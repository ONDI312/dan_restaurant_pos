from __future__ import annotations

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.audit_service import record_audit

NEXT_STATUS = {
    "pending": "preparing",
    "preparing": "ready",
    "ready": "completed",
}


def list_kitchen_tickets():
    require_permission("kitchen.use")
    orders = fetch_all(
        "SELECT o.id, o.order_number, o.order_type, o.created_at, o.kitchen_status, "
        "t.table_name FROM orders o LEFT JOIN restaurant_tables t ON t.id = o.table_id "
        "WHERE o.kitchen_status IN ('pending', 'preparing', 'ready') "
        "AND o.status != 'cancelled' ORDER BY o.created_at, o.id"
    )
    tickets = []
    for order in orders:
        items = fetch_all(
            "SELECT p.name, oi.quantity, oi.special_instructions FROM order_items oi "
            "JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ? ORDER BY oi.id",
            (order["id"],),
        )
        order_data = dict(order)
        order_data["items"] = items
        tickets.append(order_data)
    return tickets


def advance_kitchen_ticket(order_id: int) -> str:
    require_permission("kitchen.use")
    with connection() as conn:
        order = run_query(
            conn,
            "SELECT kitchen_status FROM orders WHERE id = ? AND status != 'cancelled'",
            (order_id,),
        ).fetchone()
        if order is None:
            raise ValueError("Kitchen ticket was not found or was cancelled.")
        current_status = order["kitchen_status"]
        next_status = NEXT_STATUS.get(current_status)
        if next_status is None:
            raise ValueError("This kitchen ticket is already completed.")
        result = run_query(
            conn,
            "UPDATE orders SET kitchen_status = ? WHERE id = ? AND kitchen_status = ?",
            (next_status, order_id, current_status),
        )
        if result.rowcount == 0:
            raise ValueError("The ticket changed while it was being updated. Refresh and retry.")
        record_audit(
            conn,
            "advance",
            "kitchen_ticket",
            order_id,
            {"from": current_status, "to": next_status},
        )
        return next_status
