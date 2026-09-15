"""Reservation & Conflict-Free Booking Endpoints (FR-03, FR-04, NFR-02)."""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import BookingConflictError, create_booking_atomic, get_db
from app.services.auth import get_current_user, get_current_user_optional, require_admin

router = APIRouter(prefix="/bookings", tags=["bookings"])


class CreateBookingRequest(BaseModel):
    machine_id: Optional[int] = None
    game_id: Optional[int] = None
    game_title: Optional[str] = None
    start_time: str = Field(..., description="ISO 8601 start timestamp")
    end_time: str = Field(..., description="ISO 8601 end timestamp")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_booking(
    req: CreateBookingRequest,
    current_user: Dict = Depends(get_current_user),
):
    """Create a conflict-free reservation for a gaming PC (FR-03, FR-04, NFR-02)."""
    # 1. Anti-Spam Rate Limiter: Max 5 booking requests per minute per user
    from app.core.redis import check_rate_limit, acquire_lock, release_lock, increment_dmaic_counter, record_dmaic_unique_user, cache_delete
    allowed = await check_rate_limit(f"rate:booking:{current_user['id']}", max_requests=5, window_seconds=60)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many booking requests. Please wait 1 minute before booking again.",
        )

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

    # 2-Hour Daily Free Quota Gatekeeper for Beta Testing (Lean Six Sigma policy)
    if current_user.get("role") != "admin":
        if duration_minutes > 120:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum reservation duration is 2 hours (120 minutes) per session during beta testing.",
            )

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time::timestamptz - start_time::timestamptz)) / 60.0), 0) as booked_minutes
                FROM bookings
                WHERE user_id = %s
                  AND status = 'confirmed'
                  AND (start_time::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date = (%s::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date;
                """,
                (current_user["id"], start_dt.isoformat()),
            )
            booked_minutes = float(cursor.fetchone()["booked_minutes"] or 0)
            remaining_minutes = max(0, 120 - int(booked_minutes))

            if booked_minutes + duration_minutes > 120:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Daily 2-hour free quota reached: You already have {int(booked_minutes)} minutes booked for this date ({remaining_minutes} mins remaining). Requested: {int(duration_minutes)} mins.",
                )

    # Normalize ISO strings
    start_iso = start_dt.isoformat()
    end_iso = end_dt.isoformat()

    # 2. Concurrency Lock: Prevent simultaneous double-booking on the exact same rig
    target_node = req.machine_id or 2
    lock_key = f"lock:slot:machine:{target_node}"
    if not await acquire_lock(lock_key, ttl_seconds=6):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Gaming rig slot is currently being claimed by another user. Please try again in a few seconds.",
        )

    try:
        booking = create_booking_atomic(
            user_id=current_user["id"],
            machine_id=req.machine_id,
            game_id=req.game_id,
            game_title=req.game_title,
            start_iso=start_iso,
            end_iso=end_iso,
        )
        # Record real-time Lean Six Sigma DMAIC telemetry
        await increment_dmaic_counter("sessions:total")
        await increment_dmaic_counter(f"sessions:{datetime.now().strftime('%Y-%m-%d')}")
        await record_dmaic_unique_user(current_user["id"])
        await cache_delete("machines:raw")
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
    finally:
        await release_lock(lock_key)


@router.get("/availability")
async def get_slot_availability(
    game_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    date: Optional[str] = None,
    current_user: Optional[Dict] = Depends(get_current_user_optional),
):
    """Return real-time rig availability, currently active playing sessions, and booked time slots (FR-03, FR-04)."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    target_date = date or now.strftime("%Y-%m-%d")

    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Identify capable machines for this game
        if machine_id:
            cursor.execute(
                "SELECT id, name, status, is_host FROM machines WHERE id = %s AND status != 'maintenance';",
                (machine_id,),
            )
            capable_machines = cursor.fetchall()
        elif game_id:
            cursor.execute(
                """
                SELECT m.id, m.name, m.status, m.is_host
                FROM machines m
                JOIN node_games ng ON m.id = ng.node_id
                WHERE ng.game_id = %s
                  AND ng.enabled = TRUE
                  AND ng.status = 'ready'
                  AND m.status != 'maintenance'
                ORDER BY m.is_host DESC, m.id ASC;
                """,
                (game_id,),
            )
            capable_machines = cursor.fetchall()
        else:
            cursor.execute(
                "SELECT id, name, status, is_host FROM machines WHERE status != 'maintenance' ORDER BY is_host DESC, id ASC;"
            )
            capable_machines = cursor.fetchall()

        capable_count = len(capable_machines)
        if capable_count == 0:
            return {
                "capable_machines_count": 0,
                "is_currently_in_use": False,
                "current_session": None,
                "date": target_date,
                "server_time": now_iso,
                "bookings": [],
            }

        m_ids = tuple(m["id"] for m in capable_machines)

        # 2. Check if a session is actively playing RIGHT NOW
        cursor.execute(
            """
            SELECT b.id, b.machine_id, b.user_id, b.game_title, b.start_time, b.end_time,
                   m.name as machine_name, u.name as user_name
            FROM bookings b
            JOIN machines m ON b.machine_id = m.id
            LEFT JOIN users u ON b.user_id = u.id
            WHERE b.machine_id IN %s
              AND b.status = 'confirmed'
              AND b.start_time <= %s
              AND b.end_time > %s
            ORDER BY b.end_time ASC;
            """,
            (m_ids, now_iso, now_iso),
        )
        active_sessions = cursor.fetchall()

        # Rig is currently in-use if all capable machines have an active session right now
        is_currently_in_use = len(active_sessions) >= capable_count
        current_session_info = None

        if active_sessions:
            earliest = active_sessions[0]
            end_dt = datetime.fromisoformat(earliest["end_time"].replace("Z", "+00:00"))
            rem_sec = max(0, int((end_dt - now).total_seconds()))
            rem_mins = max(1, round(rem_sec / 60))
            is_my_active = bool(current_user and earliest["user_id"] == current_user["id"])

            current_session_info = {
                "booking_id": earliest["id"],
                "machine_id": earliest["machine_id"],
                "machine_name": earliest["machine_name"],
                "game_title": earliest["game_title"],
                "user_name": earliest["user_name"],
                "start_time": earliest["start_time"],
                "end_time": earliest["end_time"],
                "remaining_seconds": rem_sec,
                "remaining_minutes": rem_mins,
                "is_mine": is_my_active,
            }

        # 3. Fetch all confirmed bookings for target date
        cursor.execute(
            """
            SELECT b.id, b.machine_id, b.user_id, b.start_time, b.end_time, b.game_title
            FROM bookings b
            WHERE b.machine_id IN %s
              AND b.status = 'confirmed'
              AND (
                (b.start_time::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date = %s::date
                OR (b.end_time::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date = %s::date
              )
            ORDER BY b.start_time ASC;
            """,
            (m_ids, target_date, target_date),
        )
        day_bookings = cursor.fetchall()

        bookings_list = []
        for b in day_bookings:
            is_mine = bool(current_user and b["user_id"] == current_user["id"])
            bookings_list.append({
                "id": b["id"],
                "machine_id": b["machine_id"],
                "start_time": b["start_time"],
                "end_time": b["end_time"],
                "game_title": b["game_title"],
                "is_mine": is_mine,
            })

    return {
        "capable_machines_count": capable_count,
        "is_currently_in_use": is_currently_in_use,
        "current_session": current_session_info,
        "date": target_date,
        "server_time": now_iso,
        "bookings": bookings_list,
    }


@router.get("/quota")
def get_daily_quota(
    date: Optional[str] = None,
    current_user: Dict = Depends(get_current_user),
):
    """Return user's remaining free daily quota (120 mins limit) for a given date."""
    now = datetime.now(timezone.utc)
    target_iso = date if date else now.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_time::timestamptz - start_time::timestamptz)) / 60.0), 0) as booked_minutes
            FROM bookings
            WHERE user_id = %s
              AND status = 'confirmed'
              AND (start_time::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date = (%s::timestamptz AT TIME ZONE 'Asia/Phnom_Penh')::date;
            """,
            (current_user["id"], target_iso),
        )
        booked_minutes = int(float(cursor.fetchone()["booked_minutes"] or 0))

    daily_limit = 120  # 2 hours per day
    remaining = max(0, daily_limit - booked_minutes)
    return {
        "daily_limit_minutes": daily_limit,
        "booked_minutes": booked_minutes,
        "remaining_minutes": remaining,
        "is_admin": current_user.get("role") == "admin",
    }


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
            WHERE b.user_id = %s
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
async def cancel_booking(
    booking_id: int,
    current_user: Dict = Depends(get_current_user),
):
    """Cancel a confirmed booking, freeing remaining reserved time and terminating active stream if running."""
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, user_id, machine_id, game_id, status, start_time, end_time FROM bookings WHERE id = %s;",
            (booking_id,),
        )
        booking = cursor.fetchone()
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found.")

        if booking["user_id"] != current_user["id"] and current_user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Not authorized to cancel this booking.")

        if booking["status"] != "confirmed":
            raise HTTPException(status_code=400, detail=f"Booking is already {booking['status']}.")

        is_active = booking["start_time"] <= now_iso <= booking["end_time"]

        # If booking is actively running, truncate end_time to now so remaining time slot is immediately released!
        if is_active:
            cursor.execute(
                "UPDATE bookings SET status = 'cancelled', end_time = %s WHERE id = %s;",
                (now_iso, booking_id),
            )
        else:
            cursor.execute(
                "UPDATE bookings SET status = 'cancelled' WHERE id = %s;",
                (booking_id,),
            )
        conn.commit()

    from app.core.redis import cache_delete
    await cache_delete("machines:raw")

    # Stop game process and tear down capture pipeline for this booking
    try:
        from app.services.agent import host_agent
        from app.services.streaming.manager import stream_manager
        from app.services.streaming.node_relay import node_relay

        if stream_manager.available:
            stream_manager.close_all()
        host_agent.stop_game()

        target_machine = booking.get("machine_id")
        if target_machine and node_relay.is_node_connected(target_machine):
            await node_relay.forward_game_command(target_machine, "STOP_GAME", timeout=4.0)
        elif node_relay.is_node_connected():
            for nid in list(node_relay._nodes.keys()):
                try:
                    await node_relay.forward_game_command(nid, "STOP_GAME", timeout=4.0)
                except Exception:
                    pass
    except Exception as exc:
        logger.debug("Failed to notify nodes of booking cancellation: %s", exc)

    return {"message": "Reservation cancelled and session ended successfully. Remaining time slot released."}


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
