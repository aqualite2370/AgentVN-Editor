import { builtInAnimationPresets } from "./animation/presets";
import { compileAnimationPreset } from "./animation/keyframeCompiler";
import { exportAnimationCommand } from "./animation/exportAnimationCommand";
import { initializeDefaultProviders } from "./providers/providerRegistry";
import { assertProviderCapability, validateGeneratedAssetRecord, validateImageGenerationRequest, validatePromptRewriteRequest, validateProviderConfig } from "./providers/validation";

export function runAdvancedEditorVerification(): string[] {
  const provider = initializeDefaultProviders()[0];
  const preset = builtInAnimationPresets[0];
  const command = exportAnimationCommand({ preset, target: "screen", blocking: true });
  const checks = [
    validateProviderConfig(provider).length === 0,
    (() => { assertProviderCapability(provider, provider.capabilities[0]); return true; })(),
    validatePromptRewriteRequest({ user_description: "背景", asset_type: "background", provider_id: provider.provider_id }).length === 0,
    validateImageGenerationRequest({ prompt: "背景", reference_images: [], asset_type: "background", aspect_ratio: "16:9", width: 1024, height: 576, count: 1, provider_id: provider.provider_id, model: provider.model, safety_level: "standard" }).length === 0,
    validateGeneratedAssetRecord({ asset_id: "asset", asset_type: "background", filename: "asset.png", mime_type: "image/png", source: "generated", created_at: new Date().toISOString() }).length === 0,
    compileAnimationPreset(preset).keyframes.length > 0,
    command.type === "animation",
  ];
  return checks.map((ok, index) => `advanced_check_${index}:${ok}`);
}
