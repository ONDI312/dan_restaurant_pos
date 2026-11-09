from decimal import Decimal

from dan_restaurant_pos.services.order_service import calculate_order_totals


def test_order_totals() -> None:
    totals = calculate_order_totals(Decimal("100.00"), Decimal("10"), Decimal("15"), Decimal("5"))
    assert totals["discount_amount"] == Decimal("10.00")
    assert totals["vat_amount"] == Decimal("13.50")
    assert totals["service_amount"] == Decimal("5.18")
    assert totals["total"] == Decimal("108.68")
