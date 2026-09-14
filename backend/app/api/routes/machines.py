import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.auth import get_current_user, require_admin

router = APIRouter(prefix="/machines", tags=["machines"])


class MachineStatusUpdate(BaseModel):
    status: str  # 'available' | 'maintenance'


class PairGenerateRequest(BaseModel):
    target_name: Optional[str] = None


class PairCompleteRequest(BaseModel):
    code: str
    name: Optional[str] = None
    gpu: Optional[str] = None
    cpu: Optional[str] = None
    ram: Optional[str] = None
    os: Optional[str] = None
    notes: Optional[str] = None


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
            SELECT id, name, gpu, cpu, ram, os, status, is_host, notes
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


@router.post("/{machine_id}/heartbeat")
def machine_heartbeat(machine_id: int):
    """Heartbeat endpoint pinged periodically by the terminal streaming service on each PC."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE machines
            SET last_seen = %s
            WHERE id = %s
            RETURNING id, name, status;
            """,
            (now_iso, machine_id),
        )
        m = cursor.fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Machine not found")
        conn.commit()

    return {"status": "ok", "machine_id": machine_id, "timestamp": now_iso}


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
    """Admin-only: Delete a gaming machine node."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM machines WHERE id = %s;", (machine_id,))
        m = cursor.fetchone()
        if not m:
            raise HTTPException(status_code=404, detail="Machine not found")
        cursor.execute("DELETE FROM machines WHERE id = %s;", (machine_id,))
        conn.commit()

    return {"message": f"Machine '{m['name']}' deleted successfully"}


# =========================================================================
# KEYPAIR PAIRING & NODE DISCOVERY (Admin 2-Step Google Authenticator MFA)
# =========================================================================


@router.post("/hardware/detect")
def detect_hardware(admin_user: Dict = Depends(require_admin)):
    """Admin-only: Detect real hardware specifications of the caller machine."""
    from app.utils.hardware import detect_host_hardware
    return detect_host_hardware()


@router.post("/pair/generate")
def generate_pair_code(
    req: PairGenerateRequest = PairGenerateRequest(),
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Generate a secure 6-digit keypair code for pairing a new streaming PC."""
    code = f"{secrets.randbelow(900) + 100}-{secrets.randbelow(900) + 100}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=10)

    now_iso = now.isoformat()
    expires_iso = expires_at.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO machine_pairings (code, admin_user_id, target_name, status, created_at, expires_at)
            VALUES (%s, %s, %s, 'pending', %s, %s)
            RETURNING id, code, expires_at;
            """,
            (code, admin_user["id"], req.target_name or "New Gaming Rig", now_iso, expires_iso),
        )
        row = cursor.fetchone()
        conn.commit()

    return {
        "id": row["id"],
        "code": row["code"],
        "expires_at": row["expires_at"],
        "expires_in_seconds": 600,
        "message": "Keypair pairing code generated successfully. Enter this code on the streaming PC.",
    }


@router.post("/pair/complete")
def complete_pairing(
    req: PairCompleteRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Validate keypair code, register new gaming PC node, and activate connection."""
    clean_code = req.code.strip().replace(" ", "").upper()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM machine_pairings 
            WHERE (code = %s OR REPLACE(code, '-', '') = REPLACE(%s, '-', ''))
              AND status = 'pending';
            """,
            (clean_code, clean_code),
        )
        pairing = cursor.fetchone()
        if not pairing:
            raise HTTPException(status_code=400, detail="Invalid or expired pairing code. Please generate a new code.")

        if datetime.fromisoformat(pairing["expires_at"]) < now:
            cursor.execute("UPDATE machine_pairings SET status = 'expired' WHERE id = %s;", (pairing["id"],))
            conn.commit()
            raise HTTPException(status_code=400, detail="Pairing code has expired. Please generate a new code.")

        final_name = req.name or pairing["target_name"] or "Gaming Rig Node"
        final_gpu = req.gpu or "Dedicated Gaming GPU"
        final_cpu = req.cpu or "High-Performance CPU"
        final_ram = req.ram or "16GB RAM"
        final_os = req.os or "Windows"
        final_notes = req.notes or f"Paired via Admin MFA Keypair on {now.strftime('%Y-%m-%d %H:%M UTC')}"

        cursor.execute(
            """
            INSERT INTO machines (name, gpu, cpu, ram, os, status, is_host, notes)
            VALUES (%s, %s, %s, %s, %s, 'available', 0, %s)
            RETURNING id, name, gpu, cpu, ram, os, status, is_host, notes;
            """,
            (final_name, final_gpu, final_cpu, final_ram, final_os, final_notes),
        )
        new_machine = cursor.fetchone()

        cursor.execute(
            """
            UPDATE machine_pairings 
            SET status = 'paired', machine_id = %s, hardware_specs = %s, paired_at = %s
            WHERE id = %s;
            """,
            (new_machine["id"], json.dumps({"gpu": final_gpu, "cpu": final_cpu, "ram": final_ram, "os": final_os}), now_iso, pairing["id"]),
        )
        conn.commit()

    return {
        "status": "success",
        "message": f"Successfully paired gaming PC '{new_machine['name']}'!",
        "machine": dict(new_machine),
    }


@router.post("/pair/node")
def pair_node_from_terminal(req: PairCompleteRequest):
    """Pair a streaming PC running the terminal service using a valid 6-digit MFA keypair code."""
    clean_code = req.code.strip().replace(" ", "").upper()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT * FROM machine_pairings 
            WHERE (code = %s OR REPLACE(code, '-', '') = REPLACE(%s, '-', ''))
              AND status = 'pending';
            """,
            (clean_code, clean_code),
        )
        pairing = cursor.fetchone()
        if not pairing:
            raise HTTPException(status_code=400, detail="Invalid or expired pairing code. Please generate a code in the admin dashboard.")

        if datetime.fromisoformat(pairing["expires_at"]) < now:
            cursor.execute("UPDATE machine_pairings SET status = 'expired' WHERE id = %s;", (pairing["id"],))
            conn.commit()
            raise HTTPException(status_code=400, detail="Pairing code has expired. Please generate a code in the admin dashboard.")

        final_name = req.name or pairing["target_name"] or "Gaming Rig Node"
        final_gpu = req.gpu or "Dedicated Gaming GPU"
        final_cpu = req.cpu or "High-Performance CPU"
        final_ram = req.ram or "16GB RAM"
        final_os = req.os or "Windows"
        final_notes = req.notes or f"Paired via Streaming PC Terminal on {now.strftime('%Y-%m-%d %H:%M UTC')}"

        cursor.execute(
            """
            INSERT INTO machines (name, gpu, cpu, ram, os, status, is_host, notes)
            VALUES (%s, %s, %s, %s, %s, 'available', 0, %s)
            RETURNING id, name, gpu, cpu, ram, os, status, is_host, notes;
            """,
            (final_name, final_gpu, final_cpu, final_ram, final_os, final_notes),
        )
        new_machine = cursor.fetchone()

        cursor.execute(
            """
            UPDATE machine_pairings 
            SET status = 'paired', machine_id = %s, hardware_specs = %s, paired_at = %s
            WHERE id = %s;
            """,
            (new_machine["id"], json.dumps({"gpu": final_gpu, "cpu": final_cpu, "ram": final_ram, "os": final_os}), now_iso, pairing["id"]),
        )
        conn.commit()

    return {
        "status": "success",
        "message": f"Successfully paired gaming PC '{new_machine['name']}'!",
        "machine": dict(new_machine),
        "node_id": new_machine["id"],
    }


@router.get("/pair/status/{code}")
def check_pairing_status(
    code: str,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Check live status of a pairing session."""
    clean_code = code.strip().replace(" ", "").upper()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT p.id, p.code, p.status, p.created_at, p.expires_at, p.paired_at,
                   m.id as machine_id, m.name as machine_name, m.status as machine_status
            FROM machine_pairings p
            LEFT JOIN machines m ON p.machine_id = m.id
            WHERE (p.code = %s OR REPLACE(p.code, '-', '') = REPLACE(%s, '-', ''))
            ORDER BY p.id DESC LIMIT 1;
            """,
            (clean_code, clean_code),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pairing session not found")

        return dict(row)

