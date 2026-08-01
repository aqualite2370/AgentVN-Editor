import type { AnimationCommand, BackgroundCommand, Choice, SpriteCommand } from "../types/commands";
import type { SceneBeat } from "../types/scene";

export function sceneDisplayLabel(scene: Pick<SceneBeat, "scene_id" | "scene_display_name" | "title">): string {
  return scene.scene_display_name?.trim() || scene.title?.trim() || scene.scene_id;
}

export function sceneReferenceLabel(scene: Pick<SceneBeat, "scene_id" | "scene_display_name" | "title">): string {
  const display = sceneDisplayLabel(scene);
  return display === scene.scene_id ? scene.scene_id : `${display} (${scene.scene_id})`;
}

export function choiceDisplayLabel(choice: Pick<Choice, "choice_id" | "choice_display_name" | "text">): string {
  return choice.choice_display_name?.trim() || choice.text?.trim() || choice.choice_id;
}

export function transitionDisplayLabel(
  command: Pick<BackgroundCommand, "transition" | "transition_display_name"> | Pick<SpriteCommand, "animation" | "animation_display_name" | "animation_config">,
): string | undefined {
  if ("transition" in command) return command.transition_display_name?.trim() || command.transition || undefined;
  const spriteCommand = command as Pick<SpriteCommand, "animation" | "animation_display_name" | "animation_config">;
  return spriteCommand.animation_config?.display_name?.trim() || spriteCommand.animation_display_name?.trim() || spriteCommand.animation || undefined;
}

export function performanceAnimationDisplayLabel(command: Pick<AnimationCommand, "animation_id" | "animation_display_name">): string {
  return command.animation_display_name?.trim() || command.animation_id;
}
