import type { ChapterCandidate } from "./types";
import { estimateTextTokens } from "../utils/contextBudget";

export type NovelProcessStatus = "unprocessed" | "waiting" | "processing" | "completed" | "failed" | "skipped" | "cancelled";
export type NovelProcessJobStatus = "waiting" | "processing" | "completed" | "failed" | "cancelled";

export interface NovelProcessingConfig {
  chunkThresholdChars: number;
  chunkTargetChars: number;
  chunkMaxChars: number;
  chunkOverlapChars: number;
  chunkMinChars: number;
  maxConcurrency: number;
  maxRetryCount: number;
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
  overlapBefore: string;
  overlapAfter: string;
  status: NovelProcessStatus;
  assignedAgentId?: string;
  resultId?: string;
  retryCount: number;
  anomalyFlags: string[];
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
  totalEstimatedTokens: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualTotalTokens: number;
  maxConcurrency: number;
  maxRetryCount: number;
  userInstruction: string;
  outputFormat: string;
  promptVersion: string;
  status: NovelProcessJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AgentTask {
  agentTaskId: string;
  jobId: string;
  chapterId: string;
  chunkId: string;
  agentIndex: number;
  status: NovelProcessStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
  retryCount: number;
  resultPreview?: string;
}

export interface NovelProcessingState {
  selectedChapterIds: string[];
  chapterSnapshots: ChapterCandidate[];
  chunks: ChunkRecord[];
  jobs: NovelProcessJob[];
  tasks: AgentTask[];
  chunkResults: Record<string, string>;
  activeJobId?: string;
  config: NovelProcessingConfig;
  userInstruction: string;
  outputFormat: string;
  promptVersion: string;
  restoredAt?: string;
  updatedAt?: string;
}

function chapterSelectionKey(chapterIds: string[]): string {
  return [...new Set(chapterIds)].sort().join("\u0000");
}

export function findMatchingNovelProcessJob(
  processing: NovelProcessingState,
  selectedChapterIds: string[],
): NovelProcessJob | undefined {
  if (selectedChapterIds.length === 0) return undefined;
  const selectionKey = chapterSelectionKey(selectedChapterIds);
  return [...processing.jobs]
    .reverse()
    .find((job) => chapterSelectionKey(job.selectedChapterIds) === selectionKey);
}

export function isNovelProcessJobActive(job?: NovelProcessJob): boolean {
  return job?.status === "waiting" || job?.status === "processing";
}

export const defaultNovelProcessingConfig: NovelProcessingConfig = {
  chunkThresholdChars: 12000,
  chunkTargetChars: 8000,
  chunkMaxChars: 12000,
  chunkOverlapChars: 500,
  chunkMinChars: 2000,
  maxConcurrency: 3,
  maxRetryCount: 2,
};

export const emptyNovelProcessingState: NovelProcessingState = {
  selectedChapterIds: [],
  chapterSnapshots: [],
  chunks: [],
  jobs: [],
  tasks: [],
  chunkResults: {},
  config: defaultNovelProcessingConfig,
  userInstruction: "",
  outputFormat: "visual_novel_blueprint",
  promptVersion: "novel-process-v3",
};

const quotePairs: Array<[string, string]> = [
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
  ["《", "》"],
  ["〈", "〉"],
  ["\"", "\""],
];

const sentenceBoundaryPattern = /[。！？!?…]+[”’」』》〉）)\]]*/g;
const paragraphBoundaryPattern = /\n{2,}/g;

export interface ChapterProcessingRow {
  chapter: ChapterCandidate;
  charCount: number;
  estimatedTokens: number;
  status: NovelProcessStatus;
  anomalyFlags: string[];
  volumeLabel: string;
  chunkCount: number;
  completedChunkCount: number;
  failedChunkCount: number;
}

export interface NovelProcessMergeResult {
  fullText: string;
  chapterTexts: Array<{ chapterId: string; title: string; text: string; failedChunkIds: string[] }>;
}

