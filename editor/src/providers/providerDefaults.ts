import type { ProviderModelParameters } from "./types";

export type ModelParameterProfileId =
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "openai"
  | "anthropic"
  | "gemini"
  | "qwen"
  | "kimi"
  | "glm"
  | "reasoning"
  | "generic-text";

export interface ModelParameterProfile {
  id: ModelParameterProfileId;
  label: string;
  description: string;
  basis_label: string;
  source_url?: string;
  parameters: ProviderModelParameters;
}

export const DEEPSEEK_V4_FLASH_DEFAULT_PARAMETERS = {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 4096,
  structured_mode: "tools",
  request_timeout_seconds: 300,
  context_budget_tokens: 24000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

export const DEEPSEEK_V4_PRO_DEFAULT_PARAMETERS = {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 8192,
  structured_mode: "tools",
  request_timeout_seconds: 300,
  context_budget_tokens: 48000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

export const REASONING_MODEL_DEFAULT_PARAMETERS = {
  temperature: 0.2,
  top_p: 0.9,
  max_tokens: 8192,
  structured_mode: "auto",
  request_timeout_seconds: 600,
  context_budget_tokens: 48000,
  thinking_mode: true,
} satisfies ProviderModelParameters;

export const GENERIC_TEXT_MODEL_DEFAULT_PARAMETERS = {
  temperature: 0.4,
  top_p: 1,
  max_tokens: 4096,
  structured_mode: "auto",
  request_timeout_seconds: 300,
  context_budget_tokens: 24000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

const OPENAI_MODEL_DEFAULT_PARAMETERS = {
  temperature: 1,
  top_p: 1,
  max_tokens: 4096,
  structured_mode: "auto",
  request_timeout_seconds: 300,
  context_budget_tokens: 32000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

const ANTHROPIC_MODEL_DEFAULT_PARAMETERS = {
  temperature: 1,
  top_p: 1,
  max_tokens: 4096,
  structured_mode: "auto",
  request_timeout_seconds: 600,
  context_budget_tokens: 48000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

const GEMINI_MODEL_DEFAULT_PARAMETERS = {
  temperature: 1,
  top_p: 0.95,
  max_tokens: 8192,
  structured_mode: "auto",
  request_timeout_seconds: 300,
  context_budget_tokens: 48000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

const QWEN_MODEL_DEFAULT_PARAMETERS = {
  temperature: 0.7,
  top_p: 0.8,
  max_tokens: 4096,
  structured_mode: "auto",
  request_timeout_seconds: 300,
  context_budget_tokens: 32000,
  thinking_mode: false,
} satisfies ProviderModelParameters;

const KIMI_MODEL_DEFAULT_PARAMETERS = {
  temperature: 1,
  top_p: 1,
  max_tokens: 8192,
  structured_mode: "auto",
  request_timeout_seconds: 600,
  context_budget_tokens: 128000,
  thinking_mode: true,
} satisfies ProviderModelParameters;

const GLM_MODEL_DEFAULT_PARAMETERS = {
  temperature: 1,
  top_p: 1,
  max_tokens: 8192,
  structured_mode: "auto",
  request_timeout_seconds: 600,
  context_budget_tokens: 128000,
  thinking_mode: true,
} satisfies ProviderModelParameters;

const profiles: Record<ModelParameterProfileId, ModelParameterProfile> = {
  "deepseek-v4-flash": {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    description: "适合快速文本生成和常规结构化任务。",
    basis_label: "官方能力范围 + AgentVN 结构化兼容基准",
    source_url: "https://api-docs.deepseek.com/quick_start/pricing",
    parameters: DEEPSEEK_V4_FLASH_DEFAULT_PARAMETERS,
  },
  "deepseek-v4-pro": {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    description: "为更长输出和更大上下文预算预留空间。",
    basis_label: "官方能力范围 + AgentVN 结构化兼容基准",
    source_url: "https://api-docs.deepseek.com/quick_start/pricing",
    parameters: DEEPSEEK_V4_PRO_DEFAULT_PARAMETERS,
  },
  openai: {
    id: "openai",
    label: "OpenAI GPT / o 系列",
    description: "适用于 GPT 与 o 系列 OpenAI 兼容模型。",
    basis_label: "官方参数范围 + AgentVN 兼容基准",
    source_url: "https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create",
    parameters: OPENAI_MODEL_DEFAULT_PARAMETERS,
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Temperature 使用官方默认值，输出和上下文采用 AgentVN 安全基准。",
    basis_label: "部分官方默认 + AgentVN 兼容基准",
    source_url: "https://docs.anthropic.com/en/api/messages",
    parameters: ANTHROPIC_MODEL_DEFAULT_PARAMETERS,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 官方默认值随模型变化，当前使用适合文本生成的兼容基准。",
    basis_label: "官方声明模型相关 + AgentVN 兼容基准",
    source_url: "https://ai.google.dev/api/generate-content",
    parameters: GEMINI_MODEL_DEFAULT_PARAMETERS,
  },
  qwen: {
    id: "qwen",
    label: "阿里云 Qwen",
    description: "Qwen OpenAI 兼容接口未统一声明默认值，使用稳健采样基准。",
    basis_label: "官方接口范围 + AgentVN 兼容基准",
    source_url: "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope",
    parameters: QWEN_MODEL_DEFAULT_PARAMETERS,
  },
  kimi: {
    id: "kimi",
    label: "Moonshot Kimi",
    description: "适配 Kimi 长上下文与推理模型，限制单次输出以控制结构化任务风险。",
    basis_label: "官方模型限制 + AgentVN 兼容基准",
    source_url: "https://platform.moonshot.cn/docs/api/chat",
    parameters: KIMI_MODEL_DEFAULT_PARAMETERS,
  },
  glm: {
    id: "glm",
    label: "智谱 GLM",
    description: "适配 GLM 新一代长上下文与思考模型，输出采用 AgentVN 安全上限。",
    basis_label: "官方模型能力 + AgentVN 兼容基准",
    source_url: "https://docs.bigmodel.cn/cn/guide/models/text/glm-5",
    parameters: GLM_MODEL_DEFAULT_PARAMETERS,
  },
  reasoning: {
    id: "reasoning",
    label: "通用推理 / Thinking 模型",
    description: "适合名称中明确标注 reasoner、reasoning 或 thinking 的模型。",
    basis_label: "AgentVN 通用推理兼容基准",
    parameters: REASONING_MODEL_DEFAULT_PARAMETERS,
  },
  "generic-text": {
    id: "generic-text",
    label: "通用文本模型",
    description: "未命中特定模型规则时使用的兼容基准。",
    basis_label: "AgentVN 通用兼容基准",
    parameters: GENERIC_TEXT_MODEL_DEFAULT_PARAMETERS,
  },
};

function normalizeModelName(modelName: string): string {
  return modelName.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function getModelParameterProfile(modelName = ""): ModelParameterProfile {
  const normalizedName = normalizeModelName(modelName);
  const isDeepSeekV4 = normalizedName.includes("deepseek") && normalizedName.includes("v4");

  if (isDeepSeekV4 && normalizedName.includes("pro")) return profiles["deepseek-v4-pro"];
  if (isDeepSeekV4) return profiles["deepseek-v4-flash"];
  if (normalizedName.includes("claude") || normalizedName.includes("anthropic")) return profiles.anthropic;
  if (normalizedName.includes("gemini")) return profiles.gemini;
  if (normalizedName.includes("qwen") || normalizedName.includes("qwq")) return profiles.qwen;
  if (normalizedName.includes("kimi") || normalizedName.includes("moonshot")) return profiles.kimi;
  if (normalizedName.startsWith("glm-") || normalizedName.includes("chatglm") || normalizedName.includes("zhipu")) return profiles.glm;
  if (
    normalizedName.startsWith("gpt-")
    || /^o[134](?:-|$)/.test(normalizedName)
    || normalizedName.includes("openai")
  ) {
    return profiles.openai;
  }
  if (
    normalizedName.includes("reasoner")
    || normalizedName.includes("reasoning")
    || normalizedName.includes("thinking")
    || normalizedName.includes("deepseek-r1")
  ) {
    return profiles.reasoning;
  }
  return profiles["generic-text"];
}

export function createDefaultModelParameters(modelName = ""): ProviderModelParameters {
  return { ...getModelParameterProfile(modelName).parameters };
}
