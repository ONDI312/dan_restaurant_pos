from datetime import date
from decimal import Decimal

from dan_restaurant_pos.database.db_setup import initialize_application
from dan_restaurant_pos.services.expense_service import (
    create_expense_category,
    list_expenses,
    save_expense,
)
from dan_restaurant_pos.services.report_service import get_sales_summary


def test_expenses_are_saved_and_included_in_summary() -> None:
    initialize_application()
    category_id = create_expense_category("Utilities")
    save_expense(
        category_id=category_id,
        description="Electricity",
        amount="12.50",
        method="Cash",
        currency="KES",
    )
    rows = list_expenses()
    assert rows[0]["description"] == "Electricity"
    assert rows[0]["currency"] == "KES"
    summary = get_sales_summary(date.today(), date.today())
    assert Decimal(str(summary["expense_total"])) == Decimal("12.50")
    assert summary["expenses_by_currency"][0]["currency"] == "KES"
