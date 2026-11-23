import type { AssetRef } from "../types/assets";

export interface StandaloneIconAppearance {
  standaloneIconAssetId?: string;
  iconAssetId?: string;
  coverAssetId?: string;
}

export interface StandaloneIconSelection {
  assetId?: string;
  asset?: AssetRef;
}

export interface StandaloneIconSource {
  blob: Blob;
  fileName: string;
  sourceKind: "bytes" | "dataUrl" | "blobUrl" | "url" | "filePath";
}

interface StandaloneIconReadDependencies {
  fetch?: typeof globalThis.fetch;
  readDesktopFile?: (filePath: string) => Promise<Uint8Array | undefined>;
}

function trimmed(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function safeIconFileName(asset: AssetRef): string {
  const original = trimmed(asset.metadata.filename) ?? `${asset.asset_id}.png`;
  return original.replace(/[\\/:*?"<>|]+/g, "_") || `${asset.asset_id}.png`;
}

function mimeTypeForAsset(asset: AssetRef): string {
  return trimmed(asset.metadata.mime_type) ?? "application/octet-stream";
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function resolveStandaloneIconAsset(
  appearance: StandaloneIconAppearance | undefined,
  assets: AssetRef[],
): StandaloneIconSelection {
  const assetId = trimmed(appearance?.standaloneIconAssetId)
    ?? trimmed(appearance?.iconAssetId)
    ?? trimmed(appearance?.coverAssetId);
  return {
    assetId,
    asset: assetId ? assets.find((asset) => asset.asset_id === assetId) : undefined,
  };
}

async function defaultReadDesktopFile(filePath: string): Promise<Uint8Array | undefined> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  const bytes = await invoke<number[]>("read_project_asset_file_bytes", { filePath });
  return new Uint8Array(bytes);
}

async function fetchBlob(
  fetchImpl: typeof globalThis.fetch,
  source: string,
): Promise<Blob> {
  const response = await fetchImpl(source, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

export async function readStandaloneIconSourceBlob(
  asset: AssetRef,
  dependencies: StandaloneIconReadDependencies = {},
): Promise<StandaloneIconSource> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const readDesktopFile = dependencies.readDesktopFile ?? defaultReadDesktopFile;
  const mimeType = mimeTypeForAsset(asset);
  const fileName = safeIconFileName(asset);
  const failures: string[] = [];

  const directBytes = asset.metadata.bytes;
  if (directBytes && directBytes.byteLength > 0) {
    return {
      blob: new Blob([copyBytes(directBytes)], { type: mimeType }),
      fileName,
      sourceKind: "bytes",
    };
  }

  const fetchSources: Array<{ sourceKind: StandaloneIconSource["sourceKind"]; value?: string }> = [
    { sourceKind: "dataUrl", value: asset.metadata.data_url?.startsWith("data:") ? asset.metadata.data_url : undefined },
    { sourceKind: "blobUrl", value: asset.metadata.blob_url?.startsWith("blob:") ? asset.metadata.blob_url : undefined },
    { sourceKind: "url", value: trimmed(asset.metadata.url) },
  ];
  for (const candidate of fetchSources) {
    if (!candidate.value) continue;
    try {
      return {
        blob: await fetchBlob(fetchImpl, candidate.value),
        fileName,
        sourceKind: candidate.sourceKind,
      };
    } catch (error) {
      failures.push(`${candidate.sourceKind}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const filePath = trimmed(asset.metadata.filePath);
  if (filePath) {
    try {
      const bytes = await readDesktopFile(filePath);
      if (bytes && bytes.byteLength > 0) {
        return {
          blob: new Blob([copyBytes(bytes)], { type: mimeType }),
          fileName,
          sourceKind: "filePath",
        };
      }
      failures.push("filePath: empty or unavailable");
    } catch (error) {
      failures.push(`filePath: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const detail = failures.length > 0 ? `（${failures.join("；")}）` : "";
  throw new Error(`软件包图标素材 ${asset.asset_id} 没有可读取的图片数据${detail}。`);
}
