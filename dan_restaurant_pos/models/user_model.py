from dataclasses import dataclass


@dataclass
class User:
    id: int | None = None
    username: str = ""
    full_name: str = ""
    role_name: str = "Cashier"
    is_active: bool = True
