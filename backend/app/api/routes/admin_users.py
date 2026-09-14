"""Admin User Management API endpoints."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field

from app.db import get_db
from app.services.auth import get_current_user, hash_password, require_admin

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


class CreateUserRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=100)
    role: Optional[str] = "user"


class UpdateRoleRequest(BaseModel):
    role: str = Field(..., description="Role: admin or user")


@router.get("", response_model=List[Dict[str, Any]])
def list_users(
    q: Optional[str] = Query(None, description="Search query by name or email"),
    admin_user: Dict = Depends(require_admin),
):
    """List all registered users with aggregated booking statistics and account details."""
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        
        sql = """
            SELECT u.id, u.name, u.email, u.role, u.mfa_enabled, u.last_login_at, u.created_at,
                   COUNT(b.id) as total_bookings,
                   COUNT(CASE WHEN b.status = 'confirmed' AND b.start_time <= %s AND %s <= b.end_time THEN 1 END) as active_bookings,
                   COUNT(CASE WHEN b.status = 'confirmed' AND b.end_time < %s THEN 1 END) as completed_bookings,
                   COUNT(CASE WHEN b.status = 'cancelled' THEN 1 END) as cancelled_bookings,
                   ROUND(COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN (EXTRACT(EPOCH FROM (b.end_time::timestamptz - b.start_time::timestamptz)) / 3600.0) ELSE 0 END), 0)::numeric, 1) as gaming_hours,
                   MAX(b.start_time) as last_booking_time
            FROM users u
            LEFT JOIN bookings b ON u.id = b.user_id
        """
        params = [now_iso, now_iso, now_iso]

        if q:
            sql += " WHERE u.name ILIKE %s OR u.email ILIKE %s "
            q_pattern = f"%{q.strip()}%"
            params.extend([q_pattern, q_pattern])

        sql += " GROUP BY u.id ORDER BY u.created_at DESC;"

        cursor.execute(sql, tuple(params))
        users = []
        for r in cursor.fetchall():
            d = dict(r)
            d["gaming_hours"] = float(d.get("gaming_hours") or 0.0)
            users.append(d)

    return users


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user_account(
    req: CreateUserRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin endpoint to provision user accounts for DMAIC testing."""
    email_clean = req.email.lower().strip()
    name_clean = req.name.strip()
    requested_role = req.role.lower().strip() if req.role else "user"

    if requested_role not in ("admin", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be one of: 'admin', 'user'.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = %s;", (email_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"An account with email '{email_clean}' already exists.",
            )

        # Invariant: Only 1 administrator account can exist in the system
        if requested_role == "admin":
            cursor.execute("SELECT COUNT(*) as admin_count FROM users WHERE role = 'admin';")
            if cursor.fetchone()["admin_count"] >= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Security policy: Only 1 administrator account can exist in the system.",
                )

        password_hash, salt = hash_password(req.password)
        now_iso = datetime.now(timezone.utc).isoformat()

        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at)
            VALUES (%s, %s, %s, %s, %s, FALSE, %s)
            RETURNING id, name, email, role, created_at;
            """,
            (name_clean, email_clean, password_hash, salt, requested_role, now_iso),
        )
        new_user = dict(cursor.fetchone())
        conn.commit()

    return new_user


@router.patch("/{user_id}/role")
def update_user_role(
    user_id: int,
    req: UpdateRoleRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Update role for a user account (admin or user only)."""
    new_role = req.role.lower().strip()
    if new_role not in ("admin", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be one of: 'admin', 'user'.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, role FROM users WHERE id = %s;", (user_id,))
        target = cursor.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")

        # Invariant: Only 1 administrator account can exist in the system
        if new_role == "admin":
            cursor.execute("SELECT id, email FROM users WHERE role = 'admin' AND id != %s;", (user_id,))
            existing_admin = cursor.fetchone()
            if existing_admin:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Security policy: Only 1 administrator account can exist in the system ({existing_admin['email']} is currently the admin). Demote them first.",
                )

        cursor.execute(
            "UPDATE users SET role = %s WHERE id = %s RETURNING id, name, email, role;",
            (new_role, user_id),
        )
        updated = dict(cursor.fetchone())
        conn.commit()

    return updated


@router.delete("/{user_id}")
def delete_user_account(
    user_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Delete a user account and cascade delete all associated bookings and telemetry."""
    if user_id == admin_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own active administrator account.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email FROM users WHERE id = %s;", (user_id,))
        target = cursor.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")

        # Cleanly delete foreign key relations
        cursor.execute("DELETE FROM session_telemetry WHERE user_id = %s;", (user_id,))
        cursor.execute("DELETE FROM bookings WHERE user_id = %s;", (user_id,))
        cursor.execute("UPDATE audit_logs SET actor_user_id = NULL WHERE actor_user_id = %s;", (user_id,))
        cursor.execute("UPDATE machine_pairings SET admin_user_id = NULL WHERE admin_user_id = %s;", (user_id,))

        cursor.execute("DELETE FROM users WHERE id = %s;", (user_id,))
        conn.commit()

    return {"message": f"User account '{target['email']}' and all associated bookings were deleted successfully."}
