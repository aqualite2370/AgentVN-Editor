import type { AnimationCommand } from "../types/commands";

export type AnimationTargetType = "screen" | "background" | "sprite" | "dialog" | "ui" | "camera";

export interface AnimationKeyframe {
  offset: number;
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  brightness?: number;
  custom_css?: string;
}

export interface AnimationPreset {
  preset_id: string;
  name: string;
  description: string;
  target_type: AnimationTargetType;
  keyframes: AnimationKeyframe[];
  duration_ms: number;
  easing: string;
  loop: boolean;
  direction: PlaybackDirection;
}

export interface CompiledAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}

export interface AnimationCommandExportOptions {
  preset: AnimationPreset;
  target: string;
  blocking: boolean;
}

export type ExportedAnimationCommand = AnimationCommand;
