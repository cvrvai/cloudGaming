"""Cloud Game Backend - FastAPI application.

Single process, single port:
  REST  /api/health, /api/system/info, /api/stream/offer (WebRTC signaling)
  WS    /ws/input (controller input)
Media is handled entirely by GStreamer (D3D11 capture -> H264 -> webrtcbin).
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.api.websockets.input import router as input_ws_router
from app.api.websockets.node_ws import router as node_ws_router
from app.db import init_db
from app.services.input.gamepad import gamepad_service
from app.services.streaming.manager import stream_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Reset machines that are not in maintenance to offline until their streaming nodes connect
    try:
        from app.db import get_db
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE machines SET status = 'offline' WHERE status != 'maintenance';")
            conn.commit()
    except Exception as exc:
        logger.warning("Failed to reset machines status on startup: %s", exc)

    gamepad_service.start()
    if not stream_manager.available:
        logger.warning(
            "GStreamer unavailable - video streaming disabled: %s",
            stream_manager.unavailable_reason,
        )
    yield
    stream_manager.close_all()
    gamepad_service.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Cloud Game Backend", version="1.0.0", lifespan=lifespan)

    # Phone browser loads the frontend from the Vite dev server (different origin)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    app.include_router(input_ws_router)
    app.include_router(node_ws_router)
    return app


app = create_app()
