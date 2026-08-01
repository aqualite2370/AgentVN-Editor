import type { AnimationPreset } from "./types";
import { compileAnimationPreset } from "./keyframeCompiler";

export function previewAnimation(element: HTMLElement, preset: AnimationPreset): Animation {
  const compiled = compileAnimationPreset(preset);
  return element.animate(compiled.keyframes, compiled.options);
}
