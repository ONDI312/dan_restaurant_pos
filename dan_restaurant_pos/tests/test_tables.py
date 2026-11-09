from decimal import Decimal

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.database.db_utils import fetch_one
from dan_restaurant_pos.services.catalog_service import create_category, create_product
from dan_restaurant_pos.services.order_service import add_order, cancel_order
from dan_restaurant_pos.services.table_service import create_table


def test_dine_in_order_occupies_and_cancellation_releases_table() -> None:
    initialize_application()
    category_id = create_category("Table test")
    product_id = create_product(
        name="Table test product",
        category_id=category_id,
        price="4.00",
        initial_stock=2,
    )
    table_id = create_table("Table test 1", 4)
    order_id = add_order(
        "dine_in",
        [{"product_id": product_id, "quantity": 1, "unit_price": Decimal("4.00")}],
        created_by=None,
        table_id=table_id,
    )
    assert fetch_one(
        "SELECT status FROM restaurant_tables WHERE id = ?", (table_id,)
    )["status"] == "occupied"

    cancel_order(order_id)
    assert fetch_one(
        "SELECT status FROM restaurant_tables WHERE id = ?", (table_id,)
    )["status"] == "available"
