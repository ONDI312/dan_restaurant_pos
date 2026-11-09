from __future__ import annotations

import sqlite3
from decimal import Decimal
from uuid import uuid4

from dan_restaurant_pos.database.db_utils import connection, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.helpers import money


def calculate_order_totals(
    subtotal: Decimal, discount_pct: Decimal, vat_pct: Decimal, service_pct: Decimal
) -> dict[str, Decimal]:
    for label, rate in (
        ("Discount", discount_pct),
        ("VAT", vat_pct),
        ("Service charge", service_pct),
    ):
        if rate < 0 or rate > 100:
            raise ValueError(f"{label} percentage must be between 0 and 100.")
    if subtotal < 0:
        raise ValueError("Subtotal cannot be negative.")
    discount_amount = subtotal * (discount_pct / Decimal("100"))
    vat_amount = (subtotal - discount_amount) * (vat_pct / Decimal("100"))
    service_amount = (subtotal - discount_amount + vat_amount) * (service_pct / Decimal("100"))
    total = subtotal - discount_amount + vat_amount + service_amount
    return {
        "discount_amount": money(discount_amount),
        "vat_amount": money(vat_amount),
        "service_amount": money(service_amount),
        "total": money(total),
    }


def add_order(
    order_type: str,
    items: list[dict],
    created_by: int | None,
    table_id: int | None = None,
    discount_pct: Decimal = Decimal("0"),
    vat_pct: Decimal = Decimal("0"),
    service_pct: Decimal = Decimal("0"),
    currency: str = "USD",
) -> int:
    require_permission("orders.create")
    current_user = get_current_user()
    if created_by is None and current_user is not None:
        created_by = int(current_user["id"])
    if order_type not in {"dine_in", "take_away"}:
        raise ValueError("Order type must be dine-in or take-away.")
    if order_type == "dine_in" and table_id is None:
        raise ValueError("Select a table for dine-in orders.")
    currency = currency.strip().upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise ValueError("Currency must be a three-letter code.")
    if not items:
        raise ValueError("An order must contain at least one product.")

    normalized_items: list[dict] = []
    subtotal = Decimal("0")
    for item in items:
        quantity = int(item["quantity"])
        unit_price = Decimal(str(item["unit_price"]))
        if quantity <= 0 or unit_price < 0:
            raise ValueError("Order quantities and prices must be valid.")
        line_total = money(unit_price * quantity)
        subtotal += line_total
        normalized_items.append(
            {
                "product_id": int(item["product_id"]),
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": line_total,
            }
        )

    subtotal = money(subtotal)
    totals = calculate_order_totals(subtotal, discount_pct, vat_pct, service_pct)
    order_number = f"ORD-{uuid4().hex[:12].upper()}"
    with connection() as conn:
        if order_type == "dine_in":
            table_query = (
                "SELECT status, is_active FROM restaurant_tables WHERE id = ?"
            )
            if not isinstance(conn, sqlite3.Connection):
                table_query += " FOR UPDATE"
            table = run_query(conn, table_query, (table_id,)).fetchone()
            if (
                table is None
                or table["status"] != "available"
                or not table["is_active"]
            ):
                raise ValueError("The selected table is not available.")
        order_row = run_query(
            conn,
            "INSERT INTO orders "
            "(order_number, order_type, table_id, subtotal, currency, discount_pct, discount_amount, "
            "vat_pct, vat_amount, service_pct, service_amount, total, status, kitchen_status, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 'pending', ?) RETURNING id",
            (
                order_number,
                order_type,
                table_id,
                str(subtotal),
                currency,
                str(discount_pct),
                str(totals["discount_amount"]),
                str(vat_pct),
                str(totals["vat_amount"]),
                str(service_pct),
                str(totals["service_amount"]),
                str(totals["total"]),
                created_by,
            ),
        ).fetchone()
        order_id = int(order_row["id"])
        for item in normalized_items:
            product = run_query(
                conn,
                "SELECT cost_price FROM products WHERE id = ?",
                (item["product_id"],),
            ).fetchone()
            if product is None:
                raise ValueError("A product in this order was not found.")
            run_query(
                conn,
                "INSERT INTO order_items "
                "(order_id, product_id, quantity, unit_price, unit_cost, line_total) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    order_id,
                    item["product_id"],
                    item["quantity"],
                    str(item["unit_price"]),
                    str(product["cost_price"]),
                    str(item["line_total"]),
                ),
            )
        if order_type == "dine_in":
            result = run_query(
                conn,
                "UPDATE restaurant_tables SET status = 'occupied' "
                "WHERE id = ? AND status = 'available'",
                (table_id,),
            )
            if result.rowcount == 0:
                raise ValueError("The selected table is no longer available.")
        record_audit(
            conn,
            "create",
            "order",
            order_id,
            {"order_number": order_number, "currency": currency, "total": totals["total"]},
        )
        return order_id


def cancel_order(order_id: int) -> None:
    require_permission("orders.cancel")
    with connection() as conn:
        order = run_query(
            conn,
            "SELECT status, kitchen_status, table_id FROM orders WHERE id = ?",
            (order_id,),
        ).fetchone()
        if order is None:
            raise ValueError("Order was not found.")
        if order["status"] != "open" or order["kitchen_status"] in {"ready", "completed"}:
            raise ValueError("Only unpaid orders not yet ready can be cancelled.")
        run_query(conn, "UPDATE orders SET status = 'cancelled' WHERE id = ?", (order_id,))
        if order["table_id"] is not None:
            run_query(
                conn,
                "UPDATE restaurant_tables SET status = 'available' WHERE id = ?",
                (order["table_id"],),
            )
        record_audit(conn, "cancel", "order", order_id)
