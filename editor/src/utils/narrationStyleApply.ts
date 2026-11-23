import type { GameCommand, NarrationCommand } from "../types/commands";

export function applyNarrationStyleToCommands(
  commands: GameCommand[],
  style: NarrationCommand["dialog_style"],
  narrationStyle: NonNullable<NarrationCommand["narration_style"]>,
): { commands: GameCommand[]; changedCount: number } {
  const normalized = style ? {
    background_asset_id: style.background_asset_id ?? null,
    background_fit: style.background_fit ?? null,
    theme_color: style.theme_color ?? null,
    text_color: style.text_color ?? null,
    font_size: style.font_size ?? null,
    font_weight: style.font_weight ?? null,
    font_style: style.font_style ?? null,
  } : null;
  const mode = normalized ? "manual" as const : "inherit" as const;
  const serialized = JSON.stringify(normalized);
  let changedCount = 0;
  const next = commands.map(command => {
    if (command.type !== "narration" || (
      (command.narration_style ?? "dialog") === narrationStyle
      && (command.dialog_style_mode ?? (command.dialog_style ? "manual" : "inherit")) === mode
      && JSON.stringify(command.dialog_style ?? null) === serialized
    )) return command;
    changedCount++;
    return { ...command, narration_style: narrationStyle, dialog_style_mode: mode,
      dialog_style: normalized ? { ...normalized } : null };
  });
  return { commands: changedCount ? next : commands, changedCount };
}
