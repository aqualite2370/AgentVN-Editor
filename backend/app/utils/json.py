"""JSON helper utilities."""

import json
from typing import Any


def dumps_json(value: Any) -> str:
    """Serialize JSON with deterministic UTF-8 friendly settings."""

    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def loads_json(value: str | None, default: Any = None) -> Any:
    """Deserialize JSON with a fallback default."""

    if not value:
        return default
    return json.loads(value)
