"""Authentication API endpoints (FR-01, NFR-01)."""
from datetime import datetime, timezone
import re
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.db import get_db
from app.services.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=100)
    role: Optional[str] = "student"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict


@router.post("/register", response_model=AuthResponse)
def register(req: RegisterRequest):
    """Register a new student account (FR-01)."""
    email_clean = req.email.lower().strip()
    name_clean = req.name.strip()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = ?;", (email_clean,))
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
            INSERT INTO users (name, email, password_hash, salt, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            (name_clean, email_clean, password_hash, salt, role, now_iso),
        )
        conn.commit()
        user_id = cursor.lastrowid

    token = create_access_token({"sub": user_id, "email": email_clean, "role": role})
    return {
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


@router.post("/login", response_model=AuthResponse)
def login(req: LoginRequest):
    """Authenticate user credentials and return JWT session token (FR-01)."""
    email_clean = req.email.lower().strip()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, name, email, password_hash, salt, role, created_at FROM users WHERE email = ?;",
            (email_clean,),
        )
        user = cursor.fetchone()

    if not user or not verify_password(req.password, user["password_hash"], user["salt"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    token = create_access_token({"sub": user["id"], "email": user["email"], "role": user["role"]})
    return {
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


@router.get("/me")
def get_me(current_user: Dict = Depends(get_current_user)):
    """Return profile details for current authenticated session."""
    return current_user
