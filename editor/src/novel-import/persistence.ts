import { nanoid } from "nanoid";
import type { GameCommand } from "../types/commands";
import type {
  AdaptedScene,
  ChapterCandidate,
  ChapterResult,
  ChunkResult,
  JobEventLog,
  NovelImportSession,
  NovelPersistenceState,
  PersistentAgentTask,
  PersistentBookImportRecord,
  PersistentChapterRecord,
  PersistentChunkRecord,
  PersistentNovelProcessJob,
  PersistentRecordStatus,
  ProgressiveImportJob,
  ProgressState,
  SourceDocument,
  TextChunk,
  TokenUsageRecord,
} from "./types";
import { estimateTokens } from "./textChunker";

export const novelPersistenceSchemaVersion = "1.0.0" as const;
export const novelPromptVersion = "novel-import-v1";
export const agentTaskHeartbeatTimeoutMs = 3 * 60 * 1000;
const maxStoredEvents = 500;

export function createEmptyNovelPersistenceState(): NovelPersistenceState {
  return {
    schemaVersion: novelPersistenceSchemaVersion,
    inspectableResults: [],
    errors: [],
    warnings: [],
    books: {},
    chapters: {},
    chunks: {},
    jobs: {},
    tasks: {},
    chunkResults: {},
    chapterResults: {},
    events: [],
    updatedAt: new Date().toISOString(),
  };
}

export function emptyTokenUsage(): TokenUsageRecord {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated: true };
}

export function addTokenUsage(left?: TokenUsageRecord, right?: TokenUsageRecord): TokenUsageRecord {
  return {
    prompt_tokens: (left?.prompt_tokens ?? 0) + (right?.prompt_tokens ?? 0),
    completion_tokens: (left?.completion_tokens ?? 0) + (right?.completion_tokens ?? 0),
    total_tokens: (left?.total_tokens ?? 0) + (right?.total_tokens ?? 0),
    estimated: Boolean(left?.estimated ?? true) || Boolean(right?.estimated ?? true),
  };
}

export function estimateTokenUsage(inputText = "", resultText = ""): TokenUsageRecord {
  const prompt = estimateTokens(inputText);
  const completion = estimateTokens(resultText);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    estimated: true,
  };
}

export function textHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function normalizeNovelPersistenceState(value: unknown): NovelPersistenceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createEmptyNovelPersistenceState();
  const source = value as Partial<NovelPersistenceState>;
  return {
    schemaVersion: novelPersistenceSchemaVersion,
    sessionSnapshot: isRecordMap<NovelImportSession>(source.sessionSnapshot) ? source.sessionSnapshot : undefined,
    importJobSnapshot: isRecordMap<ProgressiveImportJob>(source.importJobSnapshot) ? source.importJobSnapshot : undefined,
    progressSnapshot: isRecordMap<ProgressState>(source.progressSnapshot) ? source.progressSnapshot : undefined,
    processingSnapshot: isRecordMap(source.processingSnapshot) ? source.processingSnapshot as NovelPersistenceState["processingSnapshot"] : undefined,
    inspectableResults: Array.isArray(source.inspectableResults) ? source.inspectableResults : [],
    errors: Array.isArray(source.errors) ? source.errors.filter((item): item is string => typeof item === "string") : [],
    warnings: Array.isArray(source.warnings) ? source.warnings.filter((item): item is string => typeof item === "string") : [],
    books: isRecordMap<PersistentBookImportRecord>(source.books) ? source.books : {},
    activeBookId: typeof source.activeBookId === "string" ? source.activeBookId : undefined,
    chapters: isRecordMap<PersistentChapterRecord>(source.chapters) ? source.chapters : {},
    chunks: isRecordMap<PersistentChunkRecord>(source.chunks) ? source.chunks : {},
    jobs: isRecordMap<PersistentNovelProcessJob>(source.jobs) ? source.jobs : {},
    activeJobId: typeof source.activeJobId === "string" ? source.activeJobId : undefined,
    tasks: isRecordMap<PersistentAgentTask>(source.tasks) ? source.tasks : {},
    chunkResults: isRecordMap<ChunkResult>(source.chunkResults) ? source.chunkResults : {},
    chapterResults: isRecordMap<ChapterResult>(source.chapterResults) ? source.chapterResults : {},
    events: Array.isArray(source.events) ? pruneJobEvents(source.events.filter(isJobEventLog)) : [],
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
  };
}

