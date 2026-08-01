import { nanoid } from "nanoid";
import { createInstallPlan } from "../../../shared/cartridge/compatibility";
import type { CartridgeInstallRecord, CartridgePackage, InstallPlan } from "../../../shared/cartridge/types";

export function installCartridge(cartridge: CartridgePackage, existing?: CartridgeInstallRecord): { record: CartridgeInstallRecord; plan: InstallPlan } {
  const now = new Date().toISOString();
  const plan = createInstallPlan(existing?.version, cartridge.manifest.version);
  const record: CartridgeInstallRecord = {
    install_id: existing?.install_id ?? `install_${nanoid(10)}`,
    game_id: cartridge.manifest.game_id,
    title: cartridge.manifest.title,
    author: cartridge.manifest.author,
    version: cartridge.manifest.version,
    language: cartridge.manifest.language,
    cover_asset_id: cartridge.manifest.cover,
    installed_at: existing?.installed_at ?? now,
    updated_at: now,
    manifest: cartridge.manifest,
    script: cartridge.script,
    gallery: cartridge.gallery,
    ui_skin: cartridge.uiSkin,
    asset_blob_urls: cartridge.assetBlobUrls,
    ui_asset_blob_urls: cartridge.uiAssetBlobUrls,
    source_file_name: cartridge.sourceFileName
  };
  return { record, plan };
}
