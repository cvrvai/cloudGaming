"""Game Library Management Endpoints (Admin & User)."""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.auth import get_current_user, require_admin

router = APIRouter(prefix="/games", tags=["games"])


class GameCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    genre: str = Field(..., min_length=1, max_length=50)
    cover_url: Optional[str] = "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80"
    description: Optional[str] = ""
    exe_path: Optional[str] = ""
    size_gb: Optional[float] = 50.0
    installed_machines: Optional[str] = "all"


class GameUpdateRequest(BaseModel):
    title: Optional[str] = None
    genre: Optional[str] = None
    cover_url: Optional[str] = None
    description: Optional[str] = None
    exe_path: Optional[str] = None
    size_gb: Optional[float] = None
    installed_machines: Optional[str] = None


@router.get("")
def list_games():
    """List all games currently available in the cloud platform library."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, title, genre, cover_url, description, exe_path, size_gb, installed_machines, created_at
            FROM games
            ORDER BY id DESC;
            """
        )
        return [dict(row) for row in cursor.fetchall()]


@router.get("/{game_id}")
def get_game(game_id: int):
    """Get details for a specific game."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM games WHERE id = ?;", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        return dict(game)


@router.post("", status_code=status.HTTP_201_CREATED)
def add_game(
    req: GameCreateRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Add a new game to the platform library."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO games (title, genre, cover_url, description, exe_path, size_gb, installed_machines, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                req.title.strip(),
                req.genre.strip(),
                req.cover_url.strip() if req.cover_url else None,
                req.description.strip() if req.description else "",
                req.exe_path.strip() if req.exe_path else "",
                req.size_gb or 50.0,
                req.installed_machines or "all",
                now_iso,
            ),
        )
        conn.commit()
        game_id = cursor.lastrowid

    return {
        "id": game_id,
        "title": req.title,
        "genre": req.genre,
        "cover_url": req.cover_url,
        "description": req.description,
        "exe_path": req.exe_path,
        "size_gb": req.size_gb,
        "installed_machines": req.installed_machines,
        "created_at": now_iso,
    }


@router.put("/{game_id}")
def update_game(
    game_id: int,
    req: GameUpdateRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Update an existing game's metadata."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM games WHERE id = ?;", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        updates = []
        params = []
        if req.title is not None:
            updates.append("title = ?")
            params.append(req.title)
        if req.genre is not None:
            updates.append("genre = ?")
            params.append(req.genre)
        if req.cover_url is not None:
            updates.append("cover_url = ?")
            params.append(req.cover_url)
        if req.description is not None:
            updates.append("description = ?")
            params.append(req.description)
        if req.exe_path is not None:
            updates.append("exe_path = ?")
            params.append(req.exe_path)
        if req.size_gb is not None:
            updates.append("size_gb = ?")
            params.append(req.size_gb)
        if req.installed_machines is not None:
            updates.append("installed_machines = ?")
            params.append(req.installed_machines)

        if updates:
            params.append(game_id)
            cursor.execute(
                f"UPDATE games SET {', '.join(updates)} WHERE id = ?;",
                params,
            )
            conn.commit()

    return {"message": "Game updated successfully"}


@router.delete("/{game_id}")
def delete_game(
    game_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Remove a game from the platform library."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM games WHERE id = ?;", (game_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Game not found")
        conn.commit()

    return {"message": "Game deleted successfully"}
