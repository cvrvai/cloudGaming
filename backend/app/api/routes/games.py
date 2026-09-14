"""Game Catalog Management Endpoints (Admin & User)."""
import re
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.auth import get_current_user, require_admin
from app.services.streaming.node_relay import node_relay

router = APIRouter(prefix="/games", tags=["games"])


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return s or "game"


class GameCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=100)
    slug: Optional[str] = None
    genre: str = Field(..., min_length=1, max_length=50)
    cover_url: Optional[str] = "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80"
    description: Optional[str] = ""
    size_gb: Optional[float] = 50.0
    enabled: Optional[bool] = True


class GameUpdateRequest(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    genre: Optional[str] = None
    cover_url: Optional[str] = None
    description: Optional[str] = None
    size_gb: Optional[float] = None
    enabled: Optional[bool] = None


@router.get("")
def list_games():
    """List all games in the platform catalog with node installation counts."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT g.id, g.slug, g.title, g.title as name, g.genre, g.cover_url, g.cover_url as cover_image_url,
                   g.description, g.size_gb, g.enabled, g.created_at, g.updated_at,
                   COALESCE(
                       json_agg(
                           json_build_object(
                               'node_id', ng.node_id,
                               'enabled', ng.enabled,
                               'status', ng.status,
                               'machine_status', m.status
                           )
                       ) FILTER (WHERE ng.id IS NOT NULL), '[]'::json
                   ) as node_installs
            FROM games g
            LEFT JOIN node_games ng ON g.id = ng.game_id
            LEFT JOIN machines m ON ng.node_id = m.id
            GROUP BY g.id
            ORDER BY g.id DESC;
            """
        )
        games = [dict(row) for row in cursor.fetchall()]

        # Format backward compatible fields and calculate online nodes
        for g in games:
            installs = g.pop("node_installs", []) or []
            total_nodes = len(installs)
            ready_count = 0
            for inst in installs:
                nid = inst.get("node_id")
                if inst.get("enabled") and inst.get("status") == "ready":
                    # Only count as ready if the node WebSocket relay is actually connected or machine is marked available
                    if (nid and node_relay.is_node_connected(nid)) or inst.get("machine_status") == "available":
                        ready_count += 1
            g["ready_nodes_count"] = ready_count
            g["installed_machines_count"] = total_nodes
            g["is_online"] = ready_count > 0
            g["installed_machines"] = f"{total_nodes} Gaming Rig{'s' if total_nodes != 1 else ''}" if total_nodes > 0 else "None yet"

        return games


@router.get("/{game_id}")
def get_game(game_id: str):
    """Get details for a specific game by ID or slug, including PC installations."""
    with get_db() as conn:
        cursor = conn.cursor()

        if game_id.isdigit():
            cursor.execute("SELECT * FROM games WHERE id = %s;", (int(game_id),))
        else:
            cursor.execute("SELECT * FROM games WHERE slug = %s;", (game_id,))

        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        result = dict(game)
        result["name"] = result["title"]
        result["cover_image_url"] = result["cover_url"]

        # Attach nodes where this game is installed
        cursor.execute(
            """
            SELECT ng.id, ng.node_id, ng.status, ng.enabled, m.name as machine_name, m.gpu, m.status as machine_status
            FROM node_games ng
            JOIN machines m ON ng.node_id = m.id
            WHERE ng.game_id = %s;
            """,
            (result["id"],),
        )
        result["installations"] = [dict(row) for row in cursor.fetchall()]
        return result


@router.post("", status_code=status.HTTP_201_CREATED)
def add_game(
    req: GameCreateRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Add a new game to the central platform catalog."""
    now_iso = datetime.now(timezone.utc).isoformat()
    slug_val = req.slug.strip().lower() if req.slug else _slugify(req.title)

    with get_db() as conn:
        cursor = conn.cursor()

        # Check unique slug
        cursor.execute("SELECT id FROM games WHERE slug = %s;", (slug_val,))
        if cursor.fetchone():
            raise HTTPException(
                status_code=400,
                detail=f"A game with identifier '{slug_val}' already exists.",
            )

        cursor.execute(
            """
            INSERT INTO games (slug, title, genre, cover_url, description, size_gb, enabled, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id;
            """,
            (
                slug_val,
                req.title.strip(),
                req.genre.strip(),
                req.cover_url.strip() if req.cover_url else None,
                req.description.strip() if req.description else "",
                req.size_gb or 50.0,
                req.enabled if req.enabled is not None else True,
                now_iso,
                now_iso,
            ),
        )
        game_id = cursor.fetchone()["id"]
        conn.commit()

    return {
        "id": game_id,
        "slug": slug_val,
        "title": req.title,
        "name": req.title,
        "genre": req.genre,
        "cover_url": req.cover_url,
        "cover_image_url": req.cover_url,
        "description": req.description,
        "size_gb": req.size_gb,
        "enabled": req.enabled if req.enabled is not None else True,
        "created_at": now_iso,
        "updated_at": now_iso,
    }


@router.put("/{game_id}")
def update_game(
    game_id: int,
    req: GameUpdateRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Update an existing game in the catalog."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM games WHERE id = %s;", (game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        updates = ["updated_at = %s"]
        params = [now_iso]

        if req.title is not None:
            updates.append("title = %s")
            params.append(req.title.strip())
        if req.slug is not None:
            slug_clean = _slugify(req.slug)
            cursor.execute("SELECT id FROM games WHERE slug = %s AND id != %s;", (slug_clean, game_id))
            if cursor.fetchone():
                raise HTTPException(status_code=400, detail="Slug already in use by another game.")
            updates.append("slug = %s")
            params.append(slug_clean)
        if req.genre is not None:
            updates.append("genre = %s")
            params.append(req.genre.strip())
        if req.cover_url is not None:
            updates.append("cover_url = %s")
            params.append(req.cover_url.strip())
        if req.description is not None:
            updates.append("description = %s")
            params.append(req.description.strip())
        if req.size_gb is not None:
            updates.append("size_gb = %s")
            params.append(req.size_gb)
        if req.enabled is not None:
            updates.append("enabled = %s")
            params.append(req.enabled)

        params.append(game_id)
        cursor.execute(
            f"UPDATE games SET {', '.join(updates)} WHERE id = %s;",
            params,
        )
        conn.commit()

    return {"message": "Game updated successfully"}


@router.delete("/{game_id}")
def delete_game(
    game_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Remove a game from the platform catalog."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM games WHERE id = %s;", (game_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Game not found")
        conn.commit()

    return {"message": "Game deleted successfully from catalog"}
