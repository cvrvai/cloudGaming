"""Operations Research - Lean Six Sigma DMAIC CTQ Analytics & Telemetry Engine."""
import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app.db import get_db
from app.services.auth import require_admin

router = APIRouter(prefix="/admin/dmaic", tags=["dmaic-analytics"])


class LogTestRecordRequest(BaseModel):
    test_id: Optional[str] = None
    account: str = Field(..., description="Student/User email or test account")
    requested_time: Optional[str] = None
    booking_slot: Optional[str] = None
    waiting_time_minutes: float = Field(0.0, description="Waiting time until slot in minutes")
    avg_latency_ms: float = Field(0.0, description="Average WebRTC round-trip latency in ms")
    max_latency_ms: float = Field(0.0, description="Peak latency in ms")
    avg_fps: float = Field(60.0, description="Average stream frames per second")
    packet_loss_pct: float = Field(0.0, description="Packet loss percentage")
    disconnects_count: int = Field(0, description="Number of disconnections experienced")
    completed: bool = Field(True, description="Whether full 1-hour session completed successfully")
    failure_reason: Optional[str] = Field(None, description="Game crash, Stream disconnect, Network, Launch failure, etc.")
    pc_idle_minutes: float = Field(0.0, description="Host PC idle minutes before session")
    power_kwh: Optional[float] = Field(None, description="Estimated electricity in kWh")
    energy_cost_usd: Optional[float] = Field(None, description="Estimated electricity cost")
    phase: Optional[str] = Field("V1_Baseline", description="V1_Baseline or V2_Improved")
    notes: Optional[str] = None


