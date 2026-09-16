"""WebSocket endpoint for physical gaming PC streaming nodes.

Allows stream_node.py to maintain an active bidirectional signaling channel.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db import get_db
from app.services.streaming.node_relay import node_relay

logger = logging.getLogger("api.websockets.node")

router = APIRouter(prefix="/ws/node", tags=["node_ws"])


@router.websocket("/{node_id}")
async def streaming_node_endpoint(websocket: WebSocket, node_id: int):
    """Persistent bidirectional tunnel between CloudKH backend and streaming PC."""
    await websocket.accept()
    logger.info("Node #%d connected to streaming tunnel", node_id)

    # Update database: mark machine online
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE machines SET status = 'available', last_seen = %s WHERE id = %s;",
                (now_iso, node_id),
            )
            conn.commit()
    except Exception as exc:
        logger.warning("Failed to update last_seen for node #%d: %s", node_id, exc)

    await node_relay.register_node(node_id, websocket)

    try:
        # Send greeting / ack
        await websocket.send_json({
            "type": "registered",
            "node_id": node_id,
            "message": "Connected to CloudKH streaming relay",
        })

        while True:
            text = await websocket.receive_text()
            try:
                msg = json.loads(text)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "stream_answer":
                corr_id = msg.get("correlation_id")
                answer = msg.get("answer")
                node_relay.resolve_offer(corr_id, answer=answer)

            elif msg_type == "stream_error":
                corr_id = msg.get("correlation_id")
                error_detail = msg.get("error", "Node streaming pipeline error")
                node_relay.resolve_offer(corr_id, error=error_detail)

            elif msg_type == "command_result":
                corr_id = msg.get("correlation_id")
                result = msg.get("result")
                error = msg.get("error")
                node_relay.resolve_command(corr_id, result=result, error=error)

            elif msg_type in ("game_exited", "session_stopped"):
                logger.info("Node #%d reported %s: %s", node_id, msg_type, msg)
                await node_relay.broadcast_game_exited(node_id, msg)
                now_iso = datetime.now(timezone.utc).isoformat()
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            "UPDATE machines SET status = 'available', stream_started_at = NULL, last_seen = %s WHERE id = %s;",
                            (now_iso, node_id),
                        )
                        cursor.execute(
                            """
                            UPDATE bookings
                            SET status = 'completed', end_time = %s
                            WHERE machine_id = %s AND status = 'confirmed';
                            """,
                            (now_iso, node_id),
                        )
                        conn.commit()
                    from app.core.redis import cache_delete
                    await cache_delete("machines:raw")
                except Exception as db_err:
                    logger.warning("Error finalizing machine #%d status on %s: %s", node_id, msg_type, db_err)

            elif msg_type == "heartbeat":
                now_iso = datetime.now(timezone.utc).isoformat()
                is_streaming = bool(msg.get("is_streaming", False))
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute(
                            "SELECT id FROM bookings WHERE machine_id = %s AND status = 'confirmed' LIMIT 1;",
                            (node_id,),
                        )
                        has_booking = bool(cursor.fetchone())
                        if not has_booking and not is_streaming:
                            cursor.execute(
                                "UPDATE machines SET last_seen = %s, status = 'available', stream_started_at = NULL WHERE id = %s;",
                                (now_iso, node_id),
                            )
                        else:
                            cursor.execute(
                                "UPDATE machines SET last_seen = %s, status = 'in-use' WHERE id = %s;",
                                (now_iso, node_id),
                            )
                        conn.commit()
                except Exception as hb_err:
                    logger.debug("Heartbeat status update error: %s", hb_err)
                await websocket.send_json({"type": "heartbeat_ack", "timestamp": now_iso})

            elif msg_type == "node_specs":
                # Node reports hardware and GStreamer capabilities
                specs = msg.get("specs", {})
                node_relay._node_meta[node_id] = specs
                logger.info("Node #%d capabilities: %s", node_id, specs)

                # Auto-upsert machine record so it never disappears from Fleet Rigs
                try:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT id FROM machines WHERE id = %s;", (node_id,))
                        row = cursor.fetchone()
                        if not row:
                            name = specs.get("name") or f"Gaming PC (Node #{node_id})"
                            gpu = specs.get("gpu", "Dedicated Gaming GPU")
                            cpu = specs.get("cpu", "Multi-Core CPU")
                            ram = specs.get("ram", "16GB RAM")
                            os_str = specs.get("os", "Windows")
                            cursor.execute(
                                """
                                INSERT INTO machines (id, name, gpu, cpu, ram, os, status, is_host, notes, last_seen)
                                VALUES (%s, %s, %s, %s, %s, %s, 'available', 1, 'Auto-registered Gaming PC Node', %s);
                                """,
                                (node_id, name, gpu, cpu, ram, os_str, now_iso),
                            )
                        else:
                            cursor.execute(
                                "UPDATE machines SET status = 'available', last_seen = %s WHERE id = %s;",
                                (now_iso, node_id),
                            )
                        conn.commit()
                except Exception as db_exc:
                    logger.warning("Failed to auto-upsert machine #%d: %s", node_id, db_exc)

    except WebSocketDisconnect:
        logger.info("Node #%d disconnected from streaming tunnel", node_id)
    except Exception as exc:
        logger.error("Node #%d tunnel error: %s", node_id, exc)
    finally:
        await node_relay.unregister_node(node_id)
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE machines SET status = 'offline', stream_started_at = NULL WHERE id = %s AND status != 'maintenance';",
                    (node_id,),
                )
                conn.commit()
            from app.core.redis import cache_delete
            await cache_delete("machines:raw")
            logger.info("Marked node #%d as offline in DB", node_id)
        except Exception as db_exc:
            logger.warning("Failed to update status to offline for node #%d: %s", node_id, db_exc)
