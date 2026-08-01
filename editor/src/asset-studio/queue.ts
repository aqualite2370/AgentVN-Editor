import { nanoid } from "nanoid";
import type { GeneratedAssetCandidate } from "../asset-generation/session";
import {
  ProviderNetworkError,
  ProviderRateLimitedError,
  ProviderSafetyBlockedError,
  MissingApiKeyError,
  UnsupportedCapabilityError,
} from "../providers/providerErrors";
import { getImageProvider, getProvidersForCapability } from "../providers/providerRegistry";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProvider,
  ReferenceImage,
} from "../providers/types";
import { validateAssetStudioRecipe } from "./defaults";
import { useAssetStudioStore } from "./store";
import type {
  ImageGenerationJob,
  ImageGenerationJobError,
  ImageGenerationRecipeV1,
} from "./types";

const controllers = new Map<string, AbortController>();
let pumping = false;

async function stableReference(image?: ReferenceImage): Promise<ReferenceImage | undefined> {
  if (!image || !image.blob_url.startsWith("blob:")) return image;
  const response = await fetch(image.blob_url);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
  return { ...image, blob_url: dataUrl };
}

async function stableRecipe(recipe: ImageGenerationRecipeV1): Promise<ImageGenerationRecipeV1> {
  return {
    ...recipe,
    references: (await Promise.all(recipe.references.map(stableReference))).filter((item): item is ReferenceImage => Boolean(item)),
    sourceImage: await stableReference(recipe.sourceImage),
    maskImage: await stableReference(recipe.maskImage),
  };
}

function toJobError(error: unknown): ImageGenerationJobError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof MissingApiKeyError) return { code: "missing_key", message, recoverable: true };
  if (error instanceof ProviderRateLimitedError) return { code: "rate_limited", message, recoverable: true };
  if (error instanceof ProviderSafetyBlockedError) return { code: "safety_blocked", message, recoverable: true };
  if (error instanceof UnsupportedCapabilityError) return { code: "unsupported", message, recoverable: true };
  if (error instanceof ProviderNetworkError) return { code: "network", message, recoverable: true };
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "unknown", message: "生成任务已取消。", recoverable: true };
  }
  return { code: "unknown", message, recoverable: true };
}

function resultCandidates(
  result: ImageGenerationResult,
  recipe: ImageGenerationRecipeV1,
): GeneratedAssetCandidate[] {
  return result.images.map((image) => {
    const hasSource = Boolean(image.blob_url?.trim());
    return {
      ...image,
      resultId: result.result_id,
      providerId: result.provider_id,
      model: result.model,
      prompt: recipe.prompt,
      revisedPrompt: result.revised_prompt,
      warnings: result.warnings,
      issues: hasSource ? [] : [{
        code: "missing_image_data",
        severity: "error" as const,
        message: "模型返回的候选图没有可读取的数据。",
        path: "blob_url",
      }],
      canSave: hasSource,
      saveBlockedReason: hasSource ? undefined : "模型返回的候选图没有可读取的数据。",
    };
  });
}

function requestForRecipe(recipe: ImageGenerationRecipeV1, count: number): ImageGenerationRequest {
  if (!recipe.provider) throw new Error("Missing provider snapshot.");
  return {
    operation: recipe.operation,
    prompt: recipe.prompt.trim(),
    negative_prompt: recipe.negativePrompt.trim() || undefined,
    reference_images: recipe.references,
    source_image: recipe.sourceImage,
    mask_image: recipe.maskImage,
    style_preset: recipe.stylePreset || undefined,
    asset_type: recipe.assetType,
    aspect_ratio: recipe.aspectRatio,
    width: recipe.width,
    height: recipe.height,
    count,
    seed: recipe.seed,
    strength: recipe.strength,
    outpaint_insets: recipe.outpaintInsets,
    upscale_factor: recipe.upscaleFactor,
    provider_id: recipe.provider.providerId,
    model: recipe.provider.model,
    safety_level: recipe.safetyLevel,
    project_context: recipe.projectContext.trim() || undefined,
  };
}

