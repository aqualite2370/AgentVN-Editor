import type { EditorEdge, EditorNode, EditorProjectFile } from "../types/nodes";
import type { CharacterSpriteAnimationConfig } from "../../../shared/animation/characterAnimation";
import { validateCharacterAnimationConfig } from "../../../shared/animation/characterAnimation";
import { MAX_SPRITE_SCALE, MIN_SPRITE_SCALE } from "../../../shared/cartridge/spriteScale";
import { MAX_SPRITE_LAYER, MIN_SPRITE_LAYER, isValidSpriteLayer } from "../../../shared/cartridge/spriteLayer";
import { sceneReferenceLabel } from "./displayNames";

export interface ValidationIssue {
  code: string;
  message: string;
  severity?: "error" | "warning";
  nodeId?: string;
  edgeId?: string;
}

interface ValidationRuntimeChoice {
  choice_id: string;
  text?: string;
  choice_display_name?: string | null;
  target_scene_id?: string;
}

interface ValidationRuntimeCommand {
  type: string;
  character_id?: string;
  target?: string;
  target_scene_id?: string;
  else_target_scene_id?: string | null;
  animation_config?: CharacterSpriteAnimationConfig | null;
  scale?: number | null;
  layer?: number | null;
  choices?: ValidationRuntimeChoice[];
}

interface ValidationRuntimeScene {
  scene_id: string;
  scene_display_name?: string | null;
  title?: string;
  summary?: string;
  commands: ValidationRuntimeCommand[];
  next_scene_id?: string;
  is_ending?: boolean;
}

export interface ValidationRuntimeScript {
  schema_version?: string;
  entry_scene_id: string;
  characters?: Array<{ character_id: string; name?: string }>;
  scenes: ValidationRuntimeScene[];
}

function sceneLabel(scene: ValidationRuntimeScene): string {
  return scene.scene_display_name?.trim() || scene.title?.trim() || scene.scene_id;
}

function sceneLabelMap(script: ValidationRuntimeScript): Map<string, string> {
  return new Map(script.scenes.map((scene) => [scene.scene_id, sceneLabel(scene)]));
}

function isDefaultSourceHandle(sourceHandle?: string | null): boolean {
  return !sourceHandle || sourceHandle === "default";
}

function nodeReferenceLabel(node: EditorNode | undefined, fallback: string): string {
  if (!node) return fallback;
  return node.data.scene ? sceneReferenceLabel(node.data.scene) : node.data.label || fallback;
}

function choiceHandleIdsForNode(node: EditorNode | undefined): string[] {
  if (!node) return [];
  if (node.data.nodeKind === "choice") {
    return node.data.choice?.choices.map((choice) => choice.choice_id) ?? [];
  }
  return node.data.scene?.commands
    .filter((command) => command.type === "choice")
    .flatMap((command) => command.choices.map((choice) => choice.choice_id)) ?? [];
}

function duplicateSceneIdDetails(script: ValidationRuntimeScript): string {
  const groups = new Map<string, string[]>();
  for (const scene of script.scenes) {
    groups.set(scene.scene_id, [...(groups.get(scene.scene_id) ?? []), sceneLabel(scene)]);
  }
  return [...groups.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([id, labels]) => `${id}：${labels.join("、")}`)
    .join("；");
}

function collectRuntimeCharacterIds(script: ValidationRuntimeScript): Set<string> {
  const ids = new Set((script.characters ?? []).map((character) => character.character_id.trim()).filter(Boolean));
  for (const scene of script.scenes) {
    for (const command of scene.commands) {
      if ((command.type === "dialog" || command.type === "sprite") && command.character_id?.trim()) {
        ids.add(command.character_id.trim());
      }
    }
  }
  return ids;
}

function spriteTargetCharacterId(target?: string): string | undefined {
  const trimmed = target?.trim();
  if (!trimmed?.toLowerCase().startsWith("sprite:")) return undefined;
  const id = trimmed.slice("sprite:".length).trim();
  return id || "selected";
}

