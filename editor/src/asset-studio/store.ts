import { create } from "zustand";
import { createAssetStudioRecipe, defaultAssetStudioPreferences } from "./defaults";
import { loadAssetStudioCache, saveAssetStudioCache } from "./persistence";
import type {
  AssetStudioPreferences,
  ImageGenerationJob,
  ImageGenerationRecipeV1,
} from "./types";

interface AssetStudioState {
  projectId: string;
  recipe: ImageGenerationRecipeV1;
  jobs: ImageGenerationJob[];
  selectedJobId?: string;
  selectedCandidateId?: string;
  preferences: AssetStudioPreferences;
  hydrated: boolean;
  editing: boolean;
  setProject: (projectId: string) => Promise<void>;
  updateRecipe: (patch: Partial<ImageGenerationRecipeV1>) => void;
  replaceRecipe: (recipe: ImageGenerationRecipeV1) => void;
  addJob: (job: ImageGenerationJob) => void;
  updateJob: (jobId: string, patch: Partial<ImageGenerationJob>) => void;
  removeCompletedJobs: () => void;
  clearCachedOutputs: () => void;
  setSelectedJob: (jobId?: string) => void;
  setSelectedCandidate: (candidateId?: string) => void;
  setPreferences: (patch: Partial<AssetStudioPreferences>) => void;
  setEditing: (editing: boolean) => void;
  persist: () => Promise<void>;
}

let hydrateSequence = 0;

function snapshot(state: AssetStudioState) {
  return {
    version: 1 as const,
    projectId: state.projectId,
    recipe: state.recipe,
    jobs: state.jobs,
    preferences: state.preferences,
    savedAt: new Date().toISOString(),
  };
}

function persistSoon(): void {
  queueMicrotask(() => {
    void useAssetStudioStore.getState().persist();
  });
}

export const useAssetStudioStore = create<AssetStudioState>((set, get) => ({
  projectId: "project_local",
  recipe: createAssetStudioRecipe("project_local"),
  jobs: [],
  preferences: defaultAssetStudioPreferences,
  hydrated: false,
  editing: false,

  setProject: async (projectId) => {
    const sequence = ++hydrateSequence;
    set({
      projectId,
      recipe: createAssetStudioRecipe(projectId),
      jobs: [],
      selectedJobId: undefined,
      selectedCandidateId: undefined,
      hydrated: false,
      editing: false,
    });
    const cached = await loadAssetStudioCache(projectId);
    if (sequence !== hydrateSequence || get().projectId !== projectId) return;
    set(
      cached
        ? {
            recipe: cached.recipe,
            jobs: cached.jobs,
            preferences: { ...defaultAssetStudioPreferences, ...cached.preferences },
            hydrated: true,
          }
        : { hydrated: true }
    );
  },

  updateRecipe: (patch) => {
    set((state) => ({
      recipe: { ...state.recipe, ...patch, updatedAt: new Date().toISOString() },
    }));
    persistSoon();
  },

  replaceRecipe: (recipe) => {
    set({ recipe: { ...recipe, recipeId: `${recipe.recipeId}_copy`, updatedAt: new Date().toISOString() } });
    persistSoon();
  },

  addJob: (job) => {
    set((state) => ({
      jobs: [job, ...state.jobs.filter((item) => item.jobId !== job.jobId)].slice(0, 500),
      selectedJobId: job.jobId,
      selectedCandidateId: undefined,
    }));
    persistSoon();
  },

  updateJob: (jobId, patch) => {
    set((state) => ({
      jobs: state.jobs.map((job) => job.jobId === jobId ? { ...job, ...patch } : job),
    }));
    persistSoon();
  },

  removeCompletedJobs: () => {
    set((state) => ({
      jobs: state.jobs.filter((job) => !["completed", "partial", "failed", "cancelled", "interrupted"].includes(job.status)),
      selectedJobId: undefined,
      selectedCandidateId: undefined,
    }));
    persistSoon();
  },

  clearCachedOutputs: () => {
    set((state) => ({
      jobs: state.jobs.map((job) => ({
        ...job,
        candidates: job.candidates.map((candidate) => ({
          ...candidate,
          blob_url: "",
          canSave: false,
          saveBlockedReason: "未保存结果缓存已被清理；配方与任务元数据仍保留。",
        })),
      })),
      selectedCandidateId: undefined,
    }));
    persistSoon();
  },

  setSelectedJob: (selectedJobId) => set({ selectedJobId, selectedCandidateId: undefined }),
  setSelectedCandidate: (selectedCandidateId) => set({ selectedCandidateId }),

  setPreferences: (patch) => {
    set((state) => ({ preferences: { ...state.preferences, ...patch } }));
    persistSoon();
  },

  setEditing: (editing) => set({ editing }),
  persist: async () => saveAssetStudioCache(snapshot(get())),
}));
