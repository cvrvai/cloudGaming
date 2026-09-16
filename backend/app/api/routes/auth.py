"""Authentication API endpoints with 2-Step TOTP MFA and Argon2id (FR-01, NFR-01)."""
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from app.core.config import settings
from app.db import get_db
from app.services.audit import record_audit_event
from app.services.auth import (
    JWT_ALGORITHM,
    create_access_token,
    decrypt_mfa_secret,
    encrypt_mfa_secret,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# In-memory challenge store with thread-safety and 15-minute TTL (legacy fallback)
_mfa_challenges: Dict[str, Dict[str, Any]] = {}
_challenges_lock = threading.Lock()


def _cleanup_expired_challenges():
    now = datetime.now(timezone.utc)
    expired = []
    for cid, c in list(_mfa_challenges.items()):
        exp = c.get("expires_at")
        if not exp:
            expired.append(cid)
        elif isinstance(exp, datetime) and exp < now:
            expired.append(cid)
        elif isinstance(exp, str):
            try:
                if datetime.fromisoformat(exp.replace("Z", "+00:00")) < now:
                    expired.append(cid)
            except Exception:
                expired.append(cid)
    for cid in expired:
        _mfa_challenges.pop(cid, None)


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=100)
    role: Optional[str] = "user"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str = Field(..., description="Google ID Token (JWT) from Google Identity Services")


class MFAVerifyRequest(BaseModel):
    challenge_id: str
    code: str = Field(..., min_length=6, max_length=8)


class UpdateProfileRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=100)


@router.post("/register")
async def register(req: RegisterRequest, request: Request):
    """Register a new player/user account (FR-01)."""
    email_clean = req.email.lower().strip()
    name_clean = req.name.strip()
    client_ip = request.client.host if request.client else None

    # Anti-Spam Protection via Redis Rate Limiter: Max 3 accounts per 24 hours per IP
    if client_ip and client_ip not in ("127.0.0.1", "localhost", "testclient"):
        from app.core.redis import check_rate_limit
        allowed = await check_rate_limit(f"rate:register:{client_ip}", max_requests=3, window_seconds=86400)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Registration limit reached for this network (max 3 accounts per day). To maintain fair gaming rig capacity during beta testing, please sign in to your existing account.",
            )

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
        # Security Policy: Public registration always creates 'user' role
        role = "user"

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

    record_audit_event(
        action="USER_REGISTERED",
        actor_user_id=user_id,
        role=role,
        ip=client_ip,
        result="SUCCESS",
        details=f"New player registered: {email_clean}",
    )

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
async def login(req: LoginRequest, request: Request):
    """Authenticate credentials; returns user token for students, or MFA challenge for administrators."""
    email_clean = req.email.lower().strip()
    client_ip = request.client.host if request.client else None

    # Redis Anti-Brute-Force Rate Limiting (max 10 login attempts per 5 minutes per email/IP)
    if client_ip and client_ip not in ("127.0.0.1", "localhost", "testclient"):
        from app.core.redis import check_rate_limit
        allowed = await check_rate_limit(f"rate:login:{email_clean}:{client_ip}", max_requests=10, window_seconds=300)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Please wait 5 minutes before trying again.",
            )

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
    mfa_setup_required = not bool(user["mfa_enabled"])
    pending_secret = None
    provisioning_uri = None

    if mfa_setup_required:
        pending_secret = pyotp.random_base32()
        totp = pyotp.TOTP(pending_secret)
        provisioning_uri = totp.provisioning_uri(name=user["email"], issuer_name="CloudKH")

    # Cryptographically sign the MFA challenge into a stateless token (survives restarts, 15m expiry)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
    challenge_payload = {
        "type": "mfa_challenge",
        "user_id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "created_at": user["created_at"],
        "mfa_setup_required": mfa_setup_required,
        "pending_secret": pending_secret,
        "exp": expires_at,
    }
    challenge_id = jwt.encode(challenge_payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)

    with _challenges_lock:
        _cleanup_expired_challenges()
        _mfa_challenges[challenge_id] = {
            **challenge_payload,
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


@router.post("/google")
async def google_auth(req: GoogleAuthRequest, request: Request):
    """Authenticate or register player via Google Social Sign-In (OAuth 2.0 / GIS)."""
    import json
    import urllib.request
    import urllib.error

    credential = req.credential.strip()
    if not credential:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google authentication credential is required.",
        )

    # Verify ID token using Google's public tokeninfo endpoint
    tokeninfo_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={credential}"
    try:
        req_obj = urllib.request.Request(
            tokeninfo_url,
            headers={"User-Agent": "CloudKH-Backend/1.0"},
        )
        with urllib.request.urlopen(req_obj, timeout=8) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google token verification failed or expired. Please sign in again.",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not reach Google authentication servers. Please try again.",
        )

    # Validate audience if client ID configured
    if settings.google_client_id:
        token_aud = payload.get("aud")
        if token_aud != settings.google_client_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google token audience mismatch.",
            )

    email_verified = payload.get("email_verified")
    if email_verified is not True and email_verified != "true":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google account email is not verified.",
        )

    email_clean = payload.get("email", "").lower().strip()
    if not email_clean:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email not provided by Google account.",
        )

    name_clean = payload.get("name", "").strip() or email_clean.split("@")[0]
    picture_url = payload.get("picture", "")
    now_iso = datetime.now(timezone.utc).isoformat()
    client_ip = request.client.host if request.client else None

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role, mfa_enabled, created_at FROM users WHERE LOWER(email) = %s;", (email_clean,))
        user = cursor.fetchone()

        if user:
            # Existing user logging in with Google
            user_id = user["id"]
            role = user["role"]
            name_clean = user["name"]
            cursor.execute("UPDATE users SET last_login_at = %s WHERE id = %s;", (now_iso, user_id))
            conn.commit()

            record_audit_event(
                action="USER_LOGIN_GOOGLE",
                actor_user_id=user_id,
                role=role,
                ip=client_ip,
                result="SUCCESS",
                details=f"User logged in via Google OAuth: {email_clean}",
            )
        else:
            # New user registering with Google
            role = "user"
            cursor.execute(
                """
                INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at, last_login_at)
                VALUES (%s, %s, 'oauth_google', 'google', %s, FALSE, %s, %s)
                RETURNING id;
                """,
                (name_clean, email_clean, role, now_iso, now_iso),
            )
            user_id = cursor.fetchone()["id"]
            conn.commit()

            record_audit_event(
                action="USER_REGISTER_GOOGLE",
                actor_user_id=user_id,
                role=role,
                ip=client_ip,
                result="SUCCESS",
                details=f"New user registered via Google OAuth: {email_clean}",
            )

    token = create_access_token({
        "sub": user_id,
        "email": email_clean,
        "role": role,
        "mfa_verified": True,
    })

    return {
        "status": "authenticated",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "name": name_clean,
            "email": email_clean,
            "role": role,
            "picture": picture_url,
            "created_at": now_iso,
        },
    }


