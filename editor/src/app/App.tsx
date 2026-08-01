import "./App.css";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { backendClient } from "../api/backendClient";
import type { ProjectSummary, SharedEditorState, SharedProjectGraphState } from "../api/types";
import { AppErrorBoundary } from "../components/common/AppErrorBoundary";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { HoverHelpLayer } from "../components/common/HoverHelpLayer";
import { NovelProcessTaskWorkbench } from "../components/novel-import/NovelProcessTaskWorkbench";
import { ProjectHome, type RecentProjectRecord } from "../components/project/ProjectHome";
import { hydrateApiKeys } from "../providers/apiKeyStorage";
import { hydrateProviderState } from "../providers/providerRegistry";
import { useEditorStore } from "../store/editorStore";
import { useNovelImportStore } from "../store/novelImportStore";
import { useProjectStore } from "../store/projectStore";
import { useThemeStore } from "../store/themeStore";
import type { NovelPersistenceState } from "../novel-import/types";
import type { EditorProjectFile } from "../types/nodes";
import { parseProjectFile } from "../utils/projectImport";
import { writeProjectBackupIfChanged } from "../utils/projectTimeline";
import { ProjectEntryLoadingOverlay } from "./ProjectEntryLoadingOverlay";
import { hydrateEditorFromProject as hydrateEditorFromProjectShared } from "./projectHydration";
import { installNativeInteractionGuards } from "../../../shared/ui/nativeInteractionGuards";

const VisualNovelEditor = lazy(() =>
  import("../components/editor/VisualNovelEditor").then((module) => ({ default: module.VisualNovelEditor }))
);

const recentProjectsKey = "agentvn.recentProjects";
const currentDraftKey = "agentvn.currentProjectDraft";
const legacyProviderConnectionsKey = "agentvn.providerConnections";
const legacyProviderModelsKey = "agentvn.providerModels";
const legacyProviderSelectionsKey = "agentvn.providerSelections";
const legacyProviderSecretsKey = "agentvn.providerSecrets";
const legacyEditorStoreKey = "agentvn.editor";
const legacyProjectStoreKey = "agentvn.project";
const defaultViewTransitionMs = 1120;
const cartridgeExitTransitionMs = 980;
const reducedMotionTransitionMs = 360;
const projectEntryMinLoadingMs = 1050;
const projectEntryPrerenderTimeoutMs = 1800;
const projectEntryClosingMs = 1120;
const DEFAULT_BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8278";
const legacyProjectStorageMaxChars = 16 * 1024 * 1024;
type TransitionIntent = "enter-cartridge" | "exit-cartridge" | "standard";
type EntryOverlayState = "idle" | "loading" | "ready" | "closing";
type TransitionHomeSnapshot = {
  recentProjects: RecentProjectRecord[];
  currentDraft?: EditorProjectFile;
  homeStatus?: string;
};

function sanitizeLegacyEditorSettings(settings?: Record<string, unknown>): Record<string, unknown> {
  if (!settings) return {};
  const { backendBaseUrl: _backendBaseUrl, runtimeShellUrl: _runtimeShellUrl, ...rest } = settings as Record<string, unknown>;
  return rest;
}

function readJsonFromLocalStorage<T>(key: string, options: { maxChars?: number } = {}): T | undefined {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    if (options.maxChars && raw.length > options.maxChars) return undefined;
    const parsed = JSON.parse(raw) as T | { state?: T };
    if (parsed && typeof parsed === "object" && "state" in parsed && parsed.state) {
      return parsed.state;
    }
    return parsed as T;
  } catch (error) {
    reportFrontendError("editor.local-storage", error, { operation: "read", key });
    return undefined;
  }
}

function writeJsonToLocalStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    reportFrontendError("editor.local-storage", error, { operation: "write", key });
    // Local storage is only a fallback; quota/security errors must not block the editor.
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function EditorRouteFallback() {
  return (
    <div className="editor-route-loading" role="status" aria-live="polite">
      <strong>正在载入编辑器</strong>
      <span>画布、节点检查器和工具面板将按需加载。</span>
    </div>
  );
}

async function waitForEditorPrerender(timeoutMs: number): Promise<void> {
  const requiredSelectors = [".editor-shell", ".editor-toolbar", ".flow-surface", ".node-palette", ".inspector-panel"];
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (requiredSelectors.every((selector) => document.querySelector(selector))) {
      await nextAnimationFrame();
      await nextAnimationFrame();
      return;
    }
    await nextAnimationFrame();
  }
}

