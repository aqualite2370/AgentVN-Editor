import type { AnimationKeyframe, AnimationPreset, CompiledAnimation } from "./types";

export function compileKeyframe(keyframe: AnimationKeyframe): Keyframe {
  const transform = [
    keyframe.x !== undefined || keyframe.y !== undefined ? `translate(${keyframe.x ?? 0}px, ${keyframe.y ?? 0}px)` : "",
    keyframe.scale !== undefined ? `scale(${keyframe.scale})` : "",
    keyframe.rotate !== undefined ? `rotate(${keyframe.rotate}deg)` : "",
  ].filter(Boolean).join(" ");
  const filter = [
    keyframe.blur !== undefined ? `blur(${keyframe.blur}px)` : "",
    keyframe.brightness !== undefined ? `brightness(${keyframe.brightness})` : "",
  ].filter(Boolean).join(" ");
  return {
    offset: keyframe.offset,
    opacity: keyframe.opacity,
    transform: transform || undefined,
    filter: filter || undefined,
  };
}

export function compileAnimationPreset(preset: AnimationPreset): CompiledAnimation {
  return {
    keyframes: preset.keyframes.map(compileKeyframe),
    options: {
      duration: preset.duration_ms,
      easing: preset.easing,
      iterations: preset.loop ? Infinity : 1,
      direction: preset.direction,
      fill: "both",
    },
  };
}
