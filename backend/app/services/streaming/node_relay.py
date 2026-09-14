"""Node Relay Manager: Coordinates WebRTC signaling, input forwarding, and game commands between CloudKH backend and remote physical gaming PC nodes.

Allows physical gaming nodes behind NAT/firewalls to connect via an outbound WebSocket
and receive WebRTC offers, keyboard/gamepad inputs, and launch commands without port forwarding.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Dict, Optional

from fastapi import WebSocket

logger = logging.getLogger("streaming.node_relay")


class NodeRelayManager:
    """Singleton manager tracking active streaming nodes and relaying stream requests."""

    def __init__(self) -> None:
        self._nodes: Dict[int, WebSocket] = {}
        self._node_meta: Dict[int, Dict[str, Any]] = {}
        self._pending_offers: Dict[str, asyncio.Future] = {}
        self._pending_commands: Dict[str, asyncio.Future] = {}
        self._client_ws: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    def is_node_connected(self, node_id: Optional[int] = None) -> bool:
        """Check if a specific node or any node is connected."""
        if node_id is not None:
            return node_id in self._nodes
        return len(self._nodes) > 0

    def get_any_connected_node_id(self) -> Optional[int]:
        """Return first available connected node ID."""
        if self._nodes:
            return next(iter(self._nodes.keys()))
        return None

    def get_node_meta(self, node_id: int) -> Optional[Dict[str, Any]]:
        return self._node_meta.get(node_id)

    async def register_node(
        self,
        node_id: int,
        websocket: WebSocket,
        specs: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Register a connected streaming PC node."""
        async with self._lock:
            if node_id in self._nodes:
                try:
                    await self._nodes[node_id].close(code=1000, reason="Replaced by new connection")
                except Exception:
                    pass
            self._nodes[node_id] = websocket
            self._node_meta[node_id] = specs or {
                "gstreamer_available": True,
                "streaming_ready": True,
            }
            logger.info("Node #%d registered successfully. Total nodes: %d", node_id, len(self._nodes))

    async def unregister_node(self, node_id: int) -> None:
        """Unregister a disconnected node and cancel any pending requests."""
        async with self._lock:
            if node_id in self._nodes:
                del self._nodes[node_id]
                self._node_meta.pop(node_id, None)
                logger.info("Node #%d unregistered. Remaining nodes: %d", node_id, len(self._nodes))

        for corr_id, fut in list(self._pending_offers.items()):
            if not fut.done():
                fut.set_exception(RuntimeError(f"Node #{node_id} disconnected during stream setup"))
        self._pending_offers.clear()

    async def relay_offer(
        self,
        node_id: int,
        offer_sdp: str,
        width: Optional[int] = None,
        height: Optional[int] = None,
        fps: Optional[int] = None,
        bitrate: Optional[int] = None,
        timeout: float = 20.0,
    ) -> dict:
        """Forward an SDP offer from a browser client to the specified gaming node, returning its SDP answer."""
        ws = self._nodes.get(node_id)
        if not ws:
            raise RuntimeError(f"Gaming PC Node #{node_id} is not connected to the cloud backend.")

        correlation_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._pending_offers[correlation_id] = future

        msg = {
            "type": "stream_offer",
            "correlation_id": correlation_id,
            "offer": {
                "sdp": offer_sdp,
                "type": "offer",
                "width": width,
                "height": height,
                "fps": fps,
                "bitrate": bitrate,
            },
        }

        try:
            await ws.send_json(msg)
            answer_data = await asyncio.wait_for(future, timeout=timeout)
            return answer_data
        except asyncio.TimeoutError:
            raise TimeoutError(f"Node #{node_id} did not respond to stream offer within {timeout}s.")
        finally:
            self._pending_offers.pop(correlation_id, None)

    def resolve_offer(
        self,
        correlation_id: str,
        answer: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> None:
        """Resolve a pending SDP offer future with the node's answer."""
        future = self._pending_offers.get(correlation_id)
        if future and not future.done():
            if error:
                future.set_exception(RuntimeError(error))
            else:
                future.set_result(answer or {})

    async def forward_input(self, node_id: int, payload: dict) -> None:
        """Forward real-time gamepad / keyboard / mouse input to the target gaming node."""
        ws = self._nodes.get(node_id)
        if ws:
            try:
                await ws.send_json({
                    "type": "input",
                    "payload": payload,
                })
            except Exception as exc:
                logger.debug("Failed to forward input to Node #%d: %s", node_id, exc)

    async def forward_game_command(
        self,
        node_id: int,
        operation: str,
        payload: Optional[dict] = None,
        timeout: float = 8.0,
    ) -> dict:
        """Send game command (START_GAME, STOP_GAME) to the target gaming node."""
        ws = self._nodes.get(node_id)
        if not ws:
            raise RuntimeError(f"Gaming PC Node #{node_id} is not connected.")

        correlation_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._pending_commands[correlation_id] = future

        msg = {
            "type": "agent_command",
            "correlation_id": correlation_id,
            "operation": operation,
            "payload": payload or {},
        }

        try:
            await ws.send_json(msg)
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            raise TimeoutError(f"Node #{node_id} did not acknowledge '{operation}' within {timeout}s.")
        finally:
            self._pending_commands.pop(correlation_id, None)

    def resolve_command(
        self,
        correlation_id: str,
        result: Optional[dict] = None,
        error: Optional[str] = None,
    ) -> None:
        future = self._pending_commands.get(correlation_id)
        if future and not future.done():
            if error:
                future.set_exception(RuntimeError(error))
            else:
                future.set_result(result or {})

    async def register_client_ws(self, ws: WebSocket) -> None:
        """Register a connected player input WebSocket for server push events."""
        self._client_ws.add(ws)

    async def unregister_client_ws(self, ws: WebSocket) -> None:
        """Unregister player input WebSocket."""
        self._client_ws.discard(ws)

    async def broadcast_game_exited(self, node_id: int, msg: dict) -> None:
        """Broadcast game exit event to all connected player clients."""
        payload = {
            "type": "game_exited",
            "node_id": node_id,
            "game_id": msg.get("game_id"),
            "title": msg.get("title", "Game"),
            "message": msg.get("message", "Game process ended. Save data secured."),
        }
        dead = []
        for ws in list(self._client_ws):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._client_ws.discard(ws)


# Singleton node relay manager instance
node_relay = NodeRelayManager()
