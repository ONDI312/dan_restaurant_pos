from __future__ import annotations

import sqlite3
from decimal import Decimal

import psycopg
from PyQt6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.catalog_service import list_products
from dan_restaurant_pos.services.purchase_service import (
    cancel_purchase,
    create_purchase,
    finalize_purchase,
    list_purchases,
)
from dan_restaurant_pos.services.supplier_service import list_suppliers
from dan_restaurant_pos.utils.helpers import money


class PurchaseWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Purchases")
        self.resize(1200, 800)
        self.items: list[dict] = []
        self.purchase_id: int | None = None
        self.purchase_status: str | None = None
        self._build_ui()
        self._load_choices()
        self.refresh_purchases()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Purchase Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        form = QFormLayout()
        self.supplier_combo = QComboBox()
        self.invoice_input = QLineEdit()
        self.invoice_input.setPlaceholderText("Supplier invoice / reference")
        self.product_combo = QComboBox()
        self.quantity_input = QSpinBox()
        self.quantity_input.setRange(1, 1_000_000)
        self.unit_cost_input = QLineEdit()
        self.unit_cost_input.setPlaceholderText("0.00")
        form.addRow("Supplier", self.supplier_combo)
        form.addRow("Invoice reference", self.invoice_input)
        form.addRow("Product", self.product_combo)
        form.addRow("Quantity", self.quantity_input)
        form.addRow("Unit cost", self.unit_cost_input)
        layout.addLayout(form)
        line_actions = QHBoxLayout()
        add_item_button = QPushButton("Add Product")
        add_item_button.clicked.connect(self.add_item)
        remove_item_button = QPushButton("Remove Selected Product")
        remove_item_button.clicked.connect(self.remove_item)
        line_actions.addWidget(add_item_button)
        line_actions.addWidget(remove_item_button)
        layout.addLayout(line_actions)
        self.items_table = QTableWidget(0, 4)
        self.items_table.setHorizontalHeaderLabels(
            ["Product", "Quantity", "Unit cost", "Line total"]
        )
        layout.addWidget(self.items_table, 1)
        self.total_label = QLabel("Purchase total: USD 0.00")
        self.total_label.setStyleSheet("font-size: 20px; font-weight: bold;")
        layout.addWidget(self.total_label)
        actions = QHBoxLayout()
        save_button = QPushButton("Save Draft")
        save_button.clicked.connect(self.save_draft)
        finalize_button = QPushButton("Finalize Purchase")
        finalize_button.clicked.connect(self.finalize)
        cancel_button = QPushButton("Cancel Draft")
        cancel_button.clicked.connect(self.cancel_draft)
        actions.addWidget(save_button)
        actions.addWidget(finalize_button)
        actions.addWidget(cancel_button)
        layout.addLayout(actions)
        self.purchases_table = QTableWidget(0, 5)
        self.purchases_table.setHorizontalHeaderLabels(
            ["ID", "Supplier", "Invoice", "Total", "Status"]
        )
        self.purchases_table.setColumnHidden(0, True)
        self.purchases_table.itemSelectionChanged.connect(self.select_purchase)
        layout.addWidget(self.purchases_table, 1)

    def _load_choices(self) -> None:
        self.supplier_combo.clear()
        for supplier in list_suppliers():
            self.supplier_combo.addItem(supplier["name"], supplier["id"])
        self.product_combo.clear()
        for product in list_products():
            self.product_combo.addItem(
                f"{product['name']} (stock {product['stock_quantity']})",
                product["id"],
            )

    def add_item(self) -> None:
        if self.purchase_id is not None:
            QMessageBox.information(self, "Purchase", "Start a new purchase to add items.")
            return
        product_id = self.product_combo.currentData()
        if product_id is None:
            QMessageBox.warning(self, "Purchase", "Create a product before recording a purchase.")
            return
        try:
            unit_cost = Decimal(self.unit_cost_input.text())
            if unit_cost < 0:
                raise ValueError("Unit cost cannot be negative.")
        except (ValueError, ArithmeticError):
            QMessageBox.warning(self, "Purchase", "Enter a valid non-negative unit cost.")
            return
        product_name = self.product_combo.currentText().split(" (stock ", 1)[0]
        self.items.append(
            {
                "product_id": int(product_id),
                "product_name": product_name,
                "quantity": self.quantity_input.value(),
                "unit_cost": unit_cost,
            }
        )
        self.refresh_items()

    def remove_item(self) -> None:
        row = self.items_table.currentRow()
        if row >= 0 and row < len(self.items) and self.purchase_id is None:
            self.items.pop(row)
            self.refresh_items()

    def refresh_items(self) -> None:
        self.items_table.setRowCount(len(self.items))
        total = Decimal("0")
        for row, item in enumerate(self.items):
            line_total = money(item["unit_cost"] * item["quantity"])
            total += line_total
            for col, value in enumerate(
                (
                    item["product_name"],
                    item["quantity"],
                    f"{item['unit_cost']:.2f}",
                    f"{line_total:.2f}",
                )
            ):
                self.items_table.setItem(row, col, QTableWidgetItem(str(value)))
        self.total_label.setText(f"Purchase total: USD {money(total):.2f}")

    def save_draft(self) -> None:
        if self.purchase_id is not None:
            QMessageBox.information(self, "Purchase", f"Draft #{self.purchase_id} is already saved.")
            return
        supplier_id = self.supplier_combo.currentData()
        if supplier_id is None:
            QMessageBox.warning(self, "Purchase", "Add an active supplier first.")
            return
        try:
            self.purchase_id = create_purchase(
                int(supplier_id),
                self.invoice_input.text(),
                self.items,
            )
            self.purchase_status = "draft"
            self.refresh_purchases()
            QMessageBox.information(self, "Purchase", f"Draft #{self.purchase_id} saved.")
        except ValueError as error:
            QMessageBox.warning(self, "Purchase", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Purchase", f"Could not save purchase: {error}")

    def finalize(self) -> None:
        if self.purchase_id is None:
            self.save_draft()
            if self.purchase_id is None:
                return
        try:
            finalize_purchase(self.purchase_id)
            self.purchase_status = "finalized"
            self.refresh_purchases()
            QMessageBox.information(self, "Purchase", "Purchase finalized; stock was updated.")
            self.clear_form()
        except ValueError as error:
            QMessageBox.warning(self, "Purchase", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Purchase", f"Could not finalize purchase: {error}")

    def cancel_draft(self) -> None:
        if self.purchase_id is None:
            QMessageBox.information(self, "Purchase", "Select a saved draft first.")
            return
        try:
            cancel_purchase(self.purchase_id)
            self.refresh_purchases()
            self.clear_form()
        except ValueError as error:
            QMessageBox.warning(self, "Purchase", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Purchase", f"Could not cancel draft: {error}")

    def refresh_purchases(self) -> None:
        rows = list_purchases()
        self.purchases_table.setRowCount(len(rows))
        for row_index, purchase in enumerate(rows):
            values = (
                purchase["id"],
                purchase["supplier_name"] or "",
                purchase["invoice_ref"] or "",
                f"{purchase['total_amount']:.2f}",
                purchase["status"].title(),
            )
            for col, value in enumerate(values):
                self.purchases_table.setItem(
                    row_index, col, QTableWidgetItem(str(value))
                )
        self.purchases_table.resizeColumnsToContents()

    def select_purchase(self) -> None:
        if not self.purchases_table.selectedItems():
            return
        row = self.purchases_table.currentRow()
        self.purchase_id = int(self.purchases_table.item(row, 0).text())
        self.purchase_status = self.purchases_table.item(row, 4).text().lower()

    def clear_form(self) -> None:
        self.purchase_id = None
        self.purchase_status = None
        self.items.clear()
        self.invoice_input.clear()
        self.refresh_items()
        self.purchases_table.clearSelection()