function isRecordMap<T>(value: unknown): value is Record<string, T> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJobEventLog(value: unknown): value is JobEventLog {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as JobEventLog).eventId === "string" &&
    typeof (value as JobEventLog).type === "string" &&
    typeof (value as JobEventLog).createdAt === "string";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function bookRecordFromDocument(document: SourceDocument, previous?: PersistentBookImportRecord): PersistentBookImportRecord {
  const fileHash = document.file_hash || String(document.metadata.file_hash || document.document_id);
  const originalPath = document.original_path || document.file_name;
  const sourcePaths = Array.from(new Set([...(previous?.sourcePaths ?? []), ...(document.source_paths ?? []), originalPath].filter(Boolean)));
  return {
    bookId: previous?.bookId ?? document.document_id,
    title: document.title,
    fileName: document.file_name,
    fileType: document.file_type,
    fileHash,
    fileSize: document.file_size ?? Number(document.metadata.size ?? 0),
    originalPath,
    sourcePaths,
    importedAt: previous?.importedAt ?? document.imported_at,
    updatedAt: nowIso(),
    totalChars: document.total_chars,
    language: document.language,
    metadata: { ...document.metadata },
  };
}

export function chapterRecordFromCandidate(bookId: string, chapter: ChapterCandidate, previous?: PersistentChapterRecord): PersistentChapterRecord {
  return {
    chapterId: chapter.chapter_id,
    bookId,
    index: chapter.index,
    title: chapter.title,
    startOffset: chapter.start_offset,
    endOffset: chapter.end_offset,
    summary: chapter.summary,
    confidence: chapter.confidence,
    status: previous?.status === "failed" ? "failed" : "completed",
    updatedAt: nowIso(),
  };
}

export function chunkRecordFromTextChunk(bookId: string, chunk: TextChunk, previous?: PersistentChunkRecord): PersistentChunkRecord {
  return {
    chunkId: chunk.chunk_id,
    bookId,
    index: chunk.index,
    startOffset: chunk.start_offset,
    endOffset: chunk.end_offset,
    textHash: textHash(chunk.text),
    estimatedTokens: chunk.estimated_tokens,
    chapterHint: chunk.chapter_hint,
    sceneHint: chunk.scene_hint,
    status: previous?.status ?? "pending",
    updatedAt: nowIso(),
  };
}

export function appendJobEvent(
  persistence: NovelPersistenceState,
  event: Omit<JobEventLog, "eventId" | "createdAt"> & { eventId?: string; createdAt?: string },
): NovelPersistenceState {
  return {
    ...persistence,
    events: pruneJobEvents([
      ...persistence.events,
      {
        ...event,
        eventId: event.eventId ?? `job_event_${nanoid(8)}`,
        createdAt: event.createdAt ?? nowIso(),
      },
    ]),
    updatedAt: nowIso(),
  };
}

