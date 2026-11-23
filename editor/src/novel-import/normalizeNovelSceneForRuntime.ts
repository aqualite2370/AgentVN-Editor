import type { SceneBeat } from "../types/scene";

/**
 * Pydantic serializes unset optional dialogue fields as null, while the
 * Runtime contract represents their inherited/default state by absence.
 * Normalize this wire representation before validating or writing novel
 * scenes. Never drop explicit invalid values or meaningful state nulls.
 */
export function normalizeNovelSceneForRuntime(scene: SceneBeat): SceneBeat {
  return {
    ...scene,
    commands: scene.commands.map(command => {
      if (command.type !== "dialog" && command.type !== "narration") return command;
      const next = { ...command };
      if (next.presentation_mode === null) delete next.presentation_mode;
      if (next.clear_nvl_page_before === null) delete next.clear_nvl_page_before;
      if (next.bubble_position === null) delete next.bubble_position;
      if (next.dialog_style_mode === null) delete next.dialog_style_mode;
      if (next.type === "narration" && next.narration_style === null) delete next.narration_style;
      return next;
    }),
  };
}
