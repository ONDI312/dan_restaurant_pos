from __future__ import annotations

import sqlite3
from datetime import datetime
from html import escape

import psycopg
from PyQt6.QtCore import QDate, QSizeF, Qt
from PyQt6.QtGui import QPageSize, QTextDocument
from PyQt6.QtPrintSupport import QPrintDialog, QPrinter
from PyQt6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QDateEdit,
)

from dan_restaurant_pos.services.invoice_service import (
    export_invoice_pdf,
    get_invoice,
    list_invoices,
)



_CODE39 = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
    "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", "*": "nwnnwnwnn",
}


def _barcode_html(transaction_id: int) -> str:
    elements = []
    for character in f"*{transaction_id}*":
        for index, unit in enumerate(_CODE39[character]):
            width = 3 if unit == "w" else 1
            if index % 2 == 0:
                elements.append(f'<span style="display:inline-block;width:{width}px;height:48px;background:#000"></span>')
            else:
                elements.append(f'<span style="display:inline-block;width:{width}px;height:48px"></span>')
        elements.append('<span style="display:inline-block;width:1px;height:48px"></span>')
    return "".join(elements)


def _format_receipt_time(value) -> str:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return "N/A"
    return value.strftime("%d/%m/%Y %H:%M") if hasattr(value, "strftime") else "N/A"


def _receipt_html(data: dict) -> str:
    invoice = data["invoice"]
    currency = escape(str(invoice["currency"]))
    transaction_id = int(invoice["transaction_id"])
    issued_at = invoice["issued_at"]
    date_label = _format_receipt_time(issued_at)
    table_name = escape(str(invoice.get("table_name") or "N/A"))
    server = escape(str(invoice.get("cashier") or "N/A").upper())
    rows = "".join(
        f'<tr><td>{int(item["quantity"])}X {escape(str(item["name"]).upper())}</td>'
        f'<td class="amount">{currency} {float(item["line_total"]):.2f}</td></tr>'
        for item in data["items"]
    )
    totals = f'<tr><td>SUBTOTAL:</td><td class="amount">{currency} {float(invoice["subtotal"]):.2f}</td></tr>'
    if float(invoice["discount_amount"]):
        totals += f'<tr><td>DISCOUNT:</td><td class="amount">-{currency} {float(invoice["discount_amount"]):.2f}</td></tr>'
    totals += f'<tr><td>TAX:</td><td class="amount">{currency} {float(invoice["vat_amount"]):.2f}</td></tr>'
    if float(invoice["service_amount"]):
        totals += f'<tr><td>SERVICE:</td><td class="amount">{currency} {float(invoice["service_amount"]):.2f}</td></tr>'
    totals += f'<tr class="total"><td>TOTAL:</td><td class="amount">{currency} {float(invoice["total"]):.2f}</td></tr>'
    payment = data["payments"][-1] if data["payments"] else {}
    method = str(payment.get("method") or "")
    payment_type = method.upper() if method else "NOT CAPTURED"
    payment_time = payment.get("paid_at")
    payment_time_label = _format_receipt_time(payment_time)
    reference = escape(str(payment.get("transaction_ref") or f"REF {transaction_id}"))
    status = escape(str(payment.get("status") or "pending").upper())
    card_value = "NOT CAPTURED"
    details = "".join([
        f'<tr><td>CARD:</td><td class="amount">{card_value}</td></tr>',
        f'<tr><td>TYPE:</td><td class="amount">{escape(payment_type)}</td></tr>',
        '<tr><td>ENTRY:</td><td class="amount">NOT RECORDED</td></tr>',
        f'<tr><td>TIME:</td><td class="amount">{payment_time_label}</td></tr>',
        f'<tr><td>REF:</td><td class="amount">{reference}</td></tr>',
        f'<tr><td>STATUS:</td><td class="amount"><b>{status}</b></td></tr>',
    ])
    return f'''<html><head><style>
      body {{ font-family: "Courier New", monospace; font-size: 9pt; color: #111; }}
      h1 {{ text-align: center; font-size: 14pt; margin: 0 0 6pt; }}
      p.center {{ text-align: center; margin: 2pt 0; }}
      table {{ width: 100%; border-collapse: collapse; }}
      td {{ padding: 2pt 0; vertical-align: top; }}
      .amount {{ text-align: right; white-space: nowrap; }}
      .divider td {{ border-top: 1px dashed #222; height: 6pt; }}
      .meta td {{ width: 50%; }} .total td {{ font-weight: bold; font-size: 11pt; border-top: 1px solid #222; padding-top: 5pt; }}
      .barcode {{ text-align: center; white-space: nowrap; margin-top: 8pt; }}
    </style></head><body>
      <h1>DINEFINE RESTAURANT</h1>
      <p class="center">123 CULINARY AVENUE<br/>DOWNTOWN DISTRICT<br/>PHONE: (555) 123-4567<br/>WWW.DINEFINE.COM</p>
      <table><tr class="divider"><td colspan="2"></td></tr></table>
      <p class="center"><b>{date_label}</b></p>
      <table class="meta"><tr><td>RECEIPT: #R-{transaction_id}</td><td class="amount">TABLE: {table_name}</td></tr>
      <tr><td>SERVER: {server}</td><td class="amount">GUESTS: N/A</td></tr></table>
      <table><tr class="divider"><td colspan="2"></td></tr>{rows}<tr class="divider"><td colspan="2"></td></tr>{totals}<tr class="divider"><td colspan="2"></td></tr>{details}</table>
      <p class="center"><b>TIP IS NOT INCLUDED.<br/>PLEASE COME AGAIN!</b></p>
      <p class="center"><b>THANK YOU FOR DINING WITH US!</b></p>
      <div class="barcode">{_barcode_html(transaction_id)}<br/>{transaction_id}</div>
    </body></html>'''
class InvoiceListWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Invoice List")
        self.resize(1150, 750)
        self.selected_order_id: int | None = None
        self._build_ui()
        self.refresh_invoices()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Invoices and Receipts")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        filters = QHBoxLayout()
        self.start_date = QDateEdit()
        self.start_date.setCalendarPopup(True)
        self.start_date.setDate(QDate.currentDate().addDays(-30))
        self.end_date = QDateEdit()
        self.end_date.setCalendarPopup(True)
        self.end_date.setDate(QDate.currentDate())
        filters.addWidget(QLabel("From"))
        filters.addWidget(self.start_date)
        filters.addWidget(QLabel("To"))
        filters.addWidget(self.end_date)
        filter_button = QPushButton("Apply")
        filter_button.clicked.connect(self.refresh_invoices)
        filters.addWidget(filter_button)
        layout.addLayout(filters)
        self.invoices_table = QTableWidget(0, 7)
        self.invoices_table.setHorizontalHeaderLabels(
            ["ID", "Invoice", "Order", "Date", "Total", "Payment", "Cashier"]
        )
        self.invoices_table.setColumnHidden(0, True)
        self.invoices_table.itemSelectionChanged.connect(self.select_invoice)
        layout.addWidget(self.invoices_table)
        actions = QHBoxLayout()
        view_button = QPushButton("View Receipt")
        view_button.clicked.connect(self.view_receipt)
        print_button = QPushButton("Print Receipt")
        print_button.clicked.connect(self.print_receipt)
        export_button = QPushButton("Export PDF")
        export_button.clicked.connect(self.export_pdf)
        actions.addWidget(view_button)
        actions.addWidget(print_button)
        actions.addWidget(export_button)
        layout.addLayout(actions)

    def refresh_invoices(self) -> None:
        start = self.start_date.date().toPyDate()
        end = self.end_date.date().toPyDate()
        if start > end:
            QMessageBox.warning(self, "Invoices", "The start date must be before the end date.")
            return
        rows = list_invoices(start, end)
        self.invoices_table.setRowCount(len(rows))
        for row_index, invoice in enumerate(rows):
            values = (
                invoice["id"],
                invoice["invoice_number"],
                invoice["order_id"],
                str(invoice["issued_at"]),
                f"{invoice['currency']} {invoice['total']:.2f}",
                invoice["payment_method"] or "Pending",
                invoice["cashier"] or "",
            )
            for col_index, value in enumerate(values):
                self.invoices_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.invoices_table.resizeColumnsToContents()

    def select_invoice(self) -> None:
        if not self.invoices_table.selectedItems():
            return
        row = self.invoices_table.currentRow()
        self.selected_order_id = int(self.invoices_table.item(row, 2).text())

    def view_receipt(self) -> None:
        if self.selected_order_id is None:
            QMessageBox.information(self, "Invoices", "Select an invoice first.")
            return
        try:
            data = get_invoice(self.selected_order_id)
            preview = QMessageBox(self)
            preview.setWindowTitle("Receipt")
            preview.setTextFormat(Qt.TextFormat.RichText)
            preview.setText(_receipt_html(data))
            preview.exec()
        except ValueError as error:
            QMessageBox.warning(self, "Invoices", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Invoices", f"Could not load receipt: {error}")

    def print_receipt(self) -> None:
        if self.selected_order_id is None:
            QMessageBox.information(self, "Invoices", "Select an invoice first.")
            return
        try:
            data = get_invoice(self.selected_order_id)
            html = _receipt_html(data)
            printer = QPrinter(QPrinter.PrinterMode.HighResolution)
            page_height = max(180, 145 + len(data["items"]) * 8)
            printer.setPageSize(QPageSize(QSizeF(80, page_height), QPageSize.Unit.Millimeter))
            dialog = QPrintDialog(printer, self)
            if dialog.exec():
                document = QTextDocument()
                document.setHtml(html)
                document.print(printer)
        except ValueError as error:
            QMessageBox.warning(self, "Invoices", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Invoices", f"Could not print receipt: {error}")

    def export_pdf(self) -> None:
        if self.selected_order_id is None:
            QMessageBox.information(self, "Invoices", "Select an invoice first.")
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Export invoice", "invoice.pdf", "PDF files (*.pdf)"
        )
        if not path:
            return
        try:
            export_invoice_pdf(self.selected_order_id, path)
            QMessageBox.information(self, "Invoices", "Invoice PDF exported.")
        except ValueError as error:
            QMessageBox.warning(self, "Invoices", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Invoices", f"Could not export PDF: {error}")
