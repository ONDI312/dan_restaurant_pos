from decimal import Decimal

import pytest

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.database.db_utils import fetch_one
from dan_restaurant_pos.services.catalog_service import create_category, create_product
from dan_restaurant_pos.services.purchase_service import create_purchase, finalize_purchase
from dan_restaurant_pos.services.supplier_service import save_supplier


def test_finalizing_purchase_adds_stock_once() -> None:
    initialize_application()
    category_id = create_category("Purchase test")
    product_id = create_product(
        name="Purchase test product",
        category_id=category_id,
        price="6.00",
        initial_stock=2,
    )
    supplier_id = save_supplier(name="Purchase test supplier")
    purchase_id = create_purchase(
        supplier_id,
        "TEST-INV-1",
        [
            {
                "product_id": product_id,
                "quantity": 5,
                "unit_cost": Decimal("1.25"),
            }
        ],
    )
    assert fetch_one(
        "SELECT stock_quantity FROM products WHERE id = ?", (product_id,)
    )["stock_quantity"] == 2

    finalize_purchase(purchase_id)
    assert fetch_one(
        "SELECT stock_quantity FROM products WHERE id = ?", (product_id,)
    )["stock_quantity"] == 7
    with pytest.raises(ValueError, match="Only draft purchases"):
        finalize_purchase(purchase_id)
    assert fetch_one(
        "SELECT COUNT(*) AS count FROM inventory_movements "
        "WHERE product_id = ? AND movement_type = 'purchase'",
        (product_id,),
    )["count"] == 1
