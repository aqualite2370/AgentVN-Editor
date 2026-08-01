import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type Viewport } from "@xyflow/react";
import { create } from "zustand";
import { nanoid } from "nanoid";
import type { GenerationTraceEvent } from "../api/types";
import type { DialogCommand, GameCommand, NarrationCommand } from "../types/commands";
import type { MemoryMode } from "../types/memory";
import type { EditorEdge, EditorNode, EditorNodeData, EditorProjectFile, RuntimeScript } from "../types/nodes";
import type { SceneBeat } from "../types/scene";
import { computeAutoArrangeLayout, type AutoArrangeOptions, type AutoArrangeResult } from "../utils/autoArrangeGraph";
import { exportScript as buildRuntimeScript } from "../utils/exportScript";
import { cloneNode, createNodeByKind, createSceneNode, createStartNode } from "../utils/nodeFactory";
import {
  migrateAllAnimationNodes as migrateAllAnimationNodesGraph,
  migrateAnimationNode as migrateAnimationNodeGraph,
  type AnimationNodeBatchMigrationResult,
  type AnimationNodeMigrationMode,
} from "../utils/animationNodeMigration";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

export type EditorNoticeTone = "info" | "success" | "warning" | "error";
type RecentNodeEffectSource = "manual" | "ai" | "imported" | "duplicate" | "declutter";
const EDITOR_GRAPH_HISTORY_LIMIT = 50;

type EditorGraphHistoryBatch = "node-drag";

interface EditorGraphHistorySnapshot {
  nodes: EditorNode[];
  edges: EditorEdge[];
  viewport: Viewport;
  memoryMode: MemoryMode;
  selectedNodeId?: string;
  selectedEdgeId?: string;
}

interface EditorGraphHistory {
  past: EditorGraphHistorySnapshot[];
  future: EditorGraphHistorySnapshot[];
  activeBatch?: EditorGraphHistoryBatch;
}

