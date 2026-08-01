import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { nanoid } from "nanoid";
import type { CartridgePackage as SharedCartridgePackage, CartridgeValidationResult } from "../../../shared/cartridge/types";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { importRuntimeCartridgeFromArrayBuffer } from "./importCartridge";
import { isTauriRuntime } from "../utils/platform";
import type { InstalledCartridgeIndex, LibraryGame, StartupIndex } from "../types/cartridge";

type TauriLibraryRecord = {
  installId: string;
  gameId: string;
  title: string;
  author: string;
  version: string;
  language: string;
  description: string;
  coverAssetId?: string;
  sourceFileName?: string;
  installedAt: string;
  updatedAt: string;
  cartridgePath: string;
};

type WebLibraryRecord = TauriLibraryRecord & {
  cartridgeData?: string;
  storage?: "localstorage" | "indexeddb";
  byteLength?: number;
};

const webLibraryKey = "agentvn.gamecli.webLibrary";
const webCartridgeDbName = "agentvn.gamecli.cartridges";
const webCartridgeStoreName = "cartridges";

function toIndex(record: TauriLibraryRecord): InstalledCartridgeIndex {
  return record;
}

function fileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "game.vncart";
}

function bytesToArrayBuffer(bytes: Uint8Array | number[]): ArrayBuffer {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function encodeArrayBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function decodeArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function hasIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openWebCartridgeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("当前浏览器不支持 IndexedDB，无法保存较大的浏览器测试卡带。"));
      return;
    }
    const request = window.indexedDB.open(webCartridgeDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(webCartridgeStoreName)) {
        db.createObjectStore(webCartridgeStoreName);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("打开浏览器卡带库失败。"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function putWebCartridgeData(installId: string, buffer: ArrayBuffer): Promise<void> {
  const db = await openWebCartridgeDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(webCartridgeStoreName, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("保存浏览器卡带数据失败。"));
    tx.objectStore(webCartridgeStoreName).put(buffer, installId);
  }).finally(() => db.close());
}

async function getWebCartridgeData(installId: string): Promise<ArrayBuffer | undefined> {
  const db = await openWebCartridgeDb();
  return await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
    const tx = db.transaction(webCartridgeStoreName, "readonly");
    const request = tx.objectStore(webCartridgeStoreName).get(installId);
    request.onerror = () => reject(request.error ?? new Error("读取浏览器卡带数据失败。"));
    request.onsuccess = () => resolve(request.result as ArrayBuffer | undefined);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("读取浏览器卡带数据失败。"));
    };
  });
}

async function deleteWebCartridgeData(installId: string): Promise<void> {
  if (!hasIndexedDb()) return;
  const db = await openWebCartridgeDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(webCartridgeStoreName, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("删除浏览器卡带数据失败。"));
    tx.objectStore(webCartridgeStoreName).delete(installId);
  }).finally(() => db.close());
}

function loadWebRecords(): WebLibraryRecord[] {
  if (isTauriRuntime()) return [];
  try {
    const raw = window.localStorage.getItem(webLibraryKey);
    return raw ? JSON.parse(raw) as WebLibraryRecord[] : [];
  } catch (error) {
    reportFrontendError("player.library", error, { operation: "read-browser-library-index" });
    return [];
  }
}

function saveWebRecords(records: WebLibraryRecord[]): void {
  if (isTauriRuntime()) return;
  window.localStorage.setItem(webLibraryKey, JSON.stringify(records));
}


type UnpackedPreviewPayload = {
  manifest: SharedCartridgePackage["manifest"];
  script: SharedCartridgePackage["script"];
  gallery?: SharedCartridgePackage["gallery"];
  checksum?: SharedCartridgePackage["checksum"];
  uiSkin?: SharedCartridgePackage["uiSkin"];
  assetUrls?: Record<string, string>;
  uiAssetUrls?: Record<string, string>;
  sourceFileName?: string;
  startupIndex?: StartupIndex;
  contentId?: string;
};

