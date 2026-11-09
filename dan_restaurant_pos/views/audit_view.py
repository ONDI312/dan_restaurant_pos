from __future__ import annotations

import sqlite3

import psycopg
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

from dan_restaurant_pos.services.audit_service import list_audit_logs


class AuditLogWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Audit Log")
        self.resize(1200, 750)
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Audit Log")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        refresh_button = QPushButton("Refresh")
        refresh_button.clicked.connect(self.refresh)
        layout.addWidget(refresh_button)
        self.table = QTableWidget(0, 7)
        self.table.setHorizontalHeaderLabels(
            ["ID", "Date", "User", "Action", "Entity", "Entity ID", "Details"]
        )
        self.table.setColumnHidden(0, True)
        layout.addWidget(self.table)
        self.refresh()

    def refresh(self) -> None:
        try:
            rows = list_audit_logs()
            self.table.setRowCount(len(rows))
            for row_index, record in enumerate(rows):
                values = (
                    record["id"],
                    str(record["created_at"]),
                    record["username"] or "System",
                    record["action"],
                    record["entity_type"],
                    record["entity_id"] or "",
                    record["details"],
                )
                for column, value in enumerate(values):
                    self.table.setItem(
                        row_index, column, QTableWidgetItem(str(value))
                    )
            self.table.resizeColumnsToContents()
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Audit Log", f"Could not load audit log: {error}")
