import type { GeneratedAssetRecord, ImageGenerationRequest, PromptRewriteRequest, ProviderConfig } from "./types";
import { MissingApiKeyError, UnsupportedCapabilityError } from "./providerErrors";
import { getApiKey } from "./apiKeyStorage";

export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];
  if (!config.provider_id) errors.push("缺少模型配置编号");
  if (!config.connection_id) errors.push("缺少连接编号");
  if (!config.display_name) errors.push("缺少模型显示名称");
  if (!config.model) errors.push("缺少模型名称");
  if (config.capabilities.length === 0) errors.push("至少需要选择一种模型能力");
  return errors;
}

export function assertProviderCapability(config: ProviderConfig, capability: string): void {
  if (!config.capabilities.includes(capability as never)) throw new UnsupportedCapabilityError("当前模型配置不支持该能力");
}

export function assertApiKeyIfRequired(config: ProviderConfig): void {
  if (config.api_key_storage !== "none" && !getApiKey(config.connection_id)) {
    throw new MissingApiKeyError("缺少当前模型访问密钥");
  }
}

export function validatePromptRewriteRequest(request: PromptRewriteRequest): string[] {
  return request.user_description.trim() ? [] : ["请填写素材描述"];
}

export function validateImageGenerationRequest(request: ImageGenerationRequest): string[] {
  const errors: string[] = [];
  if (!request.prompt.trim()) errors.push("请填写生成提示词");
  if (request.width <= 0 || request.height <= 0) errors.push("图片宽高必须大于 0");
  if (request.count < 1 || request.count > 8) errors.push("生成数量必须在 1 到 8 之间");
  return errors;
}

export function validateGeneratedAssetRecord(record: GeneratedAssetRecord): string[] {
  const errors: string[] = [];
  if (!record.asset_id) errors.push("缺少素材标识");
  if (!record.filename) errors.push("缺少文件名");
  if (record.blob_url?.startsWith("blob:")) errors.push("临时图片地址不能直接导出");
  return errors;
}
