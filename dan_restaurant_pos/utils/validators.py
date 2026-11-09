from decimal import Decimal, InvalidOperation


def validate_pin(pin: str) -> str:
    if not pin or len(pin) < 4:
        raise ValueError("PIN must be at least 4 digits")
    if not pin.isdigit():
        raise ValueError("PIN must contain digits only")
    return pin


def validate_decimal(value: str) -> Decimal:
    try:
        amount = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError("Invalid numeric value") from None
    if amount < 0:
        raise ValueError("Value cannot be negative")
    return amount
