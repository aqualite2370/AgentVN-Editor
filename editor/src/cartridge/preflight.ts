import { collectAssetReferencesFromScript } from "../../../shared/cartridge/assetScanner";
import type { RuntimeScript } from "../../../shared/cartridge/types";
import type { AssetRef, PendingVisualAsset } from "../types/assets";
import type { ChoiceCommand, ConditionalJumpCommand, JumpCommand } from "../types/commands";
import type { EditorEdge, EditorNode } from "../types/nodes";
import { buildProjectAssetAudit } from "../utils/assetAudit";
import { collectEditorAssetReferences, type EditorAssetReference } from "../utils/editorAssetReferences";
import { scoreOpeningPerformance } from "../utils/openingPerformance";

export type PreflightCategory = "structure" | "assets" | "quality" | "metadata";
export type PreflightStatus = "pass" | "warning" | "blocked";
export type PreflightSeverity = "warning" | "blocker";

export interface PreflightIssue {
  code: string;
  category: PreflightCategory;
  severity: PreflightSeverity;
  message: string;
  solution: string;
  subject?: string;
}

export interface PreflightCheck {
  id: string;
  category: PreflightCategory;
  title: string;
  status: PreflightStatus;
  issues: PreflightIssue[];
}

export interface PreflightGroup {
  category: PreflightCategory;
  title: string;
  status: PreflightStatus;
  total: number;
  passed: number;
  warnings: number;
  blockers: number;
}

export interface PreflightReport {
  status: PreflightStatus;
  checks: PreflightCheck[];
  groups: PreflightGroup[];
  warnings: PreflightIssue[];
  blockers: PreflightIssue[];
  signature: string;
}

export interface ExportPreflightInput {
  script: RuntimeScript;
  nodes: EditorNode[];
  edges: EditorEdge[];
  assets: AssetRef[];
  metadata: {
    gameId: string;
    title: string;
    author: string;
    description: string;
  };
}

const categoryTitles: Record<PreflightCategory, string> = {
  structure: "项目结构",
  assets: "素材完整度",
  quality: "体验质量",
  metadata: "卡带元数据",
};

const nonStoryTags = new Set(["choice", "condition", "modifier", "animation", "ending"]);
const defaultGameIds = new Set(["agentvn_game", "project_local", "verify_game", "agentvn_sample", "sample_game", "untitled"]);

