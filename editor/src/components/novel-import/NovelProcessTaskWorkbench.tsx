import {
  ChevronDown,
  Eye,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { backendClient } from "../../api/backendClient";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import {
  createMockNovelProcessSnapshot,
  persistNovelProcessTaskSnapshot,
  readPersistedNovelProcessTaskSnapshot,
  updateMockSnapshotStatus,
} from "../../novel-import/novelProcessJobAdapter";
import {
  isNovelProcessJobUnfinished,
  type NovelProcessAgentProgress,
  type NovelProcessAgentStatus,
  type NovelProcessEvent,
  type NovelProcessJob,
  type NovelProcessJobStatus,
  type NovelProcessPhaseProgress,
  type NovelProcessQualityDimension,
  type NovelProcessQualityIssue,
  type NovelProcessTaskSnapshot,
  type NovelProcessTokenBreakdown,
} from "../../novel-import/processJobTypes";
import { useEditorStore } from "../../store/editorStore";
import { useNovelImportStore } from "../../store/novelImportStore";
import { useProjectStore } from "../../store/projectStore";

type TokenView = "total" | "agent" | "chapter";
type LogOrder = "newest" | "oldest";
type WorkbenchAction = "pause" | "resume" | "cancel" | "retry";

declare global {
  interface Window {
    __AGENTVN_NOVEL_TASK_WORKBENCH_READY__?: boolean;
  }
}

const heartbeatTimeoutMs = 90_000;
const workbenchExitMs = 220;
const tokenPanelMorphMs = 420;
const tokenPanelMorphSettleMs = 120;
const logPanelVisibleEventLimit = 80;

const statusMeta: Record<NovelProcessJobStatus, { label: string; tone: string; detail: string }> = {
  waiting: { label: "等待中", tone: "info", detail: "任务已进入队列，正在等待 Subagent 处理槽。" },
  running: { label: "处理中", tone: "success", detail: "多个 Subagent 正在并行处理小说切片。" },
  paused: { label: "已暂停", tone: "warning", detail: "任务继续前不会分配新的切片。" },
  retrying: { label: "重试中", tone: "retry", detail: "失败切片正在重新排队。" },
  completed: { label: "已完成", tone: "success", detail: "所有可用切片结果均已合并，可以导入。" },
  failed: { label: "失败", tone: "danger", detail: "任务在生成可用结果前失败。" },
  failed_partial: { label: "部分失败", tone: "danger", detail: "部分切片失败，但已完成的结果仍可使用。" },
  cancelled: { label: "已取消", tone: "muted", detail: "任务已取消，已完成的结果仍然保留。" },
};

const agentStatusLabel: Record<NovelProcessAgentStatus, string> = {
  waiting: "等待中",
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  retrying: "重试中",
  cancelled: "已取消",
  timeout_suspected: "心跳超时",
};

const machineValueLabels: Record<string, string> = {
  chunk_parser: "切片解析",
  chunk_parse: "切片解析",
  chapter_split: "章节拆分",
  quality_check: "质量检查",
  result_merge: "结果合并",
  chapter_merger: "章节合并",
  continuity_reviewer: "连续性复核",
  link_polisher: "衔接润色",
  waiting: "等待中",
  running: "处理中",
  paused: "已暂停",
  retrying: "重试中",
  completed: "已完成",
  failed: "失败",
  failed_partial: "部分失败",
  cancelled: "已取消",
  timeout_suspected: "心跳超时",
  pending: "待处理",
  merging: "合并中",
  merged: "已合并",
  skipped: "已跳过",
  discarded_cancelled: "取消后丢弃",
  streaming: "流式输出",
  streaming_partial_chars: "流式输出字符数",
  provider_connection_interrupted: "模型连接中断",
  mock_adapter: "模拟适配器",
  "phase:chunk_parse": "阶段：切片解析",
  "Preparing structured model request": "正在准备结构化模型请求",
  phase: "按阶段",
  task: "按任务",
  token: "按 Token",
  estimated: "预估",
  actual: "实际",
  none: "无",
};

function displayMachineValue(value?: string | null, fallback = "-"): string {
  if (!value) return fallback;
  return machineValueLabels[value] ?? value;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.round(value)));
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`;
  return `${Math.floor(minutes / 60)} 时 ${minutes % 60} 分`;
}

function formatRelativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function payloadPreview(payload: unknown): string | undefined {
  if (payload === undefined || payload === null) return undefined;
  try {
    const text = typeof payload === "string" ? payload : shallowPayloadPreview(payload);
    return text.length > 360 ? `${text.slice(0, 360)}...` : text;
  } catch {
    // error-log-ignore: 这里只生成调试预览，无法序列化时会退回普通字符串。
    return String(payload).slice(0, 360);
  }
}

function shallowPayloadPreview(payload: unknown): string {
  if (!payload || typeof payload !== "object") return String(payload ?? "");
  if (Array.isArray(payload)) return `Array(${payload.length.toLocaleString()})`;
  const entries = Object.entries(payload as Record<string, unknown>).slice(0, 12);
  return entries.map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: Array(${value.length.toLocaleString()})`;
    if (value && typeof value === "object") return `${key}: object`;
    if (typeof value === "string") return `${key}: ${value.length > 100 ? `${value.slice(0, 100)}...` : value}`;
    return `${key}: ${String(value)}`;
  }).join("\n");
}

function displayAgentStatus(agent: NovelProcessAgentProgress): NovelProcessAgentStatus {
  const heartbeatAge = Date.now() - new Date(agent.heartbeatAt).getTime();
  if ((agent.status === "running" || agent.status === "retrying") && heartbeatAge > heartbeatTimeoutMs) {
    return "timeout_suspected";
  }
  return agent.status;
}

type ProgressMeterTone = "running" | "completed" | "failed" | "paused" | "waiting";
type ProgressMeterVariant = "overall" | "agent";

function normalizeProgressValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatProgressPercent(value: number): string {
  if (value > 0 && value < 1) return "<1%";
  if (value > 0 && value < 10) return `${Number(value.toFixed(1))}%`;
  return `${Math.round(value)}%`;
}

function progressBufferValue(value: number, variant: ProgressMeterVariant): number {
  if (variant !== "overall") return 100;
  if (value <= 0) return 12;
  if (value >= 100) return 100;
  return Math.min(100, value + 18);
}

