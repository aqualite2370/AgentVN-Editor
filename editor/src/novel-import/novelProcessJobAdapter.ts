import type {
  NovelProcessAgentProgress,
  NovelProcessAgentStatus,
  NovelProcessChapterProgress,
  NovelProcessEvent,
  NovelProcessEventLevel,
  NovelProcessEventType,
  NovelProcessPhaseProgress,
  NovelProcessJob,
  NovelProcessJobStatus,
  NovelProcessQualityDimension,
  NovelProcessTaskSnapshot,
  NovelProcessTokenBreakdown,
  NovelProcessTokenStats,
} from "./processJobTypes";
import type {
  NovelAiInspectableResult,
  NovelImportSession,
  ProgressState,
  ProgressiveImportJob,
  SceneCandidate,
  TextChunk,
} from "./types";
import type { AgentTask, ChunkRecord, NovelProcessJob as LocalNovelProcessJob, NovelProcessingState } from "./novelProcessing";
import { estimateTokensFromCjkCharCount } from "../utils/contextBudget";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export const novelProcessTaskSnapshotKey = "agentvn.novelProcessTaskWorkbench.snapshot";

export interface NovelProcessMockInput {
  projectId: string;
  projectTitle: string;
  session: NovelImportSession;
  importJob?: ProgressiveImportJob;
  progress?: ProgressState;
  errors: string[];
  warnings: string[];
  inspectableResults: NovelAiInspectableResult[];
  isProcessing: boolean;
  processing?: NovelProcessingState;
}

function projectSnapshotKey(projectId: string): string {
  return `${novelProcessTaskSnapshotKey}.${encodeURIComponent(projectId || "project_local")}`;
}

