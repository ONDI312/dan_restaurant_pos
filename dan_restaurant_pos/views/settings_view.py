from __future__ import annotations

import sqlite3

import psycopg
from PyQt6.QtWidgets import (
    QFormLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.settings_service import get_settings, save_settings


class SettingsWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("DAN RESTAURANT POS - Settings")
        self.resize(800, 700)
        self._build_ui()
        self.load_settings()

    def _build_ui(self) -> None:
        root = QWidget()
        self.setCentralWidget(root)
        layout = QVBoxLayout(root)
        title = QLabel("Restaurant Settings")
        title.setStyleSheet("font-size: 24px; font-weight: bold;")
        layout.addWidget(title)
        form = QFormLayout()
        self.fields = {
            "restaurant_name": QLineEdit(),
            "phone": QLineEdit(),
            "email": QLineEdit(),
            "address": QLineEdit(),
            "currency": QLineEdit(),
            "discount_percentage": QLineEdit(),
            "vat_percentage": QLineEdit(),
            "service_percentage": QLineEdit(),
            "receipt_footer": QLineEdit(),
        }
        labels = {
            "restaurant_name": "Restaurant name",
            "phone": "Phone",
            "email": "Email",
            "address": "Address",
            "currency": "Currency code",
            "discount_percentage": "Default discount percentage",
            "vat_percentage": "VAT percentage",
            "service_percentage": "Service charge percentage",
            "receipt_footer": "Receipt footer",
        }
        for key, widget in self.fields.items():
            form.addRow(labels[key], widget)
        layout.addLayout(form)
        save_button = QPushButton("Save Settings")
        save_button.clicked.connect(self.save)
        layout.addWidget(save_button)

    def load_settings(self) -> None:
        for key, value in get_settings().items():
            if key in self.fields:
                self.fields[key].setText(value)

    def save(self) -> None:
        values = {key: widget.text() for key, widget in self.fields.items()}
        try:
            save_settings(values)
            QMessageBox.information(self, "Settings", "Settings saved.")
        except ValueError as error:
            QMessageBox.warning(self, "Settings", str(error))
        except (psycopg.Error, sqlite3.Error) as error:
            QMessageBox.critical(self, "Settings", f"Could not save settings: {error}")
