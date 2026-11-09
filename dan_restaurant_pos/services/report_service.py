from __future__ import annotations

import csv
from datetime import date, datetime, time, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from dan_restaurant_pos.database.db_utils import fetch_all
from dan_restaurant_pos.services.access_control import require_permission


def _range_params(start_date: date, end_date: date) -> tuple[str, str]:
    if start_date > end_date:
        raise ValueError("The start date must be before the end date.")
    start = datetime.combine(start_date, time.min).strftime("%Y-%m-%d %H:%M:%S")
    end = datetime.combine(end_date + timedelta(days=1), time.min).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    return start, end


def get_sales_summary(start_date: date, end_date: date) -> dict:
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    sales = fetch_all(
        "SELECT currency, COUNT(*) AS order_count, COALESCE(SUM(total), 0) AS total "
        "FROM orders WHERE status = 'paid' AND created_at >= ? AND created_at < ? "
        "GROUP BY currency ORDER BY currency",
        (start, end),
    )
    expenses = fetch_all(
        "SELECT currency, COALESCE(SUM(amount), 0) AS total FROM expenses "
        "WHERE created_at >= ? AND created_at < ? GROUP BY currency ORDER BY currency",
        (start, end),
    )
    return {
        "order_count": sum(int(row["order_count"]) for row in sales),
        "sales_total": sum((row["total"] for row in sales), 0),
        "expense_total": sum((row["total"] for row in expenses), 0),
        "sales_by_currency": sales,
        "expenses_by_currency": expenses,
    }


def sales_by_product(start_date: date, end_date: date):
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    return fetch_all(
        "SELECT p.name, o.currency, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS sales "
        "FROM order_items oi JOIN orders o ON o.id = oi.order_id "
        "JOIN products p ON p.id = oi.product_id "
        "WHERE o.status = 'paid' AND o.created_at >= ? AND o.created_at < ? "
        "GROUP BY p.id, p.name, o.currency ORDER BY sales DESC LIMIT 20",
        (start, end),
    )


def sales_by_payment_method(start_date: date, end_date: date):
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    return fetch_all(
        "SELECT p.method, o.currency, SUM(p.amount_paid) AS total "
        "FROM payments p JOIN orders o ON o.id = p.order_id "
        "WHERE p.status = 'paid' AND o.created_at >= ? AND o.created_at < ? "
        "GROUP BY p.method, o.currency ORDER BY total DESC",
        (start, end),
    )


def sales_by_category(start_date: date, end_date: date):
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    return fetch_all(
        "SELECT c.name, o.currency, SUM(oi.quantity) AS quantity, "
        "SUM(oi.line_total) AS sales "
        "FROM order_items oi JOIN orders o ON o.id = oi.order_id "
        "JOIN products p ON p.id = oi.product_id "
        "JOIN categories c ON c.id = p.category_id "
        "WHERE o.status = 'paid' AND o.created_at >= ? AND o.created_at < ? "
        "GROUP BY c.id, c.name, o.currency ORDER BY sales DESC",
        (start, end),
    )


def sales_by_cashier(start_date: date, end_date: date):
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    return fetch_all(
        "SELECT COALESCE(u.full_name, 'Unknown') AS cashier, o.currency, "
        "COUNT(*) AS order_count, SUM(o.total) AS sales "
        "FROM orders o LEFT JOIN users u ON u.id = o.created_by "
        "WHERE o.status = 'paid' AND o.created_at >= ? AND o.created_at < ? "
        "GROUP BY u.id, u.full_name, o.currency ORDER BY sales DESC",
        (start, end),
    )


def profit_by_product(start_date: date, end_date: date):
    require_permission("reports.view")
    start, end = _range_params(start_date, end_date)
    return fetch_all(
        "SELECT p.name, o.currency, SUM(oi.line_total) AS sales, "
        "SUM(oi.unit_cost * oi.quantity) AS cost, "
        "SUM(oi.line_total - oi.unit_cost * oi.quantity) AS profit "
        "FROM order_items oi JOIN orders o ON o.id = oi.order_id "
        "JOIN products p ON p.id = oi.product_id "
        "WHERE o.status = 'paid' AND o.created_at >= ? AND o.created_at < ? "
        "GROUP BY p.id, p.name, o.currency ORDER BY profit DESC LIMIT 20",
        (start, end),
    )


