import type { EditorEdge, EditorNode } from "../types/nodes";
import { graphComponents, graphNodeSize, graphSourceHandleOffset } from "./autoArrangeGraph";

export type GraphPoint = { x: number; y: number };
export type GraphRect = GraphPoint & { width: number; height: number };
export type GraphCard = GraphRect & { node: EditorNode };

const clearance = 18;
const cornerRadius = 12;

export function graphCards(nodes: EditorNode[]): GraphCard[] {
  return nodes.filter(node => !node.hidden).map(node => ({ ...node.position, ...graphNodeSize(node), node }));
}

export function roundedGraphPath(points: readonly GraphPoint[], radius = cornerRadius): string {
  if (!points.length) return "";
  const first = points[0];
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const before = Math.hypot(current.x - previous.x, current.y - previous.y);
    const after = Math.hypot(next.x - current.x, next.y - current.y);
    const r = Math.min(radius, before / 2, after / 2);
    if (!r || (previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y)) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const fromX = current.x + (previous.x - current.x) * r / before;
    const fromY = current.y + (previous.y - current.y) * r / before;
    const toX = current.x + (next.x - current.x) * r / after;
    const toY = current.y + (next.y - current.y) * r / after;
    path += ` L ${fromX} ${fromY} Q ${current.x} ${current.y} ${toX} ${toY}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function graphEndpointPath(points: readonly GraphPoint[], source: GraphPoint, target: GraphPoint): string {
  if (points.length < 4) return roundedGraphPath([source, { x: source.x, y: (source.y + target.y) / 2 }, { x: target.x, y: (source.y + target.y) / 2 }, target]);
  // React Flow owns port geometry. Keep the planned channel and connect it to the actual ports.
  const start = { x: source.x, y: Math.max(source.y + 8, points[1].y) };
  const end = { x: target.x, y: Math.min(target.y - 8, points[points.length - 2].y) };
  if (points.length === 4 && start.y <= end.y) {
    const middleY = Math.max(start.y, Math.min(end.y, points[1].y));
    return roundedGraphPath([source, { x: source.x, y: middleY }, { x: target.x, y: middleY }, target]);
  }
  const interior = points.length > 4
    ? [{ x: points[2].x, y: start.y }, { x: points[3].x, y: end.y }]
    : [{ x: source.x, y: start.y }, { x: source.x, y: end.y }];
  return roundedGraphPath([source, start, ...interior, end, target]);
}

type Span = { from: number; to: number };

function rangesOverlap(a: number, b: number, minimum: number, maximum: number): boolean {
  return Math.min(a, b) < maximum && Math.max(a, b) > minimum;
}

function touchesCard(a: GraphPoint, b: GraphPoint, card: GraphCard): boolean {
  const x = card.x - clearance;
  const y = card.y - clearance;
  const right = card.x + card.width + clearance;
  const bottom = card.y + card.height + clearance;
  return a.x === b.x
    ? a.x > x && a.x < right && rangesOverlap(a.y, b.y, y, bottom)
    : a.y > y && a.y < bottom && rangesOverlap(a.x, b.x, x, right);
}

function indexCardsByHeight(cards: GraphCard[]) {
  const sorted = [...cards].sort((a, b) => a.y - b.y);
  let bottom = -Infinity;
  const prefixBottom = sorted.map(card => {
    bottom = Math.max(bottom, card.y + card.height + clearance);
    return bottom;
  });
  return (top: number, bottom: number): GraphCard[] => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (prefixBottom[mid] <= top) lo = mid + 1;
      else hi = mid;
    }
    const matches: GraphCard[] = [];
    for (let index = lo; index < sorted.length && sorted[index].y - clearance < bottom; index++) {
      const card = sorted[index];
      if (card.y + card.height + clearance > top) matches.push(card);
    }
    return matches;
  };
}

/** Plan a small set of orthogonal channels. Layout order is derived, never saved into the story. */
export function routeGraphEdges(cards: GraphCard[], edges: EditorEdge[]): Map<string, GraphPoint[]> {
  const byId = new Map(cards.map(card => [card.node.id, card]));
  const cardsInBand = indexCardsByHeight(cards);
  const visibleEdges = edges.filter(edge => !edge.hidden && byId.has(edge.source) && byId.has(edge.target));
  const componentBounds = new Map<string, { left: number; right: number }>();
  for (const ids of graphComponents(byId.keys(), visibleEdges)) {
    const bounds = { left: Infinity, right: -Infinity };
    for (const id of ids) {
      const card = byId.get(id)!;
      bounds.left = Math.min(bounds.left, card.x);
      bounds.right = Math.max(bounds.right, card.x + card.width);
    }
    for (const id of ids) componentBounds.set(id, bounds);
  }
  const routes = new Map<string, GraphPoint[]>();
  const horizontalTracks = new Map<number, Span[]>();
  const verticalTracks = new Map<number, Span[]>();
  const trackKey = (value: number) => Math.round(value / 8);
  function segment(a: GraphPoint, b: GraphPoint) {
    const horizontal = a.y === b.y;
    const key = trackKey(horizontal ? a.y : a.x);
    const from = Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    const to = Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y);
    return { tracks: horizontal ? horizontalTracks : verticalTracks, key, from, to };
  }
  for (const edge of visibleEdges) {
    const from = byId.get(edge.source)!;
    const to = byId.get(edge.target)!;
    const source = { x: from.x + from.width * graphSourceHandleOffset(from.node, edge.sourceHandle), y: from.y + from.height };
    const target = { x: to.x + to.width / 2, y: to.y };
    const departure = source.y + 32;
    const arrival = target.y - 32;
    const forward = target.y > source.y + 48;
    const top = Math.min(arrival, source.y);
    const bottom = Math.max(departure, target.y);
    const obstacles = cardsInBand(top, bottom);
    let best: GraphPoint[] = [];
    let bestScore = Infinity;
    function consider(points: GraphPoint[]) {
      let score = (points.length - 4) * 16;
      for (let index = 1; index < points.length; index++) {
        const previous = points[index - 1];
        const current = points[index];
        const length = Math.abs(previous.x - current.x) + Math.abs(previous.y - current.y);
        if (!length) continue;
        score += length;
        if (score >= bestScore) return;
        for (const obstacle of obstacles) {
          if ((index === 1 && obstacle === from) || (index === points.length - 1 && obstacle === to)) continue;
          if (touchesCard(previous, current, obstacle)) score += 100000;
        }
        // Let edges share a short exit or entry stem, but avoid sharing the channel between ports.
        if (index > 1 && index < points.length - 1) {
          const { tracks, key, from, to } = segment(previous, current);
          const shared = tracks.get(key)?.some(span => Math.min(to, span.to) - Math.max(from, span.from) > 16);
          if (shared) score += 72;
        }
        if (score >= bestScore) return;
      }
      best = points;
      bestScore = score;
    }
    if (forward) {
      const middle = Math.round((source.y + target.y) / 2);
      for (const offset of [0, -14, 14, -28, 28, -42, 42]) {
        const y = middle + offset;
        if (y <= source.y + clearance || y >= target.y - clearance) continue;
        consider([source, { x: source.x, y }, { x: target.x, y }, target]);
        if (bestScore === Math.abs(source.x - target.x) + target.y - source.y) break;
      }
    }
    if (bestScore >= 100000 || !forward) {
      const bounds = componentBounds.get(edge.source)!;
      const candidates = new Set<number>();
      if (forward && departure <= arrival) {
        candidates.add(Math.round((source.x + target.x) / 2));
        candidates.add(source.x);
        candidates.add(target.x);
        for (const obstacle of obstacles) {
          candidates.add(obstacle.x - 36);
          candidates.add(obstacle.x + obstacle.width + 36);
        }
      }
      for (const margin of [48, 72, 96, 120, 144]) {
        candidates.add(bounds.left - margin);
        candidates.add(bounds.right + margin);
      }
      const midX = (source.x + target.x) / 2;
      const channels = [...candidates].sort((a, b) => Math.abs(a - midX) - Math.abs(b - midX));
      for (const x of channels) {
        consider([source, { x: source.x, y: departure }, { x, y: departure }, { x, y: arrival }, { x: target.x, y: arrival }, target]);
      }
    }
    routes.set(edge.id, best);
    for (let index = 2; index < best.length - 1; index++) {
      const { tracks, key, from, to } = segment(best[index - 1], best[index]);
      if (to - from <= 16) continue;
      const spans = tracks.get(key) ?? [];
      spans.push({ from, to });
      tracks.set(key, spans);
    }
  }
  return routes;
}
