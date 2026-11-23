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

const horizontalGap = 112;
const verticalGap = 170;
const componentGap = 320;
const componentRowLimit = 3400;

function positiveSize(...values: Array<number | undefined>): number {
  return values.find((value): value is number => value !== undefined && Number.isFinite(value) && value > 0) ?? 1;
}

export function graphNodeSize(node: EditorNode): { width: number; height: number } {
  const kind = node.data.nodeKind;
  const fallbackHeight = kind === "scene" ? 260 : kind === "start" || kind === "end" ? 96 : 150;
  return {
    width: positiveSize(node.measured?.width, node.width, 300),
    height: positiveSize(node.measured?.height, node.height, fallbackHeight),
  };
}

export function graphSourceHandleOffset(node: EditorNode, sourceHandle?: string | null): number {
  const handle = sourceHandle ?? "default";
  if (handle === "default" || handle === "mainline") return 0.5;
  if (node.data.nodeKind === "condition") return handle === "true" ? 0.35 : 0.65;
  if (node.data.nodeKind === "loop") return handle === "loop" ? 0.35 : 0.65;
  const choices = node.data.nodeKind === "scene"
    ? node.data.scene?.commands.flatMap(command => command.type === "choice" ? command.choices : []) ?? []
    : node.data.choice?.choices ?? [];
  const index = choices.findIndex(choice => choice.choice_id === handle);
  return index < 0 || choices.length < 2 ? 0.5 : 0.18 + (0.64 * index) / (choices.length - 1);
}

export function graphComponents(ids: Iterable<string>, edges: EditorEdge[]): string[][] {
  const remaining = new Set(ids);
  const neighbours = new Map([...remaining].map(id => [id, [] as string[]]));
  for (const { source, target } of edges) {
    if (!neighbours.has(source) || !neighbours.has(target)) continue;
    neighbours.get(source)!.push(target);
    neighbours.get(target)!.push(source);
  }
  const components: string[][] = [];
  for (const id of neighbours.keys()) {
    if (!remaining.delete(id)) continue;
    const component = [id];
    for (const member of component) {
      for (const neighbour of neighbours.get(member)!) {
        if (remaining.delete(neighbour)) component.push(neighbour);
      }
    }
    components.push(component);
  }
  return components;
}

/** Remove only DFS back edges from the rank calculation. All edges still render. */
function rankComponent(ids: string[], outgoing: Map<string, EditorEdge[]>, incomingCount: Map<string, number>, nodes: Map<string, EditorNode>) {
  const roots = [...ids].sort((a, b) => {
    const priority = (id: string) => nodes.get(id)?.data.nodeKind === "start" ? 0 : incomingCount.get(id) ? 2 : 1;
    return priority(a) - priority(b);
  });
  const visited = new Set<string>();
  const active = new Set<string>();
  const order: string[] = [];
  const finished: string[] = [];
  const forward = new Map<string, EditorEdge[]>();
  for (const root of roots) {
    if (visited.has(root)) continue;
    const stack: Array<{ id: string; next: number }> = [];
    const enter = (id: string) => {
      visited.add(id);
      active.add(id);
      order.push(id);
      forward.set(id, []);
      stack.push({ id, next: 0 });
    };
    enter(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edge = outgoing.get(frame.id)?.[frame.next++];
      if (!edge) {
        active.delete(frame.id);
        finished.push(frame.id);
        stack.pop();
      } else if (!active.has(edge.target)) {
        forward.get(frame.id)!.push(edge);
        if (!visited.has(edge.target)) enter(edge.target);
      }
    }
  }
  const rank = new Map<string, number>();
  const incoming = new Map<string, EditorEdge[]>();
  for (const id of finished.reverse()) {
    for (const edge of forward.get(id)!) {
      rank.set(edge.target, Math.max(rank.get(edge.target) ?? 0, (rank.get(id) ?? 0) + 1));
      const parents = incoming.get(edge.target) ?? [];
      parents.push(edge);
      incoming.set(edge.target, parents);
    }
  }
  const rows: string[][] = [];
  for (const id of order) (rows[rank.get(id) ?? 0] ??= []).push(id);
  return { rows, incoming, forward };
}

