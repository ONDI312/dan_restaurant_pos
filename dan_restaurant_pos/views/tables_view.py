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
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.table_service import (
    create_table,
    deactivate_table,
    list_tables,
    update_table,
)


class TablesWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Tables")
        self.resize(900, 650)
        self.table_id: int | None = None
        self._build_ui()
        self.refresh_tables()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Restaurant Tables")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)

        form = QFormLayout()
        self.name_input = QLineEdit()
        self.capacity_input = QSpinBox()
        self.capacity_input.setRange(1, 100)
        form.addRow("Table name", self.name_input)
        form.addRow("Capacity", self.capacity_input)
        layout.addLayout(form)
        actions = QHBoxLayout()
        save_button = QPushButton("Save Table")
        save_button.clicked.connect(self.save_table)
        deactivate_button = QPushButton("Deactivate")
        deactivate_button.clicked.connect(self.remove_table)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        actions.addWidget(save_button)
        actions.addWidget(deactivate_button)
        actions.addWidget(clear_button)
        layout.addLayout(actions)

        self.tables_table = QTableWidget(0, 5)
        self.tables_table.setHorizontalHeaderLabels(
            ["ID", "Table", "Capacity", "Status", "Active"]
        )
        self.tables_table.setColumnHidden(0, True)
        self.tables_table.itemSelectionChanged.connect(self.select_table)
        layout.addWidget(self.tables_table)

    def refresh_tables(self) -> None:
        rows = list_tables(include_inactive=True)
        self.tables_table.setRowCount(len(rows))
        for row_index, table in enumerate(rows):
            values = (
                table["id"],
                table["table_name"],
                table["capacity"],
                table["status"].title(),
                "Yes" if table["is_active"] else "No",
            )
            for col_index, value in enumerate(values):
                self.tables_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.tables_table.resizeColumnsToContents()

    def save_table(self) -> None:
        try:
            if self.table_id is None:
                create_table(self.name_input.text(), self.capacity_input.value())
            else:
                update_table(
                    self.table_id,
                    self.name_input.text(),
                    self.capacity_input.value(),
                )
            self.clear_form()
            self.refresh_tables()
        except ValueError as error:
            QMessageBox.warning(self, "Tables", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Tables", f"Could not save table: {error}")

    def remove_table(self) -> None:
        if self.table_id is None:
            QMessageBox.information(self, "Tables", "Select a table first.")
            return
        try:
            deactivate_table(self.table_id)
            self.clear_form()
            self.refresh_tables()
        except ValueError as error:
            QMessageBox.warning(self, "Tables", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Tables", f"Could not deactivate table: {error}")

    def select_table(self) -> None:
        if not self.tables_table.selectedItems():
            return
        row = self.tables_table.currentRow()
        self.table_id = int(self.tables_table.item(row, 0).text())
        self.name_input.setText(self.tables_table.item(row, 1).text())
        self.capacity_input.setValue(int(self.tables_table.item(row, 2).text()))

    def clear_form(self) -> None:
        self.table_id = None
        self.name_input.clear()
        self.capacity_input.setValue(4)
        self.tables_table.clearSelection()
