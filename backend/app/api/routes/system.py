from typing import Optional

from fastapi import APIRouter

from app.core.config import settings
from app.services.streaming.manager import stream_manager
from app.services.streaming.node_relay import node_relay
from app.utils.network import get_local_ip

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/info")
async def system_info(machine_id: Optional[int] = None) -> dict:
    node_available = False
    active_node = None

    if stream_manager.available:
        node_available = True
    elif machine_id and node_relay.is_node_connected(machine_id):
        node_available = True
        active_node = machine_id
    elif node_relay.is_node_connected():
        node_available = True
        active_node = node_relay.get_any_connected_node_id()

    from app.core.redis import is_redis_online
    redis_online = await is_redis_online()

    return {
        "server_ip": get_local_ip(),
        "port": settings.port,
        "stun_server": settings.stun_server,
        "video": {
            "width": settings.video_width,
            "height": settings.video_height,
            "fps": settings.target_fps,
            "bitrate": settings.video_bitrate,
        },
        "gstreamer_available": node_available,
        "node_connected": node_relay.is_node_connected(machine_id),
        "active_node_id": active_node,
        "redis_connected": redis_online,
    }
