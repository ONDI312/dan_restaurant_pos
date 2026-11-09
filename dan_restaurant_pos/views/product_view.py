from __future__ import annotations

import sqlite3
from pathlib import Path

import psycopg
from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QFileDialog,
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

from dan_restaurant_pos.services.catalog_service import (
    create_product,
    deactivate_product,
    list_categories,
    list_products,
    update_product,
)
from dan_restaurant_pos.utils.image_files import store_image


class ProductWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Products")
        self.resize(1100, 750)
        self.product_id: int | None = None
        self.image_path: str | None = None
        self.image_source: Path | None = None
        self._build_ui()
        self._load_categories()
        self.refresh_products()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Product Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)

        form = QFormLayout()
        self.name_input = QLineEdit()
        self.barcode_input = QLineEdit()
        self.category_combo = QComboBox()
        self.price_input = QLineEdit()
        self.price_input.setPlaceholderText("0.00")
        self.cost_input = QLineEdit()
        self.cost_input.setPlaceholderText("0.00")
        self.initial_stock = QSpinBox()
        self.initial_stock.setRange(0, 1_000_000)
        self.minimum_stock = QSpinBox()
        self.minimum_stock.setRange(0, 1_000_000)
        form.addRow("Product name", self.name_input)
        form.addRow("Category", self.category_combo)
        form.addRow("Barcode", self.barcode_input)
        form.addRow("Selling price", self.price_input)
        form.addRow("Cost price", self.cost_input)
        form.addRow("Initial stock", self.initial_stock)
        form.addRow("Low-stock threshold", self.minimum_stock)
        image_row = QHBoxLayout()
        self.image_label = QLabel("No image selected")
        image_button = QPushButton("Choose Image")
        image_button.clicked.connect(self.choose_image)
        image_row.addWidget(self.image_label, 1)
        image_row.addWidget(image_button)
        image_widget = QWidget()
        image_widget.setLayout(image_row)
        form.addRow("Product image", image_widget)
        layout.addLayout(form)

        buttons = QHBoxLayout()
        save_button = QPushButton("Save Product")
        save_button.clicked.connect(self.save_product)
        deactivate_button = QPushButton("Deactivate")
        deactivate_button.clicked.connect(self.deactivate_selected)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        buttons.addWidget(save_button)
        buttons.addWidget(deactivate_button)
        buttons.addWidget(clear_button)
        layout.addLayout(buttons)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search products by name or barcode")
        self.search_input.textChanged.connect(self.refresh_products)
        layout.addWidget(self.search_input)
        self.products_table = QTableWidget(0, 9)
        self.products_table.setHorizontalHeaderLabels(
            ["ID", "Product", "Category", "Barcode", "Price", "Stock", "Min Stock", "Status", "Image"]
        )
        self.products_table.setColumnHidden(0, True)
        self.products_table.setColumnHidden(8, True)
        self.products_table.setSelectionBehavior(
            QTableWidget.SelectionBehavior.SelectRows
        )
        self.products_table.itemSelectionChanged.connect(self.select_product)
        layout.addWidget(self.products_table)

    def _load_categories(self) -> None:
        self.category_combo.clear()
        for category in list_categories():
            self.category_combo.addItem(category["name"], category["id"])

    def refresh_products(self) -> None:
        rows = list_products(search=self.search_input.text(), include_unavailable=True)
        self.products_table.setRowCount(len(rows))
        for row_index, product in enumerate(rows):
            values = (
                product["id"],
                product["name"],
                product["category_name"],
                product["barcode"] or "",
                f"{product['price']:.2f}",
                product["stock_quantity"],
                product["min_stock"],
                "Available" if product["is_available"] else "Inactive",
                product["image_path"] or "",
            )
            for col_index, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                if col_index == 0:
                    item.setData(Qt.ItemDataRole.UserRole, product["id"])
                self.products_table.setItem(row_index, col_index, item)
        self.products_table.resizeColumnsToContents()

    def save_product(self) -> None:
        try:
            category_id = self.category_combo.currentData()
            if category_id is None:
                raise ValueError("Create a category before adding products.")
            image_path = (
                store_image(self.image_source, "products")
                if self.image_source is not None
                else self.image_path
            )
            if self.product_id is None:
                create_product(
                    name=self.name_input.text(),
                    category_id=int(category_id),
                    price=self.price_input.text(),
                    barcode=self.barcode_input.text(),
                    cost_price=self.cost_input.text() or "0",
                    initial_stock=self.initial_stock.value(),
                    min_stock=self.minimum_stock.value(),
                    image_path=image_path,
                )
            else:
                update_product(
                    self.product_id,
                    name=self.name_input.text(),
                    category_id=int(category_id),
                    price=self.price_input.text(),
                    barcode=self.barcode_input.text(),
                    cost_price=self.cost_input.text() or "0",
                    min_stock=self.minimum_stock.value(),
                    image_path=image_path,
                )
            self.clear_form()
            self.refresh_products()
        except (ValueError, TypeError) as error:
            QMessageBox.warning(self, "Product", str(error))
        except OSError as error:
            QMessageBox.critical(self, "Product", f"Could not store image: {error}")
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Product", f"Could not save product: {error}")

    def select_product(self) -> None:
        selected = self.products_table.selectedItems()
        if not selected:
            return
        row = self.products_table.currentRow()
        self.product_id = int(self.products_table.item(row, 0).text())
        self.name_input.setText(self.products_table.item(row, 1).text())
        category_name = self.products_table.item(row, 2).text()
        self.barcode_input.setText(self.products_table.item(row, 3).text())
        category_index = self.category_combo.findText(category_name)
        if category_index >= 0:
            self.category_combo.setCurrentIndex(category_index)
        self.price_input.setText(self.products_table.item(row, 4).text())
        self.minimum_stock.setValue(int(self.products_table.item(row, 6).text()))
        self.image_path = self.products_table.item(row, 8).text() or None
        self.image_source = None
        self.image_label.setText(
            Path(self.image_path).name if self.image_path else "No image selected"
        )
        self.initial_stock.setEnabled(False)

    def choose_image(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Choose product image", "", "Images (*.jpg *.jpeg *.png)"
        )
        if path:
            self.image_source = Path(path)
            self.image_label.setText(self.image_source.name)

    def deactivate_selected(self) -> None:
        if self.product_id is None:
            QMessageBox.information(self, "Product", "Select a product first.")
            return
        try:
            deactivate_product(self.product_id)
            self.clear_form()
            self.refresh_products()
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Product", f"Could not deactivate product: {error}")

    def clear_form(self) -> None:
        self.product_id = None
        self.image_path = None
        self.image_source = None
        self.image_label.setText("No image selected")
        self.name_input.clear()
        self.barcode_input.clear()
        self.price_input.clear()
        self.cost_input.clear()
        self.initial_stock.setEnabled(True)
        self.initial_stock.setValue(0)
        self.minimum_stock.setValue(0)
        self.products_table.clearSelection()
