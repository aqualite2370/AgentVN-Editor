import type { EditorEdge, EditorNode } from "../types/nodes";

export type AnimationNodeMigrationMode =
  | "prepend_successor"
  | "append_predecessor"
  | "convert_scene";

export interface AnimationNodeMigrationAnalysis {
  nodeId: string;
  predecessorCount: number;
  successorCount: number;
  bypassPathCount: number;
  predecessorOtherExitCount: number;
  canPrepend: boolean;
  canAppend: boolean;
  prependAffectedPathCount: number;
  appendAffectedPathCount: number;
  safePrepend: boolean;
  safeAppend: boolean;
  recommendedMode: AnimationNodeMigrationMode;
}

export interface AnimationNodeMigrationResult {
  nodes: EditorNode[];
  edges: EditorEdge[];
  mode: AnimationNodeMigrationMode;
}

export interface AnimationNodeBatchMigrationResult {
  nodes: EditorNode[];
  edges: EditorEdge[];
  migratedCount: number;
  prependCount: number;
  appendCount: number;
  convertedSceneCount: number;
}

function uniqueNodeIds(edges: EditorEdge[], field: "source" | "target"): string[] {
  return [...new Set(edges.map((edge) => edge[field]))];
}

function sceneNode(nodes: EditorNode[], nodeId: string): EditorNode | undefined {
  const node = nodes.find((item) => item.id === nodeId);
  return node?.data.nodeKind === "scene" && node.data.scene ? node : undefined;
}

export function analyzeAnimationNodeMigration(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeId: string,
): AnimationNodeMigrationAnalysis {
  const node = nodes.find((item) => item.id === nodeId);
  const incoming = edges.filter((edge) => edge.target === nodeId);
  const outgoing = edges.filter((edge) => edge.source === nodeId);
  const predecessorIds = uniqueNodeIds(incoming, "source");
  const successorIds = uniqueNodeIds(outgoing, "target");
  const successor = successorIds.length === 1 ? sceneNode(nodes, successorIds[0]) : undefined;
  const predecessor = predecessorIds.length === 1 ? sceneNode(nodes, predecessorIds[0]) : undefined;
  const bypassPathCount = successor
    ? edges.filter((edge) => edge.target === successor.id && edge.source !== nodeId).length
    : 0;
  const predecessorOtherExitCount = predecessor
    ? edges.filter((edge) => edge.source === predecessor.id && edge.target !== nodeId).length
    : 0;
  const validAnimation = node?.data.nodeKind === "animation" && Boolean(node.data.animation);
  const canPrepend = Boolean(validAnimation && successor);
  const canAppend = Boolean(validAnimation && predecessor);
  const safePrepend = canPrepend && bypassPathCount === 0;
  const safeAppend = canAppend && predecessorOtherExitCount === 0;
  return {
    nodeId,
    predecessorCount: predecessorIds.length,
    successorCount: successorIds.length,
    bypassPathCount,
    predecessorOtherExitCount,
    canPrepend,
    canAppend,
    prependAffectedPathCount: bypassPathCount,
    appendAffectedPathCount: predecessorOtherExitCount,
    safePrepend,
    safeAppend,
    recommendedMode: safePrepend
      ? "prepend_successor"
      : safeAppend
        ? "append_predecessor"
        : "convert_scene",
  };
}

