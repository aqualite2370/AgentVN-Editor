import { invoke } from "@tauri-apps/api/core";
import type { SaveData } from "../types/save";
import { isTauriRuntime } from "../utils/platform";
import { sha256String } from "../../../shared/cartridge/checksum";

/** Normal previews retain their own progress; bypass previews never call storage. */
export async function galleryStorageId(game: { install_id: string; game_id: string }): Promise<string> {
  return game.install_id === "preview_gamecli"
    ? `preview_gallery_${await sha256String(game.game_id)}`
    : game.install_id;
}

export interface GalleryUnlockRecord {
  anchor_id: string;
  scene_id: string;
  unlocked_at: string;
}

type GalleryRecord = Record<string, GalleryUnlockRecord | SaveData>;
function key(installId: string): string { return `agentvn.gamecli.gallery.${installId}`; }

function readWeb(installId: string): GalleryRecord {
  try { return JSON.parse(window.localStorage.getItem(key(installId)) ?? "{}") as GalleryRecord; } catch { return {}; }
}
function writeWeb(installId: string, records: GalleryRecord): void {
  window.localStorage.setItem(key(installId), JSON.stringify(records));
}

export async function listGalleryUnlocks(installId: string): Promise<string[]> {
  if (isTauriRuntime()) return await invoke<string[]>("list_gallery_unlocks", { installId });
  return Object.keys(readWeb(installId));
}
export async function readGalleryAnchor(
  installId: string,
  anchorId: string,
): Promise<SaveData | GalleryUnlockRecord | undefined> {
  if (isTauriRuntime()) {
    return (await invoke<SaveData | GalleryUnlockRecord | null>("read_gallery_anchor", { installId, anchorId })) ?? undefined;
  }
  return readWeb(installId)[anchorId];
}
export async function writeGalleryAnchor(installId: string, anchorId: string, record: GalleryUnlockRecord | SaveData): Promise<void> {
  if (isTauriRuntime()) { await invoke("write_gallery_anchor", { installId, anchorId, save: record }); return; }
  const records = readWeb(installId); if (!records[anchorId]) { records[anchorId] = record; writeWeb(installId, records); }
}
export async function deleteGalleryUnlocks(installId: string): Promise<void> {
  if (isTauriRuntime()) { await invoke("delete_gallery_unlocks", { installId }); return; }
  window.localStorage.removeItem(key(installId));
}
