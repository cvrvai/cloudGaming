"""Best-effort per-monitor capture region lookup for ximagesrc (X11 only).

Xorg has no concept of a "monitor index" the way Windows does, so we shell
out to `xrandr` and number the connected outputs in the order it reports
them. Falls back to capturing the whole X screen when xrandr is unavailable
or the index is out of range.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from typing import List, Optional, Tuple

_GEOMETRY_RE = re.compile(r"(\d+)x(\d+)\+(\d+)\+(\d+)")


def _connected_monitors() -> List[Tuple[int, int, int, int]]:
    xrandr = shutil.which("xrandr")
    if not xrandr:
        return []
    try:
        output = subprocess.run(
            [xrandr, "--query"], capture_output=True, text=True, timeout=5
        ).stdout
    except Exception:
        return []

    monitors = []
    for line in output.splitlines():
        if " connected" not in line:
            continue
        match = _GEOMETRY_RE.search(line)
        if not match:
            continue
        width, height, x, y = (int(group) for group in match.groups())
        monitors.append((x, y, x + width - 1, y + height - 1))
    return monitors


def get_monitor_geometry(monitor_index: int) -> Optional[Tuple[int, int, int, int]]:
    """Return (startx, starty, endx, endy) for the 1-based monitor_index, or None."""
    monitors = _connected_monitors()
    if monitor_index < 1 or monitor_index > len(monitors):
        return None
    return monitors[monitor_index - 1]
