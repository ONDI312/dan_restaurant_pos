from __future__ import annotations

import os
from datetime import datetime, timezone

from dan_restaurant_pos.database.db_utils import execute, fetch_one
from dan_restaurant_pos.services.access_control import set_current_user
from dan_restaurant_pos.utils.security import hash_pin, verify_pin


def ensure_default_admin(initial_pin: str) -> str | None:
    role = fetch_one("SELECT id FROM roles WHERE name = 'Admin'")
    if role is None:
        raise RuntimeError("The Admin role is missing from the database.")
    if fetch_one("SELECT id FROM users WHERE username = 'admin'") is not None:
        return None
    pin = os.getenv("ADMIN_SETUP_PIN") or initial_pin
    execute(
        "INSERT INTO users (username, full_name, role_id, pin_hash, is_active) VALUES (?, ?, ?, ?, TRUE)",
        ("admin", "System Administrator", role["id"], hash_pin(pin)),
    )
    return pin if not os.getenv("ADMIN_SETUP_PIN") else None


def authenticate_user(username: str, pin: str):
    row = fetch_one(
        "SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ? AND u.is_active = TRUE",
        (username,),
    )
    if row is None:
        return None
    if not verify_pin(pin, row["pin_hash"]):
        return None
    execute(
        "UPDATE users SET last_login = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), row["id"]),
    )
    user = {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["full_name"],
        "role_name": row["role_name"],
    }
    set_current_user(user)
    return user
