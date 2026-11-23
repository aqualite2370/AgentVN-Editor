import { useReactFlow } from "@xyflow/react";
import { BookOpen, Bot, Eye, GitBranch, Home, Images, Radio, Save, Sparkles, X } from "lucide-react";
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
import { RoseTwoLoader } from "../common/RoseTwoLoader";
import { GlassSelectionGroup } from "../common/GlassSelectionGroup";
import { OperationResultDialog } from "../common/OperationResultDialog";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import { buildProjectExportFileName } from "../../utils/fileNames";
import { buildProjectBundle, writeNativeProjectBundle } from "../../utils/projectBundle";
import { useEditorPreferencesStore } from "../../store/editorPreferencesStore";
import { writeProjectBackup } from "../../utils/projectTimeline";
import { advancedToolsEventName, type AdvancedToolsRequest, type AdvancedToolsTab } from "../advanced/advancedToolsBridge";
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
import { createEditorContainerMorph, visibleMorphRect } from "../../utils/editorContainerMorph";

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

const popoverExitMs = 640;
const novelWorkbenchExitMs = 440;
const popoverMorphMs = 960;
const reducedPopoverMorphMs = 640;
const reducedSurfacePresentationMs = 480;
const surfacePresentationMs = 800;
const popoverMorphSettleMs = 80;
type ToolbarPanel = "cartridge" | "advanced" | "assistant" | "timeline" | "preview";
type ToolbarPanelStage = "closed" | "open" | "closing";
type AdvancedLayoutModeOptions = { animate?: boolean; motionTokens?: EditorMotionTokens; tab?: AdvancedToolsTab };
type OptionsBoundaryMotion = { direction: "enter" | "exit"; rect: DOMRect; contentOpacity: number };
const desktopOptionsQuery = "(min-width: 1440px) and (min-height: 900px)";
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
  preview: "独立游戏预览",
};
const workspaceSurfaceLabels: Record<WorkspaceSurface, string> = {
  edit: "编辑", options: "选项", assistant: "AI 助手", preview: "独立预览",
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
  geometryHandoff,
}: {
  children: ReactNode;
  panelKey: ToolbarPanel;
  onEntered: () => void;
  motionTokens: EditorMotionTokens;
  geometryHandoff: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onEnteredRef = useRef(onEntered);
  onEnteredRef.current = onEntered;

  useLayoutEffect(() => {
    // The envelope owns this handoff's single content clock. Starting another
    // fade here would expose the target behind a still-readable source page.
    if (geometryHandoff) return;
    const target = hostRef.current;
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

export function EditorToolbar({ onReturnHome, onWorkspaceActiveChange }: {
  onReturnHome: () => void;
  onWorkspaceActiveChange?: (active: boolean) => void;
}) {
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
  const exportProject = useEditorStore((state) => state.exportProject);
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
  const optionsTriggerRef = useRef<HTMLButtonElement>(null);
  const [optionsPage, setOptionsPage] = useState<AdvancedToolsTab>("settings");
  const optionsPageRef = useRef<AdvancedToolsTab>("settings");
  const optionsBoundaryMotionRef = useRef<OptionsBoundaryMotion | null>(null);
  const workspaceInertOwnerRef = useRef<{ node: HTMLElement; original: boolean } | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingPanelRef = useRef<ToolbarPanel | null>(null);
  const previousPopoverRectRef = useRef<DOMRect | null>(null);
  const popoverMotionTokensRef = useRef<EditorMotionTokens | null>(null);
  const popoverMorphRef = useRef<Animation | null>(null);
  const popoverEnvelopeRef = useRef<ReturnType<typeof createEditorContainerMorph> | null>(null);
  const popoverMorphGhostRef = useRef<HTMLElement | null>(null);
  const popoverRetiringGhostsRef = useRef(new Set<HTMLElement>());
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
  const popoverClassName = `toolbar-popover${primaryTask ? " workspace-task-panel" : ""}${visiblePanel === "preview" ? " preview" : ""}${visiblePanel === "cartridge" ? " cartridge" : ""}${visiblePanel === "advanced" ? " advanced" : ""}${visiblePanel === "assistant" ? " assistant" : ""}${visiblePanel === "timeline" ? " timeline" : ""}${popoverLayoutModeRef.current && visiblePanel === "advanced" ? " is-layout-mode" : ""}${popoverMorphRef.current ? " is-morphing" : ""}${popoverEnvelopeRef.current ? " has-container-morph" : ""}${popoverEntryComplete ? " is-entered" : ""}${panelStage === "open" ? " is-open" : ""}${panelStage === "closing" ? " is-closing" : ""}`;
  const aiToolsActive = activePanel === "assistant" || novelWorkbenchOpen;
  const settingsToolsActive = activePanel === "advanced";

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
      alignOptionsNavigation();
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
    onWorkspaceActiveChange?.(!nextInert);
  }, [surfaceLoading, activeSurface, onWorkspaceActiveChange]);

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
    for (const ghost of [...popoverRetiringGhostsRef.current, popoverMorphGhostRef.current]) {
      ghost?.getAnimations().forEach(animation => {
        animation.onfinish = null;
        animation.cancel();
      });
      ghost?.remove();
    }
    popoverRetiringGhostsRef.current.clear();
    popoverMorphGhostRef.current = null;
  }

  function playPopoverGhosts() {
    for (const ghost of [...popoverRetiringGhostsRef.current, popoverMorphGhostRef.current]) {
      ghost?.getAnimations().forEach(animation => {
        if (animation.playState === "paused") animation.play();
      });
    }
  }

  function capturePopoverMotionStart(direction: "enter" | "exit") {
    const node = popoverRef.current;
    if (!node) return;
    const style = getComputedStyle(node);
    node.style.setProperty(`--workspace-task-${direction}-start-opacity`, style.opacity);
    node.style.setProperty(`--workspace-task-${direction}-start-transform`, style.transform);
  }

  function captureOptionsBoundaryMotion(direction: "enter" | "exit", fallback: DOMRect) {
    const node = popoverRef.current;
    const content = node?.querySelector<HTMLElement>(".toolbar-panel-presentation-layer");
    optionsBoundaryMotionRef.current = {
      direction,
      rect: popoverEnvelopeRef.current ? visibleMorphRect(popoverEnvelopeRef.current.shell) : fallback,
      contentOpacity: content ? Number(getComputedStyle(content).opacity) : 0,
    };
  }

  function capturePopoverRect(options: {
    preserveSnapshot?: boolean;
    pauseUntilMorph?: boolean;
    motionTokens?: EditorMotionTokens;
  } = {}) {
    const motionTokens = options.motionTokens ?? readEditorMotionTokens();
    popoverMotionTokensRef.current = motionTokens;
    const node = popoverRef.current;
    previousPopoverRectRef.current = popoverEnvelopeRef.current
      ? visibleMorphRect(popoverEnvelopeRef.current.shell) : node ? node.getBoundingClientRect() : null;
    // A redirect captures the pixels already being presented. Do not drop a
    // still-visible outgoing layer just because the new target is not opaque.
    popoverMorphBridgedContentRef.current?.removeAttribute("data-geometry-snapshot-owner");
    popoverMorphBridgedContentRef.current = null;
    for (const ghost of [...popoverRetiringGhostsRef.current, popoverMorphGhostRef.current]) {
      if (!ghost) continue;
      const opacity = Number(getComputedStyle(ghost).opacity);
      ghost.getAnimations().forEach(animation => { animation.onfinish = null; animation.cancel(); });
      if (opacity < 0.003) {
        ghost.remove();
        popoverRetiringGhostsRef.current.delete(ghost);
      } else {
        ghost.style.opacity = String(opacity);
        popoverRetiringGhostsRef.current.add(ghost);
      }
    }
    popoverMorphGhostRef.current = null;
    retainPopoverMorphGhostRef.current = Boolean(options.preserveSnapshot);
    if (!node || !previousPopoverRectRef.current) {
      retainPopoverMorphGhostRef.current = false;
      removePopoverMorphGhost();
      return;
    }

    // A snapshot keeps natural destination dimensions, never a stretched copy
    // of the envelope's intermediate width.
    const rect = node.getBoundingClientRect();
    const visibleRect = previousPopoverRectRef.current;
    const liveContent = node.querySelector<HTMLElement>(options.preserveSnapshot
      ? ".toolbar-panel-presentation-layer" : ".advanced-tab-viewport");
    const liveContentOpacity = liveContent ? getComputedStyle(liveContent).opacity : "1";
    const liveBackground = getComputedStyle(node).background;
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
    ghost.classList.remove("has-container-morph");
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
    ghost.style.background = liveBackground;
    ghost.style.clipPath = `inset(${Math.max(0, visibleRect.top - rect.top)}px ${Math.max(0, rect.right - visibleRect.right)}px ${Math.max(0, rect.bottom - visibleRect.bottom)}px ${Math.max(0, visibleRect.left - rect.left)}px)`;
    const frozenContent = ghost.querySelector<HTMLElement>(options.preserveSnapshot
      ? ".toolbar-panel-presentation-layer" : ".advanced-tab-viewport");
    if (frozenContent instanceof HTMLElement) frozenContent.style.opacity = liveContentOpacity;
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

    const duration = editorWorkspaceDuration(prefersReducedMotion()
      ? reducedPopoverMorphMs : popoverMorphMs * motionTokens.motionScale, motionTokens);
    for (const layer of [...popoverRetiringGhostsRef.current, ghost]) {
      const startOpacity = Number(getComputedStyle(layer).opacity);
      const fade = layer.animate([
        { opacity: startOpacity }, { opacity: 0, offset: 0.42 }, { opacity: 0 },
      ], { duration, easing: motionTokens.containerEasing, fill: "both" });
      if (options.pauseUntilMorph) fade.pause();
      fade.onfinish = () => {
        if (popoverMorphGhostRef.current === layer) removePopoverMorphGhost();
        else { layer.remove(); popoverRetiringGhostsRef.current.delete(layer); }
      };
    }
  }

  function clearPopoverMorphSettleTimer() {
    if (popoverMorphSettleTimerRef.current === null) return;
    window.clearTimeout(popoverMorphSettleTimerRef.current);
    popoverMorphSettleTimerRef.current = null;
  }

  function alignOptionsNavigation() {
    const node = popoverRef.current;
    const nav = node?.querySelector<HTMLElement>(".advanced-tools-panel > nav");
    if (!node || !nav) return;
    nav.style.marginInlineStart = "";
    if (window.matchMedia(desktopOptionsQuery).matches) return;
    if (window.innerWidth < 901 || window.innerHeight < 481) return;
    if (!node.classList.contains("is-layout-mode")) return;
    // Measure the compact CSS endpoint in this same layout commit. Its fixed
    // containing block and scrollbar gutter differ from the wide desk's;
    // projecting from viewport coordinates moves the targets by one gutter.
    // Restore the wide class before paint; contents never render at this size.
    node.classList.remove("is-layout-mode");
    const left = nav.getBoundingClientRect().left;
    node.classList.add("is-layout-mode");
    nav.style.marginInlineStart = `${Math.max(0, left - nav.getBoundingClientRect().left)}px`;
  }

  function setAdvancedLayoutMode(nextLayoutMode: boolean, options: AdvancedLayoutModeOptions = {}): number {
    const nextTab = options.tab;
    const pageChanged = nextTab !== undefined && optionsPageRef.current !== nextTab;
    const modeChanged = popoverLayoutModeRef.current !== nextLayoutMode;
    if (!modeChanged && !pageChanged) return 0;
    if (panelStage !== "open") return 0;
    const animate = options.animate !== false && (modeChanged || primaryTask && window.matchMedia(desktopOptionsQuery).matches);
    const motionTokens = options.motionTokens ?? readEditorMotionTokens();
    if (animate) {
      capturePopoverRect({ motionTokens, pauseUntilMorph: true });
    } else if (modeChanged) {
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
    }
    if (nextTab) {
      optionsPageRef.current = nextTab;
      setOptionsPage(nextTab);
    }
    popoverLayoutModeRef.current = nextLayoutMode;
    setPopoverLayoutMode(nextLayoutMode);
    const duration = editorWorkspaceDuration(prefersReducedMotion()
      ? reducedPopoverMorphMs
      : popoverMorphMs * motionTokens.motionScale, motionTokens);
    return animate ? duration : 0;
  }

  function updatePopoverLayoutMode(nextLayoutMode: boolean) {
    popoverLayoutModeRef.current = nextLayoutMode;
    setPopoverLayoutMode(nextLayoutMode);
  }

  useLayoutEffect(() => {
    alignOptionsNavigation();
    const trigger = optionsTriggerRef.current;
    const boundary = optionsBoundaryMotionRef.current;
    const exiting = panelStage === "closing" && boundary?.direction === "exit" && trigger !== null;
    const entering = panelStage === "open" && boundary?.direction === "enter";
    const previousRect = (exiting || entering ? boundary?.rect : previousPopoverRectRef.current) ?? null;
    const preserveSnapshot = retainPopoverMorphGhostRef.current;
    const node = popoverRef.current;
    optionsBoundaryMotionRef.current = null;
    previousPopoverRectRef.current = null;
    retainPopoverMorphGhostRef.current = false;
    if (!previousRect || !node || (panelStage !== "open" && !exiting)) return;

    // previousRect already captured the current on-screen presentation.
    // Measure the destination only after cancelling the previous effect;
    // otherwise a redirect measures a destination still scaled/translated by
    // that effect, and applying the new FLIP would compound both geometries.
    clearPopoverMorphSettleTimer();
    popoverMorphRef.current?.cancel();
    popoverMorphRef.current = null;
    popoverEnvelopeRef.current?.cleanup();
    popoverEnvelopeRef.current = null;
    node.classList.remove("is-morphing", "is-morph-settled");
    const reduced = prefersReducedMotion();
    const liveRect = node.getBoundingClientRect();
    const nextRect = exiting ? trigger.getBoundingClientRect() : liveRect;
    const fullDeltaX = previousRect.left - nextRect.left;
    const fullDeltaY = previousRect.top - nextRect.top;
    const fullScaleX = previousRect.width / Math.max(nextRect.width, 1);
    const fullScaleY = previousRect.height / Math.max(nextRect.height, 1);
    const sizeMorph = Math.abs(fullScaleX - 1) > 0.08 || Math.abs(fullScaleY - 1) > 0.08;
    const moved = Math.abs(fullDeltaX) > 1
      || Math.abs(fullDeltaY) > 1
      || Math.abs(fullScaleX - 1) > 0.01
      || Math.abs(fullScaleY - 1) > 0.01;
    if (!moved && !preserveSnapshot && !exiting && !entering) {
      // Narrow layouts can share the same outer rectangle for regular and
      // wide tabs. Their content already has its own crossfade; a geometry
      // snapshot would duplicate that content without any morph to own it.
      // Surface handoffs explicitly retain their snapshot as a visual bridge.
      if (!preserveSnapshot) removePopoverMorphGhost();
      return;
    }
    if (!sizeMorph && !preserveSnapshot) removePopoverMorphGhost();

    // Both endpoints use the measured workbench bounds. Only the separate
    // envelope changes geometry; content retains its final natural scale.
    node.classList.add("is-morphing");
    const motionTokens = popoverMotionTokensRef.current ?? readEditorMotionTokens();
    const nominalDuration = exiting || entering
      ? (reduced ? reducedSurfacePresentationMs : surfacePresentationMs)
      : (reduced ? reducedPopoverMorphMs : popoverMorphMs);
    const duration = editorWorkspaceDuration(nominalDuration * (reduced ? 1 : motionTokens.motionScale), motionTokens);
    if (duration <= 0) {
      node.classList.remove("is-morphing");
      removePopoverMorphGhost();
      if (exiting) finishClosingPanel();
      else setPopoverEntryComplete(true);
      return;
    }
    const easing = motionTokens.containerEasing;
    const content = node.querySelector<HTMLElement>(preserveSnapshot || entering || exiting
      ? ".toolbar-panel-presentation-layer" : ".advanced-tab-viewport");
    const contentAnimation = exiting ? content?.animate(
      [{ opacity: boundary.contentOpacity }, { opacity: 0, offset: .55 }, { opacity: 0 }],
      { duration, easing, fill: "both" },
    ) : sizeMorph || preserveSnapshot || entering ? content?.animate(
      [
        { opacity: entering ? boundary.contentOpacity : 0, transform: entering || reduced ? "none" : "translateY(4px)" },
        { opacity: entering ? boundary.contentOpacity : 0, transform: entering || reduced ? "none" : "translateY(4px)", offset: 0.24 },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration,
        easing,
        fill: "both",
      },
    ) : undefined;
    const envelope = createEditorContainerMorph(node, previousRect, nextRect, duration, easing,
      entering || exiting ? {
        direction: exiting ? "exit" : "enter",
        liveRect,
        triggerRadius: trigger ? getComputedStyle(trigger).borderRadius : undefined,
      } : undefined);
    popoverEnvelopeRef.current = envelope;
    const animation = envelope.animation;
    playPopoverGhosts();
    popoverMorphRef.current = animation;
    let cleaned = false;
    const cleanupMorphAnimation = () => {
      if (cleaned) return;
      cleaned = true;
      animation.oncancel = null;
      animation.cancel();
      contentAnimation?.cancel();
      // A queued cancel belongs to the old effect, not its successor.
      envelope.cleanup();
      if (popoverEnvelopeRef.current === envelope) popoverEnvelopeRef.current = null;
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
      if (exiting) {
        cleanupMorphAnimation();
        finishClosingPanel();
        return;
      }
      setPopoverEntryComplete(true);
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
  }, [panelStage, popoverLayoutMode, optionsPage, renderedPanel, primaryTask]);

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
    const node = popoverRef.current;
    if (panel === "advanced" && primaryTask && node && optionsTriggerRef.current && window.matchMedia(desktopOptionsQuery).matches) {
      popoverMotionTokensRef.current = readEditorMotionTokens();
      captureOptionsBoundaryMotion("exit", node.getBoundingClientRect());
      if (node.contains(document.activeElement)) optionsTriggerRef.current.focus({ preventScroll: true });
      removePopoverMorphGhost();
    } else {
      capturePopoverMotionStart("exit");
      capturePopoverRect();
    }
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
    // Keep the import workbench during loading; retire its modal/focus layer
    // only once the requested destination is ready to own interaction.
    if (surface !== "import" && novelWorkbenchOpen) closeNovelWorkbench();
    const motionTokens = readEditorMotionTokens();
    popoverMotionTokensRef.current = motionTokens;
    setSurfaceLoading(false);
    displayedSurfaceRef.current = surface;
    clearCloseTimer();
    clearPopoverMorphSettleTimer();
    const shouldMorphSurfaceHandoff = sourceSurface !== "edit"
      && sourceSurface !== "import"
      && surface !== "edit"
      && surface !== "import"
      && visiblePanel !== null;
    const optionsTrigger = optionsTriggerRef.current;
    const opensDesktopOptions = (surface === "options" || surface === "assets")
      && sourceSurface === "edit" && optionsTrigger && window.matchMedia(desktopOptionsQuery).matches;
    const reversingOptions = panelStage === "closing" && visiblePanel === "advanced";
    if (opensDesktopOptions) {
      const triggerRect = optionsTrigger.getBoundingClientRect();
      if (reversingOptions) captureOptionsBoundaryMotion("enter", triggerRect);
      else optionsBoundaryMotionRef.current = { direction: "enter", rect: triggerRect, contentOpacity: 0 };
      closingPanelRef.current = null;
    }
    if (shouldMorphSurfaceHandoff) {
      capturePopoverRect({ preserveSnapshot: true, pauseUntilMorph: true, motionTokens });
    } else if (!opensDesktopOptions || !reversingOptions) {
      popoverMorphRef.current?.cancel();
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
      if (!reversingOptions || toolsRequest) {
        setAdvancedRequest(toolsRequest ?? {
          id: `surface_${surface}_${Date.now()}`,
          tab: "settings",
        });
        if (!reversingOptions) {
          optionsPageRef.current = "settings";
          setOptionsPage("settings");
          updatePopoverLayoutMode(false);
        }
      }
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
    popoverEnvelopeRef.current?.cleanup();
    popoverEnvelopeRef.current = null;
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
      data-workspace-task={primaryTask ? activeSurface : undefined}
      data-options-page={visiblePanel === "advanced" ? optionsPage : undefined}>
        <LoadedToolbarPanelTransition
          panelKey={visiblePanel}
          onEntered={() => setPopoverEntryComplete(true)}
          motionTokens={popoverMotionTokensRef.current!}
          geometryHandoff={previousPopoverRectRef.current !== null || popoverEnvelopeRef.current !== null || optionsBoundaryMotionRef.current?.direction === "enter"}
        >
        <Suspense fallback={<ToolbarPanelLoading panel={visiblePanel} />}>
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
            <ProjectTimelinePanel />
          ) : (
            <AdvancedToolsPanel request={advancedRequest} onLayoutModeChange={setAdvancedLayoutMode} />
          )}
        </Suspense>
        </LoadedToolbarPanelTransition>
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
            ref={optionsTriggerRef}
            type="button"
            className={requestedSurface === "options" ? "is-active" : ""}
            aria-current={requestedSurface === "options" ? "page" : undefined}
            data-glass-selected={requestedSurface === "options"}
            data-workspace-surface="options"
            aria-expanded={visiblePanel === "advanced" && panelStage === "open"}
            onClick={(event) => activeSurfaceRef.current === "options"
              ? activePanel === "advanced" ? closePanel("advanced") : void openSurface("edit")
              : void openSurface("options", event.detail === 0)}
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
            独立预览
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
            {projectExportBusy ? "正在打包素材…" : "导出工程文件"}
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

    </header>
  );
}
