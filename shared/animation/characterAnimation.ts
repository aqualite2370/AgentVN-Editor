export type CharacterAnimationKind = "none" | "fade" | "move" | "tween" | "preset";
export type CharacterAnimationPhase = "enter" | "exit" | "emphasis";
export type CharacterAnimationDirection = "left" | "right" | "up" | "down" | "center" | "none";

export interface CharacterAnimationKeyframe {
  offset: number;
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  blur?: number;
  brightness?: number;
  easing?: string;
}

export interface CharacterSpriteAnimationConfig {
  kind: CharacterAnimationKind;
  phase: CharacterAnimationPhase;
  duration_ms?: number;
  delay_ms?: number;
  easing?: string;
  direction?: CharacterAnimationDirection;
  transform_origin?: string;
  keyframes?: CharacterAnimationKeyframe[];
  blocking?: boolean;
  display_name?: string | null;
  preset_id?: string | null;
}

export interface CompiledCharacterAnimation {
  animation_id: string;
  params: Record<string, string | number | boolean | null | Record<string, number | string>[]>;
  duration_ms: number;
  blocking: boolean;
}

export interface CharacterAnimationValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export const SPRITE_FOCUS_PRESET_ID = "sprite_focus";
export const SPRITE_FOCUS_DURATION_MS = 1400;
export const SPRITE_FOCUS_BACKDROP_OPACITY = 0.38;
export const SPRITE_FOCUS_COMPANION_BRIGHTNESS = 0.58;
export const SPRITE_FOCUS_KEYFRAME_OFFSETS = [0, 0.18, 0.76, 1] as const;

export function spriteFocusKeyframes(): CharacterAnimationKeyframe[] {
  return [
    { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[0], scale: 1 },
    { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[1], scale: 1.055 },
    { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[2], scale: 1.055 },
    { offset: SPRITE_FOCUS_KEYFRAME_OFFSETS[3], scale: 1 },
  ];
}

export const characterAnimationKinds: CharacterAnimationKind[] = ["none", "fade", "move", "tween", "preset"];
export const characterAnimationPhases: CharacterAnimationPhase[] = ["enter", "exit", "emphasis"];
export const characterAnimationDirections: CharacterAnimationDirection[] = ["left", "right", "up", "down", "center", "none"];

const defaultDurationMs = 520;
const minDurationMs = 80;
const maxDurationMs = 10000;
const minDelayMs = 0;
const maxDelayMs = 10000;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clampCharacterAnimationDuration(value: unknown, fallback = defaultDurationMs): number {
  const parsed = finiteNumber(value) ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minDurationMs, Math.min(maxDurationMs, Math.round(parsed)));
}

export function clampCharacterAnimationDelay(value: unknown, fallback = 0): number {
  const parsed = finiteNumber(value) ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minDelayMs, Math.min(maxDelayMs, Math.round(parsed)));
}

export function sanitizeTransformOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 48) return undefined;
  if (!/^[a-z0-9%.\-\s]+$/i.test(trimmed)) return undefined;
  return trimmed;
}

export function defaultCharacterAnimationConfig(visible = true): CharacterSpriteAnimationConfig {
  return {
    kind: "fade",
    phase: visible ? "enter" : "exit",
    duration_ms: defaultDurationMs,
    delay_ms: 0,
    easing: "ease-out",
    direction: visible ? "center" : "none",
    transform_origin: "center bottom",
    blocking: false,
    display_name: visible ? "淡入" : "淡出",
  };
}

export function legacySpriteAnimationToConfig(
  animation?: string | null,
  displayName?: string | null,
  visible = true,
): CharacterSpriteAnimationConfig | undefined {
  const id = animation?.trim();
  if (!id) return undefined;
  const base: CharacterSpriteAnimationConfig = {
    ...defaultCharacterAnimationConfig(visible),
    display_name: displayName || id,
  };
  switch (id) {
    case "fade_in":
      return { ...base, kind: "fade", phase: "enter", display_name: displayName || "淡入" };
    case "fade_out":
      return { ...base, kind: "fade", phase: "exit", display_name: displayName || "淡出" };
    case "slide_in_left":
      return { ...base, kind: "move", phase: "enter", direction: "left", display_name: displayName || "从左滑入" };
    case "slide_in_right":
      return { ...base, kind: "move", phase: "enter", direction: "right", display_name: displayName || "从右滑入" };
    case "slide_out_left":
      return { ...base, kind: "move", phase: "exit", direction: "left", display_name: displayName || "向左滑出" };
    case "slide_out_right":
      return { ...base, kind: "move", phase: "exit", direction: "right", display_name: displayName || "向右滑出" };
    case "shake":
      return { ...base, kind: "preset", phase: "emphasis", preset_id: "sprite_shake", duration_ms: 420, display_name: displayName || "抖动" };
    case "heartbeat":
      return { ...base, kind: "preset", phase: "emphasis", preset_id: "sprite_heartbeat", duration_ms: 620, display_name: displayName || "心跳缩放" };
    default:
      return { ...base, kind: "preset", preset_id: id, display_name: displayName || id };
  }
}

