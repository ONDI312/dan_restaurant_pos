import pytest

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.database.db_utils import fetch_one
from dan_restaurant_pos.services.access_control import set_current_user
from dan_restaurant_pos.services.auth_service import authenticate_user
from dan_restaurant_pos.services.settings_service import get_settings, save_settings
from dan_restaurant_pos.services.user_service import (
    create_user,
    list_roles,
    reset_user_pin,
    set_user_active,
)


def test_user_pin_hashing_and_activation() -> None:
    initialize_application()
    roles = {role["name"]: role["id"] for role in list_roles()}
    user_id = create_user("test-cashier", "Test Cashier", roles["Cashier"], "735192")
    stored = fetch_one("SELECT pin_hash FROM users WHERE id = ?", (user_id,))["pin_hash"]
    assert stored != "735192"
    assert authenticate_user("test-cashier", "735192") is not None
    assert authenticate_user("test-cashier", "wrong") is None

    set_current_user({"id": 1, "role_name": "Admin"})
    reset_user_pin(user_id, "135792")
    assert authenticate_user("test-cashier", "135792") is not None
    set_current_user({"id": 1, "role_name": "Admin"})
    set_user_active(user_id, False)
    assert authenticate_user("test-cashier", "135792") is None


def test_settings_are_validated_and_persisted() -> None:
    initialize_application()
    save_settings(
        {
            "restaurant_name": "Dan Test Kitchen",
            "currency": "USD",
            "discount_percentage": "5",
            "vat_percentage": "16",
            "service_percentage": "2",
        }
    )
    settings = get_settings()
    assert settings["restaurant_name"] == "Dan Test Kitchen"
    assert settings["vat_percentage"] == "16"
    with pytest.raises(ValueError, match="cannot exceed 100"):
        save_settings({"vat_percentage": "101"})
