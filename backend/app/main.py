"""Cloud Game Backend - FastAPI application.

Single process, single port:
  REST  /api/health, /api/system/info, /api/stream/offer (WebRTC signaling)
  WS    /ws/input (controller input)
Media is handled entirely by GStreamer (D3D11 capture -> H264 -> webrtcbin).
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
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
    # Initialize database if available, otherwise allow running in streaming-only mode
    try:
        init_db()
        from app.db import get_db
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE machines SET status = 'offline' WHERE status != 'maintenance';")
            conn.commit()
    except Exception as exc:
        logger.warning("Database unavailable (%s) - running in streaming-only mode.", exc)

    gamepad_service.start()
    if not stream_manager.available:
        logger.warning(
            "GStreamer unavailable - video streaming disabled: %s",
            stream_manager.unavailable_reason,
        )

    # Register local host agent exit callback to stop stream and broadcast event
    from app.services.agent import host_agent
    from app.services.streaming.node_relay import node_relay
    import asyncio

    def _on_local_game_exit(game_id, title):
        logger.info("Local host detected game exit for '%s' (ID %s). Terminating stream...", title, game_id)
        stream_manager.close_all()
        try:
            loop = asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe(
                node_relay.broadcast_game_exited(1, {"game_id": game_id, "title": title}),
                loop,
            )
        except Exception as e:
            logger.debug("Could not dispatch broadcast_game_exited: %s", e)

    host_agent.register_exit_callback(_on_local_game_exit)

    yield
    stream_manager.close_all()
    gamepad_service.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="Cloud Game Backend", version="1.0.0", lifespan=lifespan)

    # Secure CORS: allow cloud production, local dev, and mobile devices on local network
    from app.core.config import settings

    allowed_origins = [
        "https://cloudkh.space",
        "https://www.cloudkh.space",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    if settings.public_frontend_url:
        clean_url = settings.public_frontend_url.strip().rstrip("/")
        if clean_url and clean_url not in allowed_origins:
            allowed_origins.append(clean_url)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.cloudkh\.space|cloudkh\.space)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    app.include_router(input_ws_router)
    app.include_router(node_ws_router)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled server exception on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal Server Error: {str(exc)}"},
        )

    return app


app = create_app()
