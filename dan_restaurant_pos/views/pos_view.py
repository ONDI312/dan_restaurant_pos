from __future__ import annotations

import sqlite3
from decimal import Decimal

import psycopg
from PyQt6.QtCore import QSize, Qt
from PyQt6.QtGui import QIcon
from PyQt6.QtWidgets import (
    QComboBox,
    QDoubleSpinBox,
    QGridLayout,
    QHBoxLayout,
    QInputDialog,
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

from dan_restaurant_pos.database.db_utils import fetch_all
from dan_restaurant_pos.services.catalog_service import list_categories, list_products
from dan_restaurant_pos.services.order_service import add_order, cancel_order, calculate_order_totals
from dan_restaurant_pos.services.payment_service import record_payment
from dan_restaurant_pos.services.settings_service import get_settings
from dan_restaurant_pos.utils.image_files import resolve_image_path
from dan_restaurant_pos.utils.helpers import money


class PosWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - POS")
        self.resize(1500, 900)
        self.cart: dict[int, dict] = {}
        self.saved_order_id: int | None = None
        self.settings = get_settings()
        self.currency = self.settings["currency"]
        self.current_total = Decimal("0")
        self._build_ui()
        self._load_categories()
        self._load_tables()
        self.refresh_catalog()
        self.refresh_cart()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        page = QVBoxLayout(root)
        header = QHBoxLayout()
        title = QLabel("Point of Sale")
        title.setStyleSheet("font-size: 26px; font-weight: bold; color: #803000;")
        header.addWidget(title)
        header.addStretch()
        self.order_type = QComboBox()
        self.order_type.addItem("Take Away", "take_away")
        self.order_type.addItem("Dine In", "dine_in")
        self.order_type.currentIndexChanged.connect(self._order_type_changed)
        header.addWidget(self.order_type)
        self.table_combo = QComboBox()
        self.table_combo.setMinimumWidth(170)
        header.addWidget(self.table_combo)
        page.addLayout(header)

        content = QHBoxLayout()
        left = QVBoxLayout()
        self.cart_table = QTableWidget(0, 5)
        self.cart_table.setHorizontalHeaderLabels(
            ["Product", "Qty", "Unit price", "Line total", ""]
        )
        self.cart_table.setColumnWidth(0, 220)
        self.cart_table.setColumnWidth(1, 70)
        self.cart_table.setColumnWidth(2, 100)
        self.cart_table.setColumnWidth(3, 110)
        left.addWidget(self.cart_table, 1)

        self.subtotal_label = QLabel(f"Subtotal: {self.currency} 0.00")
        self.discount_rate = QDoubleSpinBox()
        self.discount_rate.setRange(0, 100)
        self.discount_rate.setDecimals(2)
        self.discount_rate.setSuffix("%")
        self.discount_rate.setValue(
            float(self.settings["discount_percentage"])
        )
        self.vat_rate = QDoubleSpinBox()
        self.vat_rate.setRange(0, 100)
        self.vat_rate.setDecimals(2)
        self.vat_rate.setSuffix("%")
        self.vat_rate.setValue(float(self.settings["vat_percentage"]))
        self.service_rate = QDoubleSpinBox()
        self.service_rate.setRange(0, 100)
        self.service_rate.setDecimals(2)
        self.service_rate.setSuffix("%")
        self.service_rate.setValue(float(self.settings["service_percentage"]))
        self.discount_rate.valueChanged.connect(self.refresh_cart)
        self.vat_rate.valueChanged.connect(self.refresh_cart)
        self.service_rate.valueChanged.connect(self.refresh_cart)
        left.addWidget(QLabel("Discount"))
        left.addWidget(self.discount_rate)
        left.addWidget(QLabel("VAT"))
        left.addWidget(self.vat_rate)
        left.addWidget(QLabel("Service charge"))
        left.addWidget(self.service_rate)
        self.subtotal_label.setText(f"Subtotal: {self.currency} 0.00")
        self.discount_label = QLabel(f"Discount: {self.currency} 0.00")
        self.vat_label = QLabel(f"VAT: {self.currency} 0.00")
        self.service_label = QLabel(f"Service charge: {self.currency} 0.00")
        self.total_label = QLabel(f"Total: {self.currency} 0.00")
        self.total_label.setStyleSheet("font-size: 22px; font-weight: bold;")
        for label in (
            self.subtotal_label,
            self.discount_label,
            self.vat_label,
            self.service_label,
            self.total_label,
        ):
            left.addWidget(label)

        actions = QGridLayout()
        new_button = QPushButton("New Order")
        new_button.clicked.connect(self.new_order)
        cancel_button = QPushButton("Cancel Order")
        cancel_button.clicked.connect(self.cancel_current_order)
        save_button = QPushButton("Save Order")
        save_button.clicked.connect(self.save_current_order)
        payment_button = QPushButton("Payment")
        payment_button.setStyleSheet(
            "QPushButton { background: #16803C; color: white; font-weight: bold; "
            "font-size: 20px; min-height: 56px; }"
        )
        payment_button.clicked.connect(self.take_payment)
        actions.addWidget(new_button, 0, 0)
        actions.addWidget(cancel_button, 0, 1)
        actions.addWidget(save_button, 1, 0)
        actions.addWidget(payment_button, 1, 1)
        left.addLayout(actions)
        content.addLayout(left, 5)

        right = QVBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search product or scan barcode")
        self.search_input.textChanged.connect(self.refresh_catalog)
        right.addWidget(self.search_input)
        self.category_combo = QComboBox()
        self.category_combo.currentIndexChanged.connect(self.refresh_catalog)
        right.addWidget(self.category_combo)
        self.catalog_widget = QWidget()
        self.catalog_grid = QGridLayout(self.catalog_widget)
        self.catalog_grid.setAlignment(Qt.AlignmentFlag.AlignTop)
        right.addWidget(self.catalog_widget, 1)
        content.addLayout(right, 6)
        page.addLayout(content, 1)
        self._order_type_changed()

    def _load_categories(self) -> None:
        self.category_combo.clear()
        self.category_combo.addItem("All Categories", None)
        for category in list_categories():
            self.category_combo.addItem(category["name"], category["id"])

    def _load_tables(self) -> None:
        self.table_combo.clear()
        self.table_combo.addItem("Select Table", None)
        for table in fetch_all(
            "SELECT id, table_name FROM restaurant_tables "
            "WHERE status = 'available' AND is_active = TRUE ORDER BY table_name"
        ):
            self.table_combo.addItem(table["table_name"], table["id"])

    def _order_type_changed(self) -> None:
        dine_in = self.order_type.currentData() == "dine_in"
        self.table_combo.setEnabled(dine_in)

    def refresh_catalog(self) -> None:
        while self.catalog_grid.count():
            item = self.catalog_grid.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        category_id = self.category_combo.currentData()
        products = list_products(
            category_id=int(category_id) if category_id is not None else None,
            search=self.search_input.text(),
        )
        card_index = 0
        for product in products:
            if int(product["stock_quantity"]) <= 0:
                continue
            row, col = divmod(card_index, 3)
            button = QPushButton(
                f"{product['name']}\n{self.currency} {Decimal(str(product['price'])):.2f}"
            )
            button.setMinimumSize(170, 120)
            image_path = resolve_image_path(product["image_path"])
            if image_path is not None:
                button.setIcon(QIcon(str(image_path)))
                button.setIconSize(QSize(64, 64))
            button.clicked.connect(
                lambda checked=False, item=dict(product): self.add_to_cart(item)
            )
            self.catalog_grid.addWidget(button, row, col)
            card_index += 1
        if card_index == 0:
            self.catalog_grid.addWidget(QLabel("No available products found."), 0, 0)

    def add_to_cart(self, product: dict) -> None:
        if self.saved_order_id is not None:
            QMessageBox.information(self, "POS", "Start a new order before changing this one.")
            return
        product_id = int(product["id"])
        available = int(product["stock_quantity"])
        current = self.cart.get(product_id, {}).get("quantity", 0)
        if current >= available:
            QMessageBox.warning(self, "POS", "There is not enough stock for another unit.")
            return
        if product_id not in self.cart:
            self.cart[product_id] = {
                "product_id": product_id,
                "name": product["name"],
                "unit_price": Decimal(str(product["price"])),
                "quantity": 0,
                "available": available,
            }
        self.cart[product_id]["quantity"] += 1
        self.refresh_cart()

    def refresh_cart(self) -> None:
        self.cart_table.setRowCount(len(self.cart))
        subtotal = Decimal("0")
        for row, (product_id, item) in enumerate(self.cart.items()):
            quantity = int(item["quantity"])
            line_total = money(item["unit_price"] * quantity)
            subtotal += line_total
            self.cart_table.setItem(row, 0, QTableWidgetItem(item["name"]))
            quantity_input = QSpinBox()
            quantity_input.setRange(1, int(item["available"]))
            quantity_input.setValue(quantity)
            quantity_input.setEnabled(self.saved_order_id is None)
            quantity_input.valueChanged.connect(
                lambda value, pid=product_id: self.update_quantity(pid, value)
            )
            self.cart_table.setCellWidget(row, 1, quantity_input)
            self.cart_table.setItem(row, 2, QTableWidgetItem(f"{item['unit_price']:.2f}"))
            self.cart_table.setItem(row, 3, QTableWidgetItem(f"{line_total:.2f}"))
            remove_button = QPushButton("Remove")
            remove_button.setEnabled(self.saved_order_id is None)
            remove_button.clicked.connect(
                lambda checked=False, pid=product_id: self.remove_from_cart(pid)
            )
            self.cart_table.setCellWidget(row, 4, remove_button)

        totals = calculate_order_totals(
            money(subtotal),
            Decimal(str(self.discount_rate.value())),
            Decimal(str(self.vat_rate.value())),
            Decimal(str(self.service_rate.value())),
        )
        self.current_total = totals["total"]
        self.subtotal_label.setText(f"Subtotal: {self.currency} {money(subtotal):.2f}")
        self.discount_label.setText(
            f"Discount: {self.currency} {totals['discount_amount']:.2f}"
        )
        self.vat_label.setText(f"VAT: {self.currency} {totals['vat_amount']:.2f}")
        self.service_label.setText(
            f"Service charge: {self.currency} {totals['service_amount']:.2f}"
        )
        self.total_label.setText(f"Total: {self.currency} {totals['total']:.2f}")

    def update_quantity(self, product_id: int, quantity: int) -> None:
        if product_id in self.cart:
            self.cart[product_id]["quantity"] = quantity
            self.refresh_cart()

    def remove_from_cart(self, product_id: int) -> None:
        if self.saved_order_id is None:
            self.cart.pop(product_id, None)
            self.refresh_cart()

    def save_current_order(self) -> None:
        if self.saved_order_id is not None:
            QMessageBox.information(self, "POS", f"Order #{self.saved_order_id} is already saved.")
            return
        items = [
            {
                "product_id": item["product_id"],
                "quantity": item["quantity"],
                "unit_price": item["unit_price"],
            }
            for item in self.cart.values()
        ]
        table_id = self.table_combo.currentData()
        try:
            self.saved_order_id = add_order(
                str(self.order_type.currentData()),
                items,
                created_by=None,
                table_id=int(table_id) if table_id is not None else None,
                discount_pct=Decimal(str(self.discount_rate.value())),
                vat_pct=Decimal(str(self.vat_rate.value())),
                service_pct=Decimal(str(self.service_rate.value())),
                currency=self.currency,
            )
            self._set_saved_state(True)
            self._load_tables()
            QMessageBox.information(self, "POS", f"Order #{self.saved_order_id} saved.")
        except ValueError as error:
            QMessageBox.warning(self, "POS", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "POS", f"Could not save order: {error}")

    def take_payment(self) -> None:
        if self.saved_order_id is None:
            self.save_current_order()
            if self.saved_order_id is None:
                return
        method, accepted = QInputDialog.getItem(
            self, "Payment Method", "Select method", ["Cash", "Card", "M-Pesa", "Other"], 0, False
        )
        if not accepted:
            return
        amount_text, accepted = QInputDialog.getText(
            self, "Amount Paid", "Amount paid", text=f"{self.current_total:.2f}"
        )
        if not accepted:
            return
        transaction_ref = None
        if method == "M-Pesa":
            transaction_ref, accepted = QInputDialog.getText(
                self, "M-Pesa Reference", "Transaction reference (optional)"
            )
            if not accepted:
                return
        try:
            record_payment(
                self.saved_order_id,
                method,
                Decimal(amount_text),
                transaction_ref,
            )
            if method == "M-Pesa":
                QMessageBox.information(
                    self,
                    "Payment pending",
                    "The payment is pending external confirmation. No M-Pesa transaction was sent.",
                )
            else:
                QMessageBox.information(self, "POS", "Payment recorded.")
                self.new_order()
        except (ValueError, ArithmeticError) as error:
            QMessageBox.warning(self, "Payment", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Payment", f"Could not record payment: {error}")

    def cancel_current_order(self) -> None:
        try:
            if self.saved_order_id is not None:
                cancel_order(self.saved_order_id)
            self.new_order()
        except ValueError as error:
            QMessageBox.warning(self, "POS", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "POS", f"Could not cancel order: {error}")

    def new_order(self) -> None:
        self.saved_order_id = None
        self.cart.clear()
        self.discount_rate.setValue(float(self.settings["discount_percentage"]))
        self.vat_rate.setValue(float(self.settings["vat_percentage"]))
        self.service_rate.setValue(float(self.settings["service_percentage"]))
        self._set_saved_state(False)
        self.refresh_cart()
        self._load_tables()

    def _set_saved_state(self, saved: bool) -> None:
        self.order_type.setEnabled(not saved)
        self.table_combo.setEnabled(not saved and self.order_type.currentData() == "dine_in")
        self.category_combo.setEnabled(not saved)
        self.search_input.setEnabled(not saved)
        self.catalog_widget.setEnabled(not saved)
        self.discount_rate.setEnabled(not saved)
        self.vat_rate.setEnabled(not saved)
        self.service_rate.setEnabled(not saved)
        self.refresh_cart()
