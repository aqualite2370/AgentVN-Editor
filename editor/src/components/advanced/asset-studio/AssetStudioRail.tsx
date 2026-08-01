import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  History,
  HardDrive,
  Images,
  ListOrdered,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { assetStudioOperationLabels } from "../../../asset-studio/defaults";
import type { ImageGenerationJob, ImageGenerationRecipeV1 } from "../../../asset-studio/types";
import type { GeneratedAssetCandidate } from "../../../asset-generation/session";
import { RichSelect } from "../../common/RichSelect";

type RailTab = "queue" | "results" | "history";

interface AssetStudioRailProps {
  tab: RailTab;
  jobs: ImageGenerationJob[];
  currentRecipe: ImageGenerationRecipeV1;
  selectedJobId?: string;
  onTabChange: (tab: RailTab) => void;
  onSelectJob: (jobId: string) => void;
  onSelectCandidate: (candidateId: string) => void;
  onToggleCandidate: (jobId: string, candidateId: string) => void;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onMove: (jobId: string, direction: -1 | 1) => void;
  onReorder: (sourceJobId: string, targetJobId: string) => void;
  onReuse: (recipe: ImageGenerationRecipeV1) => void;
  onSave: (candidates: GeneratedAssetCandidate[]) => void;
  onClearCompleted: () => void;
  onClearOutputs: () => void;
}

