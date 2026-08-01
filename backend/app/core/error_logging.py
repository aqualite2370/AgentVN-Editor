"""Install-relative error logging shared by the backend and its route handlers."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import threading
import time
import traceback


_configured_path: Path | None = None
_configured_handler: RotatingFileHandler | None = None
_secret_patterns: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"sk-[A-Za-z0-9_\-]{6,}"), "sk-***"),
    (re.compile(r"(Bearer\s+)[^\s\"']+", re.IGNORECASE), r"\1***"),
    (re.compile(r'("api_key"\s*:\s*")[^"]+(")', re.IGNORECASE), r"\1***\2"),
    (re.compile(r"([?&](?:api[_-]?key|token)=)[^&\s]+", re.IGNORECASE), r"\1***"),
    (re.compile(r"([?&][^=\s&#]+)=([^&\s#\"',}]*)"), r"\1=***"),
)
class _SanitizingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return sanitize_log_text(super().format(record))


class _DeduplicatingFilter(logging.Filter):
    def __init__(self) -> None:
        super().__init__()
        self._recent: dict[str, float] = {}
        self._lock = threading.Lock()

    def filter(self, record: logging.LogRecord) -> bool:
        fingerprint = f"{record.name}\n{record.levelno}\n{sanitize_log_text(record.getMessage())}"
        now = time.monotonic()
        with self._lock:
            previous = self._recent.get(fingerprint, 0.0)
            self._recent[fingerprint] = now
            expired = [key for key, timestamp in self._recent.items() if now - timestamp > 30.0]
            for key in expired:
                self._recent.pop(key, None)
        return now - previous > 1.0


def sanitize_log_text(value: object) -> str:
    """Remove common credentials before an error reaches disk."""

    text = str(value)
    for pattern, replacement in _secret_patterns:
        text = pattern.sub(replacement, text)
    return text


def error_log_dir() -> Path:
    configured = os.environ.get("AGENTVN_ERROR_LOG_DIR", "").strip()
    if configured:
        return Path(configured)
    configured_file = os.environ.get("AGENTVN_BACKEND_LOG", "").strip()
    if configured_file:
        return Path(configured_file).parent
    return Path.cwd().parent / "error_log" if Path.cwd().name == "backend" else Path.cwd() / "error_log"


def configure_error_logging() -> Path:
    """Attach one UTF-8 rotating file handler to the process root logger."""

    global _configured_handler, _configured_path
    path = error_log_dir() / "backend.log"
    if _configured_path == path:
        return path

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            path,
            maxBytes=10 * 1024 * 1024,
            backupCount=10,
            encoding="utf-8",
        )
    except OSError:
        # error-log-ignore: 日志目录不可写时不能让记录故障取代原业务错误，也不能递归记录本次失败。
        return path
    handler.setLevel(logging.WARNING)
    handler.addFilter(_DeduplicatingFilter())
    handler.setFormatter(
        _SanitizingFormatter(
            "%(asctime)s [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    root = logging.getLogger()
    if _configured_handler is not None:
        root.removeHandler(_configured_handler)
        _configured_handler.close()
    root.addHandler(handler)
    if root.level > logging.WARNING:
        root.setLevel(logging.WARNING)
    _configured_path = path
    _configured_handler = handler
    return path


def log_exception(logger: logging.Logger, message: str, exc: BaseException) -> None:
    """Write a sanitized exception and traceback without leaking provider tokens."""

    trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error("%s\n%s", sanitize_log_text(message), sanitize_log_text(trace))
