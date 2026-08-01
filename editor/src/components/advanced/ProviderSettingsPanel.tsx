import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { backendClient } from "../../api/backendClient";
import type { TestProviderConnectionResponse } from "../../api/types";
import { clearApiKey, getApiKey, getPersistedApiKeys, saveApiKey } from "../../providers/apiKeyStorage";
import {
  createProviderModel,
  deleteProviderConnection,
  deleteProviderModel,
  exportProviderState,
  getCapabilitySelection,
  getProvidersForCapability,
  initializeDefaultProviders,
  listProviderSelections,
  listProviderConnections,
  listProviderModels,
  saveProviderConnection,
  saveProviderModel,
  setCapabilitySelection,
} from "../../providers/providerRegistry";
import { createDefaultModelParameters, getModelParameterProfile } from "../../providers/providerDefaults";
import type { ProviderCapability, ProviderConnection, ProviderModel } from "../../providers/types";
import type { ProviderSelectionState } from "../../providers/types";
import { RichSelect } from "../common/RichSelect";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const capabilityLabels: Record<ProviderCapability, string> = {
  text_generation: "文本生成",
  prompt_rewrite: "提示优化",
  image_generation: "素材生成",
  image_editing: "图像编辑",
  vision_understanding: "视觉理解",
  audio_generation: "音频生成",
  speech_to_text: "语音转文本",
  text_to_speech: "文本转语音",
  animation_planning: "动画规划",
};

const capabilityHelp: Partial<Record<ProviderCapability, { description: string; example: string }>> = {
  text_generation: {
    description: "用于写剧情、对白、旁白、总结等普通文字内容。",
    example: "例：deepseek-chat、gpt-4o-mini 这类聊天模型通常可以勾选。",
  },
  prompt_rewrite: {
    description: "用于把你的想法整理成更清晰的提示词，辅助后续生成。",
    example: "例：希望 AI 帮你润色素材提示词时，启用这个能力。",
  },
  image_generation: {
    description: "只给真正能生成图片的模型勾选；普通文本模型不要勾。",
    example: "例：图片/素材生成模型可勾选；deepseek-chat 这类文本模型通常不勾。",
  },
};

const parameterHelp = {
  connectionName: {
    description: "这条连接在本软件里的名字，只用于你自己识别。",
    example: "例：DeepSeek 官方、公司代理、OpenAI 测试号。",
  },
  baseUrl: {
    description: "OpenAI 兼容接口地址。很多服务需要以 /v1 结尾；检测模型成功后会自动修正。",
    example: "例：https://api.deepseek.com/v1；如果只填 https://api.deepseek.com，系统会尝试自动补 /v1。",
  },
  apiToken: {
    description: "服务商给你的 API 密钥，用来证明请求来自你的账号。只保存在本机。",
    example: "请填写服务商后台生成的完整密钥。不要截图或发给别人；泄露后请到服务商后台立即重置。",
  },
  modelId: {
    description: "服务商接口真实使用的模型名称，请和服务商文档或模型列表保持一致。",
    example: "例：deepseek-chat、deepseek-reasoner、gpt-4o-mini。",
  },
  displayName: {
    description: "只在本软件里显示，方便你分辨模型，不会发给服务商。",
    example: "例：DeepSeek 写剧情、便宜快速模型、长文本模型。",
  },
  temperature: {
    description: "控制随机性。数值越低越稳定，越高越有变化，但也更容易跑偏。",
    example: "预设：DeepSeek V4/推理模型为 0.2，通用文本模型为 0.4；创意任务可按官方文档适当调高。",
  },
  topP: {
    description: "控制可选词范围。1 表示不额外收窄；越低越保守。",
    example: "预设：DeepSeek V4/推理模型为 0.9，通用文本模型为 1；通常不要和随机性同时大幅调整。",
  },
  maxTokens: {
    description: "限制单次最多生成多少内容。太小会截断，太大更慢也可能更贵。",
    example: "预设：Flash/通用文本模型为 4096，Pro/推理模型为 8192；不得超过对应模型官方上限。",
  },
  requestTimeout: {
    description: "控制一次模型请求最多等待多少秒。慢模型、thinking/reasoner 或 deepseek-v4-pro 可以调大。",
    example: "建议：默认 300 秒；慢模型可用 300-600 秒。调大能减少超时，但失败时也会等更久，允许范围 30-900。",
  },
  contextBudget: {
    description: "估算单次请求最多可放入多少上下文，小说导入、助手问答和剧情生成会按这个预算压缩或切片。",
    example: "建议：普通模型 24000；长上下文模型可设 48000-128000。太高可能导致服务商拒绝或费用升高。",
  },
  structuredMode: {
    description: "控制剧情生成最终数据来自结构化工具调用，还是旧的 JSON 兼容模式。",
    example: "建议：默认使用自动兼容；只有模型服务明确不支持结构化工具时，再临时切到 JSON 兼容。",
  },
  thinkingMode: {
    description: "标记这个模型会使用更长的推理或思考过程。它不会直接改写接口参数，只会在生成前提醒你结构化写入风险。",
    example: "建议：DeepSeek reasoner、thinking、长推理模型可勾选；普通聊天模型保持关闭，避免频繁警告。",
  },
  systemPrompt: {
    description: "为这个文本模型追加一段固定系统提示词，用来约束它的输出倾向、风格和格式习惯。",
    example: "例：要求模型保持指定文风、避免跳出角色、严格遵守某些输出偏好；AgentVN 的结构化写入规则仍然优先。",
  },
};

parameterHelp.structuredMode = {
  description: "Tool Call 会强制模型调用 AgentVN 工具并校验参数；工具优先兼容仅在服务商明确声明不支持工具时回退 JSON。",
  example: "建议：所有支持 Tool Call 的模型都优先使用该模式；JSON 兼容可能出现截断，只应提供给明确不支持工具的模型。",
};

