from __future__ import annotations

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (QComboBox, QHBoxLayout, QLabel, QLineEdit, QMainWindow,
    QApplication,QComboBox, QHBoxLayout, QLabel, QLineEdit, QMainWindow,
                             QMessageBox, QPushButton, QVBoxLayout, QWidget)

from dan_restaurant_pos.database.db_utils import fetch_all
from dan_restaurant_pos.services.access_control import set_current_user
from dan_restaurant_pos.services.auth_service import authenticate_user
from dan_restaurant_pos.views.dashboard_view import DashboardWindow


class LoginWindow(QMainWindow):
    def __init__(self, setup_pin: str | None = None) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - LOGIN")
        self.resize(900, 700)
        self.build_ui()
        self.load_users()
        if setup_pin:
            QMessageBox.information(
                self,
                "Initial administrator PIN",
                f"Admin PIN: {setup_pin}\nRecord this PIN now. It will not be shown again.",
            )

    def build_ui(self) -> None:
        self.central_widget = QWidget()
        self.setCentralWidget(self.central_widget)
        layout = QVBoxLayout(self.central_widget)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        title = QLabel("DAN RESTAURANT POS")
        title.setStyleSheet("font-size: 32px; font-weight: bold; color: #34251D; margin-bottom: 20px;")
        layout.addWidget(title)

        self.user_combo = QComboBox()
        self.user_combo.addItem("Select User Name")
        self.user_combo.setStyleSheet("QComboBox { min-height: 52px; font-size: 18px; padding: 8px; background: white; border: 2px solid #B34700; border-radius: 10px; }")
        layout.addWidget(self.user_combo)

        self.pin_input = QLineEdit()
        self.pin_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.pin_input.setPlaceholderText("Type Pin")
        self.pin_input.setStyleSheet("QLineEdit { min-height: 52px; font-size: 18px; padding: 8px; background: white; border: 2px solid #B34700; border-radius: 10px; }")
        layout.addWidget(self.pin_input)

        keypad_layout = QHBoxLayout()
        keyboard_values = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]
        for value in keyboard_values:
            button = QPushButton(value)
            button.setFixedSize(110, 80)
            button.setStyleSheet("QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #D65A00, stop:1 #B34700); color: white; font-size: 28px; border-radius: 12px; }")
            button.clicked.connect(lambda checked=False, v=value: self.pin_input.setText(self.pin_input.text() + v))
            keypad_layout.addWidget(button)
        layout.addLayout(keypad_layout)

        action_row = QHBoxLayout()
        clear_button = QPushButton("Clear")
        clear_button.clicked.connect(self.pin_input.clear)
        login_button = QPushButton("Login")
        login_button.clicked.connect(self.login)
        shutdown_button = QPushButton("Shutdown")
        shutdown_button.clicked.connect(self.close)

        for button in (clear_button, login_button, shutdown_button):
            button.setStyleSheet("QPushButton { min-height: 54px; font-size: 18px; border-radius: 10px; background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #B34700, stop:1 #803000); color: white; }")
            action_row.addWidget(button)
        layout.addLayout(action_row)

    def load_users(self) -> None:
        self.user_combo.clear()
        self.user_combo.addItem("Select User Name")
        rows = fetch_all("SELECT username FROM users WHERE is_active = TRUE ORDER BY username")
        for row in rows:
            self.user_combo.addItem(row["username"])

    def login(self) -> None:
        username = self.user_combo.currentText()
        pin = self.pin_input.text()
        if username == "Select User Name":
            QMessageBox.warning(self, "Login", "Please select a user.")
            return
        user = authenticate_user(username, pin)
        if user is None:
            QMessageBox.warning(self, "Login", "Invalid PIN or inactive account.")
            return
        self.dashboard = DashboardWindow(
            username=user["full_name"],
            on_logout=self.logout,
            on_exit=QApplication.instance().quit,
        )
        self.dashboard.show()
        self.hide()

    def logout(self) -> None:
        set_current_user(None)
        self.pin_input.clear()
        self.user_combo.setCurrentIndex(0)
        self.load_users()
        self.show()
