from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

from dan_restaurant_pos.database.db_utils import connection, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.utils.helpers import money


def record_payment(
    order_id: int,
    method: str,
    amount_paid: Decimal,
    transaction_ref: str | None = None,
    user_id: int | None = None,
) -> int:
    require_permission("payments.record")
    current_user = get_current_user()
    if user_id is None and current_user is not None:
        user_id = int(current_user["id"])
    normalized_method = method.strip().lower()
    if normalized_method == "mpesa":
        normalized_method = "m-pesa"
    if normalized_method not in {"cash", "card", "m-pesa", "other"}:
        raise ValueError("Choose a supported payment method.")
    amount = money(Decimal(str(amount_paid)))
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    with connection() as conn:
        order = run_query(
            conn, "SELECT total, status, table_id FROM orders WHERE id = ?", (order_id,)
        ).fetchone()
        if order is None:
            raise ValueError("Order was not found.")
        if order["status"] in {"cancelled", "paid"}:
            raise ValueError("This order cannot accept another payment.")

        if normalized_method == "m-pesa":
            pending = run_query(
                conn,
                "SELECT id FROM payments WHERE order_id = ? AND method = 'm-pesa' "
                "AND status = 'pending'",
                (order_id,),
            ).fetchone()
            if pending is not None:
                raise ValueError("This order already has a pending M-Pesa confirmation.")

        paid_row = run_query(
            conn,
            "SELECT COALESCE(SUM(amount_paid), 0) AS paid FROM payments "
            "WHERE order_id = ? AND status = 'paid'",
            (order_id,),
        ).fetchone()
        paid_before = Decimal(str(paid_row["paid"] or 0))
        due = max(Decimal(str(order["total"])) - paid_before, Decimal("0"))
        payment_status = (
            "paid"
            if normalized_method != "m-pesa" and amount >= due
            else "pending"
        )
        payment = run_query(
            conn,
            "INSERT INTO payments "
            "(order_id, method, amount_paid, transaction_ref, status, paid_at) "
            "VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE NULL END) "
            "RETURNING id",
            (
                order_id,
                normalized_method,
                str(amount),
                transaction_ref.strip() if transaction_ref else None,
                payment_status,
                payment_status,
            ),
        ).fetchone()
        payment_id = int(payment["id"])
        if payment_status == "paid":
            run_query(conn, "UPDATE orders SET status = 'paid' WHERE id = ?", (order_id,))
            if order["table_id"] is not None:
                run_query(
                    conn,
                    "UPDATE restaurant_tables SET status = 'available' WHERE id = ?",
                    (order["table_id"],),
                )
            items = run_query(
                conn,
                "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
                (order_id,),
            ).fetchall()
            for item in items:
                product_id = item["product_id"]
                quantity = item["quantity"]
                result = run_query(
                    conn,
                    "UPDATE products SET stock_quantity = stock_quantity - ? "
                    "WHERE id = ? AND stock_quantity >= ?",
                    (quantity, product_id, quantity),
                )
                if result.rowcount == 0:
                    raise ValueError("Insufficient stock to complete this order.")
                run_query(
                    conn,
                    "INSERT INTO inventory_movements "
                    "(product_id, quantity, movement_type, reason, user_id, related_order_id) "
                    "VALUES (?, ?, 'sale', 'Paid order', ?, ?)",
                    (product_id, quantity, user_id, order_id),
                )
            run_query(
                conn,
                "INSERT INTO invoices (invoice_number, order_id) VALUES (?, ?) "
                "ON CONFLICT (order_id) DO NOTHING",
                (f"INV-{uuid4().hex[:12].upper()}", order_id),
            )
        record_audit(
            conn,
            "record",
            "payment",
            payment_id,
            {
                "order_id": order_id,
                "method": normalized_method,
                "amount": amount,
                "status": payment_status,
            },
        )
        return payment_id
