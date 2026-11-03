import { useReactFlow } from "@xyflow/react";
import { BookOpen, Bot, Clock3, Eye, FileInput, GitBranch, Home, Images, Radio, Save, Sparkles, X } from "lucide-react";
import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent as ReactAnimationEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { backendClient } from "../../api/backendClient";
import { RoseTwoLoader } from "../common/RoseTwoLoader";
import { GlassSelectionGroup } from "../common/GlassSelectionGroup";
import { OperationResultDialog } from "../common/OperationResultDialog";
import { useEditorStore } from "../../store/editorStore";
import { useNovelImportStore } from "../../store/novelImportStore";
import { useProjectStore } from "../../store/projectStore";
import type { NovelPersistenceState } from "../../novel-import/types";
import type { AssetRef } from "../../types/assets";
import { buildProjectExportFileName } from "../../utils/fileNames";
import { buildProjectBundle, writeNativeProjectBundle } from "../../utils/projectBundle";
import { useEditorPreferencesStore } from "../../store/editorPreferencesStore";
import { parseProjectFile } from "../../utils/projectImport";
import { writeProjectBackup, type ProjectBackupEntry } from "../../utils/projectTimeline";
import { advancedToolsEventName, type AdvancedToolsRequest } from "../advanced/advancedToolsBridge";
import { MemoryModeSelector } from "./MemoryModeSelector";
import { ThemeToneSelector } from "./ThemeToneSelector";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { requestBack, revealNovelTaskCard, canvasNodeFocusEventName, workspaceBackEventName, workspaceOpenSurfaceEventName, workspaceSurfaceChangedEventName, type BackSource, type WorkspaceSurface, type OwnedCanvasNodeFocusRequest } from "../workspace/workspaceContracts";
import { useWorkspaceController } from "../workspace/WorkspaceContext";
import type { PreviewWindowSession } from "../advanced/PreviewWindowControls";
import { awaitModuleLoad, recoverableComponentLoader } from "../../utils/recoverableModuleLoader";
import { AssistantCreationWorkbenchWindow } from "../assistant/AssistantCreationWorkbenchWindow";
import { useAssistantCreationRecoveryWindow } from "../../assistant/useAssistantCreationRecoveryWindow";
import { editorWorkspaceDuration, pruneHiddenLayoutSnapshot, readEditorMotionTokens, type EditorMotionTokens } from "../../utils/editorTransitionPresentation";

const loadExportCartridgePanel = recoverableComponentLoader(() =>
  import("../../cartridge/ExportCartridgePanel"), (module) => module.ExportCartridgePanel);
const loadAdvancedToolsPanel = recoverableComponentLoader(() =>
  import("../advanced/AdvancedToolsPanel"), (module) => module.AdvancedToolsPanel);
const loadAssistantChatPanel = recoverableComponentLoader(() =>
  import("../assistant/AssistantChatPanel"), (module) => module.AssistantChatPanel);
const loadNovelImportWizard = recoverableComponentLoader(() =>
  import("../novel-import/NovelImportWizard"), (module) => module.NovelImportWizard);
const loadProjectTimelinePanel = recoverableComponentLoader(() =>
  import("../timeline/ProjectTimelinePanel"), (module) => module.ProjectTimelinePanel);
const loadPreviewWindowControls = recoverableComponentLoader(() =>
  import("../advanced/PreviewWindowControls"), (module) => module.PreviewWindowControls);
const PreviewWindowControls = lazy(loadPreviewWindowControls);
const ExportCartridgePanel = lazy(loadExportCartridgePanel);
const AdvancedToolsPanel = lazy(loadAdvancedToolsPanel);
const AssistantChatPanel = lazy(loadAssistantChatPanel);
const NovelImportWizard = lazy(loadNovelImportWizard);
const ProjectTimelinePanel = lazy(loadProjectTimelinePanel);

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isAssetRef(value: unknown): value is AssetRef {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof (value as AssetRef).asset_id === "string" &&
    typeof (value as AssetRef).asset_type === "string" &&
    Boolean((value as AssetRef).metadata) &&
    typeof (value as AssetRef).metadata === "object";
}

function mergeAssetManifest(current: AssetRef[], incoming: unknown[]): AssetRef[] {
  const assets = new Map(current.map((asset) => [asset.asset_id, asset]));
  for (const asset of incoming) {
    if (!isAssetRef(asset)) continue;
    assets.set(asset.asset_id, { ...assets.get(asset.asset_id), ...asset });
  }
  return [...assets.values()];
}

function scheduleCanvasViewportWork(callback: () => void, options: { delayMs?: number; idleTimeoutMs?: number } = {}) {
  const delayMs = options.delayMs ?? 0;
  const run = () => {
    window.requestAnimationFrame(() => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
      };
      if (idleWindow.requestIdleCallback) {
        idleWindow.requestIdleCallback(callback, { timeout: options.idleTimeoutMs ?? 500 });
        return;
      }
      window.setTimeout(callback, 0);
    });
  };
  if (delayMs > 0) {
    window.setTimeout(run, delayMs);
    return;
  }
  run();
}

const popoverExitMs = 640;
const novelWorkbenchExitMs = 440;
const popoverMorphMs = 960;
const reducedPopoverMorphMs = 640;
const reducedSurfacePresentationMs = 480;
const surfacePresentationMs = 800;
const popoverMorphSettleMs = 80;
type ToolbarPanel = "cartridge" | "advanced" | "assistant" | "timeline" | "preview";
type ToolbarPanelStage = "closed" | "open" | "closing";
type AdvancedLayoutModeOptions = { animate?: boolean; motionTokens?: EditorMotionTokens };
type FocusCanvasNodeEvent = CustomEvent<{
  nodeId?: string;
  nodeIds?: string[];
  select?: boolean;
  padding?: number;
  zoom?: number;
  duration?: number;
  focusRequest?: OwnedCanvasNodeFocusRequest;
}>;

const toolbarPanelLabels: Record<ToolbarPanel, string> = {
  cartridge: "打包与发布",
  advanced: "工具 / 设置",
  assistant: "AI 助手",
  timeline: "时间线",
  preview: "游戏窗口预览",
};
const workspaceSurfaceLabels: Record<WorkspaceSurface, string> = {
  edit: "编辑", options: "选项", assistant: "AI 助手", preview: "GameCLI 预览",
  publish: "发布", assets: "素材", import: "小说导入", timeline: "时间线", advanced: "选项", settings: "选项",
};

function ToolbarPanelLoading({ panel }: { panel: ToolbarPanel }) {
  return (
    <div className="toolbar-panel-loading" role="status" aria-live="polite">
      <strong>正在加载{toolbarPanelLabels[panel]}</strong>
    </div>
  );
}