const issueSolutions: Record<string, string> = {
  entry_scene_missing: "在流程图中把入口节点连接到一个存在的场景，或在项目入口设置中改为现有 scene_id。",
  scene_id_missing: "打开对应场景卡片，为场景填写稳定且唯一的 scene_id 后重新检查。",
  scene_id_duplicate: "保留其中一个 scene_id，给其余重复场景改成不同的稳定编号。",
  choice_target_missing: "从该选项的连线手柄连接到目标场景，或在选项编辑器里选择一个目标场景。",
  choice_target_invalid: "重新连接到仍存在且会导出的场景，避免指向已删除或未导出的 scene_id。",
  conditional_jump_target_missing: "为判断跳转补上 true 分支目标，或在事件编辑器中选择目标场景。",
  conditional_jump_target_invalid: "把 true 分支目标改为当前项目中存在并会导出的场景。",
  conditional_jump_else_target_invalid: "把 false 分支目标改为存在的场景；如果不需要 false 分支，请清空 else 目标。",
  jump_target_missing: "为无条件跳转补上目标场景，或从该事件所在节点连出默认目标线。",
  jump_target_invalid: "把无条件跳转目标改为当前项目中存在并会导出的场景。",
  loop_continue_target_missing: "从重复剧情节点左下方的“再做一次”圆点连线，指向需要重复的第一个场景。",
  loop_exit_target_missing: "从重复剧情节点右下方的“重复完成”圆点连线，指向重复结束后的第一个场景。",
  loop_continue_target_invalid: "“再做一次”路线指向的场景已不存在，请重新连接到需要重复的第一个场景。",
  loop_exit_target_invalid: "“重复完成”路线指向的场景已不存在，请重新连接到重复结束后的场景。",
  condition_target_missing: "补齐条件节点的有效分支连线，确保玩家可以进入后续场景。",
  exported_choice_target_invalid: "回到编辑器重新连接该选项目标，确认导出脚本中的 target_scene_id 存在。",
  choice_all_options_conditional: "至少保留一个无条件默认选项，或明确设计全部隐藏时的后续事件路线。",
  exported_conditional_jump_target_invalid: "重新连接判断跳转 true 分支，或在事件里选择一个有效目标场景。",
  exported_conditional_jump_else_target_invalid: "重新连接判断跳转 false 分支；不需要 false 分支时清空 else 目标。",
  exported_jump_target_invalid: "重新连接无条件跳转，或在事件里选择一个有效目标场景。",
  asset_reference_missing: "在素材库导入对应 asset_id 的素材，或回到定位到的场景/节点/命令字段替换为已有素材。",
  asset_reference_placeholder: "用最终素材替换该 placeholder，或在素材库中重新生成并确认不是占位资源。",
  loading_animation_video_missing: "为载入动画选择一个已导入的视频素材，或把载入动画模式改回默认模式。",
  loading_animation_images_missing: "为载入动画导入并选择至少一张图片帧，或把载入动画模式改回默认模式。",
  scene_background_missing_final: "为该场景补充最终背景素材，或把 background_id 改为素材库中已有的背景。",
  character_sprite_missing: "为该角色导入立绘素材，并在立绘命令中选择正确的 sprite_id。",
  character_portrait_missing: "为该角色导入头像素材，并在对白命令中选择正确的 portrait。",
  optional_audio_performance_missing: "按演出需要补充对应音频；如果该音频确实不需要，可保留为警告但发布前应人工确认。",
  character_reference_missing: "在对白或立绘命令中选择具体角色，确保 character_id 不为空。",
  character_reference_invalid: "在角色列表中补齐该角色，或把事件里的 character_id 改为现有角色。",
  scene_background_missing: "在场景开头添加背景事件，避免玩家端沿用旧背景或显示默认背景。",
  dialog_portrait_missing: "为该对白选择头像 portrait，或确认当前角色设计为无头像对白。",
  branch_target_unreachable: "检查入口到该分支的连线和跳转条件，确保玩家正常流程可以到达目标场景。",
  scene_unreachable: "把该场景接入入口可达路径；如果是废弃草稿，请删除或标记为不导出。",
  scene_empty: "补充叙事、对白或跳转内容；如果是占位卡片，请先完成剧情再发布。",
  scene_too_short: "补充足够的叙事或对白内容，确认不是临时占位文本。",
  opening_performance_not_polished: "在开场先铺背景、音效、镜头、等待和环境描写，再逐步引入角色立绘。",
  game_id_required: "在发布设置中填写稳定的英文 game_id，例如作品拼音或英文名。",
  game_id_invalid: "把 game_id 改为 3 到 64 位，以小写字母开头，只包含小写字母、数字、下划线、点或短横线。",
  game_id_default: "把默认 game_id 改成当前作品专属编号，避免覆盖或混淆其他发布包。",
  title_required: "填写玩家会看到的作品标题。",
  author_required: "填写作者名、团队名或发行署名。",
  description_required: "填写卡带简介，说明作品内容和版本用途。",
};

export function normalizeGameId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function issue(category: PreflightCategory, severity: PreflightSeverity, code: string, message: string, subject?: string): PreflightIssue {
  const solution = issueSolutions[code];
  if (!solution) throw new Error("预检问题缺少中文解决方案：" + code);
  return { category, severity, code, message, solution, subject };
}

function check(id: string, category: PreflightCategory, title: string, issues: PreflightIssue[]): PreflightCheck {
  const status = issues.some((item) => item.severity === "blocker")
    ? "blocked"
    : issues.length > 0
      ? "warning"
      : "pass";
  return { id, category, title, status, issues };
}

function scriptSceneLabel(scene: RuntimeScript["scenes"][number]): string {
  const maybeDisplayName = "scene_display_name" in scene && typeof scene.scene_display_name === "string"
    ? scene.scene_display_name
    : "";
  return maybeDisplayName.trim() || scene.title?.trim() || scene.scene_id || "未命名场景";
}

function nodeLabel(node: EditorNode | undefined, fallback: string): string {
  if (!node) return fallback;
  return node.data.scene?.scene_display_name?.trim() || node.data.scene?.title?.trim() || node.data.label || fallback;
}

function syntheticSceneId(node: EditorNode): string {
  return `${node.data.nodeKind}_${node.id}`;
}

function sceneIdForNode(node: EditorNode): string | null {
  if (node.data.nodeKind === "start") return null;
  return node.data.scene?.scene_id ?? syntheticSceneId(node);
}

function choiceCommandsForNode(node: EditorNode): ChoiceCommand[] {
  const commands: ChoiceCommand[] = [];
  if (node.data.choice) commands.push(node.data.choice);
  if (node.data.scene) {
    commands.push(...node.data.scene.commands.filter((command): command is ChoiceCommand => command.type === "choice"));
  }
  return commands;
}

