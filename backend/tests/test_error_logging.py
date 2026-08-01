from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from app.core import error_logging


def test_backend_error_log_uses_configured_directory_and_redacts_secrets(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("AGENTVN_ERROR_LOG_DIR", str(tmp_path))
    path = error_logging.configure_error_logging()
    logger = logging.getLogger("agentvn.test.error-log")
    logger.warning("provider failed with sk-secret123456 and Bearer private-token")
    logger.warning("provider failed with sk-secret123456 and Bearer private-token")
    for handler in logging.getLogger().handlers:
        handler.flush()

    assert path == tmp_path / "backend.log"
    text = path.read_text(encoding="utf-8")
    assert "provider failed" in text
    assert text.count("provider failed") == 1
    assert "sk-secret123456" not in text
    assert "Bearer private-token" not in text
    handler = next(
        item
        for item in logging.getLogger().handlers
        if isinstance(item, RotatingFileHandler) and item.baseFilename == str(path)
    )
    assert handler.maxBytes == 10 * 1024 * 1024
    assert handler.backupCount == 10


def test_sanitize_log_text_masks_common_credentials() -> None:
    sanitized = error_logging.sanitize_log_text(
        'api failed sk-abcdef123456 Authorization: Bearer example-token "api_key":"private-value" '
        "https://example.test/import?chapter=正文内容&attempt=2"
    )
    assert "sk-abcdef123456" not in sanitized
    assert "example-token" not in sanitized
    assert "private-value" not in sanitized
    assert "正文内容" not in sanitized
    assert "attempt=2" not in sanitized
    assert "chapter=***" in sanitized


def test_configure_error_logging_does_not_raise_when_directory_is_unwritable(tmp_path, monkeypatch) -> None:
    expected = tmp_path / "unwritable" / "backend.log"
    monkeypatch.setenv("AGENTVN_ERROR_LOG_DIR", str(expected.parent))
    monkeypatch.setattr(error_logging, "_configured_path", None)

    def fail_to_open(*_args, **_kwargs):
        raise OSError("read only")

    monkeypatch.setattr(error_logging, "RotatingFileHandler", fail_to_open)

    assert error_logging.configure_error_logging() == expected
