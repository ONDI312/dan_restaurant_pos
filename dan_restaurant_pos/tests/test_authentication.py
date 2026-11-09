from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.services.auth_service import authenticate_user


def test_default_admin_can_login() -> None:
    initialize_application()
    user = authenticate_user("admin", "1234")
    assert user is not None
    assert user["username"] == "admin"
