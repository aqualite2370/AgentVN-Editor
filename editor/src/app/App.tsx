import "./App.css";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BackendProjectImportUnavailableError, backendClient } from "../api/backendClient";
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
import { stripEmbeddedAssetPayloadsFromProject } from "../utils/embeddedAssetPayloads";
import { parseProjectFile, parseProjectJson } from "../utils/projectImport";
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
const reducedMotionTransitionMs = 520;
const projectEntryMinLoadingMs = 1050;
const projectEntryPrerenderTimeoutMs = 1800;
const projectEntryClosingMs = 1120;
const DEFAULT_BACKEND_BASE_URL = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8278";
const legacyProjectStorageMaxChars = 16 * 1024 * 1024;
const browserProjectStorageMaxChars = 12 * 1024 * 1024;
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

function writeJsonToLocalStorage(key: string, value: unknown, options: { maxChars?: number } = {}): void {
  try {
    const serialized = JSON.stringify(value);
    if (options.maxChars && serialized.length > options.maxChars) {
      reportFrontendError("editor.local-storage", new Error("Local storage payload exceeds safety limit"), {
        operation: "write",
        key,
        chars: serialized.length,
        maxChars: options.maxChars,
      });
      return;
    }
    window.localStorage.setItem(key, serialized);
  } catch (error) {
    reportFrontendError("editor.local-storage", error, { operation: "write", key });
    // Local storage is only a fallback; quota/security errors must not block the editor.
  }
}

function projectForBrowserStorage(project: EditorProjectFile): EditorProjectFile {
  return stripEmbeddedAssetPayloadsFromProject(project);
}

function recentProjectRecordForBrowserStorage(record: RecentProjectRecord): RecentProjectRecord {
  return {
    ...record,
    project: record.project ? projectForBrowserStorage(record.project) : undefined,
  };
}

function recentProjectsForBrowserStorage(records: RecentProjectRecord[]): RecentProjectRecord[] {
  return records.map(recentProjectRecordForBrowserStorage);
}

function writeCurrentDraftToLocalStorage(projectFile?: EditorProjectFile): void {
  if (!projectFile) return;
  writeJsonToLocalStorage(currentDraftKey, projectForBrowserStorage(projectFile), { maxChars: browserProjectStorageMaxChars });
}

function removeCurrentDraftFromLocalStorage(): void {
  try {
    window.localStorage.removeItem(currentDraftKey);
  } catch (error) {
    reportFrontendError("editor.local-storage", error, { operation: "remove", key: currentDraftKey });
  }
}

function writeRecentProjectsToLocalStorage(records: RecentProjectRecord[]): void {
  writeJsonToLocalStorage(recentProjectsKey, recentProjectsForBrowserStorage(records), { maxChars: browserProjectStorageMaxChars });
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
    </div>
  );
}

