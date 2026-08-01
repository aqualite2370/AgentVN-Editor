export class ProviderNotConfiguredError extends Error {}
export class MissingApiKeyError extends Error {}
export class ProviderRateLimitedError extends Error {}
export class ProviderSafetyBlockedError extends Error {}
export class ProviderNetworkError extends Error {}
export class UnsupportedCapabilityError extends Error {}
export class AssetSaveError extends Error {}

export function humanizeProviderError(error: unknown): string {
  if (error instanceof MissingApiKeyError) return "缺少访问密钥，请在模型设置中配置。";
  if (error instanceof UnsupportedCapabilityError) return "当前模型配置不支持该能力。";
  if (error instanceof ProviderSafetyBlockedError) return "请求被安全策略阻止，请调整提示词。";
  if (error instanceof ProviderRateLimitedError) return "模型服务请求过于频繁，请稍后重试。";
  if (error instanceof ProviderNetworkError) return "网络错误，请检查服务地址。";
  if (error instanceof ProviderNotConfiguredError) return "模型配置未配置或未启用。";
  if (error instanceof AssetSaveError) return "素材保存失败。";
  return error instanceof Error ? error.message : "未知错误";
}