export function sanitizeNovelProcessingConfig(config?: Partial<NovelProcessingConfig>): NovelProcessingConfig {
  const next = { ...defaultNovelProcessingConfig, ...(config ?? {}) };
  const chunkMaxChars = clampInteger(next.chunkMaxChars, 4000, 60000, defaultNovelProcessingConfig.chunkMaxChars);
  const chunkMinChars = Math.min(
    clampInteger(next.chunkMinChars, 500, chunkMaxChars, defaultNovelProcessingConfig.chunkMinChars),
    Math.max(500, chunkMaxChars - 500),
  );
  const chunkTargetChars = clampInteger(next.chunkTargetChars, chunkMinChars, chunkMaxChars, defaultNovelProcessingConfig.chunkTargetChars);
  return {
    chunkThresholdChars: clampInteger(next.chunkThresholdChars, chunkMinChars, 120000, chunkMaxChars),
    chunkTargetChars,
    chunkMaxChars,
    chunkOverlapChars: clampInteger(next.chunkOverlapChars, 0, Math.min(4000, Math.floor(chunkTargetChars / 2)), defaultNovelProcessingConfig.chunkOverlapChars),
    chunkMinChars,
    maxConcurrency: clampInteger(next.maxConcurrency, 1, 10, defaultNovelProcessingConfig.maxConcurrency),
    maxRetryCount: clampInteger(next.maxRetryCount, 0, 10, defaultNovelProcessingConfig.maxRetryCount),
  };
}

export function estimateProcessTokens(text: string): number {
  return Math.max(1, estimateTextTokens(text));
}

export function createEmptyNovelProcessingState(seed?: Partial<NovelProcessingState>): NovelProcessingState {
  const promptVersion = seed?.promptVersion === "novel-process-v1" || seed?.promptVersion === "novel-process-v2"
    ? emptyNovelProcessingState.promptVersion
    : seed?.promptVersion ?? emptyNovelProcessingState.promptVersion;
  return {
    ...emptyNovelProcessingState,
    ...seed,
    selectedChapterIds: [...(seed?.selectedChapterIds ?? [])],
    chapterSnapshots: [...(seed?.chapterSnapshots ?? [])],
    chunks: [...(seed?.chunks ?? [])],
    jobs: [...(seed?.jobs ?? [])],
    tasks: [...(seed?.tasks ?? [])],
    chunkResults: { ...(seed?.chunkResults ?? {}) },
    config: sanitizeNovelProcessingConfig(seed?.config),
    userInstruction: seed?.userInstruction ?? emptyNovelProcessingState.userInstruction,
    outputFormat: seed?.outputFormat ?? emptyNovelProcessingState.outputFormat,
    promptVersion,
  };
}

export function deriveBookId(input: { projectId?: string; documentId?: string; sessionId?: string }): string {
  return input.documentId || input.projectId || input.sessionId || "book_local";
}

export function getChapterText(documentText: string, chapter: ChapterCandidate): string {
  const start = clampInteger(chapter.start_offset, 0, documentText.length, 0);
  const end = clampInteger(chapter.end_offset, start, documentText.length, documentText.length);
  return documentText.slice(start, end);
}

export function getChapterVolumeLabel(chapter: ChapterCandidate): string {
  const title = chapter.title.trim();
  const match = title.match(/(第\s*[零〇一二三四五六七八九十百千万\d]+\s*卷[^章节回]*)|(卷\s*[零〇一二三四五六七八九十百千万\d]+)|(Book\s+\d+)|(Volume\s+\d+)/i);
  return match?.[0]?.replace(/\s+/g, "") ?? "未分卷";
}

export function buildChapterProcessingRows(chapters: ChapterCandidate[], processing: NovelProcessingState): ChapterProcessingRow[] {
  return chapters.map((chapter) => {
    const chapterChunks = processing.chunks.filter((chunk) => chunk.chapterId === chapter.chapter_id);
    const anomalyFlags = Array.from(new Set([
      ...(chapter.confidence < 0.65 ? ["low_confidence"] : []),
      ...chapterChunks.flatMap((chunk) => chunk.anomalyFlags),
    ]));
    return {
      chapter,
      charCount: Math.max(0, chapter.end_offset - chapter.start_offset),
      estimatedTokens: estimateProcessTokens("x".repeat(Math.max(0, chapter.end_offset - chapter.start_offset))),
      status: getChapterProcessStatus(chapter.chapter_id, processing),
      anomalyFlags,
      volumeLabel: getChapterVolumeLabel(chapter),
      chunkCount: chapterChunks.length,
      completedChunkCount: chapterChunks.filter((chunk) => chunk.status === "completed").length,
      failedChunkCount: chapterChunks.filter((chunk) => chunk.status === "failed").length,
    };
  });
}