function unpackedPreviewToGame(payload: UnpackedPreviewPayload, previewRoot: string): LibraryGame {
  const now = new Date().toISOString();
  const galleryItems = payload.gallery?.items ?? [];
  return {
    install_id: "preview_gamecli",
    game_id: payload.manifest.game_id,
    title: payload.manifest.title,
    author: payload.manifest.author,
    version: payload.manifest.version,
    description: payload.manifest.description,
    cover: payload.manifest.cover,
    manifest: payload.manifest as unknown as LibraryGame["manifest"],
    script: payload.script as unknown as LibraryGame["script"],
    gallery: galleryItems.map((item) => ({
      item_id: item.item_id,
      title: item.title,
      asset_id: item.asset_id,
      unlock_condition: item.unlock_condition as LibraryGame["gallery"][number]["unlock_condition"],
      unlocked: false,
    })),
    uiSkin: payload.uiSkin,
    assetUrls: payload.assetUrls ?? {},
    uiAssetUrls: payload.uiAssetUrls,
    imported_at: now,
    updated_at: now,
    language: payload.manifest.language,
    source_file_name: payload.sourceFileName ?? "disk-preview",
    cartridge_path: previewRoot,
    startupIndex: payload.startupIndex,
    contentId: payload.contentId,
  };
}

function packageToGame(cartridge: SharedCartridgePackage, record: InstalledCartridgeIndex): LibraryGame {
  return {
    install_id: record.installId,
    game_id: cartridge.manifest.game_id,
    title: cartridge.manifest.title,
    author: cartridge.manifest.author,
    version: cartridge.manifest.version,
    description: cartridge.manifest.description,
    cover: cartridge.manifest.cover,
    manifest: cartridge.manifest as unknown as LibraryGame["manifest"],
    script: cartridge.script as unknown as LibraryGame["script"],
    gallery: cartridge.gallery.items.map((item) => ({
      item_id: item.item_id,
      title: item.title,
      asset_id: item.asset_id,
      unlock_condition: item.unlock_condition as LibraryGame["gallery"][number]["unlock_condition"],
      unlocked: false,
    })),
    uiSkin: cartridge.uiSkin,
    assetUrls: cartridge.assetBlobUrls,
    uiAssetUrls: cartridge.uiAssetBlobUrls,
    imported_at: record.installedAt,
    updated_at: record.updatedAt,
    language: record.language,
    source_file_name: record.sourceFileName,
    cartridge_path: record.cartridgePath,
  };
}

function recordForPackage(
  cartridge: SharedCartridgePackage,
  sourceFileName: string | undefined,
  installId: string,
  cartridgePath = "",
): InstalledCartridgeIndex {
  const now = new Date().toISOString();
  return {
    installId,
    gameId: cartridge.manifest.game_id,
    title: cartridge.manifest.title,
    author: cartridge.manifest.author,
    version: cartridge.manifest.version,
    language: cartridge.manifest.language,
    description: cartridge.manifest.description,
    coverAssetId: cartridge.manifest.cover,
    sourceFileName,
    installedAt: now,
    updatedAt: now,
    cartridgePath,
  };
}

export async function selectCartridgePath(): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined;
  const selected = await open({
    multiple: false,
    filters: [{ name: "AgentVN Cartridge", extensions: ["vncart", "zip"] }],
  });
  return typeof selected === "string" ? selected : undefined;
}

export async function listInstalledCartridges(): Promise<InstalledCartridgeIndex[]> {
  if (!isTauriRuntime()) return loadWebRecords().map(({ cartridgeData: _cartridgeData, ...record }) => record);
  const records = await invoke<TauriLibraryRecord[]>("list_installed_cartridges");
  return records.map(toIndex);
}

