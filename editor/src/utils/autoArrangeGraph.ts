import type { EditorEdge, EditorNode } from "../types/nodes";

export interface AutoArrangeOptions {
  scope?: "all";
}

export interface AutoArrangeResult {
  movedCount: number;
  arrangedNodeIds: string[];
}

export interface AutoArrangeLayoutResult extends AutoArrangeResult {
  positions: Record<string, { x: number; y: number }>;
}

interface LayoutTree {
  id: string;
  children: LayoutTree[];
  width: number;
  nodeWidth: number;
}

const minLaneWidth = 320;
const minimumNodeWidth = 260;
const minimumNodeHeight = 140;
const verticalGap = 170;
const branchGap = 96;
const disconnectedGap = 320;
const disconnectedRowWidthLimit = 3400;
const rowCompactGap = 112;
const topPadding = 120;

function hasFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function estimatedNodeSize(node: EditorNode): { width: number; height: number } {
  if (node.data.nodeKind === "scene") return { width: 300, height: 260 };
  if (node.data.nodeKind === "start" || node.data.nodeKind === "end") return { width: 300, height: 150 };
  return { width: 300, height: 190 };
}

function nodeLayoutSize(node: EditorNode): { width: number; height: number } {
  const measured = node.measured as { width?: number; height?: number } | undefined;
  const fallback = estimatedNodeSize(node);
  return {
    width: Math.max(minimumNodeWidth, hasFiniteNumber(measured?.width) && measured.width > 0 ? measured.width : fallback.width),
    height: Math.max(minimumNodeHeight, hasFiniteNumber(measured?.height) && measured.height > 0 ? measured.height : fallback.height),
  };
}

function isDefaultHandle(handle?: string | null): boolean {
  return !handle || handle === "default";
}

function choiceHandleOrder(node: EditorNode | undefined): string[] {
  if (!node) return [];
  if (node.data.nodeKind === "scene" && node.data.scene) {
    return node.data.scene.commands
      .filter((command) => command.type === "choice")
      .flatMap((command) => command.choices.map((choice) => choice.choice_id));
  }
  if (node.data.nodeKind === "choice" && node.data.choice) {
    return node.data.choice.choices.map((choice) => choice.choice_id);
  }
  if (node.data.nodeKind === "condition") {
    return ["true", "false"];
  }
  return [];
}

function sourceHandleVisualX(edge: EditorEdge, nodesById: Map<string, EditorNode>): number {
  const handle = edge.sourceHandle ?? "default";
  const handleOrder = choiceHandleOrder(nodesById.get(edge.source));
  const choiceIndex = handleOrder.indexOf(handle);
  if (choiceIndex >= 0) {
    return handleOrder.length === 1
      ? 50
      : 18 + (64 * choiceIndex) / Math.max(1, handleOrder.length - 1);
  }
  if (handle === "true") return 35;
  if (handle === "false") return 65;
  if (handle === "default" || handle === "mainline") return 50;
  return 90;
}

function edgeSortKey(edge: EditorEdge): string {
  const handle = edge.sourceHandle ?? "default";
  if (handle === "default" || handle === "mainline") return `1:${handle}`;
  if (handle === "true") return "0:true";
  if (handle === "false") return "2:false";
  return `3:${handle}`;
}

function sortOutgoingEdges(edges: EditorEdge[], nodesById: Map<string, EditorNode>): EditorEdge[] {
  return [...edges].sort((a, b) => {
    const visualCompare = sourceHandleVisualX(a, nodesById) - sourceHandleVisualX(b, nodesById);
    if (Math.abs(visualCompare) > 0.001) return visualCompare;
    const keyCompare = edgeSortKey(a).localeCompare(edgeSortKey(b));
    if (keyCompare !== 0) return keyCompare;
    return a.target.localeCompare(b.target);
  });
}

function centerDefaultChild(edges: EditorEdge[]): EditorEdge[] {
  const main = edges.find((edge) => isDefaultHandle(edge.sourceHandle) || edge.sourceHandle === "mainline");
  if (!main || edges.length < 3) return edges;
  const rest = edges.filter((edge) => edge !== main);
  const midpoint = Math.floor(rest.length / 2);
  return [...rest.slice(0, midpoint), main, ...rest.slice(midpoint)];
}

function chooseRoots(nodes: EditorNode[], edges: EditorEdge[]): string[] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  const startRoots = nodes.filter((node) => node.data.nodeKind === "start").map((node) => node.id);
  if (startRoots.length > 0) return startRoots;
  const zeroIncoming = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0);
  if (zeroIncoming.length > 0) return zeroIncoming.map((node) => node.id);
  return nodes[0] ? [nodes[0].id] : [];
}

function buildTree(
  nodeId: string,
  outgoingById: Map<string, EditorEdge[]>,
  nodesById: Map<string, EditorNode>,
  targetIds: Set<string>,
  assigned: Set<string>,
  stack: Set<string>,
): LayoutTree {
  assigned.add(nodeId);
  stack.add(nodeId);
  const node = nodesById.get(nodeId);
  const nodeWidth = node ? nodeLayoutSize(node).width : minimumNodeWidth;
  const sortedEdges = centerDefaultChild(sortOutgoingEdges(outgoingById.get(nodeId) ?? [], nodesById));
  const children = sortedEdges
    .filter((edge) => targetIds.has(edge.target) && !stack.has(edge.target) && !assigned.has(edge.target))
    .map((edge) => buildTree(edge.target, outgoingById, nodesById, targetIds, assigned, stack));
  stack.delete(nodeId);
  const childrenWidth = children.reduce((sum, child) => sum + child.width, 0) + Math.max(0, children.length - 1) * branchGap;
  const width = Math.max(Math.max(nodeWidth, minLaneWidth), childrenWidth);
  return { id: nodeId, children, width, nodeWidth };
}

