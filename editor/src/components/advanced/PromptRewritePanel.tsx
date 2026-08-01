import { useState } from "react";
import type { AssetGenerationDraft } from "../../asset-generation/session";
import { humanizeProviderError } from "../../providers/providerErrors";
import { getLLMProvider, getSelectedProviderConfig } from "../../providers/providerRegistry";
import type { PromptRewriteResult } from "../../providers/types";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

export function PromptRewritePanel({
  assetType,
  stylePreset,
  onUsePrompt,
}: {
  assetType: AssetGenerationDraft["assetType"];
  stylePreset?: string;
  onUsePrompt: (prompt: string, negative: string) => void;
}) {
  const [description, setDescription] = useState("雨夜旧车站背景，视觉小说风格");
  const [result, setResult] = useState<PromptRewriteResult | undefined>();
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);

  async function rewrite() {
    setLoading(true);
    setStreamText("");
    try {
      const provider = getSelectedProviderConfig("prompt_rewrite") ?? getSelectedProviderConfig("text_generation");
      if (!provider) {
        setError("请先在“模型连接”里为提示词优化或文本生成指定一个可用模型。");
        return;
      }
      const llmProvider = getLLMProvider(provider.provider_id);
      const request = {
        user_description: description,
        asset_type: assetType,
        style_preset: stylePreset,
        provider_id: provider.provider_id,
      } as const;
      const next = "rewritePromptStream" in llmProvider && typeof llmProvider.rewritePromptStream === "function"
        ? await llmProvider.rewritePromptStream(request, {
            onDelta: (delta: string) => setStreamText((current) => `${current}${delta}`),
          })
        : await llmProvider.rewritePrompt(request);
      setResult(next);
      setError("");
    } catch (err) {
      reportFrontendError("editor.prompt-rewrite", err, { operation: "rewrite" });
      setError(humanizeProviderError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="advanced-card">
      <h3>提示词优化</h3>
      <textarea value={description} data-help-key="asset.prompt" onChange={(event) => setDescription(event.target.value)} />
      <button type="button" disabled={loading} data-help-key="asset.rewrite" onClick={rewrite}>{loading ? "优化中..." : "优化提示词"}</button>
      {error && <p className="inline-error">{error}</p>}
      {loading && streamText && (
        <div className="advanced-result">
          <p>{streamText}</p>
        </div>
      )}
      {result && (
        <div className="advanced-result">
          <p>{result.optimized_prompt}</p>
          <small>反向提示：{result.negative_prompt}</small>
          <button type="button" data-help-key="asset.useRewrite" onClick={() => onUsePrompt(result.optimized_prompt, result.negative_prompt)}>使用结果</button>
        </div>
      )}
    </section>
  );
}
