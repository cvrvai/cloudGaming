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
    role: Optional[str] = "student"


class UpdateRoleRequest(BaseModel):
    role: str = Field(..., description="Role: admin, student, or user")


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
        users = [dict(r) for r in cursor.fetchall()]

    return users


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user_account(
    req: CreateUserRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin endpoint to provision user/student test accounts for DMAIC simulation."""
    email_clean = req.email.lower().strip()
    name_clean = req.name.strip()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = %s;", (email_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"An account with email '{email_clean}' already exists.",
            )

        password_hash, salt = hash_password(req.password)
        now_iso = datetime.now(timezone.utc).isoformat()
        role = "admin" if req.role == "admin" else "student"

        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at)
            VALUES (%s, %s, %s, %s, %s, FALSE, %s)
            RETURNING id, name, email, role, created_at;
            """,
            (name_clean, email_clean, password_hash, salt, role, now_iso),
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
    """Update role for a user account."""
    if req.role not in ("admin", "student", "user"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Role must be one of: 'admin', 'student', 'user'.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, role FROM users WHERE id = %s;", (user_id,))
        target = cursor.fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="User not found.")

        cursor.execute(
            "UPDATE users SET role = %s WHERE id = %s RETURNING id, name, email, role;",
            (req.role, user_id),
        )
        updated = dict(cursor.fetchone())
        conn.commit()

    return updated


@router.delete("/{user_id}")
def delete_user_account(
    user_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Delete a user account."""
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

        cursor.execute("DELETE FROM users WHERE id = %s;", (user_id,))
        conn.commit()

    return {"message": f"User account '{target['email']}' deleted successfully."}