function reconnect(
  incoming: EditorEdge[],
  outgoing: EditorEdge[],
  nodeId: string,
  mode: "prepend_successor" | "append_predecessor",
): EditorEdge[] {
  const candidates = mode === "prepend_successor"
    ? incoming.flatMap((before) => outgoing.map((after, index) => ({
        id: `${before.id}_migrated_${index}`,
        source: before.source,
        target: after.target,
        sourceHandle: before.sourceHandle,
        targetHandle: after.targetHandle,
      })))
    : outgoing.flatMap((after, index) => incoming.map((before, beforeIndex) => ({
        id: `${after.id}_migrated_${index}_${beforeIndex}`,
        source: before.source,
        target: after.target,
        sourceHandle: before.sourceHandle,
        targetHandle: after.targetHandle,
      })));
  const seen = new Set<string>();
  return candidates.filter((edge) => {
    if (edge.source === nodeId || edge.target === nodeId || edge.source === edge.target) return false;
    const key = `${edge.source}:${edge.sourceHandle ?? "default"}:${edge.target}:${edge.targetHandle ?? "default"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function migrateAnimationNode(
  nodes: EditorNode[],
  edges: EditorEdge[],
  nodeId: string,
  requestedMode?: AnimationNodeMigrationMode,
): AnimationNodeMigrationResult {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node || node.data.nodeKind !== "animation" || !node.data.animation) {
    return { nodes, edges, mode: "convert_scene" };
  }
  const analysis = analyzeAnimationNodeMigration(nodes, edges, nodeId);
  const mode = requestedMode ?? analysis.recommendedMode;
  const incoming = edges.filter((edge) => edge.target === nodeId);
  const outgoing = edges.filter((edge) => edge.source === nodeId);

  if (mode === "prepend_successor" && analysis.canPrepend) {
    const successorId = outgoing[0].target;
    const nextNodes = nodes
      .filter((item) => item.id !== nodeId)
      .map((item) => item.id === successorId && item.data.scene
        ? {
            ...item,
            data: {
              ...item.data,
              scene: {
                ...item.data.scene,
                commands: [structuredClone(node.data.animation!), ...item.data.scene.commands],
              },
            },
          }
        : item);
    return {
      nodes: nextNodes,
      edges: [
        ...edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        ...reconnect(incoming, outgoing, nodeId, mode),
      ],
      mode,
    };
  }

  if (mode === "append_predecessor" && analysis.canAppend) {
    const predecessorId = incoming[0].source;
    const nextNodes = nodes
      .filter((item) => item.id !== nodeId)
      .map((item) => item.id === predecessorId && item.data.scene
        ? {
            ...item,
            data: {
              ...item.data,
              scene: {
                ...item.data.scene,
                commands: [...item.data.scene.commands, structuredClone(node.data.animation!)],
              },
            },
          }
        : item);
    return {
      nodes: nextNodes,
      edges: [
        ...edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        ...reconnect(incoming, outgoing, nodeId, mode),
      ],
      mode,
    };
  }

  const convertedNodes = nodes.map((item) => {
    if (item.id !== nodeId) return item;
    const syntheticSceneId = `animation_${item.id}`;
    return {
      ...item,
      type: "sceneNode",
      data: {
        ...item.data,
        nodeKind: "scene",
        label: item.data.label || "旧版动画场景",
        description: "由旧版独立动画节点无损转换，原有连线和播放顺序保持不变。",
        animation: undefined,
        scene: {
          scene_id: syntheticSceneId,
          title: item.data.label || "旧版动画场景",
          summary: item.data.description,
          commands: [structuredClone(item.data.animation!)],
          tags: ["legacy-animation"],
          chapter: 0,
        },
      },
    } as EditorNode;
  });
  return { nodes: convertedNodes, edges, mode: "convert_scene" };
}

export function migrateAllAnimationNodes(
  nodes: EditorNode[],
  edges: EditorEdge[],
): AnimationNodeBatchMigrationResult {
  const animationNodeIds = nodes
    .filter((node) => node.data.nodeKind === "animation" && Boolean(node.data.animation))
    .map((node) => node.id);
  let nextNodes = nodes;
  let nextEdges = edges;
  let prependCount = 0;
  let appendCount = 0;
  let convertedSceneCount = 0;

  for (const nodeId of animationNodeIds) {
    const result = migrateAnimationNode(nextNodes, nextEdges, nodeId);
    nextNodes = result.nodes;
    nextEdges = result.edges;
    if (result.mode === "prepend_successor") prependCount += 1;
    else if (result.mode === "append_predecessor") appendCount += 1;
    else convertedSceneCount += 1;
  }

  return {
    nodes: nextNodes,
    edges: nextEdges,
    migratedCount: animationNodeIds.length,
    prependCount,
    appendCount,
    convertedSceneCount,
  };
}