export function pruneJobEvents(events: JobEventLog[]): JobEventLog[] {
  if (events.length <= maxStoredEvents) return events;
  const sorted = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const errors = sorted.filter((event) => event.level === "error");
  const nonErrors = sorted.filter((event) => event.level !== "error");
  const keepNonErrors = Math.max(0, maxStoredEvents - errors.length);
  const kept = [...errors.slice(-maxStoredEvents), ...nonErrors.slice(-keepNonErrors)];
  return kept.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildDerivedJobEvents(
  previousEvents: JobEventLog[],
  input: {
    job: PersistentNovelProcessJob;
    bookId: string;
    chunks: Record<string, ChunkResult>;
    chapters: Record<string, ChapterResult>;
    errors: string[];
    warnings: string[];
  },
): JobEventLog[] {
  let events = previousEvents;
  const appendOnce = (event: JobEventLog) => {
    if (events.some((item) => item.eventId === event.eventId)) return;
    events = [...events, event];
  };

  appendOnce({
    eventId: `${input.job.jobId}:status:${input.job.status}`,
    jobId: input.job.jobId,
    bookId: input.bookId,
    level: input.job.status === "completed" ? "success" : input.job.status === "failed" || input.job.status === "failed_partial" ? "error" : input.job.status === "paused" || input.job.status === "cancelled" ? "warning" : "info",
    type: `job.${input.job.status}`,
    message: `Job status: ${input.job.status}`,
    createdAt: input.job.updatedAt,
    errorMessage: input.job.errorMessage,
  });

  for (const result of Object.values(input.chunks)) {
    if (result.status !== "completed" && result.status !== "failed" && result.status !== "timeout_suspected") continue;
    appendOnce({
      eventId: `${input.job.jobId}:chunk:${result.chunkId}:${result.status}`,
      jobId: input.job.jobId,
      bookId: result.bookId,
      targetType: "chunk",
      targetId: result.chunkId,
      level: result.status === "completed" ? "success" : "error",
      type: `chunk.${result.status}`,
      message: result.status === "completed" ? "Chunk result persisted." : result.errorMessage ?? "Chunk failed.",
      createdAt: result.generatedAt ?? nowIso(),
      errorMessage: result.errorMessage,
    });
  }

  for (const result of Object.values(input.chapters)) {
    if (!result.resultText.trim()) continue;
    appendOnce({
      eventId: `${input.job.jobId}:chapter:${result.chapterId}:${result.status}`,
      jobId: input.job.jobId,
      bookId: result.bookId,
      targetType: "chapter",
      targetId: result.chapterId,
      level: result.status === "completed" ? "success" : result.status === "failed" || result.status === "failed_partial" ? "warning" : "info",
      type: `chapter.${result.status}`,
      message: `${result.title} result persisted.`,
      createdAt: result.generatedAt ?? nowIso(),
      errorMessage: result.errorMessage,
    });
  }

  for (const error of input.errors) {
    appendOnce({
      eventId: `${input.job.jobId}:error:${textHash(error)}`,
      jobId: input.job.jobId,
      bookId: input.bookId,
      level: "error",
      type: "job.error",
      message: error,
      createdAt: nowIso(),
      errorMessage: error,
    });
  }

  for (const warning of input.warnings.slice(-20)) {
    appendOnce({
      eventId: `${input.job.jobId}:warning:${textHash(warning)}`,
      jobId: input.job.jobId,
      bookId: input.bookId,
      level: "warning",
      type: "job.warning",
      message: warning,
      createdAt: nowIso(),
    });
  }

  return pruneJobEvents(events);
}

export function recoverNovelPersistenceState(persistence: NovelPersistenceState, timeoutMs = agentTaskHeartbeatTimeoutMs): NovelPersistenceState {
  const now = Date.now();
  const staleTaskIds = new Set<string>();
  const tasks = Object.fromEntries(Object.entries(persistence.tasks).map(([taskId, task]) => {
    if (!["running", "retrying", "waiting"].includes(task.status)) return [taskId, task];
    const heartbeatMs = task.heartbeatAt ? Date.parse(task.heartbeatAt) : Date.parse(task.updatedAt);
    if (Number.isFinite(heartbeatMs) && now - heartbeatMs <= timeoutMs) return [taskId, task];
    staleTaskIds.add(taskId);
    return [taskId, {
      ...task,
      status: "timeout_suspected" as PersistentRecordStatus,
      errorMessage: task.errorMessage ?? "Task heartbeat expired during a previous session.",
      updatedAt: nowIso(),
    }];
  }));

  if (staleTaskIds.size === 0) return persistence;

  let next: NovelPersistenceState = {
    ...persistence,
    tasks,
    jobs: Object.fromEntries(Object.entries(persistence.jobs).map(([jobId, job]) => {
      const hasStaleTask = Object.values(tasks).some((task) => task.jobId === jobId && staleTaskIds.has(task.taskId));
      if (!hasStaleTask || !["running", "retrying", "waiting"].includes(job.status)) return [jobId, job];
      return [jobId, {
        ...job,
        status: "failed_partial" as PersistentRecordStatus,
        errorMessage: job.errorMessage ?? "One or more tasks may have timed out while AgentVN was closed.",
        updatedAt: nowIso(),
        heartbeatAt: nowIso(),
      }];
    })),
    updatedAt: nowIso(),
  };

  for (const taskId of staleTaskIds) {
    const task = tasks[taskId];
    next = appendJobEvent(next, {
      jobId: task.jobId,
      bookId: task.bookId,
      taskId,
      targetType: task.targetType,
      targetId: task.targetId,
      level: "warning",
      type: "task.timeout_suspected",
      message: "Task heartbeat expired during a previous session.",
    });
  }
  return next;
}

export function deriveNovelPersistenceState(input: {
  previous: NovelPersistenceState;
  session: NovelImportSession;
  importJob?: ProgressiveImportJob;
  progress?: ProgressState;
  processing?: NovelPersistenceState["processingSnapshot"];
  inspectableResults: NovelPersistenceState["inspectableResults"];
  errors: string[];
  warnings: string[];
  modelName?: string;
}): NovelPersistenceState {
  const previous = normalizeNovelPersistenceState(input.previous);
  const document = input.session.document;
  if (!document) return { ...previous, updatedAt: nowIso() };

  const bookId = document.document_id;
  const jobId = previous.activeJobId?.startsWith("novel_job_") ? previous.activeJobId : `novel_job_${input.session.session_id}`;
  let tokenUsage = emptyTokenUsage();
  const chunks = { ...previous.chunks };
  const chapters = { ...previous.chapters };
  const chunkResults = { ...previous.chunkResults };
  const chapterResults = { ...previous.chapterResults };
  const tasks = { ...previous.tasks };
  const jobs = { ...previous.jobs };
  const analysesByChunkId = new Map(input.session.ai_chunk_analyses.map((analysis) => [analysis.chunk_id, analysis]));

  for (const chunk of input.session.chunks) {
    const analysis = analysesByChunkId.get(chunk.chunk_id);
    const partial = input.session.scan_partials[chunk.chunk_id];
    const resultText = analysis ? JSON.stringify(analysis, null, 2) : partial ? JSON.stringify(partial, null, 2) : "";
    const usage = estimateTokenUsage(chunk.text, resultText);
    tokenUsage = addTokenUsage(tokenUsage, usage);
    const previousResult = previous.chunkResults[chunk.chunk_id];
    const status: PersistentRecordStatus = analysis
      ? "completed"
      : previousResult?.status === "failed"
        ? "failed"
        : previousResult?.status === "timeout_suspected"
          ? "timeout_suspected"
          : "pending";
    chunks[chunk.chunk_id] = {
      ...chunkRecordFromTextChunk(bookId, chunk, previous.chunks[chunk.chunk_id]),
      status,
    };
    chunkResults[chunk.chunk_id] = {
      chunkId: chunk.chunk_id,
      bookId,
      status,
      resultText,
      partialResult: partial,
      summary: analysis?.summary ?? partial?.summary?.summary ?? previousResult?.summary ?? "",
      continuityNotes: analysis ? [...analysis.timeline, ...analysis.foreshadowing] : [
        ...(partial?.timeline?.timeline ?? []),
        ...(partial?.timeline?.foreshadowing ?? []),
      ],
      tokenUsage: usage,
      generatedAt: analysis ? previousResult?.generatedAt ?? nowIso() : previousResult?.generatedAt,
      promptVersion: novelPromptVersion,
      modelName: input.modelName ?? previousResult?.modelName,
      retryCount: previousResult?.retryCount ?? 0,
      errorMessage: status === "failed" || status === "timeout_suspected" ? previousResult?.errorMessage : undefined,
    };
    tasks[taskId(jobId, "chunk", chunk.chunk_id)] = {
      ...taskBase(jobId, bookId, "chunk", chunk.chunk_id, input.modelName, previous.tasks[taskId(jobId, "chunk", chunk.chunk_id)]),
      status,
      tokenUsage: usage,
      completedAt: analysis ? previous.tasks[taskId(jobId, "chunk", chunk.chunk_id)]?.completedAt ?? nowIso() : undefined,
    };
  }

  for (const chapter of input.session.chapters) {
    chapters[chapter.chapter_id] = chapterRecordFromCandidate(bookId, chapter, previous.chapters[chapter.chapter_id]);
  }

  const adaptedBySource = new Map(input.session.adapted_scenes.map((scene) => [scene.source_scene_candidate_id, scene]));
  for (const scene of input.session.scenes) {
    const adapted = adaptedBySource.get(scene.scene_candidate_id);
    const previousTask = previous.tasks[taskId(jobId, "scene", scene.scene_candidate_id)];
    const status: PersistentRecordStatus = adapted
      ? "completed"
      : previousTask?.status === "failed" || previousTask?.status === "timeout_suspected"
        ? previousTask.status
        : "pending";
    const resultText = adapted ? sceneToText(adapted) : "";
    const usage = estimateTokenUsage(scene.source_excerpt, resultText);
    tokenUsage = addTokenUsage(tokenUsage, usage);
    tasks[taskId(jobId, "scene", scene.scene_candidate_id)] = {
      ...taskBase(jobId, bookId, "scene", scene.scene_candidate_id, input.modelName, previousTask),
      status,
      tokenUsage: usage,
      completedAt: adapted ? previousTask?.completedAt ?? nowIso() : previousTask?.completedAt,
      errorMessage: status === "failed" || status === "timeout_suspected" ? previousTask?.errorMessage : undefined,
    };
  }

  for (const chapter of input.session.chapters) {
    const chapterScenes = input.session.scenes.filter((scene) => scene.chapter_id === chapter.chapter_id);
    const adaptedScenes = chapterScenes
      .map((scene) => adaptedBySource.get(scene.scene_candidate_id))
      .filter((scene): scene is AdaptedScene => Boolean(scene));
    const resultText = adaptedScenes.map(sceneToText).filter(Boolean).join("\n\n");
    const chunkIds = input.session.chunks
      .filter((chunk) => chunk.start_offset < chapter.end_offset && chunk.end_offset > chapter.start_offset)
      .map((chunk) => chunk.chunk_id);
    const previousResult = previous.chapterResults[chapter.chapter_id];
    const status: PersistentRecordStatus = adaptedScenes.length > 0 && adaptedScenes.length === chapterScenes.length
      ? "completed"
      : adaptedScenes.length > 0 || chunkIds.some((chunkId) => chunkResults[chunkId]?.status === "completed")
        ? "failed_partial"
        : previousResult?.status ?? "pending";
    const usage = addTokenUsage(
      chunkIds.reduce((total, chunkId) => addTokenUsage(total, chunkResults[chunkId]?.tokenUsage), emptyTokenUsage()),
      estimateTokenUsage("", resultText),
    );
    chapterResults[chapter.chapter_id] = {
      chapterId: chapter.chapter_id,
      bookId,
      status,
      title: chapter.title,
      resultText,
      summary: adaptedScenes.map((scene) => scene.scene_beat.summary).filter(Boolean).join("\n") || chapter.summary,
      continuityNotes: [
        ...new Set([
          ...chunkIds.flatMap((chunkId) => chunkResults[chunkId]?.continuityNotes ?? []),
          ...adaptedScenes.flatMap((scene) => scene.warnings),
        ]),
      ],
      chunkIds,
      sceneIds: chapterScenes.map((scene) => scene.scene_candidate_id),
      tokenUsage: usage,
      generatedAt: resultText ? previousResult?.generatedAt ?? nowIso() : previousResult?.generatedAt,
      promptVersion: novelPromptVersion,
      modelName: input.modelName ?? previousResult?.modelName,
      retryCount: previousResult?.retryCount ?? 0,
      errorMessage: status === "failed" || status === "timeout_suspected" ? previousResult?.errorMessage : undefined,
    };
  }

  if (input.processing) {
    for (const chapter of input.processing.chapterSnapshots) {
      chapters[chapter.chapter_id] = chapterRecordFromCandidate(bookId, chapter, previous.chapters[chapter.chapter_id]);
    }

    const processingTasksByChunkId = new Map(input.processing.tasks.map((task) => [task.chunkId, task]));
    for (const chunk of input.processing.chunks) {
      const task = processingTasksByChunkId.get(chunk.chunkId);
      const resultText = input.processing.chunkResults[chunk.chunkId] ?? previous.chunkResults[chunk.chunkId]?.resultText ?? "";
      const usage: TokenUsageRecord = {
        prompt_tokens: task?.inputTokens ?? chunk.estimatedTokens,
        completion_tokens: task?.outputTokens ?? estimateTokens(resultText),
        total_tokens: task?.totalTokens ?? (task?.inputTokens ?? chunk.estimatedTokens) + (task?.outputTokens ?? estimateTokens(resultText)),
        estimated: !task?.finishedAt,
      };
      tokenUsage = addTokenUsage(tokenUsage, usage);
      const status = mapProcessingStatus(task?.status ?? chunk.status);
      chunks[chunk.chunkId] = {
        chunkId: chunk.chunkId,
        bookId: chunk.bookId || bookId,
        index: chunk.globalIndex,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        textHash: textHash(`${chunk.startOffset}:${chunk.endOffset}:${chunk.charCount}`),
        estimatedTokens: chunk.estimatedTokens,
        chapterHint: chunk.chapterId,
        status,
        updatedAt: nowIso(),
      };
      chunkResults[chunk.chunkId] = {
        chunkId: chunk.chunkId,
        bookId: chunk.bookId || bookId,
        status,
        resultText,
        summary: resultText.slice(0, 240),
        continuityNotes: [],
        tokenUsage: usage,
        generatedAt: task?.finishedAt ?? previous.chunkResults[chunk.chunkId]?.generatedAt,
        promptVersion: input.processing.promptVersion || novelPromptVersion,
        modelName: input.modelName ?? previous.chunkResults[chunk.chunkId]?.modelName,
        retryCount: task?.retryCount ?? chunk.retryCount,
        errorMessage: task?.errorMessage ?? previous.chunkResults[chunk.chunkId]?.errorMessage,
      };
    }

    for (const task of input.processing.tasks) {
      const usage: TokenUsageRecord = {
        prompt_tokens: task.inputTokens,
        completion_tokens: task.outputTokens,
        total_tokens: task.totalTokens,
        estimated: !task.finishedAt,
      };
      tasks[task.agentTaskId] = {
        taskId: task.agentTaskId,
        jobId: task.jobId,
        bookId,
        targetType: "chunk",
        targetId: task.chunkId,
        status: mapProcessingStatus(task.status),
        promptVersion: input.processing.promptVersion || novelPromptVersion,
        modelName: input.modelName ?? previous.tasks[task.agentTaskId]?.modelName,
        agentParams: { agentIndex: task.agentIndex, chapterId: task.chapterId },
        retryCount: task.retryCount,
        tokenUsage: usage,
        startedAt: task.startedAt,
        updatedAt: task.finishedAt ?? task.startedAt ?? nowIso(),
        heartbeatAt: task.status === "processing" || task.status === "waiting" ? nowIso() : previous.tasks[task.agentTaskId]?.heartbeatAt,
        completedAt: task.finishedAt,
        errorMessage: task.errorMessage,
      };
    }

    for (const processingJob of input.processing.jobs) {
      const scopedTasks = input.processing.tasks.filter((task) => task.jobId === processingJob.jobId);
      const scopedUsage = scopedTasks.reduce<TokenUsageRecord>((total, task) => addTokenUsage(total, {
        prompt_tokens: task.inputTokens,
        completion_tokens: task.outputTokens,
        total_tokens: task.totalTokens,
        estimated: !task.finishedAt,
      }), emptyTokenUsage());
      jobs[processingJob.jobId] = {
        jobId: processingJob.jobId,
        bookId: processingJob.bookId || bookId,
        status: mapProcessingJobStatus(processingJob.status, processingJob.failedChunks, processingJob.completedChunks),
        stage: "generate",
        currentTargetId: scopedTasks.find((task) => task.status === "processing" || task.status === "waiting")?.chunkId,
        total: processingJob.totalChunks,
        completed: processingJob.completedChunks,
        failed: processingJob.failedChunks,
        skipped: processingJob.skippedChunks,
        promptVersion: processingJob.promptVersion || input.processing.promptVersion || novelPromptVersion,
        modelName: input.modelName ?? previous.jobs[processingJob.jobId]?.modelName,
        agentParams: {
          selectedChapterIds: processingJob.selectedChapterIds,
          maxConcurrency: processingJob.maxConcurrency,
          maxRetryCount: processingJob.maxRetryCount,
          outputFormat: processingJob.outputFormat,
          userInstruction: processingJob.userInstruction,
        },
        tokenUsage: scopedUsage,
        retryCount: scopedTasks.reduce((sum, task) => sum + task.retryCount, 0),
        errorMessage: scopedTasks.find((task) => task.errorMessage)?.errorMessage,
        createdAt: processingJob.createdAt,
        updatedAt: processingJob.finishedAt ?? nowIso(),
        heartbeatAt: processingJob.status === "processing" || processingJob.status === "waiting" ? nowIso() : previous.jobs[processingJob.jobId]?.heartbeatAt,
        startedAt: processingJob.startedAt,
        completedAt: processingJob.finishedAt,
      };
    }

    for (const chapter of input.processing.chapterSnapshots) {
      const chapterChunks = input.processing.chunks
        .filter((chunk) => chunk.chapterId === chapter.chapter_id)
        .sort((a, b) => a.indexInChapter - b.indexInChapter);
      const resultText = chapterChunks
        .map((chunk) => input.processing?.chunkResults[chunk.chunkId] ?? "")
        .filter(Boolean)
        .join("\n\n");
      const failedChunkIds = chapterChunks.filter((chunk) => mapProcessingStatus(processingTasksByChunkId.get(chunk.chunkId)?.status ?? chunk.status) !== "completed").map((chunk) => chunk.chunkId);
      const usage = chapterChunks.reduce((total, chunk) => addTokenUsage(total, chunkResults[chunk.chunkId]?.tokenUsage), emptyTokenUsage());
      chapterResults[chapter.chapter_id] = {
        chapterId: chapter.chapter_id,
        bookId,
        status: resultText && failedChunkIds.length === 0 ? "completed" : resultText ? "failed_partial" : failedChunkIds.length > 0 ? "failed" : "pending",
        title: chapter.title,
        resultText,
        summary: chapter.summary,
        continuityNotes: failedChunkIds.length > 0 ? [`failed chunks: ${failedChunkIds.join(", ")}`] : [],
        chunkIds: chapterChunks.map((chunk) => chunk.chunkId),
        sceneIds: [],
        tokenUsage: usage,
        generatedAt: resultText ? previous.chapterResults[chapter.chapter_id]?.generatedAt ?? nowIso() : previous.chapterResults[chapter.chapter_id]?.generatedAt,
        promptVersion: input.processing.promptVersion || novelPromptVersion,
        modelName: input.modelName ?? previous.chapterResults[chapter.chapter_id]?.modelName,
        retryCount: chapterChunks.reduce((sum, chunk) => sum + chunk.retryCount, 0),
        errorMessage: failedChunkIds.length > 0 ? `${failedChunkIds.length} chunk(s) failed or unfinished.` : undefined,
      };
    }
  }

  const completed = Object.values(tasks).filter((task) => task.jobId === jobId && task.status === "completed").length;
  const failed = Object.values(tasks).filter((task) => task.jobId === jobId && ["failed", "timeout_suspected"].includes(task.status)).length;
  const skipped = input.importJob?.skippedSceneIds?.length ?? 0;
  const existingJob = previous.jobs[jobId];
  const jobStatus = normalizeJobStatus(input.importJob?.status, input.session.ai_stage, failed, input.errors.length, completed);
  const job: PersistentNovelProcessJob = {
    jobId,
    bookId,
    status: jobStatus,
    stage: input.session.ai_stage,
    currentTargetId: currentTargetId(input.progress, input.session),
    total: input.importJob?.total ?? Math.max(input.session.chunks.length, input.session.scenes.length, input.session.chapters.length),
    completed,
    failed,
    skipped,
    promptVersion: novelPromptVersion,
    modelName: input.modelName ?? existingJob?.modelName,
    agentParams: { importOptions: input.session.import_options },
    tokenUsage,
    retryCount: existingJob?.retryCount ?? 0,
    errorMessage: input.errors[input.errors.length - 1] ?? existingJob?.errorMessage,
    createdAt: existingJob?.createdAt ?? input.session.created_at,
    updatedAt: nowIso(),
    heartbeatAt: input.progress ? nowIso() : existingJob?.heartbeatAt,
    startedAt: input.importJob?.startedAt ?? existingJob?.startedAt,
    completedAt: input.importJob?.completedAt ?? (jobStatus === "completed" ? existingJob?.completedAt ?? nowIso() : existingJob?.completedAt),
  };
  const events = buildDerivedJobEvents(previous.events, {
    job,
    bookId,
    chunks: chunkResults,
    chapters: chapterResults,
    errors: input.errors,
    warnings: input.warnings,
  });

  return {
    ...previous,
    sessionSnapshot: input.session,
    importJobSnapshot: input.importJob,
    progressSnapshot: input.progress,
    processingSnapshot: input.processing,
    inspectableResults: input.inspectableResults,
    errors: input.errors,
    warnings: input.warnings,
    books: { ...previous.books, [bookId]: bookRecordFromDocument(document, previous.books[bookId]) },
    activeBookId: bookId,
    chapters,
    chunks,
    jobs: { ...previous.jobs, ...jobs, [jobId]: job },
    activeJobId: input.processing?.activeJobId ?? jobId,
    tasks,
    chunkResults,
    chapterResults,
    events,
    updatedAt: nowIso(),
  };
}

function taskId(jobId: string, targetType: PersistentAgentTask["targetType"], targetId: string): string {
  return `${jobId}:${targetType}:${targetId}`;
}

function taskBase(
  jobId: string,
  bookId: string,
  targetType: PersistentAgentTask["targetType"],
  targetId: string,
  modelName: string | undefined,
  previous?: PersistentAgentTask,
): PersistentAgentTask {
  return {
    taskId: previous?.taskId ?? taskId(jobId, targetType, targetId),
    jobId,
    bookId,
    targetType,
    targetId,
    status: previous?.status ?? "pending",
    promptVersion: novelPromptVersion,
    modelName: modelName ?? previous?.modelName,
    agentParams: previous?.agentParams ?? {},
    retryCount: previous?.retryCount ?? 0,
    tokenUsage: previous?.tokenUsage ?? emptyTokenUsage(),
    startedAt: previous?.startedAt,
    updatedAt: nowIso(),
    heartbeatAt: previous?.heartbeatAt,
    completedAt: previous?.completedAt,
    errorMessage: previous?.errorMessage,
  };
}

function normalizeJobStatus(
  jobStatus: ProgressiveImportJob["status"] | undefined,
  stage: NovelImportSession["ai_stage"],
  failed: number,
  errorCount: number,
  completed: number,
): PersistentRecordStatus {
  if (jobStatus === "completed") return "completed";
  if (jobStatus === "paused") return "paused";
  if (jobStatus === "cancelled") return "cancelled";
  if (jobStatus === "running") return "running";
  if (failed > 0 || errorCount > 0) return completed > 0 ? "failed_partial" : "failed";
  if (stage === "landing") return "pending";
  return "waiting";
}

function mapProcessingStatus(status?: string): PersistentRecordStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "processing") return "running";
  if (status === "waiting") return "waiting";
  if (status === "cancelled" || status === "skipped") return "cancelled";
  if (status === "retrying") return "retrying";
  return "pending";
}

