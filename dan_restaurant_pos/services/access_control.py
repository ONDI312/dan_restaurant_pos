from __future__ import annotations

from contextvars import ContextVar
from typing import Any

_current_user: ContextVar[dict[str, Any] | None] = ContextVar(
    "dan_restaurant_pos_current_user", default=None
)

ROLE_PERMISSIONS = {
    "Admin": {
        "pos.use",
        "catalog.read",
        "catalog.manage",
        "inventory.read",
        "inventory.manage",
        "tables.read",
        "tables.manage",
        "orders.create",
        "orders.cancel",
        "payments.record",
        "kitchen.use",
        "suppliers.read",
        "suppliers.manage",
        "purchases.read",
        "purchases.manage",
        "expenses.read",
        "expenses.manage",
        "invoices.view",
        "reports.view",
        "users.manage",
        "settings.read",
        "settings.manage",
        "audit.read",
        "app.close",
    },
    "Manager": {
        "pos.use",
        "catalog.read",
        "catalog.manage",
        "inventory.read",
        "inventory.manage",
        "tables.read",
        "tables.manage",
        "orders.create",
        "orders.cancel",
        "payments.record",
        "kitchen.use",
        "suppliers.read",
        "suppliers.manage",
        "purchases.read",
        "purchases.manage",
        "expenses.read",
        "expenses.manage",
        "invoices.view",
        "reports.view",
        "settings.read",
        "audit.read",
        "app.close",
    },
    "Cashier": {
        "pos.use",
        "catalog.read",
        "tables.read",
        "orders.create",
        "orders.cancel",
        "payments.record",
        "invoices.view",
        "settings.read",
        "app.close",
    },
    "Kitchen": {"kitchen.use", "app.close"},
}


def set_current_user(user: dict[str, Any] | None) -> None:
    _current_user.set(user)


def get_current_user() -> dict[str, Any] | None:
    return _current_user.get()


def has_permission(permission: str) -> bool:
    user = get_current_user()
    if user is None:
        return False
    return permission in ROLE_PERMISSIONS.get(user.get("role_name", ""), set())


def require_permission(permission: str) -> None:
    if not has_permission(permission):
        user = get_current_user()
        role = user.get("role_name", "Unauthenticated") if user else "Unauthenticated"
        raise PermissionError(f"{role} role is not allowed to perform this action.")
