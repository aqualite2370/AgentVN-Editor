/** Virtual game canvas. Window/device dimensions never rewrite authored UI. */
export const GAME_ASPECT_RATIOS = ["16:9", "16:10", "4:3"] as const;
export type GameAspectRatio = typeof GAME_ASPECT_RATIOS[number];
export type PlayerGameAspectRatio = GameAspectRatio | "default";
export interface GameViewportConfig { aspectRatio: GameAspectRatio }

export function normalizePlayerGameAspectRatio(value: unknown): PlayerGameAspectRatio {
  return GAME_ASPECT_RATIOS.includes(value as GameAspectRatio) ? value as GameAspectRatio : "default";
}

/** Player preferences only affect the effective canvas, never the cartridge. */
export function resolvePlayerGameViewport(config: GameViewportConfig | undefined, preference: unknown) {
  const ratio = normalizePlayerGameAspectRatio(preference);
  return resolveGameViewport(ratio === "default" ? config : { aspectRatio: ratio });
}

export function gameViewportErrors(value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["viewport"];
  const config = value as Record<string, unknown>;
  return [
    ...(!GAME_ASPECT_RATIOS.includes(config.aspectRatio as GameAspectRatio) ? ["aspectRatio"] : []),
    ...Object.keys(config).filter(key => key !== "aspectRatio"),
  ];
}

export function resolveGameViewport(config?: GameViewportConfig) {
  const aspectRatio = config?.aspectRatio ?? "16:9";
  const height = aspectRatio === "4:3" ? 960 : aspectRatio === "16:10" ? 800 : 720;
  return { aspectRatio, width: 1280, height, ratio: 1280 / height };
}

export function fitGameViewport(available: { width: number; height: number }, design = resolveGameViewport()) {
  const width = Math.min(Math.max(1, available.width), Math.max(1, available.height) * design.ratio);
  const height = width / design.ratio;
  return { width, height, x: Math.max(0, (available.width - width) / 2),
    y: Math.max(0, (available.height - height) / 2) };
}

/** Insets outside the contained game canvas are already covered by letterboxing. */
export function gameFrameSafeInsets(frame: ReturnType<typeof fitGameViewport>,
  insets: { top: number; right: number; bottom: number; left: number }) {
  const remaining = (value: number, offset: number, extent: number) =>
    Math.min(extent * .45, Math.max(0, value - offset));
  return {
    top: remaining(insets.top, frame.y, frame.height),
    bottom: remaining(insets.bottom, frame.y, frame.height),
    left: remaining(insets.left, frame.x, frame.width),
    right: remaining(insets.right, frame.x, frame.width),
  };
}