def export_report_pdf(start_date: date, end_date: date, output_path: str | Path) -> Path:
    summary = get_sales_summary(start_date, end_date)
    products = sales_by_product(start_date, end_date)
    payments = sales_by_payment_method(start_date, end_date)
    categories = sales_by_category(start_date, end_date)
    cashiers = sales_by_cashier(start_date, end_date)
    profits = profit_by_product(start_date, end_date)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(str(path), pagesize=A4)
    styles = getSampleStyleSheet()
    sales_summary = " | ".join(
        f"{row['currency']} {row['total']:.2f}"
        for row in summary["sales_by_currency"]
    ) or "0.00"
    expense_summary = " | ".join(
        f"{row['currency']} {row['total']:.2f}"
        for row in summary["expenses_by_currency"]
    ) or "0.00"
    story = [
        Paragraph("DAN RESTAURANT POS - Sales Report", styles["Title"]),
        Paragraph(f"Period: {start_date.isoformat()} to {end_date.isoformat()}", styles["Normal"]),
        Paragraph(f"Paid orders: {summary['order_count']}", styles["Normal"]),
        Paragraph(f"Sales: {sales_summary}", styles["Normal"]),
        Paragraph(f"Expenses: {expense_summary}", styles["Normal"]),
        Spacer(1, 8),
        Paragraph("Sales by Product", styles["Heading2"]),
    ]
    product_rows = [["Product", "Currency", "Quantity", "Sales"]]
    product_rows.extend(
        [
            [
                row["name"],
                row["currency"],
                str(row["quantity"]),
                f"{row['currency']} {row['sales']:.2f}",
            ]
            for row in products
        ]
    )
    story.append(Table(product_rows))
    story.extend([Spacer(1, 8), Paragraph("Sales by Payment Method", styles["Heading2"])])
    payment_rows = [["Method", "Currency", "Paid"]]
    payment_rows.extend(
        [
            [
                row["method"],
                row["currency"],
                f"{row['currency']} {row['total']:.2f}",
            ]
            for row in payments
        ]
    )
    table = Table(payment_rows)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#B34700")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E7CDBB")),
            ]
        )
    )
    story.append(table)
    for heading, rows, columns in (
        (
            "Sales by Category",
            [
                [row["name"], row["currency"], str(row["quantity"]), f"{row['currency']} {row['sales']:.2f}"]
                for row in categories
            ],
            ["Category", "Currency", "Quantity", "Sales"],
        ),
        (
            "Sales by Cashier",
            [
                [row["cashier"], row["currency"], str(row["order_count"]), f"{row['currency']} {row['sales']:.2f}"]
                for row in cashiers
            ],
            ["Cashier", "Currency", "Orders", "Sales"],
        ),
        (
            "Gross Profit by Product",
            [
                [row["name"], row["currency"], f"{row['currency']} {row['cost']:.2f}", f"{row['currency']} {row['profit']:.2f}"]
                for row in profits
            ],
            ["Product", "Currency", "Cost", "Gross profit"],
        ),
    ):
        story.extend([Spacer(1, 8), Paragraph(heading, styles["Heading2"])])
        report_table = Table([columns, *rows])
        report_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#B34700")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#E7CDBB")),
                ]
            )
        )
        story.append(report_table)
    document.build(story)
    return path


def export_report_csv(start_date: date, end_date: date, output_path: str | Path) -> Path:
    summary = get_sales_summary(start_date, end_date)
    products = sales_by_product(start_date, end_date)
    payments = sales_by_payment_method(start_date, end_date)
    categories = sales_by_category(start_date, end_date)
    cashiers = sales_by_cashier(start_date, end_date)
    profits = profit_by_product(start_date, end_date)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sales_by_currency = {
        row["currency"]: dict(row) for row in summary["sales_by_currency"]
    }
    expenses_by_currency = {
        row["currency"]: dict(row) for row in summary["expenses_by_currency"]
    }
    currencies = sorted(set(sales_by_currency) | set(expenses_by_currency))
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.writer(file)
        writer.writerow(["Sales summary"])
        writer.writerow(["Currency", "Paid orders", "Sales", "Expenses"])
        for currency in currencies:
            sales = sales_by_currency.get(currency, {})
            expenses = expenses_by_currency.get(currency, {})
            writer.writerow(
                [
                    currency,
                    sales.get("order_count", 0),
                    sales.get("total", 0),
                    expenses.get("total", 0),
                ]
            )
        for title, headings, rows in (
            (
                "Sales by Product",
                ["Product", "Currency", "Quantity", "Sales"],
                [
                    [row["name"], row["currency"], row["quantity"], row["sales"]]
                    for row in products
                ],
            ),
            (
                "Sales by Category",
                ["Category", "Currency", "Quantity", "Sales"],
                [
                    [row["name"], row["currency"], row["quantity"], row["sales"]]
                    for row in categories
                ],
            ),
            (
                "Sales by Cashier",
                ["Cashier", "Currency", "Orders", "Sales"],
                [
                    [row["cashier"], row["currency"], row["order_count"], row["sales"]]
                    for row in cashiers
                ],
            ),
            (
                "Gross Profit by Product",
                ["Product", "Currency", "Sales", "Cost", "Gross profit"],
                [
                    [row["name"], row["currency"], row["sales"], row["cost"], row["profit"]]
                    for row in profits
                ],
            ),
            (
                "Sales by Payment Method",
                ["Method", "Currency", "Paid"],
                [
                    [row["method"], row["currency"], row["total"]]
                    for row in payments
                ],
            ),
        ):
            writer.writerow([])
            writer.writerow([title])
            writer.writerow(headings)
            writer.writerows(rows)
    return path
