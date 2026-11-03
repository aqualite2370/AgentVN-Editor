import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import type { GeneratedAssetRecord, GenerationHistoryEntry } from "../../providers/types";
import { useProjectStore } from "../../store/projectStore";
import type { AssetRef } from "../../types/assets";
import { putImportedAssetsInFolder } from "../../utils/assetLibraryInteractions";
import { generatedAssetToAssetRef } from "../../utils/projectAssets";
import type { AdvancedToolsRequest, AdvancedToolsTab } from "./advancedToolsBridge";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { GlassSelectionGroup } from "../common/GlassSelectionGroup";
import { readViewportMetrics, subscribeToViewportChanges } from "../../utils/viewportMetrics";
import type { RuntimeLayoutDesignerSession } from "./RuntimeLayoutDesigner";
import { awaitModuleLoad, recoverableComponentLoader } from "../../utils/recoverableModuleLoader";
import { editorWorkspaceDuration, readEditorMotionTokens, type EditorMotionTokens } from "../../utils/editorTransitionPresentation";

type AdvancedTabLoader = () => Promise<{ default: ComponentType<any> }>;

const advancedTabLoaders: Record<AdvancedToolsTab, AdvancedTabLoader> = {
  settings: recoverableComponentLoader(() => import("./ProjectSettingsPanel"), (module) => module.ProjectSettingsPanel),
  layout: recoverableComponentLoader(() => import("./RuntimeLayoutDesigner"), (module) => module.RuntimeLayoutDesigner),
  theme: recoverableComponentLoader(() => import("./RuntimeThemeDesigner"), (module) => module.RuntimeThemeDesigner),
  novel: recoverableComponentLoader(() => import("../novel-import/NovelImportWizard"), (module) => module.NovelImportWizard),
  assets: recoverableComponentLoader(() => import("./AssetGenerationPanel"), (module) => module.AssetGenerationPanel),
  library: recoverableComponentLoader(() => import("./AssetLibraryPanel"), (module) => module.AssetLibraryPanel),
  animation: recoverableComponentLoader(() => import("./AnimationEditorPanel"), (module) => module.AnimationEditorPanel),
  preview: recoverableComponentLoader(() => import("./PreviewWindowControls"), (module) => module.PreviewWindowControls),
  providers: recoverableComponentLoader(() => import("./ProviderSettingsPanel"), (module) => module.ProviderSettingsPanel),
  history: recoverableComponentLoader(() => import("./GenerationHistoryPanel"), (module) => module.GenerationHistoryPanel),
};

const advancedTabPreloads = new Map<AdvancedToolsTab, ReturnType<AdvancedTabLoader>>();
function preloadAdvancedTab(tab: AdvancedToolsTab): ReturnType<AdvancedTabLoader> {
  const cached = advancedTabPreloads.get(tab);
  if (cached) return cached;
  const promise = advancedTabLoaders[tab]().catch((error) => {
    advancedTabPreloads.delete(tab);
    reportFrontendError("editor.advanced-tools", error, {
      operation: "load-tab",
      tab,
    });
    throw error;
  });
  advancedTabPreloads.set(tab, promise);
  return promise;
}

export function preloadWorkspaceOptions() {
  return Promise.all([preloadAdvancedTab("settings"), preloadAdvancedTab("providers")]);
}

const NovelImportWizard = memo(lazy(() => preloadAdvancedTab("novel")));
const AnimationEditorPanel = memo(lazy(() => preloadAdvancedTab("animation")));
const AssetGenerationPanel = memo(lazy(() => preloadAdvancedTab("assets")));
const AssetLibraryPanel = memo(lazy(() => preloadAdvancedTab("library")));
const GenerationHistoryPanel = memo(lazy(() => preloadAdvancedTab("history")));
const PreviewWindowControls = memo(lazy(() => preloadAdvancedTab("preview")));
const ProjectSettingsPanel = memo(lazy(() => preloadAdvancedTab("settings")));
const ProviderSettingsPanel = memo(lazy(() => preloadAdvancedTab("providers")));
const RuntimeLayoutDesigner = memo(lazy(() => preloadAdvancedTab("layout")));
const RuntimeThemeDesigner = memo(lazy(() => preloadAdvancedTab("theme")));

