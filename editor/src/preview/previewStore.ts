import { create } from "zustand";
import type { RuntimeScript } from "../types/nodes";

export type PreviewMode = "full_game" | "current_scene" | "current_branch" | "single_command";

export interface PreviewPayload {
  script: RuntimeScript;
  manifest?: unknown;
  start_scene_id?: string;
  mode: PreviewMode;
  variables: Record<string, unknown>;
  selected_scene_id?: string;
}

interface PreviewState {
  payload?: PreviewPayload;
  setPayload: (payload: PreviewPayload) => void;
  clearPayload: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  setPayload: (payload) => set({ payload }),
  clearPayload: () => set({ payload: undefined }),
}));
