"""Multi-Tenant Game Save State Manager.

Isolates and persists save states for each player.
Automatically swaps save files into the game's native directory on session start,
periodically syncs during gameplay, and archives files to user vault upon exit.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("storage.save_manager")

# Default user storage location on host
DEFAULT_USER_STORAGE = Path(__file__).resolve().parents[4] / "user_storage"

# Known default save directories for supported games
KNOWN_GAME_SAVE_PATHS = {
    "metal-slug-attack-reloaded": os.path.expandvars(r"%LOCALAPPDATA%\MSAR\Saved\SaveGames"),
    "msar": os.path.expandvars(r"%LOCALAPPDATA%\MSAR\Saved\SaveGames"),
}


class SaveStateManager:
    """Manages player profile mounting, swapping, auto-syncing, and archival."""

    def __init__(self, storage_root: Optional[Path] = None):
        self.storage_root = Path(storage_root or DEFAULT_USER_STORAGE)
        self.storage_root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._active_user_id: Optional[int] = None
        self._active_game_id: Optional[int] = None
        self._active_save_dir: Optional[Path] = None
        self._sync_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def resolve_game_save_dir(
        self,
        game_slug: Optional[str] = None,
        configured_save_path: Optional[str] = None,
    ) -> Optional[Path]:
        """Determine the actual save directory on the Windows gaming PC."""
        if configured_save_path and configured_save_path.strip():
            expanded = os.path.expandvars(configured_save_path.strip())
            return Path(expanded)

        if game_slug:
            slug_clean = game_slug.lower().strip()
            if slug_clean in KNOWN_GAME_SAVE_PATHS:
                return Path(KNOWN_GAME_SAVE_PATHS[slug_clean])

        return None

    def get_user_vault(self, user_id: int, game_id: int) -> Path:
        """Return the persistent storage path for this user and game."""
        vault = self.storage_root / f"user_{user_id}" / f"game_{game_id}"
        vault.mkdir(parents=True, exist_ok=True)
        return vault

    def mount_user_save(
        self,
        user_id: int,
        game_id: int,
        target_save_dir: Path,
    ) -> Dict[str, Any]:
        """Mount a user's save state into the game's active directory.
        
        1. Backs up previous user's save if one was left behind.
        2. Cleans the target directory so old progress is removed.
        3. Restores this user's files from their vault (or leaves clean for new players).
        """
        with self._lock:
            target_save_dir = Path(target_save_dir)
            target_save_dir.mkdir(parents=True, exist_ok=True)

            # If a different user was previously active and not archived, archive them now
            if self._active_user_id and self._active_user_id != user_id and self._active_save_dir:
                self._archive_directory(self._active_user_id, self._active_game_id or game_id, self._active_save_dir)

            vault = self.get_user_vault(user_id, game_id)
            vault_files = list(vault.glob("*"))

            # Clean the active game save directory so no other user's files remain
            self._clean_directory(target_save_dir)

            restored_count = 0
            if vault_files:
                for item in vault_files:
                    dest = target_save_dir / item.name
                    if item.is_dir():
                        shutil.copytree(item, dest, dirs_exist_ok=True)
                    else:
                        shutil.copy2(item, dest)
                    restored_count += 1
                logger.info(
                    "[SAVE_MANAGER] Restored %d save file(s) for User #%d in %s",
                    restored_count, user_id, target_save_dir,
                )
                status = "restored"
            else:
                logger.info(
                    "[SAVE_MANAGER] Clean slate initialized for new player User #%d in %s",
                    user_id, target_save_dir,
                )
                status = "new_profile"

            self._active_user_id = user_id
            self._active_game_id = game_id
            self._active_save_dir = target_save_dir

            return {
                "status": status,
                "user_id": user_id,
                "game_id": game_id,
                "restored_files": restored_count,
                "save_dir": str(target_save_dir),
            }

    def archive_user_save(
        self,
        user_id: Optional[int] = None,
        game_id: Optional[int] = None,
        target_save_dir: Optional[Path] = None,
    ) -> Dict[str, Any]:
        """Copy current save files from active game folder into user vault."""
        with self._lock:
            uid = user_id or self._active_user_id
            gid = game_id or self._active_game_id
            sdir = target_save_dir or self._active_save_dir

            if not uid or not gid or not sdir or not Path(sdir).exists():
                return {"status": "skipped", "reason": "no_active_session"}

            return self._archive_directory(uid, gid, Path(sdir))

    def _archive_directory(self, user_id: int, game_id: int, save_dir: Path) -> Dict[str, Any]:
        """Internal helper to copy files from save_dir into vault."""
        vault = self.get_user_vault(user_id, game_id)
        active_files = [f for f in save_dir.glob("*") if f.name != ".tmp"]
        archived_count = 0

        for item in active_files:
            dest = vault / item.name
            if item.is_dir():
                shutil.copytree(item, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(item, dest)
            archived_count += 1

        # Write metadata manifest
        manifest = {
            "user_id": user_id,
            "game_id": game_id,
            "file_count": archived_count,
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "files": [f.name for f in active_files],
        }
        with open(vault / "_manifest.json", "w", encoding="utf-8") as mf:
            json.dump(manifest, mf, indent=2)

        logger.info(
            "[SAVE_MANAGER] Archived %d file(s) for User #%d in %s",
            archived_count, user_id, vault,
        )
        return {
            "status": "archived",
            "user_id": user_id,
            "game_id": game_id,
            "archived_files": archived_count,
            "vault": str(vault),
        }

    def _clean_directory(self, target_dir: Path) -> None:
        """Safely clear contents of the game save directory."""
        if not target_dir.exists():
            return
        for item in target_dir.glob("*"):
            try:
                if item.is_dir():
                    shutil.rmtree(item, ignore_errors=True)
                else:
                    item.unlink(missing_ok=True)
            except Exception as e:
                logger.warning("[SAVE_MANAGER] Failed to remove %s: %s", item, e)

    def start_auto_sync(self, interval_seconds: int = 60) -> None:
        """Start background daemon to snapshot save files every interval_seconds."""
        self.stop_auto_sync()
        self._stop_event.clear()

        def _sync_worker():
            while not self._stop_event.wait(interval_seconds):
                try:
                    self.archive_user_save()
                except Exception as exc:
                    logger.warning("[SAVE_MANAGER] Background auto-sync warning: %s", exc)

        self._sync_thread = threading.Thread(
            target=_sync_worker,
            name="SaveAutoSyncThread",
            daemon=True,
        )
        self._sync_thread.start()
        logger.info("[SAVE_MANAGER] Background auto-sync started (every %ds)", interval_seconds)

    def stop_auto_sync(self) -> None:
        """Stop background auto-sync thread."""
        self._stop_event.set()
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=2.0)
            self._sync_thread = None

    def unmount_session(self, clean_after: bool = True) -> Dict[str, Any]:
        """Finalize player session: stop auto-sync, archive save, and optionally clean PC."""
        self.stop_auto_sync()
        result = self.archive_user_save()
        if clean_after and self._active_save_dir:
            with self._lock:
                self._clean_directory(self._active_save_dir)
                logger.info("[SAVE_MANAGER] Cleaned active save directory %s", self._active_save_dir)

        with self._lock:
            self._active_user_id = None
            self._active_game_id = None
            self._active_save_dir = None

        return result


# Singleton SaveStateManager instance
save_manager = SaveStateManager()
