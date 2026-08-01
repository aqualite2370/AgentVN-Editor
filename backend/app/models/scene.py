"""Scene-level visual novel contracts."""

from pydantic import Field

from app.models.commands import GameCommand
from app.models.common import StrictBaseModel


class SceneBeat(StrictBaseModel):
    """A structured visual novel scene segment."""

    scene_id: str
    scene_display_name: str | None = None
    title: str
    summary: str
    commands: list[GameCommand] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    chapter: int = Field(..., ge=0)
