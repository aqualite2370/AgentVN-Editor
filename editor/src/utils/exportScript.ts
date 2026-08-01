import type { GameCommand } from "../types/commands";
import type { LoadingAnimationConfig } from "../../../shared/cartridge/types";
import type { EditorEdge, EditorNode, RuntimeScene, RuntimeScript } from "../types/nodes";
import type { ProjectSettings } from "../types/project";
import { DEFAULT_SPRITE_SCALE, nullableSpriteScale, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import { sanitizeSpeakerFocus } from "../../../shared/cartridge/speakerFocus";
import { runtimeScriptSchemaVersion } from "../../../shared/cartridge/runtimeCapabilities";
import { choiceRuntimeText } from "./choiceText";
import { conditionToRuntimeCondition, isBuilderCondition } from "./conditions";
import { validateDefaultHandleFanOut, validateScript, type ValidationIssue, type ValidationRuntimeScript } from "./validation";

function normalizeRuntimeCommands(commands: GameCommand[]): GameCommand[] {
  return commands.map((command) => {
    if (command.type !== "sprite") return command;
    const scale = nullableSpriteScale(command.scale);
    if (scale === null) {
      const next = { ...command };
      delete next.scale;
      return next;
    }
    return { ...command, scale };
  });
}

function syntheticSceneId(node: EditorNode): string {
  return `${node.data.nodeKind}_${node.id}`;
}

function loopCommands(node: EditorNode): GameCommand[] {
  const loop = node.data.loop;
  if (!loop) return [];
  return [
    { type: "state_update", key: loop.variableKey, operation: "set_if_unset", value: loop.initialValue, value_type: "number" },
    { type: "state_update", key: loop.variableKey, operation: "add", value: loop.step, value_type: "number" },
    { type: "conditional_jump", condition: loop.continueCondition, target_scene_id: "", else_target_scene_id: "" },
  ];
}

function nodeToRuntimeScene(node: EditorNode): RuntimeScene | null {
  if (node.data.nodeKind === "scene" && node.data.scene) {
    const scene = node.data.scene;
    return {
      scene_id: scene.scene_id,
      scene_display_name: scene.scene_display_name,
      title: scene.title,
      summary: scene.summary,
      commands: normalizeRuntimeCommands(scene.commands),
      tags: scene.tags,
      chapter: scene.chapter,
      is_ending: scene.is_ending,
      ending_id: scene.ending_id,
      ending_title: scene.ending_title,
    };
  }
  if (node.data.nodeKind === "modifier" && node.data.stateUpdate) {
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.label,
      title: node.data.label,
      summary: node.data.description,
      commands: [node.data.stateUpdate],
      tags: ["modifier"],
      chapter: 0,
    };
  }
  if (node.data.nodeKind === "choice" && node.data.choice) {
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.label,
      title: node.data.label,
      summary: node.data.description,
      commands: [node.data.choice],
      tags: ["choice"],
      chapter: 0,
    };
  }
  if (node.data.nodeKind === "loop" && node.data.loop) {
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.label,
      title: node.data.label,
      summary: node.data.description,
      commands: loopCommands(node),
      tags: ["loop"],
      chapter: 0,
    };
  }
  if (node.data.nodeKind === "animation" && node.data.animation) {
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.label,
      title: node.data.label,
      summary: node.data.description,
      commands: [node.data.animation],
      tags: ["animation"],
      chapter: 0,
    };
  }
  if (node.data.nodeKind === "condition" && node.data.condition) {
    const runtimeCondition = isBuilderCondition(node.data.condition) ? conditionToRuntimeCondition(node.data.condition) : node.data.condition.expression;
    const commands: GameCommand[] = [
      {
        type: "conditional_jump",
        condition: runtimeCondition,
        target_scene_id: "",
        else_target_scene_id: "",
      },
    ];
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.label,
      title: node.data.label,
      summary: node.data.description,
      commands,
      tags: ["condition"],
      chapter: 0,
    };
  }
  if (node.data.nodeKind === "end") {
    return {
      scene_id: syntheticSceneId(node),
      scene_display_name: node.data.ending?.ending_title ?? node.data.label,
      title: node.data.ending?.ending_title ?? node.data.label,
      summary: node.data.description,
      commands: [{ type: "narration", text: node.data.ending?.ending_title ?? "剧情结束。" }],
      tags: ["ending"],
      chapter: 0,
      is_ending: true,
      ending_id: node.data.ending?.ending_id,
      ending_title: node.data.ending?.ending_title,
    };
  }
  return null;
}

function sceneIdForNode(node: EditorNode): string | null {
  return node.data.scene?.scene_id ?? syntheticSceneId(node);
}

