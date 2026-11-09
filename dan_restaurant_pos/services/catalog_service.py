from __future__ import annotations

from decimal import Decimal

from dan_restaurant_pos.database.db_utils import connection, fetch_all, fetch_one, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.validators import validate_decimal


def list_categories():
    require_permission("catalog.read")
    return fetch_all("SELECT id, name, image_path FROM categories ORDER BY name")


def create_category(name: str, image_path: str | None = None) -> int:
    require_permission("catalog.manage")
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Category name is required.")
    with connection() as conn:
        row = run_query(
            conn,
            "INSERT INTO categories (name, image_path) VALUES (?, ?) RETURNING id",
            (clean_name, image_path),
        ).fetchone()
        category_id = int(row["id"])
        record_audit(conn, "create", "category", category_id, {"name": clean_name})
        return category_id


def update_category(
    category_id: int, name: str, image_path: str | None = None
) -> None:
    require_permission("catalog.manage")
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Category name is required.")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE categories SET name = ?, image_path = COALESCE(?, image_path) WHERE id = ?",
            (clean_name, image_path, category_id),
        )
        if result.rowcount == 0:
            raise ValueError("Category was not found.")
        record_audit(conn, "update", "category", category_id, {"name": clean_name})


def delete_category(category_id: int) -> None:
    require_permission("catalog.manage")
    if fetch_one("SELECT id FROM products WHERE category_id = ?", (category_id,)):
        raise ValueError("This category still has products. Reassign them before deleting it.")
    with connection() as conn:
        result = run_query(conn, "DELETE FROM categories WHERE id = ?", (category_id,))
        if result.rowcount == 0:
            raise ValueError("Category was not found.")
        record_audit(conn, "delete", "category", category_id)


def list_products(
    category_id: int | None = None, search: str = "", include_unavailable: bool = False
):
    require_permission("catalog.read")
    query = (
        "SELECT p.id, p.name, p.barcode, p.price, p.stock_quantity, p.min_stock, "
        "p.is_available, p.category_id, p.image_path, c.name AS category_name "
        "FROM products p JOIN categories c ON c.id = p.category_id "
        "WHERE (? = TRUE OR p.is_available = TRUE)"
    )
    params: list[object] = [include_unavailable]
    if category_id is not None:
        query += " AND p.category_id = ?"
        params.append(category_id)
    if search.strip():
        query += " AND (LOWER(p.name) LIKE LOWER(?) OR LOWER(p.barcode) LIKE LOWER(?))"
        term = f"%{search.strip()}%"
        params.extend((term, term))
    query += " ORDER BY p.name"
    return fetch_all(query, params)


def create_product(
    *,
    name: str,
    category_id: int,
    price: str,
    barcode: str = "",
    initial_stock: int = 0,
    min_stock: int = 0,
    cost_price: str = "0",
    image_path: str | None = None,
    user_id: int | None = None,
) -> int:
    require_permission("catalog.manage")
    current_user = get_current_user()
    if user_id is None and current_user is not None:
        user_id = int(current_user["id"])
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Product name is required.")
    if initial_stock < 0 or min_stock < 0:
        raise ValueError("Stock values cannot be negative.")
    parsed_price = validate_decimal(price)
    parsed_cost = validate_decimal(cost_price)
    if parsed_price <= Decimal("0"):
        raise ValueError("Selling price must be greater than zero.")
    with connection() as conn:
        row = run_query(
            conn,
            "INSERT INTO products "
            "(category_id, name, barcode, price, cost_price, stock_quantity, min_stock, is_available, image_path) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?) RETURNING id",
            (
                category_id,
                clean_name,
                barcode.strip() or None,
                str(parsed_price),
                str(parsed_cost),
                initial_stock,
                min_stock,
                image_path,
            ),
        ).fetchone()
        product_id = int(row["id"])
        if initial_stock:
            run_query(
                conn,
                "INSERT INTO inventory_movements "
                "(product_id, quantity, movement_type, reason, user_id) "
                "VALUES (?, ?, 'stock_addition', 'Initial stock', ?)",
                (product_id, initial_stock, user_id),
            )
        record_audit(conn, "create", "product", product_id, {"name": clean_name})
        return product_id


def update_product(
    product_id: int,
    *,
    name: str,
    category_id: int,
    price: str,
    barcode: str = "",
    min_stock: int = 0,
    cost_price: str = "0",
    is_available: bool = True,
    image_path: str | None = None,
) -> None:
    require_permission("catalog.manage")
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Product name is required.")
    if min_stock < 0:
        raise ValueError("Minimum stock cannot be negative.")
    parsed_price = validate_decimal(price)
    parsed_cost = validate_decimal(cost_price)
    if parsed_price <= Decimal("0"):
        raise ValueError("Selling price must be greater than zero.")
    with connection() as conn:
        result = run_query(
            conn,
            "UPDATE products SET name = ?, category_id = ?, price = ?, barcode = ?, "
            "min_stock = ?, cost_price = ?, is_available = ?, "
            "image_path = COALESCE(?, image_path) WHERE id = ?",
            (
                clean_name,
                category_id,
                str(parsed_price),
                barcode.strip() or None,
                min_stock,
                str(parsed_cost),
                is_available,
                image_path,
                product_id,
            ),
        )
        if result.rowcount == 0:
            raise ValueError("Product was not found.")
        record_audit(conn, "update", "product", product_id, {"name": clean_name})


def deactivate_product(product_id: int) -> None:
    require_permission("catalog.manage")
    with connection() as conn:
        result = run_query(
            conn, "UPDATE products SET is_available = FALSE WHERE id = ?", (product_id,)
        )
        if result.rowcount == 0:
            raise ValueError("Product was not found.")
        record_audit(conn, "deactivate", "product", product_id)
