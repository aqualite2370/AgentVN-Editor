"""Identifier helpers."""

from uuid import uuid4


def new_id(prefix: str) -> str:
    """Create a compact stable-enough local identifier."""

    return f"{prefix}_{uuid4().hex[:12]}"
