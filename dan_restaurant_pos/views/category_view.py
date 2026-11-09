from __future__ import annotations

import sqlite3
from pathlib import Path

import psycopg
from PyQt6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.database.db_utils import fetch_all
from dan_restaurant_pos.services.catalog_service import (
    create_category,
    delete_category,
    list_categories,
    update_category,
)
from dan_restaurant_pos.utils.image_files import store_image


class CategoryWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Categories")
        self.resize(800, 600)
        self.category_id: int | None = None
        self.image_path: str | None = None
        self.image_source: Path | None = None
        self._build_ui()
        self.refresh_categories()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Category Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)

        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("Category name")
        layout.addWidget(self.name_input)
        image_row = QHBoxLayout()
        self.image_label = QLabel("No image selected")
        image_button = QPushButton("Choose Image")
        image_button.clicked.connect(self.choose_image)
        image_row.addWidget(self.image_label, 1)
        image_row.addWidget(image_button)
        layout.addLayout(image_row)
        actions = QHBoxLayout()
        save_button = QPushButton("Save Category")
        save_button.clicked.connect(self.save_category)
        delete_button = QPushButton("Delete Category")
        delete_button.clicked.connect(self.remove_category)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        actions.addWidget(save_button)
        actions.addWidget(delete_button)
        actions.addWidget(clear_button)
        layout.addLayout(actions)

        self.categories_table = QTableWidget(0, 4)
        self.categories_table.setHorizontalHeaderLabels(
            ["ID", "Category", "Products", "Image"]
        )
        self.categories_table.setColumnHidden(0, True)
        self.categories_table.setColumnHidden(3, True)
        self.categories_table.itemSelectionChanged.connect(self.select_category)
        layout.addWidget(self.categories_table)

    def refresh_categories(self) -> None:
        categories = list_categories()
        self.categories_table.setRowCount(len(categories))
        for row_index, category in enumerate(categories):
            product_count = fetch_all(
                "SELECT id FROM products WHERE category_id = ?", (category["id"],)
            )
            for col_index, value in enumerate(
                (
                    category["id"],
                    category["name"],
                    len(product_count),
                    category["image_path"] or "",
                )
            ):
                self.categories_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.categories_table.resizeColumnsToContents()

    def save_category(self) -> None:
        try:
            image_path = (
                store_image(self.image_source, "categories")
                if self.image_source is not None
                else self.image_path
            )
            if self.category_id is None:
                create_category(self.name_input.text(), image_path=image_path)
            else:
                update_category(
                    self.category_id, self.name_input.text(), image_path=image_path
                )
            self.clear_form()
            self.refresh_categories()
        except ValueError as error:
            QMessageBox.warning(self, "Category", str(error))
        except OSError as error:
            QMessageBox.critical(self, "Category", f"Could not store image: {error}")
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Category", f"Could not save category: {error}")

    def choose_image(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Choose category image", "", "Images (*.jpg *.jpeg *.png)"
        )
        if path:
            self.image_source = Path(path)
            self.image_label.setText(self.image_source.name)

    def remove_category(self) -> None:
        if self.category_id is None:
            QMessageBox.information(self, "Category", "Select a category first.")
            return
        try:
            delete_category(self.category_id)
            self.clear_form()
            self.refresh_categories()
        except ValueError as error:
            QMessageBox.warning(self, "Category", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Category", f"Could not delete category: {error}")

    def select_category(self) -> None:
        selected = self.categories_table.selectedItems()
        if not selected:
            return
        row = self.categories_table.currentRow()
        self.category_id = int(self.categories_table.item(row, 0).text())
        self.name_input.setText(self.categories_table.item(row, 1).text())
        self.image_path = self.categories_table.item(row, 3).text() or None
        self.image_source = None
        self.image_label.setText(
            Path(self.image_path).name if self.image_path else "No image selected"
        )

    def clear_form(self) -> None:
        self.category_id = None
        self.image_path = None
        self.image_source = None
        self.image_label.setText("No image selected")
        self.name_input.clear()
        self.categories_table.clearSelection()
