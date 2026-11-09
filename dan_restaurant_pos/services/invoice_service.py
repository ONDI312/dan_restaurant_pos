from __future__ import annotations

from datetime import date, datetime, time, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

from dan_restaurant_pos.database.db_utils import connection, fetch_all, fetch_one, run_query
from dan_restaurant_pos.services.access_control import require_permission
from dan_restaurant_pos.services.settings_service import get_settings


def list_invoices(start_date: date | None = None, end_date: date | None = None):
    require_permission("invoices.view")
    query = (
        "SELECT i.id, i.invoice_number, i.order_id, i.issued_at, o.total, o.currency, o.status, "
        "u.full_name AS cashier, "
        "(SELECT method FROM payments p WHERE p.order_id = o.id AND p.status = 'paid' "
        "ORDER BY p.id DESC LIMIT 1) AS payment_method "
        "FROM invoices i JOIN orders o ON o.id = i.order_id "
        "LEFT JOIN users u ON u.id = o.created_by WHERE 1 = 1"
    )
    params: list[str] = []
    if start_date:
        start = datetime.combine(start_date, time.min).strftime("%Y-%m-%d %H:%M:%S")
        query += " AND i.issued_at >= ?"
        params.append(start)
    if end_date:
        end = datetime.combine(end_date + timedelta(days=1), time.min).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        query += " AND i.issued_at < ?"
        params.append(end)
    query += " ORDER BY i.issued_at DESC, i.id DESC"
    return fetch_all(query, params)


def get_invoice(order_id: int) -> dict:
    require_permission("invoices.view")
    with connection() as conn:
        invoice = run_query(
            conn,
            "SELECT i.invoice_number, i.issued_at, o.order_number, o.order_type, "
            "o.subtotal, o.discount_amount, o.vat_amount, o.service_amount, o.total, o.currency, "
            "u.full_name AS cashier FROM invoices i "
            "JOIN orders o ON o.id = i.order_id "
            "LEFT JOIN users u ON u.id = o.created_by WHERE o.id = ?",
            (order_id,),
        ).fetchone()
        if invoice is None:
            raise ValueError("Invoice was not found.")
        items = run_query(
            conn,
            "SELECT p.name, oi.quantity, oi.unit_price, oi.line_total "
            "FROM order_items oi JOIN products p ON p.id = oi.product_id "
            "WHERE oi.order_id = ? ORDER BY oi.id",
            (order_id,),
        ).fetchall()
        payments = run_query(
            conn,
            "SELECT method, amount_paid, transaction_ref, status "
            "FROM payments WHERE order_id = ? ORDER BY id",
            (order_id,),
        ).fetchall()
        result = {
            "invoice": dict(invoice),
            "items": [dict(item) for item in items],
            "payments": [dict(payment) for payment in payments],
        }
    return {**result, "merchant": get_settings()}


def export_invoice_pdf(order_id: int, output_path: str | Path) -> Path:
    data = get_invoice(order_id)
    invoice = data["invoice"]
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(path), pagesize=A4)
    styles = getSampleStyleSheet()
    currency = invoice["currency"]
    merchant = data["merchant"]
    story = [
        Paragraph(escape(merchant["restaurant_name"]), styles["Title"]),
        Paragraph(escape(merchant["address"]), styles["Normal"]),
        Paragraph(
            escape(" | ".join(value for value in (merchant["phone"], merchant["email"]) if value)),
            styles["Normal"],
        ),
        Paragraph(f"Invoice: {invoice['invoice_number']}", styles["Normal"]),
        Paragraph(f"Order: {invoice['order_number']}", styles["Normal"]),
        Paragraph(f"Date: {invoice['issued_at']}", styles["Normal"]),
        Paragraph(f"Cashier: {invoice['cashier'] or 'N/A'}", styles["Normal"]),
        Spacer(1, 8 * mm),
    ]
    rows = [["Item", "Qty", "Unit price", "Total"]]
    for item in data["items"]:
        rows.append(
            [
                escape(item["name"]),
                str(item["quantity"]),
                f"{currency} {item['unit_price']:.2f}",
                f"{currency} {item['line_total']:.2f}",
            ]
        )
    rows.extend(
        [
            ["Subtotal", "", "", f"{currency} {invoice['subtotal']:.2f}"],
            ["Discount", "", "", f"{currency} {invoice['discount_amount']:.2f}"],
            ["VAT", "", "", f"{currency} {invoice['vat_amount']:.2f}"],
            ["Service charge", "", "", f"{currency} {invoice['service_amount']:.2f}"],
            ["Grand total", "", "", f"{currency} {invoice['total']:.2f}"],
        ]
    )
    table = Table(rows, repeatRows=1, colWidths=[80 * mm, 18 * mm, 38 * mm, 38 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#B34700")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E7CDBB")),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#FFF1E6")),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 6 * mm))
    for payment in data["payments"]:
        story.append(
            Paragraph(
                f"Payment: {payment['method']} - {currency} {payment['amount_paid']:.2f} "
                f"({payment['status']})",
                styles["Normal"],
            )
        )
    story.append(Spacer(1, 6 * mm))
    story.append(Paragraph(escape(merchant["receipt_footer"]), styles["Normal"]))
    document.build(story)
    return path
