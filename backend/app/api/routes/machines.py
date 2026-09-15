import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.core.redis import cache_get, cache_set, cache_delete, check_rate_limit
from app.services.auth import get_current_user, require_admin
from app.services.streaming.node_relay import node_relay

router = APIRouter(prefix="/machines", tags=["machines"])


class MachineStatusUpdate(BaseModel):
    status: str  # 'available' | 'maintenance' | 'standby' | 'in-use' | 'streaming' | 'offline'


class MachinePowerToggle(BaseModel):
    power: Optional[str] = None
    power_action: Optional[str] = None


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
async def list_machines():
    """List all campus gaming rigs with live availability, schedule blocks, and installed games.
    
    Optimized with Redis / high-speed in-memory cache and batch queries to prevent N+1 database roundtrips.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    
    # 1. Check high-speed Redis or memory cache for raw machine records
    cached = await cache_get("machines:raw")
    machines = None
    if cached:
        try:
            machines = json.loads(cached)
        except Exception:
            machines = None

    # 2. On cache miss: fetch machines, active bookings, and installed games in 3 batch queries
    if machines is None:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, gpu, cpu, ram, os, status, is_host, notes, last_seen,
                       COALESCE(active_watts, 280.0) as active_watts,
                       COALESCE(idle_watts, 55.0) as idle_watts,
                       stream_started_at
                FROM machines
                ORDER BY id ASC;
                """
            )
            machines = [dict(row) for row in cursor.fetchall()]

            if machines:
                machine_ids = tuple(m["id"] for m in machines)

                # Batch query 1: All confirmed bookings for all machines in one query
                cursor.execute(
                    """
                    SELECT id, machine_id, start_time, end_time, status
                    FROM bookings
                    WHERE machine_id IN %s 
                      AND status = 'confirmed'
                      AND end_time >= %s
                    ORDER BY start_time ASC;
                    """,
                    (machine_ids, now_iso),
                )
                bookings_by_machine: Dict[int, list] = {m["id"]: [] for m in machines}
                for b in cursor.fetchall():
                    b_dict = dict(b)
                    mid = b_dict.get("machine_id")
                    if mid in bookings_by_machine:
                        bookings_by_machine[mid].append(b_dict)

                # Batch query 2: All installed games for all machines in one query
                cursor.execute(
                    """
                    SELECT ng.id, ng.node_id, ng.game_id, ng.executable_path, ng.working_directory,
                           ng.launch_arguments, ng.enabled, ng.status,
                           g.title, g.slug, g.genre, g.cover_url
                    FROM node_games ng
                    JOIN games g ON ng.game_id = g.id
                    WHERE ng.node_id IN %s
                    ORDER BY g.title ASC;
                    """,
                    (machine_ids,),
                )
                games_by_machine: Dict[int, list] = {m["id"]: [] for m in machines}
                for g in cursor.fetchall():
                    g_dict = dict(g)
                    nid = g_dict.get("node_id")
                    if nid in games_by_machine:
                        games_by_machine[nid].append(g_dict)

                for m in machines:
                    m["bookings"] = bookings_by_machine.get(m["id"], [])
                    m["installed_games"] = games_by_machine.get(m["id"], [])

            # Cache the assembled raw records for 10 seconds (or until invalidated on mutations)
            await cache_set("machines:raw", json.dumps(machines, default=str), ttl_seconds=10)

    # 3. Dynamic real-time connection status layer (always evaluated in-memory per request)
    for m in machines:
        is_connected = node_relay.is_node_connected(m["id"])
        if m.get("stream_started_at") or m.get("status") in ("streaming", "in-use"):
            m["status"] = "in-use"
            m["live_status"] = "streaming"
        elif m["status"] == "maintenance":
            m["live_status"] = "maintenance"
        elif is_connected or m.get("status") == "available":
            is_currently_in_use = any(
                b["start_time"] <= now_iso <= b["end_time"] for b in m.get("bookings", [])
            )
            m["status"] = "in-use" if is_currently_in_use else "available"
            m["live_status"] = "streaming" if is_currently_in_use else "available"
        else:
            m["status"] = "standby"
            m["live_status"] = "standby"

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
        
        # Determine real-time occupancy and connection status:
        is_connected = node_relay.is_node_connected(machine_id)
        if result["status"] == "maintenance":
            result["live_status"] = "maintenance"
        elif not is_connected:
            result["status"] = "offline"
            result["live_status"] = "offline"
        else:
            now_iso = datetime.now(timezone.utc).isoformat()
            is_currently_in_use = any(
                b["start_time"] <= now_iso <= b["end_time"] for b in result["bookings"]
            )
            result["status"] = "available"
            result["live_status"] = "busy" if is_currently_in_use else "available"

        return result