function normalizeSnapshotForProject(snapshot: NovelProcessTaskSnapshot, projectId: string): NovelProcessTaskSnapshot | undefined {
  if (!snapshot?.job?.jobId || !Array.isArray(snapshot.events)) return undefined;
  if (snapshot.projectId && snapshot.projectId !== projectId) return undefined;
  return { ...snapshot, projectId };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: number | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function eventTime(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function estimatedSceneTokens(scene: SceneCandidate): number {
  const sourceLength = finiteNumber(scene.end_offset) - finiteNumber(scene.start_offset);
  const excerptLength = scene.source_excerpt?.length ?? 0;
  return Math.max(420, estimateTokensFromCjkCharCount(Math.max(sourceLength, excerptLength, 1000)));
}

function textChunkEstimate(chunks: TextChunk[]): number {
  return chunks.reduce((total, chunk) => total + finiteNumber(chunk.estimated_tokens), 0);
}

function latestOutputPreview(results: NovelAiInspectableResult[], fallback: string): string {
  const latest = [...results].reverse().find((item) => item.summary?.trim() || item.error?.trim());
  if (!latest) return fallback;
  return latest.error?.trim() || latest.summary.trim();
}

function statusFromImportState(input: NovelProcessMockInput): NovelProcessJobStatus | undefined {
  const { importJob, progress, errors, isProcessing } = input;
  if (!importJob && !progress) return undefined;
  if (importJob?.cancelRequested || importJob?.status === "cancelled") return "cancelled";
  if (importJob?.pauseRequested || importJob?.status === "paused") {
    return errors.length > 0 ? "failed_partial" : "paused";
  }
  if (importJob?.status === "completed") return "completed";
  if (importJob?.status === "running" || isProcessing || progress) return "running";
  return importJob?.status === "idle" ? "waiting" : undefined;
}

function buildChapterRows(session: NovelImportSession, totalChunks: number, completedChunks: number, failedChunks: number): NovelProcessChapterProgress[] {
  const chapters = session.chapters.length > 0
    ? session.chapters
    : [{
      chapter_id: session.document?.document_id ?? "chapter_mock_0",
      index: 0,
      title: session.document?.title ?? "待拆分章节",
      start_offset: 0,
      end_offset: session.document?.total_chars ?? 0,
      summary: "",
      confidence: 1,
    }];
  const chunksPerChapter = Math.max(1, Math.ceil(totalChunks / chapters.length));
  let remainingCompleted = completedChunks;
  let remainingFailed = failedChunks;
  return chapters.map((chapter) => {
    const chapterScenes = session.scenes.filter((scene) => scene.chapter_id === chapter.chapter_id);
    const chapterChunks = Math.max(1, chapterScenes.length || chunksPerChapter);
    const done = Math.min(chapterChunks, remainingCompleted);
    remainingCompleted = Math.max(0, remainingCompleted - done);
    const failed = Math.min(Math.max(0, chapterChunks - done), remainingFailed);
    remainingFailed = Math.max(0, remainingFailed - failed);
    const sceneTokenSum = chapterScenes.reduce((total, scene) => total + estimatedSceneTokens(scene), 0);
    const estimatedTokens = Math.max(600, sceneTokenSum || estimateTokensFromCjkCharCount(chapter.end_offset - chapter.start_offset));
    const inputTokens = Math.round(estimatedTokens * (done / chapterChunks) * 0.62);
    const outputTokens = Math.round(estimatedTokens * (done / chapterChunks) * 0.38);
    return {
      chapterId: chapter.chapter_id,
      chapterIndex: chapter.index,
      title: chapter.title || `第 ${chapter.index + 1} 章`,
      totalChunks: chapterChunks,
      completedChunks: done,
      failedChunks: failed,
      inputTokens,
      outputTokens,
      estimatedTokens,
    };
  });
}

function buildTokenStats(chapters: NovelProcessChapterProgress[], agentRows: NovelProcessAgentProgress[], totalChunks: number, retryExtraTokens: number): NovelProcessTokenStats {
  const byChapter: NovelProcessTokenBreakdown[] = chapters.map((chapter) => {
    const inputTokens = chapter.inputTokens;
    const outputTokens = chapter.outputTokens;
    return {
      id: chapter.chapterId,
      label: chapter.title,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedTokens: chapter.estimatedTokens,
      retryExtraTokens: Math.round(retryExtraTokens / Math.max(1, chapters.length)),
      chunkCount: chapter.totalChunks,
    };
  });
  const byAgent: NovelProcessTokenBreakdown[] = agentRows.map((agent) => ({
    id: agent.agentTaskId,
    label: `处理槽 ${agent.agentIndex + 1}`,
    inputTokens: agent.inputTokens,
    outputTokens: agent.outputTokens,
    totalTokens: agent.totalTokens,
    estimatedTokens: Math.max(1, Math.round(agent.totalTokens * 1.12)),
    retryExtraTokens: Math.round(agent.retryCount * 420),
    chunkCount: Math.max(1, agent.currentChunkTotal),
  }));
  const estimatedTokens = byChapter.reduce((total, item) => total + item.estimatedTokens, 0);
  const totalInputTokens = Math.max(
    byChapter.reduce((total, item) => total + item.inputTokens, 0),
    agentRows.reduce((total, item) => total + item.inputTokens, 0),
  );
  const totalOutputTokens = Math.max(
    byChapter.reduce((total, item) => total + item.outputTokens, 0),
    agentRows.reduce((total, item) => total + item.outputTokens, 0),
  );
  const totalTokens = totalInputTokens + totalOutputTokens + retryExtraTokens;
  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    estimatedTokens,
    actualTokens: totalTokens,
    averageChunkTokens: Math.round(totalTokens / Math.max(1, totalChunks)),
    retryExtraTokens,
    byAgent,
    byChapter,
  };
}

function buildPhaseProgress(status: NovelProcessJobStatus, completedChunks: number, totalChunks: number, updatedAt: string): NovelProcessPhaseProgress[] {
  const finished = clamp(completedChunks, 0, Math.max(1, totalChunks));
  const chunkPercent = Math.round((finished / Math.max(1, totalChunks)) * 100);
  const completed = status === "completed";
  const failed = status === "failed" || status === "failed_partial";
  return [
    {
      phase: "chunk_parse",
      label: "切片解析",
      status: chunkPercent >= 100 ? "completed" : status === "paused" ? "paused" : status === "retrying" ? "retrying" : failed ? "failed" : "running",
      current: finished,
      total: Math.max(1, totalChunks),
      percent: chunkPercent,
      updatedAt,
      etaMs: chunkPercent < 100 ? Math.max(0, totalChunks - finished) * 12_000 : null,
      blockingReason: failed ? "本地恢复快照含失败项，需要重试或复核。" : null,
    },
    { phase: "chapter_merge", label: "章节合并", status: completed ? "completed" : "waiting", current: completed ? 1 : 0, total: 1, percent: completed ? 100 : 0, updatedAt },
    { phase: "continuity_review", label: "连续性复核", status: completed ? "completed" : "waiting", current: completed ? 1 : 0, total: 1, percent: completed ? 100 : 0, updatedAt },
    { phase: "import_write", label: "写入蓝图", status: completed ? "completed" : "waiting", current: completed ? 1 : 0, total: 1, percent: completed ? 100 : 0, updatedAt },
    { phase: "validation", label: "结构校验", status: failed ? "blocked" : completed ? "completed" : "waiting", current: completed ? 1 : 0, total: 1, percent: completed ? 100 : 0, updatedAt, blockingReason: failed ? "失败项未清理前不能视为最终通过。" : null },
  ];
}

function buildQualityDimensions(completedChunks: number, totalChunks: number, failedChunks: number, hasMockSource: boolean): NovelProcessQualityDimension[] {
  const coverage = Math.round((completedChunks / Math.max(1, totalChunks)) * 100);
  const lowRisk = failedChunks > 0 ? 35 : 100;
  const sourceTrust = hasMockSource ? 50 : 100;
  const rows = [
    { key: "source_coverage", label: "原文覆盖", value: `${completedChunks}/${Math.max(1, totalChunks)}`, score: coverage },
    { key: "structured_scenes", label: "结构化场景", value: `${completedChunks}/${Math.max(1, totalChunks)}`, score: Math.max(0, Math.min(100, coverage - failedChunks * 12)) },
    { key: "low_quality_text", label: "低质文本风险", value: failedChunks > 0 ? `${failedChunks}` : "0", score: lowRisk },
    { key: "data_source", label: "数据源可信度", value: hasMockSource ? "mock" : "api", score: sourceTrust },
  ];
  return rows.map((row) => ({
    ...row,
    status: row.score >= 85 ? "good" : row.score >= 60 ? "warning" : "danger",
  }));
}

function mapLocalJobStatus(job: LocalNovelProcessJob): NovelProcessJobStatus {
  if (job.status === "waiting") return "waiting";
  if (job.status === "processing") return job.failedChunks > 0 ? "failed_partial" : "running";
  if (job.status === "completed") return "completed";
  if (job.status === "cancelled") return "cancelled";
  return job.completedChunks > 0 ? "failed_partial" : "failed";
}

function localAgentStatus(task?: AgentTask): NovelProcessAgentStatus {
  if (!task) return "waiting";
  if (task.status === "processing") return "running";
  if (task.status === "skipped") return "cancelled";
  if (task.status === "unprocessed") return "waiting";
  return task.status;
}

function buildProcessingChapterRows(processing: NovelProcessingState, job: LocalNovelProcessJob, chunks: ChunkRecord[]): NovelProcessChapterProgress[] {
  const selected = new Set(job.selectedChapterIds);
  const chapters = processing.chapterSnapshots.filter((chapter) => selected.has(chapter.chapter_id));
  return chapters.map((chapter) => {
    const chapterChunks = chunks.filter((chunk) => chunk.chapterId === chapter.chapter_id);
    const completedChunks = chapterChunks.filter((chunk) => chunk.status === "completed").length;
    const failedChunks = chapterChunks.filter((chunk) => chunk.status === "failed").length;
    const chapterTasks = processing.tasks.filter((task) => task.jobId === job.jobId && task.chapterId === chapter.chapter_id);
    const inputTokens = chapterTasks.reduce((total, task) => total + task.inputTokens, 0);
    const outputTokens = chapterTasks.reduce((total, task) => total + task.outputTokens, 0);
    return {
      chapterId: chapter.chapter_id,
      chapterIndex: chapter.index,
      title: chapter.title,
      totalChunks: Math.max(1, chapterChunks.length),
      completedChunks,
      failedChunks,
      inputTokens,
      outputTokens,
      estimatedTokens: chapterChunks.reduce((total, chunk) => total + chunk.estimatedTokens, 0),
    };
  });
}

function buildProcessingAgents(processing: NovelProcessingState, job: LocalNovelProcessJob): NovelProcessAgentProgress[] {
  const agentCount = Math.max(1, job.maxConcurrency);
  return Array.from({ length: agentCount }, (_, agentIndex) => {
    const agentTasks = processing.tasks.filter((task) => task.jobId === job.jobId && task.agentIndex === agentIndex);
    const activeTask = agentTasks.find((task) => task.status === "processing" || task.status === "failed" || task.status === "waiting") ?? agentTasks[agentTasks.length - 1];
    const chapter = activeTask ? processing.chapterSnapshots.find((item) => item.chapter_id === activeTask.chapterId) : undefined;
    const chunk = activeTask ? processing.chunks.find((item) => item.chunkId === activeTask.chunkId) : undefined;
    const completedCount = agentTasks.filter((task) => task.status === "completed").length;
    const status = localAgentStatus(activeTask);
    const inputTokens = agentTasks.reduce((total, task) => total + task.inputTokens, 0);
    const outputTokens = agentTasks.reduce((total, task) => total + task.outputTokens, 0);
    const totalAgentChunks = Math.max(1, agentTasks.length);
    return {
      agentTaskId: activeTask?.agentTaskId ?? `agent_${job.jobId}_${agentIndex}`,
      agentIndex,
      status,
      currentChapterTitle: chapter?.title ?? "等待分配章节",
      currentChunkIndex: chunk ? chunk.indexInChapter + 1 : Math.max(1, completedCount),
      currentChunkTotal: Math.max(1, processing.chunks.filter((item) => item.chapterId === activeTask?.chapterId).length || totalAgentChunks),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      elapsedMs: Date.now() - new Date(activeTask?.startedAt ?? job.startedAt ?? job.createdAt).getTime(),
      retryCount: agentTasks.reduce((total, task) => total + task.retryCount, 0),
      outputPreview: activeTask?.resultPreview || activeTask?.errorMessage || "等待切片处理槽输出预览。",
      progressPercent: Math.round((completedCount / totalAgentChunks) * 100),
      heartbeatAt: activeTask?.finishedAt ?? activeTask?.startedAt ?? job.startedAt ?? job.createdAt,
    };
  });
}

function buildProcessingEvents(processing: NovelProcessingState, job: LocalNovelProcessJob, status: NovelProcessJobStatus): NovelProcessEvent[] {
  const events: NovelProcessEvent[] = [{
    eventId: `${job.jobId}_created`,
    jobId: job.jobId,
    type: "job_created",
    level: "info",
    createdAt: job.createdAt,
    title: "任务创建",
    message: `已创建 ${job.totalChunks} 个切片，最大并发 ${job.maxConcurrency}。`,
    payload: { selectedChapterIds: job.selectedChapterIds, outputFormat: job.outputFormat },
  }];

  for (const task of processing.tasks.filter((item) => item.jobId === job.jobId).slice(-48)) {
    const level: NovelProcessEventLevel = task.status === "failed" ? "error" : task.status === "completed" ? "success" : "info";
    const type: NovelProcessEventType = task.status === "failed" ? "agent_failed" : task.status === "completed" ? "agent_completed" : task.status === "processing" ? "agent_started" : "agent_output_updated";
    events.push({
      eventId: `${job.jobId}_${task.agentTaskId}_${task.status}_${task.finishedAt ?? task.startedAt ?? job.createdAt}`,
      jobId: job.jobId,
      type,
      level,
      createdAt: task.finishedAt ?? task.startedAt ?? job.createdAt,
      title: `处理槽 ${task.agentIndex + 1}`,
      message: task.errorMessage || task.resultPreview || `切片 ${task.chunkId} 状态：${task.status}`,
      agentTaskId: task.agentTaskId,
      chapterId: task.chapterId,
      chunkId: task.chunkId,
      payload: task,
    });
  }

  if (status === "completed") {
    events.push({
      eventId: `${job.jobId}_completed`,
      jobId: job.jobId,
      type: "job_completed",
      level: "success",
      createdAt: job.finishedAt ?? nowIso(),
      title: "任务完成",
      message: "所有切片已完成处理。",
    });
  }

  return events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 50);
}

