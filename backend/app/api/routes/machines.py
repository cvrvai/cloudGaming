"""Gaming Rig Machines Fleet & Node Games Management Endpoints (FR-02, User Story 3)."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.auth import get_current_user, require_admin

router = APIRouter(prefix="/machines", tags=["machines"])


class MachineStatusUpdate(BaseModel):
    status: str  # 'available' | 'maintenance'


class NodeGameConfigCreate(BaseModel):
    game_id: int
    executable_path: str = Field(..., min_length=2, description="Absolute path to game executable")
    working_directory: Optional[str] = ""
    launch_arguments: Optional[str] = ""
    status: Optional[str] = "ready"  # 'ready', 'disabled', 'maintenance', 'broken'
    enabled: Optional[bool] = True


class NodeGameConfigUpdate(BaseModel):
    executable_path: Optional[str] = None
    working_directory: Optional[str] = None
    launch_arguments: Optional[str] = None
    status: Optional[str] = None
    enabled: Optional[bool] = None


@router.get("")
def list_machines():
    """List all campus gaming rigs with live availability, schedule blocks, and installed games."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, name, gpu, cpu, ram, status, is_host, notes
            FROM machines
            ORDER BY id ASC;
            """
        )
        machines = [dict(row) for row in cursor.fetchall()]

        now_iso = datetime.now(timezone.utc).isoformat()
        for m in machines:
            # 1. Attach confirmed bookings
            cursor.execute(
                """
                SELECT id, start_time, end_time, status
                FROM bookings
                WHERE machine_id = %s 
                  AND status = 'confirmed'
                  AND end_time >= %s
                ORDER BY start_time ASC;
                """,
                (m["id"], now_iso),
            )
            m["bookings"] = [dict(b) for b in cursor.fetchall()]

            # 2. Attach installed games on this node
            cursor.execute(
                """
                SELECT ng.id, ng.game_id, ng.executable_path, ng.working_directory,
                       ng.launch_arguments, ng.enabled, ng.status,
                       g.title, g.slug, g.genre, g.cover_url
                FROM node_games ng
                JOIN games g ON ng.game_id = g.id
                WHERE ng.node_id = %s
                ORDER BY g.title ASC;
                """,
                (m["id"],),
            )
            m["installed_games"] = [dict(g) for g in cursor.fetchall()]

            # Determine real-time occupancy status:
            if m["status"] != "maintenance":
                is_currently_in_use = any(
                    b["start_time"] <= now_iso <= b["end_time"] for b in m["bookings"]
                )
                m["live_status"] = "busy" if is_currently_in_use else "available"
            else:
                m["live_status"] = "maintenance"

        return machines


@router.get("/{machine_id}")
def get_machine(machine_id: int):
    """Get detailed specs, schedule, and configured games for a specific gaming PC."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM machines WHERE id = %s;", (machine_id,))
        machine = cursor.fetchone()
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        result = dict(machine)
        cursor.execute(
            """
            SELECT id, start_time, end_time, status 
            FROM bookings 
            WHERE machine_id = %s AND status = 'confirmed'
            ORDER BY start_time ASC;
            """,
            (machine_id,),
        )
        result["bookings"] = [dict(b) for b in cursor.fetchall()]

        cursor.execute(
            """
            SELECT ng.id, ng.game_id, ng.executable_path, ng.working_directory,
                   ng.launch_arguments, ng.enabled, ng.status,
                   g.title, g.slug, g.genre, g.cover_url
            FROM node_games ng
            JOIN games g ON ng.game_id = g.id
            WHERE ng.node_id = %s
            ORDER BY g.title ASC;
            """,
            (machine_id,),
        )
        result["installed_games"] = [dict(g) for g in cursor.fetchall()]
        return result