function conditionalJumpCommandsForNode(node: EditorNode): ConditionalJumpCommand[] {
  const commands: ConditionalJumpCommand[] = [];
  if (node.data.nodeKind === "condition" && node.data.condition) {
    commands.push({ type: "conditional_jump", condition: "", target_scene_id: "", else_target_scene_id: null });
  }
  if (node.data.nodeKind === "loop" && node.data.loop) {
    commands.push({ type: "conditional_jump", condition: node.data.loop.continueCondition, target_scene_id: "", else_target_scene_id: "" });
  }
  if (node.data.scene) {
    commands.push(...node.data.scene.commands.filter((command): command is ConditionalJumpCommand => command.type === "conditional_jump"));
  }
  return commands;
}

function jumpCommandsForNode(node: EditorNode): JumpCommand[] {
  if (!node.data.scene) return [];
  return node.data.scene.commands.filter((command): command is JumpCommand => command.type === "jump");
}

function exportedNodeIdsForScript(script: RuntimeScript, nodes: EditorNode[]): Set<string> {
  const exportedSceneIds = new Set(script.scenes.map((scene) => scene.scene_id));
  return new Set(
    nodes
      .filter((node) => {
        const sceneId = sceneIdForNode(node);
        return Boolean(sceneId && exportedSceneIds.has(sceneId));
      })
      .map((node) => node.id),
  );
}

function edgeTargetSceneId(edge: EditorEdge | undefined, nodesById: Map<string, EditorNode>): string {
  if (!edge) return "";
  const targetNode = nodesById.get(edge.target);
  return targetNode ? sceneIdForNode(targetNode) ?? "" : "";
}

function isStoryScene(scene: RuntimeScript["scenes"][number]): boolean {
  if (scene.is_ending) return false;
  return !(scene.tags ?? []).some((tag) => nonStoryTags.has(tag));
}

function textLengthOfScene(scene: RuntimeScript["scenes"][number]): number {
  return scene.commands.reduce((total, command) => {
    if (command.type === "dialog" || command.type === "narration") return total + command.text.trim().length;
    if (command.type === "choice") return total + command.choices.reduce((sum, choice) => sum + choice.text.trim().length, 0);
    return total;
  }, 0);
}

function reachableSceneIds(script: RuntimeScript): Set<string> {
  const scenesById = new Map(script.scenes.map((scene) => [scene.scene_id, scene]));
  const reachable = new Set<string>();
  const queue = [script.entry_scene_id];
  while (queue.length > 0) {
    const sceneId = queue.shift();
    if (!sceneId || reachable.has(sceneId)) continue;
    const scene = scenesById.get(sceneId);
    if (!scene) continue;
    reachable.add(sceneId);

    if (scene.next_scene_id) queue.push(scene.next_scene_id);
    for (const command of scene.commands) {
      if (command.type === "choice") {
        for (const choice of command.choices) queue.push(choice.target_scene_id);
      }
      if (command.type === "conditional_jump") {
        queue.push(command.target_scene_id);
        if (command.else_target_scene_id) queue.push(command.else_target_scene_id);
      }
      if (command.type === "jump") {
        queue.push(command.target_scene_id);
      }
    }
  }
  return reachable;
}

function validateEntryScene(script: RuntimeScript): PreflightIssue[] {
  const sceneIds = new Set(script.scenes.map((scene) => scene.scene_id));
  if (script.entry_scene_id && sceneIds.has(script.entry_scene_id)) return [];
  return [
    issue(
      "structure",
      "blocker",
      "entry_scene_missing",
      `入口场景不存在：当前 entry_scene_id 为 ${script.entry_scene_id || "空值"}，导出后玩家端无法开始播放。请把入口节点连接到一个存在的场景。`,
      script.entry_scene_id || undefined,
    ),
  ];
}

function validateSceneIds(nodes: EditorNode[]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const sceneNodes = nodes.filter((node) => node.data.nodeKind === "scene");
  const groups = new Map<string, string[]>();
  for (const node of sceneNodes) {
    const sceneId = node.data.scene?.scene_id?.trim() ?? "";
    const label = nodeLabel(node, node.id);
    if (!sceneId) {
      issues.push(issue("structure", "blocker", "scene_id_missing", `${label} 缺少 scene_id。请为场景填写稳定编号。`, node.id));
      continue;
    }
    groups.set(sceneId, [...(groups.get(sceneId) ?? []), label]);
  }
  for (const [sceneId, labels] of groups) {
    if (labels.length <= 1) continue;
    issues.push(
      issue(
        "structure",
        "blocker",
        "scene_id_duplicate",
        `scene_id 重复：${sceneId} 被 ${labels.join("、")} 共用。跳转系统无法判断要播放哪一个场景。请修改其中一个场景的稳定编号。`,
        sceneId,
      ),
    );
  }
  return issues;
}

