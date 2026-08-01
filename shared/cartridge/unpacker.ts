import JSZip from "jszip";
import { verifyChecksumManifest } from "./checksum";
import { validateCartridgeStructure, validateChecksumManifest, validateFileSizeLimits, validateNoExecutableFiles, validateSafePaths } from "./validators";
import { DEFAULT_UI_LAYOUT_PATH, validateUISkinLayout } from "./uiSkin";
import { assetIdFromUILayoutReference } from "./uiAssetReference";
import type { CartridgeImportOptions, CartridgePackage, ChecksumManifest, GalleryManifest, GameManifest, RuntimeScript } from "./types";
import type { UISkinLayout } from "./uiSkin";

async function readJson<T>(zip: JSZip, path: string): Promise<T> {
  const file = zip.file(path);
  if (!file) throw new Error(`卡带缺少必要文件（${path}）：原因：.vncart 内没有找到 ${path}。影响：GameCLI 无法读取卡带。解决方案：请从编辑器重新导出 .vncart，不要手动删除卡带内部文件。`);
  try {
    return JSON.parse(await file.async("string")) as T;
  } catch (error) {
    throw new Error(`卡带文件解析失败（${path}）：原因：${error instanceof Error ? error.message : String(error)}。影响：GameCLI 无法读取该 JSON 文件。解决方案：请重新导出卡带；如果手工修改过，请确认 ${path} 是合法 JSON。`);
  }
}

export async function loadCartridgeFromFile(file: File, options: CartridgeImportOptions): Promise<CartridgePackage> {
  if (file.stream) {
    return loadCartridgeFromReadableStream(file.stream(), { ...options, sourceFileName: file.name } as CartridgeImportOptions & { sourceFileName?: string });
  }
  return loadCartridgeFromArrayBuffer(await file.arrayBuffer(), { ...options, sourceFileName: file.name } as CartridgeImportOptions & { sourceFileName?: string });
}

export async function loadCartridgeFromReadableStream(stream: ReadableStream<Uint8Array>, options: CartridgeImportOptions & { sourceFileName?: string }): Promise<CartridgePackage> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const maxBytes = (options.maxPackageSizeMB ?? 2048) * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) throw new Error(`卡带总体积超过限制（package size）：当前读取体积已经超过 ${Math.round(maxBytes / 1024 / 1024)}MB。原因：卡带素材总量过大。影响：GameCLI 可能导入失败或占用过多内存。解决方案：请压缩素材、删除未使用资源，或拆分项目后重新导出。`);
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return loadCartridgeFromArrayBuffer(merged.buffer, options);
}

export async function loadCartridgeFromArrayBuffer(buffer: ArrayBuffer, options: CartridgeImportOptions & { sourceFileName?: string }): Promise<CartridgePackage> {
  const zip = await JSZip.loadAsync(buffer);
  const paths = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  const structure = validateCartridgeStructure(paths);
  const safe = validateSafePaths(paths);
  const executable = validateNoExecutableFiles(paths);
  const sizes = validateFileSizeLimits(paths.map((path) => {
    const internal = zip.files[path] as unknown as { _data?: { uncompressedSize?: number } };
    return { path, size: internal._data?.uncompressedSize ?? 0 };
  }), options.maxSingleFileSizeMB, options.maxPackageSizeMB);
  const errors = [...structure.errors, ...safe.errors, ...executable.errors, ...sizes.errors];
  if (errors.length > 0) throw new Error(`卡带结构校验失败：${errors.map((error) => error.message).join("; ")}`);

  const manifest = await readCartridgeManifest(zip);
  const script = await readCartridgeScript(zip);
  const gallery = await readCartridgeGallery(zip);
  const uiSkin = await readCartridgeUISkin(zip, manifest);
  if (uiSkin) {
    const uiValidation = validateUISkinLayout(uiSkin);
    if (!uiValidation.ok) throw new Error(uiValidation.errors.map((error) => error.message).join("; "));
  }
  const checksum = await readCartridgeChecksum(zip);
  const checksumValidation = validateChecksumManifest(checksum);
  if (!checksumValidation.ok) throw new Error(`校验清单无效（checksum.json）：${checksumValidation.errors.map((error) => error.message).join("; ")}`);
  const fileBuffers = new Map<string, ArrayBuffer>();
  for (const entry of checksum.files) {
    const file = zip.file(entry.path);
    if (file) fileBuffers.set(entry.path, await file.async("arraybuffer"));
  }
  const verified = await verifyChecksumManifest(checksum, fileBuffers);
  if (!verified.ok) throw new Error(`卡带完整性校验失败（checksum.json）：${verified.errors.join("; ")}`);
  const assetBlobUrls = await extractAssetBlobUrls(zip, manifest);
  const uiAssetBlobUrls = uiSkin ? await extractUISkinAssetBlobUrls(zip, uiSkin, assetBlobUrls) : undefined;
  return { manifest, script, gallery, checksum, uiSkin, assetBlobUrls, uiAssetBlobUrls, sourceFileName: options.sourceFileName };
}

export async function readCartridgeManifest(zip: JSZip): Promise<GameManifest> {
  return readJson<GameManifest>(zip, "manifest.json");
}

export async function readCartridgeScript(zip: JSZip): Promise<RuntimeScript> {
  return readJson<RuntimeScript>(zip, "script.json");
}

export async function readCartridgeGallery(zip: JSZip): Promise<GalleryManifest> {
  return zip.file("gallery.json") ? readJson<GalleryManifest>(zip, "gallery.json") : { gallery_version: "1.0.0", items: [] };
}

export async function readCartridgeUISkin(zip: JSZip, manifest: GameManifest): Promise<UISkinLayout | undefined> {
  const skinPath = manifest.ui_skin?.path ?? (zip.file(DEFAULT_UI_LAYOUT_PATH) ? DEFAULT_UI_LAYOUT_PATH : undefined);
  if (!skinPath || !zip.file(skinPath)) return undefined;
  return readJson<UISkinLayout>(zip, skinPath);
}

export async function readCartridgeChecksum(zip: JSZip): Promise<ChecksumManifest> {
  return readJson<ChecksumManifest>(zip, "checksum.json");
}

export async function extractAssetBlobUrls(zip: JSZip, manifest: GameManifest): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const asset of manifest.assets) {
    const file = zip.file(asset.path);
    if (!file) continue;
    const buffer = await file.async("arraybuffer");
    const url = URL.createObjectURL(new Blob([buffer], { type: asset.mime_type || "application/octet-stream" }));
    urls[asset.asset_id] = url;
    urls[asset.path] = url;
  }
  return urls;
}

export async function extractUISkinAssetBlobUrls(
  zip: JSZip,
  uiSkin: UISkinLayout,
  manifestAssetBlobUrls: Record<string, string> = {},
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (const asset of uiSkin.assets ?? []) {
    const file = zip.file(asset.path);
    if (!file) continue;
    const url = URL.createObjectURL(await file.async("blob"));
    urls[asset.asset_id] = url;
    urls[asset.path] = url;
  }
  for (const screen of uiSkin.screens) {
    for (const component of screen.components) {
      const reference = component.style?.backgroundImage;
      const assetId = assetIdFromUILayoutReference(reference);
      if (!reference || !assetId) continue;
      const url = manifestAssetBlobUrls[assetId];
      if (!url) continue;
      urls[assetId] = url;
      urls[reference] = url;
    }
  }
  return urls;
}

export function disposeAssetBlobUrls(urls: Record<string, string>): void {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url);
}
