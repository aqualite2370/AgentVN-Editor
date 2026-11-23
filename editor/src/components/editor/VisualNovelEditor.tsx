import { Background, BaseEdge, ConnectionLineType, Controls, ReactFlow, ReactFlowProvider, useNodesInitialized, type DefaultEdgeOptions, type EdgeProps } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { backendClient } from "../../api/backendClient";
import { editorCanvasBackgroundSource } from "../../utils/editorCanvasBackground";
import type { SharedEditorState } from "../../api/types";
import { useEditorStore } from "../../store/editorStore";
import { useProjectStore } from "../../store/projectStore";
import type { AssetRef } from "../../types/assets";
import type { EditorEdge, EditorNode } from "../../types/nodes";
import { countEmbeddedAssetPayloads } from "../../utils/embeddedAssetPayloads";
import { ErrorToast } from "../common/ErrorToast";
import { AnimationNode } from "../nodes/AnimationNode";
import { ChoiceNode } from "../nodes/ChoiceNode";
import { ConditionNode } from "../nodes/ConditionNode";
import { EndNode } from "../nodes/EndNode";
import { ModifierNode } from "../nodes/ModifierNode";
import { LoopNode } from "../nodes/LoopNode";
import { SceneNode } from "../nodes/SceneNode";
import { StartNode } from "../nodes/StartNode";
import { EditorToolbar } from "./EditorToolbar";
import { GraphHistoryShortcuts } from "./GraphHistoryShortcuts";
import { useEditorProjectAutosave } from "./useEditorProjectAutosave";
import { StoryMiniMap } from "./StoryMiniMap";
import { graphCards, graphEndpointPath, routeGraphEdges, type GraphPoint } from "../../utils/graphGeometry";
import { InspectorPanel } from "./InspectorPanel";
import { NodePalette } from "./NodePalette";
import { PreviewPanel } from "./PreviewPanel";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { EditorWorkspace } from "../workspace/EditorWorkspace";
import { openWorkspaceSurface, requestBack, requestGeneration, type WorkspaceController, type SaveResult } from "../workspace/workspaceContracts";
import { WorkspaceStatusBar } from "../workspace/WorkspaceStatusBar";
import { AssistantProjectCreationLockGate } from "../assistant/AssistantProjectCreationLockGate";

const dynamicFlowNodeClasses = new Set(["is-new-node", "is-new-ai-node", "is-decluttered-node"]);
const previewSplitStorageKey = "agentvn.previewSplitRatio";
const previewSplitDefault = 0.4;
const previewSplitMinimum = 0.35;
const previewSplitMaximum = 0.65;
const previewPaneTargetPx = 252;
const inspectorPaneTargetPx = 152;
const previewSplitterSizePx = 10;

interface OrthogonalEdgeData extends Record<string, unknown> {
  route?: GraphPoint[];
  isJunctionEdge?: boolean;
  isBackEdge?: boolean;
  isLoopEdge?: boolean;
  edgeKind?: string;
  edgeRole?: string;
}

function EditorPrerenderReadiness() {
  const nodesInitialized = useNodesInitialized();
  const nodeCount = useEditorStore((state) => state.nodes.length);

  useEffect(() => {
    if (nodeCount > 0 && !nodesInitialized) return;
    const surface = document.querySelector<HTMLElement>(".flow-surface");
    if (!surface) return;

    let active = true;
    let frame = 0;
    let previousGeometry: string | undefined;
    const verifyCommittedGeometry = () => {
      if (!active) return;
      const surfaceRect = surface.getBoundingClientRect();
      const nodes = [...surface.querySelectorAll<HTMLElement>(".react-flow__node")]
        .filter((node) => node.getClientRects().length > 0);
      const nodesHaveGeometry = nodes.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (surfaceRect.width <= 0 || surfaceRect.height <= 0 || !nodesHaveGeometry) {
        previousGeometry = undefined;
        frame = window.requestAnimationFrame(verifyCommittedGeometry);
        return;
      }

      const geometry = [
        Math.round(surfaceRect.width),
        Math.round(surfaceRect.height),
        ...nodes.flatMap((node) => {
          const rect = node.getBoundingClientRect();
          return [
            node.dataset.id,
            Math.round(rect.width),
            Math.round(rect.height),
          ];
        }),
      ].join(":");
      if (geometry !== previousGeometry) {
        previousGeometry = geometry;
        frame = window.requestAnimationFrame(verifyCommittedGeometry);
        return;
      }

      surface.dataset.editorPrerenderReady = "true";
    };

    frame = window.requestAnimationFrame(verifyCommittedGeometry);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      delete surface.dataset.editorPrerenderReady;
    };
  }, [nodeCount, nodesInitialized]);

  return null;
}

