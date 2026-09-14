"""Authentication API endpoints with 2-Step TOTP MFA and Argon2id (FR-01, NFR-01)."""
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.db import get_db
from app.services.audit import record_audit_event
from app.services.auth import (
    create_access_token,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory challenge store with thread-safety and 5-minute TTL
_mfa_challenges: Dict[str, Dict[str, Any]] = {}
_challenges_lock = threading.Lock()


def _cleanup_expired_challenges():
    now = datetime.now(timezone.utc)
    expired = [cid for cid, c in _mfa_challenges.items() if c["expires_at"] < now]
    for cid in expired:
        _mfa_challenges.pop(cid, None)


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=100)
    role: Optional[str] = "student"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MFAVerifyRequest(BaseModel):
    challenge_id: str
    code: str = Field(..., min_length=6, max_length=8)


class UpdateProfileRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=100)


@router.post("/register")
def register(req: RegisterRequest, request: Request):
    """Register a new student account (FR-01)."""
    email_clean = req.email.lower().strip()
    name_clean = req.name.strip()
    client_ip = request.client.host if request.client else None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = %s;", (email_clean,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="An account with this email address already exists.",
            )

        password_hash, salt = hash_password(req.password)
        now_iso = datetime.now(timezone.utc).isoformat()
        role = "admin" if req.role == "admin" else "student"

        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at)
            VALUES (%s, %s, %s, %s, %s, FALSE, %s)
            RETURNING id;
            """,
            (name_clean, email_clean, password_hash, salt, role, now_iso),
        )
        user_id = cursor.fetchone()["id"]
        conn.commit()

    token = create_access_token({"sub": user_id, "email": email_clean, "role": role, "mfa_verified": False})
    return {
        "status": "authenticated",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "name": name_clean,
            "email": email_clean,
            "role": role,
            "created_at": now_iso,
        },
    }


@router.post("/login")
def login(req: LoginRequest, request: Request):
    """Authenticate credentials; returns user token for students, or MFA challenge for administrators."""
    email_clean = req.email.lower().strip()
    client_ip = request.client.host if request.client else None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name, email, password_hash, salt, role, mfa_enabled, mfa_secret, created_at
            FROM users WHERE email = %s;
            """,
            (email_clean,),
        )
        user = cursor.fetchone()

    if not user or not verify_password(req.password, user["password_hash"], user.get("salt", "")):
        if user and user["role"] == "admin":
            record_audit_event(
                action="ADMIN_LOGIN_FAILED",
                actor_user_id=user["id"],
                role="admin",
                ip=client_ip,
                result="FAILED",
                details="Invalid password attempt",
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    # 1. Normal student / user accounts receive immediate authenticated session
    if user["role"] != "admin":
        now_iso = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE users SET last_login_at = %s WHERE id = %s;", (now_iso, user["id"]))
            conn.commit()

        token = create_access_token(
            {"sub": user["id"], "email": user["email"], "role": user["role"], "mfa_verified": False}
        )
        return {
            "status": "authenticated",
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user["id"],
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
                "created_at": user["created_at"],
            },
        }

    # 2. Administrator accounts MUST complete two-step MFA verification
    challenge_id = secrets.token_urlsafe(32)
    mfa_setup_required = not bool(user["mfa_enabled"])
    pending_secret = None
    provisioning_uri = None

    if mfa_setup_required:
        pending_secret = pyotp.random_base32()
        totp = pyotp.TOTP(pending_secret)
        provisioning_uri = totp.provisioning_uri(name=user["email"], issuer_name="CloudKH")

    with _challenges_lock:
        _cleanup_expired_challenges()
        _mfa_challenges[challenge_id] = {
            "user_id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "created_at": user["created_at"],
            "mfa_setup_required": mfa_setup_required,
            "pending_secret": pending_secret,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            "failed_attempts": 0,
        }

    return {
        "status": "mfa_required",
        "challenge_id": challenge_id,
        "mfa_setup_required": mfa_setup_required,
        "secret": pending_secret,
        "provisioning_uri": provisioning_uri,
        "message": "Enter 6-digit authenticator security code to complete administrator sign-in.",
    }


