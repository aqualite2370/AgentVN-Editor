export const DEFAULT_SPRITE_SCALE = 1;
export const MIN_SPRITE_SCALE = 0.5;
export const MAX_SPRITE_SCALE = 2;
export const SPRITE_SCALE_STEP = 0.05;

export function sanitizeSpriteScale(value: unknown, fallback = DEFAULT_SPRITE_SCALE): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(MAX_SPRITE_SCALE, Math.max(MIN_SPRITE_SCALE, Math.round(numeric * 100) / 100));
}

export function nullableSpriteScale(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  return sanitizeSpriteScale(value);
}

export function spriteScalePercent(value: number): string {
  return `${Math.round(sanitizeSpriteScale(value) * 100)}%`;
}
