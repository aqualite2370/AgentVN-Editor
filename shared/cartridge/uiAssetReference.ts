export const UI_LAYOUT_ASSET_REFERENCE_PREFIX = "asset:";

const MAX_UI_LAYOUT_ASSET_ID_LENGTH = 256;

export function normalizeUILayoutAssetId(assetId: unknown): string | undefined {
  if (typeof assetId !== "string") return undefined;
  const normalized = assetId.trim();
  if (
    !normalized
    || normalized.length > MAX_UI_LAYOUT_ASSET_ID_LENGTH
    || /[\u0000-\u001f\u007f\s]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function toUILayoutAssetReference(assetId: unknown): string | undefined {
  const normalized = normalizeUILayoutAssetId(assetId);
  return normalized ? `${UI_LAYOUT_ASSET_REFERENCE_PREFIX}${normalized}` : undefined;
}

export function assetIdFromUILayoutReference(reference: unknown): string | undefined {
  if (typeof reference !== "string" || !reference.startsWith(UI_LAYOUT_ASSET_REFERENCE_PREFIX)) {
    return undefined;
  }
  return normalizeUILayoutAssetId(reference.slice(UI_LAYOUT_ASSET_REFERENCE_PREFIX.length));
}

export function isUILayoutAssetReference(reference: unknown): reference is string {
  return assetIdFromUILayoutReference(reference) !== undefined;
}
