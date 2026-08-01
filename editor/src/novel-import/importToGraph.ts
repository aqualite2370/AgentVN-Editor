import type { Edge } from "@xyflow/react";
import type { AdaptedScene } from "./types";
import type { EditorNode } from "../types/nodes";
import type { MemoryMode } from "../types/memory";
import { buildPendingVisualAssetsForScene, ensureSceneHasBackgroundPlaceholder } from "../utils/assetAudit";

export interface NovelImportLayout {
  importLineId: string;
  sessionId: string;
  startPosition: { x: number; y: number };
  columnGap: number;
  rowGap: number;
  columns: number;
}

export function createNovelImportLayout(existingNodes: EditorNode[], sessionId: string): NovelImportLayout {
  const bounds = existingNodes.reduce(
    (acc, node) => ({
      maxX: Math.max(acc.maxX, node.position?.x ?? 0),
      minY: Math.min(acc.minY, node.position?.y ?? 0),
    }),
    { maxX: 240, minY: 180 },
  );
  return {
    importLineId: `novel_line_${Date.now()}`,
    sessionId,
    startPosition: { x: bounds.maxX + 460, y: Math.max(120, bounds.minY) },
    columnGap: 360,
    rowGap: 220,
    columns: 4,
  };
}

export function novelImportPosition(layout: NovelImportLayout, index: number): { x: number; y: number } {
  const row = Math.floor(index / layout.columns);
  const columnInRow = index % layout.columns;
  const column = row % 2 === 0 ? columnInRow : layout.columns - 1 - columnInRow;
  return {
    x: layout.startPosition.x + column * layout.columnGap,
    y: layout.startPosition.y + row * layout.rowGap,
  };
}

export function adaptedSceneToNode(
  adapted: AdaptedScene,
  layout: NovelImportLayout,
  index: number,
  memoryMode: MemoryMode = "none",
): EditorNode {
  const backgroundResult = ensureSceneHasBackgroundPlaceholder(adapted.scene_beat);
  const scene = backgroundResult.scene;
  const nodeId = `novel_node_${layout.importLineId}_${scene.scene_id}`;
  return {
    id: nodeId,
    type: "sceneNode",
    position: novelImportPosition(layout, index),
    data: {
      nodeKind: "scene",
      scene,
      label: scene.scene_display_name ?? scene.title,
      description: scene.summary,
      memoryMode,
      aiSettings: { authorGoal: "根据导入的小说文本生成。", autoExtractMemory: false, autoApplyMemory: false },
      previewState: { currentCommandIndex: 0, isPlaying: false },
      editorMeta: {
        collapsedInspectorSections: [],
        source: "imported",
        sourceMapping: adapted.source_mapping,
        needsReview: adapted.needs_review,
        importSessionId: layout.sessionId,
        importLineId: layout.importLineId,
        importIndex: index,
        pendingVisualAssets: buildPendingVisualAssetsForScene(scene, { nodeId }),
      },
    },
  };
}

export function importedNovelEdge(importLineId: string, sourceId: string, targetId: string, index: number): Edge {
  return { id: `novel_edge_${importLineId}_${index}`, source: sourceId, target: targetId, sourceHandle: "default" };
}

export function adaptedScenesToLinearGraph(adaptedScenes: AdaptedScene[], startPosition = { x: 240, y: 180 }): { nodes: EditorNode[]; edges: Edge[] } {
  const layout: NovelImportLayout = {
    importLineId: `novel_line_${Date.now()}`,
    sessionId: "legacy_import",
    startPosition,
    columnGap: 340,
    rowGap: 160,
    columns: Math.max(1, adaptedScenes.length),
  };
  const nodes = adaptedScenes.map((adapted, index) => adaptedSceneToNode(adapted, layout, index));
  const edges: Edge[] = nodes.slice(0, -1).map((node, index) => importedNovelEdge(layout.importLineId, node.id, nodes[index + 1].id, index));
  return { nodes, edges };
}
