import { renpyGUIErrors } from "../../../shared/cartridge/renpyGui";
import type { RenpyGuiArchiveScan, RenpyGuiAssetCandidate } from "./renpyGuiImport";
import { hasExpectedSignature, RENPY_GUI_IMPORT_LIMITS } from "./renpyGuiImport";
import type { RenpyGuiAssetBinding } from "./renpyGuiImportPlan";

export const GUI_PACK_BLOCKING_ISSUES = new Set([
  "invalid_archive", "unsafe_path", "symbolic_link", "archive_limit",
  "missing_gui", "ambiguous_gui", "invalid_encoding",
]);
const bindings = new Set(["title_background", "dialog_panel", "choice_button", "interface_font",
  "button_normal", "button_hover", "button_selected", "button_disabled"]);
export interface GuiPackSummary {
  id: string; name: string; sourceName: string; createdAt: string; revision: number; parentId?: string;
  assetCount: number; issueCount: number;
}
export interface GuiPackRecord extends GuiPackSummary {
  schemaVersion: 1;
  scan: RenpyGuiArchiveScan;
  parameterSelection: Record<string, boolean>;
  assetBindings: Record<string, RenpyGuiAssetBinding | undefined>;
}
type StoredPack = Omit<GuiPackRecord, "scan"> & {
  scan: Omit<RenpyGuiArchiveScan, "assets"> & {
    assets: Array<Omit<RenpyGuiAssetCandidate, "bytes"> & { bytesBase64: string }>;
  };
};
const validId = (id: string) => /^gui-pack-[a-z0-9-]{8,80}$/.test(id);
function fail(message: string): never { throw new Error(`GUI_PACK_INVALID: ${message}`); }
function base64(bytes: Uint8Array) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
}
function validateScan(scan: RenpyGuiArchiveScan) {
  if (!scan?.parameters || renpyGUIErrors(scan.parameters.values).length || !Array.isArray(scan.issues)
    || !Array.isArray(scan.assets) || scan.assets.length > RENPY_GUI_IMPORT_LIMITS.entries
    || scan.issues.some(issue => GUI_PACK_BLOCKING_ISSUES.has(issue.code))) fail("扫描结果被阻止或静态参数无效。");
  const paths = new Set<string>(); let total = 0;
  for (const asset of scan.assets) {
    const path = asset.path;
    if (!path || path.length > 2048 || /[\\:\u0000-\u001f]/.test(path) || path.startsWith("/")
      || path.split("/").some(part => !part || part === "." || part === "..")) fail("素材路径不安全。");
    const key = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (paths.has(key)) fail("素材路径重名。"); paths.add(key);
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
    const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
      ".ttf": "font/ttf", ".otf": "font/otf", ".woff2": "font/woff2" }[extension];
    if (!(asset.bytes instanceof Uint8Array) || !mime || mime !== asset.mimeType
      || asset.kind !== (mime.startsWith("image/") ? "image" : "font")
      || asset.sizeBytes !== asset.bytes.byteLength || !hasExpectedSignature(extension, asset.bytes)
      || asset.bytes.byteLength > RENPY_GUI_IMPORT_LIMITS.fileBytes) fail(`素材格式或大小无效：${path}`);
    total += asset.bytes.byteLength;
  }
  if (total > RENPY_GUI_IMPORT_LIMITS.totalUncompressedBytes) fail("素材总大小超限。");
}
export function createGuiPack(scan: RenpyGuiArchiveScan, options: {
  name: string; sourceName: string; parameterSelection: Record<string, boolean>;
  assetBindings: Record<string, RenpyGuiAssetBinding | undefined>; assetPaths: string[]; previous?: GuiPackSummary;
}): GuiPackRecord {
  validateScan(scan);
  const selected = new Set(options.assetPaths);
  const curated = structuredClone(scan);
  curated.assets = curated.assets.filter(asset => selected.has(asset.path));
  if (selected.size !== curated.assets.length) fail("已选素材与扫描结果不一致。");
  if (!curated.assets.length && !Object.values(options.parameterSelection).some(Boolean)) fail("没有选择资源或参数。");
  const record: GuiPackRecord = {
    schemaVersion: 1, id: `gui-pack-${crypto.randomUUID()}`, name: options.name.trim(),
    sourceName: options.sourceName.split(/[\\/]/).slice(-1)[0] ?? "", createdAt: new Date().toISOString(),
    revision: options.previous ? options.previous.revision + 1 : 1, parentId: options.previous?.id,
    scan: curated, parameterSelection: { ...options.parameterSelection },
    assetBindings: Object.fromEntries(Object.entries(options.assetBindings).filter(([path]) => selected.has(path))),
    assetCount: curated.assets.length, issueCount: curated.issues.length,
  };
  // Use the same decoder for new records and disk records.
  return decodeGuiPack(encodeGuiPack(record));
}
export function encodeGuiPack(pack: GuiPackRecord): string {
  return JSON.stringify({ ...pack, scan: { ...pack.scan,
    assets: pack.scan.assets.map(({ bytes, ...asset }) => ({ ...asset, bytesBase64: base64(bytes) })) } });
}
export function decodeGuiPack(payload: string): GuiPackRecord {
  if (payload.length > 190 * 1024 * 1024) fail("资源包记录过大。");
  const value = JSON.parse(payload) as StoredPack;
  const allowed = ["schemaVersion", "id", "name", "sourceName", "createdAt", "revision", "parentId",
    "scan", "parameterSelection", "assetBindings", "assetCount", "issueCount"];
  if (!value || value.schemaVersion !== 1 || Object.keys(value).some(key => !allowed.includes(key))
    || typeof value.id !== "string" || !validId(value.id) || !value.name?.trim() || value.name.length > 160
    || typeof value.sourceName !== "string" || /[\\/\u0000-\u001f]/.test(value.sourceName)
    || value.sourceName.length > 240 || !Number.isFinite(Date.parse(value.createdAt))
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || value.parentId !== undefined && !validId(value.parentId)
    || value.parentId === undefined && value.revision !== 1
    || !value.parameterSelection || !value.assetBindings || !Array.isArray(value.scan?.assets)) fail("清单无效。");
  for (const [key, selected] of Object.entries(value.parameterSelection))
    if (typeof selected !== "boolean" || !/^[a-zA-Z_]+\.[a-zA-Z_]+(?:\.[a-zA-Z_]+)?$/.test(key)) fail("参数选择无效。");
  for (const [path, binding] of Object.entries(value.assetBindings))
    if (binding !== undefined && (!bindings.has(binding) || !value.scan.assets.some(asset => asset.path === path))) fail("用途映射无效。");
  const scan: RenpyGuiArchiveScan = { ...value.scan, assets: value.scan.assets.map(({ bytesBase64, ...asset }) => {
    if (Object.keys(asset).some(key => !["path", "name", "kind", "mimeType", "sizeBytes"].includes(key)))
      fail("素材记录包含不允许的字段。");
    if (typeof bytesBase64 !== "string" || bytesBase64.length > 34 * 1024 * 1024
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(bytesBase64)) fail("素材字节无效。");
    const bytes = Uint8Array.from(atob(bytesBase64), char => char.charCodeAt(0));
    return { ...asset, bytes };
  }) };
  validateScan(scan);
  if (value.assetCount !== scan.assets.length || value.issueCount !== scan.issues.length) fail("清单计数不一致。");
  return { ...value, scan };
}
export function guiPackSummary({ id, name, sourceName, createdAt, revision, parentId, assetCount, issueCount }: GuiPackRecord): GuiPackSummary {
  return { id, name, sourceName, createdAt, revision, parentId, assetCount, issueCount };
}
const native = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
async function browserStore<T>(mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("agentvn-gui-pack-library", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("GUI资源包库被旧窗口占用，请关闭旧窗口后重试。"));
  });
  return new Promise((resolve, reject) => {
    const tx = database.transaction("packs", mode); let request: IDBRequest<T>;
    try { request = body(tx.objectStore("packs")); } catch (error) { database.close(); reject(error); return; }
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { database.close(); reject(tx.error ?? request.error ?? new Error("GUI资源包库事务失败。")); };
  });
}
export async function listGuiPacks(): Promise<GuiPackSummary[]> {
  if (native()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GuiPackSummary[]>("list_renpy_gui_packs");
  }
  const values = await browserStore<Array<{ id: string; payload: string }>>("readonly", store => store.getAll());
  return values.map(item => guiPackSummary(decodeGuiPack(item.payload))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function readGuiPack(id: string): Promise<GuiPackRecord> {
  if (!validId(id)) fail("资源包ID无效。");
  if (native()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return decodeGuiPack(await invoke<string>("read_renpy_gui_pack", { id }));
  }
  const value = await browserStore<{ payload: string } | undefined>("readonly", store => store.get(id));
  if (!value) throw new Error("GUI_PACK_MISSING: 所选资源包已不存在。");
  return decodeGuiPack(value.payload);
}
export async function saveGuiPack(pack: GuiPackRecord): Promise<GuiPackSummary> {
  const payload = encodeGuiPack(pack); const validated = decodeGuiPack(payload);
  if (native()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<GuiPackSummary>("save_renpy_gui_pack", { payload });
  }
  if (validated.parentId) {
    const previous = await readGuiPack(validated.parentId);
    if (validated.revision !== previous.revision + 1) fail("修订号与来源修订不一致。");
  }
  await browserStore("readwrite", store => store.add({ id: validated.id, payload }));
  return guiPackSummary(validated);
}