function stableNodeClassName(value?: string): string | undefined {
  const classes = value?.split(/\s+/).filter((item) => item && !dynamicFlowNodeClasses.has(item)) ?? [];
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function previewSplitBounds(height: number) {
  if (height <= previewSplitterSizePx) return { minimum: previewSplitMinimum, maximum: previewSplitMaximum };
  // Treat the pixel targets as soft floors. Preserve at least 12 points of
  // travel on compact workspaces so both the pointer and keyboard can resize.
  const maximum = Math.max(0.5, Math.min(previewSplitMaximum, (height - previewSplitterSizePx - inspectorPaneTargetPx) / height));
  const minimum = Math.max(previewSplitMinimum, Math.min(previewPaneTargetPx / height, maximum - 0.12));
  return { minimum, maximum };
}

function loadPreviewSplitRatio(): number {
  const saved = window.localStorage.getItem(previewSplitStorageKey);
  if (saved === null) return previewSplitDefault;
  const parsed = Number(saved);
  if (!Number.isFinite(parsed) || parsed < previewSplitMinimum || parsed > previewSplitMaximum) {
    return previewSplitDefault;
  }
  return parsed;
}

function countVisibleEdgesBy<T extends "source" | "target">(edges: Array<Record<T, string> & { hidden?: boolean }>, key: T) {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    if (edge.hidden) return;
    const nodeId = edge[key];
    counts.set(nodeId, (counts.get(nodeId) ?? 0) + 1);
  });
  return counts;
}

function hasEmbeddedAssetPayloads(assets: AssetRef[]): boolean {
  return assets.some((asset) => {
    const { data_url: dataUrl, blob_url: blobUrl } = asset.metadata;
    return dataUrl?.startsWith("data:") || blobUrl?.startsWith("data:");
  });
}

function shouldApplyPersistedAssetManifest(current: AssetRef[], incoming: AssetRef[]): boolean {
  if (hasEmbeddedAssetPayloads(current) || current.length !== incoming.length) return true;
  const currentById = new Map(current.map((asset) => [asset.asset_id, asset]));
  return incoming.some((asset) => {
    const currentAsset = currentById.get(asset.asset_id);
    return Boolean(asset.metadata.url && currentAsset?.metadata.url !== asset.metadata.url);
  });
}

function applyPersistedProjectMetadata(
  state: SharedEditorState,
  submitted: ReturnType<typeof useProjectStore.getState>,
  generation: number,
): void {
  const incomingAssets = state.project_metadata.assetManifest;
  const current = useProjectStore.getState();
  if (useEditorStore.getState().projectLoadGeneration !== generation
    || current.projectId !== submitted.projectId
    || current.title !== submitted.title
    || current.author !== submitted.author
    || current.assetManifest !== submitted.assetManifest
    || current.settings !== submitted.settings) return;
  if (state.project_metadata.projectId && state.project_metadata.projectId !== current.projectId) return;
  const shouldApplyAssets = Array.isArray(incomingAssets) && shouldApplyPersistedAssetManifest(current.assetManifest, incomingAssets as AssetRef[]);
  const shouldApplySettings = Boolean(state.project_metadata.settings) && countEmbeddedAssetPayloads(current.settings).count > 0;
  if (shouldApplyAssets || shouldApplySettings) {
    current.loadProjectMetadata({
      project_id: state.project_metadata.projectId ?? current.projectId,
      title: state.project_metadata.title ?? current.title,
      author: state.project_metadata.author ?? current.author,
      created_at: state.project_metadata.createdAt ?? current.createdAt,
      updated_at: state.project_metadata.updatedAt ?? current.updatedAt,
      asset_manifest: Array.isArray(incomingAssets) ? incomingAssets : current.assetManifest,
      editor_settings: state.project_metadata.settings ?? (current.settings as unknown as Record<string, unknown>),
    });
  }
}

function edgeSourceClass(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || undefined;
}

function edgeColorForConnection(
  sourceKind: string | undefined,
  targetKind: string | undefined,
  sourceHandle?: string | null,
): { color: string; kind: string; role?: string } {
  const handle = sourceHandle ?? "default";
  if (sourceKind === "loop") {
    if (handle === "exit") return { color: "var(--loop-exit)", kind: "loop", role: "loop-exit" };
    return { color: "var(--loop)", kind: "loop", role: handle === "loop" ? "loop-continue" : "loop" };
  }
  if (sourceKind === "condition") {
    if (handle === "true") return { color: "var(--condition)", kind: "condition", role: "condition-true" };
    if (handle === "false") return { color: "var(--end)", kind: "condition", role: "condition-false" };
    return { color: "var(--condition)", kind: "condition" };
  }
  if (targetKind === "loop") return { color: "var(--loop)", kind: sourceKind ?? "unknown", role: "loop-entry" };
  if (sourceKind === "scene" && handle !== "default" && handle !== "mainline") {
    return { color: "var(--choice)", kind: "scene", role: "choice-branch" };
  }
  switch (sourceKind) {
    case "start":
      return { color: "var(--start)", kind: "start" };
    case "scene":
      return { color: "var(--scene)", kind: "scene" };
    case "choice":
      return { color: "var(--choice)", kind: "choice" };
    case "modifier":
      return { color: "var(--modifier)", kind: "modifier" };
    case "animation":
      return { color: "var(--animation)", kind: "animation" };
    case "end":
      return { color: "var(--end)", kind: "end" };
    default:
      return { color: "var(--line-strong)", kind: sourceKind ?? "unknown" };
  }
}

function OrthogonalEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const edgeData = data as OrthogonalEdgeData | undefined;
  const path = graphEndpointPath(edgeData?.route ?? [], { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const className = [
    "orthogonal-edge-path",
    edgeData?.edgeKind ? "edge-kind-" + edgeSourceClass(edgeData.edgeKind) : "",
    edgeData?.edgeRole ? "edge-role-" + edgeSourceClass(edgeData.edgeRole) : "",
    edgeData?.isJunctionEdge ? "is-junction-edge" : "",
    edgeData?.isBackEdge ? "is-back-edge" : "",
    edgeData?.isLoopEdge ? "is-loop-edge" : "",
  ].filter(Boolean).join(" ");
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} className={className} />;
}

export function VisualNovelEditor({
  onReturnHome,
  deferRuntimePreview = false,
}: {
  onReturnHome: () => void;
  deferRuntimePreview?: boolean;
}) {
  const [isDeclutteringNodes, setIsDeclutteringNodes] = useState(false);
  const [miniMapReady, setMiniMapReady] = useState(true);
  const [viewportRevision, setViewportRevision] = useState(0);
  const viewportMovingRef = useRef(false);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("agentvn.inspectorWidth"));
    return Number.isFinite(saved) && saved >= 320 ? Math.min(1120, saved) : 440;
  });
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [workspaceActive, setWorkspaceActive] = useState(true);
  const [previewResizing, setPreviewResizing] = useState(false);
  const [previewSplitRatio, setPreviewSplitRatio] = useState(loadPreviewSplitRatio);
  const [previewStackHeight, setPreviewStackHeight] = useState(0);
  const previewBounds = previewSplitBounds(previewStackHeight);
  const displayedPreviewRatio = Math.max(previewBounds.minimum, Math.min(previewBounds.maximum, previewSplitRatio));
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const viewport = useEditorStore((state) => state.viewport);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const connectNodes = useEditorStore((state) => state.connectNodes);
  const selectNode = useEditorStore((state) => state.selectNode);
  const setViewport = useEditorStore((state) => state.setViewport);
  const setFlowSurfaceSize = useEditorStore((state) => state.setFlowSurfaceSize);
  const recentNodeEffects = useEditorStore((state) => state.recentNodeEffects);
  const activeNotice = useEditorStore((state) => state.lastError);
  const setNotice = useEditorStore((state) => state.setNotice);
  const dismissNoticeToast = useCallback(() => setNotice(undefined), [setNotice]);
  const nodeTypes = useMemo(() => ({
    sceneNode: SceneNode,
    choiceNode: ChoiceNode,
    modifierNode: ModifierNode,
    conditionNode: ConditionNode,
    loopNode: LoopNode,
    animationNode: AnimationNode,
    startNode: StartNode,
    endNode: EndNode,
  }), []);
  const edgeTypes = useMemo(() => ({
    orthogonal: OrthogonalEdge,
  }), []);
  const treeEdgeDefaults = useMemo<DefaultEdgeOptions>(() => ({
    type: "orthogonal",
    interactionWidth: 18,
  }), []);
  const cards = useMemo(() => graphCards(nodes), [nodes]);
  const edgeRoutes = useMemo(() => routeGraphEdges(cards, edges), [cards, edges]);
  const flowEdges = useMemo(
    () => {
      const outgoingCounts = countVisibleEdgesBy(edges, "source");
      const incomingCounts = countVisibleEdgesBy(edges, "target");
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      return edges.map((edge) => {
        const isJunctionEdge = (outgoingCounts.get(edge.source) ?? 0) > 1 || (incomingCounts.get(edge.target) ?? 0) > 1;
        const sourceNode = nodesById.get(edge.source);
        const targetNode = nodesById.get(edge.target);
        const sourceY = sourceNode?.position.y ?? 0;
        const targetY = targetNode?.position.y ?? sourceY;
        const isBackEdge = Boolean(sourceNode && targetNode && targetY <= sourceY - 24);
        const isLoopEdge = sourceNode?.data.nodeKind === "loop" || targetNode?.data.nodeKind === "loop";
        const edgeSemantic = edgeColorForConnection(sourceNode?.data.nodeKind, targetNode?.data.nodeKind, edge.sourceHandle);
        return {
          ...edge,
          type: "orthogonal",
          className: [
            edge.className,
            edgeSemantic.kind ? "edge-kind-" + edgeSourceClass(edgeSemantic.kind) : "",
            edgeSemantic.role ? "edge-role-" + edgeSourceClass(edgeSemantic.role) : "",
            isJunctionEdge ? "is-junction-edge" : "",
            isBackEdge ? "is-back-edge" : "",
            isLoopEdge ? "is-loop-edge" : "",
          ].filter(Boolean).join(" ") || undefined,
          data: {
            ...(edge.data as Record<string, unknown> | undefined),
            route: edgeRoutes.get(edge.id),
            isJunctionEdge,
            isBackEdge,
            isLoopEdge,
            edgeKind: edgeSemantic.kind,
            edgeRole: edgeSemantic.role,
          },
          style: {
            ...(edge.style as CSSProperties | undefined),
            "--edge-color": edgeSemantic.color,
          } as CSSProperties,
          interactionWidth: edge.interactionWidth ?? 18,
        };
      });
    },
    [edges, nodes, edgeRoutes],
  );
  const flowSurfaceRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const previewStackRef = useRef<HTMLElement>(null);
  const previewKeyboardResizeTimerRef = useRef<number | undefined>(undefined);
  const previewDragCleanupRef = useRef<(() => void) | undefined>(undefined);
  const nodeDragRef = useRef({ dragging: false, endedAt: 0 });
  const flowNodes = useMemo(
    () => nodes.map((node) => {
      const selected = node.id === selectedNodeId;
      const effect = recentNodeEffects[node.id];
      const isNewAiNode = Boolean(effect && (effect.source === "ai" || node.data.editorMeta?.source === "ai_generated"));
      const isDeclutteredNode = effect?.source === "declutter";
      const classNames = [
        stableNodeClassName(node.className),
        effect ? "is-new-node" : "",
        isNewAiNode ? "is-new-ai-node" : "",
        isDeclutteredNode ? "is-decluttered-node" : "",
      ].filter(Boolean).join(" ");
      if (node.selected === selected && node.className === classNames) return node;
      return { ...node, selected, className: classNames || undefined };
    }),
    [nodes, recentNodeEffects, selectedNodeId]
  );
  const project = useProjectStore();
  const saveRequestIdRef = useRef(0);
  const editorAppearance = project.settings.editorAppearance;
  const canvasBackgroundSource = editorCanvasBackgroundSource(editorAppearance.canvasBackgroundImage);
  const canvasBackgroundFit = editorAppearance.canvasBackgroundFit ?? "cover";
  const canvasBackgroundOpacity = editorAppearance.canvasBackgroundOpacity ?? 0.38;
  const shellBackgroundLayerStyle = useMemo<CSSProperties | undefined>(() => {
    if (!canvasBackgroundSource) return undefined;
    return {
      backgroundImage: `url("${canvasBackgroundSource}")`,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      opacity: canvasBackgroundOpacity > 0 ? Math.min(0.48, canvasBackgroundOpacity + 0.12) : 0,
    };
  }, [canvasBackgroundSource, canvasBackgroundOpacity]);
  const flowBackgroundLayerStyle = useMemo<CSSProperties | undefined>(() => {
    if (!canvasBackgroundSource) return undefined;
    return {
      backgroundImage: `url("${canvasBackgroundSource}")`,
      backgroundSize: canvasBackgroundFit === "tile" ? "320px auto" : canvasBackgroundFit,
      backgroundRepeat: canvasBackgroundFit === "tile" ? "repeat" : "no-repeat",
      backgroundPosition: "center",
      opacity: canvasBackgroundOpacity,
    };
  }, [canvasBackgroundFit, canvasBackgroundSource, canvasBackgroundOpacity]);

  const requestSave = useCallback(async (): Promise<SaveResult> => {
    const requestId = ++saveRequestIdRef.current;
    const state = useEditorStore.getState();
    const currentProject = useProjectStore.getState();
    try {
      const saved = await backendClient.saveProjectState({
        project_graph: {
          nodes: state.nodes,
          edges: state.edges,
          viewport: state.viewport,
          memoryMode: state.memoryMode,
        },
        project_metadata: {
          projectId: currentProject.projectId,
          title: currentProject.title,
          author: currentProject.author,
          createdAt: currentProject.createdAt,
          updatedAt: new Date().toISOString(),
          assetManifest: currentProject.assetManifest,
          settings: { ...currentProject.settings },
        },
      });
      if (requestId === saveRequestIdRef.current) {
        applyPersistedProjectMetadata(saved, currentProject, state.projectLoadGeneration);
        const latest = useEditorStore.getState();
        if (
          latest.projectLoadGeneration === state.projectLoadGeneration &&
          useProjectStore.getState().projectId === currentProject.projectId &&
          latest.nodes === state.nodes &&
          latest.edges === state.edges &&
          latest.viewport === state.viewport &&
          latest.memoryMode === state.memoryMode
        ) {
          useEditorStore.setState({ dirty: false });
        }
      }
      return { ok: true, message: "已保存。" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "保存失败。" };
    }
  }, []);

  const workspaceController = useMemo<WorkspaceController>(() => ({
    openSurface: openWorkspaceSurface,
    requestBack,
    requestSave,
    requestGeneration,
  }), [requestSave]);

  useEffect(() => {
    let timeoutId: number | undefined;
    const handleDeclutter = () => {
      setIsDeclutteringNodes(true);
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setIsDeclutteringNodes(false), 420);
    };
    window.addEventListener("agentvn:nodes-declutter", handleDeclutter);
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("agentvn:nodes-declutter", handleDeclutter);
    };
  }, []);

  useEffect(() => {
    if (nodes.length <= 120) {
      setMiniMapReady(true);
      return;
    }
    setMiniMapReady(false);
    let timeoutId: number | undefined;
    let idleId: number | undefined;
    timeoutId = window.setTimeout(() => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
      const showMiniMap = () => {
        idleId = undefined;
        setMiniMapReady(true);
      };
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(showMiniMap, { timeout: 1200 });
        return;
      }
      showMiniMap();
    // Do not compete with the route import's first render. The minimap is
    // auxiliary UI and can appear after the graph has settled.
    }, 1800);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (idleId !== undefined) {
        const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
        idleWindow.cancelIdleCallback?.(idleId);
      }
    };
  }, [nodes.length]);

  const resizeInspector = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startWidth = previewStackRef.current?.getBoundingClientRect().width ?? inspectorWidth;
    const maxWidth = Math.min(1120, (handle.parentElement?.clientWidth ?? window.innerWidth) * 0.6);
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const nextWidth = Math.min(maxWidth, Math.max(320, startWidth + startX - moveEvent.clientX));
      setInspectorWidth(nextWidth);
      window.localStorage.setItem("agentvn.inspectorWidth", String(nextWidth));
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      handle.removeEventListener("lostpointercapture", onLostPointerCapture);
      document.body.classList.remove("is-resizing-panel");
      setPreviewResizing(false);
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const onLostPointerCapture = (lostEvent: PointerEvent) => {
      if (lostEvent.pointerId !== pointerId) return;
      cleanup();
    };
    document.body.classList.add("is-resizing-panel");
    setPreviewResizing(true);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    handle.addEventListener("lostpointercapture", onLostPointerCapture);
  }, [inspectorWidth]);

  const resizePreview = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (previewCollapsed || event.button !== 0 || !event.isPrimary || previewDragCleanupRef.current) return;
    event.preventDefault();
    const splitter = event.currentTarget;
    const pointerId = event.pointerId;
    const workspace = previewStackRef.current;
    if (!workspace) return;
    try {
      splitter.setPointerCapture(pointerId);
    } catch {
      // error-log-ignore: 部分 WebView 不支持 Pointer Capture，文档级事件监听会继续完成拖动。
      // Some WebViews do not expose pointer capture; document listeners remain the fallback.
    }
    splitter.focus({ preventScroll: true });
    const grabOffset = event.clientY - splitter.getBoundingClientRect().top;
    let latestRatio: number | undefined;
    const update = (clientY: number) => {
      const height = Math.max(1, workspace.clientHeight);
      const { minimum, maximum } = previewSplitBounds(height);
      latestRatio = Math.min(maximum, Math.max(minimum, (clientY - workspace.getBoundingClientRect().top - grabOffset) / height));
      setPreviewSplitRatio(latestRatio);
    };
    const cleanup = (persist = true) => {
      if (!previewDragCleanupRef.current) return;
      previewDragCleanupRef.current = undefined;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      splitter.removeEventListener("lostpointercapture", onLostPointerCapture);
      window.removeEventListener("blur", onUp);
      document.body.classList.remove("is-resizing-preview");
      setPreviewResizing(false);
      if (persist && latestRatio !== undefined) window.localStorage.setItem(previewSplitStorageKey, String(latestRatio));
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) update(moveEvent.clientY);
    };
    const onUp = (upEvent?: Event) => {
      if (upEvent instanceof PointerEvent && upEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const onLostPointerCapture = () => cleanup();
    if (previewKeyboardResizeTimerRef.current !== undefined) {
      window.clearTimeout(previewKeyboardResizeTimerRef.current);
      previewKeyboardResizeTimerRef.current = undefined;
    }
    previewDragCleanupRef.current = () => cleanup(false);
    document.body.classList.add("is-resizing-preview");
    setPreviewResizing(true);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    splitter.addEventListener("lostpointercapture", onLostPointerCapture);
    window.addEventListener("blur", onUp);
  }, [previewCollapsed]);

  const resizePreviewWithKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (previewCollapsed || previewDragCleanupRef.current || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const { minimum, maximum } = previewBounds;
    const next = event.key === "Home" ? minimum : event.key === "End" ? maximum
      : Math.min(maximum, Math.max(minimum, displayedPreviewRatio + (event.key === "ArrowUp" ? -0.02 : 0.02)));
    if (next === displayedPreviewRatio) return;
    setPreviewResizing(true);
    if (previewKeyboardResizeTimerRef.current) window.clearTimeout(previewKeyboardResizeTimerRef.current);
    previewKeyboardResizeTimerRef.current = window.setTimeout(() => {
      previewKeyboardResizeTimerRef.current = undefined;
      setPreviewResizing(false);
    }, 120);
    setPreviewSplitRatio(next);
    window.localStorage.setItem(previewSplitStorageKey, String(next));
  }, [displayedPreviewRatio, previewBounds.minimum, previewBounds.maximum, previewCollapsed]);

  useEffect(() => {
    if (!workspaceActive || previewCollapsed) previewDragCleanupRef.current?.();
  }, [previewCollapsed, workspaceActive]);
  useEffect(() => () => {
    previewDragCleanupRef.current?.();
    window.clearTimeout(previewKeyboardResizeTimerRef.current);
  }, []);

  useEffect(() => {
    let frameId: number | undefined;
    let timeoutId: number | undefined;
    let active = true;
    const recoverViewport = () => {
      if (!active || document.visibilityState === "hidden") return;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      frameId = window.requestAnimationFrame(() => {
        frameId = window.requestAnimationFrame(() => {
          if (!active) return;
          setViewportRevision((current) => current + 1);
          frameId = undefined;
          const surface = flowSurfaceRef.current;
          const rect = surface?.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) {
            timeoutId = window.setTimeout(() => {
              if (!active) return;
              setViewportRevision((current) => current + 1);
              timeoutId = undefined;
            }, 180);
          }
        });
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recoverViewport();
    };
    const onPageShow = () => recoverViewport();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", recoverViewport);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("resize", recoverViewport);
    recoverViewport();
    return () => {
      active = false;
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", recoverViewport);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("resize", recoverViewport);
    };
  }, []);

  useEffect(() => {
    const workspace = previewStackRef.current;
    if (!workspace) return;
    const measureWorkspace = () => setPreviewStackHeight(workspace.clientHeight);
    measureWorkspace();
    const observer = new ResizeObserver(measureWorkspace);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [viewportRevision]);

  useEffect(() => {
    return;
    let mounted = true;
    void backendClient.loadProjectState().then((data) => {
      if (!mounted || !data) return;
      const remote = data.project_graph;
      if (!Array.isArray(remote.nodes) || remote.nodes.length === 0) return;
      useEditorStore.getState().importProject({
        schema_version: "1.0.0",
        project_id: project.projectId || "synced",
        title: project.title || "同步工程",
        author: project.author || "",
        nodes: remote.nodes as never,
        edges: (remote.edges ?? []) as never,
        viewport: (remote.viewport ?? { x: 0, y: 0, zoom: 1 }) as never,
        memory_mode: (remote.memoryMode ?? "hybrid") as never,
        asset_manifest: project.assetManifest,
        editor_settings: { ...project.settings },
        created_at: project.createdAt,
        updated_at: new Date().toISOString(),
      });
      useEditorStore.setState({ dirty: false });
    }).catch((error) => {
      // error-log-ignore: 这段兼容同步目前被前面的 return 禁用，保留代码仅供旧工程参考。
      void error;
    });

    return () => {
      mounted = false;
    };
  }, [project.assetManifest, project.author, project.createdAt, project.projectId, project.settings, project.title]);

  useEffect(() => {
    const surface = flowSurfaceRef.current;
    if (!surface) return;
    const syncActualViewport = () => {
      if (viewportMovingRef.current) return false;
      const viewportNode = surface.querySelector<HTMLElement>(".react-flow__viewport");
      const transform = viewportNode ? window.getComputedStyle(viewportNode).transform : "";
      if (!transform || transform === "none") return false;
      const matrix = new DOMMatrixReadOnly(transform);
      if (!Number.isFinite(matrix.a) || matrix.a <= 0) return false;
      const current = useEditorStore.getState().viewport;
      const changed = Math.abs(current.x - matrix.e) > 0.001
        || Math.abs(current.y - matrix.f) > 0.001
        || Math.abs(current.zoom - matrix.a) > 0.001;
      if (changed) setViewport({ x: matrix.e, y: matrix.f, zoom: matrix.a }, false);
      return changed;
    };
    const measure = () => {
      const rect = surface.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const currentSize = useEditorStore.getState().flowSurfaceSize;
      if (currentSize.width !== width || currentSize.height !== height) {
        setFlowSurfaceSize({ width, height });
      }
      if (width > 0 && height > 0) {
        syncActualViewport();
      }
      return width > 0 && height > 0;
    };
    const scheduleMeasure = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(measure);
      });
    };
    const hasInitialMeasurement = measure();
    const timeoutId = hasInitialMeasurement ? undefined : window.setTimeout(measure, 250);
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(surface);
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [setFlowSurfaceSize, setViewport, viewportRevision]);

  useEditorProjectAutosave();

  useEffect(() => {
    const labels: Record<string, string> = {
      "Zoom In": "放大画布",
      "Zoom Out": "缩小画布",
      "Fit View": "适应视图",
      "Toggle Interactivity": "锁定或解锁画布",
      "Mini Map": "缩略地图",
      "Control Panel": "画布控制",
    };
    const applyChineseLabels = (root: ParentNode = document) => {
      root.querySelectorAll<HTMLElement>("[aria-label]").forEach((element) => {
        const label = element.getAttribute("aria-label");
        const nextLabel = label && labels[label] ? labels[label] : label?.startsWith("Edge from") ? "剧情连线" : undefined;
        if (nextLabel && label !== nextLabel) element.setAttribute("aria-label", nextLabel);
      });
      root.querySelectorAll<HTMLImageElement>('img[alt="Mini Map"]').forEach((element) => {
        element.alt = "缩略地图";
      });
      root.querySelectorAll<SVGTitleElement>("title").forEach((element) => {
        if (element.textContent === "Mini Map") element.textContent = "缩略地图";
      });
      root.querySelectorAll<HTMLElement>(".react-flow__attribution").forEach((element) => {
        element.setAttribute("aria-label", "画布组件来源");
        element.style.display = "none";
      });
    };
    let frameId: number | undefined;
    let idleId: number | undefined;
    const scheduleApplyChineseLabels = () => {
      if (frameId !== undefined || idleId !== undefined) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = undefined;
        const run = () => {
          idleId = undefined;
          applyChineseLabels(flowSurfaceRef.current ?? document);
        };
        const idleWindow = window as Window & {
          requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
        };
        if (nodes.length > 80 && idleWindow.requestIdleCallback) {
          idleId = idleWindow.requestIdleCallback(run, { timeout: 400 });
          return;
        }
        run();
      });
    };
    scheduleApplyChineseLabels();
    const observer = new MutationObserver(scheduleApplyChineseLabels);
    const observerTarget = flowSurfaceRef.current ?? document.querySelector<HTMLElement>(".flow-surface");
    if (observerTarget) {
      observer.observe(observerTarget, { childList: true, subtree: true });
    }
    const id = window.setTimeout(scheduleApplyChineseLabels, 120);
    return () => {
      window.clearTimeout(id);
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (idleId !== undefined) {
        const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
        idleWindow.cancelIdleCallback?.(idleId);
      }
      observer.disconnect();
    };
  }, [nodes.length]);


  return (
    <ReactFlowProvider>
      <EditorPrerenderReadiness />
      <GraphHistoryShortcuts active={workspaceActive} />
      <AssistantProjectCreationLockGate
        projectId={project.projectId}
        projectTitle={project.title}
        onReturnHome={onReturnHome}
      >
        <div
          ref={shellRef}
          className={`editor-shell${shellBackgroundLayerStyle ? " has-editor-canvas-background" : ""}`}
          data-viewport-revision={viewportRevision}
        >
          {shellBackgroundLayerStyle && (
            <div
              className="editor-canvas-background-layer is-shell"
              aria-hidden="true"
              style={shellBackgroundLayerStyle}
            />
          )}
          <EditorWorkspace
            toolbar={<EditorToolbar onReturnHome={onReturnHome} onWorkspaceActiveChange={setWorkspaceActive} />}
            statusBar={<WorkspaceStatusBar />}
            controller={workspaceController}
          >
            <main
              className="editor-workspace"
              style={{
                "--inspector-width": `${inspectorWidth}px`,
                "--preview-split-ratio": `${displayedPreviewRatio * 100}%`,
              } as CSSProperties}
            >
          <NodePalette />
          <section
            className={`flow-surface${isDeclutteringNodes ? " is-decluttering-nodes" : ""}`}
            ref={flowSurfaceRef}
          >
            {flowBackgroundLayerStyle && (
              <div
                className="editor-canvas-background-layer is-flow"
                aria-hidden="true"
                style={flowBackgroundLayerStyle}
              />
            )}
            {activeNotice && <ErrorToast notice={activeNotice} onDismiss={dismissNoticeToast} />}
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={treeEdgeDefaults}
              connectionLineType={ConnectionLineType.Step}
              defaultViewport={viewport}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onBeforeDelete={async ({ nodes: removedNodes, edges: removedEdges }) => {
                if (removedNodes.length || removedEdges.length) useEditorStore.getState().beginGraphHistoryBatch("graph-delete");
                return true;
              }}
              onDelete={() => useEditorStore.getState().endGraphHistoryBatch("graph-delete")}
              onConnect={connectNodes}
              onMoveStart={() => { viewportMovingRef.current = true; }}
              onMoveEnd={(_, viewport) => { viewportMovingRef.current = false; setViewport(viewport); }}
              onNodeDragStart={() => {
                useEditorStore.getState().beginGraphHistoryBatch("node-drag");
                nodeDragRef.current = { dragging: true, endedAt: 0 };
              }}
              onNodeDragStop={() => {
                useEditorStore.getState().endGraphHistoryBatch("node-drag");
                nodeDragRef.current = { dragging: false, endedAt: Date.now() };
              }}
              onNodeClick={(_, node) => {
                selectNode(node.id);
                const drag = nodeDragRef.current;
                if (drag.dragging || Date.now() - drag.endedAt < 220) return;
                if (node.data.nodeKind === "scene") setPreviewCollapsed(false);
                window.dispatchEvent(new CustomEvent("agentvn:node-card-click", { detail: { nodeId: node.id } }));
              }}
              onPaneClick={() => {
                window.dispatchEvent(new Event("agentvn:node-card-click"));
                selectNode(undefined);
              }}
              onlyRenderVisibleElements
              proOptions={{ hideAttribution: true }}
              ariaLabelConfig={{
                "node.a11yDescription.default": "按回车或空格选中节点，按删除键移除节点，按退出键取消选择。",
                "node.a11yDescription.keyboardDisabled": "按回车或空格选中节点，可使用方向键移动节点，按删除键移除节点，按退出键取消选择。",
                "node.a11yDescription.ariaLiveMessage": () => "已移动选中的节点。",
                "edge.a11yDescription.default": "按回车或空格选中连线，按删除键移除连线，按退出键取消选择。",
                "controls.ariaLabel": "画布控制",
                "controls.zoomIn.ariaLabel": "放大画布",
                "controls.zoomOut.ariaLabel": "缩小画布",
                "controls.fitView.ariaLabel": "适应视图",
                "controls.interactive.ariaLabel": "锁定或解锁画布",
                "minimap.ariaLabel": "缩略地图",
                "handle.ariaLabel": "连接点",
              }}
            >
              <Background color="var(--canvas-grid)" gap={24} />
              {miniMapReady && (
                <StoryMiniMap cards={cards} routes={edgeRoutes} selectedNodeId={selectedNodeId} />
              )}
              <Controls />
            </ReactFlow>
          </section>
          <div
            className="panel-resizer"
            role="separator"
            aria-label="调整右侧编辑栏宽度"
            aria-orientation="vertical"
            title="拖拽调整右侧编辑栏宽度"
            data-help-key="canvas.resizer"
            onPointerDown={resizeInspector}
          />
          <section
            ref={previewStackRef}
            className={`scene-editor-pane${previewCollapsed ? " is-preview-collapsed" : ""}`}
          >
            <PreviewPanel
              collapsed={previewCollapsed}
              workspaceActive={workspaceActive}
              resizing={previewResizing}
              deferRuntimeMount={deferRuntimePreview}
              onCollapsedChange={setPreviewCollapsed}
            />
            <div
              className="preview-splitter"
              role="separator"
              tabIndex={previewCollapsed ? -1 : 0}
              aria-label="调整实时预览高度"
              aria-orientation="horizontal"
              aria-controls="editor-live-preview"
              aria-valuemin={Math.round(previewBounds.minimum * 100)}
              aria-valuemax={Math.round(previewBounds.maximum * 100)}
              aria-valuenow={Math.round(displayedPreviewRatio * 100)}
              data-help-key="preview.resize"
              onPointerDown={resizePreview}
              onKeyDown={resizePreviewWithKeyboard}
            />
            <InspectorPanel />
          </section>
            </main>
          </EditorWorkspace>
        </div>
      </AssistantProjectCreationLockGate>
    </ReactFlowProvider>
  );
}
