import { nanoid } from "nanoid";
import type {
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageJobEvents,
  ImageProvider,
  ImageProviderFeatureSet,
  ProviderConfig,
  ProviderTestResult,
} from "./types";
import { getApiKey } from "./apiKeyStorage";
import { MissingApiKeyError, ProviderNetworkError, ProviderRateLimitedError, ProviderSafetyBlockedError, UnsupportedCapabilityError } from "./providerErrors";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

function createSvgDataUrl(prompt: string, width: number, height: number, index: number): string {
  const safePrompt = prompt.slice(0, 120).replace(/[<>&]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#6aa7ff"/><stop offset="1" stop-color="#f2a0c4"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="18" fill="rgba(8,17,31,.42)" stroke="rgba(255,255,255,.55)"/>
    <text x="50%" y="45%" text-anchor="middle" fill="white" font-family="Segoe UI, sans-serif" font-size="28">预览图 ${index + 1}</text>
    <text x="50%" y="55%" text-anchor="middle" fill="white" font-family="Segoe UI, sans-serif" font-size="16">${safePrompt}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class MockImageProvider implements ImageProvider {
  config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async testConnection(): Promise<ProviderTestResult> {
    const start = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    return {
      ok: true,
      latency_ms: Math.round(performance.now() - start),
      provider_id: this.config.provider_id,
      model: this.config.model,
      capabilities: this.config.capabilities,
    };
  }

  getFeatureSet(): ImageProviderFeatureSet {
    return {
      operations: ["text_to_image", "image_to_image", "inpaint", "outpaint", "variation", "upscale"],
      supports_negative_prompt: true,
      supports_seed: true,
      supports_reference_roles: ["source", "character", "composition", "style", "color", "mask"],
      supports_progress: true,
      supports_preview: false,
      max_images_per_request: 8,
      dimension_mode: "exact",
      limitation_notes: ["本地占位模型用于验证完整工作流，不代表最终图像质量。"],
    };
  }

  async runImageJob(
    request: ImageGenerationRequest,
    events?: ImageJobEvents,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    events?.onPhase?.("正在准备本地预览");
    events?.onProgress?.(0.12);
    const result = await this.generateImage(request, signal);
    events?.onProgress?.(1);
    events?.onPhase?.("生成完成");
    return result;
  }

  async generateImage(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    if (!this.config.capabilities.includes("image_generation")) throw new UnsupportedCapabilityError("image_generation unsupported");
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, 550);
      signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    return {
      result_id: `result_${nanoid(8)}`,
      provider_id: this.config.provider_id,
      model: request.model,
      images: Array.from({ length: request.count }, (_, index) => ({
        image_id: `img_${nanoid(8)}`,
        blob_url: createSvgDataUrl(request.prompt, request.width, request.height, index),
        mime_type: "image/svg+xml",
        width: request.width,
        height: request.height,
        seed: request.seed,
        metadata: {
          mock: true,
          asset_type: request.asset_type,
          operation: request.operation ?? "text_to_image",
        },
      })),
      revised_prompt: request.prompt,
      created_at: new Date().toISOString(),
      warnings: ["当前使用的是本地占位图像生成器，结果仅用于界面流程预览。"],
    };
  }
}

type OpenAIImageItem = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

type GeminiPredictImage = {
  bytesBase64Encoded?: string;
  mimeType?: string;
  image?: {
    bytesBase64Encoded?: string;
    imageBytes?: string;
    mimeType?: string;
  };
};

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => {
    // error-log-ignore: 无法读取错误正文时仍使用状态码生成错误说明。
    return "";
  });
  if (!text) return `${response.status} ${response.statusText}`.trim();
  try {
    const data = JSON.parse(text) as { error?: { message?: string }; message?: string; detail?: string };
    return data.error?.message || data.message || data.detail || text;
  } catch {
    // error-log-ignore: 非 JSON 错误正文会原样展示，网络失败由请求层记录。
    return text;
  }
}

function toImageDataUrl(base64: string, mimeType = "image/png"): string {
  return `data:${mimeType};base64,${base64}`;
}

function openAIImageUrl(baseUrl: string): string {
  const trimmed = trimBaseUrl(baseUrl);
  return `${trimmed}/images/generations`;
}

function geminiPredictUrl(baseUrl: string, model: string): string {
  const trimmed = trimBaseUrl(baseUrl);
  const apiRoot = trimmed.includes("/models/")
    ? trimmed.slice(0, trimmed.indexOf("/models/"))
    : trimmed.replace(/\/openai\/?$/, "").replace(/\/v1\/?$/, "/v1beta").replace(/\/v1beta\/?$/, "/v1beta");
  return `${apiRoot}/models/${encodeURIComponent(model)}:predict`;
}

