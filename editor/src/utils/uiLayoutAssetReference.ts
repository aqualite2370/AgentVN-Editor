import {
  assetIdFromUILayoutReference,
  toUILayoutAssetReference,
} from "../../../shared/cartridge/uiAssetReference";
import type { AssetRef } from "../types/assets";

export {
  assetIdFromUILayoutReference,
  toUILayoutAssetReference,
};

export interface ResolvedUILayoutImagePreview {
  reference?: string;
  assetId?: string;
  source?: string;
  missing: boolean;
}

function assetPreviewSource(asset: AssetRef | undefined): string | undefined {
  const metadata = asset?.metadata;
  return metadata?.data_url
    ?? metadata?.blob_url
    ?? metadata?.url
    ?? metadata?.project_path
    ?? metadata?.path
    ?? metadata?.filePath;
}

export function resolveUILayoutImagePreview(
  reference: string | undefined,
  assetManifest: AssetRef[],
): ResolvedUILayoutImagePreview {
  if (!reference) return { missing: false };
  const assetId = assetIdFromUILayoutReference(reference);
  if (!assetId) {
    return {
      reference,
      source: reference,
      missing: false,
    };
  }
  const asset = assetManifest.find((candidate) => candidate.asset_id === assetId);
  return {
    reference,
    assetId,
    source: assetPreviewSource(asset),
    missing: !asset,
  };
}