function validateChoiceTargets(script: RuntimeScript, nodes: EditorNode[], edges: EditorEdge[]): PreflightIssue[] {
  const sceneIds = new Set(script.scenes.map((scene) => scene.scene_id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const exportedNodeIds = exportedNodeIdsForScript(script, nodes);
  const issues: PreflightIssue[] = [];

  for (const node of nodes) {
    if (!exportedNodeIds.has(node.id)) continue;
    for (const command of choiceCommandsForNode(node)) {
      for (const choice of command.choices) {
        const edge = edges.find((item) => item.source === node.id && item.sourceHandle === choice.choice_id);
        const edgeSceneId = edgeTargetSceneId(edge, nodesById);
        const explicitSceneId = choice.target_scene_id?.trim() ?? "";
        const targetSceneId = edgeSceneId || explicitSceneId;
        const label = nodeLabel(node, node.id);
        const choiceLabel = choice.choice_display_name?.trim() || choice.text?.trim() || choice.choice_id;

        if (!targetSceneId) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "choice_target_missing",
              `${label} 的选项“${choiceLabel}”缺少 target_scene_id。请从这个选项手柄连接一个目标场景，或在选项编辑器里选择目标。`,
              node.id,
            ),
          );
          continue;
        }

        if (!sceneIds.has(targetSceneId)) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "choice_target_invalid",
              `${label} 的选项“${choiceLabel}”指向 ${targetSceneId}，但导出场景列表中不存在这个 scene_id。请重新连接到存在的场景。`,
              targetSceneId,
            ),
          );
        }
      }
    }
  }

  for (const node of nodes) {
    if (!exportedNodeIds.has(node.id)) continue;

    for (const command of jumpCommandsForNode(node)) {
      const jumpEdge = edges.find((item) => item.source === node.id && (!item.sourceHandle || item.sourceHandle === "default"));
      const edgeSceneId = edgeTargetSceneId(jumpEdge, nodesById);
      const targetSceneId = edgeSceneId || command.target_scene_id?.trim() || "";
      const label = nodeLabel(node, node.id);

      if (!targetSceneId) {
        issues.push(issue("structure", "blocker", "jump_target_missing", `${label} 的无条件跳转缺少目标。请连接默认出口，或在跳转事件里选择目标场景。`, node.id));
      } else if (!sceneIds.has(targetSceneId)) {
        issues.push(issue("structure", "blocker", "jump_target_invalid", `${label} 的无条件跳转目标 ${targetSceneId} 不存在。请改为一个已导出的场景。`, targetSceneId));
      }
    }

    for (const command of conditionalJumpCommandsForNode(node)) {
      const isLoopNode = node.data.nodeKind === "loop";
      const trueHandle = isLoopNode ? "loop" : "true";
      const falseHandle = isLoopNode ? "exit" : "false";
      const trueEdge = edges.find((item) => item.source === node.id && item.sourceHandle === trueHandle);
      const falseEdge = edges.find((item) => item.source === node.id && item.sourceHandle === falseHandle);
      const trueEdgeSceneId = edgeTargetSceneId(trueEdge, nodesById);
      const falseEdgeSceneId = edgeTargetSceneId(falseEdge, nodesById);
      const targetSceneId = trueEdgeSceneId || command.target_scene_id?.trim() || "";
      const elseTargetSceneId = falseEdgeSceneId || command.else_target_scene_id?.trim() || "";
      const label = nodeLabel(node, node.id);

      if (!targetSceneId) {
        issues.push(issue("structure", "blocker", isLoopNode ? "loop_continue_target_missing" : "conditional_jump_target_missing", isLoopNode ? `「${label}」还没有连接“再做一次”路线。请从节点左下方圆点连到需要重复的第一个场景。` : `${label} 的判断跳转缺少 true 目标。请连接 true 分支，或在事件里选择目标场景。`, node.id));
      } else if (!sceneIds.has(targetSceneId)) {
        issues.push(issue("structure", "blocker", isLoopNode ? "loop_continue_target_invalid" : "conditional_jump_target_invalid", isLoopNode ? `「${label}」的“再做一次”路线指向了不存在的场景 ${targetSceneId}。请重新连接。` : `${label} 的判断跳转 true 目标 ${targetSceneId} 不存在。请改为一个已导出的场景。`, targetSceneId));
      }

      if (isLoopNode && !elseTargetSceneId) {
        issues.push(issue("structure", "blocker", "loop_exit_target_missing", `「${label}」还没有连接“重复完成”路线。请从节点右下方圆点连到重复结束后的第一个场景。`, node.id));
      } else if (elseTargetSceneId && !sceneIds.has(elseTargetSceneId)) {
        issues.push(issue("structure", "blocker", isLoopNode ? "loop_exit_target_invalid" : "conditional_jump_else_target_invalid", isLoopNode ? `「${label}」的“重复完成”路线指向了不存在的场景 ${elseTargetSceneId}。请重新连接。` : `${label} 的判断跳转 false 目标 ${elseTargetSceneId} 不存在。请改为一个已导出的场景，或清空 else 目标。`, elseTargetSceneId));
      }
    }

    if (node.data.nodeKind === "condition" && !conditionalJumpCommandsForNode(node).length) {
      /*
      for (const handle of ["true"]) {
        const edge = edges.find((item) => item.source === node.id && item.sourceHandle === handle);
        const targetSceneId = edgeTargetSceneId(edge, nodesById);
        if (!targetSceneId || !sceneIds.has(targetSceneId)) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "condition_target_missing",
              `${nodeLabel(node, node.id)} 的 ${handle === "true" ? "真" : "假"} 分支没有连接到有效场景。请补齐条件分支目标。`,
              node.id,
            ),
          );
        }
      }
      */
    }
  }

  for (const scene of script.scenes) {
    for (const command of scene.commands) {
      if (command.type === "choice") {
        for (const choice of command.choices) {
          if (!choice.target_scene_id || !sceneIds.has(choice.target_scene_id)) {
            issues.push(
              issue(
                "structure",
                "blocker",
                "exported_choice_target_invalid",
                `${scriptSceneLabel(scene)} 导出的选项“${choice.text || choice.choice_id}”目标无效：${choice.target_scene_id || "空值"}。请重新连接选项目标。`,
                scene.scene_id,
              ),
            );
          }
        }
        if (command.choices.length > 0 && command.choices.every((choice) => (choice.conditions ?? []).length > 0)) {
          issues.push(
            issue(
              "structure",
              "warning",
              "choice_all_options_conditional",
              `${scriptSceneLabel(scene)} 的选项全部带显示条件。运行时如果全部隐藏会自动继续下一条事件，建议补一个无条件默认选项或明确后续路线。`,
              scene.scene_id,
            ),
          );
        }
      } else if (command.type === "jump") {
        if (!command.target_scene_id || !sceneIds.has(command.target_scene_id)) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "exported_jump_target_invalid",
              `${scriptSceneLabel(scene)} 的无条件跳转目标无效：${command.target_scene_id || "空值"}。请重新连接或选择目标场景。`,
              scene.scene_id,
            ),
          );
        }
      } else if (command.type === "conditional_jump") {
        if (!command.target_scene_id || !sceneIds.has(command.target_scene_id)) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "exported_conditional_jump_target_invalid",
              `${scriptSceneLabel(scene)} 的判断跳转 true 目标无效：${command.target_scene_id || "空值"}。请重新连接或选择目标场景。`,
              scene.scene_id,
            ),
          );
        }
        if (command.else_target_scene_id && !sceneIds.has(command.else_target_scene_id)) {
          issues.push(
            issue(
              "structure",
              "blocker",
              "exported_conditional_jump_else_target_invalid",
              `${scriptSceneLabel(scene)} 的判断跳转 false 目标无效：${command.else_target_scene_id}。请重新连接、选择目标场景或清空 else。`,
              scene.scene_id,
            ),
          );
        }
      }
    }
  }

  return issues;
}

