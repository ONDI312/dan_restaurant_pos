from __future__ import annotations

import sqlite3

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
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.user_service import (
    create_user,
    list_roles,
    list_users,
    reset_user_pin,
    set_user_active,
    update_user,
)


class UsersWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Users")
        self.resize(1050, 700)
        self.user_id: int | None = None
        self.user_active = True
        self._build_ui()
        self._load_roles()
        self.refresh_users()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("User Management")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        form = QFormLayout()
        self.username_input = QLineEdit()
        self.full_name_input = QLineEdit()
        self.pin_input = QLineEdit()
        self.pin_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pin_input.setPlaceholderText("At least four digits")
        self.role_combo = QComboBox()
        form.addRow("Username", self.username_input)
        form.addRow("Full name", self.full_name_input)
        form.addRow("PIN", self.pin_input)
        form.addRow("Role", self.role_combo)
        layout.addLayout(form)
        actions = QHBoxLayout()
        save_button = QPushButton("Save User")
        save_button.clicked.connect(self.save_user)
        reset_button = QPushButton("Reset PIN")
        reset_button.clicked.connect(self.reset_pin)
        active_button = QPushButton("Toggle Active")
        active_button.clicked.connect(self.toggle_active)
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.clear_form)
        for button in (save_button, reset_button, active_button, clear_button):
            actions.addWidget(button)
        layout.addLayout(actions)
        self.users_table = QTableWidget(0, 6)
        self.users_table.setHorizontalHeaderLabels(
            ["ID", "Username", "Full Name", "Role", "Active", "Last Login"]
        )
        self.users_table.setColumnHidden(0, True)
        self.users_table.itemSelectionChanged.connect(self.select_user)
        layout.addWidget(self.users_table)

    def _load_roles(self) -> None:
        self.role_combo.clear()
        for role in list_roles():
            self.role_combo.addItem(role["name"], role["id"])

    def refresh_users(self) -> None:
        rows = list_users()
        self.users_table.setRowCount(len(rows))
        for row_index, user in enumerate(rows):
            values = (
                user["id"],
                user["username"],
                user["full_name"],
                user["role_name"],
                "Yes" if user["is_active"] else "No",
                str(user["last_login"] or "Never"),
            )
            for col_index, value in enumerate(values):
                self.users_table.setItem(
                    row_index, col_index, QTableWidgetItem(str(value))
                )
        self.users_table.resizeColumnsToContents()

    def save_user(self) -> None:
        role_id = self.role_combo.currentData()
        if role_id is None:
            QMessageBox.warning(self, "Users", "Create a role before adding users.")
            return
        try:
            if self.user_id is None:
                create_user(
                    self.username_input.text(),
                    self.full_name_input.text(),
                    int(role_id),
                    self.pin_input.text(),
                )
            else:
                update_user(
                    self.user_id,
                    self.full_name_input.text(),
                    int(role_id),
                )
            self.clear_form()
            self.refresh_users()
        except ValueError as error:
            QMessageBox.warning(self, "Users", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Users", f"Could not save user: {error}")

    def reset_pin(self) -> None:
        if self.user_id is None:
            QMessageBox.information(self, "Users", "Select a user first.")
            return
        try:
            reset_user_pin(self.user_id, self.pin_input.text())
            self.pin_input.clear()
            QMessageBox.information(self, "Users", "PIN updated.")
        except ValueError as error:
            QMessageBox.warning(self, "Users", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Users", f"Could not reset PIN: {error}")

    def toggle_active(self) -> None:
        if self.user_id is None:
            QMessageBox.information(self, "Users", "Select a user first.")
            return
        try:
            set_user_active(self.user_id, not self.user_active)
            self.user_active = not self.user_active
            self.refresh_users()
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Users", f"Could not change user status: {error}")

    def select_user(self) -> None:
        if not self.users_table.selectedItems():
            return
        row = self.users_table.currentRow()
        self.user_id = int(self.users_table.item(row, 0).text())
        self.username_input.setText(self.users_table.item(row, 1).text())
        self.username_input.setEnabled(False)
        self.full_name_input.setText(self.users_table.item(row, 2).text())
        role_index = self.role_combo.findText(self.users_table.item(row, 3).text())
        if role_index >= 0:
            self.role_combo.setCurrentIndex(role_index)
        self.user_active = self.users_table.item(row, 4).text() == "Yes"
        self.pin_input.clear()

    def clear_form(self) -> None:
        self.user_id = None
        self.username_input.setEnabled(True)
        self.username_input.clear()
        self.full_name_input.clear()
        self.pin_input.clear()
        self.users_table.clearSelection()
