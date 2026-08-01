import { nanoid } from "nanoid";
import { getApiKey } from "./apiKeyStorage";
import { createDefaultImageProvider, MockImageProvider, OpenAICompatibleImageProvider } from "./imageProviders";
import { createDefaultLLMProvider, MockLLMProvider } from "./llmProviders";
import { createDefaultModelParameters } from "./providerDefaults";
import { ProviderNotConfiguredError, UnsupportedCapabilityError } from "./providerErrors";
import type {
  ImageProvider,
  LLMProvider,
  ProviderCapability,
  ProviderConfig,
  ProviderConnection,
  ProviderModel,
  ProviderModelParameters,
  ProviderSelectionPayload,
  ProviderSelectionState,
} from "./types";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

const connectionStorageKey = "agentvn.providerConnections";
const modelStorageKey = "agentvn.providerModels";
const selectionStorageKey = "agentvn.providerSelections";
const maxSystemPromptLength = 8000;

const llmProviders = new Map<string, LLMProvider>();
const imageProviders = new Map<string, ImageProvider>();
let fallbackProviderConfigs: ProviderConfig[] | undefined;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    reportFrontendError("editor.provider-settings", error, {
      operation: "read-local-settings",
      key,
    });
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function defaultParameters(): ProviderModelParameters {
  return createDefaultModelParameters();
}

function normalizeParameters(parameters?: ProviderModelParameters): ProviderModelParameters {
  const next = { ...defaultParameters(), ...(parameters ?? {}) };
  const systemPrompt = typeof next.system_prompt === "string" ? next.system_prompt.slice(0, maxSystemPromptLength) : undefined;
  return {
    ...next,
    request_timeout_seconds: clampNumber(next.request_timeout_seconds, 300, 30, 900),
    context_budget_tokens: clampNumber(next.context_budget_tokens, 24000, 4000, 200000),
    thinking_mode: next.thinking_mode === true,
    system_prompt: systemPrompt,
  };
}

function buildMockProviders(): ProviderConfig[] {
  fallbackProviderConfigs ??= [createDefaultLLMProvider().config, createDefaultImageProvider().config];
  return fallbackProviderConfigs;
}

function sanitizeConnection(connection: ProviderConnection): ProviderConnection {
  const timestamp = connection.created_at || nowIso();
  return {
    connection_id: connection.connection_id || `conn_${nanoid(8)}`,
    provider_type: connection.provider_type ?? "openai_compatible",
    display_name: typeof connection.display_name === "string" ? connection.display_name : "",
    base_url: typeof connection.base_url === "string" && connection.base_url.trim() ? connection.base_url : "https://api.openai.com/v1",
    api_key_storage: connection.api_key_storage ?? "local",
    enabled: connection.enabled !== false,
    supports_model_discovery: Boolean(connection.supports_model_discovery),
    created_at: timestamp,
    updated_at: connection.updated_at || timestamp,
  };
}

function sanitizeModel(model: ProviderModel): ProviderModel {
  const timestamp = model.created_at || nowIso();
  const modelName = model.model_name || model.model_id || "";
  const parameters = normalizeParameters(model.default_parameters);
  return {
    provider_id: model.provider_id || `provider_${nanoid(8)}`,
    connection_id: model.connection_id,
    model_id: model.model_id || `model_${nanoid(6)}`,
    model_name: modelName,
    display_name: typeof model.display_name === "string" ? model.display_name : "",
    enabled: model.enabled !== false,
    capabilities: Array.isArray(model.capabilities) ? [...new Set(model.capabilities)] : [],
    default_parameters: parameters,
    structured_compatibility:
      model.structured_compatibility && typeof model.structured_compatibility === "object"
        ? { ...model.structured_compatibility }
        : undefined,
    created_at: timestamp,
    updated_at: model.updated_at || timestamp,
  };
}

function getConnectionLabel(connection: ProviderConnection): string {
  return connection.display_name.trim() || "Unnamed connection";
}

function getModelLabel(model: ProviderModel): string {
  return model.display_name.trim() || model.model_name || model.model_id || "Unnamed model";
}