function validateAssetReferences(script: RuntimeScript, assets: AssetRef[], nodes?: EditorNode[]): PreflightIssue[] {
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  const references = nodes?.length ? collectEditorAssetReferences(nodes) : collectAssetReferencesFromScript(script);
  const issues: PreflightIssue[] = [];
  for (const ref of references) {
    const assetId = ref.asset_id.trim();
    const asset = assetsById.get(assetId);
    if (!assetId || !asset) {
      issues.push(issue(
        "assets",
        "warning",
        "asset_reference_missing",
        `素材引用缺失：${ref.asset_id || "空值"}（${ref.asset_type}）被 ${ref.source} 引用，但素材库中没有对应 asset_id。导出会写入 placeholder，占位发布前建议替换为最终素材。`,
        assetId || ref.asset_id,
      ));
    } else if (asset.metadata.placeholder) {
      issues.push(issue(
        "assets",
        "warning",
        "asset_reference_placeholder",
        `素材待补：${ref.asset_id}（${ref.asset_type}）仍是 placeholder。导出允许继续，但建议发布前替换为最终素材。`,
        ref.asset_id,
      ));
    }
  }
  const loadingAnimation = script.loading_animation;
  if (loadingAnimation?.kind === "video" && !loadingAnimation.video_asset_id.trim()) {
    issues.push(issue("assets", "blocker", "loading_animation_video_missing", "载入动画选择了视频模式，但还没有选择 video 资源。", "loading_animation"));
  }
  if (loadingAnimation?.kind === "image_sequence") {
    const imageCount = loadingAnimation.image_asset_ids.filter((assetId) => assetId.trim()).length;
    if (imageCount === 0) {
      issues.push(issue("assets", "blocker", "loading_animation_images_missing", "载入动画选择了多图模式，但还没有导入图片帧。", "loading_animation"));
    }
  }
  return issues;
}