function hasStructuredCharacterAnimationFields(config: Partial<CharacterSpriteAnimationConfig>): boolean {
  return config.kind !== undefined ||
    config.phase !== undefined ||
    config.duration_ms !== undefined ||
    config.delay_ms !== undefined ||
    config.easing !== undefined ||
    config.direction !== undefined ||
    config.transform_origin !== undefined ||
    config.keyframes !== undefined ||
    config.blocking !== undefined ||
    config.preset_id !== undefined;
}

export function normalizeCharacterAnimationConfig(
  config?: Partial<CharacterSpriteAnimationConfig> | null,
  legacyAnimation?: string | null,
  legacyDisplayName?: string | null,
  visible = true,
): CharacterSpriteAnimationConfig | undefined {
  const legacy = legacySpriteAnimationToConfig(legacyAnimation, legacyDisplayName, visible);
  if (!config || typeof config !== "object") return legacy;
  if (!hasStructuredCharacterAnimationFields(config)) return legacy;

  const base = legacy ?? defaultCharacterAnimationConfig(visible);
  return {
    ...base,
    ...config,
    kind: config.kind ?? base.kind,
    phase: config.phase ?? base.phase,
    direction: config.direction ?? base.direction,
    display_name: config.display_name ?? legacyDisplayName ?? base.display_name,
  };
}

function movementOffset(direction?: CharacterAnimationDirection): Pick<CharacterAnimationKeyframe, "x" | "y"> {
  const distance = 120;
  if (direction === "right") return { x: distance };
  if (direction === "up") return { y: -distance };
  if (direction === "down") return { y: distance };
  if (direction === "left") return { x: -distance };
  return { x: 0, y: 0 };
}

function presetKeyframes(presetId?: string | null): CharacterAnimationKeyframe[] {
  if (presetId === SPRITE_FOCUS_PRESET_ID) return spriteFocusKeyframes();
  if (presetId?.includes("shake")) {
    return [
      { offset: 0, x: 0 },
      { offset: 0.25, x: -16 },
      { offset: 0.5, x: 14 },
      { offset: 0.75, x: -8 },
      { offset: 1, x: 0 },
    ];
  }
  if (presetId?.includes("heartbeat")) {
    return [
      { offset: 0, scale: 1 },
      { offset: 0.38, scale: 1.08 },
      { offset: 0.72, scale: 0.98 },
      { offset: 1, scale: 1 },
    ];
  }
  if (presetId?.includes("out")) return [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }];
  return [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }];
}

export function keyframesForCharacterAnimation(config: CharacterSpriteAnimationConfig): CharacterAnimationKeyframe[] {
  const phase = config.phase ?? "enter";
  if (config.kind === "none") return [];
  if (config.kind === "tween" && Array.isArray(config.keyframes) && config.keyframes.length > 0) return config.keyframes;
  if (config.kind === "preset") return presetKeyframes(config.preset_id);
  if (config.kind === "move" || config.kind === "tween") {
    const offset = movementOffset(config.direction);
    if (phase === "exit") {
      return [
        { offset: 0, opacity: 1, x: 0, y: 0 },
        { offset: 1, opacity: 0, ...offset },
      ];
    }
    if (phase === "emphasis") {
      return [
        { offset: 0, x: 0, y: 0 },
        { offset: 0.5, ...offset },
        { offset: 1, x: 0, y: 0 },
      ];
    }
    return [
      { offset: 0, opacity: 0, ...offset },
      { offset: 1, opacity: 1, x: 0, y: 0 },
    ];
  }
  if (phase === "exit") return [{ offset: 0, opacity: 1 }, { offset: 1, opacity: 0 }];
  if (phase === "emphasis") return [{ offset: 0, opacity: 1 }, { offset: 0.5, opacity: 0.45 }, { offset: 1, opacity: 1 }];
  return [{ offset: 0, opacity: 0 }, { offset: 1, opacity: 1 }];
}

function serializeKeyframes(keyframes: CharacterAnimationKeyframe[]): Record<string, number | string>[] {
  return keyframes.map((keyframe) => {
    const serialized: Record<string, number | string> = { offset: keyframe.offset };
    for (const key of ["opacity", "x", "y", "scale", "rotate", "blur", "brightness"] as const) {
      if (keyframe[key] !== undefined) serialized[key] = keyframe[key];
    }
    if (typeof keyframe.easing === "string" && keyframe.easing.trim()) serialized.easing = keyframe.easing.trim();
    return serialized;
  });
}