function createProcessingSnapshot(input: NovelProcessMockInput): NovelProcessTaskSnapshot | undefined {
  const processing = input.processing;
  if (!processing) return undefined;
  const localJob = (processing.activeJobId
    ? processing.jobs.find((job) => job.jobId === processing.activeJobId)
    : undefined) ?? processing.jobs[processing.jobs.length - 1];
  if (!localJob) return undefined;
  const chunks = processing.chunks.filter((chunk) => chunk.bookId === localJob.bookId && localJob.selectedChapterIds.includes(chunk.chapterId));
  const status = mapLocalJobStatus(localJob);
  const completedChunks = chunks.filter((chunk) => chunk.status === "completed").length;
  const failedChunks = chunks.filter((chunk) => chunk.status === "failed").length;
  const cancelledChunks = chunks.filter((chunk) => chunk.status === "cancelled" || chunk.status === "skipped").length;
  const finishedChunks = completedChunks + failedChunks + cancelledChunks;
  const chapters = buildProcessingChapterRows(processing, localJob, chunks);
  const agents = buildProcessingAgents(processing, localJob);
  const retryExtraTokens = agents.reduce((total, agent) => total + agent.retryCount * 320, 0);
  const tokenStats = buildTokenStats(chapters, agents, Math.max(1, localJob.totalChunks), retryExtraTokens);
  const job: NovelProcessJob = {
    jobId: localJob.jobId,
    bookId: localJob.bookId,
    novelTitle: input.session.document?.title || input.projectTitle || "未命名小说",
    status,
    selectedChapterCount: localJob.totalChapters,
    totalChunks: Math.max(1, localJob.totalChunks),
    completedChunks,
    failedChunks,
    cancelledChunks,
    runningAgentCount: agents.filter((agent) => agent.status === "running" || agent.status === "retrying").length,
    estimatedRemainingChunks: Math.max(0, localJob.totalChunks - finishedChunks),
    phaseProgress: buildPhaseProgress(status, finishedChunks, Math.max(1, localJob.totalChunks), processing.updatedAt ?? localJob.finishedAt ?? localJob.startedAt ?? localJob.createdAt),
    progressPercent: Math.round((finishedChunks / Math.max(1, localJob.totalChunks)) * 100),
    qualityDimensions: buildQualityDimensions(completedChunks, Math.max(1, localJob.totalChunks), failedChunks, true),
    qualityIssues: failedChunks > 0 ? [{
      code: "local_snapshot_failed_chunks",
      severity: "danger",
      message: "本地恢复快照包含失败切片，不能作为全量真实通过依据。",
      action: "重试失败切片或切换到真实后端 job 快照。",
    }] : [],
    tokenStats,
    agents,
    chapters,
    source: "mock",
    createdAt: localJob.createdAt,
    updatedAt: processing.updatedAt ?? localJob.finishedAt ?? localJob.startedAt ?? localJob.createdAt,
    completedAt: localJob.finishedAt,
  };
  return { projectId: input.projectId, job, events: buildProcessingEvents(processing, localJob, status) };
}