async function waitForEditorPrerender(timeoutMs: number): Promise<void> {
  const requiredSelectors = [
    ".editor-shell",
    ".editor-toolbar",
    '.flow-surface[data-editor-prerender-ready="true"]',
    ".node-palette",
    ".inspector-panel",
  ];
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (requiredSelectors.every((selector) => document.querySelector(selector))) {
      await nextAnimationFrame();
      await nextAnimationFrame();
      break;
    }
    await nextAnimationFrame();
  }

  // Keep the loading surface visible until the initial editor commit yields
  // real browser idle time. This avoids starting the visible container morph
  // on top of ReactFlow/observer work; it does not add time to the morph.
  if (typeof window.requestIdleCallback !== "function") {
    await nextAnimationFrame();
    await nextAnimationFrame();
    return;
  }

  const idleStartedAt = performance.now();
  let consecutiveIdlePeriods = 0;
  while (consecutiveIdlePeriods < 2 && performance.now() - idleStartedAt < timeoutMs) {
    const deadline = await new Promise<IdleDeadline>((resolve) => {
      window.requestIdleCallback(resolve, { timeout: Math.min(1000, timeoutMs) });
    });
    consecutiveIdlePeriods = !deadline.didTimeout && deadline.timeRemaining() >= 8
      ? consecutiveIdlePeriods + 1
      : 0;
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
    size_bytes: summary.size_bytes,
    size_source: summary.size_source ?? "unknown",
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
  const existingRecord = records.find((item) => item.project_id === currentDraft.project_id);
  const currentRecord = {
    ...projectToRecentProjectRecord(currentDraft),
    size_bytes: existingRecord?.size_bytes,
    size_source: existingRecord?.size_source,
  };
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

function migrateLegacyState(remote: SharedEditorState, migrateProjects: boolean): Partial<SharedEditorState> {
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

  if (migrateProjects && remote.project_graph.nodes.length === 0) {
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

  const legacyRecentProjects = migrateProjects && remote.recent_projects.length === 0
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
  const [isImportingProject, setIsImportingProject] = useState(false);
  const [backendEndpointReady, setBackendEndpointReady] = useState(false);
  const [supportsNativeProjectPicker, setSupportsNativeProjectPicker] = useState(false);
  const [didHydrate, setDidHydrate] = useState(false);
  const createProjectInFlightRef = useRef(false);
  const importProjectInFlightRef = useRef(false);
  const deleteProjectInFlightRef = useRef(new Set<string>());
  const entryTransitionStartedRef = useRef(false);
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
    if (!("__TAURI_INTERNALS__" in window)) {
      backendClient.setBaseUrl(DEFAULT_BACKEND_BASE_URL);
      setBackendEndpointReady(true);
      return;
    }
    let active = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<string[]>("get_native_capabilities"))
      .then((capabilities) => {
        if (!active) return;
        setSupportsNativeProjectPicker(capabilities.includes("project-import-ticket-v1"));
        const backendCapability = capabilities.find((item) => item.startsWith("backend-base-url="));
        backendClient.setBaseUrl(backendCapability?.slice("backend-base-url=".length) || DEFAULT_BACKEND_BASE_URL);
        setBackendEndpointReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSupportsNativeProjectPicker(false);
        backendClient.setBaseUrl(DEFAULT_BACKEND_BASE_URL);
        setBackendEndpointReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeTone;
  }, [themeTone]);

  useEffect(() => {
    if (!backendEndpointReady) return;
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
      // Keys are restored only through an explicit no-store request, never a
      // normal project-state response that Chromium could retain on disk.
      const providerSecrets = await backendClient.loadProviderSecrets();
      if (!mounted) return;
      const existingCatalog = await backendClient.loadProjectCatalog();
      if (!mounted) return;
      // The lightweight state response deliberately omits project data.
      // Its empty placeholders are not evidence that the database is empty:
      // replaying stale browser snapshots here overwrites saved layouts.
      const migrationPayload = migrateLegacyState({ ...loaded, provider_secrets: providerSecrets }, existingCatalog.length === 0);
      const hasMigration = Object.keys(migrationPayload).length > 0;
      const sharedState = hasMigration ? await backendClient.saveProjectState(migrationPayload) : loaded;
      if (!mounted) return;

      hydrateProviderState(sharedState);
      hydrateApiKeys(migrationPayload.provider_secrets ?? providerSecrets);

      const draft = buildDraftFromSharedState(sharedState);
      if (draft) {
        hydrateEditorFromProjectShared(draft);
        setCurrentDraft(draft);
      }
      const catalog = hasMigration ? await backendClient.loadProjectCatalog() : existingCatalog;
      if (!mounted) return;
      const catalogRecords = catalog.map(summaryToRecentProjectRecord);
      const sharedRecentRecords = Array.isArray(sharedState.recent_projects)
        ? toRecentProjectRecords(sharedState.recent_projects)
        : [];
      const nextRecentProjects = normalizeRecentProjects(mergeRecentProjectRecords(catalogRecords, sharedRecentRecords), draft);
      setRecentProjects(nextRecentProjects);
      writeRecentProjectsToLocalStorage(nextRecentProjects);
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
  }, [backendEndpointReady]);

  const isSwitchingView = Boolean(previousScreen);
  const isEntryOverlayVisible = entryOverlayState !== "idle";
  const isHomeHydrationOverlayVisible = homeHydrationOverlayState !== "idle";
  const isEnterCartridgeTransition = isSwitchingView && transitionIntent === "enter-cartridge";
  const isExitCartridgeTransition = isSwitchingView && transitionIntent === "exit-cartridge";
  const isEditorEntryTransitionPending = isEnterCartridgeTransition && entryOverlayState !== "closing";

  useLayoutEffect(() => {
    if (screen !== "home" || previousScreen) return;
    committedHomeSnapshotRef.current = { recentProjects, currentDraft, homeStatus };
  }, [screen, previousScreen, recentProjects, currentDraft, homeStatus]);

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
    if (!previousScreen || transitionIntent === "enter-cartridge" || entryOverlayState !== "idle") return;
    let cancelled = false;
    let startFrame = 0;
    const finishViewTransition = () => {
      if (cancelled) return;
      setPreviousScreen(undefined);
      setTransitionIntent("standard");
      setExitingHomeSnapshot(undefined);
    };
    startFrame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const transitionNames = new Set([
        "app-view-enter",
        "app-view-exit",
        "project-library-return",
        "cartridge-container-unload",
      ]);
      const transitionAnimations = [...document.querySelectorAll(".app-view.is-entering, .app-view.is-exiting")]
        .flatMap(view => view.getAnimations())
        .filter(animation => animation instanceof CSSAnimation && transitionNames.has(animation.animationName));
      if (transitionAnimations.length === 0) {
        finishViewTransition();
        return;
      }
      void Promise.allSettled(transitionAnimations.map(animation => animation.finished)).then(finishViewTransition);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(startFrame);
    };
  }, [entryOverlayState, previousScreen, transitionIntent]);

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
    setCurrentDraft(projectForBrowserStorage(snapshot));
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
    if (next === "editor") entryTransitionStartedRef.current = false;
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
    setTransitionIntent(nextIntent);
    setPreviousScreen(screen);
    setScreen(next);
  }

  async function refreshProjectCatalog({
    currentProject,
    fallbackRecords = recentProjects,
    useCurrentDraftFallback = true,
  }: {
    currentProject?: EditorProjectFile;
    fallbackRecords?: RecentProjectRecord[];
    useCurrentDraftFallback?: boolean;
  } = {}): Promise<RecentProjectRecord[]> {
    const projectToKeep = currentProject ?? (useCurrentDraftFallback ? currentDraft : undefined);
    try {
      const catalog = await backendClient.loadProjectCatalog();
      const records = normalizeRecentProjects(catalog.map(summaryToRecentProjectRecord), projectToKeep);
      setRecentProjects(records);
      writeRecentProjectsToLocalStorage(records);
      return records;
    } catch (error) {
      reportFrontendError("editor.project", error, { operation: "refresh-catalog" });
      const records = normalizeRecentProjects(fallbackRecords, projectToKeep);
      setRecentProjects(records);
      writeRecentProjectsToLocalStorage(records);
      setHomeStatus("后端暂不可用，已保留本机项目列表。");
      return records;
    }
  }

  async function rememberProject(
    projectFile?: EditorProjectFile,
    backupTrigger = "return_home",
    sourceSizeBytes?: number,
  ): Promise<RecentProjectRecord[]> {
    const snapshot = projectFile ?? exportProject({
      projectId: project.projectId,
      title: project.title,
      author: project.author,
      assetManifest: project.assetManifest,
      editorSettings: { ...project.settings },
      createdAt: project.createdAt,
    });
    const browserSafeSnapshot = projectForBrowserStorage(snapshot);
    const next = normalizeRecentProjects(recentProjects, browserSafeSnapshot);
    setCurrentDraft(browserSafeSnapshot);
    setRecentProjects(next);
    writeCurrentDraftToLocalStorage(snapshot);
    writeRecentProjectsToLocalStorage(next);
    const persistedSnapshot = await backendClient.saveProject(snapshot, { sourceSizeBytes }).catch((error) => {
      reportFrontendError("editor.project", error, {
        operation: "save-project",
        projectId: snapshot.project_id,
      });
      return browserSafeSnapshot;
    });
    return await rememberPersistedProject(persistedSnapshot, backupTrigger);
  }

  async function rememberPersistedProject(
    persistedSnapshot: EditorProjectFile,
    backupTrigger = "return_home"
  ): Promise<RecentProjectRecord[]> {
    const browserSafeSnapshot = projectForBrowserStorage(persistedSnapshot);
    const next = normalizeRecentProjects(recentProjects, browserSafeSnapshot);
    setCurrentDraft(browserSafeSnapshot);
    setRecentProjects(next);
    writeCurrentDraftToLocalStorage(persistedSnapshot);
    writeRecentProjectsToLocalStorage(next);
    await writeProjectBackupIfChanged(persistedSnapshot, backupTrigger).catch((error) => {
      reportFrontendError("editor.timeline", error, {
        operation: "automatic-backup",
        projectId: persistedSnapshot.project_id,
        trigger: backupTrigger,
      });
    });
    return await refreshProjectCatalog({ currentProject: persistedSnapshot });
  }

  async function deleteProject(record: RecentProjectRecord) {
    if (deleteProjectInFlightRef.current.has(record.project_id)) return;
    deleteProjectInFlightRef.current.add(record.project_id);

    const previousRecentProjects = recentProjects;
    const previousCurrentDraft = currentDraft;
    const nextRecentProjects = previousRecentProjects.filter((item) => item.project_id !== record.project_id);
    const isCurrentDraft = previousCurrentDraft?.project_id === record.project_id;
    const isActiveProject = project.projectId === record.project_id;

    setHomeStatus(`正在删除项目：${record.title || "未命名视觉小说"}…`);
    setRecentProjects(nextRecentProjects);
    writeRecentProjectsToLocalStorage(nextRecentProjects);
    if (isCurrentDraft) setCurrentDraft(undefined);

    try {
      await backendClient.deleteProject(record.project_id);

      if (isCurrentDraft) removeCurrentDraftFromLocalStorage();
      if (isActiveProject) {
        project.createProject({ title: "未命名视觉小说", author: "" });
        resetGraph();
        hydrateNovelImportFromProject(undefined);
      }
      await refreshProjectCatalog({
        currentProject: isCurrentDraft ? undefined : previousCurrentDraft,
        fallbackRecords: nextRecentProjects,
        useCurrentDraftFallback: false,
      });
      setHomeStatus(`已删除项目：${record.title || "未命名视觉小说"}`);
    } catch (error) {
      reportFrontendError("editor.project", error, {
        operation: "delete-project",
        projectId: record.project_id,
      });
      setRecentProjects(previousRecentProjects);
      writeRecentProjectsToLocalStorage(previousRecentProjects);
      if (isCurrentDraft && previousCurrentDraft) {
        setCurrentDraft(previousCurrentDraft);
        writeCurrentDraftToLocalStorage(previousCurrentDraft);
      }
      const detail = error instanceof Error ? error.message : String(error);
      setHomeStatus(`删除失败，项目已保留：${detail}`);
    } finally {
      deleteProjectInFlightRef.current.delete(record.project_id);
    }
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
    setCurrentDraft(projectForBrowserStorage(nextDraft));
    writeCurrentDraftToLocalStorage(nextDraft);
      const savedDraft = await backendClient.saveProject(nextDraft);
      setCurrentDraft(savedDraft);
      writeCurrentDraftToLocalStorage(savedDraft);
      await refreshProjectCatalog({ currentProject: savedDraft });
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
    // The browser draft is a home-screen cache and can predate a successful
    // layout save. Resume through the persisted-project path, just like a
    // catalog entry, instead of importing that stale snapshot into autosave.
    void openProject({ ...projectToRecentProjectRecord(currentDraft), project: undefined });
  }

  async function openProject(record: RecentProjectRecord) {
    setHomeStatus(undefined);
    try {
      const projectFile = record.project ?? await backendClient.loadProject(record.project_id);
      importProject(projectFile);
      project.loadProjectMetadata(projectFile);
      hydrateNovelImportFromProject(projectFile);
      setCurrentDraft(projectFile);
      setRecentProjects(normalizeRecentProjects(recentProjects, projectForBrowserStorage(projectFile)));
      navigateTo("editor");
    } catch (error) {
      reportFrontendError("editor.project", error, { operation: "open-project", projectId: record.project_id });
      setHomeStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function finishProjectImport(
    importedProject: EditorProjectFile,
    alreadyPersisted: boolean,
    sourceSizeBytes?: number,
  ) {
    // Import is a commit boundary, unlike ordinary offline draft caching.
    // Never replace the current graph, task session or home cache until the
    // backend has accepted the new project. rememberProject deliberately
    // tolerates save errors for other callers, so it cannot gate this path.
    const savedProject = alreadyPersisted
      ? importedProject
      : await backendClient.saveProject(importedProject, { sourceSizeBytes });
    await rememberPersistedProject(savedProject, "import_project");
    importProject(importedProject);
    /*
     * Browser persistence strips embedded asset payloads by design.  Keep the
     * freshly imported in-memory metadata (including data URLs) for the live
     * preview instead of replacing it with the stripped recent-project copy.
     */
    project.loadProjectMetadata(importedProject);
    hydrateNovelImportFromProject(importedProject);
    setHomeStatus(undefined);
    navigateTo("editor");
  }

  async function selectProjectImportFile() {
    if (importProjectInFlightRef.current) return;
    importProjectInFlightRef.current = true;
    setIsImportingProject(true);
    setHomeStatus("请选择要导入的 AgentVN 工程文件…");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ticket = await invoke<string | null>("select_project_import_file");
      if (!ticket) {
        setHomeStatus(undefined);
        return;
      }
      setHomeStatus("正在通过桌面原生通道导入工程并托管素材…");
      let backendProject: EditorProjectFile;
      try {
        backendProject = await backendClient.importProjectTicket(ticket);
      } catch (error) {
        if (error instanceof BackendProjectImportUnavailableError) {
          throw new Error("后端版本不匹配，无法导入工程。请完全退出 AgentVN，重新安装最新版后再试。");
        }
        throw error;
      }
      const validation = parseProjectJson(backendProject);
      if (!validation.project) {
        throw new Error(validation.error ?? "后端返回的工程结构无效。");
      }
      await finishProjectImport(validation.project, true);
    } catch (error) {
      reportFrontendError("editor.project", error, {
        operation: "import-project-ticket",
      });
      setHomeStatus(error instanceof Error ? error.message : String(error));
    } finally {
      importProjectInFlightRef.current = false;
      setIsImportingProject(false);
    }
  }

  async function importProjectFile(file: File) {
    if (importProjectInFlightRef.current) return;
    importProjectInFlightRef.current = true;
    setIsImportingProject(true);
    setHomeStatus(`正在通过后端安全导入 ${file.name}（${Math.max(1, Math.round(file.size / 1024 / 1024))}MB）…`);
    try {
      let importedProject: EditorProjectFile;
      let alreadyPersisted = true;
      const browserRuntime = !("__TAURI_INTERNALS__" in window);
      if (browserRuntime) {
        /*
         * The backend intentionally externalizes ZIP assets before returning
         * the project.  A browser cannot read those server-side file paths,
         * so use the bundle parser here to keep data URLs available to the
         * live preview.  Persistence still happens through rememberProject.
         */
        const fallback = await parseProjectFile(file);
        if (fallback.project) {
          importedProject = fallback.project;
          alreadyPersisted = false;
          setHomeStatus("工程已读取，正在准备素材预览…");
        } else {
          const backendProject = await backendClient.importProjectFile(file);
          const validation = parseProjectJson(backendProject);
          if (!validation.project) {
            throw new Error(`${fallback.error ?? "浏览器兼容导入失败。"} ${validation.error ?? "后端返回的工程结构无效。"}`);
          }
          importedProject = validation.project;
        }
      } else {
        try {
          const backendProject = await backendClient.importProjectFile(file);
          const validation = parseProjectJson(backendProject);
          if (!validation.project) {
            throw new Error(validation.error ?? "后端返回的工程结构无效。");
          }
          importedProject = validation.project;
        } catch (error) {
          if (!(error instanceof BackendProjectImportUnavailableError)) throw error;
          alreadyPersisted = false;
          setHomeStatus("后端原生导入不可用，正在尝试浏览器兼容导入…");
          const fallback = await parseProjectFile(file);
          if (!fallback.project) {
            throw new Error(`${error.message} ${fallback.error ?? "浏览器兼容导入失败。"}`);
          }
          importedProject = fallback.project;
        }
      }

      await finishProjectImport(importedProject, alreadyPersisted, file.size);
    } catch (error) {
      reportFrontendError("editor.project", error, {
        operation: "import-project-file",
        fileName: file.name,
        fileSize: file.size,
      });
      setHomeStatus(error instanceof Error ? error.message : String(error));
    } finally {
      importProjectInFlightRef.current = false;
      setIsImportingProject(false);
    }
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
    if (entryOverlayState !== "ready" || entryTransitionStartedRef.current) return;
    const editorView = document.querySelector<HTMLElement>(".app-view-editor.is-entry-pending");
    const overlay = document.querySelector<HTMLElement>('.project-entry-loading-overlay[data-overlay-kind="project-entry"].is-ready');
    if (!editorView || !overlay) return;

    // Start the established CSS animations after the state-render that prepared
    // the editor has settled. A React state update here would make that same
    // commit compete with the first visible container-morph frames.
    entryTransitionStartedRef.current = true;
    editorView.classList.remove("is-entry-pending");
    editorView.classList.add("is-entering");
    overlay.classList.remove("is-ready");
    overlay.classList.add("is-closing");

    let cancelled = false;
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      const transitionAnimations = [
        ...editorView.getAnimations(),
        ...overlay.getAnimations(),
      ].filter(animation => {
        if (!(animation instanceof CSSAnimation)) return false;
        return animation.animationName === "container-boot"
          || animation.animationName === "project-entry-overlay-out";
      });
      const finishEntryTransition = () => {
        if (cancelled) return;
        setPreviousScreen(undefined);
        setTransitionIntent("standard");
        setExitingHomeSnapshot(undefined);
        setEntryOverlayState("idle");
      };
      if (transitionAnimations.length === 0) {
        finishEntryTransition();
        return;
      }
      void Promise.allSettled(transitionAnimations.map(animation => animation.finished))
        .then(finishEntryTransition);
    });
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
        onSelectProjectFile={supportsNativeProjectPicker ? () => void selectProjectImportFile() : undefined}
        statusMessage={homeSnapshot ? homeSnapshot.homeStatus : homeStatus}
        isHydrating={!didHydrate || isCreatingProject || isImportingProject}
      />
    ) : (
      <Suspense fallback={<EditorRouteFallback />}>
        <VisualNovelEditor
          onReturnHome={returnHome}
          deferRuntimePreview={isEnterCartridgeTransition && !useExitingSnapshot}
        />
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
          <div className={`app-view app-view-${screen}${isSwitchingView
            ? isEditorEntryTransitionPending ? " is-entry-pending" : " is-entering"
            : " is-active"}`}>
            {renderScreen(screen)}
          </div>
          {isHomeHydrationOverlayVisible && (
            <ProjectEntryLoadingOverlay kind="home-hydration" state={homeHydrationOverlayState} onReadyCycleComplete={completeHomeHydrationCycle} />
          )}
          {isEntryOverlayVisible && (
            <ProjectEntryLoadingOverlay kind="project-entry" state={entryOverlayState} onReadyCycleComplete={completeProjectEntryCycle} />
          )}
        </div>
        <HoverHelpLayer />
      </div>
    </AppErrorBoundary>
  );
}
