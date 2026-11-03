import JSZip from "jszip";
import { parseCustomComponentMarkup, type CustomComponentDefinition } from "./customComponentMarkup";

const ARCHIVE_FORMAT = "agentvn-component-library";
const SCHEMA_VERSION = 1;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 64;
const MAX_COMPONENTS = 32;
const MAX_ASSETS_PER_COMPONENT = 16;
const MAX_COMPRESSION_RATIO = 100;
const ALLOWED_ASSET_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "font/woff", "font/woff2", "font/ttf", "font/otf",
  "application/font-woff", "application/x-font-ttf", "application/vnd.ms-opentype",
]);

export interface CustomComponentArchiveAssetInput {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface CustomComponentArchiveItemInput {
  id: string;
  name: string;
  description?: string;
  html: string;
  css: string;
  assets?: CustomComponentArchiveAssetInput[];
}

export interface ScannedCustomComponentAsset {
  id: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ScannedCustomComponent {
  id: string;
  name: string;
  description?: string;
  html: string;
  css: string;
  definition: CustomComponentDefinition;
  assets: ScannedCustomComponentAsset[];
}

export type CustomComponentArchiveScan =
  | { ok: true; components: ScannedCustomComponent[]; issues: [] }
  | { ok: false; components: []; issues: string[] };

interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  schemaVersion: number;
  components: Array<{
    id: string;
    name: string;
    description?: string;
    html: string;
    css: string;
    assets: Array<{
      id: string;
      filename: string;
      mimeType: string;
      path: string;
      sha256: string;
    }>;
  }>;
}

interface CentralEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  flags: number;
  externalAttributes: number;
  versionMadeBy: number;
}

function referencedAssetIds(definition: CustomComponentDefinition): Set<string> {
  const ids = new Set<string>();
  const visit = (node: CustomComponentDefinition["root"]) => {
    if (node.assetId) ids.add(node.assetId);
    node.children.forEach(visit);
  };
  visit(definition.root);
  return ids;
}

function requireDeclaredAssets(
  definition: CustomComponentDefinition,
  declaredIds: Set<string>,
  componentName: string,
): void {
  for (const assetId of referencedAssetIds(definition)) {
    if (!declaredIds.has(assetId))
      throw new Error(`组件“${componentName}”引用了未声明素材“${assetId}”。`);
  }
}

function safePackageName(value: string, label: string): void {
  if (!value.trim() || value.length > 160 || /[\u0000-\u001f]/.test(value))
    throw new Error(`${label}无效或超出长度限制。`);
}

function safeAssetFilename(value: string): boolean {
  return value.length > 0 && value.length <= 180
    && !/[\\/\u0000-\u001f]/.test(value)
    && value !== "." && value !== "..";
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("当前环境无法执行 SHA-256 完整性校验。");
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return hex(new Uint8Array(await subtle.digest("SHA-256", copy)));
}

function inspectCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("ZIP 文件为空、损坏或超过 20 MiB 限制。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP 缺少有效的中央目录结束记录。");
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (endOffset + 22 + commentLength !== bytes.byteLength)
    throw new Error("ZIP 结束记录或注释长度无效。");
  if (disk || centralDisk || diskEntries !== entryCount)
    throw new Error("不支持分卷或多磁盘 ZIP。");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff)
    throw new Error("不支持 ZIP64 组件包。");
  if (entryCount < 1 || entryCount > MAX_ARCHIVE_ENTRIES)
    throw new Error(`组件包文件数必须在 1 到 ${MAX_ARCHIVE_ENTRIES} 个之间。`);
  if (centralOffset + centralSize > endOffset || centralOffset < 0)
    throw new Error("ZIP 中央目录位置无效。");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: CentralEntry[] = [];
  const seen = new Set<string>();
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > centralOffset + centralSize || view.getUint32(offset, true) !== 0x02014b50)
      throw new Error("ZIP 中央目录条目损坏。");
    const versionMadeBy = view.getUint16(offset + 4, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const externalAttributes = view.getUint32(offset + 38, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralOffset + centralSize) throw new Error("ZIP 文件名或扩展字段越界。");
    let name: string;
    try {
      name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      throw new Error("ZIP 文件名不是有效 UTF-8。");
    }
    const normalized = name.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(normalized)) throw new Error(`ZIP 包含重复文件名“${name}”。`);
    seen.add(normalized);
    if (!name || name.startsWith("/") || name.includes("\\") || /^[a-z]:/i.test(name)
      || name.split("/").some((part) => !part || part === "." || part === ".."))
      throw new Error(`ZIP 包含不安全路径“${name}”。`);
    if (flags & 0x2041) throw new Error(`ZIP 文件“${name}”使用了不支持的加密或屏蔽头格式。`);
    if (method !== 0 && method !== 8) throw new Error(`ZIP 文件“${name}”使用了不支持的压缩算法。`);
    const operatingSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (operatingSystem === 3 && (unixMode & 0xf000) === 0xa000)
      throw new Error(`ZIP 文件“${name}”是符号链接。`);
    if (uncompressedSize > MAX_ENTRY_BYTES)
      throw new Error(`ZIP 文件“${name}”超过单文件 8 MiB 限制。`);
    if (uncompressedSize > 0 && (compressedSize === 0
      || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO))
      throw new Error(`ZIP 文件“${name}”的压缩比超过安全上限。`);
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES)
      throw new Error("ZIP 解压总量超过 32 MiB 限制。");
    if (name === "manifest.json" && uncompressedSize > MAX_MANIFEST_BYTES)
      throw new Error("组件清单超过 1 MiB 限制。");
    if (name !== "manifest.json" && !/^assets\/[0-9]+-[0-9]+\.bin$/.test(name))
      throw new Error(`ZIP 包含未声明的文件“${name}”。`);
    entries.push({ name, compressedSize, uncompressedSize, method, flags, externalAttributes, versionMadeBy });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP 中央目录长度与条目数不一致。");
  if (!seen.has("manifest.json")) throw new Error("组件包缺少 manifest.json。");
  return entries;
}

