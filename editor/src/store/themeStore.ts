import { create } from "zustand";

export type ThemeTone = "blue_gray" | "white_gray";

interface ThemeState {
  themeTone: ThemeTone;
  setThemeTone: (themeTone: ThemeTone) => void;
  toggleThemeTone: () => void;
}

const storageKey = "agentvn.themeTone";

function initialTheme(): ThemeTone {
  const stored = window.localStorage.getItem(storageKey);
  return stored === "white_gray" || stored === "blue_gray" ? stored : "white_gray";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  themeTone: initialTheme(),
  setThemeTone: (themeTone) => {
    window.localStorage.setItem(storageKey, themeTone);
    set({ themeTone });
  },
  toggleThemeTone: () => {
    const next = get().themeTone === "blue_gray" ? "white_gray" : "blue_gray";
    window.localStorage.setItem(storageKey, next);
    set({ themeTone: next });
  },
}));