function buildDraftFromSharedState(state: Pick<SharedEditorState, "project_graph" | "project_metadata">): EditorProjectFile | undefined {
  const graph = state.project_graph;
  const metadata = state.project_metadata ?? {};
  if (!Array.isArray(graph?.nodes) || graph.nodes.length === 0) return undefined;
  return {
    schema_version: metadata.schemaVersion ?? "1.0.0",
    project_id: metadata.projectId ?? "project_local",
    title: metadata.title ?? "未命名视觉小说",
    author: metadata.author ?? "",
    nodes: graph.nodes,
    edges: graph.edges,
    viewport: graph.viewport,
    memory_mode: graph.memoryMode,
    asset_manifest: Array.isArray(metadata.assetManifest) ? metadata.assetManifest : [],
    editor_settings: metadata.settings ?? {},
    created_at: metadata.createdAt ?? new Date().toISOString(),
    updated_at: metadata.updatedAt ?? new Date().toISOString(),
  };
}

function toRecentProjectRecords(projects: EditorProjectFile[]): RecentProjectRecord[] {
  return projects.map((project) => ({
    project_id: project.project_id,
    title: project.title,
    author: project.author,
    created_at: project.created_at,
    updated_at: project.updated_at,
    node_count: project.nodes.length,
    edge_count: project.edges.length,
    schema_version: project.schema_version,
    has_detail: true,
    project,
  }));
}

function summaryToRecentProjectRecord(summary: ProjectSummary): RecentProjectRecord {
  return {
    project_id: summary.project_id,
    title: summary.title,
    author: summary.author,
    created_at: summary.created_at,
    updated_at: summary.updated_at,
    node_count: summary.node_count,
    edge_count: summary.edge_count,
    schema_version: summary.schema_version,
    has_detail: summary.has_detail,
  };
}

function projectToRecentProjectRecord(project: EditorProjectFile): RecentProjectRecord {
  return toRecentProjectRecords([project])[0];
}

function normalizeRecentProjects(projects: RecentProjectRecord[], currentDraft?: EditorProjectFile): RecentProjectRecord[] {
  const records = projects.map((record) => ({ ...record }));
  if (!currentDraft) return records;
  const currentRecord = projectToRecentProjectRecord(currentDraft);
  return [currentRecord, ...records.filter((item) => item.project_id !== currentDraft.project_id)];
}

function mergeRecentProjectRecords(primary: RecentProjectRecord[], fallback: RecentProjectRecord[]): RecentProjectRecord[] {
  const seen = new Set<string>();
  const merged: RecentProjectRecord[] = [];
  for (const record of [...primary, ...fallback]) {
    if (!record.project_id || seen.has(record.project_id)) continue;
    seen.add(record.project_id);
    merged.push(record);
  }
  return merged;
}

function hydrateNovelImportFromProject(projectFile?: EditorProjectFile): void {
  useNovelImportStore.getState().hydratePersistence(projectFile?.editor_settings?.novelPersistence as NovelPersistenceState | undefined);
}

