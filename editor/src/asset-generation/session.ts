import type { AssetType } from "../types/assets";
import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProvider,
  ProviderConfig,
  ReferenceImage,
} from "../providers/types";
import { humanizeProviderError } from "../providers/providerErrors";
import { validateImageGenerationRequest } from "../providers/validation";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export type AssetGenerationIssueSeverity = "error" | "warning";

export interface AssetGenerationIssue {
  code: string;
  severity: AssetGenerationIssueSeverity;
  message: string;
  path?: string;
}

export interface AssetGenerationDraft {
  prompt: string;
  negativePrompt?: string;
  referenceImages: ReferenceImage[];
  stylePreset?: string;
  assetType: AssetType | "cg" | "other";
  aspectRatio?: string;
  width?: number;
  height?: number;
  count?: number;
  seed?: number;
  projectContext?: string;
  providerId?: string;
}

export interface GeneratedAssetCandidate extends GeneratedImage {
  resultId: string;
  providerId: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
  warnings: string[];
  issues: AssetGenerationIssue[];
  canSave: boolean;
  saveBlockedReason?: string;
}

export interface AssetGenerationSessionState {
  status: "idle" | "validating" | "generating" | "completed" | "failed" | "cancelled";
  draft: AssetGenerationDraft;
  candidates: GeneratedAssetCandidate[];
  issues: AssetGenerationIssue[];
  warnings: string[];
  error?: string;
  resultId?: string;
  providerId?: string;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface AssetGenerationRunInput {
  draft: AssetGenerationDraft;
  provider?: ProviderConfig;
  imageProvider: Pick<ImageProvider, "generateImage">;
  signal?: AbortSignal;
  now?: () => string;
}

type ImageSizeDefaults = {
  aspectRatio: string;
  width: number;
  height: number;
};

export function defaultImageSizeForAssetType(assetType: AssetGenerationDraft["assetType"]): ImageSizeDefaults {
  if (assetType === "sprite" || assetType === "portrait") {
    return { aspectRatio: "3:4", width: 768, height: 1024 };
  }
  if (assetType === "ui") {
    return { aspectRatio: "1:1", width: 1024, height: 1024 };
  }
  return { aspectRatio: "16:9", width: 1024, height: 576 };
}

function issue(code: string, severity: AssetGenerationIssueSeverity, message: string, path?: string): AssetGenerationIssue {
  return { code, severity, message, path };
}

function normalizedCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 2;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function buildImageGenerationRequest(
  draft: AssetGenerationDraft,
  provider?: ProviderConfig,
): { ok: true; request: ImageGenerationRequest; issues: AssetGenerationIssue[] } | { ok: false; issues: AssetGenerationIssue[] } {
  const defaults = defaultImageSizeForAssetType(draft.assetType);
  const count = normalizedCount(draft.count);
  const issues: AssetGenerationIssue[] = [];
  const prompt = draft.prompt.trim();
  if (!prompt) issues.push(issue("missing_prompt", "error", "请先填写素材图生成提示词。", "prompt"));
  if (!provider) issues.push(issue("missing_provider", "error", "请先选择一个可用的素材图生成模型。", "providerId"));
  if (count < 1 || count > 8) issues.push(issue("invalid_count", "error", "生成数量必须在 1 到 8 之间。", "count"));

  if (!provider || issues.some((item) => item.severity === "error")) return { ok: false, issues };

  const request: ImageGenerationRequest = {
    prompt,
    negative_prompt: draft.negativePrompt?.trim() || undefined,
    reference_images: draft.referenceImages,
    style_preset: draft.stylePreset?.trim() || undefined,
    asset_type: draft.assetType,
    aspect_ratio: draft.aspectRatio || defaults.aspectRatio,
    width: draft.width ?? defaults.width,
    height: draft.height ?? defaults.height,
    count,
    seed: draft.seed,
    provider_id: provider.provider_id,
    model: provider.model,
    safety_level: provider.safety_level,
    project_context: draft.projectContext?.trim() || undefined,
  };
  for (const message of validateImageGenerationRequest(request)) {
    issues.push(issue("invalid_request", "error", message));
  }
  return issues.some((item) => item.severity === "error") ? { ok: false, issues } : { ok: true, request, issues };
}

function issuesForImage(image: GeneratedImage): AssetGenerationIssue[] {
  const issues: AssetGenerationIssue[] = [];
  if (!image.blob_url?.trim()) {
    issues.push(issue("missing_image_data", "error", "图片生成结果没有返回可保存的数据。", "blob_url"));
  }
  if (image.mime_type === "image/url") {
    issues.push(issue("remote_image_requires_conversion", "warning", "远程图片保存前会尝试转换为可导出的 data_url。", "blob_url"));
  }
  if (image.blob_url?.startsWith("blob:")) {
    issues.push(issue("temporary_blob_requires_conversion", "warning", "临时图片地址保存前会转换为可导出的 data_url。", "blob_url"));
  }
  return issues;
}

export function normalizeImageGenerationResult(
  result: ImageGenerationResult,
  draft: AssetGenerationDraft,
): GeneratedAssetCandidate[] {
  return result.images.map((image) => {
    const candidateIssues = issuesForImage(image);
    const saveBlocker = candidateIssues.find((item) => item.severity === "error");
    return {
      ...image,
      resultId: result.result_id,
      providerId: result.provider_id,
      model: result.model,
      prompt: draft.prompt.trim(),
      revisedPrompt: result.revised_prompt,
      warnings: result.warnings,
      issues: candidateIssues,
      canSave: !saveBlocker,
      saveBlockedReason: saveBlocker?.message,
    };
  });
}

export async function runAssetGenerationSession(input: AssetGenerationRunInput): Promise<AssetGenerationSessionState> {
  const now = input.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const built = buildImageGenerationRequest(input.draft, input.provider);
  if (!built.ok) {
    return {
      status: "failed",
      draft: input.draft,
      candidates: [],
      issues: built.issues,
      warnings: [],
      error: built.issues.find((item) => item.severity === "error")?.message,
      startedAt,
      finishedAt: now(),
    };
  }

  try {
    const result = await input.imageProvider.generateImage(built.request, input.signal);
    return {
      status: "completed",
      draft: input.draft,
      candidates: normalizeImageGenerationResult(result, input.draft),
      issues: built.issues,
      warnings: result.warnings,
      resultId: result.result_id,
      providerId: result.provider_id,
      model: result.model,
      startedAt,
      finishedAt: now(),
    };
  } catch (error) {
    const cancelled = isAbortError(error);
    if (!cancelled) reportFrontendError("editor.asset-generation", error, { operation: "generate" });
    return {
      status: cancelled ? "cancelled" : "failed",
      draft: input.draft,
      candidates: [],
      issues: cancelled ? [] : [issue("provider_error", "error", humanizeProviderError(error))],
      warnings: [],
      error: cancelled ? "已取消生成请求。" : humanizeProviderError(error),
      startedAt,
      finishedAt: now(),
    };
  }
}
