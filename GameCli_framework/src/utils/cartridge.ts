import { importRuntimeCartridge } from "../cartridge/importCartridge";
import type { CartridgePackage } from "../types/cartridge";
import type { GameManifest } from "../types/manifest";
import type { RuntimeScript } from "../types/script";

export async function parseVnCart(file: File): Promise<CartridgePackage> {
  const { cartridge } = await importRuntimeCartridge(file);
  return {
    manifest: cartridge.manifest as unknown as GameManifest,
    script: cartridge.script as unknown as RuntimeScript,
    gallery: cartridge.gallery.items.map((item) => ({ item_id: item.item_id, title: item.title, asset_id: item.asset_id, unlocked: false })),
    uiSkin: cartridge.uiSkin,
    assetUrls: cartridge.assetBlobUrls,
    uiAssetUrls: cartridge.uiAssetBlobUrls,
  };
}