export interface EditorNotice {
  message: string;
  tone?: EditorNoticeTone;
  reportable?: boolean;
  source?: string;
  detail?: string;
  action?: string;
  occurredAt?: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

interface EditorStoreState {
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId?: string;
  selectedEdgeId?: string;
  selectionRevision: number;
  viewport: Viewport;
  flowSurfaceSize: { width: number; height: number };
  recentNodeEffects: Record<string, { source: RecentNodeEffectSource; createdAt: number }>;
  memoryMode: MemoryMode;
  dirty: boolean;
  graphHistory: EditorGraphHistory;
  lastError?: EditorNotice;
  activeGeneration?: {
    nodeId: string;
    token: string;
    startedAt: number;
  };
  generationDebug?: {
    nodeId: string;
    startedAt: number;
    status?: string;
    decisionText: string;
    traces: GenerationTraceEvent[];
  };
}

interface EditorStoreActions {
  setNodes: (nodes: EditorNode[]) => void;
  setEdges: (edges: EditorEdge[]) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNode: (node: EditorNode) => void;
  createNode: (nodeKind: EditorNodeData["nodeKind"], position?: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, patch: Partial<EditorNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => void;
  selectNode: (nodeId?: string) => void;
  connectNodes: (connection: Connection) => void;
  connectChoiceTargetsFromSceneIds: (sourceNodeId: string) => number;
  disconnectEdge: (edgeId: string) => void;
  updateSceneCommands: (nodeId: string, commands: GameCommand[]) => void;
  migrateAnimationNode: (nodeId: string, mode?: AnimationNodeMigrationMode) => AnimationNodeMigrationMode | undefined;
  migrateAllAnimationNodes: () => AnimationNodeBatchMigrationResult | undefined;
  applyDialogPortraitToCharacter: (characterId: string, portrait: string) => number;
  applyDialogTextStyleToCharacter: (characterId: string, style: NonNullable<DialogCommand["dialog_style"]>) => number;
  applyNarrationStyleToAll: (style: NonNullable<NarrationCommand["dialog_style"]>) => number;
  updateMemoryMode: (memoryMode: MemoryMode, nodeId?: string) => void;
  beginGeneration: (nodeId: string) => { ok: true; token: string } | { ok: false; activeNodeId: string };
  endGeneration: (token: string) => void;
  resetGenerationDebug: (nodeId: string) => void;
  setGenerationDebugStatus: (status: string) => void;
  appendGenerationDecisionDelta: (delta: string) => void;
  addGenerationTrace: (trace: GenerationTraceEvent) => void;
  applyGeneratedScene: (sourceNodeId: string, scene: SceneBeat) => { node: EditorNode; linked: boolean };
  applyGeneratedBranchScene: (sourceNodeId: string, choiceId: string, scene: SceneBeat, options?: { branchIndex?: number; branchCount?: number }) => { node?: EditorNode; linked: boolean };
  applyGeneratedSceneToNode: (nodeId: string, scene: SceneBeat, options?: { preserveSceneId?: boolean; preserveChapter?: boolean; generatedFromNodeId?: string }) => { node?: EditorNode; replaced: boolean };
  autoArrangeNodes: (options?: AutoArrangeOptions) => AutoArrangeResult;
  getSpawnPosition: (nodeKind: EditorNodeData["nodeKind"]) => { x: number; y: number };
  declutterNodesAround: (nodeIds: string[]) => string[];
  declutterOverlappingNodes: () => string[];
  registerNewNodeEffect: (nodeId: string, source: RecentNodeEffectSource) => void;
  clearNewNodeEffect: (nodeId: string) => void;
  recordGraphHistory: () => void;
  beginGraphHistoryBatch: (batch: EditorGraphHistoryBatch) => void;
  endGraphHistoryBatch: (batch: EditorGraphHistoryBatch) => void;
  undoGraphChange: () => boolean;
  redoGraphChange: () => boolean;
  importProject: (project: EditorProjectFile) => void;
  importProjectAsRoute: (project: EditorProjectFile) => { nodes: number; edges: number; selectedNodeId?: string };
  resetGraph: () => void;
  exportProject: (metadata: { projectId: string; title: string; author: string; assetManifest: unknown[]; editorSettings?: Record<string, unknown>; createdAt?: string }) => EditorProjectFile;
  exportScript: () => RuntimeScript;
  setViewport: (viewport: Viewport) => void;
  setFlowSurfaceSize: (size: { width: number; height: number }) => void;
  setNotice: (notice?: string | EditorNotice, tone?: EditorNoticeTone, detail?: string) => void;
  setLastError: (notice?: string | EditorNotice, tone?: EditorNoticeTone, detail?: string) => void;
}

const initialNodes: EditorNode[] = [
  createStartNode({ x: 40, y: 220 }, "hybrid"),
  createSceneNode({ x: 280, y: 180 }, "hybrid", {
    scene_id: "scene_opening",
    title: "\u5F00\u573A",
    summary: "\u96E8\u591C\u91CC\uFF0C\u4E3B\u89D2\u62B5\u8FBE\u65E7\u8F66\u7AD9\u3002",
    commands: [
      { type: "background", background_id: "station_rain", background_fit: "stretch", transition: "fade" },
      { type: "narration", text: "\u96E8\u6C34\u6CBF\u7740\u7AD9\u724C\u8FB9\u7F18\u6EF4\u843D\u3002" },
      { type: "dialog", character_id: "alice", text: "\u4F60\u7EC8\u4E8E\u6765\u4E86\u3002", emotion: "calm", side: "left" },
    ],
    tags: ["opening"],
    chapter: 1,
  }),
];

const initialEdges: EditorEdge[] = [{ id: "edge_start_opening", source: "start", target: "node_scene_opening", sourceHandle: "default" }];

function arrangedInitialNodes(): EditorNode[] {
  const nodes = structuredClone(initialNodes);
  const layout = computeAutoArrangeLayout(nodes, initialEdges, { scope: "all" });
  return nodes.map((node) => {
    const position = layout.positions[node.id];
    return position ? { ...node, position } : node;
  });
}

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeNode(node: EditorNode, index: number): EditorNode | undefined {
  if (!node || typeof node.id !== "string" || !node.data || typeof node.data.nodeKind !== "string") {
    return undefined;
  }

  const x = hasFiniteNumber(node.position?.x) ? node.position.x : 240 + index * 80;
  const y = hasFiniteNumber(node.position?.y) ? node.position.y : 180 + index * 60;
  return {
    ...node,
    position: { x, y },
    data: {
      ...node.data,
      label: typeof node.data.label === "string" ? node.data.label : "未命名节点",
      description: typeof node.data.description === "string" ? node.data.description : "",
      aiSettings: node.data.aiSettings ?? {
        authorGoal: "延续当前剧情，并保持角色动机一致。",
        generationOutline: "",
        autoExtractMemory: true,
        autoApplyMemory: false,
      },
      previewState: node.data.previewState ?? { currentCommandIndex: 0, isPlaying: false },
      editorMeta: node.data.editorMeta ?? { collapsedInspectorSections: [], source: "manual" },
      loadingAnimation: node.data.nodeKind === "start" ? node.data.loadingAnimation ?? { kind: "default" } : node.data.loadingAnimation,
    },
  };
}

function nodeNeedsRepair(node: EditorNode | undefined): boolean {
  return !node ||
    typeof node.id !== "string" ||
    !node.data ||
    typeof node.data.nodeKind !== "string" ||
    !hasFiniteNumber(node.position?.x) ||
    !hasFiniteNumber(node.position?.y) ||
    typeof node.data.label !== "string" ||
    typeof node.data.description !== "string" ||
    !node.data.aiSettings ||
    !node.data.previewState ||
    !node.data.editorMeta;
}

function sanitizeNodes(nodes: EditorNode[] | undefined): EditorNode[] {
  const sanitized = (Array.isArray(nodes) ? nodes : [])
    .map((node, index) => sanitizeNode(node, index))
    .filter((node): node is EditorNode => Boolean(node));
  return sanitized.length > 0 ? sanitized : structuredClone(initialNodes);
}

function sanitizeEdges(edges: EditorEdge[] | undefined, nodes: EditorNode[]): EditorEdge[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return (Array.isArray(edges) ? edges : []).filter((edge) => {
    return typeof edge.id === "string" && nodeIds.has(edge.source) && nodeIds.has(edge.target);
  });
}

function isInitialNodeSet(nodes: EditorNode[]): boolean {
  return nodes.length === initialNodes.length && initialNodes.every((node) => nodes.some((item) => item.id === node.id));
}

function sanitizeViewport(viewport: Viewport | undefined): Viewport {
  return {
    x: hasFiniteNumber(viewport?.x) ? viewport.x : 0,
    y: hasFiniteNumber(viewport?.y) ? viewport.y : 0,
    zoom: hasFiniteNumber(viewport?.zoom) && viewport.zoom > 0 ? viewport.zoom : 1,
  };
}

function emptyGraphHistory(): EditorGraphHistory {
  return { past: [], future: [] };
}

function captureGraphSnapshot(state: Pick<EditorStoreState, "nodes" | "edges" | "viewport" | "memoryMode" | "selectedNodeId" | "selectedEdgeId">): EditorGraphHistorySnapshot {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    viewport: { ...state.viewport },
    memoryMode: state.memoryMode,
    selectedNodeId: state.selectedNodeId,
    selectedEdgeId: state.selectedEdgeId,
  };
}

function restoreGraphSnapshot(snapshot: EditorGraphHistorySnapshot, state: EditorStoreState): Partial<EditorStoreState> {
  return {
    nodes: structuredClone(snapshot.nodes),
    edges: structuredClone(snapshot.edges),
    viewport: { ...snapshot.viewport },
    memoryMode: snapshot.memoryMode,
    selectedNodeId: snapshot.selectedNodeId,
    selectedEdgeId: snapshot.selectedEdgeId,
    selectionRevision: state.selectionRevision + 1,
    recentNodeEffects: {},
    dirty: true,
  };
}

function pushGraphHistory(state: EditorStoreState, batch?: EditorGraphHistoryBatch): EditorGraphHistory {
  if (state.graphHistory.activeBatch) {
    return batch && state.graphHistory.activeBatch === batch
      ? state.graphHistory
      : state.graphHistory;
  }
  return {
    past: [...state.graphHistory.past, captureGraphSnapshot(state)].slice(-EDITOR_GRAPH_HISTORY_LIMIT),
    future: [],
    activeBatch: batch,
  };
}

function withGraphHistory<T extends Partial<EditorStoreState>>(state: EditorStoreState, patch: T): T & { graphHistory: EditorGraphHistory } {
  return { ...patch, graphHistory: pushGraphHistory(state) };
}

function isDefaultSourceHandle(sourceHandle?: string | null): boolean {
  return !sourceHandle || sourceHandle === "default";
}

function syntheticSceneId(node: EditorNode): string {
  return `${node.data.nodeKind}_${node.id}`;
}

function runtimeSceneIdForNode(node: EditorNode | undefined): string {
  if (!node) return "";
  return node.data.scene?.scene_id ?? syntheticSceneId(node);
}

function choicesForBranchSource(node: EditorNode | undefined): Array<{ choice_id: string; target_scene_id: string }> {
  if (!node) return [];
  if (node.data.nodeKind === "choice" && node.data.choice) {
    return node.data.choice.choices.map((choice) => ({
      choice_id: choice.choice_id,
      target_scene_id: choice.target_scene_id,
    }));
  }
  if (node.data.nodeKind === "scene" && node.data.scene) {
    return node.data.scene.commands.flatMap((command) => {
      if (command.type !== "choice") return [];
      return command.choices.map((choice) => ({
        choice_id: choice.choice_id,
        target_scene_id: choice.target_scene_id,
      }));
    });
  }
  return [];
}

function uniqueGeneratedScene(scene: SceneBeat, nodes: EditorNode[]): SceneBeat {
  const usedSceneIds = new Set(nodes.map((node) => node.data.scene?.scene_id).filter((id): id is string => Boolean(id)));
  const rawBase = scene.scene_id?.trim() || `scene_ai_${nanoid(6)}`;
  const base = rawBase.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+/, "") || `scene_ai_${nanoid(6)}`;
  if (!usedSceneIds.has(base)) return { ...scene, scene_id: base };
  let index = 2;
  while (usedSceneIds.has(`${base}_${index}`)) index += 1;
  return { ...scene, scene_id: `${base}_${index}` };
}

function syncChoiceTargetForConnection(nodes: EditorNode[], connection: Connection): EditorNode[] {
  if (!connection.source || !connection.target || !connection.sourceHandle || isDefaultSourceHandle(connection.sourceHandle)) return nodes;
  const targetSceneId = runtimeSceneIdForNode(nodes.find((node) => node.id === connection.target));
  if (!targetSceneId) return nodes;
  return nodes.map((node) => {
    if (node.id !== connection.source) return node;
    if (node.data.nodeKind === "choice" && node.data.choice) {
      const choices = node.data.choice.choices.map((choice) =>
        choice.choice_id === connection.sourceHandle ? { ...choice, target_scene_id: targetSceneId } : choice
      );
      return { ...node, data: { ...node.data, choice: { ...node.data.choice, choices } } };
    }
    if (node.data.nodeKind === "scene" && node.data.scene) {
      const commands = node.data.scene.commands.map((command) => {
        if (command.type !== "choice") return command;
        return {
          ...command,
          choices: command.choices.map((choice) =>
            choice.choice_id === connection.sourceHandle ? { ...choice, target_scene_id: targetSceneId } : choice
          ),
        };
      });
      return { ...node, data: { ...node.data, scene: { ...node.data.scene, commands } } };
    }
    return node;
  });
}

