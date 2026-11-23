import type { RuntimeSettings } from "../types/settings";
import { normalizePlayerGameAspectRatio } from "../../../shared/cartridge/gameViewport";

export const RUNTIME_SETTINGS_SCHEMA_VERSION = 8 as const;
export const LEGACY_RUNTIME_SETTINGS_KEY = "vn.runtime.settings";

const defaults: RuntimeSettings = {
  schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
  textSpeed: 36,
  autoSpeed: 1200,
  textSpeedCps: 36,
  autoForwardTime: 6,
  autoForwardAfterClick: false,
  waitForVoice: true,
  autoSaveEnabled: true,
  skipUnread: false,
  skipAfterChoices: false,
  transitions: "all",
  volumeMaster: 1,
  volumeBgm: 0.8,
  volumeSfx: 0.9,
  volumeVoice: 0.9,
  muteAll: false,
  muteBgm: false,
  muteSfx: false,
  muteVoice: false,
  audioEmphasis: false,
  voiceSustain: false,
  voiceAfterMenu: false,
  audioWhenUnfocused: false,
  audioWhenMinimized: false,
  fontScale: 1,
  lineSpacing: 1,
  highContrastText: false,
  gameAspectRatio: "default",
  selfVoicing: false,
  selfVoicingVolumeDrop: 0.35,
  language: "zh-CN",
};

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = numberOr(value, fallback);
  return Math.max(min, Math.min(max, parsed));
}

export function migrateRuntimeSettings(input: Partial<RuntimeSettings> | undefined): RuntimeSettings {
  const source = { ...(input ?? {}) } as Record<string, unknown>;
  delete source.rollbackSideDesktop;
  delete source.rollbackSideMobile;
  delete source.titleBackgroundDimmingOverride;
  delete source.settingsPanelBackgroundDimmingOverride;
  const legacyTextSpeed = clamp(source.textSpeed, 0, 200, defaults.textSpeedCps);
  const textSpeedCps = clamp(source.textSpeedCps, 0, 200, legacyTextSpeed);
  const legacyAutoSpeed = clamp(source.autoSpeed, 300, 3000, defaults.autoSpeed);
  const autoForwardTime = clamp(source.autoForwardTime, 0, 30, legacyAutoSpeed / 200);
  return {
    ...defaults,
    ...source,
    schemaVersion: RUNTIME_SETTINGS_SCHEMA_VERSION,
    textSpeed: textSpeedCps,
    textSpeedCps,
    autoSpeed: legacyAutoSpeed,
    autoForwardTime,
    autoForwardAfterClick: Boolean(source.autoForwardAfterClick),
    waitForVoice: source.waitForVoice !== false,
    autoSaveEnabled: source.autoSaveEnabled !== false,
    skipUnread: Boolean(source.skipUnread),
    skipAfterChoices: Boolean(source.skipAfterChoices),
    // Legacy "none" is accepted on read but normalized to the mandatory
    // runtime page-transition policy.
    transitions: "all",
    volumeMaster: clamp(source.volumeMaster, 0, 1, defaults.volumeMaster),
    volumeBgm: clamp(source.volumeBgm, 0, 1, defaults.volumeBgm),
    volumeSfx: clamp(source.volumeSfx, 0, 1, defaults.volumeSfx),
    volumeVoice: clamp(source.volumeVoice, 0, 1, defaults.volumeVoice),
    muteAll: Boolean(source.muteAll),
    muteBgm: Boolean(source.muteBgm),
    muteSfx: Boolean(source.muteSfx),
    muteVoice: Boolean(source.muteVoice),
    audioEmphasis: Boolean(source.audioEmphasis),
    voiceSustain: Boolean(source.voiceSustain),
    voiceAfterMenu: Boolean(source.voiceAfterMenu),
    audioWhenUnfocused: Boolean(source.audioWhenUnfocused),
    audioWhenMinimized: Boolean(source.audioWhenMinimized),
    fontScale: clamp(source.fontScale, 0.75, 2, defaults.fontScale),
    lineSpacing: clamp(source.lineSpacing, 0.8, 2, defaults.lineSpacing),
    highContrastText: Boolean(source.highContrastText),
    gameAspectRatio: normalizePlayerGameAspectRatio(source.gameAspectRatio),
    selfVoicing: Boolean(source.selfVoicing),
    selfVoicingVolumeDrop: clamp(source.selfVoicingVolumeDrop, 0, 1, defaults.selfVoicingVolumeDrop),
    language: typeof source.language === "string" && source.language.trim() ? source.language : defaults.language,
  };
}

export function runtimeSettingsKey(installId: string): string {
  return `vn.runtime.settings.${installId}`;
}

export function runtimeAspectRatioKey(gameId: string): string {
  return `vn.runtime.aspect-ratio.${encodeURIComponent(gameId)}`;
}

export function defaultRuntimeSettings(): RuntimeSettings {
  return structuredClone(defaults);
}

export function autoForwardDelayMs(text: string, autoForwardTime: number): number | undefined {
  const seconds = clamp(autoForwardTime, 0, 30, defaults.autoForwardTime);
  if (seconds <= 0) return undefined;
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locale?: string | string[],
      options?: { granularity: "grapheme" },
    ) => { segment(value: string): Iterable<unknown> };
  }).Segmenter;
  const graphemeCount = Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text)).length
    : Array.from(text).length;
  return Math.max(300, Math.round(seconds * 1000 * (graphemeCount + 25) / 250));
}
