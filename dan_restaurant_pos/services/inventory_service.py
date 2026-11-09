from __future__ import annotations

from dan_restaurant_pos.database.db_utils import connection, fetch_all, fetch_one, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit

ADDITIONS = {"stock_addition", "purchase", "adjustment_add"}
DEDUCTIONS = {"stock_deduction", "damage", "adjustment_deduction"}


def add_inventory_movement(
    product_id: int,
    quantity: int,
    movement_type: str,
    reason: str,
    user_id: int | None = None,
) -> None:
    require_permission("inventory.manage")
    current_user = get_current_user()
    if user_id is None and current_user is not None:
        user_id = int(current_user["id"])
    if quantity <= 0:
        raise ValueError("Movement quantity must be greater than zero.")
    if movement_type not in ADDITIONS | DEDUCTIONS:
        raise ValueError("Choose a supported stock addition or deduction type.")
    clean_reason = reason.strip()
    if not clean_reason:
        raise ValueError("A reason is required for every stock movement.")

    with connection() as conn:
        if movement_type in DEDUCTIONS:
            result = run_query(
                conn,
                "UPDATE products SET stock_quantity = stock_quantity - ? "
                "WHERE id = ? AND stock_quantity >= ?",
                (quantity, product_id, quantity),
            )
            if result.rowcount == 0:
                exists = run_query(
                    conn, "SELECT id FROM products WHERE id = ?", (product_id,)
                ).fetchone()
                if exists is None:
                    raise ValueError("Product was not found.")
                raise ValueError("Stock cannot be reduced below zero.")
        else:
            result = run_query(
                conn,
                "UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?",
                (quantity, product_id),
            )
            if result.rowcount == 0:
                raise ValueError("Product was not found.")
        run_query(
            conn,
            "INSERT INTO inventory_movements "
            "(product_id, quantity, movement_type, reason, user_id) VALUES (?, ?, ?, ?, ?)",
            (product_id, quantity, movement_type, clean_reason, user_id),
        )
        record_audit(
            conn,
            "adjust",
            "inventory",
            product_id,
            {"quantity": quantity, "movement_type": movement_type, "reason": clean_reason},
        )


def get_product_stock(product_id: int) -> int:
    require_permission("inventory.read")
    row = fetch_one("SELECT stock_quantity FROM products WHERE id = ?", (product_id,))
    if row is None:
        raise ValueError("Product was not found.")
    return int(row["stock_quantity"])


def list_inventory(search: str = ""):
    require_permission("inventory.read")
    query = (
        "SELECT p.id, p.name, c.name AS category_name, p.stock_quantity, p.min_stock, "
        "p.cost_price, p.is_available FROM products p "
        "JOIN categories c ON c.id = p.category_id WHERE 1 = 1"
    )
    params: list[str] = []
    if search.strip():
        term = f"%{search.strip()}%"
        query += " AND (LOWER(p.name) LIKE LOWER(?) OR LOWER(p.barcode) LIKE LOWER(?))"
        params.extend((term, term))
    query += " ORDER BY p.name"
    return fetch_all(query, params)


def list_inventory_movements(product_id: int | None = None):
    require_permission("inventory.read")
    query = (
        "SELECT m.id, p.name AS product_name, m.quantity, m.movement_type, m.reason, "
        "m.created_at, u.username FROM inventory_movements m "
        "JOIN products p ON p.id = m.product_id "
        "LEFT JOIN users u ON u.id = m.user_id"
    )
    params: tuple[int, ...] = ()
    if product_id is not None:
        query += " WHERE m.product_id = ?"
        params = (product_id,)
    query += " ORDER BY m.created_at DESC LIMIT 500"
    return fetch_all(query, params)


def list_low_stock_products():
    require_permission("inventory.read")
    return fetch_all(
        "SELECT id, name, stock_quantity, min_stock FROM products "
        "WHERE is_available = TRUE AND stock_quantity <= min_stock ORDER BY stock_quantity, name"
    )