const providerStructuredModeOptions = [
  { value: "tools", label: "Tool Call（推荐）" },
  { value: "auto", label: "工具优先兼容" },
  { value: "json_object", label: "JSON 兼容（可能截断）" },
] as const;

const providerModelExpansionStorageKey = "agentvn.providerModelExpansion";
const legacyTextFamilyCapabilities = ["text_generation", "prompt_rewrite"] as const;
const systemPromptMaxLength = 8000;

type CompatibilityProgress = {
  percent: number;
  message: string;
  level?: "info" | "success" | "error";
};

function providerIdFrom(connectionId: string, modelId: string): string {
  return `${connectionId}::${modelId}`;
}

function readExpandedProviderModels(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(providerModelExpansionStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[0] === "string" && entry[1] === true)
    );
  } catch (error) {
    reportFrontendError("editor.provider-settings", error, {
      operation: "read-expanded-models",
    });
    return {};
  }
}

function writeExpandedProviderModels(state: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  const next = Object.fromEntries(Object.entries(state).filter(([, expanded]) => expanded));
  if (Object.keys(next).length === 0) {
    window.localStorage.removeItem(providerModelExpansionStorageKey);
    return;
  }
  window.localStorage.setItem(providerModelExpansionStorageKey, JSON.stringify(next));
}

