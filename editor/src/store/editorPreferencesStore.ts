import { create } from "zustand";

interface EditorPreferencesState {
  hoverHelpEnabled: boolean;
  setHoverHelpEnabled: (enabled: boolean) => void;
  projectExportDirectories: Record<string, string>;
  setProjectExportDirectory: (projectId: string, directory: string | null) => void;
}

const hoverHelpStorageKey = "agentvn.hoverHelpEnabled";
const projectDirectoriesStorageKey = "agentvn.projectExportDirectories.v1";

function initialHoverHelpEnabled(): boolean {
  return window.localStorage.getItem(hoverHelpStorageKey) !== "false";
}

function initialProjectExportDirectories(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(projectDirectoriesStorageKey) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, directory]) =>
      Boolean(id) && typeof directory === "string" && Boolean(directory.trim()))) as Record<string, string>;
  } catch {
    return {};
  }
}

export const useEditorPreferencesStore = create<EditorPreferencesState>((set) => ({
  hoverHelpEnabled: initialHoverHelpEnabled(),
  projectExportDirectories: initialProjectExportDirectories(),
  setHoverHelpEnabled: (hoverHelpEnabled) => {
    window.localStorage.setItem(hoverHelpStorageKey, String(hoverHelpEnabled));
    set({ hoverHelpEnabled });
  },
  setProjectExportDirectory: (projectId, directory) => set((state) => {
    if (!projectId) return state;
    const next = { ...state.projectExportDirectories };
    if (directory?.trim()) next[projectId] = directory.trim();
    else delete next[projectId];
    window.localStorage.setItem(projectDirectoriesStorageKey, JSON.stringify(next));
    return { projectExportDirectories: next };
  }),
}));