function pendingVisualAssetLocation(item: PendingVisualAsset): string {
  if (item.location?.trim()) return item.location.trim();
  return [
    item.scene_title ? "场景「" + item.scene_title + "」" : item.scene_id,
    item.node_label ? "节点/卡片「" + item.node_label + "」" : item.node_id ? "节点/卡片「" + item.node_id + "」" : undefined,
    item.command_index !== undefined && item.command_index >= 0 && item.command_type
      ? "第 " + (item.command_index + 1) + " 条 " + item.command_type + (item.field ? "." + item.field : "")
      : item.field,
  ].filter(Boolean).join(" / ");
}

function pendingVisualAssetSubject(item: PendingVisualAsset): string {
  return [
    item.node_id ?? item.scene_id,
    item.command_index !== undefined ? String(item.command_index + 1) : undefined,
    item.field,
    item.asset_id,
  ].filter(Boolean).join(":");
}

function validateVisualAssetReadiness(nodes: EditorNode[], assets: AssetRef[]): PreflightIssue[] {
  const audit = buildProjectAssetAudit(nodes, assets, { includeOptional: false });
  return [
    ...audit.missing_background_scenes.flatMap((scene) => scene.missing_background.map((item) => issue(
      "assets",
      "warning",
      "scene_background_missing_final",
      pendingVisualAssetLocation(item) + " 缺最终背景或仍在使用 placeholder；asset_id=" + (item.asset_id ?? "未指定") + "。请补充背景素材，或按定位修改 " + (item.field ?? "background_id") + "。",
      pendingVisualAssetSubject(item),
    ))),
    ...audit.missing_sprite_characters.map((item) => issue(
      "assets",
      "warning",
      "character_sprite_missing",
      pendingVisualAssetLocation(item) + " 缺立绘；character_id=" + (item.character_id ?? "未知角色") + "，asset_id=" + (item.asset_id ?? "未指定") + "。请导入立绘素材，或按定位修改 " + (item.field ?? "sprite_id") + "。",
      pendingVisualAssetSubject(item),
    )),
    ...audit.missing_portrait_characters.map((item) => issue(
      "assets",
      "warning",
      "character_portrait_missing",
      pendingVisualAssetLocation(item) + " 缺头像；character_id=" + (item.character_id ?? "未知角色") + "，asset_id=" + (item.asset_id ?? "未指定") + "。请导入头像素材，或按定位修改 " + (item.field ?? "portrait") + "。",
      pendingVisualAssetSubject(item),
    )),
  ];
}

function validateOptionalAudioPerformance(nodes: EditorNode[], assets: AssetRef[]): PreflightIssue[] {
  const audit = buildProjectAssetAudit(nodes, assets, { includeOptional: true });
  return audit.optional_audio_performance.map((item) => issue(
    "assets",
    "warning",
    "optional_audio_performance_missing",
    pendingVisualAssetLocation(item) + " 可选项未配置：" + item.label + "。" + item.reason,
    pendingVisualAssetSubject(item),
  ));
}

