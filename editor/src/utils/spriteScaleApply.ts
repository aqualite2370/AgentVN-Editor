import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import type { EditorNode } from "../types/nodes";
import type { ProjectSettings } from "../types/project";

export interface SpriteScaleApplyResult {
  nodes: EditorNode[];
  changedCommands: number;
  targetDisplayName: string;
}

export function humanizeSpriteScaleCharacterId(characterId: string): string {
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

export function resolveSpriteScaleDisplayName(characterId: string, settings: Pick<ProjectSettings, "characterDisplayNames">): string {
  const id = characterId.trim();
  const displayName = id ? settings.characterDisplayNames[id]?.trim() : "";
  return displayName || humanizeSpriteScaleCharacterId(id);
}

export function applySpriteScaleByDisplayName(
  nodes: EditorNode[],
  characterId: string,
  scale: number,
  settings: Pick<ProjectSettings, "characterDisplayNames">,
): SpriteScaleApplyResult {
  const nextScale = sanitizeSpriteScale(scale, DEFAULT_SPRITE_SCALE);
  const targetDisplayName = resolveSpriteScaleDisplayName(characterId, settings);
  let changedCommands = 0;
  const nextNodes = nodes.map((node) => {
    if (node.data.nodeKind !== "scene" || !node.data.scene) return node;
    let sceneChanged = false;
    const commands = node.data.scene.commands.map((command) => {
      if (command.type !== "sprite") return command;
      if (resolveSpriteScaleDisplayName(command.character_id, settings) !== targetDisplayName) return command;
      if (command.scale === nextScale) return command;
      sceneChanged = true;
      changedCommands += 1;
      return { ...command, scale: nextScale };
    });
    return sceneChanged ? { ...node, data: { ...node.data, scene: { ...node.data.scene, commands } } } : node;
  });
  return { nodes: nextNodes, changedCommands, targetDisplayName };
}