function sceneForAgent(session: NovelImportSession, index: number, completedChunks: number): SceneCandidate | undefined {
  if (session.scenes.length === 0) return undefined;
  return session.scenes[(completedChunks + index) % session.scenes.length];
}

function buildAgents(input: NovelProcessMockInput, status: NovelProcessJobStatus, totalChunks: number, completedChunks: number, failedChunks: number): NovelProcessAgentProgress[] {
  const runningCount = status === "running" || status === "retrying" ? Math.max(1, Math.min(4, totalChunks - completedChunks)) : Math.min(4, Math.max(1, totalChunks));
  const agentCount = Math.max(1, Math.min(4, runningCount));
  const heartbeatAt = input.progress?.updatedAt ? new Date(input.progress.updatedAt).toISOString() : input.importJob?.completedAt ?? nowIso();
  const preview = latestOutputPreview(input.inspectableResults, "等待切片处理槽输出片段；真实执行接入后这里会显示最新结构化返回。");
  return Array.from({ length: agentCount }, (_, index) => {
    const scene = sceneForAgent(input.session, index, completedChunks);
    let agentStatus: NovelProcessAgentStatus = "waiting";
    if (status === "completed") agentStatus = "completed";
    else if (status === "cancelled") agentStatus = index === 0 ? "cancelled" : "completed";
    else if (status === "failed" || (status === "failed_partial" && index === 0)) agentStatus = "failed";
    else if (status === "retrying" || (status === "failed_partial" && index === 1)) agentStatus = "retrying";
    else if (status === "running") agentStatus = index === 0 ? "running" : index % 3 === 0 ? "waiting" : "running";
    else if (status === "paused") agentStatus = "waiting";
    const chunkTotal = Math.max(1, Math.min(6, Math.ceil(totalChunks / agentCount)));
    const currentChunkIndex = agentStatus === "completed" ? chunkTotal : clamp((completedChunks % chunkTotal) + 1, 1, chunkTotal);
    const progressPercent = agentStatus === "completed"
      ? 100
      : agentStatus === "failed" || agentStatus === "cancelled"
        ? Math.max(8, Math.round((currentChunkIndex / chunkTotal) * 72))
        : Math.round((currentChunkIndex / chunkTotal) * 100);
    const baseTokens = Math.max(520, Math.round((textChunkEstimate(input.session.chunks) || totalChunks * 1100) / agentCount));
    const inputTokens = Math.round(baseTokens * (0.42 + index * 0.04) * progressPercent / 100);
    const outputTokens = Math.round(baseTokens * (0.28 + index * 0.03) * progressPercent / 100);
    const retryCount = agentStatus === "failed" || agentStatus === "retrying" ? Math.max(1, failedChunks || index) : index === 2 && status === "running" ? 1 : 0;
    return {
      agentTaskId: `mock_agent_${input.session.session_id}_${index + 1}`,
      agentIndex: index,
      status: agentStatus,
      currentChapterTitle: scene?.title || input.session.chapters[index]?.title || input.session.document?.title || "待处理章节",
      currentChunkIndex,
      currentChunkTotal: chunkTotal,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      elapsedMs: Math.max(1000, Date.now() - new Date(input.importJob?.startedAt ?? input.session.updated_at).getTime() + index * 12000),
      retryCount,
      outputPreview: preview,
      progressPercent,
      progressBasis: "mock_adapter",
      queuePosition: agentStatus === "waiting" ? index + 1 : null,
      estimatedRemainingMs: agentStatus === "running" ? Math.max(0, totalChunks - completedChunks) * 12_000 : null,
      lastMeaningfulEventAt: heartbeatAt,
      staleReason: undefined,
      heartbeatAt,
    };
  });
}

