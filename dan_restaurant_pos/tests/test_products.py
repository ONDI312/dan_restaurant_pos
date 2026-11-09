from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.database.db_utils import fetch_one


def test_products_table_exists() -> None:
    initialize_application()
    row = fetch_one("SELECT COUNT(*) AS count FROM products")
    assert row is not None