function humanizeCharacterId(characterId: string): string {
  const trimmed = characterId.trim();
  if (!trimmed) return characterId;
  if (/[\u3400-\u9fff]/.test(trimmed)) return trimmed;
  if (/^(char|character)[_-][a-z0-9]{3,}$/i.test(trimmed)) return "未知角色";
  const stripped = trimmed.replace(/^(char|character)[_-]/i, "");
  return stripped
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || trimmed;
}

function collectCharacterProfiles(scenes: RuntimeScene[]): RuntimeScript["characters"] {
  const ids = new Set<string>();
  for (const scene of scenes) {
    for (const command of scene.commands) {
      if (command.type === "dialog" || command.type === "sprite") ids.add(command.character_id);
    }
  }
  return [...ids].sort().map((character_id) => ({
    character_id,
    name: humanizeCharacterId(character_id),
    aliases: [],
  }));
}

function normalizeLoadingAnimation(config: LoadingAnimationConfig | undefined): LoadingAnimationConfig | undefined {
  if (!config || config.kind === "default") return undefined;
  if (config.kind === "video") {
    const videoAssetId = config.video_asset_id.trim();
    return videoAssetId ? { kind: "video", video_asset_id: videoAssetId } : undefined;
  }
  const imageAssetIds = Array.from(new Set(config.image_asset_ids.map((assetId) => assetId.trim()).filter(Boolean)));
  if (imageAssetIds.length === 0) return undefined;
  const frameDurationMs = Math.max(100, Math.round(config.frame_duration_ms ?? 1000));
  return { kind: "image_sequence", image_asset_ids: imageAssetIds, frame_duration_ms: frameDurationMs };
}

function defaultTargetSceneId(node: EditorNode, nodes: EditorNode[], edges: EditorEdge[]): string | undefined {
  const edge = edges.find((item) => item.source === node.id && (!item.sourceHandle || item.sourceHandle === "default"));
  const target = edge ? nodes.find((item) => item.id === edge.target) : undefined;
  return target ? sceneIdForNode(target) ?? undefined : undefined;
}

function explicitCommandTargetSceneIds(node: EditorNode): string[] {
  const scene = nodeToRuntimeScene(node);
  if (!scene) return [];
  return scene.commands.flatMap((command) => {
    if (command.type === "choice") {
      return command.choices.map((choice) => choice.target_scene_id).filter((id): id is string => Boolean(id));
    }
    if (command.type === "conditional_jump") {
      return [command.target_scene_id, command.else_target_scene_id ?? ""].filter((id): id is string => Boolean(id));
    }
    if (command.type === "jump") return [command.target_scene_id].filter(Boolean);
    return [];
  });
}

function reachableNodeIdsForExport(startId: string, nodes: EditorNode[], edges: EditorEdge[]): Set<string> {
  const reachable = new Set<string>();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIdsBySceneId = new Map<string, string>();
  for (const node of nodes) {
    const sceneId = sceneIdForNode(node);
    if (sceneId) nodeIdsBySceneId.set(sceneId, node.id);
  }

  const queue = [startId];
  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);

    for (const edge of edges.filter((item) => item.source === nodeId)) {
      if (!reachable.has(edge.target)) queue.push(edge.target);
    }

    const node = nodesById.get(nodeId);
    if (!node) continue;
    for (const targetSceneId of explicitCommandTargetSceneIds(node)) {
      const targetNodeId = nodeIdsBySceneId.get(targetSceneId);
      if (targetNodeId && !reachable.has(targetNodeId)) queue.push(targetNodeId);
    }
  }

  return reachable;
}