function collectDepthHeights(
  tree: LayoutTree,
  depth: number,
  depthHeights: Map<number, number>,
  nodesById: Map<string, EditorNode>,
): void {
  const node = nodesById.get(tree.id);
  const height = node ? nodeLayoutSize(node).height : minimumNodeHeight;
  depthHeights.set(depth, Math.max(depthHeights.get(depth) ?? 0, height));
  tree.children.forEach((child) => collectDepthHeights(child, depth + 1, depthHeights, nodesById));
}

function buildDepthYPositions(depthHeights: Map<number, number>): Map<number, number> {
  const depthYs = new Map<number, number>();
  const maxDepth = Math.max(0, ...depthHeights.keys());
  let cursor = topPadding;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    depthYs.set(depth, Math.round(cursor));
    cursor += Math.max(minimumNodeHeight, depthHeights.get(depth) ?? minimumNodeHeight) + verticalGap;
  }
  return depthYs;
}

function treeVisualHeight(
  tree: LayoutTree,
  depth: number,
  depthYs: Map<number, number>,
  nodesById: Map<string, EditorNode>,
): number {
  const node = nodesById.get(tree.id);
  const nodeHeight = node ? nodeLayoutSize(node).height : minimumNodeHeight;
  const ownBottom = (depthYs.get(depth) ?? topPadding) + nodeHeight;
  return Math.max(ownBottom, ...tree.children.map((child) => treeVisualHeight(child, depth + 1, depthYs, nodesById)));
}

function placeTree(
  tree: LayoutTree,
  left: number,
  depth: number,
  positions: Record<string, { x: number; y: number }>,
  depthYs: Map<number, number>,
  yOffset = 0,
): void {
  const centerX = left + tree.width / 2;
  positions[tree.id] = {
    x: Math.round(centerX - tree.nodeWidth / 2),
    y: (depthYs.get(depth) ?? topPadding) + yOffset,
  };
  let cursor = left;
  for (const child of tree.children) {
    placeTree(child, cursor, depth + 1, positions, depthYs, yOffset);
    cursor += child.width + branchGap;
  }
}

function compactRowsHorizontally(
  positions: Record<string, { x: number; y: number }>,
  nodesById: Map<string, EditorNode>,
): void {
  const rowStartX = Math.min(...Object.values(positions).map((position) => position.x));
  const rows = new Map<number, Array<{ id: string; x: number }>>();
  for (const [id, position] of Object.entries(positions)) {
    const row = rows.get(position.y) ?? [];
    row.push({ id, x: position.x });
    rows.set(position.y, row);
  }

  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    let cursor = rowStartX;
    for (const item of row) {
      const node = nodesById.get(item.id);
      const width = node ? nodeLayoutSize(node).width : minimumNodeWidth;
      positions[item.id] = { ...positions[item.id], x: Math.round(cursor) };
      cursor += width + rowCompactGap;
    }
  }
}

export function computeAutoArrangeLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
  _options: AutoArrangeOptions = {},
): AutoArrangeLayoutResult {
  const targetNodes = nodes;
  if (targetNodes.length === 0) {
    return { positions: {}, movedCount: 0, arrangedNodeIds: [] };
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const targetNodeIds = new Set(targetNodes.map((node) => node.id));
  const targetEdges = edges.filter((edge) => targetNodeIds.has(edge.source) && targetNodeIds.has(edge.target));
  const outgoingById = new Map<string, EditorEdge[]>();
  for (const edge of targetEdges) {
    outgoingById.set(edge.source, [...(outgoingById.get(edge.source) ?? []), edge]);
  }

  const assigned = new Set<string>();
  const roots = chooseRoots(targetNodes, targetEdges);
  const trees: LayoutTree[] = [];
  for (const rootId of roots) {
    if (!targetNodeIds.has(rootId) || assigned.has(rootId)) continue;
    trees.push(buildTree(rootId, outgoingById, nodesById, targetNodeIds, assigned, new Set()));
  }
  for (const node of targetNodes) {
    if (!assigned.has(node.id)) trees.push(buildTree(node.id, outgoingById, nodesById, targetNodeIds, assigned, new Set()));
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const depthHeights = new Map<number, number>();
  trees.forEach((tree) => collectDepthHeights(tree, 0, depthHeights, nodesById));
  const depthYs = buildDepthYPositions(depthHeights);
  const rowStartX = Math.min(...targetNodes.map((node) => node.position.x), 80);
  let cursor = rowStartX;
  let rowYOffset = 0;
  let rowHeight = 0;
  for (const tree of trees) {
    const treeHeight = treeVisualHeight(tree, 0, depthYs, nodesById) - topPadding;
    const wouldOverflowRow = cursor > rowStartX && (cursor - rowStartX) + tree.width > disconnectedRowWidthLimit;
    if (wouldOverflowRow) {
      rowYOffset += rowHeight + disconnectedGap;
      cursor = rowStartX;
      rowHeight = 0;
    }
    placeTree(tree, cursor, 0, positions, depthYs, rowYOffset);
    cursor += tree.width + disconnectedGap;
    rowHeight = Math.max(rowHeight, treeHeight);
  }

  compactRowsHorizontally(positions, nodesById);

  const arrangedNodeIds = Object.keys(positions);
  const movedCount = arrangedNodeIds.filter((id) => {
    const node = nodesById.get(id);
    const position = positions[id];
    return node && (Math.abs(node.position.x - position.x) > 1 || Math.abs(node.position.y - position.y) > 1);
  }).length;

  return { positions, movedCount, arrangedNodeIds };
}
