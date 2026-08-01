import { Background, BaseEdge, ConnectionLineType, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type DefaultEdgeOptions, type EdgeProps, type Viewport } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { backendClient } from "../../api/backendClient";
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
import { InspectorPanel } from "./InspectorPanel";
import { NodePalette } from "./NodePalette";
import { PreviewPanel } from "./PreviewPanel";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const dynamicFlowNodeClasses = new Set(["is-new-node", "is-new-ai-node", "is-decluttered-node"]);
const orthogonalCornerRadius = 12;
const previewSplitStorageKey = "agentvn.previewSplitRatio";
const previewSplitDefault = 0.4;
const previewSplitMinimum = 0.35;
const previewSplitMaximum = 0.65;
const previewPaneMinimumPx = 240;
const previewSplitterSizePx = 10;

interface OrthogonalEdgeData extends Record<string, unknown> {
  isJunctionEdge?: boolean;
  isBackEdge?: boolean;
  isLoopEdge?: boolean;
  edgeKind?: string;
  edgeRole?: string;
}

type CanvasViewportController = {
  setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => Promise<boolean>;
};

const storyMiniMapWidth = 232;
const storyMiniMapHeight = 92;
const storyMiniMapPadding = 10;
type StoryMiniMapDensityTone = "soft" | "solid" | "dense";
const storyMiniMapDensityPaint: Record<StoryMiniMapDensityTone, { fill: string; stroke: string }> = {
  soft: { fill: "#60a5fa", stroke: "rgba(30, 64, 175, 0.52)" },
  solid: { fill: "#2563eb", stroke: "rgba(30, 64, 175, 0.56)" },
  dense: { fill: "#1e40af", stroke: "rgba(15, 23, 42, 0.56)" },
};
const storyMiniMapNodeColors: Record<string, string> = {
  start: "#137c86",
  scene: "#5965c9",
  choice: "#b45b9f",
  modifier: "#9b6a2f",
  condition: "#3f8f70",
  loop: "#7a6dc8",
  animation: "#c06b4b",
  end: "#9c3d52",
};

function stableNodeClassName(value?: string): string | undefined {
  const classes = value?.split(/\s+/).filter((item) => item && !dynamicFlowNodeClasses.has(item)) ?? [];
  return classes.length > 0 ? classes.join(" ") : undefined;
}

