import { useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import {
  AudioLines,
  CheckCircle2,
  Columns3,
  Clock3,
  GripVertical,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  Video,
  Wand2,
} from "lucide-react";
import { backendClient } from "../../api/backendClient";
import {
  assetStudioAssetTypePresets,
  assetStudioOperationLabels,
  validateAssetStudioRecipe,
} from "../../asset-studio/defaults";
import {
  cancelAssetStudioJob,
  enqueueAssetStudioRecipe,
  moveQueuedAssetStudioJob,
  reorderQueuedAssetStudioJob,
  resumeAssetStudioQueue,
  retryAssetStudioJob,
} from "../../asset-studio/queue";
import { useAssetStudioStore } from "../../asset-studio/store";
import type { AssetStudioOpenContext, ImageGenerationJob, ImageGenerationRecipeV1 } from "../../asset-studio/types";
import type { GeneratedAssetCandidate } from "../../asset-generation/session";
import { getPersistedApiKeys } from "../../providers/apiKeyStorage";
import { humanizeProviderError } from "../../providers/providerErrors";
import {
  exportProviderState,
  getImageProvider,
  getLLMProvider,
  getProvidersForCapability,
  getSelectedProviderConfig,
  setCapabilitySelection,
} from "../../providers/providerRegistry";
import type {
  GeneratedAssetRecord,
  ImageOperation,
  ImageProviderFeatureSet,
  PromptRewriteResult,
  ProviderConfig,
  ReferenceImage,
} from "../../providers/types";
import { useProjectStore } from "../../store/projectStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { requestAdvancedTools } from "./advancedToolsBridge";
import { AssetStudioComposer } from "./asset-studio/AssetStudioComposer";
import { AssetStudioRail } from "./asset-studio/AssetStudioRail";
import { AssetStudioSaveDialog } from "./asset-studio/AssetStudioSaveDialog";
import { AssetStudioStage, candidateReference } from "./asset-studio/AssetStudioStage";

const operationOrder: ImageOperation[] = [
  "text_to_image",
  "image_to_image",
  "inpaint",
  "outpaint",
  "variation",
  "upscale",
];

const operationIcons: Record<ImageOperation, typeof Sparkles> = {
  text_to_image: Sparkles,
  image_to_image: Layers3,
  inpaint: Wand2,
  outpaint: PanelRightOpen,
  variation: ImageIcon,
  upscale: Maximize2,
};

function fallbackFeatures(provider: ProviderConfig): ImageProviderFeatureSet {
  return {
    operations: provider.capabilities.includes("image_editing")
      ? ["text_to_image", "image_to_image", "inpaint", "outpaint", "variation"]
      : ["text_to_image"],
    supports_negative_prompt: provider.provider_type === "mock",
    supports_seed: provider.provider_type === "mock",
    supports_reference_roles: provider.capabilities.includes("image_editing") ? ["source", "mask"] : [],
    supports_progress: provider.provider_type === "mock",
    supports_preview: false,
    max_images_per_request: provider.provider_type === "mock" ? 8 : 4,
    dimension_mode: "exact",
    limitation_notes: [],
  };
}

function snapshotProvider(provider: ProviderConfig) {
  let features = fallbackFeatures(provider);
  try {
    features = getImageProvider(provider.provider_id).getFeatureSet?.() ?? features;
  } catch {
    // The validation layer will explain unavailable providers when the user submits.
  }
  return {
    providerId: provider.provider_id,
    connectionName: provider.connection_name,
    displayName: provider.display_name,
    model: provider.model,
    features,
  };
}

function localCandidate(
  dataUrl: string,
  label: string,
  recipe: ImageGenerationRecipeV1,
): GeneratedAssetCandidate {
  const id = `local_${nanoid(8)}`;
  return {
    image_id: id,
    blob_url: dataUrl,
    mime_type: "image/png",
    width: recipe.width,
    height: recipe.height,
    seed: recipe.seed,
    metadata: { source: "asset_studio_local_edit", label, operation: recipe.operation },
    resultId: `local_result_${nanoid(8)}`,
    providerId: "local_edit",
    model: "AgentVN 本地画布",
    prompt: recipe.prompt,
    revisedPrompt: recipe.prompt,
    warnings: [`${label}由本地画布完成，不包含新的模型推理。`],
    issues: [],
    canSave: true,
  };
}

export function AssetGenerationPanel({
  onSaveAsset,
  openContext,
}: {
  onSaveAsset: (asset: GeneratedAssetRecord) => void;
  openContext?: AssetStudioOpenContext & { onApplyAsset?: (asset: GeneratedAssetRecord) => void };
}) {
  const projectId = useProjectStore((state) => state.projectId);
  const projectAssetStudio = useProjectStore((state) => state.settings.assetStudio);
  const setProjectAssetStudio = useProjectStore((state) => state.setAssetStudio);
  const storeProjectId = useAssetStudioStore((state) => state.projectId);
  const recipe = useAssetStudioStore((state) => state.recipe);
  const jobs = useAssetStudioStore((state) => state.jobs);
  const selectedJobId = useAssetStudioStore((state) => state.selectedJobId);
  const selectedCandidateId = useAssetStudioStore((state) => state.selectedCandidateId);
  const preferences = useAssetStudioStore((state) => state.preferences);
  const editing = useAssetStudioStore((state) => state.editing);
  const hydrated = useAssetStudioStore((state) => state.hydrated);
  const setProject = useAssetStudioStore((state) => state.setProject);
  const updateRecipe = useAssetStudioStore((state) => state.updateRecipe);
  const replaceRecipe = useAssetStudioStore((state) => state.replaceRecipe);
  const addJob = useAssetStudioStore((state) => state.addJob);
  const updateJob = useAssetStudioStore((state) => state.updateJob);
  const removeCompletedJobs = useAssetStudioStore((state) => state.removeCompletedJobs);
  const clearCachedOutputs = useAssetStudioStore((state) => state.clearCachedOutputs);
  const setSelectedJob = useAssetStudioStore((state) => state.setSelectedJob);
  const setSelectedCandidate = useAssetStudioStore((state) => state.setSelectedCandidate);
  const setPreferences = useAssetStudioStore((state) => state.setPreferences);
  const setEditing = useAssetStudioStore((state) => state.setEditing);
  const [rewriteResult, setRewriteResult] = useState<PromptRewriteResult>();
  const [rewriteStream, setRewriteStream] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [promptBeforeRewrite, setPromptBeforeRewrite] = useState("");
  const [savingCandidates, setSavingCandidates] = useState<GeneratedAssetCandidate[]>([]);
  const [preferencesSeededFor, setPreferencesSeededFor] = useState("");

  const providers = useMemo(() => getProvidersForCapability("image_generation"), [
    projectId,
    recipe.provider?.providerId,
  ]);
  const selectedJob = jobs.find((job) => job.jobId === selectedJobId) ?? jobs[0];
  const selectedCandidate = selectedJob?.candidates.find((candidate) => candidate.image_id === selectedCandidateId)
    ?? selectedJob?.candidates[0];
  const issues = validateAssetStudioRecipe(recipe, recipe.provider?.features);
  const errorIssues = issues.filter((issue) => issue.severity === "error");
  const activeJob = jobs.find((job) => ["queued", "validating", "running"].includes(job.status));

  useEffect(() => {
    if (storeProjectId !== projectId || !hydrated) void setProject(projectId);
  }, [hydrated, projectId, setProject, storeProjectId]);

  useEffect(() => {
    if (hydrated && storeProjectId === projectId) resumeAssetStudioQueue();
  }, [hydrated, projectId, storeProjectId]);

  useEffect(() => {
    if (!hydrated || !openContext?.recommendedAssetType) return;
    const recommended = openContext.recommendedAssetType;
    const preset = assetStudioAssetTypePresets[recommended];
    const currentContext = useAssetStudioStore.getState().recipe.projectContext;
    const sourceGeneration = openContext.sourceGeneration;
    updateRecipe({
      assetType: recommended,
      operation: sourceGeneration?.operation ?? (openContext.sourceImage ? "variation" : "text_to_image"),
      prompt: sourceGeneration?.prompt ?? useAssetStudioStore.getState().recipe.prompt,
      negativePrompt: sourceGeneration?.negative_prompt ?? "",
      stylePreset: sourceGeneration?.style_preset ?? useAssetStudioStore.getState().recipe.stylePreset,
      aspectRatio: sourceGeneration?.aspect_ratio ?? preset.aspectRatio,
      width: sourceGeneration?.width ?? preset.width,
      height: sourceGeneration?.height ?? preset.height,
      seed: sourceGeneration?.seed,
      sourceImage: openContext.sourceImage,
      projectContext: currentContext || (openContext.field ? `当前素材槽位：${openContext.field}` : ""),
    });
    setPreferences({ mobilePane: "compose" });
  }, [hydrated, openContext, setPreferences, updateRecipe]);

  useEffect(() => {
    if (!hydrated || preferencesSeededFor === projectId) return;
    setPreferences({
      advancedOpen: projectAssetStudio.advancedOpen,
      leftWidth: projectAssetStudio.leftWidth,
      rightWidth: projectAssetStudio.rightWidth,
    });
    setPreferencesSeededFor(projectId);
  }, [hydrated, preferencesSeededFor, projectAssetStudio, projectId, setPreferences]);

  useEffect(() => {
    if (preferencesSeededFor !== projectId) return;
    if (
      projectAssetStudio.advancedOpen === preferences.advancedOpen
      && projectAssetStudio.leftWidth === preferences.leftWidth
      && projectAssetStudio.rightWidth === preferences.rightWidth
    ) return;
    setProjectAssetStudio({
      version: 1,
      advancedOpen: preferences.advancedOpen,
      leftWidth: preferences.leftWidth,
      rightWidth: preferences.rightWidth,
      customPresets: useProjectStore.getState().settings.assetStudio.customPresets,
    });
  }, [preferences, preferencesSeededFor, projectAssetStudio, projectId, setProjectAssetStudio]);

  useEffect(() => {
    if (!hydrated || recipe.provider && providers.some((provider) => provider.provider_id === recipe.provider?.providerId)) return;
    const persisted = getSelectedProviderConfig("image_generation");
    const provider = providers.find((item) => item.provider_id === persisted?.provider_id) ?? providers[0];
    if (provider) updateRecipe({ provider: snapshotProvider(provider), safetyLevel: provider.safety_level });
  }, [hydrated, providers, recipe.provider, updateRecipe]);

  useEffect(() => {
    if (selectedJob?.candidates.length && !selectedCandidateId) {
      setSelectedCandidate(selectedJob.candidates[0].image_id);
    }
  }, [selectedCandidateId, selectedJob, setSelectedCandidate]);

  useEffect(() => {
    if (
      selectedJob?.candidates.length
      && ["completed", "partial"].includes(selectedJob.status)
      && preferences.railTab === "queue"
    ) {
      setPreferences({ railTab: "results" });
    }
  }, [preferences.railTab, selectedJob, setPreferences]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTextField = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT" || target?.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void generate();
      } else if (event.key === "Escape" && editing) {
        event.preventDefault();
        setEditing(false);
      } else if (event.key === "Escape" && preferences.rightOpen) {
        event.preventDefault();
        setPreferences({ rightOpen: false });
      } else if (!isTextField && selectedJob?.candidates.length && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const index = Math.max(0, selectedJob.candidates.findIndex((item) => item.image_id === selectedCandidate?.image_id));
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = selectedJob.candidates[(index + delta + selectedJob.candidates.length) % selectedJob.candidates.length];
        setSelectedCandidate(next.image_id);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  async function persistProviderSelection(providerId: string) {
    setCapabilitySelection("image_generation", providerId || undefined);
    await backendClient.saveProjectState({
      ...exportProviderState(),
      provider_secrets: getPersistedApiKeys(),
    });
  }

  function changeProvider(providerId: string) {
    const provider = providers.find((item) => item.provider_id === providerId);
    updateRecipe({
      provider: provider ? snapshotProvider(provider) : undefined,
      safetyLevel: provider?.safety_level ?? "standard",
    });
    if (provider) void persistProviderSelection(provider.provider_id);
  }

  async function rewritePrompt() {
    if (!recipe.prompt.trim() || rewriting) return;
    setRewriting(true);
    setRewriteStream("");
    setRewriteResult(undefined);
    setRewriteError("");
    try {
      const provider = getSelectedProviderConfig("prompt_rewrite") ?? getSelectedProviderConfig("text_generation");
      if (!provider) {
        setRewriteError("请先在“模型/连接”中为文本生成指定可用模型。");
        return;
      }
      const llmProvider = getLLMProvider(provider.provider_id);
      const request = {
        user_description: recipe.prompt,
        asset_type: recipe.assetType,
        style_preset: recipe.stylePreset,
        scene_context: recipe.projectContext || undefined,
        provider_id: provider.provider_id,
      } as const;
      const result = llmProvider.rewritePromptStream
        ? await llmProvider.rewritePromptStream(request, {
            onDelta: (delta) => setRewriteStream((current) => `${current}${delta}`),
          })
        : await llmProvider.rewritePrompt(request);
      setRewriteResult(result);
      setRewriteStream("");
    } catch (error) {
      reportFrontendError("editor.asset-studio.prompt-rewrite", error, { operation: "rewrite" });
      setRewriteError(humanizeProviderError(error));
    } finally {
      setRewriting(false);
    }
  }

  function applyRewrite(includeNegative = true) {
    if (!rewriteResult) return;
    setPromptBeforeRewrite(recipe.prompt);
    updateRecipe({
      originalPrompt: recipe.originalPrompt || recipe.prompt,
      optimizedPrompt: rewriteResult.optimized_prompt,
      prompt: rewriteResult.optimized_prompt,
      negativePrompt: includeNegative ? rewriteResult.negative_prompt || recipe.negativePrompt : recipe.negativePrompt,
    });
  }

  function beginResize(side: "left" | "right", event: React.PointerEvent<HTMLButtonElement>) {
    const workspace = event.currentTarget.parentElement;
    if (!workspace) return;
    event.preventDefault();
    const bounds = workspace.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const next = side === "left"
        ? Math.min(440, Math.max(300, moveEvent.clientX - bounds.left))
        : Math.min(440, Math.max(300, bounds.right - moveEvent.clientX));
      setPreferences(side === "left" ? { leftWidth: Math.round(next) } : { rightWidth: Math.round(next) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  async function generate() {
    if (errorIssues.length > 0) {
      setPreferences({ railTab: "queue" });
      return;
    }
    const jobId = await enqueueAssetStudioRecipe(projectId, recipe);
    setSelectedJob(jobId);
    setPreferences({ railTab: "queue" });
  }

  function continueFromCandidate(operation: ImageOperation, candidate: GeneratedAssetCandidate) {
    const sourceImage = candidateReference(candidate);
    updateRecipe({
      operation,
      sourceImage,
      references: recipe.references.filter((image) => image.role !== "source"),
      seed: operation === "variation" ? Math.floor(Math.random() * 2_147_483_647) : recipe.seed,
      width: operation === "upscale" ? candidate.width * recipe.upscaleFactor : candidate.width,
      height: operation === "upscale" ? candidate.height * recipe.upscaleFactor : candidate.height,
    });
  }

  function addLocalOutput(dataUrl: string, label: string) {
    const candidate = localCandidate(dataUrl, label, recipe);
    if (selectedJob) {
      updateJob(selectedJob.jobId, {
        candidates: [candidate, ...selectedJob.candidates],
        selectedCandidateIds: [candidate.image_id, ...selectedJob.selectedCandidateIds],
      });
      setSelectedCandidate(candidate.image_id);
      return;
    }
    const now = new Date().toISOString();
    const job: ImageGenerationJob = {
      jobId: `local_job_${nanoid(8)}`,
      projectId,
      recipe,
      status: "completed",
      progress: 1,
      phase: `${label}完成`,
      candidates: [candidate],
      selectedCandidateIds: [candidate.image_id],
      warnings: candidate.warnings,
      queuedAt: now,
      startedAt: now,
      finishedAt: now,
      attempt: 1,
    };
    addJob(job);
    setSelectedCandidate(candidate.image_id);
  }

  function setMask(dataUrl: string) {
    const mask: ReferenceImage = {
      image_id: `mask_${nanoid(8)}`,
      source: "sketch",
      blob_url: dataUrl,
      note: "重绘蒙版",
      weight: 1,
      role: "mask",
    };
    updateRecipe({ operation: "inpaint", maskImage: mask });
    setEditing(false);
  }

  function toggleCandidate(jobId: string, candidateId: string) {
    const job = jobs.find((item) => item.jobId === jobId);
    if (!job) return;
    const selected = job.selectedCandidateIds.includes(candidateId)
      ? job.selectedCandidateIds.filter((id) => id !== candidateId)
      : [...job.selectedCandidateIds, candidateId];
    updateJob(jobId, { selectedCandidateIds: selected });
  }

  function selectOperation(operation: ImageOperation) {
    if (!recipe.provider?.features.operations.includes(operation)) return;
    updateRecipe({ operation });
    if (operation === "inpaint" || operation === "outpaint") {
      if (recipe.sourceImage) setEditing(true);
    } else {
      setEditing(false);
    }
  }

  return (
    <section
      className="asset-generation-panel asset-studio"
      data-hover-help-suppressed="true"
      style={{
        "--asset-studio-left": `${preferences.leftWidth}px`,
        "--asset-studio-right": `${preferences.rightWidth}px`,
      } as React.CSSProperties}
    >
      <header className="asset-studio-header">
        <div className="asset-studio-brand">
          <span className="asset-studio-brand-mark"><Sparkles size={19} aria-hidden="true" /></span>
          <h1>绘梦</h1>
        </div>
        <nav className="asset-studio-mode-switcher" aria-label="生成模式">
          {operationOrder.map((operation) => {
            const Icon = operationIcons[operation];
            const supported = recipe.provider?.features.operations.includes(operation) ?? operation === "text_to_image";
            return (
              <button
                type="button"
                key={operation}
                data-help-key="asset.operation"
                className={recipe.operation === operation ? "is-active" : ""}
                aria-pressed={recipe.operation === operation}
                disabled={!supported}
                aria-label={supported ? assetStudioOperationLabels[operation] : `${assetStudioOperationLabels[operation]}，当前模型不支持`}
                onClick={() => selectOperation(operation)}
              >
                <Icon size={16} aria-hidden="true" />
                {assetStudioOperationLabels[operation]}
              </button>
            );
          })}
          <span className="asset-studio-future-mode" aria-label="音频工作台将在后续版本开放"><AudioLines size={15} />音频</span>
          <span className="asset-studio-future-mode" aria-label="视频工作台将在后续版本开放"><Video size={15} />视频</span>
        </nav>
        <div className="asset-studio-header-status">
          <span className={recipe.provider ? "is-ready" : "is-blocked"}>
            {recipe.provider ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
            {recipe.provider?.displayName || "未连接图像模型"}
          </span>
          <small>{hydrated ? "草稿已自动保存" : "正在恢复草稿"}</small>
          <button
            type="button"
            className="asset-studio-icon-button asset-studio-rail-toggle"
            data-help-key="asset.toggleRail"
            aria-label={preferences.rightOpen ? "收起生产栏" : "打开生产栏"}
            aria-pressed={preferences.rightOpen}
            onClick={() => setPreferences({ rightOpen: !preferences.rightOpen })}
          >
            {preferences.rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
        </div>
      </header>

      {!recipe.provider && (
        <div className="asset-studio-blocker" role="alert">
          <div>
            <strong>需要先配置图像模型</strong>
            <span>工作台会根据模型真实能力开放参考生成、重绘和扩图等模式。</span>
          </div>
          <button type="button" data-help-key="asset.configureProvider" onClick={() => requestAdvancedTools({ tab: "providers", title: "配置图像模型" })}>
            前往模型/连接
          </button>
        </div>
      )}

      {rewriteError && <div className="asset-studio-inline-alert" role="alert">{rewriteError}</div>}

      <nav className="asset-studio-mobile-tabs" aria-label="工作台区域">
        {([
          ["compose", "创作", Sparkles],
          ["stage", "画布", ImageIcon],
          ["production", "任务", Columns3],
        ] as const).map(([pane, label, Icon]) => (
          <button
            type="button"
            key={pane}
            data-help-key="asset.mobilePane"
            className={preferences.mobilePane === pane ? "is-active" : ""}
            aria-pressed={preferences.mobilePane === pane}
            onClick={() => setPreferences({ mobilePane: pane })}
          >
            <Icon size={16} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      <div className={`asset-studio-workspace pane-${preferences.mobilePane}${preferences.rightOpen ? " is-rail-open" : ""}`}>
        <AssetStudioComposer
          recipe={recipe}
          providers={providers}
          issues={issues}
          rewriteResult={rewriteResult}
          rewriteStream={rewriteStream}
          rewriting={rewriting}
          canUndoRewrite={Boolean(promptBeforeRewrite)}
          onPatch={updateRecipe}
          onReplace={replaceRecipe}
          onProviderChange={changeProvider}
          onRewrite={() => void rewritePrompt()}
          onApplyRewrite={applyRewrite}
          onUndoRewrite={() => {
            if (!promptBeforeRewrite) return;
            updateRecipe({ prompt: promptBeforeRewrite, optimizedPrompt: undefined });
            setPromptBeforeRewrite("");
          }}
          customPresets={projectAssetStudio.customPresets}
          onSaveCustomPreset={(name) => {
            const latestAssetStudio = useProjectStore.getState().settings.assetStudio;
            setProjectAssetStudio({
              ...latestAssetStudio,
              customPresets: [
                {
                  presetId: `asset_preset_${nanoid(8)}`,
                  name,
                  assetType: recipe.assetType,
                  stylePreset: recipe.stylePreset,
                  aspectRatio: recipe.aspectRatio,
                  width: recipe.width,
                  height: recipe.height,
                  promptTemplate: recipe.prompt
                    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, "[密钥已移除]")
                    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/gi, "Bearer [密钥已移除]"),
                },
                ...latestAssetStudio.customPresets,
              ].slice(0, 50),
            });
          }}
        />
        <button
          type="button"
          className="asset-studio-resize-handle is-left"
          data-help-key="asset.resizeComposer"
          aria-label="调整创作栏宽度"
          onPointerDown={(event) => beginResize("left", event)}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <AssetStudioStage
          recipe={recipe}
          job={selectedJob}
          candidate={selectedCandidate}
          editing={editing}
          onSelectCandidate={setSelectedCandidate}
          onSave={setSavingCandidates}
          onReuseRecipe={(next) => replaceRecipe(next)}
          onContinueFromCandidate={continueFromCandidate}
          onSetEditing={setEditing}
          onMaskChange={setMask}
          onLocalOutput={addLocalOutput}
          onRetry={(jobId) => void retryAssetStudioJob(jobId)}
          onSwitchProvider={() => requestAdvancedTools({ tab: "providers", title: "切换图像模型" })}
          onRemoveUnsupported={() => updateRecipe({
            operation: recipe.provider?.features.operations.includes(recipe.operation) ? recipe.operation : "text_to_image",
            negativePrompt: recipe.provider?.features.supports_negative_prompt ? recipe.negativePrompt : "",
            seed: recipe.provider?.features.supports_seed ? recipe.seed : undefined,
            references: recipe.references.filter((reference) => recipe.provider?.features.supports_reference_roles.includes(reference.role ?? "composition")),
            maskImage: recipe.provider?.features.supports_reference_roles.includes("mask") ? recipe.maskImage : undefined,
          })}
        />
        <button
          type="button"
          className="asset-studio-resize-handle is-right"
          data-help-key="asset.resizeRail"
          aria-label="调整生产栏宽度"
          onPointerDown={(event) => beginResize("right", event)}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <AssetStudioRail
          tab={preferences.railTab}
          jobs={jobs}
          currentRecipe={recipe}
          selectedJobId={selectedJob?.jobId}
          onTabChange={(railTab) => setPreferences({ railTab })}
          onSelectJob={(jobId) => {
            setSelectedJob(jobId);
            const job = jobs.find((item) => item.jobId === jobId);
            if (job?.candidates[0]) setSelectedCandidate(job.candidates[0].image_id);
          }}
          onSelectCandidate={(candidateId) => {
            setSelectedCandidate(candidateId);
            setPreferences({ railTab: "results" });
          }}
          onToggleCandidate={toggleCandidate}
          onCancel={cancelAssetStudioJob}
          onRetry={(jobId) => void retryAssetStudioJob(jobId)}
          onMove={moveQueuedAssetStudioJob}
          onReorder={reorderQueuedAssetStudioJob}
          onReuse={(next) => replaceRecipe(next)}
          onSave={setSavingCandidates}
          onClearCompleted={removeCompletedJobs}
          onClearOutputs={clearCachedOutputs}
        />
      </div>

      <footer className="asset-studio-command-bar">
        <div className="asset-studio-command-summary">
          <strong>{assetStudioOperationLabels[recipe.operation]} · {recipe.aspectRatio} · {recipe.count} 张</strong>
          <span>{recipe.width} × {recipe.height} · {recipe.provider?.model || "请选择模型"}</span>
        </div>
        {errorIssues.length > 0 && (
          <div className="asset-studio-command-error" role="alert">
            {errorIssues[0].message}
            {errorIssues.length > 1 && `，另有 ${errorIssues.length - 1} 项`}
          </div>
        )}
        <div className="asset-studio-command-actions">
          <span>快捷键：Ctrl / ⌘ + Enter</span>
          {activeJob && (
            <button type="button" className="asset-studio-secondary-button" data-help-key="asset.cancelJob" onClick={() => cancelAssetStudioJob(activeJob.jobId)}>
              取消当前任务
            </button>
          )}
          <button
            type="button"
            className="asset-studio-primary-button"
            data-help-key="asset.generate"
            disabled={errorIssues.length > 0}
            onClick={() => void generate()}
          >
            {activeJob ? <LoaderCircle className="is-spinning" size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            加入生成队列
          </button>
        </div>
      </footer>

      {savingCandidates.length > 0 && (
        <AssetStudioSaveDialog
          candidates={savingCandidates}
          recipe={selectedJob?.recipe ?? recipe}
          jobId={selectedJob?.jobId}
          onSaveAsset={onSaveAsset}
          openContext={openContext}
          onClose={() => setSavingCandidates([])}
        />
      )}
    </section>
  );
}
