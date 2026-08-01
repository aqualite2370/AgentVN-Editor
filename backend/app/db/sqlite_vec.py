"""sqlite-vec extension loading helpers."""

import sqlite3


def try_load_sqlite_vec(conn: sqlite3.Connection) -> bool:
    """Load sqlite-vec when available.

    Development and PyInstaller builds may provide the extension differently.
    The app still supports local fallback ranking when loading fails.
    """

    try:
        import sqlite_vec  # type: ignore

        sqlite_vec.load(conn)
        return True
    except Exception:
        # error-log-ignore: sqlite-vec 是可选加速能力，未安装或当前 SQLite 不支持时使用普通检索。
        return False
