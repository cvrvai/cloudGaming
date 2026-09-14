"""Gaming Rig Machines Fleet endpoints (FR-02, User Story 3)."""
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.db import get_db
from app.services.auth import get_current_user, require_admin

router = APIRouter(prefix="/machines", tags=["machines"])


class MachineStatusUpdate(BaseModel):
    status: str  # 'available' | 'maintenance'


@router.get("")
def list_machines():
    """List all campus gaming rigs with live availability and schedule blocks (FR-02)."""
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

        # Attach confirmed bookings for today/future to each machine for timeline view
        now_iso = datetime.now(timezone.utc).isoformat()
        for m in machines:
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

            # Determine real-time occupancy status:
            # If current time falls inside any confirmed booking, mark machine as 'busy'
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
    """Get detailed specs and schedule for a specific gaming PC."""
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