function validateCharacterReferences(script: RuntimeScript): PreflightIssue[] {
  const characterIds = new Set((script.characters ?? []).map((character) => character.character_id).filter(Boolean));
  const issues: PreflightIssue[] = [];
  for (const scene of script.scenes) {
    for (const command of scene.commands) {
      if (command.type !== "dialog" && command.type !== "sprite") continue;
      const characterId = command.character_id?.trim() ?? "";
      if (!characterId) {
        issues.push(issue("structure", "blocker", "character_reference_missing", `${scriptSceneLabel(scene)} 有角色事件缺少 character_id。请为对白或立绘事件选择角色。`, scene.scene_id));
      } else if (!characterIds.has(characterId)) {
        issues.push(issue("structure", "blocker", "character_reference_invalid", `${scriptSceneLabel(scene)} 引用了角色 ${characterId}，但角色清单中不存在。请补齐角色或修正引用。`, characterId));
      }
    }
  }
  return issues;
}

function validateSceneBackgrounds(script: RuntimeScript): PreflightIssue[] {
  return script.scenes
    .filter((scene) => isStoryScene(scene) && !scene.commands.some((command) => command.type === "background"))
    .map((scene) => issue("quality", "warning", "scene_background_missing", `${scriptSceneLabel(scene)} 没有背景事件。玩家端会沿用旧背景或显示默认背景。`, scene.scene_id));
}

function validateDialogPortraits(script: RuntimeScript): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const scene of script.scenes) {
    for (const command of scene.commands) {
      if (command.type !== "dialog") continue;
      if (!command.text.trim()) continue;
      if (!command.portrait?.trim()) {
        issues.push(issue("quality", "warning", "dialog_portrait_missing", `${scriptSceneLabel(scene)} 中 ${command.character_id || "未知角色"} 的对白缺少头像 portrait。`, scene.scene_id));
      }
    }
  }
  return issues;
}

function validateBranchReachability(script: RuntimeScript): PreflightIssue[] {
  const sceneIds = new Set(script.scenes.map((scene) => scene.scene_id));
  const reachable = reachableSceneIds(script);
  const issues: PreflightIssue[] = [];

  for (const scene of script.scenes) {
    for (const command of scene.commands) {
      if (command.type === "choice") {
        for (const choice of command.choices) {
          if (choice.target_scene_id && sceneIds.has(choice.target_scene_id) && !reachable.has(choice.target_scene_id)) {
            issues.push(
              issue(
                "quality",
                "warning",
                "branch_target_unreachable",
                `${scriptSceneLabel(scene)} 的分支目标 ${choice.target_scene_id} 不在入口可达路径上。玩家正常流程可能无法看到该分支结果。`,
                choice.target_scene_id,
              ),
            );
          }
        }
      } else if (command.type === "conditional_jump") {
        for (const targetSceneId of [command.target_scene_id, command.else_target_scene_id].filter(Boolean) as string[]) {
          if (sceneIds.has(targetSceneId) && !reachable.has(targetSceneId)) {
            issues.push(
              issue(
                "quality",
                "warning",
                "branch_target_unreachable",
                `${scriptSceneLabel(scene)} 的判断跳转目标 ${targetSceneId} 不在入口可达路径中。请确认它不是临时草稿。`,
                targetSceneId,
              ),
            );
          }
        }
      } else if (command.type === "jump") {
        const targetSceneId = command.target_scene_id;
        if (targetSceneId && sceneIds.has(targetSceneId) && !reachable.has(targetSceneId)) {
          issues.push(
            issue(
              "quality",
              "warning",
              "branch_target_unreachable",
              `${scriptSceneLabel(scene)} 的无条件跳转目标 ${targetSceneId} 不在入口可达路径中。请确认它不是临时草稿。`,
              targetSceneId,
            ),
          );
        }
      }
    }
  }

  for (const scene of script.scenes) {
    if (!reachable.has(scene.scene_id)) {
      issues.push(issue("quality", "warning", "scene_unreachable", `${scriptSceneLabel(scene)} 无法从入口路径到达。请确认它不是临时草稿。`, scene.scene_id));
    }
  }

  return issues;
}

function validateSceneLength(script: RuntimeScript): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  for (const scene of script.scenes) {
    if (!isStoryScene(scene)) continue;
    const textLength = textLengthOfScene(scene);
    const hasBranch = scene.commands.some((command) => command.type === "choice");
    if (scene.commands.length === 0) {
      issues.push(issue("quality", "warning", "scene_empty", `${scriptSceneLabel(scene)} 是空场景。玩家到达后不会看到剧情内容。`, scene.scene_id));
    } else if (!hasBranch && textLength > 0 && textLength < 12) {
      issues.push(issue("quality", "warning", "scene_too_short", `${scriptSceneLabel(scene)} 文本过短，可能像占位内容。建议补充叙事或对白。`, scene.scene_id));
    } else if (!hasBranch && textLength === 0) {
      issues.push(issue("quality", "warning", "scene_too_short", `${scriptSceneLabel(scene)} 没有可读文本，可能只包含素材或状态事件。请确认这符合设计。`, scene.scene_id));
    }
  }
  return issues;
}

