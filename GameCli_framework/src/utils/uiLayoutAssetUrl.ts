import { assetIdFromUILayoutReference } from "../../../shared/cartridge/uiAssetReference";
import type { GameManifest } from "../types/manifest";
import { toRuntimeAssetUrl } from "./runtimeAssetUrl";

function isPackagedUILayoutAssetPath(reference: string): boolean {
  return (
    (reference.startsWith("assets/") || reference.startsWith("ui/assets/"))
    && !reference.includes("../")
    && !reference.includes("\\")
    && !reference.startsWith("/")
    && !/^[a-zA-Z]:/.test(reference)
  );
}

function firstResolvedRuntimeUrl(candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = toRuntimeAssetUrl(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

export function resolveUILayoutAssetUrl(
  reference: string | null | undefined,
  manifest: Pick<GameManifest, "assets"> | undefined,
  assetUrls: Record<string, string> | undefined,
  uiAssetUrls: Record<string, string> | undefined,
): string | undefined {
  const normalizedReference = reference?.trim();
  if (!normalizedReference) return undefined;

  const assetId = assetIdFromUILayoutReference(normalizedReference);
  if (assetId) {
    const manifestAsset = manifest?.assets.find((asset) => asset.asset_id === assetId);
    return firstResolvedRuntimeUrl([
      uiAssetUrls?.[normalizedReference],
      uiAssetUrls?.[assetId],
      assetUrls?.[assetId],
      manifestAsset ? assetUrls?.[manifestAsset.path] : undefined,
    ]);
  }

  if (!isPackagedUILayoutAssetPath(normalizedReference)) return undefined;
  const manifestAsset = manifest?.assets.find((asset) => asset.path === normalizedReference);
  return firstResolvedRuntimeUrl([
    uiAssetUrls?.[normalizedReference],
    assetUrls?.[normalizedReference],
    manifestAsset ? uiAssetUrls?.[manifestAsset.asset_id] : undefined,
    manifestAsset ? assetUrls?.[manifestAsset.asset_id] : undefined,
  ]);
}
