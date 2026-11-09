import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARENT = ROOT.parent
if str(PARENT) not in sys.path:
    sys.path.insert(0, str(PARENT))
import pytest

from dan_restaurant_pos.services.access_control import set_current_user


@pytest.fixture(autouse=True)
def isolate_database(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("ADMIN_SETUP_PIN", "1234")
    set_current_user({"id": 1, "role_name": "Admin"})
    yield
    set_current_user(None)
