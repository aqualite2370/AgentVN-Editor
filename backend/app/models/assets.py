"""Asset reference contracts."""

from enum import Enum
from typing import Any

from pydantic import Field

from app.models.common import StrictBaseModel


class AssetType(str, Enum):
    BACKGROUND = "background"
    SPRITE = "sprite"
    PORTRAIT = "portrait"
    BGM = "bgm"
    SFX = "sfx"
    VOICE = "voice"
    VIDEO = "video"
    ANIMATION = "animation"
    FONT = "font"
    UI = "ui"


class AssetRef(StrictBaseModel):
    """Runtime-safe asset identifier."""

    asset_id: str
    asset_type: AssetType
    metadata: dict[str, Any] = Field(default_factory=dict)
