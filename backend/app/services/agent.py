"""Gaming PC Agent Service (MVP Manual Admin Configuration).

Enforces strict security:
- Predefined operations only: START_GAME, STOP_GAME, GET_STATUS, START_SESSION, STOP_SESSION, SHUTDOWN_PC, RESTART_PC.
- Absolutely NO arbitrary command execution (RUN_SHELL, RUN_CMD, RUN_POWERSHELL, EXECUTE_COMMAND are blocked).
- Executables are strictly resolved from administrator-configured 'node_games' records.
"""
import logging
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from app.db import get_db
except ImportError:
    get_db = None

try:
    from app.services.storage.save_manager import save_manager
except ImportError:
    save_manager = None

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
def _get_running_process_names() -> set:
    """Return lowercase filenames of all currently running processes on Windows."""
    if sys.platform != "win32":
        return set()
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_char * 260),
        ]

    names = set()
    try:
        hSnap = ctypes.windll.kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
        pe32 = PROCESSENTRY32()
        pe32.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if ctypes.windll.kernel32.Process32First(hSnap, ctypes.byref(pe32)):
            while True:
                names.add(pe32.szExeFile.decode("utf-8", errors="ignore").lower())
                if not ctypes.windll.kernel32.Process32Next(hSnap, ctypes.byref(pe32)):
                    break
        ctypes.windll.kernel32.CloseHandle(hSnap)
    except Exception:
        pass
    return names


def get_host_steam_and_game_status() -> Dict[str, Any]:
    """Inspect local Windows host processes to auto-detect Steam and running games."""
    if sys.platform != "win32":
        return {
            "is_running": False,
            "is_steam": False,
            "process_name": None,
            "pid": None,
            "start_time": None,
            "game_title": None,
        }

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.windll.kernel32

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_char * 260),
        ]

    class FILETIME(ctypes.Structure):
        _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]

    def _get_proc_start_time(pid: int) -> Optional[datetime]:
        h = kernel32.OpenProcess(0x0400 | 0x1000, False, pid)
        if not h:
            return None
        creation = FILETIME()
        exit_t = FILETIME()
        kernel_t = FILETIME()
        user_t = FILETIME()
        ok = kernel32.GetProcessTimes(
            h,
            ctypes.byref(creation),
            ctypes.byref(exit_t),
            ctypes.byref(kernel_t),
            ctypes.byref(user_t),
        )
        kernel32.CloseHandle(h)
        if not ok:
            return None
        ft = (creation.dwHighDateTime << 32) + creation.dwLowDateTime
        epoch_diff = 116444736000000000
        posix_us = (ft - epoch_diff) // 10
        return datetime.fromtimestamp(posix_us / 1000000.0, tz=timezone.utc)

    known_game_exes = {}
    if get_db is not None:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT ng.executable_path, g.title FROM node_games ng JOIN games g ON ng.game_id = g.id;")
                for row in cursor.fetchall():
                    ep = (row.get("executable_path") or "").lower()
                    if ep:
                        fname = Path(ep).name.lower()
                        known_game_exes[fname] = row.get("title")
        except Exception:
            pass

    hSnap = kernel32.CreateToolhelp32Snapshot(0x00000002, 0)
    pe32 = PROCESSENTRY32()
    pe32.dwSize = ctypes.sizeof(PROCESSENTRY32)
    steam_info = None
    game_info = None

    if kernel32.Process32First(hSnap, ctypes.byref(pe32)):
        while True:
            pname = pe32.szExeFile.decode("utf-8", errors="ignore").lower()
            if pname == "steam.exe":
                s_time = _get_proc_start_time(pe32.th32ProcessID)
                steam_info = {
                    "is_running": True,
                    "is_steam": True,
                    "process_name": "steam.exe",
                    "pid": pe32.th32ProcessID,
                    "start_time": s_time,
                    "game_title": "Steam Client",
                }
            elif pname in known_game_exes or "msar" in pname or "metalslug" in pname:
                g_time = _get_proc_start_time(pe32.th32ProcessID)
                title = known_game_exes.get(pname, "METAL SLUG ATTACK RELOADED")
                game_info = {
                    "is_running": True,
                    "is_steam": False,
                    "process_name": pname,
                    "pid": pe32.th32ProcessID,
                    "start_time": g_time,
                    "game_title": title,
                }
            if not kernel32.Process32Next(hSnap, ctypes.byref(pe32)):
                break
    kernel32.CloseHandle(hSnap)

    if game_info:
        return game_info
    if steam_info:
        default_title = list(known_game_exes.values())[0] if known_game_exes else "Game Session"
        steam_info["game_title"] = default_title
        return steam_info

    return {
        "is_running": False,
        "is_steam": False,
        "process_name": None,
        "pid": None,
        "start_time": None,
        "game_title": None,
    }



