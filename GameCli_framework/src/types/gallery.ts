import type { Condition } from "./commands";

export interface GalleryItem {
  item_id: string;
  title: string;
  asset_id: string;
  unlock_condition?: Condition;
  unlocked: boolean;
}
