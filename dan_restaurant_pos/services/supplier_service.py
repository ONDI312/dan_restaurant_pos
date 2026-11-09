from __future__ import annotations

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.audit_service import record_audit


def list_suppliers(include_inactive: bool = False):
    require_permission("suppliers.read")
    return fetch_all(
        "SELECT id, name, contact_person, phone, email, address, is_active "
        "FROM suppliers WHERE (? = TRUE OR is_active = TRUE) ORDER BY name",
        (include_inactive,),
    )


def save_supplier(
    *,
    name: str,
    contact_person: str = "",
    phone: str = "",
    email: str = "",
    address: str = "",
    supplier_id: int | None = None,
) -> int:
    require_permission("suppliers.manage")
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Supplier name is required.")
    values = (
        clean_name,
        contact_person.strip() or None,
        phone.strip() or None,
        email.strip() or None,
        address.strip() or None,
    )
    with connection() as conn:
        if supplier_id is None:
            row = run_query(
                conn,
                "INSERT INTO suppliers (name, contact_person, phone, email, address) "
                "VALUES (?, ?, ?, ?, ?) RETURNING id",
                values,
            ).fetchone()
            supplier_id = int(row["id"])
            record_audit(conn, "create", "supplier", supplier_id, {"name": clean_name})
            return supplier_id
        result = run_query(
            conn,
            "UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, "
            "address = ? WHERE id = ?",
            (*values, supplier_id),
        )
        if result.rowcount == 0:
            raise ValueError("Supplier was not found.")
        record_audit(conn, "update", "supplier", supplier_id, {"name": clean_name})
        return supplier_id


def deactivate_supplier(supplier_id: int) -> None:
    require_permission("suppliers.manage")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE suppliers SET is_active = FALSE WHERE id = ?",
            (supplier_id,),
        )
        if result.rowcount == 0:
            raise ValueError("Supplier was not found.")
        record_audit(conn, "deactivate", "supplier", supplier_id)