const statusLabels: Record<ImageGenerationJob["status"], string> = {
  queued: "排队中",
  validating: "校验中",
  running: "生成中",
  partial: "部分完成",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

function isActive(job: ImageGenerationJob) {
  return ["queued", "validating", "running"].includes(job.status);
}

function statusIcon(job: ImageGenerationJob) {
  if (job.status === "completed") return <CheckCircle2 size={15} aria-hidden="true" />;
  if (job.status === "running" || job.status === "validating") return <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />;
  if (job.status === "queued") return <Clock3 size={15} aria-hidden="true" />;
  if (job.status === "failed" || job.status === "cancelled") return <XCircle size={15} aria-hidden="true" />;
  return <History size={15} aria-hidden="true" />;
}

export function AssetStudioRail({
  tab,
  jobs,
  currentRecipe,
  selectedJobId,
  onTabChange,
  onSelectJob,
  onSelectCandidate,
  onToggleCandidate,
  onCancel,
  onRetry,
  onMove,
  onReorder,
  onReuse,
  onSave,
  onClearCompleted,
  onClearOutputs,
}: AssetStudioRailProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [operationFilter, setOperationFilter] = useState("all");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const [timeFilter, setTimeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pendingRestoreId, setPendingRestoreId] = useState<string>();
  const selectedJob = jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0];
  const activeJobs = jobs.filter(isActive).sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  const queuedJobs = activeJobs.filter((job) => job.status === "queued");
  const providers = useMemo(() => Array.from(new Map(
    jobs
      .filter((job) => job.recipe.provider)
      .map((job) => [job.recipe.provider!.providerId, job.recipe.provider!])
  ).values()), [jobs]);
  const history = useMemo(() => jobs.filter((job) => {
    if (isActive(job)) return false;
    if (statusFilter !== "all" && job.status !== statusFilter) return false;
    if (operationFilter !== "all" && job.recipe.operation !== operationFilter) return false;
    if (assetTypeFilter !== "all" && job.recipe.assetType !== assetTypeFilter) return false;
    if (providerFilter !== "all" && job.recipe.provider?.providerId !== providerFilter) return false;
    const age = Date.now() - Date.parse(job.queuedAt);
    if (timeFilter === "today" && age > 24 * 60 * 60 * 1000) return false;
    if (timeFilter === "week" && age > 7 * 24 * 60 * 60 * 1000) return false;
    const needle = query.trim().toLocaleLowerCase();
    if (needle && ![
      job.recipe.prompt,
      job.recipe.originalPrompt,
      job.recipe.optimizedPrompt,
      job.recipe.provider?.displayName,
      job.recipe.provider?.model,
    ].some((value) => value?.toLocaleLowerCase().includes(needle))) return false;
    return true;
  }), [assetTypeFilter, jobs, operationFilter, providerFilter, query, statusFilter, timeFilter]);
  const selectedCandidates = selectedJob?.candidates.filter((candidate) =>
    selectedJob.selectedCandidateIds.includes(candidate.image_id)
  ) ?? [];
  const cachedBytes = jobs.reduce((total, job) => total + job.candidates.reduce(
    (candidateTotal, candidate) => candidateTotal + (candidate.blob_url.startsWith("data:") ? Math.ceil(candidate.blob_url.length * 0.75) : 0),
    0
  ), 0);
  const pendingRestore = jobs.find((job) => job.jobId === pendingRestoreId);
  const restoreDifferences = pendingRestore ? [
    pendingRestore.recipe.operation !== currentRecipe.operation ? "生成操作" : "",
    pendingRestore.recipe.assetType !== currentRecipe.assetType ? "素材类型" : "",
    pendingRestore.recipe.prompt !== currentRecipe.prompt ? "提示词" : "",
    pendingRestore.recipe.stylePreset !== currentRecipe.stylePreset ? "风格预设" : "",
    pendingRestore.recipe.aspectRatio !== currentRecipe.aspectRatio || pendingRestore.recipe.width !== currentRecipe.width || pendingRestore.recipe.height !== currentRecipe.height ? "画幅尺寸" : "",
    pendingRestore.recipe.provider?.providerId !== currentRecipe.provider?.providerId ? "图像模型" : "",
    pendingRestore.recipe.references.length !== currentRecipe.references.length ? "参考图" : "",
  ].filter(Boolean) : [];

  return (
    <aside className="asset-studio-rail" aria-label="生成队列与历史">
      <div className="asset-studio-rail-tabs" role="tablist" aria-label="生产信息">
        <button type="button" data-help-key="asset.railQueue" role="tab" aria-selected={tab === "queue"} className={tab === "queue" ? "is-active" : ""} onClick={() => onTabChange("queue")}>
          <ListOrdered size={16} aria-hidden="true" />
          队列
          {activeJobs.length > 0 && <span>{activeJobs.length}</span>}
        </button>
        <button type="button" data-help-key="asset.railResults" role="tab" aria-selected={tab === "results"} className={tab === "results" ? "is-active" : ""} onClick={() => onTabChange("results")}>
          <Images size={16} aria-hidden="true" />
          本批结果
        </button>
        <button type="button" data-help-key="asset.railHistory" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "is-active" : ""} onClick={() => onTabChange("history")}>
          <History size={16} aria-hidden="true" />
          历史
        </button>
      </div>

      <div className="asset-studio-rail-body">
        {tab === "queue" && (
          <section className="asset-studio-job-list" role="tabpanel" aria-live="polite">
            <header>
              <div>
                <strong>生产队列</strong>
                <span>任务按顺序执行，同一时间只占用一个模型</span>
              </div>
            </header>
            {activeJobs.length === 0 ? (
              <div className="asset-studio-rail-empty">
                <ListOrdered size={24} aria-hidden="true" />
                <strong>队列空闲</strong>
                <span>新任务会在这里显示阶段与进度。</span>
              </div>
            ) : activeJobs.map((job) => (
              <article
                className={`asset-studio-job-card status-${job.status}`}
                key={job.jobId}
                draggable={job.status === "queued"}
                onDragStart={(event) => event.dataTransfer.setData("text/asset-studio-job", job.jobId)}
                onDragOver={(event) => {
                  if (job.status === "queued") event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceJobId = event.dataTransfer.getData("text/asset-studio-job");
                  if (sourceJobId) onReorder(sourceJobId, job.jobId);
                }}
              >
                <button type="button" className="asset-studio-job-main" data-help-key="asset.openJob" onClick={() => onSelectJob(job.jobId)}>
                  <span className="asset-studio-job-status">{statusIcon(job)}{statusLabels[job.status]}</span>
                  <strong>{assetStudioOperationLabels[job.recipe.operation]} · {job.recipe.provider?.displayName}</strong>
                  <p>{job.recipe.prompt || "无提示词任务"}</p>
                  <span className="asset-studio-job-progress"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></span>
                  <small>{job.phase} · {Math.round(job.progress * 100)}%</small>
                </button>
                <div className="asset-studio-job-actions">
                  {job.status === "queued" && (
                    <>
                      <button
                        type="button"
                        className="asset-studio-icon-button"
                        data-help-key="asset.moveJobUp"
                        aria-label="在队列中上移"
                        disabled={queuedJobs[0]?.jobId === job.jobId}
                        onClick={() => onMove(job.jobId, -1)}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="asset-studio-icon-button"
                        data-help-key="asset.moveJobDown"
                        aria-label="在队列中下移"
                        disabled={queuedJobs[queuedJobs.length - 1]?.jobId === job.jobId}
                        onClick={() => onMove(job.jobId, 1)}
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </button>
                    </>
                  )}
                  <button type="button" className="asset-studio-ghost-button" data-help-key="asset.cancelJob" onClick={() => onCancel(job.jobId)}>取消</button>
                </div>
              </article>
            ))}
          </section>
        )}

        {tab === "results" && (
          <section className="asset-studio-result-list" role="tabpanel">
            <header>
              <div>
                <strong>本批候选</strong>
                <span>{selectedJob ? `${selectedJob.candidates.length} 张结果` : "选择一个历史任务查看结果"}</span>
              </div>
              {selectedCandidates.length > 0 && (
                <button type="button" className="asset-studio-secondary-button" data-help-key="asset.saveSelected" onClick={() => onSave(selectedCandidates)}>
                  <Save size={15} aria-hidden="true" />
                  保存 {selectedCandidates.length} 张
                </button>
              )}
            </header>
            {!selectedJob || selectedJob.candidates.length === 0 ? (
              <div className="asset-studio-rail-empty">
                <Images size={24} aria-hidden="true" />
                <strong>还没有候选图</strong>
                <span>选择已完成任务，或先生成一批素材。</span>
              </div>
            ) : (
              <div className="asset-studio-result-card-grid">
                {selectedJob.candidates.map((candidate, index) => {
                  const checked = selectedJob.selectedCandidateIds.includes(candidate.image_id);
                  return (
                    <article key={candidate.image_id}>
                      <button type="button" className="asset-studio-result-preview" data-help-key="asset.openCandidate" onClick={() => onSelectCandidate(candidate.image_id)}>
                        {candidate.blob_url
                          ? <img src={candidate.blob_url} loading="lazy" alt={`${selectedJob.recipe.assetType}候选图 ${index + 1}：${selectedJob.recipe.prompt.slice(0, 60)}`} />
                          : <span>缓存已过期</span>}
                      </button>
                      <label>
                        <input
                          data-help-key="asset.selectCandidate"
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleCandidate(selectedJob.jobId, candidate.image_id)}
                        />
                        选择候选 {index + 1}
                      </label>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {tab === "history" && (
          <section className="asset-studio-history" role="tabpanel">
            <header>
              <div>
                <strong>生成历史</strong>
                <span>记录成功、失败、取消和中断的每次尝试</span>
              </div>
              <div className="asset-studio-history-header-actions">
                <span>缓存 {(cachedBytes / 1024 / 1024).toFixed(cachedBytes > 0 ? 1 : 0)} 兆 / 上限 512 兆</span>
                <button type="button" className="asset-studio-icon-button" data-help-key="asset.clearCache" aria-label="清理未保存结果缓存，保留任务元数据" onClick={() => {
                  if (window.confirm("清理所有未入库候选图？任务和配方元数据会保留。")) onClearOutputs();
                }}>
                  <HardDrive size={16} aria-hidden="true" />
                </button>
                <button type="button" className="asset-studio-icon-button" data-help-key="asset.clearHistory" aria-label="清除已完成历史" onClick={() => {
                  if (window.confirm("清除所有已完成、失败、取消和中断的历史记录？")) onClearCompleted();
                }}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="asset-studio-history-filters">
              <label className="asset-studio-history-search">
                <Search size={15} aria-hidden="true" />
                <span className="sr-only">搜索历史</span>
                <input data-help-key="asset.historySearch" value={query} placeholder="搜索提示词或模型" onChange={(event) => setQuery(event.target.value)} />
              </label>
              <RichSelect value={timeFilter} variant="compact" ariaLabel="按时间筛选" helpKey="asset.historyTime" options={[
                { value: "all", label: "全部时间" },
                { value: "today", label: "最近 24 小时" },
                { value: "week", label: "最近 7 天" },
              ]} onChange={setTimeFilter} />
              <RichSelect value={statusFilter} variant="compact" ariaLabel="按状态筛选" helpKey="asset.historyStatus" options={[
                { value: "all", label: "全部状态" },
                { value: "completed", label: "已完成" },
                { value: "partial", label: "部分完成" },
                { value: "failed", label: "失败" },
                { value: "cancelled", label: "已取消" },
                { value: "interrupted", label: "已中断" },
              ]} onChange={setStatusFilter} />
              <RichSelect value={operationFilter} variant="compact" ariaLabel="按操作筛选" helpKey="asset.historyOperation" options={[
                { value: "all", label: "全部操作" },
                ...Object.entries(assetStudioOperationLabels).map(([value, label]) => ({ value, label })),
              ]} onChange={setOperationFilter} />
              <RichSelect value={assetTypeFilter} variant="compact" ariaLabel="按素材类型筛选" helpKey="asset.historyType" options={[
                { value: "all", label: "全部素材" },
                { value: "background", label: "背景" },
                { value: "sprite", label: "立绘" },
                { value: "portrait", label: "头像" },
                { value: "cg", label: "剧情 CG" },
                { value: "ui", label: "UI" },
              ]} onChange={setAssetTypeFilter} />
              <RichSelect value={providerFilter} variant="compact" ariaLabel="按提供商筛选" helpKey="asset.historyProvider" options={[
                { value: "all", label: "全部模型" },
                ...providers.map((provider) => ({ value: provider.providerId, label: provider.displayName })),
              ]} onChange={setProviderFilter} />
            </div>
            {pendingRestore && (
              <div className="asset-studio-restore-confirm" role="alert">
                <strong>恢复配方前确认差异</strong>
                <p>
                  当前草稿不会被静默覆盖。将更改
                  {restoreDifferences.length ? `：${restoreDifferences.join("、")}` : "少量时间戳与来源信息"}。
                </p>
                <div>
                  <button type="button" className="asset-studio-ghost-button" data-help-key="asset.cancelRestore" onClick={() => setPendingRestoreId(undefined)}>取消</button>
                  <button type="button" className="asset-studio-secondary-button" data-help-key="asset.confirmRestore" onClick={() => {
                    onReuse(pendingRestore.recipe);
                    setPendingRestoreId(undefined);
                  }}>确认恢复</button>
                </div>
              </div>
            )}
            {history.length === 0 ? (
              <div className="asset-studio-rail-empty">
                <History size={24} aria-hidden="true" />
                <strong>暂无匹配记录</strong>
                <span>调整筛选条件或开始一次生成。</span>
              </div>
            ) : history.map((job) => (
              <article className={`asset-studio-history-card status-${job.status}`} key={job.jobId}>
                <button type="button" className="asset-studio-job-main" data-help-key="asset.openHistoryJob" onClick={() => onSelectJob(job.jobId)}>
                  <span className="asset-studio-job-status">{statusIcon(job)}{statusLabels[job.status]}</span>
                  <strong>{assetStudioOperationLabels[job.recipe.operation]} · {job.recipe.assetType}</strong>
                  <p>{job.recipe.prompt || "无提示词任务"}</p>
                  <small>
                    {new Date(job.queuedAt).toLocaleString()} · {job.recipe.provider?.model || "未知模型"}
                  </small>
                </button>
                <div className="asset-studio-history-actions">
                  <button type="button" data-help-key="asset.restoreRecipe" onClick={() => setPendingRestoreId(job.jobId)}><RefreshCw size={14} />恢复配方</button>
                  {job.error?.recoverable && (
                    <button type="button" data-help-key="asset.retryJob" onClick={() => onRetry(job.jobId)}>
                      {job.status === "partial" && job.failedOutputCount ? `重试失败的 ${job.failedOutputCount} 张` : "重试"}
                    </button>
                  )}
                </div>
                {job.error && <p className="asset-studio-history-error">{job.error.message}</p>}
              </article>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