export function getChapterProcessStatus(chapterId: string, processing: Pick<NovelProcessingState, "chunks">): NovelProcessStatus {
  const chunks = processing.chunks.filter((chunk) => chunk.chapterId === chapterId);
  if (chunks.length === 0) return "unprocessed";
  if (chunks.every((chunk) => chunk.status === "completed")) return "completed";
  if (chunks.every((chunk) => chunk.status === "skipped")) return "skipped";
  if (chunks.every((chunk) => chunk.status === "cancelled")) return "cancelled";
  if (chunks.some((chunk) => chunk.status === "failed")) return "failed";
  if (chunks.some((chunk) => chunk.status === "processing")) return "processing";
  if (chunks.some((chunk) => chunk.status === "waiting")) return "waiting";
  return "unprocessed";
}

export function buildInitialChapterSelection(chapters: ChapterCandidate[], previousSelection: string[] = []): string[] {
  const chapterIds = new Set(chapters.map((chapter) => chapter.chapter_id));
  const retained = previousSelection.filter((chapterId) => chapterIds.has(chapterId));
  return retained.length > 0 ? retained : chapters.map((chapter) => chapter.chapter_id);
}

export function createChunksForSelectedChapters(input: {
  bookId: string;
  documentText: string;
  chapters: ChapterCandidate[];
  selectedChapterIds: string[];
  config?: Partial<NovelProcessingConfig>;
}): ChunkRecord[] {
  const config = sanitizeNovelProcessingConfig(input.config);
  const selected = new Set(input.selectedChapterIds);
  const chunks: ChunkRecord[] = [];
  let globalIndex = 0;

  for (const chapter of input.chapters.filter((item) => selected.has(item.chapter_id)).sort((a, b) => a.index - b.index)) {
    const chapterText = getChapterText(input.documentText, chapter);
    const chapterStart = Math.max(0, Math.min(input.documentText.length, chapter.start_offset));
    const segments = chapterText.length > config.chunkThresholdChars
      ? splitChapterTextIntoSegments(chapterText, config)
      : [{ start: 0, end: chapterText.length, anomalyFlags: [] }];

    segments.forEach((segment, indexInChapter) => {
      const startOffset = chapterStart + segment.start;
      const endOffset = chapterStart + segment.end;
      const primaryText = input.documentText.slice(startOffset, endOffset);
      const overlapBefore = input.documentText.slice(
        Math.max(chapterStart, startOffset - config.chunkOverlapChars),
        startOffset,
      );
      const overlapAfter = input.documentText.slice(
        endOffset,
        Math.min(chapterStart + chapterText.length, endOffset + config.chunkOverlapChars),
      );
      chunks.push({
        chunkId: createProcessingId("chunk"),
        chapterId: chapter.chapter_id,
        bookId: input.bookId,
        indexInChapter,
        globalIndex,
        startOffset,
        endOffset,
        charCount: Math.max(0, endOffset - startOffset),
        estimatedTokens: estimateProcessTokens(`${overlapBefore}${primaryText}${overlapAfter}`),
        overlapBefore,
        overlapAfter,
        status: "waiting",
        retryCount: 0,
        anomalyFlags: segment.anomalyFlags,
      });
      globalIndex += 1;
    });
  }

  return chunks;
}

