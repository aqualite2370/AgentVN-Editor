import type { PackageBuildResultDialogModel } from "./packageBuildResultDialog";
import type {
  AndroidEnvironmentResult,
  ReleaseOptimizationProfile,
  StandalonePackageBuildResult,
  WindowsEnvironmentResult,
} from "./standalonePackage";
import type { PackageExportMode, PackageTargetPlatform } from "./runtimePackage";

export type PackageWorkspaceStage = "settings" | "assets" | "checks";
export type PackageEnvironmentOperation = "check" | "install" | "import";
export type PackageEnvironmentOperationDialogPhase =
  | "preparing"
  | "selecting"
  | "checking"
  | "cleaning"
  | "installing"
  | "verifying"
  | "validating"
  | "extracting"
  | "validated"
  | "deploying"
  | "completed"
  | "failed";

export interface PackageTaskDraft {
  mode: PackageExportMode;
  targetPlatform: PackageTargetPlatform;
  gameId: string;
  title: string;
  author: string;
  version: string;
  androidApplicationId: string;
  language: string;
  description: string;
  includeGallery: boolean;
  includeMetadata: boolean;
  workspaceStage: PackageWorkspaceStage;
  warningsConfirmed: boolean;
  packageOutputDir: string;
  releaseOptimizationProfile: ReleaseOptimizationProfile;
  consoleOpen: boolean;
}

export interface ExportProgressState {
  stage: string;
  detail: string;
  percent: number;
  startedAt: number;
  updatedAt: number;
}

export interface PackageConsoleEntry {
  id: string;
  time: number;
  level: "info" | "success" | "warning" | "error" | string;
  source: string;
  message: string;
}

export interface PackageEnvironmentOperationDialogState {
  platform: PackageTargetPlatform;
  operation: PackageEnvironmentOperation;
  phase: PackageEnvironmentOperationDialogPhase;
  message: string;
  percent: number;
  processedBytes: number;
  totalBytes: number;
  processedFiles: number;
  totalFiles: number;
  reclaimedBytes: number;
  installSource?: "avnenv" | "online";
  startedAt: number;
  detail?: string;
}

export interface PackageTaskDescriptor {
  kind: "export" | "environment";
  runId: string;
  platform: PackageTargetPlatform;
  operation?: PackageEnvironmentOperation;
  status: "running" | "completed" | "failed";
  startedAt: number;
  error?: string;
}

export interface PackageTaskSessionState {
  projectId: string;
  draft: PackageTaskDraft;
  task?: PackageTaskDescriptor;
  environmentTasks: Partial<Record<PackageTargetPlatform, PackageTaskDescriptor>>;
  exportProgress?: ExportProgressState;
  consoleEntries: PackageConsoleEntry[];
  packageBuildResult?: StandalonePackageBuildResult;
  packageResultDialog?: PackageBuildResultDialogModel;
  androidEnvResult?: AndroidEnvironmentResult;
  androidEnvBusy: "check" | "install" | "import" | null;
  windowsEnvResult?: WindowsEnvironmentResult;
  windowsEnvBusy: "check" | "install" | null;
  environmentOperationDialog?: PackageEnvironmentOperationDialogState;
}

export type PackageTaskSessionListener = (state: PackageTaskSessionState) => void;

export interface PackageTaskSession {
  getState(): PackageTaskSessionState;
  subscribe(listener: PackageTaskSessionListener): () => void;
  update(updater: (state: PackageTaskSessionState) => PackageTaskSessionState): void;
  setDraft(partial: Partial<PackageTaskDraft>): void;
  beginTask(input: Omit<PackageTaskDescriptor, "status" | "startedAt"> & { startedAt?: number }): boolean;
  completeTask(input: {
    status: "completed" | "failed";
    platform?: PackageTargetPlatform;
    runId?: string;
    error?: string;
  }): void;
}

const sessions = new Map<string, PackageTaskSession>();

function defaultDraft(input: Partial<PackageTaskDraft>): PackageTaskDraft {
  return {
    mode: "standalone_package",
    targetPlatform: "windows",
    gameId: "agentvn_game",
    title: "",
    author: "",
    version: "0.1.0",
    androidApplicationId: "",
    language: "zh-CN",
    description: "由 AgentVN 导出的视觉小说发布内容。",
    includeGallery: true,
    includeMetadata: true,
    workspaceStage: "settings",
    warningsConfirmed: false,
    packageOutputDir: "",
    releaseOptimizationProfile: "balanced",
    consoleOpen: true,
    ...input,
  };
}

function createSession(projectId: string, draft: Partial<PackageTaskDraft>): PackageTaskSession {
  let state: PackageTaskSessionState = {
    projectId,
    draft: defaultDraft(draft),
    environmentTasks: {},
    consoleEntries: [],
    androidEnvBusy: null,
    windowsEnvBusy: null,
  };
  const listeners = new Set<PackageTaskSessionListener>();

  const session: PackageTaskSession = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(updater) {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    setDraft(partial) {
      session.update((current) => ({
        ...current,
        draft: { ...current.draft, ...partial },
      }));
    },
    beginTask(input) {
      const existing = input.kind === "environment"
        ? state.environmentTasks[input.platform]
        : state.task;
      if (existing?.status === "running") return false;
      if (input.kind === "environment" && state.task?.kind === "export" && state.task.status === "running") {
        session.update((current) => ({
          ...current,
          environmentTasks: {
            ...current.environmentTasks,
            [input.platform]: {
              ...input,
              status: "running",
              startedAt: input.startedAt ?? Date.now(),
            },
          },
        }));
        return true;
      }
      session.update((current) => ({
        ...current,
        environmentTasks: input.kind === "environment"
          ? {
              ...current.environmentTasks,
              [input.platform]: {
                ...input,
                status: "running",
                startedAt: input.startedAt ?? Date.now(),
              },
            }
          : current.environmentTasks,
        task: {
          ...input,
          status: "running",
          startedAt: input.startedAt ?? Date.now(),
        },
      }));
      return true;
    },
    completeTask(input) {
      session.update((current) => {
        const nextEnvironmentTasks = { ...current.environmentTasks };
        if (input.platform) {
          const currentEnvironmentTask = nextEnvironmentTasks[input.platform];
          if (
            currentEnvironmentTask
            && (!input.runId || currentEnvironmentTask.runId === input.runId)
          ) {
            nextEnvironmentTasks[input.platform] = {
              ...currentEnvironmentTask,
              status: input.status,
              error: input.error,
            };
          }
        }
        if (
          !current.task
          || (input.runId && current.task.runId !== input.runId)
        ) {
          return { ...current, environmentTasks: nextEnvironmentTasks };
        }
        return {
          ...current,
          environmentTasks: nextEnvironmentTasks,
          task: {
            ...current.task,
            status: input.status,
            error: input.error,
          },
        };
      });
    },
  };
  return session;
}

export function createPackageTaskSession(
  projectId: string,
  draft: Partial<PackageTaskDraft> = {},
): PackageTaskSession {
  const existing = sessions.get(projectId);
  if (existing) return existing;
  const session = createSession(projectId, draft);
  sessions.set(projectId, session);
  return session;
}

export function getPackageTaskSession(
  projectId: string,
  draft: Partial<PackageTaskDraft> = {},
): PackageTaskSession {
  return createPackageTaskSession(projectId, draft);
}

export function resetPackageTaskSessions(): void {
  sessions.clear();
}
