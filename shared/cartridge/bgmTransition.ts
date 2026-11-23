export const DEFAULT_BGM_FADE_MS = 500;

export type BgmAction = "play" | "stop";

export interface BgmCommandFieldsInput {
  action?: unknown;
  fade_ms?: unknown;
}

export interface NormalizedBgmCommandFields {
  action: BgmAction;
  fade_ms: number;
}

function normalizeFadeMs(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return Math.round(numeric);
}

export function normalizeBgmCommandFields(input: BgmCommandFieldsInput): NormalizedBgmCommandFields {
  const legacyFade = input.action === "fade";
  return {
    action: input.action === "stop" || legacyFade ? "stop" : "play",
    fade_ms: normalizeFadeMs(input.fade_ms, legacyFade ? DEFAULT_BGM_FADE_MS : 0),
  };
}