function mapProcessingJobStatus(status?: string, failed = 0, completed = 0): PersistentRecordStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return completed > 0 ? "failed_partial" : "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "processing") return failed > 0 ? "failed_partial" : "running";
  if (status === "waiting") return "waiting";
  return "pending";
}

function currentTargetId(progress: ProgressState | undefined, session: NovelImportSession): string | undefined {
  if (!progress) return undefined;
  if (progress.phase === "scan") return session.chunks[Math.max(0, progress.current - 1)]?.chunk_id;
  if (progress.phase === "planning") return session.chapters[progress.current]?.chapter_id;
  if (progress.phase === "blueprint") return session.scenes[progress.current]?.scene_candidate_id;
  return progress.phase;
}

export function sceneToText(adapted: AdaptedScene): string {
  const scene = adapted.scene_beat;
  const lines = scene.commands.flatMap(commandToTextLine).filter(Boolean);
  return [`### ${scene.title}`, scene.summary, ...lines].filter(Boolean).join("\n");
}

function commandToTextLine(command: GameCommand): string[] {
  if (command.type === "dialog") return [`${command.character_id}: ${command.text}`];
  if (command.type === "narration") return [command.text];
  if (command.type === "choice") return command.choices.map((choice) => `* ${choice.text}`);
  if (command.type === "show_image") {
    const label = command.image_display_name?.trim() || command.image_id;
    return [`[展示图片：${label}]${command.caption?.trim() ? ` ${command.caption.trim()}` : ""}`];
  }
  return [];
}

