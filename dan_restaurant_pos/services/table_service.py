from __future__ import annotations

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.audit_service import record_audit


def list_tables(include_inactive: bool = False):
    require_permission("tables.read")
    return fetch_all(
        "SELECT id, table_name, capacity, status, is_active FROM restaurant_tables "
        "WHERE (? = TRUE OR is_active = TRUE) ORDER BY table_name",
        (include_inactive,),
    )


def create_table(table_name: str, capacity: int) -> int:
    require_permission("tables.manage")
    clean_name = table_name.strip()
    if not clean_name:
        raise ValueError("Table name is required.")
    if capacity < 1:
        raise ValueError("Table capacity must be at least one.")
    with connection() as conn:
        row = run_query(
            conn,
            "INSERT INTO restaurant_tables (table_name, capacity) VALUES (?, ?) RETURNING id",
            (clean_name, capacity),
        ).fetchone()
        table_id = int(row["id"])
        record_audit(
            conn,
            "create",
            "table",
            table_id,
            {"name": clean_name, "capacity": capacity},
        )
        return table_id


def update_table(table_id: int, table_name: str, capacity: int) -> None:
    require_permission("tables.manage")
    clean_name = table_name.strip()
    if not clean_name:
        raise ValueError("Table name is required.")
    if capacity < 1:
        raise ValueError("Table capacity must be at least one.")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE restaurant_tables SET table_name = ?, capacity = ? WHERE id = ?",
            (clean_name, capacity, table_id),
        )
        if result.rowcount == 0:
            raise ValueError("Table was not found.")
        record_audit(
            conn,
            "update",
            "table",
            table_id,
            {"name": clean_name, "capacity": capacity},
        )


def deactivate_table(table_id: int) -> None:
    require_permission("tables.manage")
    with connection() as conn:
        table = run_query(
            conn, "SELECT status FROM restaurant_tables WHERE id = ?", (table_id,)
        ).fetchone()
        if table is None:
            raise ValueError("Table was not found.")
        if table["status"] == "occupied":
            raise ValueError("An occupied table cannot be deactivated.")
        run_query(
            conn,
            "UPDATE restaurant_tables SET is_active = FALSE WHERE id = ?",
            (table_id,),
        )
        record_audit(conn, "deactivate", "table", table_id)
