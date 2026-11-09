from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtCore import Qt
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

from dan_restaurant_pos.services.inventory_service import (
    add_inventory_movement,
    list_inventory,
    list_inventory_movements,
)


class InventoryWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Inventory")
        self.resize(1200, 800)
        self.selected_product_id: int | None = None
        self._build_ui()
        self.refresh_inventory()
        self.refresh_movements()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Inventory and Stock Movements")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search by product or barcode")
        self.search_input.textChanged.connect(self.refresh_inventory)
        layout.addWidget(self.search_input)
        self.inventory_table = QTableWidget(0, 6)
        self.inventory_table.setHorizontalHeaderLabels(
            ["ID", "Product", "Category", "Current Stock", "Minimum", "Unit Cost"]
        )
        self.inventory_table.setColumnHidden(0, True)
        self.inventory_table.setSelectionBehavior(
            QTableWidget.SelectionBehavior.SelectRows
        )
        self.inventory_table.itemSelectionChanged.connect(self.select_product)
        layout.addWidget(self.inventory_table, 1)

        form = QFormLayout()
        self.movement_combo = QComboBox()
        for label, value in (
            ("Stock addition", "stock_addition"),
            ("Stock deduction", "stock_deduction"),
            ("Damaged stock", "damage"),
            ("Adjustment - add", "adjustment_add"),
            ("Adjustment - deduct", "adjustment_deduction"),
        ):
            self.movement_combo.addItem(label, value)
        self.quantity_input = QSpinBox()
        self.quantity_input.setRange(1, 1_000_000)
        self.reason_input = QLineEdit()
        form.addRow("Movement type", self.movement_combo)
        form.addRow("Quantity", self.quantity_input)
        form.addRow("Reason", self.reason_input)
        layout.addLayout(form)
        apply_button = QPushButton("Record Stock Movement")
        apply_button.clicked.connect(self.record_movement)
        layout.addWidget(apply_button)

        layout.addWidget(QLabel("Recent Movement History"))
        self.movements_table = QTableWidget(0, 6)
        self.movements_table.setHorizontalHeaderLabels(
            ["Date", "Product", "Type", "Quantity", "Reason", "User"]
        )
        layout.addWidget(self.movements_table, 1)

    def refresh_inventory(self) -> None:
        rows = list_inventory(self.search_input.text())
        self.inventory_table.setRowCount(len(rows))
        for row_index, product in enumerate(rows):
            values = (
                product["id"],
                product["name"],
                product["category_name"],
                product["stock_quantity"],
                product["min_stock"],
                f"{product['cost_price']:.2f}",
            )
            for col_index, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                if col_index == 0:
                    item.setData(Qt.ItemDataRole.UserRole, product["id"])
                if col_index == 3 and int(product["stock_quantity"]) <= int(product["min_stock"]):
                    item.setBackground(Qt.GlobalColor.yellow)
                self.inventory_table.setItem(row_index, col_index, item)
        self.inventory_table.resizeColumnsToContents()

    def refresh_movements(self) -> None:
        rows = list_inventory_movements(self.selected_product_id)
        self.movements_table.setRowCount(len(rows))
        for row_index, movement in enumerate(rows):
            values = (
                movement["created_at"],
                movement["product_name"],
                movement["movement_type"],
                movement["quantity"],
                movement["reason"],
                movement["username"] or "",
            )
            for col_index, value in enumerate(values):
                self.movements_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.movements_table.resizeColumnsToContents()

    def select_product(self) -> None:
        if not self.inventory_table.selectedItems():
            return
        row = self.inventory_table.currentRow()
        self.selected_product_id = int(self.inventory_table.item(row, 0).text())
        self.refresh_movements()

    def record_movement(self) -> None:
        if self.selected_product_id is None:
            QMessageBox.information(self, "Inventory", "Select a product first.")
            return
        try:
            add_inventory_movement(
                self.selected_product_id,
                self.quantity_input.value(),
                str(self.movement_combo.currentData()),
                self.reason_input.text(),
            )
            self.reason_input.clear()
            self.refresh_inventory()
            self.refresh_movements()
        except ValueError as error:
            QMessageBox.warning(self, "Inventory", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(
                self, "Inventory", f"Could not record stock movement: {error}"
            )