export function validateSingleStartNode(nodes: EditorNode[]): ValidationIssue[] {
  const starts = nodes.filter((node) => node.data.nodeKind === "start");
  if (starts.length === 1) return [];
  return [{
    code: "single_start_node",
    message: `入口节点数量错误（StartNode）：当前有 ${starts.length} 个入口节点。原因：项目需要一个唯一入口来决定玩家从哪里开始。影响：预览、导出和 GameCLI 播放可能无法确定起点。解决方案：请在画布中只保留一个入口节点。`,
  }];
}

export function validateNodeConnections(nodes: EditorNode[], edges: EditorEdge[]): ValidationIssue[] {
  const ids = new Set(nodes.map((node) => node.id));
  return edges
    .filter((edge) => !ids.has(edge.source) || !ids.has(edge.target))
    .map((edge) => ({
      code: "broken_edge",
      message: "剧情连线引用了不存在的节点（edge）：原因：连线的起点或终点节点已经被删除。影响：导出后剧情跳转会断开。解决方案：请删除这条失效连线，并重新从正确节点拖出连线。",
      edgeId: edge.id,
    }));
}

export function validateUnreachableNodes(nodes: EditorNode[], reachableIds: Set<string>): ValidationIssue[] {
  return nodes
    .filter((node) => node.data.nodeKind !== "start" && !reachableIds.has(node.id))
    .map((node) => ({
      code: "unreachable_node",
      message: `${nodeReferenceLabel(node, node.id)} 无法从入口到达（node）：原因：入口节点没有通过连线通向这个节点。影响：玩家正常流程不会播放到这里。解决方案：请从入口路径上的场景连线到该节点，或确认它只是临时草稿。`,
      nodeId: node.id,
    }));
}

export function validateBrokenChoiceHandles(nodes: EditorNode[], edges: EditorEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const edge of edges) {
    if (!edge.sourceHandle || edge.sourceHandle === "default" || edge.sourceHandle === "true" || edge.sourceHandle === "false") continue;
    const source = nodes.find((node) => node.id === edge.source);
    const choiceIds = choiceHandleIdsForNode(source);
    if ((source?.data.nodeKind === "scene" || source?.data.nodeKind === "choice") && !choiceIds.includes(edge.sourceHandle)) {
      issues.push({
        code: "broken_choice_handle",
        message: `${nodeReferenceLabel(source, edge.source)} 的选项连线引用了不存在的选项编号（choice_id）：原因：原选项可能已被删除或改名。影响：玩家点击该选项时无法跳转到目标场景。解决方案：请删除这条旧连线，并从当前存在的选项重新连接目标场景。`,
        edgeId: edge.id,
        nodeId: source.id,
      });
    }
  }
  return issues;
}

