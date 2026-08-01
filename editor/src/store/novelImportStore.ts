import { create, type StoreApi } from "zustand";
import { nanoid } from "nanoid";
import { backendClient, type NovelProcessChunkPayload } from "../api/backendClient";
import { getProviderSelectionPayload } from "../providers/providerRegistry";
import type { ProviderSelectionPayload } from "../providers/types";
import { aiAdaptNovelSceneStream, aiBuildNovelOutlineStream, aiPlanNovelChapterStream, aiScanNovelChunkStream, verifyNovelAiRoutes, type AiCheckpointEvent, type AiTraceEvent } from "../novel-import/adaptationClient";
import { analyzeNovelFile, novelPreflightThresholds } from "../novel-import/importNovelFile";
import { adaptedSceneToNode, createNovelImportLayout, importedNovelEdge, type NovelImportLayout } from "../novel-import/importToGraph";
import { splitChaptersAsync as splitNovelChaptersAsync } from "../novel-import/chapterSplitter";
import { evaluateNovelImportQuality, suggestedSceneCountForText } from "../novel-import/quality";
import { createMockNovelProcessSnapshot, persistNovelProcessTaskSnapshot } from "../novel-import/novelProcessJobAdapter";
import { updateSourceMappingAfterEdit } from "../novel-import/sourceMapping";
import { validateNovelBlueprintWrite } from "../novel-import/structureValidator";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { chunkText, normalizeText } from "../novel-import/textChunker";
import {
  buildInitialChapterSelection,
  createAgentTasksForJob,
  createChunksForSelectedChapters,
  createEmptyNovelProcessingState,
  createNovelProcessJob,
  deriveBookId,
  findMatchingNovelProcessJob,
  getChapterProcessStatus,
  getChapterVolumeLabel,
  initializeChunkDispatch,
  isNovelProcessJobActive,
  markAgentTaskFailedInState,
  retryAgentTaskInState,
  retryFailedAgentTasksInState,
  sanitizeNovelProcessingConfig,
  setChunkResultInState,
  type AgentTask,
  type ChunkRecord,
  type NovelProcessStatus,
  type NovelProcessingConfig,
  type NovelProcessJobStatus,
  type NovelProcessingState,
} from "../novel-import/novelProcessing";
import type {
  NovelProcessAgentProgress,
  NovelProcessChapterProgress,
  NovelProcessJob as NovelProcessPanelJob,
} from "../novel-import/processJobTypes";
import {
  buildNovelResultExport,
  chunksMatchDocument,
  createEmptyNovelPersistenceState,
  deriveNovelPersistenceState,
  findReusableBookByHash,
  findSameNameDifferentHash,
  normalizeNovelPersistenceState,
  recoverNovelPersistenceState,
} from "../novel-import/persistence";
import { estimateTextTokens, getAvailableInputTokens } from "../utils/contextBudget";
import type {
  AdaptedScene,
  AssetSuggestion,
  BranchSuggestion,
  BookImportRecord,
  ChapterCandidate,
  ChapterSplitReport,
  CharacterCandidate,
  CharacterCandidateReview,
  ConflictPoint,
  ImportOptions,
  NovelImportEntryMode,
  NovelImportPreflight,
  NovelAiChunkAnalysis,
  NovelAiChunkPartial,
  NovelAiInspectableResult,
  NovelAiOutlinePartial,
  NovelAiStage,
  NovelImportSession,
  NovelPersistenceState,
  NovelPendingImport,
  ProgressState,
  ProgressiveImportJob,
  SceneCandidate,
  SourceDocument,
  TextChunk,
} from "../novel-import/types";
import { defaultImportOptions } from "../novel-import/types";
import { useEditorStore } from "./editorStore";
import { useProjectStore } from "./projectStore";
import type { EditorEdge, EditorNode, GraphImportMode } from "../types/nodes";
import type { SceneBeat } from "../types/scene";
import {
  buildPendingVisualAssetsForScene,
  ensureDefaultBackgroundPlaceholderAsset,
  ensureSceneHasBackgroundPlaceholder,
} from "../utils/assetAudit";

export interface NovelImportModelStatus {
  configured: boolean;
  label: string;
  contextBudget: number;
  availableInputBudget: number;
  reservedBudget: number;
}

export interface NovelModelStreamState {
  open: boolean;
  title: string;
  status: string;
  responseText: string;
  responseSegments?: string[];
  rawLength?: number;
  traces: AiTraceEvent[];
  requestId?: string;
}

export type NovelProcessJobCreationStatus = "idle" | "creating" | "created" | "duplicate" | "failed";

export interface NovelProcessJobCreationState {
  status: NovelProcessJobCreationStatus;
  message?: string;
  jobId?: string;
  chunkCount?: number;
}

export interface NovelGraphImportResult {
  lastInsertedNodeId?: string;
  mode: GraphImportMode;
  reusedExistingImport: boolean;
  notice: string;
  importedNodeIds: string[];
  importLineId?: string;
}

type NovelSplitDiagnosticStatus = "idle" | "started" | "completed" | "failed";

interface NovelSplitDiagnostic {
  status: NovelSplitDiagnosticStatus;
  startedAt?: string;
  completedAt?: string;
  chapterCount?: number;
  errorMessage?: string;
}

interface NovelImportStore {
  session: NovelImportSession;
  pendingImport?: NovelPendingImport;
  importJob?: ProgressiveImportJob;
  progress?: ProgressState;
  modelStream: NovelModelStreamState;
  inspectableResults: NovelAiInspectableResult[];
  errors: string[];
  warnings: string[];
  splitDiagnostic: NovelSplitDiagnostic;
  jobCreation: NovelProcessJobCreationState;
  processing: NovelProcessingState;
  persistence: NovelPersistenceState;
  scanRetries: number;
  isProcessing: boolean;
  toggleModelStream: () => void;
  hydratePersistence: (persistence?: NovelPersistenceState) => void;
  exportResults: (format: "txt" | "markdown", completedOnly?: boolean) => string;
  retryChunkResult: (chunkId: string) => Promise<void>;
  retryFailedItems: () => Promise<void>;
  resetSession: () => void;
  importFile: (file: File) => Promise<void>;
  confirmDirectImport: () => void;
  startChapterSplitImport: () => Promise<void>;
  cancelPendingImport: () => void;
  updateDocumentText: (text: string) => void;
  updateImportOptions: (options: Partial<ImportOptions>) => void;
  splitChapters: () => Promise<void>;
  prepareChapterSelection: () => void;
  toggleProcessingChapter: (chapterId: string) => void;
  selectAllProcessingChapters: () => void;
  invertProcessingChapterSelection: () => void;
  selectProcessingVolume: (volumeLabel: string) => void;
  selectOnlyUnprocessedChapters: () => void;
  selectOnlyFailedChapters: () => void;
  clearProcessingChapterSelection: () => void;
  updateNovelProcessingConfig: (config: Partial<NovelProcessingConfig>) => void;
  updateNovelProcessingDraft: (draft: Partial<Pick<NovelProcessingState, "userInstruction" | "outputFormat" | "promptVersion">>) => void;
  createNovelProcessingJob: (options?: { regenerate?: boolean }) => Promise<void>;
  syncNovelProcessingJobStatus: (jobId: string, status: string) => void;
  syncNovelProcessingJobSnapshot: (job: NovelProcessPanelJob) => void;
  retryNovelAgentTask: (agentTaskId: string) => void;
  retryFailedNovelAgentTasks: () => void;
  markNovelAgentTaskFailed: (agentTaskId: string, errorMessage: string) => void;
  setNovelChunkResult: (chunkId: string, result: string, tokenUsage?: { inputTokens?: number; outputTokens?: number }) => void;
  importNovelProcessJobResults: (jobId: string) => Promise<NovelGraphImportResult | undefined>;
  updateChapter: (chapter: ChapterCandidate) => void;
  updateOutlineChapter: (chapter: ChapterCandidate) => void;
  removeOutlineChapter: (chapterId: string) => void;
  splitScenes: () => void;
  updateSceneCandidate: (scene: SceneCandidate) => void;
  extractCharacters: () => void;
  updateCharacter: (character: CharacterCandidate) => void;
  updateOutlineCharacter: (character: CharacterCandidate) => void;
  promoteCharacterCandidate: (characterId: string) => void;
  ignoreCharacterCandidate: (characterId: string) => void;
  updateAdaptedScene: (scene: AdaptedScene) => void;
  startAiAnalysis: () => Promise<void>;
  confirmOutlineAndGenerate: () => Promise<void>;
  generateBlueprintLine: () => Promise<void>;
  continueWithQualityRisk: () => Promise<void>;
  retryQualityCheck: () => Promise<void>;
  pauseBlueprintGeneration: () => void;
  resumeBlueprintGeneration: () => Promise<void>;
  skipCurrentScene: () => void;
  cancelBlueprintGeneration: () => void;
}

function createEmptySession(options?: Partial<ImportOptions>): NovelImportSession {
  const now = new Date().toISOString();
  return {
    session_id: `novel_session_${nanoid(8)}`,
    chunks: [],
    chapters: [],
    scenes: [],
    characters: [],
    character_candidates_review: [],
    adapted_scenes: [],
    asset_suggestions: [],
    branch_suggestions: [],
    conflict_points: [],
    ai_chunk_analyses: [],
    scan_partials: {},
    outline_partials: {},
    planned_chapter_ids: [],
    validation_reports: [],
    quality_risk_accepted: false,
    ai_stage: "landing",
    status: "idle",
    created_at: now,
    updated_at: now,
    import_options: { ...defaultImportOptions, ...options },
  };
}

function createEmptyModelStream(): NovelModelStreamState {
  return { open: false, title: "模型响应", status: "等待开始", responseText: "", responseSegments: [], rawLength: 0, traces: [] };
}

const modelStreamMaxVisibleChars = 18_000;
const modelStreamMaxSegments = 120;
const eagerDocumentEditChunkLimit = 60_000;

const novelProcessingStorageKey = "agentvn.novelProcessing.v1";

function loadNovelProcessingState(): NovelProcessingState {
  if (typeof window === "undefined") return createEmptyNovelProcessingState();
  try {
    const raw = window.localStorage.getItem(novelProcessingStorageKey);
    if (!raw) return createEmptyNovelProcessingState();
    const parsed = JSON.parse(raw) as Partial<NovelProcessingState>;
    return createEmptyNovelProcessingState({
      ...parsed,
      restoredAt: new Date().toISOString(),
    });
  } catch (error) {
    reportFrontendError("editor.novel-import", error, {
      operation: "restore-processing-state",
    });
    return createEmptyNovelProcessingState();
  }
}

function persistNovelProcessingState(processing: NovelProcessingState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(novelProcessingStorageKey, JSON.stringify({ ...processing, updatedAt: new Date().toISOString() }));
  } catch (error) {
    reportFrontendError("editor.novel-import", error, {
      operation: "persist-processing-state",
    });
    // Local recovery is best-effort; job rows can still be recreated explicitly.
  }
}

function panelJobStatusToLocal(status: string): NovelProcessJobStatus {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "failed_partial") return "failed";
  return "processing";
}

function panelAgentStatusToLocal(status: string): NovelProcessStatus {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "failed_partial") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "waiting" || status === "paused") return "waiting";
  return "processing";
}

function clampPanelCount(value: number | undefined, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.floor(value ?? 0)));
}

function normalizePanelChapterTitle(value: string): string {
  return value.trim().replace(/\s+/g, "").toLowerCase();
}

function findLocalChapterIdForPanelChapter(processing: NovelProcessingState, panelChapter: NovelProcessChapterProgress): string | undefined {
  const direct = processing.chapterSnapshots.find((chapter) => chapter.chapter_id === panelChapter.chapterId);
  if (direct) return direct.chapter_id;
  const byIndex = processing.chapterSnapshots.find((chapter) => chapter.index === panelChapter.chapterIndex);
  if (byIndex) return byIndex.chapter_id;
  const panelTitle = normalizePanelChapterTitle(panelChapter.title);
  return processing.chapterSnapshots.find((chapter) => normalizePanelChapterTitle(chapter.title) === panelTitle)?.chapter_id;
}

function syncNovelProcessingFromPanelJob(processing: NovelProcessingState, panelJob: NovelProcessPanelJob): NovelProcessingState {
  const localJob = processing.jobs.find((job) => job.jobId === panelJob.jobId);
  if (!localJob) return processing;

  let changed = false;
  const updatedAt = panelJob.updatedAt ?? new Date().toISOString();
  const localStatus = panelJobStatusToLocal(panelJob.status);
  const selectedChapterIds = new Set(localJob.selectedChapterIds);
  const scopedChunk = (chunk: ChunkRecord) => chunk.bookId === localJob.bookId && selectedChapterIds.has(chunk.chapterId);
  const chunks = processing.chunks.map((chunk) => ({ ...chunk }));
  const tasks = processing.tasks.map((task) => ({ ...task }));
  const chunkById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const tasksByChunkId = new Map<string, AgentTask[]>();
  for (const task of tasks) {
    if (task.jobId !== panelJob.jobId) continue;
    const rows = tasksByChunkId.get(task.chunkId) ?? [];
    rows.push(task);
    tasksByChunkId.set(task.chunkId, rows);
  }

  const updateTaskForChunk = (
    chunkId: string,
    status: NovelProcessStatus,
    agent?: NovelProcessAgentProgress,
  ) => {
    const rows = tasksByChunkId.get(chunkId) ?? [];
    for (const task of rows) {
      if (task.status !== status) {
        task.status = status;
        changed = true;
      }
      if (agent) {
        const nextStartedAt = agent.taskStartedAt ?? task.startedAt;
        const nextFinishedAt = agent.taskCompletedAt ?? (status === "completed" || status === "failed" || status === "cancelled" ? agent.heartbeatAt : task.finishedAt);
        const nextPreview = agent.partialPreview || agent.outputPreview || task.resultPreview;
        const nextError = status === "failed" ? (agent.outputPreview || agent.staleReason || task.errorMessage) : task.errorMessage;
        if (task.startedAt !== nextStartedAt) {
          task.startedAt = nextStartedAt;
          changed = true;
        }
        if (task.finishedAt !== nextFinishedAt) {
          task.finishedAt = nextFinishedAt;
          changed = true;
        }
        if (nextPreview && task.resultPreview !== nextPreview.slice(0, 180)) {
          task.resultPreview = nextPreview.slice(0, 180);
          changed = true;
        }
        if (task.errorMessage !== nextError) {
          task.errorMessage = nextError;
          changed = true;
        }
        if (Number.isFinite(agent.retryCount) && task.retryCount !== agent.retryCount) {
          task.retryCount = agent.retryCount;
          changed = true;
        }
      }
    }
  };

  const updateChunkStatus = (
    chunkId: string | undefined | null,
    status: NovelProcessStatus,
    agent?: NovelProcessAgentProgress,
  ) => {
    if (!chunkId) return;
    const chunk = chunkById.get(chunkId);
    if (!chunk || !scopedChunk(chunk)) return;
    if (chunk.status !== status) {
      chunk.status = status;
      changed = true;
    }
    if (agent?.agentTaskId && chunk.assignedAgentId !== `agent_${agent.agentIndex}`) {
      chunk.assignedAgentId = `agent_${agent.agentIndex}`;
      changed = true;
    }
    updateTaskForChunk(chunk.chunkId, status, agent);
  };

  for (const agent of panelJob.agents ?? []) {
    const assignedChunkIds = agent.assignedChunkIds?.length ? agent.assignedChunkIds : agent.currentChunkId ? [agent.currentChunkId] : [];
    const completedCount = clampPanelCount(agent.completedTaskCount, assignedChunkIds.length);
    const failedCount = clampPanelCount(agent.failedTaskCount, Math.max(0, assignedChunkIds.length - completedCount));
    assignedChunkIds.forEach((chunkId, index) => {
      if (index < completedCount) updateChunkStatus(chunkId, "completed", agent);
      else if (index < completedCount + failedCount) updateChunkStatus(chunkId, "failed", agent);
      else if (chunkId === agent.currentChunkId) updateChunkStatus(chunkId, panelAgentStatusToLocal(agent.status), agent);
      else updateChunkStatus(chunkId, "waiting", agent);
    });
  }

  for (const panelChapter of panelJob.chapters ?? []) {
    const chapterId = findLocalChapterIdForPanelChapter(processing, panelChapter);
    if (!chapterId) continue;
    const chapterChunks = chunks
      .filter((chunk) => scopedChunk(chunk) && chunk.chapterId === chapterId)
      .sort((a, b) => a.indexInChapter - b.indexInChapter);
    const completedCount = clampPanelCount(panelChapter.completedChunks, chapterChunks.length);
    const failedCount = clampPanelCount(panelChapter.failedChunks, Math.max(0, chapterChunks.length - completedCount));
    chapterChunks.forEach((chunk, index) => {
      if (index < completedCount) updateChunkStatus(chunk.chunkId, "completed");
      else if (index < completedCount + failedCount) updateChunkStatus(chunk.chunkId, "failed");
      else if (chunk.status === "completed" || chunk.status === "failed") updateChunkStatus(chunk.chunkId, "waiting");
    });
  }

  const jobs = processing.jobs.map((job) => {
    if (job.jobId !== panelJob.jobId) return job;
    const next = {
      ...job,
      status: localStatus,
      totalChunks: panelJob.totalChunks,
      completedChunks: panelJob.completedChunks,
      failedChunks: panelJob.failedChunks,
      skippedChunks: panelJob.cancelledChunks,
      actualInputTokens: panelJob.tokenStats?.totalInputTokens ?? job.actualInputTokens,
      actualOutputTokens: panelJob.tokenStats?.totalOutputTokens ?? job.actualOutputTokens,
      actualTotalTokens: panelJob.tokenStats?.totalTokens ?? job.actualTotalTokens,
      finishedAt: localStatus === "completed" || localStatus === "failed" || localStatus === "cancelled"
        ? panelJob.completedAt ?? job.finishedAt ?? updatedAt
        : undefined,
    };
    const didChange = JSON.stringify(job) !== JSON.stringify(next);
    if (didChange) changed = true;
    return next;
  });

  if (!changed) return processing;
  return {
    ...processing,
    chunks,
    tasks,
    jobs,
    activeJobId: processing.activeJobId ?? panelJob.jobId,
    updatedAt,
  };
}

function syncProcessingChapters(processing: NovelProcessingState, chapters: ChapterCandidate[]): NovelProcessingState {
  const selectedChapterIds = buildInitialChapterSelection(chapters, processing.selectedChapterIds);
  return {
    ...processing,
    chapterSnapshots: chapters.map((chapter) => ({ ...chapter })),
    selectedChapterIds,
    updatedAt: new Date().toISOString(),
  };
}

function clearNovelProcessingState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(novelProcessingStorageKey);
  } catch (error) {
    reportFrontendError("editor.novel-import", error, {
      operation: "clear-processing-state",
    });
    // Best-effort cleanup.
  }
}

function touch(session: NovelImportSession): NovelImportSession {
  return { ...session, updated_at: new Date().toISOString() };
}

function createBookImportRecord(document: SourceDocument, preflight: NovelImportPreflight, entryMode: NovelImportEntryMode): BookImportRecord {
  return {
    record_id: `book_import_${nanoid(8)}`,
    document_id: document.document_id,
    file_name: document.file_name,
    file_hash_sha256: preflight.file_hash_sha256,
    entry_mode: entryMode,
    status: entryMode === "direct" ? "direct_ready" : "split_preview",
    created_at: new Date().toISOString(),
    preflight,
  };
}