@router.get("/metrics")
def get_dmaic_ctq_metrics(admin_user: Dict = Depends(require_admin)):
    """Calculate real-time Lean Six Sigma DMAIC Critical to Quality (CTQ) metrics.
    
    1. Choonvai: CTQ 1 - Cloud Gaming Latency & Stream Quality (target <= 100ms)
    2. Sean Pheavyraksonya: CTQ 2 - PC Utilization & Energy Waste
    3. Lim Hokann: CTQ 3 - Booking Waiting Time & Rig Capacity
    4. Hour: CTQ 4 - Successful Session Completion Rate (target >= 95%)
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    with get_db() as conn:
        cursor = conn.cursor()

        # Telemetry aggregation
        cursor.execute("""
            SELECT COUNT(*) as total_records,
                   COALESCE(AVG(avg_latency_ms), 0.0) as mean_latency,
                   COALESCE(MAX(max_latency_ms), 0.0) as peak_latency,
                   COALESCE(AVG(avg_fps), 60.0) as mean_fps,
                   COALESCE(AVG(packet_loss_pct), 0.0) as mean_packet_loss,
                   COALESCE(SUM(disconnects_count), 0) as total_disconnects,
                   COUNT(CASE WHEN completed = TRUE THEN 1 END) as completed_sessions,
                   COUNT(CASE WHEN completed = FALSE THEN 1 END) as failed_sessions,
                   COUNT(CASE WHEN avg_latency_ms > 100.0 THEN 1 END) as latency_defects,
                   COALESCE(AVG(waiting_time_minutes), 0.0) as mean_waiting_time,
                   COALESCE(SUM(power_kwh), 0.0) as total_kwh,
                   COALESCE(SUM(energy_cost_usd), 0.0) as total_energy_cost
            FROM session_telemetry;
        """)
        t_stats = dict(cursor.fetchone())

        # Failure categorization breakdown for CTQ 4
        cursor.execute("""
            SELECT COALESCE(failure_reason, 'Unspecified') as reason, COUNT(*) as count
            FROM session_telemetry
            WHERE completed = FALSE
            GROUP BY failure_reason
            ORDER BY count DESC;
        """)
        failure_breakdown = [dict(r) for r in cursor.fetchall()]

        # Bookings aggregation for CTQ 2 & 3
        cursor.execute("""
            SELECT COUNT(*) as total_bookings,
                   COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_bookings,
                   COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings
            FROM bookings;
        """)
        b_stats = dict(cursor.fetchone())

    total_sessions = t_stats["total_records"]
    completed = t_stats["completed_sessions"]
    failed = t_stats["failed_sessions"]

    # CTQ 4: Completion Rate
    completion_rate = (completed / total_sessions * 100.0) if total_sessions > 0 else 100.0

    # CTQ 1: Latency defect rate (Six Sigma DPMO calculation)
    latency_defects = t_stats["latency_defects"]
    latency_defect_rate = (latency_defects / total_sessions * 100.0) if total_sessions > 0 else 0.0

    # CTQ 2: PC Utilization & Energy Estimation
    # RTX 3050 rig: ~280W under active load, ~45W when idle
    # Baseline: 16 hours operating day per single machine
    gaming_hours = round(completed * 1.0, 1) # 1 hour per session
    powered_hours = max(16.0, gaming_hours)
    idle_hours = max(0.0, powered_hours - gaming_hours)
    utilization_pct = round((gaming_hours / powered_hours) * 100.0, 1) if powered_hours > 0 else 0.0

    # Energy calculations
    kwh_gaming = (280.0 * gaming_hours) / 1000.0
    kwh_idle = (45.0 * idle_hours) / 1000.0
    total_est_kwh = round(kwh_gaming + kwh_idle, 2)
    est_cost_usd = round(total_est_kwh * 0.18, 2) # ~$0.18 per kWh average

    return {
        "ctq1_latency": {
            "owner": "Choonvai",
            "target": "<= 100 ms",
            "mean_latency_ms": round(t_stats["mean_latency"], 1),
            "peak_latency_ms": round(t_stats["peak_latency"], 1),
            "mean_fps": round(t_stats["mean_fps"], 1),
            "packet_loss_pct": round(t_stats["mean_packet_loss"], 2),
            "defect_count": latency_defects,
            "defect_rate_pct": round(latency_defect_rate, 1),
            "pass_status": t_stats["mean_latency"] <= 100.0 or total_sessions == 0,
        },
        "ctq2_utilization": {
            "owner": "Sean Pheavyraksonya",
            "target": "Maximize Rig Efficiency & Minimize Idle Waste",
            "pc_powered_hours": powered_hours,
            "gaming_hours": gaming_hours,
            "idle_hours": idle_hours,
            "utilization_pct": utilization_pct,
            "total_kwh": total_est_kwh,
            "est_cost_usd": est_cost_usd,
            "cost_per_session_usd": round(est_cost_usd / max(1, completed), 2),
        },
        "ctq3_waiting_time": {
            "owner": "Lim Hokann",
            "target": "Minimize Queue Wait (< 60 mins)",
            "mean_waiting_time_mins": round(t_stats["mean_waiting_time"], 1),
            "total_booked_slots": b_stats["confirmed_bookings"],
            "cancelled_bookings": b_stats["cancelled_bookings"],
            "available_slots_per_day": max(0, 16 - b_stats["confirmed_bookings"]),
            "capacity_bottleneck": b_stats["confirmed_bookings"] >= 12,
        },
        "ctq4_completion_rate": {
            "owner": "Hour",
            "target": ">= 95% Completion Rate",
            "total_sessions": total_sessions,
            "completed_sessions": completed,
            "failed_sessions": failed,
            "completion_rate_pct": round(completion_rate, 1),
            "total_disconnects": t_stats["total_disconnects"],
            "pass_status": completion_rate >= 95.0,
            "failure_breakdown": failure_breakdown,
        },
        "dmaic_meta": {
            "project_name": "CloudKH Single-PC Cloud Gaming MVP",
            "organization": "CloudKH",
            "methodology": "Lean Six Sigma DMAIC",
            "hardware": "1x NVIDIA RTX 3050 Gaming Rig (1 User at a time)",
            "phase": "Define / Measure (Baseline V1)",
            "server_time": now_iso,
        },
    }


@router.get("/records")
def list_dmaic_records(
    phase: Optional[str] = Query(None, description="Filter by phase: V1_Baseline, V2_Improved, or all"),
    admin_user: Dict = Depends(require_admin),
):
    """List all experimental test observations."""
    phase_str = str(phase) if isinstance(phase, str) and phase != "all" else None
    with get_db() as conn:
        cursor = conn.cursor()
        if phase_str:
            cursor.execute(
                "SELECT * FROM session_telemetry WHERE phase = %s ORDER BY id DESC;",
                (phase_str,),
            )
        else:
            cursor.execute("SELECT * FROM session_telemetry ORDER BY id DESC;")
        rows = [dict(r) for r in cursor.fetchall()]
        for r in rows:
            r["account_name"] = r.get("user_email") or "Unknown"
            r["waiting_time_mins"] = r.get("waiting_time_minutes") or 0.0
            r["latency_ms"] = r.get("avg_latency_ms") or 0.0
            r["fps"] = r.get("avg_fps") or 60.0
            r["pc_idle_time_mins"] = r.get("pc_idle_minutes") or 0.0
            r["power_usage_watts"] = round((r.get("power_kwh") or 0.28) * 1000, 0)
    return rows


@router.post("/records", status_code=status.HTTP_201_CREATED)
def log_dmaic_test_run(
    req: LogTestRecordRequest,
    admin_user: Dict = Depends(require_admin),
):
    """Log an experimental observation run into the DMAIC dataset."""
    now_iso = datetime.now(timezone.utc).isoformat()

    # Calculate power & cost if not provided (280W gaming load)
    power_kwh = req.power_kwh
    if power_kwh is None:
        power_kwh = round((280.0 * 1.0) / 1000.0, 3) # 0.28 kWh per 1h session
    cost_usd = req.energy_cost_usd
    if cost_usd is None:
        cost_usd = round(power_kwh * 0.18, 3)

    with get_db() as conn:
        cursor = conn.cursor()

        # Generate test ID if not provided: TEST-001, TEST-002...
        test_id = req.test_id
        if not test_id:
            cursor.execute("SELECT COUNT(*) as count FROM session_telemetry;")
            c = cursor.fetchone()["count"] + 1
            test_id = f"TEST-{c:03d}"

        # Match user_id if account matches registered email
        cursor.execute("SELECT id FROM users WHERE email = %s;", (req.account.strip().lower(),))
        u_match = cursor.fetchone()
        user_id = u_match["id"] if u_match else None

        cursor.execute(
            """
            INSERT INTO session_telemetry (
                test_id, user_id, user_email, requested_time, booking_slot,
                waiting_time_minutes, avg_latency_ms, max_latency_ms, avg_fps,
                packet_loss_pct, disconnects_count, completed, failure_reason,
                pc_idle_minutes, power_kwh, energy_cost_usd, phase, notes, created_at
            ) VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s
            ) RETURNING *;
            """,
            (
                test_id, user_id, req.account.strip(), req.requested_time or now_iso, req.booking_slot or "1-Hour Slot",
                req.waiting_time_minutes, req.avg_latency_ms, req.max_latency_ms, req.avg_fps,
                req.packet_loss_pct, req.disconnects_count, req.completed, req.failure_reason,
                req.pc_idle_minutes, power_kwh, cost_usd, req.phase or "V1_Baseline", req.notes, now_iso,
            ),
        )
        record = dict(cursor.fetchone())
        conn.commit()

    return record


@router.get("/export")
def export_dmaic_dataset_csv(
    phase: Optional[str] = Query(None),
    admin_user: Dict = Depends(require_admin),
):
    """Download the research dataset as a CSV file matching the team's presentation requirements."""
    phase_str = str(phase) if isinstance(phase, str) and phase != "all" else None
    with get_db() as conn:
        cursor = conn.cursor()
        if phase_str:
            cursor.execute(
                "SELECT * FROM session_telemetry WHERE phase = %s ORDER BY id ASC;",
                (phase_str,),
            )
        else:
            cursor.execute("SELECT * FROM session_telemetry ORDER BY id ASC;")
        records = [dict(r) for r in cursor.fetchall()]

    output = io.StringIO()
    writer = csv.writer(output)

    # Standard Lean Six Sigma column headers matching team's specification
    writer.writerow([
        "Test ID",
        "Account",
        "Requested Time",
        "Booking Slot",
        "Waiting Time (min)",
        "Latency (ms)",
        "Max Latency (ms)",
        "FPS",
        "Packet Loss (%)",
        "Disconnects",
        "Completed?",
        "Failure Reason",
        "PC Idle Time (min)",
        "Power Usage (kWh)",
        "Energy Cost ($)",
        "Phase",
        "Notes",
        "Logged At",
    ])

    for r in records:
        writer.writerow([
            r.get("test_id", ""),
            r.get("user_email", ""),
            r.get("requested_time", ""),
            r.get("booking_slot", ""),
            r.get("waiting_time_minutes", 0),
            r.get("avg_latency_ms", 0),
            r.get("max_latency_ms", 0),
            r.get("avg_fps", 60),
            r.get("packet_loss_pct", 0),
            r.get("disconnects_count", 0),
            "YES" if r.get("completed") else "NO",
            r.get("failure_reason") or "None",
            r.get("pc_idle_minutes", 0),
            r.get("power_kwh", 0),
            r.get("energy_cost_usd", 0),
            r.get("phase", "V1_Baseline"),
            r.get("notes") or "",
            r.get("created_at", ""),
        ])

    csv_data = output.getvalue()
    filename = f"CloudKH_Lean_Six_Sigma_DMAIC_Dataset_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
