import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Columns2,
  Download,
  Expand,
  Grid2X2,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  Save,
  ScanSearch,
  Sparkles,
  Wand2,
} from "lucide-react";
import { assetStudioAssetTypePresets, assetStudioOperationLabels } from "../../../asset-studio/defaults";
import type { ImageGenerationJob, ImageGenerationRecipeV1 } from "../../../asset-studio/types";
import type { GeneratedAssetCandidate } from "../../../asset-generation/session";
import type { ImageOperation, ReferenceImage } from "../../../providers/types";
import { AssetStudioCanvasEditor } from "./AssetStudioCanvasEditor";

interface AssetStudioStageProps {
  recipe: ImageGenerationRecipeV1;
  job?: ImageGenerationJob;
  candidate?: GeneratedAssetCandidate;
  editing: boolean;
  onSelectCandidate: (candidateId: string) => void;
  onSave: (candidates: GeneratedAssetCandidate[]) => void;
  onReuseRecipe: (recipe: ImageGenerationRecipeV1) => void;
  onContinueFromCandidate: (operation: ImageOperation, candidate: GeneratedAssetCandidate) => void;
  onSetEditing: (editing: boolean) => void;
  onMaskChange: (dataUrl: string) => void;
  onLocalOutput: (dataUrl: string, label: string) => void;
  onRetry: (jobId: string) => void;
  onSwitchProvider: () => void;
  onRemoveUnsupported: () => void;
}

function candidateReference(candidate: GeneratedAssetCandidate): ReferenceImage {
  return {
    image_id: `source_${candidate.image_id}`,
    source: "project_asset",
    blob_url: candidate.blob_url,
    note: candidate.image_id,
    weight: 1,
    role: "source",
  };
}

function downloadCandidate(candidate: GeneratedAssetCandidate) {
  const anchor = document.createElement("a");
  anchor.href = candidate.blob_url;
  anchor.download = `${candidate.image_id}.${candidate.mime_type.includes("jpeg") ? "jpg" : "png"}`;
  anchor.click();
}

