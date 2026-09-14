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
                detail="Streaming blocked: No authorized game is actively running. Windows desktop interface streaming is disabled.",
            )
        try:
            return await stream_manager.create_peer_answer(
                offer.sdp,
                width=offer.width,
                height=offer.height,
                fps=offer.fps,
                bitrate=offer.bitrate,
            )
        except Exception as exc:
            logger.exception("Failed to negotiate local stream")
            raise HTTPException(status_code=500, detail=str(exc))

    # 2. Cloud Relay Mode: Backend is running on Cloud (Render) - forward offer to connected gaming PC node
    target_node_id = offer.node_id or offer.machine_id or node_relay.get_any_connected_node_id()
    if target_node_id and node_relay.is_node_connected(target_node_id):
        try:
            answer = await node_relay.relay_offer(
                target_node_id,
                offer.sdp,
                width=offer.width,
                height=offer.height,
                fps=offer.fps,
                bitrate=offer.bitrate,
            )
            return answer
        except Exception as exc:
            logger.exception("Failed to negotiate relayed stream with node #%s", target_node_id)
            raise HTTPException(status_code=500, detail=f"Node streaming negotiation failed: {exc}")

    # Neither local capture nor a connected node is available
    raise HTTPException(
        status_code=503,
        detail="No gaming PC streaming node is currently online. Please start stream_node.py on your gaming PC.",
    )
