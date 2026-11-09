from __future__ import annotations

import secrets
import os
from pathlib import Path

from dan_restaurant_pos.database.db_utils import (
    connection,
    execute_script,
    get_database_url,
    run_query,
)
from dan_restaurant_pos.services.access_control import ROLE_PERMISSIONS
from dan_restaurant_pos.services.auth_service import ensure_default_admin
from dan_restaurant_pos.utils.validators import validate_pin

DATABASE_DIR = Path(__file__).resolve().parent


def initialize_application() -> str | None:
    schema_name = (
        "schema.sql" if get_database_url().startswith("sqlite:///") else "schema.postgres.sql"
    )
    execute_script((DATABASE_DIR / schema_name).read_text(encoding="utf-8"))
    _seed_permissions()
    setup_pin = validate_pin(
        os.getenv("ADMIN_SETUP_PIN") or str(secrets.randbelow(100_000_000)).zfill(8)
    )
    return ensure_default_admin(setup_pin)


def _seed_permissions() -> None:
    permission_names = sorted(set().union(*ROLE_PERMISSIONS.values()))
    permission_values = ", ".join("(?)" for _ in permission_names)
    permission_params = tuple(permission_names)
    role_permissions = [
        (role_name, permission_name)
        for role_name, permissions in ROLE_PERMISSIONS.items()
        for permission_name in sorted(permissions)
    ]
    role_selects = " UNION ALL ".join(
        "SELECT (SELECT id FROM roles WHERE name = ?) AS role_id, "
        "(SELECT id FROM permissions WHERE name = ?) AS permission_id"
        for _ in role_permissions
    )
    role_params = tuple(
        value for pair in role_permissions for value in pair
    )
    with connection() as conn:
        run_query(
            conn,
            f"INSERT INTO permissions (name) VALUES {permission_values} "
            "ON CONFLICT (name) DO NOTHING",
            permission_params,
        )
        run_query(
            conn,
            "INSERT INTO role_permissions (role_id, permission_id) "
            f"SELECT role_id, permission_id FROM ({role_selects}) role_permissions "
            "WHERE role_id IS NOT NULL AND permission_id IS NOT NULL "
            "ON CONFLICT (role_id, permission_id) DO NOTHING",
            role_params,
        )
