import type { EditorEdge, EditorNode } from "../types/nodes";
import type { GameCommand } from "../types/commands";
import type { MemoryMode } from "../types/memory";
import type { ProviderSelectionPayload } from "../api/types";
import { packPrioritizedContext, type ContextBudgetReport, type PrioritizedContextItem } from "./contextBudget";

const MAX_SCENES = 80;
const MAX_TEXT_LENGTH = 220;

function compactText(value: string | null | undefined, maxLength = MAX_TEXT_LENGTH): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function summarizeCommand(command: GameCommand): Record<string, unknown> {
  if (command.type === "dialog") {
    return {
      type: command.type,
      character_id: command.character_id,
      text: compactText(command.text),
      emotion: command.emotion ?? null,
      side: command.side ?? null,
      portrait: command.portrait ?? null,
    };
  }
  if (command.type === "narration") {
    return { type: command.type, text: compactText(command.text) };
  }
  if (command.type === "choice") {
    return {
      type: command.type,
      choices: command.choices.map((choice) => ({
        choice_id: choice.choice_id,
        choice_display_name: choice.choice_display_name ?? null,
        text: compactText(choice.text, 120),
        target_scene_id: choice.target_scene_id,
        conditions: choice.conditions,
      })),
    };
  }
  return { ...command };
}

function collectCommandIndex(commands: GameCommand[]) {
  const characters = new Set<string>();
  const backgrounds = new Set<string>();
  const focusedImages = new Set<string>();
  const sprites = new Set<string>();
  const bgm = new Set<string>();
  const sfx = new Set<string>();
  const stateKeys = new Set<string>();
  const choices: Array<{ choice_id: string; text: string; target_scene_id: string }> = [];

  for (const command of commands) {
    if (command.type === "dialog") characters.add(command.character_id);
    if (command.type === "sprite") {
      characters.add(command.character_id);
      sprites.add(command.sprite_id);
    }
    if (command.type === "background") backgrounds.add(command.background_id);
    if (command.type === "show_image") focusedImages.add(command.image_id);
    if (command.type === "bgm" && command.bgm_id) bgm.add(command.bgm_id);
    if (command.type === "sfx") sfx.add(command.sfx_id);
    if (command.type === "state_update") stateKeys.add(command.key);
    if (command.type === "choice") {
      command.choices.forEach((choice) => {
        choices.push({
          choice_id: choice.choice_id,
          text: compactText(choice.text, 120),
          target_scene_id: choice.target_scene_id,
        });
      });
    }
  }

  return {
    characters: [...characters],
    backgrounds: [...backgrounds],
    focused_images: [...focusedImages],
    sprites: [...sprites],
    bgm: [...bgm],
    sfx: [...sfx],
    state_keys: [...stateKeys],
    choices,
  };
}

function buildTagIndex(nodes: EditorNode[]) {
  const tags: Record<string, string[]> = {};
  for (const node of nodes) {
    const scene = node.data.scene;
    if (!scene) continue;
    scene.tags.forEach((tag) => {
      if (!tags[tag]) tags[tag] = [];
      tags[tag].push(scene.scene_id);
    });
  }
  return tags;
}

function buildChapterIndex(nodes: EditorNode[]) {
  const chapters: Record<string, string[]> = {};
  for (const node of nodes) {
    const scene = node.data.scene;
    if (!scene) continue;
    const key = String(scene.chapter);
    if (!chapters[key]) chapters[key] = [];
    chapters[key].push(scene.scene_id);
  }
  return chapters;
}

function edgePayload(edge: EditorEdge) {
  return {
    id: edge.id,
    source: edge.source,
    source_handle: edge.sourceHandle ?? null,
    target: edge.target,
    target_handle: edge.targetHandle ?? null,
    label: edge.label ?? null,
  };
}

