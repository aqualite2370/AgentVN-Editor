"""API response schemas."""

from pydantic import Field

from app.models.common import MemoryMode, StrictBaseModel


class HealthResponse(StrictBaseModel):
    status: str = "ok"
    service: str = "agentvn-backend"


class ApplyMemoryUpdateResponse(StrictBaseModel):
    invalidated_relations: int
    new_relations: int
    emotion_snapshots: int


class MemoryModeResponse(StrictBaseModel):
    memory_mode: MemoryMode


class DiscoveredProviderModel(StrictBaseModel):
    model_id: str
    display_name: str


class TestProviderConnectionResponse(StrictBaseModel):
    ok: bool
    latency_ms: int
    base_url: str
    supports_model_discovery: bool
    models: list[DiscoveredProviderModel]
    error_message: str | None = None


class TestProviderGenerationResponse(StrictBaseModel):
    ok: bool
    latency_ms: int
    model_id: str
    structured_mode: str
    message: str
    error_message: str | None = None
    tool_calling_ok: bool | None = None
    scene_schema_ok: bool | None = None
    json_mode_ok: bool | None = None
    memory_schema_ok: bool | None = None
    complex_schema_ok: bool | None = None
    tool_unsupported: bool | None = None
    fallback_reason: str | None = None
    recommended_structured_mode: str | None = None
    diagnostics: list[str] = Field(default_factory=list)


class AssistantCitationResponse(StrictBaseModel):
    id: str
    source: str
    title: str


class AssistantChatResponse(StrictBaseModel):
    answer: str
    citations: list[AssistantCitationResponse]
