import { importRuntimeCartridge } from "../cartridge/importCartridge";
import type { CartridgePackage } from "../types/cartridge";
import type { GameManifest } from "../types/manifest";
import type { RuntimeScript } from "../types/script";

export async function parseVnCart(file: File): Promise<CartridgePackage> {
  const { cartridge } = await importRuntimeCartridge(file);
  return {
    manifest: cartridge.manifest as unknown as GameManifest,
    script: cartridge.script as unknown as RuntimeScript,
    gallery: cartridge.gallery.items.map((item) => ({ item_id: item.item_id, title: item.title, description: item.description, asset_id: item.asset_id, anchor_id: item.anchor_id ?? item.item_id, scene_id: item.scene_id, command_index: item.command_index, unlocked: false })),
    uiSkin: cartridge.uiSkin,
    assetUrls: cartridge.assetBlobUrls,
    uiAssetUrls: cartridge.uiAssetBlobUrls,
  };
}
