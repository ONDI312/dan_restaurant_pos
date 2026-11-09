from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

password_hasher = PasswordHasher()


def hash_pin(pin: str) -> str:
    return password_hasher.hash(pin)


def verify_pin(pin: str, hashed_pin: str) -> bool:
    try:
        return password_hasher.verify(hashed_pin, pin)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False
