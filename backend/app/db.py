"""PostgreSQL Database layer for CloudKH platform.

Provides thread-safe connection pooling via psycopg2, schema initialization,
manual administrator game-to-node mapping (node_games), and atomic reservation
locks (FOR UPDATE) to prevent double bookings (FR-04, NFR-02).
"""
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Generator, Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from app.core.config import settings

_pool: Optional[ThreadedConnectionPool] = None
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    minconn=1,
                    maxconn=20,
                    dsn=settings.database_url,
                    cursor_factory=RealDictCursor,
                )
    return _pool


@contextmanager
def get_db() -> Generator[Any, None, None]:
    """Provide a transactional database connection from the connection pool."""
    pool = _get_pool()
    conn = pool.getconn()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def init_db() -> None:
    """Initialize database tables and seed initial data if empty."""
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'student',
            mfa_enabled BOOLEAN DEFAULT FALSE,
            mfa_secret TEXT,
            last_login_at TEXT,
            created_at TEXT NOT NULL
        );
        """)

        for col_def in [
            ("mfa_enabled", "BOOLEAN DEFAULT FALSE"),
            ("mfa_secret", "TEXT"),
            ("last_login_at", "TEXT"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]};")
            except Exception:
                pass

        # Audit Logs table (Security & Admin Operations)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            timestamp TEXT NOT NULL,
            actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            role TEXT,
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            ip TEXT,
            result TEXT NOT NULL,
            details TEXT
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, timestamp);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);")

        # 2. Machines (Gaming Rigs) table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS machines (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            gpu TEXT NOT NULL,
            cpu TEXT NOT NULL,
            ram TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'available',
            is_host INTEGER NOT NULL DEFAULT 0,
            notes TEXT
        );
        """)

        # 3. Games Catalog table (Central game metadata)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id SERIAL PRIMARY KEY,
            slug TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            genre TEXT NOT NULL,
            cover_url TEXT,
            description TEXT,
            size_gb DOUBLE PRECISION DEFAULT 50.0,
            enabled BOOLEAN DEFAULT TRUE,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """)

        # Migration helpers for existing games schema
        for col_def in [
            ("slug", "TEXT UNIQUE"),
            ("enabled", "BOOLEAN DEFAULT TRUE"),
            ("updated_at", "TEXT"),
        ]:
            try:
                cursor.execute(f"ALTER TABLE games ADD COLUMN IF NOT EXISTS {col_def[0]} {col_def[1]};")
            except Exception:
                pass

        # 4. Node Games table (Manual per-PC game configuration)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS node_games (
            id SERIAL PRIMARY KEY,
            node_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            executable_path TEXT NOT NULL,
            working_directory TEXT,
            launch_arguments TEXT DEFAULT '',
            enabled BOOLEAN DEFAULT TRUE,
            status TEXT NOT NULL DEFAULT 'ready',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CONSTRAINT uq_node_game UNIQUE (node_id, game_id)
        );
        """)

        # 5. Bookings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
            game_id INTEGER,
            game_title TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'confirmed',
            created_at TEXT NOT NULL
        );
        """)

        # Indices for high performance lookups & conflict checking
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_bookings_machine_overlap 
        ON bookings(machine_id, status, start_time, end_time);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_bookings_user 
        ON bookings(user_id, status);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_node_games_node 
        ON node_games(node_id, status);
        """)
        cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_node_games_game 
        ON node_games(game_id, status);
        """)

        conn.commit()
        _seed_initial_data(conn)


def _seed_initial_data(conn: Any) -> None:
    from app.services.auth import hash_password
    from app.utils.hardware import detect_host_hardware

    cursor = conn.cursor()
    real_hw = detect_host_hardware()
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Seed or Bootstrap Admin account if none exists
    cursor.execute("SELECT id FROM users WHERE email = %s;", (settings.bootstrap_admin_email,))
    admin_row = cursor.fetchone()
    if not admin_row:
        admin_hash, admin_salt = hash_password(settings.bootstrap_admin_password)
        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at)
            VALUES (%s, %s, %s, %s, 'admin', FALSE, %s);
            """,
            ("System Administrator", settings.bootstrap_admin_email, admin_hash, admin_salt, now_iso),
        )

    # 2. Seed Student Demo account if none exists
    cursor.execute("SELECT id FROM users WHERE email = 'gamer@cloudkh.com' LIMIT 1;")
    if not cursor.fetchone():
        user_hash, user_salt = hash_password("user123456")
        cursor.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, mfa_enabled, created_at)
            VALUES (%s, %s, %s, %s, 'student', FALSE, %s);
            """,
            ("Cloud Gamer", "gamer@cloudkh.com", user_hash, user_salt, now_iso),
        )

    # 2. Seed or sync Gaming Rigs with real host hardware
    cursor.execute("SELECT COUNT(*) AS count FROM machines;")
    row = cursor.fetchone()
    if row["count"] == 0:
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
            (
                "Cloud Rig 03",
                "NVIDIA GeForce RTX 4070 Ti",
                "Intel Core i7-13700K",
                "32GB DDR5",
                "available",
                0,
                "VR & Ultra Ray Tracing station",
            ),
        ]
        cursor.executemany(
            """
            INSERT INTO machines (name, gpu, cpu, ram, status, is_host, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s);
            """,
            rigs,
        )
    else:
        cursor.execute(
            """
            UPDATE machines
            SET name = %s, gpu = %s, cpu = %s, ram = %s
            WHERE is_host = 1;
            """,
            (
                real_hw["name"],
                real_hw["gpu"],
                real_hw["cpu"],
                f"{real_hw['ram']} ({real_hw['os']})",
            ),
        )

    # 3. Seed or sync Games Catalog
    sample_games = [
        (
            "forza-horizon-4",
            "Forza Horizon 4",
            "Racing",
            "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80",
            "Dynamic seasons and open-world racing festival in historic Britain.",
            80.0,
            True,
            now_iso,
            now_iso,
        ),
        (
            "persona-3-reload",
            "Persona 3 Reload",
            "JRPG",
            "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&auto=format&fit=crop&q=80",
            "Step into the shoes of a transfer student thrust into an unexpected fate.",
            30.0,
            True,
            now_iso,
            now_iso,
        ),
        (
            "gta-v",
            "Grand Theft Auto V",
            "Open World Action",
            "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=600&auto=format&fit=crop&q=80",
            "Los Santos open world campaign and multiplayer.",
            110.0,
            True,
            now_iso,
            now_iso,
        ),
        (
            "cyberpunk-2077",
            "Cyberpunk 2077",
            "Action RPG",
            "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600&auto=format&fit=crop&q=80",
            "Night City dystopian open world with full Ray Tracing and DLSS support.",
            70.0,
            True,
            now_iso,
            now_iso,
        ),
        (
            "black-myth-wukong",
            "Black Myth: Wukong",
            "Action RPG",
            "https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&auto=format&fit=crop&q=80",
            "Action RPG rooted in Chinese mythology featuring the Destined One.",
            130.0,
            True,
            now_iso,
            now_iso,
        ),
    ]

    for g in sample_games:
        cursor.execute("SELECT id FROM games WHERE slug = %s;", (g[0],))
        existing = cursor.fetchone()
        if not existing:
            cursor.execute(
                """
                INSERT INTO games (slug, title, genre, cover_url, description, size_gb, enabled, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                g,
            )

    # 4. Seed Node Games (Manual per-node game installation configuration)
    cursor.execute("SELECT COUNT(*) AS count FROM node_games;")
    ng_row = cursor.fetchone()
    if ng_row["count"] == 0:
        # Fetch game IDs by slug
        cursor.execute("SELECT id, slug FROM games;")
        game_map = {row["slug"]: row["id"] for row in cursor.fetchall()}

        # Fetch Host PC (node_id 1) and Cloud Rig 02 (node_id 2)
        cursor.execute("SELECT id, is_host FROM machines ORDER BY id ASC;")
        machine_rows = cursor.fetchall()
        host_id = machine_rows[0]["id"] if machine_rows else 1
        rig2_id = machine_rows[1]["id"] if len(machine_rows) > 1 else 2

        node_configs = [
            # Host PC games
            (
                host_id,
                game_map["forza-horizon-4"],
                r"C:\Games\Forza Horizon 4\ForzaHorizon4.exe",
                r"C:\Games\Forza Horizon 4",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            (
                host_id,
                game_map["persona-3-reload"],
                r"C:\Games\P3R\P3R.exe",
                r"C:\Games\P3R",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            (
                host_id,
                game_map["gta-v"],
                r"C:\Games\GTAV\GTA5.exe",
                r"C:\Games\GTAV",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            (
                host_id,
                game_map["cyberpunk-2077"],
                r"C:\Games\Cyberpunk2077\bin\x64\Cyberpunk2077.exe",
                r"C:\Games\Cyberpunk2077",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            (
                host_id,
                game_map["black-myth-wukong"],
                r"C:\Games\BlackMythWukong\b1\Binaries\Win64\b1-Win64-Shipping.exe",
                r"C:\Games\BlackMythWukong",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            # Cloud Rig 02 games
            (
                rig2_id,
                game_map["black-myth-wukong"],
                r"D:\Games\BlackMythWukong\b1\Binaries\Win64\b1-Win64-Shipping.exe",
                r"D:\Games\BlackMythWukong",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
            (
                rig2_id,
                game_map["cyberpunk-2077"],
                r"D:\Games\Cyberpunk2077\bin\x64\Cyberpunk2077.exe",
                r"D:\Games\Cyberpunk2077",
                "",
                True,
                "ready",
                now_iso,
                now_iso,
            ),
        ]

        cursor.executemany(
            """
            INSERT INTO node_games (node_id, game_id, executable_path, working_directory, launch_arguments, enabled, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (node_id, game_id) DO NOTHING;
            """,
            node_configs,
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
    """Atomically check for conflicts and insert a booking with transaction row locking (FR-04, NFR-02).
    
    When game_id is specified, only gaming rigs where the administrator has configured
    the game (node_games status = 'ready' and enabled = true) are eligible.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            # Resolve game_title if game_id provided
            if game_id and not game_title:
                cursor.execute("SELECT title FROM games WHERE id = %s;", (game_id,))
                g = cursor.fetchone()
                if g:
                    game_title = g["title"]

            # Auto-assign machine if none specified
            allocated_machine_id = machine_id
            if not allocated_machine_id:
                if game_id:
                    # Select machines where admin has explicitly configured this game as ready
                    cursor.execute(
                        """
                        SELECT m.id, m.name 
                        FROM machines m
                        JOIN node_games ng ON m.id = ng.node_id
                        WHERE ng.game_id = %s 
                          AND ng.enabled = TRUE 
                          AND ng.status = 'ready'
                          AND m.status != 'maintenance'
                        ORDER BY m.is_host DESC, m.id ASC FOR UPDATE;
                        """,
                        (game_id,),
                    )
                else:
                    cursor.execute(
                        "SELECT id, name FROM machines WHERE status != 'maintenance' ORDER BY is_host DESC, id ASC FOR UPDATE;"
                    )
                available_candidates = cursor.fetchall()
                if not available_candidates:
                    if game_id:
                        raise ValueError(f"Game '{game_title or game_id}' is not currently configured or ready on any online gaming PC.")
                    else:
                        raise ValueError("No gaming rigs are currently online.")

                # Check each candidate for overlap
                for cand in available_candidates:
                    cursor.execute(
                        """
                        SELECT id FROM bookings
                        WHERE machine_id = %s
                          AND status = 'confirmed'
                          AND (start_time < %s)
                          AND (end_time > %s);
                        """,
                        (cand["id"], end_iso, start_iso),
                    )
                    if not cursor.fetchone():
                        allocated_machine_id = cand["id"]
                        break

                if not allocated_machine_id:
                    raise BookingConflictError("All gaming servers capable of running this title are fully booked for this time slot.")

            # 1. Verify machine exists, lock it, and check not under maintenance
            cursor.execute("SELECT id, name, status FROM machines WHERE id = %s FOR UPDATE;", (allocated_machine_id,))
            machine = cursor.fetchone()
            if not machine:
                raise ValueError(f"Machine {allocated_machine_id} does not exist")
            if machine["status"] == "maintenance":
                raise ValueError(f"Machine '{machine['name']}' is currently undergoing maintenance")

            # Verify that the game is installed and ready on this specific machine
            if game_id:
                cursor.execute(
                    """
                    SELECT id, status, enabled FROM node_games
                    WHERE node_id = %s AND game_id = %s;
                    """,
                    (allocated_machine_id, game_id),
                )
                ng = cursor.fetchone()
                if not ng or not ng["enabled"] or ng["status"] != "ready":
                    status_text = ng["status"] if ng else "not installed"
                    raise ValueError(f"Game '{game_title or game_id}' is {status_text} on machine '{machine['name']}'.")

            # 2. Check for overlapping confirmed reservations on the allocated machine
            cursor.execute(
                """
                SELECT id, start_time, end_time 
                FROM bookings 
                WHERE machine_id = %s 
                  AND status = 'confirmed' 
                  AND (start_time < %s) 
                  AND (end_time > %s);
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

            # 3. Insert new confirmed booking and return ID
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor.execute(
                """
                INSERT INTO bookings (user_id, machine_id, game_id, game_title, start_time, end_time, status, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, 'confirmed', %s)
                RETURNING id;
                """,
                (user_id, allocated_machine_id, game_id, game_title, start_iso, end_iso, now_iso),
            )
            booking_row = cursor.fetchone()
            booking_id = booking_row["id"]
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