function mapInspectablePhaseToEventType(result: NovelAiInspectableResult): NovelProcessEventType {
  if (result.status === "failed") return "agent_failed";
  if (result.phase === "scan") return "agent_output_updated";
  if (result.phase === "planning") return "chapter_split_completed";
  if (result.phase === "blueprint") return result.status === "parsed" || result.status === "review" ? "agent_completed" : "agent_output_updated";
  return "result_merged";
}

function eventLevelFromResult(result: NovelAiInspectableResult): NovelProcessEventLevel {
  if (result.status === "failed") return "error";
  if (result.status === "review" || result.warnings.length > 0) return "warning";
  if (result.status === "parsed") return "success";
  return "info";
}

function buildEvents(input: NovelProcessMockInput, jobId: string, status: NovelProcessJobStatus): NovelProcessEvent[] {
  const events: NovelProcessEvent[] = [
    {
      eventId: `${jobId}_created`,
      jobId,
      type: "job_created",
      level: "info",
      createdAt: input.importJob?.startedAt ?? input.session.created_at,
      title: "任务创建",
      message: `${input.session.document?.title ?? input.projectTitle} 已进入小说处理队列。`,
      payload: { source: "mock_adapter", sessionId: input.session.session_id },
    },
  ];

  for (const [index, result] of input.inspectableResults.slice(-42).entries()) {
    events.push({
      eventId: `${jobId}_inspect_${result.id}`,
      jobId,
      type: mapInspectablePhaseToEventType(result),
      level: eventLevelFromResult(result),
      createdAt: result.createdAt,
      title: result.title,
      message: result.summary || result.error || "模型事件已记录。",
      chapterId: result.chapterId,
      agentTaskId: `mock_agent_${input.session.session_id}_${(index % 4) + 1}`,
      payload: result.payload,
    });
  }

  if (input.progress) {
    events.push({
      eventId: `${jobId}_progress_${input.progress.updatedAt ?? Date.now()}`,
      jobId,
      type: "agent_output_updated",
      level: "info",
      createdAt: input.progress.updatedAt ? new Date(input.progress.updatedAt).toISOString() : nowIso(),
      title: input.progress.stageLabel ?? "任务进度",
      message: input.progress.detail ?? input.progress.message,
      payload: input.progress,
    });
  }

  input.warnings.slice(-4).forEach((warning, index) => {
    events.push({
      eventId: `${jobId}_warning_${index}_${warning.slice(0, 18)}`,
      jobId,
      type: "agent_output_updated",
      level: "warning",
      createdAt: eventTime((index + 1) * 9000),
      title: "任务警告",
      message: warning,
    });
  });

  input.errors.slice(-4).forEach((error, index) => {
    events.push({
      eventId: `${jobId}_error_${index}_${error.slice(0, 18)}`,
      jobId,
      type: "agent_failed",
      level: "error",
      createdAt: eventTime((index + 1) * 7000),
      title: "处理槽失败",
      message: error,
    });
  });

  if (status === "completed") {
    events.push({
      eventId: `${jobId}_completed`,
      jobId,
      type: "job_completed",
      level: "success",
      createdAt: input.importJob?.completedAt ?? nowIso(),
      title: "任务完成",
      message: "结果已合并，可查看导入节点。",
    });
  }
  if (status === "cancelled") {
    events.push({
      eventId: `${jobId}_cancelled`,
      jobId,
      type: "job_cancelled",
      level: "warning",
      createdAt: nowIso(),
      title: "任务取消",
      message: "任务已取消，已完成结果仍可查看。",
    });
  }
  if (status === "paused") {
    events.push({
      eventId: `${jobId}_paused`,
      jobId,
      type: "job_paused",
      level: "warning",
      createdAt: nowIso(),
      title: "任务暂停",
      message: "用户已请求暂停后续 chunk。",
    });
  }
  if (status === "retrying") {
    events.push({
      eventId: `${jobId}_retrying`,
      jobId,
      type: "job_retry",
      level: "warning",
      createdAt: nowIso(),
      title: "任务重试",
      message: "正在重试失败切片。",
    });
  }

  return events
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);
}

