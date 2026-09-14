"""Reservation & Conflict-Free Booking Endpoints (FR-03, FR-04, NFR-02)."""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import BookingConflictError, create_booking_atomic, get_db
from app.services.auth import get_current_user, require_admin

router = APIRouter(prefix="/bookings", tags=["bookings"])


class CreateBookingRequest(BaseModel):
    machine_id: Optional[int] = None
    game_id: Optional[int] = None
    game_title: Optional[str] = None
    start_time: str = Field(..., description="ISO 8601 start timestamp")
    end_time: str = Field(..., description="ISO 8601 end timestamp")


@router.post("", status_code=status.HTTP_201_CREATED)
def create_booking(
    req: CreateBookingRequest,
    current_user: Dict = Depends(get_current_user),
):
    """Create a conflict-free reservation for a gaming PC (FR-03, FR-04, NFR-02)."""
    try:
        start_dt = datetime.fromisoformat(req.start_time.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(req.end_time.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid ISO 8601 datetime format for start_time or end_time.",
        )

    if end_dt <= start_dt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="End time must be after start time.",
        )

    duration_minutes = (end_dt - start_dt).total_seconds() / 60
    if duration_minutes < 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservation duration must be at least 5 minutes.",
        )
    if duration_minutes > 480:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reservation duration cannot exceed 8 hours per slot.",
        )

    # Normalize ISO strings
    start_iso = start_dt.isoformat()
    end_iso = end_dt.isoformat()

    try:
        booking = create_booking_atomic(
            user_id=current_user["id"],
            machine_id=req.machine_id,
            game_id=req.game_id,
            game_title=req.game_title,
            start_iso=start_iso,
            end_iso=end_iso,
        )
        return booking
    except BookingConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )


@router.get("/my")
def get_my_bookings(current_user: Dict = Depends(get_current_user)):
    """Return active, upcoming, and past reservations for the current student (User Story 1)."""
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT b.id, b.user_id, b.machine_id, b.game_id, b.game_title, b.start_time, b.end_time, b.status, b.created_at,
                   m.name as machine_name, m.gpu, m.cpu, m.ram, m.is_host,
                   g.cover_url as game_cover_url, g.genre as game_genre
            FROM bookings b
            JOIN machines m ON b.machine_id = m.id
            LEFT JOIN games g ON b.game_id = g.id
            WHERE b.user_id = ?
            ORDER BY b.start_time DESC;
            """,
            (current_user["id"],),
        )
        rows = [dict(row) for row in cursor.fetchall()]

    active: List[Dict] = []
    upcoming: List[Dict] = []
    past: List[Dict] = []

    for b in rows:
        if b["status"] == "confirmed":
            if b["start_time"] <= now_iso <= b["end_time"]:
                # Calculate remaining seconds
                end_dt = datetime.fromisoformat(b["end_time"].replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                b["remaining_seconds"] = max(0, int((end_dt - now_dt).total_seconds()))
                active.append(b)
            elif b["start_time"] > now_iso:
                start_dt = datetime.fromisoformat(b["start_time"].replace("Z", "+00:00"))
                now_dt = datetime.now(timezone.utc)
                b["seconds_until_start"] = max(0, int((start_dt - now_dt).total_seconds()))
                upcoming.append(b)
            else:
                past.append(b)
        else:
            past.append(b)

    return {
        "active": active,
        "upcoming": upcoming,
        "past": past,
        "server_time": now_iso,
    }


@router.delete("/{booking_id}")
def cancel_booking(
    booking_id: int,
    current_user: Dict = Depends(get_current_user),
):
    """Cancel a confirmed booking."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, user_id, status, start_time FROM bookings WHERE id = ?;",
            (booking_id,),
        )
        booking = cursor.fetchone()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found.")

        if booking["user_id"] != current_user["id"] and current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorized to cancel this booking.")

        if booking["status"] != "confirmed":
            raise HTTPException(status_code=400, detail=f"Booking is already {booking['status']}.")

        cursor.execute(
            "UPDATE bookings SET status = 'cancelled' WHERE id = ?;",
            (booking_id,),
        )
        conn.commit()

    return {"message": "Reservation cancelled successfully."}


@router.get("/admin/all")
def get_all_bookings(admin_user: Dict = Depends(require_admin)):
    """Admin-only: list all system bookings with student details (User Story 3)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT b.id, b.user_id, b.machine_id, b.game_id, b.game_title, b.start_time, b.end_time, b.status, b.created_at,
                   u.name as user_name, u.email as user_email,
                   m.name as machine_name, m.gpu,
                   g.cover_url as game_cover_url
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN machines m ON b.machine_id = m.id
            LEFT JOIN games g ON b.game_id = g.id
            ORDER BY b.start_time DESC;
            """
        )
        return [dict(row) for row in cursor.fetchall()]
