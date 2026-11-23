import { create } from "zustand";
import type { RuntimeSettings } from "../types/settings";
import { localStorageAdapter } from "../utils/storage";
import {
  defaultRuntimeSettings,
  LEGACY_RUNTIME_SETTINGS_KEY,
  migrateRuntimeSettings,
  runtimeAspectRatioKey,
  runtimeSettingsKey,
} from "./runtimePreferences";

const initialSettings = defaultRuntimeSettings();

interface SettingsStore {
  settings: RuntimeSettings;
  activeInstallId?: string;
  activeGameId?: string;
  loadForGame: (installId: string, gameId?: string) => void;
  updateSettings: (patch: Partial<RuntimeSettings>) => void;
  resetSettings: () => void;
  persistSettings: () => void;
}

function persistForGame(installId: string | undefined, gameId: string | undefined, settings: RuntimeSettings) {
  if (installId) localStorageAdapter.set(runtimeSettingsKey(installId), settings);
  if (gameId) localStorageAdapter.set(runtimeAspectRatioKey(gameId), settings.gameAspectRatio);
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: initialSettings,
  activeInstallId: undefined,
  loadForGame: (installId, gameId) => {
    const key = runtimeSettingsKey(installId);
    const stored = localStorageAdapter.get<Partial<RuntimeSettings> | undefined>(key, undefined)
      ?? localStorageAdapter.get<Partial<RuntimeSettings> | undefined>(LEGACY_RUNTIME_SETTINGS_KEY, undefined);
    // Fixed players and complete-cartridge previews reuse these install IDs.
    // Never infer their game's ratio from the last cartridge loaded there.
    const fallback = installId === "preview_gamecli" || installId === "fixed_embedded_game"
      ? "default" : stored?.gameAspectRatio;
    const ratio = gameId
      ? localStorageAdapter.get<RuntimeSettings["gameAspectRatio"] | undefined>(runtimeAspectRatioKey(gameId), fallback)
      : stored?.gameAspectRatio;
    const settings = migrateRuntimeSettings({ ...stored, gameAspectRatio: ratio });
    persistForGame(installId, gameId, settings);
    set({ settings, activeInstallId: installId, activeGameId: gameId });
  },
  updateSettings: (patch) => set((state) => {
    const settings = migrateRuntimeSettings({ ...state.settings, ...patch });
    persistForGame(state.activeInstallId, state.activeGameId, settings);
    return { settings };
  }),
  resetSettings: () => {
    const settings = defaultRuntimeSettings();
    persistForGame(get().activeInstallId, get().activeGameId, settings);
    set({ settings });
  },
  persistSettings: () => {
    const state = get();
    persistForGame(state.activeInstallId, state.activeGameId, state.settings);
  },
}));
