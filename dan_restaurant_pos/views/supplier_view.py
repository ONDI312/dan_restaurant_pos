from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtWidgets import (
    QFormLayout,
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

from dan_restaurant_pos.services.supplier_service import (
    deactivate_supplier,
    list_suppliers,
    save_supplier,
)


class SupplierWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Suppliers")
        self.resize(1050, 700)
        self.supplier_id: int | None = None
        self._build_ui()
        self.refresh_suppliers()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Supplier Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        form = QFormLayout()
        self.name_input = QLineEdit()
        self.contact_input = QLineEdit()
        self.phone_input = QLineEdit()
        self.email_input = QLineEdit()
        self.address_input = QLineEdit()
        form.addRow("Business name", self.name_input)
        form.addRow("Contact person", self.contact_input)
        form.addRow("Phone", self.phone_input)
        form.addRow("Email", self.email_input)
        form.addRow("Address", self.address_input)
        layout.addLayout(form)
        actions = QHBoxLayout()
        save_button = QPushButton("Save Supplier")
        save_button.clicked.connect(self.save)
        deactivate_button = QPushButton("Deactivate")
        deactivate_button.clicked.connect(self.deactivate)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        actions.addWidget(save_button)
        actions.addWidget(deactivate_button)
        actions.addWidget(clear_button)
        layout.addLayout(actions)
        self.suppliers_table = QTableWidget(0, 7)
        self.suppliers_table.setHorizontalHeaderLabels(
            ["ID", "Supplier", "Contact", "Phone", "Email", "Address", "Status"]
        )
        self.suppliers_table.setColumnHidden(0, True)
        self.suppliers_table.itemSelectionChanged.connect(self.select_supplier)
        layout.addWidget(self.suppliers_table)

    def refresh_suppliers(self) -> None:
        rows = list_suppliers(include_inactive=True)
        self.suppliers_table.setRowCount(len(rows))
        for row_index, supplier in enumerate(rows):
            values = (
                supplier["id"],
                supplier["name"],
                supplier["contact_person"] or "",
                supplier["phone"] or "",
                supplier["email"] or "",
                supplier["address"] or "",
                "Active" if supplier["is_active"] else "Inactive",
            )
            for col_index, value in enumerate(values):
                self.suppliers_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.suppliers_table.resizeColumnsToContents()

    def save(self) -> None:
        try:
            self.supplier_id = save_supplier(
                supplier_id=self.supplier_id,
                name=self.name_input.text(),
                contact_person=self.contact_input.text(),
                phone=self.phone_input.text(),
                email=self.email_input.text(),
                address=self.address_input.text(),
            )
            self.clear_form()
            self.refresh_suppliers()
        except ValueError as error:
            QMessageBox.warning(self, "Supplier", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Supplier", f"Could not save supplier: {error}")

    def deactivate(self) -> None:
        if self.supplier_id is None:
            QMessageBox.information(self, "Supplier", "Select a supplier first.")
            return
        try:
            deactivate_supplier(self.supplier_id)
            self.clear_form()
            self.refresh_suppliers()
        except ValueError as error:
            QMessageBox.warning(self, "Supplier", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(
                self, "Supplier", f"Could not deactivate supplier: {error}"
            )

    def select_supplier(self) -> None:
        if not self.suppliers_table.selectedItems():
            return
        row = self.suppliers_table.currentRow()
        self.supplier_id = int(self.suppliers_table.item(row, 0).text())
        self.name_input.setText(self.suppliers_table.item(row, 1).text())
        self.contact_input.setText(self.suppliers_table.item(row, 2).text())
        self.phone_input.setText(self.suppliers_table.item(row, 3).text())
        self.email_input.setText(self.suppliers_table.item(row, 4).text())
        self.address_input.setText(self.suppliers_table.item(row, 5).text())

    def clear_form(self) -> None:
        self.supplier_id = None
        for widget in (
            self.name_input,
            self.contact_input,
            self.phone_input,
            self.email_input,
            self.address_input,
        ):
            widget.clear()
        self.suppliers_table.clearSelection()
