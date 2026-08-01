import { nanoid } from "nanoid";
import { createDefaultModelParameters } from "./providerDefaults";
import type { LLMProvider, PromptRewriteRequest, PromptRewriteResult, ProviderConfig, ProviderTestResult } from "./types";
import { UnsupportedCapabilityError } from "./providerErrors";

export class MockLLMProvider implements LLMProvider {
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

  async rewritePrompt(request: PromptRewriteRequest, signal?: AbortSignal): Promise<PromptRewriteResult> {
    if (!this.config.capabilities.includes("text_generation") && !this.config.capabilities.includes("prompt_rewrite")) {
      throw new UnsupportedCapabilityError("text_generation unsupported");
    }
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(resolve, 180);
      signal?.addEventListener("abort", () => {
        window.clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
    const style = request.style_preset ? `，风格参考：${request.style_preset}` : "";
    return {
      optimized_prompt: `${request.user_description}${style}，视觉小说素材，构图清晰，光影有层次，主体明确。`,
      negative_prompt: request.negative_requirements || "低质量、模糊、结构变形、不可读文字",
      style_notes: "保持视觉小说素材的可读性，避免过度复杂背景。",
      composition_notes: `面向 ${request.asset_type} 的中心构图，主体与 UI 安全区域分离。`,
    };
  }

  async rewritePromptStream(
    request: PromptRewriteRequest,
    handlers: { onDelta?: (delta: string) => void; onFinal?: (result: PromptRewriteResult) => void },
    signal?: AbortSignal
  ): Promise<PromptRewriteResult> {
    const result = await this.rewritePrompt(request, signal);
    handlers.onDelta?.("");
    for (const part of result.optimized_prompt.match(/.{1,8}/g) ?? []) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise((resolve) => window.setTimeout(resolve, 24));
      handlers.onDelta?.(part);
    }
    handlers.onFinal?.(result);
    return result;
  }
}

export function createDefaultLLMProvider(): MockLLMProvider {
  return new MockLLMProvider({
    provider_id: `mock_llm_${nanoid(5)}`,
    connection_id: "mock_connection_llm",
    model_id: "mock-llm-model",
    provider_type: "mock",
    display_name: "本地占位提示词助手",
    connection_name: "本地占位连接",
    model: "占位改写模型",
    api_key_storage: "none",
    capabilities: ["text_generation"],
    enabled: true,
    is_relay: false,
    safety_level: "standard",
    default_parameters: createDefaultModelParameters(),
  });
}