export function validateDefaultHandleFanOut(nodes: EditorNode[], edges: EditorEdge[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const defaultEdgesBySource = new Map<string, EditorEdge[]>();
  for (const edge of edges) {
    if (!isDefaultSourceHandle(edge.sourceHandle)) continue;
    defaultEdgesBySource.set(edge.source, [...(defaultEdgesBySource.get(edge.source) ?? []), edge]);
  }
  for (const [sourceId, defaultEdges] of defaultEdgesBySource) {
    if (defaultEdges.length <= 1) continue;
    const sourceLabel = nodeReferenceLabel(nodesById.get(sourceId), sourceId);
    const targetLabels = defaultEdges.map((edge) => nodeReferenceLabel(nodesById.get(edge.target), edge.target)).join("、");
    issues.push({
      code: "multiple_default_successors",
      message: `${sourceLabel} 的默认后续连接了多个节点（default handle）：当前连接到 ${targetLabels}。原因：默认后续只能表达一条非选项分支。影响：GameCLI 播放时无法让玩家选择，旧逻辑通常只会播放第一条线。解决方案：请保留一条默认后续；如果需要分支，请在场景里添加“选项分支”事件并从选项连接目标场景。`,
      severity: "warning",
      nodeId: sourceId,
      edgeId: defaultEdges[0].id,
    });
  }
  return issues;
}

export function validateProject(project: EditorProjectFile): ValidationIssue[] {
  return [
    ...validateSingleStartNode(project.nodes),
    ...validateNodeConnections(project.nodes, project.edges),
    ...validateBrokenChoiceHandles(project.nodes, project.edges),
    ...validateDefaultHandleFanOut(project.nodes, project.edges),
  ];
}

export function validateScript(script: ValidationRuntimeScript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sceneIds = new Set(script.scenes.map((scene) => scene.scene_id));
  const labels = sceneLabelMap(script);
  const characterIds = collectRuntimeCharacterIds(script);
  if (!script.schema_version) {
    issues.push({ code: "schema_version", message: "剧本结构版本缺失（schema_version）：原因：导出的 script.json 没有声明结构版本。影响：GameCLI 无法判断该剧本是否可被当前版本读取。解决方案：请重新从编辑器导出卡带；如果是手工修改文件，请补回 schema_version。" });
  }
  if (!script.entry_scene_id) {
    issues.push({ code: "entry_scene_id", message: "入口场景编号缺失（entry_scene_id）：原因：剧本没有指定玩家开始播放的场景。影响：GameCLI 无法开始游戏。解决方案：请确认画布中入口节点已连接到一个场景节点，然后重新预览或导出。" });
  }
  if (sceneIds.size !== script.scenes.length) {
    const details = duplicateSceneIdDetails(script);
    issues.push({
      code: "duplicate_scene_id",
      message: `场景稳定编号重复（scene_id）：${details || "存在多个场景使用同一个编号"}。原因：场景编号是剧情跳转用的唯一身份证，不能重复。影响：系统跳转时无法确定要播放哪一个场景。解决方案：请在右侧检查器中找到重复场景，修改其中一个场景的稳定编号，例如 scene_opening_2。`,
    });
  }
  if (!sceneIds.has(script.entry_scene_id)) {
    issues.push({
      code: "missing_entry_scene",
      message: `入口场景编号无效（entry_scene_id）：当前入口指向 ${script.entry_scene_id || "空值"}，但场景列表里找不到它。原因：入口连线目标可能已删除，或场景稳定编号被改过。影响：GameCLI 无法进入游戏。解决方案：请把入口节点重新连接到一个存在的场景，或把入口场景编号改成现有场景的 scene_id。`,
    });
  }
  for (const scene of script.scenes) {
    const currentSceneLabel = labels.get(scene.scene_id) ?? scene.scene_id;
    if (scene.next_scene_id && !sceneIds.has(scene.next_scene_id)) {
      issues.push({
        code: "missing_next_scene",
        message: `${currentSceneLabel} 的下一场景编号无效（next_scene_id）：当前指向 ${scene.next_scene_id}，但场景列表里找不到它。原因：默认后续连线目标可能已删除，或目标场景的 scene_id 被改过。影响：玩家播放到这里后无法继续。解决方案：请重新连接默认后续，或把下一场景编号改成现有场景的 scene_id。`,
      });
    }
    for (const command of scene.commands) {
      if (command.type === "sprite") {
        if (
          command.layer !== null
          && command.layer !== undefined
          && !isValidSpriteLayer(command.layer)
        ) {
          issues.push({
            code: "sprite_layer_range",
            message: `${currentSceneLabel} 的人物层级无效：必须是 ${MIN_SPRITE_LAYER} 到 ${MAX_SPRITE_LAYER} 之间的整数。`,
          });
        }
        if (command.scale !== null && command.scale !== undefined && (!Number.isFinite(command.scale) || command.scale < MIN_SPRITE_SCALE || command.scale > MAX_SPRITE_SCALE)) {
          issues.push({
            code: "sprite_scale_range",
            message: `${currentSceneLabel} 的角色立绘缩放超出范围：必须在 50% 到 200% 之间。`,
            severity: "warning",
          });
        }
        validateCharacterAnimationConfig(command.animation_config, `scene.${scene.scene_id}.sprite.${command.character_id || "unknown"}.animation_config`).forEach((animationIssue) => {
          issues.push({
            code: animationIssue.code,
            message: `${currentSceneLabel} 的角色立绘动画配置无效：${animationIssue.message}`,
          });
        });
      }
      if (command.type === "animation") {
        const targetId = spriteTargetCharacterId(command.target);
        if (targetId && targetId !== "selected" && targetId !== "all" && !characterIds.has(targetId)) {
          issues.push({
            code: "missing_animation_character_target",
            message: `${currentSceneLabel} 的角色动画目标无效（target）：${command.target} 找不到可追溯的角色。请先添加该角色的对白/立绘命令，或把目标改成 sprite:selected、sprite:all、已有角色 ID。`,
          });
        }
      }
      if (command.type === "jump") {
        if (!command.target_scene_id || !sceneIds.has(command.target_scene_id)) {
          issues.push({ code: "missing_jump_target", message: `${currentSceneLabel} 的跳转目标无效：${command.target_scene_id || "空值"}。请选择存在的场景。` });
        }
      }
      if (command.type === "conditional_jump") {
        if (!command.target_scene_id || !sceneIds.has(command.target_scene_id)) {
          issues.push({
            code: "missing_conditional_jump_target",
            message: `${currentSceneLabel} 的判断跳转目标无效（target_scene_id）：当前指向 ${command.target_scene_id || "空值"}。请把 true 分支连接到存在的场景，或在判断跳转事件里选择目标场景。`,
          });
        }
        if (command.else_target_scene_id && !sceneIds.has(command.else_target_scene_id)) {
          issues.push({
            code: "missing_conditional_jump_else_target",
            message: `${currentSceneLabel} 的判断跳转 else 目标无效（else_target_scene_id）：当前指向 ${command.else_target_scene_id}。请把 false 分支连接到存在的场景，或清空 else 目标让剧情继续下一条事件。`,
          });
        }
      }
      if (command.type !== "choice") continue;
      for (const choice of command.choices ?? []) {
        if (!choice.target_scene_id || !sceneIds.has(choice.target_scene_id)) {
          const choiceLabel = choice.choice_display_name?.trim() || choice.text || choice.choice_id;
          issues.push({
            code: "missing_choice_target",
            message: `${currentSceneLabel} 的选项“${choiceLabel}”目标场景编号无效（target_scene_id）：当前指向 ${choice.target_scene_id || "空值"}。原因：选项目标场景不存在，或目标场景的 scene_id 被改过。影响：玩家点击该选项后无法进入后续剧情。解决方案：请在选项编辑器中选择一个存在的目标场景编号，或重新从选项手柄连接目标场景。`,
          });
        }
      }
    }
    const hasChoice = scene.commands.some((command) => command.type === "choice");
    const hasConditionalJump = scene.commands.some((command) => command.type === "conditional_jump" && Boolean(command.target_scene_id));
    const hasJump = scene.commands.some((command) => command.type === "jump" && Boolean(command.target_scene_id));
    if (!scene.is_ending && !scene.next_scene_id && !hasChoice && !hasConditionalJump && !hasJump) {
      issues.push({
        code: "dead_end_scene",
        message: `${currentSceneLabel} 没有后续且不是结局（next_scene_id）：原因：这个场景既没有默认后续，也没有选项分支或结局标记。影响：玩家播放到这里会停住。解决方案：请连接一个后续场景、添加选项分支，或把该节点设置为结局。`,
        severity: "warning",
      });
    }
  }
  return issues;
}
