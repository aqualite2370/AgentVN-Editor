import type { EditorEdge, EditorNode } from "../types/nodes";
import { commandLabels } from "./commandTools";

interface HistoryGraph {
  nodes: readonly Pick<EditorNode, "id" | "data" | "position">[];
  edges: readonly EditorEdge[];
  memoryMode?: string;
}

// Compare JSON values rather than serialized key order or transient ReactFlow fields.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
  const keys = Object.keys(first).filter(key => first[key] !== undefined);
  return keys.length === Object.keys(second).filter(key => second[key] !== undefined).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(second, key) && sameValue(first[key], second[key]));
}

function name(node: HistoryGraph["nodes"][number]): string {
  const text = node.data.scene?.title?.trim() || node.data.label?.trim() || "未命名节点";
  return `「${text.length > 36 ? text.slice(0, 35) + "…" : text}」`;
}

function eventsDescription(before: HistoryGraph["nodes"][number], after: HistoryGraph["nodes"][number]): string | undefined {
  const previous = before.data.scene?.commands, next = after.data.scene?.commands;
  if (!previous || !next || sameValue(previous, next)) return undefined;
  const title = name(after);
  const first = Math.max(0, next.findIndex((command, index) => !sameValue(command, previous[index])));
  if (next.length > previous.length) return `新增${title}的 ${next.length - previous.length} 项事件`;
  if (next.length < previous.length) return `删除${title}的 ${previous.length - next.length} 项事件`;
  const unmatched = [...previous];
  const reordered = next.every(command => {
    const index = unmatched.findIndex(item => sameValue(command, item));
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
  if (reordered) return `重排${title}的 ${next.length} 项事件`;
  const changed = next.filter((command, index) => !sameValue(command, previous[index])).length;
  return changed === 1 ? `修改${title}第 ${first + 1} 项事件（${commandLabels[next[first].type]}）`
    : `修改${title}的 ${changed} 项事件`;
}

/** Describe the actual before/after edit, without exposing internal node IDs. */
export function describeGraphChange(before: HistoryGraph, after: HistoryGraph): string {
  const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
  const newNodes = new Map(after.nodes.map(node => [node.id, node]));
  const added = after.nodes.filter(node => !oldNodes.has(node.id));
  const removed = before.nodes.filter(node => !newNodes.has(node.id));
  const parts: string[] = [];
  if (added.length) parts.push(added.length === 1 ? `新增节点${name(added[0])}` : `新增 ${added.length} 个节点`);
  if (removed.length) parts.push(removed.length === 1 ? `删除节点${name(removed[0])}` : `删除 ${removed.length} 个节点`);
  const edits: string[] = [], renamed: string[] = [], dataChanges: string[] = [];
  let moved = 0;
  for (const node of after.nodes) {
    const old = oldNodes.get(node.id);
    if (!old) continue;
    const events = eventsDescription(old, node);
    if (events) edits.push(events);
    else if (old.data.label !== node.data.label || old.data.scene?.title !== node.data.scene?.title)
      renamed.push(`修改节点${name(old)}的名称`);
    else if (!sameValue(old.data, node.data)) dataChanges.push(`修改节点${name(node)}的设置`);
    if (!sameValue(old.position, node.position)) moved++;
  }
  if (edits.length) parts.push(edits.length <= 2 ? edits.join("；") : `修改 ${edits.length} 个场景的事件`);
  if (renamed.length) parts.push(renamed.length === 1 ? renamed[0] : `修改 ${renamed.length} 个节点的名称`);
  if (dataChanges.length) parts.push(dataChanges.length === 1 ? dataChanges[0] : `修改 ${dataChanges.length} 个节点的设置`);
  if (moved) parts.push(`调整 ${moved} 个节点的位置`);
  const oldEdges = new Map(before.edges.map(edge => [edge.id, edge]));
  const newEdges = new Map(after.edges.map(edge => [edge.id, edge]));
  const addedEdges = after.edges.filter(edge => !oldEdges.has(edge.id)).length;
  const removedEdges = before.edges.filter(edge => !newEdges.has(edge.id)).length;
  const changedEdges = after.edges.filter(edge => {
    const old = oldEdges.get(edge.id);
    return old && (old.source !== edge.source || old.target !== edge.target
      || old.sourceHandle !== edge.sourceHandle || old.targetHandle !== edge.targetHandle || !sameValue(old.data, edge.data));
  }).length;
  if (addedEdges) parts.push(`新增 ${addedEdges} 条连线`);
  if (removedEdges) parts.push(`删除 ${removedEdges} 条连线`);
  if (changedEdges) parts.push(`修改 ${changedEdges} 条连线`);
  if (before.memoryMode !== after.memoryMode) parts.push("切换记忆模式");
  return parts.length ? parts.join("；") : "修改工程图";
}
