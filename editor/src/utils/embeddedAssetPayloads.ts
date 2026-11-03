import type { EditorProjectFile } from "../types/nodes";

export const embeddedProjectPayloadImportLimitBytes = 512 * 1024 * 1024;
// Keep this below the file guard, but high enough for large complete projects
// that intentionally embed generated backgrounds, UI art, and transparent
// sprites. Smaller timeline backups still strip payloads before writing.
export const embeddedProjectPayloadInlineLimitChars = 448 * 1024 * 1024;

export interface EmbeddedAssetPayloadStats {
  count: number;
  totalChars: number;
}

export function isEmbeddedAssetPayload(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

export function countEmbeddedAssetPayloads(value: unknown): EmbeddedAssetPayloadStats {
  const seen = new WeakSet<object>();
  const stats: EmbeddedAssetPayloadStats = { count: 0, totalChars: 0 };

  function visit(item: unknown): void {
    if (isEmbeddedAssetPayload(item)) {
      stats.count += 1;
      stats.totalChars += item.length;
      return;
    }
    if (!item || typeof item !== "object") return;
    if (seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    Object.values(item as Record<string, unknown>).forEach(visit);
  }

  visit(value);
  return stats;
}

export function stripEmbeddedAssetPayloads<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if ((key === "data_url" || key === "blob_url" || key === "dataUrl") && isEmbeddedAssetPayload(item)) return undefined;
    return item;
  })) as T;
}

export function stripEmbeddedAssetPayloadsFromProject(project: EditorProjectFile): EditorProjectFile {
  return stripEmbeddedAssetPayloads(project);
}