export async function importCartridgeFromFile(
  file: File,
  existingRecords: InstalledCartridgeIndex[],
): Promise<{ index: InstalledCartridgeIndex; game: LibraryGame; duplicate: boolean; validation: CartridgeValidationResult }> {
  const buffer = await file.arrayBuffer();
  const { cartridge, validation } = await importRuntimeCartridgeFromArrayBuffer(buffer, file.name);
  const existing = existingRecords.find(
    (item) => item.gameId === cartridge.manifest.game_id && item.version === cartridge.manifest.version,
  );
  const record = recordForPackage(cartridge, file.name, existing?.installId ?? `cart_${nanoid(12)}`, "");
  let webRecord: WebLibraryRecord;
  if (hasIndexedDb()) {
    await putWebCartridgeData(record.installId, buffer);
    webRecord = { ...record, storage: "indexeddb", byteLength: buffer.byteLength };
  } else {
    webRecord = { ...record, storage: "localstorage", cartridgeData: encodeArrayBuffer(buffer), byteLength: buffer.byteLength };
  }
  const records = [webRecord, ...loadWebRecords().filter((item) => item.installId !== webRecord.installId)];
  saveWebRecords(records);
  return { index: record, game: packageToGame(cartridge, record), duplicate: Boolean(existing), validation };
}

export async function importCartridgeFromPath(
  sourcePath: string,
  existingRecords: InstalledCartridgeIndex[],
): Promise<{ index: InstalledCartridgeIndex; game: LibraryGame; duplicate: boolean; validation: CartridgeValidationResult }> {
  const bytes = await readFile(sourcePath);
  const { cartridge, validation } = await importRuntimeCartridgeFromArrayBuffer(
    bytesToArrayBuffer(bytes),
    fileNameFromPath(sourcePath),
  );
  const existing = existingRecords.find(
    (item) => item.gameId === cartridge.manifest.game_id && item.version === cartridge.manifest.version,
  );
  const now = new Date().toISOString();
  const record: TauriLibraryRecord = {
    installId: existing?.installId ?? `cart_${nanoid(12)}`,
    gameId: cartridge.manifest.game_id,
    title: cartridge.manifest.title,
    author: cartridge.manifest.author,
    version: cartridge.manifest.version,
    language: cartridge.manifest.language,
    description: cartridge.manifest.description,
    coverAssetId: cartridge.manifest.cover,
    sourceFileName: fileNameFromPath(sourcePath),
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    cartridgePath: existing?.cartridgePath ?? "",
  };
  const saved = await invoke<TauriLibraryRecord>("import_cartridge_from_path", { sourcePath, record });
  const index = toIndex(saved);
  return { index, game: packageToGame(cartridge, index), duplicate: Boolean(existing), validation };
}

export async function loadInstalledGame(index: InstalledCartridgeIndex): Promise<LibraryGame> {
  if (!isTauriRuntime()) {
    const record = loadWebRecords().find((item) => item.installId === index.installId);
    if (!record) throw new Error("未找到已导入的浏览器测试卡带。");
    const buffer = record.cartridgeData
      ? decodeArrayBuffer(record.cartridgeData)
      : await getWebCartridgeData(record.installId);
    if (!buffer) throw new Error("未找到浏览器测试卡带数据，可能已被浏览器清理。");
    const { cartridge } = await importRuntimeCartridgeFromArrayBuffer(buffer, record.sourceFileName);
    return packageToGame(cartridge, record);
  }
  const bytes = await invoke<number[]>("load_installed_cartridge", { installId: index.installId });
  const { cartridge } = await importRuntimeCartridgeFromArrayBuffer(
    bytesToArrayBuffer(bytes),
    index.sourceFileName,
  );
  return packageToGame(cartridge, index);
}

export async function loadGameFromArrayBuffer(
  buffer: ArrayBuffer,
  options: { installId: string; sourceFileName?: string },
): Promise<LibraryGame> {
  const { cartridge } = await importRuntimeCartridgeFromArrayBuffer(buffer, options.sourceFileName);
  return packageToGame(cartridge, recordForPackage(cartridge, options.sourceFileName, options.installId));
}

