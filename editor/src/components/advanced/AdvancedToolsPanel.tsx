import { Suspense, lazy, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties } from "react";
import type { GeneratedAssetRecord, GenerationHistoryEntry } from "../../providers/types";
import { useProjectStore } from "../../store/projectStore";
import type { AssetRef } from "../../types/assets";
import { putImportedAssetsInFolder } from "../../utils/assetLibraryInteractions";
import { generatedAssetToAssetRef } from "../../utils/projectAssets";
import type { AdvancedToolsRequest, AdvancedToolsTab } from "./advancedToolsBridge";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

type AdvancedTabLoader = () => Promise<{ default: ComponentType<any> }>;

const advancedTabLoaders: Record<AdvancedToolsTab, AdvancedTabLoader> = {
  settings: () => import("./ProjectSettingsPanel").then((module) => ({ default: module.ProjectSettingsPanel })),
  layout: () => import("./RuntimeLayoutDesigner").then((module) => ({ default: module.RuntimeLayoutDesigner })),
  theme: () => import("./RuntimeThemeDesigner").then((module) => ({ default: module.RuntimeThemeDesigner })),
  novel: () => import("../novel-import/NovelImportWizard").then((module) => ({ default: module.NovelImportWizard })),
  assets: () => import("./AssetGenerationPanel").then((module) => ({ default: module.AssetGenerationPanel })),
  library: () => import("./AssetLibraryPanel").then((module) => ({ default: module.AssetLibraryPanel })),
  animation: () => import("./AnimationEditorPanel").then((module) => ({ default: module.AnimationEditorPanel })),
  preview: () => import("./PreviewWindowControls").then((module) => ({ default: module.PreviewWindowControls })),
  providers: () => import("./ProviderSettingsPanel").then((module) => ({ default: module.ProviderSettingsPanel })),
  history: () => import("./GenerationHistoryPanel").then((module) => ({ default: module.GenerationHistoryPanel })),
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
  layout: "客户端布局",
  theme: "客户端主题",
  novel: "小说导入",
  assets: "素材生成",
  library: "素材库",
  animation: "动画编辑",
  preview: "预览窗口",
  providers: "模型/连接",
  history: "生成历史",
};

const visibleAdvancedTabs = (Object.keys(tabLabels) as AdvancedToolsTab[]).filter((item) => item !== "novel" && item !== "history");

type TabTransitionPhase = "idle" | "entering";
type AdvancedLayoutModeOptions = { animate?: boolean };
type AdvancedTabSwitchOptions = { animateContainer?: boolean };

const tabContentExitMs = 220;
const tabContentEnterMs = 360;
const tabContainerResizeMs = 420;
const tabTransitionSettlePaddingMs = 80;

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

function AdvancedTabLoading({ tab }: { tab: AdvancedToolsTab }) {
  return (
    <div className="advanced-tab-loading" role="status" aria-live="polite">
      <strong>正在载入{tabLabels[tab]}</strong>
      <span>按功能拆分加载，减少编辑器首屏脚本体积。</span>
    </div>
  );
}

function AdvancedTabPreparing({ tab }: { tab: AdvancedToolsTab }) {
  return (
    <div className="advanced-tab-loading advanced-tab-preparing" role="status" aria-live="polite">
      <strong>正在展开{tabLabels[tab]}</strong>
      <span>先完成工作区尺寸切换，再载入复杂控件，避免动画卡顿。</span>
    </div>
  );
}

function getMotionScale(): number {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--motion-scale").trim();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 1;
}