export async function exportCustomComponentArchive(
  components: CustomComponentArchiveItemInput[],
): Promise<Uint8Array> {
  if (!Array.isArray(components) || components.length < 1 || components.length > MAX_COMPONENTS)
    throw new Error(`每个组件包必须包含 1 到 ${MAX_COMPONENTS} 个组件。`);
  const zip = new JSZip();
  const ids = new Set<string>();
  const manifest: ArchiveManifest = { format: ARCHIVE_FORMAT, schemaVersion: SCHEMA_VERSION, components: [] };
  let totalAssetBytes = 0;
  for (const [componentIndex, component] of components.entries()) {
    safePackageName(component.id, "组件 ID");
    safePackageName(component.name, "组件名称");
    if (ids.has(component.id)) throw new Error(`组件 ID“${component.id}”重复。`);
    ids.add(component.id);
    const parsed = parseCustomComponentMarkup(component.html, component.css);
    if (!parsed.ok) throw new Error(`组件“${component.name}”未通过安全解析：${parsed.issues.join(" ")}`);
    const assets = component.assets ?? [];
    if (assets.length > MAX_ASSETS_PER_COMPONENT) throw new Error("单个组件素材数量超过限制。");
    const assetIds = new Set<string>();
    requireDeclaredAssets(parsed.component!, new Set(assets.map((asset) => asset.id)), component.name);
    const packedAssets: ArchiveManifest["components"][number]["assets"] = [];
    for (const [assetIndex, asset] of assets.entries()) {
      safePackageName(asset.id, "素材 ID");
      if (assetIds.has(asset.id)) throw new Error(`组件“${component.name}”的素材 ID 重复。`);
      assetIds.add(asset.id);
      if (!safeAssetFilename(asset.filename) || !ALLOWED_ASSET_TYPES.has(asset.mimeType))
        throw new Error(`组件“${component.name}”包含不支持的素材名称或类型。`);
      if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength < 1 || asset.bytes.byteLength > MAX_ENTRY_BYTES)
        throw new Error(`素材“${asset.filename}”为空或超过 8 MiB 限制。`);
      totalAssetBytes += asset.bytes.byteLength;
      if (totalAssetBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("组件素材总量超过 32 MiB 限制。");
      const archivePath = `assets/${componentIndex}-${assetIndex}.bin`;
      zip.file(archivePath, asset.bytes, { createFolders: false });
      packedAssets.push({
        id: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        path: archivePath,
        sha256: await digest(asset.bytes),
      });
    }
    manifest.components.push({
      id: component.id,
      name: component.name,
      ...(component.description ? { description: component.description.slice(0, 1000) } : {}),
      html: component.html,
      css: component.css,
      assets: packedAssets,
    });
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error("组件清单超过 1 MiB 限制。");
  zip.file("manifest.json", manifestBytes);
  const result = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (result.byteLength > MAX_ARCHIVE_BYTES) throw new Error("生成的组件包超过 20 MiB 限制。");
  return result;
}

function parseManifest(value: unknown): ArchiveManifest {
  if (!value || typeof value !== "object") throw new Error("组件清单格式无效。");
  const manifest = value as Partial<ArchiveManifest>;
  if (manifest.format !== ARCHIVE_FORMAT) throw new Error("文件不是 AgentVN 组件包。");
  if (manifest.schemaVersion !== SCHEMA_VERSION) throw new Error(`不支持组件包版本 ${String(manifest.schemaVersion)}。`);
  if (!Array.isArray(manifest.components) || manifest.components.length < 1
    || manifest.components.length > MAX_COMPONENTS) throw new Error("组件清单中的组件数量无效。");
  return manifest as ArchiveManifest;
}

export async function scanCustomComponentArchive(bytes: Uint8Array): Promise<CustomComponentArchiveScan> {
  try {
    const centralEntries = inspectCentralDirectory(bytes);
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
    const zipEntries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (zipEntries.length !== centralEntries.length) throw new Error("ZIP 中存在重复或不一致的文件条目。");
    const centralByName = new Map(centralEntries.map((entry) => [entry.name, entry]));
    for (const entry of zipEntries) {
      if ((entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) || !centralByName.has(entry.name))
        throw new Error(`ZIP 文件“${entry.name}”路径规范化前后不一致。`);
    }
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) throw new Error("组件包缺少 manifest.json。");
    const manifestBytes = await manifestEntry.async("uint8array");
    const manifest = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)));
    const expectedFiles = new Set(["manifest.json"]);
    const ids = new Set<string>();
    const scanned: ScannedCustomComponent[] = [];
    for (const component of manifest.components) {
      safePackageName(component.id, "组件 ID");
      safePackageName(component.name, "组件名称");
      if (ids.has(component.id)) throw new Error(`组件 ID“${component.id}”重复。`);
      ids.add(component.id);
      if (typeof component.html !== "string" || typeof component.css !== "string"
        || typeof component.assets === "undefined" || !Array.isArray(component.assets)
        || component.assets.length > MAX_ASSETS_PER_COMPONENT)
        throw new Error(`组件“${component.name}”的清单字段无效。`);
      const parsed = parseCustomComponentMarkup(component.html, component.css);
      if (!parsed.ok) throw new Error(`组件“${component.name}”未通过安全解析：${parsed.issues.join(" ")}`);
      const assetIds = new Set<string>();
      const assets: ScannedCustomComponentAsset[] = [];
      for (const asset of component.assets) {
        safePackageName(asset.id, "素材 ID");
        if (assetIds.has(asset.id)) throw new Error(`组件“${component.name}”的素材 ID 重复。`);
        assetIds.add(asset.id);
        if (!safeAssetFilename(asset.filename) || !ALLOWED_ASSET_TYPES.has(asset.mimeType)
          || !/^assets\/[0-9]+-[0-9]+\.bin$/.test(asset.path)
          || !/^[\da-f]{64}$/i.test(asset.sha256))
          throw new Error(`组件“${component.name}”包含无效素材声明。`);
        const expectedPath = `assets/${scanned.length}-${assets.length}.bin`;
        if (asset.path !== expectedPath) throw new Error(`素材“${asset.filename}”路径不符合清单顺序。`);
        expectedFiles.add(asset.path);
        const entry = zip.file(asset.path);
        if (!entry) throw new Error(`素材“${asset.filename}”缺失。`);
        const data = await entry.async("uint8array");
        if (data.byteLength > MAX_ENTRY_BYTES || await digest(data) !== asset.sha256.toLowerCase())
          throw new Error(`素材“${asset.filename}”大小或 SHA-256 校验失败。`);
        assets.push({ id: asset.id, filename: asset.filename, mimeType: asset.mimeType, bytes: data });
      }
      requireDeclaredAssets(parsed.component!, assetIds, component.name);
      scanned.push({
        id: component.id,
        name: component.name,
        ...(component.description ? { description: component.description.slice(0, 1000) } : {}),
        html: component.html,
        css: component.css,
        definition: parsed.component!,
        assets,
      });
    }
    const unexpected = centralEntries.find((entry) => !expectedFiles.has(entry.name));
    if (unexpected) throw new Error(`ZIP 包含清单未声明的文件“${unexpected.name}”。`);
    return { ok: true, components: scanned, issues: [] };
  } catch (error) {
    return {
      ok: false,
      components: [],
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}
