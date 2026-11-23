import type { Condition } from "./commands";

export interface GalleryItem {
  item_id: string;
  title: string;
  asset_id: string;
  description?: string;
  image_fit?: import("../../../shared/cartridge/galleryPresentation").GalleryImageFit;
  anchor_id?: string;
  scene_id?: string;
  command_index?: number;
  unlock_condition?: Condition;
  unlocked: boolean;
  snapshot?: import("./save").SaveData;
}
