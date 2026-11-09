from __future__ import annotations

from datetime import date, datetime, time, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.graphics.barcode import createBarcodeDrawing
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
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
            "SELECT i.invoice_number, i.issued_at, o.id AS transaction_id, o.order_number, "
            "o.order_type, o.customer_name, o.created_at, o.subtotal, o.discount_amount, "
            "o.vat_amount, o.service_amount, o.total, o.currency, t.table_name, "
            "u.full_name AS cashier FROM invoices i "
            "JOIN orders o ON o.id = i.order_id "
            "LEFT JOIN restaurant_tables t ON t.id = o.table_id "
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
            "SELECT method, amount_paid, transaction_ref, status, paid_at "
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
    currency = invoice["currency"]
    transaction_id = int(invoice["transaction_id"])
    cashier = (invoice.get("cashier") or "—").upper()
    issued_at = invoice["issued_at"]
    if isinstance(issued_at, str):
        try:
            issued_at = datetime.fromisoformat(issued_at.replace("Z", "+00:00"))
        except ValueError:
            issued_at = None
    date_label = issued_at.strftime("%d/%m/%Y %H:%M") if isinstance(issued_at, datetime) else "—"
    payments = data["payments"]
    latest_payment = payments[-1] if payments else {}
    method = str(latest_payment.get("method") or "").upper()
    payment_time = latest_payment.get("paid_at")
    if payment_time and hasattr(payment_time, "strftime"):
        payment_time_label = payment_time.strftime("%d/%m/%Y %H:%M")
    else:
        payment_time_label = "—"
    payment_status = str(latest_payment.get("status") or "PENDING").upper()
    payment_reference = str(latest_payment.get("transaction_ref") or f"REF {transaction_id}")
    page_height = (195 + len(data["items"]) * 8 + len(payments) * 6) * mm
    document = SimpleDocTemplate(
        str(path), pagesize=(80 * mm, page_height),
        leftMargin=4 * mm, rightMargin=4 * mm, topMargin=5 * mm, bottomMargin=5 * mm,
    )
    styles = getSampleStyleSheet()
    center = styles["Normal"].clone("ReceiptCenter")
    center.fontName = "Courier-Bold"
    center.fontSize = 9
    center.leading = 12
    center.alignment = 1
    normal = styles["Normal"].clone("ReceiptNormal")
    normal.fontName = "Courier"
    normal.fontSize = 8
    normal.leading = 11
    bold = styles["Normal"].clone("ReceiptBold")
    bold.fontName = "Courier-Bold"
    bold.fontSize = 8
    bold.leading = 11
    story = [
        Paragraph("DINEFINE RESTAURANT", center),
        Paragraph("123 CULINARY AVENUE<br/>DOWNTOWN DISTRICT", center),
        Paragraph("PHONE: (555) 123-4567", center),
        Paragraph("WWW.DINEFINE.COM", center),
        Spacer(1, 3 * mm),
        HRFlowable(width="100%", thickness=0.7, color=colors.black),
        Spacer(1, 2 * mm),
        Paragraph(date_label, center),
    ]
    metadata = [
        [Paragraph(f"RECEIPT: #R-{transaction_id}", normal), Paragraph(f"TABLE: {escape(str(invoice.get('table_name') or '—'))}", normal)],
        [Paragraph(f"SERVER: {escape(cashier)}", normal), Paragraph("GUESTS: —", normal)],
    ]
    meta_table = Table(metadata, colWidths=[36 * mm, 36 * mm])
    meta_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.extend([meta_table, Spacer(1, 2 * mm), HRFlowable(width="100%", thickness=0.7, color=colors.black), Spacer(1, 2 * mm)])
    item_rows = []
    for item in data["items"]:
        name = escape(str(item["name"]).upper())
        item_rows.append([
            Paragraph(f"{item['quantity']}X {name}", normal),
            Paragraph(f"{currency} {item['line_total']:.2f}", bold),
        ])
    items_table = Table(item_rows, colWidths=[52 * mm, 20 * mm])
    items_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.extend([items_table, Spacer(1, 2 * mm), HRFlowable(width="100%", thickness=0.7, color=colors.black), Spacer(1, 2 * mm)])
    financial_rows = [
        [Paragraph("SUBTOTAL:", normal), Paragraph(f"{currency} {invoice['subtotal']:.2f}", normal)],
    ]
    if invoice["discount_amount"]:
        financial_rows.append([Paragraph("DISCOUNT:", normal), Paragraph(f"-{currency} {invoice['discount_amount']:.2f}", normal)])
    financial_rows.append([Paragraph("TAX:", normal), Paragraph(f"{currency} {invoice['vat_amount']:.2f}", normal)])
    if invoice["service_amount"]:
        financial_rows.append([Paragraph("SERVICE:", normal), Paragraph(f"{currency} {invoice['service_amount']:.2f}", normal)])
    financial_rows.append([Paragraph("<b>TOTAL:</b>", bold), Paragraph(f"<b>{currency} {invoice['total']:.2f}</b>", bold)])
    financial_table = Table(financial_rows, colWidths=[52 * mm, 20 * mm])
    financial_table.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1), ("LINEABOVE", (0, -1), (-1, -1), 0.7, colors.black),
    ]))
    story.extend([financial_table, Spacer(1, 2 * mm), HRFlowable(width="100%", thickness=0.7, color=colors.black), Spacer(1, 2 * mm)])
    if method == "CARD":
        card_label, type_label = "NOT CAPTURED", "CARD"
    else:
        card_label, type_label = "NOT CAPTURED", method or "NOT CAPTURED"
    payment_rows = [
        [Paragraph("CARD:", normal), Paragraph(escape(card_label), normal)],
        [Paragraph("TYPE:", normal), Paragraph(escape(type_label), normal)],
        [Paragraph("ENTRY:", normal), Paragraph("NOT RECORDED", normal)],
        [Paragraph("TIME:", normal), Paragraph(payment_time_label, normal)],
        [Paragraph("REF:", normal), Paragraph(escape(payment_reference), normal)],
        [Paragraph("STATUS:", normal), Paragraph(escape(payment_status), bold)],
    ]
    payment_table = Table(payment_rows, colWidths=[20 * mm, 52 * mm])
    payment_table.setStyle(TableStyle([
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    story.extend([
        payment_table, Spacer(1, 3 * mm),
        Paragraph("TIP IS NOT INCLUDED.<br/>PLEASE COME AGAIN!", center),
        Spacer(1, 4 * mm), Paragraph("THANK YOU FOR DINING WITH US!", center),
        Spacer(1, 2 * mm),
    ])
    barcode = createBarcodeDrawing("Code128", value=str(transaction_id), barHeight=12 * mm, humanReadable=True)
    barcode.hAlign = "CENTER"
    story.append(barcode)
    document.build(story)
    return path