async function runProvider(
  provider: ImageProvider,
  request: ImageGenerationRequest,
  jobId: string,
  chunkIndex: number,
  chunkCount: number,
  controller: AbortController,
): Promise<ImageGenerationResult> {
  const events = {
    onPhase: (phase: string) => useAssetStudioStore.getState().updateJob(jobId, { phase }),
    onProgress: (progress: number) => useAssetStudioStore.getState().updateJob(jobId, {
      progress: Math.min(0.98, (chunkIndex + Math.max(0, Math.min(1, progress))) / chunkCount),
    }),
    onPreview: (image: ImageGenerationResult["images"][number]) => {
      const current = useAssetStudioStore.getState().jobs.find((item) => item.jobId === jobId);
      if (!current || current.status === "cancelled") return;
      const [preview] = resultCandidates({
        result_id: `preview_${jobId}`,
        provider_id: provider.config.provider_id,
        model: request.model,
        images: [image],
        created_at: new Date().toISOString(),
        warnings: [],
      }, current.recipe);
      useAssetStudioStore.getState().updateJob(jobId, {
        candidates: [
          ...current.candidates.filter((candidate) => candidate.image_id !== preview.image_id),
          preview,
        ],
      });
    },
  };
  return provider.runImageJob
    ? provider.runImageJob(request, events, controller.signal)
    : provider.generateImage(request, controller.signal);
}

async function executeJob(job: ImageGenerationJob): Promise<void> {
  const store = useAssetStudioStore.getState();
  const providerConfig = getProvidersForCapability("image_generation")
    .find((provider) => provider.provider_id === job.recipe.provider?.providerId);
  const provider = providerConfig ? getImageProvider(providerConfig.provider_id) : undefined;
  const features = provider?.getFeatureSet?.() ?? job.recipe.provider?.features;
  const issues = validateAssetStudioRecipe(job.recipe, features);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (!providerConfig || !provider || !features) {
    store.updateJob(job.jobId, {
      status: "failed",
      progress: 0,
      phase: "模型不可用",
      error: { code: "missing_provider", message: "原任务使用的图像模型当前不可用。", recoverable: true },
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  if (errors.length > 0) {
    store.updateJob(job.jobId, {
      status: "failed",
      progress: 0,
      phase: "参数校验失败",
      error: { code: "validation", message: errors.map((item) => item.message).join("\n"), recoverable: true },
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const controller = new AbortController();
  controllers.set(job.jobId, controller);
  store.updateJob(job.jobId, {
    status: "running",
    progress: 0.02,
    phase: "准备生成",
    startedAt: new Date().toISOString(),
    error: undefined,
  });

  const maxPerRequest = Math.max(1, features.max_images_per_request);
  const chunks: number[] = [];
  for (let remaining = job.recipe.count; remaining > 0; remaining -= maxPerRequest) {
    chunks.push(Math.min(maxPerRequest, remaining));
  }
  const candidates: GeneratedAssetCandidate[] = [];
  const warnings: string[] = [];
  const failures: ImageGenerationJobError[] = [];
  let failedOutputCount = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    if (controller.signal.aborted) break;
    try {
      const result = await runProvider(
        provider,
        requestForRecipe(job.recipe, chunks[index]),
        job.jobId,
        index,
        chunks.length,
        controller,
      );
      candidates.push(...resultCandidates(result, job.recipe));
      warnings.push(...result.warnings);
    } catch (error) {
      if (controller.signal.aborted) break;
      failures.push(toJobError(error));
      failedOutputCount += chunks[index];
    }
  }

  controllers.delete(job.jobId);
  const current = useAssetStudioStore.getState().jobs.find((item) => item.jobId === job.jobId);
  if (controller.signal.aborted || current?.status === "cancelled") {
    useAssetStudioStore.getState().updateJob(job.jobId, {
      status: "cancelled",
      progress: 0,
      phase: "已取消",
      finishedAt: new Date().toISOString(),
    });
    return;
  }
  const status = failures.length === 0 ? "completed" : candidates.length > 0 ? "partial" : "failed";
  useAssetStudioStore.getState().updateJob(job.jobId, {
    status,
    progress: status === "failed" ? 0 : 1,
    phase: status === "completed" ? "生成完成" : status === "partial" ? "部分结果生成成功" : "生成失败",
    candidates,
    selectedCandidateIds: candidates.map((candidate) => candidate.image_id),
    warnings: Array.from(new Set(warnings)),
    error: failures[0],
    failedOutputCount,
    finishedAt: new Date().toISOString(),
  });
}

async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      const next = useAssetStudioStore.getState().jobs
        .filter((job) => job.status === "queued")
        .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt))[0];
      if (!next) break;
      useAssetStudioStore.getState().updateJob(next.jobId, { status: "validating", phase: "校验配方" });
      await executeJob(next);
    }
  } finally {
    pumping = false;
  }
}