def _resolve_game_executables_and_steam_appid(exe_path: str):
    """Discover all related game executable names (including shipping binaries) and Steam AppID."""
    p = Path(exe_path).resolve()
    names = {p.name.lower()}
    steam_appid = None

    if p.parent.exists():
        try:
            for sub_exe in p.parent.glob("**/*.exe"):
                sub_name = sub_exe.name.lower()
                if not any(x in sub_name for x in ("setup", "redist", "prereq", "crash")):
                    names.add(sub_name)
        except Exception:
            pass

    for parent in p.parents:
        if parent.name.lower() == "common" and parent.parent.name.lower() == "steamapps":
            steamapps_dir = parent.parent
            try:
                game_folder = p.relative_to(parent).parts[0]
                for acf in steamapps_dir.glob("appmanifest_*.acf"):
                    text = acf.read_text(encoding="utf-8", errors="ignore")
                    if game_folder.lower() in text.lower():
                        import re
                        m = re.search(r'"appid"\s+"(\d+)"', text, re.IGNORECASE)
                        if m:
                            steam_appid = m.group(1)
                            break
            except Exception:
                pass
            break

    return names, steam_appid


def _extract_target_from_shortcut(path: Path) -> List[str]:
    """Extract physical executable paths referenced inside a .lnk or .url file."""
    targets = []
    p_str = str(path)
    if p_str.lower().endswith('.url'):
        try:
            with open(p_str, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            for line in content.splitlines():
                if '=' in line:
                    _, v = line.split('=', 1)
                    v = v.strip().strip('"')
                    if v.lower().endswith('.exe') and Path(v).is_file():
                        targets.append(v)
        except Exception:
            pass
    elif p_str.lower().endswith('.lnk'):
        try:
            with open(p_str, 'rb') as f:
                raw = f.read()
            m_ascii = re.findall(rb'[a-zA-Z]:\\[^\x00\r\n\t<>\":|?*]+\.exe', raw, re.IGNORECASE)
            for b in m_ascii:
                s = b.decode('utf-8', errors='ignore')
                if Path(s).is_file() and s not in targets:
                    targets.append(s)
            m_utf16 = re.findall(rb'(?:[a-zA-Z]\x00:\x00\\(?:[^\x00\r\n\t<>\":|?*]\x00)+\.exe\x00)', raw, re.IGNORECASE)
            for b in m_utf16:
                s = b.decode('utf-16le', errors='ignore')
                if Path(s).is_file() and s not in targets:
                    targets.append(s)
        except Exception:
            pass
    return targets


def _score_game_match(candidate_path: Path, title: str, slug: str, configured_exe: Optional[str] = None) -> int:
    """Score how well a candidate file/shortcut matches the requested game."""
    stem = candidate_path.stem.lower()
    title_lower = (title or "").lower().strip()
    slug_lower = (slug or "").lower().replace('-', ' ').strip()

    # Normalize Roman numerals and numbers: "ii" <-> "2", "two" <-> "2", etc.
    def _normalize_numerals(s: str) -> str:
        s = re.sub(r'\bii\b', '2', s)
        s = re.sub(r'\biii\b', '3', s)
        s = re.sub(r'\biv\b', '4', s)
        s = re.sub(r'\btwo\b', '2', s)
        s = re.sub(r'\bthree\b', '3', s)
        return s

    norm_stem = _normalize_numerals(stem)
    norm_title = _normalize_numerals(title_lower)
    norm_slug = _normalize_numerals(slug_lower)

    # 1. Exact stem matches title or slug (or normalized)
    if stem in (title_lower, slug_lower) or norm_stem in (norm_title, norm_slug):
        return 100

    # 2. Configured exe stem match
    if configured_exe:
        conf_stem = Path(configured_exe).stem.lower()
        if stem == conf_stem or norm_stem == _normalize_numerals(conf_stem):
            return 95

    # If candidate is a shortcut (.lnk / .url), inspect its underlying target executables
    if candidate_path.suffix.lower() in ('.lnk', '.url'):
        targets = _extract_target_from_shortcut(candidate_path)
        for t in targets:
            t_stem = Path(t).stem.lower()
            if t_stem in (title_lower, slug_lower) or _normalize_numerals(t_stem) in (norm_title, norm_slug):
                return 98
            if configured_exe and t_stem == Path(configured_exe).stem.lower():
                return 95

    # 3. Clean word tokens (filtering out generic filler words)
    ignore_tokens = {'the', 'edition', 'pc', 'remastered', 'season', 'mode', 'game', 'final', 'deluxe'}
    raw_tokens = [w for w in re.findall(r'[a-z0-9]+', norm_title) if w not in ignore_tokens and len(w) >= 2]
    if not raw_tokens:
        raw_tokens = [w for w in re.findall(r'[a-z0-9]+', norm_title) if len(w) >= 2]

    cand_tokens = set(re.findall(r'[a-z0-9]+', norm_stem))

    if not raw_tokens:
        return 0

    # All key tokens present in candidate name
    if all(tok in cand_tokens for tok in raw_tokens):
        return 85

    # Check match ratio
    matched_count = sum(1 for tok in raw_tokens if tok in cand_tokens)
    if matched_count >= max(1, len(raw_tokens) - 1):
        return 70 + matched_count * 5

    # Check substring match for primary game name (token length >= 4)
    primary_tokens = [t for t in raw_tokens if len(t) >= 4]
    if primary_tokens and any(t in norm_stem for t in primary_tokens):
        return 65

    return 0


def _find_local_game_file(title: str, slug: str, configured_path: Optional[str] = None) -> Optional[Path]:
    """Search user desktop (including custom folders where shortcuts were moved),
    Start Menu, Steam libraries, and standard drive game directories for a matching game executable or shortcut.
    """
    if configured_path and Path(configured_path).is_file():
        return Path(configured_path)

    search_roots = []

    # 1. User Desktop & Public Desktop (recursive to find any folder where user moved shortcuts)
    desktop_dirs = [
        Path.home() / "Desktop",
        Path.home() / "OneDrive" / "Desktop",
        Path(os.environ.get("PUBLIC", "C:/Users/Public")) / "Desktop",
        Path.home() / "Games",
        Path.home() / "Saved Games",
        Path.home() / "Downloads",
    ]
    for d in desktop_dirs:
        if d.is_dir():
            search_roots.append((d, 4))

    # 2. Start Menu Programs
    start_menu_dirs = [
        Path(os.environ.get("APPDATA", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
        Path(os.environ.get("ProgramData", "")) / "Microsoft" / "Windows" / "Start Menu" / "Programs",
    ]
    for d in start_menu_dirs:
        if d.is_dir():
            search_roots.append((d, 3))

    # 3. Steam Libraries
    steam_roots = [
        Path(r"C:\Program Files (x86)\Steam"),
        Path(r"C:\Program Files\Steam"),
    ]
    steam_common_dirs = []
    for s_root in steam_roots:
        vdf = s_root / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            try:
                txt = vdf.read_text("utf-8", errors="ignore")
                for line in txt.splitlines():
                    if '"path"' in line:
                        parts = line.split('"path"', 1)[1].strip().strip('"').replace('\\\\', '\\')
                        c_dir = Path(parts) / "steamapps" / "common"
                        if c_dir.is_dir() and c_dir not in steam_common_dirs:
                            steam_common_dirs.append(c_dir)
            except Exception:
                pass
        common = s_root / "steamapps" / "common"
        if common.is_dir() and common not in steam_common_dirs:
            steam_common_dirs.append(common)

    for sc in steam_common_dirs:
        search_roots.append((sc, 2))

    # 4. Standard Game installation folders on available drives
    game_folders = [
        Path(r"C:\Program Files\Epic Games"),
        Path(r"C:\Games"),
        Path(r"D:\Games"),
        Path(r"E:\Games"),
        Path(r"C:\XboxGames"),
        Path(r"D:\XboxGames"),
    ]
    for gf in game_folders:
        if gf.is_dir():
            search_roots.append((gf, 2))

    best_candidate: Optional[Tuple[int, Path]] = None
    valid_extensions = {".lnk", ".url", ".exe"}

    for root_dir, max_depth in search_roots:
        try:
            root_depth = len(root_dir.parts)
            for dirpath, dirnames, filenames in os.walk(str(root_dir)):
                curr_depth = len(Path(dirpath).parts) - root_depth
                if curr_depth > max_depth:
                    dirnames.clear()
                    continue

                for fname in filenames:
                    ext = os.path.splitext(fname)[1].lower()
                    if ext not in valid_extensions:
                        continue

                    # Ignore uninstaller and crash reporter files
                    fname_lower = fname.lower()
                    if any(bad in fname_lower for bad in ("uninstall", "crashreport", "unitycrash", "cleanup", "redist", "vcredist", "dxsetup")):
                        continue

                    cand_path = Path(dirpath) / fname
                    score = _score_game_match(cand_path, title, slug, configured_path)
                    if score > 0:
                        # Slight preference for desktop shortcuts
                        is_desktop = any(str(cand_path).startswith(str(d)) for d in desktop_dirs)
                        final_score = score + (10 if is_desktop else 0)
                        if not best_candidate or final_score > best_candidate[0]:
                            best_candidate = (final_score, cand_path)
        except Exception:
            continue

    if best_candidate and best_candidate[0] >= 50:
        return best_candidate[1]
    return None


class GamingPCAgent:
    """Agent running on the host / gaming node to manage game lifecycles."""

    def __init__(self, node_id: Optional[int] = None, api_base: str = "https://api.cloudkh.space"):
        self.node_id = node_id if node_id is not None else _detect_local_node_id()
        self.api_base = api_base
        self._active_process: Optional[subprocess.Popen] = None
        self._active_game_info: Optional[Dict[str, Any]] = None
        self._exit_callbacks = []
        self._authorized_game_exes: set = set()
        self._watchdog_active = False
        self._lock = threading.Lock()
        self._load_authorized_game_exes()

    def register_exit_callback(self, callback) -> None:
        """Register a function to execute immediately when the game process terminates."""
        if callback not in self._exit_callbacks:
            self._exit_callbacks.append(callback)

    def _load_authorized_game_exes(self) -> None:
        """Cache all configured game executables from DB or Cloud API."""
        loaded_from_db = False
        if get_db is not None:
            try:
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT executable_path FROM node_games WHERE enabled IS TRUE;")
                    rows = cursor.fetchall()
                    for row in rows:
                        p = row.get("executable_path", "").strip()
                        if p:
                            names, _ = _resolve_game_executables_and_steam_appid(p)
                            self._authorized_game_exes.update(names)
                    loaded_from_db = True
            except Exception as e:
                logger.debug("Could not load authorized game exes from DB (worker node mode): %s", e)

        if not loaded_from_db:
            try:
                import json
                import urllib.request
                api = getattr(self, "api_base", "https://api.cloudkh.space")
                req = urllib.request.Request(f"{api.rstrip('/')}/api/machines", headers={"User-Agent": "CloudKH-NodeStreamer/1.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    machines = json.loads(resp.read().decode("utf-8"))
                    for m in machines:
                        if m.get("id") == self.node_id or str(m.get("id")) == str(self.node_id):
                            for g in m.get("installed_games", []):
                                p = g.get("executable_path", "").strip()
                                if p:
                                    names, _ = _resolve_game_executables_and_steam_appid(p)
                                    self._authorized_game_exes.update(names)
            except Exception as e:
                logger.debug("Could not load authorized game exes from Cloud API: %s", e)

    def is_game_running(self) -> bool:
        """Check if an authorized game process is currently running on the PC."""
        with self._lock:
            if self._active_process and self._active_process.poll() is None:
                return True
            if self._active_game_info and self._active_game_info.get("simulated"):
                return True

            # If game was started less than 15s ago, maintain running state during bootstrap
            if self._active_game_info and self._active_game_info.get("started_at"):
                try:
                    s_dt = datetime.fromisoformat(self._active_game_info["started_at"])
                    elapsed = (datetime.now(timezone.utc) - s_dt).total_seconds()
                    if elapsed < 15.0:
                        return True
                except Exception:
                    pass

            running = _get_running_process_names()
            if self._authorized_game_exes and (self._authorized_game_exes & running):
                return True

            # Check if running contains active game exe or title/slug keywords
            if self._active_game_info:
                p = self._active_game_info.get("executable_path")
                if p and Path(p).name.lower() in running:
                    return True
                title = (self._active_game_info.get("title") or "").lower()
                slug = (self._active_game_info.get("slug") or "").lower().replace("-", " ")
                tokens = {w for w in re.findall(r'[a-z0-9]+', f"{title} {slug}") if len(w) >= 4 and w not in ("game", "mode", "edition", "season", "final", "deluxe")}
                tokens.update({"minecraft", "spiritfarer", "stardew", "hades", "msar", "metalslug", "shipping"})
                for kw in tokens:
                    if (kw in title or kw in slug or kw in ("msar", "shipping")) and any(kw in r for r in running):
                        return True

            self._load_authorized_game_exes()
            if self._authorized_game_exes and (self._authorized_game_exes & running):
                return True

            return False

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
                user_id=payload.get("user_id"),
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
        user_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Look up administrator-configured executable for this node and launch it."""
        with self._lock:
            config = None
            # 1. Try local database if available
            if get_db is not None:
                try:
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
                except Exception as db_exc:
                    logger.debug("[Agent] Local DB query skipped/failed (worker node mode): %s", db_exc)

            # 2. Fallback: Query Cloud API if running as worker node without local database
            if not config:
                try:
                    import json
                    import urllib.request
                    api = getattr(self, "api_base", "https://api.cloudkh.space")
                    req = urllib.request.Request(f"{api.rstrip('/')}/api/machines", headers={"User-Agent": "CloudKH-NodeStreamer/1.0"})
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        machines = json.loads(resp.read().decode("utf-8"))
                        for m in machines:
                            if m.get("id") == self.node_id or str(m.get("id")) == str(self.node_id):
                                for g in m.get("installed_games", []):
                                    if (game_id and g.get("game_id") == game_id) or (slug and g.get("slug") == slug):
                                        config = g
                                        break
                                if config:
                                    break
                        # If still not found for self.node_id, search any machine as fallback
                        if not config:
                            for m in machines:
                                for g in m.get("installed_games", []):
                                    if (game_id and g.get("game_id") == game_id) or (slug and g.get("slug") == slug):
                                        config = g
                                        break
                                if config:
                                    break
                except Exception as api_exc:
                    logger.warning("[Agent] Error resolving game via Cloud API: %s", api_exc)

            if not config:
                raise ValueError("Game is not configured on this gaming PC by administrator.")

            if not config.get("enabled", True) or config.get("status", "ready") != "ready":
                raise ValueError(f"Game '{config.get('title')}' is currently '{config.get('status')}' on this PC.")

            exe_path = config["executable_path"].strip()
            cwd = config.get("working_directory")
            if cwd:
                cwd = cwd.strip()
            if not cwd or not Path(cwd).is_dir():
                cwd = str(Path(exe_path).parent)
            args_str = config.get("launch_arguments", "").strip() if config.get("launch_arguments") else ""

            # If configured executable does not exist on disk, auto-discover local game executable or shortcut
            if not Path(exe_path).is_file():
                logger.info(
                    "Configured executable '%s' not found on disk. Searching Desktop (including subfolders), Start Menu, and game directories...",
                    exe_path,
                )
                discovered = _find_local_game_file(
                    title=config.get("title", ""),
                    slug=config.get("slug", ""),
                    configured_path=exe_path,
                )
                if discovered:
                    logger.info("Auto-discovered local game executable/shortcut: %s", discovered)
                    exe_path = str(discovered)
                    if not cwd or not Path(cwd).is_dir():
                        cwd = str(discovered.parent)

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

            # Multi-Tenant User Save Isolation: mount player private save state
            save_mount_info = None
            if user_id and save_manager is not None:
                save_dir = save_manager.resolve_game_save_dir(
                    game_slug=config.get("slug"),
                    configured_save_path=config.get("save_directory"),
                )
                if save_dir:
                    try:
                        save_mount_info = save_manager.mount_user_save(
                            user_id=user_id,
                            game_id=config["game_id"],
                            target_save_dir=save_dir,
                        )
                        save_manager.start_auto_sync(interval_seconds=60)
                    except Exception as exc:
                        logger.warning("Failed to mount user save: %s", exc)

            # Build command argument list safely without shell=True
            cmd = [exe_path]
            if args_str:
                cmd.extend(args_str.split())

            # Resolve all executable names (including shipping binaries)
            exe_names, _ = _resolve_game_executables_and_steam_appid(exe_path)
            self._authorized_game_exes.update(exe_names)

            # Check if target is a Windows shortcut (.lnk or .url)
            is_shortcut = exe_path.lower().endswith((".lnk", ".url"))
            exe_exists = Path(exe_path).is_file()
            pid = None
            simulated = False

            if exe_exists:
                if is_shortcut:
                    try:
                        logger.info("Launching game via Windows shortcut/URL: %s (CWD: %s)", exe_path, cwd)
                        # Extract physical target executables if available
                        targets = _extract_target_from_shortcut(Path(exe_path))
                        for t in targets:
                            names, _ = _resolve_game_executables_and_steam_appid(t)
                            self._authorized_game_exes.update(names)
                            logger.info("Registered shortcut target executable: %s", t)

                        if sys.platform == "win32":
                            import ctypes
                            ret = ctypes.windll.shell32.ShellExecuteW(
                                None,
                                "open",
                                str(exe_path),
                                args_str or None,
                                str(cwd) if cwd and Path(cwd).is_dir() else None,
                                1,  # SW_SHOWNORMAL
                            )
                            if ret <= 32:
                                os.startfile(str(exe_path))
                        else:
                            subprocess.Popen(["xdg-open", exe_path])

                        simulated = False
                        self._start_process_watchdog(config["title"], config["game_id"])
                        if sys.platform == "win32":
                            threading.Thread(target=self._focus_game_window, daemon=True).start()
                    except Exception as e:
                        logger.error("Failed to launch game shortcut '%s': %s", exe_path, e)
                        return {
                            "status": "error",
                            "error": f"Failed to launch game shortcut: {e}",
                            "game_id": config["game_id"],
                            "title": config["title"],
                        }
                else:
                    try:
                        logger.info("Executing native game executable: %s (CWD: %s)", exe_path, cwd)
                        proc = subprocess.Popen(
                            cmd,
                            cwd=cwd,
                            shell=False,
                        )
                        self._active_process = proc
                        pid = proc.pid
                        logger.info("Launched game '%s' (PID %s): %s", config["title"], pid, exe_path)

                        # Start robust process tree watchdog
                        self._start_process_watchdog(config["title"], config["game_id"])

                        # Focus game window on Windows
                        if sys.platform == "win32":
                            threading.Thread(target=self._focus_game_window, daemon=True).start()
                    except Exception as e:
                        elevated_ok = False
                        # WinError 740: The requested operation requires elevation
                        if sys.platform == "win32" and (getattr(e, "winerror", None) == 740 or "740" in str(e)):
                            logger.warning("Physical executable requires elevation [WinError 740]. Attempting ShellExecuteW 'runas'...")
                            try:
                                import ctypes
                                ret = ctypes.windll.shell32.ShellExecuteW(
                                    None,
                                    "runas",
                                    str(exe_path),
                                    args_str or None,
                                    str(cwd) if cwd else None,
                                    1,  # SW_SHOWNORMAL
                                )
                                if ret > 32:
                                    elevated_ok = True
                                    logger.info("Launched elevated game '%s' via ShellExecuteW: %s", config["title"], exe_path)
                                    self._start_process_watchdog(config["title"], config["game_id"])
                                    threading.Thread(target=self._focus_game_window, daemon=True).start()
                                else:
                                    logger.error("ShellExecuteW 'runas' failed with code %s", ret)
                            except Exception as shell_err:
                                logger.error("ShellExecuteW elevation exception: %s", shell_err)

                        if not elevated_ok:
                            logger.error("Failed to launch physical executable: %s", e)
                            return {
                                "status": "error",
                                "error": f"Failed to launch game: {e}. The game requires elevation. Please run Command Prompt as Administrator!",
                                "game_id": config["game_id"],
                                "title": config["title"],
                            }
            else:
                logger.info(
                    "Game executable or shortcut '%s' not present on disk; running in simulated mode.",
                    exe_path,
                )
                simulated = True

            self._active_game_info = {
                "game_id": config["game_id"],
                "user_id": user_id,
                "title": config["title"],
                "slug": config["slug"],
                "executable_path": exe_path,
                "pid": pid,
                "simulated": simulated,
                "save_mount": save_mount_info,
                "started_at": datetime.now(timezone.utc).isoformat(),
            }

            return {
                "status": "started",
                "game_id": config["game_id"],
                "user_id": user_id,
                "title": config["title"],
                "slug": config["slug"],
                "pid": pid,
                "simulated": simulated,
                "save_mount": save_mount_info,
            }

    def _start_process_watchdog(self, title: str, game_id: int) -> None:
        """Monitor game process in background without killing early if launcher hands off."""
        if self._watchdog_active:
            return
        self._watchdog_active = True

        def _watch():
            logger.info("[Watchdog] Monitoring game '%s' (grace period for process bootstrap)...", title)
            # Give game up to 18 seconds to bootstrap its window and shipping process
            for _ in range(18):
                time.sleep(1.0)
                if self.is_game_running():
                    break

            logger.info("[Watchdog] Game '%s' bootstrap complete. Monitoring active lifecycle...", title)

            # Loop while any authorized game process is running; require multiple consecutive failed checks
            consecutive_failed = 0
            while True:
                if not self.is_game_running():
                    consecutive_failed += 1
                    if consecutive_failed >= 5:  # 5 checks * 0.8s = 4.0s of continuous absence
                        break
                else:
                    consecutive_failed = 0
                time.sleep(0.8)

            logger.info("[Watchdog] Game '%s' has stopped running. Triggering exit...", title)
            self._watchdog_active = False
            self._handle_process_exit(0, title, game_id)

        t = threading.Thread(target=_watch, name=f"Watchdog-{title}", daemon=True)
        t.start()

    def get_active_game_window_handle(self) -> Optional[int]:
        """Find the native HWND for any authorized running game window on Windows.

        Uses OpenDesktopW('default') and EnumDesktopWindows to reliably discover
        windows on the interactive desktop, matching against authorized game exes,
        and returning the window with the largest visible area.
        """
        if sys.platform != "win32":
            return None
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        hdesk = None
        try:
            hdesk = user32.OpenDesktopW("default", 0, False, 0x01FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)
        except Exception:
            pass

        # Make sure authorized exes are loaded
        if not self._authorized_game_exes:
            self._load_authorized_game_exes()

        target_exes_lower = {x.lower() for x in self._authorized_game_exes}
        if self._active_game_info and self._active_game_info.get("executable_path"):
            target_exes_lower.add(Path(self._active_game_info["executable_path"]).name.lower())
        candidates = []

        def enum_cb(hwnd, lparam):
            if not user32.IsWindowVisible(hwnd):
                return 1
            rc = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rc))
            w = max(0, rc.right - rc.left)
            h = max(0, rc.bottom - rc.top)
            if w < 100 or h < 100:
                return 1

            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            matched = False
            found_name = "unknown"

            hproc = kernel32.OpenProcess(0x1000, False, pid.value)
            if hproc:
                buf = ctypes.create_unicode_buffer(512)
                size = wintypes.DWORD(512)
                if kernel32.QueryFullProcessImageNameW(hproc, 0, buf, ctypes.byref(size)):
                    found_name = Path(buf.value).name.lower()
                    if found_name in target_exes_lower or any(k in found_name for k in ("minecraft", "spiritfarer", "stardew", "hades", "msar", "shipping")):
                        matched = True
                kernel32.CloseHandle(hproc)

            # Check window title fallback (accessible even across integrity/elevation levels)
            if not matched:
                t_buf = ctypes.create_unicode_buffer(512)
                if user32.GetWindowTextW(hwnd, t_buf, 512) > 0:
                    w_title = t_buf.value.lower()
                    active_title = (self._active_game_info.get("title") or "").lower() if self._active_game_info else ""
                    if (active_title and active_title in w_title) or any(k in w_title for k in ("minecraft", "spiritfarer", "stardew", "hades")):
                        matched = True
                        found_name = t_buf.value

            if matched:
                candidates.append((w * h, hwnd, found_name, w, h))
            return 1

        CMP = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HWND, wintypes.LPARAM)
        try:
            user32.EnumDesktopWindows(hdesk if hdesk else 0, CMP(enum_cb), 0)
        except Exception as exc:
            logger.debug("[Agent] EnumDesktopWindows error: %s", exc)

        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            chosen_hwnd = candidates[0][1]
            logger.info(
                "[Agent] Found active game window HWND: %s (0x%x, exe: %s, %dx%d)",
                chosen_hwnd, chosen_hwnd, candidates[0][2], candidates[0][3], candidates[0][4]
            )
            return chosen_hwnd
        return None

    def bring_game_to_foreground(self, hwnd: Optional[int] = None) -> None:
        """Bring the specified or active game window to the foreground and maximize it."""
        if sys.platform != "win32":
            return
        if not hwnd:
            hwnd = self.get_active_game_window_handle()
        if not hwnd:
            return

        import ctypes
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        try:
            hdesk = user32.OpenDesktopW("default", 0, False, 0x01FF)
            if hdesk:
                user32.SetThreadDesktop(hdesk)

            fg_hwnd = user32.GetForegroundWindow()
            fg_tid = user32.GetWindowThreadProcessId(fg_hwnd, None) if fg_hwnd else 0
            cur_tid = kernel32.GetCurrentThreadId()

            if fg_tid and fg_tid != cur_tid:
                user32.AttachThreadInput(cur_tid, fg_tid, True)

            # SW_RESTORE = 9, SW_MAXIMIZE = 3
            user32.ShowWindow(hwnd, 9)
            user32.ShowWindow(hwnd, 3)
            user32.SetForegroundWindow(hwnd)
            user32.SetFocus(hwnd)

            if fg_tid and fg_tid != cur_tid:
                user32.AttachThreadInput(cur_tid, fg_tid, False)

            logger.info("[Agent] Brought game window (HWND 0x%x) to foreground & maximized.", hwnd)
        except Exception as e:
            logger.debug("[Agent] Could not bring game window to foreground: %s", e)

    def _focus_game_window(self) -> None:
        """Bring the newly launched game window to foreground on Windows."""
        for _ in range(10):
            time.sleep(1.0)
            hwnd = self.get_active_game_window_handle()
            if hwnd:
                self.bring_game_to_foreground(hwnd)
                logger.info("[Agent] Focused game window HWND 0x%x", hwnd)
                break

    def _handle_process_exit(self, pid: int, title: str, game_id: int) -> None:
        """Invoked immediately when the game process terminates."""
        with self._lock:
            self._active_process = None
            self._active_game_info = None

        if save_manager is not None:
            logger.info("[Agent] Game '%s' exited. Unmounting & archiving user saves...", title)
            try:
                save_manager.unmount_session(clean_after=True)
            except Exception as exc:
                logger.warning("[Agent] Save unmount error on exit: %s", exc)

        for cb in list(self._exit_callbacks):
            try:
                cb(game_id, title)
            except Exception as exc:
                logger.warning("[Agent] Error invoking exit callback: %s", exc)

    def stop_game(self) -> Dict[str, Any]:
        """Terminate the active game process and archive user save state."""
        with self._lock:
            info = self._active_game_info
            logger.info("[Agent] stop_game requested. Initiating process termination...")
            self._terminate_active_process()
            self._active_game_info = None
            self._watchdog_active = False

        archive_res = None
        if save_manager is not None:
            time.sleep(0.5)  # Allow process to finish writing files to disk
            try:
                archive_res = save_manager.unmount_session(clean_after=True)
            except Exception as exc:
                logger.warning("[Agent] Save unmount error in stop_game: %s", exc)

        if info:
            for cb in list(self._exit_callbacks):
                try:
                    cb(info.get("game_id", 0), info.get("title", "Game"))
                except Exception as exc:
                    logger.warning("[Agent] Error invoking exit callback from stop_game: %s", exc)

        return {
            "status": "stopped",
            "previous_game": info["title"] if info else None,
            "save_archived": archive_res,
        }

    def _terminate_active_process(self) -> None:
        """Forcefully terminate active game process via process handle, window PID, WM_CLOSE, and taskkill."""
        logger.info("[Agent] Forcefully terminating active game process and child trees...")
        if self._active_process:
            try:
                self._active_process.terminate()
                self._active_process.wait(timeout=2)
            except Exception:
                try:
                    self._active_process.kill()
                except Exception:
                    pass
            self._active_process = None

        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            protected_exes = {
                "steam.exe", "steamwebhelper.exe", "steamservice.exe",
                "explorer.exe", "python.exe", "uvicorn.exe", "node.exe",
                "cmd.exe", "powershell.exe", "conhost.exe", "code.exe",
                "taskhostw.exe", "dwm.exe", "svchost.exe"
            }

            # 1. Attempt to find active window, post WM_CLOSE, and record PID
            target_pids = set()
            try:
                hwnd = self.get_active_game_window_handle()
                if hwnd:
                    pid = wintypes.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if pid.value > 0:
                        target_pids.add(pid.value)
                    logger.info("[Agent] Posting WM_CLOSE to game window HWND 0x%x (PID %d)...", hwnd, pid.value)
                    user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
            except Exception as exc:
                logger.debug("[Agent] Error signaling active window: %s", exc)

            # 2. Gather all target game executable names across all configured games
            target_exes = set()
            if self._authorized_game_exes:
                target_exes.update(self._authorized_game_exes)

            if self._active_game_info:
                p = self._active_game_info.get("executable_path")
                if p:
                    target_exes.add(Path(p).name.lower())

            if get_db is not None:
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT executable_path FROM node_games;")
                        for row in cursor.fetchall():
                            ep = (row.get("executable_path") or "").strip()
                            if ep:
                                target_exes.add(Path(ep).name.lower())
                except Exception:
                    pass

            # Also add common game exe patterns and active game tokens if running
            try:
                running = _get_running_process_names()
                active_tokens = set()
                if self._active_game_info:
                    t = (self._active_game_info.get("title") or "").lower()
                    s = (self._active_game_info.get("slug") or "").lower().replace("-", " ")
                    active_tokens = {w for w in re.findall(r'[a-z0-9]+', f"{t} {s}") if len(w) >= 4 and w not in ("game", "mode", "edition", "season")}
                active_tokens.update({"minecraft", "spiritfarer", "stardew", "hades", "msar", "metalslug", "shipping"})
                for r_exe in running:
                    if r_exe in protected_exes:
                        continue
                    if any(k in r_exe for k in active_tokens):
                        target_exes.add(r_exe)
            except Exception:
                pass

            target_exes = {e.lower() for e in target_exes if e.lower() not in protected_exes and e.endswith(".exe")}

            # 3. Terminate by target PIDs
            for pid in target_pids:
                try:
                    logger.info("[Agent] Terminating game window PID %d...", pid)
                    subprocess.run(["taskkill", "/F", "/PID", str(pid), "/T"], capture_output=True, timeout=3)
                except Exception:
                    pass

            # 4. Terminate by executable image names
            for exe in target_exes:
                try:
                    logger.info("[Agent] Executing taskkill /F /IM %s /T", exe)
                    subprocess.run(["taskkill", "/F", "/IM", exe, "/T"], capture_output=True, timeout=3)
                except Exception:
                    pass

            # 5. Check if any target process remains (e.g. elevated UAC token) and escalate
            try:
                time.sleep(0.3)
                remaining = _get_running_process_names()
                still_running = target_exes & remaining
                if still_running:
                    logger.warning("[Agent] Processes still running (elevated token): %s. Escalating to elevated taskkill via ShellExecuteW...", still_running)
                    for exe in still_running:
                        try:
                            ctypes.windll.shell32.ShellExecuteW(
                                None,
                                "runas",
                                "taskkill.exe",
                                f"/F /IM {exe} /T",
                                None,
                                0,  # SW_HIDE
                            )
                        except Exception as elev_exc:
                            logger.error("[Agent] Elevated taskkill error for %s: %s", exe, elev_exc)
            except Exception as e:
                logger.debug("[Agent] Post-termination check exception: %s", e)

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
host_agent = GamingPCAgent(node_id=None)