function ProgressMeter({
  value,
  label,
  tone = "running",
  variant = "agent",
}: {
  value: number;
  label: string;
  tone?: ProgressMeterTone;
  variant?: ProgressMeterVariant;
}) {
  const bounded = normalizeProgressValue(value);
  const ariaValue = bounded > 0 && bounded < 0.1 ? 0.1 : Number(bounded.toFixed(1));
  const visualValue = bounded > 0 && bounded < 1 ? 1 : bounded;
  const displayPercent = formatProgressPercent(bounded);
  const bufferValue = progressBufferValue(bounded, variant);
  return (
    <div className={`novel-task-progress-meter is-${variant} is-${tone}`}>
      <span className="novel-task-progress-label">{label}</span>
      <div
        className="novel-task-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ariaValue}
        aria-valuetext={`${label} ${displayPercent}`}
      >
        {variant === "overall" && <span className="novel-task-progress-buffer" style={{ width: `${bufferValue}%` }} />}
        <span className="novel-task-progress-value" style={{ width: `${visualValue}%` }} />
      </div>
      <span className="novel-task-progress-percent">{displayPercent}</span>
    </div>
  );
}

function progressToneFromJob(status: NovelProcessJobStatus): ProgressMeterTone {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "failed_partial" || status === "cancelled") return "failed";
  if (status === "paused") return "paused";
  if (status === "waiting") return "waiting";
  return "running";
}

