import type { SpeakerFocusConfig } from "./types";

export const DEFAULT_SPEAKER_FOCUS: SpeakerFocusConfig = {
  enabled: true,
  scale: 1.05,
  duration_ms: 220,
};

export const MIN_SPEAKER_FOCUS_SCALE = 1;
export const MAX_SPEAKER_FOCUS_SCALE = 1.15;
export const MIN_SPEAKER_FOCUS_DURATION_MS = 80;
export const MAX_SPEAKER_FOCUS_DURATION_MS = 1000;

export function sanitizeSpeakerFocus(value: unknown): SpeakerFocusConfig {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const scale = typeof source.scale === "number" && Number.isFinite(source.scale)
    ? Math.min(MAX_SPEAKER_FOCUS_SCALE, Math.max(MIN_SPEAKER_FOCUS_SCALE, source.scale))
    : DEFAULT_SPEAKER_FOCUS.scale;
  const duration = typeof source.duration_ms === "number" && Number.isFinite(source.duration_ms)
    ? Math.min(MAX_SPEAKER_FOCUS_DURATION_MS, Math.max(MIN_SPEAKER_FOCUS_DURATION_MS, Math.round(source.duration_ms)))
    : DEFAULT_SPEAKER_FOCUS.duration_ms;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SPEAKER_FOCUS.enabled,
    scale,
    duration_ms: duration,
  };
}