function resetSessionForCommittedImport(
  session: NovelImportSession,
  document: SourceDocument,
  importRecord: BookImportRecord,
  chunks: TextChunk[],
  status: NovelImportSession["status"],
): NovelImportSession {
  return touch({
    ...session,
    document: {
      ...document,
      metadata: {
        ...document.metadata,
        import_record_id: importRecord.record_id,
        import_preflight: importRecord.preflight,
      },
    },
    import_record: importRecord,
    chunks,
    ai_stage: "landing",
    status,
    ai_chunk_analyses: [],
    scan_partials: {},
    outline_partials: {},
    planned_chapter_ids: [],
    validation_reports: [],
    quality_report: undefined,
    quality_risk_accepted: false,
    ai_outline: undefined,
    chapters: [],
    chapter_split_report: undefined,
    scenes: [],
    characters: [],
    character_candidates_review: [],
    adapted_scenes: [],
    asset_suggestions: [],
    branch_suggestions: [],
    conflict_points: [],
  });
}

function contextBudgetToChunkChars(options?: Partial<ImportOptions>): number {
  const selection = getNovelProviderSelectionPayload();
  const { available } = getAvailableInputTokens(selection);
  const configured = Number(options?.max_chunk_chars ?? defaultImportOptions.max_chunk_chars);
  return Math.max(2600, Math.min(8000, configured, Math.floor(available * 0.24)));
}