export function compileCharacterAnimation(
  config?: CharacterSpriteAnimationConfig | null,
  legacyAnimation?: string | null,
  legacyDisplayName?: string | null,
  visible = true,
): CompiledCharacterAnimation | undefined {
  const normalized = normalizeCharacterAnimationConfig(config, legacyAnimation, legacyDisplayName, visible);
  if (!normalized || normalized.kind === "none") return undefined;
  const duration_ms = clampCharacterAnimationDuration(normalized.duration_ms);
  const delay_ms = clampCharacterAnimationDelay(normalized.delay_ms);
  const transform_origin = sanitizeTransformOrigin(normalized.transform_origin);
  const animation_id = normalized.preset_id || `sprite_${normalized.kind}_${normalized.phase}`;
  return {
    animation_id,
    duration_ms,
    blocking: normalized.blocking === true,
    params: {
      duration: duration_ms,
      duration_ms,
      delay_ms,
      easing: normalized.easing || "ease-out",
      transform_origin: transform_origin ?? null,
      keyframes: serializeKeyframes(keyframesForCharacterAnimation(normalized)),
      character_animation_kind: normalized.kind,
      character_animation_phase: normalized.phase,
      character_animation_direction: normalized.direction ?? null,
      scene_focus: normalized.preset_id === SPRITE_FOCUS_PRESET_ID,
    },
  };
}

export function validateCharacterAnimationConfig(
  config: CharacterSpriteAnimationConfig | undefined | null,
  path = "animation_config",
): CharacterAnimationValidationIssue[] {
  if (!config) return [];
  const normalized = normalizeCharacterAnimationConfig(config);
  if (!normalized) return [];
  const issues: CharacterAnimationValidationIssue[] = [];
  if (!characterAnimationKinds.includes(normalized.kind)) {
    issues.push({ code: "invalid_character_animation_kind", message: `Invalid character animation kind: ${String(normalized.kind)}`, path: `${path}.kind` });
  }
  if (!characterAnimationPhases.includes(normalized.phase)) {
    issues.push({ code: "invalid_character_animation_phase", message: `Invalid character animation phase: ${String(normalized.phase)}`, path: `${path}.phase` });
  }
  if (normalized.direction && !characterAnimationDirections.includes(normalized.direction)) {
    issues.push({ code: "invalid_character_animation_direction", message: `Invalid character animation direction: ${String(normalized.direction)}`, path: `${path}.direction` });
  }
  if (normalized.duration_ms !== undefined && clampCharacterAnimationDuration(normalized.duration_ms) !== Math.round(Number(normalized.duration_ms))) {
    issues.push({ code: "invalid_character_animation_duration", message: "Character animation duration must be between 80 and 10000 ms.", path: `${path}.duration_ms` });
  }
  if (normalized.delay_ms !== undefined && clampCharacterAnimationDelay(normalized.delay_ms) !== Math.round(Number(normalized.delay_ms))) {
    issues.push({ code: "invalid_character_animation_delay", message: "Character animation delay must be between 0 and 10000 ms.", path: `${path}.delay_ms` });
  }
  if (normalized.transform_origin !== undefined && !sanitizeTransformOrigin(normalized.transform_origin)) {
    issues.push({ code: "invalid_character_animation_origin", message: "Character animation transform origin must be a short safe string such as center bottom or 50% 100%.", path: `${path}.transform_origin` });
  }
  const keyframes = normalized.keyframes;
  if (keyframes !== undefined && !Array.isArray(keyframes)) {
    issues.push({ code: "invalid_character_animation_keyframes", message: "Character animation keyframes must be an array.", path: `${path}.keyframes` });
    return issues;
  }
  keyframes?.forEach((keyframe, index) => {
    if (!finiteNumber(keyframe.offset) || keyframe.offset < 0 || keyframe.offset > 1) {
      issues.push({ code: "invalid_character_animation_offset", message: "Character animation keyframe offsets must be numbers from 0 to 1.", path: `${path}.keyframes.${index}.offset` });
    }
    if (keyframe.opacity !== undefined && (!finiteNumber(keyframe.opacity) || keyframe.opacity < 0 || keyframe.opacity > 1)) {
      issues.push({ code: "invalid_character_animation_opacity", message: "Character animation opacity must be a number from 0 to 1.", path: `${path}.keyframes.${index}.opacity` });
    }
    for (const key of ["x", "y", "scale", "rotate", "blur", "brightness"] as const) {
      if (keyframe[key] !== undefined && !finiteNumber(keyframe[key])) {
        issues.push({ code: "invalid_character_animation_number", message: `Character animation ${key} must be a finite number.`, path: `${path}.keyframes.${index}.${key}` });
      }
    }
    if (keyframe.easing !== undefined && (typeof keyframe.easing !== "string" || !keyframe.easing.trim())) {
      issues.push({ code: "invalid_character_animation_keyframe_easing", message: "Character animation keyframe easing must be a non-empty string when provided.", path: `${path}.keyframes.${index}.easing` });
    }
  });
  return issues;
}