export function createMockNovelProcessSnapshot(input: NovelProcessMockInput): NovelProcessTaskSnapshot | undefined {
  const processingSnapshot = createProcessingSnapshot(input);
  if (processingSnapshot) return processingSnapshot;
  const status = statusFromImportState(input);
  if (!status) return undefined;
  const jobId = `mock_novel_process_${input.session.session_id}`;
  const plannedTotal = input.importJob?.total ?? (input.session.scenes.length || input.session.chunks.length || 1);
  const totalChunks = Math.max(1, plannedTotal);
  const completedChunks = clamp(input.importJob?.generatedCount ?? input.session.adapted_scenes.length, 0, totalChunks);
  const failedChunks = status === "failed_partial" || status === "failed"
    ? Math.max(1, input.importJob?.failedSceneIds.length ?? 0, input.errors.length > 0 ? 1 : 0)
    : input.importJob?.failedSceneIds.length ?? 0;
  const cancelledChunks = status === "cancelled"
    ? Math.max(0, totalChunks - completedChunks - failedChunks)
    : input.importJob?.skippedSceneIds?.length ?? 0;
  const finishedChunks = clamp(completedChunks + failedChunks + cancelledChunks, 0, totalChunks);
  const chapters = buildChapterRows(input.session, totalChunks, completedChunks, failedChunks);
  const agents = buildAgents(input, status, totalChunks, completedChunks, failedChunks);
  const retryExtraTokens = Math.max(0, failedChunks * 760 + agents.reduce((total, agent) => total + agent.retryCount * 320, 0));
  const tokenStats = buildTokenStats(chapters, agents, totalChunks, retryExtraTokens);
  const job: NovelProcessJob = {
    jobId,
    bookId: input.session.document?.document_id,
    novelTitle: input.session.document?.title || input.projectTitle || "未命名小说",
    status,
    selectedChapterCount: Math.max(1, input.session.planned_chapter_ids.length || input.session.chapters.length || chapters.length),
    totalChunks,
    completedChunks,
    failedChunks,
    cancelledChunks,
    runningAgentCount: agents.filter((agent) => agent.status === "running" || agent.status === "retrying").length,
    estimatedRemainingChunks: Math.max(0, totalChunks - finishedChunks),
    phaseProgress: buildPhaseProgress(status, finishedChunks, totalChunks, input.progress?.updatedAt ? new Date(input.progress.updatedAt).toISOString() : nowIso()),
    progressPercent: Math.round((finishedChunks / totalChunks) * 100),
    qualityDimensions: buildQualityDimensions(completedChunks, totalChunks, failedChunks, true),
    qualityIssues: failedChunks > 0 ? [{
      code: "mock_snapshot_failed_chunks",
      severity: "danger",
      message: "mock adapter 快照包含失败项，不能作为全量真实通过依据。",
      action: "继续等待真实后端 job，或重跑失败阶段。",
    }] : [],
    tokenStats,
    agents,
    chapters,
    source: "mock",
    createdAt: input.importJob?.startedAt ?? input.session.created_at,
    updatedAt: input.progress?.updatedAt ? new Date(input.progress.updatedAt).toISOString() : nowIso(),
    completedAt: input.importJob?.completedAt,
    failureReason: input.errors[input.errors.length - 1],
  };
  return { projectId: input.projectId, job, events: buildEvents(input, jobId, status) };
}

