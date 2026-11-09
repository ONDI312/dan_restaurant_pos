import pytest

from dan_restaurant_pos.services.access_control import (
    require_permission,
    set_current_user,
)
from dan_restaurant_pos.services.catalog_service import create_category


def test_permissions_are_enforced_by_services() -> None:
    set_current_user({"id": 3, "role_name": "Cashier"})
    with pytest.raises(PermissionError):
        create_category("Not allowed")
    require_permission("orders.create")

    set_current_user({"id": 4, "role_name": "Kitchen"})
    require_permission("kitchen.use")
    with pytest.raises(PermissionError):
        require_permission("reports.view")

    set_current_user(None)
    with pytest.raises(PermissionError):
        require_permission("pos.use")
    set_current_user({"id": 1, "role_name": "Admin"})