export function createNovelProcessJob(input: {
  bookId: string;
  selectedChapterIds: string[];
  chunks: ChunkRecord[];
  config?: Partial<NovelProcessingConfig>;
  userInstruction?: string;
  outputFormat?: string;
  promptVersion?: string;
  now?: string;
}): NovelProcessJob {
  const config = sanitizeNovelProcessingConfig(input.config);
  const now = input.now ?? new Date().toISOString();
  return {
    jobId: createProcessingId("job"),
    bookId: input.bookId,
    selectedChapterIds: [...input.selectedChapterIds],
    totalChapters: input.selectedChapterIds.length,
    totalChunks: input.chunks.length,
    completedChunks: input.chunks.filter((chunk) => chunk.status === "completed").length,
    failedChunks: input.chunks.filter((chunk) => chunk.status === "failed").length,
    skippedChunks: input.chunks.filter((chunk) => chunk.status === "skipped").length,
    totalEstimatedTokens: input.chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0),
    actualInputTokens: 0,
    actualOutputTokens: 0,
    actualTotalTokens: 0,
    maxConcurrency: config.maxConcurrency,
    maxRetryCount: config.maxRetryCount,
    userInstruction: input.userInstruction ?? "",
    outputFormat: input.outputFormat ?? "visual_novel_blueprint",
    promptVersion: input.promptVersion ?? "novel-process-v3",
    status: input.chunks.length > 0 ? "processing" : "waiting",
    createdAt: now,
    startedAt: input.chunks.length > 0 ? now : undefined,
  };
}

export function createAgentTasksForJob(input: {
  job: NovelProcessJob;
  chunks: ChunkRecord[];
  now?: string;
}): AgentTask[] {
  const now = input.now ?? new Date().toISOString();
  return input.chunks.map((chunk) => {
    const isDispatched = chunk.globalIndex < input.job.maxConcurrency;
    return {
      agentTaskId: createProcessingId("agent_task"),
      jobId: input.job.jobId,
      chapterId: chunk.chapterId,
      chunkId: chunk.chunkId,
      agentIndex: chunk.globalIndex % input.job.maxConcurrency,
      status: isDispatched ? "processing" : "waiting",
      inputTokens: chunk.estimatedTokens,
      outputTokens: 0,
      totalTokens: chunk.estimatedTokens,
      startedAt: isDispatched ? now : undefined,
      retryCount: 0,
    };
  });
}

export function initializeChunkDispatch(chunks: ChunkRecord[], job: NovelProcessJob): ChunkRecord[] {
  return chunks.map((chunk) => (
    chunk.globalIndex < job.maxConcurrency
      ? { ...chunk, status: "processing", assignedAgentId: `agent_${chunk.globalIndex % job.maxConcurrency}` }
      : { ...chunk, status: "waiting" }
  ));
}

export function refreshJobProgress(job: NovelProcessJob, chunks: ChunkRecord[]): NovelProcessJob {
  const scoped = chunks.filter((chunk) => chunk.bookId === job.bookId && job.selectedChapterIds.includes(chunk.chapterId));
  const completedChunks = scoped.filter((chunk) => chunk.status === "completed").length;
  const failedChunks = scoped.filter((chunk) => chunk.status === "failed").length;
  const skippedChunks = scoped.filter((chunk) => chunk.status === "skipped").length;
  const finished = scoped.length > 0 && completedChunks + failedChunks + skippedChunks === scoped.length;
  return {
    ...job,
    totalChunks: scoped.length,
    completedChunks,
    failedChunks,
    skippedChunks,
    status: failedChunks > 0 ? "failed" : finished ? "completed" : job.status,
    finishedAt: finished ? job.finishedAt ?? new Date().toISOString() : job.finishedAt,
  };
}

export function retryAgentTaskInState(processing: NovelProcessingState, agentTaskId: string): NovelProcessingState {
  const task = processing.tasks.find((item) => item.agentTaskId === agentTaskId);
  const job = task ? processing.jobs.find((item) => item.jobId === task.jobId) : undefined;
  if (!task || !job || task.status === "completed" || task.retryCount >= job.maxRetryCount) return processing;
  const updatedAt = new Date().toISOString();
  const tasks = processing.tasks.map((item) => item.agentTaskId === agentTaskId ? {
    ...item,
    status: "waiting" as NovelProcessStatus,
    retryCount: item.retryCount + 1,
    startedAt: undefined,
    finishedAt: undefined,
  } : item);
  const chunks = processing.chunks.map((chunk) => chunk.chunkId === task.chunkId ? {
    ...chunk,
    status: "waiting" as NovelProcessStatus,
    retryCount: chunk.retryCount + 1,
  } : chunk);
  const jobs = processing.jobs.map((item) => item.jobId === task.jobId ? refreshJobProgress({ ...item, status: "processing", finishedAt: undefined }, chunks) : item);
  return { ...processing, tasks, chunks, jobs, updatedAt };
}

