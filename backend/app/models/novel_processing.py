"""Shared contracts for durable long-novel processing."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import ConfigDict, Field, model_validator

from app.models.common import StrictBaseModel
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionRequest


class NovelContractModel(StrictBaseModel):
    """Base for the camelCase JSON contracts used by the editor and backend."""

    model_config = ConfigDict(extra="forbid", use_enum_values=True)


class NovelProcessingConfig(NovelContractModel):
    largeTextThresholdChars: int = Field(default=300_000, ge=1)
    largeTextThresholdWords: int = Field(default=100_000, ge=1)
    maxDirectProcessChars: int = Field(default=1_200_000, ge=1)
    chunkTargetChars: int = Field(default=8_000, ge=1)
    chunkMaxChars: int = Field(default=12_000, ge=1)
    chunkMinChars: int = Field(default=2_000, ge=1)
    chunkOverlapChars: int = Field(default=500, ge=0)
    maxConcurrentAgents: int = Field(default=3, ge=1, le=10)
    maxRetryCount: int = Field(default=2, ge=0)
    lowChapterConfidenceThreshold: float = Field(default=0.65, ge=0.0, le=1.0)
    previousContextSummaryMaxChars: int = Field(default=800, ge=0)
    chapterSummaryMaxChars: int = Field(default=1_500, ge=0)

    @model_validator(mode="after")
    def validate_chunk_bounds(self) -> "NovelProcessingConfig":
        if self.chunkMinChars > self.chunkTargetChars:
            raise ValueError("novel.chunkMinChars must be <= novel.chunkTargetChars")
        if self.chunkTargetChars > self.chunkMaxChars:
            raise ValueError("novel.chunkTargetChars must be <= novel.chunkMaxChars")
        if self.chunkOverlapChars >= self.chunkMaxChars:
            raise ValueError("novel.chunkOverlapChars must be < novel.chunkMaxChars")
        if self.largeTextThresholdChars > self.maxDirectProcessChars:
            raise ValueError("novel.largeTextThresholdChars must be <= novel.maxDirectProcessChars")
        return self


class NovelProcessingStatus(str, Enum):
    PENDING = "pending"
    WAITING = "waiting"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    FAILED_PARTIAL = "failed_partial"
    RETRYING = "retrying"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"
    TIMEOUT_SUSPECTED = "timeout_suspected"


class NovelProcessingPhase(str, Enum):
    CHUNK_PARSE = "chunk_parse"
    CHAPTER_MERGE = "chapter_merge"
    CONTINUITY_REVIEW = "continuity_review"


class LargeTextLevel(str, Enum):
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    HUGE = "huge"


class RecommendedNovelAction(str, Enum):
    DIRECT = "direct"
    SPLIT_RECOMMENDED = "split_recommended"
    SPLIT_REQUIRED = "split_required"


class ChapterSourceType(str, Enum):
    EPUB_TOC = "epub_toc"
    HTML_HEADING = "html_heading"
    MARKDOWN_HEADING = "markdown_heading"
    DOCX_HEADING = "docx_heading"
    TXT_RULE = "txt_rule"
    MANUAL = "manual"
    FALLBACK_AUTO = "fallback_auto"


NovelFileType = Literal["txt", "md", "docx", "epub", "html", "json", "unknown"]


class BookImportRecord(NovelContractModel):
    bookId: str
    fileName: str
    originalPath: str | None = None
    fileSizeBytes: int = Field(..., ge=0)
    fileHash: str
    encoding: str = "utf-8"
    fileType: NovelFileType = "unknown"
    charCount: int = Field(..., ge=0)
    wordCount: int = Field(..., ge=0)
    estimatedTokens: int = Field(..., ge=0)
    hasStructuredChapters: bool = False
    largeTextLevel: LargeTextLevel
    recommendedAction: RecommendedNovelAction
    createdAt: str
    updatedAt: str


class ChapterRecord(NovelContractModel):
    chapterId: str
    bookId: str
    index: int = Field(..., ge=0)
    volumeIndex: int | None = Field(default=None, ge=0)
    volumeTitle: str | None = None
    title: str
    normalizedTitle: str
    startOffset: int = Field(..., ge=0)
    endOffset: int = Field(..., ge=0)
    charCount: int = Field(..., ge=0)
    wordCount: int = Field(..., ge=0)
    estimatedTokens: int = Field(..., ge=0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    sourceType: ChapterSourceType
    status: NovelProcessingStatus = NovelProcessingStatus.PENDING
    anomalyFlags: list[str] = Field(default_factory=list)
    createdAt: str
    updatedAt: str

    @model_validator(mode="after")
    def validate_offsets(self) -> "ChapterRecord":
        if self.endOffset < self.startOffset:
            raise ValueError("chapter.endOffset must be greater than or equal to startOffset")
        return self


class ChunkRecord(NovelContractModel):
    chunkId: str
    chapterId: str
    bookId: str
    indexInChapter: int = Field(..., ge=0)
    globalIndex: int = Field(..., ge=0)
    startOffset: int = Field(..., ge=0)
    endOffset: int = Field(..., ge=0)
    charCount: int = Field(..., ge=0)
    estimatedTokens: int = Field(..., ge=0)
    overlapBefore: int = Field(default=0, ge=0)
    overlapAfter: int = Field(default=0, ge=0)
    status: NovelProcessingStatus = NovelProcessingStatus.PENDING
    assignedAgentId: str | None = None
    resultId: str | None = None
    retryCount: int = Field(default=0, ge=0)
    createdAt: str
    updatedAt: str

    @model_validator(mode="after")
    def validate_offsets(self) -> "ChunkRecord":
        if self.endOffset < self.startOffset:
            raise ValueError("chunk.endOffset must be greater than or equal to startOffset")
        return self


class NovelProcessJob(NovelContractModel):
    jobId: str
    bookId: str
    selectedChapterIds: list[str] = Field(default_factory=list)
    totalChapters: int = Field(default=0, ge=0)
    totalChunks: int = Field(default=0, ge=0)
    completedChunks: int = Field(default=0, ge=0)
    failedChunks: int = Field(default=0, ge=0)
    skippedChunks: int = Field(default=0, ge=0)
    cancelledChunks: int = Field(default=0, ge=0)
    totalEstimatedTokens: int = Field(default=0, ge=0)
    actualInputTokens: int = Field(default=0, ge=0)
    actualOutputTokens: int = Field(default=0, ge=0)
    actualTotalTokens: int = Field(default=0, ge=0)
    maxConcurrency: int = Field(default=3, ge=1, le=10)
    maxRetryCount: int = Field(default=2, ge=0)
    userInstruction: str | None = None
    outputFormat: str = "markdown"
    promptVersion: str = "novel-processing-v1"
    activePhase: NovelProcessingPhase = NovelProcessingPhase.CHUNK_PARSE
    status: NovelProcessingStatus = NovelProcessingStatus.PENDING
    createdAt: str
    startedAt: str | None = None
    pausedAt: str | None = None
    finishedAt: str | None = None
    updatedAt: str


class AgentTask(NovelContractModel):
    agentTaskId: str
    jobId: str
    bookId: str
    chapterId: str
    chunkId: str
    agentIndex: int = Field(..., ge=0)
    agentRole: Literal["chunk_parser", "chapter_merger", "continuity_reviewer", "link_polisher"] = "chunk_parser"
    attemptId: str = ""
    runAttempt: int = Field(default=1, ge=1)
    status: NovelProcessingStatus = NovelProcessingStatus.PENDING
    phase: str = "queued"
    currentStepLabel: str | None = None
    assignmentReason: str | None = None
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    tokenSource: str = "none"
    startedAt: str | None = None
    finishedAt: str | None = None
    heartbeatAt: str | None = None
    leaseExpiresAt: str | None = None
    cancelRequestedAt: str | None = None
    errorMessage: str | None = None
    failureCategory: str | None = None
    retryBackoffMs: int = Field(default=0, ge=0)
    retryCount: int = Field(default=0, ge=0)
    partialChars: int = Field(default=0, ge=0)
    partialResult: str | None = None
    resultPreview: str | None = None
    inputChunkChars: int = Field(default=0, ge=0)
    contextChars: int = Field(default=0, ge=0)
    schemaRepairCount: int = Field(default=0, ge=0)
    rawOutput: str | None = None


class ChunkResult(NovelContractModel):
    resultId: str
    jobId: str
    bookId: str
    chapterId: str
    chunkId: str
    chunkIndex: int = Field(..., ge=0)
    status: NovelProcessingStatus = NovelProcessingStatus.COMPLETED
    resultText: str
    summary: str | None = None
    scenes: list[SceneBeat] = Field(default_factory=list)
    sceneCount: int = Field(default=0, ge=0)
    usedFallbackScene: bool = False
    schemaRepairCount: int = Field(default=0, ge=0)
    mergeStatus: Literal["pending", "merged", "discarded_cancelled", "failed", "cancelled"] = "pending"
    continuityNotes: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    qualityWarnings: list[str] = Field(default_factory=list)
    errorMessage: str | None = None
    rawOutput: str | None = None
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    tokenSource: str = "none"
    promptVersion: str = "novel-processing-v1"
    modelName: str | None = None
    createdAt: str
    updatedAt: str


class ChapterResult(NovelContractModel):
    chapterResultId: str
    jobId: str
    bookId: str
    chapterId: str
    chapterIndex: int = Field(..., ge=0)
    title: str
    mergedText: str
    summary: str | None = None
    chunkResultIds: list[str] = Field(default_factory=list)
    inputTokens: int = Field(default=0, ge=0)
    outputTokens: int = Field(default=0, ge=0)
    totalTokens: int = Field(default=0, ge=0)
    status: NovelProcessingStatus = NovelProcessingStatus.PENDING
    createdAt: str
    updatedAt: str


class JobEventLog(NovelContractModel):
    eventId: str
    jobId: str | None = None
    bookId: str | None = None
    chapterId: str | None = None
    chunkId: str | None = None
    agentTaskId: str | None = None
    level: Literal["info", "warning", "error"] = "info"
    type: str
    message: str
    payload: dict[str, Any] | None = None
    createdAt: str


class NovelImportFileInfo(NovelContractModel):
    bookId: str | None = None
    fileName: str
    originalPath: str | None = None
    fileSizeBytes: int = Field(default=0, ge=0)
    fileHash: str | None = None
    encoding: str = "utf-8"
    fileType: NovelFileType = "unknown"
    text: str | None = None
    charCount: int | None = Field(default=None, ge=0)
    wordCount: int | None = Field(default=None, ge=0)
    hasStructuredChapters: bool | None = None


class ChapterSplitOptions(NovelContractModel):
    sourceTypes: list[ChapterSourceType] | None = None
    minimumConfidence: float | None = Field(default=None, ge=0.0, le=1.0)
    preserveExisting: bool = False


class ChapterBoundaryChange(NovelContractModel):
    chapterId: str
    startOffset: int | None = Field(default=None, ge=0)
    endOffset: int | None = Field(default=None, ge=0)
    title: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    anomalyFlags: list[str] | None = None


class ChapterBoundaryUpdateRequest(NovelContractModel):
    changes: list[ChapterBoundaryChange]


class ChunkCreationOptions(NovelContractModel):
    chunkTargetChars: int | None = Field(default=None, ge=1)
    chunkMaxChars: int | None = Field(default=None, ge=1)
    chunkMinChars: int | None = Field(default=None, ge=1)
    chunkOverlapChars: int | None = Field(default=None, ge=0)
    recreateExisting: bool = True


class NovelProcessJobOptions(NovelContractModel):
    maxConcurrency: int | None = Field(default=None, ge=1, le=10)
    maxRetryCount: int | None = Field(default=None, ge=0)
    userInstruction: str | None = None
    outputFormat: str = "markdown"
    promptVersion: str = "novel-processing-v1"
    providerSelection: ProviderSelectionRequest | None = None


class CreateChunksRequest(NovelContractModel):
    chapterIds: list[str]
    options: ChunkCreationOptions = Field(default_factory=ChunkCreationOptions)


class CreateNovelProcessJobRequest(NovelContractModel):
    chapterIds: list[str]
    options: NovelProcessJobOptions = Field(default_factory=NovelProcessJobOptions)


class ExportJobResultResponse(NovelContractModel):
    jobId: str
    format: str
    fileName: str
    content: str
    warnings: list[str] = Field(default_factory=list)
