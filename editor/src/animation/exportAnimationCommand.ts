import type { AnimationCommand } from "../types/commands";
import type { AnimationCommandExportOptions } from "./types";

export function exportAnimationCommand(options: AnimationCommandExportOptions): AnimationCommand {
  return {
    type: "animation",
    animation_id: options.preset.preset_id,
    target: options.target,
    params: {
      duration: options.preset.duration_ms,
      easing: options.preset.easing,
      loop: options.preset.loop,
      direction: options.preset.direction,
      keyframes: JSON.parse(JSON.stringify(options.preset.keyframes)) as Record<string, number | string | null>[],
    },
    blocking: options.blocking,
  };
}
