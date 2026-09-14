"""Gaming PC Agent Service (MVP Manual Admin Configuration).

Enforces strict security:
- Predefined operations only: START_GAME, STOP_GAME, GET_STATUS, START_SESSION, STOP_SESSION, SHUTDOWN_PC, RESTART_PC.
- Absolutely NO arbitrary command execution (RUN_SHELL, RUN_CMD, RUN_POWERSHELL, EXECUTE_COMMAND are blocked).
- Executables are strictly resolved from administrator-configured 'node_games' records.
"""
import logging
import os
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from app.db import get_db

logger = logging.getLogger("agent")

# Predefined, strictly permitted operations
ALLOWED_OPERATIONS = {
    "START_GAME",
    "STOP_GAME",
    "GET_STATUS",
    "START_SESSION",
    "STOP_SESSION",
    "SHUTDOWN_PC",
    "RESTART_PC",
}

# Forbidden operations explicitly rejected
FORBIDDEN_OPERATIONS = {
    "EXECUTE_COMMAND",
    "RUN_SHELL",
    "RUN_POWERSHELL",
    "RUN_CMD",
}


def _detect_local_node_id() -> int:
    env_id = os.environ.get("NODE_ID")
    if env_id and env_id.isdigit():
        return int(env_id)
    candidates = [
        Path(".node_config.json"),
        Path(__file__).resolve().parents[3] / ".node_config.json",
        Path(__file__).resolve().parents[2] / ".node_config.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                import json
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if data.get("node_id"):
                        return int(data["node_id"])
            except Exception:
                pass
    return 1


class GamingPCAgent:
    """Agent running on the host / gaming node to manage game lifecycles."""

    def __init__(self, node_id: Optional[int] = None):
        self.node_id = node_id if node_id is not None else _detect_local_node_id()
        self._active_process: Optional[subprocess.Popen] = None
        self._active_game_info: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()

    def dispatch(self, operation: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Dispatch a predefined agent operation."""
        op_upper = operation.upper().strip()

        if op_upper in FORBIDDEN_OPERATIONS:
            raise PermissionError(f"Operation '{op_upper}' is strictly forbidden by security policy.")

        if op_upper not in ALLOWED_OPERATIONS:
            raise ValueError(
                f"Unrecognized operation '{op_upper}'. Permitted operations: {sorted(ALLOWED_OPERATIONS)}"
            )

        payload = payload or {}

        if op_upper == "START_GAME":
            return self.start_game(
                game_id=payload.get("game_id"),
                slug=payload.get("slug"),
            )
        elif op_upper == "STOP_GAME":
            return self.stop_game()
        elif op_upper == "GET_STATUS":
            return self.get_status()
        elif op_upper == "START_SESSION":
            return self.start_session(payload)
        elif op_upper == "STOP_SESSION":
            return self.stop_session()
        elif op_upper in ("SHUTDOWN_PC", "RESTART_PC"):
            return {"status": "acknowledged", "operation": op_upper, "message": f"{op_upper} queued"}
        else:
            raise ValueError(f"Unhandled operation: {op_upper}")

    def start_game(
        self,
        game_id: Optional[int] = None,
        slug: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Look up administrator-configured executable for this node and launch it."""
        with self._lock:
            # Query administrator-configured node_games record
            with get_db() as conn:
                cursor = conn.cursor()
                if game_id:
                    cursor.execute(
                        """
                        SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path,
                               ng.working_directory, ng.launch_arguments, ng.enabled, ng.status,
                               g.title, g.slug
                        FROM node_games ng
                        JOIN games g ON ng.game_id = g.id
                        WHERE ng.node_id = %s AND ng.game_id = %s;
                        """,
                        (self.node_id, game_id),
                    )
                elif slug:
                    cursor.execute(
                        """
                        SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path,
                               ng.working_directory, ng.launch_arguments, ng.enabled, ng.status,
                               g.title, g.slug
                        FROM node_games ng
                        JOIN games g ON ng.game_id = g.id
                        WHERE ng.node_id = %s AND g.slug = %s;
                        """,
                        (self.node_id, slug),
                    )
                else:
                    raise ValueError("Either game_id or slug is required to start a game.")

                config = cursor.fetchone()

                if not config:
                    # Fallback: Query any active node_game matching game_id / slug
                    if game_id:
                        cursor.execute(
                            """
                            SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path,
                                   ng.working_directory, ng.launch_arguments, ng.enabled, ng.status,
                                   g.title, g.slug
                            FROM node_games ng
                            JOIN games g ON ng.game_id = g.id
                            WHERE ng.game_id = %s LIMIT 1;
                            """,
                            (game_id,),
                        )
                    elif slug:
                        cursor.execute(
                            """
                            SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path,
                                   ng.working_directory, ng.launch_arguments, ng.enabled, ng.status,
                                   g.title, g.slug
                            FROM node_games ng
                            JOIN games g ON ng.game_id = g.id
                            WHERE g.slug = %s LIMIT 1;
                            """,
                            (slug,),
                        )
                    config = cursor.fetchone()

            if not config:
                raise ValueError("Game is not configured on this gaming PC by administrator.")

            if not config["enabled"] or config["status"] != "ready":
                raise ValueError(f"Game '{config['title']}' is currently '{config['status']}' on this PC.")

            exe_path = config["executable_path"].strip()
            cwd = config["working_directory"].strip() if config["working_directory"] else None
            args_str = config["launch_arguments"].strip() if config["launch_arguments"] else ""

            # Check if active game is already running
            if self._active_process and self._active_process.poll() is None:
                if self._active_game_info and self._active_game_info.get("game_id") == config["game_id"]:
                    return {
                        "status": "already_running",
                        "game_id": config["game_id"],
                        "title": config["title"],
                        "pid": self._active_process.pid,
                    }
                else:
                    self._terminate_active_process()

            # Build command argument list safely without shell=True
            cmd = [exe_path]
            if args_str:
                cmd.extend(args_str.split())

            # Verify executable existence if local host
            exe_exists = Path(exe_path).is_file()
            pid = None
            simulated = False

            if exe_exists:
                try:
                    proc = subprocess.Popen(
                        cmd,
                        cwd=cwd if cwd and Path(cwd).is_dir() else None,
                        shell=False,
                    )
                    self._active_process = proc
                    pid = proc.pid
                    logger.info("Launched game '%s' (PID %d): %s", config["title"], pid, exe_path)
                except Exception as e:
                    logger.warning("Failed to launch physical executable: %s", e)
                    simulated = True
            else:
                logger.info(
                    "Admin-configured executable path '%s' not present on disk; running in simulated mode.",
                    exe_path,
                )
                simulated = True

            self._active_game_info = {
                "game_id": config["game_id"],
                "title": config["title"],
                "slug": config["slug"],
                "executable_path": exe_path,
                "pid": pid,
                "simulated": simulated,
                "started_at": datetime.now(timezone.utc).isoformat(),
            }

            return {
                "status": "started",
                "game_id": config["game_id"],
                "title": config["title"],
                "slug": config["slug"],
                "pid": pid,
                "simulated": simulated,
            }

    def stop_game(self) -> Dict[str, Any]:
        """Terminate the active game process."""
        with self._lock:
            info = self._active_game_info
            if not self._active_process and not info:
                return {"status": "no_active_game"}

            self._terminate_active_process()
            self._active_game_info = None
            return {
                "status": "stopped",
                "previous_game": info["title"] if info else None,
            }

    def _terminate_active_process(self) -> None:
        if self._active_process:
            try:
                self._active_process.terminate()
                self._active_process.wait(timeout=3)
            except Exception:
                try:
                    self._active_process.kill()
                except Exception:
                    pass
            self._active_process = None

    def get_status(self) -> Dict[str, Any]:
        """Return agent status including any currently running game."""
        with self._lock:
            is_running = False
            if self._active_process:
                is_running = (self._active_process.poll() is None)
                if not is_running:
                    self._active_process = None
                    self._active_game_info = None
            elif self._active_game_info and self._active_game_info.get("simulated"):
                is_running = True

            return {
                "node_id": self.node_id,
                "is_running": is_running,
                "active_game": self._active_game_info if is_running else None,
            }

    def start_session(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        game_id = payload.get("game_id")
        slug = payload.get("slug")
        if game_id or slug:
            self.start_game(game_id=game_id, slug=slug)
        return {"status": "session_started", "node_id": self.node_id}

    def stop_session(self) -> Dict[str, Any]:
        self.stop_game()
        return {"status": "session_stopped", "node_id": self.node_id}


# Singleton host agent instance
host_agent = GamingPCAgent(node_id=1)