function clearChoiceTargetForRemovedEdge(nodes: EditorNode[], edge: EditorEdge | undefined): EditorNode[] {
  if (!edge?.sourceHandle || isDefaultSourceHandle(edge.sourceHandle)) return nodes;
  const removedTargetSceneId = runtimeSceneIdForNode(nodes.find((node) => node.id === edge.target));
  return nodes.map((node) => {
    if (node.id !== edge.source) return node;
    if (node.data.nodeKind === "choice" && node.data.choice) {
      const choices = node.data.choice.choices.map((choice) =>
        choice.choice_id === edge.sourceHandle && choice.target_scene_id === removedTargetSceneId
          ? { ...choice, target_scene_id: "" }
          : choice
      );
      return { ...node, data: { ...node.data, choice: { ...node.data.choice, choices } } };
    }
    if (node.data.nodeKind === "scene" && node.data.scene) {
      const commands = node.data.scene.commands.map((command) => {
        if (command.type !== "choice") return command;
        return {
          ...command,
          choices: command.choices.map((choice) =>
            choice.choice_id === edge.sourceHandle && choice.target_scene_id === removedTargetSceneId
              ? { ...choice, target_scene_id: "" }
              : choice
          ),
        };
      });
      return { ...node, data: { ...node.data, scene: { ...node.data.scene, commands } } };
    }
    return node;
  });
}

function safeIdPart(value: string | undefined, fallback: string): string {
  const safe = (value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+/, "").slice(0, 72);
  return safe || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${index}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function graphBounds(nodes: EditorNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) return { minX: 240, minY: 180, maxX: 240, maxY: 180 };
  return nodes.reduce((bounds, node) => {
    const rect = existingNodeRect(node);
    return {
      minX: Math.min(bounds.minX, rect.x),
      minY: Math.min(bounds.minY, rect.y),
      maxX: Math.max(bounds.maxX, rect.x + rect.width),
      maxY: Math.max(bounds.maxY, rect.y + rect.height),
    };
  }, { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
}

function remapRouteTarget(targetSceneId: string | undefined, sceneIdMap: Map<string, string>): string {
  if (!targetSceneId) return "";
  return sceneIdMap.get(targetSceneId) ?? "";
}

function remapRouteCommandTargets(command: GameCommand, sceneIdMap: Map<string, string>): GameCommand {
  if (command.type === "choice") {
    return {
      ...command,
      choices: command.choices.map((choice) => ({
        ...choice,
        target_scene_id: remapRouteTarget(choice.target_scene_id, sceneIdMap),
      })),
    };
  }
  if (command.type === "conditional_jump") {
    return {
      ...command,
      target_scene_id: remapRouteTarget(command.target_scene_id, sceneIdMap),
      else_target_scene_id: command.else_target_scene_id ? remapRouteTarget(command.else_target_scene_id, sceneIdMap) : command.else_target_scene_id,
    };
  }
  return command;
}

function sanitizeImportedRouteNodes(nodes: EditorNode[] | undefined): EditorNode[] {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node, index) => sanitizeNode(node, index))
    .filter((node): node is EditorNode => Boolean(node));
}

function createRouteImportGraph(project: EditorProjectFile, currentNodes: EditorNode[], currentEdges: EditorEdge[]): {
  nodes: EditorNode[];
  edges: EditorEdge[];
  selectedNodeId?: string;
} {
  const routeId = nanoid(6);
  const importedNodes = sanitizeImportedRouteNodes(project.nodes).filter((node) => node.data.nodeKind !== "start");
  if (importedNodes.length === 0) return { nodes: [], edges: [] };

  const usedNodeIds = new Set(currentNodes.map((node) => node.id));
  const usedSceneIds = new Set(currentNodes.map((node) => node.data.scene?.scene_id).filter((sceneId): sceneId is string => Boolean(sceneId)));
  const nodeIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();
  const projectIdPart = safeIdPart(project.project_id, "project");

  importedNodes.forEach((node, index) => {
    nodeIdMap.set(node.id, uniqueId(`${node.data.nodeKind}_${routeId}_${safeIdPart(node.id, String(index + 1))}`, usedNodeIds));
    if (node.data.scene?.scene_id) {
      sceneIdMap.set(node.data.scene.scene_id, uniqueId(`scene_${routeId}_${projectIdPart}_${safeIdPart(node.data.scene.scene_id, String(index + 1))}`, usedSceneIds));
    }
  });

  const currentBounds = graphBounds(currentNodes);
  const importedBounds = graphBounds(importedNodes);
  const targetX = currentNodes.length > 0 ? currentBounds.maxX + 460 : 280;
  const targetY = currentNodes.length > 0 ? currentBounds.minY : 180;
  const offsetX = targetX - importedBounds.minX;
  const offsetY = targetY - importedBounds.minY;

  const routeNodes: EditorNode[] = importedNodes.map((node, index): EditorNode => {
    const nextNode = structuredClone(node) as EditorNode;
    const nextScene = nextNode.data.scene
      ? {
        ...nextNode.data.scene,
        scene_id: sceneIdMap.get(nextNode.data.scene.scene_id) ?? nextNode.data.scene.scene_id,
        commands: nextNode.data.scene.commands.map((command) => remapRouteCommandTargets(command, sceneIdMap)),
      }
      : undefined;
    const nextChoice = nextNode.data.choice
      ? {
        ...nextNode.data.choice,
        choices: nextNode.data.choice.choices.map((choice) => ({
          ...choice,
          target_scene_id: remapRouteTarget(choice.target_scene_id, sceneIdMap),
        })),
      }
      : undefined;
    return {
      ...nextNode,
      id: nodeIdMap.get(node.id) ?? nextNode.id,
      selected: false,
      position: { x: nextNode.position.x + offsetX, y: nextNode.position.y + offsetY },
      data: {
        ...nextNode.data,
        scene: nextScene,
        choice: nextChoice,
        editorMeta: {
          ...nextNode.data.editorMeta,
          source: "imported" as const,
          importLineId: routeId,
          importIndex: index,
          debugNotes: [
            nextNode.data.editorMeta?.debugNotes,
            `Imported as an isolated route from ${project.title || project.project_id}; connect it manually when it should join the playable flow.`,
          ].filter(Boolean).join("\n"),
        },
      },
    };
  });

  const usedEdgeIds = new Set(currentEdges.map((edge) => edge.id));
  const routeEdges = (Array.isArray(project.edges) ? project.edges : [])
    .filter((edge) => nodeIdMap.has(edge.source) && nodeIdMap.has(edge.target))
    .map((edge, index): EditorEdge => ({
      ...edge,
      id: uniqueId(`edge_${routeId}_${safeIdPart(edge.id, String(index + 1))}`, usedEdgeIds),
      source: nodeIdMap.get(edge.source) ?? edge.source,
      target: nodeIdMap.get(edge.target) ?? edge.target,
      selected: false,
    }));

  const importedStartTargets = (Array.isArray(project.edges) ? project.edges : [])
    .filter((edge) => project.nodes.some((node) => node.id === edge.source && node.data.nodeKind === "start"))
    .map((edge) => nodeIdMap.get(edge.target))
    .filter((nodeId): nodeId is string => Boolean(nodeId));
  return {
    nodes: routeNodes,
    edges: routeEdges,
    selectedNodeId: importedStartTargets[0] ?? routeNodes[0]?.id,
  };
}

function estimatedNodeSize(nodeKind: EditorNodeData["nodeKind"]): { width: number; height: number } {
  if (nodeKind === "scene") return { width: 300, height: 240 };
  if (nodeKind === "start" || nodeKind === "end") return { width: 300, height: 140 };
  return { width: 300, height: 170 };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap = 28,
): boolean {
  return !(
    a.x + a.width + gap < b.x ||
    b.x + b.width + gap < a.x ||
    a.y + a.height + gap < b.y ||
    b.y + b.height + gap < a.y
  );
}

