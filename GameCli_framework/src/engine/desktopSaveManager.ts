import { invoke } from "@tauri-apps/api/core";
import type { SaveData, SaveKind, SaveSlotRef } from "../types/save";
import { isTauriRuntime } from "../utils/platform";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export interface SaveStorageInfo {
  portable: boolean;
  sourceDirectory: string | null;
  targetDirectory: string;
  availableFiles: string[];
  conflictFiles: string[];
  skippedFiles: string[];
  copiedFiles: string[];
  unverifiedFiles?: UnverifiedSave[];
}

export interface LegacySaveClaim {
  fileName: string;
  sourceSha256: string;
}

export interface UnverifiedSave extends LegacySaveClaim {
  slot: number;
  saveKind: SaveKind;
  createdAt?: string | null;
  sceneId: string;
  summary?: string | null;
  conflict: boolean;
}

export async function getSaveStorageInfo(installId: string): Promise<SaveStorageInfo | undefined> {
  if (!isTauriRuntime()) return undefined;
  return invoke<SaveStorageInfo>("get_save_storage_info", { installId });
}

export async function migrateLegacySaves(installId: string, gameId: string,
  legacyClaims: LegacySaveClaim[] = []): Promise<SaveStorageInfo> {
  if (!isTauriRuntime()) throw new Error("旧存档迁移仅适用于Windows独立游戏。");
  return invoke<SaveStorageInfo>("migrate_legacy_saves", { installId, gameId, confirmed: true, legacyClaims });
}

function saveKey(installId: string): string {
  return `agentvn.gamecli.saves.${installId}`;
}

function readWebSaves(installId: string): SaveData[] {
  try {
    const raw = window.localStorage.getItem(saveKey(installId));
    return raw ? JSON.parse(raw) as SaveData[] : [];
  } catch (error) {
    reportFrontendError("player.save", error, { operation: "local-storage-read", installId });
    return [];
  }
}

function writeWebSaves(installId: string, saves: SaveData[]): void {
  const key = saveKey(installId);
  const serialized = JSON.stringify(saves);
  try {
    window.localStorage.setItem(key, serialized);
  } catch (error) {
    reportFrontendError("player.save", error, { operation: "local-storage-full-save", key });
    // A thumbnail must never make a real game save fail. Retry with visual metadata removed.
    const compact = saves.map(({
      preview_image: _previewImage,
      preview_version: _previewVersion,
      preview_choices: _previewChoices,
      ...save
    }) => save);
    try {
      window.localStorage.setItem(key, JSON.stringify(compact));
    } catch {
      throw error;
    }
  }
}

function saveKind(save: SaveData): SaveKind {
  if (save.save_kind === "auto" || save.save_kind === "quick") return save.save_kind;
  return "manual";
}

function matchesSlot(save: SaveData, ref: SaveSlotRef): boolean {
  return saveKind(save) === ref.kind && save.slot === ref.slot;
}

export function normalizeSaveData(save: SaveData): SaveData {
  return {
    ...save,
    save_version: save.camera ? 3 : 2,
    save_kind: saveKind(save),
  };
}

export async function listDesktopSaves(installId: string): Promise<SaveData[]> {
  const saves = isTauriRuntime()
    ? await invoke<SaveData[]>("list_saves", { installId })
    : readWebSaves(installId);
  return saves.map(normalizeSaveData);
}

export async function writeDesktopSave(installId: string, ref: SaveSlotRef, save: SaveData): Promise<void> {
  const normalized = normalizeSaveData({ ...save, save_kind: ref.kind, slot: ref.slot });
  if (!isTauriRuntime()) {
    writeWebSaves(installId, [
      normalized,
      ...readWebSaves(installId).filter((item) => !matchesSlot(item, ref)),
    ]);
    return;
  }
  await invoke("write_save", { installId, kind: ref.kind, slot: ref.slot, save: normalized });
}

export async function readDesktopSave(installId: string, ref: SaveSlotRef): Promise<SaveData | undefined> {
  if (!isTauriRuntime()) {
    const save = readWebSaves(installId).find((item) => matchesSlot(item, ref));
    return save ? normalizeSaveData(save) : undefined;
  }
  const save = await invoke<SaveData | null>("read_save", { installId, kind: ref.kind, slot: ref.slot });
  return save ? normalizeSaveData(save) : undefined;
}

export async function deleteDesktopSave(installId: string, ref: SaveSlotRef): Promise<void> {
  if (!isTauriRuntime()) {
    writeWebSaves(installId, readWebSaves(installId).filter((save) => !matchesSlot(save, ref)));
    return;
  }
  await invoke("delete_save", { installId, kind: ref.kind, slot: ref.slot });
}
