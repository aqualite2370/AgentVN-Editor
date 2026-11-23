import type { BubblePositionConfig, DialogPresentationMode, GameCommand, RuntimeScript } from "./types";

export function isDialogPresentationMode(value: unknown): value is DialogPresentationMode {
  return value === "dialog" || value === "nvl" || value === "bubble";
}

/** Presentation is story data, independent of the active layout and player preferences. */
export function resolveDialogPresentation(
  command: Extract<GameCommand, { type: "dialog" | "narration" }>,
  script?: Pick<RuntimeScript, "default_dialog_presentation" | "characters">,
): DialogPresentationMode {
  return command.presentation_mode
    ?? (command.type === "dialog"
      ? script?.characters?.find(character => character.character_id === command.character_id)?.dialog_presentation
      : undefined)
    ?? script?.default_dialog_presentation
    ?? "dialog";
}

export function normalizeCharacterDialogPresentations(value: unknown): Record<string, DialogPresentationMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, mode]) =>
    Boolean(id.trim()) && isDialogPresentationMode(mode)));
}

export function isBubblePositionConfig(value: unknown): value is BubblePositionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const config = value as Record<string, unknown>;
  const numberInRange = (n: unknown, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (config.mode === "fixed") return Object.keys(config).every(key => ["mode", "x", "y"].includes(key))
    && numberInRange(config.x, 0, 100) && numberInRange(config.y, 0, 100);
  return config.mode === "character"
    && Object.keys(config).every(key => ["mode", "offset_x", "offset_y"].includes(key))
    && (config.offset_x === undefined || numberInRange(config.offset_x, -100, 100))
    && (config.offset_y === undefined || numberInRange(config.offset_y, -100, 100));
}