export function buildNovelResultExport(
  persistence: NovelPersistenceState,
  format: "txt" | "markdown",
  options: { includeAppendix?: boolean; completedOnly?: boolean } = {},
): string {
  const book = persistence.activeBookId ? persistence.books[persistence.activeBookId] : Object.values(persistence.books)[0];
  if (!book) return "";
  const chapters = Object.values(persistence.chapterResults)
    .filter((chapter) => chapter.bookId === book.bookId)
    .filter((chapter) => !options.completedOnly || chapter.status === "completed" || chapter.resultText.trim())
    .sort((a, b) => (persistence.chapters[a.chapterId]?.index ?? 0) - (persistence.chapters[b.chapterId]?.index ?? 0));
  const failed = chapters.filter((chapter) => chapter.status !== "completed");
  const tokenUsage = chapters.reduce((total, chapter) => addTokenUsage(total, chapter.tokenUsage), emptyTokenUsage());

  if (format === "markdown") {
    return [
      `# ${book.title}`,
      ...chapters.flatMap((chapter) => [`## ${chapter.title}`, chapter.resultText || `> ${chapter.status}`]),
      options.includeAppendix === false ? "" : [
        "## Appendix",
        `Total tokens: ${tokenUsage.total_tokens}${tokenUsage.estimated ? " (estimated)" : ""}`,
        failed.length ? `Failed or partial chapters: ${failed.map((chapter) => chapter.title).join(", ")}` : "Failed or partial chapters: none",
      ].join("\n\n"),
    ].filter(Boolean).join("\n\n");
  }

  return [
    book.title,
    ...chapters.flatMap((chapter) => [chapter.title, chapter.resultText || `[${chapter.status}]`]),
    options.includeAppendix === false ? "" : [
      "Appendix",
      `Total tokens: ${tokenUsage.total_tokens}${tokenUsage.estimated ? " (estimated)" : ""}`,
      failed.length ? `Failed or partial chapters: ${failed.map((chapter) => chapter.title).join(", ")}` : "Failed or partial chapters: none",
    ].join("\n"),
  ].filter(Boolean).join("\n\n");
}

export function findReusableBookByHash(persistence: NovelPersistenceState, document: SourceDocument): PersistentBookImportRecord | undefined {
  const hash = document.file_hash;
  if (!hash) return undefined;
  return Object.values(persistence.books).find((book) => book.fileHash === hash);
}

export function findSameNameDifferentHash(persistence: NovelPersistenceState, document: SourceDocument): PersistentBookImportRecord | undefined {
  const hash = document.file_hash;
  if (!hash) return undefined;
  return Object.values(persistence.books).find((book) => book.fileName === document.file_name && book.fileHash !== hash);
}

export function chunksMatchDocument(chunks: TextChunk[], document: SourceDocument): boolean {
  return chunks.length > 0 && chunks.every((chunk) =>
    chunk.document_id === document.document_id &&
    chunk.start_offset >= 0 &&
    chunk.end_offset <= document.normalized_text.length &&
    textHash(document.normalized_text.slice(chunk.start_offset, chunk.end_offset)) === textHash(chunk.text)
  );
}
