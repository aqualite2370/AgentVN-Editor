import type { EditorNode } from "../types/nodes";
import type { NovelProcessJob, NovelProcessPhaseProgress } from "./processJobTypes";
import { validateRuntimeScript } from "../../../shared/cartridge/validators";
import type { GameCommand } from "../../../shared/cartridge/types";

interface GraphPhaseInput {
  nodes: EditorNode[];
  sessionId: string;
  taskKind: "executor" | "blueprint" | "fixture";
  plannedScenes?: number;
}

// Exhaustive against the command union. This projection never modifies a
// source mapping, author graph, model result or running game.
const commandTypes: Record<GameCommand["type"], true> = {
  dialog: true, narration: true, hide_dialog: true, background: true, show_image: true,
  video: true, sprite: true, choice: true, state_update: true, conditional_jump: true,
  jump: true, animation: true, bgm: true, sfx: true, camera: true, wait: true,
  gallery_anchor: true, rollback: true,
};

function structureErrors(node: EditorNode, allNodes: EditorNode[]): string[] {
  const scene = node.data.scene;
  if (!scene?.scene_id?.trim()) return ["实际节点缺少 scene_id。"];
  if (!Array.isArray(scene.commands)) return ["实际节点 commands 不是事件数组。"];
  if (allNodes.some(other => other.id !== node.id && other.data.scene?.scene_id === scene.scene_id))
    return [`scene_id "${scene.scene_id}" 与工程中另一节点重复。`];
  for (const command of scene.commands) {
    if (!command || typeof command.type !== "string" || !Object.prototype.hasOwnProperty.call(commandTypes, command.type))
      return ["实际节点包含未知或损坏的事件类型。"];
    if ((command.type === "dialog" || command.type === "narration") && typeof command.text !== "string")
      return ["对白事件缺少有效文本。"];
    if (command.type === "choice" && (!Array.isArray(command.choices) || command.choices.length === 0))
      return ["分支事件没有有效选项。"];
  }
  try {
    // Validate the actual scene with real scene IDs as reference context.
    // Empty context command lists exclude unrelated author's errors. This is
    // not a full-project, asset, source-fidelity or export acceptance gate.
    const context = [...new Map(allNodes
      .filter(other => other.id !== node.id && other.data.scene?.scene_id)
      .map(other => [other.data.scene!.scene_id, { ...other.data.scene!, commands: [] }])).values()];
    const result = validateRuntimeScript({
      schema_version: "1.0", game_id: "novel-graph-structure-check", title: "当前任务节点结构校验",
      entry_scene_id: scene.scene_id, scenes: [scene, ...context],
    });
    return result.errors.map(issue => issue.message);
  } catch {
    return ["实际节点事件字段损坏，结构校验未通过。"];
  }
}

export function withNovelGraphPhaseProgress(job: NovelProcessJob, input: GraphPhaseInput): NovelProcessJob {
  if (input.taskKind === "fixture") return job;
  const executor = input.taskKind === "executor";
  const scoped = input.nodes.filter(node => node.data.scene && (executor
    ? node.data.editorMeta?.sourceProcessJobId === job.jobId
    : node.data.editorMeta?.importSessionId === input.sessionId));
  const chapterIds = new Set(job.chapters.map(chapter => chapter.chapterIndex));
  const total = Math.max(1, executor
    ? Math.max(chapterIds.size, job.selectedChapterCount)
    : input.plannedScenes ?? job.totalChunks);
  // Copies of one chapter cannot count twice. Legacy unindexed nodes count
  // only their observed scene, not all chapters of a terminal job.
  const groups = new Map<string, EditorNode[]>();
  for (const node of scoped) {
    const chapter = node.data.editorMeta?.sourceProcessChapterIndex;
    if (executor && chapter !== undefined && chapterIds.size > 0 && !chapterIds.has(chapter)) continue;
    const key = executor && chapter !== undefined ? `chapter:${chapter}` : `node:${node.id}`;
    groups.set(key, [...(groups.get(key) ?? []), node]);
  }
  const written = Math.min(total, groups.size);
  const failures: string[] = [];
  let validated = 0;
  for (const group of groups.values()) {
    const errors = group.flatMap(node => structureErrors(node, input.nodes));
    failures.push(...errors);
    if (errors.length === 0) validated++;
  }
  validated = Math.min(total, validated);
  const incompleteStatus = job.status === "cancelled" ? "cancelled"
    : job.status === "failed" || job.status === "failed_partial" ? "blocked" : "waiting";
  const phase = (validation: boolean): NovelProcessPhaseProgress => {
    const current = validation ? validated : written;
    return {
      phase: validation ? "validation" : "import_write",
      label: validation ? "结构校验" : "写入蓝图",
      status: validation && failures.length > 0 ? "blocked" : current === total ? "completed" : incompleteStatus,
      current, total, percent: Math.round(current / total * 100),
      updatedAt: job.updatedAt, etaMs: null,
      progressBasis: validation ? "current_project_structure_validation" : "current_project_graph",
      blockingReason: validation
        ? failures.length > 0 ? failures.slice(0, 3).join("\n")
          : `${validated}/${total} ${executor ? "章" : "场景"}当前节点结构已核对；不代表全工程、素材或导出验收通过。`
        : `${written}/${total} ${executor ? "章" : "场景"}实际存在于本工程；生成结束不等于写入完成。`,
    };
  };
  const phases = (Array.isArray(job.phaseProgress) ? job.phaseProgress : [])
    .filter(item => item.phase !== "import_write" && item.phase !== "validation");
  return { ...job, phaseProgress: [...phases, phase(false), phase(true)] };
}
