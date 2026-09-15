"""Prepare the process environment so PyGObject (gi) can find GStreamer DLLs.

Must be imported BEFORE any `import gi` happens anywhere in the app.
Replaces the manual `$env:PYGI_DLL_DIRS` / `$env:PATH` steps from the old
RUN_SERVICES.md flow.
"""
import os
import sys

_configured = False


def configure_gstreamer_env() -> None:
    global _configured
    if _configured:
        return
    _configured = True

    configured_bin = os.getenv("GSTREAMER_BIN", "")
    try:
        from app.core.config import settings
        configured_bin = getattr(settings, "gstreamer_bin", configured_bin)
    except Exception:
        pass

    candidates = [
        configured_bin,
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\gstreamer\1.0\msvc_x86_64\bin"),
        r"C:\Program Files\gstreamer\1.0\msvc_x86_64\bin",
        r"C:\gstreamer\1.0\msvc_x86_64\bin",
    ]
    gst_bin = None
    for cand in candidates:
        if cand and os.path.isdir(cand):
            gst_bin = cand
            break

    if not gst_bin:
        return

    os.environ.setdefault("PYGI_DLL_DIRS", gst_bin)
    if gst_bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = gst_bin + os.pathsep + os.environ.get("PATH", "")

    gst_root = os.path.dirname(gst_bin)
    plugin_path = os.path.join(gst_root, "lib", "gstreamer-1.0")
    if os.path.isdir(plugin_path):
        os.environ.setdefault("GST_PLUGIN_SYSTEM_PATH_1_0", plugin_path)
        os.environ.setdefault("GST_PLUGIN_PATH_1_0", plugin_path)

    # Auto-inject GStreamer's site-packages so 'import gi' works without manual .pth creation
    gi_site_packages = os.path.join(gst_root, "lib", "site-packages")
    if os.path.isdir(gi_site_packages) and gi_site_packages not in sys.path:
        sys.path.insert(0, gi_site_packages)

    if sys.platform == "win32" and hasattr(os, "add_dll_directory"):
        try:
            os.add_dll_directory(gst_bin)
        except OSError:
            pass


# Automatically configure environment upon import
configure_gstreamer_env()