const tabLabels: Record<AdvancedToolsTab, string> = {
  settings: "项目设置",
  layout: "游戏客户端",
  theme: "客户端主题",
  novel: "小说导入",
  assets: "素材生成",
  library: "素材库",
  animation: "动画编辑",
  preview: "预览窗口",
  providers: "模型/连接",
  history: "生成历史",
};

const visibleAdvancedTabs: AdvancedToolsTab[] = [
  "settings", "layout", "theme", "assets", "library", "animation", "providers", "history",
];

type TabTransitionPhase = "idle" | "preparing" | "crossfading";
type AdvancedLayoutModeOptions = { animate?: boolean; motionTokens?: EditorMotionTokens };
type AdvancedTabSwitchOptions = { animateContainer?: boolean; instant?: boolean };

const tabContentTransitionMs = 400;
const reducedTabTransitionMs = 400;

function isWideModeTab(tab: AdvancedToolsTab): boolean {
  return tab === "layout" || tab === "theme" || tab === "novel" || tab === "animation" || tab === "assets";
}

function shouldKeepWarmTab(candidate: AdvancedToolsTab, activeTab: AdvancedToolsTab): boolean {
  const warmRegularTabs: AdvancedToolsTab[] = ["settings", "providers", "library", "assets", "preview"];
  const warmWideTabs: AdvancedToolsTab[] = ["layout", "theme", "animation"];
  if (warmWideTabs.includes(candidate)) return candidate !== activeTab;
  return (
    warmRegularTabs.includes(candidate) &&
    warmRegularTabs.includes(activeTab)
  ) || (
    (candidate === "layout" || candidate === "theme") &&
    (activeTab === "layout" || activeTab === "theme")
  );
}

function mountedTabsForSettledTab(nextTab: AdvancedToolsTab): Set<AdvancedToolsTab> {
  const next = new Set<AdvancedToolsTab>([nextTab]);
  if (nextTab !== "layout") next.add("layout");
  return next;
}

function AdvancedTabLoading({ tab }: { tab: AdvancedToolsTab }) {
  return (
    <div className="advanced-tab-loading" role="status" aria-live="polite">
      <strong>正在载入{tabLabels[tab]}</strong>
    </div>
  );
}

