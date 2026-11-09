from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QInputDialog,
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

from dan_restaurant_pos.services.expense_service import (
    create_expense_category,
    list_expense_categories,
    list_expenses,
    save_expense,
)
from dan_restaurant_pos.services.settings_service import get_settings


class ExpenseWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Expenses")
        self.resize(1100, 750)
        self.expense_id: int | None = None
        self.currency = get_settings()["currency"]
        self._build_ui()
        self.refresh_categories()
        self.refresh_expenses()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Expense Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        form = QFormLayout()
        category_row = QHBoxLayout()
        self.category_combo = QComboBox()
        add_category_button = QPushButton("Add Category")
        add_category_button.clicked.connect(self.add_category)
        category_row.addWidget(self.category_combo, 1)
        category_row.addWidget(add_category_button)
        category_widget = QWidget()
        category_widget.setLayout(category_row)
        self.description_input = QLineEdit()
        self.amount_input = QLineEdit()
        self.amount_input.setPlaceholderText("0.00")
        self.method_combo = QComboBox()
        self.method_combo.addItems(["Cash", "Card", "M-Pesa", "Other"])
        form.addRow("Category", category_widget)
        form.addRow("Description", self.description_input)
        form.addRow(f"Amount ({self.currency})", self.amount_input)
        form.addRow("Payment method", self.method_combo)
        layout.addLayout(form)
        actions = QHBoxLayout()
        save_button = QPushButton("Save Expense")
        save_button.clicked.connect(self.save)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        actions.addWidget(save_button)
        actions.addWidget(clear_button)
        layout.addLayout(actions)
        self.expenses_table = QTableWidget(0, 6)
        self.expenses_table.setHorizontalHeaderLabels(
            ["ID", "Date", "Category", "Description", "Amount", "Method"]
        )
        self.expenses_table.setColumnHidden(0, True)
        self.expenses_table.itemSelectionChanged.connect(self.select_expense)
        layout.addWidget(self.expenses_table)

    def refresh_categories(self) -> None:
        self.category_combo.clear()
        for category in list_expense_categories():
            self.category_combo.addItem(category["name"], category["id"])

    def add_category(self) -> None:
        name, accepted = QInputDialog.getText(self, "Expense Category", "Category name")
        if not accepted:
            return
        try:
            create_expense_category(name)
            self.refresh_categories()
            index = self.category_combo.findText(name.strip())
            if index >= 0:
                self.category_combo.setCurrentIndex(index)
        except ValueError as error:
            QMessageBox.warning(self, "Expense Category", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(
                self, "Expense Category", f"Could not add category: {error}"
            )

    def refresh_expenses(self) -> None:
        rows = list_expenses()
        self.expenses_table.setRowCount(len(rows))
        for row_index, expense in enumerate(rows):
            values = (
                expense["id"],
                str(expense["created_at"]),
                expense["category"] or "",
                expense["description"],
                f"{expense['currency']} {expense['amount']:.2f}",
                expense["method"] or "",
            )
            for col_index, value in enumerate(values):
                self.expenses_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.expenses_table.resizeColumnsToContents()

    def save(self) -> None:
        category_id = self.category_combo.currentData()
        if category_id is None:
            QMessageBox.warning(self, "Expense", "Add an expense category first.")
            return
        try:
            self.expense_id = save_expense(
                expense_id=self.expense_id,
                category_id=int(category_id),
                description=self.description_input.text(),
                amount=self.amount_input.text(),
                method=self.method_combo.currentText(),
                currency=self.currency,
            )
            self.clear_form()
            self.refresh_expenses()
        except (ValueError, ArithmeticError) as error:
            QMessageBox.warning(self, "Expense", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Expense", f"Could not save expense: {error}")

    def select_expense(self) -> None:
        if not self.expenses_table.selectedItems():
            return
        row = self.expenses_table.currentRow()
        self.expense_id = int(self.expenses_table.item(row, 0).text())
        category_index = self.category_combo.findText(
            self.expenses_table.item(row, 2).text()
        )
        if category_index >= 0:
            self.category_combo.setCurrentIndex(category_index)
        self.description_input.setText(self.expenses_table.item(row, 3).text())
        self.amount_input.setText(
            self.expenses_table.item(row, 4).text().split(" ", maxsplit=1)[-1]
        )
        method_index = self.method_combo.findText(self.expenses_table.item(row, 5).text())
        if method_index >= 0:
            self.method_combo.setCurrentIndex(method_index)

    def clear_form(self) -> None:
        self.expense_id = None
        self.description_input.clear()
        self.amount_input.clear()
        self.expenses_table.clearSelection()