export async function loadGameFromUnpackedPreview(previewRoot: string): Promise<LibraryGame> {
  const payload = await invoke<UnpackedPreviewPayload>("load_unpacked_preview", { previewRoot });
  return unpackedPreviewToGame(payload, previewRoot);
}

async function fetchEmbeddedJson<T>(relativePath: string, required: true): Promise<T>;
async function fetchEmbeddedJson<T>(relativePath: string, required: false): Promise<T | undefined>;
async function fetchEmbeddedJson<T>(relativePath: string, required: boolean): Promise<T | undefined> {
  const response = await fetch(`/embedded-cartridge/${relativePath}`);
  if (!response.ok) {
    if (!required && response.status === 404) return undefined;
    throw new Error(`固定客户端缺少 ${relativePath}。`);
  }
  return await response.json() as T;
}

export async function loadGameFromEmbeddedDirectory(): Promise<LibraryGame> {
  if (isTauriRuntime()) {
    const payload = await invoke<UnpackedPreviewPayload>("load_embedded_game");
    return unpackedPreviewToGame(payload, "embedded-resource");
  }
  const manifest = await fetchEmbeddedJson<SharedCartridgePackage["manifest"]>("manifest.json", true);
  const script = await fetchEmbeddedJson<SharedCartridgePackage["script"]>("script.json", true);
  const gallery = await fetchEmbeddedJson<SharedCartridgePackage["gallery"]>("gallery.json", false);
  const checksum = await fetchEmbeddedJson<SharedCartridgePackage["checksum"]>("checksum.json", true);
  const startupIndex = await fetchEmbeddedJson<StartupIndex>("startup-index.json", false);
  const uiPath = manifest?.ui_skin?.path ?? "ui/layout.json";
  const uiSkin = await fetchEmbeddedJson<SharedCartridgePackage["uiSkin"]>(uiPath, false);
  const assetUrls: Record<string, string> = {};
  for (const asset of manifest?.assets ?? []) {
    const url = `/embedded-cartridge/${asset.path}`;
    assetUrls[asset.asset_id] = url;
    assetUrls[asset.path] = url;
  }
  const uiAssetUrls: Record<string, string> = {};
  for (const asset of uiSkin?.assets ?? []) {
    uiAssetUrls[asset.asset_id] = `/embedded-cartridge/${asset.path}`;
  }
  return unpackedPreviewToGame({
    manifest,
    script,
    gallery,
    checksum,
    uiSkin,
    assetUrls,
    uiAssetUrls,
    sourceFileName: "embedded-cartridge/",
    startupIndex,
    contentId: startupIndex?.contentId,
  }, "embedded-cartridge/");
}

export async function loadGameFromPath(sourcePath: string, installId: string): Promise<LibraryGame> {
  const bytes = await invoke<number[]>("read_cartridge_from_path", { sourcePath });
  const { cartridge } = await importRuntimeCartridgeFromArrayBuffer(
    bytesToArrayBuffer(bytes),
    fileNameFromPath(sourcePath),
  );
  return packageToGame(cartridge, recordForPackage(cartridge, fileNameFromPath(sourcePath), installId, sourcePath));
}

export async function removeInstalledCartridge(installId: string, deleteSaves = false): Promise<InstalledCartridgeIndex[]> {
  if (!isTauriRuntime()) {
    const records = loadWebRecords().filter((item) => item.installId !== installId);
    await deleteWebCartridgeData(installId);
    saveWebRecords(records);
    return records.map(({ cartridgeData: _cartridgeData, ...record }) => record);
  }
  const records = await invoke<TauriLibraryRecord[]>("remove_installed_cartridge", { installId, deleteSaves });
  return records.map(toIndex);
}