function chunkDocumentText(documentId: string, text: string, options: ImportOptions, chapters?: ChapterCandidate[]): TextChunk[] {
  const baseChunkChars = contextBudgetToChunkChars(options);
  const boundedChunkChars = Math.max(2600, Math.min(8000, baseChunkChars));
  const overlapChars = Math.max(240, Math.min(720, Math.floor(boundedChunkChars * 0.08)));
  if (!chapters?.length) return chunkText(documentId, text, boundedChunkChars, overlapChars);
  const chunks: TextChunk[] = [];
  for (const chapter of [...chapters].sort((a, b) => a.index - b.index)) {
    const start = Math.max(0, Math.min(text.length, chapter.start_offset));
    const end = Math.max(start, Math.min(text.length, chapter.end_offset));
    const localText = text.slice(start, end);
    const localChunks = chunkText(documentId, localText, boundedChunkChars, overlapChars);
    chunks.push(...localChunks.map((chunk) => ({
      ...chunk,
      chunk_id: `${chunk.chunk_id}_${chapter.chapter_id.slice(-6)}`,
      index: chunks.length + chunk.index,
      text: chunk.text,
      start_offset: start + chunk.start_offset,
      end_offset: start + chunk.end_offset,
      chapter_hint: chapter.title,
    })));
  }
  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

function shouldRefreshChunksImmediatelyAfterEdit(text: string): boolean {
  return text.length <= eagerDocumentEditChunkLimit;
}

function buildProcessingStateForChapters(input: {
  document: SourceDocument;
  sessionId: string;
  chapters: ChapterCandidate[];
  previous?: NovelProcessingState;
}): NovelProcessingState {
  const bookId = deriveBookId({ documentId: input.document.document_id, sessionId: input.sessionId });
  const base = syncProcessingChapters(input.previous ?? createEmptyNovelProcessingState(), input.chapters);
  const selectedChapterIds = buildInitialChapterSelection(input.chapters, base.selectedChapterIds);
  const chunks = createChunksForSelectedChapters({
    bookId,
    documentText: input.document.normalized_text,
    chapters: input.chapters,
    selectedChapterIds,
    config: base.config,
  });
  return {
    ...base,
    selectedChapterIds,
    chapterSnapshots: input.chapters.map((chapter) => ({ ...chapter })),
    chunks,
    jobs: [],
    tasks: [],
    activeJobId: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function getNovelProviderSelectionPayload(): ProviderSelectionPayload | undefined {
  const selection = getProviderSelectionPayload("text_generation");
  if (!selection) return undefined;
  const parameters = selection.parameters ?? {};
  return {
    ...selection,
    parameters: {
      ...parameters,
      structured_mode: "json_object",
      max_tokens: Math.max(Number(parameters.max_tokens ?? 0), 3000),
      request_timeout_seconds: Math.max(Number(parameters.request_timeout_seconds ?? 0), 300),
      context_budget_tokens: Math.max(Number(parameters.context_budget_tokens ?? 0), 24000),
      thinking_mode: false,
    },
  };
}

function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***");
}

type NovelImportSet = StoreApi<NovelImportStore>["setState"];

function classifyNovelImportError(error: unknown, detail: string, phase: string): string {
  const haystack = `${error instanceof Error ? error.name : ""}\n${phase}\n${detail}`.toLowerCase();
  if (/aborterror|timed out|timeout|超时|超过\s+\d+\s*秒/.test(haystack)) return "请求超时";
  if (/missing novel ai routes|backend route is missing|接口版本|openapi/.test(haystack)) return "后端小说 AI 接口缺失";

  const statusMatch = haystack.match(/(?:http|returned http|后端请求失败)\s*(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1] ?? 0);
    if (status === 401 || status === 403) return "模型鉴权失败";
    if (status === 429) return "模型服务限流";
    return `后端 HTTP ${status} 错误`;
  }

  if (/failed to fetch|无法连接后端|network|econn|enotfound|connection refused|连接.*失败/.test(haystack)) return "后端连接失败";
  if (/\bapi[_-]?key\b|\bauthorization\b|\bauthentication\b|\bunauthorized\b|\bforbidden\b|bearer|invalid api key|incorrect api key|鉴权|访问密钥|密钥/.test(haystack)) return "模型鉴权失败";
  if (/rate limit|too many requests|限流|请求过于频繁/.test(haystack)) return "模型服务限流";
  if (/safety|content policy|blocked|安全策略|策略阻止/.test(haystack)) return "模型安全策略阻止";
  if (/json|schema|structured|final structured payload|结构化|解析|校验/.test(haystack)) return "模型结构化输出解析失败";
  if (/stream|sse|readable stream|流式/.test(haystack)) return "模型流式响应失败";
  if (/route|backend|后端/.test(haystack)) return "后端请求失败";
  if (/文件|file|读取|decode|encoding|格式/.test(haystack)) return "小说文件读取失败";
  return /ai|模型|蓝图/.test(haystack) ? "模型调用失败" : "导入流程失败";
}

function buildNovelImportErrorDetail(input: { activeDetail?: string; modelTranscript?: string }, detail: string): string {
  const modelTranscript = input.modelTranscript?.trim().slice(-modelStreamMaxVisibleChars);
  return [
    input.activeDetail,
    detail,
    modelTranscript ? `===== 模型完整输出 =====\n${modelTranscript}` : undefined,
  ].filter((section): section is string => Boolean(section?.trim())).join("\n\n");
}

function appendModelTranscript(current: string, title: string, body: string): string {
  const trimmed = body.trim();
  const compactBody = trimmed.length <= 1200
    ? trimmed
    : /^[\[{]/.test(trimmed)
      ? `Structured result is available in the parsed results panel. Realtime log skipped ${trimmed.length.toLocaleString()} JSON characters to keep the UI responsive.`
      : `${trimmed.slice(0, 900)}\n...\n[truncated ${Math.max(0, trimmed.length - 900).toLocaleString()} characters]`;
  const section = `\n\n===== ${title} =====\n${compactBody}`;
  return trimModelTranscript(`${current.trimEnd()}${section}`.trimStart());
}

function shallowStructuredPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  if (Array.isArray(payload)) return `Structured result array with ${payload.length.toLocaleString()} items. Full data is available in the parsed results panel.`;
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const lines = keys.slice(0, 14).map((key) => {
    const value = record[key];
    if (Array.isArray(value)) return `${key}: ${value.length.toLocaleString()} items`;
    if (value && typeof value === "object") return `${key}: object`;
    if (typeof value === "string") return `${key}: ${value.length > 180 ? `${value.slice(0, 180)}...` : value}`;
    if (value === undefined) return `${key}: undefined`;
    return `${key}: ${String(value)}`;
  });
  if (keys.length > lines.length) lines.push(`...${(keys.length - lines.length).toLocaleString()} more fields`);
  return [
    "Structured result is available in the parsed results panel.",
    "Realtime log records a shallow summary to keep the UI responsive.",
    ...lines,
  ].join("\n");
}

function appendStructuredModelTranscript(current: string, title: string, payload: unknown): string {
  const section = `\n\n===== ${title} =====\n${shallowStructuredPayloadSummary(payload)}`;
  return trimModelTranscript(`${current.trimEnd()}${section}`.trimStart());
}

function invalidChapterSourceRanges(chapters: ChapterCandidate[], text: string): string[] {
  return [...chapters]
    .sort((a, b) => a.index - b.index)
    .flatMap((chapter, index, ordered) => {
      const issues: string[] = [];
      if (chapter.start_offset < 0 || chapter.end_offset > text.length) issues.push(`${chapter.title} 原文范围越界`);
      if (chapter.end_offset <= chapter.start_offset) issues.push(`${chapter.title} 章节原文为空`);
      if (!text.slice(chapter.start_offset, chapter.end_offset).trim()) issues.push(`${chapter.title} 未映射到有效原文`);
      if (index > 0 && chapter.start_offset < ordered[index - 1].end_offset) issues.push(`${chapter.title} 与上一章节原文范围重叠`);
      return issues;
    });
}

function appendModelTranscriptHeader(current: string, title: string): string {
  const section = `\n\n===== ${title} =====\n`;
  return trimModelTranscript(`${current.trimEnd()}${section}`.trimStart());
}

function trimModelTranscript(value: string): string {
  if (value.length <= modelStreamMaxVisibleChars) return value;
  return `...[showing the latest ${modelStreamMaxVisibleChars.toLocaleString()} realtime characters]\n${value.slice(-modelStreamMaxVisibleChars)}`;
}

function appendModelStreamSegment(stream: NovelModelStreamState, chunk: string): NovelModelStreamState {
  const responseText = trimModelTranscript(`${stream.responseText}${chunk}`);
  const responseSegments = [...(stream.responseSegments ?? []), chunk].slice(-modelStreamMaxSegments);
  return {
    ...stream,
    responseText,
    responseSegments,
    rawLength: (stream.rawLength ?? stream.responseText.length) + chunk.length,
  };
}

function createFullDocumentProcessingChapter(document: SourceDocument): ChapterCandidate {
  return {
    chapter_id: `full_document_${document.document_id}`,
    book_id: document.document_id,
    title: document.title || document.file_name || "全文处理",
    normalized_title: document.title || document.file_name || "全文处理",
    index: 0,
    start_offset: 0,
    end_offset: document.normalized_text.length,
    char_count: document.normalized_text.length,
    estimated_tokens: estimateTextTokens(document.normalized_text),
    source_type: "fallback_auto",
    status: "confirmed",
    anomaly_flags: ["fallback_generated"],
    summary: "未选择章节切分时自动创建的全文处理范围。",
    confidence: 1,
    metadata: { synthetic_full_document: true },
  };
}

const modelStreamDeltaBuffers = new Map<string, string>();
const modelStreamDeltaFrames = new Map<string, number>();

function scheduleModelStreamFrame(callback: FrameRequestCallback): number {
  return typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame(callback)
    : window.setTimeout(() => callback(Date.now()), 16);
}

function cancelModelStreamFrame(handle: number): void {
  if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(handle);
  else window.clearTimeout(handle);
}

function clearModelStreamDeltaQueue(requestId?: string): void {
  const ids = requestId ? [requestId] : [...modelStreamDeltaFrames.keys()];
  for (const id of ids) {
    const frame = modelStreamDeltaFrames.get(id);
    if (frame !== undefined) cancelModelStreamFrame(frame);
    modelStreamDeltaFrames.delete(id);
    modelStreamDeltaBuffers.delete(id);
  }
}

function flushModelStreamDeltaQueue(set: NovelImportSet, requestId: string): void {
  const frame = modelStreamDeltaFrames.get(requestId);
  if (frame !== undefined) cancelModelStreamFrame(frame);
  modelStreamDeltaFrames.delete(requestId);
  const chunk = modelStreamDeltaBuffers.get(requestId) ?? "";
  modelStreamDeltaBuffers.delete(requestId);
  if (!chunk) return;
  set((current) => {
    if (current.modelStream.requestId !== requestId) return {};
    return {
      modelStream: {
        ...appendModelStreamSegment(current.modelStream, chunk),
        status: "流式输出中",
      },
      progress: markProgressHeartbeat(current.progress),
    };
  });
}

function queueModelStreamDelta(set: NovelImportSet, requestId: string, delta: string): void {
  if (!delta) return;
  modelStreamDeltaBuffers.set(requestId, `${modelStreamDeltaBuffers.get(requestId) ?? ""}${delta}`);
  if (modelStreamDeltaFrames.has(requestId)) return;
  const frame = scheduleModelStreamFrame(() => {
    modelStreamDeltaFrames.delete(requestId);
    const chunk = modelStreamDeltaBuffers.get(requestId) ?? "";
    modelStreamDeltaBuffers.delete(requestId);
    if (!chunk) return;
    set((current) => {
      if (current.modelStream.requestId !== requestId) return {};
      return {
        modelStream: {
          ...appendModelStreamSegment(current.modelStream, chunk),
          status: "流式输出中",
        },
        progress: markProgressHeartbeat(current.progress),
      };
    });
  });
  modelStreamDeltaFrames.set(requestId, frame);
}

function progressPhaseLabel(phase: string): string {
  if (phase === "import") return "读取小说文件";
  if (phase === "version") return "接口版本确认";
  if (phase === "scan") return "AI 全文扫描";
  if (phase === "outline") return "全书大纲合成";
  if (phase === "planning") return "场景规划";
  if (phase === "blueprint") return "蓝图生成";
  return phase;
}

function createProgressState(
  input: Pick<ProgressState, "phase" | "current" | "total" | "message" | "cancellable"> & Partial<ProgressState>,
  previous?: ProgressState,
): ProgressState {
  const now = Date.now();
  return {
    ...input,
    stageLabel: input.stageLabel ?? progressPhaseLabel(input.phase),
    detail: input.detail ?? input.message,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    lastResponseMs: input.lastResponseMs ?? previous?.lastResponseMs,
  };
}

function markProgressHeartbeat(progress?: ProgressState): ProgressState | undefined {
  return progress ? { ...progress, updatedAt: Date.now() } : undefined;
}

function markProgressResponse(progress: ProgressState | undefined, requestStartedAt: number): ProgressState | undefined {
  return progress ? { ...progress, updatedAt: Date.now(), lastResponseMs: Date.now() - requestStartedAt } : undefined;
}

const genericCharacterNamePattern = /^(众人|众|大家|所有人|旁白|系统|声音|路人|群众|村民|人群|士兵|守卫|侍卫|卫兵|黑衣人|白衣人|男人|女人|男子|女子|少年|少女|老人|老者|仆人|侍女|丫鬟|店小二|掌柜|官兵|敌人|怪物|妖怪|那人|那女子|那男子|某人|一人|一名.+|几名.+|.+之一)$/;
const descriptiveCharacterNamePattern = /(之一|其中|某个|几个|一群|众|们|声音|目光|身影|影子|气息|旁白|系统)/;

function filterCharacterCandidates(characters: CharacterCandidate[]): CharacterCandidate[] {
  return characters.filter((character) => {
    const id = character.character_id?.trim();
    const name = character.name?.trim();
    const description = character.description?.trim();
    return Boolean(id && name && description) && !looksLikeCharacterDescription(name);
  });
}

function looksLikeCharacterDescription(name: string): boolean {
  const value = name.trim();
  return !value || value.length > 24 || /[，。！？、,.;:]/.test(value);
}

function characterIdentityKey(value?: string | null): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[「」『』“”"'\s·・,，。！？、:：；;（）()【】\[\]<>《》]/g, "");
}

const cjkRomanizationAliases: Record<string, string[]> = {
  阿: ["a"],
  奥: ["ao"],
  百: ["bai"],
  布: ["bu"],
  德: ["de"],
  佛: ["fo", "fu"],
  格: ["ge"],
  哈: ["ha"],
  怀: ["huai"],
  加: ["jia"],
  科: ["ke"],
  莱: ["lai"],
  勒: ["le", "lei"],
  列: ["lie"],
  鲁: ["lu"],
  米: ["mi"],
  内: ["nei"],
  诺: ["nuo"],
  斯: ["si"],
  特: ["te"],
  维: ["wei"],
  伊: ["yi"],
  以: ["yi"],
  尔: ["er"],
};

const westernCharacterNameAliases: Record<string, string[]> = {
  [characterIdentityKey("布鲁斯")]: ["bruce"],
  [characterIdentityKey("加百列")]: ["gabriel"],
  [characterIdentityKey("伊文斯")]: ["evans"],
  [characterIdentityKey("科勒怀尔")]: ["colewell", "kellerwell", "keller_well"],
  [characterIdentityKey("管家")]: ["butler"],
  [characterIdentityKey("莱尔")]: ["laier", "leir", "leyer", "leeevans", "lee_evans", "leirevans", "leir_evans", "leo", "evans"],
  [characterIdentityKey("伯恩山")]: ["butler"],
  [characterIdentityKey("以佛")]: ["yifo", "yifu", "ifo", "ife", "ifrit"],
  [characterIdentityKey("学长")]: ["xuezhang", "senpai", "senior", "upperclassman"],
};

function westernAliasesForCharacterToken(token: string): string[] {
  const key = characterIdentityKey(token);
  if (!key) return [];
  const aliases = new Set<string>();
  for (const [sourceKey, values] of Object.entries(westernCharacterNameAliases)) {
    if (key === sourceKey || key.includes(sourceKey)) {
      values.map(characterIdentityKey).filter(Boolean).forEach((value) => aliases.add(value));
    }
  }
  return [...aliases];
}

function romanizedCharacterKeys(value?: string | null): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  const tokens = [raw, ...raw.split(/[·・.\s_-]+/)].map((item) => item.trim()).filter(Boolean);
  const aliases: string[] = [];
  for (const token of tokens) {
    aliases.push(...westernAliasesForCharacterToken(token));
    let sawCjk = false;
    let variants = [""];
    let blocked = false;
    for (const char of token) {
      const mapped = cjkRomanizationAliases[char];
      if (mapped) {
        sawCjk = true;
        variants = variants.flatMap((prefix) => mapped.map((part) => `${prefix}${part}`));
        continue;
      }
      if (/[\u4e00-\u9fff]/.test(char)) {
        blocked = true;
        break;
      }
      if (/[A-Za-z0-9]/.test(char)) variants = variants.map((prefix) => `${prefix}${char.toLowerCase()}`);
    }
    if (!blocked && sawCjk) aliases.push(...variants.map(characterIdentityKey).filter((key) => key.length >= 2));
  }
  return [...new Set(aliases)];
}

function characterReferenceKeys(value?: string | null): string[] {
  return [...new Set([characterIdentityKey(value), ...romanizedCharacterKeys(value)].filter(Boolean))];
}

function characterKeysForReview(character: CharacterCandidate): string[] {
  return [
    character.character_id,
    character.name,
    ...character.aliases,
  ].map(characterIdentityKey).filter(Boolean);
}

function characterKeysForCommandReference(character: CharacterCandidate): string[] {
  return [
    character.character_id,
    character.name,
    ...character.aliases,
  ].flatMap(characterReferenceKeys).filter(Boolean);
}

function isLikelyMinorCharacterName(name: string): boolean {
  const value = name.trim();
  return genericCharacterNamePattern.test(value) || descriptiveCharacterNamePattern.test(value);
}

function mergeCharacterCandidateList(characters: CharacterCandidate[]): CharacterCandidate[] {
  const merged: CharacterCandidate[] = [];
  for (const character of filterCharacterCandidates(characters)) {
    const keys = new Set(characterKeysForReview(character));
    const index = merged.findIndex((item) => characterKeysForReview(item).some((key) => keys.has(key)));
    if (index >= 0) {
      const existing = merged[index];
      merged[index] = {
        ...existing,
        ...character,
        character_id: existing.character_id || character.character_id,
        name: existing.name || character.name,
        aliases: [...new Set([...existing.aliases, ...character.aliases, existing.name, character.name].filter(Boolean))],
        first_seen_offset: Math.min(existing.first_seen_offset ?? 0, character.first_seen_offset ?? 0),
        description: character.description || existing.description,
        speaking_style_hint: character.speaking_style_hint || existing.speaking_style_hint,
        confidence: Math.max(existing.confidence ?? 0, character.confidence ?? 0),
      };
    } else {
      merged.push(character);
    }
  }
  return merged;
}

function characterReferenceEvidence(character: CharacterCandidate, session: NovelImportSession): CharacterCandidateReview["evidence"] {
  const keys = new Set(characterKeysForReview(character));
  const sceneRefs = session.scenes.filter((scene) => scene.characters.some((value) => keys.has(characterIdentityKey(value)))).length;
  const commandValues = session.adapted_scenes.flatMap((adapted) => adapted.scene_beat.commands.flatMap((command) => {
    if (command.type === "dialog" || command.type === "sprite") return [command.character_id];
    if (command.type === "animation" && command.target.startsWith("sprite:")) return [command.target.slice("sprite:".length)];
    return [];
  }));
  const matchedCommands = commandValues.filter((value) => keys.has(characterIdentityKey(value)));
  return {
    sceneRefs,
    commandRefs: matchedCommands.length,
    aliasMatches: [...new Set(matchedCommands)],
  };
}

function characterOutlineReferenceCount(character: CharacterCandidate, session: NovelImportSession): number {
  const outline = session.ai_outline;
  if (!outline) return 0;
  const searchable = characterIdentityKey([
    outline.summary,
    outline.main_plot,
    ...outline.chapters.map((chapter) => `${chapter.title} ${chapter.summary}`),
    ...(outline.conflict_points ?? []).map((point) => `${point.source_scene_display_name ?? ""} ${point.description} ${point.mainline_resolution}`),
  ].join("\n"));
  return characterKeysForReview(character)
    .filter((key) => key.length >= 2)
    .filter((key) => searchable.includes(key)).length;
}

function reviewCharacterCandidate(character: CharacterCandidate, allCharacters: CharacterCandidate[], session: NovelImportSession, previous?: CharacterCandidateReview): CharacterCandidateReview {
  const keys = characterKeysForReview(character);
  const occurrenceRefs = allCharacters.filter((item) => characterKeysForReview(item).some((key) => keys.includes(key))).length;
  const evidence = characterReferenceEvidence(character, session);
  const outlineRefs = characterOutlineReferenceCount(character, session);
  const reasons: string[] = [];
  let score = 0;
  if ((character.confidence ?? 0) >= 0.78) {
    score += 24;
    reasons.push("模型置信度高");
  } else if ((character.confidence ?? 0) >= 0.62) {
    score += 14;
  } else {
    reasons.push("置信度偏低");
  }
  if (character.description.trim().length >= 12) score += 10;
  else reasons.push("描述信息不足");
  if (character.speaking_style_hint?.trim()) score += 5;
  if (character.aliases.length > 0) score += Math.min(10, character.aliases.length * 4);
  if (occurrenceRefs > 1) {
    score += Math.min(24, occurrenceRefs * 8);
    reasons.push(`重复出现 ${occurrenceRefs} 次`);
  } else {
    reasons.push("出现次数低");
  }
  if (evidence.sceneRefs > 0) {
    score += Math.min(30, evidence.sceneRefs * 15);
    reasons.push(`场景引用 ${evidence.sceneRefs} 次`);
  }
  if (outlineRefs > 0) {
    score += Math.min(20, outlineRefs * 10);
    reasons.push(`大纲文本提及 ${outlineRefs} 次`);
  }
  if (evidence.commandRefs > 0) {
    score += Math.min(45, evidence.commandRefs * 20);
    reasons.push(`对白/立绘引用 ${evidence.commandRefs} 次`);
  } else {
    reasons.push("无对白/立绘引用");
  }
  if (isLikelyMinorCharacterName(character.name)) {
    score -= 30;
    reasons.push("疑似称谓或群体角色");
  }
  const promotedByEvidence = evidence.commandRefs > 0 || evidence.sceneRefs >= 2;
  const strongOutlineRole = outlineRefs > 0 && (character.confidence ?? 0) >= 0.72 && character.description.trim().length >= 10;
  const shouldPromote = promotedByEvidence || strongOutlineRole || (score >= 46 && !isLikelyMinorCharacterName(character.name));
  const previousStatus = previous?.status;
  const status: CharacterCandidateReview["status"] = previousStatus === "ignored"
    ? "ignored"
    : previousStatus === "promoted" || shouldPromote
      ? "promoted"
      : "candidate";
  return {
    character,
    score: Math.max(0, Math.round(score)),
    status,
    reasons: [...new Set(reasons)],
    evidence,
  };
}

function buildCharacterCandidateReviews(
  characters: CharacterCandidate[],
  session: NovelImportSession,
  previousReviews: CharacterCandidateReview[] = session.character_candidates_review ?? [],
): CharacterCandidateReview[] {
  const merged = mergeCharacterCandidateList(characters);
  const previousByKey = new Map(previousReviews.flatMap((review) => characterKeysForReview(review.character).map((key) => [key, review] as const)));
  return merged
    .map((character) => reviewCharacterCandidate(character, characters, session, previousByKey.get(characterKeysForReview(character)[0] ?? "")))
    .sort((a, b) => b.score - a.score || a.character.first_seen_offset - b.character.first_seen_offset);
}

function splitReviewedCharacters(
  characters: CharacterCandidate[],
  session: NovelImportSession,
  previousReviews: CharacterCandidateReview[] = session.character_candidates_review ?? [],
): { confirmed: CharacterCandidate[]; reviews: CharacterCandidateReview[] } {
  const reviews = buildCharacterCandidateReviews(characters, session, previousReviews);
  return {
    confirmed: reviews.filter((review) => review.status === "promoted").map((review) => review.character),
    reviews,
  };
}

function characterReviewSources(session: NovelImportSession, updates: CharacterCandidate[] = []): CharacterCandidate[] {
  return [
    ...session.characters,
    ...(session.character_candidates_review ?? []).map((review) => review.character),
    ...updates,
  ];
}

function textFingerprint(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function partialMatchesChunk(partial: NovelAiChunkPartial | undefined, chunk: TextChunk): partial is NovelAiChunkPartial {
  return Boolean(
    partial &&
    partial.document_id === chunk.document_id &&
    partial.chunk_id === chunk.chunk_id &&
    partial.start_offset === chunk.start_offset &&
    partial.end_offset === chunk.end_offset &&
    partial.text_hash === textFingerprint(chunk.text)
  );
}

function withChunkMetadata(chunk: TextChunk, partial: NovelAiChunkPartial): NovelAiChunkPartial {
  return {
    ...partial,
    document_id: chunk.document_id,
    chunk_id: chunk.chunk_id,
    start_offset: chunk.start_offset,
    end_offset: chunk.end_offset,
    text_hash: textFingerprint(chunk.text),
  };
}

function isScanCheckpointStage(stage: string): stage is "summary" | "entities" | "timeline" {
  return stage === "summary" || stage === "entities" || stage === "timeline";
}

function isOutlineCheckpointStage(stage: string): stage is "mainline" | "structure" | "index" {
  return stage === "mainline" || stage === "structure" || stage === "index";
}

function applyScanCheckpoint(chunk: TextChunk, checkpoint: AiCheckpointEvent): void {
  if (!isScanCheckpointStage(checkpoint.stage)) {
    useNovelImportStore.setState((state) => ({ warnings: [...state.warnings, `未知扫描检查点：${checkpoint.stage}`] }));
    return;
  }
  useNovelImportStore.setState((state) => {
    const current = partialMatchesChunk(state.session.scan_partials[chunk.chunk_id], chunk)
      ? state.session.scan_partials[chunk.chunk_id]
      : withChunkMetadata(chunk, {});
    const next = { ...current };
    if (checkpoint.stage === "summary") next.summary = checkpoint.payload as NovelAiChunkPartial["summary"];
    if (checkpoint.stage === "entities") next.entities = checkpoint.payload as NovelAiChunkPartial["entities"];
    if (checkpoint.stage === "timeline") next.timeline = checkpoint.payload as NovelAiChunkPartial["timeline"];
    return {
      session: touch({ ...state.session, scan_partials: { ...state.session.scan_partials, [chunk.chunk_id]: withChunkMetadata(chunk, next) } }),
      progress: markProgressHeartbeat(state.progress),
    };
  });
}

function applyOutlineCheckpoint(checkpoint: AiCheckpointEvent): void {
  if (!isOutlineCheckpointStage(checkpoint.stage)) {
    useNovelImportStore.setState((state) => ({ warnings: [...state.warnings, `未知大纲检查点：${checkpoint.stage}`] }));
    return;
  }
  useNovelImportStore.setState((state) => {
    const next = { ...state.session.outline_partials };
    if (checkpoint.stage === "mainline") next.mainline = checkpoint.payload as NovelAiOutlinePartial["mainline"];
    if (checkpoint.stage === "structure") next.structure = checkpoint.payload as NovelAiOutlinePartial["structure"];
    if (checkpoint.stage === "index") next.index = checkpoint.payload as NovelAiOutlinePartial["index"];
    return {
      session: touch({ ...state.session, outline_partials: next }),
      progress: markProgressHeartbeat(state.progress),
    };
  });
}

function appendInspectableResult(result: Omit<NovelAiInspectableResult, "id" | "createdAt">): void {
  useNovelImportStore.setState((state) => ({
    inspectableResults: [
      ...state.inspectableResults,
      {
        ...result,
        id: `novel_ai_result_${nanoid(8)}`,
        createdAt: new Date().toISOString(),
      },
    ],
  }));
}

function stringifyPayload(payload: unknown): string {
  try {
    return shallowStructuredPayloadSummary(payload);
  } catch {
    // error-log-ignore: 这里只生成简短的调试摘要，无法序列化时退回普通字符串。
    return String(payload);
  }
}

function reportNovelImportError(input: {
  phase: string;
  modelLabel?: string;
  error: unknown;
  session: NovelImportSession;
  progress?: ProgressState;
  activeDetail?: string;
  modelTranscript?: string;
}): string {
  const detail = formatError(input.error);
  const errorType = classifyNovelImportError(input.error, detail, input.phase);
  const compactDetail = detail.replace(/\s+/g, " ").trim().slice(0, 180);
  const message = `${input.phase}：${errorType}${compactDetail ? `；${compactDetail}` : ""}`;
  const fullDetail = buildNovelImportErrorDetail(input, detail);
  const model = input.modelLabel ?? (input.modelTranscript?.trim() ? getNovelImportModelStatus().label : undefined);
  useEditorStore.getState().setLastError({
    message,
    tone: "error",
    reportable: true,
    source: "小说导入",
    detail: fullDetail,
    action: input.modelTranscript?.trim()
      ? "点击打开完整错误报告，查看模型完整输出、当前阶段和项目快照。"
      : "点击打开完整错误报告，查看当前阶段和项目快照。",
    error: input.error instanceof Error ? input.error : detail,
    context: {
      phase: input.phase,
      errorType,
      model,
      sessionId: input.session.session_id,
      aiStage: input.session.ai_stage,
      status: input.session.status,
      progress: input.progress,
      hasModelTranscript: Boolean(input.modelTranscript?.trim()),
      modelTranscriptLength: input.modelTranscript?.length ?? 0,
      chunkCount: input.session.chunks.length,
      scannedChunkCount: input.session.ai_chunk_analyses.length,
      chapterCount: input.session.chapters.length,
      sceneCount: input.session.scenes.length,
      document: input.session.document ? {
        documentId: input.session.document.document_id,
        fileName: input.session.document.file_name,
        totalChars: input.session.document.total_chars,
      } : undefined,
    },
  });
  return message;
}

function outlineText(session: NovelImportSession): string {
  const outline = session.ai_outline;
  if (!outline) return "";
  return [
    `摘要：${outline.summary}`,
    `主线：${outline.main_plot}`,
    `章节：${outline.chapters.map((chapter) => `${chapter.index + 1}. ${chapter.title}：${chapter.summary}`).join("\n")}`,
  ].join("\n\n");
}

function isDefaultOpeningNode(node: EditorNode | undefined): boolean {
  const scene = node?.data.scene;
  if (!node || node.id !== "node_scene_opening" || node.data.nodeKind !== "scene" || !scene) return false;
  return (
    scene.scene_id === "scene_opening" &&
    scene.title === "开场" &&
    scene.summary === "雨夜里，主角抵达旧车站。" &&
    Array.isArray(scene.commands) &&
    scene.commands.length === 3 &&
    scene.commands[0]?.type === "background" &&
    scene.commands[0].background_id === "station_rain"
  );
}

function isBlankMainLine(): boolean {
  const editor = useEditorStore.getState();
  if (editor.nodes.length === 1 && editor.nodes[0]?.data.nodeKind === "start" && editor.edges.length === 0) return true;
  if (editor.nodes.length !== 2 || editor.edges.length !== 1) return false;
  const start = editor.nodes.find((node) => node.data.nodeKind === "start");
  const opening = editor.nodes.find((node) => isDefaultOpeningNode(node));
  const edge = editor.edges[0];
  return Boolean(start && opening && edge.source === start.id && edge.target === opening.id && (!edge.sourceHandle || edge.sourceHandle === "default"));
}

function removeDefaultOpeningLine(nodes: EditorNode[], edges: EditorEdge[]): { nodes: EditorNode[]; edges: EditorEdge[] } {
  const openingIds = new Set(nodes.filter((node) => isDefaultOpeningNode(node)).map((node) => node.id));
  if (openingIds.size === 0) return { nodes, edges };
  return {
    nodes: nodes.filter((node) => !openingIds.has(node.id)),
    edges: edges.filter((edge) => !openingIds.has(edge.source) && !openingIds.has(edge.target)),
  };
}

function novelGraphImportNotice(mode: GraphImportMode, count: number, reusedExistingImport = false): string {
  if (reusedExistingImport) {
    return "该 subagent job 的结果已经写入过蓝图，本次没有重复追加，已定位到已有解析节点树。";
  }
  if (mode === "blank_autoconnect") {
    return `已写入 ${count} 个解析节点，并自动接入空白蓝图入口主线。`;
  }
  return `已写入 ${count} 个解析节点，生成结果已放在画布空白区域作为独立节点树；未覆盖原有节点，也未接入现有工程流，需要启用时请手动连线。`;
}

function findImportLineMode(importLineId?: string): GraphImportMode | undefined {
  if (!importLineId) return undefined;
  return useEditorStore.getState().nodes.find((node) => node.data.editorMeta?.importLineId === importLineId)?.data.editorMeta?.graphImportMode;
}

function resolveNovelGraphImportMode(existingJob?: ProgressiveImportJob): GraphImportMode {
  return existingJob?.graphImportMode ?? findImportLineMode(existingJob?.importLineId) ?? (isBlankMainLine() ? "blank_autoconnect" : "append_isolated");
}

function graphBaseForImportMode(mode: GraphImportMode, nodes: EditorNode[], edges: EditorEdge[]): { nodes: EditorNode[]; edges: EditorEdge[] } {
  return mode === "blank_autoconnect" ? removeDefaultOpeningLine(nodes, edges) : { nodes, edges };
}

function withNovelGraphMetadata(node: EditorNode, input: { mode: GraphImportMode; sourceProcessJobId?: string }): EditorNode {
  return {
    ...node,
    data: {
      ...node.data,
      editorMeta: {
        ...node.data.editorMeta,
        graphImportMode: input.mode,
        sourceProcessJobId: input.sourceProcessJobId,
      },
    },
  };
}

function importedNovelLineEdges(
  layout: NovelImportLayout,
  nodes: EditorNode[],
  mode: GraphImportMode,
  lastInsertedNodeId?: string,
  edgeIndexOffset = 0,
): EditorEdge[] {
  return nodes
    .map((node, index) => {
      const sourceId = index === 0
        ? lastInsertedNodeId ?? (mode === "blank_autoconnect" ? "start" : undefined)
        : nodes[index - 1].id;
      return sourceId ? importedNovelEdge(layout.importLineId, sourceId, node.id, edgeIndexOffset + index) : undefined;
    })
    .filter((edge): edge is EditorEdge => Boolean(edge));
}

function findExistingProcessJobImport(jobId: string): NovelGraphImportResult | undefined {
  const importedNodes = useEditorStore.getState().nodes
    .filter((node) => node.data.editorMeta?.sourceProcessJobId === jobId)
    .sort((a, b) => (a.data.editorMeta?.importIndex ?? 0) - (b.data.editorMeta?.importIndex ?? 0));
  if (importedNodes.length === 0) return undefined;
  const lastNode = importedNodes[importedNodes.length - 1];
  const mode = lastNode.data.editorMeta?.graphImportMode ?? "append_isolated";
  return {
    lastInsertedNodeId: lastNode.id,
    mode,
    reusedExistingImport: true,
    notice: novelGraphImportNotice(mode, importedNodes.length, true),
    importedNodeIds: importedNodes.map((node) => node.id),
    importLineId: lastNode.data.editorMeta?.importLineId,
  };
}

function characterLookupKey(value?: string | null): string {
  return characterIdentityKey(value);
}

const protagonistPlaceholderKeys = new Set([
  "protagonist",
  "main_character",
  "maincharacter",
  "main_char",
  "mainchar",
  "mainrole",
  "lead",
  "hero",
  "heroine",
  "player",
  "mc",
  "主角",
  "主人公",
  "男主",
  "女主",
  "我",
].map(characterLookupKey));

function isProtagonistPlaceholder(value?: string | null): boolean {
  const key = characterLookupKey(value);
  return Boolean(key && protagonistPlaceholderKeys.has(key));
}

function characterDisplayName(characterId: string, characters: CharacterCandidate[]): string {
  const key = characterLookupKey(characterId);
  if (!key) return characterId;
  const directMatches = characters.filter((character) => [
    characterLookupKey(character.character_id),
    characterLookupKey(character.name),
    ...character.aliases.map(characterLookupKey),
  ].includes(key));
  const romanizedMatches = characters.filter((character) => characterKeysForCommandReference(character).includes(key));
  const matched = directMatches.length === 1
    ? directMatches[0]
    : romanizedMatches.length === 1
      ? romanizedMatches[0]
      : undefined;
  return matched?.name?.trim() || characterId;
}

function preferredSceneCharacterName(sceneCharacters: string[] = [], characters: CharacterCandidate[]): string | undefined {
  const sceneName = sceneCharacters
    .map((item) => item.trim())
    .find((item) => item && !isLikelyMinorCharacterName(item))
    ?? sceneCharacters.map((item) => item.trim()).find(Boolean);
  if (sceneName) {
    const displayName = characterDisplayName(sceneName, characters).trim();
    return displayName || sceneName;
  }
  return characters.find((character) => {
    const directKeys = [character.character_id, character.name, ...character.aliases];
    return directKeys.some(isProtagonistPlaceholder) || /主角|主人公/.test(character.description);
  })?.name?.trim();
}

function buildSceneCharacterFallbacks(adapted: AdaptedScene, characters: CharacterCandidate[], sceneCharacters: string[] = []): Map<string, string> {
  const ids = new Set<string>();
  for (const command of adapted.scene_beat.commands) {
    if (command.type === "dialog" || command.type === "sprite") ids.add(command.character_id);
  }
  const fallback = preferredSceneCharacterName(sceneCharacters, characters);
  const fallbacks = new Map<string, string>();
  if (fallback) {
    for (const id of ids) {
      if (isProtagonistPlaceholder(id)) fallbacks.set(id, fallback);
    }
  }
  const singleCharacterFallback = sceneCharacters.map((item) => item.trim()).find(Boolean);
  if (ids.size === 1 && singleCharacterFallback) {
    const [onlyId] = [...ids];
    if (!fallbacks.has(onlyId)) fallbacks.set(onlyId, singleCharacterFallback);
  }
  return fallbacks;
}

function applyCharacterDisplayNames(adapted: AdaptedScene, characters: CharacterCandidate[], sceneCharacters: string[] = []): AdaptedScene {
  const fallbackNames = buildSceneCharacterFallbacks(adapted, characters, sceneCharacters);
  return {
    ...adapted,
    scene_beat: {
      ...adapted.scene_beat,
      commands: adapted.scene_beat.commands.map((command) => {
        if (command.type === "dialog" || command.type === "sprite") {
          const fromRegistry = characterDisplayName(command.character_id, characters);
          return { ...command, character_id: fromRegistry === command.character_id ? fallbackNames.get(command.character_id) ?? fromRegistry : fromRegistry };
        }
        return command;
      }),
    },
  };
}

function sceneIdBase(value: string | undefined | null, fallback: string): string {
  const normalized = (value?.trim() || fallback).replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 80) || fallback;
}

function nextUniqueSceneId(preferred: string | undefined | null, usedSceneIds: Set<string>, fallback: string): string {
  const base = sceneIdBase(preferred, fallback);
  let candidate = base;
  let index = 2;
  while (usedSceneIds.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, Math.max(1, 96 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedSceneIds.add(candidate);
  return candidate;
}

function remapSceneChoiceTargets(commands: AdaptedScene["scene_beat"]["commands"], fromSceneId: string, toSceneId: string): AdaptedScene["scene_beat"]["commands"] {
  if (!fromSceneId || fromSceneId === toSceneId) return commands;
  return commands.map((command) => {
    if (command.type === "conditional_jump") {
      return {
        ...command,
        target_scene_id: command.target_scene_id === fromSceneId ? toSceneId : command.target_scene_id,
        else_target_scene_id: command.else_target_scene_id === fromSceneId ? toSceneId : command.else_target_scene_id,
      };
    }
    if (command.type !== "choice") return command;
    return {
      ...command,
      choices: command.choices.map((choice) => choice.target_scene_id === fromSceneId ? { ...choice, target_scene_id: toSceneId } : choice),
    };
  });
}

function collectUsedSceneIds(adaptedScenes: AdaptedScene[] = []): Set<string> {
  const editorSceneIds = useEditorStore.getState().nodes
    .map((node) => node.data.scene?.scene_id)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
  const adaptedSceneIds = adaptedScenes
    .map((scene) => scene.scene_beat.scene_id)
    .filter((sceneId): sceneId is string => Boolean(sceneId));
  return new Set([...editorSceneIds, ...adaptedSceneIds]);
}

interface SceneIdAliasIndex {
  aliases: Map<string, Set<string>>;
  labels: Map<string, string>;
}

function normalizeSceneAlias(value?: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function addSceneAlias(index: SceneIdAliasIndex, alias: string | undefined | null, sceneId: string): void {
  const key = normalizeSceneAlias(alias);
  if (!key || !sceneId) return;
  const matches = index.aliases.get(key) ?? new Set<string>();
  matches.add(sceneId);
  index.aliases.set(key, matches);
}

function sceneDisplayLabel(scene?: AdaptedScene["scene_beat"], fallback?: string): string {
  return scene?.scene_display_name?.trim() || scene?.title?.trim() || fallback || "";
}

function buildSceneIdAliasIndex(scenes: SceneCandidate[], adaptedScenes: AdaptedScene[]): SceneIdAliasIndex {
  const index: SceneIdAliasIndex = { aliases: new Map(), labels: new Map() };
  const candidatesById = new Map(scenes.map((scene) => [scene.scene_candidate_id, scene]));

  for (const adapted of adaptedScenes) {
    const finalSceneId = adapted.scene_beat.scene_id;
    if (!finalSceneId) continue;
    const candidate = candidatesById.get(adapted.source_scene_candidate_id);
    index.labels.set(finalSceneId, sceneDisplayLabel(adapted.scene_beat, candidate?.display_name ?? candidate?.title));
    for (const alias of [
      finalSceneId,
      adapted.source_scene_candidate_id,
      adapted.scene_beat.title,
      adapted.scene_beat.scene_display_name,
      candidate?.title,
      candidate?.display_name,
    ]) {
      addSceneAlias(index, alias, finalSceneId);
    }
  }

  for (const node of useEditorStore.getState().nodes) {
    const scene = node.data.scene;
    if (!scene?.scene_id) continue;
    index.labels.set(scene.scene_id, sceneDisplayLabel(scene, node.data.label));
    addSceneAlias(index, scene.scene_id, scene.scene_id);
    addSceneAlias(index, scene.title, scene.scene_id);
    addSceneAlias(index, scene.scene_display_name, scene.scene_id);
    addSceneAlias(index, node.data.label, scene.scene_id);
  }

  return index;
}

function resolveSceneAlias(index: SceneIdAliasIndex, value?: string | null): string | undefined {
  const key = normalizeSceneAlias(value);
  if (!key) return undefined;
  const matches = index.aliases.get(key);
  if (!matches || matches.size !== 1) return undefined;
  return [...matches][0];
}

function resolveBranchSuggestions(input: {
  suggestions: BranchSuggestion[];
  scenes: SceneCandidate[];
  adaptedScenes: AdaptedScene[];
}): { suggestions: BranchSuggestion[]; warnings: string[] } {
  const index = buildSceneIdAliasIndex(input.scenes, input.adaptedScenes);
  const warnings: string[] = [];
  const resolved: BranchSuggestion[] = [];
  const seenSuggestionIds = new Set<string>();

  for (const suggestion of input.suggestions) {
    if (seenSuggestionIds.has(suggestion.suggestion_id)) {
      warnings.push(`已跳过重复的联想节点 "${suggestion.suggestion_id}"。`);
      continue;
    }
    seenSuggestionIds.add(suggestion.suggestion_id);

    if (suggestion.confidence < 0.6) {
      warnings.push(`已跳过低置信度联想节点 "${suggestion.suggestion_id}"（confidence=${suggestion.confidence}）。`);
      continue;
    }

    const sourceSceneId =
      resolveSceneAlias(index, suggestion.source_scene_id) ??
      resolveSceneAlias(index, suggestion.source_scene_display_name);
    if (!sourceSceneId) {
      warnings.push(`已跳过无法解析来源场景的联想节点 "${suggestion.suggestion_id}"：source_scene_id=${suggestion.source_scene_id || "(空)"}。`);
      continue;
    }

    resolved.push({
      ...suggestion,
      source_scene_id: sourceSceneId,
      source_scene_display_name: suggestion.source_scene_display_name ?? index.labels.get(sourceSceneId),
      enabled_by_default: false,
    });
  }

  return { suggestions: resolved, warnings };
}

function ensureUniqueImportedSceneId(adapted: AdaptedScene, usedSceneIds: Set<string>, fallbackSeed: string): AdaptedScene {
  const previousSceneId = adapted.scene_beat.scene_id;
  const fallback = `novel_scene_${fallbackSeed.replace(/[^A-Za-z0-9_-]/g, "_") || nanoid(8)}`;
  const sceneId = nextUniqueSceneId(previousSceneId, usedSceneIds, fallback);
  if (sceneId === previousSceneId) return adapted;
  const scene = {
    ...adapted.scene_beat,
    scene_id: sceneId,
    commands: remapSceneChoiceTargets(adapted.scene_beat.commands, previousSceneId, sceneId),
  };
  return {
    ...adapted,
    scene_beat: scene,
    source_mapping: updateSourceMappingAfterEdit(adapted.source_mapping, scene),
    warnings: [
      ...adapted.warnings,
      `Novel import renamed duplicate or invalid scene_id "${previousSceneId || fallbackSeed}" to "${sceneId}" before writing the graph.`,
    ],
  };
}

function remapBranchSuggestionSourceSceneIds(suggestions: BranchSuggestion[], fromSceneId: string, toSceneId: string): BranchSuggestion[] {
  if (!fromSceneId || fromSceneId === toSceneId) return suggestions;
  return suggestions.map((suggestion) => suggestion.source_scene_id === fromSceneId ? { ...suggestion, source_scene_id: toSceneId } : suggestion);
}

function remapAssetSuggestionSourceSceneIds(
  suggestions: AssetSuggestion[],
  fromSceneIds: string[],
  toSceneId: string,
  displayName?: string | null,
): AssetSuggestion[] {
  const sources = new Set(fromSceneIds.filter(Boolean));
  return suggestions.map((suggestion) => sources.has(suggestion.source_scene_id)
    ? { ...suggestion, source_scene_id: toSceneId, source_scene_display_name: suggestion.source_scene_display_name ?? displayName ?? undefined }
    : suggestion);
}

function buildLayout(sessionId: string, existingJob?: ProgressiveImportJob): NovelImportLayout {
  const editor = useEditorStore.getState();
  const blank = isBlankMainLine();
  const base = createNovelImportLayout(editor.nodes, sessionId);
  if (existingJob?.layoutStartPosition) {
    return {
      ...base,
      importLineId: existingJob.importLineId,
      startPosition: existingJob.layoutStartPosition,
      columnGap: existingJob.layoutColumnGap ?? base.columnGap,
      rowGap: existingJob.layoutRowGap ?? base.rowGap,
      columns: existingJob.layoutColumns ?? base.columns,
    };
  }
  return {
    ...base,
    importLineId: existingJob?.importLineId ?? base.importLineId,
    startPosition: blank ? { x: (editor.nodes[0]?.position?.x ?? 40) + 360, y: editor.nodes[0]?.position?.y ?? 220 } : base.startPosition,
  };
}

const playerVisibleDiagnosticPattern = /章节原文缺失|原文内容缺失|原文缺失|原文不可用|原文未提供|未返回结构化\s*scenes|fallback\s*scene|待复核的\s*subagent\s*输出|source text is incomplete|source is incomplete/i;

function safeProcessResultText(result: { resultText: string; summary: string; chapterTitle: string; chunkIndex: number }): string {
  const candidate = (result.resultText || result.summary).trim();
  if (candidate && !playerVisibleDiagnosticPattern.test(candidate)) return candidate;
  const title = result.chapterTitle ? `${result.chapterTitle} ` : "";
  return `${title}第 ${result.chunkIndex + 1} 个切片需要作者复核后写入正式剧情。`;
}

function fallbackSceneFromProcessResult(result: { chunkId: string; chapterTitle: string; chapterIndex: number; chunkIndex: number; resultText: string; summary: string }): SceneBeat {
  const text = safeProcessResultText(result);
  return {
    scene_id: `process_${result.chunkId}`,
    scene_display_name: result.chapterTitle ? `${result.chapterTitle} · 切片 ${result.chunkIndex + 1}` : `切片 ${result.chunkIndex + 1}`,
    title: result.chapterTitle ? `${result.chapterTitle} · 切片 ${result.chunkIndex + 1}` : `导入切片 ${result.chunkIndex + 1}`,
    summary: result.summary || text.slice(0, 180),
    chapter: result.chapterIndex,
    tags: ["novel_process", "needs_review"],
    commands: [{ type: "narration", text: text.slice(0, 1200) }],
  };
}

function adaptedFromProcessScene(scene: SceneBeat, input: { chunkId: string; resultText: string; summary: string; usedFallbackScene?: boolean; qualityWarnings?: string[]; warnings?: string[] }): AdaptedScene {
  const qualityWarnings = [
    ...(scene.tags.includes("needs_review") ? ["该场景由非结构化切片结果生成，请作者复核后再发布。"] : []),
    ...(input.usedFallbackScene ? ["该切片未返回结构化场景，当前结果仅供作者复核。"] : []),
    ...(input.qualityWarnings ?? []),
    ...(input.warnings ?? []),
  ];
  return {
    adapted_scene_id: `adapted_${scene.scene_id}`,
    source_scene_candidate_id: input.chunkId,
    scene_beat: scene,
    source_mapping: {
      document_id: input.chunkId,
      start_offset: 0,
      end_offset: input.resultText.length,
      source_excerpt: input.summary || input.resultText.slice(0, 400),
      adapted_command_ids: scene.commands.map((_, index) => `cmd_${index + 1}`),
    },
    warnings: [...new Set(qualityWarnings)],
    needs_review: qualityWarnings.length > 0,
  };
}

function applyLinkPolishPatchToScene(scene: SceneBeat, patch: { choiceId: string; choiceText: string; choiceDisplayName?: string | null; targetSceneId: string; targetTitle: string; targetSummary: string; openingText?: string | null }): SceneBeat {
  const commands = scene.commands.map((command) => {
    if (command.type !== "choice") return command;
    return {
      ...command,
      choices: command.choices.map((choice) => (
        choice.choice_id === patch.choiceId
          ? { ...choice, text: patch.choiceText, choice_display_name: patch.choiceDisplayName ?? choice.choice_display_name }
          : choice
      )),
    };
  });
  if (scene.scene_id !== patch.targetSceneId) return { ...scene, commands };
  const targetCommands = [...commands];
  const firstTextIndex = targetCommands.findIndex((command) => command.type === "narration" || command.type === "dialog");
  if (patch.openingText && firstTextIndex >= 0) {
    const command = targetCommands[firstTextIndex];
    targetCommands[firstTextIndex] = { ...command, text: patch.openingText } as typeof command;
  }
  return {
    ...scene,
    title: patch.targetTitle,
    scene_display_name: patch.targetTitle,
    summary: patch.targetSummary,
    commands: targetCommands,
  };
}

async function polishProcessScenes(scenes: SceneBeat[], providerSelection?: ProviderSelectionPayload): Promise<{ scenes: SceneBeat[]; warnings: string[] }> {
  const byId = new Map(scenes.map((scene) => [scene.scene_id, scene]));
  const links = scenes.flatMap((sourceScene) => sourceScene.commands.flatMap((command) => {
    if (command.type !== "choice") return [];
    return command.choices.flatMap((choice) => {
      const targetScene = byId.get(choice.target_scene_id);
      if (!targetScene) return [];
      return [{
        sourceScene,
        targetScene,
        choiceId: choice.choice_id,
        choiceText: choice.text,
        choiceDisplayName: choice.choice_display_name,
      }];
    });
  }));
  if (links.length === 0) return { scenes, warnings: [] };
  const response = await backendClient.polishNovelProcessLinks({ links, providerSelection });
  let nextScenes = scenes;
  for (const patch of response.patches) {
    nextScenes = nextScenes.map((scene) => applyLinkPolishPatchToScene(scene, patch));
  }
  return { scenes: nextScenes, warnings: response.warnings.concat(response.patches.flatMap((patch) => patch.warnings ?? [])) };
}

function materializeBranchSuggestions(input: {
  importLineId: string;
  suggestions: BranchSuggestion[];
  memoryMode: ImportOptions["memory_mode"];
}): number {
  const grouped = new Map<string, BranchSuggestion[]>();
  for (const suggestion of input.suggestions) {
    if (suggestion.enabled_by_default || suggestion.confidence < 0.6) continue;
    const list = grouped.get(suggestion.source_scene_id) ?? [];
    list.push(suggestion);
    grouped.set(suggestion.source_scene_id, list);
  }
  if (grouped.size === 0) return 0;

  let created = 0;
  const createdNodeIds: string[] = [];
  useEditorStore.getState().recordGraphHistory();
  useEditorStore.setState((editor) => {
    const nodes = [...editor.nodes];
    const edges = [...editor.edges];
    const nodesBySceneId = new Map(nodes.filter((node) => node.data.scene).map((node) => [node.data.scene!.scene_id, node]));
    const nextNodes: EditorNode[] = [];
    const nextEdges: EditorEdge[] = [];

    for (const [sourceSceneId, suggestions] of grouped) {
      const sourceNode = nodesBySceneId.get(sourceSceneId);
      if (!sourceNode) continue;
      const alreadyMaterialized = nodes.some((node) => node.data.editorMeta?.importLineId === input.importLineId && node.data.editorMeta?.debugNotes === `branch_source:${sourceNode.id}`);
      if (alreadyMaterialized) continue;

      const defaultEdge = edges.find((edge) => edge.source === sourceNode.id && (!edge.sourceHandle || edge.sourceHandle === "default"));
      const nextNode = defaultEdge ? nodes.find((node) => node.id === defaultEdge.target) : undefined;
      const choiceId = `choice_import_${nanoid(8)}`;
      const x = sourceNode.position.x + 340;
      const y = sourceNode.position.y + 40;
      const choiceNode: EditorNode = {
        id: choiceId,
        type: "choiceNode",
        position: { x, y },
        data: {
          nodeKind: "choice",
          label: "AI 推测分支",
          description: "小说导入时根据冲突点生成的分支入口。主线会继续原文顺序，其他选项供作者继续开发。",
          memoryMode: input.memoryMode,
          aiSettings: { authorGoal: "继续扩写导入的剧情分支。", generationOutline: "", autoExtractMemory: false, autoApplyMemory: false },
          previewState: { currentCommandIndex: 0, isPlaying: false },
          editorMeta: {
            collapsedInspectorSections: [],
            source: "imported",
            importLineId: input.importLineId,
            debugNotes: `branch_source:${sourceNode.id}`,
          },
          choice: {
            type: "choice",
            choices: [
              { choice_id: "mainline", choice_display_name: "继续原文主线", text: "继续原文主线", target_scene_id: "", conditions: [] },
              ...suggestions.map((suggestion, index) => ({
                choice_id: `branch_${index + 1}_${suggestion.suggestion_id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64),
                choice_display_name: suggestion.choice_display_name ?? "推测分支",
                text: suggestion.choice_text,
                target_scene_id: "",
                conditions: [],
              })),
            ],
          },
        },
      };
      nextNodes.push(choiceNode);
      createdNodeIds.push(choiceNode.id);
      nextEdges.push({ id: `novel_branch_edge_${input.importLineId}_${sourceNode.id}_choice`, source: sourceNode.id, target: choiceNode.id, sourceHandle: "default" });
      if (nextNode) {
        nextEdges.push({ id: `novel_branch_edge_${input.importLineId}_${choiceNode.id}_mainline`, source: choiceNode.id, target: nextNode.id, sourceHandle: "mainline" });
      }
      suggestions.forEach((suggestion, index) => {
        const branchNodeId = `node_import_branch_${nanoid(8)}`;
        const branchSceneId = `import_branch_${nanoid(8)}`;
        const branchHandle = choiceNode.data.choice!.choices[index + 1].choice_id;
        const branchNode: EditorNode = {
          id: branchNodeId,
          type: "sceneNode",
          position: { x: x + 340, y: y + (index + 1) * 220 },
          data: {
            nodeKind: "scene",
            label: suggestion.choice_display_name ?? "AI 推测分支",
            description: `${suggestion.branch_summary}\n\nAI 推测分支，待作者继续开发。`,
            memoryMode: input.memoryMode,
            aiSettings: { authorGoal: suggestion.branch_summary, generationOutline: suggestion.branch_summary, autoExtractMemory: false, autoApplyMemory: false },
            previewState: { currentCommandIndex: 0, isPlaying: false },
            editorMeta: {
              collapsedInspectorSections: [],
              source: "imported",
              importLineId: input.importLineId,
              debugNotes: `branch_suggestion:${suggestion.suggestion_id}`,
              needsReview: true,
            },
            scene: {
              scene_id: branchSceneId,
              title: suggestion.choice_display_name ?? "AI 推测分支",
              summary: suggestion.branch_summary,
              commands: [{ type: "narration", text: `AI 推测分支占位：${suggestion.branch_summary}` }],
              tags: ["novel_import", "ai_branch_stub"],
              chapter: 0,
            },
          },
        };
        nextNodes.push(branchNode);
        createdNodeIds.push(branchNode.id);
        nextEdges.push({ id: `novel_branch_edge_${input.importLineId}_${choiceNode.id}_${branchNode.id}`, source: choiceNode.id, target: branchNode.id, sourceHandle: branchHandle });
      });
      if (defaultEdge) {
        const edgeIndex = edges.findIndex((edge) => edge.id === defaultEdge.id);
        if (edgeIndex >= 0) edges.splice(edgeIndex, 1);
      }
      created += 1;
    }

    if (nextNodes.length === 0) return {};
    return { nodes: [...nodes, ...nextNodes], edges: [...edges, ...nextEdges], dirty: true };
  });
  if (createdNodeIds.length > 0) useEditorStore.getState().declutterNodesAround(createdNodeIds);
  return created;
}

export function getNovelImportModelStatus(): NovelImportModelStatus {
  const selection = getNovelProviderSelectionPayload();
  const budget = getAvailableInputTokens(selection);
  return {
    configured: Boolean(selection),
    label: selection ? `${selection.connection_id} / ${selection.model_id}` : "未配置文本生成模型",
    contextBudget: budget.budget,
    availableInputBudget: budget.available,
    reservedBudget: budget.reserved,
  };
}

export const useNovelImportStore = create<NovelImportStore>((set, get) => ({
  session: createEmptySession(),
  pendingImport: undefined,
  modelStream: createEmptyModelStream(),
  inspectableResults: [],
  errors: [],
  warnings: [],
  splitDiagnostic: { status: "idle" },
  jobCreation: { status: "idle" },
  processing: loadNovelProcessingState(),
  persistence: createEmptyNovelPersistenceState(),
  scanRetries: 0,
  isProcessing: false,

  toggleModelStream: () => set((state) => ({ modelStream: { ...state.modelStream, open: !state.modelStream.open } })),
  hydratePersistence: (persistence) => {
    if (!persistence) {
      clearModelStreamDeltaQueue();
      clearNovelProcessingState();
      const emptyPersistence = createEmptyNovelPersistenceState();
      set({
        session: createEmptySession(),
        pendingImport: undefined,
        importJob: undefined,
        progress: undefined,
        modelStream: createEmptyModelStream(),
        inspectableResults: [],
        errors: [],
        warnings: [],
        splitDiagnostic: { status: "idle" },
        jobCreation: { status: "idle" },
        processing: createEmptyNovelProcessingState(),
        persistence: emptyPersistence,
        scanRetries: 0,
        isProcessing: false,
      });
      return;
    }
    const restored = recoverNovelPersistenceState(normalizeNovelPersistenceState(persistence));
    const processing = restored.processingSnapshot
      ? createEmptyNovelProcessingState(restored.processingSnapshot)
      : createEmptyNovelProcessingState();
    const importJob = restored.importJobSnapshot?.status === "running"
      ? { ...restored.importJobSnapshot, status: "paused" as const, pauseRequested: false, cancelRequested: false }
      : restored.importJobSnapshot;
    persistNovelProcessingState(processing);
    set({
      session: restored.sessionSnapshot ?? createEmptySession(),
      pendingImport: undefined,
      importJob,
      progress: undefined,
      modelStream: createEmptyModelStream(),
      processing,
      persistence: restored,
      inspectableResults: restored.inspectableResults,
      errors: restored.errors,
      warnings: restored.warnings,
      splitDiagnostic: { status: "idle" },
      jobCreation: { status: "idle" },
      isProcessing: false,
    });
  },

  exportResults: (format, completedOnly = false) => buildNovelResultExport(get().persistence, format, { completedOnly, includeAppendix: true }),

  retryChunkResult: async (chunkId) => {
    const state = get();
    const task = state.processing.tasks.find((item) => item.chunkId === chunkId);
    if (task) get().retryNovelAgentTask(task.agentTaskId);
    else if (state.session.chunks.some((chunk) => chunk.chunk_id === chunkId)) {
      set((current) => ({
        session: touch({
          ...current.session,
          ai_chunk_analyses: current.session.ai_chunk_analyses.filter((analysis) => analysis.chunk_id !== chunkId),
        }),
        warnings: [...current.warnings, "已将该扫描 chunk 置回待处理；继续 AI 解析时会跳过已完成 chunk，只重跑缺失项。"],
      }));
      await get().startAiAnalysis();
    }
  },

  retryFailedItems: async () => {
    get().retryFailedNovelAgentTasks();
    const hasFailedScanChunk = Object.values(get().persistence.chunkResults).some((result) =>
      (result.status === "failed" || result.status === "timeout_suspected") &&
      get().session.chunks.some((chunk) => chunk.chunk_id === result.chunkId)
    );
    if (hasFailedScanChunk) await get().startAiAnalysis();
  },

  updateImportOptions: (options) => set((state) => ({
    session: touch({ ...state.session, import_options: { ...state.session.import_options, ...options } }),
  })),

  resetSession: () => {
    clearModelStreamDeltaQueue();
    clearNovelProcessingState();
    set({
      session: createEmptySession(),
      pendingImport: undefined,
      importJob: undefined,
      progress: undefined,
      modelStream: createEmptyModelStream(),
      inspectableResults: [],
      errors: [],
      warnings: [],
      splitDiagnostic: { status: "idle" },
      jobCreation: { status: "idle" },
      processing: createEmptyNovelProcessingState(),
      persistence: createEmptyNovelPersistenceState(),
      scanRetries: 0,
      isProcessing: false,
    });
  },

  importFile: async (file) => {
    if (get().isProcessing) return;
    clearModelStreamDeltaQueue();
    set({
      isProcessing: true,
      errors: [],
      splitDiagnostic: { status: "idle" },
      jobCreation: { status: "idle" },
      progress: createProgressState({
        phase: "import",
        current: 0,
        total: 1,
        message: "正在分析小说文件",
        detail: `正在分析 ${file.name} 的格式、编码、文本规模和章节结构。`,
        cancellable: false,
      }),
    });
    try {
      const pendingImport = await analyzeNovelFile(file, get().session.import_options.language);
      const sameNameDifferentHash = findSameNameDifferentHash(get().persistence, pendingImport.document);
      const reusableBook = findReusableBookByHash(get().persistence, pendingImport.document);
      const reusableSession = reusableBook && get().persistence.sessionSnapshot?.document?.document_id === reusableBook.bookId
        ? get().persistence.sessionSnapshot
        : undefined;
      if (sameNameDifferentHash) {
        const warning = `检测到同名文件 "${pendingImport.document.file_name}" 的内容 hash 已变化；不会复用上次章节拆分，请重新拆分。`;
        set((state) => ({ warnings: [...state.warnings, warning] }));
        if (typeof window !== "undefined") window.alert(warning);
      }
      if (reusableBook && reusableSession?.document && !sameNameDifferentHash) {
        const shouldReuse = typeof window === "undefined"
          ? true
          : window.confirm(`检测到相同文件 hash，可复用《${reusableBook.title}》上次章节拆分和已完成结果。是否恢复？`);
        if (shouldReuse) {
          const sourcePaths = Array.from(new Set([
            ...(reusableSession.document.source_paths ?? []),
            ...(pendingImport.document.source_paths ?? []),
            pendingImport.document.original_path ?? pendingImport.document.file_name,
          ].filter(Boolean)));
          const restoredSession = touch({
            ...reusableSession,
            document: {
              ...reusableSession.document,
              file_name: pendingImport.document.file_name,
              file_hash: pendingImport.document.file_hash,
              file_size: pendingImport.document.file_size,
              original_path: pendingImport.document.original_path,
              source_paths: sourcePaths,
              metadata: {
                ...reusableSession.document.metadata,
                ...pendingImport.document.metadata,
                reused_from_book_id: reusableBook.bookId,
              },
            },
          });
          set({
            pendingImport: undefined,
            session: restoredSession,
            inspectableResults: get().persistence.inspectableResults,
            processing: get().persistence.processingSnapshot ? createEmptyNovelProcessingState(get().persistence.processingSnapshot) : get().processing,
            errors: [],
            warnings: [`已复用相同 hash 的上次章节拆分和已完成结果：${reusableBook.title}`],
            progress: undefined,
            isProcessing: false,
          });
          return;
        }
      }
      set({
        pendingImport,
        inspectableResults: [],
        progress: undefined,
        isProcessing: false,
      });
    } catch (error) {
      const summary = reportNovelImportError({
        phase: "小说文件读取",
        error,
        session: get().session,
        progress: get().progress,
        activeDetail: `正在读取 ${file.name}`,
      });
      set((state) => ({ errors: [...state.errors, summary], progress: undefined, isProcessing: false }));
    }
  },

  confirmDirectImport: () => set((state) => {
    const pending = state.pendingImport;
    if (!pending) return {};
    if (pending.preflight.recommended_action === "split_required") {
      return {
        errors: [...state.errors, "当前文件超过直接处理上限，必须先拆分，不能整本直接处理。"],
        progress: undefined,
        isProcessing: false,
      };
    }
    const importRecord = createBookImportRecord(pending.document, pending.preflight, "direct");
    const chunks = chunkDocumentText(pending.document.document_id, pending.document.normalized_text, state.session.import_options);
    clearNovelProcessingState();
    return {
      pendingImport: undefined,
      session: resetSessionForCommittedImport(state.session, pending.document, importRecord, chunks, "imported"),
      importJob: undefined,
      inspectableResults: [],
      processing: createEmptyNovelProcessingState(),
      errors: [],
      warnings: pending.preflight.encoding_warning ? [pending.preflight.encoding_warning] : [],
      progress: undefined,
      isProcessing: false,
    };
  }),

  startChapterSplitImport: async () => {
    const pending = get().pendingImport;
    if (!pending || get().isProcessing) return;
    const importRecord = createBookImportRecord(pending.document, pending.preflight, "chapter_split");
    set((state) => ({
      progress: createProgressState({
        phase: "import",
        current: 0,
        total: pending.document.normalized_text.length || 1,
        message: "正在进行本地章节拆分",
        detail: pending.document.file_name,
        cancellable: false,
      }, state.progress),
      isProcessing: true,
      errors: [],
      splitDiagnostic: { status: "started", startedAt: new Date().toISOString() },
    }));
    try {
      const { chapters, report } = await splitNovelChaptersAsync(pending.document.normalized_text, {
        bookId: deriveBookId({ documentId: pending.document.document_id, sessionId: get().session.session_id }),
        fileType: pending.document.file_type,
        metadata: pending.document.metadata,
        onProgress: (progress) => {
          set((state) => ({
            progress: createProgressState({
              phase: "import",
              current: progress.current,
              total: progress.total,
              message: progress.message,
              detail: pending.document.file_name,
              cancellable: false,
            }, state.progress),
          }));
        },
      });
      const chunks = chunkDocumentText(pending.document.document_id, pending.document.normalized_text, get().session.import_options, chapters);
      const baseSession = resetSessionForCommittedImport(get().session, pending.document, importRecord, chunks, "chapters_split");
      const processing = buildProcessingStateForChapters({
        document: pending.document,
        sessionId: baseSession.session_id,
        chapters,
        previous: get().processing,
      });
      persistNovelProcessingState(processing);
      set((state) => ({
        pendingImport: undefined,
        session: touch({ ...baseSession, chapters, chunks, chapter_split_report: report }),
        importJob: undefined,
        inspectableResults: [],
        processing,
        errors: [],
        splitDiagnostic: {
          status: "completed",
          startedAt: get().splitDiagnostic.startedAt,
          completedAt: new Date().toISOString(),
          chapterCount: chapters.length,
        },
        warnings: [
          ...(pending.preflight.encoding_warning ? [pending.preflight.encoding_warning] : []),
          report.needsHumanConfirmation
            ? `本地章节拆分完成：${chapters.length} 个章节，需要人工确认低置信度或异常章节。`
            : `本地章节拆分完成：${chapters.length} 个章节，可进入章节预览和勾选。`,
          ...state.warnings.filter((warning) => !warning.includes("本地章节拆分完成")),
        ],
        progress: undefined,
        isProcessing: false,
      }));
    } catch (error) {
      const summary = reportNovelImportError({
        phase: "本地章节拆分",
        error,
        session: get().session,
        progress: get().progress,
        activeDetail: `正在拆分 ${pending.document.file_name}`,
      });
      set((state) => ({
        errors: [...state.errors, summary],
        splitDiagnostic: {
          status: "failed",
          startedAt: state.splitDiagnostic.startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: summary,
        },
        progress: undefined,
        isProcessing: false,
      }));
    }
  },

  cancelPendingImport: () => set({
    pendingImport: undefined,
    progress: undefined,
    isProcessing: false,
  }),

  updateDocumentText: (text) => set((state) => {
    const document = state.session.document;
    if (!document) return {};
    const normalized = normalizeText(text);
    const nextDocument = { ...document, normalized_text: normalized, total_chars: normalized.length };
    const chunks = shouldRefreshChunksImmediatelyAfterEdit(normalized)
      ? chunkDocumentText(nextDocument.document_id, normalized, state.session.import_options)
      : [];
    clearNovelProcessingState();
    return {
      session: touch({
        ...state.session,
        document: nextDocument,
        chunks,
        ai_stage: "landing",
        ai_chunk_analyses: [],
        scan_partials: {},
        outline_partials: {},
        planned_chapter_ids: [],
        validation_reports: [],
        quality_report: undefined,
        quality_risk_accepted: false,
        ai_outline: undefined,
        chapters: [],
        chapter_split_report: undefined,
        scenes: [],
        characters: [],
        character_candidates_review: [],
        adapted_scenes: [],
        asset_suggestions: [],
        branch_suggestions: [],
        conflict_points: [],
      }),
      inspectableResults: [],
      processing: createEmptyNovelProcessingState(),
    };
  }),

  splitChapters: async () => {
    const state = get();
    const document = state.session.document;
    if (!document) {
      set((current) => ({ errors: [...current.errors, "请先导入小说文本。"] }));
      return;
    }
    if (state.isProcessing) return;
    set((current) => ({
      progress: createProgressState({
        phase: "import",
        current: 0,
        total: document.normalized_text.length || 1,
        message: "正在重新拆分章节",
        detail: document.file_name,
        cancellable: false,
      }, current.progress),
      isProcessing: true,
      errors: [],
      splitDiagnostic: { status: "started", startedAt: new Date().toISOString() },
    }));
    try {
      const { chapters, report } = await splitNovelChaptersAsync(document.normalized_text, {
        bookId: deriveBookId({ documentId: document.document_id, sessionId: get().session.session_id }),
        fileType: document.file_type,
        metadata: document.metadata,
        onProgress: (progress) => {
          set((current) => ({
            progress: createProgressState({
              phase: "import",
              current: progress.current,
              total: progress.total,
              message: progress.message,
              detail: document.file_name,
              cancellable: false,
            }, current.progress),
          }));
        },
      });
      const chunks = chunkDocumentText(document.document_id, document.normalized_text, get().session.import_options, chapters);
      const processing = buildProcessingStateForChapters({
        document,
        sessionId: get().session.session_id,
        chapters,
        previous: get().processing,
      });
      persistNovelProcessingState(processing);
      set((current) => ({
        session: touch({ ...current.session, chapters, chunks, status: "chapters_split", chapter_split_report: report }),
        processing,
        warnings: [
          ...current.warnings,
          report.needsHumanConfirmation
            ? `本地章节拆分完成：${chapters.length} 个章节，需要人工确认。`
            : `本地章节拆分完成：${chapters.length} 个章节。`,
        ],
        progress: undefined,
        isProcessing: false,
        splitDiagnostic: {
          status: "completed",
          startedAt: get().splitDiagnostic.startedAt,
          completedAt: new Date().toISOString(),
          chapterCount: chapters.length,
        },
      }));
    } catch (error) {
      const summary = reportNovelImportError({
        phase: "本地章节拆分",
        error,
        session: get().session,
        progress: get().progress,
        activeDetail: `正在拆分 ${document.file_name}`,
      });
      set((current) => ({
        errors: [...current.errors, summary],
        splitDiagnostic: {
          status: "failed",
          startedAt: current.splitDiagnostic.startedAt,
          completedAt: new Date().toISOString(),
          errorMessage: summary,
        },
        progress: undefined,
        isProcessing: false,
      }));
    }
  },
  prepareChapterSelection: () => set((state) => {
    const document = state.session.document;
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    if (chapters.length === 0) return { errors: [...state.errors, document ? "请先完成本地章节拆分。" : "没有可选择的章节，请先导入小说或恢复已有任务。"] };
    const processing = syncProcessingChapters(state.processing, chapters);
    persistNovelProcessingState(processing);
    return {
      session: document && state.session.chapters.length === 0 ? touch({ ...state.session, chapters, status: "chapters_split" }) : state.session,
      processing,
    };
  }),
  toggleProcessingChapter: (chapterId) => set((state) => {
    const selected = new Set(state.processing.selectedChapterIds);
    if (selected.has(chapterId)) selected.delete(chapterId);
    else selected.add(chapterId);
    const processing = { ...state.processing, selectedChapterIds: [...selected], updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  selectAllProcessingChapters: () => set((state) => {
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const processing = { ...state.processing, selectedChapterIds: chapters.map((chapter) => chapter.chapter_id), updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  invertProcessingChapterSelection: () => set((state) => {
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const selected = new Set(state.processing.selectedChapterIds);
    const processing = {
      ...state.processing,
      selectedChapterIds: chapters.filter((chapter) => !selected.has(chapter.chapter_id)).map((chapter) => chapter.chapter_id),
      updatedAt: new Date().toISOString(),
    };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  selectProcessingVolume: (volumeLabel) => set((state) => {
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const processing = {
      ...state.processing,
      selectedChapterIds: chapters.filter((chapter) => getChapterVolumeLabel(chapter) === volumeLabel).map((chapter) => chapter.chapter_id),
      updatedAt: new Date().toISOString(),
    };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  selectOnlyUnprocessedChapters: () => set((state) => {
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const processing = {
      ...state.processing,
      selectedChapterIds: chapters
        .filter((chapter) => getChapterProcessStatus(chapter.chapter_id, state.processing) === "unprocessed")
        .map((chapter) => chapter.chapter_id),
      updatedAt: new Date().toISOString(),
    };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  selectOnlyFailedChapters: () => set((state) => {
    const chapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const processing = {
      ...state.processing,
      selectedChapterIds: chapters
        .filter((chapter) => getChapterProcessStatus(chapter.chapter_id, state.processing) === "failed")
        .map((chapter) => chapter.chapter_id),
      updatedAt: new Date().toISOString(),
    };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  clearProcessingChapterSelection: () => set((state) => {
    const processing = { ...state.processing, selectedChapterIds: [], updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing, jobCreation: { status: "idle" } };
  }),
  updateNovelProcessingConfig: (config) => set((state) => {
    const processing = { ...state.processing, config: sanitizeNovelProcessingConfig({ ...state.processing.config, ...config }), updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing };
  }),
  updateNovelProcessingDraft: (draft) => set((state) => {
    const processing = { ...state.processing, ...draft, updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing };
  }),
  createNovelProcessingJob: async (options) => {
    const state = get();
    if (state.jobCreation.status === "creating") return;
    const document = state.session.document;
    const existingChapters = state.session.chapters.length > 0 ? state.session.chapters : state.processing.chapterSnapshots;
    const chapters = existingChapters.length > 0
      ? existingChapters
      : document
        ? [createFullDocumentProcessingChapter(document)]
        : [];
    if (!document && chapters.length === 0) {
      const message = "没有可编排的章节；请先导入小说或恢复已有 job。";
      set({ errors: [...state.errors, message], jobCreation: { status: "failed", message } });
      return;
    }
    if (!document) {
      const message = "当前只恢复了任务快照，缺少原文，不能重新生成 chunk。已有任务仍可查看和重试。";
      set({ errors: [...state.errors, message], jobCreation: { status: "failed", message } });
      return;
    }
    const retainedSelectedChapterIds = state.processing.selectedChapterIds.filter((chapterId) => chapters.some((chapter) => chapter.chapter_id === chapterId));
    const selectedChapterIds = retainedSelectedChapterIds.length > 0
      ? retainedSelectedChapterIds
      : existingChapters.length === 0 && chapters.length === 1
        ? [chapters[0].chapter_id]
        : [];
    if (selectedChapterIds.length === 0) {
      const message = "请至少勾选一个章节。";
      set({ errors: [...state.errors, message], jobCreation: { status: "failed", message } });
      return;
    }
    const matchingJob = findMatchingNovelProcessJob(state.processing, selectedChapterIds);
    if (matchingJob && !options?.regenerate) {
      const message = `相同章节已存在任务 ${matchingJob.jobId}，未重复创建。请查看任务工作台；需要再次执行时使用“重新生成 chunk/task”。`;
      set({
        warnings: [...state.warnings, message],
        jobCreation: { status: "duplicate", message, jobId: matchingJob.jobId, chunkCount: matchingJob.totalChunks },
      });
      return;
    }
    if (options?.regenerate && isNovelProcessJobActive(matchingJob)) {
      const message = `任务 ${matchingJob?.jobId ?? ""} 仍在运行，不能同时重新生成。请先等待任务结束或在任务工作台中取消。`;
      set({
        warnings: [...state.warnings, message],
        jobCreation: { status: "duplicate", message, jobId: matchingJob?.jobId, chunkCount: matchingJob?.totalChunks },
      });
      return;
    }
    const providerSelection = getNovelProviderSelectionPayload();
    if (!providerSelection) {
      set({ jobCreation: { status: "failed", message: "请先在“模型/连接”中配置文本生成模型。" } });
      set({ errors: [...state.errors, "请先在“模型/连接”中配置文本生成模型，subagent 批处理需要真实后端模型。"] });
      return;
    }
    set({
      jobCreation: {
        status: "creating",
        message: options?.regenerate ? "正在重新生成 chunk 并创建任务…" : "正在创建任务…",
      },
    });
    const config = sanitizeNovelProcessingConfig(state.processing.config);
    const bookId = deriveBookId({ projectId: useProjectStore.getState().projectId, documentId: document.document_id, sessionId: state.session.session_id });
    const rawChunks = createChunksForSelectedChapters({
      bookId,
      documentText: document.normalized_text,
      chapters,
      selectedChapterIds,
      config,
    });
    const chapterById = new Map(chapters.map((chapter) => [chapter.chapter_id, chapter]));
    const apiChunks: NovelProcessChunkPayload[] = rawChunks.map((chunk) => {
      const chapter = chapterById.get(chunk.chapterId);
      return {
        chunkId: chunk.chunkId,
        chapterTitle: chapter?.title ?? "",
        chapterIndex: chapter?.index ?? 0,
        chunkIndex: chunk.indexInChapter,
        chunkText: document.normalized_text.slice(chunk.startOffset, chunk.endOffset),
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        previousContextSummary: chunk.overlapBefore.slice(-800),
        nextContextHint: chunk.overlapAfter.slice(0, 800),
      };
    });
    set({ warnings: [...state.warnings, `正在创建真实后端 subagent job：${rawChunks.length} 个 chunk，最大并发 ${config.maxConcurrency}。`] });
    try {
      set({
        jobCreation: {
          status: "creating",
          message: `正在创建任务：${rawChunks.length} 个 chunk，最大并发 ${config.maxConcurrency}…`,
          chunkCount: rawChunks.length,
        },
      });
      const apiJob = await backendClient.createNovelProcessJob({
        bookId,
        title: document.title || document.file_name || useProjectStore.getState().title,
        chunks: apiChunks,
        userInstruction: state.processing.userInstruction || "请把小说切片改写为可合并的 AgentVN 视觉小说场景草案。",
        outputFormat: state.processing.outputFormat || "visual_novel_blueprint",
        promptVersion: state.processing.promptVersion || "novel-process-v1",
        maxConcurrency: config.maxConcurrency,
        maxRetries: config.maxRetryCount,
        providerSelection,
      });
      const localJob = createNovelProcessJob({
        bookId,
        selectedChapterIds,
        chunks: rawChunks,
        config,
        userInstruction: state.processing.userInstruction,
        outputFormat: state.processing.outputFormat,
        promptVersion: state.processing.promptVersion,
      });
      const job = { ...localJob, jobId: apiJob.jobId };
      const chunks = initializeChunkDispatch(rawChunks, job);
      const tasks = createAgentTasksForJob({ job, chunks });
      const nextState = get();
      const processing = {
        ...nextState.processing,
        config,
        selectedChapterIds,
        chapterSnapshots: chapters,
        chunks,
        jobs: options?.regenerate ? [...nextState.processing.jobs.filter((item) => item.jobId !== matchingJob?.jobId), job] : [...nextState.processing.jobs, job],
        tasks: options?.regenerate ? [...nextState.processing.tasks.filter((task) => task.jobId !== matchingJob?.jobId), ...tasks] : [...nextState.processing.tasks, ...tasks],
        activeJobId: apiJob.jobId,
        updatedAt: new Date().toISOString(),
      };
      persistNovelProcessingState(processing);
      const projectId = useProjectStore.getState().projectId;
      const localPanelSnapshot = createMockNovelProcessSnapshot({
        projectId,
        projectTitle: useProjectStore.getState().title,
        session: nextState.session,
        importJob: nextState.importJob,
        progress: nextState.progress,
        errors: nextState.errors,
        warnings: nextState.warnings,
        inspectableResults: nextState.inspectableResults,
        isProcessing: nextState.isProcessing,
        processing,
      });
      if (localPanelSnapshot) persistNovelProcessTaskSnapshot(projectId, localPanelSnapshot);
      set({
        processing,
        jobCreation: {
          status: "created",
          message: `任务 ${apiJob.jobId} 已创建，${rawChunks.length} 个 chunk 已进入任务工作台。`,
          jobId: apiJob.jobId,
          chunkCount: rawChunks.length,
        },
      });
      const panelJob = await backendClient.getNovelProcessJob(apiJob.jobId);
      const events = await backendClient.getJobEvents(apiJob.jobId, 50);
      persistNovelProcessTaskSnapshot(projectId, { projectId, job: panelJob, events });
      const syncedProcessing = syncNovelProcessingFromPanelJob(processing, panelJob);
      if (syncedProcessing !== processing) persistNovelProcessingState(syncedProcessing);
      set({
        processing: syncedProcessing,
        jobCreation: {
          status: "created",
          message: `任务 ${apiJob.jobId} 已创建，${rawChunks.length} 个 chunk 已进入任务工作台。`,
          jobId: apiJob.jobId,
          chunkCount: rawChunks.length,
        },
        warnings: [...nextState.warnings, `真实后端 subagent job 已启动：${apiJob.jobId}，最大并发 ${config.maxConcurrency}。`],
      });
    } catch (error) {
      reportFrontendError("editor.novel-import", error, { operation: "create-processing-job" });
      const detail = error instanceof Error ? error.message : String(error);
      if (get().jobCreation.status === "created") {
        set((current) => ({ warnings: [...current.warnings, `任务已创建，但任务面板快照暂未读取成功：${detail}`] }));
        return;
      }
      const message = `创建真实后端 subagent job 失败：${detail}`;
      set((current) => ({
        errors: [...current.errors, message],
        jobCreation: { status: "failed", message },
      }));
    }
  },
  syncNovelProcessingJobStatus: (jobId, status) => set((state) => {
    const localStatus: NovelProcessJobStatus = status === "completed"
      ? "completed"
      : status === "cancelled"
        ? "cancelled"
        : status === "failed" || status === "failed_partial"
          ? "failed"
          : "processing";
    let changed = false;
    const jobs = state.processing.jobs.map((job) => {
      if (job.jobId !== jobId || job.status === localStatus) return job;
      changed = true;
      return { ...job, status: localStatus };
    });
    if (!changed) return {};
    const processing = { ...state.processing, jobs, updatedAt: new Date().toISOString() };
    persistNovelProcessingState(processing);
    return { processing };
  }),
  syncNovelProcessingJobSnapshot: (job) => set((state) => {
    const processing = syncNovelProcessingFromPanelJob(state.processing, job);
    if (processing === state.processing) return {};
    persistNovelProcessingState(processing);
    return { processing };
  }),
  retryNovelAgentTask: (agentTaskId) => set((state) => {
    const processing = retryAgentTaskInState(state.processing, agentTaskId);
    persistNovelProcessingState(processing);
    return { processing };
  }),
  retryFailedNovelAgentTasks: () => set((state) => {
    const processing = retryFailedAgentTasksInState(state.processing);
    persistNovelProcessingState(processing);
    return { processing };
  }),
  markNovelAgentTaskFailed: (agentTaskId, errorMessage) => set((state) => {
    const processing = markAgentTaskFailedInState(state.processing, agentTaskId, errorMessage);
    persistNovelProcessingState(processing);
    return { processing };
  }),
  setNovelChunkResult: (chunkId, result, tokenUsage) => set((state) => {
    const processing = setChunkResultInState(state.processing, chunkId, result, tokenUsage);
    persistNovelProcessingState(processing);
    return { processing };
  }),
  importNovelProcessJobResults: async (jobId) => {
    const providerSelection = getNovelProviderSelectionPayload();
    const existingImport = findExistingProcessJobImport(jobId);
    if (existingImport) return existingImport;
    try {
      const results = await backendClient.getNovelProcessJobResults(jobId);
      const sceneEntries = results.completedResults.flatMap((result) => {
        const resultScenes = result.scenes && result.scenes.length > 0
          ? result.scenes
          : [fallbackSceneFromProcessResult(result)];
        return resultScenes.map((scene) => ({ scene, result }));
      });
      const scenes = sceneEntries.map((entry) => entry.scene);
      if (scenes.length === 0) {
        set((current) => ({ errors: [...current.errors, "真实 subagent job 暂无可写入场景结果。"] }));
        return undefined;
      }
      const polished = await polishProcessScenes(scenes, providerSelection);
      const adaptedScenes = polished.scenes.map((scene, index) => {
        const sourceResult = sceneEntries[Math.min(index, sceneEntries.length - 1)].result;
        return adaptedFromProcessScene(scene, sourceResult);
      });
      const existingBeforeWrite = findExistingProcessJobImport(jobId);
      if (existingBeforeWrite) return existingBeforeWrite;
      const currentState = get();
      const graphImportMode = resolveNovelGraphImportMode();
      const layout = buildLayout(currentState.session.session_id);
      const memoryMode = currentState.session.import_options.memory_mode;
      const editor = useEditorStore.getState();
      const nodes = adaptedScenes.map((adapted, index) =>
        withNovelGraphMetadata(adaptedSceneToNode(adapted, layout, index, memoryMode), {
          mode: graphImportMode,
          sourceProcessJobId: jobId,
        })
      );
      const edges = importedNovelLineEdges(layout, nodes, graphImportMode);
      editor.recordGraphHistory();
      useEditorStore.setState((current) => {
        const base = graphBaseForImportMode(graphImportMode, current.nodes, current.edges);
        return {
          nodes: [...base.nodes, ...nodes],
          edges: [...base.edges, ...edges],
          dirty: true,
        };
      });
      for (const node of nodes) {
        editor.registerNewNodeEffect(node.id, "imported");
      }
      editor.declutterNodesAround(nodes.map((node) => node.id));
      const lastInsertedNodeId = nodes[nodes.length - 1]?.id;
      const importResult: NovelGraphImportResult = {
        lastInsertedNodeId,
        mode: graphImportMode,
        reusedExistingImport: false,
        notice: novelGraphImportNotice(graphImportMode, adaptedScenes.length),
        importedNodeIds: nodes.map((node) => node.id),
        importLineId: layout.importLineId,
      };
      set((current) => ({
        session: touch({
          ...current.session,
          adapted_scenes: [...current.session.adapted_scenes, ...adaptedScenes],
          ai_stage: "report",
          status: "imported_to_graph",
        }),
        importJob: current.importJob ? { ...current.importJob, status: "completed", generatedCount: adaptedScenes.length, lastInsertedNodeId, completedAt: new Date().toISOString(), graphImportMode } : current.importJob,
        warnings: [...current.warnings, ...results.warnings, ...polished.warnings, importResult.notice],
      }));
      return importResult;
    } catch (error) {
      reportFrontendError("editor.novel-import", error, { operation: "import-processing-results" });
      const detail = error instanceof Error ? error.message : String(error);
      set((current) => ({ errors: [...current.errors, `写入真实 subagent job 结果失败：${detail}`] }));
      return undefined;
    }
  },
  splitScenes: () => set({ errors: ["默认小说导入流程已改为真实大模型场景规划，请先确认 AI 大纲。"] }),
  extractCharacters: () => set({ errors: ["角色识别已由 AI 全文扫描生成，请在大纲确认页复核。"] }),

  updateChapter: (chapter) => get().updateOutlineChapter(chapter),
  updateOutlineChapter: (chapter) => set((state) => {
    const chapters = state.session.chapters.map((item) => item.chapter_id === chapter.chapter_id ? chapter : item);
    const processing = syncProcessingChapters(state.processing, chapters);
    persistNovelProcessingState(processing);
    return { session: touch({ ...state.session, chapters, ai_outline: state.session.ai_outline ? { ...state.session.ai_outline, chapters } : undefined }), processing };
  }),
  removeOutlineChapter: (chapterId) => set((state) => {
    const chapters = state.session.chapters.filter((chapter) => chapter.chapter_id !== chapterId).map((chapter, index) => ({ ...chapter, index }));
    const processing = syncProcessingChapters(state.processing, chapters);
    persistNovelProcessingState(processing);
    return { session: touch({ ...state.session, chapters, ai_outline: state.session.ai_outline ? { ...state.session.ai_outline, chapters } : undefined }), processing };
  }),
  updateSceneCandidate: (scene) => set((state) => ({
    session: touch({ ...state.session, scenes: state.session.scenes.map((item) => item.scene_candidate_id === scene.scene_candidate_id ? scene : item) }),
  })),
  updateCharacter: (character) => get().updateOutlineCharacter(character),
  updateOutlineCharacter: (character) => set((state) => {
    const characters = state.session.characters.map((item) => item.character_id === character.character_id ? character : item);
    const character_candidates_review = state.session.character_candidates_review?.map((review) =>
      review.character.character_id === character.character_id ? { ...review, character } : review
    );
    return { session: touch({ ...state.session, characters, character_candidates_review, ai_outline: state.session.ai_outline ? { ...state.session.ai_outline, characters } : undefined }) };
  }),
  promoteCharacterCandidate: (characterId) => set((state) => {
    const review = state.session.character_candidates_review?.find((item) => item.character.character_id === characterId);
    if (!review) return {};
    const characters = mergeCharacterCandidateList([...state.session.characters, review.character]);
    const character_candidates_review = state.session.character_candidates_review?.map((item) =>
      item.character.character_id === characterId ? { ...item, status: "promoted" as const } : item
    );
    return {
      session: touch({
        ...state.session,
        characters,
        character_candidates_review,
        ai_outline: state.session.ai_outline ? { ...state.session.ai_outline, characters } : undefined,
      }),
    };
  }),
  ignoreCharacterCandidate: (characterId) => set((state) => {
    const characters = state.session.characters.filter((character) => character.character_id !== characterId);
    const character_candidates_review = state.session.character_candidates_review?.map((item) =>
      item.character.character_id === characterId ? { ...item, status: "ignored" as const } : item
    );
    return {
      session: touch({
        ...state.session,
        characters,
        character_candidates_review,
        ai_outline: state.session.ai_outline ? { ...state.session.ai_outline, characters } : undefined,
      }),
    };
  }),
  updateAdaptedScene: (scene) => set((state) => ({
    session: touch({ ...state.session, adapted_scenes: state.session.adapted_scenes.map((item) => item.adapted_scene_id === scene.adapted_scene_id ? scene : item) }),
  })),

  startAiAnalysis: async () => {
    const state = get();
    const document = state.session.document;
    const providerSelection = getNovelProviderSelectionPayload();
    if (state.isProcessing) return;
    if (!document) {
      set({ errors: ["请先导入小说文本。"] });
      return;
    }
    if (state.session.import_record?.preflight.recommended_action === "split_required") {
      set({ errors: ["当前文件超过直接处理上限，必须先拆分，不能整本直接进入 AI 解析。"] });
      return;
    }
    if (document.normalized_text.length >= novelPreflightThresholds.max_direct_process_chars) {
      set({ errors: ["当前文本超过直接处理上限，必须先拆分，不能整本直接进入 AI 解析。"] });
      return;
    }
    if (state.session.status === "chapters_split") {
      set({ errors: ["当前已进入章节拆分预览入口，请先完成章节拆分后再启动后续处理。"] });
      return;
    }
    if (!providerSelection) {
      set({ errors: ["请先在“模型/连接”中配置文本生成模型，小说导入不会默认使用纯规则切分。"] });
      return;
    }

    if (state.session.ai_outline && state.session.ai_stage !== "scan") {
      set((current) => ({
        session: touch({ ...current.session, ai_stage: "outline", status: "outline_ready" }),
        progress: undefined,
        isProcessing: false,
      }));
      return;
    }

    const chunks = chunksMatchDocument(state.session.chunks, document)
      ? state.session.chunks
      : chunkDocumentText(document.document_id, document.normalized_text, state.session.import_options);
    const chunkIds = new Set(chunks.map((chunk) => chunk.chunk_id));
    const chunksById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]));
    const existingAnalyses = state.session.ai_chunk_analyses
      .filter((analysis) => chunkIds.has(analysis.chunk_id))
      .sort((a, b) => a.index - b.index);
    const existingScanPartials = Object.fromEntries(
      Object.entries(state.session.scan_partials).filter(([chunkId, partial]) => {
        const chunk = chunksById.get(chunkId);
        return Boolean(chunk && partialMatchesChunk(partial, chunk));
      })
    );
    const modelLabel = `${providerSelection.connection_id} / ${providerSelection.model_id}`;
    const budget = getAvailableInputTokens(providerSelection);
    set({
      isProcessing: true,
      errors: [],
      warnings: [`上下文预算：全文约 ${estimateTextTokens(document.normalized_text).toLocaleString()} tokens，可用输入约 ${budget.available.toLocaleString()} tokens；小说将分为 ${chunks.length} 个批次扫描。`],
      scanRetries: 0,
      progress: createProgressState({
        phase: "version",
        current: 0,
        total: chunks.length + 2,
        message: `当前模型：${modelLabel}`,
        detail: "正在确认后端小说 AI 接口版本。",
        cancellable: false,
      }),
      modelStream: { open: true, title: `当前模型：${modelLabel}`, status: "正在确认后端小说 AI 接口版本", responseText: "", traces: [], requestId: `version_${nanoid(8)}` },
      session: touch({ ...state.session, chunks, ai_chunk_analyses: existingAnalyses, scan_partials: existingScanPartials, validation_reports: [], quality_report: undefined, quality_risk_accepted: false, ai_outline: undefined, chapters: [], scenes: [], characters: [], character_candidates_review: [], asset_suggestions: [], branch_suggestions: [], conflict_points: [], ai_stage: "scan", status: "ai_scanning" }),
    });

    const analyses: NovelAiChunkAnalysis[] = [...existingAnalyses];
    let rollingSummary = existingAnalyses.map((analysis) => analysis.summary).join("\n").slice(-2400);
    let activeDetail = "正在确认后端小说 AI 接口版本";
    try {
      const versionCheckStartedAt = Date.now();
      await verifyNovelAiRoutes();
      set((current) => ({ progress: markProgressResponse(current.progress, versionCheckStartedAt) }));
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        if (analyses.some((analysis) => analysis.chunk_id === chunk.chunk_id)) {
          continue;
        }
        const streamRequestId = `scan_${chunk.chunk_id}_${nanoid(8)}`;
        clearModelStreamDeltaQueue();
        const savedPartial = get().session.scan_partials[chunk.chunk_id];
        const partial = partialMatchesChunk(savedPartial, chunk) ? savedPartial : {};
        activeDetail = `正在扫描文本块 ${index + 1}/${chunks.length}，chunk_id=${chunk.chunk_id}，offset=${chunk.start_offset}-${chunk.end_offset}`;
        set({
          progress: createProgressState({
            phase: "scan",
            current: index + 1,
            total: chunks.length + 2,
            message: `当前模型：${modelLabel}`,
            detail: `正在扫描文本块 ${index + 1}/${chunks.length}，offset ${chunk.start_offset}-${chunk.end_offset}。`,
            cancellable: false,
          }, get().progress),
          modelStream: {
            ...get().modelStream,
            open: true,
            title: `当前模型：${modelLabel}`,
            status: `正在扫描文本块 ${index + 1}/${chunks.length}`,
            responseText: appendModelTranscriptHeader(get().modelStream.responseText, `文本块 ${index + 1}/${chunks.length}`),
            traces: [],
            requestId: streamRequestId,
          },
        });
        const scanStartedAt = Date.now();
        const analysis = await aiScanNovelChunkStream({
          document_id: document.document_id,
          chunk_id: chunk.chunk_id,
          index: chunk.index,
          text: chunk.text,
          start_offset: chunk.start_offset,
          end_offset: chunk.end_offset,
          previous_summary: rollingSummary,
          partial_summary: partial.summary,
          partial_entities: partial.entities,
          partial_timeline: partial.timeline,
          provider_selection: providerSelection,
        }, {
          onDelta: (delta) => queueModelStreamDelta(set, streamRequestId, delta),
          onStatus: (status) => set((current) => current.modelStream.requestId === streamRequestId ? ({ modelStream: { ...current.modelStream, status }, progress: markProgressHeartbeat(current.progress) }) : {}),
          onTrace: (trace) => set((current) => current.modelStream.requestId === streamRequestId ? ({ modelStream: { ...current.modelStream, traces: [...current.modelStream.traces.slice(-14), trace] }, progress: markProgressHeartbeat(current.progress) }) : {}),
          onCheckpoint: (checkpoint) => applyScanCheckpoint(chunk, checkpoint),
          onFinal: (payload) => {
            flushModelStreamDeltaQueue(set, streamRequestId);
            set((current) => current.modelStream.requestId === streamRequestId ? ({
              progress: markProgressResponse(current.progress, scanStartedAt),
              modelStream: {
                ...current.modelStream,
                status: "工具参数已通过 AgentVN 结构校验",
                responseText: appendStructuredModelTranscript(current.modelStream.responseText, `文本块 ${index + 1}/${chunks.length} 规范化结果`, payload),
              },
            }) : {});
          },
          onError: (message) => {
            flushModelStreamDeltaQueue(set, streamRequestId);
            set((current) => current.modelStream.requestId === streamRequestId ? ({
              progress: markProgressHeartbeat(current.progress),
              modelStream: {
                ...current.modelStream,
                status: "模型扫描失败",
                responseText: appendModelTranscript(current.modelStream.responseText, `文本块 ${index + 1}/${chunks.length} 错误`, message),
              },
            }) : {});
          },
        });
        appendInspectableResult({
          phase: "scan",
          title: `全文扫描 · 文本块 ${index + 1}/${chunks.length}`,
          sourceRange: { start: chunk.start_offset, end: chunk.end_offset },
          status: analysis.warnings.length > 0 ? "review" : "parsed",
          modelLabel,
          summary: analysis.summary,
          payload: analysis,
          warnings: analysis.warnings,
        });
        analyses.push(analysis);
        rollingSummary = `${rollingSummary}\n${analysis.summary}`.slice(-2400);
        set((current) => ({ session: touch({ ...current.session, ai_chunk_analyses: [...analyses] }) }));
      }
      const outlineStreamRequestId = `outline_${document.document_id}_${nanoid(8)}`;
      clearModelStreamDeltaQueue();
      set({
        progress: createProgressState({
          phase: "outline",
          current: chunks.length + 1,
          total: chunks.length + 2,
          message: `当前模型：${modelLabel}`,
          detail: `正在合成全书大纲，已完成扫描批次 ${analyses.length}/${chunks.length}。`,
          cancellable: false,
        }, get().progress),
        modelStream: { open: true, title: `当前模型：${modelLabel}`, status: "正在合成全书大纲", responseText: appendModelTranscriptHeader("", "全书大纲合成"), traces: [], requestId: outlineStreamRequestId },
      });
      activeDetail = `正在合成全书大纲，已完成扫描批次 ${analyses.length}/${chunks.length}`;
      const outlineStartedAt = Date.now();
      const outline = await aiBuildNovelOutlineStream({
        document_id: document.document_id,
        title: document.title,
        total_chars: document.total_chars,
        analyses,
        allow_branch_suggestions: get().session.import_options.allow_branch_suggestions,
        partial_mainline: get().session.outline_partials.mainline,
        partial_structure: get().session.outline_partials.structure,
        partial_index: get().session.outline_partials.index,
        provider_selection: providerSelection,
      }, {
        onDelta: (delta) => queueModelStreamDelta(set, outlineStreamRequestId, delta),
        onStatus: (status) => set((current) => current.modelStream.requestId === outlineStreamRequestId ? ({ modelStream: { ...current.modelStream, status }, progress: markProgressHeartbeat(current.progress) }) : {}),
        onTrace: (trace) => set((current) => current.modelStream.requestId === outlineStreamRequestId ? ({ modelStream: { ...current.modelStream, traces: [...current.modelStream.traces.slice(-14), trace] }, progress: markProgressHeartbeat(current.progress) }) : {}),
        onCheckpoint: applyOutlineCheckpoint,
        onFinal: (payload) => {
          flushModelStreamDeltaQueue(set, outlineStreamRequestId);
          set((current) => current.modelStream.requestId === outlineStreamRequestId ? ({
            progress: markProgressResponse(current.progress, outlineStartedAt),
            modelStream: {
              ...current.modelStream,
              responseText: appendStructuredModelTranscript(current.modelStream.responseText, "Outline normalized result", payload),
            },
          }) : {});
        },
      });
      appendInspectableResult({
        phase: "outline",
        title: "大纲合成 · 全书结构",
        status: outline.needs_review ? "review" : "parsed",
        modelLabel,
        summary: outline.summary,
        payload: outline,
        warnings: outline.warnings,
      });
      set((current) => {
        const processing = syncProcessingChapters(current.processing, outline.chapters);
        const outlineSession = {
          ...current.session,
          ai_outline: outline,
          chapters: outline.chapters,
          conflict_points: outline.conflict_points ?? [],
        };
        const reviewedCharacters = splitReviewedCharacters(outline.characters, outlineSession);
        persistNovelProcessingState(processing);
        return {
          session: touch({
            ...current.session,
            ai_outline: { ...outline, characters: reviewedCharacters.confirmed },
            chapters: outline.chapters,
            characters: reviewedCharacters.confirmed,
            character_candidates_review: reviewedCharacters.reviews,
            conflict_points: outline.conflict_points ?? [],
            ai_stage: "outline",
            status: "outline_ready",
          }),
          processing,
          progress: undefined,
          isProcessing: false,
          modelStream: { ...current.modelStream, status: "全书大纲已生成" },
        };
      });
    } catch (error) {
      const summary = reportNovelImportError({
        phase: "AI 全文扫描",
        modelLabel,
        error,
        session: get().session,
        progress: get().progress,
        activeDetail,
        modelTranscript: get().modelStream.responseText,
      });
      set((current) => ({
        errors: [...current.errors, summary],
        progress: undefined,
        isProcessing: false,
        modelStream: { ...current.modelStream, open: true, status: "模型流程已停止" },
        session: touch({ ...current.session, ai_stage: "scan" }),
      }));
    }
  },

  confirmOutlineAndGenerate: async () => {
    const state = get();
    if (state.isProcessing) return;
    if (!state.session.ai_outline) {
      set({ errors: ["请先完成并确认全书大纲。"] });
      return;
    }
    const document = state.session.document;
    const rangeErrors = document ? invalidChapterSourceRanges(state.session.chapters, document.normalized_text) : ["小说原文未加载。"];
    if (rangeErrors.length > 0) {
      set({ errors: [`章节原文映射校验失败，已阻止生成低质量蓝图：${rangeErrors.join("；")}`] });
      return;
    }
    set((current) => ({ session: touch({ ...current.session, ai_stage: "planning", status: "scene_planning" }) }));
    await get().generateBlueprintLine();
  },

  continueWithQualityRisk: async () => {
    const state = get();
    if (state.isProcessing) return;
    if (!state.session.ai_outline) {
      set({ errors: ["请先完成并确认全书大纲。"] });
      return;
    }
    set((current) => ({
      session: touch({
        ...current.session,
        quality_report: current.session.quality_report ?? evaluateNovelImportQuality(current.session),
        quality_risk_accepted: true,
        ai_stage: "planning",
        status: "scene_planning",
      }),
      errors: [],
      warnings: [...current.warnings, "已确认按风险继续；导入报告和写入节点会保留低质量风险标记。"],
    }));
    await get().generateBlueprintLine();
  },

  retryQualityCheck: async () => {
    const state = get();
    if (state.isProcessing) return;
    if (!state.session.document || !state.session.ai_outline) {
      set({ errors: ["请先完成 AI 全文扫描和大纲确认。"] });
      return;
    }
    if (state.session.adapted_scenes.length > 0) {
      set({ errors: ["已有场景写入画布，不能直接重试场景规划；请重新开始导入或手动处理现有节点。"] });
      return;
    }
    set((current) => ({
      session: touch({
        ...current.session,
        scenes: [],
        planned_chapter_ids: [],
        branch_suggestions: [],
        conflict_points: [],
        validation_reports: [],
        quality_report: undefined,
        quality_risk_accepted: false,
        ai_stage: "planning",
        status: "scene_planning",
      }),
      importJob: undefined,
      errors: [],
      warnings: [...current.warnings, "已清空本次低质量场景规划，正在重新请求模型规划。"],
    }));
    await get().generateBlueprintLine();
  },

  generateBlueprintLine: async () => {
    const state = get();
    const document = state.session.document;
    const providerSelection = getNovelProviderSelectionPayload();
    if (state.isProcessing) return;
    if (!document || !state.session.ai_outline) {
      set({ errors: ["请先完成 AI 全文扫描和大纲确认。"] });
      return;
    }
    const rangeErrors = invalidChapterSourceRanges(state.session.chapters, document.normalized_text);
    if (rangeErrors.length > 0) {
      set({
        errors: [`章节原文映射校验失败，已阻止生成低质量蓝图：${rangeErrors.join("；")}`],
        isProcessing: false,
      });
      return;
    }
    if (!providerSelection) {
      set({ errors: ["请先配置文本生成模型。"] });
      return;
    }

    const modelLabel = `${providerSelection.connection_id} / ${providerSelection.model_id}`;
    const existingJob = state.importJob && (state.importJob.status === "paused" || state.importJob.status === "cancelled")
      ? state.importJob
      : undefined;
    const layout = buildLayout(state.session.session_id, existingJob);
    const graphImportMode = resolveNovelGraphImportMode(existingJob);
    const outline = outlineText(state.session);
    const chapters = [...state.session.chapters].sort((a, b) => a.index - b.index);
    const startedAt = new Date().toISOString();
    let scenes = [...state.session.scenes].sort((a, b) => a.index - b.index);
    const validChapterIds = new Set(chapters.map((chapter) => chapter.chapter_id));
    const sceneChapterIds = new Set(scenes.map((scene) => scene.chapter_id).filter((chapterId) => validChapterIds.has(chapterId)));
    const plannedChapterIds = new Set(
      state.session.planned_chapter_ids.filter((chapterId) => validChapterIds.has(chapterId) && sceneChapterIds.has(chapterId))
    );
    for (const chapterId of sceneChapterIds) plannedChapterIds.add(chapterId);
    let lastInsertedNodeId = existingJob?.lastInsertedNodeId;
    let activeDetail = "正在准备小说导入蓝图生成";

    set({
      isProcessing: true,
      errors: [],
      progress: createProgressState({
        phase: "planning",
        current: 0,
        total: Math.max(1, chapters.length),
        message: `当前模型：${modelLabel}`,
        detail: `正在准备规划 ${chapters.length} 个章节。`,
        cancellable: true,
      }),
      importJob: {
        importLineId: layout.importLineId,
        graphImportMode,
        layoutStartPosition: layout.startPosition,
        layoutColumnGap: layout.columnGap,
        layoutRowGap: layout.rowGap,
        layoutColumns: layout.columns,
        status: "running",
        total: Math.max(1, scenes.length),
        generatedCount: existingJob?.generatedCount ?? 0,
        failedSceneIds: existingJob?.failedSceneIds ?? [],
        skippedSceneIds: existingJob?.skippedSceneIds ?? [],
        lastInsertedNodeId,
        cancelRequested: false,
        pauseRequested: false,
        skipRequested: false,
        startedAt: existingJob?.startedAt ?? startedAt,
      },
      session: touch({ ...state.session, planned_chapter_ids: [...plannedChapterIds], validation_reports: existingJob ? state.session.validation_reports : [], ai_stage: scenes.length > 0 ? "generate" : "planning", status: scenes.length > 0 ? "blueprint_generating" : "scene_planning" }),
    });

    try {
      if (plannedChapterIds.size < chapters.length) {
        const planned: SceneCandidate[] = [...scenes];
        for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex += 1) {
          const chapter = chapters[chapterIndex];
          if (plannedChapterIds.has(chapter.chapter_id)) continue;
          const text = document.normalized_text.slice(chapter.start_offset, chapter.end_offset);
          const planningStreamRequestId = `planning_${chapter.chapter_id}_${nanoid(8)}`;
          clearModelStreamDeltaQueue();
          activeDetail = `正在规划章节 ${chapterIndex + 1}/${chapters.length}：${chapter.title}，offset=${chapter.start_offset}-${chapter.end_offset}`;
          set({
            progress: createProgressState({
              phase: "planning",
              current: chapterIndex,
              total: chapters.length,
              message: `当前模型：${modelLabel}，正在规划章节 ${chapterIndex + 1}/${chapters.length}`,
              detail: `正在规划章节 ${chapterIndex + 1}/${chapters.length}：${chapter.title}。`,
              cancellable: true,
            }, get().progress),
          });
          set({
            modelStream: {
              open: true,
              title: `当前模型：${modelLabel}`,
              status: `正在规划章节 ${chapterIndex + 1}/${chapters.length}`,
              responseText: appendModelTranscriptHeader(get().modelStream.responseText, `章节规划 ${chapterIndex + 1}/${chapters.length} · ${chapter.title}`),
              traces: [],
              requestId: planningStreamRequestId,
            },
          });
          const planningStartedAt = Date.now();
          const response = await aiPlanNovelChapterStream({
            document_id: document.document_id,
            chapter,
            outline_summary: outline,
            known_characters: get().session.characters,
            text,
            suggested_scene_count: suggestedSceneCountForText(text.length, get().session.import_options.max_scene_chars),
            min_scene_count: suggestedSceneCountForText(text.length, get().session.import_options.max_scene_chars),
            min_branch_suggestion_count: 1,
            allow_branch_suggestions: get().session.import_options.allow_branch_suggestions,
            provider_selection: providerSelection,
          }, {
            onDelta: (delta) => queueModelStreamDelta(set, planningStreamRequestId, delta),
            onStatus: (status) => set((current) => current.modelStream.requestId === planningStreamRequestId ? ({ modelStream: { ...current.modelStream, status }, progress: markProgressHeartbeat(current.progress) }) : {}),
            onTrace: (trace) => set((current) => current.modelStream.requestId === planningStreamRequestId ? ({ modelStream: { ...current.modelStream, traces: [...current.modelStream.traces.slice(-14), trace] }, progress: markProgressHeartbeat(current.progress) }) : {}),
            onFinal: (payload) => {
              flushModelStreamDeltaQueue(set, planningStreamRequestId);
              set((current) => current.modelStream.requestId === planningStreamRequestId ? ({
                modelStream: {
                  ...current.modelStream,
                  status: "章节规划结构已校验",
                  responseText: appendStructuredModelTranscript(current.modelStream.responseText, `章节规划 ${chapterIndex + 1}/${chapters.length} 结构化结果`, payload),
                },
                progress: markProgressResponse(current.progress, planningStartedAt),
              }) : {});
            },
            onError: (message) => {
              flushModelStreamDeltaQueue(set, planningStreamRequestId);
              set((current) => current.modelStream.requestId === planningStreamRequestId ? ({
                modelStream: {
                  ...current.modelStream,
                  status: "章节规划失败",
                  responseText: appendModelTranscript(current.modelStream.responseText, `章节规划 ${chapterIndex + 1}/${chapters.length} 错误`, message),
                },
                progress: markProgressHeartbeat(current.progress),
              }) : {});
            },
          });
          set((current) => ({ progress: markProgressResponse(current.progress, planningStartedAt) }));
          const nextScenes = response.scenes.map((scene, offset) => ({ ...scene, index: planned.length + offset, chapter_id: chapter.chapter_id }));
          planned.push(...nextScenes);
          plannedChapterIds.add(chapter.chapter_id);
          appendInspectableResult({
            phase: "planning",
            title: `场景规划 · 第 ${chapter.index + 1} 章`,
            chapterId: chapter.chapter_id,
            chapterTitle: chapter.title,
            chapterIndex: chapter.index,
            sourceRange: { start: chapter.start_offset, end: chapter.end_offset },
            status: response.needs_review || response.warnings.length > 0 ? "review" : "parsed",
            modelLabel,
            summary: `规划 ${response.scenes.length} 个场景，冲突点 ${response.conflict_points.length} 个。`,
            payload: response,
            warnings: response.warnings,
          });
          set((current) => ({
            session: touch({
              ...current.session,
              scenes: [...planned],
              planned_chapter_ids: [...plannedChapterIds],
              ai_stage: "planning",
              status: "scene_planning",
            }),
            importJob: current.importJob ? { ...current.importJob, total: Math.max(current.importJob.total, planned.length) } : undefined,
          }));
          if (response.conflict_points?.length) set((current) => ({ session: touch({ ...current.session, conflict_points: [...current.session.conflict_points, ...response.conflict_points] }) }));
          if (response.branch_suggestions?.length) set((current) => ({ session: touch({ ...current.session, branch_suggestions: [...current.session.branch_suggestions, ...response.branch_suggestions.filter((item) => !current.session.branch_suggestions.some((existing) => existing.suggestion_id === item.suggestion_id))] }) }));
          if (response.warnings.length) set((current) => ({ warnings: [...current.warnings, ...response.warnings.map(formatError)] }));
        }
        scenes = planned;
      }

      const plannedSession = touch({ ...get().session, scenes, ai_stage: "planning", status: "scene_planning" });
      const planningQuality = evaluateNovelImportQuality(plannedSession);
      if (planningQuality.score < planningQuality.threshold && !plannedSession.quality_risk_accepted) {
        set((current) => ({
          session: touch({ ...current.session, scenes, quality_report: planningQuality, ai_stage: "planning", status: "scene_planning" }),
          importJob: current.importJob ? { ...current.importJob, total: scenes.length, status: "paused", generatedCount: 0 } : undefined,
          progress: undefined,
          isProcessing: false,
          warnings: [...current.warnings, "小说导入质量评分低于阈值，已暂停写入蓝图；请重试规划或确认继续并标记风险。"],
        }));
        return;
      }

      set((current) => ({
        session: touch({ ...current.session, scenes, quality_report: planningQuality, ai_stage: "generate", status: "blueprint_generating" }),
        importJob: current.importJob ? { ...current.importJob, total: scenes.length } : undefined,
      }));

      const startIndex = existingJob?.generatedCount ?? 0;
      const usedSceneIds = collectUsedSceneIds(get().session.adapted_scenes);
      for (let index = startIndex; index < scenes.length; index += 1) {
        const job = get().importJob;
        if (job?.cancelRequested || job?.pauseRequested) {
          set((current) => ({
            isProcessing: false,
            progress: undefined,
            importJob: current.importJob ? { ...current.importJob, status: job.cancelRequested ? "cancelled" : "paused", generatedCount: index, lastInsertedNodeId, cancelRequested: false, pauseRequested: false } : undefined,
          }));
          return;
        }
        const scene = scenes[index];
        if (get().session.adapted_scenes.some((item) => item.source_scene_candidate_id === scene.scene_candidate_id)) {
          set((current) => ({
            importJob: current.importJob ? { ...current.importJob, generatedCount: Math.max(current.importJob.generatedCount, index + 1) } : undefined,
          }));
          continue;
        }
        const blueprintStreamRequestId = `blueprint_${scene.scene_candidate_id}_${nanoid(8)}`;
        clearModelStreamDeltaQueue();
        if (job?.skipRequested) {
          set((current) => ({
            importJob: current.importJob ? { ...current.importJob, skippedSceneIds: [...(current.importJob.skippedSceneIds ?? []), scene.scene_candidate_id], skipRequested: false, generatedCount: index + 1 } : undefined,
          }));
          continue;
        }
        activeDetail = `正在改编场景 ${index + 1}/${scenes.length}：${scene.title}，scene_candidate_id=${scene.scene_candidate_id}`;
        set({
          progress: createProgressState({
            phase: "blueprint",
            current: index,
            total: scenes.length,
            message: `当前模型：${modelLabel}，正在改编场景 ${index + 1}/${scenes.length}`,
            detail: `正在改编场景 ${index + 1}/${scenes.length}：${scene.title}。`,
            cancellable: true,
          }, get().progress),
        });
        const previous = get().session.adapted_scenes[index - 1]?.scene_beat.summary;
        set({
          modelStream: {
            open: true,
            title: `当前模型：${modelLabel}`,
            status: `正在改编场景 ${index + 1}/${scenes.length}`,
            responseText: appendModelTranscriptHeader(get().modelStream.responseText, `场景改编 ${index + 1}/${scenes.length} · ${scene.title}`),
            traces: [],
            requestId: blueprintStreamRequestId,
          },
        });
        const blueprintStartedAt = Date.now();
        const response = await aiAdaptNovelSceneStream({
          scene_candidate: scene,
          known_characters: get().session.characters,
          previous_scene_summary: previous,
          outline_summary: outline,
          import_options: get().session.import_options,
          memory_mode: get().session.import_options.memory_mode,
          provider_selection: providerSelection,
        }, {
          onDelta: (delta) => queueModelStreamDelta(set, blueprintStreamRequestId, delta),
          onStatus: (status) => set((current) => current.modelStream.requestId === blueprintStreamRequestId ? ({ modelStream: { ...current.modelStream, status }, progress: markProgressHeartbeat(current.progress) }) : {}),
          onTrace: (trace) => set((current) => current.modelStream.requestId === blueprintStreamRequestId ? ({ modelStream: { ...current.modelStream, traces: [...current.modelStream.traces.slice(-14), trace] }, progress: markProgressHeartbeat(current.progress) }) : {}),
          onFinal: (payload) => {
            flushModelStreamDeltaQueue(set, blueprintStreamRequestId);
            set((current) => current.modelStream.requestId === blueprintStreamRequestId ? ({
              modelStream: {
                ...current.modelStream,
                status: "场景改编结构已校验",
                responseText: appendStructuredModelTranscript(current.modelStream.responseText, `场景改编 ${index + 1}/${scenes.length} 结构化结果`, payload),
              },
              progress: markProgressResponse(current.progress, blueprintStartedAt),
            }) : {});
          },
          onError: (message) => {
            flushModelStreamDeltaQueue(set, blueprintStreamRequestId);
            set((current) => current.modelStream.requestId === blueprintStreamRequestId ? ({
              modelStream: {
                ...current.modelStream,
                status: "场景改编失败",
                responseText: appendModelTranscript(current.modelStream.responseText, `场景改编 ${index + 1}/${scenes.length} 错误`, message),
              },
              progress: markProgressHeartbeat(current.progress),
            }) : {});
          },
        });
        const blueprintResponseMs = Date.now() - blueprintStartedAt;
        const sessionBeforeCharacterMerge = get().session;
        const reviewedCharacters = splitReviewedCharacters(
          characterReviewSources(sessionBeforeCharacterMerge, response.character_updates),
          {
            ...sessionBeforeCharacterMerge,
            adapted_scenes: [...sessionBeforeCharacterMerge.adapted_scenes, response.adapted_scene],
          },
        );
        const mergedCharacters = reviewedCharacters.confirmed;
        const adaptedBeforeSceneIdDedupe = applyCharacterDisplayNames(response.adapted_scene, mergedCharacters, scene.characters);
        const plannedBranchSuggestionsForScene = get().session.branch_suggestions
          .filter((item) => item.source_scene_id === scene.scene_candidate_id);
        const sceneIdAliasIndex = buildSceneIdAliasIndex(get().session.scenes, get().session.adapted_scenes);
        const validation = validateNovelBlueprintWrite({
          reportId: `novel_validation_${nanoid(8)}`,
          document,
          sceneCandidate: scene,
          adaptedScene: adaptedBeforeSceneIdDedupe,
          branchSuggestions: [...plannedBranchSuggestionsForScene, ...response.branch_suggestions],
          conflictPoints: response.conflict_points ?? [],
          knownCharacters: mergedCharacters,
          usedSceneIds,
          projectAssets: useProjectStore.getState().assetManifest,
          allowBranchSuggestions: get().session.import_options.allow_branch_suggestions,
          resolveSceneId: (sourceSceneId, context) =>
            resolveSceneAlias(sceneIdAliasIndex, sourceSceneId) ??
            resolveSceneAlias(sceneIdAliasIndex, context?.suggestion?.source_scene_display_name ?? context?.conflict?.source_scene_display_name),
        });
        set((current) => ({
          session: touch({ ...current.session, validation_reports: [...current.session.validation_reports, validation.report] }),
        }));
        if (validation.blocked) {
          appendInspectableResult({
            phase: "blueprint",
            title: `结构校验阻断 · ${scene.title}`,
            chapterId: scene.chapter_id,
            chapterTitle: scene.title,
            chapterIndex: scene.index,
            sourceRange: { start: scene.start_offset, end: scene.end_offset },
            status: "failed",
            modelLabel,
            summary: `写入前结构校验发现 ${validation.report.errors.length} 个阻断错误，蓝图未写入。`,
            payload: {
              scene_candidate: scene,
              raw_adapt_response: response,
              validation: validation.report,
            },
            warnings: validation.report.warnings,
            error: validation.report.errors.join("\n"),
          });
          throw new Error(`AI 结构校验阻断：${validation.report.errors.join("；")}`);
        }
        const backgroundResult = ensureSceneHasBackgroundPlaceholder(validation.adaptedScene.scene_beat);
        if (backgroundResult.inserted) {
          const projectState = useProjectStore.getState();
          const nextAssets = ensureDefaultBackgroundPlaceholderAsset(projectState.assetManifest);
          if (nextAssets.length !== projectState.assetManifest.length) projectState.setAssetManifest(nextAssets);
        }
        const adapted: AdaptedScene = {
          ...validation.adaptedScene,
          scene_beat: backgroundResult.scene,
          warnings: backgroundResult.inserted
            ? [...validation.adaptedScene.warnings, "Inserted an explicit default visual placeholder background; replace it with a final background asset before release."]
            : validation.adaptedScene.warnings,
          needs_review: validation.adaptedScene.needs_review || backgroundResult.inserted,
        };
        const responseAssetSuggestions = remapAssetSuggestionSourceSceneIds(
          response.asset_suggestions ?? [],
          [adaptedBeforeSceneIdDedupe.scene_beat.scene_id, scene.scene_candidate_id],
          adapted.scene_beat.scene_id,
          adapted.scene_beat.scene_display_name ?? adapted.scene_beat.title,
        );
        const responseBranchSuggestions = validation.branchSuggestions.filter((item) => !item.enabled_by_default);
        const responseConflictPoints = validation.conflictPoints;
        const qualityReport = get().session.quality_report;
        const qualityRisk = qualityReport?.risk_flag ? qualityReport.risk_level : undefined;
        const baseNode = adaptedSceneToNode(adapted, layout, index, get().session.import_options.memory_mode);
        const pendingVisualAssets = buildPendingVisualAssetsForScene(adapted.scene_beat, {
          nodeId: baseNode.id,
          projectAssets: useProjectStore.getState().assetManifest,
          assetSuggestions: responseAssetSuggestions,
        });
        const node = withNovelGraphMetadata({
          ...baseNode,
          data: {
            ...baseNode.data,
            editorMeta: {
              ...baseNode.data.editorMeta,
              needsReview: Boolean(baseNode.data.editorMeta.needsReview || adapted.needs_review || qualityRisk),
              qualityRisk,
              pendingVisualAssets,
            },
          },
        }, { mode: graphImportMode });
        const edge = importedNovelLineEdges(layout, [node], graphImportMode, lastInsertedNodeId, index)[0];
        useEditorStore.getState().recordGraphHistory();
        useEditorStore.setState((editor) => {
          const base = graphBaseForImportMode(graphImportMode, editor.nodes, editor.edges);
          return {
            nodes: [...base.nodes, node],
            edges: edge ? [...base.edges, edge] : base.edges,
            dirty: true,
          };
        });
        useEditorStore.getState().registerNewNodeEffect(node.id, "imported");
        useEditorStore.getState().declutterNodesAround([node.id]);
        lastInsertedNodeId = node.id;
        appendInspectableResult({
          phase: "blueprint",
          title: `蓝图写入 · ${adapted.scene_beat.title}`,
          chapterId: scene.chapter_id,
          chapterTitle: scene.title,
          chapterIndex: adapted.scene_beat.chapter,
          sourceRange: { start: scene.start_offset, end: scene.end_offset },
          status: adapted.needs_review || adapted.warnings.length > 0 ? "review" : "parsed",
          modelLabel,
          summary: `写入节点 ${node.id}，scene_id=${adapted.scene_beat.scene_id}，命令 ${adapted.scene_beat.commands.length} 条。`,
          payload: {
            scene_candidate: scene,
            adapt_response: response,
            raw_adapt_response: response,
            validated_adapted_scene: adapted,
            pending_visual_assets: pendingVisualAssets,
            validation: validation.report,
            write_result: {
              node_id: node.id,
              scene_id: adapted.scene_beat.scene_id,
              chapter: adapted.scene_beat.chapter,
              edge,
              needs_review: adapted.needs_review,
            },
          },
          warnings: [...adapted.warnings, ...pendingVisualAssets.map((asset) => `${asset.scene_title}: ${asset.label} (${asset.asset_id ?? asset.character_id ?? asset.kind})`)],
        });
        set((current) => ({
          session: touch({
            ...current.session,
            characters: mergedCharacters,
            character_candidates_review: reviewedCharacters.reviews,
            ai_outline: current.session.ai_outline ? { ...current.session.ai_outline, characters: mergedCharacters } : current.session.ai_outline,
            adapted_scenes: [...current.session.adapted_scenes.filter((item) => item.source_scene_candidate_id !== scene.scene_candidate_id), adapted],
            asset_suggestions: [
              ...current.session.asset_suggestions.filter((item) => item.source_scene_id !== adapted.scene_beat.scene_id),
              ...responseAssetSuggestions,
            ],
            branch_suggestions: [
              ...current.session.branch_suggestions.filter((item) => item.source_scene_id !== adapted.scene_beat.scene_id && item.source_scene_id !== scene.scene_candidate_id),
              ...responseBranchSuggestions,
            ],
            conflict_points: [
              ...current.session.conflict_points,
              ...responseConflictPoints,
            ],
            status: "imported_to_graph",
            ai_stage: "generate",
          }),
          importJob: current.importJob ? { ...current.importJob, generatedCount: index + 1, lastInsertedNodeId } : undefined,
          progress: createProgressState({
            phase: "blueprint",
            current: index + 1,
            total: scenes.length,
            message: `已写入节点 ${index + 1}/${scenes.length}`,
            detail: `已写入 ${adapted.scene_beat.title}，继续处理下一场景。`,
            lastResponseMs: blueprintResponseMs,
            cancellable: true,
          }, current.progress),
        }));
      }
      if (get().session.import_options.allow_branch_suggestions) {
        const resolvedBranches = resolveBranchSuggestions({
          suggestions: get().session.branch_suggestions,
          scenes: get().session.scenes,
          adaptedScenes: get().session.adapted_scenes,
        });
        set((current) => ({
          session: touch({ ...current.session, branch_suggestions: resolvedBranches.suggestions }),
          warnings: [...current.warnings, ...resolvedBranches.warnings],
        }));
        const createdBranches = materializeBranchSuggestions({
          importLineId: layout.importLineId,
          suggestions: resolvedBranches.suggestions,
          memoryMode: get().session.import_options.memory_mode,
        });
        if (createdBranches > 0) {
          set((current) => ({ warnings: [...current.warnings, `已根据冲突分析生成 ${createdBranches} 个推测分支节点。`] }));
        }
      }
      const finalQuality = evaluateNovelImportQuality(get().session);
      const finalImportNotice = novelGraphImportNotice(graphImportMode, scenes.length);
      set((current) => ({
        session: touch({ ...current.session, quality_report: finalQuality, ai_stage: "report", status: "imported_to_graph" }),
        importJob: current.importJob ? { ...current.importJob, status: "completed", generatedCount: scenes.length, lastInsertedNodeId, completedAt: new Date().toISOString(), graphImportMode } : undefined,
        progress: undefined,
        isProcessing: false,
        warnings: current.warnings.includes(finalImportNotice) ? current.warnings : [...current.warnings, finalImportNotice],
      }));
    } catch (error) {
      const summary = reportNovelImportError({
        phase: "蓝图生成",
        modelLabel,
        error,
        session: get().session,
        progress: get().progress,
        activeDetail,
        modelTranscript: get().modelStream.responseText,
      });
      set((current) => ({
        errors: [...current.errors, summary],
        progress: undefined,
        isProcessing: false,
        importJob: current.importJob ? { ...current.importJob, status: "paused" } : undefined,
      }));
    }
  },

  pauseBlueprintGeneration: () => set((state) => state.importJob ? { importJob: { ...state.importJob, pauseRequested: true } } : {}),
  resumeBlueprintGeneration: async () => {
    set((state) => state.importJob ? { importJob: { ...state.importJob, status: "running", pauseRequested: false } } : {});
    await get().generateBlueprintLine();
  },
  skipCurrentScene: () => set((state) => state.importJob ? { importJob: { ...state.importJob, skipRequested: true } } : {}),
  cancelBlueprintGeneration: () => set((state) => state.importJob ? { importJob: { ...state.importJob, cancelRequested: true } } : {}),
}));

let novelPersistenceSyncTimer: number | undefined;
let syncingNovelPersistence = false;
let lastNovelPersistenceSnapshot = "";

function hasNovelPersistenceContent(state: NovelImportStore): boolean {
  return Boolean(
    state.session.document ||
    state.processing.jobs.length > 0 ||
    state.processing.chunks.length > 0 ||
    Object.keys(state.persistence.books).length > 0 ||
    Object.keys(state.persistence.jobs).length > 0
  );
}

function buildPersistenceForCurrentState(state: NovelImportStore): NovelPersistenceState {
  if (state.session.document) {
    return deriveNovelPersistenceState({
      previous: state.persistence,
      session: state.session,
      importJob: state.importJob,
      progress: state.progress,
      processing: state.processing,
      inspectableResults: state.inspectableResults,
      errors: state.errors,
      warnings: state.warnings,
      modelName: getNovelImportModelStatus().label,
    });
  }
  return {
    ...normalizeNovelPersistenceState(state.persistence),
    sessionSnapshot: undefined,
    importJobSnapshot: state.importJob,
    progressSnapshot: state.progress,
    processingSnapshot: state.processing,
    inspectableResults: state.inspectableResults,
    errors: state.errors,
    warnings: state.warnings,
    updatedAt: new Date().toISOString(),
  };
}

function flushNovelPersistenceSync(): void {
  if (syncingNovelPersistence) return;
  const state = useNovelImportStore.getState();
  const next = buildPersistenceForCurrentState(state);
  const snapshot = JSON.stringify(next);
  if (snapshot === lastNovelPersistenceSnapshot) return;
  lastNovelPersistenceSnapshot = snapshot;
  syncingNovelPersistence = true;
  useNovelImportStore.setState({ persistence: next });
  useProjectStore.getState().setNovelPersistence(hasNovelPersistenceContent(state) ? next : undefined);
  persistNovelProcessingState(state.processing);
  syncingNovelPersistence = false;
}

function scheduleNovelPersistenceSync(): void {
  if (syncingNovelPersistence) return;
  if (typeof window === "undefined") {
    flushNovelPersistenceSync();
    return;
  }
  if (novelPersistenceSyncTimer !== undefined) window.clearTimeout(novelPersistenceSyncTimer);
  novelPersistenceSyncTimer = window.setTimeout(() => {
    novelPersistenceSyncTimer = undefined;
    flushNovelPersistenceSync();
  }, 350);
}

useNovelImportStore.subscribe(() => scheduleNovelPersistenceSync());

if (typeof window !== "undefined") {
  (window as Window & { __AGENTVN_NOVEL_IMPORT_STORE__?: typeof useNovelImportStore }).__AGENTVN_NOVEL_IMPORT_STORE__ = useNovelImportStore;
}
