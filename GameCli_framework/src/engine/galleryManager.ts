import type { GalleryItem } from "../types/gallery";
import type { RuntimeVariables } from "./runtimeVariables";
import { evaluateCondition } from "./runtimeVariables";

export function updateGalleryUnlocks(items: GalleryItem[], variables: RuntimeVariables): GalleryItem[] {
  return items.map((item) => ({
    ...item,
    unlocked: item.unlocked || (item.unlock_condition ? evaluateCondition(item.unlock_condition, variables) : item.unlocked)
  }));
}