function migrateLegacyState(remote: SharedEditorState): Partial<SharedEditorState> {
  const payload: Partial<SharedEditorState> = {};

  const legacyProviderConnections = remote.provider_connections.length === 0
    ? readJsonFromLocalStorage<SharedEditorState["provider_connections"]>(legacyProviderConnectionsKey)
    : undefined;
  if (remote.provider_connections.length === 0 && Array.isArray(legacyProviderConnections) && legacyProviderConnections.length > 0) {
    payload.provider_connections = legacyProviderConnections;
  }
  const legacyProviderModels = remote.provider_models.length === 0
    ? readJsonFromLocalStorage<SharedEditorState["provider_models"]>(legacyProviderModelsKey)
    : undefined;
  if (remote.provider_models.length === 0 && Array.isArray(legacyProviderModels) && legacyProviderModels.length > 0) {
    payload.provider_models = legacyProviderModels;
  }
  const legacyProviderSelections = Object.keys(remote.provider_selections).length === 0
    ? readJsonFromLocalStorage<SharedEditorState["provider_selections"]>(legacyProviderSelectionsKey)
    : undefined;
  if (Object.keys(remote.provider_selections).length === 0 && legacyProviderSelections) {
    payload.provider_selections = legacyProviderSelections;
  }
  const legacyProviderSecrets = Object.keys(remote.provider_secrets).length === 0
    ? readJsonFromLocalStorage<Record<string, string>>(legacyProviderSecretsKey)
    : undefined;
  if (Object.keys(remote.provider_secrets).length === 0 && legacyProviderSecrets) {
    payload.provider_secrets = legacyProviderSecrets;
  }

  if (remote.project_graph.nodes.length === 0) {
    const legacyCurrentDraft = readJsonFromLocalStorage<EditorProjectFile>(currentDraftKey, { maxChars: legacyProjectStorageMaxChars });
    if (legacyCurrentDraft) {
      payload.project_graph = {
        nodes: legacyCurrentDraft.nodes,
        edges: legacyCurrentDraft.edges,
        viewport: legacyCurrentDraft.viewport,
        memoryMode: legacyCurrentDraft.memory_mode,
      };
      payload.project_metadata = {
        projectId: legacyCurrentDraft.project_id,
        title: legacyCurrentDraft.title,
        author: legacyCurrentDraft.author,
        createdAt: legacyCurrentDraft.created_at,
        updatedAt: legacyCurrentDraft.updated_at,
        assetManifest: legacyCurrentDraft.asset_manifest,
        settings: sanitizeLegacyEditorSettings(legacyCurrentDraft.editor_settings),
      };
    } else {
      const legacyEditorStore = readJsonFromLocalStorage<{
        nodes?: EditorProjectFile["nodes"];
        edges?: EditorProjectFile["edges"];
        viewport?: EditorProjectFile["viewport"];
        memoryMode?: SharedProjectGraphState["memoryMode"];
      }>(legacyEditorStoreKey, { maxChars: legacyProjectStorageMaxChars });
      const legacyProjectStore = legacyEditorStore ? readJsonFromLocalStorage<{
        projectId?: string;
        title?: string;
        author?: string;
        createdAt?: string;
        updatedAt?: string;
        assetManifest?: unknown[];
        settings?: Record<string, unknown>;
        schemaVersion?: string;
        editorVersion?: string;
      }>(legacyProjectStoreKey, { maxChars: legacyProjectStorageMaxChars }) : undefined;
      if (legacyEditorStore) {
        payload.project_graph = {
          nodes: legacyEditorStore.nodes ?? [],
          edges: legacyEditorStore.edges ?? [],
          viewport: legacyEditorStore.viewport ?? { x: 0, y: 0, zoom: 1 },
          memoryMode: legacyEditorStore.memoryMode ?? "hybrid",
        };
        payload.project_metadata = {
          projectId: legacyProjectStore?.projectId ?? "project_local",
          title: legacyProjectStore?.title ?? "未命名视觉小说",
          author: legacyProjectStore?.author ?? "",
          createdAt: legacyProjectStore?.createdAt,
          updatedAt: legacyProjectStore?.updatedAt,
          assetManifest: legacyProjectStore?.assetManifest ?? [],
          settings: sanitizeLegacyEditorSettings(legacyProjectStore?.settings),
          schemaVersion: legacyProjectStore?.schemaVersion,
          editorVersion: legacyProjectStore?.editorVersion,
        };
      }
    }
  }

  const legacyRecentProjects = remote.recent_projects.length === 0
    ? readJsonFromLocalStorage<RecentProjectRecord[]>(recentProjectsKey, { maxChars: legacyProjectStorageMaxChars })
    : undefined;
  if (remote.recent_projects.length === 0 && Array.isArray(legacyRecentProjects) && legacyRecentProjects.length > 0) {
    payload.recent_projects = legacyRecentProjects
      .map((item) => item.project)
      .filter((project): project is EditorProjectFile => Boolean(project));
  }

  return payload;
}

