import type { ProviderSelectionPayload } from "../api/types";

export interface NovelProcessingConfig {
  largeTextThresholdChars: number;
  largeTextThresholdWords: number;
  maxDirectProcessChars: number;
  chunkTargetChars: number;
  chunkMaxChars: number;
  chunkMinChars: number;
  chunkOverlapChars: number;
  maxConcurrentAgents: number;
  maxRetryCount: number;
  lowChapterConfidenceThreshold: number;
  previousContextSummaryMaxChars: number;
  chapterSummaryMaxChars: number;
}

export const DEFAULT_NOVEL_PROCESSING_CONFIG: NovelProcessingConfig = {
  largeTextThresholdChars: 300_000,
  largeTextThresholdWords: 100_000,
  maxDirectProcessChars: 1_200_000,
  chunkTargetChars: 8_000,
  chunkMaxChars: 12_000,
  chunkMinChars: 2_000,
  chunkOverlapChars: 500,
  maxConcurrentAgents: 3,
  maxRetryCount: 2,
  lowChapterConfidenceThreshold: 0.65,
  previousContextSummaryMaxChars: 800,
  chapterSummaryMaxChars: 1_500,
};

export type NovelProcessingStatus =
  | "pending"
  | "waiting"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "failed_partial"
  | "retrying"
  | "cancelled"
  | "skipped"
  | "timeout_suspected";

export const NOVEL_PROCESSING_STATUSES: NovelProcessingStatus[] = [
  "pending",
  "waiting",
  "running",
  "paused",
  "completed",
  "failed",
  "failed_partial",
  "retrying",
  "cancelled",
  "skipped",
  "timeout_suspected",
];

export type LargeTextLevel = "small" | "medium" | "large" | "huge";
export type RecommendedNovelAction = "direct" | "split_recommended" | "split_required";
export type ChapterSourceType =
  | "epub_toc"
  | "html_heading"
  | "markdown_heading"
  | "docx_heading"
  | "txt_rule"
  | "manual"
  | "fallback_auto";
export type NovelFileType = "txt" | "md" | "docx" | "epub" | "html" | "json" | "unknown";

