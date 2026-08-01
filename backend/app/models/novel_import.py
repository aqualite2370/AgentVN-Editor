"""Novel import and adaptation contracts."""

from typing import Any, Literal

from pydantic import Field, model_validator

from app.models.commands import GameCommand
from app.models.common import MemoryMode, StrictBaseModel
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest


class ImportOptions(StrictBaseModel):
    language: str = "zh-CN"
    target_style: str = "visual_novel"
    preserve_original_dialogue: bool = True
    narration_density: str = "medium"
    split_scene_aggressiveness: str = "medium"
    generate_background_hints: bool = True
    generate_sprite_hints: bool = True
    generate_bgm_hints: bool = False
    generate_animation_hints: bool = True
    memory_mode: MemoryMode = MemoryMode.NONE
    max_chunk_chars: int = 6000
    max_scene_chars: int = 2200
    allow_branch_suggestions: bool = False


class CharacterCandidate(StrictBaseModel):
    character_id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    first_seen_offset: int = 0
    description: str = ""
    speaking_style_hint: str | None = None
    confidence: float = 0.5


class ChapterCandidate(StrictBaseModel):
    chapter_id: str
    book_id: str | None = None
    title: str
    normalized_title: str | None = None
    index: int
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., ge=0)
    char_count: int | None = Field(default=None, ge=0)
    word_count: int | None = Field(default=None, ge=0)
    estimated_tokens: int | None = Field(default=None, ge=0)
    source_type: Literal[
        "epub_toc",
        "html_heading",
        "markdown_heading",
        "docx_heading",
        "txt_rule",
        "manual",
        "fallback_auto",
    ] | None = None
    status: Literal["confirmed", "needs_review", "manual_review"] | None = None
    anomaly_flags: list[Literal[
        "too_short",
        "too_long",
        "low_confidence",
        "duplicate_title",
        "non_incremental_index",
        "toc_duplicate",
        "suspicious_ad",
        "fallback_generated",
    ]] = Field(default_factory=list)
    summary: str
    confidence: float = 0.5
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceSpan(StrictBaseModel):
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., ge=0)

    @model_validator(mode="after")
    def validate_order(self) -> "SourceSpan":
        if self.end_offset < self.start_offset:
            raise ValueError("source_span.end_offset must be greater than or equal to start_offset")
        return self


class SceneCandidate(StrictBaseModel):
    scene_candidate_id: str
    chapter_id: str
    title: str
    display_name: str | None = None
    index: int
    start_offset: int
    end_offset: int
    location_hint: str | None = None
    time_hint: str | None = None
    characters: list[str] = Field(default_factory=list)
    source_span: SourceSpan | None = None
    source_excerpt: str
    summary: str
    commands: list[GameCommand] = Field(default_factory=list)
    confidence: float = 0.5

    @model_validator(mode="after")
    def fill_source_span(self) -> "SceneCandidate":
        if self.source_span is None:
            self.source_span = SourceSpan(start_offset=self.start_offset, end_offset=self.end_offset)
        return self


class SourceMapping(StrictBaseModel):
    document_id: str
    start_offset: int
    end_offset: int
    source_excerpt: str
    adapted_command_ids: list[str] = Field(default_factory=list)


class AdaptedScene(StrictBaseModel):
    adapted_scene_id: str
    source_scene_candidate_id: str
    scene_beat: SceneBeat
    source_mapping: SourceMapping
    warnings: list[str] = Field(default_factory=list)
    needs_review: bool = False


class AssetSuggestion(StrictBaseModel):
    suggestion_id: str
    asset_type: str
    description: str
    suggested_asset_id: str
    prompt_hint: str
    source_scene_id: str
    source_scene_display_name: str | None = None


class BranchSuggestion(StrictBaseModel):
    suggestion_id: str
    source_scene_id: str
    source_scene_display_name: str | None = None
    choice_display_name: str | None = None
    choice_text: str
    branch_summary: str
    confidence: float = 0.0
    enabled_by_default: bool = False


class ConflictPoint(StrictBaseModel):
    conflict_id: str
    source_scene_id: str
    source_scene_display_name: str | None = None
    conflict_type: str = "branch_opportunity"
    description: str
    mainline_resolution: str
    suggests_branch: bool = False
    confidence: float = 0.0
    branch_suggestion_ids: list[str] = Field(default_factory=list)


class AdaptSceneRequest(StrictBaseModel):
    scene_candidate: SceneCandidate
    known_characters: list[CharacterCandidate] = Field(default_factory=list)
    previous_scene_summary: str | None = None
    import_options: ImportOptions
    memory_mode: MemoryMode = MemoryMode.NONE
    provider_selection: ProviderSelectionRequest | None = None


