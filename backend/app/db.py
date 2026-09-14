"""SQLite Database layer for CloudKH platform.

Provides thread-safe connections, WAL mode, schema initialization,
and atomic reservation locks to prevent double bookings (FR-04, NFR-02).
"""
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

DB_PATH = Path(__file__).resolve().parents[1] / "cloudkh.db"
_lock = threading.Lock()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Initialize database tables and seed initial data if empty."""
    with _lock, get_db() as conn:
        cursor = conn.cursor()

        # 1. Users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student',
            created_at TEXT NOT NULL
        );
        """)

        # 2. Machines (Gaming Rigs) table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS machines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            gpu TEXT NOT NULL,
            cpu TEXT NOT NULL,
            ram TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'available',
            is_host INTEGER NOT NULL DEFAULT 0,
            notes TEXT
        );
        """)

        # 3. Bookings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            machine_id INTEGER NOT NULL REFERENCES machines(id),
            game_id INTEGER,
            game_title TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'confirmed',
            created_at TEXT NOT NULL
        );
        """)

        # Migration helper for existing databases
        try:
            cursor.execute("ALTER TABLE bookings ADD COLUMN game_id INTEGER;")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE bookings ADD COLUMN game_title TEXT;")
        except Exception:
            pass

        # 4. Games Library table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            genre TEXT NOT NULL,
            cover_url TEXT,
            description TEXT,
            exe_path TEXT,
            size_gb REAL DEFAULT 50.0,
            installed_machines TEXT DEFAULT 'all',
            created_at TEXT NOT NULL
        );
        """)

        # Indices for high performance overlap checks & user lookups
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_bookings_machine_overlap 
        ON bookings(machine_id, status, start_time, end_time);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_bookings_user 
        ON bookings(user_id, status);
        """)

        conn.commit()
        _seed_initial_data(conn)


def _seed_initial_data(conn: sqlite3.Connection) -> None:
    from app.services.auth import hash_password
    from app.utils.hardware import detect_host_hardware

    cursor = conn.cursor()
    real_hw = detect_host_hardware()

    # Seed Admin and Demo accounts if none exist
    cursor.execute("SELECT COUNT(*) FROM users;")
    if cursor.fetchone()[0] == 0:
        now = datetime.now(timezone.utc).isoformat()

        admin_hash, admin_salt = hash_password("cloudkh2026")
        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            ("System Administrator", "admin@kit.edu.kh", admin_hash, admin_salt, "admin", now),
        )

        user_hash, user_salt = hash_password("user123456")
        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?);
            """,
            ("Cloud Gamer", "gamer@cloudkh.com", user_hash, user_salt, "user", now),
        )

    # Seed or sync Gaming Rigs with real host hardware
    cursor.execute("SELECT COUNT(*) FROM machines;")
    if cursor.fetchone()[0] == 0:
        rigs = [
            (
                real_hw["name"],
                real_hw["gpu"],
                real_hw["cpu"],
                f"{real_hw['ram']} ({real_hw['os']})",
                "available",
                1,
                "Local Host Gaming Workstation - WebRTC Screen Streamer",
            ),
            (
                "Cloud Rig 02",
                "NVIDIA GeForce RTX 3080",
                "AMD Ryzen 7 5800X",
                "32GB DDR4",
                "available",
                0,
                "Dedicated esports node",
            ),
        ]
        cursor.executemany(
            """
            INSERT INTO machines (name, gpu, cpu, ram, status, is_host, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
            rigs,
        )
    else:
        # Always update the host machine with actual detected hardware
        cursor.execute(
            """
            UPDATE machines
            SET name = ?, gpu = ?, cpu = ?, ram = ?
            WHERE is_host = 1;
            """,
            (
                real_hw["name"],
                real_hw["gpu"],
                real_hw["cpu"],
                f"{real_hw['ram']} ({real_hw['os']})",
            ),
        )

    # Seed Games Library if empty
    cursor.execute("SELECT COUNT(*) FROM games;")
    if cursor.fetchone()[0] == 0:
        now_iso = datetime.now(timezone.utc).isoformat()
        sample_games = [
            (
                "Cyberpunk 2077",
                "Action RPG",
                "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80",
                "Night City dystopian open world with full Ray Tracing and DLSS support.",
                r"C:\Games\Cyberpunk2077\bin\x64\Cyberpunk2077.exe",
                70.0,
                "all",
                now_iso,
            ),
            (
                "Counter-Strike 2",
                "Competitive FPS",
                "https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&auto=format&fit=crop&q=80",
                "Sub-tick tactical esports shooter running at ultra low latency.",
                r"C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\bin\win64\cs2.exe",
                35.0,
                "all",
                now_iso,
            ),
            (
                "Black Myth: Wukong",
                "Action RPG",
                "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&auto=format&fit=crop&q=80",
                "Unreal Engine 5 showcase rooted in Chinese mythology.",
                r"C:\Games\b1\b1.exe",
                130.0,
                "1",
                now_iso,
            ),
            (
                "Valorant",
                "Tactical Shooter",
                "https://images.unsplash.com/photo-1563089145-599997674d42?w=600&auto=format&fit=crop&q=80",
                "5v5 character-based competitive FPS.",
                r"C:\Riot Games\VALORANT\live\VALORANT.exe",
                45.0,
                "all",
                now_iso,
            ),
            (
                "Grand Theft Auto V",
                "Open World Action",
                "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80",
                "Los Santos open world campaign and multiplayer.",
                r"C:\Games\GTAV\GTA5.exe",
                110.0,
                "all",
                now_iso,
            ),
        ]
        cursor.executemany(
            """
            INSERT INTO games (title, genre, cover_url, description, exe_path, size_gb, installed_machines, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """,
            sample_games,
        )

    conn.commit()


