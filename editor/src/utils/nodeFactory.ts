import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import type { AnimationCommand, ChoiceCommand, StateUpdateCommand } from "../types/commands";
import type { MemoryMode } from "../types/memory";
import type { EditorNode, EditorNodeData, EditorNodeKind } from "../types/nodes";
import type { SceneBeat } from "../types/scene";
import { defaultConditionData } from "./conditions";

function createChoiceId(): string {
  return "choice_" + nanoid(6);
}

const defaultAiSettings = {
  authorGoal: "延续当前剧情，并保持角色动机一致。",
  generationOutline: "",
  autoExtractMemory: true,
  autoApplyMemory: false,
};

function baseData(nodeKind: EditorNodeKind, memoryMode: MemoryMode): Omit<EditorNodeData, "label" | "description"> {
  return {
    nodeKind,
    memoryMode,
    aiSettings: { ...defaultAiSettings },
    previewState: { currentCommandIndex: 0, isPlaying: false },
    editorMeta: { collapsedInspectorSections: [], source: "manual" },
  };
}

function withBase(
  nodeKind: EditorNodeKind,
  memoryMode: MemoryMode,
  data: Pick<EditorNodeData, "label" | "description"> & Partial<Omit<EditorNodeData, "nodeKind" | "memoryMode" | "aiSettings" | "previewState" | "editorMeta">>,
): EditorNodeData {
  return {
    ...baseData(nodeKind, memoryMode),
    ...data,
  } as EditorNodeData;
}

export function createSceneNode(position = { x: 240, y: 180 }, memoryMode: MemoryMode = "hybrid", scene?: SceneBeat): EditorNode {
  const sceneId = scene?.scene_id ?? `scene_${nanoid(8)}`;
  return {
    id: `node_${sceneId}`,
    type: "sceneNode",
    position,
    data: withBase("scene", memoryMode, {
      label: scene?.title ?? "新场景",
      description: scene?.summary ?? "在右侧检查器编辑场景标题、摘要、章节和剧情指令。",
      scene: scene ?? {
        scene_id: sceneId,
        title: "新场景",
        summary: "",
        commands: [],
        tags: [],
        chapter: 1,
      },
    }),
  };
}

export function createModifierNode(position = { x: 520, y: 220 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  const stateUpdate: StateUpdateCommand = { type: "state_update", key: "flag_name", operation: "set", value: true, value_type: "boolean" };
  return {
    id: `modifier_${nanoid(8)}`,
    type: "modifierNode",
    position,
    data: withBase("modifier", memoryMode, {
      label: "状态修改",
      description: "修改 Runtime 简单变量，不写入 AI 长期记忆。",
      stateUpdate,
    }),
  };
}

export function createChoiceNode(position = { x: 520, y: 300 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  const choice: ChoiceCommand = {
    type: "choice",
    choices: [
      { choice_id: createChoiceId(), choice_display_name: null, text: "", target_scene_id: "", conditions: [] },
      { choice_id: createChoiceId(), choice_display_name: null, text: "", target_scene_id: "", conditions: [] },
    ],
  };
  return {
    id: `choice_${nanoid(8)}`,
    type: "choiceNode",
    position,
    data: withBase("choice", memoryMode, {
      label: "选项分支",
      description: "把多个玩家选择作为画布上的独立分支节点管理。",
      choice,
    }),
  };
}

export function createConditionNode(position = { x: 520, y: 360 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  return {
    id: `condition_${nanoid(8)}`,
    type: "conditionNode",
    position,
    data: withBase("condition", memoryMode, {
      label: "条件分支",
      description: "根据 Runtime 变量决定后续线路。",
      condition: defaultConditionData(),
    }),
  };
}

export function createLoopNode(position = { x: 520, y: 430 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  return {
    id: `loop_${nanoid(8)}`,
    type: "loopNode",
    position,
    data: withBase("loop", memoryMode, {
      label: "重复一段剧情",
      description: "让战斗回合、搜寻、巡逻等一段剧情重复执行，并在完成后继续后面的剧情。",
      loop: {
        variableKey: "loop_count",
        initialValue: 0,
        step: 1,
        continueCondition: { key: "loop_count", operator: "less_or_equal", value: 3 },
        loopLabel: "再做一次（共 3 次）",
        exitLabel: "重复完成，继续剧情",
      },
    }),
  };
}

export function createAnimationNode(position = { x: 520, y: 500 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  const animation: AnimationCommand = {
    type: "animation",
    animation_id: "fade_flash",
    target: "screen",
    params: { duration: 600 },
    blocking: true,
  };
  return {
    id: `animation_${nanoid(8)}`,
    type: "animationNode",
    position,
    data: withBase("animation", memoryMode, {
      label: "动画",
      description: "导出为 Runtime 可执行的 AnimationCommand。",
      animation,
    }),
  };
}

export function createStartNode(position = { x: 40, y: 220 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  return {
    id: "start",
    type: "startNode",
    position,
    data: withBase("start", memoryMode, {
      loadingAnimation: { kind: "default" },
      label: "入口",
      description: "项目唯一入口节点。",
    }),
  };
}

export function createEndNode(position = { x: 860, y: 220 }, memoryMode: MemoryMode = "hybrid"): EditorNode {
  return {
    id: `end_${nanoid(8)}`,
    type: "endNode",
    position,
    data: withBase("end", memoryMode, {
      label: "结局",
      description: "剧情终止节点。",
      ending: { ending_id: `ending_${nanoid(6)}`, ending_title: "结局" },
    }),
  };
}

export function createNodeByKind(kind: EditorNodeKind, position: { x: number; y: number }, memoryMode: MemoryMode): EditorNode {
  const factories: Record<EditorNodeKind, () => EditorNode> = {
    scene: () => createSceneNode(position, memoryMode),
    choice: () => createChoiceNode(position, memoryMode),
    modifier: () => createModifierNode(position, memoryMode),
    condition: () => createConditionNode(position, memoryMode),
    loop: () => createLoopNode(position, memoryMode),
    animation: () => createAnimationNode(position, memoryMode),
    start: () => createStartNode(position, memoryMode),
    end: () => createEndNode(position, memoryMode),
  };
  return factories[kind]();
}

export function cloneNode(node: EditorNode): EditorNode {
  const cloned = structuredClone(node) as Node<EditorNodeData>;
  cloned.id = `${node.data.nodeKind}_${nanoid(8)}`;
  cloned.position = { x: (node.position?.x ?? 240) + 40, y: (node.position?.y ?? 180) + 40 };
  if (cloned.data.scene) {
    cloned.data.scene.scene_id = `scene_${nanoid(8)}`;
    cloned.data.scene.title = `${cloned.data.scene.title} 副本`;
    cloned.data.label = cloned.data.scene.title;
  }
  cloned.data.editorMeta = { ...cloned.data.editorMeta, source: "manual", generatedAt: undefined, generatedFromNodeId: undefined };
  return cloned;
}
