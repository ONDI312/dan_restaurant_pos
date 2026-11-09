from __future__ import annotations

import sqlite3
from datetime import date

import psycopg
from PyQt6.QtCore import QDate
from PyQt6.QtWidgets import (
    QFileDialog,
    QDateEdit,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.report_service import (
    export_report_csv,
    export_report_pdf,
    get_sales_summary,
    profit_by_product,
    sales_by_cashier,
    sales_by_category,
    sales_by_payment_method,
    sales_by_product,
)


class ReportsWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Reports")
        self.resize(1100, 750)
        self._build_ui()
        self.refresh_report()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Sales and Expense Reports")
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
        apply_button = QPushButton("Apply")
        apply_button.clicked.connect(self.refresh_report)
        filters.addWidget(apply_button)
        export_button = QPushButton("Export PDF")
        export_button.clicked.connect(self.export_pdf)
        filters.addWidget(export_button)
        csv_button = QPushButton("Export Excel-Compatible CSV")
        csv_button.clicked.connect(self.export_csv)
        filters.addWidget(csv_button)
        layout.addLayout(filters)
        self.summary_label = QLabel()
        self.summary_label.setStyleSheet("font-size: 20px; font-weight: bold;")
        layout.addWidget(self.summary_label)
        layout.addWidget(QLabel("Sales by Product"))
        self.products_table = QTableWidget(0, 4)
        self.products_table.setHorizontalHeaderLabels(
            ["Product", "Currency", "Quantity", "Sales"]
        )
        layout.addWidget(self.products_table)
        layout.addWidget(QLabel("Sales by Payment Method"))
        self.payment_table = QTableWidget(0, 3)
        self.payment_table.setHorizontalHeaderLabels(["Method", "Currency", "Amount"])
        layout.addWidget(self.payment_table)
        layout.addWidget(QLabel("Category, cashier, and gross-profit breakdown"))
        self.analytics_table = QTableWidget(0, 4)
        self.analytics_table.setHorizontalHeaderLabels(
            ["Metric", "Name", "Currency", "Value"]
        )
        layout.addWidget(self.analytics_table)

    def _selected_dates(self) -> tuple[date, date]:
        return (
            self.start_date.date().toPyDate(),
            self.end_date.date().toPyDate(),
        )

    def refresh_report(self) -> None:
        start, end = self._selected_dates()
        if start > end:
            QMessageBox.warning(self, "Reports", "The start date must be before the end date.")
            return
        try:
            summary = get_sales_summary(start, end)
            sales = " | ".join(
                f"{item['currency']} {item['total']:.2f}"
                for item in summary["sales_by_currency"]
            ) or "0.00"
            expenses = " | ".join(
                f"{item['currency']} {item['total']:.2f}"
                for item in summary["expenses_by_currency"]
            ) or "0.00"
            self.summary_label.setText(
                f"Paid orders: {summary['order_count']}    "
                f"Sales: {sales}    "
                f"Expenses: {expenses}"
            )
            products = sales_by_product(start, end)
            self.products_table.setRowCount(len(products))
            for row, item in enumerate(products):
                values = (
                    item["name"],
                    item["currency"],
                    item["quantity"],
                    f"{item['sales']:.2f}",
                )
                for col, value in enumerate(values):
                    self.products_table.setItem(row, col, QTableWidgetItem(str(value)))
            methods = sales_by_payment_method(start, end)
            self.payment_table.setRowCount(len(methods))
            for row, item in enumerate(methods):
                self.payment_table.setItem(row, 0, QTableWidgetItem(item["method"]))
                self.payment_table.setItem(
                    row, 1, QTableWidgetItem(item["currency"])
                )
                self.payment_table.setItem(
                    row, 2, QTableWidgetItem(f"{item['total']:.2f}")
                )
            analytics = []
            analytics.extend(
                ("Category sales", item["name"], item["currency"],
                 f"{item['quantity']} items / {item['sales']:.2f}")
                for item in sales_by_category(start, end)
            )
            analytics.extend(
                ("Cashier sales", item["cashier"], item["currency"],
                 f"{item['sales']:.2f} ({item['order_count']} orders)")
                for item in sales_by_cashier(start, end)
            )
            analytics.extend(
                ("Gross profit", item["name"], item["currency"],
                 f"{item['profit']:.2f}")
                for item in profit_by_product(start, end)
            )
            self.analytics_table.setRowCount(len(analytics))
            for row, values in enumerate(analytics):
                for col, value in enumerate(values):
                    self.analytics_table.setItem(row, col, QTableWidgetItem(str(value)))
        except ValueError as error:
            QMessageBox.warning(self, "Reports", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Reports", f"Could not load reports: {error}")

    def export_pdf(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Export report", "sales-report.pdf", "PDF files (*.pdf)"
        )
        if not path:
            return
        try:
            start, end = self._selected_dates()
            export_report_pdf(start, end, path)
            QMessageBox.information(self, "Reports", "Report PDF exported.")
        except ValueError as error:
            QMessageBox.warning(self, "Reports", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Reports", f"Could not export report: {error}")

    def export_csv(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Export report for Excel", "sales-report.csv", "CSV files (*.csv)"
        )
        if not path:
            return
        try:
            start, end = self._selected_dates()
            export_report_csv(start, end, path)
            QMessageBox.information(
                self, "Reports", "Excel-compatible CSV report exported."
            )
        except ValueError as error:
            QMessageBox.warning(self, "Reports", str(error))
        except (OSError, psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Reports", f"Could not export report: {error}")
