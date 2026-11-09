import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.views.login_view import LoginWindow

import psycopg
from PyQt6.QtWidgets import QApplication, QMessageBox


def main() -> None:
    app = QApplication(sys.argv)
    app.setApplicationName("DAN RESTAURANT POS")
    theme_path = Path(__file__).resolve().parent / "assets" / "styles" / "theme.qss"
    app.setStyleSheet(theme_path.read_text(encoding="utf-8"))
    try:
        setup_pin = initialize_application()
    except (psycopg.Error, OSError, RuntimeError, ValueError) as error:
        QMessageBox.critical(
            None,
            "Database connection error",
            f"Could not initialize the Neon database.\n{error}",
        )
        return
    window = LoginWindow(setup_pin=setup_pin)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