class AdaptSceneResponse(StrictBaseModel):
    adapted_scene: AdaptedScene
    character_updates: list[CharacterCandidate] = Field(default_factory=list)
    asset_suggestions: list[AssetSuggestion] = Field(default_factory=list)
    branch_suggestions: list[BranchSuggestion] = Field(default_factory=list)
    conflict_points: list[ConflictPoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiConflictAnalysisResponse(StrictBaseModel):
    conflict_points: list[ConflictPoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiBranchSuggestionResponse(StrictBaseModel):
    branch_suggestions: list[BranchSuggestion] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AnalyzeChunkRequest(StrictBaseModel):
    text: str
    chunk_id: str | None = None


class AnalyzeChunkResponse(StrictBaseModel):
    summary: str
    characters: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    times: list[str] = Field(default_factory=list)
    dialogue_count: int = 0


class SplitSceneRequest(StrictBaseModel):
    chapter_id: str
    text: str
    max_scene_chars: int = 2200


class SplitSceneResponse(StrictBaseModel):
    scenes: list[SceneCandidate]


class BatchAdaptRequest(StrictBaseModel):
    scenes: list[SceneCandidate]
    known_characters: list[CharacterCandidate] = Field(default_factory=list)
    import_options: ImportOptions
    memory_mode: MemoryMode = MemoryMode.NONE


class BatchAdaptResponse(StrictBaseModel):
    adapted_scenes: list[AdaptedScene]
    warnings: list[str] = Field(default_factory=list)


class ExtractCharactersRequest(StrictBaseModel):
    text: str


class ExtractCharactersResponse(StrictBaseModel):
    characters: list[CharacterCandidate]


class NovelAiChunkRequest(StrictBaseModel):
    document_id: str
    chunk_id: str
    index: int = Field(..., ge=0)
    text: str
    start_offset: int = Field(..., ge=0)
    end_offset: int = Field(..., ge=0)
    previous_summary: str | None = None
    partial_summary: "NovelAiChunkSummary | None" = None
    partial_entities: "NovelAiChunkEntityIndex | None" = None
    partial_timeline: "NovelAiChunkTimelineNotes | None" = None
    provider_selection: ProviderSelectionRequest | None = None


class NovelAiChunkAnalysis(StrictBaseModel):
    chunk_id: str
    index: int
    summary: str
    chapter_candidates: list[ChapterCandidate] = Field(default_factory=list)
    characters: list[CharacterCandidate] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    timeline: list[str] = Field(default_factory=list)
    foreshadowing: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    confidence: float = 0.5


class NovelAiChunkSummary(StrictBaseModel):
    chunk_id: str
    index: int
    summary: str
    confidence: float = 0.5
    warnings: list[str] = Field(default_factory=list)


class NovelAiChunkEntityIndex(StrictBaseModel):
    chapter_candidates: list[ChapterCandidate] = Field(default_factory=list)
    characters: list[CharacterCandidate] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiChunkTimelineNotes(StrictBaseModel):
    timeline: list[str] = Field(default_factory=list)
    foreshadowing: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiOutlineRequest(StrictBaseModel):
    document_id: str
    title: str
    total_chars: int = Field(..., ge=0)
    analyses: list[NovelAiChunkAnalysis]
    allow_branch_suggestions: bool = False
    partial_mainline: "NovelAiOutlineMainline | None" = None
    partial_structure: "NovelAiOutlineStructure | None" = None
    partial_index: "NovelAiOutlineIndex | None" = None
    provider_selection: ProviderSelectionRequest | None = None


class NovelAiOutlineResponse(StrictBaseModel):
    document_id: str
    title: str
    summary: str
    main_plot: str
    chapters: list[ChapterCandidate]
    characters: list[CharacterCandidate]
    timeline: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    branch_or_foreshadowing: list[str] = Field(default_factory=list)
    conflict_points: list[ConflictPoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    needs_review: bool = False
    coverage_confidence: float = 0.5


class NovelAiOutlineMainline(StrictBaseModel):
    document_id: str
    title: str
    summary: str
    main_plot: str
    needs_review: bool = False
    coverage_confidence: float = 0.5
    warnings: list[str] = Field(default_factory=list)


class NovelAiOutlineStructure(StrictBaseModel):
    chapters: list[ChapterCandidate]
    timeline: list[str] = Field(default_factory=list)
    branch_or_foreshadowing: list[str] = Field(default_factory=list)
    conflict_points: list[ConflictPoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiOutlineIndex(StrictBaseModel):
    characters: list[CharacterCandidate] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NovelAiPlanChapterRequest(StrictBaseModel):
    document_id: str
    chapter: ChapterCandidate
    outline_summary: str
    known_characters: list[CharacterCandidate] = Field(default_factory=list)
    text: str
    suggested_scene_count: int | None = Field(default=None, ge=1)
    min_scene_count: int | None = Field(default=None, ge=1)
    min_branch_suggestion_count: int = Field(default=1, ge=0)
    allow_branch_suggestions: bool = False
    provider_selection: ProviderSelectionRequest | None = None


class NovelAiScenePlanResponse(StrictBaseModel):
    chapter_id: str
    scenes: list[SceneCandidate]
    conflict_points: list[ConflictPoint] = Field(default_factory=list)
    branch_suggestions: list[BranchSuggestion] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    needs_review: bool = False


class NovelAiChapterScenePlan(StrictBaseModel):
    chapter_id: str
    scenes: list[SceneCandidate]
    warnings: list[str] = Field(default_factory=list)
    needs_review: bool = False


class NovelAiAdaptSceneRequest(AdaptSceneRequest):
    outline_summary: str | None = None
    previous_scene_summary: str | None = None