function progressToneFromAgent(status: NovelProcessAgentStatus): ProgressMeterTone {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled" || status === "timeout_suspected") return "failed";
  if (status === "waiting") return "waiting";
  return "running";
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="novel-task-stat">
      <dt>{label}</dt>
      <dd>{typeof value === "number" ? formatInteger(value) : value}</dd>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function sourceLabel(source: NovelProcessJob["source"]): { label: string; detail: string } {
  if (source === "api") return { label: "真实后端 API", detail: "来自后端 NovelProcessJob 快照" };
  if (source === "ui_pressure_fixture") return { label: "UI 压力测试快照", detail: "仅用于任务面板渲染压力审计，不代表真实 AI 成功" };
  return { label: "本地恢复 / mock adapter", detail: "只用于恢复显示，不能作为全量真实通过依据" };
}

function phaseTone(status: NovelProcessPhaseProgress["status"]): ProgressMeterTone {
  if (status === "completed") return "completed";
  if (status === "blocked" || status === "failed" || status === "cancelled") return "failed";
  if (status === "paused") return "paused";
  if (status === "waiting") return "waiting";
  return "running";
}

type LegacyPhaseProgress = Record<string, number>;

function normalizePhaseProgress(phases?: NovelProcessPhaseProgress[] | LegacyPhaseProgress): NovelProcessPhaseProgress[] {
  if (!phases) return [];
  if (Array.isArray(phases)) return phases;
  return Object.entries(phases).map(([phase, percent]) => ({
    phase,
    label: phase,
    status: percent >= 100 ? "completed" : percent > 0 ? "running" : "waiting",
    current: Math.round(percent),
    total: 100,
    percent,
    startedAt: null,
    updatedAt: null,
    etaMs: null,
    blockingReason: null,
  }));
}

function PhaseTimeline({ phases }: { phases?: NovelProcessPhaseProgress[] | LegacyPhaseProgress }) {
  const rows = normalizePhaseProgress(phases);
  if (rows.length === 0) return null;
  return (
    <div className="novel-phase-timeline" aria-label="任务阶段进度">
      {rows.map((phase) => (
        <article key={phase.phase} className={`is-${phase.status}`}>
          <header>
            <strong>{phase.label}</strong>
            <span>{formatProgressPercent(phase.percent)}</span>
          </header>
          <ProgressMeter value={phase.percent} label={`${phase.label}进度`} tone={phaseTone(phase.status)} />
          <p>{phase.current}/{phase.total}{phase.etaMs ? ` · 预计剩余 ${formatDuration(phase.etaMs)}` : ""}</p>
          {phase.blockingReason && <small title={phase.blockingReason}>{phase.blockingReason}</small>}
        </article>
      ))}
    </div>
  );
}

function QualityIssueList({ issues }: { issues?: NovelProcessQualityIssue[] }) {
  if (!issues || issues.length === 0) return null;
  return (
    <div className="novel-task-quality-issues" role="status" aria-label="质量阻断与修复建议">
      {issues.slice(0, 6).map((issue, index) => (
        <article key={`${issue.code}_${issue.sourceChunkId ?? index}`} className={`is-${issue.severity}`}>
          <strong>{issue.message}</strong>
          {issue.action && <p>{issue.action}</p>}
          {issue.evidence && <small title={issue.evidence}>{issue.sourceChunkId ? `${issue.sourceChunkId} · ` : ""}{issue.evidence}</small>}
        </article>
      ))}
    </div>
  );
}

function QualityDimensionPanel({ dimensions, issues }: { dimensions?: NovelProcessQualityDimension[]; issues?: NovelProcessQualityIssue[] }) {
  if ((!dimensions || dimensions.length === 0) && (!issues || issues.length === 0)) return null;
  return (
    <section className="novel-task-section novel-task-quality-panel" aria-labelledby="novel-task-quality-title">
      <header>
        <div>
          <span className="panel-kicker">质量门禁</span>
          <h3 id="novel-task-quality-title">结果可信度</h3>
        </div>
        <span className="novel-task-count">{issues?.length ?? 0} 个问题</span>
      </header>
      {dimensions && dimensions.length > 0 && (
        <div className="novel-quality-dimension-grid">
          {dimensions.map((dimension) => (
            <article key={dimension.key} className={`is-${dimension.status}`}>
              <header>
                <strong>{dimension.label}</strong>
                <span>{dimension.score}</span>
              </header>
              <ProgressMeter value={dimension.score} label={`${dimension.label}评分`} tone={dimension.status === "good" ? "completed" : dimension.status === "warning" ? "paused" : "failed"} />
              <small>{dimension.value}</small>
            </article>
          ))}
        </div>
      )}
      <QualityIssueList issues={issues} />
    </section>
  );
}

function OverviewPanel({ job }: { job: NovelProcessJob }) {
  const meta = statusMeta[job.status];
  const source = sourceLabel(job.source);
  return (
    <section className="novel-task-section novel-task-overview" aria-labelledby="novel-task-overview-title">
      <header>
        <div>
          <span className="panel-kicker">任务概览</span>
          <h3 id="novel-task-overview-title">{job.novelTitle}</h3>
        </div>
        <span className={`novel-task-status is-${meta.tone}`}>{meta.label}</span>
      </header>
      <p>{meta.detail}</p>
      <dl className="novel-task-stat-grid">
        <StatTile label="已选章节" value={job.selectedChapterCount} />
        <StatTile label="总切片" value={job.totalChunks} />
        <StatTile label="已完成" value={job.completedChunks} />
        <StatTile label="失败" value={job.failedChunks} />
        <StatTile label="已取消" value={job.cancelledChunks} />
        <StatTile label="运行处理槽" value={job.runningAgentCount} />
        <StatTile label="预计剩余" value={`${job.estimatedRemainingChunks} 个切片`} />
        <StatTile label="当前阶段" value={displayMachineValue(job.activePhase, "切片解析")} />
        <StatTile label="数据源" value={source.label} hint={source.detail} />
      </dl>
      <ProgressMeter value={job.progressPercent} label="小说处理整体进度" tone={progressToneFromJob(job.status)} variant="overall" />
      <PhaseTimeline phases={job.phaseProgress} />
    </section>
  );
}

function TokenMetric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <article className="novel-token-metric">
      <span>{label}</span>
      <strong>{formatInteger(value)}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

function TokenBreakdownList({ rows, emptyText }: { rows: NovelProcessTokenBreakdown[]; emptyText: string }) {
  if (rows.length === 0) return <p className="novel-task-empty">{emptyText}</p>;
  const maxTokens = Math.max(1, ...rows.map((row) => row.totalTokens));
  return (
    <div className={`novel-token-breakdown-list${rows.length > 6 ? " is-scrollable" : ""}`}>
      {rows.map((row) => (
        <article key={row.id} className="novel-token-breakdown-row">
          <div>
            <strong title={row.label}>{row.label}</strong>
            <small>{row.chunkCount} 个切片 · 重试额外 {formatInteger(row.retryExtraTokens)}</small>
          </div>
          <span>{formatInteger(row.totalTokens)}</span>
          <div className="novel-token-breakdown-bar" aria-label={`${row.label} token 消耗 ${row.totalTokens}`}>
            <i style={{ width: `${Math.max(4, Math.round((row.totalTokens / maxTokens) * 100))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}

function TokenPanel({ job, tokenView, onTokenViewChange }: { job: NovelProcessJob; tokenView: TokenView; onTokenViewChange: (view: TokenView) => void }) {
  const stats = job.tokenStats;
  const overBudget = stats.estimatedTokens > 0 && stats.actualTokens > stats.estimatedTokens * 1.2;
  const panelRef = useRef<HTMLElement | null>(null);
  const previousRectRef = useRef<DOMRect | null>(null);
  const morphAnimationRef = useRef<Animation | null>(null);
  const morphSettleTimerRef = useRef<number | null>(null);

  function clearMorphSettleTimer() {
    if (morphSettleTimerRef.current === null) return;
    window.clearTimeout(morphSettleTimerRef.current);
    morphSettleTimerRef.current = null;
  }

  function cleanupMorphAnimation(animation = morphAnimationRef.current) {
    const node = panelRef.current;
    if (animation) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      if (morphAnimationRef.current === animation) morphAnimationRef.current = null;
    }
    if (node) {
      node.style.transform = "";
      node.style.opacity = "";
      node.style.height = "";
      node.classList.remove("is-morphing");
      node.classList.remove("is-morph-settled");
    }
  }

  function changeTokenView(view: TokenView) {
    if (view === tokenView) return;
    previousRectRef.current = panelRef.current?.getBoundingClientRect() ?? null;
    clearMorphSettleTimer();
    cleanupMorphAnimation();
    onTokenViewChange(view);
  }

  useLayoutEffect(() => {
    const previousRect = previousRectRef.current;
    const node = panelRef.current;
    previousRectRef.current = null;
    if (!previousRect || !node || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const nextRect = node.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / Math.max(nextRect.width, 1);
    const heightChanged = Math.abs(previousRect.height - nextRect.height) > 1;
    const moved = Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1 || Math.abs(scaleX - 1) > 0.01 || heightChanged;
    if (!moved) return;

    node.classList.add("is-morphing");
    const animation = node.animate(
      [
        {
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, 1)`,
          opacity: 0.96,
          height: `${previousRect.height}px`,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
          height: `${nextRect.height}px`,
        },
      ],
      {
        duration: tokenPanelMorphMs,
        easing: "cubic-bezier(0.18, 0.9, 0.18, 1)",
        fill: "both",
      },
    );
    morphAnimationRef.current = animation;
    animation.onfinish = () => {
      node.classList.add("is-morph-settled");
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      node.style.transform = "";
      node.style.opacity = "";
      node.style.height = "";
      if (morphAnimationRef.current === animation) morphAnimationRef.current = null;
      morphSettleTimerRef.current = window.setTimeout(() => {
        node.classList.remove("is-morphing");
        node.classList.remove("is-morph-settled");
        morphSettleTimerRef.current = null;
      }, tokenPanelMorphSettleMs);
    };
    animation.oncancel = () => {
      node.classList.remove("is-morphing");
      node.classList.remove("is-morph-settled");
      node.style.transform = "";
      node.style.opacity = "";
      node.style.height = "";
      if (morphAnimationRef.current === animation) morphAnimationRef.current = null;
    };
  }, [tokenView]);

  useEffect(() => () => {
    clearMorphSettleTimer();
    cleanupMorphAnimation();
  }, []);

  return (
    <section ref={panelRef} className="novel-task-section novel-token-panel" aria-labelledby="novel-task-token-title">
      <header>
        <div>
          <span className="panel-kicker">Token 统计</span>
          <h3 id="novel-task-token-title">消耗与预估</h3>
        </div>
        <div className="segmented-control novel-task-segmented" role="tablist" aria-label="Token 统计视图">
          {(["total", "agent", "chapter"] as TokenView[]).map((view) => (
            <button
              type="button"
              data-help-key="novel.task.tokenView"
              key={view}
              role="tab"
              aria-selected={tokenView === view}
              className={tokenView === view ? "is-active" : ""}
              onClick={() => changeTokenView(view)}
            >
              {view === "total" ? "总计" : view === "agent" ? "按处理槽" : "按章节"}
            </button>
          ))}
        </div>
      </header>
      {overBudget && (
        <p className="novel-token-warning" role="alert">
          实际 Token 消耗已超过预估，请检查重试次数或输出长度。
        </p>
      )}
      <div key={tokenView} className="novel-token-view-content" data-token-view={tokenView}>
        {tokenView === "total" ? (
          <div className="novel-token-grid">
            <TokenMetric label="总输入 Token" value={stats.totalInputTokens} />
            <TokenMetric label="总输出 Token" value={stats.totalOutputTokens} />
            <TokenMetric label="总 Token" value={stats.totalTokens} />
            <TokenMetric label="本次预计 Token" value={stats.estimatedTokens} />
            <TokenMetric label="本次实际 Token" value={stats.actualTokens} />
            <TokenMetric label="平均每个切片" value={stats.averageChunkTokens} />
            <TokenMetric label="失败重试额外" value={stats.retryExtraTokens} />
          </div>
        ) : tokenView === "agent" ? (
          <TokenBreakdownList rows={stats.byAgent} emptyText="暂无处理槽 token 明细。" />
        ) : (
          <TokenBreakdownList rows={stats.byChapter} emptyText="暂无章节 token 明细。" />
        )}
      </div>
    </section>
  );
}

function shortId(value?: string | null): string {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function DetailRow({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div className="novel-agent-detail-row">
      <dt>{label}</dt>
      <dd title={title ?? String(value)}>{value}</dd>
    </div>
  );
}

const AgentDetail = memo(function AgentDetail({ agent }: { agent: NovelProcessAgentProgress }) {
  const preview = agent.partialPreview || agent.outputPreview || "";
  return (
    <div className="novel-agent-detail">
      <dl>
        <DetailRow label="处理槽" value={`Subagent ${agent.agentIndex + 1}`} />
        <DetailRow label="角色" value={displayMachineValue(agent.agentRole, "切片解析")} />
        <DetailRow label="任务 ID" value={shortId(agent.agentTaskId)} title={agent.agentTaskId} />
        <DetailRow label="尝试次数" value={`${agent.runAttempt ?? 0}${agent.attemptId ? ` · ${shortId(agent.attemptId)}` : ""}`} title={agent.attemptId ?? ""} />
        <DetailRow label="切片 ID" value={shortId(agent.currentChunkId)} title={agent.currentChunkId ?? ""} />
        <DetailRow label="阶段" value={displayMachineValue(agent.phase ?? agent.status)} />
        <DetailRow label="当前步骤" value={displayMachineValue(agent.currentStepLabel ?? agent.status)} />
        <DetailRow label="输入字符数" value={formatInteger(agent.inputChunkChars ?? 0)} />
        <DetailRow label="上下文字符数" value={formatInteger(agent.contextChars ?? 0)} />
        <DetailRow label="文本位置" value={agent.chunkStartOffset !== null && agent.chunkStartOffset !== undefined ? `${agent.chunkStartOffset}-${agent.chunkEndOffset ?? "?"}` : "-"} />
        <DetailRow label="Token 来源" value={displayMachineValue(agent.tokenSource, "无")} />
        <DetailRow label="场景数" value={`${agent.sceneCount ?? 0}${agent.usedFallbackScene ? " · 回退场景" : ""}`} />
        <DetailRow label="结构修复" value={agent.schemaRepairCount ?? 0} />
        <DetailRow
          label="对白结构"
          value={agent.semanticValidationStatus === "passed"
            ? "已通过"
            : agent.semanticValidationStatus === "repaired"
              ? `已自动修复 ${agent.semanticRepairCount ?? 0} 条`
              : agent.semanticValidationStatus === "blocked"
                ? "未通过"
                : "未检测"}
        />
        <DetailRow
          label="聊天昵称"
          value={agent.characterCandidates?.map((item) => item.name).join("、") || "-"}
        />
        <DetailRow label="合并状态" value={displayMachineValue(agent.mergeStatus, "待处理")} />
        <DetailRow label="进度依据" value={displayMachineValue(agent.progressBasis, "按阶段")} />
        <DetailRow label="队列位置" value={agent.queuePosition ?? "-"} />
        <DetailRow label="预计剩余" value={agent.estimatedRemainingMs ? formatDuration(agent.estimatedRemainingMs) : "-"} />
        <DetailRow label="完成 / 失败" value={`${agent.completedTaskCount ?? 0} / ${agent.failedTaskCount ?? 0}`} />
        {agent.retryBackoffMs ? <DetailRow label="重试等待" value={formatDuration(agent.retryBackoffMs)} /> : null}
        {agent.failureCategory ? <DetailRow label="失败类型" value={displayMachineValue(agent.failureCategory)} /> : null}
      </dl>
      {agent.assignmentReason && <p className="novel-agent-detail-note">{agent.assignmentReason}</p>}
      {agent.staleReason && <p className="novel-agent-quality-warning">{agent.staleReason}</p>}
      {agent.usedFallbackScene && <p className="novel-agent-quality-warning">回退场景将被标记为需要复核。</p>}
      {agent.semanticValidationStatus === "repaired" && (
        <p className="novel-agent-quality-warning">对白结构已由规则拆分，导入后仍需复核人物昵称与消息边界。</p>
      )}
      {agent.semanticValidationStatus === "blocked" && (
        <p className="novel-agent-quality-warning">对白结构无法安全修复。该切片不会写入项目，请新建 v2 任务重跑。</p>
      )}
      <QualityIssueList issues={agent.qualityIssues} />
      {agent.qualityWarnings && agent.qualityWarnings.length > 0 && (
        <ul className="novel-agent-quality-list">
          {agent.qualityWarnings.slice(0, 3).map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      {(agent.previousContextSummary || agent.currentChunkExcerpt || agent.nextContextHint) && (
        <pre className="novel-agent-context">{[
          agent.previousContextSummary ? `上文：${agent.previousContextSummary}` : "",
          agent.currentChunkExcerpt ? `当前：${agent.currentChunkExcerpt}` : "",
          agent.nextContextHint ? `下文：${agent.nextContextHint}` : "",
        ].filter(Boolean).join("\n")}</pre>
      )}
      {preview && <pre className="novel-agent-output">{preview}</pre>}
      {agent.recentEvents && agent.recentEvents.length > 0 && (
        <div className="novel-agent-event-list">
          {agent.recentEvents.map((event) => (
            <span key={event.eventId} className={`is-${event.level}`} title={event.message}>
              {event.type}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

function agentPanelSignature(agents: NovelProcessAgentProgress[], expandedAgentIds: Set<string>): string {
  const expanded = [...expandedAgentIds].sort().join(",");
  const agentRows = agents.map((agent) => {
    const status = displayAgentStatus(agent);
    const heartbeat = status === "running" || status === "retrying" || status === "timeout_suspected"
      ? agent.heartbeatAt
      : agent.taskCompletedAt ?? agent.lastMeaningfulEventAt ?? "";
    const elapsed = status === "running" || status === "retrying" ? agent.elapsedMs : agent.taskCompletedAt ?? "";
    const events = agent.recentEvents?.map((event) => event.eventId).join(",") ?? "";
    const warnings = agent.qualityWarnings?.join(",") ?? "";
    return [
      agent.agentTaskId,
      agent.currentChunkId ?? "",
      status,
      agent.phase ?? "",
      agent.currentStepLabel ?? "",
      agent.progressPercent,
      heartbeat,
      elapsed,
      agent.retryCount,
      agent.inputTokens,
      agent.outputTokens,
      agent.totalTokens,
      agent.partialPreview ?? "",
      agent.outputPreview ?? "",
      agent.sceneCount ?? 0,
      agent.usedFallbackScene ? 1 : 0,
      agent.schemaRepairCount ?? 0,
      agent.semanticRepairCount ?? 0,
      agent.semanticValidationStatus ?? "",
      agent.characterCandidates?.map((item) => item.name).join(",") ?? "",
      warnings,
      events,
    ].join("\u001f");
  }).join("\u001e");
  return `${expanded}\u001d${agentRows}`;
}

const AgentPanel = memo(function AgentPanel({
  agents,
  expandedAgentIds,
  onToggleAgents,
}: {
  agents: NovelProcessAgentProgress[];
  expandedAgentIds: Set<string>;
  onToggleAgents: (agentTaskIds: string[], selectedAgentTaskId: string) => void;
}) {
  const agentTaskIds = useMemo(() => agents.map((agent) => agent.agentTaskId), [agents]);
  return (
    <section className="novel-task-section novel-agent-panel" aria-labelledby="novel-task-agent-title">
      <header>
        <div>
          <span className="panel-kicker">Subagent 进度</span>
          <h3 id="novel-task-agent-title">Subagent 任务槽</h3>
        </div>
        <span className="novel-task-count">{agents.length} 个处理槽</span>
      </header>
      <div className="novel-agent-grid">
        {agents.map((agent) => {
          const status = displayAgentStatus(agent);
          const expanded = expandedAgentIds.has(agent.agentTaskId);
          return (
            <article key={agent.agentTaskId} className={`novel-agent-card is-${status}${expanded ? " is-expanded" : ""}`}>
              <header>
                <div>
                  <strong>Subagent {agent.agentIndex + 1}</strong>
                  <small>{displayMachineValue(agent.agentRole, "切片解析")} / {shortId(agent.agentTaskId)} / {formatRelativeTime(agent.heartbeatAt)}心跳</small>
                </div>
                <span>{agentStatusLabel[status]}</span>
              </header>
              <dl>
                <div><dt>章节</dt><dd title={agent.currentChapterTitle}>{agent.currentChapterTitle}</dd></div>
                <div><dt>切片</dt><dd title={agent.currentChunkId ?? undefined}>{agent.currentChunkIndex}/{agent.currentChunkTotal}</dd></div>
                <div><dt>阶段</dt><dd>{displayMachineValue(agent.phase ?? agent.status)}</dd></div>
                <div><dt>字符数</dt><dd>{formatInteger(agent.inputChunkChars ?? 0)} + {formatInteger(agent.contextChars ?? 0)}</dd></div>
                <div><dt>场景数</dt><dd>{agent.sceneCount ?? 0}{agent.usedFallbackScene ? " / 回退" : ""}</dd></div>
                <div><dt>输入 Token</dt><dd>{formatInteger(agent.inputTokens)}</dd></div>
                <div><dt>输出 Token</dt><dd>{formatInteger(agent.outputTokens)}</dd></div>
                <div><dt>总 Token</dt><dd>{formatInteger(agent.totalTokens)}</dd></div>
                <div><dt>已用时间</dt><dd>{formatDuration(agent.elapsedMs)}</dd></div>
                <div><dt>预计剩余</dt><dd>{agent.estimatedRemainingMs ? formatDuration(agent.estimatedRemainingMs) : "-"}</dd></div>
                <div><dt>进度依据</dt><dd title={agent.progressBasis}>{displayMachineValue(agent.progressBasis, "按阶段")}</dd></div>
                <div><dt>重试次数</dt><dd>{agent.retryCount}</dd></div>
              </dl>
              {(agent.usedFallbackScene || Boolean(agent.semanticValidationStatus) || (agent.qualityWarnings && agent.qualityWarnings.length > 0)) && (
                <div className="novel-agent-quality-strip">
                  {agent.usedFallbackScene ? <span>回退场景待复核</span> : null}
                  {agent.schemaRepairCount ? <span>{agent.schemaRepairCount} 次结构修复</span> : null}
                  {agent.semanticValidationStatus === "passed" ? <span>对白结构已通过</span> : null}
                  {agent.semanticValidationStatus === "repaired" ? <span>{agent.semanticRepairCount ?? 0} 条对白已自动修复</span> : null}
                  {agent.semanticValidationStatus === "blocked" ? <span>对白结构阻断</span> : null}
                  {agent.qualityWarnings?.slice(0, 1).map((warning) => <span key={warning} title={warning}>{warning}</span>)}
                </div>
              )}
              <p title={agent.partialPreview || agent.outputPreview}>{agent.currentStepLabel ? `${displayMachineValue(agent.currentStepLabel)} / ` : ""}{agent.partialPreview || agent.outputPreview}</p>
              <ProgressMeter value={agent.progressPercent} label={`Subagent ${agent.agentIndex + 1} 进度`} tone={progressToneFromAgent(status)} />
              <button
                type="button"
                className="novel-agent-detail-toggle"
                data-help-key="novel.task.agentDetails"
                aria-expanded={expanded}
                aria-controls={`novel-agent-detail-${agent.agentIndex}`}
                onClick={() => onToggleAgents(agentTaskIds, agent.agentTaskId)}
              >
                <ChevronDown size={14} aria-hidden="true" />
                {expanded ? "收起详情" : "任务详情"}
              </button>
              <div
                id={`novel-agent-detail-${agent.agentIndex}`}
                className="novel-agent-detail-region"
                data-expanded={expanded}
                aria-hidden={!expanded}
              >
                <div className="novel-agent-detail-region-inner">
                  <AgentDetail agent={agent} />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}, (previous, next) => agentPanelSignature(previous.agents, previous.expandedAgentIds) === agentPanelSignature(next.agents, next.expandedAgentIds));

function AssignmentPanel({ job }: { job: NovelProcessJob }) {
  return (
    <section className="novel-task-section novel-assignment-panel" aria-labelledby="novel-task-assignment-title">
      <header>
        <div>
          <span className="panel-kicker">分工安排</span>
          <h3 id="novel-task-assignment-title">真实并发槽位</h3>
        </div>
        <span className="novel-task-count">并发 {job.maxConcurrency ?? job.agents.length} · 队列 {job.queueDepth ?? job.estimatedRemainingChunks}</span>
      </header>
      <div className="novel-assignment-grid">
        {job.agents.map((agent) => (
          <article key={`assignment_${agent.agentIndex}`} className="novel-assignment-card">
            <header>
              <strong>处理槽 {agent.agentIndex + 1}</strong>
              <small>{formatRelativeTime(agent.lastHeartbeatAt ?? agent.heartbeatAt)}心跳</small>
            </header>
            <p>{agent.assignmentReason || "等待调度器分配下一个切片。"}</p>
            <dl>
              <div><dt>阶段</dt><dd>{displayMachineValue(agent.currentStepLabel || agent.status)}</dd></div>
              <div><dt>输入字符</dt><dd>{formatInteger(agent.inputChunkChars ?? 0)}</dd></div>
              <div><dt>切片</dt><dd>{agent.assignedChunkIds?.slice(-3).join(" / ") || "未分配"}</dd></div>
            </dl>
            {(agent.currentChunkExcerpt || agent.previousContextSummary || agent.nextContextHint) && (
              <pre>{[
                agent.previousContextSummary ? `上文：${agent.previousContextSummary}` : "",
                agent.currentChunkExcerpt ? `当前：${agent.currentChunkExcerpt}` : "",
                agent.nextContextHint ? `下文：${agent.nextContextHint}` : "",
              ].filter(Boolean).join("\n")}</pre>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function eventTypeLabel(type: NovelProcessEvent["type"]): string {
  const labels: Record<NovelProcessEvent["type"], string> = {
    job_created: "任务创建",
    chapter_split_completed: "章节拆分完成",
    agent_started: "处理槽开始处理",
    agent_output_updated: "处理槽输出更新",
    agent_completed: "处理槽完成处理",
    agent_failed: "处理槽失败",
    job_retry: "任务重试",
    result_merged: "结果合并",
    job_completed: "任务完成",
    job_paused: "任务暂停",
    job_resumed: "任务继续",
    job_cancelled: "任务取消",
  };
  return labels[type];
}

function eventListSignature(events: NovelProcessEvent[]): string {
  return events.slice(0, logPanelVisibleEventLimit).map((event) => `${event.eventId}:${event.createdAt}`).join("|");
}

const LogPanel = memo(function LogPanel({ events, logOrder, onLogOrderChange }: { events: NovelProcessEvent[]; logOrder: LogOrder; onLogOrderChange: (order: LogOrder) => void }) {
  const visibleEvents = useMemo(() => {
    const rows = [...events].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recentRows = rows.slice(0, logPanelVisibleEventLimit);
    return logOrder === "newest" ? recentRows : recentRows.reverse();
  }, [events, logOrder]);
  return (
    <section className="novel-task-section novel-log-panel" aria-labelledby="novel-task-log-title">
      <header>
        <div>
          <span className="panel-kicker">任务日志</span>
          <h3 id="novel-task-log-title">最近 50 条事件</h3>
        </div>
        <button type="button" className="novel-task-order-toggle" data-help-key="novel.task.logOrder" aria-label="切换日志排序" onClick={() => onLogOrderChange(logOrder === "newest" ? "oldest" : "newest")}>
          <ChevronDown size={14} />
          {logOrder === "newest" ? "时间倒序" : "时间正序"}
        </button>
      </header>
      <div className="novel-log-list">
        {visibleEvents.length === 0 ? (
          <p className="novel-task-empty">暂无任务事件。</p>
        ) : visibleEvents.map((event) => {
          const preview = payloadPreview(event.payload);
          return (
            <article key={event.eventId} className={`novel-log-item is-${event.level}`}>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString("zh-CN", { hour12: false })}</time>
              <div>
                <strong>{eventTypeLabel(event.type)} · {event.title}</strong>
                <p>{event.message}</p>
                {preview && <pre>{preview}</pre>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}, (previous, next) => previous.logOrder === next.logOrder && eventListSignature(previous.events) === eventListSignature(next.events));

function visibleActions(status: NovelProcessJobStatus): Array<WorkbenchAction | "view" | "collapse"> {
  if (status === "running" || status === "waiting" || status === "retrying") return ["pause", "cancel", "collapse"];
  if (status === "paused") return ["resume", "cancel", "collapse"];
  if (status === "failed_partial") return ["retry", "view", "cancel", "collapse"];
  if (status === "failed") return ["retry", "view", "collapse"];
  if (status === "completed" || status === "cancelled") return ["view", "collapse"];
  return ["collapse"];
}

export function NovelProcessTaskWorkbench() {
  const session = useNovelImportStore((state) => state.session);
  const importJob = useNovelImportStore((state) => state.importJob);
  const progress = useNovelImportStore((state) => state.progress);
  const errors = useNovelImportStore((state) => state.errors);
  const warnings = useNovelImportStore((state) => state.warnings);
  const inspectableResults = useNovelImportStore((state) => state.inspectableResults);
  const isProcessing = useNovelImportStore((state) => state.isProcessing);
  const processing = useNovelImportStore((state) => state.processing);
  const pauseBlueprintGeneration = useNovelImportStore((state) => state.pauseBlueprintGeneration);
  const resumeBlueprintGeneration = useNovelImportStore((state) => state.resumeBlueprintGeneration);
  const cancelBlueprintGeneration = useNovelImportStore((state) => state.cancelBlueprintGeneration);
  const retryFailedNovelAgentTasks = useNovelImportStore((state) => state.retryFailedNovelAgentTasks);
  const importNovelProcessJobResults = useNovelImportStore((state) => state.importNovelProcessJobResults);
  const syncNovelProcessingJobSnapshot = useNovelImportStore((state) => state.syncNovelProcessingJobSnapshot);
  const projectId = useProjectStore((state) => state.projectId);
  const projectTitle = useProjectStore((state) => state.title);
  const nodes = useEditorStore((state) => state.nodes);
  const selectNode = useEditorStore((state) => state.selectNode);
  const [snapshot, setSnapshot] = useState<NovelProcessTaskSnapshot | undefined>(() => readPersistedNovelProcessTaskSnapshot(projectId));
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelClosing, setPanelClosing] = useState(false);
  const [tokenView, setTokenView] = useState<TokenView>("total");
  const [logOrder, setLogOrder] = useState<LogOrder>("newest");
  const [busyAction, setBusyAction] = useState<WorkbenchAction>();
  const [actionMessage, setActionMessage] = useState<string>();
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(() => new Set());
  const dismissedJobIdsRef = useRef(new Set<string>());
  const panelCloseTimerRef = useRef<number | null>(null);

  function clearPanelCloseTimer() {
    if (panelCloseTimerRef.current === null) return;
    window.clearTimeout(panelCloseTimerRef.current);
    panelCloseTimerRef.current = null;
  }

  function openPanel() {
    clearPanelCloseTimer();
    setPanelClosing(false);
    setPanelOpen(true);
  }

  useEffect(() => {
    window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__ = true;
    return () => {
      delete window.__AGENTVN_NOVEL_TASK_WORKBENCH_READY__;
      clearPanelCloseTimer();
    };
  }, []);

  useEffect(() => {
    setSnapshot(readPersistedNovelProcessTaskSnapshot(projectId));
    setPanelOpen(false);
    setPanelClosing(false);
    clearPanelCloseTimer();
    setActionMessage(undefined);
    setExpandedAgentIds(new Set());
    dismissedJobIdsRef.current.clear();
  }, [projectId]);

  const derivedSnapshot = useMemo(() => createMockNovelProcessSnapshot({
    projectId,
    projectTitle,
    session,
    importJob,
    progress,
    errors,
    warnings,
    inspectableResults,
    isProcessing,
    processing,
  }), [projectId, projectTitle, session, importJob, progress, errors, warnings, inspectableResults, isProcessing, processing]);

  useEffect(() => {
    if (!derivedSnapshot) return;
    setSnapshot((current) => {
      if (current?.job.source === "api" && current.job.jobId === derivedSnapshot.job.jobId) return current;
      if (current?.job.source === "ui_pressure_fixture") return current;
      return derivedSnapshot;
    });
    persistNovelProcessTaskSnapshot(projectId, derivedSnapshot);
  }, [derivedSnapshot, projectId]);

  useEffect(() => {
    function handlePressureSnapshot(event: Event) {
      const detail = (event as CustomEvent<NovelProcessTaskSnapshot>).detail;
      if (!detail?.job?.jobId || !Array.isArray(detail.events)) return;
      const next: NovelProcessTaskSnapshot = {
        ...detail,
        projectId: detail.projectId ?? projectId,
        job: { ...detail.job, source: "ui_pressure_fixture" },
      };
      setSnapshot(next);
      openPanel();
    }

    window.addEventListener("agentvn:novel-processing-pressure-snapshot", handlePressureSnapshot);
    return () => window.removeEventListener("agentvn:novel-processing-pressure-snapshot", handlePressureSnapshot);
  }, [projectId]);

  useEffect(() => {
    const jobId = processing.activeJobId;
    if (!jobId) return;
    let cancelled = false;
    const loadActiveJob = async () => {
      try {
        const [job, events] = await Promise.all([
          backendClient.getNovelProcessJob(jobId),
          backendClient.getJobEvents(jobId, 50),
        ]);
        if (cancelled) return;
        const next = { projectId, job, events };
        setSnapshot(next);
        persistNovelProcessTaskSnapshot(projectId, next);
        syncNovelProcessingJobSnapshot(job);
      } catch (error) {
        reportFrontendError("editor.novel-process", error, {
          operation: "load-active-job",
          jobId,
        });
        // Keep the local snapshot visible if the API panel is temporarily unavailable.
      }
    };
    void loadActiveJob();
    return () => {
      cancelled = true;
    };
  }, [processing.activeJobId, projectId, syncNovelProcessingJobSnapshot]);

  useEffect(() => {
    if (!snapshot || snapshot.job.source !== "api") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const [job, events] = await Promise.all([
          backendClient.getNovelProcessJob(snapshot.job.jobId),
          backendClient.getJobEvents(snapshot.job.jobId, 50),
        ]);
        if (cancelled) return;
        const next = { projectId, job, events };
        setSnapshot(next);
        persistNovelProcessTaskSnapshot(projectId, next);
        syncNovelProcessingJobSnapshot(job);
      } catch (error) {
        reportFrontendError("editor.novel-process", error, {
          operation: "refresh-job",
          jobId: snapshot.job.jobId,
        });
        // The mock adapter keeps the panel usable while session 4/6 finish the API.
      }
    };
    void refresh();
    const intervalId = window.setInterval(refresh, isNovelProcessJobUnfinished(snapshot.job.status) ? 500 : 6000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [projectId, snapshot?.job.jobId, snapshot?.job.source, snapshot?.job.status, syncNovelProcessingJobSnapshot]);

  if (!snapshot) return null;

  const { job, events } = snapshot;
  const meta = statusMeta[job.status];
  const actions = visibleActions(job.status);
  const latestNodeId = importJob?.lastInsertedNodeId
    ?? nodes.slice().reverse().find((node) => node.data.editorMeta?.importSessionId === session.session_id || node.data.editorMeta?.source === "imported")?.id;

  const closePanel = () => {
    dismissedJobIdsRef.current.add(job.jobId);
    if (!panelOpen || panelClosing) return;
    setPanelClosing(true);
    clearPanelCloseTimer();
    const exitMs = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 1 : workbenchExitMs;
    panelCloseTimerRef.current = window.setTimeout(() => {
      setPanelOpen(false);
      setPanelClosing(false);
      panelCloseTimerRef.current = null;
    }, exitMs);
  };

  const updateLocalSnapshot = (status: NovelProcessJobStatus, message: string) => {
    setSnapshot((current) => {
      if (!current) return current;
      const next = updateMockSnapshotStatus(current, status, message);
      persistNovelProcessTaskSnapshot(projectId, next);
      return next;
    });
  };

  const runAction = async (action: WorkbenchAction) => {
    setBusyAction(action);
    setActionMessage(undefined);
    try {
      if (job.source === "api") {
        const nextJob = action === "pause"
          ? await backendClient.pauseNovelProcessJob(job.jobId)
          : action === "resume"
            ? await backendClient.resumeNovelProcessJob(job.jobId)
            : action === "cancel"
              ? await backendClient.cancelNovelProcessJob(job.jobId)
              : await backendClient.retryFailedChunks(job.jobId);
        const next = { projectId, job: nextJob, events };
        setSnapshot(next);
        persistNovelProcessTaskSnapshot(projectId, next);
      } else {
        if (action === "pause") {
          pauseBlueprintGeneration();
          updateLocalSnapshot("paused", "任务暂停");
        }
        if (action === "resume") {
          void resumeBlueprintGeneration();
          updateLocalSnapshot("running", "任务继续");
        }
        if (action === "cancel") {
          cancelBlueprintGeneration();
          updateLocalSnapshot("cancelled", "任务取消");
        }
        if (action === "retry") {
          retryFailedNovelAgentTasks();
          void resumeBlueprintGeneration();
          updateLocalSnapshot("retrying", "重试失败项");
        }
        setActionMessage("当前为 mock adapter 操作，真实执行由任务 API 接入。");
      }
    } catch (error) {
      reportFrontendError("editor.novel-process", error, {
        operation: action,
        jobId: job.jobId,
      });
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(undefined);
    }
  };

  const toggleAgentDetails = (agentTaskIds: string[], selectedAgentTaskId: string) => {
    setExpandedAgentIds((current) => {
      if (current.has(selectedAgentTaskId)) return new Set();
      return new Set(agentTaskIds);
    });
  };

  const viewResult = async () => {
    const importResult = job.source === "api" && (job.status === "completed" || job.status === "failed_partial")
      ? await importNovelProcessJobResults(job.jobId)
      : undefined;
    const targetNodeId = importResult?.lastInsertedNodeId ?? latestNodeId;
    if (!targetNodeId) {
      setActionMessage("暂无可定位的已完成节点。");
      return;
    }
    selectNode(targetNodeId);
    setActionMessage(importResult?.notice ?? "已定位到最新导入结果。");
    closePanel();
  };

  const content = (
    <>
      {panelOpen && (
        <div className={`novel-task-layer${panelClosing ? " is-closing" : ""}`} aria-live="polite">
          <div className="novel-task-backdrop" aria-hidden="true" />
          <section
            className={`novel-task-workbench is-${meta.tone}${panelClosing ? " is-closing" : ""}`}
            role="dialog"
            aria-modal="false"
            aria-labelledby="novel-task-workbench-title"
            data-testid="novel-task-workbench"
            data-job-status={job.status}
          >
            <header className="novel-task-header">
              <div className="novel-task-title-block">
                <span className="panel-kicker">任务工作台</span>
                <h2 id="novel-task-workbench-title">{job.novelTitle}</h2>
                <small>{job.jobId} · {formatRelativeTime(job.updatedAt)}更新{job.source === "mock" ? " · 本地回退数据" : ""}</small>
              </div>
              <div className="novel-task-header-status">
                <span className={`novel-task-status is-${meta.tone}`}>{meta.label}</span>
                <button type="button" className="novel-task-icon-button" data-help-key="novel.task.closePanel" aria-label="最小化任务面板" onClick={closePanel}>
                  <Minimize2 size={16} />
                </button>
              </div>
            </header>

            <div className="novel-task-body">
              {job.promptVersion && job.promptVersion !== "novel-process-v3" && (
                <div className="novel-agent-quality-warning">
                  旧解析版本 {job.promptVersion} 不支持章节片段聚合；请新建任务以使用 novel-process-v3。
                </div>
              )}
              <OverviewPanel job={job} />
              <AssignmentPanel job={job} />
              <QualityDimensionPanel dimensions={job.qualityDimensions} issues={job.qualityIssues} />
              <TokenPanel job={job} tokenView={tokenView} onTokenViewChange={setTokenView} />
              <AgentPanel agents={job.agents} expandedAgentIds={expandedAgentIds} onToggleAgents={toggleAgentDetails} />
              <LogPanel events={events} logOrder={logOrder} onLogOrderChange={setLogOrder} />
            </div>

            <footer className="novel-task-actions" aria-label="任务操作">
              {actionMessage && <p className="novel-task-action-message">{actionMessage}</p>}
              <div>
                {actions.includes("pause") && (
                  <button type="button" data-help-key="novel.task.pause" disabled={Boolean(busyAction)} onClick={() => void runAction("pause")}>
                    <Pause size={15} />暂停
                  </button>
                )}
                {actions.includes("resume") && (
                  <button type="button" data-help-key="novel.task.resume" disabled={Boolean(busyAction)} onClick={() => void runAction("resume")}>
                    <Play size={15} />继续
                  </button>
                )}
                {actions.includes("retry") && (
                  <button type="button" data-help-key="novel.task.retry" disabled={Boolean(busyAction)} onClick={() => void runAction("retry")}>
                    <RotateCcw size={15} />重试失败项
                  </button>
                )}
                {actions.includes("view") && (
                  <button type="button" data-help-key="novel.task.viewResult" onClick={() => void viewResult()}>
                    <Eye size={15} />{job.status === "cancelled" ? "查看已完成结果" : "查看结果"}
                  </button>
                )}
                {actions.includes("cancel") && (
                  <button type="button" className="is-danger" data-help-key="novel.task.cancel" disabled={Boolean(busyAction)} onClick={() => void runAction("cancel")}>
                    <XCircle size={15} />取消
                  </button>
                )}
                {actions.includes("collapse") && (
                  <button type="button" className="is-ghost" data-help-key="novel.task.collapse" onClick={closePanel}>
                    <Minimize2 size={15} />收起面板
                  </button>
                )}
              </div>
            </footer>
          </section>
        </div>
      )}

      {!panelOpen && (
        <button
          type="button"
          className={`novel-task-mini-entry is-${meta.tone}`}
          style={{ "--novel-task-progress": `${Math.max(0, Math.min(100, job.progressPercent)) * 3.6}deg` } as CSSProperties}
          data-help-key="novel.task.openPanel"
          aria-label={`打开小说任务面板，当前状态：${meta.label}`}
          title={`${job.novelTitle} · ${meta.label} · ${job.completedChunks}/${job.totalChunks} · ${formatPercent(job.progressPercent)}`}
          data-testid="novel-task-mini-entry"
          data-job-status={job.status}
          onClick={() => {
            dismissedJobIdsRef.current.delete(job.jobId);
            openPanel();
          }}
        >
          <span className="novel-task-mini-icon">
            <Sparkles size={20} />
            {(job.status === "failed" || job.status === "failed_partial" || job.status === "retrying") && <i aria-hidden="true" />}
          </span>
          <span className="novel-task-mini-tooltip" role="tooltip">
            <strong>{statusMeta[job.status].label}</strong>
            <small>{job.completedChunks}/{job.totalChunks} · {formatPercent(job.progressPercent)}</small>
          </span>
        </button>
      )}
    </>
  );
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}
