"""Development entry point: python run.py"""
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uvicorn

import app.core.gst_env
from app.core.config import settings
from app.utils.network import get_local_ip, print_qr_ascii


def main() -> None:
    local_ip = get_local_ip()
    frontend_url = settings.public_frontend_url or f"http://{local_ip}:5173"
    api_url = f"http://127.0.0.1:{settings.port}" if settings.host in {"127.0.0.1", "localhost"} else f"http://{local_ip}:{settings.port}"

    print("=" * 55)
    print("  Cloud Game Backend (FastAPI + GStreamer)")
    print("=" * 55)
    print(f"  API:        {api_url}")
    print(f"  Input WS:   {api_url.replace('http://', 'ws://')}/ws/input")
    print(f"  Video:      {settings.video_width}x{settings.video_height} @ {settings.target_fps}fps")
    print("=" * 55)
    print(f"\nOpen on phone: {frontend_url}")
    print_qr_ascii(frontend_url)

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
