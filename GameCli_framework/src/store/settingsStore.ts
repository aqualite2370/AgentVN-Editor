import { create } from "zustand";
import type { RuntimeSettings } from "../types/settings";
import { localStorageAdapter } from "../utils/storage";

const SETTINGS_KEY = "vn.runtime.settings";
type StoredRuntimeSettings = Partial<RuntimeSettings> & { theme?: unknown };
type LegacyStoredRuntimeSettings = StoredRuntimeSettings & {
  titleBackgroundDimmingOverride?: unknown;
  settingsPanelBackgroundDimmingOverride?: unknown;
};

const defaults: RuntimeSettings = {
  schemaVersion: 7,
  textSpeed: 36,
  autoSpeed: 1200,
  autoSaveEnabled: true,
  skipUnread: false,
  volumeBgm: 0.8,
  volumeSfx: 0.9,
  volumeVoice: 0.9,
  language: "zh-CN",
};

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function migrateSettings(input: LegacyStoredRuntimeSettings | undefined): RuntimeSettings {
  if (!input) return defaults;
  const stored = { ...input };
  delete stored.theme;
  delete stored.titleBackgroundDimmingOverride;
  delete stored.settingsPanelBackgroundDimmingOverride;
  const oldTextSpeed = Number(input.textSpeed);
  const textSpeed = typeof input.schemaVersion === "number" && input.schemaVersion >= 2
    ? clamp(Number.isFinite(oldTextSpeed) ? oldTextSpeed : defaults.textSpeed, 0, 120)
    : clamp(Math.round(1000 / Math.max(1, Number.isFinite(oldTextSpeed) ? oldTextSpeed : 28)), 1, 120);
  return {
    ...defaults,
    ...stored,
    schemaVersion: 7,
    textSpeed,
    autoSpeed: clamp(numberOr(input.autoSpeed, defaults.autoSpeed), 300, 3000),
    autoSaveEnabled: input.autoSaveEnabled !== false,
    volumeBgm: clamp(numberOr(input.volumeBgm, defaults.volumeBgm), 0, 1),
    volumeSfx: clamp(numberOr(input.volumeSfx, defaults.volumeSfx), 0, 1),
    volumeVoice: clamp(numberOr(input.volumeVoice, defaults.volumeVoice), 0, 1),
    skipUnread: Boolean(input.skipUnread),
    language: input.language || defaults.language,
  };
}

const initialSettings = migrateSettings(localStorageAdapter.get<StoredRuntimeSettings | undefined>(SETTINGS_KEY, undefined));
localStorageAdapter.set(SETTINGS_KEY, initialSettings);

interface SettingsStore {
  settings: RuntimeSettings;
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
  resetSettings: () => void;
  persistSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: initialSettings,
  updateSettings: (patch) => set((state) => {
    const settings = migrateSettings({ ...state.settings, ...patch, schemaVersion: 7 });
    localStorageAdapter.set(SETTINGS_KEY, settings);
    return { settings };
  }),
  resetSettings: () => {
    localStorageAdapter.set(SETTINGS_KEY, defaults);
    set({ settings: defaults });
  },
  persistSettings: () => localStorageAdapter.set(SETTINGS_KEY, get().settings)
}));