function buildProviderConfig(connection: ProviderConnection, model: ProviderModel): ProviderConfig {
  return {
    provider_id: model.provider_id,
    connection_id: connection.connection_id,
    model_id: model.model_id,
    provider_type: connection.provider_type,
    display_name: getModelLabel(model),
    connection_name: getConnectionLabel(connection),
    base_url: connection.base_url,
    model: model.model_name,
    api_key_storage: connection.api_key_storage,
    capabilities: model.capabilities,
    enabled: connection.enabled && model.enabled,
    is_relay: false,
    pricing_hint: connection.provider_type === "mock" ? "Local fallback" : "OpenAI-compatible custom endpoint",
    safety_level: "standard",
    default_parameters: model.default_parameters,
  };
}

function saveProviderConnections(connections: ProviderConnection[]): void {
  saveJson(connectionStorageKey, connections);
}

function saveProviderModels(models: ProviderModel[]): void {
  saveJson(modelStorageKey, models);
}

function saveProviderSelections(selections: ProviderSelectionState): void {
  saveJson(selectionStorageKey, normalizeProviderSelections(selections));
}

export function listProviderConnections(): ProviderConnection[] {
  return loadJson<ProviderConnection[]>(connectionStorageKey, []).map(sanitizeConnection);
}

export function listProviderModels(connectionId?: string): ProviderModel[] {
  const models = loadJson<ProviderModel[]>(modelStorageKey, []).map(sanitizeModel);
  return connectionId ? models.filter((item) => item.connection_id === connectionId) : models;
}

export function listProviderSelections(): ProviderSelectionState {
  return normalizeProviderSelections(loadJson<ProviderSelectionState>(selectionStorageKey, {}));
}

function normalizeProviderSelections(selections: ProviderSelectionState): ProviderSelectionState {
  const next: ProviderSelectionState = { ...selections };
  if (!next.text_generation && next.prompt_rewrite) {
    next.text_generation = next.prompt_rewrite;
  }
  if (next.text_generation) {
    next.prompt_rewrite = next.text_generation;
  } else {
    delete next.prompt_rewrite;
  }
  return next;
}

function normalizeSelectionCapability(capability: keyof ProviderSelectionState): keyof ProviderSelectionState {
  return capability === "prompt_rewrite" ? "text_generation" : capability;
}

function providerSupportsSelectionCapability(config: ProviderConfig, capability: keyof ProviderSelectionState): boolean {
  if (capability === "prompt_rewrite") {
    return config.capabilities.includes("text_generation") || config.capabilities.includes("prompt_rewrite");
  }
  return config.capabilities.includes(capability);
}

function customProviderConfigs(): ProviderConfig[] {
  const connectionMap = new Map(listProviderConnections().map((item) => [item.connection_id, item]));
  return listProviderModels()
    .map((model) => {
      const connection = connectionMap.get(model.connection_id);
      return connection ? buildProviderConfig(connection, model) : undefined;
    })
    .filter((item): item is ProviderConfig => Boolean(item));
}

function syncRuntimeProviders(): void {
  llmProviders.clear();
  imageProviders.clear();
  for (const config of listProviderConfigs()) {
    if (config.capabilities.includes("image_generation")) {
      imageProviders.set(
        config.provider_id,
        config.provider_type === "mock" ? new MockImageProvider(config) : new OpenAICompatibleImageProvider(config)
      );
    }
    if (config.capabilities.includes("text_generation") || config.capabilities.includes("prompt_rewrite")) {
      llmProviders.set(config.provider_id, new MockLLMProvider(config));
    }
  }
}

export function hydrateProviderState(state: {
  provider_connections?: ProviderConnection[];
  provider_models?: ProviderModel[];
  provider_selections?: ProviderSelectionState;
}): void {
  saveProviderConnections(Array.isArray(state.provider_connections) ? state.provider_connections.map(sanitizeConnection) : []);
  saveProviderModels(Array.isArray(state.provider_models) ? state.provider_models.map(sanitizeModel) : []);
  saveProviderSelections(state.provider_selections && typeof state.provider_selections === "object" ? state.provider_selections : {});
  syncRuntimeProviders();
}

