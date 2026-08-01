import type { GeneratedAssetRecord } from "../providers/types";
import type { AssetRef, AssetType } from "../types/assets";
import type { AssetManifestItem } from "../../../shared/cartridge/types";
import { assetTypeMatchesExpected } from "../../../shared/cartridge/assetTaxonomy";

export interface LibraryAssetRecord extends GeneratedAssetRecord {
  preview_url?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  media_warning?: string;
}

const imageFileExtensionPattern = /\.(png|jpe?g|webp|gif|bmp|svg)(?:[?#].*)?$/i;
const importedUIImageMimeByExtension: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const MAX_IMPORTED_UI_IMAGE_BYTES = 20 * 1024 * 1024;

export interface ImportedUIImageFileDescriptor {
  name: string;
  type: string;
  size: number;
}

export type ImportedUIImageValidationResult =
  | { ok: true; mimeType: string; displayName: string }
  | { ok: false; code: "empty_file" | "unsupported_extension" | "unsupported_mime_type" | "file_too_large"; message: string };

function cleanSegment(value: string): string {
  const cleaned = value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
  return Array.from(cleaned).slice(0, 64).join("");
}

export function sanitizeAssetId(value: string): string {
  const sanitized = cleanSegment(value);
  return sanitized || `asset_${Date.now()}`;
}

function fileExtension(fileName: string): string {
  const match = /\.[^.]+$/.exec(fileName.trim());
  return match?.[0].toLowerCase() ?? "";
}

function fileStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "button_image";
}

export function uniqueAssetId(base: string, usedIds: ReadonlySet<string>): string {
  const root = sanitizeAssetId(base);
  let candidate = root;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = sanitizeAssetId(`${root}_${index}`);
    index += 1;
  }
  return candidate;
}

export function validateImportedUIImageFile(file: ImportedUIImageFileDescriptor): ImportedUIImageValidationResult {
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: "empty_file", message: "图片文件为空，无法导入。" };
  }
  if (file.size > MAX_IMPORTED_UI_IMAGE_BYTES) {
    return {
      ok: false,
      code: "file_too_large",
      message: `图片不能超过 ${Math.round(MAX_IMPORTED_UI_IMAGE_BYTES / 1024 / 1024)} MB。`,
    };
  }
  const extension = fileExtension(file.name);
  const expectedMimeType = importedUIImageMimeByExtension[extension];
  if (!expectedMimeType) {
    return {
      ok: false,
      code: "unsupported_extension",
      message: "仅支持 PNG、JPEG、WebP 或 GIF 图片。",
    };
  }
  const declaredMimeType = file.type.trim().toLowerCase();
  if (declaredMimeType && declaredMimeType !== expectedMimeType) {
    return {
      ok: false,
      code: "unsupported_mime_type",
      message: `文件类型与扩展名不匹配：需要 ${expectedMimeType}。`,
    };
  }
  return {
    ok: true,
    mimeType: expectedMimeType,
    displayName: fileStem(file.name),
  };
}

export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取图片失败。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败。"));
    reader.readAsDataURL(file);
  });
}

export function createImportedUIImageAsset(
  file: ImportedUIImageFileDescriptor,
  dataUrl: string,
  usedIds: ReadonlySet<string>,
  createdAt = new Date().toISOString(),
): AssetRef {
  const validation = validateImportedUIImageFile(file);
  if (!validation.ok) throw new Error(validation.message);
  if (!dataUrl.startsWith(`data:${validation.mimeType};base64,`)) {
    throw new Error("读取到的图片数据格式与文件类型不匹配。");
  }
  const assetId = uniqueAssetId(validation.displayName, usedIds);
  return {
    asset_id: assetId,
    asset_type: "ui",
    metadata: {
      display_name: validation.displayName,
      filename: file.name,
      mime_type: validation.mimeType,
      size_bytes: file.size,
      source: "imported",
      data_url: dataUrl,
      project_path: buildProjectAssetPath("ui", assetId, file.name),
      created_at: createdAt,
      tags: ["custom_button"],
    },
  };
}

