import type { AssetType } from "../types/assets";

export type ProviderCapability =
  | "text_generation"
  | "image_generation"
  | "image_editing"
  | "vision_understanding"
  | "audio_generation"
  | "speech_to_text"
  | "text_to_speech"
  | "animation_planning"
  | "prompt_rewrite";

export type ApiKeyStorageMode = "none" | "session" | "local" | "local_encrypted" | "os_keychain" | "relay_account";
export type ProviderType = "openai_compatible" | "deepseek" | "gemini" | "local" | "relay" | "mock";
export type SafetyLevel = "low" | "standard" | "strict";

export interface ProviderModelParameters {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  structured_mode?: "auto" | "tools" | "json_object";
  request_timeout_seconds?: number;
  context_budget_tokens?: number;
  thinking_mode?: boolean;
  system_prompt?: string;
}

export interface ProviderConnection {
  connection_id: string;
  provider_type: ProviderType;
  display_name: string;
  base_url: string;
  api_key_storage: ApiKeyStorageMode;
  enabled: boolean;
  supports_model_discovery: boolean;
  created_at: string;
  updated_at: string;
}

export type StructuredCompatibilityState = "untested" | "passed" | "json_fallback" | "failed" | "stale";

export interface StructuredCompatibilityStatus {
  state: StructuredCompatibilityState;
  tested_at?: string;
  tested_model_id?: string;
  tested_base_url?: string;
  tested_structured_mode?: ProviderModelParameters["structured_mode"];
  tested_thinking_mode?: boolean;
  scene_schema_ok?: boolean;
  memory_schema_ok?: boolean;
  complex_schema_ok?: boolean;
  json_mode_ok?: boolean;
  tool_unsupported?: boolean;
  recommended_structured_mode?: ProviderModelParameters["structured_mode"];
  latency_ms?: number;
  summary?: string;
  diagnostics?: string[];
}

export interface ProviderModel {
  provider_id: string;
  connection_id: string;
  model_id: string;
  model_name: string;
  display_name: string;
  enabled: boolean;
  capabilities: ProviderCapability[];
  default_parameters: ProviderModelParameters;
  structured_compatibility?: StructuredCompatibilityStatus;
  created_at: string;
  updated_at: string;
}

export interface ProviderSelectionState {
  text_generation?: string;
  prompt_rewrite?: string;
  image_generation?: string;
}

export interface ProviderConfig {
  provider_id: string;
  connection_id: string;
  model_id: string;
  provider_type: ProviderType;
  display_name: string;
  connection_name: string;
  base_url?: string;
  model: string;
  api_key_storage: ApiKeyStorageMode;
  capabilities: ProviderCapability[];
  enabled: boolean;
  is_relay: boolean;
  pricing_hint?: string;
  safety_level: SafetyLevel;
  default_parameters: ProviderModelParameters;
}

export interface ProviderSelectionPayload {
  connection_id: string;
  model_id: string;
  base_url: string;
  api_key: string;
  parameters?: ProviderModelParameters;
}

export interface DiscoveredProviderModel {
  model_id: string;
  display_name: string;
}

export interface ProviderDiscoveryResult {
  ok: boolean;
  latency_ms: number;
  base_url: string;
  supports_model_discovery: boolean;
  models: DiscoveredProviderModel[];
  error_message?: string;
}

export interface RelayUsage {
  request_id: string;
  provider: string;
  model: string;
  input_units: number;
  output_units: number;
  estimated_cost?: number;
  created_at: string;
}

export interface ProviderTestResult {
  ok: boolean;
  latency_ms: number;
  provider_id: string;
  model: string;
  capabilities: ProviderCapability[];
  error_message?: string;
}

export interface ReferenceImage {
  image_id: string;
  source: "upload" | "project_asset" | "clipboard" | "sketch";
  blob_url: string;
  note?: string;
  weight: number;
  role?: "source" | "character" | "composition" | "style" | "color" | "mask";
}

export type ImageOperation =
  | "text_to_image"
  | "image_to_image"
  | "inpaint"
  | "outpaint"
  | "variation"
  | "upscale";