export function readPersistedNovelProcessTaskSnapshot(projectId: string): NovelProcessTaskSnapshot | undefined {
  try {
    const scopedRaw = window.localStorage.getItem(projectSnapshotKey(projectId));
    if (scopedRaw) {
      return normalizeSnapshotForProject(JSON.parse(scopedRaw) as NovelProcessTaskSnapshot, projectId);
    }
    const legacyRaw = window.localStorage.getItem(novelProcessTaskSnapshotKey);
    if (!legacyRaw) return undefined;
    const migrated = normalizeSnapshotForProject(JSON.parse(legacyRaw) as NovelProcessTaskSnapshot, projectId);
    if (!migrated) return undefined;
    persistNovelProcessTaskSnapshot(projectId, migrated);
    window.localStorage.removeItem(novelProcessTaskSnapshotKey);
    return migrated;
  } catch (error) {
    reportFrontendError("editor.novel-process", error, {
      operation: "restore-task-snapshot",
      projectId,
    });
    return undefined;
  }
}

export function persistNovelProcessTaskSnapshot(projectId: string, snapshot: NovelProcessTaskSnapshot): void {
  try {
    window.localStorage.setItem(projectSnapshotKey(projectId), JSON.stringify({ ...snapshot, projectId }));
  } catch (error) {
    reportFrontendError("editor.novel-process", error, {
      operation: "persist-task-snapshot",
      projectId,
    });
    // Persistence is best-effort until session 6 wires the shared job store.
  }
}

