import type { EditorEdge, EditorNode } from "../types/nodes";

export function outgoingEdges(nodeId: string, edges: EditorEdge[]): EditorEdge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

export function reachableNodeIds(startNodeId: string, nodes: EditorNode[], edges: EditorEdge[]): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const visited = new Set<string>();
  const stack = [startNodeId];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current) || !nodeIds.has(current)) continue;
    visited.add(current);
    for (const edge of outgoingEdges(current, edges)) {
      stack.push(edge.target);
    }
  }
  return visited;
}

export function buildPreviousSummary(nodeId: string, nodes: EditorNode[], edges: EditorEdge[], maxScenes = 5): string {
  const incomingMap = new Map<string, string[]>();
  for (const edge of edges) {
    incomingMap.set(edge.target, [...(incomingMap.get(edge.target) ?? []), edge.source]);
  }
  const summaries: string[] = [];
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id) || summaries.length >= maxScenes) return;
    visited.add(id);
    const parents = incomingMap.get(id) ?? [];
    for (const parentId of parents) {
      const parent = nodes.find((node) => node.id === parentId);
      if (parent?.data.scene?.summary) summaries.unshift(parent.data.scene.summary);
      walk(parentId);
    }
  };
  walk(nodeId);
  return summaries.slice(-maxScenes).join("\n");
}
