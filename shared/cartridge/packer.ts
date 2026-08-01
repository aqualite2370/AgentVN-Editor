import JSZip from "jszip";
import { createChecksumManifest } from "./checksum";
import { DEFAULT_UI_LAYOUT_PATH } from "./uiSkin";
import type { CartridgeAssetInput, CartridgeExportOptions, CartridgeMetadata, ChecksumManifest, GalleryManifest, GameManifest, RuntimeScript } from "./types";
import type { UISkinLayout } from "./uiSkin";

async function normalizeData(data: Blob | ArrayBuffer | Uint8Array | string): Promise<ArrayBuffer | Uint8Array | string> {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return data;
  return new Uint8Array(await data.arrayBuffer());
}

export async function createCartridgePackage(input: {
  manifest: GameManifest;
  script: RuntimeScript;
  gallery?: GalleryManifest;
  assets?: CartridgeAssetInput[];
  metadata?: CartridgeMetadata;
  uiSkin?: UISkinLayout;
  uiAssets?: Array<{ path: string; data: Blob | ArrayBuffer | Uint8Array | string }>;
  exportOptions?: CartridgeExportOptions;
}): Promise<{ zip: JSZip; checksum: ChecksumManifest; fileName: string }> {
  const zip = new JSZip();
  const gallery = input.gallery ?? { gallery_version: "1.0.0", items: [] };
  const filesForChecksum: Array<{ path: string; data: ArrayBuffer | Uint8Array | string }> = [];
  const add = async (path: string, data: Blob | ArrayBuffer | Uint8Array | string) => {
    const normalized = await normalizeData(data);
    zip.file(path, normalized);
    filesForChecksum.push({ path, data: normalized });
  };

  await add("manifest.json", JSON.stringify(input.manifest, null, 2));
  await add("script.json", JSON.stringify(input.script, null, 2));
  if (input.exportOptions?.includeGallery !== false) await add("gallery.json", JSON.stringify(gallery, null, 2));
  if (input.exportOptions?.includeMetadata !== false && input.metadata) {
    if (input.metadata.credits) await add("metadata/credits.json", JSON.stringify(input.metadata.credits, null, 2));
    if (input.metadata.changelog) await add("metadata/changelog.json", JSON.stringify(input.metadata.changelog, null, 2));
    if (input.metadata.license) await add("metadata/license.json", JSON.stringify(input.metadata.license, null, 2));
  }
  if (input.uiSkin) {
    const skinPath = input.manifest.ui_skin?.path ?? DEFAULT_UI_LAYOUT_PATH;
    await add(skinPath, JSON.stringify(input.uiSkin, null, 2));
  }
  for (const asset of input.uiAssets ?? []) await add(asset.path, asset.data);
  for (const asset of input.assets ?? []) await add(asset.path, asset.data);
  const checksum = await createChecksumManifest(filesForChecksum);
  zip.file("checksum.json", JSON.stringify(checksum, null, 2));
  return {
    zip,
    checksum,
    fileName: input.exportOptions?.fileName ?? `${input.manifest.game_id}-${input.manifest.version}.vncart`
  };
}

export async function packCartridgeToBlob(input: Parameters<typeof createCartridgePackage>[0]): Promise<Blob> {
  const { zip } = await createCartridgePackage(input);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export async function packCartridgeToUint8Array(input: Parameters<typeof createCartridgePackage>[0]): Promise<Uint8Array> {
  const { zip } = await createCartridgePackage(input);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
