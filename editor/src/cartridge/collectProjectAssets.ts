import { buildAssetManifest, collectAssetReferencesFromScript, type AssetReference } from "../../../shared/cartridge/assetScanner";
import type { AssetManifestItem, RuntimeScript } from "../../../shared/cartridge/types";

export interface ProjectAssetScanResult {
  references: AssetReference[];
  manifestAssets: AssetManifestItem[];
  missingAssets: AssetReference[];
}

function isPlaceholderAsset(asset: AssetManifestItem): boolean {
  return Boolean(asset.placeholder || asset.tags?.includes("placeholder") || asset.tags?.includes("missing"));
}

function markPlaceholder(asset: AssetManifestItem): AssetManifestItem {
  return {
    ...asset,
    placeholder: true,
    tags: [...new Set([...(asset.tags ?? []), "placeholder", "missing"])],
  };
}

export function collectProjectAssets(script: RuntimeScript, projectAssets: AssetManifestItem[] = []): ProjectAssetScanResult {
  const references = collectAssetReferencesFromScript(script);
  const finalAssetIds = new Set(projectAssets.filter((asset) => !isPlaceholderAsset(asset)).map((asset) => asset.asset_id));
  const missingAssets = references.filter((ref) => !finalAssetIds.has(ref.asset_id));
  const existingIds = new Set(projectAssets.map((asset) => asset.asset_id));
  const synthesizedPlaceholders = buildAssetManifest(missingAssets.filter((ref) => !existingIds.has(ref.asset_id))).map(markPlaceholder);
  const manifestAssets = projectAssets.length > 0
    ? [...projectAssets, ...synthesizedPlaceholders]
    : buildAssetManifest(references).map((asset) => missingAssets.some((ref) => ref.asset_id === asset.asset_id) ? markPlaceholder(asset) : asset);
  return { references, manifestAssets, missingAssets };
}