export function exportProviderState(): {
  provider_connections: ProviderConnection[];
  provider_models: ProviderModel[];
  provider_selections: ProviderSelectionState;
} {
  return {
    provider_connections: listProviderConnections(),
    provider_models: listProviderModels(),
    provider_selections: listProviderSelections(),
  };
}

export function listProviderConfigs(capability?: ProviderCapability): ProviderConfig[] {
  const custom = customProviderConfigs().filter((item) => item.enabled);
  const fallback = buildMockProviders();
  if (!capability) {
    if (custom.length === 0) return fallback;
    const covered = new Set(custom.flatMap((item) => item.capabilities));
    return [...custom, ...fallback.filter((item) => item.capabilities.some((next) => !covered.has(next)))];
  }
  const matches = custom.filter((item) => item.capabilities.includes(capability));
  return matches.length > 0 ? matches : fallback.filter((item) => item.capabilities.includes(capability));
}

export function initializeDefaultProviders(): ProviderConfig[] {
  const providers = listProviderConfigs();
  syncRuntimeProviders();
  return providers;
}

export function saveProviderConnection(
  connection: Omit<ProviderConnection, "created_at" | "updated_at"> & Partial<Pick<ProviderConnection, "created_at" | "updated_at">>
): ProviderConnection {
  const next = sanitizeConnection({ ...connection, created_at: connection.created_at || nowIso(), updated_at: nowIso() } as ProviderConnection);
  const connections = listProviderConnections();
  const existingIndex = connections.findIndex((item) => item.connection_id === next.connection_id);
  if (existingIndex >= 0) connections.splice(existingIndex, 1, next);
  else connections.unshift(next);
  saveProviderConnections(connections);
  syncRuntimeProviders();
  return next;
}

export function deleteProviderConnection(connectionId: string): void {
  saveProviderConnections(listProviderConnections().filter((item) => item.connection_id !== connectionId));
  saveProviderModels(listProviderModels().filter((item) => item.connection_id !== connectionId));
  const selections = listProviderSelections();
  const remainingModels = listProviderModels();
  for (const [capability, providerId] of Object.entries(selections)) {
    const model = remainingModels.find((item) => item.provider_id === providerId);
    if (!model || model.connection_id === connectionId) delete selections[capability as keyof ProviderSelectionState];
  }
  saveProviderSelections(selections);
  syncRuntimeProviders();
}

export function saveProviderModel(
  model: Omit<ProviderModel, "created_at" | "updated_at"> & Partial<Pick<ProviderModel, "created_at" | "updated_at">>
): ProviderModel {
  const next = sanitizeModel({ ...model, created_at: model.created_at || nowIso(), updated_at: nowIso() } as ProviderModel);
  const models = listProviderModels();
  const existingIndex = models.findIndex((item) => item.provider_id === next.provider_id);
  if (existingIndex >= 0) models.splice(existingIndex, 1, next);
  else models.unshift(next);
  saveProviderModels(models);
  syncRuntimeProviders();
  return next;
}

export function createProviderModel(connectionId: string, partial?: Partial<ProviderModel>): ProviderModel {
  const modelName = partial?.model_name || "";
  return saveProviderModel({
    provider_id: partial?.provider_id || `provider_${nanoid(8)}`,
    connection_id: connectionId,
    model_id: partial?.model_id || `model_${nanoid(6)}`,
    model_name: modelName,
    display_name: partial?.display_name || "",
    enabled: partial?.enabled ?? true,
    capabilities: partial?.capabilities ?? [],
    default_parameters: normalizeParameters(partial?.default_parameters ?? createDefaultModelParameters(modelName)),
    structured_compatibility: partial?.structured_compatibility,
  });
}

export function deleteProviderModel(providerId: string): void {
  saveProviderModels(listProviderModels().filter((item) => item.provider_id !== providerId));
  const selections = listProviderSelections();
  for (const [capability, selectedProviderId] of Object.entries(selections)) {
    if (selectedProviderId === providerId) delete selections[capability as keyof ProviderSelectionState];
  }
  saveProviderSelections(selections);
  syncRuntimeProviders();
}