function existingNodeRect(node: EditorNode): { x: number; y: number; width: number; height: number } {
  const measured = node.measured as { width?: number; height?: number } | undefined;
  const size = estimatedNodeSize(node.data.nodeKind);
  return {
    x: node.position.x,
    y: node.position.y,
    width: hasFiniteNumber(measured?.width) ? measured.width : size.width,
    height: hasFiniteNumber(measured?.height) ? measured.height : size.height,
  };
}

function overlapArea(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return x * y;
}

function overlapRatio(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const smaller = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlapArea(a, b) / smaller;
}

function rectFromPosition(node: EditorNode, position = node.position): { x: number; y: number; width: number; height: number } {
  const rect = existingNodeRect(node);
  return { ...rect, x: position.x, y: position.y };
}

function sortedNodesForLayout(nodes: EditorNode[], focusIds: Set<string>): EditorNode[] {
  return [...nodes].sort((a, b) => {
    const focusDelta = Number(focusIds.has(a.id)) - Number(focusIds.has(b.id));
    if (focusDelta !== 0) return focusDelta;
    if (a.position.y !== b.position.y) return a.position.y - b.position.y;
    return a.position.x - b.position.x;
  });
}

function findDeclutterCluster(nodes: EditorNode[], focusIds: Set<string>): EditorNode[] {
  if (focusIds.size === 0) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const clusterIds = new Set([...focusIds].filter((id) => byId.has(id)));
  let changed = true;
  while (changed) {
    changed = false;
    const cluster = nodes.filter((node) => clusterIds.has(node.id));
    for (const node of nodes) {
      if (clusterIds.has(node.id)) continue;
      const rect = existingNodeRect(node);
      const joinsCluster = cluster.some((clusterNode) => {
        const clusterRect = existingNodeRect(clusterNode);
        return overlapRatio(rect, clusterRect) >= 0.12 || rectsOverlap(rect, clusterRect, -18);
      });
      if (joinsCluster) {
        clusterIds.add(node.id);
        changed = true;
      }
    }
  }
  return sortedNodesForLayout(nodes.filter((node) => clusterIds.has(node.id)), focusIds);
}

function clusterNeedsDeclutter(cluster: EditorNode[]): boolean {
  if (cluster.length < 2) return false;
  let heavyOverlapCount = 0;
  for (let i = 0; i < cluster.length; i += 1) {
    for (let j = i + 1; j < cluster.length; j += 1) {
      const ratio = overlapRatio(existingNodeRect(cluster[i]), existingNodeRect(cluster[j]));
      if (ratio >= 0.35) return true;
      if (ratio >= 0.15) heavyOverlapCount += 1;
    }
  }
  return cluster.length >= 3 && heavyOverlapCount >= 2;
}

function wouldOverlapTooMuch(
  candidate: { x: number; y: number; width: number; height: number },
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return rects.some((rect) => overlapRatio(candidate, rect) > 0.15 || rectsOverlap(candidate, rect, 18));
}

function declutterClusterPositions(nodes: EditorNode[], focusIds: Set<string>): { nodes: EditorNode[]; movedIds: string[] } {
  const cluster = findDeclutterCluster(nodes, focusIds);
  if (!clusterNeedsDeclutter(cluster)) return { nodes, movedIds: [] };

  const anchor = cluster[0];
  const maxWidth = Math.max(...cluster.map((node) => existingNodeRect(node).width), 300);
  const maxHeight = Math.max(...cluster.map((node) => existingNodeRect(node).height), 170);
  const columnGap = 88;
  const rowGap = 64;
  const columns = cluster.length >= 5 ? 3 : 2;
  const stableRects = nodes
    .filter((node) => !cluster.some((clusterNode) => clusterNode.id === node.id))
    .map(existingNodeRect);
  const placedRects = [existingNodeRect(anchor)];
  const movedPositions = new Map<string, { x: number; y: number }>();

  cluster.slice(1).forEach((node, index) => {
    const rect = existingNodeRect(node);
    const column = index % columns;
    const row = Math.floor(index / columns);
    let candidate = {
      x: Math.round(anchor.position.x + (column + 1) * (maxWidth + columnGap)),
      y: Math.round(anchor.position.y + row * (maxHeight + rowGap) + (column % 2) * 28),
      width: rect.width,
      height: rect.height,
    };
    let guard = 0;
    while (wouldOverlapTooMuch(candidate, [...stableRects, ...placedRects]) && guard < 16) {
      candidate = { ...candidate, y: candidate.y + Math.round(maxHeight + rowGap) };
      guard += 1;
    }
    placedRects.push(candidate);
    if (Math.abs(candidate.x - node.position.x) > 1 || Math.abs(candidate.y - node.position.y) > 1) {
      movedPositions.set(node.id, { x: candidate.x, y: candidate.y });
    }
  });

  if (movedPositions.size === 0) return { nodes, movedIds: [] };
  return {
    nodes: nodes.map((node) => {
      const position = movedPositions.get(node.id);
      return position ? { ...node, position } : node;
    }),
    movedIds: [...movedPositions.keys()],
  };
}

function dispatchDeclutterAnimation(movedIds: string[]) {
  if (typeof window === "undefined" || movedIds.length === 0) return;
  window.dispatchEvent(new CustomEvent("agentvn:nodes-declutter", { detail: { nodeIds: movedIds } }));
}

function spiralOffsets(step = 96, rings = 7): Array<{ x: number; y: number }> {
  const offsets = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= rings; ring += 1) {
    const radius = ring * step;
    offsets.push(
      { x: radius, y: 0 },
      { x: 0, y: radius },
      { x: -radius, y: 0 },
      { x: 0, y: -radius },
      { x: radius, y: radius },
      { x: -radius, y: radius },
      { x: radius, y: -radius },
      { x: -radius, y: -radius },
    );
  }
  return offsets;
}

function normalizeStoreNotice(
  notice: string | EditorNotice | undefined,
  tone: EditorNoticeTone,
  detail?: string,
): EditorNotice | undefined {
  if (!notice) return undefined;
  if (typeof notice === "string") {
    return { message: notice, tone, detail, occurredAt: new Date().toISOString() };
  }
  return {
    ...notice,
    tone: notice.tone ?? tone,
    detail: notice.detail ?? detail,
    occurredAt: notice.occurredAt ?? new Date().toISOString(),
  };
}

function logStoreNotice(notice: EditorNotice | undefined): void {
  if (!notice || notice.tone !== "error" || notice.reportable === false) return;
  reportFrontendError("editor.notice", notice.error ?? notice.message, {
    source: notice.source,
    detail: notice.detail,
    action: notice.action,
    context: notice.context,
  });
}

