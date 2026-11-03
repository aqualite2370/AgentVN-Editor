"""API request schemas."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.common import MemoryMode, StrictBaseModel
from app.models.assistant_creation import AssistantComponentDraft, AssistantElementRectPatch
from app.models.memory import MemoryUpdate
from app.models.scene import SceneBeat


class ProviderSelectionParameters(StrictBaseModel):
    temperature: float | None = Field(default=None, ge=0)
    top_p: float | None = Field(default=None, ge=0, le=1)
    max_tokens: int | None = Field(default=None, ge=1)
    structured_mode: str | None = Field(default=None, pattern="^(auto|tools|json_object)$")
    request_timeout_seconds: float | None = Field(default=None, ge=30, le=900)
    context_budget_tokens: int | None = Field(default=None, ge=4000, le=200000)
    thinking_mode: bool | None = None
    system_prompt: str | None = Field(default=None, max_length=8000)


class ProviderSelectionRequest(StrictBaseModel):
    connection_id: str
    model_id: str
    base_url: str
    api_key: str
    parameters: ProviderSelectionParameters | None = None


class TestProviderConnectionRequest(StrictBaseModel):
    base_url: str
    api_key: str


class TestProviderGenerationRequest(StrictBaseModel):
    provider_selection: ProviderSelectionRequest


class AssistantDocChunkRequest(StrictBaseModel):
    id: str
    source: str
    title: str
    tags: list[str] = Field(default_factory=list)
    text: str


class AssistantChatMessageRequest(StrictBaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class AssistantAuthorizedAssetRequest(StrictBaseModel):
    id: str = Field(..., min_length=1, max_length=160, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
    filename: str = Field(..., min_length=1, max_length=255)
    mime_type: str = Field(..., pattern=r"^image/(png|jpeg|webp|gif)$")

    @model_validator(mode="after")
    def validate_filename(self):
        if not self.filename.strip() or any(character in self.filename for character in ("/", "\\", ":", "\x00")):
            raise ValueError("Authorized image filename must be a basename, never a path.")
        return self


class AssistantAuthorizedComponentRequest(StrictBaseModel):
    """A personal component the user explicitly selected for this creation session."""

    id: str = Field(..., min_length=1, max_length=160)
    name: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=1000)
    html: str = Field(..., max_length=32000)
    css: str = Field(default="", max_length=32000)
    assets: list[AssistantAuthorizedAssetRequest] = Field(default_factory=list, max_length=16)


class AssistantChatRequest(StrictBaseModel):
    question: str = Field(..., min_length=1)
    context_chunks: list[AssistantDocChunkRequest] = Field(default_factory=list, max_length=12)
    messages: list[AssistantChatMessageRequest] = Field(default_factory=list, max_length=20)
    editor_context: str | None = None
    provider_selection: ProviderSelectionRequest | None = None


class AssistantAuthorizedElementTarget(StrictBaseModel):
    """Minimal context for a control the user explicitly selected for this request."""

    target_id: str = Field(..., pattern=r"^target-[1-8]$")
    screen_id: Literal[
        "title", "player", "game_menu", "save_load", "preferences",
        "history", "gallery", "about", "help",
    ]
    component_type: str = Field(..., min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=160)
    rect: AssistantElementRectPatch | None = None


class AssistantComponentDraftRequest(StrictBaseModel):
    """Only the current creation session and context explicitly approved by the user."""

    user_request: str = Field(..., min_length=1, max_length=4000)
    agent_tools: bool = False
    messages: list[AssistantChatMessageRequest] = Field(default_factory=list, max_length=8)
    current_draft: AssistantComponentDraft | None = None
    authorized_components: list[AssistantAuthorizedComponentRequest] = Field(default_factory=list, max_length=8)
    authorized_assets: list[AssistantAuthorizedAssetRequest] = Field(default_factory=list, max_length=16)
    authorized_targets: list[AssistantAuthorizedElementTarget] = Field(default_factory=list, max_length=8)
    provider_selection: ProviderSelectionRequest | None = None

    @model_validator(mode="after")
    def validate_authorized_targets(self):
        asset_ids = [asset.id for asset in self.authorized_assets]
        asset_ids.extend(asset.id for component in self.authorized_components for asset in component.assets)
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("Authorized asset aliases must be unique across all sources.")
        if not self.authorized_targets:
            return self
        ids = [target.target_id for target in self.authorized_targets]
        pages = {target.screen_id for target in self.authorized_targets}
        if len(ids) != len(set(ids)):
            raise ValueError("Authorized element target aliases must be unique.")
        if len(pages) != 1:
            raise ValueError("Element edit authorization must be limited to one page per request.")
        for target in self.authorized_targets:
            if target.rect is not None and any(
                getattr(target.rect, key) is None for key in ("x", "y", "width", "height")
            ):
                raise ValueError("Authorized target geometry must include all coordinates.")
            if target.rect is not None and (
                target.rect.x + target.rect.width > 100
                or target.rect.y + target.rect.height > 100
            ):
                raise ValueError("Authorized target geometry must remain within the layout canvas.")
        return self


class GenerateSceneRequest(StrictBaseModel):
    current_scene: str
    target_scene_stub: str | None = None
    previous_summary: str | None = None
    author_goal: str
    generation_outline: str | None = None
    editor_context: str | None = None
    memory_mode: MemoryMode = MemoryMode.HYBRID
    chapter: int = Field(..., ge=0)
    character_id: str | None = None
    provider_selection: ProviderSelectionRequest | None = None


class ExtractMemoryRequest(StrictBaseModel):
    scene: SceneBeat
    memory_mode: MemoryMode = MemoryMode.HYBRID
    chapter: int = Field(..., ge=0)
    provider_selection: ProviderSelectionRequest | None = None


class ApplyMemoryUpdateRequest(StrictBaseModel):
    update: MemoryUpdate
    chapter: int = Field(..., ge=0)


class SetMemoryModeRequest(StrictBaseModel):
    memory_mode: MemoryMode
