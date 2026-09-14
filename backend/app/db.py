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
            notes TEXT,
            os TEXT
        );
        """)
        cursor.execute("ALTER TABLE machines ADD COLUMN IF NOT EXISTS os TEXT;")
        cursor.execute("ALTER TABLE machines ADD COLUMN IF NOT EXISTS last_seen TEXT;")

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

        # 6. Machine Pairings table (Keypair codes for adding streaming PCs)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS machine_pairings (
            id SERIAL PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            target_name TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
            hardware_specs JSONB,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            paired_at TEXT
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_machine_pairings_code ON machine_pairings(code);")

        # 7. Enable Row Level Security (RLS) on all public tables to secure against unauthorized PostgREST access
        for tbl in ["users", "machines", "games", "node_games", "bookings", "machine_pairings", "audit_logs"]:
            try:
                cursor.execute(f"ALTER TABLE public.{tbl} ENABLE ROW LEVEL SECURITY;")
            except Exception:
                pass

        conn.commit()
        _seed_initial_data(conn)


def _seed_initial_data(conn: Any) -> None:
    from app.services.auth import hash_password

    cursor = conn.cursor()
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

    # 2. Clean up legacy hardcoded host workstation note if any exists
    cursor.execute("DELETE FROM machines WHERE notes LIKE 'Local Host Gaming Workstation%';")

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
                        SELECT id, user_id FROM bookings
                        WHERE machine_id = %s
                          AND status = 'confirmed'
                          AND (start_time < %s)
                          AND (end_time > %s);
                        """,
                        (cand["id"], end_iso, start_iso),
                    )
                    overlapping = cursor.fetchone()
                    if not overlapping:
                        allocated_machine_id = cand["id"]
                        break
                    elif overlapping["user_id"] == user_id:
                        cursor.execute("SELECT * FROM bookings WHERE id = %s;", (overlapping["id"],))
                        return dict(cursor.fetchone())

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
                SELECT id, user_id, start_time, end_time 
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
                # If the reservation already belongs to the current user, return the active booking to resume session
                user_existing = next((r for r in conflicting if r["user_id"] == user_id), None)
                if user_existing:
                    cursor.execute("SELECT * FROM bookings WHERE id = %s;", (user_existing["id"],))
                    return dict(cursor.fetchone())

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