function clampPreviewSplitRatio(value: number, workspaceHeight?: number): number {
  const parsed = Number.isFinite(value) ? value : previewSplitDefault;
  if (!workspaceHeight || workspaceHeight <= previewSplitterSizePx) {
    return Math.min(previewSplitMaximum, Math.max(previewSplitMinimum, parsed));
  }
  const availableHeight = workspaceHeight - previewSplitterSizePx;
  const minimumRatio = Math.max(previewSplitMinimum, previewPaneMinimumPx / availableHeight);
  const maximumRatio = Math.min(previewSplitMaximum, 1 - previewPaneMinimumPx / availableHeight);
  if (minimumRatio > maximumRatio) return previewSplitDefault;
  return Math.min(maximumRatio, Math.max(minimumRatio, parsed));
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

function shouldPreserveNativeUndo(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("input, textarea, select, [contenteditable], [role='textbox']");
  return Boolean(editable);
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

function applyPersistedProjectMetadata(state: SharedEditorState): void {
  const incomingAssets = state.project_metadata.assetManifest;
  const current = useProjectStore.getState();
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

function roundedOrthogonalPath(points: Array<{ x: number; y: number }>, radius = orthogonalCornerRadius): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingLength = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outgoingLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const cornerRadius = Math.min(radius, incomingLength / 2, outgoingLength / 2);
    const incomingX = current.x === previous.x ? current.x : current.x + (previous.x > current.x ? cornerRadius : -cornerRadius);
    const incomingY = current.y === previous.y ? current.y : current.y + (previous.y > current.y ? cornerRadius : -cornerRadius);
    const outgoingX = current.x === next.x ? current.x : current.x + (next.x > current.x ? cornerRadius : -cornerRadius);
    const outgoingY = current.y === next.y ? current.y : current.y + (next.y > current.y ? cornerRadius : -cornerRadius);
    if (cornerRadius <= 0 || (incomingX === outgoingX && incomingY === outgoingY)) {
      path += ` L ${current.x} ${current.y}`;
    } else {
      path += ` L ${incomingX} ${incomingY} Q ${current.x} ${current.y} ${outgoingX} ${outgoingY}`;
    }
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function buildOrthogonalEdgePath(sourceX: number, sourceY: number, targetX: number, targetY: number, data?: OrthogonalEdgeData): string {
  const deltaX = targetX - sourceX;
  const deltaY = targetY - sourceY;
  const sameLane = Math.abs(deltaX) <= 8;
  const isBackEdge = Boolean(data?.isBackEdge) || deltaY <= -24;
  if (sameLane && !isBackEdge) {
    return roundedOrthogonalPath([
      { x: sourceX, y: sourceY },
      { x: sourceX, y: targetY },
      { x: targetX, y: targetY },
    ], 0);
  }

  if (isBackEdge) {
    const side = deltaX >= 0 ? 1 : -1;
    const laneX = side > 0
      ? Math.max(sourceX, targetX) + (data?.isLoopEdge ? 148 : 116)
      : Math.min(sourceX, targetX) - (data?.isLoopEdge ? 148 : 116);
    const exitY = sourceY + (data?.isJunctionEdge ? 62 : 46);
    const entryY = targetY - 46;
    return roundedOrthogonalPath([
      { x: sourceX, y: sourceY },
      { x: sourceX, y: exitY },
      { x: laneX, y: exitY },
      { x: laneX, y: entryY },
      { x: targetX, y: entryY },
      { x: targetX, y: targetY },
    ]);
  }

  const midpointY = Math.round(sourceY + Math.max(48, deltaY / 2));
  return roundedOrthogonalPath([
    { x: sourceX, y: sourceY },
    { x: sourceX, y: midpointY },
    { x: targetX, y: midpointY },
    { x: targetX, y: targetY },
  ]);
}

function OrthogonalEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const edgeData = data as OrthogonalEdgeData | undefined;
  const path = buildOrthogonalEdgePath(sourceX, sourceY, targetX, targetY, edgeData);
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

function StoryMiniMap({
  nodes,
  edges,
  selectedNodeId,
  onNodeClick,
}: {
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId?: string;
  onNodeClick: (event: ReactMouseEvent, node: EditorNode) => void;
}) {
  const contentWidth = storyMiniMapWidth - storyMiniMapPadding * 2;
  const contentHeight = storyMiniMapHeight - storyMiniMapPadding * 2;
  const treeLayout = useMemo(() => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const nodeIds = new Set(nodesById.keys());
    const validEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const outgoing = new Map<string, EditorEdge[]>();
    const incoming = new Map<string, number>();
    for (const edge of validEdges) {
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    }

    const roots = nodes.filter((node) => node.data.nodeKind === "start");
    const fallbackRoots = roots.length > 0 ? roots : nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
    const orderedRoots = (fallbackRoots.length > 0 ? fallbackRoots : nodes.slice(0, 1))
      .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y);
    const positioned = new Set<string>();
    const layoutRows: EditorNode[][] = [];
    let rowCursor = 0;

    const place = (node: EditorNode, depth: number, stack: Set<string>) => {
      if (stack.has(node.id)) return;
      if (!positioned.has(node.id)) {
        const row = layoutRows[depth] ?? [];
        row.push(node);
        layoutRows[depth] = row;
        positioned.add(node.id);
      }
      const nextStack = new Set(stack);
      nextStack.add(node.id);
      const children = [...(outgoing.get(node.id) ?? [])]
        .sort((left, right) => (left.sourceHandle ?? "").localeCompare(right.sourceHandle ?? "") || left.target.localeCompare(right.target))
        .map((edge) => nodesById.get(edge.target))
        .filter((child): child is EditorNode => Boolean(child));
      children.forEach((child) => place(child, depth + 1, nextStack));
    };

    orderedRoots.forEach((root) => {
      place(root, rowCursor, new Set());
      rowCursor = layoutRows.length + 1;
    });
    nodes
      .filter((node) => !positioned.has(node.id))
      .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
      .forEach((node) => {
        place(node, rowCursor, new Set());
        rowCursor = layoutRows.length + 1;
      });

    const compactRows = layoutRows.filter((row) => Array.isArray(row) && row.length > 0);
    const maxColumns = Math.max(1, ...compactRows.map((row) => row.length));
    const rows = Math.max(1, compactRows.length);
    const cellWidth = contentWidth / maxColumns;
    const cellHeight = contentHeight / rows;
    const nodeWidth = Math.max(8, Math.min(18, cellWidth * 0.56));
    const nodeHeight = Math.max(5.5, Math.min(10, cellHeight * 0.44));
    const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
    compactRows.forEach((row, rowIndex) => {
      const rowWidth = row.length * cellWidth;
      const rowOffset = (contentWidth - rowWidth) / 2;
      row.forEach((node, columnIndex) => {
        positions.set(node.id, {
          x: storyMiniMapPadding + rowOffset + columnIndex * cellWidth + (cellWidth - nodeWidth) / 2,
          y: storyMiniMapPadding + rowIndex * cellHeight + (cellHeight - nodeHeight) / 2,
          width: nodeWidth,
          height: nodeHeight,
        });
      });
    });
    return { positions, edges: validEdges };
  }, [contentHeight, contentWidth, edges, nodes]);

  const selectedPosition = selectedNodeId ? treeLayout.positions.get(selectedNodeId) : undefined;

  return (
    <div className="story-minimap" aria-label="?????">
      <svg viewBox={`0 0 ${storyMiniMapWidth} ${storyMiniMapHeight}`} role="img">
        <rect className="story-minimap-frame" x="0.5" y="0.5" width={storyMiniMapWidth - 1} height={storyMiniMapHeight - 1} rx="8" />
        <g className="story-minimap-edges">
          {treeLayout.edges.map((edge) => {
            const source = treeLayout.positions.get(edge.source);
            const target = treeLayout.positions.get(edge.target);
            if (!source || !target) return null;
            const sourceX = source.x + source.width / 2;
            const sourceY = source.y + source.height;
            const targetX = target.x + target.width / 2;
            const targetY = target.y;
            const middleY = sourceY + Math.max(5, (targetY - sourceY) / 2);
            return (
              <path
                key={edge.id}
                className="story-minimap-edge"
                d={`M ${sourceX} ${sourceY} C ${sourceX} ${middleY}, ${targetX} ${middleY}, ${targetX} ${targetY}`}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((node) => {
            const position = treeLayout.positions.get(node.id);
            if (!position) return null;
            const selected = node.id === selectedNodeId;
            return (
              <rect
                key={node.id}
                className={`story-minimap-node${selected ? " is-selected" : ""}`}
                x={position.x}
                y={position.y}
                width={position.width}
                height={position.height}
                rx="1.8"
                fill={storyMiniMapNodeColors[node.data.nodeKind] ?? "#6f7480"}
                stroke={selected ? "#f3b84d" : "#35242a"}
                strokeWidth={selected ? 1.6 : 0.9}
                onClick={(event) => onNodeClick(event, node)}
              />
            );
          })}
        </g>
        {selectedPosition && (
          <rect
            className="story-minimap-viewport"
            x={selectedPosition.x - 2}
            y={selectedPosition.y - 2}
            width={selectedPosition.width + 4}
            height={selectedPosition.height + 4}
            rx="3"
          />
        )}
      </svg>
    </div>
  );
}

function DistributionMiniMap({
  nodes,
  viewport,
  surfaceSize,
}: {
  nodes: EditorNode[];
  viewport: Viewport;
  surfaceSize: { width: number; height: number };
}) {
  const reactFlow = useReactFlow<EditorNode>();
  const contentWidth = storyMiniMapWidth - storyMiniMapPadding * 2;
  const contentHeight = storyMiniMapHeight - storyMiniMapPadding * 2;
  const distribution = useMemo(() => {
    type MiniMapNodeRect = {
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      tone: StoryMiniMapDensityTone;
      centerX: number;
      centerY: number;
      worldCenterX: number;
      worldCenterY: number;
    };
    if (nodes.length === 0) {
      return {
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        scaleX: 1,
        scaleY: 1,
        projectX: (x: number) => x,
        projectY: (y: number) => y,
        offsetX: storyMiniMapPadding,
        offsetY: storyMiniMapPadding,
        drawnWidth: contentWidth,
        drawnHeight: contentHeight,
        nodeRects: [] as MiniMapNodeRect[],
      };
    }
    const nodePoints = nodes.map((node) => {
      const measured = node.measured as { width?: number; height?: number } | undefined;
      const width = measured?.width ?? node.width ?? 300;
      const height = measured?.height ?? node.height ?? 180;
      return {
        id: node.id,
        minX: node.position.x,
        minY: node.position.y,
        maxX: node.position.x + width,
        maxY: node.position.y + height,
        centerX: node.position.x + width / 2,
        centerY: node.position.y + height / 2,
        kind: node.data.nodeKind,
      };
    });
    const bounds = nodePoints.reduce((accumulator, point) => {
      return {
        minX: Math.min(accumulator.minX, point.minX),
        minY: Math.min(accumulator.minY, point.minY),
        maxX: Math.max(accumulator.maxX, point.maxX),
        maxY: Math.max(accumulator.maxY, point.maxY),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const worldWidth = Math.max(1, bounds.maxX - bounds.minX);
    const worldHeight = Math.max(1, bounds.maxY - bounds.minY);
    const drawnWidth = contentWidth;
    const drawnHeight = contentHeight;
    const offsetX = storyMiniMapPadding;
    const offsetY = storyMiniMapPadding;
    const scaleX = drawnWidth / worldWidth;
    const scaleY = drawnHeight / worldHeight;
    const projectX = (x: number) => offsetX + (x - bounds.minX) * scaleX;
    const projectY = (y: number) => offsetY + (y - bounds.minY) * scaleY;
    const miniNodeWidth = nodes.length > 100 ? 4.8 : nodes.length > 60 ? 5.6 : 6.6;
    const miniNodeHeight = nodes.length > 100 ? 2.9 : nodes.length > 60 ? 3.2 : 3.8;
    const toneForNode = (kind: string): StoryMiniMapDensityTone => {
      if (kind === "start" || kind === "end") return "dense";
      if (kind === "choice" || kind === "condition" || kind === "loop") return "solid";
      return "soft";
    };
    const clampRectPosition = (value: number, size: number, min: number, max: number) => {
      if (max - min <= size) return min + Math.max(0, (max - min - size) / 2);
      return Math.min(max - size, Math.max(min, value));
    };
    return {
      bounds,
      scaleX,
      scaleY,
      offsetX,
      offsetY,
      drawnWidth,
      drawnHeight,
      projectX,
      projectY,
      nodeRects: nodePoints.map((point): MiniMapNodeRect => {
        const centerX = projectX(point.centerX);
        const centerY = projectY(point.centerY);
        return {
          id: point.id,
          x: Math.round(clampRectPosition(centerX - miniNodeWidth / 2, miniNodeWidth, offsetX, offsetX + drawnWidth) * 2) / 2,
          y: Math.round(clampRectPosition(centerY - miniNodeHeight / 2, miniNodeHeight, offsetY, offsetY + drawnHeight) * 2) / 2,
          width: miniNodeWidth,
          height: miniNodeHeight,
          tone: toneForNode(point.kind),
          centerX,
          centerY,
          worldCenterX: point.centerX,
          worldCenterY: point.centerY,
        };
      }),
    };
  }, [contentHeight, contentWidth, nodes]);

  const visibleWorld = viewport.zoom > 0 && surfaceSize.width > 0 && surfaceSize.height > 0
    ? {
      x: (0 - viewport.x) / viewport.zoom,
      y: (0 - viewport.y) / viewport.zoom,
      width: surfaceSize.width / viewport.zoom,
      height: surfaceSize.height / viewport.zoom,
    }
    : undefined;

  const handlePointerDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * storyMiniMapWidth;
    const localY = ((event.clientY - rect.top) / rect.height) * storyMiniMapHeight;
    const clampedX = Math.min(distribution.offsetX + distribution.drawnWidth, Math.max(distribution.offsetX, localX));
    const clampedY = Math.min(distribution.offsetY + distribution.drawnHeight, Math.max(distribution.offsetY, localY));
    const xRatio = (clampedX - distribution.offsetX) / Math.max(distribution.drawnWidth, 1);
    const yRatio = (clampedY - distribution.offsetY) / Math.max(distribution.drawnHeight, 1);
    const worldX = distribution.bounds.minX + xRatio * Math.max(1, distribution.bounds.maxX - distribution.bounds.minX);
    const worldY = distribution.bounds.minY + yRatio * Math.max(1, distribution.bounds.maxY - distribution.bounds.minY);
    void reactFlow.setCenter(worldX, worldY, {
      zoom: Math.max(0.28, Math.min(0.82, viewport.zoom || 0.62)),
      duration: 180,
    });
  };
  const clampMiniMapValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const focusPosition = visibleWorld
    ? {
      x: clampMiniMapValue(
        distribution.projectX(visibleWorld.x + visibleWorld.width / 2),
        distribution.offsetX,
        distribution.offsetX + distribution.drawnWidth,
      ),
      y: clampMiniMapValue(
        distribution.projectY(visibleWorld.y + visibleWorld.height / 2),
        distribution.offsetY,
        distribution.offsetY + distribution.drawnHeight,
      ),
    }
    : undefined;
  const focusMarker = focusPosition
    ? {
      x: clampMiniMapValue(focusPosition.x - 7, distribution.offsetX, distribution.offsetX + distribution.drawnWidth - 14),
      y: clampMiniMapValue(focusPosition.y - 5, distribution.offsetY, distribution.offsetY + distribution.drawnHeight - 10),
      width: 14,
      height: 10,
    }
    : undefined;

  return (
    <div className="story-minimap" aria-label="节点分布缩略图" onPointerDown={handlePointerDown}>
      <svg viewBox={`0 0 ${storyMiniMapWidth} ${storyMiniMapHeight}`} role="img">
        <g>
          {distribution.nodeRects.map((node) => {
            const paint = storyMiniMapDensityPaint[node.tone];
            return (
              <rect
                key={node.id}
                className={`story-minimap-distribution-node is-${node.tone}`}
                data-node-id={node.id}
                data-mini-center-x={node.centerX}
                data-mini-center-y={node.centerY}
                data-world-center-x={node.worldCenterX}
                data-world-center-y={node.worldCenterY}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx="1.6"
                fill={paint.fill}
                stroke={paint.stroke}
                strokeWidth="0.65"
              />
            );
          })}
        </g>
        {focusMarker && (
          <>
            <rect
              className="story-minimap-focus-window"
              x={focusMarker.x}
              y={focusMarker.y}
              width={focusMarker.width}
              height={focusMarker.height}
              rx="2.4"
              fill="rgba(245, 158, 11, 0.12)"
              stroke="#d97706"
              strokeWidth="1.35"
            />
            <path
              className="story-minimap-focus-brackets"
              d={`M ${focusMarker.x - 2} ${focusMarker.y + 2} L ${focusMarker.x - 2} ${focusMarker.y - 1} L ${focusMarker.x + 2} ${focusMarker.y - 1} M ${focusMarker.x + focusMarker.width + 2} ${focusMarker.y + 2} L ${focusMarker.x + focusMarker.width + 2} ${focusMarker.y - 1} L ${focusMarker.x + focusMarker.width - 2} ${focusMarker.y - 1} M ${focusMarker.x - 2} ${focusMarker.y + focusMarker.height - 2} L ${focusMarker.x - 2} ${focusMarker.y + focusMarker.height + 1} L ${focusMarker.x + 2} ${focusMarker.y + focusMarker.height + 1} M ${focusMarker.x + focusMarker.width + 2} ${focusMarker.y + focusMarker.height - 2} L ${focusMarker.x + focusMarker.width + 2} ${focusMarker.y + focusMarker.height + 1} L ${focusMarker.x + focusMarker.width - 2} ${focusMarker.y + focusMarker.height + 1}`}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1"
            />
          </>
        )}
      </svg>
    </div>
  );
}

export function VisualNovelEditor({ onReturnHome }: { onReturnHome: () => void }) {
  const [isDeclutteringNodes, setIsDeclutteringNodes] = useState(false);
  const [miniMapReady, setMiniMapReady] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const saved = window.localStorage.getItem("agentvn.inspectorWidth");
    return saved ? Number(saved) : 440;
  });
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  const [previewResizing, setPreviewResizing] = useState(false);
  const [previewSplitRatio, setPreviewSplitRatio] = useState(loadPreviewSplitRatio);
  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const viewport = useEditorStore((state) => state.viewport);
  const flowSurfaceSize = useEditorStore((state) => state.flowSurfaceSize);
  const memoryMode = useEditorStore((state) => state.memoryMode);
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
    [edges, nodes],
  );
  const flowSurfaceRef = useRef<HTMLElement>(null);
  const previewStackRef = useRef<HTMLElement>(null);
  const previewKeyboardResizeTimerRef = useRef<number>();
  const reactFlowInstanceRef = useRef<CanvasViewportController | null>(null);
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
  const editorAppearance = project.settings.editorAppearance;
  const canvasBackgroundImage = editorAppearance.canvasBackgroundImage;
  const canvasBackgroundFit = editorAppearance.canvasBackgroundFit ?? "cover";
  const canvasBackgroundOpacity = editorAppearance.canvasBackgroundOpacity ?? 0.38;
  const shellBackgroundLayerStyle = useMemo<CSSProperties | undefined>(() => {
    const source = canvasBackgroundImage?.dataUrl ?? canvasBackgroundImage?.url;
    if (!source) return undefined;
    return {
      backgroundImage: `url("${source}")`,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      opacity: canvasBackgroundOpacity > 0 ? Math.min(0.48, canvasBackgroundOpacity + 0.12) : 0,
    };
  }, [canvasBackgroundImage?.dataUrl, canvasBackgroundImage?.url, canvasBackgroundOpacity]);
  const flowBackgroundLayerStyle = useMemo<CSSProperties | undefined>(() => {
    const source = canvasBackgroundImage?.dataUrl ?? canvasBackgroundImage?.url;
    if (!source) return undefined;
    return {
      backgroundImage: `url("${source}")`,
      backgroundSize: canvasBackgroundFit === "tile" ? "320px auto" : canvasBackgroundFit,
      backgroundRepeat: canvasBackgroundFit === "tile" ? "repeat" : "no-repeat",
      backgroundPosition: "center",
      opacity: canvasBackgroundOpacity,
    };
  }, [canvasBackgroundFit, canvasBackgroundImage?.dataUrl, canvasBackgroundImage?.url, canvasBackgroundOpacity]);

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
    }, 900);
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (idleId !== undefined) {
        const idleWindow = window as Window & { cancelIdleCallback?: (handle: number) => void };
        idleWindow.cancelIdleCallback?.(idleId);
      }
    };
  }, [nodes.length]);

  const nodeColor = (node: { data?: { nodeKind?: string } }) => {
    switch (node.data?.nodeKind) {
      case "scene":
        return "var(--scene)";
      case "choice":
        return "var(--choice)";
      case "modifier":
        return "var(--modifier)";
      case "condition":
        return "var(--condition)";
      case "loop":
        return "var(--loop)";
      case "animation":
        return "var(--animation)";
      case "start":
        return "var(--start)";
      case "end":
        return "var(--end)";
      default:
        return "var(--surface-3)";
    }
  };

  const focusMiniMapNode = useCallback((event: ReactMouseEvent, miniMapNode: EditorNode) => {
    event.preventDefault();
    event.stopPropagation();
    const target = useEditorStore.getState().nodes.find((item) => item.id === miniMapNode.id);
    if (!target) return;
    selectNode(target.id);
    const measured = target.measured as { width?: number; height?: number } | undefined;
    const centerX = target.position.x + (measured?.width ?? 300) / 2;
    const centerY = target.position.y + (measured?.height ?? 180) / 2;
    window.requestAnimationFrame(() => {
      void reactFlowInstanceRef.current?.setCenter(centerX, centerY, {
        zoom: 0.82,
        duration: 180,
      });
    });
  }, [selectNode]);

  const navigateMiniMapPosition = useCallback((x: number, y: number) => {
    window.requestAnimationFrame(() => {
      void reactFlowInstanceRef.current?.setCenter(x, y, {
        zoom: Math.max(0.28, Math.min(0.82, viewport.zoom || 0.62)),
        duration: 180,
      });
    });
  }, [viewport.zoom]);

  const resizeInspector = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(1120, Math.max(360, startWidth + startX - moveEvent.clientX));
      setInspectorWidth(nextWidth);
      window.localStorage.setItem("agentvn.inspectorWidth", String(nextWidth));
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing-panel");
    };
    document.body.classList.add("is-resizing-panel");
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }, [inspectorWidth]);

  const resizePreview = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (previewCollapsed) return;
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
    const rect = workspace.getBoundingClientRect();
    const availableHeight = Math.max(1, rect.height - previewSplitterSizePx);
    let latestRatio = previewSplitRatio;
    const update = (clientY: number) => {
      latestRatio = clampPreviewSplitRatio((clientY - rect.top) / availableHeight, rect.height);
      setPreviewSplitRatio(latestRatio);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      splitter.removeEventListener("lostpointercapture", onLostPointerCapture);
      window.removeEventListener("blur", onUp);
      document.body.classList.remove("is-resizing-preview");
      setPreviewResizing(false);
      window.localStorage.setItem(previewSplitStorageKey, String(latestRatio));
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId === pointerId) update(moveEvent.clientY);
    };
    const onUp = (upEvent?: Event) => {
      if (upEvent instanceof PointerEvent && upEvent.pointerId !== pointerId) return;
      cleanup();
    };
    const onLostPointerCapture = () => cleanup();
    document.body.classList.add("is-resizing-preview");
    setPreviewResizing(true);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    splitter.addEventListener("lostpointercapture", onLostPointerCapture);
    window.addEventListener("blur", onUp);
    update(event.clientY);
  }, [previewCollapsed, previewSplitRatio]);

  const resizePreviewWithKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (previewCollapsed || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    setPreviewResizing(true);
    if (previewKeyboardResizeTimerRef.current) window.clearTimeout(previewKeyboardResizeTimerRef.current);
    previewKeyboardResizeTimerRef.current = window.setTimeout(() => {
      previewKeyboardResizeTimerRef.current = undefined;
      setPreviewResizing(false);
    }, 120);
    const direction = event.key === "ArrowUp" ? -1 : 1;
    const workspaceHeight = previewStackRef.current?.getBoundingClientRect().height;
    setPreviewSplitRatio((current) => {
      const next = clampPreviewSplitRatio(current + direction * 0.02, workspaceHeight);
      window.localStorage.setItem(previewSplitStorageKey, String(next));
      return next;
    });
  }, [previewCollapsed]);

  useEffect(() => {
    const workspace = previewStackRef.current;
    if (!workspace) return;
    const clampToWorkspace = () => {
      const height = workspace.getBoundingClientRect().height;
      setPreviewSplitRatio((current) => clampPreviewSplitRatio(current, height));
    };
    clampToWorkspace();
    const observer = new ResizeObserver(clampToWorkspace);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);

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
      const viewportNode = surface.querySelector<HTMLElement>(".react-flow__viewport");
      const transform = viewportNode ? window.getComputedStyle(viewportNode).transform : "";
      if (!transform || transform === "none") return;
      const matrix = new DOMMatrixReadOnly(transform);
      if (!Number.isFinite(matrix.a) || matrix.a <= 0) return;
      setViewport({ x: matrix.e, y: matrix.f, zoom: matrix.a });
    };
    const measure = () => {
      const rect = surface.getBoundingClientRect();
      setFlowSurfaceSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
      syncActualViewport();
    };
    measure();
    const timeoutId = window.setTimeout(measure, 250);
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [setFlowSurfaceSize, setViewport]);

  useEffect(() => {
    const current = useEditorStore.getState();
    if (!current.dirty) return;
    const saveTimer = window.setTimeout(() => {
      const next = useEditorStore.getState();
      if (!next.dirty) return;
      void backendClient.saveProjectState({
        project_graph: {
          nodes: next.nodes,
          edges: next.edges,
          viewport: next.viewport,
          memoryMode: next.memoryMode,
        },
        project_metadata: {
          projectId: project.projectId,
          title: project.title,
          author: project.author,
          createdAt: project.createdAt,
          updatedAt: new Date().toISOString(),
          assetManifest: project.assetManifest,
          settings: { ...project.settings },
        },
      }).then((state) => {
        applyPersistedProjectMetadata(state);
        useEditorStore.setState({ dirty: false });
      }).catch((error) => {
        reportFrontendError("editor.project", error, {
          operation: "autosave-graph",
          projectId: project.projectId,
        });
      });
    }, 800);
    return () => window.clearTimeout(saveTimer);
  }, [nodes, edges, viewport, memoryMode, project.assetManifest, project.author, project.createdAt, project.projectId, project.settings, project.title]);

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      void backendClient.saveProjectState({
        project_metadata: {
          projectId: project.projectId,
          title: project.title,
          author: project.author,
          createdAt: project.createdAt,
          updatedAt: new Date().toISOString(),
          assetManifest: project.assetManifest,
          settings: { ...project.settings },
        },
      }).then((state) => {
        applyPersistedProjectMetadata(state);
      }).catch((error) => {
        reportFrontendError("editor.project", error, {
          operation: "autosave-metadata",
          projectId: project.projectId,
        });
      });
    }, 500);
    return () => window.clearTimeout(saveTimer);
  }, [project.assetManifest, project.author, project.createdAt, project.projectId, project.settings, project.title]);

  useEffect(() => {
    function handleGraphHistoryShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || shouldPreserveNativeUndo(event.target)) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const wantsUndo = key === "z" && !event.shiftKey;
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      if (!wantsUndo && !wantsRedo) return;

      const handled = wantsUndo
        ? useEditorStore.getState().undoGraphChange()
        : useEditorStore.getState().redoGraphChange();
      if (handled) event.preventDefault();
    }

    window.addEventListener("keydown", handleGraphHistoryShortcut);
    return () => window.removeEventListener("keydown", handleGraphHistoryShortcut);
  }, []);

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
      <div className={`editor-shell${shellBackgroundLayerStyle ? " has-editor-canvas-background" : ""}`}>
        {shellBackgroundLayerStyle && (
          <div
            className="editor-canvas-background-layer is-shell"
            aria-hidden="true"
            style={shellBackgroundLayerStyle}
          />
        )}
        <EditorToolbar onReturnHome={onReturnHome} />
        <main
          className="editor-workspace"
          style={{
            "--inspector-width": `${inspectorWidth}px`,
            "--preview-split-ratio": `${previewSplitRatio * 100}%`,
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
              onConnect={connectNodes}
              onInit={(instance) => {
                reactFlowInstanceRef.current = instance;
              }}
              onMoveEnd={(_, viewport) => setViewport(viewport)}
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
                <DistributionMiniMap
                  nodes={nodes}
                  viewport={viewport}
                  surfaceSize={flowSurfaceSize}
                />
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
              resizing={previewResizing}
              onCollapsedChange={setPreviewCollapsed}
            />
            <div
              className="preview-splitter"
              role="separator"
              tabIndex={previewCollapsed ? -1 : 0}
              aria-label="调整场景预览区和场景编辑区高度"
              aria-orientation="horizontal"
              aria-valuemin={35}
              aria-valuemax={65}
              aria-valuenow={Math.round(previewSplitRatio * 100)}
              title="拖动或使用 ArrowUp / ArrowDown 调整场景预览区高度"
              data-testid="preview-splitter"
              onPointerDown={resizePreview}
              onKeyDown={resizePreviewWithKeyboard}
            />
            <InspectorPanel />
          </section>
        </main>
      </div>
    </ReactFlowProvider>
  );
}
