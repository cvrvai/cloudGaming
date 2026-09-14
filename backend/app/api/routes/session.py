"""Session Access Control & Stream Launcher Gatekeeper (FR-05, User Story 2)."""
from datetime import datetime, timezone
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.db import get_db
from app.services.auth import create_access_token, get_current_user

router = APIRouter(prefix="/session", tags=["session"])


class VerifySessionRequest(BaseModel):
    booking_id: int


@router.post("/verify")
def verify_session_access(
    req: VerifySessionRequest,
    current_user: Dict = Depends(get_current_user),
):
    """Validate that the student has a valid, active reservation right now (FR-05)."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT b.id, b.user_id, b.machine_id, b.start_time, b.end_time, b.status,
                   m.name as machine_name, m.is_host, m.gpu
            FROM bookings b
            JOIN machines m ON b.machine_id = m.id
            WHERE b.id = ?;
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
        "machine_name": booking["machine_name"],
        "is_host": bool(booking["is_host"]),
        "gpu": booking["gpu"],
        "session_token": session_token,
        "remaining_seconds": remaining_seconds,
        "end_time": booking["end_time"],
        "user_name": current_user["name"],
    }
