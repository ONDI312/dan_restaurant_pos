from __future__ import annotations

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.security import hash_pin
from dan_restaurant_pos.utils.validators import validate_pin


def list_roles():
    require_permission("users.manage")
    return fetch_all("SELECT id, name FROM roles ORDER BY name")


def list_users():
    require_permission("users.manage")
    return fetch_all(
        "SELECT u.id, u.username, u.full_name, u.is_active, u.last_login, "
        "r.name AS role_name, u.role_id FROM users u "
        "JOIN roles r ON r.id = u.role_id ORDER BY u.username"
    )


def create_user(username: str, full_name: str, role_id: int, pin: str) -> int:
    require_permission("users.manage")
    clean_username = username.strip()
    clean_name = full_name.strip()
    if not clean_username or not clean_name:
        raise ValueError("Username and full name are required.")
    validate_pin(pin)
    with connection() as conn:
        row = run_query(
            conn,
            "INSERT INTO users (username, full_name, role_id, pin_hash) "
            "VALUES (?, ?, ?, ?) RETURNING id",
            (clean_username, clean_name, role_id, hash_pin(pin)),
        ).fetchone()
        user_id = int(row["id"])
        record_audit(conn, "create", "user", user_id, {"username": clean_username})
        return user_id


def update_user(user_id: int, full_name: str, role_id: int) -> None:
    require_permission("users.manage")
    clean_name = full_name.strip()
    if not clean_name:
        raise ValueError("Full name is required.")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE users SET full_name = ?, role_id = ? WHERE id = ?",
            (clean_name, role_id, user_id),
        )
        if result.rowcount == 0:
            raise ValueError("User was not found.")
        record_audit(conn, "update", "user", user_id, {"full_name": clean_name})


def reset_user_pin(user_id: int, pin: str) -> None:
    require_permission("users.manage")
    validate_pin(pin)
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE users SET pin_hash = ? WHERE id = ?",
            (hash_pin(pin), user_id),
        )
        if result.rowcount == 0:
            raise ValueError("User was not found.")
        record_audit(conn, "reset_pin", "user", user_id)


def set_user_active(user_id: int, is_active: bool) -> None:
    require_permission("users.manage")
    with connection() as conn:
        result = run_query(
            conn, "UPDATE users SET is_active = ? WHERE id = ?", (is_active, user_id)
        )
        if result.rowcount == 0:
            raise ValueError("User was not found.")
        record_audit(
            conn,
            "activate" if is_active else "deactivate",
            "user",
            user_id,
        )
