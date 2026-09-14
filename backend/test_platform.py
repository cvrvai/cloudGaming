"""Unit & integration test for CloudKH platform features.

Tests FR-01 through FR-05, NFR-01, NFR-02.
"""
from datetime import datetime, timedelta, timezone
import sys

from fastapi.testclient import TestClient

from app.main import app
from app.db import init_db

client = TestClient(app)


def test_full_platform_flow():
    print("Initializing DB...")
    init_db()

    # 1. Test Login with seeded Admin
    res = client.post("/api/auth/login", json={"email": "admin@kit.edu.kh", "password": "cloudkh2026"})
    assert res.status_code == 200, f"Admin login failed: {res.text}"
    admin_token = res.json()["access_token"]
    print("[OK] Admin login successful")

    # 2. Test User Registration (FR-01)
    test_email = f"gamer_{int(datetime.now().timestamp())}@kit.edu.kh"
    res = client.post(
        "/api/auth/register",
        json={"name": "Sokha KIT", "email": test_email, "password": "securepass123"},
    )
    assert res.status_code == 200, f"Registration failed: {res.text}"
    student_token = res.json()["access_token"]
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

    # 4. Test Reservation Creation (FR-03)
    headers = {"Authorization": f"Bearer {student_token}"}
    now = datetime.now(timezone.utc)
    slot1_start = (now + timedelta(hours=1)).isoformat()
    slot1_end = (now + timedelta(hours=2)).isoformat()

    res = client.post(
        "/api/bookings",
        json={"machine_id": rig1["id"], "start_time": slot1_start, "end_time": slot1_end},
        headers=headers,
    )
    assert res.status_code == 201, f"Booking creation failed: {res.text}"
    booking1 = res.json()
    print("[OK] Conflict-free booking created successfully")

    # 5. Test Conflict Elimination (FR-04, NFR-02)
    # Overlapping slot on SAME machine (e.g. +1.5h to +2.5h overlaps with +1h to +2h)
    conflict_start = (now + timedelta(hours=1, minutes=30)).isoformat()
    conflict_end = (now + timedelta(hours=2, minutes=30)).isoformat()
    res = client.post(
        "/api/bookings",
        json={"machine_id": rig1["id"], "start_time": conflict_start, "end_time": conflict_end},
        headers=headers,
    )
    assert res.status_code == 409, f"Should reject conflicting booking, got {res.status_code}: {res.text}"
    print("[OK] Conflict elimination verified (overlapped booking was rejected with 409 Conflict)")

    # Same time slot on DIFFERENT machine (Rig 2) should succeed!
    res = client.post(
        "/api/bookings",
        json={"machine_id": rig2["id"], "start_time": conflict_start, "end_time": conflict_end},
        headers=headers,
    )
    assert res.status_code == 201, f"Non-overlapping machine should succeed: {res.text}"
    print("[OK] Independent machine reservation verified")

    # 6. Test My Bookings (User Story 1)
    res = client.get("/api/bookings/my", headers=headers)
    assert res.status_code == 200
    my_bookings = res.json()
    assert len(my_bookings["upcoming"]) >= 2
    print("[OK] 'My Bookings' retrieved successfully")

    # 7. Test Session Access Control (FR-05)
    # Booking 1 is 1 hour in the future -> Session launch should be REJECTED (403 Forbidden)
    res = client.post(
        "/api/session/verify",
        json={"booking_id": booking1["id"]},
        headers=headers,
    )
    assert res.status_code == 403, f"Future slot should be rejected: {res.text}"
    print("[OK] Future slot session launch rejected with 403 Forbidden (FR-05 verified)")

    # Create an ACTIVE booking happening right now
    active_start = (now - timedelta(minutes=5)).isoformat()
    active_end = (now + timedelta(minutes=25)).isoformat()
    res = client.post(
        "/api/bookings",
        json={"machine_id": rig1["id"], "start_time": active_start, "end_time": active_end},
        headers=headers,
    )
    # If slot1 was 1h later, active_start (-5m to +25m) does not overlap
    assert res.status_code == 201
    active_booking = res.json()

    # Verify session access during active slot -> SHOULD SUCCEED (200 OK)
    res = client.post(
        "/api/session/verify",
        json={"booking_id": active_booking["id"]},
        headers=headers,
    )
    assert res.status_code == 200, f"Active session verification failed: {res.text}"
    session_data = res.json()
    assert session_data["status"] == "authorized"
    assert "session_token" in session_data
    assert session_data["remaining_seconds"] > 0
    print(f"[OK] Active session authorized! Remaining: {session_data['remaining_seconds']}s")

    # 8. Test Admin Oversight (User Story 3)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    res = client.get("/api/bookings/admin/all", headers=admin_headers)
    assert res.status_code == 200
    assert len(res.json()) >= 3
    print("[OK] Admin oversight retrieved all bookings")

    print("\n============================================================")
    print("  ALL CLOUDKH BACKEND SPECIFICATION TESTS PASSED (100%)")
    print("============================================================")


if __name__ == "__main__":
    test_full_platform_flow()
