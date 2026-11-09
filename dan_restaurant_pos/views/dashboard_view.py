from __future__ import annotations

from collections.abc import Callable

from PyQt6.QtWidgets import (
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from dan_restaurant_pos.services.access_control import has_permission, require_permission
from dan_restaurant_pos.views.category_view import CategoryWindow
from dan_restaurant_pos.views.audit_view import AuditLogWindow
from dan_restaurant_pos.views.expense_view import ExpenseWindow
from dan_restaurant_pos.views.inventory_view import InventoryWindow
from dan_restaurant_pos.views.invoice_list_view import InvoiceListWindow
from dan_restaurant_pos.views.kot_view import KotWindow
from dan_restaurant_pos.views.pos_view import PosWindow
from dan_restaurant_pos.views.product_view import ProductWindow
from dan_restaurant_pos.views.purchase_view import PurchaseWindow
from dan_restaurant_pos.views.reports_view import ReportsWindow
from dan_restaurant_pos.views.supplier_view import SupplierWindow
from dan_restaurant_pos.views.settings_view import SettingsWindow
from dan_restaurant_pos.views.tables_view import TablesWindow
from dan_restaurant_pos.views.users_view import UsersWindow


class DashboardWindow(QMainWindow):
    MODULE_PERMISSIONS = {
        "pos": "pos.use",
        "product": "catalog.manage",
        "inventory": "inventory.manage",
        "supplier": "suppliers.manage",
        "purchase": "purchases.manage",
        "category": "catalog.manage",
        "tables": "tables.manage",
        "dashboard": "reports.view",
        "expense": "expenses.manage",
        "reports": "reports.view",
        "users": "users.manage",
        "settings": "settings.manage",
        "audit": "audit.read",
        "invoice": "invoices.view",
        "kot": "kitchen.use",
        "close": "app.close",
    }

    def __init__(
        self,
        username: str = "User",
        on_logout: Callable[[], None] | None = None,
        on_exit: Callable[[], None] | None = None,
    ) -> None:
        super().__init__()
        self.username = username
        self.on_logout = on_logout
        self.on_exit = on_exit
        self.setWindowTitle("DAN RESTAURANT POS - Dashboard")
        self.resize(1400, 900)
        self.module_windows: list[QMainWindow] = []
        self.build_ui()

    def build_ui(self) -> None:
        central = QWidget()
        self.setCentralWidget(central)
        root_layout = QVBoxLayout(central)

        header_layout = QHBoxLayout()
        brand_label = QLabel("DAN RESTAURANT POS")
        brand_label.setStyleSheet("font-size: 24px; font-weight: bold; color: #803000;")
        header_layout.addWidget(brand_label)
        header_layout.addStretch()
        username_label = QLabel(self.username)
        username_label.setStyleSheet("font-size: 22px; font-weight: bold; color: #34251D;")
        header_layout.addWidget(username_label)
        logout_button = QPushButton("Logout")
        logout_button.clicked.connect(self.logout)
        header_layout.addWidget(logout_button)
        root_layout.addLayout(header_layout)

        grid = QGridLayout()
        modules = [
            ("POS", "pos"), ("Product", "product"), ("Inventory", "inventory"), ("Supplier", "supplier"), ("Purchase", "purchase"),
            ("Category", "category"), ("Tables", "tables"), ("Dashboard", "dashboard"), ("Expense", "expense"), ("Reports", "reports"),
            ("Users", "users"), ("Settings", "settings"), ("Invoice List", "invoice"), ("KOT", "kot"), ("Close", "close"),
            ("Audit Log", "audit"),
        ]
        for index, (name, action) in enumerate(modules):
            row, col = divmod(index, 5)
            button = QPushButton(name)
            button.setMinimumSize(200, 150)
            button.setVisible(has_permission(self.MODULE_PERMISSIONS[action]))
            button.setStyleSheet("QPushButton { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #D65A00, stop:1 #B34700); color: white; font-size: 22px; border-radius: 12px; } QPushButton:hover { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #E77A2D, stop:1 #C65D1C); } QPushButton:pressed { background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 #8D3A08, stop:1 #6a2b00); }")
            button.clicked.connect(lambda checked=False, a=action: self.handle_action(a))
            grid.addWidget(button, row, col)
        root_layout.addLayout(grid)

    def handle_action(self, action: str) -> None:
        try:
            require_permission(self.MODULE_PERMISSIONS[action])
        except PermissionError as error:
            QMessageBox.warning(self, "Access denied", str(error))
            return
        if action == "close":
            answer = QMessageBox.question(
                self,
                "Close DAN RESTAURANT POS",
                "Are you sure you want to close the application?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No,
            )
            if answer == QMessageBox.StandardButton.Yes:
                self._close_module_windows()
                self.close()
                if self.on_exit:
                    self.on_exit()
            return
        windows = {
            "pos": PosWindow,
            "product": ProductWindow,
            "category": CategoryWindow,
            "inventory": InventoryWindow,
            "tables": TablesWindow,
            "kot": KotWindow,
            "supplier": SupplierWindow,
            "purchase": PurchaseWindow,
            "invoice": InvoiceListWindow,
            "expense": ExpenseWindow,
            "reports": ReportsWindow,
            "dashboard": ReportsWindow,
            "users": UsersWindow,
            "settings": SettingsWindow,
            "audit": AuditLogWindow,
        }
        window_type = windows.get(action)
        if window_type is None:
            QMessageBox.information(
                self,
                "Module not ready",
                "This module is not implemented yet; it will be added in the next development step.",
            )
            return
        window = window_type()
        self.module_windows.append(window)
        window.show()

    def logout(self) -> None:
        answer = QMessageBox.question(
            self,
            "Logout",
            "Log out of DAN RESTAURANT POS?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if answer == QMessageBox.StandardButton.Yes:
            self._close_module_windows()
            self.close()
            if self.on_logout:
                self.on_logout()

    def _close_module_windows(self) -> None:
        for window in self.module_windows:
            window.close()
        self.module_windows.clear()
