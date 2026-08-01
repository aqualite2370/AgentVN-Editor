"""SQLite connection management."""

import sqlite3
from pathlib import Path

from app.core.config import Settings, get_settings
from app.db.init_db import init_db
from app.db.sqlite_vec import try_load_sqlite_vec


def get_connection(settings: Settings | None = None) -> sqlite3.Connection:
    """Create a SQLite connection with row access and initialized schema."""

    settings = settings or get_settings()
    db_path = Path(settings.database_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try_load_sqlite_vec(conn)
    init_db(conn)
    return conn
