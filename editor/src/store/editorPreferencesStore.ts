import { create } from "zustand";

interface EditorPreferencesState {
  hoverHelpEnabled: boolean;
  setHoverHelpEnabled: (enabled: boolean) => void;
}

const hoverHelpStorageKey = "agentvn.hoverHelpEnabled";

function initialHoverHelpEnabled(): boolean {
  return window.localStorage.getItem(hoverHelpStorageKey) !== "false";
}

export const useEditorPreferencesStore = create<EditorPreferencesState>((set) => ({
  hoverHelpEnabled: initialHoverHelpEnabled(),
  setHoverHelpEnabled: (hoverHelpEnabled) => {
    window.localStorage.setItem(hoverHelpStorageKey, String(hoverHelpEnabled));
    set({ hoverHelpEnabled });
  },
}));