export function retryFailedAgentTasksInState(processing: NovelProcessingState): NovelProcessingState {
  return processing.tasks
    .filter((task) => task.status === "failed")
    .reduce((current, task) => retryAgentTaskInState(current, task.agentTaskId), processing);
}

export function markAgentTaskFailedInState(processing: NovelProcessingState, agentTaskId: string, errorMessage: string): NovelProcessingState {
  const task = processing.tasks.find((item) => item.agentTaskId === agentTaskId);
  if (!task || task.status === "completed") return processing;
  const finishedAt = new Date().toISOString();
  const tasks = processing.tasks.map((item) => item.agentTaskId === agentTaskId ? {
    ...item,
    status: "failed" as NovelProcessStatus,
    errorMessage,
    finishedAt,
  } : item);
  const chunks = processing.chunks.map((chunk) => chunk.chunkId === task.chunkId ? { ...chunk, status: "failed" as NovelProcessStatus } : chunk);
  const jobs = processing.jobs.map((job) => job.jobId === task.jobId ? refreshJobProgress(job, chunks) : job);
  return { ...processing, tasks, chunks, jobs, updatedAt: finishedAt };
}

export function setChunkResultInState(processing: NovelProcessingState, chunkId: string, result: string, tokenUsage?: { inputTokens?: number; outputTokens?: number }): NovelProcessingState {
  const resultId = createProcessingId("result");
  const finishedAt = new Date().toISOString();
  const chunk = processing.chunks.find((item) => item.chunkId === chunkId);
  if (!chunk) return processing;
  const chunks = processing.chunks.map((item) => item.chunkId === chunkId ? { ...item, status: "completed" as NovelProcessStatus, resultId } : item);
  const tasks = processing.tasks.map((task) => task.chunkId === chunkId ? {
    ...task,
    status: "completed" as NovelProcessStatus,
    outputTokens: tokenUsage?.outputTokens ?? estimateProcessTokens(result),
    inputTokens: tokenUsage?.inputTokens ?? task.inputTokens,
    totalTokens: (tokenUsage?.inputTokens ?? task.inputTokens) + (tokenUsage?.outputTokens ?? estimateProcessTokens(result)),
    finishedAt,
    resultPreview: result.slice(0, 180),
  } : task);
  const jobs = processing.jobs.map((job) => job.selectedChapterIds.includes(chunk.chapterId) ? refreshJobProgress(job, chunks) : job);
  return {
    ...processing,
    chunks,
    tasks,
    jobs,
    chunkResults: { ...processing.chunkResults, [chunkId]: result },
    updatedAt: finishedAt,
  };
}

export function mergeNovelProcessResults(input: {
  chapters: ChapterCandidate[];
  chunks: ChunkRecord[];
  chunkResults: Record<string, string>;
  tasks?: AgentTask[];
}): NovelProcessMergeResult {
  const tasksByChunkId = new Map((input.tasks ?? []).map((task) => [task.chunkId, task]));
  const chapterTexts = input.chapters
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((chapter) => {
      const chunks = input.chunks
        .filter((chunk) => chunk.chapterId === chapter.chapter_id)
        .sort((a, b) => a.indexInChapter - b.indexInChapter);
      const failedChunkIds: string[] = [];
      const merged = chunks.reduce((text, chunk) => {
        const result = input.chunkResults[chunk.chunkId];
        if (result === undefined) {
          if (chunk.status === "failed") failedChunkIds.push(chunk.chunkId);
          return text;
        }
        return appendWithoutDuplicateOverlap(text, result);
      }, "");
      const failedNote = failedChunkIds.length > 0
        ? `\n\n[${failedChunkIds.length} 个 chunk 失败，已隐藏失败片段：${failedChunkIds.map((id) => tasksByChunkId.get(id)?.errorMessage ? `${id}` : id).join(", ")}]`
        : "";
      const chapterText = [`# ${chapter.title}`, merged.trim(), failedNote.trim()].filter(Boolean).join("\n\n");
      return { chapterId: chapter.chapter_id, title: chapter.title, text: chapterText, failedChunkIds };
    });
  return {
    chapterTexts,
    fullText: chapterTexts.map((chapter) => chapter.text).filter(Boolean).join("\n\n"),
  };
}