function shouldUseGeminiPredict(config: ProviderConfig): boolean {
  const baseUrl = config.base_url ?? "";
  return baseUrl.includes("generativelanguage.googleapis.com") && !/\/openai\/?$/.test(trimBaseUrl(baseUrl));
}

function unsupportedInputWarnings(request: ImageGenerationRequest, mode: "openai" | "gemini"): string[] {
  const warnings: string[] = [];
  if (request.reference_images.length > 0) {
    warnings.push(mode === "gemini"
      ? "Gemini Imagen adapter 当前不传递参考图，已仅使用文本提示词生成。"
      : "OpenAI-compatible image adapter 当前不传递参考图，已仅使用文本提示词生成。");
  }
  if (request.negative_prompt?.trim()) {
    warnings.push(mode === "gemini"
      ? "Gemini Imagen adapter 当前不传递反向提示词，已在生成请求中忽略该字段。"
      : "OpenAI-compatible image adapter 当前不传递反向提示词，已在生成请求中忽略该字段。");
  }
  if (mode === "gemini" && request.width > 0 && request.height > 0) {
    warnings.push("Gemini Imagen adapter 使用 aspectRatio 参数，不保证精确宽高输出；保存时会记录编辑器期望尺寸。");
  }
  return warnings;
}

async function imageSourceToBlob(source: string, fallbackMimeType = "image/png"): Promise<Blob> {
  if (source.startsWith("data:") || source.startsWith("blob:") || /^https?:/i.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new ProviderNetworkError(`无法读取编辑来源图片：${response.status}`);
    const blob = await response.blob();
    return blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: fallbackMimeType });
  }
  throw new ProviderNetworkError("编辑来源图片格式不受支持。");
}

export class OpenAICompatibleImageProvider implements ImageProvider {
  config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  getFeatureSet(): ImageProviderFeatureSet {
    if (shouldUseGeminiPredict(this.config)) {
      return {
        operations: ["text_to_image"],
        supports_negative_prompt: false,
        supports_seed: false,
        supports_reference_roles: [],
        supports_progress: false,
        supports_preview: false,
        max_images_per_request: 4,
        dimension_mode: "aspect_ratio",
        limitation_notes: [
          "当前 Gemini Imagen 适配器只传递文本提示词与画幅比例。",
          "精确宽高、反向提示词、种子和参考图不会发送，因此工作台会提前阻止这些组合。",
        ],
      };
    }
    const supportsEditing = this.config.capabilities.includes("image_editing");
    return {
      operations: supportsEditing
        ? ["text_to_image", "image_to_image", "inpaint", "outpaint", "variation"]
        : ["text_to_image"],
      supports_negative_prompt: false,
      supports_seed: false,
      supports_reference_roles: supportsEditing ? ["source", "mask"] : [],
      supports_progress: false,
      supports_preview: false,
      max_images_per_request: 4,
      dimension_mode: "exact",
      limitation_notes: supportsEditing
        ? ["编辑请求使用 OpenAI-compatible `/images/edits` 或 `/images/variations` 端点。"]
        : ["当前连接未声明图像编辑能力，只开放文生图。"],
    };
  }

