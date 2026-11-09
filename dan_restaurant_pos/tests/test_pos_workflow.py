from decimal import Decimal
from datetime import date
from pathlib import Path

import pytest

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.database.db_utils import fetch_one
from dan_restaurant_pos.services.catalog_service import create_category, create_product
from dan_restaurant_pos.services.kitchen_service import advance_kitchen_ticket
from dan_restaurant_pos.services.audit_service import list_audit_logs
from dan_restaurant_pos.services.order_service import add_order
from dan_restaurant_pos.services.payment_service import record_payment
from dan_restaurant_pos.services.invoice_service import export_invoice_pdf, get_invoice
from dan_restaurant_pos.services.report_service import (
    export_report_csv,
    get_sales_summary,
    profit_by_product,
)


def test_sale_updates_inventory_and_creates_invoice_after_payment(tmp_path: Path) -> None:
    initialize_application()
    category_id = create_category("Beverages")
    product_id = create_product(
        name="Water",
        category_id=category_id,
        price="10.00",
        cost_price="4.00",
        initial_stock=3,
    )
    order_id = add_order(
        "take_away",
        [{"product_id": product_id, "quantity": 2, "unit_price": Decimal("10.00")}],
        created_by=None,
        currency="KES",
    )
    assert advance_kitchen_ticket(order_id) == "preparing"
    assert advance_kitchen_ticket(order_id) == "ready"
    assert advance_kitchen_ticket(order_id) == "completed"

    record_payment(order_id, "M-Pesa", Decimal("20.00"), "TEST-REF")
    assert fetch_one(
        "SELECT status FROM orders WHERE id = ?", (order_id,)
    )["status"] == "open"
    assert fetch_one(
        "SELECT stock_quantity FROM products WHERE id = ?", (product_id,)
    )["stock_quantity"] == 3
    with pytest.raises(ValueError, match="pending M-Pesa"):
        record_payment(order_id, "M-Pesa", Decimal("20.00"), "DUPLICATE-REF")

    record_payment(order_id, "Cash", Decimal("20.00"))
    assert fetch_one(
        "SELECT status FROM orders WHERE id = ?", (order_id,)
    )["status"] == "paid"
    assert fetch_one(
        "SELECT stock_quantity FROM products WHERE id = ?", (product_id,)
    )["stock_quantity"] == 1
    assert fetch_one(
        "SELECT COUNT(*) AS count FROM inventory_movements "
        "WHERE product_id = ? AND movement_type = 'sale'",
        (product_id,),
    )["count"] == 1
    invoice = fetch_one("SELECT order_id FROM invoices WHERE order_id = ?", (order_id,))
    assert invoice is not None
    assert get_invoice(order_id)["items"][0]["name"] == "Water"
    assert get_invoice(order_id)["invoice"]["currency"] == "KES"
    assert Decimal(str(profit_by_product(date.today(), date.today())[0]["profit"])) == Decimal("12.00")
    pdf_path = export_invoice_pdf(order_id, tmp_path / "receipt.pdf")
    assert pdf_path.is_file()
    summary = get_sales_summary(date.today(), date.today())
    assert summary["order_count"] == 1
    assert Decimal(str(summary["sales_total"])) == Decimal("20.00")
    assert summary["sales_by_currency"][0]["currency"] == "KES"
    assert any(
        record["entity_type"] == "payment" and record["action"] == "record"
        for record in list_audit_logs()
    )
    report_path = export_report_csv(date.today(), date.today(), tmp_path / "report.csv")
    assert "Gross Profit by Product" in report_path.read_text(encoding="utf-8-sig")