@router.post("/mfa/verify")
def verify_mfa(req: MFAVerifyRequest, request: Request):
    """Verify 6-digit TOTP code and issue an authenticated administrator session."""
    client_ip = request.client.host if request.client else None
    now = datetime.now(timezone.utc)

    challenge = None
    # 1. Decode cryptographically signed challenge token
    try:
        payload = jwt.decode(req.challenge_id, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        if payload.get("type") == "mfa_challenge":
            challenge = payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security challenge has expired. Please click 'Back to Sign In' and enter your password again.",
        )
    except Exception:
        pass

    # 2. Fallback to memory store if legacy token
    if not challenge:
        with _challenges_lock:
            _cleanup_expired_challenges()
            challenge = _mfa_challenges.get(req.challenge_id)

    if not challenge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Security challenge has expired or is invalid. Please click 'Back to Sign In' and sign in again.",
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

    # Verify code using RFC 6238 TOTP (allowing +/- 2 time steps drift = 60s window for mobile clock variance)
    totp = pyotp.TOTP(totp_secret)
    is_valid = totp.verify(code_clean, valid_window=2)

    if not is_valid:
        with _challenges_lock:
            if req.challenge_id in _mfa_challenges:
                _mfa_challenges[req.challenge_id]["failed_attempts"] = _mfa_challenges[req.challenge_id].get("failed_attempts", 0) + 1
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
        "role": current_user.get("role", "user"),
        "mfa_enabled": current_user.get("mfa_enabled", False),
        "created_at": current_user.get("created_at"),
    }

