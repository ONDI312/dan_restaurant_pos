from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtCore import QDate
from PyQt6.QtGui import QTextDocument
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
            invoice = data["invoice"]
            merchant = data["merchant"]
            currency = invoice["currency"]
            lines = [
                f"{item['quantity']} x {item['name']} @ {currency} {item['unit_price']:.2f}"
                for item in data["items"]
            ]
            payments = [
                f"{item['method']}: {currency} {item['amount_paid']:.2f} ({item['status']})"
                for item in data["payments"]
            ]
            text = (
                f"{merchant['restaurant_name']}\n"
                f"{merchant['address']}\n{merchant['phone']} {merchant['email']}\n"
                f"Invoice {invoice['invoice_number']}\n"
                f"Order {invoice['order_number']}\nDate {invoice['issued_at']}\n\n"
                + "\n".join(lines)
                + f"\n\nSubtotal: {currency} {invoice['subtotal']:.2f}"
                + f"\nDiscount: {currency} {invoice['discount_amount']:.2f}"
                + f"\nVAT: {currency} {invoice['vat_amount']:.2f}"
                + f"\nService charge: {currency} {invoice['service_amount']:.2f}"
                + f"\nTOTAL: {currency} {invoice['total']:.2f}\n\n"
                + "\n".join(payments)
                + f"\n\n{merchant['receipt_footer']}"
            )
            QMessageBox.information(self, "Receipt", text)
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
            invoice = data["invoice"]
            merchant = data["merchant"]
            currency = invoice["currency"]
            text = (
                f"{merchant['restaurant_name']}\n{merchant['address']}\n"
                f"{merchant['phone']} {merchant['email']}\n"
                f"Invoice {invoice['invoice_number']} | Order {invoice['order_number']}\n"
                f"Date {invoice['issued_at']}\n\n"
                + "\n".join(
                    f"{item['quantity']} x {item['name']} @ {currency} "
                    f"{item['unit_price']:.2f}"
                    for item in data["items"]
                )
                + f"\n\nTOTAL: {currency} {invoice['total']:.2f}\n"
                + f"{merchant['receipt_footer']}"
            )
            printer = QPrinter(QPrinter.PrinterMode.HighResolution)
            dialog = QPrintDialog(printer, self)
            if dialog.exec():
                document = QTextDocument()
                document.setPlainText(text)
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