export async function enqueueAssetStudioRecipe(
  projectId: string,
  recipe: ImageGenerationRecipeV1,
): Promise<string> {
  const stable = await stableRecipe(recipe);
  const jobId = `job_${nanoid(10)}`;
  useAssetStudioStore.getState().addJob({
    jobId,
    projectId,
    recipe: stable,
    status: "queued",
    progress: 0,
    phase: "等待生成",
    candidates: [],
    selectedCandidateIds: [],
    warnings: [],
    queuedAt: new Date().toISOString(),
    attempt: 1,
  });
  void pumpQueue();
  return jobId;
}

export function cancelAssetStudioJob(jobId: string): void {
  controllers.get(jobId)?.abort();
  useAssetStudioStore.getState().updateJob(jobId, {
    status: "cancelled",
    progress: 0,
    phase: "已取消",
    finishedAt: new Date().toISOString(),
  });
}

export async function retryAssetStudioJob(jobId: string): Promise<string | undefined> {
  const job = useAssetStudioStore.getState().jobs.find((item) => item.jobId === jobId);
  if (!job) return undefined;
  const nextId = await enqueueAssetStudioRecipe(job.projectId, {
    ...job.recipe,
    count: job.failedOutputCount && job.failedOutputCount > 0 ? job.failedOutputCount : job.recipe.count,
    recipeId: `recipe_${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  useAssetStudioStore.getState().updateJob(nextId, {
    attempt: job.attempt + 1,
    parentJobId: job.jobId,
  });
  return nextId;
}

export function moveQueuedAssetStudioJob(jobId: string, direction: -1 | 1): void {
  const queued = useAssetStudioStore.getState().jobs
    .filter((job) => job.status === "queued")
    .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  const index = queued.findIndex((job) => job.jobId === jobId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= queued.length) return;
  const current = queued[index];
  const target = queued[targetIndex];
  const currentQueuedAt = current.queuedAt;
  useAssetStudioStore.getState().updateJob(current.jobId, { queuedAt: target.queuedAt });
  useAssetStudioStore.getState().updateJob(target.jobId, { queuedAt: currentQueuedAt });
}

export function reorderQueuedAssetStudioJob(sourceJobId: string, targetJobId: string): void {
  const queued = useAssetStudioStore.getState().jobs
    .filter((job) => job.status === "queued")
    .sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  const sourceIndex = queued.findIndex((job) => job.jobId === sourceJobId);
  const targetIndex = queued.findIndex((job) => job.jobId === targetJobId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const [moved] = queued.splice(sourceIndex, 1);
  queued.splice(targetIndex, 0, moved);
  const start = Date.now();
  queued.forEach((job, index) => {
    useAssetStudioStore.getState().updateJob(job.jobId, {
      queuedAt: new Date(start + index).toISOString(),
    });
  });
}

export function resumeAssetStudioQueue(): void {
  void pumpQueue();
}