function patchTargets(scene: RuntimeScene, node: EditorNode, nodes: EditorNode[], edges: EditorEdge[]): RuntimeScene {
  const allSceneIds = new Set(nodes.map((item) => sceneIdForNode(item)).filter((id): id is string => Boolean(id)));
  const nextSceneId = scene.is_ending ? undefined : defaultTargetSceneId(node, nodes, edges);
  const commands = structuredClone(scene.commands).flatMap((command): GameCommand[] => {
    if (command.type === "jump") {
      const jumpEdge = edges.find((item) => item.source === node.id && (!item.sourceHandle || item.sourceHandle === "default"));
      const jumpTarget = jumpEdge ? nodes.find((item) => item.id === jumpEdge.target) : undefined;
      const edgeSceneId = jumpTarget ? sceneIdForNode(jumpTarget) ?? "" : "";
      const existingTargetSceneId = command.target_scene_id && allSceneIds.has(command.target_scene_id) ? command.target_scene_id : "";
      return [{ ...command, target_scene_id: edgeSceneId || existingTargetSceneId || nextSceneId || "" }];
    }
    if (command.type === "conditional_jump") {
      const trueHandle = node.data.nodeKind === "loop" ? "loop" : "true";
      const falseHandle = node.data.nodeKind === "loop" ? "exit" : "false";
      const trueEdge = edges.find((item) => item.source === node.id && item.sourceHandle === trueHandle);
      const falseEdge = edges.find((item) => item.source === node.id && item.sourceHandle === falseHandle);
      const trueTarget = trueEdge ? nodes.find((item) => item.id === trueEdge.target) : undefined;
      const falseTarget = falseEdge ? nodes.find((item) => item.id === falseEdge.target) : undefined;
      const trueEdgeSceneId = trueTarget ? sceneIdForNode(trueTarget) ?? "" : "";
      const falseEdgeSceneId = falseTarget ? sceneIdForNode(falseTarget) ?? "" : "";
      const existingTargetSceneId = command.target_scene_id && allSceneIds.has(command.target_scene_id) ? command.target_scene_id : "";
      const existingElseSceneId = command.else_target_scene_id && allSceneIds.has(command.else_target_scene_id) ? command.else_target_scene_id : "";
      return [{
        ...command,
        target_scene_id: trueEdgeSceneId || existingTargetSceneId || "",
        else_target_scene_id: falseEdgeSceneId || existingElseSceneId || null,
      }];
    }
    if (command.type !== "choice") return [command];
    const choices = command.choices
      .map((choice, index) => {
        const edge = edges.find((item) => item.source === node.id && item.sourceHandle === choice.choice_id);
        const target = edge ? nodes.find((item) => item.id === edge.target) : undefined;
        const edgeTargetSceneId = target ? sceneIdForNode(target) ?? "" : "";
        const existingTargetSceneId = choice.target_scene_id && allSceneIds.has(choice.target_scene_id) ? choice.target_scene_id : "";
        return {
          ...choice,
          text: choiceRuntimeText(choice, index),
          target_scene_id: edgeTargetSceneId || existingTargetSceneId || nextSceneId || "",
        };
      })
      .filter((choice) => choice.target_scene_id && allSceneIds.has(choice.target_scene_id));
    return choices.length > 0 ? [{ ...command, choices }] : [];
  });
  return { ...scene, commands, next_scene_id: nextSceneId };
}

export function exportScript(nodes: EditorNode[], edges: EditorEdge[]): RuntimeScript {
  const start = nodes.find((node) => node.data.nodeKind === "start");
  const reachable = start ? reachableNodeIdsForExport(start.id, nodes, edges) : new Set<string>();
  const startEdge = start ? edges.find((edge) => edge.source === start.id) : undefined;
  const entryNode = startEdge ? nodes.find((node) => node.id === startEdge.target) : nodes.find((node) => node.data.nodeKind === "scene");
  const entrySceneId = entryNode ? sceneIdForNode(entryNode) ?? "" : "";
  const scenes = nodes
    .filter((node) => reachable.has(node.id) && node.data.nodeKind !== "start")
    .map((node) => {
      const scene = nodeToRuntimeScene(node);
      return scene ? patchTargets(scene, node, nodes, edges) : null;
    })
    .filter((scene): scene is RuntimeScene => Boolean(scene));

  const script: RuntimeScript = {
    schema_version: "1.1.0",
    entry_scene_id: entrySceneId,
    loading_animation: normalizeLoadingAnimation(start?.data.loadingAnimation),
    characters: collectCharacterProfiles(scenes),
    scenes,
  };
  return {
    ...script,
    schema_version: runtimeScriptSchemaVersion(script),
  };
}

export function applyProjectRuntimeSettingsToScript<T extends RuntimeScript>(script: T, settings: ProjectSettings): T {
  const displayNames = settings.characterDisplayNames ?? {};
  return {
    ...script,
    default_sprite_scale: sanitizeSpriteScale(settings.defaultSpriteScale, DEFAULT_SPRITE_SCALE),
    speaker_focus: sanitizeSpeakerFocus(settings.speakerFocus),
    characters: script.characters?.map((character) => ({
      ...character,
      name: displayNames[character.character_id]?.trim() || character.name,
    })),
  } as T;
}

export function validateExportScript(script: ValidationRuntimeScript, graph?: { nodes: EditorNode[]; edges: EditorEdge[] }): ValidationIssue[] {
  return [
    ...(graph ? validateDefaultHandleFanOut(graph.nodes, graph.edges) : []),
    ...validateScript(script),
  ];
}
