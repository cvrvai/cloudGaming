"""GStreamer availability and plugin diagnostics."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from functools import lru_cache
from typing import Dict, List, Optional, Tuple

from app.core.gst_env import configure_gstreamer_env

configure_gstreamer_env()

try:
    import gi

    gi.require_version("Gst", "1.0")
    from gi.repository import Gst

    GSTREAMER_AVAILABLE = True
    GSTREAMER_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - depends on host install
    GSTREAMER_AVAILABLE = False
    GSTREAMER_IMPORT_ERROR = str(exc)

# Elements required by the capture -> x264enc -> webrtcbin pipeline
if sys.platform.startswith("linux"):
    REQUIRED_ELEMENTS: List[str] = [
        "ximagesrc",
        "videoconvert",
        "videoscale",
        "x264enc",
        "h264parse",
        "rtph264pay",
        "webrtcbin",
    ]
else:
    REQUIRED_ELEMENTS = [
        "d3d11screencapturesrc",
        "d3d11convert",
        "d3d11download",
        "videoconvert",
        "x264enc",
        "h264parse",
        "rtph264pay",
        "webrtcbin",
    ]

AUDIO_ELEMENTS: List[str] = ["wasapisrc", "opusenc", "rtpopuspay"] if sys.platform == "win32" else []


def ensure_gstreamer_initialized() -> bool:
    if not GSTREAMER_AVAILABLE:
        return False
    if not Gst.is_initialized():
        Gst.init([])
    return True


@lru_cache(maxsize=1)
def audio_plugins_available() -> bool:
    """Return whether the local WebRTC audio pipeline can be constructed."""
    if not GSTREAMER_AVAILABLE or not AUDIO_ELEMENTS:
        return False
    ensure_gstreamer_initialized()
    return all(Gst.ElementFactory.find(element) is not None for element in AUDIO_ELEMENTS)


def _find_gst_inspect() -> Optional[str]:
    gst_bin = os.getenv("GSTREAMER_BIN", r"C:\gstreamer\1.0\msvc_x86_64\bin")
    try:
        from app.core.config import settings
        gst_bin = getattr(settings, "gstreamer_bin", gst_bin)
    except Exception:
        pass

    candidates = [
        os.path.join(gst_bin, "gst-inspect-1.0.exe"),
        shutil.which("gst-inspect-1.0"),
        shutil.which("gst-inspect-1.0.exe"),
    ]
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def _inspect_element(gst_inspect: str, element: str) -> Tuple[bool, str]:
    try:
        result = subprocess.run(
            [gst_inspect, element], capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            first = result.stdout.strip().splitlines()
            return True, first[0] if first else ""
        return False, f"gst-inspect-1.0 returned {result.returncode}"
    except Exception as exc:
        return False, f"error: {exc}"


def check_plugins() -> Dict:
    """Return availability report for gi import + required pipeline elements."""
    report: Dict = {
        "gstreamer_available": GSTREAMER_AVAILABLE,
        "import_error": GSTREAMER_IMPORT_ERROR,
        "elements": {},
        "audio": {},
        "audio_available": False,
        "all_required_present": False,
    }

    if not GSTREAMER_AVAILABLE:
        return report

    ensure_gstreamer_initialized()

    all_present = True
    for element in REQUIRED_ELEMENTS:
        factory = Gst.ElementFactory.find(element)
        if factory:
            long_name = factory.get_metadata("long-name") or element
            report["elements"][element] = {"available": True, "info": f"Factory: {long_name}"}
        else:
            gst_inspect = _find_gst_inspect()
            if gst_inspect:
                found, info = _inspect_element(gst_inspect, element)
                report["elements"][element] = {"available": found, "info": info}
                if not found:
                    all_present = False
            else:
                report["elements"][element] = {"available": False, "info": "Element factory not found"}
                all_present = False

    audio_present = True
    for element in AUDIO_ELEMENTS:
        factory = Gst.ElementFactory.find(element)
        if factory:
            long_name = factory.get_metadata("long-name") or element
            report["audio"][element] = {"available": True, "info": f"Factory: {long_name}"}
        else:
            report["audio"][element] = {"available": False, "info": "Element factory not found"}
            audio_present = False

    report["all_required_present"] = all_present
    report["audio_available"] = audio_present
    return report


def print_plugin_report(report: Optional[Dict] = None) -> None:
    if report is None:
        report = check_plugins()

    print("=" * 60)
    print("  GStreamer Plugin Diagnostic Report")
    print("=" * 60)
    if not report["gstreamer_available"]:
        print(f"  PyGObject/GStreamer import FAILED: {report['import_error']}")
    else:
        print("  PyGObject/GStreamer import: OK")
    for name, info in report["elements"].items():
        symbol = "+" if info["available"] else "x"
        print(f"    [{symbol}] {name}")
    if report.get("audio"):
        print("  Audio pipeline:")
        for name, info in report["audio"].items():
            symbol = "+" if info["available"] else "x"
            print(f"    [{symbol}] {name}")
    print("-" * 60)
    if report["all_required_present"]:
        print("  Result: ALL REQUIRED PLUGINS AVAILABLE")
    else:
        print("  Result: SOME REQUIRED PLUGINS MISSING")
    if report.get("audio_available"):
        print("  Audio result: WASAPI loopback + Opus available")
    elif sys.platform == "win32":
        print("  Audio result: WASAPI/Opus pipeline unavailable")
    print("=" * 60)


if __name__ == "__main__":
    print_plugin_report()
