"""Session Access Control & Stream Launcher Gatekeeper (FR-05, User Story 2)."""
from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.agent import host_agent
from app.services.auth import create_access_token, get_current_user, require_admin

router = APIRouter(prefix="/session", tags=["session"])
EDC_TARIFF_USD_PER_KWH = 0.18


class VerifySessionRequest(BaseModel):
    booking_id: int


class AgentCommandRequest(BaseModel):
    operation: str = Field(..., description="Predefined agent operation, e.g. START_GAME, STOP_GAME, GET_STATUS")
    payload: Optional[Dict[str, Any]] = None


@router.post("/verify")
async def verify_session_access(
    req: VerifySessionRequest,
    current_user: Dict = Depends(get_current_user),
):
    """Validate active reservation and launch administrator-configured game via trusted agent (FR-05)."""
    now = datetime.now(timezone.utc)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT b.id, b.user_id, b.machine_id, b.game_id, b.game_title, b.start_time, b.end_time, b.status,
                   m.name as machine_name, m.is_host, m.gpu
            FROM bookings b
            JOIN machines m ON b.machine_id = m.id
            WHERE b.id = %s;
            """,
            (req.booking_id,),
        )
        booking = cursor.fetchone()

    if not booking:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reservation not found.",
        )

    # Verify ownership (unless admin)
    if booking["user_id"] != current_user["id"] and current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: You do not own this reservation.",
        )

    if booking["status"] != "confirmed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Reservation is not active (status: {booking['status']}).",
        )

    start_dt = datetime.fromisoformat(booking["start_time"].replace("Z", "+00:00"))
    end_dt = datetime.fromisoformat(booking["end_time"].replace("Z", "+00:00"))

    # Clock window check (with 1-minute early grace buffer)
    if (start_dt - now).total_seconds() > 60:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Slot has not started yet. Scheduled start: {booking['start_time']}.",
        )

    if now > end_dt:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This gaming session has already expired.",
        )

    remaining_seconds = max(1, int((end_dt - now).total_seconds()))

    target_machine_id = booking["machine_id"]
    from app.services.streaming.node_relay import node_relay
    from app.services.streaming.manager import stream_manager

    # If the reserved machine is not connected or not in node_relay._nodes, fallback to any connected node
    if not node_relay.is_node_connected(target_machine_id) or target_machine_id not in node_relay._nodes:
        fallback_node = node_relay.get_any_connected_node_id()
        if fallback_node:
            target_machine_id = fallback_node

    if target_machine_id != booking["machine_id"]:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE bookings SET machine_id = %s WHERE id = %s;", (target_machine_id, booking["id"]))
                conn.commit()
        except Exception:
            pass

    # Trigger trusted host agent to start game if a game was reserved
    agent_launch_info = None
    if booking["game_id"]:
        if target_machine_id in node_relay._nodes or node_relay.is_node_connected(target_machine_id):
            try:
                cmd_res = await node_relay.forward_game_command(
                    target_machine_id,
                    "START_GAME",
                    {
                        "game_id": booking["game_id"],
                        "user_id": booking["user_id"],
                    },
                    timeout=8.0,
                )
                agent_launch_info = cmd_res.get("result", cmd_res)
            except Exception as e:
                agent_launch_info = {"status": "warning", "error": str(e)}
        elif booking["is_host"] == 1 and stream_manager.available:
            try:
                agent_launch_info = host_agent.start_game(
                    game_id=booking["game_id"],
                    user_id=booking["user_id"],
                )
            except Exception as e:
                agent_launch_info = {"status": "warning", "error": str(e)}

    # Issue temporary session launch token
    session_token = create_access_token(
        {
            "sub": current_user["id"],
            "booking_id": booking["id"],
            "machine_id": target_machine_id,
            "type": "game_stream_session",
        }
    )

    return {
        "status": "authorized",
        "booking_id": booking["id"],
        "machine_id": target_machine_id,
        "machine_name": booking["machine_name"],
        "is_host": bool(booking["is_host"]),
        "gpu": booking["gpu"],
        "game_id": booking["game_id"],
        "game_title": booking["game_title"],
        "agent": agent_launch_info,
        "session_token": session_token,
        "remaining_seconds": remaining_seconds,
        "end_time": booking["end_time"],
        "user_name": current_user["name"],
    }


class StopSessionRequest(BaseModel):
    booking_id: Optional[int] = None
    machine_id: Optional[int] = None


@router.post("/stop")
async def stop_session(
    req: Optional[StopSessionRequest] = None,
    current_user: Dict = Depends(get_current_user),
):
    """End active streaming session, terminate game process, and release remaining slot."""
    from app.services.streaming.node_relay import node_relay
    from app.core.redis import cache_delete
    host_res = host_agent.stop_game()

    if node_relay.is_node_connected():
        for node_id in list(node_relay._nodes.keys()):
            try:
                await node_relay.forward_game_command(node_id, "STOP_GAME", timeout=4.0)
            except Exception:
                pass

    # Complete active booking so remaining time slot is released and quota is deducted
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            target_machine = req.machine_id if req and req.machine_id else None
            if req and req.booking_id:
                cursor.execute(
                    """
                    UPDATE bookings
                    SET status = 'completed', end_time = %s
                    WHERE id = %s AND (user_id = %s OR %s = 'admin') AND status = 'confirmed'
                    RETURNING machine_id;
                    """,
                    (now_iso, req.booking_id, current_user["id"], current_user.get("role")),
                )
                row = cursor.fetchone()
                if row and not target_machine:
                    target_machine = row["machine_id"]
            else:
                cursor.execute(
                    """
                    UPDATE bookings
                    SET status = 'completed', end_time = %s
                    WHERE user_id = %s AND status = 'confirmed' AND start_time <= %s AND end_time > %s
                    RETURNING machine_id;
                    """,
                    (now_iso, current_user["id"], now_iso, now_iso),
                )
                row = cursor.fetchone()
                if row and not target_machine:
                    target_machine = row["machine_id"]

            if target_machine:
                cursor.execute(
                    "UPDATE machines SET status = 'available', stream_started_at = NULL, last_seen = %s WHERE id = %s;",
                    (now_iso, target_machine),
                )
            else:
                cursor.execute(
                    "UPDATE machines SET status = 'available', stream_started_at = NULL, last_seen = %s WHERE status = 'in-use' OR stream_started_at IS NOT NULL;",
                    (now_iso,),
                )
            conn.commit()
        await cache_delete("machines:raw")
    except Exception:
        pass

    return {"status": "session_stopped", "host": host_res}


class ClientTelemetryReport(BaseModel):
    booking_id: Optional[int] = None
    avg_latency_ms: float = Field(0.0, description="WebRTC Round Trip Time average")
    max_latency_ms: float = Field(0.0, description="WebRTC Round Trip Time peak")
    avg_fps: float = Field(60.0, description="Decoded frames per second")
    packet_loss_pct: float = Field(0.0, description="Packet loss rate")
    disconnects_count: int = Field(0, description="WebRTC disconnect count")
    completed: bool = Field(True, description="Session completed without defect")
    failure_reason: Optional[str] = None
    duration_seconds: float = Field(0.0, description="Duration of stream in seconds")
    phase: Optional[str] = Field("V2_Improved", description="DMAIC phase tag")
    user_rating: Optional[int] = Field(None, ge=1, le=5, description="Optional Verbatim VOC rating from 1 to 5")
    experience_tag: Optional[Literal["smooth", "mixed", "laggy"]] = Field(
        None,
        description="Optional qualitative stream tag selected by the player",
    )
    user_comment: Optional[str] = Field(None, max_length=1000, description="Optional Verbatim Voice of Customer comment")


@router.post("/telemetry")
async def record_live_session_telemetry(
    req: ClientTelemetryReport,
    current_user: Dict = Depends(get_current_user),
):
    """Automatically record verified live gameplay telemetry into DMAIC dataset."""
    import hashlib
    from app.core.redis import increment_dmaic_counter, record_dmaic_unique_user

    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()

        # Generate audit test ID
        cursor.execute("SELECT COUNT(*) as count FROM session_telemetry;")
        count = cursor.fetchone()["count"] + 1
        test_id = f"RUN-{count:03d}"

        # Verify valid foreign keys
        user_id = current_user.get("id")
        if user_id:
            cursor.execute("SELECT id FROM users WHERE id = %s;", (user_id,))
            if not cursor.fetchone():
                user_id = None

        valid_booking_id = None
        if req.booking_id:
            cursor.execute("SELECT id FROM bookings WHERE id = %s;", (req.booking_id,))
            if cursor.fetchone():
                valid_booking_id = req.booking_id

        # Fetch booking context
        booking_slot = "Live Gameplay"
        waiting_time_mins = 0.0
        game_title = "CloudKH Game"
        machine_id = None

        if valid_booking_id:
            cursor.execute(
                "SELECT game_title, start_time, machine_id, created_at FROM bookings WHERE id = %s;",
                (valid_booking_id,),
            )
            b_row = cursor.fetchone()
            if b_row:
                game_title = b_row["game_title"] or game_title
                machine_id = b_row["machine_id"]
                booking_slot = f"Slot #{valid_booking_id}"
                if b_row["start_time"] and b_row["created_at"]:
                    try:
                        s_dt = datetime.fromisoformat(b_row["start_time"].replace("Z", "+00:00"))
                        c_dt = datetime.fromisoformat(b_row["created_at"].replace("Z", "+00:00"))
                        waiting_time_mins = max(0.0, round((s_dt - c_dt).total_seconds() / 60.0, 1))
                    except Exception:
                        pass

        # If machine not bound via booking, assign currently active rig or host rig
        if not machine_id:
            cursor.execute("SELECT id FROM machines ORDER BY is_host DESC, id ASC LIMIT 1;")
            m_default = cursor.fetchone()
            if m_default:
                machine_id = m_default["id"]

        # Dynamic power calculation from the exact hardware profile of this machine
        active_watts = 0.0
        if machine_id:
            cursor.execute("SELECT COALESCE(active_watts, 0.0) as active_watts FROM machines WHERE id = %s;", (machine_id,))
            m_w = cursor.fetchone()
            if m_w and m_w["active_watts"]:
                active_watts = float(m_w["active_watts"])

        duration_hrs = max(0.01, req.duration_seconds / 3600.0)
        power_kwh = round((active_watts * duration_hrs) / 1000.0, 3)
        cost_usd = round(power_kwh * EDC_TARIFF_USD_PER_KWH, 3)

        feedback_comment = req.user_comment.strip() if req.user_comment else None
        if feedback_comment == "":
            feedback_comment = None
        feedback_submitted_at = now_iso if (req.user_rating or req.experience_tag or feedback_comment) else None

        # Generate Cryptographic Integrity Hash (SHA-256 for academic/audit verification)
        integrity_payload = (
            f"{test_id}:{user_id or 'guest'}:{valid_booking_id}:{req.avg_latency_ms}:"
            f"{req.avg_fps}:{req.user_rating or ''}:{req.experience_tag or ''}:"
            f"{feedback_comment or ''}:{now_iso}"
        )
        integrity_hash = hashlib.sha256(integrity_payload.encode()).hexdigest()

        cursor.execute(
            """
            INSERT INTO session_telemetry (
                test_id, booking_id, user_id, user_email, machine_id,
                game_title, requested_time, booking_slot, waiting_time_minutes,
                avg_latency_ms, max_latency_ms, avg_fps, packet_loss_pct,
                disconnects_count, completed, failure_reason, pc_idle_minutes,
                power_kwh, energy_cost_usd, duration_seconds, phase, source, integrity_hash,
                user_rating, experience_tag, user_comment, feedback_submitted_at,
                notes, created_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s
            ) RETURNING *;
            """,
            (
                test_id, valid_booking_id, user_id, current_user.get("email"), machine_id,
                game_title, now_iso, booking_slot, waiting_time_mins,
                req.avg_latency_ms, req.max_latency_ms, req.avg_fps, req.packet_loss_pct,
                req.disconnects_count, req.completed, req.failure_reason, 0.0,
                power_kwh, cost_usd, float(req.duration_seconds), req.phase or "V2_Improved", "automated_stream", integrity_hash,
                req.user_rating, req.experience_tag, feedback_comment, feedback_submitted_at,
                f"Live WebRTC stream on {game_title} (duration: {int(req.duration_seconds)}s)", now_iso,
            ),
        )
        record = dict(cursor.fetchone())
        conn.commit()

    # Increment Redis DMAIC telemetry counters
    try:
        await increment_dmaic_counter("sessions:total")
        await record_dmaic_unique_user(current_user["id"])
    except Exception:
        pass

    return {
        "status": "recorded",
        "test_id": test_id,
        "integrity_hash": integrity_hash,
        "record": record,
    }


@router.post("/agent/command")
async def dispatch_agent_command(
    req: AgentCommandRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Dispatch predefined agent operations (START_GAME, STOP_GAME, GET_STATUS).
    
    Arbitrary shell execution (RUN_SHELL, RUN_CMD, EXECUTE_COMMAND) is strictly blocked.
    """
    try:
        res = host_agent.dispatch(req.operation, req.payload)
        return res
    except PermissionError as pe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))