export function appendWithoutDuplicateOverlap(previous: string, next: string): string {
  const left = previous.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;
  const max = Math.min(2000, left.length, right.length);
  for (let size = max; size >= 20; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return `${left}${right.slice(size)}`;
    }
  }
  return `${left}\n\n${right}`;
}

interface Segment {
  start: number;
  end: number;
  anomalyFlags: string[];
}

function splitChapterTextIntoSegments(text: string, config: NovelProcessingConfig): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const remaining = text.length - cursor;
    if (remaining <= config.chunkMaxChars) {
      if (remaining < config.chunkMinChars && segments.length > 0) {
        const previous = segments[segments.length - 1];
        if (remaining + (previous.end - previous.start) <= config.chunkMaxChars) {
          previous.end = text.length;
          previous.anomalyFlags = Array.from(new Set([...previous.anomalyFlags, ...(remaining < config.chunkMinChars ? ["merged_short_tail"] : [])]));
          break;
        }
      }
      segments.push({ start: cursor, end: text.length, anomalyFlags: remaining < config.chunkMinChars && segments.length > 0 ? ["below_min_chars"] : [] });
      break;
    }

    const cut = chooseSplitOffset(text, cursor, config);
    const end = Math.max(cursor + 1, Math.min(text.length, cut.offset));
    segments.push({ start: cursor, end, anomalyFlags: cut.anomalyFlags });
    cursor = end;
  }
  return segments.map((segment, index) => ({ ...segment, anomalyFlags: index === 0 ? segment.anomalyFlags : segment.anomalyFlags.filter((flag) => flag !== "below_min_chars") }));
}

function chooseSplitOffset(text: string, cursor: number, config: NovelProcessingConfig): { offset: number; anomalyFlags: string[] } {
  const min = Math.min(text.length, cursor + config.chunkMinChars);
  const target = Math.min(text.length, cursor + config.chunkTargetChars);
  const max = Math.min(text.length, cursor + config.chunkMaxChars);
  const paragraphCandidates = collectBoundaryOffsets(text, paragraphBoundaryPattern, min, max)
    .filter((offset) => !isInsideQuote(text.slice(cursor, offset)));
  const sentenceCandidates = collectBoundaryOffsets(text, sentenceBoundaryPattern, min, max)
    .filter((offset) => !isInsideQuote(text.slice(cursor, offset)));

  const paragraphCut = chooseNearestCandidate(paragraphCandidates, target);
  if (paragraphCut !== undefined) return { offset: paragraphCut, anomalyFlags: [] };

  const sentenceCut = chooseNearestCandidate(sentenceCandidates, target);
  if (sentenceCut !== undefined) return { offset: sentenceCut, anomalyFlags: [] };

  const unsafeSentenceCut = chooseNearestCandidate(collectBoundaryOffsets(text, sentenceBoundaryPattern, min, max), target);
  if (unsafeSentenceCut !== undefined) return { offset: unsafeSentenceCut, anomalyFlags: ["quote_boundary_uncertain"] };

  const hardOffset = target > cursor ? target : max;
  const anomalyFlags = ["hard_cut"];
  if (isInsideQuote(text.slice(cursor, hardOffset))) anomalyFlags.push("cut_inside_quote");
  return { offset: hardOffset, anomalyFlags };
}

function collectBoundaryOffsets(text: string, pattern: RegExp, min: number, max: number): number[] {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const offsets: number[] = [];
  for (const match of text.matchAll(regex)) {
    const end = (match.index ?? 0) + match[0].length;
    if (end >= min && end <= max) offsets.push(end);
  }
  return offsets;
}

function chooseNearestCandidate(candidates: number[], target: number): number | undefined {
  if (candidates.length === 0) return undefined;
  return candidates
    .slice()
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || b - a)[0];
}

function isInsideQuote(text: string): boolean {
  for (const [open, close] of quotePairs) {
    if (open === close) {
      const count = countUnescaped(text, open);
      if (count % 2 !== 0) return true;
      continue;
    }
    const openCount = countChar(text, open);
    const closeCount = countChar(text, close);
    if (openCount > closeCount) return true;
  }
  return false;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const item of text) if (item === char) count += 1;
  return count;
}

function countUnescaped(text: string, char: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === char && text[index - 1] !== "\\") count += 1;
  }
  return count;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function createProcessingId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