export interface BookImportRecord {
  bookId: string;
  fileName: string;
  originalPath: string | null;
  fileSizeBytes: number;
  fileHash: string;
  encoding: string;
  fileType: NovelFileType;
  charCount: number;
  wordCount: number;
  estimatedTokens: number;
  hasStructuredChapters: boolean;
  largeTextLevel: LargeTextLevel;
  recommendedAction: RecommendedNovelAction;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterRecord {
  chapterId: string;
  bookId: string;
  index: number;
  volumeIndex: number | null;
  volumeTitle: string | null;
  title: string;
  normalizedTitle: string;
  startOffset: number;
  endOffset: number;
  charCount: number;
  wordCount: number;
  estimatedTokens: number;
  confidence: number;
  sourceType: ChapterSourceType;
  status: NovelProcessingStatus;
  anomalyFlags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ChunkRecord {
  chunkId: string;
  chapterId: string;
  bookId: string;
  indexInChapter: number;
  globalIndex: number;
  startOffset: number;
  endOffset: number;
  charCount: number;
  estimatedTokens: number;
  overlapBefore: number;
  overlapAfter: number;
  status: NovelProcessingStatus;
  assignedAgentId: string | null;
  resultId: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface NovelProcessJob {
  jobId: string;
  bookId: string;
  selectedChapterIds: string[];
  totalChapters: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  skippedChunks: number;
  cancelledChunks: number;
  totalEstimatedTokens: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  maxConcurrency: number;
  maxRetryCount: number;
  userInstruction: string | null;
  outputFormat: string;
  promptVersion: string;
  activePhase: "chunk_parse" | "chapter_merge" | "continuity_review";
  status: NovelProcessingStatus;
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface AgentTask {
  agentTaskId: string;
  jobId: string;
  bookId: string;
  chapterId: string;
  chunkId: string;
  agentIndex: number;
  agentRole: "chunk_parser" | "chapter_merger" | "continuity_reviewer" | "link_polisher";
  attemptId: string;
  runAttempt: number;
  status: NovelProcessingStatus;
  phase: string;
  currentStepLabel: string | null;
  assignmentReason: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSource: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  errorMessage: string | null;
  failureCategory: string | null;
  retryBackoffMs: number;
  retryCount: number;
  partialChars: number;
  partialResult: string | null;
  resultPreview: string | null;
  inputChunkChars: number;
  contextChars: number;
  schemaRepairCount: number;
  rawOutput: string | null;
}

export interface ChunkResult {
  resultId: string;
  jobId: string;
  bookId: string;
  chapterId: string;
  chunkId: string;
  chunkIndex: number;
  status: NovelProcessingStatus;
  resultText: string;
  summary: string | null;
  scenes: unknown[];
  sceneCount: number;
  usedFallbackScene: boolean;
  schemaRepairCount: number;
  mergeStatus: "pending" | "merged" | "discarded_cancelled" | "failed" | "cancelled";
  continuityNotes: string[];
  warnings: string[];
  qualityWarnings: string[];
  errorMessage: string | null;
  rawOutput: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSource: string;
  promptVersion: string;
  modelName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterResult {
  chapterResultId: string;
  jobId: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  title: string;
  mergedText: string;
  summary: string | null;
  chunkResultIds: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  status: NovelProcessingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventLog {
  eventId: string;
  jobId: string | null;
  bookId: string | null;
  chapterId: string | null;
  chunkId: string | null;
  agentTaskId: string | null;
  level: "info" | "warning" | "error";
  type: string;
  message: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface NovelImportFileInfo {
  bookId?: string | null;
  fileName: string;
  originalPath?: string | null;
  fileSizeBytes?: number;
  fileHash?: string | null;
  encoding?: string;
  fileType?: NovelFileType;
  text?: string | null;
  charCount?: number | null;
  wordCount?: number | null;
  hasStructuredChapters?: boolean | null;
}

export interface ChapterSplitOptions {
  sourceTypes?: ChapterSourceType[] | null;
  minimumConfidence?: number | null;
  preserveExisting?: boolean;
}

export interface ChapterBoundaryChange {
  chapterId: string;
  startOffset?: number | null;
  endOffset?: number | null;
  title?: string | null;
  confidence?: number | null;
  anomalyFlags?: string[] | null;
}

export interface ChapterBoundaryUpdateRequest {
  changes: ChapterBoundaryChange[];
}

export interface ChunkCreationOptions {
  chunkTargetChars?: number | null;
  chunkMaxChars?: number | null;
  chunkMinChars?: number | null;
  chunkOverlapChars?: number | null;
  recreateExisting?: boolean;
}

export interface NovelProcessJobOptions {
  maxConcurrency?: number | null;
  maxRetryCount?: number | null;
  userInstruction?: string | null;
  outputFormat?: string;
  promptVersion?: string;
  providerSelection?: ProviderSelectionPayload | null;
}

export interface CreateChunksRequest {
  chapterIds: string[];
  options?: ChunkCreationOptions;
}

export interface CreateNovelProcessJobRequest {
  chapterIds: string[];
  options?: NovelProcessJobOptions;
}

export interface ExportJobResultResponse {
  jobId: string;
  format: string;
  fileName: string;
  content: string;
  warnings: string[];
}

const base = "/api/novel/processing";

export const NOVEL_PROCESSING_ROUTES = {
  analyzeNovelImport: `${base}/import/analyze`,
  createBookImportRecord: `${base}/books`,
  splitBookIntoChapters: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/chapters/split`,
  listChapters: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/chapters`,
  updateChapterBoundaries: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/chapters/boundaries`,
  createChunksForSelectedChapters: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/chunks`,
  createNovelProcessJob: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/jobs`,
  getNovelProcessJob: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}`,
  listNovelProcessJobs: (bookId: string) => `${base}/books/${encodeURIComponent(bookId)}/jobs`,
  pauseNovelProcessJob: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}/pause`,
  resumeNovelProcessJob: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}/resume`,
  cancelNovelProcessJob: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}/cancel`,
  retryFailedChunks: (jobId: string) => `${base}/jobs/${encodeURIComponent(jobId)}/retry_failed_chunks`,
  getJobEvents: (jobId: string, limit = 100) => `${base}/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`,
  getChunkResult: (chunkId: string) => `${base}/chunks/${encodeURIComponent(chunkId)}/result`,
  getChapterResult: (chapterId: string) => `${base}/chapters/${encodeURIComponent(chapterId)}/result`,
  exportJobResult: (jobId: string, format = "markdown") => `${base}/jobs/${encodeURIComponent(jobId)}/export?format=${encodeURIComponent(format)}`,
} as const;

export interface NovelProcessingApiContract {
  analyzeNovelImport(file: NovelImportFileInfo): Promise<BookImportRecord>;
  createBookImportRecord(fileInfo: NovelImportFileInfo): Promise<BookImportRecord>;
  splitBookIntoChapters(bookId: string, options?: ChapterSplitOptions): Promise<ChapterRecord[]>;
  listChapters(bookId: string): Promise<ChapterRecord[]>;
  updateChapterBoundaries(bookId: string, changes: ChapterBoundaryChange[]): Promise<ChapterRecord[]>;
  createChunksForSelectedChapters(bookId: string, chapterIds: string[], options?: ChunkCreationOptions): Promise<ChunkRecord[]>;
  createNovelProcessJob(bookId: string, chapterIds: string[], options?: NovelProcessJobOptions): Promise<NovelProcessJob>;
  getNovelProcessJob(jobId: string): Promise<NovelProcessJob>;
  listNovelProcessJobs(bookId: string): Promise<NovelProcessJob[]>;
  pauseNovelProcessJob(jobId: string): Promise<NovelProcessJob>;
  resumeNovelProcessJob(jobId: string): Promise<NovelProcessJob>;
  cancelNovelProcessJob(jobId: string): Promise<NovelProcessJob>;
  retryFailedChunks(jobId: string): Promise<NovelProcessJob>;
  getJobEvents(jobId: string, limit?: number): Promise<JobEventLog[]>;
  getChunkResult(chunkId: string): Promise<ChunkResult>;
  getChapterResult(chapterId: string): Promise<ChapterResult>;
  exportJobResult(jobId: string, format: string): Promise<ExportJobResultResponse>;
}
