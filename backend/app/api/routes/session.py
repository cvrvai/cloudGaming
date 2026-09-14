"""Session Access Control & Stream Launcher Gatekeeper (FR-05, User Story 2)."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.agent import host_agent
from app.services.auth import create_access_token, get_current_user, require_admin

router = APIRouter(prefix="/session", tags=["session"])


class VerifySessionRequest(BaseModel):
    booking_id: int


class AgentCommandRequest(BaseModel):
    operation: str = Field(..., description="Predefined agent operation, e.g. START_GAME, STOP_GAME, GET_STATUS")
    payload: Optional[Dict[str, Any]] = None


@router.post("/verify")
def verify_session_access(
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

    # Trigger trusted host agent to start game if this machine is host and a game was reserved
    agent_launch_info = None
    if booking["game_id"]:
        from app.services.streaming.node_relay import node_relay
        if booking["is_host"] == 1:
            try:
                agent_launch_info = host_agent.start_game(game_id=booking["game_id"])
            except Exception as e:
                agent_launch_info = {"status": "warning", "error": str(e)}
        elif node_relay.is_node_connected(booking["machine_id"]):
            try:
                import asyncio
                asyncio.create_task(
                    node_relay.forward_game_command(
                        booking["machine_id"],
                        "START_GAME",
                        {"game_id": booking["game_id"]},
                    )
                )
                agent_launch_info = {"status": "command_dispatched_to_node", "node_id": booking["machine_id"]}
            except Exception as e:
                agent_launch_info = {"status": "warning", "error": str(e)}

    # Issue temporary session launch token
    session_token = create_access_token(
        {
            "sub": current_user["id"],
            "booking_id": booking["id"],
            "machine_id": booking["machine_id"],
            "type": "game_stream_session",
        }
    )

    return {
        "status": "authorized",
        "booking_id": booking["id"],
        "machine_id": booking["machine_id"],
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


@router.post("/stop")
def stop_session(
    current_user: Dict = Depends(get_current_user),
):
    """End active streaming session and terminate game process."""
    host_agent.stop_game()
    return {"status": "session_stopped"}


@router.post("/agent/command")
def dispatch_agent_command(
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