function sceneSummaryObject(node: EditorNode): Record<string, unknown> {
  const scene = node.data.scene;
  if (!scene) {
    return {
      node_id: node.id,
      node_kind: node.data.nodeKind,
      label: node.data.label,
      description: compactText(node.data.description, 260),
    };
  }
  const commandIndex = collectCommandIndex(scene.commands);
  const runtimeScene = scene as typeof scene & {
    is_ending?: boolean;
    ending_id?: string | null;
    ending_title?: string | null;
  };
  return {
    node_id: node.id,
    scene_id: scene.scene_id,
    title: scene.title,
    scene_display_name: scene.scene_display_name ?? null,
    summary: compactText(scene.summary, 360),
    chapter: scene.chapter,
    tags: scene.tags,
    is_ending: runtimeScene.is_ending ?? false,
    ending_id: runtimeScene.ending_id ?? null,
    ending_title: runtimeScene.ending_title ?? null,
    command_count: scene.commands.length,
    command_types: scene.commands.map((command) => command.type),
    ...commandIndex,
  };
}

function sceneSummary(node: EditorNode): string {
  return JSON.stringify(sceneSummaryObject(node));
}

function fullNodeContext(node: EditorNode): string {
  const scene = node.data.scene;
  if (!scene) {
    return JSON.stringify({
      node_id: node.id,
      node_kind: node.data.nodeKind,
      position: node.position,
      label: node.data.label,
      description: node.data.description,
      choice: node.data.choice,
      state_update: node.data.stateUpdate,
      condition: node.data.condition,
      animation: node.data.animation,
      ending: node.data.ending,
    });
  }
  return JSON.stringify({
    node_id: node.id,
    position: node.position,
    label: node.data.label,
    description: node.data.description,
    memory_mode: node.data.memoryMode ?? null,
    ai_settings: {
      author_goal: node.data.aiSettings.authorGoal,
      generation_outline: node.data.aiSettings.generationOutline,
      auto_extract_memory: node.data.aiSettings.autoExtractMemory,
      auto_apply_memory: node.data.aiSettings.autoApplyMemory,
    },
    scene,
  });
}