export const useEditorStore = create<EditorStoreState & EditorStoreActions>()(
  (set, get) => ({
      nodes: initialNodes,
      edges: initialEdges,
      selectedNodeId: "node_scene_opening",
      selectionRevision: 0,
      viewport: { x: 0, y: 0, zoom: 1 },
      flowSurfaceSize: { width: 0, height: 0 },
      recentNodeEffects: {},
      memoryMode: "hybrid",
      dirty: false,
      graphHistory: emptyGraphHistory(),

      setNodes: (nodes) => set((state) => {
        const sanitizedNodes = sanitizeNodes(nodes);
        return withGraphHistory(state, { nodes: sanitizedNodes, edges: sanitizeEdges(state.edges, sanitizedNodes), dirty: true });
      }),
      setEdges: (edges) => set((state) => withGraphHistory(state, { edges, dirty: true })),
      onNodesChange: (changes) => set((state) => {
        const graphChanges = changes.filter((change) => change.type !== "select");
        if (graphChanges.length === 0) return {};
        const nodes = applyNodeChanges(graphChanges, state.nodes) as EditorNode[];
        if (graphChanges.every((change) => change.type === "dimensions")) {
          return { nodes };
        }
        return withGraphHistory(state, { nodes, dirty: true });
      }),
      onEdgesChange: (changes) =>
        set((state) => {
          const graphChanges = changes.filter((change) => change.type !== "select");
          if (graphChanges.length === 0) return {};
          const removedEdges = graphChanges
            .filter((change) => change.type === "remove")
            .map((change) => state.edges.find((edge) => edge.id === change.id))
            .filter((edge): edge is EditorEdge => Boolean(edge));
          const nodes = removedEdges.reduce((nextNodes, edge) => clearChoiceTargetForRemovedEdge(nextNodes, edge), state.nodes);
          return withGraphHistory(state, { nodes, edges: applyEdgeChanges(graphChanges, state.edges), dirty: true });
        }),
      addNode: (node) =>
        set((state) => {
          const safeNode = sanitizeNode(node, state.nodes.length);
          if (!safeNode) {
            return { lastError: { message: "节点数据不完整，已阻止加入画布。", tone: "error" as const, source: "编辑器蓝图", reportable: true } };
          }
          if (safeNode.data.nodeKind === "start" && state.nodes.some((item) => item.data.nodeKind === "start")) {
            return { lastError: { message: "\u9879\u76EE\u53EA\u80FD\u6709\u4E00\u4E2A\u5165\u53E3\u8282\u70B9\u3002", tone: "warning" as const, source: "编辑器蓝图", reportable: false } };
          }
          return withGraphHistory(state, { nodes: [...state.nodes, safeNode], dirty: true });
        }),
      createNode: (nodeKind, position) => {
        const node = createNodeByKind(nodeKind, position ?? get().getSpawnPosition(nodeKind), get().memoryMode);
        get().addNode(node);
        if (get().nodes.some((item) => item.id === node.id)) {
          get().declutterNodesAround([node.id]);
          get().selectNode(node.id);
          get().registerNewNodeEffect(node.id, "manual");
        }
      },
      updateNodeData: (nodeId, patch) =>
        set((state) => {
          const choiceIds = patch.choice?.choices.map((choice) => choice.choice_id);
          return withGraphHistory(state, {
          nodes: state.nodes.map((node) => {
            if (node.id !== nodeId) return node;
            const data = { ...node.data, ...patch };
            if (patch.scene) {
              data.label = patch.scene.title;
              data.description = patch.scene.summary;
              if (node.data.editorMeta?.source === "ai_generated") {
                data.editorMeta = { ...node.data.editorMeta, source: "ai_edited" };
              }
            }
            return { ...node, data };
          }),
          edges: choiceIds
            ? state.edges.filter((edge) => edge.source !== nodeId || (Boolean(edge.sourceHandle) && choiceIds.includes(edge.sourceHandle!)))
            : state.edges,
          dirty: true,
        });
        }),
      deleteNode: (nodeId) =>
        set((state) => withGraphHistory(state, {
          nodes: state.nodes.filter((node) => node.id !== nodeId || node.data.nodeKind === "start"),
          edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
          selectedNodeId: state.selectedNodeId === nodeId ? undefined : state.selectedNodeId,
          dirty: true,
        })),
      duplicateNode: (nodeId) => {
        const node = get().nodes.find((item) => item.id === nodeId);
        if (!node || node.data.nodeKind === "start") return;
        const cloned = { ...cloneNode(node), position: get().getSpawnPosition(node.data.nodeKind) };
        set((state) => withGraphHistory(state, { nodes: [...state.nodes, cloned], dirty: true }));
        get().declutterNodesAround([cloned.id]);
        get().registerNewNodeEffect(cloned.id, "duplicate");
      },
      selectNode: (selectedNodeId) => set((state) => {
        const recentNodeEffects = selectedNodeId
          ? Object.fromEntries(Object.entries(state.recentNodeEffects).filter(([nodeId]) => nodeId !== selectedNodeId))
          : state.recentNodeEffects;
        return { selectedNodeId, selectedEdgeId: undefined, selectionRevision: state.selectionRevision + 1, recentNodeEffects };
      }),
      connectNodes: (connection) =>
        set((state) => {
          const nextNodes = syncChoiceTargetForConnection(state.nodes, connection);
          const nextEdges = state.edges.filter((edge) => {
            if (edge.source !== connection.source) return true;
            const currentHandle = edge.sourceHandle ?? "default";
            const nextHandle = connection.sourceHandle ?? "default";
            return currentHandle !== nextHandle;
          });
          return withGraphHistory(state, {
            nodes: nextNodes,
            edges: addEdge({ ...connection, id: `edge_${nanoid(8)}` }, nextEdges),
            dirty: true,
          });
        }),
      connectChoiceTargetsFromSceneIds: (sourceNodeId) => {
        let connectedCount = 0;
        set((state) => {
          const source = state.nodes.find((node) => node.id === sourceNodeId);
          const choices = choicesForBranchSource(source);
          if (choices.length === 0) return {};
          const nodesBySceneId = new Map(state.nodes.map((node) => [runtimeSceneIdForNode(node), node]));
          const validNodeIds = new Set(state.nodes.map((node) => node.id));
          let nextEdges = state.edges;
          for (const choice of choices) {
            const choiceId = choice.choice_id.trim();
            const targetSceneId = choice.target_scene_id.trim();
            if (!choiceId || !targetSceneId) continue;
            const target = nodesBySceneId.get(targetSceneId);
            if (!target) continue;
            const hasVisibleEdge = nextEdges.some((edge) =>
              edge.source === sourceNodeId &&
              (edge.sourceHandle ?? "default") === choiceId &&
              validNodeIds.has(edge.target)
            );
            if (hasVisibleEdge) continue;
            nextEdges = addEdge(
              { id: `edge_${nanoid(8)}`, source: sourceNodeId, target: target.id, sourceHandle: choiceId, targetHandle: "default" },
              nextEdges,
            );
            connectedCount += 1;
          }
          return connectedCount > 0 ? withGraphHistory(state, { edges: nextEdges, dirty: true }) : {};
        });
        return connectedCount;
      },
      disconnectEdge: (edgeId) =>
        set((state) => {
          const removedEdge = state.edges.find((edge) => edge.id === edgeId);
          return withGraphHistory(state, {
            nodes: clearChoiceTargetForRemovedEdge(state.nodes, removedEdge),
            edges: state.edges.filter((edge) => edge.id !== edgeId),
            dirty: true,
          });
        }),
      updateSceneCommands: (nodeId, commands) =>
        set((state) => {
          const choiceIds = commands
            .filter((command) => command.type === "choice")
            .flatMap((command) => command.choices.map((choice) => choice.choice_id));
          return withGraphHistory(state, {
            nodes: state.nodes.map((node) => {
            if (node.id !== nodeId || !node.data.scene) return node;
            const nextScene = { ...node.data.scene, commands };
            const editorMeta = node.data.editorMeta?.source === "ai_generated"
              ? { ...node.data.editorMeta, source: "ai_edited" as const }
              : node.data.editorMeta;
            return { ...node, data: { ...node.data, scene: nextScene, editorMeta } };
          }),
            edges: state.edges.filter((edge) => edge.source !== nodeId || !edge.sourceHandle || edge.sourceHandle === "default" || choiceIds.includes(edge.sourceHandle)),
            dirty: true,
          });
        }),
      migrateAnimationNode: (nodeId, mode) => {
        const state = get();
        const node = state.nodes.find((item) => item.id === nodeId);
        if (!node || node.data.nodeKind !== "animation" || !node.data.animation) return undefined;
        const result = migrateAnimationNodeGraph(state.nodes, state.edges, nodeId, mode);
        set((current) => withGraphHistory(current, {
          nodes: result.nodes,
          edges: result.edges,
          selectedNodeId: result.mode === "convert_scene" ? nodeId : undefined,
          selectedEdgeId: undefined,
          dirty: true,
          lastError: {
            tone: "success",
            source: "旧版动画节点转换",
            message: result.mode === "prepend_successor"
              ? "动画已移到后续场景开头，原节点和连线已安全合并。"
              : result.mode === "append_predecessor"
                ? "动画已移到前置场景末尾，原节点和连线已安全合并。"
                : "动画节点已原地转成普通场景，编号、位置和连线均已保留。",
          },
        }));
        return result.mode;
      },
      migrateAllAnimationNodes: () => {
        let batchResult: AnimationNodeBatchMigrationResult | undefined;
        set((state) => {
          const result = migrateAllAnimationNodesGraph(state.nodes, state.edges);
          if (result.migratedCount === 0) return {};
          batchResult = result;
          return withGraphHistory(state, {
            nodes: result.nodes,
            edges: result.edges,
            selectedNodeId: undefined,
            selectedEdgeId: undefined,
            dirty: true,
            lastError: {
              tone: "success",
              source: "旧版动画节点批量转换",
              message: `已转换 ${result.migratedCount} 个旧版动画节点：安全移入场景 ${result.prependCount + result.appendCount} 个，原地转成普通场景 ${result.convertedSceneCount} 个。`,
            },
          });
        });
        return batchResult;
      },
      applyDialogPortraitToCharacter: (characterId, portrait) => {
        const targetCharacterId = characterId.trim();
        const nextPortrait = portrait.trim();
        if (!targetCharacterId || !nextPortrait) return 0;
        let changedCount = 0;
        set((state) => {
          const nodes = state.nodes.map((node) => {
            if (!node.data.scene) return node;
            let nodeChanged = false;
            const commands = node.data.scene.commands.map((command) => {
              if (command.type !== "dialog" || command.character_id.trim() !== targetCharacterId || command.portrait === nextPortrait) return command;
              changedCount += 1;
              nodeChanged = true;
              return { ...command, portrait: nextPortrait };
            });
            if (!nodeChanged) return node;
            const editorMeta = node.data.editorMeta?.source === "ai_generated"
              ? { ...node.data.editorMeta, source: "ai_edited" as const }
              : node.data.editorMeta;
            return { ...node, data: { ...node.data, scene: { ...node.data.scene, commands }, editorMeta } };
          });
          return changedCount > 0 ? withGraphHistory(state, { nodes, dirty: true }) : {};
        });
        return changedCount;
      },
      applyDialogTextStyleToCharacter: (characterId, style) => {
        const targetCharacterId = characterId.trim();
        if (!targetCharacterId) return 0;
        const textStyle = {
          text_color: style.text_color ?? null,
          font_size: style.font_size ?? null,
          font_weight: style.font_weight ?? null,
          font_style: style.font_style ?? null,
        };
        let changedCount = 0;
        set((state) => {
          const nodes = state.nodes.map((node) => {
            if (!node.data.scene) return node;
            let nodeChanged = false;
            const commands = node.data.scene.commands.map((command) => {
              if (command.type !== "dialog" || command.character_id.trim() !== targetCharacterId) return command;
              const nextStyle = { ...(command.dialog_style ?? {}), ...textStyle };
              changedCount += 1;
              nodeChanged = true;
              return { ...command, dialog_style_mode: "manual" as const, dialog_style: nextStyle };
            });
            if (!nodeChanged) return node;
            const editorMeta = node.data.editorMeta?.source === "ai_generated"
              ? { ...node.data.editorMeta, source: "ai_edited" as const }
              : node.data.editorMeta;
            return { ...node, data: { ...node.data, scene: { ...node.data.scene, commands }, editorMeta } };
          });
          return changedCount > 0 ? withGraphHistory(state, { nodes, dirty: true }) : {};
        });
        return changedCount;
      },
      applyNarrationStyleToAll: (style) => {
        const narrationStyle: NonNullable<NarrationCommand["dialog_style"]> = {
          background_asset_id: style.background_asset_id ?? null,
          background_fit: style.background_fit ?? null,
          theme_color: style.theme_color ?? null,
          text_color: style.text_color ?? null,
          font_size: style.font_size ?? null,
          font_weight: style.font_weight ?? null,
          font_style: style.font_style ?? null,
        };
        const serializedStyle = JSON.stringify(narrationStyle);
        let changedCount = 0;
        set((state) => {
          const nodes = state.nodes.map((node) => {
            if (!node.data.scene) return node;
            let nodeChanged = false;
            const commands = node.data.scene.commands.map((command) => {
              if (command.type !== "narration") return command;
              if (command.dialog_style_mode === "manual" && JSON.stringify(command.dialog_style ?? null) === serializedStyle) return command;
              changedCount += 1;
              nodeChanged = true;
              return { ...command, dialog_style_mode: "manual" as const, dialog_style: { ...narrationStyle } };
            });
            if (!nodeChanged) return node;
            const editorMeta = node.data.editorMeta?.source === "ai_generated"
              ? { ...node.data.editorMeta, source: "ai_edited" as const }
              : node.data.editorMeta;
            return { ...node, data: { ...node.data, scene: { ...node.data.scene, commands }, editorMeta } };
          });
          return changedCount > 0 ? withGraphHistory(state, { nodes, dirty: true }) : {};
        });
        return changedCount;
      },
      updateMemoryMode: (memoryMode, nodeId) =>
        set((state) => withGraphHistory(state, {
          memoryMode: nodeId ? state.memoryMode : memoryMode,
          nodes: nodeId
            ? state.nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, memoryMode } } : node))
            : state.nodes,
          dirty: true,
        })),
      beginGeneration: (nodeId) => {
        const activeGeneration = get().activeGeneration;
        if (activeGeneration) return { ok: false, activeNodeId: activeGeneration.nodeId };
        const token = `generation_${nanoid(10)}`;
        const startedAt = Date.now();
        set({
          activeGeneration: { nodeId, token, startedAt },
          generationDebug: {
            nodeId,
            startedAt,
            status: "准备连接模型...",
            decisionText: "",
            traces: [],
          },
        });
        return { ok: true, token };
      },
      endGeneration: (token) =>
        set((state) => {
          if (state.activeGeneration?.token !== token) return {};
          return { activeGeneration: undefined };
        }),
      resetGenerationDebug: (nodeId) => set({
        generationDebug: {
          nodeId,
          startedAt: Date.now(),
          status: "准备连接模型...",
          decisionText: "",
          traces: [],
        },
      }),
      setGenerationDebugStatus: (status) =>
        set((state) => state.generationDebug ? { generationDebug: { ...state.generationDebug, status } } : {}),
      appendGenerationDecisionDelta: (delta) =>
        set((state) => state.generationDebug ? {
          generationDebug: {
            ...state.generationDebug,
            decisionText: `${state.generationDebug.decisionText}${delta}`,
          },
        } : {}),
      addGenerationTrace: (trace) =>
        set((state) => state.generationDebug ? {
          generationDebug: {
            ...state.generationDebug,
            traces: [...state.generationDebug.traces, trace].slice(-80),
          },
        } : {}),
      applyGeneratedScene: (sourceNodeId, scene) => {
        const hasDefaultSuccessor = get().edges.some((edge) => edge.source === sourceNodeId && isDefaultSourceHandle(edge.sourceHandle));
        const position = get().getSpawnPosition("scene");
        const node = createSceneNode(position, get().memoryMode, uniqueGeneratedScene(scene, get().nodes));
        node.data.editorMeta = {
          ...node.data.editorMeta,
          source: "ai_generated",
          generatedAt: new Date().toISOString(),
          generatedFromNodeId: sourceNodeId,
        };
        set((state) => withGraphHistory(state, {
          nodes: [...state.nodes, node],
          edges: hasDefaultSuccessor
            ? state.edges
            : [...state.edges, { id: `edge_${nanoid(8)}`, source: sourceNodeId, target: node.id, sourceHandle: "default" }],
          dirty: true,
        }));
        get().declutterNodesAround([node.id]);
        get().registerNewNodeEffect(node.id, "ai");
        return { node, linked: !hasDefaultSuccessor };
      },
      applyGeneratedBranchScene: (sourceNodeId, choiceId, scene, options = {}) => {
        const source = get().nodes.find((node) => node.id === sourceNodeId);
        if (!source || !choiceId.trim()) return { linked: false };
        const branchIndex = options.branchIndex ?? 0;
        const branchCount = Math.max(1, options.branchCount ?? 1);
        const verticalOffset = Math.round((branchIndex - (branchCount - 1) / 2) * 260);
        const position = {
          x: Math.round(source.position.x + 430),
          y: Math.round(source.position.y + verticalOffset),
        };
        const sceneForNode = uniqueGeneratedScene(scene, get().nodes);
        const node = createSceneNode(position, get().memoryMode, sceneForNode);
        node.data.editorMeta = {
          ...node.data.editorMeta,
          source: "ai_generated",
          generatedAt: new Date().toISOString(),
          generatedFromNodeId: sourceNodeId,
        };
        const connection: Connection = { source: sourceNodeId, target: node.id, sourceHandle: choiceId, targetHandle: "default" };
        set((state) => {
          const nextEdges = state.edges.filter((edge) => {
            if (edge.source !== sourceNodeId) return true;
            return (edge.sourceHandle ?? "default") !== choiceId;
          });
          const nodesWithBranch = [...state.nodes, node];
          return withGraphHistory(state, {
            nodes: syncChoiceTargetForConnection(nodesWithBranch, connection),
            edges: addEdge({ ...connection, id: `edge_${nanoid(8)}` }, nextEdges),
            dirty: true,
          });
        });
        get().declutterNodesAround([node.id]);
        get().registerNewNodeEffect(node.id, "ai");
        return { node, linked: true };
      },
      applyGeneratedSceneToNode: (nodeId, scene, options = {}) => {
        let replacedNode: EditorNode | undefined;
        set((state) => {
          const nodes = state.nodes.map((node) => {
            if (node.id !== nodeId || node.data.nodeKind !== "scene" || !node.data.scene) return node;
            const nextScene: SceneBeat = {
              ...scene,
              scene_id: options.preserveSceneId === false ? scene.scene_id : node.data.scene.scene_id,
              chapter: options.preserveChapter === false ? scene.chapter : node.data.scene.chapter,
            };
            replacedNode = {
              ...node,
              data: {
                ...node.data,
                label: nextScene.title,
                description: nextScene.summary,
                scene: nextScene,
                editorMeta: {
                  ...node.data.editorMeta,
                  source: "ai_generated",
                  generatedAt: new Date().toISOString(),
                  generatedFromNodeId: options.generatedFromNodeId ?? nodeId,
                },
              },
            };
            return replacedNode;
          });
          return replacedNode
            ? withGraphHistory(state, { nodes, dirty: true })
            : {};
        });
        return { node: replacedNode, replaced: Boolean(replacedNode) };
      },
      autoArrangeNodes: (options = {}) => {
        const state = get();
        const layout = computeAutoArrangeLayout(state.nodes, state.edges, options);
        if (layout.arrangedNodeIds.length === 0 || layout.movedCount === 0) {
          return { movedCount: layout.movedCount, arrangedNodeIds: layout.arrangedNodeIds };
        }
        set((state) => withGraphHistory(state, {
          nodes: state.nodes.map((node) => {
            const position = layout.positions[node.id];
            return position ? { ...node, position } : node;
          }),
          dirty: true,
        }));
        return { movedCount: layout.movedCount, arrangedNodeIds: layout.arrangedNodeIds };
      },
      getSpawnPosition: (nodeKind) => {
        const state = get();
        const size = estimatedNodeSize(nodeKind);
        const surface = state.flowSurfaceSize.width > 0 && state.flowSurfaceSize.height > 0
          ? state.flowSurfaceSize
          : { width: 960, height: 640 };
        const zoom = state.viewport.zoom > 0 ? state.viewport.zoom : 1;
        const center = {
          x: (surface.width / 2 - state.viewport.x) / zoom,
          y: (surface.height / 2 - state.viewport.y) / zoom,
        };
        const base = {
          x: Math.round(center.x - size.width / 2),
          y: Math.round(center.y - size.height / 2),
          width: size.width,
          height: size.height,
        };
        const occupied = state.nodes.map(existingNodeRect);
        for (const offset of spiralOffsets()) {
          const candidate = { ...base, x: base.x + offset.x, y: base.y + offset.y };
          if (!occupied.some((rect) => rectsOverlap(candidate, rect))) {
            return { x: candidate.x, y: candidate.y };
          }
        }
        return { x: base.x, y: base.y };
      },
      declutterNodesAround: (nodeIds) => {
        const focusIds = new Set(nodeIds.filter(Boolean));
        if (focusIds.size === 0) return [];
        const result = declutterClusterPositions(get().nodes, focusIds);
        if (result.movedIds.length === 0) return [];
        const createdAt = Date.now();
        set((state) => {
          const recentNodeEffects = { ...state.recentNodeEffects };
          for (const nodeId of result.movedIds) {
            recentNodeEffects[nodeId] = { source: "declutter", createdAt };
          }
          return { nodes: result.nodes, recentNodeEffects, dirty: true };
        });
        dispatchDeclutterAnimation(result.movedIds);
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            set((state) => {
              const recentNodeEffects = { ...state.recentNodeEffects };
              let changed = false;
              for (const nodeId of result.movedIds) {
                if (recentNodeEffects[nodeId]?.source === "declutter" && recentNodeEffects[nodeId]?.createdAt === createdAt) {
                  delete recentNodeEffects[nodeId];
                  changed = true;
                }
              }
              return changed ? { recentNodeEffects } : {};
            });
          }, 1800);
        }
        return result.movedIds;
      },
      declutterOverlappingNodes: () => get().declutterNodesAround(get().nodes.map((node) => node.id)),
      registerNewNodeEffect: (nodeId, source) => {
        const createdAt = Date.now();
        set((state) => ({
          recentNodeEffects: {
            ...state.recentNodeEffects,
            [nodeId]: { source, createdAt },
          },
        }));
        if (typeof window !== "undefined") {
          window.setTimeout(() => {
            set((state) => {
              if (state.recentNodeEffects[nodeId]?.createdAt !== createdAt) return {};
              const { [nodeId]: _expired, ...recentNodeEffects } = state.recentNodeEffects;
              return { recentNodeEffects };
            });
          }, 5200);
        }
      },
      clearNewNodeEffect: (nodeId) =>
        set((state) => {
          if (!state.recentNodeEffects[nodeId]) return {};
          const { [nodeId]: _removed, ...recentNodeEffects } = state.recentNodeEffects;
          return { recentNodeEffects };
        }),
      recordGraphHistory: () =>
        set((state) => {
          const graphHistory = pushGraphHistory(state);
          return graphHistory === state.graphHistory ? {} : { graphHistory };
        }),
      beginGraphHistoryBatch: (batch) =>
        set((state) => {
          if (state.graphHistory.activeBatch) return {};
          return { graphHistory: pushGraphHistory(state, batch) };
        }),
      endGraphHistoryBatch: (batch) =>
        set((state) => (
          state.graphHistory.activeBatch === batch
            ? { graphHistory: { ...state.graphHistory, activeBatch: undefined } }
            : {}
        )),
      undoGraphChange: () => {
        const state = get();
        const previous = state.graphHistory.past[state.graphHistory.past.length - 1];
        if (!previous) return false;
        const present = captureGraphSnapshot(state);
        set((current) => ({
          ...restoreGraphSnapshot(previous, current),
          lastError: {
            message: "已撤销上一次画布修改。",
            tone: "info",
            source: "画布撤销",
            action: "仅影响编辑器画布的节点、连线、视口与记忆模式。",
          },
          graphHistory: {
            past: current.graphHistory.past.slice(0, -1),
            future: [present, ...current.graphHistory.future].slice(0, EDITOR_GRAPH_HISTORY_LIMIT),
            activeBatch: undefined,
          },
        }));
        return true;
      },
      redoGraphChange: () => {
        const state = get();
        const next = state.graphHistory.future[0];
        if (!next) return false;
        const present = captureGraphSnapshot(state);
        set((current) => ({
          ...restoreGraphSnapshot(next, current),
          graphHistory: {
            past: [...current.graphHistory.past, present].slice(-EDITOR_GRAPH_HISTORY_LIMIT),
            future: current.graphHistory.future.slice(1),
            activeBatch: undefined,
          },
        }));
        return true;
      },
      importProject: (project) => {
        const nodes = sanitizeNodes(project.nodes);
        const repaired = !Array.isArray(project.nodes) || nodes.length !== project.nodes.length || project.nodes.some((node) => nodeNeedsRepair(node));
        const edges = sanitizeEdges(project.edges, nodes);
        set({
          nodes,
          edges: edges.length > 0 || !isInitialNodeSet(nodes) ? edges : structuredClone(initialEdges),
          viewport: sanitizeViewport(project.viewport),
          recentNodeEffects: {},
          memoryMode: project.memory_mode,
          dirty: repaired || edges.length !== project.edges.length || (edges.length === 0 && isInitialNodeSet(nodes)),
          graphHistory: emptyGraphHistory(),
          lastError: repaired ? { message: "已修复不完整的同步节点，避免画布白屏。", tone: "warning", source: "项目导入" } : undefined,
        });
      },
      importProjectAsRoute: (project) => {
        const state = get();
        const route = createRouteImportGraph(project, state.nodes, state.edges);
        if (route.nodes.length === 0) {
          set({
            lastError: {
              message: "导入工程中没有可作为独立线路加入的节点。",
              tone: "warning",
              source: "项目路线导入",
              action: "请确认工程文件包含场景、选项、条件或结局节点；入口节点会被自动跳过以保留当前项目唯一入口。",
            },
          });
          return { nodes: 0, edges: 0 };
        }
        const createdAt = Date.now();
        const highlightedRouteNodes = route.nodes.length > 60
          ? route.nodes.filter((node, index) => index < 12 || node.id === route.selectedNodeId)
          : route.nodes;
        const successNotice = {
          message: `已导入独立线路：${route.nodes.length} 个节点 / ${route.edges.length} 条内部连线。`,
          tone: "success" as const,
          source: "项目路线导入",
          action: "新线路已放在当前画布右侧，不会自动连接到现有入口或剧情流；需要启用时请手动连线。",
        };
        const clearHighlightedEffects = () => {
          if (typeof window === "undefined") return;
          const importedIds = new Set(highlightedRouteNodes.map((node) => node.id));
          window.setTimeout(() => {
            set((current) => {
              const recentNodeEffects = Object.fromEntries(
                Object.entries(current.recentNodeEffects).filter(([nodeId, effect]) => !importedIds.has(nodeId) || effect.createdAt !== createdAt)
              );
              return { recentNodeEffects };
            });
          }, 5200);
        };
        if (typeof window !== "undefined" && route.nodes.length > 80) {
          const firstBatchSize = 24;
          const nextBatchSize = 24;
          const appendedEdgeIds = new Set<string>();
          const pickEdgesForAvailableNodes = (nodeIds: Set<string>) => {
            const nextEdges = route.edges.filter((edge) => {
              if (appendedEdgeIds.has(edge.id)) return false;
              return nodeIds.has(edge.source) && nodeIds.has(edge.target);
            });
            nextEdges.forEach((edge) => appendedEdgeIds.add(edge.id));
            return nextEdges;
          };
          const firstNodes = route.nodes.slice(0, firstBatchSize);
          const firstNodeIds = new Set([...state.nodes.map((node) => node.id), ...firstNodes.map((node) => node.id)]);
          const firstEdges = pickEdgesForAvailableNodes(firstNodeIds);
          set((current) => withGraphHistory(current, {
            nodes: [...current.nodes, ...firstNodes],
            edges: [...current.edges, ...firstEdges],
            selectedNodeId: route.selectedNodeId,
            selectedEdgeId: undefined,
            dirty: true,
            recentNodeEffects: {
              ...current.recentNodeEffects,
              ...Object.fromEntries(highlightedRouteNodes.filter((node) => firstNodeIds.has(node.id)).map((node) => [node.id, { source: "imported" as const, createdAt }])),
            },
            lastError: successNotice,
          }));
          const scheduleBatch = (startIndex: number) => {
            const idleWindow = window as Window & {
              requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
            };
            const run = () => {
              const batchNodes = route.nodes.slice(startIndex, startIndex + nextBatchSize);
              if (batchNodes.length === 0) return;
              set((current) => {
                const availableNodeIds = new Set([...current.nodes.map((node) => node.id), ...batchNodes.map((node) => node.id)]);
                return {
                  nodes: [...current.nodes, ...batchNodes],
                  edges: [...current.edges, ...pickEdgesForAvailableNodes(availableNodeIds)],
                  dirty: true,
                };
              });
              const nextIndex = startIndex + nextBatchSize;
              if (nextIndex < route.nodes.length) scheduleBatch(nextIndex);
            };
            window.setTimeout(() => {
              if (idleWindow.requestIdleCallback) {
                idleWindow.requestIdleCallback(run, { timeout: 120 });
                return;
              }
              window.requestAnimationFrame(run);
            }, 32);
          };
          scheduleBatch(firstBatchSize);
          clearHighlightedEffects();
          return { nodes: route.nodes.length, edges: route.edges.length, selectedNodeId: route.selectedNodeId };
        }
        set((current) => withGraphHistory(current, {
          nodes: [...current.nodes, ...route.nodes],
          edges: [...current.edges, ...route.edges],
          selectedNodeId: route.selectedNodeId,
          selectedEdgeId: undefined,
          dirty: true,
          recentNodeEffects: {
            ...current.recentNodeEffects,
            ...Object.fromEntries(highlightedRouteNodes.map((node) => [node.id, { source: "imported" as const, createdAt }])),
          },
          lastError: successNotice,
        }));
        clearHighlightedEffects();
        return { nodes: route.nodes.length, edges: route.edges.length, selectedNodeId: route.selectedNodeId };
      },
      resetGraph: () =>
        set({
          nodes: arrangedInitialNodes(),
          edges: structuredClone(initialEdges),
          selectedNodeId: "node_scene_opening",
          selectedEdgeId: undefined,
          viewport: { x: 0, y: 0, zoom: 1 },
          recentNodeEffects: {},
          memoryMode: "hybrid",
          dirty: false,
          graphHistory: emptyGraphHistory(),
          lastError: undefined,
          generationDebug: undefined,
        }),
      exportProject: (metadata) => ({
        schema_version: "1.1.0",
        project_id: metadata.projectId,
        title: metadata.title,
        author: metadata.author,
        nodes: get().nodes,
        edges: get().edges,
        viewport: get().viewport,
        memory_mode: get().memoryMode,
        asset_manifest: metadata.assetManifest,
        editor_settings: metadata.editorSettings ?? {},
        created_at: metadata.createdAt ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      exportScript: () => buildRuntimeScript(get().nodes, get().edges),
      setViewport: (viewport) => set({ viewport }),
      setFlowSurfaceSize: (flowSurfaceSize) => set({ flowSurfaceSize }),
      setNotice: (notice, tone = "info", detail) => {
        const normalized = normalizeStoreNotice(notice, tone, detail);
        logStoreNotice(normalized);
        set({ lastError: normalized });
      },
      setLastError: (notice, tone = "error", detail) => {
        const normalized = normalizeStoreNotice(notice, tone, detail);
        logStoreNotice(normalized);
        set({ lastError: normalized });
      },
    })
);

if (typeof window !== "undefined") {
  (window as Window & { __AGENTVN_EDITOR_STORE__?: typeof useEditorStore }).__AGENTVN_EDITOR_STORE__ = useEditorStore;
}
