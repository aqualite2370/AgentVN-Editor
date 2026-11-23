import { fetchNativeAnimationAsset, NATIVE_ANIMATION_MAX_BYTES, parseNativeAnimationAsset } from "../../../shared/animation/nativeAnimationAsset";
import type { AssetRef } from "../types/assets";

/** Same managed sources as cartridge packaging; no new arbitrary filesystem access. */
export async function readEditorAnimationAsset(asset: AssetRef): Promise<string> {
  if (asset.asset_type !== "animation") throw new Error(`素材 ${asset.asset_id} 不是动画。`);
  const meta = asset.metadata;
  if (meta.bytes) {
    if (meta.bytes.byteLength > NATIVE_ANIMATION_MAX_BYTES) throw new Error("动画素材超过 1 MiB。");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(meta.bytes);
  }
  const url = meta.data_url || meta.blob_url || meta.url;
  if (url) {
    try { return await fetchNativeAnimationAsset(url); }
    catch (error) { if (!meta.filePath) throw error; }
  }
  if (meta.filePath && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("read_project_asset_file_bytes", { filePath: meta.filePath });
    if (bytes.length > NATIVE_ANIMATION_MAX_BYTES) throw new Error("动画素材超过 1 MiB。");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes));
  }
  throw new Error(`动画素材 ${asset.asset_id} 无法读取，请重新导入或替换文件。`);
}

export async function inspectEditorAnimationAsset(asset: AssetRef) {
  return parseNativeAnimationAsset(await readEditorAnimationAsset(asset), asset.metadata.filename || asset.asset_id);
}