function useAdvancedTabTransition(
  onLayoutModeChange?: (isLayoutMode: boolean, options?: AdvancedLayoutModeOptions) => number,
) {
  const [activeTab, setActiveTab] = useState<AdvancedToolsTab>("settings");
  const [selectedTab, setSelectedTab] = useState<AdvancedToolsTab>("settings");
  const [enteringTab, setEnteringTab] = useState<AdvancedToolsTab>();
  const [exitingTab, setExitingTab] = useState<AdvancedToolsTab>();
  const [transitionPhase, setTransitionPhase] = useState<TabTransitionPhase>("idle");
  const [containerMorphing, setContainerMorphing] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number>();
  const [viewportScaleY, setViewportScaleY] = useState(1);
  const [mountedTabs, setMountedTabs] = useState<Set<AdvancedToolsTab>>(() => new Set(["settings"]));
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRefs = useRef(new Map<AdvancedToolsTab, HTMLDivElement>());
  const contentRefCallbacks = useRef(new Map<AdvancedToolsTab, (node: HTMLDivElement | null) => void>());
  const settleTimerRef = useRef<number | null>(null);
  const viewportMeasureFrameRef = useRef<number | null>(null);
  const layoutModeRef = useRef(isWideModeTab("settings"));
  const activeTabRef = useRef(activeTab);

  const isLayoutMode = isWideModeTab(selectedTab) || isWideModeTab(activeTab);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  function clearTransitionTimers() {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    if (viewportMeasureFrameRef.current !== null) window.cancelAnimationFrame(viewportMeasureFrameRef.current);
    settleTimerRef.current = null;
    viewportMeasureFrameRef.current = null;
  }

  function syncLayoutMode(nextLayoutMode: boolean, animate: boolean) {
    if (layoutModeRef.current === nextLayoutMode) return;
    layoutModeRef.current = nextLayoutMode;
    onLayoutModeChange?.(nextLayoutMode, { animate });
  }

  function ensureMountedTab(nextTab: AdvancedToolsTab) {
    setMountedTabs((current) => {
      if (current.has(nextTab)) return current;
      const next = new Set(current);
      next.add(nextTab);
      return next;
    });
  }

  function readTabHeight(targetTab: AdvancedToolsTab): number | undefined {
    const node = contentRefs.current.get(targetTab);
    if (!node) return undefined;
    const scrollNode = node.querySelector<HTMLElement>(".advanced-tab-scroll");
    const maxCachedHeight = Math.max(160, window.innerHeight - 220);
    const nextHeight = Math.min(Math.ceil(scrollNode?.scrollHeight ?? node.scrollHeight), maxCachedHeight);
    return nextHeight > 0 ? nextHeight : undefined;
  }

  function tabScaleRatio(fromHeight?: number, toHeight?: number): number {
    if (!fromHeight || !toHeight) return 1;
    const ratio = fromHeight / toHeight;
    return Math.min(1.28, Math.max(0.72, ratio));
  }

  function measureActiveHeight() {
    if (viewportMeasureFrameRef.current !== null) window.cancelAnimationFrame(viewportMeasureFrameRef.current);
    viewportMeasureFrameRef.current = window.requestAnimationFrame(() => {
      const nextHeight = readTabHeight(activeTabRef.current);
      if (nextHeight) setViewportHeight((current) => current === nextHeight ? current : nextHeight);
      viewportMeasureFrameRef.current = null;
    });
  }

  function requestTabSwitch(nextTab: AdvancedToolsTab, options: AdvancedTabSwitchOptions = {}) {
    const currentTab = activeTabRef.current;
    if (nextTab === selectedTab && nextTab === currentTab && !exitingTab) return;
    clearTransitionTimers();
    void preloadAdvancedTab(nextTab).catch(() => {
      // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
      return undefined;
    });
    const nextAlreadyMounted = mountedTabs.has(nextTab);
    ensureMountedTab(nextTab);

    const motionScale = getMotionScale();
    const animateContent = motionScale > 0;
    const currentWide = isWideModeTab(currentTab);
    const nextWide = isWideModeTab(nextTab);
    const currentHeight = !currentWide && !nextWide ? readTabHeight(currentTab) : undefined;
    const managedHeightTransition = !currentWide && !nextWide && nextAlreadyMounted;
    const nextHeight = managedHeightTransition ? readTabHeight(nextTab) : undefined;
    if (managedHeightTransition && nextHeight) {
      setViewportHeight(nextHeight);
      setViewportScaleY(tabScaleRatio(currentHeight, nextHeight));
    } else if (currentHeight) {
      setViewportHeight(currentHeight);
      setViewportScaleY(1);
    } else {
      setViewportHeight(undefined);
      setViewportScaleY(1);
    }
    syncLayoutMode(nextWide, options.animateContainer !== false && animateContent);
    setSelectedTab(nextTab);
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);

    if (!animateContent || nextTab === currentTab) {
      setEnteringTab(undefined);
      setExitingTab(undefined);
      setContainerMorphing(false);
      setTransitionPhase("idle");
      return;
    }

    setEnteringTab(nextTab);
    setExitingTab(managedHeightTransition ? currentTab : undefined);
    setContainerMorphing(managedHeightTransition);
    setTransitionPhase("idle");
    settleTimerRef.current = window.setTimeout(() => {
      setEnteringTab(undefined);
      setExitingTab(undefined);
      setContainerMorphing(false);
      setTransitionPhase("idle");
      settleTimerRef.current = null;
      if (!isWideModeTab(activeTabRef.current)) measureActiveHeight();
    }, Math.ceil((managedHeightTransition ? Math.max(tabContentEnterMs, tabContentExitMs, tabContainerResizeMs) : tabContentEnterMs) * motionScale) + tabTransitionSettlePaddingMs);
  }

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

  useLayoutEffect(() => {
    if (isLayoutMode) return;
    measureActiveHeight();
  }, [activeTab, transitionPhase, isLayoutMode]);

  useEffect(() => {
    syncLayoutMode(isWideModeTab(selectedTab), false);
  }, [selectedTab, onLayoutModeChange]);

  useEffect(() => () => clearTransitionTimers(), []);

  return {
    activeTab,
    selectedTab,
    enteringTab,
    exitingTab,
    transitionPhase,
    containerMorphing,
    viewportHeight,
    viewportScaleY,
    mountedTabs,
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
  const assetManifest = useProjectStore((state) => state.assetManifest);
  const assetLibrary = useProjectStore((state) => state.settings.assetLibrary);
  const setAssetManifest = useProjectStore((state) => state.setAssetManifest);
  const setAssetLibrary = useProjectStore((state) => state.setAssetLibrary);
  const {
    activeTab,
    selectedTab,
    enteringTab,
    exitingTab,
    transitionPhase,
    containerMorphing,
    viewportHeight,
    viewportScaleY,
    mountedTabs,
    isLayoutMode,
    viewportRef,
    contentRefFor,
    requestTabSwitch,
    measureActiveHeight,
  } = useAdvancedTabTransition(onLayoutModeChange);

  useEffect(() => {
    if (!request) return;
    setNotice(request);
    requestTabSwitch(request.tab, { animateContainer: false });
  }, [request?.id]);

  useEffect(() => {
    if (isLayoutMode) return;
    let cancelIdleMeasure: (() => void) | undefined;
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
    const node = viewportRef.current?.querySelector<HTMLElement>(".advanced-tab-content.is-active");
    if (!node) return () => cancelIdleMeasure?.();
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

  const updateLibraryAsset = useCallback((asset: AssetRef) => {
    setAssetManifest([asset, ...assetManifest.filter((item) => item.asset_id !== asset.asset_id)]);
  }, [assetManifest, setAssetManifest]);

  const deleteLibraryAsset = useCallback((assetId: string) => {
    setAssetManifest(assetManifest.filter((item) => item.asset_id !== assetId));
    if (assetLibrary.assetLocations[assetId]) {
      const assetLocations = { ...assetLibrary.assetLocations };
      delete assetLocations[assetId];
      setAssetLibrary({ ...assetLibrary, assetLocations });
    }
  }, [assetLibrary, assetManifest, setAssetLibrary, setAssetManifest]);

  function renderTabContent(activeTab: AdvancedToolsTab) {
    if (activeTab === "settings") return <ProjectSettingsPanel />;
    if (activeTab === "layout") return <RuntimeLayoutDesigner />;
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
          assets={assetManifest}
          assetLibrary={assetLibrary}
          onAssetLibraryChange={setAssetLibrary}
          onImportMany={importAssetsToLibrary}
          onUpdate={updateLibraryAsset}
          onDelete={deleteLibraryAsset}
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
    "--advanced-tab-scale-y": String(viewportScaleY),
  } as CSSProperties : undefined;

  return (
    <section className={`advanced-tools-panel${isLayoutMode ? " layout-mode" : ""} is-tab-${transitionPhase}`}>
      <nav>
        {visibleAdvancedTabs.map((item) => (
          <button
            key={item}
            type="button"
            className={selectedTab === item ? "is-active" : ""}
            data-help-key={`advanced.tab.${item}`}
            onPointerEnter={() => void preloadAdvancedTab(item).catch(() => {
              // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
              return undefined;
            })}
            onFocus={() => void preloadAdvancedTab(item).catch(() => {
              // error-log-ignore: preloadAdvancedTab 已在统一入口记录加载失败。
              return undefined;
            })}
            onClick={() => requestTabSwitch(item, { animateContainer: true })}
          >
            {tabLabels[item]}
          </button>
        ))}
      </nav>

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
        className={`advanced-tab-viewport${containerMorphing ? " is-morphing" : ""}${viewportHeight && !isLayoutMode ? " has-managed-height" : ""}`}
        ref={viewportRef}
        style={viewportStyle}
      >
        {visibleAdvancedTabs.filter((item) => mountedTabs.has(item)).map((item) => {
          const isActive = item === activeTab;
          const isLeaving = item === exitingTab;
          const keepWarm = !isActive && !isLeaving && shouldKeepWarmTab(item, activeTab);
          return (
            <div
              className={`advanced-tab-content${isActive ? " is-active" : isLeaving ? " is-leaving" : keepWarm ? " is-warm" : " is-inactive"}${item === enteringTab ? " is-entering" : ""}`}
              ref={contentRefFor(item)}
              data-tab={item}
              aria-hidden={!isActive}
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
