import type { GeneratedAssetRecord, SavedGenerationProvenance } from "../providers/types";
import { AssetSaveError } from "../providers/providerErrors";
import { validateGeneratedAssetRecord } from "../providers/validation";
import type { AssetType } from "../types/assets";
import { buildProjectAssetPath, sanitizeAssetId } from "../utils/projectAssets";
import type { GeneratedAssetCandidate } from "./session";

export interface SaveGeneratedAssetCandidateOptions {
  assetType: AssetType | "other";
  usedAssetIds: Set<string>;
  licenseNote?: string;
  displayName?: string;
  generation?: SavedGenerationProvenance;
  outputMimeType?: "image/png" | "image/jpeg" | "image/webp";
  now?: () => string;
  fetchImpl?: typeof fetch;
}

function uniqueAssetId(base: string, usedIds: Set<string>): string {
  const root = sanitizeAssetId(base);
  let candidate = root;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = sanitizeAssetId(root + "_" + index);
    index += 1;
  }
  return candidate;
}

function mimeTypeFromDataUrl(dataUrl: string, fallback: string): string {
  const match = dataUrl.match(/^data:([^;,]+)[;,]/);
  return match?.[1] || fallback || "image/png";
}

function extensionFromMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as unknown as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob: Blob, fallbackMimeType: string): Promise<string> {
  const mimeType = blob.type || fallbackMimeType || "image/png";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return "data:" + mimeType + ";base64," + bytesToBase64(bytes);
}

async function imageUrlToDataUrl(source: string, fallbackMimeType: string, fetchImpl: typeof fetch): Promise<string> {
  if (source.startsWith("data:")) return source;
  try {
    const response = await fetchImpl(source);
    const blob = await response.blob();
    return await blobToDataUrl(blob, fallbackMimeType);
  } catch (error) {
    throw new AssetSaveError(
      "无法把生成图片转换为可导出的 data_url：" + (error instanceof Error ? error.message : String(error)),
    );
  }
}

async function convertDataUrl(dataUrl: string, outputMimeType?: SaveGeneratedAssetCandidateOptions["outputMimeType"]): Promise<string> {
  if (!outputMimeType || mimeTypeFromDataUrl(dataUrl, "") === outputMimeType) return dataUrl;
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new AssetSaveError("无法解码图片以转换保存格式。"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new AssetSaveError("当前环境不支持图片格式转换。");
  if (outputMimeType === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0);
  return canvas.toDataURL(outputMimeType, outputMimeType === "image/png" ? undefined : 0.92);
}

export async function saveGeneratedAssetCandidate(
  candidate: GeneratedAssetCandidate,
  options: SaveGeneratedAssetCandidateOptions,
): Promise<GeneratedAssetRecord> {
  if (!candidate.canSave) {
    throw new AssetSaveError(candidate.saveBlockedReason || "当前生成图片不能保存入素材库。");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sourceDataUrl = await imageUrlToDataUrl(candidate.blob_url, candidate.mime_type, fetchImpl);
  const dataUrl = await convertDataUrl(sourceDataUrl, options.outputMimeType);
  const mimeType = mimeTypeFromDataUrl(dataUrl, candidate.mime_type);
  const assetId = uniqueAssetId(candidate.image_id || "generated_" + Date.now(), options.usedAssetIds);
  const extension = extensionFromMimeType(mimeType);
  const filename = assetId + "." + extension;
  const createdAt = (options.now ?? (() => new Date().toISOString()))();
  const record: GeneratedAssetRecord = {
    asset_id: assetId,
    asset_type: options.assetType,
    display_name: options.displayName?.trim() || assetId,
    filename,
    mime_type: mimeType,
    source: "generated",
    provider_id: candidate.providerId,
    model: candidate.model,
    prompt: candidate.revisedPrompt || candidate.prompt,
    created_at: createdAt,
    license_note: options.licenseNote?.trim() || undefined,
    project_path: buildProjectAssetPath(options.assetType, assetId, filename),
    blob_url: dataUrl,
    generation: options.generation,
  };
  const errors = validateGeneratedAssetRecord(record);
  if (errors.length > 0) throw new AssetSaveError(errors.join("；"));
  return record;
}
