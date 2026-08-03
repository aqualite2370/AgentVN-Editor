"""Concurrent novel processing job contracts."""

from typing import Literal

from pydantic import Field, model_validator

from app.models.commands import GameCommand
from app.models.common import JsonValue, StrictBaseModel
from app.models.novel_import import CharacterCandidate
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest


JobStatus = Literal["created", "running", "paused", "cancelled", "completed", "failed", "failed_partial", "retrying"]
ChunkStatus = Literal["pending", "waiting", "retrying", "running", "completed", "failed", "cancelled", "superseded"]
AgentTaskStatus = Literal["waiting", "running", "completed", "failed", "retrying", "cancelled"]
TokenSource = Literal["provider", "estimated", "mixed", "none"]
AgentRole = Literal["chunk_parser", "chapter_merger", "continuity_reviewer", "link_polisher"]
QualitySeverity = Literal["info", "warning", "danger", "blocked"]
ChapterResultStatus = Literal["pending", "completed", "failed", "cancelled"]


class TokenUsage(StrictBaseModel):
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    tokenSource: TokenSource = "none"


class SubagentModelInput(StrictBaseModel):
    bookId: str
    chapterTitle: str
    chapterIndex: int = Field(..., ge=0)
    chunkIndex: int = Field(..., ge=0)
    chunkText: str
    previousContextSummary: str = Field(default="", max_length=800)
    nextContextHint: str = Field(default="", max_length=800)
    userInstruction: str
    outputFormat: str
    promptVersion: str
    speakerCandidates: list[str] | None = None


class SceneFragment(StrictBaseModel):
    summary: str = ""
    tags: list[str] = Field(default_factory=list)
    commands: list[GameCommand] = Field(default_factory=list)
    continuityNotes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    errorMessage: str | None = None

    @model_validator(mode="after")
    def reject_route_commands(self) -> "SceneFragment":
        route_types = {"choice", "jump", "conditional_jump"}
        invalid = [command.type for command in self.commands if command.type in route_types]
        if invalid:
            raise ValueError(
                "Scene fragments cannot contain route commands; chapter links are created after chapter merge."
            )
        return self


class SubagentModelOutput(StrictBaseModel):
    status: Literal["completed", "failed"] = "completed"
    resultText: str = ""
    summary: str = ""
    fragment: SceneFragment | None = None
    scenes: list[SceneBeat] = Field(default_factory=list)
    continuityNotes: list[str] = Field(default_factory=list)
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    warnings: list[str] = Field(default_factory=list)
    errorMessage: str | None = None


class QualityIssue(StrictBaseModel):
    code: str
    severity: QualitySeverity = "warning"
    message: str
    evidence: str = ""
    action: str = ""
    sourceChunkId: str | None = None


class NovelProcessChunkInput(StrictBaseModel):
    chunkId: str | None = None
    chapterTitle: str = ""
    chapterIndex: int = Field(default=0, ge=0)
    chunkIndex: int = Field(..., ge=0)
    chunkText: str
    startOffset: int = Field(default=0, ge=0)
    endOffset: int = Field(default=0, ge=0)
    previousContextSummary: str | None = None
    nextContextHint: str | None = None


class ChunkRecord(StrictBaseModel):
    chunkId: str
    chapterTitle: str = ""
    chapterIndex: int = Field(default=0, ge=0)
    chunkIndex: int = Field(..., ge=0)
    chunkText: str
    parentChunkId: str | None = None
    splitDepth: int = Field(default=0, ge=0, le=2)
    startOffset: int = Field(default=0, ge=0)
    endOffset: int = Field(default=0, ge=0)
    status: ChunkStatus = "pending"
    retryCount: int = Field(default=0, ge=0)
    previousContextSummary: str = ""
    nextContextHint: str = ""
    contextChars: int = Field(default=0, ge=0)
    nextAttemptAt: str | None = None
    summary: str = ""
    resultId: str | None = None
    errorMessage: str | None = None
    updatedAt: str


class AgentTask(StrictBaseModel):
    taskId: str
    jobId: str
    chunkId: str
    chapterTitle: str = ""
    chapterIndex: int = Field(default=0, ge=0)
    chunkIndex: int = Field(..., ge=0)
    agentIndex: int = Field(default=0, ge=0)
    agentRole: AgentRole = "chunk_parser"
    attemptId: str = ""
    runAttempt: int = Field(default=1, ge=1)
    status: AgentTaskStatus = "waiting"
    phase: str = "queued"
    assignmentReason: str = ""
    currentStepLabel: str = ""
    lastHeartbeatAt: str | None = None
    partialChars: int = Field(default=0, ge=0)
    retryCount: int = Field(default=0, ge=0)
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    tokenSource: TokenSource = "none"
    leaseExpiresAt: str | None = None
    cancelRequestedAt: str | None = None
    partialResult: str = ""
    resultPreview: str = ""
    rawOutput: str = ""
    warnings: list[str] = Field(default_factory=list)
    errorMessage: str | None = None
    failureCategory: str | None = None
    retryBackoffMs: int = Field(default=0, ge=0)
    startedAt: str | None = None
    completedAt: str | None = None
    inputKeys: list[str] = Field(default_factory=list)
    inputChunkChars: int = Field(default=0, ge=0)
    contextChars: int = Field(default=0, ge=0)
    schemaRepairCount: int = Field(default=0, ge=0)


