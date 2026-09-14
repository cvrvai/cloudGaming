"""Unit & integration test for CloudKH platform features.

Tests FR-01 through FR-05, NFR-01, NFR-02, and MVP Game Management (Manual Admin Configuration & Security).
"""
from datetime import datetime, timedelta, timezone
import sys

from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db, init_db

client = TestClient(app)


def test_full_platform_flow():
    print("Initializing DB...")
    init_db()
    with get_db() as conn:
        conn.cursor().execute("DELETE FROM bookings;")
        conn.commit()

    # 1. Test Login with seeded Admin
    res = client.post("/api/auth/login", json={"email": "admin@kit.edu.kh", "password": "cloudkh2026"})
    assert res.status_code == 200, f"Admin login failed: {res.text}"
    admin_token = res.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    print("[OK] Admin login successful")

    # 2. Test User Registration (FR-01)
    test_email = f"gamer_{int(datetime.now().timestamp())}@kit.edu.kh"
    res = client.post(
        "/api/auth/register",
        json={"name": "Sokha KIT", "email": test_email, "password": "securepass123"},
    )
    assert res.status_code == 200, f"Registration failed: {res.text}"
    student_token = res.json()["access_token"]
    student_headers = {"Authorization": f"Bearer {student_token}"}
    student_id = res.json()["user"]["id"]
    print("[OK] Student registration successful")

    # Duplicate registration check
    res = client.post(
        "/api/auth/register",
        json={"name": "Sokha KIT", "email": test_email, "password": "securepass123"},
    )
    assert res.status_code == 400, "Should reject duplicate email"
    print("[OK] Duplicate email rejection verified")

    # 3. Test Machine Fleet (FR-02)
    res = client.get("/api/machines")
    assert res.status_code == 200
    machines = res.json()
    assert len(machines) >= 3
    print(f"[OK] Found {len(machines)} gaming machines in fleet")
    rig1 = machines[0]
    rig2 = machines[1]

    # 4. Test Game Catalog & Node Configuration (MVP Manual Admin Config)
    res = client.get("/api/games")
    assert res.status_code == 200
    games = res.json()
    assert len(games) >= 3
    print(f"[OK] Game catalog loaded ({len(games)} games)")

    fh4_game = next((g for g in games if g["slug"] == "forza-horizon-4"), games[0])
    val_game = next((g for g in games if g["slug"] == "valorant"), None)

    # Check node games for Host PC
    res = client.get(f"/api/machines/{rig1['id']}/games")
    assert res.status_code == 200
    host_games = res.json()
    assert len(host_games) >= 1
    print(f"[OK] Verified PC-001 has {len(host_games)} admin-configured games")

    # Normal user CANNOT configure games on nodes (Security check)
    res = client.post(
        f"/api/machines/{rig1['id']}/games",
        json={
            "game_id": fh4_game["id"],
            "executable_path": "C:\\malicious\\path.exe",
        },
        headers=student_headers,
    )
    assert res.status_code == 403, "Normal user must not configure node games"
    print("[OK] Security: Normal user blocked from configuring node executables")

    # Admin CAN configure games on nodes
    res = client.post(
        f"/api/machines/{rig1['id']}/games",
        json={
            "game_id": fh4_game["id"],
            "executable_path": r"C:\Games\Forza Horizon 4\ForzaHorizon4.exe",
            "working_directory": r"C:\Games\Forza Horizon 4",
            "launch_arguments": "",
            "status": "ready",
            "enabled": True,
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, f"Admin failed to configure game on PC: {res.text}"
    print("[OK] Admin successfully configured Forza Horizon 4 on PC-001")

    # 5. Test Game-Aware Reservation Creation (FR-03, FR-04)
    now = datetime.now(timezone.utc)
    slot1_start = (now + timedelta(hours=1)).isoformat()
    slot1_end = (now + timedelta(hours=2)).isoformat()

    # User books Forza Horizon 4 -> System must allocate PC-001
    res = client.post(
        "/api/bookings",
        json={
            "game_id": fh4_game["id"],
            "start_time": slot1_start,
            "end_time": slot1_end,
        },
        headers=student_headers,
    )
    assert res.status_code == 201, f"Booking creation failed: {res.text}"
    booking1 = res.json()
    assert booking1["machine_id"] == rig1["id"], "Forza Horizon 4 must allocate PC-001"
    print("[OK] Game-aware reservation auto-allocated PC-001 for Forza Horizon 4")

    # Conflict elimination on same machine
    conflict_start = (now + timedelta(hours=1, minutes=30)).isoformat()
    conflict_end = (now + timedelta(hours=2, minutes=30)).isoformat()
    res = client.post(
        "/api/bookings",
        json={"machine_id": rig1["id"], "start_time": conflict_start, "end_time": conflict_end},
        headers=student_headers,
    )
    assert res.status_code == 409, f"Should reject conflicting booking: {res.text}"
    print("[OK] Conflict elimination verified (409 Conflict)")

    # 6. Test My Bookings
    res = client.get("/api/bookings/my", headers=student_headers)
    assert res.status_code == 200
    my_bookings = res.json()
    assert len(my_bookings["upcoming"]) >= 1
    print("[OK] 'My Bookings' retrieved successfully")

    # 7. Test Session Access Control & Agent Game Launch (FR-05)
    # Future slot rejected
    res = client.post(
        "/api/session/verify",
        json={"booking_id": booking1["id"]},
        headers=student_headers,
    )
    assert res.status_code == 403, f"Future slot should be rejected: {res.text}"
    print("[OK] Future slot session launch rejected with 403")

    # Create active booking happening right now
    active_start = (now - timedelta(minutes=5)).isoformat()
    active_end = (now + timedelta(minutes=25)).isoformat()
    res = client.post(
        "/api/bookings",
        json={
            "machine_id": rig1["id"],
            "game_id": fh4_game["id"],
            "start_time": active_start,
            "end_time": active_end,
        },
        headers=student_headers,
    )
    assert res.status_code == 201
    active_booking = res.json()

    # Verify session access -> Launches admin-configured game via trusted agent
    res = client.post(
        "/api/session/verify",
        json={"booking_id": active_booking["id"]},
        headers=student_headers,
    )
    assert res.status_code == 200, f"Active session verification failed: {res.text}"
    session_data = res.json()
    assert session_data["status"] == "authorized"
    assert "agent" in session_data
    print(f"[OK] Active session authorized with agent launch status: {session_data['agent'].get('status')}")

    # 8. Test Strict Agent Command Security
    # Arbitrary shell execution MUST BE BLOCKED
    res = client.post(
        "/api/session/agent/command",
        json={"operation": "RUN_SHELL", "payload": {"cmd": "dir"}},
        headers=admin_headers,
    )
    assert res.status_code == 403, "RUN_SHELL must be strictly forbidden"

    res = client.post(
        "/api/session/agent/command",
        json={"operation": "EXECUTE_COMMAND", "payload": {"cmd": "calc.exe"}},
        headers=admin_headers,
    )
    assert res.status_code == 403, "EXECUTE_COMMAND must be strictly forbidden"
    print("[OK] Security: Arbitrary shell commands (RUN_SHELL, EXECUTE_COMMAND) blocked with 403 Forbidden")

    # Predefined operations permitted (GET_STATUS, STOP_GAME)
    res = client.post(
        "/api/session/agent/command",
        json={"operation": "GET_STATUS"},
        headers=admin_headers,
    )
    assert res.status_code == 200, "GET_STATUS must be permitted"

    res = client.post(
        "/api/session/agent/command",
        json={"operation": "STOP_GAME"},
        headers=admin_headers,
    )
    assert res.status_code == 200, "STOP_GAME must be permitted"
    print("[OK] Predefined agent operations (GET_STATUS, STOP_GAME) verified")

    # 9. Test Admin Oversight (User Story 3)
    res = client.get("/api/bookings/admin/all", headers=admin_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 2
    print("[OK] Admin oversight retrieved all bookings")

    print("\n============================================================")
    print("  ALL CLOUDKH MVP MANUAL ADMIN & AGENT TESTS PASSED (100%)")
    print("============================================================")


if __name__ == "__main__":
    test_full_platform_flow()
