"""Unit & integration test for CloudKH platform features.

Tests FR-01 through FR-05, NFR-01, NFR-02, MVP Game Management, and Admin 2-Step TOTP MFA Security.
"""
from datetime import datetime, timedelta, timezone
import sys
import pyotp
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_db, init_db
from app.services.auth import create_access_token, decrypt_mfa_secret
from app.core.config import settings

client = TestClient(app)


def test_full_platform_flow():
    print("Initializing DB...")
    init_db()
    with get_db() as conn:
        conn.cursor().execute("DELETE FROM bookings;")
        conn.commit()

    # 1. Test Admin Login (2-Step TOTP MFA Security)
    # Step A: Submit credentials
    res = client.post(
        "/api/auth/login",
        json={"email": settings.bootstrap_admin_email, "password": settings.bootstrap_admin_password},
    )
    assert res.status_code == 200, f"Admin credential check failed: {res.text}"
    mfa_challenge = res.json()
    assert mfa_challenge["status"] == "mfa_required", "Admin must receive MFA challenge"
    assert "access_token" not in mfa_challenge, "Server MUST NOT issue an access token before MFA"
    challenge_id = mfa_challenge["challenge_id"]
    print("[OK] Admin login returned MFA challenge (zero premature token leakage)")

    # Step B: Reject invalid TOTP code
    res = client.post("/api/auth/mfa/verify", json={"challenge_id": challenge_id, "code": "000000"})
    assert res.status_code == 401, "Invalid code must be rejected"
    print("[OK] Security: Invalid 6-digit TOTP code rejected with 401 Unauthorized")

    # Step C: Resolve secret and verify with genuine TOTP code
    secret = mfa_challenge.get("secret")
    if not secret:
        # If already enrolled, fetch encrypted secret from DB
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT mfa_secret FROM users WHERE email = %s;", (settings.bootstrap_admin_email,))
            row = cur.fetchone()
            secret = decrypt_mfa_secret(row["mfa_secret"])

    code = pyotp.TOTP(secret).now()
    res = client.post("/api/auth/mfa/verify", json={"challenge_id": challenge_id, "code": code})
    assert res.status_code == 200, f"MFA verification failed: {res.text}"
    admin_auth = res.json()
    assert admin_auth["status"] == "authenticated"
    assert admin_auth["user"]["mfa_verified"] is True
    admin_token = admin_auth["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    print("[OK] Admin 2-step TOTP MFA completed; verified admin token issued")

    # Step D: Test that an unverified admin token is REJECTED by privileged endpoints
    unverified_token = create_access_token(
        {"sub": admin_auth["user"]["id"], "role": "admin", "mfa_verified": False}
    )
    res = client.get("/api/bookings/admin/all", headers={"Authorization": f"Bearer {unverified_token}"})
    assert res.status_code == 403, "Unverified admin token must be rejected"
    print("[OK] Security: Privileged endpoint rejected unverified admin token with 403 Forbidden")

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

    # Normal user login returns immediate token (no MFA required for students)
    res = client.post(
        "/api/auth/login",
        json={"email": test_email, "password": "securepass123"},
    )
    assert res.status_code == 200
    user_login_data = res.json()
    assert user_login_data["status"] == "authenticated"
    assert "access_token" in user_login_data
    print("[OK] Student login returned immediate authenticated session (no MFA)")

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
    res = client.post(
        "/api/session/agent/command",
        json={"operation": "RUN_SHELL", "payload": {"cmd": "dir"}},
        headers=admin_headers,
    )
    assert res.status_code == 403, "RUN_SHELL must be strictly forbidden"
    print("[OK] Security: Arbitrary shell commands blocked with 403 Forbidden")

    # 9. Test Audit Log Trail
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT action, result FROM audit_logs WHERE role = 'admin' ORDER BY id DESC LIMIT 5;")
        audit_records = cur.fetchall()
        assert len(audit_records) >= 1
        print(f"[OK] Verified audit trail recorded {len(audit_records)} security events (e.g. {audit_records[0]['action']})")

    # 10. Test Admin Oversight (User Story 3)
    res = client.get("/api/bookings/admin/all", headers=admin_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 2
    print("[OK] Admin oversight retrieved all bookings")

    print("\n============================================================")
    print("  ALL CLOUDKH 2-STEP MFA & SECURITY TESTS PASSED (100%)")
    print("============================================================")


if __name__ == "__main__":
    test_full_platform_flow()