@router.patch("/{machine_id}/status")
def update_machine_status(
    machine_id: int,
    req: MachineStatusUpdate,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: toggle machine between available and maintenance."""
    if req.status not in ("available", "maintenance"):
        raise HTTPException(status_code=400, detail="Status must be 'available' or 'maintenance'")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE machines SET status = %s WHERE id = %s;", (req.status, machine_id))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Machine not found")
        conn.commit()

    return {"message": f"Machine status updated to {req.status}"}


# =========================================================================
# NODE GAMES: Manual per-PC game configuration (Admin only)
# =========================================================================


@router.get("/{machine_id}/games")
def get_machine_games(machine_id: int):
    """List all games installed and configured on a specific gaming rig."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM machines WHERE id = %s;", (machine_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Machine not found")

        cursor.execute(
            """
            SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path, ng.working_directory,
                   ng.launch_arguments, ng.enabled, ng.status, ng.created_at, ng.updated_at,
                   g.title, g.slug, g.genre, g.cover_url, g.size_gb
            FROM node_games ng
            JOIN games g ON ng.game_id = g.id
            WHERE ng.node_id = %s
            ORDER BY g.title ASC;
            """,
            (machine_id,),
        )
        return [dict(row) for row in cursor.fetchall()]


@router.post("/{machine_id}/games", status_code=status.HTTP_201_CREATED)
def assign_game_to_machine(
    machine_id: int,
    req: NodeGameConfigCreate,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Manually configure an installed game on a specific gaming PC."""
    valid_statuses = {"ready", "disabled", "maintenance", "broken"}
    game_status = (req.status or "ready").lower().strip()
    if game_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{game_status}'. Allowed: {sorted(valid_statuses)}",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()

        # Check machine exists
        cursor.execute("SELECT id, name FROM machines WHERE id = %s;", (machine_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Machine not found")

        # Check game exists in catalog
        cursor.execute("SELECT id, title FROM games WHERE id = %s;", (req.game_id,))
        game = cursor.fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found in catalog")

        cursor.execute(
            """
            INSERT INTO node_games (node_id, game_id, executable_path, working_directory, launch_arguments, enabled, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (node_id, game_id) DO UPDATE SET
                executable_path = EXCLUDED.executable_path,
                working_directory = EXCLUDED.working_directory,
                launch_arguments = EXCLUDED.launch_arguments,
                enabled = EXCLUDED.enabled,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            RETURNING id;
            """,
            (
                machine_id,
                req.game_id,
                req.executable_path.strip(),
                req.working_directory.strip() if req.working_directory else "",
                req.launch_arguments.strip() if req.launch_arguments else "",
                req.enabled if req.enabled is not None else True,
                game_status,
                now_iso,
                now_iso,
            ),
        )
        ng_id = cursor.fetchone()["id"]
        conn.commit()

    return {
        "id": ng_id,
        "node_id": machine_id,
        "game_id": req.game_id,
        "game_title": game["title"],
        "executable_path": req.executable_path.strip(),
        "working_directory": req.working_directory.strip() if req.working_directory else "",
        "launch_arguments": req.launch_arguments.strip() if req.launch_arguments else "",
        "status": game_status,
        "enabled": req.enabled if req.enabled is not None else True,
        "message": f"Game '{game['title']}' configured on PC successfully",
    }


@router.put("/{machine_id}/games/{game_id}")
def update_machine_game_config(
    machine_id: int,
    game_id: int,
    req: NodeGameConfigUpdate,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Update manual game configuration on a specific gaming PC."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT id FROM node_games WHERE node_id = %s AND game_id = %s;",
            (machine_id, game_id),
        )
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Game is not configured on this machine")

        updates = ["updated_at = %s"]
        params = [now_iso]

        if req.executable_path is not None:
            updates.append("executable_path = %s")
            params.append(req.executable_path.strip())
        if req.working_directory is not None:
            updates.append("working_directory = %s")
            params.append(req.working_directory.strip())
        if req.launch_arguments is not None:
            updates.append("launch_arguments = %s")
            params.append(req.launch_arguments.strip())
        if req.status is not None:
            status_clean = req.status.lower().strip()
            if status_clean not in {"ready", "disabled", "maintenance", "broken"}:
                raise HTTPException(status_code=400, detail="Invalid status")
            updates.append("status = %s")
            params.append(status_clean)
        if req.enabled is not None:
            updates.append("enabled = %s")
            params.append(req.enabled)

        params.extend([machine_id, game_id])
        cursor.execute(
            f"UPDATE node_games SET {', '.join(updates)} WHERE node_id = %s AND game_id = %s;",
            params,
        )
        conn.commit()

    return {"message": "Game configuration updated successfully"}


@router.delete("/{machine_id}/games/{game_id}")
def remove_game_from_machine(
    machine_id: int,
    game_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Remove game installation configuration from a specific PC."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM node_games WHERE node_id = %s AND game_id = %s;",
            (machine_id, game_id),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Game assignment not found on this machine")
        conn.commit()

    return {"message": "Game unassigned from gaming PC successfully"}


@router.delete("/{machine_id}")
def delete_machine(
    machine_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Delete a gaming machine node (primary host workstation cannot be deleted)."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, is_host FROM machines WHERE id = %s;", (machine_id,))
        m = cursor.fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Machine not found")
        if m["is_host"] == 1:
            raise HTTPException(status_code=400, detail="Cannot delete the primary host gaming workstation")
        cursor.execute("DELETE FROM machines WHERE id = %s;", (machine_id,))
        conn.commit()

    return {"message": f"Machine '{m['name']}' deleted successfully"}

