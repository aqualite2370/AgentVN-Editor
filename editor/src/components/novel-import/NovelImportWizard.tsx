import { AlertTriangle, BookOpen, CheckCircle2, ChevronDown, Copy, Download, Pause, Play, RotateCcw, SkipForward, WandSparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { FileSearch, Scissors, ShieldAlert } from "lucide-react";
import { getNovelImportModelStatus, useNovelImportStore } from "../../store/novelImportStore";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { ChapterCandidate, CharacterCandidate, CharacterCandidateReview, NovelAiInspectableResult, NovelAiOutline, NovelAiStage, NovelImportQualityReport, NovelImportValidationReport, ProgressState } from "../../novel-import/types";
import type { NovelImportPreflight, SourceDocument } from "../../novel-import/types";
import { buildChapterProcessingRows, findMatchingNovelProcessJob, isNovelProcessJobActive, mergeNovelProcessResults } from "../../novel-import/novelProcessing";
import { novelImportStatusLabel } from "../../novel-import/displayLabels";
import { estimateTokens } from "../../novel-import/textChunker";
import { buildProjectAssetAudit } from "../../utils/assetAudit";
import { assetTypeDisplayLabel } from "../../../../shared/cartridge/assetTaxonomy";
import { RoseTwoLoader } from "../common/RoseTwoLoader";
import { RichSelect } from "../common/RichSelect";

const stages: Array<{ id: NovelAiStage; label: string; description: string }> = [
  { id: "landing", label: "导入文本", description: "读取小说并检查模型" },
  { id: "scan", label: "AI 全文扫描", description: "分批理解全文" },
  { id: "outline", label: "大纲确认", description: "复核章节和角色" },
  { id: "planning", label: "场景规划", description: "按章节拆成场景" },
  { id: "generate", label: "蓝图生成", description: "逐个写入节点" },
  { id: "report", label: "导入报告", description: "查看覆盖和风险" },
];

function stageIndex(stage: NovelAiStage): number {
  return stages.findIndex((item) => item.id === stage);
}

function getStageMeta(stage: NovelAiStage) {
  return stages.find((item) => item.id === stage) ?? stages[0];
}

const inlineErrorPreviewMaxLength = 180;

function summarizeNovelImportError(error?: string): string | undefined {
  if (!error) return undefined;
  const compact = error
    .replace(/https:\/\/errors\.pydantic\.dev\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) return undefined;
  if (/validation errors|Input should be|not valid JSON|valid JSON|JSON/i.test(compact)) {
    return "模型返回内容未通过结构校验，当前阶段已暂停。完整错误已发送到右上角报错通知。";
  }
  if (/HTTP\s*5\d{2}|502/.test(compact)) {
    return "模型服务返回错误，当前阶段已暂停。完整错误已发送到右上角报错通知。";
  }
  const stops = ["。", "！", "？", ". "]
    .map((token) => compact.indexOf(token))
    .filter((index) => index >= 0);
  const firstStop = stops.length > 0 ? Math.min(...stops) : -1;
  const firstSentence = firstStop >= 0 ? compact.slice(0, firstStop + 1).trim() : compact;
  const preview = firstSentence.length > inlineErrorPreviewMaxLength
    ? `${firstSentence.slice(0, inlineErrorPreviewMaxLength)}...`
    : firstSentence;
  return `${preview} 完整错误已发送到右上角报错通知。`;
}

function getLatestImportErrorSummary(errors: string[]): string | undefined {
  return summarizeNovelImportError(errors[errors.length - 1]);
}

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? (value ?? 0).toLocaleString() : "0";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function preflightFromDocument(document?: SourceDocument): NovelImportPreflight | undefined {
  const value = document?.metadata?.import_preflight;
  return value && typeof value === "object" ? value as NovelImportPreflight : undefined;
}

function recommendationClass(preflight: NovelImportPreflight): string {
  if (preflight.recommended_action === "split_required") return "is-required";
  if (preflight.processing_tier === "large") return "is-large";
  if (preflight.recommended_action === "split_recommended") return "is-recommended";
  return "is-direct";
}

function structureLabel(preflight: NovelImportPreflight): string {
  if (!preflight.has_chapter_structure) return "未检测到";
  if (preflight.chapter_structure.method === "epub_toc") return "EPUB 目录";
  if (preflight.chapter_structure.method === "epub_spine") return "EPUB spine";
  if (preflight.chapter_structure.method === "html_heading") return "HTML 标题";
  if (preflight.chapter_structure.method === "docx_heading") return "DOCX 标题";
  if (preflight.chapter_structure.method === "markdown_heading") return "Markdown 标题";
  if (preflight.chapter_structure.method === "txt_pattern") return "TXT 章节标题";
  return "已检测到";
}

function processingTierLabel(preflight: NovelImportPreflight): string {
  if (preflight.processing_tier === "oversized") return "超出直接上限";
  if (preflight.processing_tier === "large") return "超长文本";
  if (preflight.processing_tier === "medium") return "中等长文";
  return "小文本";
}

function StageTimeline({ activeStage }: { activeStage: NovelAiStage }) {
  const activeIndex = stageIndex(activeStage);
  return (
    <ol className="novel-ai-timeline compact">
      {stages.map((stage, index) => (
        <li key={stage.id} className={index < activeIndex ? "is-done" : index === activeIndex ? "is-active" : ""}>
          <span>{index < activeIndex ? <CheckCircle2 size={14} /> : index === activeIndex ? <RoseTwoLoader className="novel-stage-spinner" particleCount={32} /> : index + 1}</span>
          <div>
            <strong>{stage.label}</strong>
            <small>{stage.description}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

function NovelStageHeader({
  activeStage,
  isProcessing,
  errorSummary,
  onReset,
}: {
  activeStage: NovelAiStage;
  isProcessing: boolean;
  errorSummary?: string;
  onReset: () => void;
}) {
  const stage = getStageMeta(activeStage);
  return (
    <header className="novel-stage-header">
      <div>
        <span className="panel-kicker">小说导入</span>
        <strong>大模型长文规划工作流</strong>
        <p className={errorSummary ? "novel-stage-error-hint" : undefined}>
          {errorSummary ? `当前：${stage.label}。该阶段解析失败，请查看右上角报错通知中的完整报告后重试。` : `当前：${stage.label}。AI 会先解析全文大纲，确认后再规划场景并写入蓝图。`}
        </p>
      </div>
      <div className="novel-stage-header-actions">
        <span className="novel-stage-pill">{stage.label}</span>
        <button type="button" data-help-key="novel.reset" disabled={isProcessing} onClick={onReset}>
          <RotateCcw size={14} />
          重新开始
        </button>
      </div>
    </header>
  );
}

function NovelSecondaryDrawer({
  title,
  description,
  badge,
  active,
  open,
  onToggle,
  className,
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`novel-expand-control novel-secondary-drawer${active ? " is-active" : ""}${open ? " is-expanded" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="novel-expand-toggle novel-secondary-drawer-summary" data-help-key="novel.drawerToggle" aria-expanded={open} onClick={onToggle}>
        <div>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <span className="novel-secondary-drawer-meta">
          {badge && <small>{badge}</small>}
          <ChevronDown className="novel-expand-chevron" size={16} />
        </span>
      </button>
      <div className="novel-expand-content-wrap">
        <div className="novel-expand-content novel-secondary-drawer-body">{children}</div>
      </div>
    </article>
  );
}

function ModelStreamPanel() {
  const progress = useNovelImportStore((state) => state.progress);
  const stream = useNovelImportStore((state) => state.modelStream);
  const toggle = useNovelImportStore((state) => state.toggleModelStream);
  if (!progress && !stream.responseText && stream.traces.length === 0) return null;
  return (
    <NovelSecondaryDrawer
      className="novel-model-stream-panel"
      title={stream.title}
      description={stream.status || progress?.message || "等待模型响应"}
      badge={progress ? `${progress.current}/${progress.total}` : stream.traces.length > 0 ? `${stream.traces.length} 条日志` : undefined}
      active={Boolean(progress)}
      open={stream.open}
      onToggle={toggle}
    >
      {progress && (
        <div className="novel-model-stream-progress">
          <progress value={progress.current} max={Math.max(1, progress.total)} />
          <span>{progress.current}/{progress.total}</span>
        </div>
      )}
      <section className="novel-model-stream-body" aria-label="模型完整响应">
        <h4>模型完整响应</h4>
        {(stream.rawLength ?? 0) > stream.responseText.length && (
          <p className="novel-model-stream-window-note">
            实时窗口显示最近 {stream.responseText.length.toLocaleString()} / {(stream.rawLength ?? stream.responseText.length).toLocaleString()} 字符；完整结构化结果请在解析结构面板查看。
          </p>
        )}
        <pre>{stream.responseText || "尚未收到模型片段；如果当前模型或结构化接口不支持 token 流，后端会显示降级提示。"}</pre>
        {stream.traces.length > 0 && (
          <div className="novel-model-trace-list">
            {stream.traces.map((trace, index) => (
              <p key={trace.id ?? `${trace.phase ?? "trace"}-${index}`}>
                <strong>{trace.title ?? trace.phase ?? "状态"}</strong>
                <span>{trace.message ?? trace.level ?? ""}</span>
              </p>
            ))}
          </div>
        )}
      </section>
    </NovelSecondaryDrawer>
  );
}

function formatPhaseLabel(phase: NovelAiInspectableResult["phase"]): string {
  if (phase === "scan") return "全文扫描";
  if (phase === "outline") return "大纲合成";
  if (phase === "planning") return "场景规划";
  return "蓝图写入";
}

function formatStatusLabel(status: NovelAiInspectableResult["status"]): string {
  if (status === "waiting") return "等待中";
  if (status === "streaming") return "流式输出中";
  if (status === "review") return "需复核";
  if (status === "failed") return "失败";
  return "已解析";
}

function commandTypeSummary(payload: unknown): string {
  const candidate = payload as { adapt_response?: { adapted_scene?: { scene_beat?: { commands?: Array<{ type?: string; character_id?: string }> } } } };
  const commands = candidate.adapt_response?.adapted_scene?.scene_beat?.commands ?? [];
  if (commands.length === 0) return "无命令";
  const counts = commands.reduce<Record<string, number>>((acc, command) => {
    const type = command.type ?? "unknown";
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([type, count]) => `${type} ${count}`).join(" / ");
}

function formatElapsed(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "等待中";
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatResponseDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "等待首个响应";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} 秒`;
}

function useHeartbeatTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function formatProgressScope(progress: ProgressState, session: ReturnType<typeof useNovelImportStore.getState>["session"], generatedCount?: number, totalScenes?: number): string {
  if (progress.phase === "scan") {
    return `扫描批次 ${Math.min(session.ai_chunk_analyses.length + 1, session.chunks.length || 1)}/${session.chunks.length || progress.total}`;
  }
  if (progress.phase === "outline") {
    return `扫描批次 ${session.ai_chunk_analyses.length}/${session.chunks.length || 0}`;
  }
  if (progress.phase === "planning") {
    return `章节 ${Math.min(progress.current + 1, progress.total)}/${progress.total}`;
  }
  if (progress.phase === "blueprint") {
    return `场景 ${generatedCount ?? progress.current}/${totalScenes ?? progress.total}`;
  }
  return `${progress.current}/${progress.total}`;
}

function NovelOperationHeartbeat() {
  const progress = useNovelImportStore((state) => state.progress);
  const stream = useNovelImportStore((state) => state.modelStream);
  const session = useNovelImportStore((state) => state.session);
  const importJob = useNovelImportStore((state) => state.importJob);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const active = Boolean(progress || isProcessing);
  useHeartbeatTick(active);
  if (!active) return null;

  const now = Date.now();
  const startedAt = progress?.startedAt ?? progress?.updatedAt ?? now;
  const updatedAt = progress?.updatedAt ?? startedAt;
  const stageLabel = progress?.stageLabel ?? getStageMeta(session.ai_stage).label;
  const detail = progress?.detail ?? stream.status ?? "等待模型响应";
  const progressText = progress ? formatProgressScope(progress, session, importJob?.generatedCount, importJob?.total) : "准备中";

  return (
    <section className="operation-heartbeat novel-operation-heartbeat" role="status" aria-live="polite">
      <span className="operation-heartbeat-pulse" aria-hidden="true" />
      <div className="novel-heartbeat-copy">
        <strong>{stageLabel}</strong>
        <span>{detail}</span>
      </div>
      <dl>
        <div><dt>批次/进度</dt><dd>{progressText}</dd></div>
        <div><dt>已运行</dt><dd>{formatElapsed(now - startedAt)}</dd></div>
        <div><dt>最近响应</dt><dd>{formatResponseDuration(progress?.lastResponseMs)}</dd></div>
        <div><dt>上次事件</dt><dd>{formatElapsed(now - updatedAt)}前</dd></div>
      </dl>
    </section>
  );
}

function NovelAiResultCard({ result, mode }: { result: NovelAiInspectableResult; mode: "readable" | "json" }) {
  const range = result.sourceRange ? `${result.sourceRange.start} - ${result.sourceRange.end}` : "无";
  return (
    <article className={`novel-ai-result-card is-${result.status}`} id={`novel-result-${result.id}`}>
      <header>
        <div>
          <span>{formatPhaseLabel(result.phase)}</span>
          <strong>{result.title}</strong>
        </div>
        <small>{formatStatusLabel(result.status)}</small>
      </header>
      <dl className="novel-ai-result-meta">
        <div><dt>章节</dt><dd>{result.chapterIndex !== undefined ? `第 ${result.chapterIndex + 1} 章` : "全局"}{result.chapterId ? ` · ${result.chapterId}` : ""}{result.chapterTitle ? ` · ${result.chapterTitle}` : ""}</dd></div>
        <div><dt>来源范围</dt><dd>{range}</dd></div>
        <div><dt>模型</dt><dd>{result.modelLabel}</dd></div>
      </dl>
      {mode === "readable" ? (
        <div className="novel-ai-result-readable">
          <p>{result.summary}</p>
          {result.phase === "blueprint" && <p>命令概览：{commandTypeSummary(result.payload)}</p>}
          {result.warnings.length > 0 && (
            <ul>
              {result.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}
            </ul>
          )}
          {result.error && <p className="inline-error">{result.error}</p>}
        </div>
      ) : (
        <pre className="novel-ai-json-view" aria-label={`${result.title} JSON`}>{JSON.stringify(result.payload, null, 2)}</pre>
      )}
    </article>
  );
}

function NovelAiResultPanel() {
  const results = useNovelImportStore((state) => state.inspectableResults);
  const [mode, setMode] = useState<"readable" | "json">("readable");
  const [open, setOpen] = useState(false);
  const chapters = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((result) => {
      const key = result.chapterId ?? "global";
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [results]);
  if (results.length === 0) return null;
  return (
    <NovelSecondaryDrawer
      className="novel-ai-result-panel"
      title="查看解析结构"
      description="只读复核后端校验通过的章节、场景和写入参数。"
      badge={`${results.length} 条`}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <header className="novel-ai-result-tools">
        <div>
          <strong>已解析结构</strong>
          <span>展示后端校验通过或归一化后的 JSON / 写入参数，只读可滚动。</span>
        </div>
        <div className="segmented-control" role="tablist" aria-label="解析结果视图">
          <button type="button" data-help-key="novel.resultReadable" className={mode === "readable" ? "is-active" : ""} onClick={() => setMode("readable")}>可读视图</button>
          <button type="button" data-help-key="novel.resultJson" className={mode === "json" ? "is-active" : ""} onClick={() => setMode("json")}>JSON 视图</button>
        </div>
      </header>
      <nav className="novel-ai-result-index" aria-label="章节索引">
        {chapters.map((result) => (
          <a href={`#novel-result-${result.id}`} key={result.id}>
            {result.chapterIndex !== undefined ? `第 ${result.chapterIndex + 1} 章` : "全局"}
            {result.chapterTitle ? ` · ${result.chapterTitle}` : ""}
          </a>
        ))}
      </nav>
      <div className="novel-ai-result-list">
        {results.map((result) => <NovelAiResultCard key={result.id} result={result} mode={mode} />)}
      </div>
    </NovelSecondaryDrawer>
  );
}

function persistentStatusLabel(status: string): string {
  return novelImportStatusLabel(status);
}

function saveTextFile(fileName: string, content: string, mimeType: string): void {
  if (!content.trim() || typeof window === "undefined") return;
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.replace(/[\\/:*?"<>|]+/g, "_");
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
}

function NovelPersistentResultsPanel() {
  const persistence = useNovelImportStore((state) => state.persistence);
  const exportResults = useNovelImportStore((state) => state.exportResults);
  const retryChunkResult = useNovelImportStore((state) => state.retryChunkResult);
  const retryFailedItems = useNovelImportStore((state) => state.retryFailedItems);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chunk" | "chapter" | "book">("chunk");
  const book = persistence.activeBookId ? persistence.books[persistence.activeBookId] : Object.values(persistence.books)[0];
  const chunkRows = useMemo(() => Object.values(persistence.chunkResults)
    .filter((result) => !book || result.bookId === book.bookId)
    .sort((a, b) => (persistence.chunks[a.chunkId]?.index ?? 0) - (persistence.chunks[b.chunkId]?.index ?? 0)), [book, persistence.chunkResults, persistence.chunks]);
  const chapterRows = useMemo(() => Object.values(persistence.chapterResults)
    .filter((result) => !book || result.bookId === book.bookId)
    .sort((a, b) => (persistence.chapters[a.chapterId]?.index ?? 0) - (persistence.chapters[b.chapterId]?.index ?? 0)), [book, persistence.chapterResults, persistence.chapters]);
  const recentEvents = useMemo(() => [...persistence.events]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50), [persistence.events]);
  const failedCount = chunkRows.filter((row) => row.status === "failed" || row.status === "timeout_suspected").length;
  const hasResults = Boolean(book || chunkRows.length > 0 || chapterRows.length > 0 || recentEvents.length > 0);
  if (!hasResults) return null;

  const markdown = exportResults("markdown", false);
  const txt = exportResults("txt", false);
  const completedMarkdown = exportResults("markdown", true);

  return (
    <NovelSecondaryDrawer
      className="novel-ai-result-panel novel-persistent-results-panel"
      title="持久化结果"
      description={book ? `${book.title} · ${chunkRows.length} 个切片` : "任务结果、错误和事件日志"}
      badge={failedCount > 0 ? `${failedCount} 失败` : `${chapterRows.length} 章`}
      active={failedCount > 0}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <header className="novel-ai-result-tools">
        <div>
          <strong>结果管理</strong>
          <span>按切片、章节和全书查看已持久化内容，可导出已完成部分。</span>
        </div>
        <div className="segmented-control" role="tablist" aria-label="持久化结果视图">
          <button type="button" data-help-key="novel.resultView.chunk" className={view === "chunk" ? "is-active" : ""} onClick={() => setView("chunk")}>切片</button>
          <button type="button" data-help-key="novel.resultView.chapter" className={view === "chapter" ? "is-active" : ""} onClick={() => setView("chapter")}>章节</button>
          <button type="button" data-help-key="novel.resultView.book" className={view === "book" ? "is-active" : ""} onClick={() => setView("book")}>全书</button>
        </div>
      </header>

      {view === "chunk" && (
        <div className="novel-ai-result-list">
          {chunkRows.map((result) => {
            const chunk = persistence.chunks[result.chunkId];
            const canRetry = result.status === "failed" || result.status === "timeout_suspected" || result.status === "cancelled";
            return (
              <article key={result.chunkId} className={`novel-ai-result-card is-${result.status === "completed" ? "parsed" : result.status === "failed" ? "failed" : "review"}`}>
                <header>
                  <div>
                    <span>切片 {chunk?.index ?? result.chunkId}</span>
                    <strong>{chunk ? `${chunk.startOffset} - ${chunk.endOffset}` : result.chunkId}</strong>
                  </div>
                  <small>{persistentStatusLabel(result.status)}</small>
                </header>
                <dl className="novel-ai-result-meta">
                  <div><dt>Token</dt><dd>{result.tokenUsage.total_tokens.toLocaleString()}{result.tokenUsage.estimated ? " 估算" : ""}</dd></div>
                  <div><dt>模型</dt><dd>{result.modelName ?? "未记录"}</dd></div>
                  <div><dt>重试</dt><dd>{result.retryCount}</dd></div>
                </dl>
                {result.summary && <p>{result.summary}</p>}
                {result.continuityNotes.length > 0 && <p>{result.continuityNotes.slice(0, 3).join(" / ")}</p>}
                {result.resultText && <pre className="novel-ai-json-view">{result.resultText}</pre>}
                {result.errorMessage && <p className="inline-error">{result.errorMessage}</p>}
                {canRetry && <button type="button" data-help-key="novel.result.retryChunk" onClick={() => void retryChunkResult(result.chunkId)}><RotateCcw size={14} /> 重试切片</button>}
              </article>
            );
          })}
        </div>
      )}

      {view === "chapter" && (
        <div className="novel-ai-result-list">
          {chapterRows.map((chapter) => {
            const failedChunkIds = chapter.chunkIds.filter((chunkId) => {
              const status = persistence.chunkResults[chunkId]?.status;
              return status === "failed" || status === "timeout_suspected" || status === "cancelled";
            });
            return (
              <article key={chapter.chapterId} className={`novel-ai-result-card is-${chapter.status === "completed" ? "parsed" : chapter.status === "failed" ? "failed" : "review"}`}>
                <header>
                  <div>
                    <span>章节</span>
                    <strong>{chapter.title}</strong>
                  </div>
                  <small>{persistentStatusLabel(chapter.status)}</small>
                </header>
                <dl className="novel-ai-result-meta">
                  <div><dt>切片</dt><dd>{chapter.chunkIds.length}</dd></div>
                  <div><dt>Token</dt><dd>{chapter.tokenUsage.total_tokens.toLocaleString()}</dd></div>
                  <div><dt>失败</dt><dd>{failedChunkIds.length}</dd></div>
                </dl>
                {chapter.resultText ? <pre className="novel-ai-json-view">{chapter.resultText}</pre> : <p>暂无合并结果。</p>}
                <div className="row-actions">
                  <button type="button" data-help-key="novel.result.copyChapter" disabled={!chapter.resultText} onClick={() => void navigator.clipboard?.writeText(chapter.resultText)}><Copy size={14} /> 复制</button>
                  {failedChunkIds.length > 0 && (
                    <button type="button" data-help-key="novel.result.retryChapterChunks" onClick={() => void Promise.all(failedChunkIds.map((chunkId) => retryChunkResult(chunkId)))}><RotateCcw size={14} /> 重试失败切片</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {view === "book" && (
        <section className="novel-ai-result-readable">
          <div className="row-actions">
            <button type="button" data-help-key="novel.result.exportTxt" disabled={!txt.trim()} onClick={() => saveTextFile(`${book?.title ?? "novel-result"}.txt`, txt, "text/plain")}><Download size={14} /> TXT</button>
            <button type="button" data-help-key="novel.result.exportMarkdown" disabled={!markdown.trim()} onClick={() => saveTextFile(`${book?.title ?? "novel-result"}.md`, markdown, "text/markdown")}><Download size={14} /> Markdown</button>
            <button type="button" data-help-key="novel.result.exportCompleted" disabled={!completedMarkdown.trim()} onClick={() => saveTextFile(`${book?.title ?? "novel-result"}-completed.md`, completedMarkdown, "text/markdown")}><Download size={14} /> 已完成部分</button>
            {failedCount > 0 && <button type="button" data-help-key="novel.result.retryFailed" onClick={() => void retryFailedItems()}><RotateCcw size={14} /> 重试失败项</button>}
          </div>
          <pre className="novel-ai-json-view">{markdown || "暂无可导出的全书结果。"}</pre>
        </section>
      )}

      {recentEvents.length > 0 && (
        <section className="novel-run-log" aria-label="最近任务事件">
          <header>
            <strong>最近事件</strong>
            <span>{recentEvents.length} 条</span>
          </header>
          {recentEvents.map((event) => (
            <p key={event.eventId} className={event.level === "error" ? "inline-error" : event.level === "warning" ? "inline-warning" : "inline-status"}>
              {new Date(event.createdAt).toLocaleString("zh-CN")} · {event.message}
            </p>
          ))}
        </section>
      )}
    </NovelSecondaryDrawer>
  );
}

function validationStatusLabel(status: NovelImportValidationReport["status"]): string {
  if (status === "blocked") return "阻断错误";
  if (status === "fixed") return "自动修复";
  return "通过";
}

function NovelValidationReportPanel() {
  const reports = useNovelImportStore((state) => state.session.validation_reports);
  const [open, setOpen] = useState(true);
  if (reports.length === 0) return null;

  const passedCount = reports.reduce((sum, report) => sum + report.passed.length, 0);
  const fixCount = reports.reduce((sum, report) => sum + report.fixes.length, 0);
  const errorCount = reports.reduce((sum, report) => sum + report.errors.length, 0);
  const warningCount = reports.reduce((sum, report) => sum + report.warnings.length, 0);
  const latest = reports[reports.length - 1];
  const recent = [...reports].slice(-5).reverse();

  return (
    <NovelSecondaryDrawer
      className="novel-validation-panel"
      title="结构校验"
      description={`通过 ${passedCount} · 自动修复 ${fixCount} · 阻断 ${errorCount}`}
      badge={validationStatusLabel(latest.status)}
      active={errorCount > 0 || fixCount > 0}
      open={open}
      onToggle={() => setOpen((value) => !value)}
    >
      <section className={`novel-validation-summary is-${latest.status}`} data-help-key="novel.validationSummary" aria-label="小说导入结构校验摘要">
        <header>
          <strong>AI 结果入库前校验</strong>
          <span>{validationStatusLabel(latest.status)}</span>
        </header>
        <dl>
          <div><dt>通过</dt><dd>{passedCount}</dd></div>
          <div><dt>自动修复</dt><dd>{fixCount}</dd></div>
          <div><dt>阻断错误</dt><dd>{errorCount}</dd></div>
          <div><dt>警告</dt><dd>{warningCount}</dd></div>
        </dl>
      </section>
      <div className="novel-validation-list">
        {recent.map((report) => (
          <article key={report.id} className={`novel-validation-card is-${report.status}`} data-help-key="novel.validationReport">
            <header>
              <div>
                <strong>{report.title}</strong>
                <span>{report.sceneId ? `scene_id=${report.sceneId}` : report.sourceSceneCandidateId}</span>
              </div>
              <small>{validationStatusLabel(report.status)}</small>
            </header>
            {report.fixes.length > 0 && (
              <ul>
                {report.fixes.slice(0, 3).map((item, index) => <li key={`${report.id}:fix:${index}:${item}`}>{item}</li>)}
              </ul>
            )}
            {report.errors.length > 0 && (
              <ul className="is-error-list">
                {report.errors.slice(0, 4).map((item, index) => <li key={`${report.id}:error:${index}:${item}`}>{item}</li>)}
              </ul>
            )}
            {report.errors.length === 0 && report.fixes.length === 0 && <p>场景 ID（scene_id）、选项目标（choice target）、来源映射（source mapping）、分支来源和命令引用均已通过。</p>}
          </article>
        ))}
      </div>
    </NovelSecondaryDrawer>
  );
}

function qualityRiskLabel(level: NovelImportQualityReport["risk_level"]): string {
  if (level === "high") return "高风险";
  if (level === "medium") return "中风险";
  return "低风险";
}

function metricStatusLabel(status: NovelImportQualityReport["metrics"][number]["status"]): string {
  if (status === "danger") return "不足";
  if (status === "warning") return "需复核";
  return "良好";
}

function NovelQualityPanel({
  report,
  accepted,
  isProcessing,
  showActions,
  onRetry,
  onContinue,
}: {
  report: NovelImportQualityReport;
  accepted: boolean;
  isProcessing: boolean;
  showActions: boolean;
  onRetry: () => void;
  onContinue: () => void;
}) {
  const blocked = report.score < report.threshold && !accepted;
  const usableBranchCount = report.usable_branch_suggestion_count ?? report.branch_suggestion_count;
  const branchShortfall = usableBranchCount < 1;
  return (
    <section className={`novel-quality-panel${report.risk_flag ? " is-risk" : " is-pass"}`} aria-label="小说导入质量评分">
      <header className="novel-quality-header">
        <div>
          <span className="panel-kicker">可改编质量</span>
          <strong>质量评分 {report.score}/{report.threshold}</strong>
          <p>{report.risk_flag ? "存在改编风险，建议先处理不足项。" : "场景覆盖、分支和命令结构已达到当前阈值。"}</p>
        </div>
        <span className={`novel-quality-risk-pill is-${report.risk_level}`}>
          {accepted ? "已按风险继续" : qualityRiskLabel(report.risk_level)}
        </span>
      </header>
      <div className="novel-quality-metrics">
        {report.metrics.map((metric) => (
          <div key={metric.key} className={`novel-quality-metric is-${metric.status}`}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metricStatusLabel(metric.status)} · {metric.score}</small>
          </div>
        ))}
      </div>
      {report.dimensions && report.dimensions.length > 0 && (
        <div className="novel-quality-dimensions" aria-label="质量维度评分">
          {report.dimensions.map((dimension) => (
            <article key={dimension.key} className={`is-${dimension.status}`}>
              <header>
                <strong>{dimension.label}</strong>
                <span>{dimension.score}</span>
              </header>
              <div className="novel-quality-dimension-bar" aria-hidden="true">
                <i style={{ width: `${Math.max(2, Math.min(100, dimension.score))}%` }} />
              </div>
              <small>{dimension.value} · {metricStatusLabel(dimension.status)}</small>
            </article>
          ))}
        </div>
      )}
      {report.blocking_issues && report.blocking_issues.length > 0 && (
        <div className="novel-quality-blockers" role="alert" aria-label="质量阻断项">
          {report.blocking_issues.slice(0, 5).map((issue, index) => (
            <article key={`${issue.code}_${issue.sourceSceneId ?? index}`} className={`is-${issue.severity}`}>
              <strong>{issue.message}</strong>
              {issue.action && <p>{issue.action}</p>}
              {issue.evidence && <small title={issue.evidence}>{issue.sourceSceneId ? `${issue.sourceSceneId} · ` : ""}{issue.evidence}</small>}
            </article>
          ))}
        </div>
      )}
      {branchShortfall && (
        <p className="novel-quality-branch-warning">
          <AlertTriangle size={14} />
          分支建议偏少：当前 {usableBranchCount} 个可用分支；这不会阻断主线导入，后续可以手工补充选择点。
        </p>
      )}
      {report.reasons.length > 0 && (
        <ul className="novel-quality-reasons">
          {report.reasons.map((reason, index) => <li key={`quality-reason:${index}:${reason}`}>{reason}</li>)}
        </ul>
      )}
      {showActions && blocked && (
        <div className="novel-quality-actions">
          <button type="button" data-help-key="novel.retryQuality" disabled={isProcessing} onClick={onRetry}>
            <RotateCcw size={14} />
            重试规划
          </button>
          <button type="button" className="primary-action" data-help-key="novel.continueQualityRisk" disabled={isProcessing} onClick={onContinue}>
            <Play size={14} />
            按风险继续
          </button>
        </div>
      )}
    </section>
  );
}

function NovelImportPreflightCard({
  preflight,
  pending,
  isProcessing,
  modelLabel,
  onDirect,
  onSplit,
  onCancel,
}: {
  preflight: NovelImportPreflight;
  pending: boolean;
  isProcessing: boolean;
  modelLabel: string;
  onDirect: () => void;
  onSplit: () => void;
  onCancel: () => void;
}) {
  const canDirect = preflight.recommended_action !== "split_required";
  const headingSamples = preflight.chapter_structure.sample_headings.slice(0, 5);
  return (
    <section className={`novel-file-preflight ${recommendationClass(preflight)}`} aria-label="小说文件导入检测">
      <header className="novel-preflight-header">
        <div>
          <span className="panel-kicker">导入检测</span>
          <strong>{preflight.recommendation_label}</strong>
          <p>{preflight.time_hint}</p>
        </div>
        <span className="novel-recommendation-pill">{processingTierLabel(preflight)}</span>
      </header>
      <div className="novel-preflight-grid">
        <section>
          <h4>文件信息</h4>
          <dl>
            <div><dt>文件名</dt><dd title={preflight.file_name}>{preflight.file_name}</dd></div>
            <div><dt>文件大小</dt><dd>{formatFileSize(preflight.file_size_bytes)}</dd></div>
            <div><dt>文件类型</dt><dd>{preflight.file_type}</dd></div>
            <div><dt>编码格式</dt><dd>{preflight.encoding}</dd></div>
          </dl>
        </section>
        <section>
          <h4>字数统计</h4>
          <dl>
            <div><dt>字符数</dt><dd>{formatNumber(preflight.total_chars)}</dd></div>
            <div><dt>预估字数</dt><dd>{formatNumber(preflight.estimated_words)}</dd></div>
            <div><dt>章节结构</dt><dd>{structureLabel(preflight)}</dd></div>
            <div><dt>标题样本</dt><dd>{headingSamples.length ? `${headingSamples.length} 条` : "无"}</dd></div>
          </dl>
        </section>
        <section>
          <h4>预计消耗</h4>
          <dl>
            <div><dt>输入 Token</dt><dd>{formatNumber(preflight.estimated_tokens)}</dd></div>
            <div><dt>处理档位</dt><dd>{processingTierLabel(preflight)}</dd></div>
            <div><dt>模型</dt><dd>{modelLabel}</dd></div>
            <div><dt>推荐方式</dt><dd>{preflight.recommendation_label}</dd></div>
          </dl>
        </section>
      </div>
      {preflight.encoding_warning && <p className="inline-warning">{preflight.encoding_warning}</p>}
      {headingSamples.length > 0 && (
        <div className="novel-heading-samples" aria-label="章节标题样本">
          {headingSamples.map((heading, index) => <span key={`${index}:${heading}`}>{heading}</span>)}
        </div>
      )}
      {pending && (
        <div className="novel-preflight-actions">
          <button type="button" className="primary-action" data-help-key="novel.startChapterSplit" disabled={isProcessing} onClick={onSplit}>
            <Scissors size={16} />
            开始章节拆分
          </button>
          {canDirect && (
            <button type="button" data-help-key="novel.continueDirect" disabled={isProcessing} onClick={onDirect}>
              <Play size={16} />
              继续直接处理
            </button>
          )}
          <button type="button" data-help-key="novel.cancelImport" disabled={isProcessing} onClick={onCancel}>
            <XCircle size={16} />
            取消导入
          </button>
        </div>
      )}
      {!canDirect && <p className="inline-warning">当前文件超过直接处理上限，必须先拆分。</p>}
    </section>
  );
}

function LargeTextPreflightDialog({
  preflight,
  isProcessing,
  onSplit,
  onDirect,
  onCancel,
}: {
  preflight: NovelImportPreflight;
  isProcessing: boolean;
  onSplit: () => void;
  onDirect: () => void;
  onCancel: () => void;
}) {
  const directBlocked = preflight.recommended_action === "split_required";
  return (
    <div className="novel-large-dialog-backdrop" role="presentation">
      <section className={`novel-large-dialog ${directBlocked ? "is-required" : ""}`} role="dialog" aria-modal="true" aria-labelledby="novel-large-dialog-title">
        <div className="novel-large-dialog-icon" aria-hidden="true">
          {directBlocked ? <ShieldAlert size={22} /> : <AlertTriangle size={22} />}
        </div>
        <header>
          <h3 id="novel-large-dialog-title">小说内容较大，建议先拆分</h3>
          <p>{directBlocked ? "当前文件超过直接处理上限，必须先拆分。" : "建议先按章节拆分，再进入后续 AI 处理。"}</p>
        </header>
        <dl>
          <div><dt>当前字数</dt><dd>{formatNumber(preflight.estimated_words)}</dd></div>
          <div><dt>字符数</dt><dd>{formatNumber(preflight.total_chars)}</dd></div>
          <div><dt>预估 Token</dt><dd>{formatNumber(preflight.estimated_tokens)}</dd></div>
          <div><dt>推荐处理方式</dt><dd>{preflight.recommendation_label}</dd></div>
        </dl>
        <section className="novel-large-risk">
          <strong>直接处理的风险</strong>
          <ul>
            {preflight.direct_process_risks.map((risk, index) => <li key={`direct-risk:${index}:${risk}`}>{risk}</li>)}
          </ul>
        </section>
        <div className="novel-large-dialog-actions">
          <button type="button" className="primary-action" data-help-key="novel.startChapterSplit" disabled={isProcessing} onClick={onSplit}>
            <Scissors size={16} />
            开始章节拆分
          </button>
          {!directBlocked && (
            <button type="button" data-help-key="novel.continueDirect" disabled={isProcessing} onClick={onDirect}>
              <Play size={16} />
              继续直接处理
            </button>
          )}
          <button type="button" data-help-key="novel.cancelImport" disabled={isProcessing} onClick={onCancel}>
            <XCircle size={16} />
            取消导入
          </button>
        </div>
      </section>
    </div>
  );
}

function processStatusLabel(status: string): string {
  return novelImportStatusLabel(status);
}

function recommendedActionLabel(action: string): string {
  if (action === "confirm") return "确认";
  if (action === "adjust_rules") return "调整规则";
  if (action === "manual_merge") return "手动合并";
  if (action === "manual_split") return "手动拆分";
  if (action === "fallback_slice") return "回退切片";
  return action;
}

type ChapterSelectionCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
  children?: ReactNode;
  onChange: () => void;
};

function ChapterSelectionCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  className = "",
  children,
  onChange,
}: ChapterSelectionCheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isMixed = indeterminate && !checked;
  const stateClass = isMixed ? "is-mixed" : checked ? "is-checked" : "is-empty";

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = isMixed;
  }, [isMixed]);

  return (
    <label className={`novel-chapter-checkbox ${className} ${stateClass}${disabled ? " is-disabled" : ""}`}>
      <input
        ref={inputRef}
        type="checkbox"
        data-help-key="novel.chapterSelection.checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={isMixed ? "mixed" : checked}
        onChange={() => onChange()}
      />
      <span className="novel-chapter-checkbox-box" aria-hidden="true" />
      {children}
    </label>
  );
}

function NovelChapterSplitEntry() {
  const session = useNovelImportStore((state) => state.session);
  const processing = useNovelImportStore((state) => state.processing);
  const jobCreation = useNovelImportStore((state) => state.jobCreation);
  const resetSession = useNovelImportStore((state) => state.resetSession);
  const splitChapters = useNovelImportStore((state) => state.splitChapters);
  const prepareChapterSelection = useNovelImportStore((state) => state.prepareChapterSelection);
  const toggleChapter = useNovelImportStore((state) => state.toggleProcessingChapter);
  const selectAll = useNovelImportStore((state) => state.selectAllProcessingChapters);
  const invertSelection = useNovelImportStore((state) => state.invertProcessingChapterSelection);
  const selectVolume = useNovelImportStore((state) => state.selectProcessingVolume);
  const selectUnprocessed = useNovelImportStore((state) => state.selectOnlyUnprocessedChapters);
  const selectFailed = useNovelImportStore((state) => state.selectOnlyFailedChapters);
  const clearSelection = useNovelImportStore((state) => state.clearProcessingChapterSelection);
  const updateConfig = useNovelImportStore((state) => state.updateNovelProcessingConfig);
  const updateDraft = useNovelImportStore((state) => state.updateNovelProcessingDraft);
  const createJob = useNovelImportStore((state) => state.createNovelProcessingJob);
  const retryTask = useNovelImportStore((state) => state.retryNovelAgentTask);
  const retryFailedTasks = useNovelImportStore((state) => state.retryFailedNovelAgentTasks);
  const markTaskFailed = useNovelImportStore((state) => state.markNovelAgentTaskFailed);
  const preflight = session.import_record?.preflight ?? preflightFromDocument(session.document);
  const splitReport = session.chapter_split_report;
  const samples = preflight?.chapter_structure.sample_headings.slice(0, 12) ?? [];
  const chapters = session.chapters.length > 0 ? session.chapters : processing.chapterSnapshots;
  const rows = useMemo(() => buildChapterProcessingRows(chapters, processing), [chapters, processing]);
  const selected = new Set(processing.selectedChapterIds);
  const volumeLabels = useMemo(() => Array.from(new Set(rows.map((row) => row.volumeLabel))), [rows]);
  const [volumeLabel, setVolumeLabel] = useState(volumeLabels[0] ?? "未分卷");
  const activeJob = processing.activeJobId ? processing.jobs.find((job) => job.jobId === processing.activeJobId) : undefined;
  const activeTasks = activeJob ? processing.tasks.filter((task) => task.jobId === activeJob.jobId) : [];
  const failedTaskCount = activeTasks.filter((task) => task.status === "failed").length;
  const selectedRows = rows.filter((row) => selected.has(row.chapter.chapter_id));
  const selectedChapterCount = selectedRows.length;
  const chapterCount = rows.length;
  const canCreateFullDocumentJob = chapterCount === 0 && Boolean(session.document);
  const selectedChapterIdsForJob = canCreateFullDocumentJob ? ["__full_document__"] : selectedRows.map((row) => row.chapter.chapter_id);
  const allChaptersSelected = chapterCount > 0 && selectedChapterCount === chapterCount;
  const noChaptersSelected = selectedChapterCount === 0;
  const partiallySelected = !noChaptersSelected && !allChaptersSelected;
  const toggleAllChapters = () => {
    if (allChaptersSelected) clearSelection();
    else selectAll();
  };
  const matchingJob = useMemo(
    () => findMatchingNovelProcessJob(processing, selectedChapterIdsForJob),
    [processing, selectedChapterIdsForJob],
  );
  const isCreatingJob = jobCreation.status === "creating";
  const createDisabled = (!canCreateFullDocumentJob && selectedRows.length === 0) || !session.document || isCreatingJob || Boolean(matchingJob);
  const regenerateDisabled = (!canCreateFullDocumentJob && selectedRows.length === 0) || !session.document || isCreatingJob || isNovelProcessJobActive(matchingJob);
  const visibleCreationState = jobCreation.status !== "idle"
    ? jobCreation
    : matchingJob
      ? {
          status: "duplicate" as const,
          message: `相同章节已存在任务 ${matchingJob.jobId}。创建任务已锁定；需要再次执行时使用“重新生成切片和任务”。`,
          jobId: matchingJob.jobId,
          chunkCount: matchingJob.totalChunks,
        }
      : undefined;
  const selectedChars = selectedRows.reduce((sum, row) => sum + row.charCount, 0);
  const selectedTokens = selectedRows.reduce((sum, row) => sum + row.estimatedTokens, 0);
  const totalChunks = processing.chunks.length;
  const merged = useMemo(() => mergeNovelProcessResults({
    chapters,
    chunks: processing.chunks,
    chunkResults: processing.chunkResults,
    tasks: processing.tasks,
  }), [chapters, processing.chunkResults, processing.chunks, processing.tasks]);

  useEffect(() => {
    if (volumeLabels.length > 0 && !volumeLabels.includes(volumeLabel)) setVolumeLabel(volumeLabels[0]);
  }, [volumeLabel, volumeLabels]);

  useEffect(() => {
    if (session.chapters.length > 0 && processing.chapterSnapshots.length === 0) {
      prepareChapterSelection();
    }
  }, [prepareChapterSelection, processing.chapterSnapshots.length, session.chapters.length]);

  return (
    <section className="novel-primary-panel novel-chapter-split-entry novel-chapter-selection-page is-active">
      <div className="novel-split-entry-title">
        <span className="panel-kicker">章节拆分</span>
        <h3>章节选择与任务编排</h3>
        <p>选择本次要处理的章节，系统会按章节生成切片记录（ChunkRecord）、小说处理任务（NovelProcessJob）和切片处理任务。</p>
      </div>
      <dl className="report-list compact-report">
        <div><dt>记录</dt><dd>{session.import_record?.record_id ?? "待创建"}</dd></div>
        <div><dt>文件</dt><dd>{preflight?.file_name ?? session.document?.file_name ?? "未知"}</dd></div>
        <div><dt>字符数</dt><dd>{formatNumber(preflight?.total_chars ?? session.document?.total_chars ?? 0)}</dd></div>
        <div><dt>预估 Token</dt><dd>{formatNumber(preflight?.estimated_tokens ?? 0)}</dd></div>
        <div><dt>结构</dt><dd>{preflight ? structureLabel(preflight) : "未检测"}</dd></div>
        <div><dt>章节</dt><dd>{chapters.length}</dd></div>
        <div><dt>已选</dt><dd>{selectedRows.length} 章 / {formatNumber(selectedChars)} 字</dd></div>
        <div><dt>选中 Token</dt><dd>{formatNumber(selectedTokens)}</dd></div>
        <div><dt>切片（Chunk）</dt><dd>{totalChunks}</dd></div>
        <div><dt>任务（Job）</dt><dd>{activeJob ? processStatusLabel(activeJob.status) : "未创建"}</dd></div>
        <div><dt>并发</dt><dd>{processing.config.maxConcurrency}</dd></div>
      </dl>
      {samples.length > 0 ? (
        <div className="novel-heading-samples is-preview">
          {samples.map((heading, index) => <span key={`${index}:${heading}`}>{heading}</span>)}
        </div>
      ) : (
        <p className="inline-warning">未检测到稳定章节标题，后续拆分需要人工规则或兜底分片。</p>
      )}
      {splitReport && (
        <section className="novel-local-split-report" aria-label="本地章节拆分报告">
          <dl className="report-list compact-report">
            <div><dt>来源</dt><dd>{splitReport.sourceType}</dd></div>
            <div><dt>整体置信度</dt><dd>{Math.round(splitReport.overallConfidence * 100)}%</dd></div>
            <div><dt>平均长度</dt><dd>{formatNumber(splitReport.preview.averageChapterLength)} 字</dd></div>
            <div><dt>异常比例</dt><dd>{Math.round(splitReport.anomalyRatio * 100)}%</dd></div>
            <div><dt>人工确认</dt><dd>{splitReport.needsHumanConfirmation ? "需要" : "不需要"}</dd></div>
            <div><dt>回退处理</dt><dd>{splitReport.usedFallback ? "已启用" : "未启用"}</dd></div>
          </dl>
          {splitReport.lowConfidenceReason && <p className="inline-warning">{splitReport.lowConfidenceReason}</p>}
          <div className="novel-heading-samples is-preview">
            {splitReport.preview.firstTwentyTitles.map((title, index) => <span key={`${index}:${title}`}>{title}</span>)}
          </div>
          {splitReport.preview.anomalyChapters.length > 0 && (
            <div className="novel-split-anomalies">
              {splitReport.preview.anomalyChapters.slice(0, 8).map((chapter) => (
                <span key={chapter.chapterId}>{chapter.index + 1}. {chapter.title} · {chapter.anomalyFlags.join(", ")}</span>
              ))}
            </div>
          )}
          <p className="novel-split-actions">推荐操作：{splitReport.preview.recommendedActions.map(recommendedActionLabel).join(" / ")}</p>
        </section>
      )}
      <section className="novel-processing-controls" aria-label="章节批量选择">
        <div className="novel-processing-selection-toolbar">
          <ChapterSelectionCheckbox
            className="novel-chapter-bulk-select"
            checked={allChaptersSelected}
            indeterminate={partiallySelected}
            disabled={chapterCount === 0}
            ariaLabel={allChaptersSelected ? "全不选章节" : "全选章节"}
            onChange={toggleAllChapters}
          >
            <span className="novel-chapter-bulk-copy">
              <strong>{allChaptersSelected ? "全不选" : "全选"}</strong>
              <span className="novel-chapter-selection-count">已选 {selectedChapterCount} / 共 {chapterCount} 章</span>
            </span>
          </ChapterSelectionCheckbox>
          <div className="row-actions">
          <button type="button" data-help-key="novel.splitChapters" onClick={splitChapters}><Scissors size={14} /> 重新识别章节</button>
          <button type="button" data-help-key="novel.selectAllChapters" onClick={selectAll}>全选</button>
          <button type="button" data-help-key="novel.invertChapters" onClick={invertSelection}>反选</button>
          <RichSelect
            value={volumeLabel}
            options={volumeLabels.map((label) => ({ value: label, label }))}
            ariaLabel="按卷选择"
            helpKey="novel.volumeFilter"
            variant="compact"
            onChange={setVolumeLabel}
          />
          <button type="button" data-help-key="novel.selectVolume" onClick={() => selectVolume(volumeLabel)}>按卷选择</button>
          <button type="button" data-help-key="novel.selectUnprocessed" onClick={selectUnprocessed}>只选未处理</button>
          <button type="button" data-help-key="novel.selectFailed" onClick={selectFailed}>只选失败章节</button>
          <button type="button" data-help-key="novel.clearSelection" onClick={clearSelection}>清空选择</button>
          </div>
        </div>
        <div className="novel-processing-config-grid">
          <label><span>目标字符</span><input type="number" data-help-key="novel.process.chunkTargetChars" min={2000} max={60000} value={processing.config.chunkTargetChars} onChange={(event) => updateConfig({ chunkTargetChars: Number(event.target.value) })} /></label>
          <label><span>最大字符</span><input type="number" data-help-key="novel.process.chunkMaxChars" min={4000} max={60000} value={processing.config.chunkMaxChars} onChange={(event) => updateConfig({ chunkMaxChars: Number(event.target.value) })} /></label>
          <label><span>最小字符</span><input type="number" data-help-key="novel.process.chunkMinChars" min={500} max={20000} value={processing.config.chunkMinChars} onChange={(event) => updateConfig({ chunkMinChars: Number(event.target.value) })} /></label>
          <label><span>上下文重叠字符</span><input type="number" data-help-key="novel.process.chunkOverlapChars" min={0} max={4000} value={processing.config.chunkOverlapChars} onChange={(event) => updateConfig({ chunkOverlapChars: Number(event.target.value) })} /></label>
          <label><span>最大并发</span><input type="number" data-help-key="novel.process.maxConcurrency" min={1} max={10} value={processing.config.maxConcurrency} onChange={(event) => updateConfig({ maxConcurrency: Number(event.target.value) })} /></label>
          <label><span>最大重试</span><input type="number" data-help-key="novel.process.maxRetryCount" min={0} max={10} value={processing.config.maxRetryCount} onChange={(event) => updateConfig({ maxRetryCount: Number(event.target.value) })} /></label>
        </div>
        <div className="novel-processing-draft-grid">
          <label><span>输出格式</span><input data-help-key="novel.process.outputFormat" value={processing.outputFormat} onChange={(event) => updateDraft({ outputFormat: event.target.value })} /></label>
          <label><span>提示词版本（Prompt）</span><input data-help-key="novel.process.promptVersion" value={processing.promptVersion} onChange={(event) => updateDraft({ promptVersion: event.target.value })} /></label>
          <label className="is-wide"><span>用户指令</span><textarea data-help-key="novel.process.userInstruction" value={processing.userInstruction} onChange={(event) => updateDraft({ userInstruction: event.target.value })} /></label>
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="primary-action"
            data-help-key="novel.createProcessJob"
            data-testid="novel-create-process-job"
            disabled={createDisabled}
            aria-describedby={visibleCreationState ? "novel-process-job-creation-status" : undefined}
            onClick={() => void createJob()}
          >
            {isCreatingJob ? <RoseTwoLoader className="novel-create-job-spinner" particleCount={18} /> : matchingJob ? <CheckCircle2 size={14} /> : <Play size={14} />}
            {isCreatingJob ? "正在创建任务" : matchingJob ? "任务已存在" : "创建任务"}
          </button>
          <button
            type="button"
            data-help-key="novel.regenerateProcessJob"
            data-testid="novel-regenerate-process-job"
            disabled={regenerateDisabled}
            onClick={() => void createJob({ regenerate: true })}
          >
            <RotateCcw size={14} />
            重新生成切片和任务
          </button>
          <button type="button" data-help-key="novel.retryFailedTasks" disabled={failedTaskCount === 0} onClick={retryFailedTasks}>
            <ShieldAlert size={14} />
            批量重跑失败
          </button>
          <button type="button" data-help-key="novel.reset" onClick={resetSession}>
          <RotateCcw size={14} />
          重新选择文件
          </button>
        </div>
        {visibleCreationState && (
          <section
            id="novel-process-job-creation-status"
            className={`novel-process-job-creation-status is-${visibleCreationState.status}`}
            data-testid="novel-process-job-creation-status"
            role={visibleCreationState.status === "failed" ? "alert" : "status"}
            aria-live={visibleCreationState.status === "failed" ? "assertive" : "polite"}
          >
            <span className="novel-process-job-creation-icon" aria-hidden="true">
              {visibleCreationState.status === "creating"
                ? <RoseTwoLoader className="novel-create-job-spinner" particleCount={18} />
                : visibleCreationState.status === "failed"
                  ? <AlertTriangle size={18} />
                  : <CheckCircle2 size={18} />}
            </span>
            <div>
              <strong>
                {visibleCreationState.status === "creating"
                  ? "正在创建小说处理任务"
                  : visibleCreationState.status === "failed"
                    ? "任务创建失败"
                    : visibleCreationState.status === "created"
                      ? "任务已创建"
                      : "相同章节任务已存在"}
              </strong>
              <p>{visibleCreationState.message}</p>
              {(visibleCreationState.jobId || visibleCreationState.chunkCount) && (
                <small>
                  {visibleCreationState.jobId ? `任务 ${visibleCreationState.jobId}` : ""}
                  {visibleCreationState.jobId && visibleCreationState.chunkCount ? " · " : ""}
                  {visibleCreationState.chunkCount ? `${visibleCreationState.chunkCount} 个切片` : ""}
                </small>
              )}
            </div>
          </section>
        )}
      </section>
      <div className="novel-chapter-table-wrap">
        <table className="novel-chapter-table">
          <thead>
            <tr>
              <th className="novel-chapter-select-column">选择</th>
              <th>章节标题</th>
              <th>字数</th>
              <th>预估 Token</th>
              <th>处理状态</th>
              <th>异常标记</th>
              <th>置信度</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.chapter.chapter_id} className={selected.has(row.chapter.chapter_id) ? "is-selected" : ""}>
                <td className="novel-chapter-select-cell">
                  <ChapterSelectionCheckbox
                    className="novel-chapter-row-select"
                    checked={selected.has(row.chapter.chapter_id)}
                    ariaLabel={`选择章节：${row.chapter.title}`}
                    onChange={() => toggleChapter(row.chapter.chapter_id)}
                  />
                </td>
                <td><strong>{row.chapter.title}</strong><small>{row.volumeLabel} · #{row.chapter.index + 1}</small></td>
                <td>{formatNumber(row.charCount)}</td>
                <td>{formatNumber(row.estimatedTokens)}</td>
                <td>
                  <span className={`novel-process-status is-${row.status}`}>{processStatusLabel(row.status)}</span>
                  <small className="novel-process-chunk-progress">
                    {row.chunkCount > 0 ? `${row.completedChunkCount}/${row.chunkCount} chunk` : "0/0 chunk"}
                    {row.failedChunkCount > 0 ? ` · 失败 ${row.failedChunkCount}` : ""}
                  </small>
                </td>
                <td>{row.anomalyFlags.length > 0 ? row.anomalyFlags.join(", ") : "无"}</td>
                <td>{Math.round(row.chapter.confidence * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {activeJob && (
        <section className="novel-agent-task-panel" aria-label="切片处理任务初始化">
          <header>
            <div>
              <strong>小说处理任务（NovelProcessJob）</strong>
              <span>{activeJob.jobId} · {activeJob.totalChunks} 个切片 · 最大并发={activeJob.maxConcurrency}</span>
            </div>
            <small>{activeJob.completedChunks}/{activeJob.totalChunks} 完成 · 失败 {activeJob.failedChunks}</small>
          </header>
          <div className="novel-agent-task-list">
            {activeTasks.slice(0, 24).map((task) => (
              <article key={task.agentTaskId} className={`is-${task.status}`}>
                <header>
                  <strong>处理槽 {task.agentIndex + 1}</strong>
                  <span>{processStatusLabel(task.status)} · 重试 {task.retryCount}</span>
                </header>
                <p>{task.chunkId} · 输入 {formatNumber(task.inputTokens)} / 总计 {formatNumber(task.totalTokens)}</p>
                {task.errorMessage && <p className="inline-error">{task.errorMessage}</p>}
                <div className="row-actions">
                  <button type="button" data-help-key="novel.process.retryTask" disabled={task.status !== "failed" || task.retryCount >= activeJob.maxRetryCount} onClick={() => retryTask(task.agentTaskId)}>单个重跑</button>
                  <button type="button" data-help-key="novel.process.markTaskFailed" disabled={task.status === "completed"} onClick={() => markTaskFailed(task.agentTaskId, "在章节规划器中手动标记为失败。")}>标记失败</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="novel-merge-preview" aria-label="结果拼接预览">
        <header>
          <strong>结果拼接规则</strong>
          <span>{merged.chapterTexts.length} 章 · 失败切片不阻止查看已完成结果</span>
        </header>
        <pre>{merged.fullText || "等待后续切片处理槽写入切片结果；合并时会按章节和切片顺序拼接，并去掉重叠内容。"}</pre>
      </section>
    </section>
  );
}

function StatusPanel() {
  const session = useNovelImportStore((state) => state.session);
  const pendingImport = useNovelImportStore((state) => state.pendingImport);
  const importJob = useNovelImportStore((state) => state.importJob);
  const progress = useNovelImportStore((state) => state.progress);
  const scanRetries = useNovelImportStore((state) => state.scanRetries);
  const model = getNovelImportModelStatus();
  const scannedChars = session.ai_chunk_analyses.reduce((sum, analysis) => {
    const chunk = session.chunks.find((item) => item.chunk_id === analysis.chunk_id);
    return sum + (chunk ? Math.max(0, chunk.end_offset - chunk.start_offset) : 0);
  }, 0);
  const estimatedNodes = session.scenes.length || session.chapters.length * 8 || 0;
  const validationErrors = session.validation_reports.reduce((sum, report) => sum + report.errors.length, 0);
  const validationFixes = session.validation_reports.reduce((sum, report) => sum + report.fixes.length, 0);
  const checkpointSummary = [
    Object.keys(session.scan_partials).length > 0 ? `扫描 ${Object.keys(session.scan_partials).length}` : "",
    Object.keys(session.outline_partials).length > 0 ? `大纲 ${Object.keys(session.outline_partials).length}` : "",
    session.planned_chapter_ids.length > 0 ? `章节 ${session.planned_chapter_ids.length}` : "",
  ].filter(Boolean).join(" / ") || "无";
  const preflight = pendingImport?.preflight ?? session.import_record?.preflight ?? preflightFromDocument(session.document);

  return (
    <aside className="novel-ai-status-panel">
      <strong>运行状态</strong>
      <dl>
        <div><dt>当前模型</dt><dd>{model.label}</dd></div>
        <div><dt>当前阶段</dt><dd>{progress?.stageLabel ?? getStageMeta(session.ai_stage).label}</dd></div>
        <div><dt>最近响应</dt><dd>{formatResponseDuration(progress?.lastResponseMs)}</dd></div>
        <div><dt>上下文预算</dt><dd>{model.contextBudget.toLocaleString()} Token</dd></div>
        <div><dt>可用输入</dt><dd>{model.availableInputBudget.toLocaleString()} Token</dd></div>
        <div><dt>保留缓冲</dt><dd>{model.reservedBudget.toLocaleString()} Token</dd></div>
        <div><dt>文本规模</dt><dd>{preflight ? `${formatNumber(preflight.total_chars)} 字 / 约 ${formatNumber(preflight.estimated_tokens)} Token` : session.document ? `${session.document.total_chars.toLocaleString()} 字 / 约 ${estimateTokens(session.document.normalized_text).toLocaleString()} Token` : "未导入"}</dd></div>
        <div><dt>推荐方式</dt><dd>{preflight?.recommendation_label ?? "待检测"}</dd></div>
        <div><dt>已扫描</dt><dd>{scannedChars.toLocaleString()} 字</dd></div>
        <div><dt>批次数</dt><dd>{session.ai_chunk_analyses.length}/{session.chunks.length || 0}</dd></div>
        <div><dt>已存断点</dt><dd>{checkpointSummary}</dd></div>
        <div><dt>失败/重试</dt><dd>{importJob?.failedSceneIds.length ?? 0} / {scanRetries}</dd></div>
        <div><dt>结构校验</dt><dd>{session.validation_reports.length > 0 ? `修复 ${validationFixes} / 阻断 ${validationErrors}` : "待运行"}</dd></div>
        <div><dt>质量评分</dt><dd>{session.quality_report ? `${session.quality_report.score}/${session.quality_report.threshold} · ${qualityRiskLabel(session.quality_report.risk_level)}` : "待评估"}</dd></div>
        <div><dt>预计节点</dt><dd>{estimatedNodes || "待规划"}</dd></div>
      </dl>
    </aside>
  );
}

function NovelImportLanding() {
  const session = useNovelImportStore((state) => state.session);
  const pendingImport = useNovelImportStore((state) => state.pendingImport);
  const importFile = useNovelImportStore((state) => state.importFile);
  const confirmDirectImport = useNovelImportStore((state) => state.confirmDirectImport);
  const startChapterSplitImport = useNovelImportStore((state) => state.startChapterSplitImport);
  const cancelPendingImport = useNovelImportStore((state) => state.cancelPendingImport);
  const updateImportOptions = useNovelImportStore((state) => state.updateImportOptions);
  const startAiAnalysis = useNovelImportStore((state) => state.startAiAnalysis);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const [textCheckOpen, setTextCheckOpen] = useState(false);
  const [largeDialogKey, setLargeDialogKey] = useState<string | undefined>();
  const model = getNovelImportModelStatus();
  const document = session.document;
  const activePreflight = pendingImport?.preflight ?? session.import_record?.preflight ?? preflightFromDocument(document);
  const estimatedTokens = document ? estimateTokens(document.normalized_text) : 0;
  const canResume = session.ai_chunk_analyses.length > 0 || Object.keys(session.scan_partials).length > 0 || Object.keys(session.outline_partials).length > 0 || session.planned_chapter_ids.length > 0;
  const pendingKey = pendingImport ? `${pendingImport.preflight.file_hash_sha256 ?? pendingImport.preflight.file_name}:${pendingImport.preflight.total_chars}` : undefined;
  const shouldShowLargeDialog = Boolean(
    pendingImport &&
    pendingImport.preflight.recommended_action !== "direct" &&
    largeDialogKey === pendingKey
  );

  useEffect(() => {
    setLargeDialogKey(pendingKey);
  }, [pendingKey]);

  return (
    <section className={`novel-ai-landing novel-ai-launchpad${activePreflight ? " has-preflight" : ""}`}>
      <div className="novel-ai-launchbar">
        <div className="novel-ai-copy">
          <span className="panel-kicker">AI 小说导入</span>
          <h3>长篇小说转蓝图控制台</h3>
          <p>大模型会分批阅读全文，先生成完整文章大纲。确认大纲后，系统会自动规划场景并逐个写入蓝图节点。</p>
        </div>
        <div className="novel-ai-main-actions">
          <label className={`file-button novel-ai-compact-button${isProcessing ? " is-disabled" : ""}`} data-help-key="novel.importFile" aria-disabled={isProcessing}>
            <FileSearch size={16} />
            选择小说文件
            <input type="file" accept=".txt,.md,.epub,.html,.htm,.xhtml,.docx,.json" disabled={isProcessing} onChange={(event) => event.target.files?.[0] && importFile(event.target.files[0])} />
          </label>
          <button type="button" className={`primary-action novel-ai-compact-button ai-glow-button${isProcessing ? " ai-flow-active" : ""}`} data-help-key="novel.aiStart" disabled={!document || Boolean(pendingImport) || session.status === "chapters_split" || isProcessing || !model.configured} onClick={() => void startAiAnalysis()}>
            <WandSparkles size={16} />
            {canResume ? "继续 AI 解析" : "开始 AI 解析"}
          </button>
        </div>
      </div>
      {!model.configured && <p className="inline-warning">尚未配置文本生成模型。请先到“模型/连接”配置模型，小说导入不会默认使用纯规则切分。</p>}
      {activePreflight && (
        <NovelImportPreflightCard
          preflight={activePreflight}
          pending={Boolean(pendingImport)}
          isProcessing={isProcessing}
          modelLabel={model.label}
          onDirect={confirmDirectImport}
          onSplit={startChapterSplitImport}
          onCancel={cancelPendingImport}
        />
      )}
      {shouldShowLargeDialog && pendingImport && (
        <LargeTextPreflightDialog
          preflight={pendingImport.preflight}
          isProcessing={isProcessing}
          onSplit={startChapterSplitImport}
          onDirect={confirmDirectImport}
          onCancel={cancelPendingImport}
        />
      )}
      {document && !pendingImport && session.status !== "chapters_split" && (
        <section className="novel-direct-options" aria-label="小说直接处理选项">
          <label className="novel-branch-toggle">
            <input
              type="checkbox"
              data-help-key="novel.branchSuggestions"
              checked={session.import_options.allow_branch_suggestions}
              onChange={(event) => updateImportOptions({ allow_branch_suggestions: event.target.checked })}
              disabled={isProcessing}
            />
            <span>
              <strong>推测潜在分支</strong>
              <small>开启后会分析时间线、动机和伏笔冲突，并在高置信分歧处生成选项分支节点。关闭时只解析为一条顺畅主线。</small>
            </span>
          </label>
          <article className={`novel-expand-control novel-text-check${textCheckOpen ? " is-expanded" : ""}`}>
            <button
              type="button"
              className="novel-expand-toggle"
              aria-expanded={textCheckOpen}
              data-help-key="novel.normalizedTextToggle"
              onClick={() => setTextCheckOpen((value) => !value)}
            >
              <span className="novel-expand-summary">
                <strong>展开文本检查与修正</strong>
                <small>查看清洗后的原文，并在 AI 扫描前微调内容。</small>
              </span>
              <ChevronDown className="novel-expand-chevron" size={16} />
            </button>
            <div className="novel-expand-content-wrap">
              <div className="novel-expand-content">
                <textarea data-help-key="novel.normalizedText" value={document.normalized_text} onChange={(event) => useNovelImportStore.getState().updateDocumentText(event.target.value)} />
              </div>
            </div>
          </article>
          <p className="inline-status">已确认直接处理：{document.file_name}，约 {estimatedTokens.toLocaleString()} Token。点击“开始 AI 解析”后才会调用模型。</p>
        </section>
      )}
    </section>
  );
}

function NovelAiScanPanel() {
  const analyses = useNovelImportStore((state) => state.session.ai_chunk_analyses);
  return (
    <section className="novel-primary-panel novel-ai-scan-panel is-active">
      <h3>AI 全文扫描</h3>
      <p>模型正在分批阅读小说，提取章节候选、角色、时间线和伏笔。每个批次都会保留摘要，供后续合成全书大纲。</p>
      <div className="novel-ai-log-list">
        {analyses.map((analysis) => (
          <article key={analysis.chunk_id}>
            <strong>批次 {analysis.index + 1}</strong>
            <span>置信度 {Math.round(analysis.confidence * 100)}%</span>
            <p>{analysis.summary}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function NovelNextActionBanner({
  outline,
  chapters,
  characters,
  isProcessing,
  onConfirm,
}: {
  outline: NovelAiOutline;
  chapters: ChapterCandidate[];
  characters: CharacterCandidate[];
  isProcessing: boolean;
  onConfirm: () => void;
}) {
  const warningCount = outline.warnings.length + (outline.needs_review ? 1 : 0);
  const estimatedNodes = Math.max(outline.chapters.length, chapters.length) * 8;
  return (
    <section className="novel-next-action-banner" aria-label="下一步操作">
      <div>
        <span className="panel-kicker">下一步</span>
        <strong>全文解析已完成，请复核大纲，然后生成蓝图节点。</strong>
        <p>确认章节、角色和主线没有明显偏差后，系统会继续规划场景并逐个写入画布。</p>
      </div>
      <dl>
        <div><dt>章节</dt><dd>{chapters.length || outline.chapters.length}</dd></div>
        <div><dt>角色</dt><dd>{characters.length || outline.characters.length}</dd></div>
        <div><dt>警告</dt><dd>{warningCount}</dd></div>
        <div><dt>预计节点</dt><dd>{estimatedNodes || "待估算"}</dd></div>
      </dl>
      <button type="button" className={`primary-action ai-glow-button${isProcessing ? " ai-flow-active" : ""}`} data-help-key="novel.confirmOutline" disabled={isProcessing} onClick={onConfirm}>
        <BookOpen size={16} />
        确认大纲并生成蓝图
      </button>
    </section>
  );
}

function NovelOutlineReview() {
  const outline = useNovelImportStore((state) => state.session.ai_outline);
  const chapters = useNovelImportStore((state) => state.session.chapters);
  const characters = useNovelImportStore((state) => state.session.characters);
  const characterReviews = useNovelImportStore((state) => state.session.character_candidates_review ?? []);
  const updateChapter = useNovelImportStore((state) => state.updateOutlineChapter);
  const removeChapter = useNovelImportStore((state) => state.removeOutlineChapter);
  const updateCharacter = useNovelImportStore((state) => state.updateOutlineCharacter);
  const promoteCharacterCandidate = useNovelImportStore((state) => state.promoteCharacterCandidate);
  const ignoreCharacterCandidate = useNovelImportStore((state) => state.ignoreCharacterCandidate);
  const confirmOutlineAndGenerate = useNovelImportStore((state) => state.confirmOutlineAndGenerate);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const pendingCharacterReviews = characterReviews.filter((review) => review.status !== "promoted");

  if (!outline) {
    return (
      <section className="novel-primary-panel novel-empty-state">
        <h3>等待大纲</h3>
        <p>请先导入小说并开始 AI 解析。</p>
      </section>
    );
  }

  return (
    <section className="novel-outline-review">
      <NovelNextActionBanner outline={outline} chapters={chapters} characters={characters} isProcessing={isProcessing} onConfirm={() => void confirmOutlineAndGenerate()} />
      <article className="novel-outline-summary">
        <h3>全书大纲确认</h3>
        <p>{outline.summary}</p>
        <strong>主线</strong>
        <p>{outline.main_plot}</p>
        {outline.needs_review && <p className="inline-warning"><AlertTriangle size={14} /> 模型认为覆盖率不足，请重点复核章节范围。</p>}
      </article>
      <NovelChapterSplitEntry />
      <div className="novel-outline-grid">
        <section className="novel-outline-section">
          <h4>章节列表</h4>
          <div className="novel-edit-list">
            {chapters.map((chapter) => (
              <ChapterRow key={chapter.chapter_id} chapter={chapter} onChange={updateChapter} onRemove={removeChapter} />
            ))}
          </div>
        </section>
        <section className="novel-outline-section">
          <div className="novel-section-heading">
            <h4>主要角色</h4>
            <span>{characters.length} 个已确认</span>
          </div>
          <div className="novel-edit-list">
            {characters.length > 0 ? (
              characters.map((character) => (
                <CharacterRow key={character.character_id} character={character} onChange={updateCharacter} />
              ))
            ) : (
              <p className="novel-muted-note">暂无已确认角色。</p>
            )}
          </div>
          <CandidateCharacterReviewPanel
            reviews={pendingCharacterReviews}
            onPromote={promoteCharacterCandidate}
            onIgnore={ignoreCharacterCandidate}
          />
        </section>
      </div>
    </section>
  );
}

function ChapterRow({ chapter, onChange, onRemove }: { chapter: ChapterCandidate; onChange: (chapter: ChapterCandidate) => void; onRemove: (chapterId: string) => void }) {
  return (
    <article className="novel-edit-row">
      <input data-help-key="novel.chapterTitle" value={chapter.title} onChange={(event) => onChange({ ...chapter, title: event.target.value })} />
      <textarea data-help-key="novel.chapterSummary" value={chapter.summary} onChange={(event) => onChange({ ...chapter, summary: event.target.value })} />
      <span>{chapter.start_offset} - {chapter.end_offset} / {Math.round(chapter.confidence * 100)}%</span>
      <button type="button" data-help-key="novel.removeChapter" onClick={() => onRemove(chapter.chapter_id)}>移除</button>
    </article>
  );
}

function CharacterRow({ character, onChange }: { character: CharacterCandidate; onChange: (character: CharacterCandidate) => void }) {
  return (
    <article className="novel-edit-row">
      <input data-help-key="novel.characterId" value={character.character_id} onChange={(event) => onChange({ ...character, character_id: event.target.value })} />
      <input data-help-key="novel.characterName" value={character.name} onChange={(event) => onChange({ ...character, name: event.target.value })} />
      <textarea data-help-key="novel.characterDescription" value={character.description} onChange={(event) => onChange({ ...character, description: event.target.value })} />
    </article>
  );
}

function CandidateCharacterReviewPanel({
  reviews,
  onPromote,
  onIgnore,
}: {
  reviews: CharacterCandidateReview[];
  onPromote: (characterId: string) => void;
  onIgnore: (characterId: string) => void;
}) {
  if (reviews.length === 0) return null;
  const activeCount = reviews.filter((review) => review.status === "candidate").length;
  const ignoredCount = reviews.filter((review) => review.status === "ignored").length;
  return (
    <details className="novel-character-review" open={activeCount > 0}>
      <summary>
        <span>候选角色 / 待复核</span>
        <strong>{activeCount} 个候选</strong>
        {ignoredCount > 0 && <em>{ignoredCount} 个已忽略</em>}
        <ChevronDown size={15} aria-hidden="true" />
      </summary>
      <div className="novel-character-review-list">
        {reviews.map((review) => (
          <CandidateCharacterRow
            key={review.character.character_id}
            review={review}
            onPromote={onPromote}
            onIgnore={onIgnore}
          />
        ))}
      </div>
    </details>
  );
}

function CandidateCharacterRow({
  review,
  onPromote,
  onIgnore,
}: {
  review: CharacterCandidateReview;
  onPromote: (characterId: string) => void;
  onIgnore: (characterId: string) => void;
}) {
  const evidence = [
    `场景 ${review.evidence.sceneRefs}`,
    `命令 ${review.evidence.commandRefs}`,
    review.evidence.aliasMatches.length > 0 ? `命中 ${review.evidence.aliasMatches.slice(0, 3).join(" / ")}` : undefined,
  ].filter((item): item is string => Boolean(item));
  return (
    <article className={`novel-candidate-row${review.status === "ignored" ? " is-ignored" : ""}`}>
      <div>
        <strong>{review.character.name}</strong>
        <span>{review.character.character_id}</span>
      </div>
      <p>{review.character.description}</p>
      <div className="novel-candidate-meta">
        <span>评分 {review.score}</span>
        {review.reasons.slice(0, 4).map((reason, index) => <span key={`review-reason:${index}:${reason}`}>{reason}</span>)}
        {evidence.map((item, index) => <span key={`evidence:${index}:${item}`}>{item}</span>)}
      </div>
      <div className="row-actions">
        <button type="button" data-help-key="novel.characterReview.promote" onClick={() => onPromote(review.character.character_id)}>
          <CheckCircle2 size={14} />
          提升为主要角色
        </button>
        <button type="button" data-help-key="novel.characterReview.ignore" onClick={() => onIgnore(review.character.character_id)} disabled={review.status === "ignored"}>
          <XCircle size={14} />
          {review.status === "ignored" ? "已忽略" : "忽略"}
        </button>
      </div>
    </article>
  );
}

function NovelBlueprintGenerationPanel() {
  const session = useNovelImportStore((state) => state.session);
  const progress = useNovelImportStore((state) => state.progress);
  const importJob = useNovelImportStore((state) => state.importJob);
  const errors = useNovelImportStore((state) => state.errors);
  const pause = useNovelImportStore((state) => state.pauseBlueprintGeneration);
  const resume = useNovelImportStore((state) => state.resumeBlueprintGeneration);
  const skip = useNovelImportStore((state) => state.skipCurrentScene);
  const cancel = useNovelImportStore((state) => state.cancelBlueprintGeneration);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const latestErrorSummary = useMemo(() => getLatestImportErrorSummary(errors), [errors]);

  return (
    <section className={`novel-primary-panel novel-blueprint-generation${isProcessing ? " is-active" : ""}${latestErrorSummary ? " is-error" : ""}`}>
      <h3>{session.ai_stage === "planning" ? "AI 场景规划" : "蓝图生成"}</h3>
      {latestErrorSummary ? (
        <p className="novel-step-error-hint" role="alert">场景规划失败：{latestErrorSummary}</p>
      ) : (
        <p>确认大纲后，章节会自动规划为场景，随后每个场景逐个生成并写入画布。</p>
      )}
      {progress && <progress value={progress.current} max={progress.total} />}
      {importJob && (
        <dl className="report-list compact-report">
          <div><dt>已生成</dt><dd>{importJob.generatedCount}/{importJob.total}</dd></div>
          <div><dt>失败</dt><dd>{importJob.failedSceneIds.length}</dd></div>
          <div><dt>跳过</dt><dd>{importJob.skippedSceneIds?.length ?? 0}</dd></div>
          <div><dt>状态</dt><dd>{novelImportStatusLabel(importJob.status)}</dd></div>
        </dl>
      )}
      <div className="row-actions">
        {importJob?.status === "paused" || importJob?.status === "cancelled" ? (
          <button type="button" data-help-key="novel.resumeBlueprint" disabled={isProcessing} onClick={() => void resume()}><Play size={14} /> 继续</button>
        ) : (
          <button type="button" data-help-key="novel.pauseBlueprint" disabled={!isProcessing} onClick={pause}><Pause size={14} /> 暂停</button>
        )}
        <button type="button" data-help-key="novel.skipScene" disabled={!isProcessing} onClick={skip}><SkipForward size={14} /> 跳过当前场景</button>
        <button type="button" data-help-key="novel.cancelBlueprintLine" disabled={!isProcessing} onClick={cancel}><XCircle size={14} /> 取消</button>
      </div>
    </section>
  );
}

function NovelImportReportPanel() {
  const session = useNovelImportStore((state) => state.session);
  const importJob = useNovelImportStore((state) => state.importJob);
  const warnings = useNovelImportStore((state) => state.warnings);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const retryQualityCheck = useNovelImportStore((state) => state.retryQualityCheck);
  const continueWithQualityRisk = useNovelImportStore((state) => state.continueWithQualityRisk);
  const nodes = useEditorStore((state) => state.nodes);
  const selectNode = useEditorStore((state) => state.selectNode);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const importedNodes = useMemo(() => {
    const scoped = nodes.filter((node) => node.data.editorMeta?.importSessionId === session.session_id);
    return scoped.length > 0 ? scoped : nodes.filter((node) => node.data.editorMeta?.source === "imported");
  }, [nodes, session.session_id]);
  const assetAudit = useMemo(() => buildProjectAssetAudit(importedNodes, assetManifest, { includeOptional: true }), [assetManifest, importedNodes]);
  return (
    <section className="novel-primary-panel novel-import-report-panel">
      <h3>导入报告</h3>
      <dl className="report-list">
        <div><dt>文本字符</dt><dd>{session.document?.total_chars ?? 0}</dd></div>
        <div><dt>AI 批次</dt><dd>{session.ai_chunk_analyses.length}</dd></div>
        <div><dt>章节</dt><dd>{session.chapters.length}</dd></div>
        <div><dt>场景规划</dt><dd>{session.scenes.length}</dd></div>
        <div><dt>已写入节点</dt><dd>{session.adapted_scenes.length}</dd></div>
        <div><dt>失败场景</dt><dd>{importJob?.failedSceneIds.length ?? 0}</dd></div>
        <div><dt>待复核</dt><dd>{session.adapted_scenes.filter((scene) => scene.needs_review).length}</dd></div>
        <div><dt>待补视觉资产</dt><dd>{assetAudit.pending.filter((item) => !item.optional).length}</dd></div>
        <div><dt>缺背景场景</dt><dd>{assetAudit.missing_background_scenes.length}</dd></div>
        <div><dt>缺立绘角色</dt><dd>{assetAudit.missing_sprite_characters.length}</dd></div>
        <div><dt>缺头像角色</dt><dd>{assetAudit.missing_portrait_characters.length}</dd></div>
        <div><dt>音频/演出可选</dt><dd>{assetAudit.optional_audio_performance.length}</dd></div>
        <div><dt>警告</dt><dd>{warnings.length + (session.ai_outline?.warnings.length ?? 0)}</dd></div>
      </dl>
      {session.quality_report && (
        <NovelQualityPanel
          report={session.quality_report}
          accepted={session.quality_risk_accepted}
          isProcessing={isProcessing}
          showActions={false}
          onRetry={() => void retryQualityCheck()}
          onContinue={() => void continueWithQualityRisk()}
        />
      )}
      {assetAudit.pending.length > 0 && (
        <div className="novel-missing-asset-list">
          {assetAudit.pending.slice(0, 8).map((item) => (
            <button type="button" key={item.id} data-help-key="novel.assetAuditItem" disabled={!item.node_id} onClick={() => item.node_id && selectNode(item.node_id)}>
              <span>{item.optional ? "可选" : item.placeholder ? "占位" : "缺失"}</span>
              <strong>{item.scene_title}</strong>
              <small>{item.label}{item.character_id ? ` · ${item.character_id}` : ""}{item.asset_id ? ` · ${item.asset_id}` : ` · ${assetTypeDisplayLabel(item.asset_type ?? item.kind)}`}</small>
            </button>
          ))}
        </div>
      )}
      <p>空白蓝图会接入入口主线；已有蓝图会保留原入口和连线，在画布空白处另开小说工程线。</p>
    </section>
  );
}

export function NovelImportWizard() {
  const session = useNovelImportStore((state) => state.session);
  const importJob = useNovelImportStore((state) => state.importJob);
  const errors = useNovelImportStore((state) => state.errors);
  const warnings = useNovelImportStore((state) => state.warnings);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const resetSession = useNovelImportStore((state) => state.resetSession);
  const retryQualityCheck = useNovelImportStore((state) => state.retryQualityCheck);
  const continueWithQualityRisk = useNovelImportStore((state) => state.continueWithQualityRisk);
  const latestErrorSummary = useMemo(() => getLatestImportErrorSummary(errors), [errors]);

  const activePanel = useMemo(() => {
    if (session.status === "chapters_split") return <NovelChapterSplitEntry />;
    if (session.ai_stage === "scan") return <NovelAiScanPanel />;
    if (session.ai_stage === "outline") return <NovelOutlineReview />;
    if (session.ai_stage === "planning" || session.ai_stage === "generate") return <NovelBlueprintGenerationPanel />;
    if (session.ai_stage === "report") return <NovelImportReportPanel />;
    return <NovelImportLanding />;
  }, [session.ai_stage, session.status]);
  const visibleWarnings = warnings.slice(-4);
  const hasRunFeedback = Boolean(importJob) || errors.length > 0 || visibleWarnings.length > 0;

  return (
    <section className="advanced-tools-panel novel-import-wizard novel-ai-import">
      <NovelStageHeader activeStage={session.ai_stage} isProcessing={isProcessing} errorSummary={latestErrorSummary} onReset={resetSession} />
      <StageTimeline activeStage={session.ai_stage} />
      <NovelOperationHeartbeat />
      <div className="novel-ai-layout">
        <main>
          {activePanel}
          {latestErrorSummary && (
            <p className="inline-error novel-error-summary" role="alert" aria-live="assertive">
              导入解析失败：{latestErrorSummary}{errors.length > 1 ? `（共 ${errors.length} 条错误，当前显示最新一条）` : ""}
            </p>
          )}
          {session.quality_report && session.ai_stage !== "report" && (
            <NovelQualityPanel
              report={session.quality_report}
              accepted={session.quality_risk_accepted}
              isProcessing={isProcessing}
              showActions
              onRetry={() => void retryQualityCheck()}
              onContinue={() => void continueWithQualityRisk()}
            />
          )}
          <div className="novel-secondary-stack">
            <ModelStreamPanel />
            <NovelValidationReportPanel />
            <NovelAiResultPanel />
            <NovelPersistentResultsPanel />
          </div>
          {hasRunFeedback && (
            <section className="novel-run-feedback" aria-live="polite">
              {importJob && (
                <p className="inline-status">蓝图生成：{importJob.generatedCount}/{importJob.total}，失败 {importJob.failedSceneIds.length} 个，状态 {novelImportStatusLabel(importJob.status)}</p>
              )}
              {errors.length > 0 && (
                <section className="novel-run-log is-error" aria-label="运行错误摘要">
                  <header>
                    <strong>运行错误</strong>
                    <span>{errors.length} 条</span>
                  </header>
                  <p>{latestErrorSummary ?? "完整错误已发送到右上角报错通知。"}</p>
                </section>
              )}
              {visibleWarnings.length > 0 && (
                <div className="novel-run-warning-list">
                  {visibleWarnings.map((warning, index) => <p className="inline-warning" key={`${index}:${warning}`}>{warning}</p>)}
                </div>
              )}
            </section>
          )}
        </main>
        <StatusPanel />
      </div>
    </section>
  );
}
