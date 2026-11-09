from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtCore import Qt, QTimer
from PyQt6.QtWidgets import (
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.kitchen_service import (
    NEXT_STATUS,
    advance_kitchen_ticket,
    list_kitchen_tickets,
)


class KotWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Kitchen Orders")
        self.resize(1250, 750)
        self.selected_order_id: int | None = None
        self.selected_status: str | None = None
        self._build_ui()
        self.refresh_tickets()
        self.refresh_timer = QTimer(self)
        self.refresh_timer.setInterval(10_000)
        self.refresh_timer.timeout.connect(self.refresh_tickets)
        self.refresh_timer.start()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Kitchen Order Tickets")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        self.tickets_table = QTableWidget(0, 6)
        self.tickets_table.setHorizontalHeaderLabels(
            ["Order", "Type", "Table", "Created", "Items", "Status"]
        )
        self.tickets_table.itemSelectionChanged.connect(self.select_ticket)
        layout.addWidget(self.tickets_table)
        self.advance_button = QPushButton("Select a ticket")
        self.advance_button.setEnabled(False)
        self.advance_button.clicked.connect(self.advance_ticket)
        layout.addWidget(self.advance_button)

    def refresh_tickets(self) -> None:
        selected_id = self.selected_order_id
        tickets = list_kitchen_tickets()
        self.tickets_table.setRowCount(len(tickets))
        target_row = None
        for row_index, ticket in enumerate(tickets):
            item_lines = []
            for item in ticket["items"]:
                line = f"{item['quantity']} x {item['name']}"
                if item["special_instructions"]:
                    line += f" ({item['special_instructions']})"
                item_lines.append(line)
            values = (
                ticket["order_number"],
                ticket["order_type"].replace("_", " ").title(),
                ticket["table_name"] or "-",
                str(ticket["created_at"]),
                "\n".join(item_lines),
                ticket["kitchen_status"].title(),
            )
            for col_index, value in enumerate(values):
                item = QTableWidgetItem(str(value))
                if col_index == 0:
                    item.setData(Qt.ItemDataRole.UserRole, ticket["id"])
                    item.setData(Qt.ItemDataRole.UserRole + 1, ticket["kitchen_status"])
                self.tickets_table.setItem(row_index, col_index, item)
            if ticket["id"] == selected_id:
                target_row = row_index
        self.tickets_table.resizeColumnsToContents()
        if target_row is not None:
            self.tickets_table.selectRow(target_row)
        else:
            self.selected_order_id = None
            self.selected_status = None
            self.advance_button.setEnabled(False)
            self.advance_button.setText("Select a ticket")

    def select_ticket(self) -> None:
        if not self.tickets_table.selectedItems():
            return
        row = self.tickets_table.currentRow()
        order_item = self.tickets_table.item(row, 0)
        self.selected_order_id = int(order_item.data(Qt.ItemDataRole.UserRole))
        self.selected_status = order_item.data(Qt.ItemDataRole.UserRole + 1)
        self.advance_button.setText(
            f"Mark {NEXT_STATUS[self.selected_status].title()}"
        )
        self.advance_button.setEnabled(True)

    def advance_ticket(self) -> None:
        if self.selected_order_id is None:
            return
        try:
            advance_kitchen_ticket(self.selected_order_id)
            self.refresh_tickets()
        except ValueError as error:
            QMessageBox.warning(self, "Kitchen Ticket", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(
                self, "Kitchen Ticket", f"Could not update ticket: {error}"
            )
