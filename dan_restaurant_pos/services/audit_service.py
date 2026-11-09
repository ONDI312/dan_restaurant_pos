from __future__ import annotations

import json

from dan_restaurant_pos.database.db_utils import fetch_all, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission


def record_audit(
    conn,
    action: str,
    entity_type: str,
    entity_id: int | str | None,
    details: dict | None = None,
) -> None:
    user = get_current_user()
    user_id = int(user["id"]) if user is not None else None
    run_query(
        conn,
        "INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            user_id,
            action,
            entity_type,
            str(entity_id) if entity_id is not None else None,
            json.dumps(details or {}, default=str, sort_keys=True),
        ),
    )


def list_audit_logs(limit: int = 500):
    require_permission("audit.read")
    if limit < 1 or limit > 1000:
        raise ValueError("Audit log limit must be between 1 and 1000.")
    return fetch_all(
        "SELECT a.id, a.created_at, u.username, a.action, a.entity_type, "
        "a.entity_id, a.details FROM audit_logs a "
        "LEFT JOIN users u ON u.id = a.user_id "
        "ORDER BY a.created_at DESC, a.id DESC LIMIT ?",
        (limit,),
    )
