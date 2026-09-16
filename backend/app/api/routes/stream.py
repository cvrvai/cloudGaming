"""WebRTC signaling: the browser POSTs an SDP offer, we answer.

The offer may carry optional quality overrides (width/height/fps/bitrate);
anything omitted falls back to the .env defaults. Values are clamped
server-side in the stream manager.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.streaming.manager import stream_manager
from app.services.streaming.node_relay import node_relay
from app.services.turn import get_ice_configuration

logger = logging.getLogger("api.stream")

router = APIRouter(prefix="/stream", tags=["stream"])


class SdpOffer(BaseModel):
    sdp: str
    type: str
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[int] = None
    bitrate: Optional[int] = None
    node_id: Optional[int] = None
    machine_id: Optional[int] = None
    game_id: Optional[int] = None
    game_title: Optional[str] = None
    slug: Optional[str] = None
    booking_id: Optional[int] = None


class SdpAnswer(BaseModel):
    sdp: str
    type: str


@router.post("/offer", response_model=SdpAnswer)
async def create_stream(offer: SdpOffer) -> dict:
    if offer.type != "offer" or not offer.sdp:
        raise HTTPException(status_code=400, detail="Invalid SDP offer")

    # 1. Standalone Host Mode: If this backend process has GStreamer (running on Gaming PC)
    if stream_manager.available:
        from app.services.agent import host_agent
        if not host_agent.is_game_running():
            raise HTTPException(
                status_code=403,
                detail="Game is starting up. Please wait a moment...",
            )
        game_hwnd = host_agent.get_active_game_window_handle()
        if game_hwnd:
            host_agent.bring_game_to_foreground(game_hwnd)
        try:
            _, turn_uri = await get_ice_configuration()
            return await stream_manager.create_peer_answer(
                offer.sdp,
                width=offer.width,
                height=offer.height,
                fps=offer.fps,
                bitrate=offer.bitrate,
                window_handle=None,
                turn_server=turn_uri,
            )
        except Exception as exc:
            logger.exception("Failed to negotiate local stream")
            raise HTTPException(status_code=500, detail="Unable to start game stream. Please try again.")

    # 2. Cloud Relay Mode: Backend is running on Cloud (Render) - forward offer to connected gaming PC node
    target_node_id = offer.node_id or offer.machine_id
    if not target_node_id or target_node_id not in node_relay._nodes:
        fallback_id = node_relay.get_any_connected_node_id()
        if fallback_id:
            target_node_id = fallback_id

    req_game_id = offer.game_id
    req_game_title = offer.game_title
    req_slug = offer.slug
    req_booking_id = offer.booking_id

    if not req_game_id and target_node_id:
        try:
            from datetime import datetime, timezone
            from app.db import get_db
            now_iso = datetime.now(timezone.utc).isoformat()
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT b.id, b.game_id, b.game_title, g.slug
                    FROM bookings b
                    LEFT JOIN games g ON b.game_id = g.id
                    WHERE b.machine_id = %s AND b.status = 'confirmed' AND b.start_time <= %s AND b.end_time >= %s
                    ORDER BY b.start_time DESC LIMIT 1;
                    """,
                    (target_node_id, now_iso, now_iso),
                )
                act_b = cursor.fetchone()
                if act_b:
                    req_game_id = act_b["game_id"]
                    req_game_title = act_b["game_title"]
                    req_slug = act_b.get("slug")
                    req_booking_id = act_b["id"]
        except Exception:
            pass

    # If target node is not active in WebSocket relay, try any connected node or return 503
    if target_node_id and target_node_id not in node_relay._nodes:
        fallback_nid = node_relay.get_any_connected_node_id()
        if fallback_nid:
            target_node_id = fallback_nid
        else:
            raise HTTPException(
                status_code=503,
                detail="Gaming rig is currently connecting. Please try again in a few seconds.",
            )

    if target_node_id and target_node_id in node_relay._nodes:
        try:
            _, turn_uri = await get_ice_configuration()
            answer = await node_relay.relay_offer(
                target_node_id,
                offer.sdp,
                width=offer.width,
                height=offer.height,
                fps=offer.fps,
                bitrate=offer.bitrate,
                turn_server=turn_uri,
                game_id=req_game_id,
                game_title=req_game_title,
                slug=req_slug,
                booking_id=req_booking_id,
            )
            # Stamp stream_started_at in DB
            try:
                from datetime import datetime, timezone
                from app.db import get_db
                from app.core.redis import cache_delete
                now_iso = datetime.now(timezone.utc).isoformat()
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE machines SET status = 'in-use', stream_started_at = %s, last_seen = %s WHERE id = %s AND stream_started_at IS NULL;",
                        (now_iso, now_iso, target_node_id),
                    )
                    conn.commit()
                await cache_delete("machines:raw")
            except Exception:
                pass

            return answer
        except Exception as exc:
            logger.warning("Failed to negotiate relayed stream with node #%s: %s", target_node_id, exc)
            raise HTTPException(
                status_code=503,
                detail="Game stream is initializing. Please retry in a moment.",
            )

    # Neither local capture nor a connected node is available
    raise HTTPException(
        status_code=503,
        detail="Gaming rig is currently offline. Please try again in a few moments.",
    )