export interface ImageOutpaintInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ImageGenerationRequest {
  operation?: ImageOperation;
  prompt: string;
  negative_prompt?: string;
  reference_images: ReferenceImage[];
  source_image?: ReferenceImage;
  mask_image?: ReferenceImage;
  style_preset?: string;
  asset_type: AssetType | "cg" | "other";
  aspect_ratio: string;
  width: number;
  height: number;
  count: number;
  seed?: number;
  strength?: number;
  outpaint_insets?: ImageOutpaintInsets;
  upscale_factor?: 2 | 4;
  provider_id: string;
  model: string;
  safety_level: SafetyLevel;
  project_context?: string;
}

export interface GeneratedImage {
  image_id: string;
  blob_url: string;
  mime_type: string;
  width: number;
  height: number;
  seed?: number;
  metadata: Record<string, unknown>;
}

export interface ImageGenerationResult {
  result_id: string;
  provider_id: string;
  model: string;
  images: GeneratedImage[];
  revised_prompt?: string;
  usage?: RelayUsage;
  created_at: string;
  warnings: string[];
}

export interface PromptRewriteRequest {
  user_description: string;
  asset_type: AssetType | "cg" | "other";
  style_preset?: string;
  character_context?: string;
  scene_context?: string;
  negative_requirements?: string;
  provider_id: string;
}

export interface PromptRewriteResult {
  optimized_prompt: string;
  negative_prompt: string;
  style_notes: string;
  composition_notes: string;
}

export interface SavedGenerationProvenance {
  version: 1;
  operation: ImageOperation;
  provider_id?: string;
  model?: string;
  prompt: string;
  negative_prompt?: string;
  style_preset?: string;
  aspect_ratio: string;
  width: number;
  height: number;
  seed?: number;
  source_job_id?: string;
  local_steps?: string[];
}

export interface GeneratedAssetRecord {
  asset_id: string;
  asset_type: AssetType | "other";
  display_name?: string;
  filename: string;
  mime_type: string;
  source: "generated" | "imported" | "edited" | "bundled";
  provider_id?: string;
  model?: string;
  prompt?: string;
  created_at: string;
  license_note?: string;
  project_path?: string;
  blob_url?: string;
  generation?: SavedGenerationProvenance;
}

export interface StylePreset {
  style_id: string;
  name: string;
  description: string;
  prompt_suffix: string;
  negative_prompt: string;
  recommended_asset_types: Array<AssetType | "cg" | "other">;
}

export interface GenerationHistoryEntry {
  history_id: string;
  created_at: string;
  provider_id: string;
  model: string;
  request_type: "image_generation" | "prompt_rewrite" | "image_editing" | "vision";
  prompt_preview: string;
  result_asset_ids: string[];
  status: "success" | "failed" | "cancelled";
}

export interface ImageProviderFeatureSet {
  operations: ImageOperation[];
  supports_negative_prompt: boolean;
  supports_seed: boolean;
  supports_reference_roles: Array<NonNullable<ReferenceImage["role"]>>;
  supports_progress: boolean;
  supports_preview: boolean;
  max_images_per_request: number;
  dimension_mode: "exact" | "aspect_ratio";
  limitation_notes: string[];
}

export interface ImageJobEvents {
  onPhase?: (phase: string) => void;
  onProgress?: (progress: number) => void;
  onPreview?: (image: GeneratedImage) => void;
}

export interface LLMProvider {
  config: ProviderConfig;
  testConnection: () => Promise<ProviderTestResult>;
  rewritePrompt: (request: PromptRewriteRequest, signal?: AbortSignal) => Promise<PromptRewriteResult>;
  rewritePromptStream?: (
    request: PromptRewriteRequest,
    handlers: { onDelta?: (delta: string) => void; onFinal?: (result: PromptRewriteResult) => void },
    signal?: AbortSignal
  ) => Promise<PromptRewriteResult>;
}

export interface ImageProvider {
  config: ProviderConfig;
  testConnection: () => Promise<ProviderTestResult>;
  getFeatureSet?: () => ImageProviderFeatureSet;
  runImageJob?: (
    request: ImageGenerationRequest,
    events?: ImageJobEvents,
    signal?: AbortSignal
  ) => Promise<ImageGenerationResult>;
  /** @deprecated Use runImageJob for operation-aware generation. */
  generateImage: (request: ImageGenerationRequest, signal?: AbortSignal) => Promise<ImageGenerationResult>;
}
