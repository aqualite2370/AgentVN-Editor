"""Shared model primitives."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StrictBaseModel(BaseModel):
    """Base model configured for predictable JSON schemas."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)


JsonValue = str | int | float | bool | None | list[Any] | dict[str, Any]


class MemoryMode(str, Enum):
    """Available long-term memory strategies."""

    NONE = "none"
    CHRONICLE_GRAPH_ONLY = "chronicle_graph_only"
    EMOTION_TRACE_ONLY = "emotion_trace_only"
    HYBRID = "hybrid"


class ScoredText(StrictBaseModel):
    """Text item with retrieval scoring metadata."""

    text: str = Field(..., description="Retrieved text.")
    score: float = Field(..., ge=0.0, description="Final ranking score.")
