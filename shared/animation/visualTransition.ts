export const VISUAL_TRANSITION_KINDS = [
  "none",
  "fade",
  "crossfade",
  "reveal_center",
  "wipe_left_to_right",
  "wipe_right_to_left",
  "blur",
  "slide_left",
  "slide_right",
  "slide_up",
  "slide_down",
] as const;

export type VisualTransitionKind = (typeof VISUAL_TRANSITION_KINDS)[number];

export const VISUAL_TRANSITION_EASING_PRESETS = [
  "linear",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
] as const;

export type VisualTransitionEasingPreset = (typeof VISUAL_TRANSITION_EASING_PRESETS)[number];
export type VisualTransitionEasing =
  | VisualTransitionEasingPreset
  | `cubic-bezier(${string})`;

export interface VisualTransitionConfig {
  kind: VisualTransitionKind;
  duration_ms?: number;
  easing?: VisualTransitionEasing;
}

export interface NormalizedVisualTransitionConfig {
  kind: VisualTransitionKind;
  duration_ms: number;
  easing: VisualTransitionEasing;
}

export interface VisualTransitionValidationIssue {
  code:
    | "visual_transition_config"
    | "visual_transition_kind"
    | "visual_transition_duration"
    | "visual_transition_easing";
  message: string;
  path?: string;
}

export const MIN_VISUAL_TRANSITION_DURATION_MS = 80;
export const MAX_VISUAL_TRANSITION_DURATION_MS = 10_000;

export const DEFAULT_VISUAL_TRANSITION_CONFIG: NormalizedVisualTransitionConfig = {
  kind: "crossfade",
  duration_ms: 420,
  easing: "ease-in-out",
};

const MAX_CUBIC_BEZIER_Y_MAGNITUDE = 4;
const numberPattern = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
const cubicBezierPattern = new RegExp(
  `^cubic-bezier\\(\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*,\\s*(${numberPattern})\\s*\\)$`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isVisualTransitionKind(value: unknown): value is VisualTransitionKind {
  return typeof value === "string" && VISUAL_TRANSITION_KINDS.includes(value as VisualTransitionKind);
}

function normalizedNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function parseCubicBezier(value: string): VisualTransitionEasing | undefined {
  const match = cubicBezierPattern.exec(value);
  if (!match) return undefined;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return undefined;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
  if (Math.abs(y1) > MAX_CUBIC_BEZIER_Y_MAGNITUDE || Math.abs(y2) > MAX_CUBIC_BEZIER_Y_MAGNITUDE) return undefined;
  return `cubic-bezier(${normalizedNumber(x1)}, ${normalizedNumber(y1)}, ${normalizedNumber(x2)}, ${normalizedNumber(y2)})`;
}

export function parseVisualTransitionEasing(value: unknown): VisualTransitionEasing | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (VISUAL_TRANSITION_EASING_PRESETS.includes(trimmed as VisualTransitionEasingPreset)) {
    return trimmed as VisualTransitionEasingPreset;
  }
  return parseCubicBezier(trimmed);
}

export function sanitizeVisualTransitionEasing(value: unknown): VisualTransitionEasing {
  return parseVisualTransitionEasing(value) ?? DEFAULT_VISUAL_TRANSITION_CONFIG.easing;
}

export function normalizeVisualTransitionDuration(value: unknown, kind: VisualTransitionKind): number {
  if (kind === "none") return 0;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VISUAL_TRANSITION_CONFIG.duration_ms;
  }
  return Math.min(
    MAX_VISUAL_TRANSITION_DURATION_MS,
    Math.max(MIN_VISUAL_TRANSITION_DURATION_MS, Math.round(value)),
  );
}

export function normalizeVisualTransition(value: unknown): NormalizedVisualTransitionConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const config = isRecord(value) ? value : {};
  const kind = isVisualTransitionKind(config.kind)
    ? config.kind
    : DEFAULT_VISUAL_TRANSITION_CONFIG.kind;
  return {
    kind,
    duration_ms: normalizeVisualTransitionDuration(config.duration_ms, kind),
    easing: sanitizeVisualTransitionEasing(config.easing),
  };
}

const legacyBackgroundKindMap: Record<string, VisualTransitionKind> = {
  none: "none",
  instant: "none",
  cut: "none",
  fade: "fade",
  fade_in: "fade",
  crossfade: "crossfade",
  cross_fade: "crossfade",
  dissolve: "crossfade",
  center: "reveal_center",
  center_out: "reveal_center",
  reveal_center: "reveal_center",
  left_to_right: "wipe_left_to_right",
  wipe_left_to_right: "wipe_left_to_right",
  wipe_ltr: "wipe_left_to_right",
  right_to_left: "wipe_right_to_left",
  wipe_right_to_left: "wipe_right_to_left",
  wipe_rtl: "wipe_right_to_left",
  blur: "blur",
  blur_fade: "blur",
  slide_left: "slide_left",
  slide_right: "slide_right",
  slide_up: "slide_up",
  slide_down: "slide_down",
};

export function mapLegacyBackgroundTransition(value: unknown): NormalizedVisualTransitionConfig | undefined {
  if (typeof value !== "string") return undefined;
  const legacyKey = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const kind = legacyBackgroundKindMap[legacyKey];
  return kind ? normalizeVisualTransition({ kind }) : undefined;
}

export function resolveVisualTransition(
  config: unknown,
  legacyBackgroundTransition?: unknown,
): NormalizedVisualTransitionConfig | undefined {
  return normalizeVisualTransition(config) ?? mapLegacyBackgroundTransition(legacyBackgroundTransition);
}

export function validateVisualTransitionConfig(
  value: unknown,
  path = "transition",
): VisualTransitionValidationIssue[] {
  if (value === undefined || value === null) return [];
  if (!isRecord(value)) {
    return [{
      code: "visual_transition_config",
      message: "Visual transition config must be an object.",
      path,
    }];
  }

  const issues: VisualTransitionValidationIssue[] = [];
  if (!isVisualTransitionKind(value.kind)) {
    issues.push({
      code: "visual_transition_kind",
      message: `Unsupported visual transition kind: ${String(value.kind)}.`,
      path: `${path}.kind`,
    });
  }

  if (value.duration_ms !== undefined) {
    const minimum = value.kind === "none" ? 0 : MIN_VISUAL_TRANSITION_DURATION_MS;
    if (
      typeof value.duration_ms !== "number"
      || !Number.isFinite(value.duration_ms)
      || value.duration_ms < minimum
      || value.duration_ms > MAX_VISUAL_TRANSITION_DURATION_MS
    ) {
      issues.push({
        code: "visual_transition_duration",
        message: `Visual transition duration must be a finite number between ${minimum} and ${MAX_VISUAL_TRANSITION_DURATION_MS} milliseconds.`,
        path: `${path}.duration_ms`,
      });
    }
  }

  if (value.easing !== undefined && !parseVisualTransitionEasing(value.easing)) {
    issues.push({
      code: "visual_transition_easing",
      message: "Visual transition easing must be a safe preset or restricted cubic-bezier value.",
      path: `${path}.easing`,
    });
  }

  return issues;
}
