from __future__ import annotations

from decimal import Decimal

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.validators import validate_decimal

DEFAULT_SETTINGS = {
    "restaurant_name": "DAN RESTAURANT POS",
    "phone": "",
    "email": "",
    "address": "",
    "currency": "USD",
    "discount_percentage": "0",
    "vat_percentage": "0",
    "service_percentage": "0",
    "receipt_footer": "Thank you for dining with us.",
}


def get_settings() -> dict[str, str]:
    require_permission("settings.read")
    values = DEFAULT_SETTINGS.copy()
    for row in fetch_all("SELECT key, value FROM settings"):
        if row["value"] is not None:
            values[row["key"]] = row["value"]
    return values


def save_settings(values: dict[str, str]) -> None:
    require_permission("settings.manage")
    merged = DEFAULT_SETTINGS | {
        key: str(value).strip() for key, value in values.items()
    }
    if not merged["restaurant_name"]:
        raise ValueError("Restaurant name is required.")
    currency = merged["currency"].upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise ValueError("Currency must be a three-letter code.")
    merged["currency"] = currency
    for key in ("discount_percentage", "vat_percentage", "service_percentage"):
        value = validate_decimal(merged[key])
        if value > Decimal("100"):
            raise ValueError(f"{key.replace('_', ' ').title()} cannot exceed 100.")
    with connection() as conn:
        for key, value in merged.items():
            run_query(
                conn,
                "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) "
                "ON CONFLICT (key) DO UPDATE SET value = excluded.value, "
                "updated_at = CURRENT_TIMESTAMP",
                (key, value),
            )
        record_audit(conn, "update", "settings", None, {"keys": sorted(merged)})
