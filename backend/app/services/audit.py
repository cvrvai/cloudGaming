"""Audit Logging Service for Security & Admin Operations."""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.db import get_db

logger = logging.getLogger("audit")


def record_audit_event(
    action: str,
    actor_user_id: Optional[int] = None,
    role: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    ip: Optional[str] = None,
    result: str = "SUCCESS",
    details: Optional[str] = None,
) -> None:
    """Record an audit trail event in the database (NFR-01, Security)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO audit_logs (timestamp, actor_user_id, role, action, target_type, target_id, ip, result, details)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    now_iso,
                    actor_user_id,
                    role,
                    action,
                    target_type,
                    str(target_id) if target_id is not None else None,
                    ip,
                    result,
                    details,
                ),
            )
            conn.commit()
    except Exception as e:
        logger.error("Failed to record audit event '%s': %s", action, e)
