export type NovelProcessJobStatus =
  | "waiting"
  | "running"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "failed_partial"
  | "cancelled";

export type NovelProcessAgentStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled"
  | "timeout_suspected";

export type NovelProcessEventType =
  | "job_created"
  | "chapter_split_completed"
  | "agent_started"
  | "agent_output_updated"
  | "agent_completed"
  | "agent_failed"
  | "job_retry"
  | "result_merged"
  | "job_completed"
  | "job_paused"
  | "job_resumed"
  | "job_cancelled";

export type NovelProcessEventLevel = "info" | "warning" | "error" | "success";
export type NovelProcessPhaseStatus = "waiting" | "running" | "completed" | "blocked" | "failed" | "paused" | "retrying" | "cancelled";
export type NovelProcessQualitySeverity = "info" | "warning" | "danger" | "blocked";

export interface NovelProcessPhaseProgress {
  phase: string;
  label: string;
  status: NovelProcessPhaseStatus;
  current: number;
  total: number;
  percent: number;
  startedAt?: string | null;
  updatedAt?: string | null;
  etaMs?: number | null;
  blockingReason?: string | null;
}

export interface NovelProcessQualityIssue {
  code: string;
  severity: NovelProcessQualitySeverity;
  message: string;
  evidence?: string;
  action?: string;
  sourceChunkId?: string | null;
}

export interface NovelProcessQualityDimension {
  key: string;
  label: string;
  value: string;
  score: number;
  status: "good" | "warning" | "danger";
}

export interface NovelProcessTokenBreakdown {
  id: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedTokens: number;
  retryExtraTokens: number;
  chunkCount: number;
}

export interface NovelProcessTokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedTokens: number;
  actualTokens: number;
  averageChunkTokens: number;
  retryExtraTokens: number;
  byAgent: NovelProcessTokenBreakdown[];
  byChapter: NovelProcessTokenBreakdown[];
}

export interface NovelProcessAgentProgress {
  agentTaskId: string;
  agentIndex: number;
  agentRole?: "chunk_parser" | "chapter_merger" | "continuity_reviewer" | "link_polisher";
  attemptId?: string | null;
  runAttempt?: number;
  status: NovelProcessAgentStatus;
  phase?: string;
  currentChapterTitle: string;
  currentChunkId?: string | null;
  currentChunkIndex: number;
  currentChunkTotal: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenSource?: string;
  elapsedMs: number;
  retryCount: number;
  completedTaskCount?: number;
  failedTaskCount?: number;
  outputPreview: string;
  progressPercent: number;
  heartbeatAt: string;
  assignedChunkIds?: string[];
  currentStepLabel?: string;
  lastHeartbeatAt?: string;
  leaseExpiresAt?: string | null;
  cancelRequestedAt?: string | null;
  partialPreview?: string;
  assignmentReason?: string;
  inputChunkChars?: number;
  contextChars?: number;
  schemaRepairCount?: number;
  semanticRepairCount?: number;
  semanticValidationStatus?: "passed" | "repaired" | "blocked";
  characterCandidates?: Array<{
    character_id: string;
    name: string;
    aliases: string[];
    first_seen_offset: number;
    description: string;
    speaking_style_hint?: string;
    confidence: number;
  }>;
  failureCategory?: string | null;
  retryBackoffMs?: number;
  sceneCount?: number;
  usedFallbackScene?: boolean;
  qualityWarnings?: string[];
  qualityIssues?: NovelProcessQualityIssue[];
  mergeStatus?: "pending" | "merged" | "discarded_cancelled" | "failed" | "cancelled";
  chunkStartOffset?: number | null;
  chunkEndOffset?: number | null;
  currentChunkExcerpt?: string;
  previousContextSummary?: string;
  nextContextHint?: string;
  taskStartedAt?: string | null;
  taskCompletedAt?: string | null;
  progressBasis?: string;
  queuePosition?: number | null;
  estimatedRemainingMs?: number | null;
  lastMeaningfulEventAt?: string | null;
  staleReason?: string | null;
  recentEvents?: NovelProcessEvent[];
}

export interface NovelProcessChapterProgress {
  chapterId: string;
  chapterIndex: number;
  title: string;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  inputTokens: number;
  outputTokens: number;
  estimatedTokens: number;
}

export interface NovelProcessJob {
  jobId: string;
  bookId?: string;
  novelTitle: string;
  status: NovelProcessJobStatus;
  selectedChapterCount: number;
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  cancelledChunks: number;
  runningAgentCount: number;
  estimatedRemainingChunks: number;
  maxConcurrency?: number;
  queueDepth?: number;
  activePhase?: string;
  promptVersion?: string;
  phaseProgress?: NovelProcessPhaseProgress[];
  progressPercent: number;
  qualityDimensions?: NovelProcessQualityDimension[];
  qualityIssues?: NovelProcessQualityIssue[];
  tokenStats: NovelProcessTokenStats;
  agents: NovelProcessAgentProgress[];
  chapters: NovelProcessChapterProgress[];
  source: "api" | "mock" | "ui_pressure_fixture";
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failureReason?: string;
}

export interface NovelProcessEvent {
  eventId: string;
  jobId: string;
  type: NovelProcessEventType;
  level: NovelProcessEventLevel;
  createdAt: string;
  title: string;
  message: string;
  agentTaskId?: string;
  chapterId?: string;
  chunkId?: string;
  payload?: unknown;
}

export interface NovelProcessTaskSnapshot {
  projectId?: string;
  job: NovelProcessJob;
  events: NovelProcessEvent[];
}

export const autoOpenNovelProcessStatuses: NovelProcessJobStatus[] = [
  "running",
  "paused",
  "failed_partial",
  "waiting",
  "retrying",
];

export function isNovelProcessJobUnfinished(status: NovelProcessJobStatus): boolean {
  return status === "waiting" || status === "running" || status === "paused" || status === "retrying" || status === "failed_partial";
}