function LoadedToolbarPanelTransition({
  children,
  panelKey,
  onEntered,
  motionTokens,
}: {
  children: ReactNode;
  panelKey: ToolbarPanel;
  onEntered: () => void;
  motionTokens: EditorMotionTokens;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onEnteredRef = useRef(onEntered);
  onEnteredRef.current = onEntered;

  useLayoutEffect(() => {
    const target = hostRef.current?.firstElementChild;
    if (!(target instanceof HTMLElement)) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // The navigation reads these values before attaching its destination.
    // Reading root custom properties here flushes the newly mounted layout
    // designer inside React's commit, before its first presentation frame.
    const configuredScale = motionTokens.motionScale;
    const motionScale = Math.max(1, Number.isFinite(configuredScale) ? configuredScale : 1);
    const duration = editorWorkspaceDuration(
      (reduced ? reducedSurfacePresentationMs : surfacePresentationMs) * motionScale, motionTokens);
    const easing = motionTokens.contentEasing || "cubic-bezier(0.23, 1, 0.32, 1)";
    const animation = target.animate(
      [
        { opacity: 0.7, transform: reduced ? "none" : "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration, easing, fill: "both" },
    );
    animation.onfinish = () => {
      animation.onfinish = null;
      target.style.opacity = "";
      target.style.transform = "";
      animation.cancel();
      onEnteredRef.current();
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [panelKey]);

  return <div ref={hostRef} className="toolbar-panel-presentation-layer">{children}</div>;
}

function NovelWorkbenchLoading() {
  return (
    <div className="toolbar-panel-loading" role="status" aria-live="polite">
      <strong>正在加载小说导入</strong>
    </div>
  );
}

export function EditorToolbar({ onReturnHome }: { onReturnHome: () => void }) {
  const workspace = useWorkspaceController();
  const [renderedPanel, setRenderedPanel] = useState<ToolbarPanel | null>(null);
  const [panelStage, setPanelStage] = useState<ToolbarPanelStage>("closed");
  const [advancedRequest, setAdvancedRequest] = useState<AdvancedToolsRequest>();
  const [popoverLayoutMode, setPopoverLayoutMode] = useState(false);
  const popoverLayoutModeRef = useRef(false);
  const [popoverEntryComplete, setPopoverEntryComplete] = useState(false);
  const [portalAdvancedPopover, setPortalAdvancedPopover] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-height: 520px)").matches
  ));
  const [novelWorkbenchOpen, setNovelWorkbenchOpen] = useState(false);
  const [creationWorkbenchOpen, setCreationWorkbenchOpen] = useState(false);
  const [creationWorkbenchOpenRequest, setCreationWorkbenchOpenRequest] = useState(0);
  const creationWorkbenchReturnFocusRef = useRef<HTMLElement | null>(null);
  const [creationRecoveryConversationId, setCreationRecoveryConversationId] = useState<string>();
  const [novelWorkbenchClosing, setNovelWorkbenchClosing] = useState(false);
  const [restoringEntry, setRestoringEntry] = useState<ProjectBackupEntry>();
  const [projectSaveConfirmationOpen, setProjectSaveConfirmationOpen] = useState(false);
  const [projectSaveMessage, setProjectSaveMessage] = useState("");
  const [projectExportBusy, setProjectExportBusy] = useState(false);
  const [activeSurface, setActiveSurface] = useState<WorkspaceSurface>("edit");
  const activeSurfaceRef = useRef<WorkspaceSurface>("edit");
  const displayedSurfaceRef = useRef<WorkspaceSurface>("edit");
  const [requestedSurface, setRequestedSurface] = useState<WorkspaceSurface>("edit");
  const [surfaceLoading, setSurfaceLoading] = useState(false);
  const [surfaceLoadError, setSurfaceLoadError] = useState<{ surface: WorkspaceSurface; message: string }>();
  const surfaceTokenRef = useRef(0);
  const surfaceControllerRef = useRef<AbortController | undefined>(undefined);
  const surfaceInstantRef = useRef(false);
  const [primaryTask, setPrimaryTask] = useState(false);
  const previewBusyRef = useRef(false);
  const previewSessionRef = useRef<PreviewWindowSession | undefined>(undefined);
  const memoryMode = useEditorStore((state) => state.memoryMode);
  const nodes = useEditorStore((state) => state.nodes);
  const updateMemoryMode = useEditorStore((state) => state.updateMemoryMode);
  const autoArrangeNodes = useEditorStore((state) => state.autoArrangeNodes);
  const exportProject = useEditorStore((state) => state.exportProject);
  const importProject = useEditorStore((state) => state.importProject);
  const importProjectAsRoute = useEditorStore((state) => state.importProjectAsRoute);
  const setNotice = useEditorStore((state) => state.setNotice);
  const project = useProjectStore();
  useAssistantCreationRecoveryWindow(project.projectId, creationWorkbenchOpen, conversationId => {
    creationWorkbenchReturnFocusRef.current = null;
    setCreationRecoveryConversationId(conversationId);
    setCreationWorkbenchOpenRequest(request => request + 1);
    setCreationWorkbenchOpen(true);
  });
  const reactFlow = useReactFlow();
  const toolbarRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const workspaceInertOwnerRef = useRef<{ node: HTMLElement; original: boolean } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingPanelRef = useRef<ToolbarPanel | null>(null);
  const previousPopoverRectRef = useRef<DOMRect | null>(null);
  const popoverMotionTokensRef = useRef<EditorMotionTokens | null>(null);
  const popoverMorphRef = useRef<Animation | null>(null);
  const popoverMorphGhostRef = useRef<HTMLElement | null>(null);
  const popoverMorphBridgedContentRef = useRef<HTMLElement | null>(null);
  const retainPopoverMorphGhostRef = useRef(false);
  const popoverMorphSettleTimerRef = useRef<number | null>(null);
  const novelWorkbenchCloseTimerRef = useRef<number | null>(null);
  const novelImportButtonRef = useRef<HTMLButtonElement>(null);
  const novelWorkbenchRef = useRef<HTMLElement>(null);
  const saveProjectButtonRef = useRef<HTMLButtonElement>(null);
  const activePanel = panelStage === "open" ? renderedPanel : null;
  const visiblePanel = renderedPanel;
  // React commits during a WAAPI morph must preserve its measured origin.
  // Reading the owner avoids an extra render solely to start the animation.
  const popoverClassName = `toolbar-popover${primaryTask ? " workspace-task-panel" : ""}${visiblePanel === "preview" ? " preview" : ""}${visiblePanel === "cartridge" ? " cartridge" : ""}${visiblePanel === "advanced" ? " advanced" : ""}${visiblePanel === "assistant" ? " assistant" : ""}${visiblePanel === "timeline" ? " timeline" : ""}${popoverLayoutModeRef.current && visiblePanel === "advanced" ? " is-layout-mode" : ""}${popoverMorphRef.current ? " is-morphing" : ""}${popoverEntryComplete ? " is-entered" : ""}${panelStage === "open" ? " is-open" : ""}${panelStage === "closing" ? " is-closing" : ""}`;
  const aiToolsActive = activePanel === "assistant" || novelWorkbenchOpen;
  const settingsToolsActive = activePanel === "advanced";
  const timelineToolsActive = activePanel === "timeline";

  useLayoutEffect(() => {
    const updateTaskTop = () => {
      const bottom = toolbarRef.current?.getBoundingClientRect().bottom ?? 90;
      document.documentElement.style.setProperty("--workspace-task-top", `${bottom + 8}px`);
    };
    const workspaceShell = toolbarRef.current?.closest<HTMLElement>(".editor-workspace-shell");
    const workspace = workspaceShell?.querySelector<HTMLElement>(".editor-workspace");
    const flowSurface = workspace?.querySelector<HTMLElement>(".flow-surface");
    const updateTaskBounds = () => {
      const rect = flowSurface?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const root = document.documentElement;
      root.style.setProperty("--workspace-task-left", `${Math.max(0, rect.left)}px`);
      root.style.setProperty("--workspace-task-right", `${Math.max(0, root.clientWidth - rect.right)}px`);
      root.style.setProperty("--workspace-task-width", `${rect.width}px`);
      // Complex authoring desks occupy the editing area beside the node rail.
      // Leave the underlying canvas/Inspector mounted in their original tracks.
      const workspaceRect = workspace?.getBoundingClientRect();
      const wideRight = workspaceRect?.right ?? rect.right;
      root.style.setProperty("--workspace-wide-task-right", `${Math.max(0, root.clientWidth - wideRight)}px`);
      root.style.setProperty("--workspace-wide-task-width", `${Math.max(0, wideRight - rect.left)}px`);
    };
    const update = () => {
      updateTaskTop();
      updateTaskBounds();
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (workspace) observer?.observe(workspace);
    if (flowSurface) observer?.observe(flowSurface);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--workspace-task-top");
      document.documentElement.style.removeProperty("--workspace-task-left");
      document.documentElement.style.removeProperty("--workspace-task-right");
      document.documentElement.style.removeProperty("--workspace-task-width");
      document.documentElement.style.removeProperty("--workspace-wide-task-right");
      document.documentElement.style.removeProperty("--workspace-wide-task-width");
    };
  }, []);

  useEffect(() => {
    const hasVisiblePopover = renderedPanel !== null && panelStage !== "closed";
    document.body.classList.toggle("is-toolbar-popover-open", hasVisiblePopover);
    return () => document.body.classList.remove("is-toolbar-popover-open");
  }, [panelStage, renderedPanel]);

  useLayoutEffect(() => {
    const content = toolbarRef.current?.closest(".editor-workspace-shell")
      ?.querySelector<HTMLElement>(".editor-workspace-body");
    if (!content) return;
    const owner = workspaceInertOwnerRef.current;
    if (owner?.node !== content) {
      if (owner && owner.node.inert !== owner.original) owner.node.inert = owner.original;
      workspaceInertOwnerRef.current = { node: content, original: content.inert };
    }
    const nextInert = surfaceLoading || activeSurface !== "edit";
    // Loading and the ready modal share one input lease. Restore the original
    // state only when this owner unmounts, not on each loading/active update.
    if (content.inert !== nextInert) content.inert = nextInert;
  }, [surfaceLoading, activeSurface]);

  useLayoutEffect(() => () => {
    const owner = workspaceInertOwnerRef.current;
    workspaceInertOwnerRef.current = null;
    if (owner && owner.node.inert !== owner.original) owner.node.inert = owner.original;
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-height: 520px)");
    const update = () => setPortalAdvancedPopover(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const preload = () => {
      void loadAdvancedToolsPanel().catch(() => undefined);
      void loadAssistantChatPanel().catch(() => undefined);
      void loadExportCartridgePanel().catch(() => undefined);
      void loadPreviewWindowControls().catch(() => undefined);
      void import("../advanced/AdvancedToolsPanel").then((module) => module.preloadWorkspaceOptions()).catch(() => undefined);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idle = idleWindow.requestIdleCallback
      ? idleWindow.requestIdleCallback(preload, { timeout: 900 })
      : window.setTimeout(preload, 160);
    return () => {
      if (typeof idle === "number" && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, []);

  useEffect(() => {
    if (panelStage !== "open" || renderedPanel === null) {
      setPopoverEntryComplete(false);
      return;
    }
    setPopoverEntryComplete(false);
  }, [panelStage, renderedPanel]);

  function prefersReducedMotion() {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  function removePopoverMorphGhost() {
    popoverMorphBridgedContentRef.current?.removeAttribute("data-geometry-snapshot-owner");
    popoverMorphBridgedContentRef.current = null;
    popoverMorphGhostRef.current?.remove();
    popoverMorphGhostRef.current = null;
  }

  function capturePopoverMotionStart(direction: "enter" | "exit") {
    const node = popoverRef.current;
    if (!node) return;
    const style = getComputedStyle(node);
    node.style.setProperty(`--workspace-task-${direction}-start-opacity`, style.opacity);
    node.style.setProperty(`--workspace-task-${direction}-start-transform`, style.transform);
  }

  function capturePopoverRect(options: {
    preserveSnapshot?: boolean;
    pauseUntilMorph?: boolean;
    motionTokens?: EditorMotionTokens;
  } = {}) {
    const motionTokens = options.motionTokens ?? readEditorMotionTokens();
    popoverMotionTokensRef.current = motionTokens;
    const node = popoverRef.current;
    previousPopoverRectRef.current = node ? node.getBoundingClientRect() : null;
    removePopoverMorphGhost();
    retainPopoverMorphGhostRef.current = Boolean(options.preserveSnapshot);
    if (!node || !previousPopoverRectRef.current) {
      retainPopoverMorphGhostRef.current = false;
      return;
    }

    const rect = previousPopoverRectRef.current;
    const ghost = node.cloneNode(true) as HTMLElement;
    ghost.classList.remove(
      "is-morphing",
      "is-morph-settled",
      "is-entering",
      "is-entered",
      "is-closing",
      "is-open",
    );
    ghost.classList.add("toolbar-popover-morph-ghost");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.removeAttribute("id");
    ghost.querySelectorAll("[id], [data-help-key], [data-testid], [data-component-id]").forEach(element => {
      element.removeAttribute("id");
      element.removeAttribute("data-help-key");
      element.removeAttribute("data-testid");
      element.removeAttribute("data-component-id");
    });
    const sourceElements = node.querySelectorAll("*");
    // Preserve source/clone indices before pruning. Reading state from nodes
    // that will never be presented wastes work and can flush the live layout.
    const clonedElements = ghost.querySelectorAll("*");
    const removed = pruneHiddenLayoutSnapshot(ghost, { width: window.innerWidth, height: window.innerHeight });
    const scrollPositions: Array<{ element: Element; top: number; left: number }> = [];
    const scrollCandidates = node.querySelectorAll(
      ".advanced-tab-scroll,.advanced-tab-viewport,.runtime-layout-sidebar,.runtime-layout-center,"
      + ".runtime-layout-inspector,.assistant-chat-body,.assistant-history-menu,"
      + ".assistant-process-monitor,.assistant-creation-preview,.assistant-creation-review-content,"
      + ".assistant-code-block,.assistant-table-scroll,.custom-component-list,"
      + ".custom-component-import-review,[data-editor-snapshot-scroll]",
    );
    clonedElements.forEach((element, index) => {
      if (!ghost.contains(element)) return;
      const source = sourceElements[index];
      if (!source) return;
      if (element instanceof HTMLInputElement && source instanceof HTMLInputElement) {
        // File input values cannot be assigned a nonempty string. Keep the
        // cloned visual state without assigning a path during the handoff.
        if (element.type !== "file") element.value = source.value;
        element.checked = source.checked;
      } else if (element instanceof HTMLTextAreaElement && source instanceof HTMLTextAreaElement) {
        element.value = source.value;
      } else if (element instanceof HTMLSelectElement && source instanceof HTMLSelectElement) {
        element.value = source.value;
      }
    });
    scrollCandidates.forEach(source => {
      const index = Array.prototype.indexOf.call(sourceElements, source);
      if (index < 0) return;
      const element = clonedElements[index];
      if (!(element instanceof Element) || !ghost.contains(element)) return;
      const top = source.scrollTop, left = source.scrollLeft;
      if (top !== 0 || left !== 0) scrollPositions.push({ element, top, left });
    });
    ghost.style.setProperty("position", "fixed", "important");
    ghost.style.setProperty("inset", "auto", "important");
    ghost.style.setProperty("left", `${rect.left}px`, "important");
    ghost.style.setProperty("top", `${rect.top}px`, "important");
    ghost.style.setProperty("right", "auto", "important");
    ghost.style.setProperty("bottom", "auto", "important");
    ghost.style.setProperty("width", `${rect.width}px`, "important");
    ghost.style.setProperty("height", `${rect.height}px`, "important");
    ghost.style.setProperty("max-width", "none", "important");
    ghost.style.setProperty("max-height", "none", "important");
    ghost.style.setProperty("margin", "0", "important");
    ghost.style.setProperty("transform", "none", "important");
    ghost.style.setProperty("opacity", "1");
    ghost.style.setProperty("z-index", "1201", "important");
    ghost.style.setProperty("pointer-events", "none", "important");
    ghost.style.setProperty("overflow", "hidden", "important");
    ghost.style.setProperty("animation", "none", "important");
    ghost.style.setProperty("transition", "none", "important");
    if (removed) ghost.dataset.editorSnapshotLayoutPruned = String(removed);
    document.body.appendChild(ghost);
    // A detached clone has no scrollable layout: assigning its scroll position
    // there clamps to zero. Restore retained positions before its first paint.
    for (const { element, top, left } of scrollPositions) {
      if (!ghost.contains(element)) continue;
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    popoverMorphGhostRef.current = ghost;
    // The snapshot owns this exact outgoing page, not every leaving page.
    // Keep its React instance/opacity clock, but avoid laying it out again at
    // the destination's wide width. A superseding capture first releases this
    // marker, so a stale bridge cannot suppress a later page's presentation.
    const bridgedContent = node.querySelector<HTMLElement>(".advanced-tab-content.is-active");
    if (!options.preserveSnapshot && bridgedContent) {
      bridgedContent.setAttribute("data-geometry-snapshot-owner", "true");
      popoverMorphBridgedContentRef.current = bridgedContent;
    }

    const easing = motionTokens.containerEasing;
    const reduced = prefersReducedMotion();
    // Top-level surface handoffs retain the established slow outgoing layer.
    // Tab snapshots only bridge geometry and must finish before that morph.
    // These are separate motion owners even though both use a DOM snapshot.
    const surfaceHandoff = Boolean(options.preserveSnapshot);
    const ghostFade = ghost.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: editorWorkspaceDuration(surfaceHandoff
          ? reduced ? reducedSurfacePresentationMs : Math.min(576, popoverMorphMs * 0.6)
          : reduced ? Math.min(240, reducedPopoverMorphMs * 0.375) : Math.min(360, popoverMorphMs * 0.375), motionTokens),
        delay: editorWorkspaceDuration(reduced ? 0 : surfaceHandoff
          ? Math.min(384, popoverMorphMs * 0.4)
          : Math.min(120, popoverMorphMs * 0.125), motionTokens),
        easing: easing || "cubic-bezier(0.77, 0, 0.175, 1)",
        fill: "both",
      },
    );
    // A tab snapshot is captured before React commits the destination
    // geometry. Start its clock with that morph, so commit/render time cannot
    // consume the overlap before the destination's content begins to appear.
    if (options.pauseUntilMorph) ghostFade.pause();
    ghostFade.onfinish = () => {
      if (popoverMorphGhostRef.current === ghost) removePopoverMorphGhost();
    };
  }

  function clearPopoverMorphSettleTimer() {
    if (popoverMorphSettleTimerRef.current === null) return;
    window.clearTimeout(popoverMorphSettleTimerRef.current);
    popoverMorphSettleTimerRef.current = null;
  }

  function setAdvancedLayoutMode(nextLayoutMode: boolean, options: AdvancedLayoutModeOptions = {}): number {
    if (popoverLayoutModeRef.current === nextLayoutMode) return 0;
    const motionTokens = options.motionTokens ?? readEditorMotionTokens();
    if (options.animate === false) {
      clearPopoverMorphSettleTimer();
      popoverMorphRef.current?.cancel();
      popoverMorphRef.current = null;
      removePopoverMorphGhost();
      previousPopoverRectRef.current = null;
      const node = popoverRef.current;
      node?.classList.remove("is-morphing", "is-morph-settled");
      if (node) {
        node.style.transform = "";
        node.style.opacity = "";
        node.style.filter = "";
      }
    } else {
      capturePopoverRect({ motionTokens, pauseUntilMorph: true });
    }
    popoverLayoutModeRef.current = nextLayoutMode;
    if (options.animate === false) {
      popoverRef.current?.classList.toggle("is-layout-mode", nextLayoutMode && visiblePanel === "advanced");
    } else {
      setPopoverLayoutMode(nextLayoutMode);
    }
    const duration = editorWorkspaceDuration(prefersReducedMotion()
      ? reducedPopoverMorphMs
      : popoverMorphMs * motionTokens.motionScale, motionTokens);
    return options.animate === false ? 0 : duration;
  }

  function updatePopoverLayoutMode(nextLayoutMode: boolean) {
    popoverLayoutModeRef.current = nextLayoutMode;
    setPopoverLayoutMode(nextLayoutMode);
  }

  useLayoutEffect(() => {
    const previousRect = previousPopoverRectRef.current;
    const preserveSnapshot = retainPopoverMorphGhostRef.current;
    const node = popoverRef.current;
    previousPopoverRectRef.current = null;
    retainPopoverMorphGhostRef.current = false;
    if (!previousRect || !node || panelStage !== "open") return;

    // previousRect already captured the current on-screen presentation.
    // Measure the destination only after cancelling the previous effect;
    // otherwise a redirect measures a destination still scaled/translated by
    // that effect, and applying the new FLIP would compound both geometries.
    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
    popoverMorphRef.current = null;
    node.classList.remove("is-morphing", "is-morph-settled");
    const reduced = prefersReducedMotion();
    const nextRect = node.getBoundingClientRect();
    const fullDeltaX = previousRect.left - nextRect.left;
    const fullDeltaY = previousRect.top - nextRect.top;
    const fullScaleX = previousRect.width / Math.max(nextRect.width, 1);
    const fullScaleY = previousRect.height / Math.max(nextRect.height, 1);
    const sizeMorph = Math.abs(fullScaleX - 1) > 0.08 || Math.abs(fullScaleY - 1) > 0.08;
    const moved = Math.abs(fullDeltaX) > 1
      || Math.abs(fullDeltaY) > 1
      || Math.abs(fullScaleX - 1) > 0.01
      || Math.abs(fullScaleY - 1) > 0.01;
    if (!moved) {
      // Narrow layouts can share the same outer rectangle for regular and
      // wide tabs. Their content already has its own crossfade; a geometry
      // snapshot would duplicate that content without any morph to own it.
      // Surface handoffs explicitly retain their snapshot as a visual bridge.
      if (!preserveSnapshot) removePopoverMorphGhost();
      return;
    }
    if (!sizeMorph && !preserveSnapshot) removePopoverMorphGhost();

    // Reduced motion still bridges geometry. Docked workbenches must fit
    // their canvas track, not merely the much wider viewport: a small 1.08
    // scale at its right edge otherwise covers the preserved Inspector.
    const canvasTrack = node.classList.contains("workspace-task-panel")
      && !node.classList.contains("cartridge")
      ? document.querySelector<HTMLElement>(".editor-workspace > .flow-surface")?.getBoundingClientRect()
      : undefined;
    const trackFitsDestination = canvasTrack
      && nextRect.left >= canvasTrack.left - 1 && nextRect.right <= canvasTrack.right + 1;
    const motionLeft = trackFitsDestination ? canvasTrack.left : 0;
    const motionRight = trackFitsDestination ? canvasTrack.right : window.innerWidth;
    // Both endpoints fit; the shared monotonic easing then keeps every
    // intermediate rectangle inside the same preserved boundary.
    const deltaX = reduced
      ? Math.max(-Math.min(24, nextRect.left - motionLeft),
        Math.min(24, motionRight - nextRect.right, fullDeltaX))
      : fullDeltaX;
    const deltaY = reduced
      ? Math.max(-Math.min(24, nextRect.top),
        Math.min(24, window.innerHeight - nextRect.bottom, fullDeltaY))
      : fullDeltaY;
    const scaleX = reduced
      ? Math.max(0.92, Math.min(1.08, fullScaleX,
        (motionRight - nextRect.left - deltaX) / Math.max(nextRect.width, 1)))
      : fullScaleX;
    const scaleY = reduced
      ? Math.max(0.92, Math.min(1.08, fullScaleY,
        (window.innerHeight - nextRect.top - deltaY) / Math.max(nextRect.height, 1)))
      : fullScaleY;
    node.classList.add("is-morphing");
    const motionTokens = popoverMotionTokensRef.current ?? readEditorMotionTokens();
    const duration = editorWorkspaceDuration(reduced
      ? reducedPopoverMorphMs
      : popoverMorphMs * motionTokens.motionScale, motionTokens);
    if (duration <= 0) return;
    const easing = motionTokens.containerEasing;
    const contentEasing = motionTokens.contentEasing;
    const content = node.querySelector<HTMLElement>(".advanced-tools-panel");
    const contentAnimation = sizeMorph ? content?.animate(
      [
        { opacity: 0 },
        { opacity: 1 },
      ],
      {
        duration: editorWorkspaceDuration(reduced ? 400 : Math.min(160, popoverMorphMs * motionTokens.motionScale * 0.17), motionTokens),
        delay: editorWorkspaceDuration(reduced ? 160 : Math.min(320, popoverMorphMs * motionTokens.motionScale * 0.34), motionTokens),
        easing: contentEasing || "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "both",
      },
    ) : undefined;
    const animation = node.animate(
      [
        {
          transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`,
          opacity: 0.96,
        },
        {
          transform: "translate(0, 0) scale(1, 1)",
          opacity: 1,
        },
      ],
      {
        duration,
        easing: easing || "cubic-bezier(0.23, 1, 0.32, 1)",
        fill: "both",
      },
    );
    if (!preserveSnapshot) {
      popoverMorphGhostRef.current?.getAnimations().forEach(ghostAnimation => {
        if (ghostAnimation.playState === "paused") ghostAnimation.play();
      });
    }
    popoverMorphRef.current = animation;
    let cleaned = false;
    const cleanupMorphAnimation = () => {
      if (cleaned) return;
      cleaned = true;
      animation.oncancel = null;
      animation.cancel();
      contentAnimation?.cancel();
      if (popoverMorphRef.current === animation) {
        node.style.transform = "";
        node.style.opacity = "";
        node.style.filter = "";
        popoverMorphRef.current = null;
      }
    };
    animation.onfinish = () => {
      if (popoverMorphRef.current !== animation) {
        cleanupMorphAnimation();
        return;
      }
      // Tab geometry bridges finish with the real container. Surface handoffs
      // own a separate outgoing fade, cleaned by its actual finish callback.
      if (!preserveSnapshot) removePopoverMorphGhost();
      node.classList.add("is-morph-settled");
      popoverMorphSettleTimerRef.current = window.setTimeout(() => {
        node.classList.remove("is-morphing");
        popoverMorphSettleTimerRef.current = null;
      }, popoverMorphSettleMs);
      cleanupMorphAnimation();
    };
    animation.oncancel = () => {
      // cancel events are queued. A rapid redirect may already have installed
      // a successor when this callback runs; only its owner may change anchor
      // classes, inline presentation or the successor's settle timer.
      if (popoverMorphRef.current === animation) {
        clearPopoverMorphSettleTimer();
        node.classList.remove("is-morph-settled", "is-morphing");
      }
      cleanupMorphAnimation();
    };
  }, [panelStage, popoverLayoutMode, renderedPanel, primaryTask]);

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function finishClosingPanel() {
    const panel = closingPanelRef.current;
    if (!panel) return;
    closingPanelRef.current = null;
    clearCloseTimer();
    setRenderedPanel((current) => (current === panel ? null : current));
    setPanelStage("closed");
    updatePopoverLayoutMode(false);
  }

  function handlePopoverAnimationEnd(event: ReactAnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget
      || event.animationName !== "workspace-task-exit"
      || panelStage !== "closing") return;
    finishClosingPanel();
  }

  function clearNovelWorkbenchCloseTimer() {
    if (novelWorkbenchCloseTimerRef.current === null) return;
    window.clearTimeout(novelWorkbenchCloseTimerRef.current);
    novelWorkbenchCloseTimerRef.current = null;
  }

  function closePanel(panel = activePanel) {
    if (previewBusyRef.current) return;
    if (!panel) return;
    ++surfaceTokenRef.current;
    surfaceControllerRef.current?.abort();
    displayedSurfaceRef.current = "edit";
    activeSurfaceRef.current = "edit";
    setRequestedSurface("edit");
    setSurfaceLoading(false);
    setSurfaceLoadError(undefined);
    setActiveSurface("edit");
    window.dispatchEvent(new CustomEvent(workspaceSurfaceChangedEventName, { detail: { surface: "edit" } }));
    clearCloseTimer();
    capturePopoverMotionStart("exit");
    capturePopoverRect();
    setRenderedPanel(panel);
    setPanelStage("closing");
    closingPanelRef.current = panel;
    if (!primaryTask) {
      closeTimerRef.current = window.setTimeout(finishClosingPanel, popoverExitMs);
    }
  }

  function togglePanel(panel: ToolbarPanel) {
    if (activePanel === panel) {
      closePanel(panel);
      return;
    }
    clearCloseTimer();
    capturePopoverRect();
    if (panel !== "advanced") updatePopoverLayoutMode(false);
    setRenderedPanel(panel);
    setPanelStage("open");
  }

  function openNovelWorkbench() {
    revealNovelTaskCard(useProjectStore.getState().projectId);
    clearCloseTimer();
    clearNovelWorkbenchCloseTimer();
    popoverMorphRef.current?.cancel();
    setRenderedPanel(null);
    setPanelStage("closed");
    updatePopoverLayoutMode(false);
    setNovelWorkbenchClosing(false);
    setNovelWorkbenchOpen(true);
  }

  async function openSurface(surface: WorkspaceSurface, instant = false, toolsRequest?: AdvancedToolsRequest) {
    if (previewBusyRef.current) return;
    if (surface === activeSurfaceRef.current) {
      if (toolsRequest) setAdvancedRequest(toolsRequest);
      return;
    }
    const sourceSurface = displayedSurfaceRef.current;
    activeSurfaceRef.current = surface;
    surfaceInstantRef.current = instant;
    setRequestedSurface(surface);
    setSurfaceLoadError(undefined);
    const token = ++surfaceTokenRef.current;
    surfaceControllerRef.current?.abort();
    const controller = new AbortController();
    surfaceControllerRef.current = controller;
    if (surface === displayedSurfaceRef.current) {
      setSurfaceLoading(false);
      return;
    }
    const load = surface === "preview" ? loadPreviewWindowControls
      : surface === "publish" ? loadExportCartridgePanel
        : surface === "assistant" ? loadAssistantChatPanel
          : surface === "import" ? loadNovelImportWizard
            : surface === "timeline" ? loadProjectTimelinePanel
              : surface !== "edit" ? loadAdvancedToolsPanel : undefined;
    if (load) {
      setSurfaceLoading(true);
      try {
        await awaitModuleLoad<unknown>(load(), controller.signal);
        if (token !== surfaceTokenRef.current) return;
      } catch (error) {
        if (token !== surfaceTokenRef.current || controller.signal.aborted) return;
        activeSurfaceRef.current = displayedSurfaceRef.current;
        setRequestedSurface(displayedSurfaceRef.current);
        setSurfaceLoading(false);
        setSurfaceLoadError({ surface, message: error instanceof Error ? error.message : "页面载入失败，请重试。" });
        reportFrontendError("editor.workspace", error, { operation: "load-surface", surface });
        return;
      }
    }
    if (token !== surfaceTokenRef.current) return;
    const motionTokens = readEditorMotionTokens();
    popoverMotionTokensRef.current = motionTokens;
    setSurfaceLoading(false);
    displayedSurfaceRef.current = surface;
    clearCloseTimer();
    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
    const shouldMorphSurfaceHandoff = sourceSurface !== "edit"
      && sourceSurface !== "import"
      && surface !== "edit"
      && surface !== "import"
      && visiblePanel !== null;
    if (shouldMorphSurfaceHandoff) {
      capturePopoverRect({ preserveSnapshot: true, motionTokens });
    } else {
      removePopoverMorphGhost();
      previousPopoverRectRef.current = null;
    }
    setPrimaryTask(true);
    if (panelStage === "closing") capturePopoverMotionStart("enter");
    setActiveSurface(surface);
    window.dispatchEvent(new CustomEvent(workspaceSurfaceChangedEventName, { detail: { surface } }));
    if (surface === "edit") {
      if (novelWorkbenchOpen) closeNovelWorkbench();
      if (activePanel) closePanel();
      return;
    }
    if (surface === "preview") {
      updatePopoverLayoutMode(false);
      setRenderedPanel("preview");
      setPanelStage("open");
      return;
    }
    if (surface === "options" || surface === "assets") {
      clearCloseTimer();
      setAdvancedRequest(toolsRequest ?? {
        id: `surface_${surface}_${Date.now()}`,
        tab: "settings",
      });
      updatePopoverLayoutMode(toolsRequest
        ? ["layout", "theme", "assets", "animation"].includes(toolsRequest.tab) : false);
      setRenderedPanel("advanced");
      setPanelStage("open");
      return;
    }
    if (surface === "import") {
      openNovelWorkbench();
      return;
    }
    if (surface === "publish") {
      updatePopoverLayoutMode(false);
      setRenderedPanel("cartridge");
      setPanelStage("open");
      return;
    }
    if (surface === "assistant") {
      updatePopoverLayoutMode(false);
      setRenderedPanel("assistant");
      setPanelStage("open");
      return;
    }
    if (surface === "timeline") {
      togglePanel("timeline");
      return;
    }
    togglePanel("advanced");
  }

  const openSurfaceRef = useRef(openSurface);
  openSurfaceRef.current = openSurface;

  useEffect(() => () => {
    ++surfaceTokenRef.current;
    surfaceControllerRef.current?.abort();
  }, []);

  function closeNovelWorkbench() {
    if (!novelWorkbenchOpen || novelWorkbenchClosing) return;
    // Closing the independent workbench returns to editing. Keeping "import"
    // as the requested/displayed owner makes the next real click a no-op.
    // Do not reset a newer navigation request or steal its focus.
    if (activeSurfaceRef.current === "import") {
      ++surfaceTokenRef.current;
      surfaceControllerRef.current?.abort();
      activeSurfaceRef.current = "edit";
      displayedSurfaceRef.current = "edit";
      setRequestedSurface("edit");
      setActiveSurface("edit");
      setSurfaceLoading(false);
      setSurfaceLoadError(undefined);
      window.dispatchEvent(new CustomEvent(workspaceSurfaceChangedEventName, { detail: { surface: "edit" } }));
      novelImportButtonRef.current?.focus({ preventScroll: true });
    }
    setNovelWorkbenchClosing(true);
    clearNovelWorkbenchCloseTimer();
    const exitMs = novelWorkbenchExitMs;
    novelWorkbenchCloseTimerRef.current = window.setTimeout(() => {
      setNovelWorkbenchOpen(false);
      setNovelWorkbenchClosing(false);
      novelWorkbenchCloseTimerRef.current = null;
    }, exitMs);
  }

  function handleWorkspaceBack(source: BackSource): boolean {
    if (novelWorkbenchOpen) {
      closeNovelWorkbench();
      return true;
    }
    if (activePanel) {
      closePanel();
      return true;
    }
    void source;
    return false;
  }

  function buildCurrentProjectSnapshot() {
    return exportProject({
      projectId: project.projectId,
      title: project.title,
      author: project.author,
      assetManifest: project.assetManifest,
      editorSettings: { ...project.settings },
      createdAt: project.createdAt,
    });
  }

  async function exportPortableProjectFile() {
    if (projectExportBusy) return;
    setProjectExportBusy(true);
    try {
      const saveResult = await workspace.requestSave();
      if (!saveResult.ok) {
        setNotice({
          tone: "warning",
          source: "工作区保存",
          message: saveResult.message ?? "远端保存失败，继续导出本地工程包。",
          reportable: false,
        });
      }
      const currentProject = useProjectStore.getState();
      const exportedProject = exportProject({
        projectId: currentProject.projectId,
        title: currentProject.title,
        author: currentProject.author,
        assetManifest: currentProject.assetManifest,
        editorSettings: { ...currentProject.settings },
        createdAt: currentProject.createdAt,
      });
      const fileName = buildProjectExportFileName(currentProject.title);
      const directory = useEditorPreferencesStore.getState().projectExportDirectories[currentProject.projectId];
      const nativePath = await writeNativeProjectBundle(exportedProject, fileName, directory);
      if (nativePath) {
        setProjectSaveMessage(`工程已保存到：${nativePath}`);
        setNotice(`工程包已保存：${nativePath}`, "success");
      } else {
        const bundle = await buildProjectBundle(exportedProject, (message, completed, total) => {
          setNotice(`${message}（${Math.min(completed, total)}/${total}）`, "info");
        });
        downloadBlob(fileName, bundle);
        setProjectSaveMessage("工程已交由浏览器下载；下载目录由浏览器控制。");
      }
      setProjectSaveConfirmationOpen(true);
      void saveTimelineSnapshot("manual_save").catch((error) => {
        reportFrontendError("editor.timeline", error, {
          operation: "manual-backup",
          projectId: currentProject.projectId,
        });
        setNotice({
          tone: "warning",
          source: "工程备份",
          message: error instanceof Error ? error.message : "保存时间线快照失败。",
          detail: error instanceof Error ? error.stack : undefined,
          action: "便携工程已导出；如需排查备份，请检查 backup-timeline 目录。",
        });
      });
    } catch (error) {
      reportFrontendError("editor.project-export", error, {
        operation: "materialize-portable-assets",
        projectId: project.projectId,
        assetCount: project.assetManifest.length,
      });
      // Tauri rejects Result<_, String> with a string, not an Error instance.
      // Keep the native failure code/path and its recovery instructions.
      const message = error instanceof Error ? error.message
        : typeof error === "string" && error.trim() ? error
          : "无法把素材完整写入工程文件。";
      setNotice({
        tone: "error",
        source: "保存工程",
        message,
        detail: error instanceof Error ? error.stack : undefined,
        action: message.startsWith("PROJECT_EXPORT_DIRECTORY_")
          ? "请检查所示保存目录的写入权限与可用空间，恢复后重试；也可在选项的项目设置中重新选择本工程的保存目录，不会改存到其他目录。"
          : "请确认素材仍可在素材库中预览，然后重新保存；不会再生成缺少素材内容的工程文件。",
      });
    } finally {
      setProjectExportBusy(false);
    }
  }

  async function saveTimelineSnapshot(trigger: string) {
    return await writeProjectBackup(buildCurrentProjectSnapshot(), trigger);
  }

  function autoArrangeCanvas() {
    const result = autoArrangeNodes({ scope: "all" });
    if (result.arrangedNodeIds.length === 0) {
      setNotice("没有可整理的节点。", "info");
      return;
    }
    const focusNodeId = nodes.find((node) => node.data.nodeKind === "start")?.id ?? result.arrangedNodeIds[0];
    window.requestAnimationFrame(() => {
      void reactFlow.fitView({
        nodes: [{ id: focusNodeId }],
        padding: 0.42,
        duration: 420,
      });
    });
    setNotice(
      `已整理画布：移动 ${result.movedCount} 个节点。`,
      result.movedCount > 0 ? "success" : "info",
    );
  }

  async function restoreTimelineProject(nextProject: Parameters<typeof importProject>[0], entry: ProjectBackupEntry) {
    setRestoringEntry(entry);
    let savedProject: Parameters<typeof importProject>[0] = nextProject;
    try {
      savedProject = await backendClient.saveProject(nextProject);
    } catch (error) {
      reportFrontendError("editor.timeline", error, {
        operation: "save-restored-project",
        projectId: nextProject.project_id,
      });
      setNotice(error instanceof Error ? error.message : "Timeline restore failed.", "error");
      setRestoringEntry(undefined);
      return;
    }
    window.requestAnimationFrame(() => {
      try {
        importProject(savedProject);
        project.loadProjectMetadata(savedProject);
        useNovelImportStore.getState().hydratePersistence(savedProject.editor_settings?.novelPersistence as NovelPersistenceState | undefined);
        setNotice(`已恢复 ${new Date(entry.timestamp_ms).toLocaleString()} 的工程快照。`, "success");
        closePanel("timeline");
        window.setTimeout(() => setRestoringEntry(undefined), prefersReducedMotion() ? 320 : 1300);
      } catch (error) {
        reportFrontendError("editor.timeline", error, {
          operation: "apply-restored-project",
          projectId: savedProject.project_id,
        });
        setNotice({
          tone: "error",
          source: "时间线恢复",
          message: error instanceof Error ? error.message : "恢复工程快照失败。",
          detail: error instanceof Error ? error.stack : undefined,
          error,
          action: "请检查备份文件是否完整，或选择其他时间线记录。",
        });
        setRestoringEntry(undefined);
      }
    });
  }

  useEffect(() => {
    if (!activePanel) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      const targetElement = target instanceof Element ? target : target.parentElement;
      if (targetElement?.closest('[data-toolbar-popover-keepopen="true"], .workspace-load-feedback, .rich-select-popover, .color-picker-backdrop, .color-picker-dialog, .animation-template-popover, .asset-picker-popover')) return;
      if (targetElement?.closest(".novel-task-mini-entry, .novel-task-workbench")) return;
      closePanel();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && document.querySelector(".animation-template-popover")) return;
      if (event.key === "Escape") requestBack("escape");
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePanel]);

  useEffect(() => {
    const handleOpenSurface = (event: Event) => {
      const surface = (event as CustomEvent<{ surface?: WorkspaceSurface }>).detail?.surface;
      if (surface) openSurface(surface);
    };
    window.addEventListener(workspaceOpenSurfaceEventName, handleOpenSurface);
    return () => window.removeEventListener(workspaceOpenSurfaceEventName, handleOpenSurface);
  }, [activePanel, novelWorkbenchOpen, primaryTask]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      const customEvent = event as CustomEvent<{ source?: BackSource; handled?: boolean }>;
      if (!handleWorkspaceBack(customEvent.detail?.source ?? "system")) return;
      if (customEvent.detail) customEvent.detail.handled = true;
      event.preventDefault();
    };
    window.addEventListener(workspaceBackEventName, handleBack);
    return () => window.removeEventListener(workspaceBackEventName, handleBack);
  }, [activePanel, novelWorkbenchOpen, novelWorkbenchClosing]);

  useEffect(() => {
    const pendingFocus = new Set<() => void>();
    function handleFocusCanvasNode(event: Event) {
      const detail = (event as FocusCanvasNodeEvent).detail;
      const requestedIds = detail?.nodeIds?.length ? detail.nodeIds : detail?.nodeId ? [detail.nodeId] : [];
      const store = useEditorStore.getState();
      const nodeIds = requestedIds.filter((id) => store.nodes.some((node) => node.id === id));
      if (nodeIds.length === 0) { detail?.focusRequest?.resolve(false); return; }
      if (detail?.focusRequest) {
        const request = detail.focusRequest;
        let frame: number | undefined;
        let settled = false;
        const finish = (focused: boolean) => {
          if (settled) return;
          settled = true;
          if (frame !== undefined) window.cancelAnimationFrame(frame);
          request.signal.removeEventListener("abort", abort);
          pendingFocus.delete(abort);
          request.resolve(focused);
        };
        const abort = () => finish(false);
        const current = () => !settled && !request.signal.aborted && request.isCurrent();
        pendingFocus.add(abort);
        request.signal.addEventListener("abort", abort, { once: true });
        if (!current()) { finish(false); return; }
        const node = store.nodes.find(item => item.id === nodeIds[0])!;
        const measured = node.measured as { width?: number; height?: number } | undefined;
        const checkRendered = () => {
          if (!current()) { finish(false); return; }
          const target = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
          const flow = target?.closest<HTMLElement>(".flow-surface");
          const rect = target?.getBoundingClientRect();
          const bounds = flow?.getBoundingClientRect();
          if (target && flow && rect && bounds && !target.closest("[inert]")
            && !document.querySelector('[aria-modal="true"]')
            && rect.width > 0 && rect.height > 0
            && rect.right > bounds.left && rect.left < bounds.right
            && rect.bottom > bounds.top && rect.top < bounds.bottom) {
            target.focus({ preventScroll: true });
            if (document.activeElement === target) { finish(true); return; }
          }
          frame = window.requestAnimationFrame(checkRendered);
        };
        void reactFlow.setCenter(
          node.position.x + (measured?.width ?? 300) / 2,
          node.position.y + (measured?.height ?? 180) / 2,
          { zoom: detail.zoom ?? .82, duration: 0 },
        ).then(() => {
          if (!current()) { finish(false); return; }
          frame = window.requestAnimationFrame(checkRendered);
        }).catch(error => {
          reportFrontendError("editor.canvas-focus", error, { operation: "focus-task-result", nodeId: node.id });
          finish(false);
        });
        return;
      }
      if (detail?.select !== false) store.selectNode(nodeIds[0]);
      window.requestAnimationFrame(() => {
        if (nodeIds.length > 1) {
          void reactFlow.fitView({
            nodes: nodeIds.map((id) => ({ id })),
            padding: detail?.padding ?? 0.32,
            duration: detail?.duration ?? 180,
          });
          return;
        }
        let attempts = 0;
        const focus = () => {
          const current = useEditorStore.getState().nodes.find((node) => node.id === nodeIds[0]);
          if (!current && attempts++ < 375) {
            window.setTimeout(focus, 32);
            return;
          }
          if (!current) return;
          const measured = current.measured as { width?: number; height?: number } | undefined;
          const centerX = current.position.x + (measured?.width ?? 300) / 2;
          const centerY = current.position.y + (measured?.height ?? 180) / 2;
           void reactFlow.setCenter(centerX, centerY, {
             zoom: detail?.zoom ?? 0.82,
             duration: detail?.duration ?? 180,
           });
           if (attempts++ < 375) {
             window.setTimeout(() => {
               const rendered = document.querySelector(
                 `.react-flow__node[data-id="${CSS.escape(nodeIds[0])}"]`,
               );
               if (!(rendered instanceof HTMLElement)) {
                 focus();
                 return;
               }
               const rect = rendered.getBoundingClientRect();
               const visible = rect.width > 0
                 && rect.height > 0
                 && rect.right > 0
                 && rect.bottom > 0
                 && rect.left < window.innerWidth
                 && rect.top < window.innerHeight;
               if (!visible) focus();
             }, 48);
           }
        };
        // Large route imports are appended in idle batches. Wait for the
        // requested node instead of dropping the focus event during import.
        window.requestAnimationFrame(focus);
      });
    }

    window.addEventListener(canvasNodeFocusEventName, handleFocusCanvasNode);
    return () => {
      window.removeEventListener(canvasNodeFocusEventName, handleFocusCanvasNode);
      for (const abort of pendingFocus) abort();
    };
  }, [reactFlow]);

  useEffect(() => () => {
    clearCloseTimer();
    clearNovelWorkbenchCloseTimer();
    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
    removePopoverMorphGhost();
    closingPanelRef.current = null;
  }, []);

  useEffect(() => {
    if (!novelWorkbenchOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") requestBack("escape");
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [novelWorkbenchOpen, novelWorkbenchClosing]);

  useLayoutEffect(() => {
    if (!novelWorkbenchOpen || novelWorkbenchClosing) return;
    novelWorkbenchRef.current?.querySelector<HTMLButtonElement>(
      '[data-help-key="toolbar.novelImport.closeWorkbench"]',
    )?.focus({ preventScroll: true });
  }, [novelWorkbenchOpen, novelWorkbenchClosing]);

  useEffect(() => {
    function handleAdvancedRequest(event: Event) {
      if (previewBusyRef.current) return;
      const detail = (event as CustomEvent<AdvancedToolsRequest>).detail;
      if (!detail) return;
      if (detail.workspaceNavigation) {
        void openSurfaceRef.current(detail.tab === "novel" ? "import" : "options", false, detail);
        return;
      }
      popoverMotionTokensRef.current = readEditorMotionTokens();
      clearCloseTimer();
      if (detail.tab === "novel") {
        setAdvancedRequest(undefined);
        updatePopoverLayoutMode(false);
        setRenderedPanel(null);
        setPanelStage("closed");
        openNovelWorkbench();
        return;
      }
      setAdvancedRequest(detail);
      updatePopoverLayoutMode(["layout", "theme", "assets", "animation"].includes(detail.tab));
      setRenderedPanel("advanced");
      setPanelStage("open");
    }

    window.addEventListener(advancedToolsEventName, handleAdvancedRequest);
    return () => window.removeEventListener(advancedToolsEventName, handleAdvancedRequest);
  }, []);

  const toolbarPopover = visiblePanel ? (
    <div className={popoverClassName} ref={popoverRef} onAnimationEnd={handlePopoverAnimationEnd}
      inert={surfaceLoading || panelStage === "closing"}
      data-workspace-task={primaryTask ? activeSurface : undefined}>
      <Suspense fallback={<ToolbarPanelLoading panel={visiblePanel} />}>
        <LoadedToolbarPanelTransition
          panelKey={visiblePanel}
          onEntered={() => setPopoverEntryComplete(true)}
          motionTokens={popoverMotionTokensRef.current!}
        >
          {visiblePanel === "preview" ? (
            <PreviewWindowControls
              sessionRef={previewSessionRef}
              onBusyChange={(busy) => { previewBusyRef.current = busy; }}
              onBack={() => closePanel("preview")}
            />
          ) : visiblePanel === "cartridge" ? (
            <ExportCartridgePanel onClose={() => closePanel("cartridge")} />
          ) : visiblePanel === "assistant" ? (
            <AssistantChatPanel onOpenCreationWorkbench={() => {
              creationWorkbenchReturnFocusRef.current = document.activeElement instanceof HTMLElement
                ? document.activeElement : null;
              setCreationRecoveryConversationId(undefined);
              setCreationWorkbenchOpenRequest(request => request + 1);
              setCreationWorkbenchOpen(true);
              closePanel("assistant");
            }} />
          ) : visiblePanel === "timeline" ? (
            <ProjectTimelinePanel onRestore={restoreTimelineProject} />
          ) : (
            <AdvancedToolsPanel request={advancedRequest} onLayoutModeChange={setAdvancedLayoutMode} />
          )}
        </LoadedToolbarPanelTransition>
      </Suspense>
    </div>
  ) : null;

  return (
    <header className="editor-toolbar" ref={toolbarRef}>
      <div className="toolbar-inner">
        <div className="toolbar-brand">
          <strong>AgentVN</strong>
        </div>

        <button type="button" className="toolbar-home-button" data-help-key="toolbar.home" onClick={() => {
          if (!previewBusyRef.current) onReturnHome();
        }}>
          <Home size={16} />
          返回首页
        </button>

        <GlassSelectionGroup
          as="nav"
          motion="light"
          className="workspace-surface-nav"
          testId="workspace-surface-nav"
          ariaLabel="编辑器工作区"
          selectedKey={requestedSurface}
        >
          <button data-help-key="editor.control"
            type="button"
            className={requestedSurface === "edit" ? "is-active" : ""}
            aria-current={requestedSurface === "edit" ? "page" : undefined}
            data-glass-selected={requestedSurface === "edit"}
            data-workspace-surface="edit"
            onClick={(event) => void openSurface("edit", event.detail === 0)}
          >
            <GitBranch size={17} />
            编辑
          </button>
          <button data-help-key="editor.control"
            type="button"
            className={requestedSurface === "options" ? "is-active" : ""}
            aria-current={requestedSurface === "options" ? "page" : undefined}
            data-glass-selected={requestedSurface === "options"}
            data-workspace-surface="options"
            onClick={(event) => void openSurface("options", event.detail === 0)}
          >
            <Images size={17} />
            选项
          </button>
          <button data-help-key="editor.control"
            type="button"
            className={requestedSurface === "assistant" ? "is-active" : ""}
            aria-current={requestedSurface === "assistant" ? "page" : undefined}
            data-glass-selected={requestedSurface === "assistant"}
            data-workspace-surface="assistant"
            onClick={(event) => void openSurface("assistant", event.detail === 0)}
          >
            <Bot size={17} />
            AI
          </button>
          <button data-help-key="editor.control"
            type="button"
            className={requestedSurface === "preview" ? "is-active" : ""}
            aria-current={requestedSurface === "preview" ? "page" : undefined}
            data-glass-selected={requestedSurface === "preview"}
            data-workspace-surface="preview"
            onClick={(event) => void openSurface("preview", event.detail === 0)}
          >
            <Eye size={17} />
            预览
          </button>
          <button data-help-key="editor.control"
            type="button"
            className={requestedSurface === "publish" ? "is-active" : ""}
            aria-current={requestedSurface === "publish" ? "page" : undefined}
            data-glass-selected={requestedSurface === "publish"}
            data-workspace-surface="publish"
            onClick={(event) => void openSurface("publish", event.detail === 0)}
          >
            <Radio size={17} />
            发布
          </button>
        </GlassSelectionGroup>

        <div className="toolbar-group toolbar-project-group" data-testid="workspace-project-actions">
          <button
            ref={saveProjectButtonRef}
            type="button"
            data-help-key="toolbar.saveProject"
            onClick={() => void exportPortableProjectFile()}
            disabled={projectExportBusy}
          >
            <Save size={16} />
            {projectExportBusy ? "正在打包素材…" : "保存工程"}
          </button>

          <button
            ref={novelImportButtonRef}
            type="button"
            aria-expanded={novelWorkbenchOpen && !novelWorkbenchClosing}
            aria-controls="novel-import-workbench"
            data-help-key="toolbar.novelImport"
            onClick={() => void openSurface("import")}
          >
            <BookOpen size={16} />
            小说导入
          </button>

          <label className="file-button" data-help-key="toolbar.importProject">
            <FileInput size={16} />
            导入工程
            <input data-help-key="editor.control"
              type="file"
              accept=".vnproj,.json"
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = event.target.files?.[0];
                if (!file) return;

                const result = await parseProjectFile(file);
                if (!result.project) {
                  setNotice({
                    tone: "error",
                    source: "工程导入",
                    message: result.error ?? "导入失败。",
                    action: "请选择有效的 AgentVN 工程文件（.vnproj 或 .json）。",
                  });
                  input.value = "";
                  return;
                }

                const importResult = importProjectAsRoute(result.project);
                if (result.project.asset_manifest.length > 0) {
                  project.setAssetManifest(mergeAssetManifest(project.assetManifest, result.project.asset_manifest));
                }

                if (importResult.nodes > 0) {
                  const largeImport = importResult.nodes > 80;
                  scheduleCanvasViewportWork(() => {
                    void reactFlow.fitView({
                      nodes: importResult.selectedNodeId ? [{ id: importResult.selectedNodeId }] : undefined,
                      padding: 0.36,
                      duration: largeImport ? 0 : 420,
                    });
                  }, { delayMs: largeImport ? 3000 : 0, idleTimeoutMs: largeImport ? 1200 : 500 });
                  setNotice({
                    tone: "success",
                    source: "项目路线导入",
                    message: "已导入独立线路：" + importResult.nodes + " 个节点 / " + importResult.edges + " 条内部连线。",
                    action: "新线路已放在画布右侧，不会自动连接到入口；需要启用时请手动连线。",
                  });
                } else {
                  setNotice({
                    tone: "info",
                    source: "项目路线导入",
                    message: "导入文件中没有可追加的节点。",
                    action: "请检查工程内容，或使用首页导入来替换当前工程。",
                  });
                }

                input.value = "";
              }}
            />
          </label>

          <button
            type="button"
            data-help-key="toolbar.exportCartridge"
            aria-expanded={activePanel === "cartridge"}
            onClick={() => openSurface("publish")}
          >
            <GitBranch size={16} />
            打包与发布
          </button>

          <button
            type="button"
            className="toolbar-arrange-button"
            data-help-key="toolbar.autoArrange"
            onClick={autoArrangeCanvas}
          >
            整理画布
          </button>
          <button
            type="button"
            className="toolbar-secondary-action"
            data-help-key="toolbar.advanced"
            aria-expanded={activePanel === "advanced"}
            onClick={() => openSurface("advanced")}
          >
            <Sparkles size={16} />
            设置
          </button>
        </div>

        <div className="toolbar-group toolbar-right toolbar-tools-group">
          <section
            className={"toolbar-tool-container toolbar-ai-tools ai-glow-surface ai-flow-border" + (aiToolsActive ? " ai-flow-active" : "")}
            aria-label="AI 工具"
          >
            <span className="toolbar-container-label">AI 工具</span>
          <GlassSelectionGroup motion="light" className="toolbar-container-actions" selectedKey={activePanel === "assistant" ? "assistant" : novelWorkbenchOpen ? "novel" : ""} scrollAxis="x">
              <button
                type="button"
                className={"ai-glow-button" + (activePanel === "assistant" ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "assistant"}
                data-glass-selected={activePanel === "assistant"}
                data-help-key="toolbar.assistant"
                onClick={() => openSurface("assistant")}
              >
                <Bot size={16} />
                AI 助手
              </button>
            </GlassSelectionGroup>
          </section>

          <section
            className={"toolbar-tool-container toolbar-settings-tools ai-glow-surface ai-flow-border" + (settingsToolsActive ? " ai-flow-active" : "")}
            aria-label="工具 / 设置"
          >
            <span className="toolbar-container-label">工具 / 设置</span>
            <GlassSelectionGroup className="toolbar-container-actions" selectedKey={settingsToolsActive ? "advanced" : ""} scrollAxis="x">
              <button
                type="button"
                className={"ai-glow-button" + (settingsToolsActive ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "advanced"}
                data-glass-selected={settingsToolsActive}
                data-help-key="toolbar.advanced"
                onClick={() => openSurface("advanced")}
              >
                <Sparkles size={16} />
                工具 / 设置
              </button>
            </GlassSelectionGroup>
          </section>

          <section
            className={"toolbar-tool-container toolbar-timeline-tools ai-glow-surface ai-flow-border" + (timelineToolsActive ? " ai-flow-active" : "")}
            aria-label="时间线"
          >
            <span className="toolbar-container-label">时间线</span>
            <GlassSelectionGroup className="toolbar-container-actions" selectedKey={timelineToolsActive ? "timeline" : ""} scrollAxis="x">
              <button
                type="button"
                className={"ai-glow-button" + (timelineToolsActive ? " ai-flow-active" : "")}
                aria-expanded={activePanel === "timeline"}
                data-glass-selected={timelineToolsActive}
                data-help-key="toolbar.timeline"
                onClick={() => openSurface("timeline")}
              >
                <Clock3 size={16} />
                历史记录
              </button>
            </GlassSelectionGroup>
          </section>


          <MemoryModeSelector compact value={memoryMode} onChange={(mode) => updateMemoryMode(mode)} />
          <ThemeToneSelector />
          <Radio size={16} className="status-dot" />
        </div>
      </div>

      {(surfaceLoading || surfaceLoadError) && createPortal(
        <div className="workspace-load-feedback" role={surfaceLoadError ? "alert" : "status"}>
          <span>{surfaceLoadError?.message ?? `正在载入${workspaceSurfaceLabels[requestedSurface]}，原页面已保留…`}</span>
          {surfaceLoadError && <button type="button" onClick={() => void openSurface(surfaceLoadError.surface)}>重试载入工作区</button>}
        </div>, document.body)}
      {(primaryTask || visiblePanel === "cartridge" || (visiblePanel === "advanced" && portalAdvancedPopover)) && toolbarPopover
        ? createPortal(toolbarPopover, document.body)
        : toolbarPopover}

      {creationWorkbenchOpen && (
        <AssistantCreationWorkbenchWindow recoveryConversationId={creationRecoveryConversationId}
          openRequestId={creationWorkbenchOpenRequest}
          returnFocusTarget={creationWorkbenchReturnFocusRef.current}
          fallbackFocusTarget={() => toolbarRef.current?.querySelector<HTMLElement>(
            '[data-workspace-surface="assistant"]',
          ) ?? null}
          onClose={() => { setCreationWorkbenchOpen(false); setCreationRecoveryConversationId(undefined); }} />
      )}

      {novelWorkbenchOpen && createPortal((
        <div
          className={"novel-import-workbench-backdrop" + (novelWorkbenchClosing ? " is-closing" : "")}
          role="presentation"
          onMouseDown={closeNovelWorkbench}
        >
          <section
            ref={novelWorkbenchRef}
            id="novel-import-workbench"
            className={"novel-import-workbench-dialog" + (novelWorkbenchClosing ? " is-closing" : "")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="novel-import-workbench-title"
            data-testid="novel-import-workbench"
            inert={novelWorkbenchClosing}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="novel-import-workbench-header">
              <div>
                <span className="toolbar-container-label">AI 工具</span>
                <h3 id="novel-import-workbench-title">小说导入工作台</h3>
                <p>解析长篇文本，生成可编辑的剧情节点与线路草稿。</p>
              </div>
              <button type="button" className="studio-icon-button" data-help-key="toolbar.novelImport.closeWorkbench" aria-label="关闭小说导入工作台" onClick={closeNovelWorkbench}>
                <X size={18} />
              </button>
            </header>
            <div className="novel-import-workbench-body">
              <Suspense fallback={<NovelWorkbenchLoading />}>
                <section className="advanced-tools-panel layout-mode novel-tool-frame is-tab-idle">
                  <div className="advanced-tab-viewport">
                    <div className="advanced-tab-content" data-tab="novel">
                      <NovelImportWizard />
                    </div>
                  </div>
                </section>
              </Suspense>
            </div>
          </section>
        </div>
      ), document.body)}

      <OperationResultDialog
        open={projectSaveConfirmationOpen}
        tone="success"
        surfaceTone="accent"
        label="保存成功"
        title="工程已导出"
        message={projectSaveMessage}
        icon={<Save size={20} />}
        confirmLabel="OK"
        testId="project-save-confirmation"
        closeAriaLabel="关闭保存成功提示"
        returnFocusRef={saveProjectButtonRef}
        onDismiss={() => setProjectSaveConfirmationOpen(false)}
      />

      {restoringEntry && (
        <div className="timeline-restore-toast" role="status" aria-live="polite">
          <span>
            <strong>正在恢复时间线</strong>
            <RoseTwoLoader particleCount={42} />
          </span>
          <div>
            <strong>{new Date(restoringEntry.timestamp_ms).toLocaleString()}</strong>
            <span>工程快照恢复中，请稍候。</span>
          </div>
        </div>
      )}
    </header>
  );
}