export function AssetStudioStage({
  recipe,
  job,
  candidate,
  editing,
  onSelectCandidate,
  onSave,
  onReuseRecipe,
  onContinueFromCandidate,
  onSetEditing,
  onMaskChange,
  onLocalOutput,
  onRetry,
  onSwitchProvider,
  onRemoveUnsupported,
}: AssetStudioStageProps) {
  const sourceUrl = candidate?.blob_url || recipe.sourceImage?.blob_url;
  const completedCandidates = job?.candidates ?? [];
  const isRunning = job?.status === "queued" || job?.status === "validating" || job?.status === "running";
  const [viewMode, setViewMode] = useState<"focus" | "grid" | "compare">("focus");
  const candidateIndex = Math.max(0, completedCandidates.findIndex((item) => item.image_id === candidate?.image_id));
  const compareCandidate = completedCandidates.length > 1
    ? completedCandidates[(candidateIndex + 1) % completedCandidates.length]
    : undefined;
  const supports = (operation: ImageOperation) => recipe.provider?.features.operations.includes(operation) ?? false;

  if (editing && sourceUrl) {
    return (
      <main className="asset-studio-stage is-editing" aria-label="图片编辑舞台">
        <header className="asset-studio-stage-header">
          <div>
            <span className="asset-studio-eyebrow">非破坏编辑</span>
            <h2>蒙版、裁切与透明处理</h2>
          </div>
          <button type="button" className="asset-studio-secondary-button" data-help-key="asset.finishEditing" onClick={() => onSetEditing(false)}>
            <CheckCircle2 size={16} aria-hidden="true" />
            完成编辑
          </button>
        </header>
        <AssetStudioCanvasEditor
          sourceUrl={sourceUrl}
          recipe={recipe}
          onMaskChange={onMaskChange}
          onLocalOutput={onLocalOutput}
        />
      </main>
    );
  }

  return (
    <main className="asset-studio-stage" aria-label="生成结果舞台">
      <header className="asset-studio-stage-header">
        <div>
          <span className="asset-studio-eyebrow">{assetStudioOperationLabels[recipe.operation]}</span>
          <h2>{candidate ? assetStudioAssetTypePresets[recipe.assetType].label + "候选结果" : "创作舞台"}</h2>
        </div>
        {candidate && (
          <div className="asset-studio-stage-heading-actions">
            {completedCandidates.length > 1 && (
              <div className="asset-studio-view-switcher" role="group" aria-label="结果查看方式">
                <button type="button" data-help-key="asset.viewFocus" className={viewMode === "focus" ? "is-active" : ""} aria-pressed={viewMode === "focus"} onClick={() => setViewMode("focus")}>
                  <ImageIcon size={15} aria-hidden="true" />聚焦
                </button>
                <button type="button" data-help-key="asset.viewGrid" className={viewMode === "grid" ? "is-active" : ""} aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}>
                  <Grid2X2 size={15} aria-hidden="true" />网格
                </button>
                <button type="button" data-help-key="asset.viewCompare" className={viewMode === "compare" ? "is-active" : ""} aria-pressed={viewMode === "compare"} onClick={() => setViewMode("compare")}>
                  <Columns2 size={15} aria-hidden="true" />A/B
                </button>
              </div>
            )}
            <div className="asset-studio-stage-meta">
              <span>{candidate.width} × {candidate.height}</span>
              {candidate.seed !== undefined && <span>随机种子 {candidate.seed}</span>}
            </div>
          </div>
        )}
      </header>

      <div className={`asset-studio-stage-canvas${candidate ? " has-result" : ""}${isRunning ? " is-running" : ""} view-${viewMode}`}>
        {candidate && viewMode === "grid" ? (
          <div className="asset-studio-stage-result-grid">
            {completedCandidates.map((item, index) => (
              <button
                type="button"
                data-help-key="asset.openCandidate"
                key={item.image_id}
                className={item.image_id === candidate.image_id ? "is-selected" : ""}
                aria-pressed={item.image_id === candidate.image_id}
                onClick={() => {
                  onSelectCandidate(item.image_id);
                  setViewMode("focus");
                }}
              >
                <img src={item.blob_url} loading="lazy" alt={`候选图 ${index + 1}：${recipe.prompt.slice(0, 60)}`} />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        ) : candidate && viewMode === "compare" && compareCandidate ? (
          <div className="asset-studio-stage-comparison">
            {[candidate, compareCandidate].map((item, index) => (
              <figure key={item.image_id}>
                <img src={item.blob_url} alt={`${index === 0 ? "A" : "B"} 候选图：${recipe.prompt.slice(0, 60)}`} />
                <figcaption>{index === 0 ? "A · 当前主结果" : "B · 下一候选"}</figcaption>
              </figure>
            ))}
          </div>
        ) : candidate ? (
          <>
            <img
              src={candidate.blob_url}
              alt={`${assetStudioAssetTypePresets[recipe.assetType].label}候选图：${recipe.prompt.slice(0, 80)}`}
            />
            <div className="asset-studio-result-badge">
              <Sparkles size={14} aria-hidden="true" />
              AI 生成
            </div>
          </>
        ) : isRunning ? (
          <div className="asset-studio-generating-state" role="status" aria-live="polite">
            <span className="asset-studio-generation-orbit"><Sparkles size={25} aria-hidden="true" /></span>
            <strong>{job?.phase || "正在准备生成"}</strong>
            <p>{recipe.prompt.slice(0, 120)}</p>
            <div className="asset-studio-progress-track">
              <span style={{ width: `${Math.max(6, Math.round((job?.progress ?? 0) * 100))}%` }} />
            </div>
            <small>{Math.round((job?.progress ?? 0) * 100)}%</small>
          </div>
        ) : job?.status === "failed" ? (
          <div className="asset-studio-empty-state is-error" role="alert">
            <ScanSearch size={34} aria-hidden="true" />
            <strong>本次生成没有完成</strong>
            <p>{job.error?.message || "模型未返回可用结果。"}</p>
            <div className="asset-studio-failure-actions">
              {job.error?.recoverable && <button type="button" className="asset-studio-secondary-button" data-help-key="asset.retryJob" onClick={() => onRetry(job.jobId)}>重试任务</button>}
              <button type="button" className="asset-studio-ghost-button" data-help-key="asset.switchProvider" onClick={onSwitchProvider}>切换模型</button>
              {job.error?.code === "unsupported" || job.error?.code === "validation"
                ? <button type="button" className="asset-studio-ghost-button" data-help-key="asset.removeUnsupported" onClick={onRemoveUnsupported}>移除不支持参数</button>
                : null}
            </div>
          </div>
        ) : (
          <div className="asset-studio-empty-state asset-studio-left-guide" role="status">
            <span className="asset-studio-left-guide-icon" aria-hidden="true">
              <ArrowLeft size={22} />
            </span>
            <span>请在左侧操作与编辑</span>
          </div>
        )}
      </div>

      {candidate && (
        <div className="asset-studio-result-actions" aria-label="结果操作">
          <button type="button" className="asset-studio-primary-button" data-help-key="asset.saveGenerated" disabled={!candidate.canSave} onClick={() => onSave([candidate])}>
            <Save size={16} aria-hidden="true" />
            保存入库
          </button>
          <button type="button" data-help-key="asset.reuseRecipe" onClick={() => onReuseRecipe(job?.recipe ?? recipe)}>
            <RefreshCw size={16} aria-hidden="true" />
            复用参数
          </button>
          <button
            type="button"
            data-help-key="asset.makeVariation"
            disabled={!supports("variation")}
            aria-label={supports("variation") ? "制作变体，继承来源和参数并生成新种子" : "制作变体，当前模型不支持"}
            onClick={() => onContinueFromCandidate("variation", candidate)}
          >
            <Wand2 size={16} aria-hidden="true" />
            制作变体
          </button>
          <button type="button" data-help-key="asset.startInpaint" disabled={!supports("inpaint")} aria-label={supports("inpaint") ? "局部重绘，绘制蒙版后重新生成" : "局部重绘，当前模型不支持"} onClick={() => {
            onContinueFromCandidate("inpaint", candidate);
            onSetEditing(true);
          }}>
            <Expand size={16} aria-hidden="true" />
            局部重绘
          </button>
          <button type="button" data-help-key="asset.startOutpaint" disabled={!supports("outpaint")} aria-label={supports("outpaint") ? "扩图，设置边界后扩展画面" : "扩图，当前模型不支持"} onClick={() => {
            onContinueFromCandidate("outpaint", candidate);
            onSetEditing(true);
          }}>
            <Expand size={16} aria-hidden="true" />
            扩图
          </button>
          <button type="button" data-help-key="asset.startUpscale" disabled={!supports("upscale")} aria-label={supports("upscale") ? "放大，使用模型进行高质量放大" : "放大，当前模型不支持"} onClick={() => onContinueFromCandidate("upscale", candidate)}>
            <Maximize2 size={16} aria-hidden="true" />
            放大
          </button>
          <button type="button" data-help-key="asset.download" onClick={() => downloadCandidate(candidate)}>
            <Download size={16} aria-hidden="true" />
            下载副本
          </button>
        </div>
      )}

      {completedCandidates.length > 1 && (
        <section className="asset-studio-filmstrip" aria-label="候选结果">
          <div className="asset-studio-filmstrip-heading">
            <strong>本批候选</strong>
            <span>{completedCandidates.length} 张</span>
          </div>
          <div>
            {completedCandidates.map((item, index) => (
              <button
                type="button"
                data-help-key="asset.openCandidate"
                key={item.image_id}
                className={item.image_id === candidate?.image_id ? "is-selected" : ""}
                aria-label={`查看候选图 ${index + 1}`}
                aria-pressed={item.image_id === candidate?.image_id}
                onClick={() => onSelectCandidate(item.image_id)}
              >
                <img src={item.blob_url} loading="lazy" alt="" />
                <span>{index + 1}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {candidate && (
        <details className="asset-studio-provenance">
          <summary><ArrowUpRight size={15} aria-hidden="true" />查看来源与完整参数</summary>
          <dl>
            <div><dt>模型</dt><dd>{candidate.model}</dd></div>
            <div><dt>操作</dt><dd>{assetStudioOperationLabels[recipe.operation]}</dd></div>
            <div><dt>画幅</dt><dd>{recipe.aspectRatio} · {recipe.width} × {recipe.height}</dd></div>
            <div><dt>提示词</dt><dd>{candidate.revisedPrompt || candidate.prompt}</dd></div>
          </dl>
        </details>
      )}
    </main>
  );
}

export { candidateReference };