function buildEditorGenerationContextItems(options: {
  currentNodeId: string;
  contextNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  memoryMode: MemoryMode;
}): PrioritizedContextItem[] {
  const { currentNodeId, contextNodeId, nodes, edges, memoryMode } = options;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const currentNode = nodeById.get(currentNodeId);
  const contextNode = nodeById.get(contextNodeId);
  const focusIds = new Set([currentNodeId, contextNodeId].filter(Boolean));
  const adjacentEdges = edges.filter((edge) => focusIds.has(edge.source) || focusIds.has(edge.target));
  const adjacentIds = new Set<string>();
  for (const edge of adjacentEdges) {
    adjacentIds.add(edge.source);
    adjacentIds.add(edge.target);
  }
  focusIds.forEach((id) => adjacentIds.delete(id));

  const sceneNodes = nodes.filter((node) => node.data.nodeKind === "scene" && node.data.scene);
  const nonSceneNodes = nodes.filter((node) => node.data.nodeKind !== "scene");
  const items: PrioritizedContextItem[] = [
    {
      id: "editor-request",
      priority: "P0",
      title: "Generation request anchors",
      text: JSON.stringify({
        context_version: "2.0-prioritized",
        purpose: "Editor context for AI scene generation. Treat this as reference material, not output schema.",
        current_node_id: currentNodeId,
        context_node_id: contextNodeId,
        global_memory_mode: memoryMode,
        graph_stats: {
          node_count: nodes.length,
          edge_count: edges.length,
          scene_count: sceneNodes.length,
        },
      }),
      summary: "当前生成请求的锚点、全局记忆模式和图谱规模。",
      tags: ["current", "anchors"],
    },
  ];

  if (currentNode) {
    items.push({
      id: `current:${currentNode.id}`,
      priority: "P0",
      title: `Current node ${currentNode.data.scene?.scene_id ?? currentNode.id}`,
      text: fullNodeContext(currentNode),
      summary: sceneSummary(currentNode),
      tags: ["current-node", currentNode.data.nodeKind],
    });
  }

  if (contextNode && contextNode.id !== currentNode?.id) {
    items.push({
      id: `context:${contextNode.id}`,
      priority: "P0",
      title: `Context source node ${contextNode.data.scene?.scene_id ?? contextNode.id}`,
      text: fullNodeContext(contextNode),
      summary: sceneSummary(contextNode),
      tags: ["context-node", contextNode.data.nodeKind],
    });
  }

  if (adjacentEdges.length > 0) {
    items.push({
      id: "adjacent-edges",
      priority: "P1",
      title: "Incoming and outgoing edges around the current scene",
      text: JSON.stringify(adjacentEdges.map(edgePayload)),
      summary: `当前节点附近共有 ${adjacentEdges.length} 条连线，影响前后剧情、分支和跳转关系。`,
      tags: ["edges", "local-graph"],
    });
  }

  for (const nodeId of adjacentIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    items.push({
      id: `adjacent:${node.id}`,
      priority: "P1",
      title: `Adjacent node ${node.data.scene?.scene_id ?? node.id}`,
      text: fullNodeContext(node),
      summary: sceneSummary(node),
      tags: ["adjacent", node.data.nodeKind],
    });
  }

  const remoteSceneSummaries = sceneNodes
    .filter((node) => !focusIds.has(node.id) && !adjacentIds.has(node.id))
    .slice(0, MAX_SCENES)
    .map(sceneSummaryObject);
  if (remoteSceneSummaries.length > 0) {
    items.push({
      id: "remote-scene-index",
      priority: "P2",
      title: "Remote scene summary index",
      text: JSON.stringify(remoteSceneSummaries),
      summary: `远端场景索引共 ${remoteSceneSummaries.length} 个，用于维持章节、角色、资源和跳转一致性。`,
      tags: ["remote-scenes", "summary-index"],
    });
  }

  items.push({
    id: "global-indexes",
    priority: "P2",
    title: "Global tag and chapter indexes",
    text: JSON.stringify({
      tag_index: buildTagIndex(nodes),
      chapter_index: buildChapterIndex(nodes),
      non_scene_nodes: nonSceneNodes.map((node) => ({
        node_id: node.id,
        node_kind: node.data.nodeKind,
        label: node.data.label,
        description: compactText(node.data.description, 180),
      })),
    }),
    summary: "全局标签、章节和非场景节点摘要，用于避免生成内容与项目结构脱节。",
    tags: ["global-index"],
  });

  const remoteCommandSamples = sceneNodes
    .filter((node) => !focusIds.has(node.id) && !adjacentIds.has(node.id))
    .slice(0, Math.max(20, Math.floor(MAX_SCENES / 2)))
    .map((node) => ({
      node_id: node.id,
      scene_id: node.data.scene!.scene_id,
      command_samples: node.data.scene!.commands.slice(0, 4).map(summarizeCommand),
    }));
  if (remoteCommandSamples.length > 0) {
    items.push({
      id: "remote-command-samples",
      priority: "P3",
      title: "Low priority remote command samples",
      text: JSON.stringify(remoteCommandSamples),
      summary: "远端命令样本只用于参考写法；超预算时可安全丢弃。",
      tags: ["low-priority", "command-samples"],
    });
  }

  return items;
}

export function buildEditorGenerationContext(options: {
  currentNodeId: string;
  contextNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  memoryMode: MemoryMode;
  providerSelection?: ProviderSelectionPayload | null;
}): string {
  return buildEditorGenerationContextPackage(options).context;
}

export function buildEditorGenerationContextPackage(options: {
  currentNodeId: string;
  contextNodeId: string;
  nodes: EditorNode[];
  edges: EditorEdge[];
  memoryMode: MemoryMode;
  providerSelection?: ProviderSelectionPayload | null;
}): { context: string; report: ContextBudgetReport } {
  const items = buildEditorGenerationContextItems(options);
  const packed = packPrioritizedContext(items, options.providerSelection, {
    minimumKeepTokens: 1800,
    note: "编辑器蓝图上下文使用分级摘要：当前节点、scene_id、连线和场景索引优先保留。",
  });
  return { context: packed.text, report: packed.report };
}
