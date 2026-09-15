"""Authentication and authorization services.

Implements Argon2id password hashing, encrypted MFA secrets at rest,
JWT token issuing and validation with MFA verification claims, and FastAPI security dependencies.
"""
import base64
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings

# Argon2id password hasher
_ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

security_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """Hash a password using Argon2id."""
    return _ph.hash(password), "argon2id"


def verify_password(password: str, password_hash: str, salt: str = "") -> bool:
    """Verify password against stored Argon2id or legacy PBKDF2 hash."""
    if password_hash.startswith("$argon2"):
        try:
            return _ph.verify(password_hash, password)
        except VerifyMismatchError:
            return False
        except Exception:
            return False

    # Backward compatibility with existing PBKDF2-HMAC-SHA256 hashes
    if salt:
        try:
            test_hash = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                salt.encode("utf-8"),
                100_000,
            ).hex()
            return secrets.compare_digest(test_hash, password_hash)
        except Exception:
            return False
    return False


def _get_fernet() -> Fernet:
    """Derive Fernet cipher from configured mfa_encryption_key."""
    key_bytes = hashlib.sha256(settings.mfa_encryption_key.encode("utf-8")).digest()
    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt_mfa_secret(secret: str) -> str:
    """Encrypt a TOTP secret at rest using Fernet (AES-128-CBC + HMAC)."""
    return _get_fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_mfa_secret(encrypted: str) -> str:
    """Decrypt a stored TOTP secret."""
    return _get_fernet().decrypt(encrypted.encode("utf-8")).decode("utf-8")


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Encode JWT access token with expiration and MFA verification claim."""
    to_encode = data.copy()
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token has expired. Please log in again.",
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {exc}",
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security_scheme),
) -> Dict[str, Any]:
    """FastAPI dependency to extract and verify the current authenticated user (NFR-01)."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    payload = decode_access_token(token)
    user_id_raw = payload.get("sub")
    if not user_id_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
        )
    try:
        user_id = int(user_id_raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user ID in token.",
        )

    # 1. High-speed Redis session cache (sub-millisecond auth check, NFR-01)
    import json
    from app.core.redis import cache_get, cache_set

    cache_key = f"auth:user:{user_id}"
    try:
        cached_user_json = await cache_get(cache_key)
        if cached_user_json:
            user_dict = json.loads(cached_user_json)
            user_dict["mfa_verified"] = payload.get("mfa_verified", False)
            return user_dict
    except Exception:
        pass

    # 2. Cache miss: Fetch from database
    from app.db import get_db

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, email, role, mfa_enabled, created_at FROM users WHERE id = %s;", (user_id,))
        user = cursor.fetchone()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account no longer exists.",
            )
        user_dict = dict(user)

        # Store in Redis with 15-minute TTL (900 seconds)
        try:
            await cache_set(cache_key, json.dumps(user_dict, default=str), ttl_seconds=900)
        except Exception:
            pass

        user_dict["mfa_verified"] = payload.get("mfa_verified", False)
        return user_dict


async def require_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    """Dependency requiring user to have admin role AND completed MFA verification."""
    if user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrative privileges required.",
        )
    if not user.get("mfa_verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Two-step MFA verification required for administrative privileges.",
        )
    return user