function validateOpeningPerformance(script: RuntimeScript): PreflightIssue[] {
  const result = scoreOpeningPerformance(script);
  if (result.score >= 80) return [];
  return [
    issue(
      "quality",
      "warning",
      "opening_performance_not_polished",
      `开局演出评分 ${result.score}/100，未达到精美阈值。${result.issues.join(" ")}`,
      result.details.entrySceneId || script.entry_scene_id,
    ),
  ];
}

function validateMetadata(input: ExportPreflightInput["metadata"]): PreflightIssue[] {
  const issues: PreflightIssue[] = [];
  const rawGameId = input.gameId.trim();
  const normalized = normalizeGameId(input.gameId);
  if (!rawGameId) {
    issues.push(issue("metadata", "blocker", "game_id_required", "game_id 不能为空。请填写一个稳定的英文发布编号。", "game_id"));
  } else if (rawGameId !== normalized || !/^[a-z][a-z0-9_.-]{2,63}$/.test(rawGameId)) {
    issues.push(issue("metadata", "blocker", "game_id_invalid", "game_id 不合法。请使用 3-64 位小写字母开头的英文、数字、下划线、点或短横线。", rawGameId));
  } else if (defaultGameIds.has(rawGameId)) {
    issues.push(issue("metadata", "blocker", "game_id_default", `game_id 仍是默认值 ${rawGameId}。请改成这个作品专属的发布编号。`, rawGameId));
  }

  if (!input.title.trim()) issues.push(issue("metadata", "blocker", "title_required", "标题不能为空。请填写玩家看到的作品标题。", "title"));
  if (!input.author.trim()) issues.push(issue("metadata", "blocker", "author_required", "作者不能为空。请填写作者或团队名称。", "author"));
  if (!input.description.trim()) issues.push(issue("metadata", "blocker", "description_required", "简介不能为空。请填写卡带描述。", "description"));
  return issues;
}

function buildGroups(checks: PreflightCheck[]): PreflightGroup[] {
  return (Object.keys(categoryTitles) as PreflightCategory[]).map((category) => {
    const scoped = checks.filter((item) => item.category === category);
    const blockers = scoped.filter((item) => item.status === "blocked").length;
    const warnings = scoped.filter((item) => item.status === "warning").length;
    return {
      category,
      title: categoryTitles[category],
      total: scoped.length,
      passed: scoped.filter((item) => item.status === "pass").length,
      warnings,
      blockers,
      status: blockers > 0 ? "blocked" : warnings > 0 ? "warning" : "pass",
    };
  });
}

export function runExportPreflight(input: ExportPreflightInput): PreflightReport {
  const checks = [
    check("entry_scene", "structure", "入口场景存在", validateEntryScene(input.script)),
    check("scene_id_unique", "structure", "scene_id 唯一", validateSceneIds(input.nodes)),
    check("choice_targets", "structure", "选项目标有效", validateChoiceTargets(input.script, input.nodes, input.edges)),
    check("asset_references", "assets", "素材引用可追踪", validateAssetReferences(input.script, input.assets, input.nodes)),
    check("visual_assets", "assets", "视觉资产待补", validateVisualAssetReadiness(input.nodes, input.assets)),
    check("audio_performance_options", "assets", "音频/演出可选项", validateOptionalAudioPerformance(input.nodes, input.assets)),
    check("character_references", "structure", "角色引用存在", validateCharacterReferences(input.script)),
    check("scene_backgrounds", "quality", "场景背景", validateSceneBackgrounds(input.script)),
    check("dialog_portraits", "quality", "对白头像", validateDialogPortraits(input.script)),
    check("branch_reachability", "quality", "分支可达性", validateBranchReachability(input.script)),
    check("scene_length", "quality", "场景内容长度", validateSceneLength(input.script)),
    check("opening_performance", "quality", "开局演出精美度", validateOpeningPerformance(input.script)),
    check("metadata", "metadata", "发布元数据", validateMetadata(input.metadata)),
  ];
  const allIssues = checks.flatMap((item) => item.issues);
  const blockers = allIssues.filter((item) => item.severity === "blocker");
  const warnings = allIssues.filter((item) => item.severity === "warning");
  const status: PreflightStatus = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "pass";
  const signature = allIssues.map((item) => `${item.severity}:${item.code}:${item.subject ?? ""}:${item.message}`).join("|");
  return { status, checks, groups: buildGroups(checks), warnings, blockers, signature };
}