function placeComponent(ids: string[], outgoing: Map<string, EditorEdge[]>, incomingCount: Map<string, number>, nodes: Map<string, EditorNode>) {
  const { rows, incoming, forward } = rankComponent(ids, outgoing, incomingCount, nodes);
  const sizes = new Map(ids.map(id => [id, graphNodeSize(nodes.get(id)!)]));
  const centers = new Map<string, number>();
  const width = (id: string) => sizes.get(id)!.width;
  let widestRow = 0;
  for (const row of rows) {
    const rowWidth = row.reduce((sum, id) => sum + width(id), (row.length - 1) * horizontalGap);
    widestRow = Math.max(widestRow, rowWidth);
    let x = -rowWidth / 2;
    for (const id of row) {
      centers.set(id, x + width(id) / 2);
      x += width(id) + horizontalGap;
    }
  }
  const initialCenters = new Map(centers);

  // Fit each row to the neighbouring rows, preserving output-port order and spacing.
  // Adjacent blocks are pooled when their desired centers would overlap.
  function align(row: string[], edgesByNode: Map<string, EditorEdge[]>, neighbour: "source" | "target") {
    const blocks: Array<{ start: number; end: number; total: number; count: number }> = [];
    const offsets: number[] = [];
    let offset = 0;
    for (const [index, id] of row.entries()) {
      offsets.push(offset + width(id) / 2);
      offset += width(id) + horizontalGap;
      const edges = edgesByNode.get(id) ?? [];
      // Keep the incoming lane of a single continuation until it actually reaches the merge.
      const endsAtMerge = neighbour === "target" && edges.length === 1
        && (incoming.get(edges[0].target)?.length ?? 0) > 1;
      const neighbours = endsAtMerge ? [centers.get(id)!] : edges.map(edge => centers.get(edge[neighbour])!);
      if (neighbours.length) neighbours.sort((a, b) => a - b);
      // The midpoint of extreme lanes centers both a fork and a merge over their span.
      const desired = neighbours.length ? (neighbours[0] + neighbours[neighbours.length - 1]) / 2 : initialCenters.get(id)!;
      blocks.push({ start: index, end: index, total: desired - offsets[index], count: 1 });
      while (blocks.length > 1) {
        const last = blocks[blocks.length - 1];
        const previous = blocks[blocks.length - 2];
        if (previous.total / previous.count <= last.total / last.count) break;
        previous.end = last.end;
        previous.total += last.total;
        previous.count += last.count;
        blocks.pop();
      }
    }
    const left = -widestRow / 2;
    const right = widestRow / 2 - (offset - horizontalGap);
    for (const block of blocks) {
      const shift = Math.min(right, Math.max(left, block.total / block.count));
      for (let index = block.start; index <= block.end; index++) {
        centers.set(row[index], shift + offsets[index]);
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let index = 1; index < rows.length; index++) align(rows[index], incoming, "source");
    for (let index = rows.length - 2; index >= 0; index--) align(rows[index], forward, "target");
  }
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (const row of rows) {
    let rowHeight = 140;
    for (const id of row) {
      const size = sizes.get(id)!;
      positions.set(id, { x: Math.round(centers.get(id)! + widestRow / 2 - size.width / 2), y });
      rowHeight = Math.max(rowHeight, size.height);
    }
    y += Math.ceil(rowHeight) + verticalGap;
  }
  return { positions, width: widestRow, height: y - verticalGap };
}

export function computeAutoArrangeLayout(
  nodes: EditorNode[],
  edges: EditorEdge[],
  _options: AutoArrangeOptions = {},
): AutoArrangeLayoutResult {
  const visibleNodes = nodes.filter(node => !node.hidden);
  const nodesById = new Map(visibleNodes.map(node => [node.id, node]));
  const visibleEdges = edges.filter(edge => !edge.hidden && nodesById.has(edge.source) && nodesById.has(edge.target));
  const outgoing = new Map<string, EditorEdge[]>();
  const incomingCount = new Map<string, number>();
  for (const edge of visibleEdges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge);
    outgoing.set(edge.source, list);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }
  for (const [source, list] of outgoing) {
    const node = nodesById.get(source)!;
    list.sort((a, b) => graphSourceHandleOffset(node, a.sourceHandle) - graphSourceHandleOffset(node, b.sourceHandle)
      || a.target.localeCompare(b.target) || a.id.localeCompare(b.id));
  }
  const components = graphComponents(nodesById.keys(), visibleEdges);
  components.sort((a, b) => Number(b.some(id => nodesById.get(id)?.data.nodeKind === "start"))
    - Number(a.some(id => nodesById.get(id)?.data.nodeKind === "start")));
  const positions = Object.create(null) as AutoArrangeLayoutResult["positions"];
  const originX = 80;
  let x = originX;
  let y = 120;
  let rowHeight = 0;
  for (const ids of components) {
    const component = placeComponent(ids, outgoing, incomingCount, nodesById);
    if (x > originX && x - originX + component.width > componentRowLimit) {
      x = originX;
      y += rowHeight + componentGap;
      rowHeight = 0;
    }
    for (const [id, position] of component.positions) positions[id] = { x: x + position.x, y: y + position.y };
    x += Math.ceil(component.width) + componentGap;
    rowHeight = Math.max(rowHeight, component.height);
  }
  const arrangedNodeIds = Object.keys(positions);
  const movedCount = arrangedNodeIds.filter(id => {
    const original = nodesById.get(id)!.position;
    return Math.abs(original.x - positions[id].x) > 1 || Math.abs(original.y - positions[id].y) > 1;
  }).length;
  return { positions, arrangedNodeIds, movedCount };
}