@router.post("/mfa/verify")
def verify_mfa(req: MFAVerifyRequest, request: Request):
    """Verify 6-digit TOTP code and issue an authenticated administrator session."""
    client_ip = request.client.host if request.client else None
    now = datetime.now(timezone.utc)

    with _challenges_lock:
        _cleanup_expired_challenges()
        challenge = _mfa_challenges.get(req.challenge_id)

    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security challenge has expired or is invalid. Please sign in again.",
        )

    if challenge["expires_at"] < now:
        with _challenges_lock:
            _mfa_challenges.pop(req.challenge_id, None)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security challenge has expired. Please sign in again.",
        )

    if challenge["failed_attempts"] >= 5:
        with _challenges_lock:
            _mfa_challenges.pop(req.challenge_id, None)
        record_audit_event(
            action="MFA_BLOCKED",
            actor_user_id=challenge["user_id"],
            role="admin",
            ip=client_ip,
            result="BLOCKED",
            details="Too many failed MFA verification attempts",
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed verification attempts. Please sign in again.",
        )

    code_clean = req.code.strip().replace(" ", "").replace("-", "")

    # Retrieve or resolve the TOTP secret
    totp_secret = None
    if challenge["mfa_setup_required"]:
        totp_secret = challenge["pending_secret"]
    else:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT mfa_secret FROM users WHERE id = %s;", (challenge["user_id"],))
            row = cursor.fetchone()
            if row and row["mfa_secret"]:
                try:
                    totp_secret = decrypt_mfa_secret(row["mfa_secret"])
                except Exception:
                    totp_secret = None

    if not totp_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="MFA secret could not be resolved.",
        )

    # Verify code using RFC 6238 TOTP (allowing +/- 1 time step drift of 30s)
    totp = pyotp.TOTP(totp_secret)
    is_valid = totp.verify(code_clean, valid_window=1)

    if not is_valid:
        with _challenges_lock:
            challenge["failed_attempts"] += 1
        record_audit_event(
            action="MFA_FAILED",
            actor_user_id=challenge["user_id"],
            role="admin",
            ip=client_ip,
            result="FAILED",
            details="Invalid TOTP 6-digit code",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid security verification code. Please check your authenticator app and try again.",
        )

    # Code is valid! If first-time enrollment, encrypt secret and enable MFA in database
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        if challenge["mfa_setup_required"]:
            encrypted_secret = encrypt_mfa_secret(totp_secret)
            cursor.execute(
                """
                UPDATE users
                SET mfa_enabled = TRUE, mfa_secret = %s, last_login_at = %s
                WHERE id = %s;
                """,
                (encrypted_secret, now_iso, challenge["user_id"]),
            )
        else:
            cursor.execute("UPDATE users SET last_login_at = %s WHERE id = %s;", (now_iso, challenge["user_id"]))
        conn.commit()

    # Log successful audit events
    record_audit_event(
        action="MFA_SUCCESS",
        actor_user_id=challenge["user_id"],
        role="admin",
        ip=client_ip,
        result="SUCCESS",
    )
    record_audit_event(
        action="ADMIN_LOGIN",
        actor_user_id=challenge["user_id"],
        role="admin",
        ip=client_ip,
        result="SUCCESS",
    )

    # Remove challenge from memory
    with _challenges_lock:
        _mfa_challenges.pop(req.challenge_id, None)

    # Issue verified admin JWT access token
    admin_token = create_access_token(
        {
            "sub": challenge["user_id"],
            "email": challenge["email"],
            "role": "admin",
            "mfa_verified": True,
        }
    )

    return {
        "status": "authenticated",
        "access_token": admin_token,
        "token_type": "bearer",
        "user": {
            "id": challenge["user_id"],
            "name": challenge["name"],
            "email": challenge["email"],
            "role": "admin",
            "created_at": challenge["created_at"],
            "mfa_verified": True,
        },
    }


@router.get("/me")
def get_me(current_user: Dict = Depends(get_current_user)):
    """Return profile details for current authenticated session."""
    return current_user


@router.put("/profile")
def update_profile(req: UpdateProfileRequest, current_user: Dict = Depends(get_current_user)):
    """Update display name for the currently authenticated user."""
    name_clean = req.name.strip()
    if not name_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Name cannot be empty.",
        )

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET name = %s WHERE id = %s RETURNING id, name, email, role, created_at;",
            (name_clean, current_user["id"]),
        )
        updated = cursor.fetchone()
        conn.commit()

    return {
        "status": "success",
        "user": dict(updated),
    }


@router.put("/password")
def change_password(req: ChangePasswordRequest, request: Request, current_user: Dict = Depends(get_current_user)):
    """Change user password after verifying the current password."""
    client_ip = request.client.host if request.client else None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT password_hash, salt FROM users WHERE id = %s;", (current_user["id"],))
        user_row = cursor.fetchone()

    if not user_row or not verify_password(req.current_password, user_row["password_hash"], user_row.get("salt", "")):
        record_audit_event(
            action="PASSWORD_CHANGE_FAILED",
            actor_user_id=current_user["id"],
            role=current_user["role"],
            ip=client_ip,
            result="FAILED",
            details="Invalid current password provided",
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password.",
        )

    new_hash, new_salt = hash_password(req.new_password)
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET password_hash = %s, salt = %s WHERE id = %s;",
            (new_hash, new_salt, current_user["id"]),
        )
        conn.commit()

    record_audit_event(
        action="PASSWORD_CHANGED",
        actor_user_id=current_user["id"],
        role=current_user["role"],
        ip=client_ip,
        result="SUCCESS",
        details="User updated password via self-service",
    )

    return {
        "status": "success",
        "message": "Password updated successfully.",
    }


@router.get("/stats")
def get_user_stats(current_user: Dict = Depends(get_current_user)):
    """Return summary statistics for user profile."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        # Total bookings
        cursor.execute("SELECT COUNT(*) AS total FROM bookings WHERE user_id = %s;", (current_user["id"],))
        total_bookings = cursor.fetchone()["total"]

        # Active bookings
        cursor.execute(
            """
            SELECT COUNT(*) AS active FROM bookings
            WHERE user_id = %s AND status = 'active' AND end_time > %s;
            """,
            (current_user["id"], now_iso),
        )
        active_bookings = cursor.fetchone()["active"]

        # Completed bookings
        cursor.execute(
            """
            SELECT COUNT(*) AS completed FROM bookings
            WHERE user_id = %s AND (status = 'completed' OR end_time <= %s);
            """,
            (current_user["id"], now_iso),
        )
        completed_bookings = cursor.fetchone()["completed"]

    return {
        "total_bookings": total_bookings,
        "active_bookings": active_bookings,
        "completed_bookings": completed_bookings,
        "role": current_user.get("role", "student"),
        "mfa_enabled": current_user.get("mfa_enabled", False),
        "created_at": current_user.get("created_at"),
    }

