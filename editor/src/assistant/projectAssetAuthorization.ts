import type { AssetRef } from "../types/assets";
import { readStandaloneIconSourceBlob } from "../packaging/standaloneIcon";
import type { AssistantCreationAuthorizedAsset } from "./creationAgent";

const supportedMimes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const mimeByExtension: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
const maxAssetBytes = 8 * 1024 * 1024;

export function projectCreationAssetMime(asset: AssetRef): string | undefined {
  const mime = asset.metadata.mime_type?.trim().toLowerCase()
    || mimeByExtension[asset.metadata.filename?.split(".").slice(-1)[0]?.toLowerCase() ?? ""];
  return mime && supportedMimes.has(mime) && asset.metadata.placeholder !== true ? mime : undefined;
}

function imageSignatureMatches(bytes: Uint8Array, mime: string): boolean {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (mime === "image/png") return starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (mime === "image/jpeg") return starts(255, 216, 255);
  if (mime === "image/gif") return starts(71, 73, 70, 56) && [55, 57].includes(bytes[4]) && bytes[5] === 97;
  return starts(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

/** Read only the selected project assets. Metadata and paths never leave this module. */
export async function readProjectCreationAssetAuthorization(
  assets: readonly AssetRef[], selectedIds: readonly string[],
): Promise<{ context: Array<{ id: string; filename: string; mime_type: string }>; assets: AssistantCreationAuthorizedAsset[] }> {
  if (selectedIds.length > 16 || new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("每个创造会话最多授权 16 张工程图片，且不能重复选择。");
  }
  const selected = selectedIds.map(id => {
    const matches = assets.filter(asset => asset.asset_id === id);
    if (matches.length !== 1) throw new Error("选中的工程素材已移除或编号重复；请重新选择。");
    return matches[0];
  });
  const copies: AssistantCreationAuthorizedAsset[] = [];
  let total = 0;
  for (const [index, asset] of selected.entries()) {
    const mimeType = projectCreationAssetMime(asset);
    if (!mimeType) throw new Error("当前组件只支持 PNG、JPEG、WebP、GIF 工程图片；请选择兼容素材。");
    if ((asset.metadata.size_bytes ?? 0) > maxAssetBytes || (asset.metadata.bytes?.byteLength ?? 0) > maxAssetBytes) {
      throw new Error("工程图片不能超过 8 MiB。");
    }
    let bytes: Uint8Array;
    try {
      const source = await readStandaloneIconSourceBlob({ ...asset, metadata: { ...asset.metadata, mime_type: mimeType } }, {
        fetch: async (input, init) => {
          const response = await fetch(input, { ...init, signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error("Source unavailable");
          if (Number(response.headers.get("content-length")) > maxAssetBytes) throw new Error("Image too large");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Source unavailable");
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > maxAssetBytes) throw new Error("Image too large");
              chunks.push(value);
            }
          } finally {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
          const copy = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) { copy.set(chunk, offset); offset += chunk.byteLength; }
          return new Response(copy.buffer, { headers: { "content-type": mimeType } });
        },
      });
      if (!source.blob.size || source.blob.size > maxAssetBytes) throw new Error("Image empty or too large");
      bytes = new Uint8Array(await source.blob.arrayBuffer());
    } catch {
      // File paths, source URLs and raw backend errors are private local diagnostics.
      throw new Error(`工程图片“${asset.metadata.display_name || "未命名图片"}”读取失败或超过 8 MiB；未发起模型请求。`);
    }
    if (!imageSignatureMatches(bytes, mimeType)) throw new Error("工程图片内容与声明格式不一致；未发起模型请求。");
    total += bytes.byteLength;
    if (total > 32 * 1024 * 1024) throw new Error("本次授权素材总量超过 32 MiB，未发起模型请求。");
    copies.push({ id: `project-asset-${index + 1}`,
      filename: (asset.metadata.filename || `图片-${index + 1}.${mimeType.split("/")[1]}`)
        .split(/[\\/]/).slice(-1)[0].replace(/[:*?"<>|\u0000-\u001f]/g, "_").slice(0, 255),
      mimeType, bytes: new Uint8Array(bytes) });
  }
  return { context: copies.map(({ id, filename, mimeType }) => ({ id, filename, mime_type: mimeType })), assets: copies };
}
