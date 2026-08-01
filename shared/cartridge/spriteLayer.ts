export const MIN_SPRITE_LAYER = -1000;
export const MAX_SPRITE_LAYER = 1000;
export const DEFAULT_SPRITE_LAYER = 0;

export function isValidSpriteLayer(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= MIN_SPRITE_LAYER
    && value <= MAX_SPRITE_LAYER;
}

export function sanitizeSpriteLayer(value: unknown, fallback = DEFAULT_SPRITE_LAYER): number {
  if (!isValidSpriteLayer(value)) return fallback;
  return value;
}

export function inheritedSpriteLayer(
  commandLayer: unknown,
  existingLayer?: number | null,
): number | undefined {
  if (commandLayer === undefined || commandLayer === null) {
    return isValidSpriteLayer(existingLayer) ? existingLayer : undefined;
  }
  return sanitizeSpriteLayer(commandLayer);
}

export function spriteLayerZIndex(layer: unknown, exiting = false): number {
  return sanitizeSpriteLayer(layer) * 2 + (exiting ? 0 : 1);
}
