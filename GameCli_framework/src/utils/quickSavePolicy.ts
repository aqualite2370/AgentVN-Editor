import type { SaveData, SaveSlotRef } from "../types/save";

export const QUICK_SAVE_SLOT_COUNT = 6;

export function chooseQuickSaveSlot(saves: SaveData[]): SaveSlotRef {
  const quickSaves = saves.filter((save) => save.save_kind === "quick");
  for (let slot = 1; slot <= QUICK_SAVE_SLOT_COUNT; slot += 1) {
    if (!quickSaves.some((save) => save.slot === slot)) return { kind: "quick", slot };
  }
  const oldest = [...quickSaves].sort((left, right) => (
    Date.parse(left.created_at) - Date.parse(right.created_at) || left.slot - right.slot
  ))[0];
  return { kind: "quick", slot: oldest?.slot ?? 1 };
}

export function latestQuickSave(
  saves: SaveData[],
  isCompatible: (save: SaveData) => boolean,
): SaveData | undefined {
  return saves
    .filter((save) => save.save_kind === "quick" && isCompatible(save))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)
      || right.slot - left.slot)[0];
}

export function expiredQuickSaves(saves: SaveData[]): SaveData[] {
  return saves
    .filter((save) => save.save_kind === "quick")
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)
      || right.slot - left.slot)
    .slice(QUICK_SAVE_SLOT_COUNT);
}
