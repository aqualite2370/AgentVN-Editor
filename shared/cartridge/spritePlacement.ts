export const DEFAULT_SPRITE_OFFSET_X = 0;
export const DEFAULT_SPRITE_OFFSET_Y = 0;
export const MIN_SPRITE_OFFSET_X = -40;
export const MAX_SPRITE_OFFSET_X = 40;
export const MIN_SPRITE_OFFSET_Y = -30;
export const MAX_SPRITE_OFFSET_Y = 30;
export const SPRITE_OFFSET_STEP = 0.5;

function sanitizeOffset(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  const stepped = Math.round(numeric / SPRITE_OFFSET_STEP) * SPRITE_OFFSET_STEP;
  return Math.min(max, Math.max(min, Number(stepped.toFixed(2))));
}

export function sanitizeSpriteOffsetX(value: unknown, fallback = DEFAULT_SPRITE_OFFSET_X): number {
  return sanitizeOffset(value, MIN_SPRITE_OFFSET_X, MAX_SPRITE_OFFSET_X, fallback);
}

export function sanitizeSpriteOffsetY(value: unknown, fallback = DEFAULT_SPRITE_OFFSET_Y): number {
  return sanitizeOffset(value, MIN_SPRITE_OFFSET_Y, MAX_SPRITE_OFFSET_Y, fallback);
}

export function nullableSpriteOffsetX(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return sanitizeSpriteOffsetX(value);
}

export function nullableSpriteOffsetY(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return sanitizeSpriteOffsetY(value);
}

export function isValidSpriteOffsetX(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_SPRITE_OFFSET_X
    && value <= MAX_SPRITE_OFFSET_X
    && Math.abs(value / SPRITE_OFFSET_STEP - Math.round(value / SPRITE_OFFSET_STEP)) < 1e-8;
}

export function isValidSpriteOffsetY(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= MIN_SPRITE_OFFSET_Y
    && value <= MAX_SPRITE_OFFSET_Y
    && Math.abs(value / SPRITE_OFFSET_STEP - Math.round(value / SPRITE_OFFSET_STEP)) < 1e-8;
}