class BookingConflictError(Exception):
    """Raised when an attempted reservation overlaps with an existing confirmed booking."""
    pass


def create_booking_atomic(
    user_id: int,
    start_iso: str,
    end_iso: str,
    machine_id: Optional[int] = None,
    game_id: Optional[int] = None,
    game_title: Optional[str] = None,
) -> Dict[str, Any]:
    """Atomically check for conflicts and insert a booking with transaction lock (FR-04, NFR-02).
    
    If machine_id is omitted, automatically finds and allocates the best available gaming rig.
    """
    with _lock, get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE;")
        try:
            # Resolve game_title if game_id provided
            if game_id and not game_title:
                cursor.execute("SELECT title FROM games WHERE id = ?;", (game_id,))
                g = cursor.fetchone()
                if g:
                    game_title = g["title"]

            # Auto-assign machine if none specified
            allocated_machine_id = machine_id
            if not allocated_machine_id:
                # Find all active machines not under maintenance
                cursor.execute(
                    "SELECT id, name FROM machines WHERE status != 'maintenance' ORDER BY is_host DESC, id ASC;"
                )
                available_candidates = cursor.fetchall()
                if not available_candidates:
                    raise ValueError("No gaming rigs are currently online.")

                # Check each candidate for overlap
                for cand in available_candidates:
                    cursor.execute(
                        """
                        SELECT id FROM bookings
                        WHERE machine_id = ?
                          AND status = 'confirmed'
                          AND (start_time < ?)
                          AND (end_time > ?);
                        """,
                        (cand["id"], end_iso, start_iso),
                    )
                    if not cursor.fetchone():
                        allocated_machine_id = cand["id"]
                        break

                if not allocated_machine_id:
                    raise BookingConflictError("All gaming servers are fully booked for this time slot. Please choose another time.")

            # 1. Verify machine exists and is not under maintenance
            cursor.execute("SELECT id, name, status FROM machines WHERE id = ?;", (allocated_machine_id,))
            machine = cursor.fetchone()
            if not machine:
                raise ValueError(f"Machine {allocated_machine_id} does not exist")
            if machine["status"] == "maintenance":
                raise ValueError(f"Machine '{machine['name']}' is currently undergoing maintenance")

            # 2. Check for overlapping confirmed reservations on the allocated machine:
            cursor.execute(
                """
                SELECT id, start_time, end_time 
                FROM bookings 
                WHERE machine_id = ? 
                  AND status = 'confirmed'
                  AND (start_time < ?) 
                  AND (end_time > ?);
                """,
                (allocated_machine_id, end_iso, start_iso),
            )
            conflicting = cursor.fetchall()
            if conflicting:
                conflict_details = [
                    f"Booking #{row['id']} ({row['start_time']} to {row['end_time']})"
                    for row in conflicting
                ]
                raise BookingConflictError(
                    f"Selected time slot overlaps with existing reservation(s): {', '.join(conflict_details)}"
                )

            # 3. Insert new confirmed booking
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor.execute(
                """
                INSERT INTO bookings (user_id, machine_id, game_id, game_title, start_time, end_time, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?);
                """,
                (user_id, allocated_machine_id, game_id, game_title, start_iso, end_iso, now_iso),
            )
            booking_id = cursor.lastrowid
            conn.commit()

            return {
                "id": booking_id,
                "user_id": user_id,
                "machine_id": allocated_machine_id,
                "machine_name": machine["name"],
                "game_id": game_id,
                "game_title": game_title,
                "start_time": start_iso,
                "end_time": end_iso,
                "status": "confirmed",
                "created_at": now_iso,
            }
        except Exception:
            conn.rollback()
            raise