class ChunkResult(StrictBaseModel):
    resultId: str
    chunkId: str
    chapterTitle: str = ""
    chapterIndex: int = Field(default=0, ge=0)
    chunkIndex: int = Field(..., ge=0)
    status: Literal["completed", "failed", "cancelled"] = "completed"
    resultText: str = ""
    summary: str = ""
    fragment: SceneFragment | None = None
    scenes: list[SceneBeat] = Field(default_factory=list)
    sceneCount: int = Field(default=0, ge=0)
    usedFallbackScene: bool = False
    schemaRepairCount: int = Field(default=0, ge=0)
    characterCandidates: list[CharacterCandidate] = Field(default_factory=list)
    semanticRepairCount: int = Field(default=0, ge=0)
    semanticValidationStatus: Literal["passed", "repaired", "blocked"] = "passed"
    mergeStatus: Literal["pending", "merged", "discarded_cancelled", "failed", "cancelled"] = "pending"
    continuityNotes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    qualityWarnings: list[str] = Field(default_factory=list)
    qualityIssues: list[QualityIssue] = Field(default_factory=list)
    errorMessage: str | None = None
    rawOutput: str = ""
    tokens: TokenUsage = Field(default_factory=TokenUsage)
    completedAt: str


class ChapterResult(StrictBaseModel):
    chapterTitle: str = ""
    chapterIndex: int = Field(default=0, ge=0)
    status: ChapterResultStatus = "pending"
    summary: str = Field(default="", max_length=1500)
    scene: SceneBeat | None = None
    sourceChunkIds: list[str] = Field(default_factory=list)
    qualityWarnings: list[str] = Field(default_factory=list)
    errorMessage: str | None = None
    completedChunks: int = Field(default=0, ge=0)
    failedChunks: int = Field(default=0, ge=0)
    cancelledChunks: int = Field(default=0, ge=0)
    tokens: TokenUsage = Field(default_factory=TokenUsage)
    updatedAt: str


class BookGlobalMemory(StrictBaseModel):
    characters: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    settings: list[str] = Field(default_factory=list)
    terms: list[str] = Field(default_factory=list)


class JobEventLog(StrictBaseModel):
    eventId: str
    eventType: str
    message: str
    createdAt: str
    taskId: str | None = None
    chunkId: str | None = None
    details: dict[str, JsonValue] = Field(default_factory=dict)


class NovelProcessJobCreateRequest(StrictBaseModel):
    bookId: str
    title: str = ""
    chunks: list[NovelProcessChunkInput]
    userInstruction: str
    outputFormat: str = "markdown"
    promptVersion: str = "novel-process-v3"
    maxConcurrency: int = Field(default=3, ge=1, le=10)
    maxRetries: int = Field(default=2, ge=0, le=10)
    providerSelection: ProviderSelectionRequest | None = None


class NovelProcessJobControlResponse(StrictBaseModel):
    ok: bool = True
    jobId: str
    status: JobStatus


class NovelProcessJob(StrictBaseModel):
    jobId: str
    bookId: str
    title: str = ""
    status: JobStatus = "created"
    userInstruction: str
    outputFormat: str
    promptVersion: str
    activePhase: Literal["chunk_parse", "chapter_merge", "continuity_review"] = "chunk_parse"
    maxConcurrency: int = Field(default=3, ge=1, le=10)
    maxRetries: int = Field(default=2, ge=0, le=10)
    providerSelection: ProviderSelectionRequest | None = None
    chunks: list[ChunkRecord] = Field(default_factory=list)
    agentTasks: list[AgentTask] = Field(default_factory=list)
    chunkResults: list[ChunkResult] = Field(default_factory=list)
    chapterResults: list[ChapterResult] = Field(default_factory=list)
    bookGlobalMemory: BookGlobalMemory = Field(default_factory=BookGlobalMemory)
    eventLogs: list[JobEventLog] = Field(default_factory=list)
    totalChunks: int = Field(default=0, ge=0)
    completedChunks: int = Field(default=0, ge=0)
    failedChunks: int = Field(default=0, ge=0)
    cancelledChunks: int = Field(default=0, ge=0)
    runningTasks: int = Field(default=0, ge=0)
    actualInputTokens: int = Field(default=0, ge=0)
    actualOutputTokens: int = Field(default=0, ge=0)
    actualTotalTokens: int = Field(default=0, ge=0)
    tokenSource: TokenSource = "none"
    createdAt: str
    updatedAt: str
    startedAt: str | None = None
    completedAt: str | None = None


class NovelProcessJobResults(StrictBaseModel):
    jobId: str
    status: JobStatus
    completedResults: list[ChunkResult] = Field(default_factory=list)
    failedResults: list[ChunkResult] = Field(default_factory=list)
    completedChapterResults: list[ChapterResult] = Field(default_factory=list)
    failedChapterResults: list[ChapterResult] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class SceneLinkPolishItem(StrictBaseModel):
    sourceScene: SceneBeat
    targetScene: SceneBeat
    choiceId: str
    choiceText: str
    choiceDisplayName: str | None = None


class SceneLinkPolishPatch(StrictBaseModel):
    choiceId: str
    choiceText: str
    choiceDisplayName: str | None = None
    targetSceneId: str
    targetTitle: str
    targetSummary: str
    openingText: str | None = None
    warnings: list[str] = Field(default_factory=list)


class SceneLinkPolishRequest(StrictBaseModel):
    links: list[SceneLinkPolishItem]
    providerSelection: ProviderSelectionRequest | None = None


class SceneLinkPolishResponse(StrictBaseModel):
    patches: list[SceneLinkPolishPatch] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