function useAdvancedTabTransition(
  onLayoutModeChange?: (isLayoutMode: boolean, options?: AdvancedLayoutModeOptions) => number,
) {
  const [activeTab, setActiveTab] = useState<AdvancedToolsTab>("settings");
  const [selectedTab, setSelectedTab] = useState<AdvancedToolsTab>("settings");
  const [enteringTab, setEnteringTab] = useState<AdvancedToolsTab>();
  const [presentedTabs, setPresentedTabs] = useState<Set<AdvancedToolsTab>>(() => new Set(["settings"]));
  const [transitionPhase, setTransitionPhase] = useState<TabTransitionPhase>("idle");
  const [viewportHeight, setViewportHeight] = useState<number>();
  const [mountedTabs, setMountedTabs] = useState<Set<AdvancedToolsTab>>(
    () => new Set(["settings", "layout"]),
  );
  const [layerStartOpacities, setLayerStartOpacities] = useState<Partial<Record<AdvancedToolsTab, number>>>({});
  const [loadError, setLoadError] = useState<{ tab: AdvancedToolsTab; message: string }>();
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRefs = useRef(new Map<AdvancedToolsTab, HTMLDivElement>());
  const contentRefCallbacks = useRef(new Map<AdvancedToolsTab, (node: HTMLDivElement | null) => void>());
  const settledTransitionTokenRef = useRef(0);
  const viewportMeasureFrameRef = useRef<number | null>(null);
  const transitionTokenRef = useRef(0);
  const transitionInFlightRef = useRef(false);
  const layoutModeRef = useRef(isWideModeTab("settings"));
  const activeTabRef = useRef(activeTab);
  const requestedTabRef = useRef<AdvancedToolsTab>("settings");
  const loadControllerRef = useRef<AbortController | undefined>(undefined);
  const layerAnimationsRef = useRef<Animation[]>([]);
  const transitionDurationRef = useRef(tabContentTransitionMs);
  const transitionEasingRef = useRef("");
  const isLayoutMode = isWideModeTab(activeTab);

  function settleTabTransition(
    token: number,
    nextTab: AdvancedToolsTab,
  ) {
    if (token !== transitionTokenRef.current || settledTransitionTokenRef.current === token) return;
    settledTransitionTokenRef.current = token;
    transitionInFlightRef.current = false;
    const activeNode = contentRefs.current.get(nextTab);
    if (activeNode) activeNode.style.opacity = "1";
    setEnteringTab(undefined);
    setPresentedTabs(new Set([nextTab]));
    setTransitionPhase("idle");
    setMountedTabs(mountedTabsForSettledTab(nextTab));
    if (!isWideModeTab(nextTab)) {
      window.requestAnimationFrame(() => {
        if (token === transitionTokenRef.current) measureActiveHeight();
      });
    }
  }

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  function clearTransitionTimers() {
    if (viewportMeasureFrameRef.current !== null) window.cancelAnimationFrame(viewportMeasureFrameRef.current);
    viewportMeasureFrameRef.current = null;
    for (const animation of layerAnimationsRef.current) animation.cancel();
    layerAnimationsRef.current = [];
  }

  function syncLayoutMode(nextLayoutMode: boolean, animate: boolean, motionTokens?: EditorMotionTokens): number {
    if (layoutModeRef.current === nextLayoutMode) return 0;
    layoutModeRef.current = nextLayoutMode;
    return onLayoutModeChange?.(nextLayoutMode, { animate, motionTokens }) ?? 0;
  }

  function ensureMountedTab(nextTab: AdvancedToolsTab) {
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
  }

  async function waitForAdvancedTabReady(token: number, targetTab: AdvancedToolsTab): Promise<boolean> {
    const deadline = performance.now() + 30_000;
    let mountedFrames = 0;
    while (token === transitionTokenRef.current && performance.now() < deadline) {
      await new Promise<number>((resolve) => window.requestAnimationFrame(resolve));
      if (token !== transitionTokenRef.current) return false;
      const target = contentRefs.current.get(targetTab);
      if (!target) {
        mountedFrames = 0;
        continue;
      }
      // A mounted layer can still contain React.lazy's Suspense fallback.
      // Do not hand off input or capture the geometry bridge until the actual
      // page has committed; otherwise first layout and the morph share a frame.
      const pageContent = target.querySelector(".advanced-tab-scroll")?.firstElementChild;
      if (!pageContent || target.querySelector(".advanced-tab-loading")) {
        mountedFrames = 0;
        continue;
      }
      const readinessNode = target?.querySelector<HTMLElement>("[data-advanced-tab-ready]");
      const requiresExplicitReadiness = targetTab === "layout";
      if (requiresExplicitReadiness && readinessNode?.dataset.advancedTabReady !== "true") {
        mountedFrames = 0;
        continue;
      }
      mountedFrames += 1;
      if (mountedFrames >= 2) return true;
    }
    return false;
  }

  function readTabHeight(targetTab: AdvancedToolsTab): number | undefined {
    const node = contentRefs.current.get(targetTab);
    if (!node) return undefined;
    const scrollNode = node.querySelector<HTMLElement>(".advanced-tab-scroll");
    const viewportNode = viewportRef.current;
    const viewportRect = viewportNode?.getBoundingClientRect() ?? node.getBoundingClientRect();
    const viewportMetrics = readViewportMetrics();
    /*
     * The regular advanced popover sizes itself from this measurement. Using
     * its current bottom as a cap creates a feedback loop: a short first
     * measurement makes the popover short, which then makes every subsequent
     * measurement short. Cap against the actual viewport instead.
     */
    const safeBottom = viewportMetrics.bottom - 12;
    const maxCachedHeight = Math.max(1, Math.floor(safeBottom - viewportRect.top - 12));
    const nextHeight = Math.min(
      Math.ceil(scrollNode?.scrollHeight ?? node.scrollHeight),
      maxCachedHeight,
    );
    return nextHeight > 0 ? nextHeight : undefined;
  }

  function measureActiveHeight() {
    if (transitionInFlightRef.current) return;
    const token = transitionTokenRef.current;
    if (viewportMeasureFrameRef.current !== null) window.cancelAnimationFrame(viewportMeasureFrameRef.current);
    viewportMeasureFrameRef.current = window.requestAnimationFrame(() => {
      viewportMeasureFrameRef.current = null;
      // An idle/resize callback from the outgoing tab can outlive its effect.
      // Never let it resize the viewport while the next tab is crossfading.
      if (transitionInFlightRef.current || token !== transitionTokenRef.current) return;
      const nextHeight = readTabHeight(activeTabRef.current);
      if (nextHeight) setViewportHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }

  async function requestTabSwitch(nextTab: AdvancedToolsTab, options: AdvancedTabSwitchOptions = {}) {
    const currentTab = activeTabRef.current;
    if (nextTab === requestedTabRef.current && (transitionInFlightRef.current || nextTab === currentTab)) return;
    const starts: Partial<Record<AdvancedToolsTab, number>> = {};
    // Snapshot every currently presented layer before cancelling its animation.
    // A→B→C and A→B→A can still contain pixels from A: keeping only B would
    // erase that visible remainder during C's asynchronous preparation.
    for (const [tab, node] of contentRefs.current) {
      if (node.hidden || node.classList.contains("is-warm") || node.classList.contains("is-inactive")) continue;
      const opacity = Number.parseFloat(window.getComputedStyle(node).opacity);
      starts[tab] = Number.isFinite(opacity) ? opacity : tab === currentTab ? 1 : 0;
    }
    for (const [tab, opacity] of Object.entries(starts)) {
      const node = contentRefs.current.get(tab as AdvancedToolsTab);
      if (node) node.style.opacity = String(opacity);
    }
    const transitionToken = ++transitionTokenRef.current;
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    clearTransitionTimers();
    requestedTabRef.current = nextTab;
    transitionInFlightRef.current = true;
    setSelectedTab(nextTab);
    setTransitionPhase("preparing");
    setLoadError(undefined);
    const present = (targetTab: AdvancedToolsTab) => {
      const tokens = readEditorMotionTokens();
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const sibling = isWideModeTab(currentTab) === isWideModeTab(targetTab);
      transitionDurationRef.current = editorWorkspaceDuration(sibling
        ? reduced ? tokens.reducedSiblingDurationMs : tokens.siblingDurationMs * Math.max(.25, tokens.motionScale)
        : reduced ? reducedTabTransitionMs : tabContentTransitionMs * Math.max(.25, tokens.motionScale), tokens);
      transitionEasingRef.current = sibling ? tokens.siblingEasing : tokens.crossfadeEasing;
      const visible = new Set(Object.keys(starts) as AdvancedToolsTab[]);
      visible.add(targetTab);
      setPresentedTabs(visible);
      setLayerStartOpacities({ ...starts, [targetTab]: starts[targetTab] ?? 0 });
      setEnteringTab(targetTab);
      // Inert removes old controls from tab order; move a focused old control
      // onto the persistent navigation before committing the new input owner.
      for (const [tab, node] of contentRefs.current) {
        if (tab !== targetTab && node.contains(document.activeElement)) {
          viewportRef.current?.closest(".advanced-tools-panel")
            ?.querySelector<HTMLButtonElement>(`[data-help-key="advanced.tab.${targetTab}"]`)
            ?.focus({ preventScroll: true });
          break;
        }
      }
      activeTabRef.current = targetTab;
      setActiveTab(targetTab);
      setSelectedTab(targetTab);
      syncLayoutMode(isWideModeTab(targetTab), !options.instant, tokens);
      setTransitionPhase("crossfading");
    };
    try {
      await awaitModuleLoad(preloadAdvancedTab(nextTab), controller.signal);
      if (transitionToken !== transitionTokenRef.current) return;
      ensureMountedTab(nextTab);
      if (!await waitForAdvancedTabReady(transitionToken, nextTab)) {
        if (transitionToken !== transitionTokenRef.current) return;
        throw new Error("页面尚未就绪，原页面已保留，请重试。");
      }
    } catch (error) {
      if (transitionToken !== transitionTokenRef.current || controller.signal.aborted) return;
      requestedTabRef.current = currentTab;
      setSelectedTab(currentTab);
      setLoadError({ tab: nextTab, message: error instanceof Error ? error.message : "页面载入失败，请重试。" });
      // Even a failed request may have interrupted a blend. Restore its owner
      // from the frozen pixels, rather than snapping all old layers away.
      present(currentTab);
      return;
    }
    if (transitionToken !== transitionTokenRef.current) return;
    present(nextTab);
  }

  useLayoutEffect(() => {
    if (transitionPhase !== "crossfading" || !enteringTab) return;
    const token = transitionTokenRef.current;
    const enteringNode = contentRefs.current.get(enteringTab);
    if (!enteringNode) return;
    const duration = transitionDurationRef.current;
    const layers = [...presentedTabs].flatMap(tab => {
      const node = contentRefs.current.get(tab);
      return node ? [{ tab, node, end: tab === enteringTab ? 1 : 0 }] : [];
    });
    for (const { node, end } of layers) node.style.opacity = String(end);
    if (duration === 0) {
      settleTabTransition(token, enteringTab);
      return;
    }
    const easing = transitionEasingRef.current;
    const timing = { duration, easing: easing || "cubic-bezier(0.23, 1, 0.32, 1)", fill: "both" as const };
    const animations = layers.map(({ tab, node, end }) =>
      node.animate([{ opacity: layerStartOpacities[tab] ?? 0 }, { opacity: end }], timing));
    // Keep the initial visual values through this layout commit. Start on the
    // next presentation frame with one explicit clock for both layers: large
    // 4K layers can otherwise remain compositor-pending until the safety timer.
    for (const animation of animations) animation.pause();
    layerAnimationsRef.current = animations;
    const settle = () => settleTabTransition(token, enteringTab);
    void Promise.all(animations.map(animation => animation.finished)).then(settle, () => {
      // A cancelled/deactivated compositor must not leave a page locked.
      // Superseded requests are rejected by the token inside settle.
      settle();
    });
    const startFrame = window.requestAnimationFrame((timestamp) => {
      if (token !== transitionTokenRef.current) return;
      // RAF's timestamp is the beginning of the frame; a costly layout may
      // already have consumed most of the budget by the time this runs.
      for (const animation of animations) {
        animation.play();
        // WAAPI startTime is expressed on the document timeline. Use the
        // timestamp supplied by this RAF rather than performance.now(), whose
        // sampling point can be ahead of the frame timestamp and produce a
        // negative currentTime on the first compositor sample.
        animation.startTime = timestamp;
      }
    });
    const finishWhenHidden = () => { if (document.hidden) settle(); };
    document.addEventListener("visibilitychange", finishWhenHidden);
    return () => {
      window.cancelAnimationFrame(startFrame);
      document.removeEventListener("visibilitychange", finishWhenHidden);
      for (const animation of animations) animation.cancel();
      if (layerAnimationsRef.current === animations) layerAnimationsRef.current = [];
    };
  }, [transitionPhase, enteringTab, presentedTabs]);

  function contentRefFor(targetTab: AdvancedToolsTab) {
    const cached = contentRefCallbacks.current.get(targetTab);
    if (cached) return cached;
    const callback = (node: HTMLDivElement | null) => {
      if (node) contentRefs.current.set(targetTab, node);
      else contentRefs.current.delete(targetTab);
    };
    contentRefCallbacks.current.set(targetTab, callback);
    return callback;
  }

  useEffect(() => {
    void syncLayoutMode(isWideModeTab(activeTab), false);
  }, [activeTab, onLayoutModeChange]);

  useEffect(() => () => {
    ++transitionTokenRef.current;
    loadControllerRef.current?.abort();
    clearTransitionTimers();
    // StrictMode replays effects without destroying refs. Release the cancelled
    // request so the replay can load its initial requested page; otherwise the
    // duplicate-target guard mistakes that retry for a live navigation.
    transitionInFlightRef.current = false;
    requestedTabRef.current = activeTabRef.current;
  }, []);

  return {
    activeTab,
    selectedTab,
    enteringTab,
    presentedTabs,
    transitionPhase,
    layoutTransitioning: transitionPhase !== "idle",
    viewportHeight,
    mountedTabs,
    layerStartOpacities,
    loadError,
    isLayoutMode,
    viewportRef,
    contentRefFor,
    requestTabSwitch,
    measureActiveHeight,
  };
}

export function AdvancedToolsPanel({ request, onLayoutModeChange }: { request?: AdvancedToolsRequest; onLayoutModeChange?: (isLayoutMode: boolean, options?: AdvancedLayoutModeOptions) => number }) {
  const [history, setHistory] = useState<GenerationHistoryEntry[]>([]);
  const [notice, setNotice] = useState<AdvancedToolsRequest | undefined>();
  const runtimeLayoutSessionRef = useRef<RuntimeLayoutDesignerSession>({});
  const projectId = useProjectStore((state) => state.projectId);
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const assetLibrary = useProjectStore((state) => state.settings.assetLibrary);
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const setAssetLibrary = useProjectStore((state) => state.setAssetLibrary);
  const {
    activeTab,
    selectedTab,
    enteringTab,
    presentedTabs,
    transitionPhase,
    layoutTransitioning,
    viewportHeight,
    mountedTabs,
    layerStartOpacities,
    loadError,
    isLayoutMode,
    viewportRef,
    contentRefFor,
    requestTabSwitch,
    measureActiveHeight,
  } = useAdvancedTabTransition(onLayoutModeChange);
  const visibleTabs = visibleAdvancedTabs;

  useEffect(() => {
    if (!request) return;
    setNotice(request.title || request.message ? request : undefined);
    requestTabSwitch(request.tab, { animateContainer: false });
  }, [request?.id]);

  useEffect(() => {
    /*
     * Load tab implementations while the advanced panel is idle so a real
     * click does not spend the entire opacity timeline waiting on a dynamic
     * import. Rendering still remains lazy per mounted tab.
     */
    const preload = () => {
      for (const tab of visibleAdvancedTabs) {
        void preloadAdvancedTab(tab).catch(() => undefined);
      }
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const usedIdleCallback = typeof idleWindow.requestIdleCallback === "function";
    const idle = usedIdleCallback
      ? idleWindow.requestIdleCallback(preload, { timeout: 900 })
      : window.setTimeout(preload, 120);
    return () => {
      if (usedIdleCallback && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle);
      }
    };
  }, []);

  useEffect(() => {
    if (isLayoutMode || transitionPhase !== "idle") return;
    let cancelIdleMeasure: (() => void) | undefined;
    let settleMeasureTimer: number | undefined;
    const scheduleMeasure = () => {
      cancelIdleMeasure?.();
      if ("requestIdleCallback" in window) {
        const id = window.requestIdleCallback(measureActiveHeight, { timeout: 160 });
        cancelIdleMeasure = () => window.cancelIdleCallback(id);
        return;
      }
      const id = globalThis.setTimeout(measureActiveHeight, 80);
      cancelIdleMeasure = () => globalThis.clearTimeout(id);
    };

    scheduleMeasure();
    /*
     * The popover enters after the tab mounts. Measuring only during the
     * initial render captures the pre-entry height and leaves a permanently
     * short settings viewport (the exact "cannot fully expand" symptom).
     * Re-measure once the popover geometry has settled.
     */
    settleMeasureTimer = window.setTimeout(scheduleMeasure, 360);
    const unsubscribeViewport = subscribeToViewportChanges(scheduleMeasure);
    const node = viewportRef.current?.querySelector<HTMLElement>(".advanced-tab-content.is-active");
    if (!node) {
      return () => {
        cancelIdleMeasure?.();
        if (settleMeasureTimer !== undefined) window.clearTimeout(settleMeasureTimer);
        unsubscribeViewport();
      };
    }
    const observer = new ResizeObserver(scheduleMeasure);
    const observed = new Set<Element>();
    const observe = (target: Element | null | undefined) => {
      if (!target || observed.has(target)) return;
      observer.observe(target);
      observed.add(target);
    };
    const observeContentChildren = () => {
      const scrollNode = node.querySelector<HTMLElement>(".advanced-tab-scroll");
      observe(node);
      observe(scrollNode);
      Array.from((scrollNode ?? node).children).forEach(observe);
    };
    observeContentChildren();
    const mutationObserver = new MutationObserver(() => {
      scheduleMeasure();
      observeContentChildren();
    });
    mutationObserver.observe(node.querySelector<HTMLElement>(".advanced-tab-scroll") ?? node, {
      childList: true,
    });
    return () => {
      cancelIdleMeasure?.();
      if (settleMeasureTimer !== undefined) window.clearTimeout(settleMeasureTimer);
      unsubscribeViewport();
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [activeTab, transitionPhase, isLayoutMode, notice, assetManifest.length, assetLibrary.folders.length, Object.keys(assetLibrary.assetLocations).length, history.length]);

  useEffect(() => {
    const preloadWideTabs = () => {
      void preloadAdvancedTab("layout").catch(() => {
        // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
        return undefined;
      });
      window.setTimeout(() => void preloadAdvancedTab("theme").catch(() => {
        // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
        return undefined;
      }), 180);
    };
    const schedule = "requestIdleCallback" in window
      ? window.requestIdleCallback(preloadWideTabs, { timeout: 1200 })
      : globalThis.setTimeout(preloadWideTabs, 250);
    return () => {
      if ("cancelIdleCallback" in window && typeof schedule === "number") window.cancelIdleCallback(schedule);
      else globalThis.clearTimeout(schedule as number);
    };
  }, []);

  const saveAsset = useCallback((asset: GeneratedAssetRecord) => {
    const assetRef = generatedAssetToAssetRef(asset);
    const currentManifest = useProjectStore.getState().assetManifest;
    setAssetManifest([
      assetRef,
      ...currentManifest.filter((item) => item.asset_id !== assetRef.asset_id),
    ]);
    setHistory((current) => [
      {
        history_id: `hist_${Date.now()}`,
        created_at: new Date().toISOString(),
        provider_id: asset.provider_id ?? "unknown",
        model: asset.model ?? "unknown",
        request_type: "image_generation",
        prompt_preview: asset.prompt?.slice(0, 120) ?? "",
        result_asset_ids: [asset.asset_id],
        status: "success",
      },
      ...current,
    ]);
  }, [setAssetManifest]);

  const importAssetsToLibrary = useCallback((entries: Array<{ asset: AssetRef; folderId: string | null }>) => {
    if (entries.length === 0) return;
    const importedIds = new Set(entries.map((entry) => entry.asset.asset_id));
    setAssetManifest([
      ...entries.map((entry) => entry.asset),
      ...assetManifest.filter((item) => !importedIds.has(item.asset_id)),
    ]);
    setAssetLibrary(putImportedAssetsInFolder(
      assetLibrary,
      entries.map((entry) => ({ assetId: entry.asset.asset_id, folderId: entry.folderId })),
    ));
  }, [assetLibrary, assetManifest, setAssetLibrary, setAssetManifest]);

  const updateLibraryAssets = useCallback((updates: AssetRef[]) => {
    if (updates.length === 0) return;
    if (useProjectStore.getState().projectId !== projectId) return;
    const updatesById = new Map(updates.map((asset) => [asset.asset_id, asset]));
    const currentManifest = useProjectStore.getState().assetManifest;
    setAssetManifest(currentManifest.map((asset) => updatesById.get(asset.asset_id) ?? asset));
  }, [projectId, setAssetManifest]);

  const deleteLibraryAssets = useCallback((assetIds: string[]) => {
    if (assetIds.length === 0) return;
    const deletedIds = new Set(assetIds);
    const currentState = useProjectStore.getState();
    setAssetManifest(currentState.assetManifest.filter((item) => !deletedIds.has(item.asset_id)));
    const currentLibrary = currentState.settings.assetLibrary;
    const assetLocations = { ...currentLibrary.assetLocations };
    let locationsChanged = false;
    for (const assetId of deletedIds) {
      if (!(assetId in assetLocations)) continue;
      delete assetLocations[assetId];
      locationsChanged = true;
    }
    if (locationsChanged) setAssetLibrary({ ...currentLibrary, assetLocations });
  }, [setAssetLibrary, setAssetManifest]);

  function renderTabContent(activeTab: AdvancedToolsTab) {
    if (activeTab === "settings") return <ProjectSettingsPanel />;
    if (activeTab === "layout") return <RuntimeLayoutDesigner sessionRef={runtimeLayoutSessionRef} />;
    if (activeTab === "theme") return <RuntimeThemeDesigner />;
    if (activeTab === "assets") {
      return (
        <AssetGenerationPanel
          onSaveAsset={saveAsset}
          openContext={request?.tab === "assets" ? request.assetStudioContext : undefined}
        />
      );
    }
    if (activeTab === "novel") return <NovelImportWizard />;
    if (activeTab === "library") {
      return (
        <AssetLibraryPanel
          key={projectId}
          assets={assetManifest}
          assetLibrary={assetLibrary}
          onAssetLibraryChange={setAssetLibrary}
          onImportMany={importAssetsToLibrary}
          onUpdateMany={updateLibraryAssets}
          onDeleteMany={deleteLibraryAssets}
        />
      );
    }
    if (activeTab === "animation") return <AnimationEditorPanel />;
    if (activeTab === "preview") return <PreviewWindowControls />;
    if (activeTab === "providers") return <ProviderSettingsPanel />;
    return <GenerationHistoryPanel history={history} />;
  }

  const viewportStyle = viewportHeight && !isLayoutMode ? {
    height: `${viewportHeight}px`,
    minHeight: `${viewportHeight}px`,
  } as CSSProperties : undefined;

  return (
    <section
      className={`advanced-tools-panel${isLayoutMode ? " layout-mode" : ""} is-tab-${transitionPhase}`}
      data-layout-transitioning={layoutTransitioning ? "true" : undefined}
    >
      <GlassSelectionGroup
        as="nav"
        selectedKey={selectedTab}
        scrollAxis="x"
        motion="light"
        observeViewportResize
      >
        {visibleTabs.map((item) => (
          <button
            key={item}
            type="button"
            className={selectedTab === item ? "is-active" : ""}
            data-glass-selected={selectedTab === item}
            data-help-key={`advanced.tab.${item}`}
            onPointerEnter={() => void preloadAdvancedTab(item).catch(() => {
              // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
              return undefined;
            })}
            onFocus={() => void preloadAdvancedTab(item).catch(() => {
              // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
              return undefined;
            })}
            onClick={() => void requestTabSwitch(item)}
          >
            {tabLabels[item]}
          </button>
        ))}
      </GlassSelectionGroup>

      {notice && activeTab === notice.tab && (
        <div className="advanced-panel-notice" role="status">
          <div>
            <strong>{notice.title ?? "请先完成配置"}</strong>
            {notice.message && <p>{notice.message}</p>}
          </div>
          <button type="button" data-help-key="advanced.noticeDismiss" onClick={() => setNotice(undefined)}>
            知道了
          </button>
        </div>
      )}

      <div
        className={`advanced-tab-viewport${viewportHeight && !isLayoutMode ? " has-managed-height" : ""}`}
        ref={viewportRef}
        style={viewportStyle}
      >
        {transitionPhase === "preparing" && <div className="advanced-tab-pending" role="status">
          正在载入{tabLabels[selectedTab]}
        </div>}
        {loadError && <div className="advanced-tab-load-error" role="alert">
          <span>{tabLabels[loadError.tab]}：{loadError.message}</span>
          <button type="button" onClick={() => void requestTabSwitch(loadError.tab)}>重试载入</button>
        </div>}
        {[...mountedTabs].map((item) => {
          const isActive = item === activeTab;
          const isLeaving = !isActive && presentedTabs.has(item);
          const isEntering = item === enteringTab;
          const keepWarm = !isActive && !isLeaving && shouldKeepWarmTab(item, activeTab);
          const layerState = isActive
            ? " is-active"
            : isLeaving
              ? " is-leaving"
              : isEntering
                ? " is-preparing"
                : keepWarm
                  ? " is-warm"
                  : " is-inactive";
          return (
            <div
              className={`advanced-tab-content${layerState}${isEntering && !isActive ? " is-preparing" : ""}${isEntering && transitionPhase === "crossfading" ? " is-entering" : ""}`}
              style={isEntering || isLeaving
                ? {
                  pointerEvents: isLeaving && !isActive ? "none" : undefined,
                  "--advanced-tab-start-opacity": layerStartOpacities[item] ?? (isActive ? 1 : 0),
                } as CSSProperties
                : undefined}
              ref={contentRefFor(item)}
              data-tab={item}
              aria-hidden={!isActive}
              inert={!isActive}
              data-advanced-tab-interactive={isActive ? "true" : "false"}
              hidden={!isActive && !keepWarm && !isLeaving}
              key={item}
            >
              <div className="advanced-tab-scroll">
                <Suspense fallback={<AdvancedTabLoading tab={item} />}>
                  {renderTabContent(item)}
                </Suspense>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
