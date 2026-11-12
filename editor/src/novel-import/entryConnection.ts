import type { EditorEdge, EditorNode } from "../types/nodes";

/** An untouched starter scene is disposable; an edited starter is authored content. */
export function isDefaultOpeningNode(node: EditorNode | undefined): boolean {
  const scene = node?.data.scene;
  if (!node || node.id !== "node_scene_opening" || node.data.nodeKind !== "scene" || !scene) return false;
  const expected = {
    scene_id: "scene_opening", title: "开场", summary: "雨夜里，主角抵达旧车站。",
    commands: [
      { type: "background", background_id: "station_rain", background_fit: "stretch", transition: "fade" },
      { type: "narration", text: "雨水沿着站牌边缘滴落。" },
      { type: "dialog", character_id: "alice", text: "你终于来了。", emotion: "calm", side: "left" },
    ], chapter: 1, tags: ["opening"],
  };
  return Object.keys(scene).every(key => key in expected)
    && Object.entries(expected).every(([key, value]) =>
      JSON.stringify(scene[key as keyof typeof scene]) === JSON.stringify(value));
}

export type NovelEntryConnection = {
  status: "connected" | "available" | "manual" | "missing";
  message: string;
  firstNodeId?: string;
  importedCount: number;
  reachableCount: number;
  removableNodeId?: string;
  startId?: string;
};

export function inspectNovelEntryConnection(
  nodes: EditorNode[], edges: EditorEdge[], importLineId: string | undefined,
): NovelEntryConnection {
  const line = importLineId ? nodes.filter(node => node.data.editorMeta?.importLineId === importLineId)
    .sort((a, b) => (a.data.editorMeta?.importIndex ?? 0) - (b.data.editorMeta?.importIndex ?? 0)) : [];
  const starts = nodes.filter(node => node.data.nodeKind === "start");
  const base = { importedCount: line.length, reachableCount: 0, firstNodeId: line[0]?.id, startId: starts[0]?.id };
  if (!line.length) return { ...base, status: "missing", message: "当前任务尚未写入场景。" };
  const reached = new Set(starts.map(node => node.id));
  // Follow real graph edges. No model calls, source edits or fabricated links.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const pending = [...reached];
  for (let i = 0; i < pending.length; i++) {
    for (const target of outgoing.get(pending[i]) ?? []) {
      if (!reached.has(target)) { reached.add(target); pending.push(target); }
    }
  }
  base.reachableCount = line.filter(node => reached.has(node.id)).length;
  const rootEdges = starts.length === 1 ? edges.filter(edge => edge.source === starts[0].id) : [];
  if (base.reachableCount === line.length && starts.length === 1 && rootEdges.length === 1
    && (!rootEdges[0].sourceHandle || rootEdges[0].sourceHandle === "default"))
    return { ...base, status: "connected", message: `${line.length} 个生成场景已接入游戏入口。` };
  const ids = new Set(line.map(node => node.id));
  const remaining = nodes.filter(node => !ids.has(node.id) && node.data.nodeKind !== "start");
  const opening = remaining.length === 1 && isDefaultOpeningNode(remaining[0]) ? remaining[0] : undefined;
  const start = starts[0];
  const startEdges = rootEdges;
  const defaultStart = startEdges.length === 0 || (opening && startEdges.length === 1
    && startEdges[0].target === opening.id && (!startEdges[0].sourceHandle || startEdges[0].sourceHandle === "default"));
  const internal = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  const linear = internal.length === line.length - 1 && line.slice(1).every((node, index) =>
    internal.some(edge => edge.source === line[index].id && edge.target === node.id
      && (!edge.sourceHandle || edge.sourceHandle === "default")));
  const ordinaryEdges = edges.every(edge => internal.includes(edge) || startEdges.includes(edge));
  if (starts.length === 1 && (remaining.length === 0 || opening) && defaultStart && linear && ordinaryEdges
    && new Set(nodes.map(node => node.id)).size === nodes.length) {
    return { ...base, status: "available", removableNodeId: opening?.id,
      message: opening ? "生成场景未接入入口；可移除未修改的默认开场并接入本次结果。"
        : "生成场景未接入入口；可将本次结果接入空白入口。" };
  }
  return { ...base, status: "manual",
    message: `${base.reachableCount}/${line.length} 个生成场景可从入口到达。已有剧情或连线将保留，请在画布中连接本次结果。` };
}

/** Called again at commit time; never apply a stale UI eligibility decision. */
export function connectNovelEntry(nodes: EditorNode[], edges: EditorEdge[], importLineId: string) {
  const inspection = inspectNovelEntryConnection(nodes, edges, importLineId);
  if (inspection.status !== "available" || !inspection.startId || !inspection.firstNodeId)
    throw new Error(inspection.status === "connected" ? "本次结果已接入游戏入口。" : inspection.message);
  const { removableNodeId, firstNodeId, startId } = inspection;
  return {
    inspection,
    nodes: nodes.filter(node => node.id !== removableNodeId),
    edges: [
      ...edges.filter(edge => edge.source !== removableNodeId && edge.target !== removableNodeId),
      { id: `novel_entry_${importLineId}`, source: startId, target: firstNodeId, sourceHandle: "default" },
    ],
  };
}
