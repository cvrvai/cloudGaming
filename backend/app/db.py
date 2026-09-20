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
        cursor.execute("ALTER TABLE machines ADD COLUMN IF NOT EXISTS stream_started_at TEXT;")
        cursor.execute("ALTER TABLE machines ADD COLUMN IF NOT EXISTS active_watts DOUBLE PRECISION DEFAULT 280.0;")
        cursor.execute("ALTER TABLE machines ADD COLUMN IF NOT EXISTS idle_watts DOUBLE PRECISION DEFAULT 55.0;")
        try:
            cursor.execute("UPDATE machines SET active_watts = 260.0, idle_watts = 48.0 WHERE id = 2 AND (active_watts IS NULL OR active_watts = 280.0);")
            cursor.execute("UPDATE machines SET active_watts = 210.0, idle_watts = 38.0 WHERE id = 3 AND (active_watts IS NULL OR active_watts = 280.0);")
        except Exception:
            pass

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
        # `code TEXT UNIQUE` already creates a unique index for pairing-code lookups.
        # Keep indexes on the foreign keys used to resolve ownership and machines.
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_machine_pairings_admin_user ON machine_pairings(admin_user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_machine_pairings_machine ON machine_pairings(machine_id);")

        # 7. Session Telemetry table (Operations Research - Lean Six Sigma DMAIC CTQ tracking)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS session_telemetry (
            id SERIAL PRIMARY KEY,
            test_id TEXT NOT NULL,
            booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            user_email TEXT,
            machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
            game_title TEXT,
            requested_time TEXT,
            booking_slot TEXT,
            waiting_time_minutes DOUBLE PRECISION DEFAULT 0.0,
            avg_latency_ms DOUBLE PRECISION DEFAULT 0.0,
            max_latency_ms DOUBLE PRECISION DEFAULT 0.0,
            avg_fps DOUBLE PRECISION DEFAULT 60.0,
            packet_loss_pct DOUBLE PRECISION DEFAULT 0.0,
            disconnects_count INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT TRUE,
            failure_reason TEXT,
            pc_idle_minutes DOUBLE PRECISION DEFAULT 0.0,
            power_kwh DOUBLE PRECISION DEFAULT 0.0,
            energy_cost_usd DOUBLE PRECISION DEFAULT 0.0,
            phase TEXT DEFAULT 'V1_Baseline',
            source TEXT DEFAULT 'automated_stream',
            integrity_hash TEXT,
            user_rating SMALLINT,
            experience_tag TEXT,
            user_comment TEXT,
            feedback_submitted_at TEXT,
            notes TEXT,
            created_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_test_id ON session_telemetry(test_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_phase ON session_telemetry(phase);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_booking ON session_telemetry(booking_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_user ON session_telemetry(user_id);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_machine ON session_telemetry(machine_id);")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS integrity_hash TEXT;")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'automated_stream';")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS duration_seconds DOUBLE PRECISION DEFAULT 0.0;")
        # Verbatim Voice of Customer (VOC) captured after a completed session.
        # Keep these nullable so automated/admin observations remain valid when
        # no participant feedback was collected.
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS user_rating SMALLINT;")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS experience_tag TEXT;")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS user_comment TEXT;")
        cursor.execute("ALTER TABLE session_telemetry ADD COLUMN IF NOT EXISTS feedback_submitted_at TEXT;")

        # 8. Voice of Customer (VOC) & Player Feedback table (Lean Six Sigma DMAIC CTQ tracking)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS voc_feedback (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            user_name TEXT NOT NULL,
            user_email TEXT NOT NULL,
            game_title TEXT,
            machine_name TEXT DEFAULT 'Gaming PC (DESKTOP-BR6FNPB)',
            rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
            sentiment TEXT NOT NULL DEFAULT 'negative',
            category TEXT NOT NULL DEFAULT 'rig_capacity',
            experience_tag TEXT NOT NULL,
            waiting_time_minutes DOUBLE PRECISION DEFAULT 0.0,
            comment TEXT NOT NULL,
            impact_level TEXT DEFAULT 'CRITICAL',
            ctq_defect_category TEXT DEFAULT 'CTQ 3: Rig Capacity & Waiting Time Defect',
            status TEXT DEFAULT 'open',
            created_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_voc_category ON voc_feedback(category);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_voc_rating ON voc_feedback(rating);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_voc_sentiment ON voc_feedback(sentiment);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_voc_created_at ON voc_feedback(created_at DESC);")

        # 9. Enable Row Level Security (RLS) on all public tables
        for tbl in ["users", "machines", "games", "node_games", "bookings", "machine_pairings", "audit_logs", "session_telemetry", "voc_feedback"]:
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

    # 3. Seed Voice of Customer (VOC) feedback if empty (Lean Six Sigma DMAIC CTQ 3)
    cursor.execute("SELECT COUNT(*) as cnt FROM voc_feedback;")
    voc_cnt = (cursor.fetchone() or {}).get("cnt", 0)
    if voc_cnt == 0:
        try:
            from app.api.routes.voc import SEED_VOC_COMPLAINTS
            from datetime import timedelta
            base_dt = datetime.now(timezone.utc)
            for idx, item in enumerate(SEED_VOC_COMPLAINTS):
                created_at = (base_dt - timedelta(days=item.get("days_ago", 1), minutes=idx * 17)).isoformat()
                cursor.execute(
                    """
                    INSERT INTO voc_feedback (
                        user_name, user_email, game_title, machine_name,
                        rating, sentiment, category, experience_tag, waiting_time_minutes,
                        comment, impact_level, ctq_defect_category, status, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'open', %s);
                    """,
                    (
                        item["user_name"],
                        item["user_email"],
                        item["game_title"],
                        "Gaming PC (DESKTOP-BR6FNPB)",
                        item["rating"],
                        item["sentiment"],
                        item["category"],
                        item["experience_tag"],
                        item["waiting_time_minutes"],
                        item["comment"],
                        item["impact_level"],
                        item["ctq_defect_category"],
                        created_at,
                    ),
                )
        except Exception:
            pass

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
                        SELECT m.id, m.name, m.status 
                        FROM machines m
                        JOIN node_games ng ON m.id = ng.node_id
                        WHERE ng.game_id = %s 
                          AND ng.enabled = TRUE 
                          AND ng.status = 'ready'
                          AND m.status != 'maintenance'
                        ORDER BY (CASE WHEN m.status = 'available' THEN 0 ELSE 1 END) ASC, m.last_seen DESC NULLS LAST, m.is_host DESC, m.id ASC FOR UPDATE;
                        """,
                        (game_id,),
                    )
                else:
                    cursor.execute(
                        "SELECT id, name, status FROM machines WHERE status != 'maintenance' ORDER BY (CASE WHEN status = 'available' THEN 0 ELSE 1 END) ASC, last_seen DESC NULLS LAST, is_host DESC, id ASC FOR UPDATE;"
                    )
                available_candidates = cursor.fetchall()
                if not available_candidates:
                    if game_id:
                        raise ValueError(f"Game '{game_title or game_id}' is not currently configured or ready on any online gaming PC.")
                    else:
                        raise ValueError("No gaming rigs are currently online.")

                now_check_iso = datetime.now(timezone.utc).isoformat()
                is_immediate = (start_iso <= now_check_iso)

                # Check each candidate for overlap
                for cand in available_candidates:
                    # For immediate instant sessions, skip machines that are not currently online and available
                    if is_immediate and cand["status"] != "available":
                        continue

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
                    if is_immediate:
                        raise BookingConflictError("All gaming computers for this game are currently occupied. Please schedule a reservation for the next open slot.")
                    else:
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