export function buildProjectAssetPath(assetType: AssetType, assetId: string, filename: string): string {
  const safeId = sanitizeAssetId(assetId);
  const safeName = filename.replace(/[\\/:*?"<>|]+/g, "_").trim() || `${safeId}.bin`;
  return `assets/${assetType}/${safeId}-${safeName}`;
}

function isSafeCartridgeAssetPath(value: string): boolean {
  if (!value || value.includes("\0")) return false;
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.split("/").includes("..")) return false;
  return normalized.startsWith("assets/") || normalized.startsWith("ui/assets/");
}

export function normalizeAssetManifestPath(assetType: AssetType, assetId: string, filename: string, candidate?: string): string {
  if (candidate) {
    const normalized = candidate.replace(/\\/g, "/");
    if (isSafeCartridgeAssetPath(normalized)) return normalized;
  }
  return buildProjectAssetPath(assetType, assetId, filename);
}

export function generatedAssetToAssetRef(asset: GeneratedAssetRecord): AssetRef {
  const assetType = asset.asset_type as AssetType;
  const filename = asset.filename ?? `${asset.asset_id}.bin`;
  return {
    asset_id: sanitizeAssetId(asset.asset_id),
    asset_type: assetType,
    metadata: {
      display_name: asset.display_name ?? filename.replace(/\.[^.]+$/, "") ?? asset.asset_id,
      filename,
      mime_type: asset.mime_type,
      source: asset.source,
      license_note: asset.license_note,
      blob_url: asset.blob_url,
      data_url: asset.blob_url?.startsWith("data:") ? asset.blob_url : undefined,
      project_path: normalizeAssetManifestPath(assetType, asset.asset_id, filename, asset.project_path),
      provider_id: asset.provider_id,
      model: asset.model,
      prompt: asset.prompt,
      generation: asset.generation as unknown as Record<string, unknown> | undefined,
      created_at: asset.created_at,
    },
  };
}

export function assetRefToLibraryRecord(asset: AssetRef): LibraryAssetRecord {
  const previewUrl = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
  return {
    asset_id: asset.asset_id,
    asset_type: asset.asset_type,
    display_name: asset.metadata.display_name,
    filename: asset.metadata.filename ?? `${asset.asset_id}.bin`,
    mime_type: asset.metadata.mime_type ?? "application/octet-stream",
    source: asset.metadata.source ?? "imported",
    license_note: asset.metadata.license_note,
    provider_id: asset.metadata.provider_id,
    model: asset.metadata.model,
    prompt: asset.metadata.prompt,
    created_at: asset.metadata.created_at ?? new Date().toISOString(),
    project_path: asset.metadata.project_path,
    blob_url: previewUrl,
    preview_url: previewUrl,
    width: asset.metadata.width,
    height: asset.metadata.height,
    duration_ms: asset.metadata.duration_ms,
    media_warning: asset.metadata.media_warning,
  };
}

export function isImagePreviewSource(
  value: string | undefined,
  options: { mimeType?: string; filename?: string; assetType?: string } = {},
): boolean {
  if (!value) return false;
  const mimeType = options.mimeType?.toLowerCase() ?? "";
  if (value.startsWith("data:image/")) return true;
  if (mimeType.startsWith("image/")) return true;
  if (imageFileExtensionPattern.test(value)) return true;
  if (options.filename && imageFileExtensionPattern.test(options.filename)) return true;
  if (value.startsWith("blob:")) {
    return options.assetType === "background" || options.assetType === "sprite" || options.assetType === "portrait" || options.assetType === "ui";
  }
  return false;
}

export function assetRefToManifestItem(asset: AssetRef): AssetManifestItem {
  const filename = asset.metadata.filename ?? `${asset.asset_id}.bin`;
  return {
    asset_id: asset.asset_id,
    asset_type: asset.asset_type,
    path: normalizeAssetManifestPath(asset.asset_type, asset.asset_id, filename, asset.metadata.project_path ?? asset.metadata.path),
    filename,
    mime_type: asset.metadata.mime_type,
    size_bytes: asset.metadata.size_bytes,
    width: asset.metadata.width,
    height: asset.metadata.height,
    duration_ms: asset.metadata.duration_ms,
    preload: asset.asset_type === "background" || assetTypeMatchesExpected(asset.asset_type, "sprite") || asset.asset_type === "font",
    tags: asset.metadata.tags,
    placeholder: asset.metadata.placeholder,
    ai_generated: asset.metadata.source === "generated",
    source_provider: asset.metadata.provider_id,
    source_model: asset.metadata.model,
    license_note: asset.metadata.license_note,
  };
}

export function manifestAssetsFromProjectAssets(assets: AssetRef[]): AssetManifestItem[] {
  return assets.map(assetRefToManifestItem);
}

export function isBackgroundSelectableAsset(asset: AssetRef): boolean {
  return asset.asset_type === "background" && Boolean(asset.asset_id);
}