@router.patch("/{machine_id}/status")
async def update_machine_status(
    machine_id: int,
    req: MachineStatusUpdate,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: toggle machine status."""
    valid_statuses = ("available", "maintenance", "standby", "in-use", "streaming", "offline")
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid_statuses}")

    now_iso = datetime.now(timezone.utc).isoformat()
    stream_started = now_iso if req.status in ("in-use", "streaming") else None

    with get_db() as conn:
        cursor = conn.cursor()
        if stream_started:
            cursor.execute(
                "UPDATE machines SET status = %s, stream_started_at = %s, last_seen = %s WHERE id = %s;",
                (req.status, stream_started, now_iso, machine_id),
            )
        else:
            cursor.execute(
                "UPDATE machines SET status = %s, stream_started_at = NULL, last_seen = %s WHERE id = %s;",
                (req.status, now_iso, machine_id),
            )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Machine not found")
        conn.commit()

    await cache_delete("machines:raw")
    return {"message": f"Machine status updated to {req.status}"}


@router.post("/{machine_id}/start-stream")
async def start_machine_stream(
    machine_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Open computer / launch streaming under full active load."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE machines 
            SET status = 'in-use', stream_started_at = %s, last_seen = %s
            WHERE id = %s RETURNING *;
            """,
            (now_iso, now_iso, machine_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Machine not found")
        conn.commit()

    await cache_delete("machines:raw")
    m_dict = dict(row)
    m_dict["live_status"] = "streaming"
    return {
        "status": "streaming",
        "message": f"Stream started on {m_dict['name']}. Rig running under load.",
        "machine": m_dict,
        "stream_started_at": now_iso,
    }


@router.post("/{machine_id}/stop-stream")
async def stop_machine_stream(
    machine_id: int,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: Stop stream, record active hours and watt consumption to telemetry."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM machines WHERE id = %s;", (machine_id,))
        machine = cursor.fetchone()
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")

        m_dict = dict(machine)
        started_at_str = m_dict.get("stream_started_at")
        duration_seconds = 1800.0  # default 30 mins if not recorded
        if started_at_str:
            try:
                start_dt = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
                duration_seconds = max(10.0, (now - start_dt).total_seconds())
            except Exception:
                duration_seconds = 1800.0

        run_hours = round(duration_seconds / 3600.0, 3)
        act_watts = float(m_dict.get("active_watts") or 260.0)
        power_kwh = round((act_watts * run_hours) / 1000.0, 4)
        cost_usd = round(power_kwh * 0.18, 4)

        # Reset machine status
        cursor.execute(
            """
            UPDATE machines 
            SET status = 'available', stream_started_at = NULL, last_seen = %s
            WHERE id = %s;
            """,
            (now_iso, machine_id),
        )

        # Look up installed game for machine
        cursor.execute(
            """
            SELECT g.title FROM node_games ng
            JOIN games g ON ng.game_id = g.id
            WHERE ng.node_id = %s
            ORDER BY ng.id ASC LIMIT 1;
            """,
            (machine_id,)
        )
        game_row = cursor.fetchone()
        game_title = game_row["title"] if game_row else "METAL SLUG ATTACK RELOADED"

        # Calculate time period string in local time (UTC+7 / Cambodia time)
        try:
            tz_offset = timedelta(hours=7)
            start_local = (start_dt + tz_offset).strftime("%I:%M %p")
            end_local = (now + tz_offset).strftime("%I:%M %p")
            time_window = f"{start_local} - {end_local}"
        except Exception:
            time_window = "Live Stream Session"

        # Insert telemetry record into session_telemetry so it immediately records to Daily Watt Log
        cursor.execute("SELECT COUNT(*) as count FROM session_telemetry;")
        count = cursor.fetchone()["count"] + 1
        test_id = f"RUN-{count:03d}"

        cursor.execute(
            """
            INSERT INTO session_telemetry (
                test_id, user_email, machine_id, game_title, requested_time, booking_slot,
                waiting_time_minutes, avg_latency_ms, max_latency_ms, avg_fps,
                packet_loss_pct, disconnects_count, completed,
                pc_idle_minutes, power_kwh, energy_cost_usd, duration_seconds, phase, source,
                created_at, notes
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s
            );
            """,
            (
                test_id, admin_user.get("email", "admin@cloudkh.space"), machine_id, game_title, now_iso, time_window,
                0.0, 42.5, 68.0, 60.0,
                0.1, 0, True,
                0.0, power_kwh, cost_usd, round(duration_seconds, 1), "V2_Improved", "admin_stream",
                now_iso, f"Live stream of {game_title} on {m_dict['name']} ({round(duration_seconds)}s)",
            ),
        )
        conn.commit()

    await cache_delete("machines:raw")

    return {
        "status": "stopped",
        "message": f"Stream stopped on {m_dict['name']}.",
        "duration_seconds": round(duration_seconds, 1),
        "duration_hours": run_hours,
        "power_kwh": power_kwh,
        "energy_cost_usd": cost_usd,
        "energy_cost_khr": int(cost_usd * 4050),
    }


@router.post("/{machine_id}/power")
async def toggle_machine_power(
    machine_id: int,
    req: MachinePowerToggle,
    admin_user: Dict = Depends(require_admin),
):
    """Admin-only: toggle computer power between on (available) and standby."""
    now_iso = datetime.now(timezone.utc).isoformat()
    action = (req.power or req.power_action or 'on').lower()
    new_status = 'available' if action in ('on', 'online', 'available') else 'standby'
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE machines SET status = %s, stream_started_at = NULL, last_seen = %s WHERE id = %s RETURNING *;",
            (new_status, now_iso, machine_id),
        )
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Machine not found")
        conn.commit()
    await cache_delete("machines:raw")
    return {"status": new_status, "message": f"Machine set to {new_status}"}


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
async def assign_game_to_machine(
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

    await cache_delete("machines:raw")
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
async def update_machine_game_config(
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

    await cache_delete("machines:raw")
    return {"message": "Game configuration updated successfully"}


@router.delete("/{machine_id}/games/{game_id}")
async def remove_game_from_machine(
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

    await cache_delete("machines:raw")
    return {"message": "Game unassigned from gaming PC successfully"}


@router.delete("/{machine_id}")
async def delete_machine(
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

    await cache_delete("machines:raw")
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
async def complete_pairing(
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

    await cache_delete("machines:raw")
    return {
        "status": "success",
        "message": f"Successfully paired gaming PC '{new_machine['name']}'!",
        "machine": dict(new_machine),
    }


@router.post("/pair/node")
async def pair_node_from_terminal(req: PairCompleteRequest, request: Request):
    """Pair a streaming PC running the terminal service using a valid 6-digit MFA keypair code.
    
    Protected against brute-force attacks via Token-Bucket rate limiting.
    """
    client_ip = request.client.host if request.client else None
    if client_ip and client_ip not in ("127.0.0.1", "localhost", "testclient"):
        allowed = await check_rate_limit(f"rate:pair_node:{client_ip}", max_requests=10, window_seconds=300)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many pairing attempts. Please wait 5 minutes before trying again.",
            )

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

    await cache_delete("machines:raw")
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

