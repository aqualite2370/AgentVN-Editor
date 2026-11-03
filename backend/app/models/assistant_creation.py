"""Typed outputs for the assistant's isolated creative workspace."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.common import StrictBaseModel


class AssistantComponentDraft(StrictBaseModel):
    """A component proposal; it is never written to a project by the backend."""

    name: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)
    html: str = Field(..., max_length=32000)
    css: str = Field(default="", max_length=32000)
    screen_id: Literal[
        "title", "player", "game_menu", "save_load", "preferences",
        "history", "gallery", "about", "help",
    ] = "title"


class AssistantElementRectPatch(StrictBaseModel):
    """A partial, bounded geometry update for an explicitly selected layout element."""

    x: float | None = Field(default=None, ge=0, le=100)
    y: float | None = Field(default=None, ge=0, le=100)
    width: float | None = Field(default=None, gt=0, le=100)
    height: float | None = Field(default=None, gt=0, le=100)

    @model_validator(mode="after")
    def require_at_least_one_coordinate(self):
        if all(value is None for value in (self.x, self.y, self.width, self.height)):
            raise ValueError("A geometry patch must change at least one coordinate.")
        return self


class AssistantElementEditProposal(StrictBaseModel):
    """A local-review proposal; target ids are per-request aliases, not project ids."""

    target_id: str = Field(..., pattern=r"^target-[1-8]$")
    screen_id: Literal[
        "title", "player", "game_menu", "save_load", "preferences",
        "history", "gallery", "about", "help",
    ]
    label: str | None = Field(default=None, min_length=1, max_length=160)
    rect: AssistantElementRectPatch | None = None

    @model_validator(mode="after")
    def require_supported_change(self):
        if self.label is None and self.rect is None:
            raise ValueError("An element edit must include a label or geometry change.")
        return self


class AssistantComponentDraftBatch(StrictBaseModel):
    """Bounded component and existing-element proposals; never writes to a project."""

    components: list[AssistantComponentDraft] = Field(default_factory=list, max_length=16)
    edits: list[AssistantElementEditProposal] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def require_bounded_proposal(self):
        if not self.components and not self.edits:
            raise ValueError("At least one component or element edit proposal is required.")
        if len(self.components) + len(self.edits) > 16:
            raise ValueError("A proposal may contain no more than 16 total items.")
        target_ids = [edit.target_id for edit in self.edits]
        if len(target_ids) != len(set(target_ids)):
            raise ValueError("An element target may only be edited once per proposal.")
        if self.edits:
            pages = {edit.screen_id for edit in self.edits}
            pages.update(component.screen_id for component in self.components)
            if len(pages) > 1:
                raise ValueError("A proposal may only target one layout page.")
        return self

    @model_validator(mode="before")
    @classmethod
    def accept_legacy_single_component(cls, value: object) -> object:
        # Existing provider adapters and saved test fixtures may still return
        # the original one-component object. Normalize it at the API boundary.
        if isinstance(value, dict) and set(value) == {"name", "description", "html", "css"}:
            return {"components": [value]}
        return value