export function updateMockSnapshotStatus(snapshot: NovelProcessTaskSnapshot, status: NovelProcessJobStatus, message: string): NovelProcessTaskSnapshot {
  const updatedAt = nowIso();
  const eventType: NovelProcessEventType =
    status === "paused" ? "job_paused" :
      status === "running" ? "job_resumed" :
        status === "cancelled" ? "job_cancelled" :
          status === "retrying" ? "job_retry" :
            status === "completed" ? "job_completed" :
              "agent_output_updated";
  const level: NovelProcessEventLevel =
    status === "cancelled" || status === "paused" || status === "retrying" ? "warning" :
      status === "completed" ? "success" :
        status === "failed" || status === "failed_partial" ? "error" :
          "info";
  const event: NovelProcessEvent = {
    eventId: `${snapshot.job.jobId}_${eventType}_${Date.now()}`,
    jobId: snapshot.job.jobId,
    type: eventType,
    level,
    createdAt: updatedAt,
    title: message,
    message,
  };
  return {
    job: {
      ...snapshot.job,
      status,
      updatedAt,
      completedAt: status === "completed" ? updatedAt : snapshot.job.completedAt,
      runningAgentCount: status === "running" || status === "retrying" ? Math.max(1, snapshot.job.runningAgentCount) : 0,
    },
    events: [event, ...snapshot.events].slice(0, 50),
  };
}

// TODO(session-4/session-6): replace the mock synthesis above with persisted
// NovelProcessJob rows, agent task rows, token records, and job event streams.
