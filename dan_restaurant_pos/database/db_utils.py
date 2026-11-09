from __future__ import annotations

import atexit
import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

_pool = None
_pool_lock = threading.Lock()


def get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Configure Neon credentials in the project .env.local file."
        )
    return url


def _get_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                from psycopg.rows import dict_row
                from psycopg_pool import ConnectionPool

                _pool = ConnectionPool(
                    conninfo=get_database_url(),
                    min_size=int(os.getenv("DB_POOL_MIN_SIZE", "1")),
                    max_size=int(os.getenv("DB_POOL_MAX_SIZE", "5")),
                    kwargs={"sslmode": "require", "row_factory": dict_row},
                    open=False,
                )
                _pool.open(wait=True)
    return _pool


@contextmanager
def connection() -> Iterator[Any]:
    url = get_database_url()
    if url.startswith("sqlite:///"):
        db_path = url.removeprefix("sqlite:///")
        path = Path(db_path)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        return

    with _get_pool().connection() as conn:
        yield conn


def _adapt_query(query: str) -> str:
    if get_database_url().startswith("sqlite:///"):
        return query
    return re.sub(r"\?", "%s", query)


def run_query(conn: Any, query: str, params: Iterable[Any] | None = None):
    return conn.execute(_adapt_query(query), tuple(params or ()))


def execute(query: str, params: Iterable[Any] | None = None) -> None:
    with connection() as conn:
        run_query(conn, query, params)


def fetch_one(query: str, params: Iterable[Any] | None = None):
    with connection() as conn:
        return run_query(conn, query, params).fetchone()


def fetch_all(query: str, params: Iterable[Any] | None = None):
    with connection() as conn:
        return run_query(conn, query, params).fetchall()


def execute_script(script: str) -> None:
    with connection() as conn:
        if isinstance(conn, sqlite3.Connection):
            conn.executescript(script)
            return
        for statement in script.split(";"):
            if statement.strip():
                run_query(conn, statement)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


atexit.register(close_pool)