export function App() {
  const [screen, setScreen] = useState<"home" | "editor">("home");
  const [previousScreen, setPreviousScreen] = useState<"home" | "editor">();
  const [transitionIntent, setTransitionIntent] = useState<TransitionIntent>("standard");
  const [recentProjects, setRecentProjects] = useState<RecentProjectRecord[]>([]);
  const [currentDraft, setCurrentDraft] = useState<EditorProjectFile | undefined>();
  const [homeStatus, setHomeStatus] = useState<string>();
  const [exitingHomeSnapshot, setExitingHomeSnapshot] = useState<TransitionHomeSnapshot>();
  const [entryOverlayState, setEntryOverlayState] = useState<EntryOverlayState>("idle");
  const [homeHydrationOverlayState, setHomeHydrationOverlayState] = useState<EntryOverlayState>("loading");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [didHydrate, setDidHydrate] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);
  const createProjectInFlightRef = useRef(false);
  const homeHydrationStartedAtRef = useRef(typeof performance === "undefined" ? 0 : performance.now());
  const committedHomeSnapshotRef = useRef<TransitionHomeSnapshot>({
    recentProjects: [],
  });
  const themeTone = useThemeStore((state) => state.themeTone);
  const project = useProjectStore();
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const viewport = useEditorStore((state) => state.viewport);
  const memoryMode = useEditorStore((state) => state.memoryMode);
  const importProject = useEditorStore((state) => state.importProject);
  const exportProject = useEditorStore((state) => state.exportProject);
  const resetGraph = useEditorStore((state) => state.resetGraph);

  useEffect(() => installNativeInteractionGuards(document), []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeTone;
  }, [themeTone]);

  useEffect(() => {
    backendClient.setBaseUrl(DEFAULT_BACKEND_BASE_URL);
  }, []);

  useEffect(() => {
    let mounted = true;

    const localDraft = readJsonFromLocalStorage<EditorProjectFile>(currentDraftKey, { maxChars: legacyProjectStorageMaxChars });
    const localRecentProjects = readJsonFromLocalStorage<RecentProjectRecord[]>(recentProjectsKey, { maxChars: legacyProjectStorageMaxChars });
    if (localDraft) {
      hydrateEditorFromProjectShared(localDraft);
      setCurrentDraft(localDraft);
    }
    if (Array.isArray(localRecentProjects)) {
      setRecentProjects(normalizeRecentProjects(localRecentProjects, localDraft));
    }

    async function loadSharedState() {
      const loaded = await backendClient.loadProjectState({ includeProject: false, includeRecentProjects: false });
      if (!mounted) return;
      if (!loaded) {
        setDidHydrate(true);
        return;
      }
      const migrationPayload = migrateLegacyState(loaded);
      const hasMigration = Object.keys(migrationPayload).length > 0;
      const sharedState = hasMigration ? await backendClient.saveProjectState(migrationPayload) : loaded;
      if (!mounted) return;

      hydrateProviderState(sharedState);
      hydrateApiKeys(sharedState.provider_secrets);

      const draft = buildDraftFromSharedState(sharedState);
      if (draft) {
        hydrateEditorFromProjectShared(draft);
        setCurrentDraft(draft);
      }
      const catalog = await backendClient.loadProjectCatalog();
      if (!mounted) return;
      const catalogRecords = catalog.map(summaryToRecentProjectRecord);
      const sharedRecentRecords = Array.isArray(sharedState.recent_projects)
        ? toRecentProjectRecords(sharedState.recent_projects)
        : [];
      const nextRecentProjects = normalizeRecentProjects(mergeRecentProjectRecords(catalogRecords, sharedRecentRecords), draft);
      setRecentProjects(nextRecentProjects);
      writeJsonToLocalStorage(recentProjectsKey, nextRecentProjects);
      setDidHydrate(true);
    }

    void loadSharedState().catch((error) => {
      reportFrontendError("editor.project", error, { operation: "hydrate-shared-state" });
      if (mounted) setHomeStatus("后端暂不可用，当前显示本机缓存项目。");
      if (mounted) setDidHydrate(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const isSwitchingView = Boolean(previousScreen);
  const isEntryOverlayVisible = entryOverlayState !== "idle";
  const isHomeHydrationOverlayVisible = homeHydrationOverlayState !== "idle";
  const isEnterCartridgeTransition = isSwitchingView && transitionIntent === "enter-cartridge";
  const isExitCartridgeTransition = isSwitchingView && transitionIntent === "exit-cartridge";

  useLayoutEffect(() => {
    if (screen !== "home" || previousScreen) return;
    committedHomeSnapshotRef.current = { recentProjects, currentDraft, homeStatus };
  }, [screen, previousScreen, recentProjects, currentDraft, homeStatus]);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
  }, []);

  useEffect(() => {
    if (entryOverlayState !== "loading" || screen !== "editor" || previousScreen !== "home" || transitionIntent !== "enter-cartridge") return;
    let cancelled = false;

    async function prepareEditorEntry() {
      await Promise.all([
        waitForEditorPrerender(projectEntryPrerenderTimeoutMs),
        delay(projectEntryMinLoadingMs),
      ]);
      if (cancelled) return;
      setEntryOverlayState("ready");
    }

    void prepareEditorEntry();
    return () => {
      cancelled = true;
    };
  }, [entryOverlayState, previousScreen, screen, transitionIntent]);

  useEffect(() => {
    if (!didHydrate || homeHydrationOverlayState !== "loading") return;
    const elapsedMs = performance.now() - homeHydrationStartedAtRef.current;
    const timer = window.setTimeout(
      () => setHomeHydrationOverlayState("ready"),
      Math.max(0, projectEntryMinLoadingMs - elapsedMs)
    );
    return () => window.clearTimeout(timer);
  }, [didHydrate, homeHydrationOverlayState]);

  useEffect(() => {
    if (homeHydrationOverlayState !== "closing") return;
    const closingMs = prefersReducedMotion() ? reducedMotionTransitionMs : projectEntryClosingMs;
    const timer = window.setTimeout(() => setHomeHydrationOverlayState("idle"), closingMs);
    return () => window.clearTimeout(timer);
  }, [homeHydrationOverlayState]);

  useEffect(() => {
    if (entryOverlayState !== "closing") return;
    const closingMs = prefersReducedMotion() ? reducedMotionTransitionMs : projectEntryClosingMs;
    const timer = window.setTimeout(() => {
      setPreviousScreen(undefined);
      setTransitionIntent("standard");
      setExitingHomeSnapshot(undefined);
      setEntryOverlayState("idle");
      transitionTimerRef.current = null;
    }, closingMs);
    return () => window.clearTimeout(timer);
  }, [entryOverlayState]);

  useEffect(() => {
    if (!didHydrate || screen !== "editor") return;
    const snapshot = exportProject({
      projectId: project.projectId,
      title: project.title,
      author: project.author,
      assetManifest: project.assetManifest,
      editorSettings: { ...project.settings },
      createdAt: project.createdAt,
    });
    setCurrentDraft(snapshot);
  }, [
    didHydrate,
    nodes,
    edges,
    viewport,
    memoryMode,
    screen,
    project.projectId,
    project.title,
    project.author,
    project.assetManifest,
    project.settings,
    project.createdAt,
    exportProject,
  ]);

  function navigateTo(next: "home" | "editor") {
    if (next === screen || previousScreen) return;
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    setExitingHomeSnapshot(screen === "home" ? committedHomeSnapshotRef.current : undefined);
    const nextIntent: TransitionIntent = screen === "home" && next === "editor"
      ? "enter-cartridge"
      : screen === "editor" && next === "home"
        ? "exit-cartridge"
        : "standard";
    if (nextIntent === "enter-cartridge") {
      setTransitionIntent(nextIntent);
      setPreviousScreen(screen);
      setEntryOverlayState("loading");
      setScreen(next);
      return;
    }
    const transitionDuration = prefersReducedMotion()
      ? reducedMotionTransitionMs
      : nextIntent === "exit-cartridge"
        ? cartridgeExitTransitionMs
        : defaultViewTransitionMs;
    setTransitionIntent(nextIntent);
    setPreviousScreen(screen);
    setScreen(next);
    transitionTimerRef.current = window.setTimeout(() => {
      setPreviousScreen(undefined);
      setTransitionIntent("standard");
      setExitingHomeSnapshot(undefined);
      transitionTimerRef.current = null;
    }, transitionDuration);
  }

  async function refreshProjectCatalog(currentProject?: EditorProjectFile): Promise<RecentProjectRecord[]> {
    try {
      const catalog = await backendClient.loadProjectCatalog();
      const records = normalizeRecentProjects(catalog.map(summaryToRecentProjectRecord), currentProject ?? currentDraft);
      setRecentProjects(records);
      writeJsonToLocalStorage(recentProjectsKey, records);
      return records;
    } catch (error) {
      reportFrontendError("editor.project", error, { operation: "refresh-catalog" });
      const records = normalizeRecentProjects(recentProjects, currentProject ?? currentDraft);
      setRecentProjects(records);
      writeJsonToLocalStorage(recentProjectsKey, records);
      setHomeStatus("后端暂不可用，已保留本机项目列表。");
      return records;
    }
  }

  async function rememberProject(projectFile?: EditorProjectFile, backupTrigger = "return_home"): Promise<RecentProjectRecord[]> {
    const snapshot = projectFile ?? exportProject({
      projectId: project.projectId,
      title: project.title,
      author: project.author,
      assetManifest: project.assetManifest,
      editorSettings: { ...project.settings },
      createdAt: project.createdAt,
    });
    const next = normalizeRecentProjects(recentProjects, snapshot);
    setCurrentDraft(snapshot);
    setRecentProjects(next);
    writeJsonToLocalStorage(currentDraftKey, snapshot);
    writeJsonToLocalStorage(recentProjectsKey, next);
    const persistedSnapshot = await backendClient.saveProject(snapshot).catch((error) => {
      reportFrontendError("editor.project", error, {
        operation: "save-project",
        projectId: snapshot.project_id,
      });
      return snapshot;
    });
    setCurrentDraft(persistedSnapshot);
    await writeProjectBackupIfChanged(persistedSnapshot, backupTrigger).catch((error) => {
      reportFrontendError("editor.timeline", error, {
        operation: "automatic-backup",
        projectId: persistedSnapshot.project_id,
        trigger: backupTrigger,
      });
    });
    return await refreshProjectCatalog(persistedSnapshot);
  }

  async function deleteProject(record: RecentProjectRecord) {
    const nextRecentProjects = recentProjects.filter((item) => item.project_id !== record.project_id);
    const isCurrentDraft = currentDraft?.project_id === record.project_id;
    const isActiveProject = project.projectId === record.project_id;
    setRecentProjects(nextRecentProjects);
    writeJsonToLocalStorage(recentProjectsKey, nextRecentProjects);
    if (isCurrentDraft) setCurrentDraft(undefined);
    await backendClient.deleteProject(record.project_id);

    if (isActiveProject) {
      project.createProject({ title: "未命名视觉小说", author: "" });
      resetGraph();
      hydrateNovelImportFromProject(undefined);
    }
    await refreshProjectCatalog(isCurrentDraft ? undefined : currentDraft);

    setHomeStatus(`已删除项目：${record.title || "未命名视觉小说"}`);
  }

  async function createProject() {
    if (createProjectInFlightRef.current) return;
    createProjectInFlightRef.current = true;
    setIsCreatingProject(true);
    setHomeStatus(undefined);
    try {
      const archivedRecentProjects = currentDraft
        ? await rememberProject(currentDraft, "new_project")
        : recentProjects;
      project.createProject({ title: "未命名视觉小说", author: "" });
      resetGraph();
      hydrateNovelImportFromProject(undefined);
      const nextProject = useProjectStore.getState();
      const nextEditor = useEditorStore.getState();
      const nextDraft = nextEditor.exportProject({
        projectId: nextProject.projectId,
        title: nextProject.title,
        author: nextProject.author,
        assetManifest: nextProject.assetManifest,
        editorSettings: { ...nextProject.settings },
        createdAt: nextProject.createdAt,
      });
      await backendClient.saveProjectState({
        recent_projects: archivedRecentProjects.map((record) => record.project).filter((projectFile): projectFile is EditorProjectFile => Boolean(projectFile)),
        project_graph: {
          nodes: nextEditor.nodes,
          edges: nextEditor.edges,
          viewport: nextDraft.viewport,
          memoryMode: nextDraft.memory_mode,
        },
        project_metadata: {
          projectId: nextProject.projectId,
          title: nextProject.title,
          author: nextProject.author,
          createdAt: nextProject.createdAt,
          updatedAt: nextProject.updatedAt,
          assetManifest: nextProject.assetManifest,
          settings: { ...nextProject.settings },
        },
      });
    setCurrentDraft(nextDraft);
    writeJsonToLocalStorage(currentDraftKey, nextDraft);
      const savedDraft = await backendClient.saveProject(nextDraft);
      setCurrentDraft(savedDraft);
      writeJsonToLocalStorage(currentDraftKey, savedDraft);
      await refreshProjectCatalog(savedDraft);
      navigateTo("editor");
    } catch (error) {
      reportFrontendError("editor.project", error, { operation: "create-project" });
      setHomeStatus(error instanceof Error ? error.message : String(error));
    } finally {
      createProjectInFlightRef.current = false;
      setIsCreatingProject(false);
    }
  }

  function openDraft() {
    if (!currentDraft) return;
    importProject(currentDraft);
    project.loadProjectMetadata(currentDraft);
    hydrateNovelImportFromProject(currentDraft);
    setHomeStatus(undefined);
    navigateTo("editor");
  }

  async function openProject(record: RecentProjectRecord) {
    setHomeStatus(undefined);
    try {
      const projectFile = record.project ?? await backendClient.loadProject(record.project_id);
      importProject(projectFile);
      project.loadProjectMetadata(projectFile);
      hydrateNovelImportFromProject(projectFile);
      setCurrentDraft(projectFile);
      setRecentProjects(normalizeRecentProjects(recentProjects, projectFile));
      navigateTo("editor");
    } catch (error) {
      reportFrontendError("editor.project", error, { operation: "open-project", projectId: record.project_id });
      setHomeStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function importProjectFile(file: File) {
    const result = await parseProjectFile(file);
    if (!result.project) {
      reportFrontendError("editor.project", result.error ?? "导入失败。", {
        operation: "import-project-file",
        fileName: file.name,
      });
      setHomeStatus(result.error ?? "导入失败。");
      return;
    }
    importProject(result.project);
    project.loadProjectMetadata(result.project);
    hydrateNovelImportFromProject(result.project);
    const persisted = await rememberProject(result.project);
    const persistedProject = persisted.find((item) => item.project_id === result.project?.project_id)?.project;
    if (persistedProject) {
      project.loadProjectMetadata(persistedProject);
      hydrateNovelImportFromProject(persistedProject);
    }
    setHomeStatus(undefined);
    navigateTo("editor");
  }

  function returnHome() {
    void rememberProject().catch((error) => {
      reportFrontendError("editor.project", error, {
        operation: "save-before-return-home",
        projectId: project.projectId,
      });
    });
    navigateTo("home");
  }

  function completeHomeHydrationCycle() {
    setHomeHydrationOverlayState((current) => current === "ready" ? "closing" : current);
  }

  function completeProjectEntryCycle() {
    setEntryOverlayState((current) => current === "ready" ? "closing" : current);
  }

  function renderScreen(target: "home" | "editor", useExitingSnapshot = false) {
    const homeSnapshot = useExitingSnapshot ? exitingHomeSnapshot : undefined;
    return target === "home" ? (
      <ProjectHome
        recentProjects={homeSnapshot ? homeSnapshot.recentProjects : recentProjects}
        currentDraft={homeSnapshot ? homeSnapshot.currentDraft : currentDraft}
        onCreateProject={createProject}
        onOpenDraft={openDraft}
        onOpenProject={(record) => void openProject(record)}
        onDeleteProject={(record) => void deleteProject(record)}
        onImportProject={(file) => void importProjectFile(file)}
        statusMessage={homeSnapshot ? homeSnapshot.homeStatus : homeStatus}
        isHydrating={!didHydrate || isCreatingProject}
      />
    ) : (
      <Suspense fallback={<EditorRouteFallback />}>
        <VisualNovelEditor onReturnHome={returnHome} />
        {!useExitingSnapshot && !isSwitchingView && !isEntryOverlayVisible && <NovelProcessTaskWorkbench />}
      </Suspense>
    );
  }

  return (
    <AppErrorBoundary>
      <div className="app-root">
        <div
          className={`app-transition-stage${isSwitchingView ? " is-switching" : ""}${isHomeHydrationOverlayVisible ? " is-home-hydrating" : ""}${isEnterCartridgeTransition ? " is-enter-cartridge is-project-entry-loading" : ""}${isExitCartridgeTransition ? " is-exit-cartridge" : ""}`}
        >
          {previousScreen && (
            <div className={`app-view app-view-${previousScreen} is-exiting`}>
              {renderScreen(previousScreen, true)}
            </div>
          )}
          <div className={`app-view app-view-${screen}${isSwitchingView ? " is-entering" : " is-active"}`}>
            {renderScreen(screen)}
          </div>
          {isHomeHydrationOverlayVisible && (
            <ProjectEntryLoadingOverlay state={homeHydrationOverlayState} onReadyCycleComplete={completeHomeHydrationCycle} />
          )}
          {isEntryOverlayVisible && (
            <ProjectEntryLoadingOverlay state={entryOverlayState} onReadyCycleComplete={completeProjectEntryCycle} />
          )}
        </div>
        <HoverHelpLayer />
      </div>
    </AppErrorBoundary>
  );
}