  async testConnection(signal?: AbortSignal): Promise<ProviderTestResult> {
    const start = performance.now();
    try {
      const apiKey = getApiKey(this.config.connection_id);
      if (!apiKey) throw new MissingApiKeyError("Missing API key for image provider.");
      const response = await fetch(`${trimBaseUrl(this.config.base_url ?? "")}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      });
      return {
        ok: response.ok,
        latency_ms: Math.round(performance.now() - start),
        provider_id: this.config.provider_id,
        model: this.config.model,
        capabilities: this.config.capabilities,
        error_message: response.ok ? undefined : await readErrorMessage(response),
      };
    } catch (error) {
      reportFrontendError("editor.image-provider", error, {
        operation: "test-connection",
        providerId: this.config.provider_id,
        model: this.config.model,
      });
      return {
        ok: false,
        latency_ms: Math.round(performance.now() - start),
        provider_id: this.config.provider_id,
        model: this.config.model,
        capabilities: this.config.capabilities,
        error_message: error instanceof Error ? error.message : "图像服务连接失败。",
      };
    }
  }

  async runImageJob(
    request: ImageGenerationRequest,
    events?: ImageJobEvents,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const operation = request.operation ?? "text_to_image";
    const features = this.getFeatureSet();
    if (!features.operations.includes(operation)) {
      throw new UnsupportedCapabilityError(`当前模型不支持“${operation}”操作。`);
    }
    events?.onPhase?.("正在连接图像模型");
    events?.onProgress?.(0.08);
    if (operation === "text_to_image") {
      const result = await this.generateImage(request, signal);
      events?.onProgress?.(1);
      return result;
    }
    const result = operation === "variation"
      ? await this.generateWithOpenAIVariations(request, signal)
      : await this.generateWithOpenAIEdits(request, signal);
    events?.onProgress?.(1);
    return result;
  }

  async generateImage(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    if (!this.config.capabilities.includes("image_generation")) throw new UnsupportedCapabilityError("image_generation unsupported");
    const apiKey = getApiKey(this.config.connection_id);
    if (!apiKey) throw new MissingApiKeyError("Missing API key for image provider.");
    if (!this.config.base_url) throw new ProviderNetworkError("Image provider base URL is empty.");

    return shouldUseGeminiPredict(this.config)
      ? this.generateWithGeminiPredict(request, apiKey, signal)
      : this.generateWithOpenAIImages(request, apiKey, signal);
  }

  private async generateWithOpenAIEdits(
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const apiKey = getApiKey(this.config.connection_id);
    if (!apiKey) throw new MissingApiKeyError("Missing API key for image provider.");
    if (!this.config.base_url) throw new ProviderNetworkError("Image provider base URL is empty.");
    const source = request.source_image ?? request.reference_images.find((image) => image.role === "source") ?? request.reference_images[0];
    if (!source) throw new ProviderNetworkError("图像编辑需要一张来源图片。");
    const form = new FormData();
    form.append("model", request.model);
    form.append("prompt", request.prompt);
    form.append("n", String(Math.min(Math.max(request.count, 1), 4)));
    form.append("size", `${request.width}x${request.height}`);
    form.append("image", await imageSourceToBlob(source.blob_url), "source.png");
    if (request.mask_image) {
      form.append("mask", await imageSourceToBlob(request.mask_image.blob_url), "mask.png");
    }
    const response = await fetch(`${trimBaseUrl(this.config.base_url)}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    if (!response.ok) throw await this.toProviderError(response);
    return this.imageItemsToResult(
      await response.json() as { data?: OpenAIImageItem[]; revised_prompt?: string },
      request,
      "openai_compatible_image_edit",
    );
  }

  private async generateWithOpenAIVariations(
    request: ImageGenerationRequest,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const apiKey = getApiKey(this.config.connection_id);
    if (!apiKey) throw new MissingApiKeyError("Missing API key for image provider.");
    if (!this.config.base_url) throw new ProviderNetworkError("Image provider base URL is empty.");
    const source = request.source_image ?? request.reference_images.find((image) => image.role === "source") ?? request.reference_images[0];
    if (!source) throw new ProviderNetworkError("制作变体需要一张来源图片。");
    const form = new FormData();
    form.append("model", request.model);
    form.append("n", String(Math.min(Math.max(request.count, 1), 4)));
    form.append("size", `${request.width}x${request.height}`);
    form.append("image", await imageSourceToBlob(source.blob_url), "source.png");
    const response = await fetch(`${trimBaseUrl(this.config.base_url)}/images/variations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
    if (!response.ok) throw await this.toProviderError(response);
    return this.imageItemsToResult(
      await response.json() as { data?: OpenAIImageItem[]; revised_prompt?: string },
      request,
      "openai_compatible_image_variation",
    );
  }

  private imageItemsToResult(
    payload: { data?: OpenAIImageItem[]; revised_prompt?: string },
    request: ImageGenerationRequest,
    source: string,
  ): ImageGenerationResult {
    const items = payload.data ?? [];
    if (items.length === 0) throw new ProviderNetworkError("Image provider returned no images.");
    return {
      result_id: `result_${nanoid(8)}`,
      provider_id: this.config.provider_id,
      model: request.model,
      images: items.map((item, index) => ({
        image_id: `img_${nanoid(8)}`,
        blob_url: item.b64_json ? toImageDataUrl(item.b64_json) : item.url ?? "",
        mime_type: item.b64_json ? "image/png" : "image/url",
        width: request.width,
        height: request.height,
        seed: request.seed,
        metadata: { source, asset_type: request.asset_type, operation: request.operation, index },
      })),
      revised_prompt: payload.revised_prompt ?? items.find((item) => item.revised_prompt)?.revised_prompt ?? request.prompt,
      created_at: new Date().toISOString(),
      warnings: [],
    };
  }

  private async generateWithOpenAIImages(request: ImageGenerationRequest, apiKey: string, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const response = await fetch(openAIImageUrl(this.config.base_url ?? ""), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        n: Math.min(Math.max(request.count, 1), 4),
        size: `${request.width}x${request.height}`,
        response_format: "b64_json",
      }),
      signal,
    });
    if (!response.ok) throw await this.toProviderError(response);
    const payload = (await response.json()) as { data?: OpenAIImageItem[]; revised_prompt?: string };
    const items = payload.data ?? [];
    if (items.length === 0) throw new ProviderNetworkError("Image provider returned no images.");
    return {
      result_id: `result_${nanoid(8)}`,
      provider_id: this.config.provider_id,
      model: request.model,
      images: items.map((item, index) => ({
        image_id: `img_${nanoid(8)}`,
        blob_url: item.b64_json ? toImageDataUrl(item.b64_json) : item.url ?? "",
        mime_type: item.b64_json ? "image/png" : "image/url",
        width: request.width,
        height: request.height,
        seed: request.seed,
        metadata: {
          source: "openai_compatible_image_api",
          asset_type: request.asset_type,
          index,
        },
      })),
      revised_prompt: payload.revised_prompt ?? items.find((item) => item.revised_prompt)?.revised_prompt ?? request.prompt,
      created_at: new Date().toISOString(),
      warnings: unsupportedInputWarnings(request, "openai"),
    };
  }

  private async generateWithGeminiPredict(request: ImageGenerationRequest, apiKey: string, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const response = await fetch(geminiPredictUrl(this.config.base_url ?? "", request.model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        instances: [{ prompt: request.prompt }],
        parameters: {
          sampleCount: Math.min(Math.max(request.count, 1), 4),
          aspectRatio: request.aspect_ratio || "16:9",
        },
      }),
      signal,
    });
    if (!response.ok) throw await this.toProviderError(response);
    const payload = (await response.json()) as {
      predictions?: GeminiPredictImage[];
      generatedImages?: GeminiPredictImage[];
    };
    const items = payload.predictions ?? payload.generatedImages ?? [];
    if (items.length === 0) throw new ProviderNetworkError("Gemini Imagen returned no images.");
    return {
      result_id: `result_${nanoid(8)}`,
      provider_id: this.config.provider_id,
      model: request.model,
      images: items.map((item, index) => {
        const image = item.image ?? {};
        const base64 = item.bytesBase64Encoded ?? image.bytesBase64Encoded ?? image.imageBytes ?? "";
        const mimeType = item.mimeType ?? image.mimeType ?? "image/png";
        return {
          image_id: `img_${nanoid(8)}`,
          blob_url: toImageDataUrl(base64, mimeType),
          mime_type: mimeType,
          width: request.width,
          height: request.height,
          seed: request.seed,
          metadata: {
            source: "gemini_imagen_predict_api",
            asset_type: request.asset_type,
            index,
          },
        };
      }),
      revised_prompt: request.prompt,
      created_at: new Date().toISOString(),
      warnings: unsupportedInputWarnings(request, "gemini"),
    };
  }

  private async toProviderError(response: Response): Promise<Error> {
    const message = await readErrorMessage(response);
    if (response.status === 401 || response.status === 403) return new MissingApiKeyError(message);
    if (response.status === 429) return new ProviderRateLimitedError(`Image provider rate limited: ${message}`);
    if (response.status === 400 && /safety|policy|blocked/i.test(message)) return new ProviderSafetyBlockedError(message);
    return new ProviderNetworkError(`Image provider request failed ${response.status}: ${message}`);
  }
}

export function createDefaultImageProvider(): MockImageProvider {
  return new MockImageProvider({
    provider_id: `mock_image_${nanoid(5)}`,
    connection_id: "mock_connection_image",
    model_id: "mock-image-model",
    provider_type: "mock",
    display_name: "本地占位图像生成器",
    connection_name: "本地占位连接",
    model: "占位图像模型",
    api_key_storage: "none",
    capabilities: ["image_generation", "image_editing", "vision_understanding"],
    enabled: true,
    is_relay: false,
    pricing_hint: "本地免费占位",
    safety_level: "standard",
    default_parameters: { temperature: 0.7, top_p: 1, max_tokens: 1200 },
  });
}
