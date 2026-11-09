from __future__ import annotations

from decimal import Decimal

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.helpers import money


def list_purchases():
    require_permission("purchases.read")
    return fetch_all(
        "SELECT p.id, p.invoice_ref, p.total_amount, p.status, p.created_at, "
        "s.name AS supplier_name FROM purchases p "
        "LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC, p.id DESC"
    )


def create_purchase(
    supplier_id: int,
    invoice_ref: str,
    items: list[dict],
) -> int:
    require_permission("purchases.manage")
    if not items:
        raise ValueError("A purchase must contain at least one product.")
    normalized_items = []
    total = Decimal("0")
    for item in items:
        quantity = int(item["quantity"])
        unit_cost = Decimal(str(item["unit_cost"]))
        if quantity <= 0 or unit_cost < 0:
            raise ValueError("Purchase quantities and costs must be valid.")
        line_total = money(unit_cost * quantity)
        total += line_total
        normalized_items.append(
            (int(item["product_id"]), quantity, unit_cost, line_total)
        )
    with connection() as conn:
        supplier = run_query(
            conn,
            "SELECT id FROM suppliers WHERE id = ? AND is_active = TRUE",
            (supplier_id,),
        ).fetchone()
        if supplier is None:
            raise ValueError("Select an active supplier.")
        purchase = run_query(
            conn,
            "INSERT INTO purchases (supplier_id, invoice_ref, total_amount, status) "
            "VALUES (?, ?, ?, 'draft') RETURNING id",
            (supplier_id, invoice_ref.strip() or None, str(money(total))),
        ).fetchone()
        purchase_id = int(purchase["id"])
        for product_id, quantity, unit_cost, line_total in normalized_items:
            run_query(
                conn,
                "INSERT INTO purchase_items "
                "(purchase_id, product_id, quantity, unit_cost, line_total) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    purchase_id,
                    product_id,
                    quantity,
                    str(unit_cost),
                    str(line_total),
                ),
            )
        record_audit(
            conn,
            "create",
            "purchase",
            purchase_id,
            {"supplier_id": supplier_id, "total": money(total)},
        )
        return purchase_id


def finalize_purchase(purchase_id: int, user_id: int | None = None) -> None:
    require_permission("purchases.manage")
    current_user = get_current_user()
    if user_id is None and current_user is not None:
        user_id = int(current_user["id"])
    with connection() as conn:
        purchase = run_query(
            conn,
            "SELECT status, invoice_ref FROM purchases WHERE id = ?",
            (purchase_id,),
        ).fetchone()
        if purchase is None:
            raise ValueError("Purchase was not found.")
        if purchase["status"] != "draft":
            raise ValueError("Only draft purchases can be finalized.")
        result = run_query(
            conn,
            "UPDATE purchases SET status = 'finalized' WHERE id = ? AND status = 'draft'",
            (purchase_id,),
        )
        if result.rowcount == 0:
            raise ValueError("This purchase was already finalized.")
        items = run_query(
            conn,
            "SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?",
            (purchase_id,),
        ).fetchall()
        if not items:
            raise ValueError("Purchase has no line items.")
        reason = f"Purchase {purchase['invoice_ref'] or purchase_id}"
        for item in items:
            updated = run_query(
                conn,
                "UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?",
                (item["quantity"], item["product_id"]),
            )
            if updated.rowcount == 0:
                raise ValueError("A purchase product no longer exists.")
            run_query(
                conn,
                "INSERT INTO inventory_movements "
                "(product_id, quantity, movement_type, reason, user_id, related_purchase_id) "
                "VALUES (?, ?, 'purchase', ?, ?, ?)",
                (
                    item["product_id"],
                    item["quantity"],
                    reason,
                    user_id,
                    purchase_id,
                ),
            )
        record_audit(conn, "finalize", "purchase", purchase_id)


def cancel_purchase(purchase_id: int) -> None:
    require_permission("purchases.manage")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE purchases SET status = 'cancelled' WHERE id = ? AND status = 'draft'",
            (purchase_id,),
        )
        if result.rowcount == 0:
            raise ValueError("Only draft purchases can be cancelled.")
        record_audit(conn, "cancel", "purchase", purchase_id)