function parseNumber(value: string, fallback?: number): number | undefined {
  if (!value.trim()) return fallback;
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampRequestTimeout(value: number | undefined): number {
  const next = typeof value === "number" && Number.isFinite(value) ? value : 300;
  return Math.min(900, Math.max(30, next));
}

function clampContextBudget(value: number | undefined): number {
  const next = typeof value === "number" && Number.isFinite(value) ? value : 24000;
  return Math.min(200000, Math.max(4000, next));
}

function clampSystemPrompt(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > systemPromptMaxLength ? value.slice(0, systemPromptMaxLength) : value;
}

function formatHelpText(help: { description: string; example: string }): string {
  return `${help.description}\n${help.example}`;
}

function isLikelyToolChoiceLimitedModel(model: ProviderModel): boolean {
  const name = `${model.model_id} ${model.model_name} ${model.display_name}`.toLowerCase();
  return name.includes("deepseek-v4-pro") || name.includes("reasoner") || name.includes("thinking");
}

function isTextFamilyModel(model: ProviderModel): boolean {
  return model.capabilities.includes("text_generation") || model.capabilities.includes("prompt_rewrite");
}

function isAssetOnlyModel(model: ProviderModel): boolean {
  return model.capabilities.includes("image_generation") && !isTextFamilyModel(model);
}

function textFamilyCapabilitiesFor(model: ProviderModel, checked: boolean): ProviderCapability[] {
  const withoutTextFamily = model.capabilities.filter((capability) => !legacyTextFamilyCapabilities.includes(capability as never));
  return checked ? [...new Set<ProviderCapability>([...withoutTextFamily, "text_generation"])] : withoutTextFamily;
}

function assetCapabilityFor(model: ProviderModel, checked: boolean): ProviderCapability[] {
  return checked
    ? [...new Set<ProviderCapability>([...model.capabilities, "image_generation"])]
    : model.capabilities.filter((capability) => capability !== "image_generation");
}

function sanitizeCompatibilityText(text: string | undefined): string {
  if (!text) return "";
  return text
    .replace(/AgentVN\s*MCP/gi, "AgentVN 结构化生成")
    .replace(/\bMCP\b/gi, "结构化生成")
    .replace(/tool_choice/gi, "结构化选择参数")
    .replace(/\btools?\b/gi, "结构化工具")
    .replace(/JSON object/gi, "JSON 兼容");
}

function structuredModeLabel(mode: string | undefined): string {
  if (mode === "tools") return "Tool Call";
  if (mode === "json_object") return "JSON 兼容（可能截断）";
  return "工具优先兼容";
}

function compatibilityResultLabel(result: { tool_calling_ok?: boolean; json_mode_ok?: boolean; memory_schema_ok?: boolean; recommended_structured_mode?: string }): string {
  if (result.tool_calling_ok && result.memory_schema_ok !== false) return "Tool Call 已通过";
  if (result.json_mode_ok) return "仅 JSON 兼容";
  return "检查失败";
}

function resolvedCompatibilityState(model: ProviderModel, connection: ProviderConnection) {
  const status = model.structured_compatibility;
  if (!status) return "untested" as const;
  if (
    status.tested_model_id !== model.model_id
    || status.tested_base_url !== connection.base_url
    || status.tested_structured_mode !== model.default_parameters.structured_mode
    || status.tested_thinking_mode !== (model.default_parameters.thinking_mode === true)
  ) {
    return "stale" as const;
  }
  return status.state;
}

function compatibilityStateLabel(state: ReturnType<typeof resolvedCompatibilityState>): string {
  if (state === "passed") return "Tool Call 已通过";
  if (state === "json_fallback") return "仅 JSON 兼容";
  if (state === "failed") return "适配测试失败";
  if (state === "stale") return "配置已变更，需重测";
  return "Tool Call 未测试";
}

function modelSummaryChips(model: ProviderModel): Array<{ label: string; tone?: "muted" | "accent" | "asset" }> {
  const chips: Array<{ label: string; tone?: "muted" | "accent" | "asset" }> = [
    { label: model.enabled ? "启用" : "停用", tone: model.enabled ? "accent" : "muted" },
  ];
  if (isTextFamilyModel(model)) chips.push({ label: "文本", tone: "accent" });
  if (model.capabilities.includes("image_generation")) chips.push({ label: "素材", tone: "asset" });
  const mode = model.default_parameters.structured_mode ?? "auto";
  if (isTextFamilyModel(model)) chips.push({ label: mode === "json_object" ? "JSON" : mode === "tools" ? "工具" : "自动" });
  if (model.default_parameters.thinking_mode === true) chips.push({ label: "思考" });
  if (model.default_parameters.system_prompt?.trim()) chips.push({ label: "提示词" });
  for (const capability of model.capabilities) {
    if (legacyTextFamilyCapabilities.includes(capability as never) || capability === "image_generation") continue;
    chips.push({ label: capabilityLabels[capability] ?? capability });
  }
  if (chips.length === 1) chips.push({ label: "未分配", tone: "muted" });
  return chips;
}

function ProviderInfoCard({ title, description, example }: { title: string; description: string; example: string }) {
  return (
    <article className="provider-info-card">
      <strong>{title}</strong>
      <span>{description}</span>
      <span>{example}</span>
    </article>
  );
}

export function ProviderSettingsPanel() {
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>();
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [hasLoadedProviderState, setHasLoadedProviderState] = useState(false);
  const [tokenDrafts, setTokenDrafts] = useState<Record<string, string>>({});
  const [tokenVisibility, setTokenVisibility] = useState<Record<string, boolean>>({});
  const [connectionStatus, setConnectionStatus] = useState<Record<string, string>>({});
  const [discoveringConnectionId, setDiscoveringConnectionId] = useState<string>();
  const [testingProviderId, setTestingProviderId] = useState<string>();
  const [compatibilityProgress, setCompatibilityProgress] = useState<Record<string, CompatibilityProgress>>({});
  const [selections, setSelections] = useState<ProviderSelectionState>({});
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>(() => readExpandedProviderModels());

  async function persistProviderState() {
    await backendClient.saveProjectState({
      ...exportProviderState(),
      provider_secrets: getPersistedApiKeys(),
    });
  }

  function refresh() {
    const nextConnections = listProviderConnections();
    const nextModels = listProviderModels();
    setConnections(nextConnections);
    setModels(nextModels);
    setHasLoadedProviderState(true);
    setSelectedConnectionId((current) =>
      current && nextConnections.some((item) => item.connection_id === current) ? current : nextConnections[0]?.connection_id
    );
    setSelections(listProviderSelections());
    initializeDefaultProviders();
  }

  function updateCapabilitySelection(capability: keyof ProviderSelectionState, providerId?: string) {
    setCapabilitySelection(capability, providerId);
    const nextSelections = listProviderSelections();
    setSelections(nextSelections);
    void persistProviderState();
  }

function updateTextFamilySelection(providerId?: string) {
    setCapabilitySelection("text_generation", providerId);
    const nextSelections = listProviderSelections();
    setSelections(nextSelections);
    void persistProviderState();
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setTokenDrafts(Object.fromEntries(connections.map((connection) => [connection.connection_id, getApiKey(connection.connection_id) ?? ""])));
  }, [connections]);

  useEffect(() => {
    if (!hasLoadedProviderState) return;
    const validIds = new Set(models.map((model) => model.provider_id));
    setExpandedModels((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([providerId, expanded]) => expanded && validIds.has(providerId))
      );
      const changed =
        Object.keys(next).length !== Object.keys(current).length ||
        Object.keys(next).some((providerId) => !current[providerId]);
      if (changed) writeExpandedProviderModels(next);
      return changed ? next : current;
    });
  }, [hasLoadedProviderState, models]);

  const selectedConnection = useMemo(
    () => connections.find((item) => item.connection_id === selectedConnectionId),
    [connections, selectedConnectionId]
  );

  const selectedModels = useMemo(
    () => models.filter((item) => item.connection_id === selectedConnectionId),
    [models, selectedConnectionId]
  );

  const textFamilyProviders = useMemo(() => {
    return getProvidersForCapability("text_generation");
  }, [models, selections]);

  const textFamilySelection = selections.text_generation ?? getCapabilitySelection("text_generation");

  function updateConnection(connectionId: string, patch: Partial<ProviderConnection>) {
    const current = connections.find((item) => item.connection_id === connectionId);
    if (!current) return;
    if (typeof patch.base_url === "string" && patch.base_url !== current.base_url) {
      for (const model of listProviderModels(connectionId)) {
        if (!model.structured_compatibility) continue;
        saveProviderModel({
          ...model,
          structured_compatibility: {
            ...model.structured_compatibility,
            state: "stale",
            summary: "Base URL 已变更，需要重新运行 Tool Call 适配测试。",
          },
        });
      }
    }
    saveProviderConnection({ ...current, ...patch });
    refresh();
    void persistProviderState();
  }

  function updateModel(providerId: string, patch: Partial<ProviderModel>) {
    const current = models.find((item) => item.provider_id === providerId);
    if (!current) return;
    const next = { ...current, ...patch };
    if (!patch.structured_compatibility && current.structured_compatibility) {
      const nextParameters = next.default_parameters;
      const compatibilityInputsChanged =
        next.model_id !== current.model_id
        || next.model_name !== current.model_name
        || nextParameters.structured_mode !== current.default_parameters.structured_mode
        || nextParameters.thinking_mode !== current.default_parameters.thinking_mode;
      if (compatibilityInputsChanged) {
        next.structured_compatibility = {
          ...current.structured_compatibility,
          state: "stale",
          summary: "模型或关键结构化参数已变更，需要重新运行 Tool Call 适配测试。",
        };
      }
    }
    saveProviderModel(next);
    refresh();
    void persistProviderState();
  }

  function applyRecommendedModelParameters(model: ProviderModel) {
    const profile = getModelParameterProfile(model.model_name || model.model_id);
    updateModel(model.provider_id, {
      default_parameters: {
        ...createDefaultModelParameters(model.model_name || model.model_id),
        system_prompt: model.default_parameters.system_prompt,
      },
    });
    setConnectionStatus((current) => ({
      ...current,
      [model.provider_id]: `已应用“${profile.label}”推荐预设；请按对应模型官方文档复核。`,
    }));
  }

  function applyCompatibilityRecommendation(model: ProviderModel) {
    const status = model.structured_compatibility;
    const recommended = status?.recommended_structured_mode;
    if (!status || (recommended !== "tools" && recommended !== "json_object" && recommended !== "auto")) return;
    updateModel(model.provider_id, {
      default_parameters: {
        ...model.default_parameters,
        structured_mode: recommended,
      },
      structured_compatibility: {
        ...status,
        state: status.state,
        tested_structured_mode: recommended,
        summary: `${status.summary ?? "适配测试已完成"}；已应用建议模式：${structuredModeLabel(recommended)}。`,
      },
    });
    setConnectionStatus((current) => ({
      ...current,
      [model.provider_id]: `已应用适配测试建议：${structuredModeLabel(recommended)}。`,
    }));
  }

  function addConnection() {
    const connection = saveProviderConnection({
      connection_id: `conn_${nanoid(8)}`,
      provider_type: "openai_compatible",
      display_name: "新建 OpenAI 兼容连接",
      base_url: "https://api.openai.com/v1",
      api_key_storage: "local",
      enabled: true,
      supports_model_discovery: true,
    });
    refresh();
    setSelectedConnectionId(connection.connection_id);
    void persistProviderState();
  }

  function saveConnectionToken(connection: ProviderConnection) {
    const nextToken = tokenDrafts[connection.connection_id] ?? "";
    if (nextToken.trim()) {
      saveApiKey(connection.connection_id, nextToken, "local");
    } else {
      clearApiKey(connection.connection_id);
      setTokenDrafts((current) => ({ ...current, [connection.connection_id]: "" }));
    }
    for (const model of listProviderModels(connection.connection_id)) {
      if (!model.structured_compatibility) continue;
      saveProviderModel({
        ...model,
        structured_compatibility: {
          ...model.structured_compatibility,
          state: "stale",
          summary: "API Token 已更新，需要重新运行 Tool Call 适配测试。",
        },
      });
    }
    refresh();
    setConnectionStatus((current) => ({ ...current, [connection.connection_id]: "已保存设置" }));
    void persistProviderState();
  }

  async function detectModels(connection: ProviderConnection) {
    const apiKey = tokenDrafts[connection.connection_id] ?? "";
    if (apiKey.trim()) {
      saveApiKey(connection.connection_id, apiKey, "local");
    }
    setDiscoveringConnectionId(connection.connection_id);
    setConnectionStatus((current) => ({ ...current, [connection.connection_id]: "正在检测模型..." }));
    try {
      const result = await backendClient.testProviderConnection({ base_url: connection.base_url, api_key: apiKey });
      applyDiscoveryResult(connection, result);
    } catch (error) {
      reportFrontendError("editor.provider-settings", error, {
        operation: "discover-models",
        connectionId: connection.connection_id,
      });
      setConnectionStatus((current) => ({
        ...current,
        [connection.connection_id]: error instanceof Error ? error.message : "检测失败",
      }));
    } finally {
      setDiscoveringConnectionId(undefined);
    }
  }

  function applyDiscoveryResult(connection: ProviderConnection, result: TestProviderConnectionResponse) {
    saveProviderConnection({
      ...connection,
      base_url: result.base_url || connection.base_url,
      supports_model_discovery: result.supports_model_discovery,
    });
    if (result.models.length > 0) {
      const existing = listProviderModels(connection.connection_id);
      for (const discovered of result.models) {
        const matched = existing.find((item) => item.model_id === discovered.model_id);
        saveProviderModel({
          provider_id: matched?.provider_id || providerIdFrom(connection.connection_id, discovered.model_id),
          connection_id: connection.connection_id,
          model_id: discovered.model_id,
          model_name: discovered.model_id,
          display_name: matched?.display_name || discovered.display_name,
          enabled: matched?.enabled ?? true,
          capabilities: matched?.capabilities ?? ["text_generation"],
          default_parameters: matched?.default_parameters ?? createDefaultModelParameters(discovered.model_id),
          structured_compatibility: matched?.structured_compatibility,
        });
      }
      setConnectionStatus((current) => ({
        ...current,
        [connection.connection_id]: `已导入 ${result.models.length} 个模型`,
      }));
    } else if (result.ok && !result.supports_model_discovery) {
      setConnectionStatus((current) => ({
        ...current,
        [connection.connection_id]: "连接可用，但该端点未返回模型列表，可以手动添加模型。",
      }));
    } else {
      setConnectionStatus((current) => ({
        ...current,
        [connection.connection_id]: result.error_message ?? "未检测到模型",
      }));
    }
    refresh();
    void persistProviderState();
  }

  function addManualModel(connection: ProviderConnection) {
    createProviderModel(connection.connection_id, {
      provider_id: providerIdFrom(connection.connection_id, `manual_${nanoid(6)}`),
      model_id: "custom-model",
      model_name: "custom-model",
      display_name: "手动添加模型",
      enabled: true,
      capabilities: ["text_generation"],
      default_parameters: createDefaultModelParameters(),
    });
    refresh();
    void persistProviderState();
  }

  function setModelExpanded(providerId: string, expanded: boolean) {
    setExpandedModels((current) => {
      const next = expanded ? { ...current, [providerId]: true } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== providerId));
      writeExpandedProviderModels(next);
      return next;
    });
  }

  async function testModelGeneration(connection: ProviderConnection, model: ProviderModel) {
    const confirmed = window.confirm(
      "建议先进行一次 Tool Call 适配测试。\n\n"
      + "测试会向当前模型发送 SceneBeat、MemoryUpdate 和复杂小说规划三个小型探针，"
      + "可能产生少量模型费用。只有服务商明确不支持 Tool Call 时才会追加一次 JSON 兼容探针。\n\n"
      + "是否开始测试？"
    );
    if (!confirmed) return;

    const apiKey = tokenDrafts[connection.connection_id] ?? "";
    if (!apiKey.trim()) {
      setConnectionStatus((current) => ({ ...current, [model.provider_id]: "请先填写 API Token，再检查结构化生成兼容性。" }));
      setCompatibilityProgress((current) => ({
        ...current,
        [model.provider_id]: { percent: 100, message: "缺少 API Token", level: "error" },
      }));
      return;
    }
    saveApiKey(connection.connection_id, apiKey, "local");
    setTestingProviderId(model.provider_id);
    setCompatibilityProgress((current) => ({
      ...current,
      [model.provider_id]: { percent: 18, message: "准备请求", level: "info" },
    }));
    setConnectionStatus((current) => ({ ...current, [model.provider_id]: "正在检查结构化生成兼容性..." }));
    try {
      setCompatibilityProgress((current) => ({
        ...current,
        [model.provider_id]: { percent: 36, message: "连接模型", level: "info" },
      }));
      const result = await backendClient.testProviderGeneration({
        provider_selection: {
          connection_id: connection.connection_id,
          model_id: model.model_id,
          base_url: connection.base_url,
          api_key: apiKey,
          parameters: model.default_parameters,
        },
      });
      setCompatibilityProgress((current) => ({
        ...current,
        [model.provider_id]: {
          percent: 72,
          message: result.complex_schema_ok === false ? "检查复杂规划结构" : "校验 Tool Call 参数",
          level: "info",
        },
      }));
      const recommended = result.recommended_structured_mode;
      const recommendedMode =
        recommended === "tools" || recommended === "json_object" || recommended === "auto"
          ? recommended
          : undefined;
      const resultLabel = compatibilityResultLabel(result);
      const recommendedLabel = structuredModeLabel(recommended);
      const compatibilityState =
        result.tool_calling_ok
          ? "passed"
          : result.tool_unsupported && result.json_mode_ok
            ? "json_fallback"
            : "failed";
      updateModel(model.provider_id, {
        structured_compatibility: {
          state: compatibilityState,
          tested_at: new Date().toISOString(),
          tested_model_id: model.model_id,
          tested_base_url: connection.base_url,
          tested_structured_mode: model.default_parameters.structured_mode,
          tested_thinking_mode: model.default_parameters.thinking_mode === true,
          scene_schema_ok: result.scene_schema_ok,
          memory_schema_ok: result.memory_schema_ok,
          complex_schema_ok: result.complex_schema_ok,
          json_mode_ok: result.json_mode_ok,
          tool_unsupported: result.tool_unsupported,
          recommended_structured_mode: recommendedMode,
          latency_ms: result.latency_ms,
          summary: result.ok
            ? `${resultLabel}；建议模式：${recommendedLabel}`
            : sanitizeCompatibilityText(result.error_message || result.message),
          diagnostics: (result.diagnostics ?? []).map((item) => sanitizeCompatibilityText(item)).slice(0, 8),
        },
      });
      setConnectionStatus((current) => ({
        ...current,
        [model.provider_id]: result.ok
          ? `${resultLabel}。耗时 ${result.latency_ms}ms。${recommended ? `建议模式：${recommendedLabel}；配置尚未自动修改。` : ""}`
          : `检查失败：${sanitizeCompatibilityText(result.error_message || result.message)} Tool Call 失败不会自动降级为 JSON。`,
      }));
      setCompatibilityProgress((current) => ({
        ...current,
        [model.provider_id]: {
          percent: 100,
          message: result.ok ? resultLabel : "检查失败",
          level: result.ok ? "success" : "error",
        },
      }));
    } catch (error) {
      reportFrontendError("editor.provider-settings", error, {
        operation: "test-model",
        providerId: model.provider_id,
        modelId: model.model_id,
      });
      const message = sanitizeCompatibilityText(error instanceof Error ? error.message : "兼容性检查失败");
      updateModel(model.provider_id, {
        structured_compatibility: {
          state: "failed",
          tested_at: new Date().toISOString(),
          tested_model_id: model.model_id,
          tested_base_url: connection.base_url,
          tested_structured_mode: model.default_parameters.structured_mode,
          tested_thinking_mode: model.default_parameters.thinking_mode === true,
          summary: message,
          diagnostics: [message],
        },
      });
      setConnectionStatus((current) => ({
        ...current,
        [model.provider_id]: message,
      }));
      setCompatibilityProgress((current) => ({
        ...current,
        [model.provider_id]: { percent: 100, message: "检查失败", level: "error" },
      }));
    } finally {
      setTestingProviderId(undefined);
    }
  }

  return (
    <section className="advanced-card provider-settings-panel ai-glow-surface">
      <header className="provider-settings-header">
        <div>
          <h3>模型/连接</h3>
          <p>这些配置只保存在当前设备，不会写入项目、运行脚本或卡带。</p>
        </div>
        <button type="button" data-help-key="provider.addConnection" onClick={addConnection}>
          新增连接
        </button>
      </header>

      <section className="provider-defaults-card ai-glow-surface">
        <strong>当前启用模型</strong>
        <div className="advanced-grid-2">
          <label>
            文本与联想模型
            <RichSelect
              value={textFamilySelection ?? ""}
              options={[
                { value: "", label: "请明确指定文本与联想模型" },
                ...textFamilyProviders.map((provider) => ({ value: provider.provider_id, label: `${provider.connection_name} / ${provider.display_name}` })),
              ]}
              helpKey="provider.textFamilyModel"
              onChange={(nextProviderId) => updateTextFamilySelection(nextProviderId || undefined)}
            />
          </label>
          <label>
            素材生成模型
            <RichSelect
              value={selections.image_generation ?? getCapabilitySelection("image_generation") ?? ""}
              options={[
                { value: "", label: "请明确指定素材生成模型" },
                ...getProvidersForCapability("image_generation").map((provider) => ({ value: provider.provider_id, label: `${provider.connection_name} / ${provider.display_name}` })),
              ]}
              helpKey="provider.assetModel"
              onChange={(nextProviderId) => updateCapabilitySelection("image_generation", nextProviderId || undefined)}
            />
          </label>
        </div>
      </section>

      <div className="provider-settings-layout">
        <aside className="provider-connection-list">
          {connections.map((connection) => (
            <button
              key={connection.connection_id}
              type="button"
              className={selectedConnectionId === connection.connection_id ? "is-active" : ""}
              data-help-key="provider.selectConnection"
              onClick={() => setSelectedConnectionId(connection.connection_id)}
            >
              <strong>{connection.display_name || "未命名连接"}</strong>
              <span>{connection.base_url}</span>
            </button>
          ))}
          {connections.length === 0 && <div className="empty-state">还没有自定义连接，点击“新增连接”开始配置。</div>}
        </aside>

        {selectedConnection && (
          <section className="provider-connection-detail">
            <article className="advanced-card">
              <div className="provider-connection-toolbar">
                <strong>连接设置</strong>
                <button
                  type="button"
                  data-help-key="provider.deleteConnection"
                  onClick={() => {
                    deleteProviderConnection(selectedConnection.connection_id);
                    refresh();
                    void persistProviderState();
                  }}
                >
                  删除连接
                </button>
              </div>
              <div className="provider-info-grid">
                <ProviderInfoCard title="名称" {...parameterHelp.connectionName} />
                <ProviderInfoCard title="接口地址（Base URL）" {...parameterHelp.baseUrl} />
                <ProviderInfoCard title="API 密钥（API Token）" {...parameterHelp.apiToken} />
              </div>
              <div className="form-grid">
                <label>
                  名称
                  <input
                    value={selectedConnection.display_name}
                    placeholder="未命名连接"
                    data-help-key="provider.connectionName"
                    onChange={(event) => updateConnection(selectedConnection.connection_id, { display_name: event.target.value })}
                  />
                </label>
                <label>
                  接口地址（Base URL）
                  <input value={selectedConnection.base_url} data-help-key="provider.baseUrl" onChange={(event) => updateConnection(selectedConnection.connection_id, { base_url: event.target.value })} />
                </label>
                <label>
                  API 密钥（API Token）
                  {(() => {
                    const tokenValue = tokenDrafts[selectedConnection.connection_id] ?? "";
                    const revealed = tokenVisibility[selectedConnection.connection_id] ?? false;
                    return (
                      <div className="provider-token-field">
                        <input
                          type={revealed ? "text" : "password"}
                          value={tokenValue}
                          placeholder="请输入完整的 API Token"
                          data-help-key="provider.apiToken"
                          autoComplete="off"
                          spellCheck={false}
                          onChange={(event) =>
                            setTokenDrafts((current) => ({
                              ...current,
                              [selectedConnection.connection_id]: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="provider-token-visibility"
                          data-help-key="provider.toggleTokenVisibility"
                          aria-label={revealed ? "隐藏 API Token" : "显示 API Token"}
                          onClick={() =>
                            setTokenVisibility((current) => ({
                              ...current,
                              [selectedConnection.connection_id]: !revealed,
                            }))
                          }
                        >
                          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    );
                  })()}
                </label>
                <label className="provider-checkbox">
                  <input type="checkbox" checked={selectedConnection.enabled} data-help-key="provider.enableConnection" onChange={(event) => updateConnection(selectedConnection.connection_id, { enabled: event.target.checked })} />
                  <span className="provider-checkbox-text">
                    <strong>启用连接</strong>
                    <small>关闭后，这条连接下的所有模型都不会出现在可选模型列表里。</small>
                  </span>
                </label>
              </div>
              <div className="row-actions">
                <button type="button" data-help-key="provider.save" onClick={() => saveConnectionToken(selectedConnection)}>
                  保存
                </button>
                <button type="button" disabled={discoveringConnectionId === selectedConnection.connection_id} data-help-key="provider.detectModels" onClick={() => void detectModels(selectedConnection)}>
                  {discoveringConnectionId === selectedConnection.connection_id ? "检测中..." : "检测模型"}
                </button>
                <button type="button" data-help-key="provider.addManualModel" onClick={() => addManualModel(selectedConnection)}>
                  手动添加模型
                </button>
              </div>
              {connectionStatus[selectedConnection.connection_id] && <p className="provider-status">{connectionStatus[selectedConnection.connection_id]}</p>}
            </article>

            <article className="advanced-card">
              <div className="provider-connection-toolbar">
                <strong>模型列表</strong>
                <span>{selectedModels.length} 个模型</span>
              </div>
              <div className="provider-model-list">
{selectedModels.map((model) => (
                  <article className={`advanced-list-item provider-model-item${expandedModels[model.provider_id] ? " is-expanded" : ""}`} key={model.provider_id}>
                    <div className="provider-model-toolbar">
                      <button
                        type="button"
                        className="provider-model-toggle"
                        data-help-key="provider.toggleModelDetails"
                        aria-expanded={expandedModels[model.provider_id] ? "true" : "false"}
                        onClick={() => setModelExpanded(model.provider_id, !expandedModels[model.provider_id])}
                      >
                        <span className="provider-model-summary">
                          <strong>{model.display_name || model.model_name}</strong>
                          <span className="provider-model-chip-row" aria-label="模型摘要标签">
                            {modelSummaryChips(model).map((chip) => (
                              <span className={`provider-model-chip${chip.tone ? ` is-${chip.tone}` : ""}`} key={`${model.provider_id}-${chip.label}`}>
                                {chip.label}
                              </span>
                            ))}
                          </span>
                        </span>
                        <ChevronDown className="provider-model-chevron" size={16} />
                      </button>
                      <button
                        type="button"
                        data-help-key="provider.deleteModel"
                        onClick={() => {
                          deleteProviderModel(model.provider_id);
                          refresh();
                          void persistProviderState();
                        }}
                      >
                        删除
                      </button>
                    </div>
                    {expandedModels[model.provider_id] && (
                    <div className="provider-model-content-wrap">
                      <div className="provider-model-content">
                        <div className="provider-info-grid">
                          <ProviderInfoCard title="模型 ID" {...parameterHelp.modelId} />
                          <ProviderInfoCard title="显示名称" {...parameterHelp.displayName} />
                        </div>
                        <div className="advanced-grid-2">
                          <label>
                            模型 ID
                            <input
                              value={model.model_id}
                              data-help-key="provider.modelId"
                              onChange={(event) => {
                                const nextModelId = event.target.value;
                                updateModel(model.provider_id, {
                                  model_id: nextModelId,
                                  model_name: nextModelId,
                                });
                              }}
                            />
                          </label>
                          <label>
                            显示名称
                            <input value={model.display_name} data-help-key="provider.displayName" onChange={(event) => updateModel(model.provider_id, { display_name: event.target.value })} />
                          </label>
                        </div>
                        <label className="provider-checkbox">
                          <input type="checkbox" checked={model.enabled} data-help-key="provider.enableModel" onChange={(event) => updateModel(model.provider_id, { enabled: event.target.checked })} />
                          <span className="provider-checkbox-text">
                            <strong>启用模型</strong>
                          <small>关闭后，这个模型会保留在列表中，但不会被文本与联想或素材生成选中。</small>
                          </span>
                        </label>
                        <div className="provider-section-heading">
                          <strong>能力选择</strong>
                          <span>勾选此模型可以承担的任务。文本与联想会同时服务剧情生成、大模型助手、小说导入和提示词优化。</span>
                        </div>
                        <div className="provider-capability-grid">
                          <label className="provider-checkbox provider-capability-card ai-glow-surface">
                            <input
                              type="checkbox"
                              checked={isTextFamilyModel(model)}
                              data-help-key="provider.textFamilyCapability"
                              onChange={(event) => updateModel(model.provider_id, { capabilities: textFamilyCapabilitiesFor(model, event.target.checked) })}
                            />
                            <span className="provider-checkbox-text">
                              <strong>用于文本与联想</strong>
                              <small>用于剧情续写、小说导入、大模型助手和提示词优化。</small>
                              <small>勾选后会进入统一文本模型列表，提示词优化也会共用这一项。</small>
                            </span>
                          </label>
                          <label className="provider-checkbox provider-capability-card ai-glow-surface">
                            <input
                              type="checkbox"
                              checked={model.capabilities.includes("image_generation")}
                              data-help-key="provider.assetCapability"
                              onChange={(event) => updateModel(model.provider_id, { capabilities: assetCapabilityFor(model, event.target.checked) })}
                            />
                            <span className="provider-checkbox-text">
                              <strong>用于素材生成</strong>
                              <small>用于生成背景、立绘和素材图。普通文本模型不要勾选。</small>
                              <small>如果只勾选素材生成，下方文本生成参数会自动收起。</small>
                            </span>
                          </label>
                        </div>
                        {isAssetOnlyModel(model) ? (
                          <p className="provider-status provider-asset-only-note">
                            该模型只用于素材生成，文本生成参数和结构化生成兼容性检查无需填写。请在“素材生成”面板中验证实际图片生成效果。
                          </p>
                        ) : (
                          <>
                        <details className="provider-system-prompt-panel">
                          <summary data-help-key="provider.systemPrompt">
                            <span>
                              <strong>模型系统提示词</strong>
                              <small>
                                {model.default_parameters.system_prompt?.trim()
                                  ? `已设置 ${model.default_parameters.system_prompt.length}/${systemPromptMaxLength} 字`
                                  : "未设置，默认使用 AgentVN 功能提示词"}
                              </small>
                            </span>
                            <ChevronDown size={15} aria-hidden="true" />
                          </summary>
                          <div className="provider-system-prompt-body">
                            <p>
                              可以约束模型按想要的输出进行输出。例如“破盾”提示词；具体实践可参考“酒馆”。
                            </p>
                            <label>
                              系统提示词
                              <textarea
                                value={model.default_parameters.system_prompt ?? ""}
                                maxLength={systemPromptMaxLength}
                                spellCheck={false}
                                data-help-key="provider.systemPrompt"
                                data-help-title="模型系统提示词"
                                data-help={formatHelpText(parameterHelp.systemPrompt)}
                                placeholder="例如：保持冷静、克制、适合视觉小说的叙事语气；不要输出解释文字；所有新增内容必须能被 AgentVN 结构化校验。"
                                onChange={(event) =>
                                  updateModel(model.provider_id, {
                                    default_parameters: {
                                      ...model.default_parameters,
                                      system_prompt: clampSystemPrompt(event.target.value),
                                    },
                                  })
                                }
                              />
                            </label>
                            <div className="provider-system-prompt-footer">
                              <span>{(model.default_parameters.system_prompt ?? "").length}/{systemPromptMaxLength}</span>
                              <button
                                type="button"
                                data-help-key="provider.systemPrompt"
                                disabled={!model.default_parameters.system_prompt}
                                onClick={() =>
                                  updateModel(model.provider_id, {
                                    default_parameters: {
                                      ...model.default_parameters,
                                      system_prompt: undefined,
                                    },
                                  })
                                }
                              >
                                清空提示词
                              </button>
                            </div>
                          </div>
                        </details>
                        <div className="provider-section-heading">
                          <strong>生成参数</strong>
                          <span>系统会根据模型 ID 自动选择内建预设；各项参数仍应按对应模型官方文档调整。</span>
                        </div>
                        <div className="advanced-grid-2">
                          <label>
                            随机性（Temperature）
                            <input
                              type="number"
                              step="0.1"
                              data-help-key="provider.temperature"
                              data-help-title="随机性（Temperature）"
                              data-help={formatHelpText(parameterHelp.temperature)}
                              value={model.default_parameters.temperature ?? ""}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    temperature: parseNumber(
                                      event.target.value,
                                      createDefaultModelParameters(model.model_name || model.model_id).temperature ?? 0.4,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            核采样范围（Top P）
                            <input
                              type="number"
                              step="0.1"
                              data-help-key="provider.topP"
                              data-help-title="核采样范围（Top P）"
                              data-help={formatHelpText(parameterHelp.topP)}
                              value={model.default_parameters.top_p ?? ""}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    top_p: parseNumber(
                                      event.target.value,
                                      createDefaultModelParameters(model.model_name || model.model_id).top_p ?? 1,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            最大输出长度（Max Tokens）
                            <input
                              type="number"
                              step="1"
                              data-help-key="provider.maxTokens"
                              data-help-title="最大输出长度（Max Tokens）"
                              data-help={formatHelpText(parameterHelp.maxTokens)}
                              value={model.default_parameters.max_tokens ?? ""}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    max_tokens: parseNumber(
                                      event.target.value,
                                      createDefaultModelParameters(model.model_name || model.model_id).max_tokens ?? 4096,
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            结构化输出模式
                            <RichSelect
                              value={model.default_parameters.structured_mode ?? "auto"}
                              options={providerStructuredModeOptions}
                              helpKey="provider.structuredMode"
                              helpTitle="结构化输出模式"
                              helpText={formatHelpText(parameterHelp.structuredMode)}
                              onChange={(nextStructuredMode) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    structured_mode: nextStructuredMode as "auto" | "tools" | "json_object",
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            请求超时（秒）
                            <input
                              type="number"
                              min="30"
                              max="900"
                              step="30"
                              data-help-key="provider.requestTimeout"
                              data-help-title="请求超时（秒）"
                              data-help={formatHelpText(parameterHelp.requestTimeout)}
                              value={model.default_parameters.request_timeout_seconds ?? createDefaultModelParameters(model.model_name || model.model_id).request_timeout_seconds}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    request_timeout_seconds: clampRequestTimeout(
                                      parseNumber(
                                        event.target.value,
                                        createDefaultModelParameters(model.model_name || model.model_id).request_timeout_seconds ?? 300,
                                      ),
                                    ),
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            上下文预算（tokens）
                            <input
                              type="number"
                              min="4000"
                              max="200000"
                              step="1000"
                              data-help-key="provider.contextBudget"
                              data-help-title="上下文预算（tokens）"
                              data-help={formatHelpText(parameterHelp.contextBudget)}
                              value={model.default_parameters.context_budget_tokens ?? createDefaultModelParameters(model.model_name || model.model_id).context_budget_tokens}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    context_budget_tokens: clampContextBudget(
                                      parseNumber(
                                        event.target.value,
                                        createDefaultModelParameters(model.model_name || model.model_id).context_budget_tokens ?? 24000,
                                      ),
                                    ),
                                  },
                                })
                              }
                            />
                            <small className="provider-parameter-note">
                              当前自动预设：{getModelParameterProfile(model.model_name || model.model_id).label}
                              （{getModelParameterProfile(model.model_name || model.model_id).basis_label}）。合适的参数详见对应模型官方文档。
                            </small>
                          </label>
                          <label className="provider-checkbox provider-capability-card ai-glow-surface">
                            <input
                              type="checkbox"
                              checked={model.default_parameters.thinking_mode === true}
                              data-help-key="provider.thinkingMode"
                              data-help-title="启用思考模式"
                              data-help={formatHelpText(parameterHelp.thinkingMode)}
                              onChange={(event) =>
                                updateModel(model.provider_id, {
                                  default_parameters: {
                                    ...model.default_parameters,
                                    thinking_mode: event.target.checked,
                                  },
                                })
                              }
                            />
                            <span className="provider-checkbox-text">
                              <strong>启用思考模式</strong>
                              <small>用于 reasoner / thinking 类模型，生成前会提示结构化写入风险。</small>
                            </span>
                          </label>
                          {isLikelyToolChoiceLimitedModel(model) && (
                            <p className="provider-status">
                              检测到 thinking / reasoner 类模型。运行 Tool Call 时 AgentVN 会关闭 DeepSeek thinking；
                              请使用下方适配测试确认服务商是否支持强制工具调用。
                            </p>
                          )}
                        </div>
                        <div className={`provider-tool-status is-${resolvedCompatibilityState(model, selectedConnection)}`}>
                          <strong>{compatibilityStateLabel(resolvedCompatibilityState(model, selectedConnection))}</strong>
                          <span>
                            {model.structured_compatibility?.summary
                              ?? "尚未验证当前模型能否完成 SceneBeat、MemoryUpdate 和复杂小说规划 Tool Call。"}
                          </span>
                          {model.structured_compatibility?.tested_at && (
                            <small>最后测试：{new Date(model.structured_compatibility.tested_at).toLocaleString()}</small>
                          )}
                        </div>
                        <div className="row-actions">
                          <button type="button" onClick={() => applyRecommendedModelParameters(model)}>
                            应用推荐预设
                          </button>
                          <button type="button" data-help-key="provider.compatibilityCheck" disabled={testingProviderId === model.provider_id} onClick={() => void testModelGeneration(selectedConnection, model)}>
                            {testingProviderId === model.provider_id ? "适配测试中..." : "检查模型 / Tool Call"}
                          </button>
                          {model.structured_compatibility?.recommended_structured_mode
                            && model.structured_compatibility.recommended_structured_mode !== model.default_parameters.structured_mode
                            && (
                              <button type="button" onClick={() => applyCompatibilityRecommendation(model)}>
                                应用测试建议
                              </button>
                            )}
                        </div>
                        {compatibilityProgress[model.provider_id] && (
                          <div className={`provider-compatibility-progress is-${compatibilityProgress[model.provider_id].level ?? "info"}`}>
                            <div>
                              <strong>{compatibilityProgress[model.provider_id].message}</strong>
                              <span>{compatibilityProgress[model.provider_id].percent}%</span>
                            </div>
                            <progress max={100} value={compatibilityProgress[model.provider_id].percent} />
                          </div>
                        )}
                        {connectionStatus[model.provider_id] && <p className="provider-status">{connectionStatus[model.provider_id]}</p>}
                          </>
                        )}
                      </div>
                    </div>
                    )}
                  </article>
                ))}
                {selectedModels.length === 0 && <div className="empty-state">当前连接下还没有模型。可以先检测模型，也可以手动添加。</div>}
              </div>
            </article>
          </section>
        )}
      </div>
    </section>
  );
}