export function setCapabilitySelection(capability: keyof ProviderSelectionState, providerId?: string): void {
  const selections = listProviderSelections();
  const normalizedCapability = normalizeSelectionCapability(capability);
  if (providerId) selections[normalizedCapability] = providerId;
  else delete selections[normalizedCapability];
  saveProviderSelections(selections);
}

export function getCapabilitySelection(capability: keyof ProviderSelectionState): string | undefined {
  return listProviderSelections()[normalizeSelectionCapability(capability)];
}

export function getProviderConfig(providerId: string): ProviderConfig | undefined {
  return initializeDefaultProviders().find((item) => item.provider_id === providerId);
}

export function getActiveProviderConfig(capability: keyof ProviderSelectionState): ProviderConfig | undefined {
  const normalizedCapability = normalizeSelectionCapability(capability);
  const candidates = initializeDefaultProviders().filter((item) => providerSupportsSelectionCapability(item, capability));
  const selectedId = getCapabilitySelection(normalizedCapability);
  return candidates.find((item) => item.provider_id === selectedId) ?? candidates[0];
}

export const getSelectedProviderConfig = getActiveProviderConfig;

interface ProviderSelectionPayloadOptions {
  allowFallbackWithKey?: boolean;
}

function toProviderSelectionPayload(config: ProviderConfig | undefined): ProviderSelectionPayload | undefined {
  if (!config || config.provider_type === "mock" || !config.base_url) return undefined;
  const apiKey = getApiKey(config.connection_id);
  if (!apiKey) return undefined;
  return {
    connection_id: config.connection_id,
    model_id: config.model_id,
    base_url: config.base_url,
    api_key: apiKey,
    parameters: config.default_parameters,
  };
}

export function getProviderSelectionPayload(
  capability: keyof ProviderSelectionState,
  options: ProviderSelectionPayloadOptions = {}
): ProviderSelectionPayload | undefined {
  const activePayload = toProviderSelectionPayload(getActiveProviderConfig(capability));
  if (activePayload || !options.allowFallbackWithKey) return activePayload;
  return initializeDefaultProviders()
    .filter((item) => item.enabled && item.capabilities.includes(capability))
    .map((item) => toProviderSelectionPayload(item))
    .find((payload): payload is ProviderSelectionPayload => Boolean(payload));
}

export function getProvidersForCapability(capability: ProviderCapability): ProviderConfig[] {
  return initializeDefaultProviders().filter((item) => item.capabilities.includes(capability));
}

export function upsertProvider(config: ProviderConfig): void {
  const existingConnection = listProviderConnections().find((item) => item.connection_id === config.connection_id);
  const existingModel = listProviderModels().find((item) => item.provider_id === config.provider_id);
  saveProviderConnection({
    connection_id: config.connection_id,
    provider_type: config.provider_type,
    display_name: config.connection_name,
    base_url: config.base_url ?? "https://api.openai.com/v1",
    api_key_storage: config.api_key_storage,
    enabled: true,
    supports_model_discovery: false,
    created_at: existingConnection?.created_at,
  });
  saveProviderModel({
    provider_id: config.provider_id,
    connection_id: config.connection_id,
    model_id: config.model_id,
    model_name: config.model,
    display_name: config.display_name,
    enabled: config.enabled,
    capabilities: config.capabilities,
    default_parameters: config.default_parameters,
    structured_compatibility: existingModel?.structured_compatibility,
  });
}

export function getImageProvider(providerId: string): ImageProvider {
  syncRuntimeProviders();
  const provider = imageProviders.get(providerId);
  if (!provider || !provider.config.enabled) throw new ProviderNotConfiguredError("Image provider not configured");
  return provider;
}

export function getLLMProvider(providerId: string): LLMProvider {
  syncRuntimeProviders();
  const provider = llmProviders.get(providerId);
  if (!provider || !provider.config.enabled) throw new ProviderNotConfiguredError("LLM provider not configured");
  return provider;
}

export function assertCapability(config: ProviderConfig, capability: ProviderCapability): void {
  if (!config.capabilities.includes(capability)) throw new UnsupportedCapabilityError(`${capability} unsupported`);
}
