from __future__ import annotations

from decimal import Decimal

from dan_restaurant_pos.database.db_utils import connection, fetch_all, run_query
from dan_restaurant_pos.services.access_control import get_current_user, require_permission
from dan_restaurant_pos.services.audit_service import record_audit
from dan_restaurant_pos.services.settings_service import get_settings
from dan_restaurant_pos.utils.helpers import money


def list_expense_categories():
    require_permission("expenses.read")
    return fetch_all("SELECT id, name FROM expense_categories ORDER BY name")


def create_expense_category(name: str) -> int:
    require_permission("expenses.manage")
    clean_name = name.strip()
    if not clean_name:
        raise ValueError("Expense category name is required.")
    with connection() as conn:
        row = run_query(
            conn,
            "INSERT INTO expense_categories (name) VALUES (?) RETURNING id",
            (clean_name,),
        ).fetchone()
        category_id = int(row["id"])
        record_audit(conn, "create", "expense_category", category_id, {"name": clean_name})
        return category_id


def list_expenses():
    require_permission("expenses.read")
    return fetch_all(
        "SELECT e.id, c.name AS category, e.description, e.amount, e.currency, e.method, "
        "e.created_at, u.username FROM expenses e "
        "LEFT JOIN expense_categories c ON c.id = e.category_id "
        "LEFT JOIN users u ON u.id = e.created_by ORDER BY e.created_at DESC LIMIT 1000"
    )


def save_expense(
    *,
    category_id: int,
    description: str,
    amount: str,
    method: str,
    currency: str | None = None,
    user_id: int | None = None,
    expense_id: int | None = None,
) -> int:
    require_permission("expenses.manage")
    current_user = get_current_user()
    currency = (currency or get_settings()["currency"]).strip().upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise ValueError("Currency must be a three-letter code.")
    if user_id is None and current_user is not None:
        user_id = int(current_user["id"])
    clean_description = description.strip()
    parsed_amount = money(Decimal(amount))
    if not clean_description:
        raise ValueError("Expense description is required.")
    if parsed_amount <= 0:
        raise ValueError("Expense amount must be greater than zero.")
    with connection() as conn:
        if expense_id is None:
            row = run_query(
                conn,
                "INSERT INTO expenses "
                "(category_id, description, amount, currency, method, created_by) "
                "VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
                (
                    category_id,
                    clean_description,
                    str(parsed_amount),
                    currency,
                    method.strip() or None,
                    user_id,
                ),
            ).fetchone()
            expense_id = int(row["id"])
            record_audit(
                conn,
                "create",
                "expense",
                expense_id,
                {"amount": parsed_amount, "currency": currency, "category_id": category_id},
            )
            return expense_id
        result = run_query(
            conn,
            "UPDATE expenses SET category_id = ?, description = ?, amount = ?, currency = ?, method = ? "
            "WHERE id = ?",
            (
                category_id,
                clean_description,
                str(parsed_amount),
                currency,
                method.strip() or None,
                expense_id,
            ),
        )
        if result.rowcount == 0:
            raise ValueError("Expense was not found.")
        record_audit(
            conn,
            "update",
            "expense",
            expense_id,
            {"amount": parsed_amount, "currency": currency, "category_id": category_id},
        )
        return expense_id
