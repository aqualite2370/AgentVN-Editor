"""API request schemas."""

from pydantic import Field

from app.models.common import MemoryMode, StrictBaseModel
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


class AssistantChatRequest(StrictBaseModel):
    question: str = Field(..., min_length=1)
    context_chunks: list[AssistantDocChunkRequest] = Field(default_factory=list, max_length=12)
    messages: list[AssistantChatMessageRequest] = Field(default_factory=list, max_length=20)
    editor_context: str | None = None
    provider_selection: ProviderSelectionRequest | None = None


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
