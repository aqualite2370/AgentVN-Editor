import { DEFAULT_SPRITE_SCALE, sanitizeSpriteScale } from "../../../shared/cartridge/spriteScale";
import { sanitizeSpriteOffsetX, sanitizeSpriteOffsetY } from "../../../shared/cartridge/spritePlacement";
import type { SpriteCommand } from "../types/commands";
import type { EditorNode } from "../types/nodes";
import type { CharacterSpriteLayoutSettings, ProjectSettings } from "../types/project";
import { resolveSpriteScaleDisplayName } from "./spriteScaleApply";

export type SpritePlacementScope = "scene" | "character";

export interface SpritePlacementApplyResult {
  nodes: EditorNode[];
  changedCommands: number;
  targetDisplayName: string;
  matchingCharacterIds: string[];
}

export function resolveCharacterSpriteLayout(
  characterId: string,
  settings: Pick<ProjectSettings, "characterDisplayNames" | "characterSpriteLayouts">,
): CharacterSpriteLayoutSettings | undefined {
  const id = characterId.trim();
  if (!id) return undefined;
  const exact = settings.characterSpriteLayouts[id];
  if (exact) return exact;
  const explicitName = settings.characterDisplayNames[id]?.trim();
  if (!explicitName) return undefined;
  const matchingId = Object.keys(settings.characterSpriteLayouts).find(
    (candidateId) => settings.characterDisplayNames[candidateId]?.trim() === explicitName,
  );
  return matchingId ? settings.characterSpriteLayouts[matchingId] : undefined;
}

export function spritePlacementFromCommand(
  command: Pick<SpriteCommand, "position" | "offset_x" | "offset_y" | "scale">,
  fallbackScale = DEFAULT_SPRITE_SCALE,
): CharacterSpriteLayoutSettings {
  return {
    position: command.position ?? null,
    offset_x: sanitizeSpriteOffsetX(command.offset_x),
    offset_y: sanitizeSpriteOffsetY(command.offset_y),
    scale: sanitizeSpriteScale(command.scale, fallbackScale),
  };
}

export function applySpritePlacementToCommand(
  command: SpriteCommand,
  layout: CharacterSpriteLayoutSettings,
): SpriteCommand {
  return {
    ...command,
    position: layout.position ?? command.position ?? null,
    offset_x: sanitizeSpriteOffsetX(layout.offset_x),
    offset_y: sanitizeSpriteOffsetY(layout.offset_y),
    scale: sanitizeSpriteScale(layout.scale, DEFAULT_SPRITE_SCALE),
  };
}

function samePlacement(command: SpriteCommand, layout: CharacterSpriteLayoutSettings): boolean {
  return (command.position ?? null) === (layout.position ?? command.position ?? null)
    && sanitizeSpriteOffsetX(command.offset_x) === sanitizeSpriteOffsetX(layout.offset_x)
    && sanitizeSpriteOffsetY(command.offset_y) === sanitizeSpriteOffsetY(layout.offset_y)
    && sanitizeSpriteScale(command.scale, DEFAULT_SPRITE_SCALE) === sanitizeSpriteScale(layout.scale, DEFAULT_SPRITE_SCALE);
}

function spritePlacementMatchKey(
  characterId: string,
  settings: Pick<ProjectSettings, "characterDisplayNames">,
): string {
  const id = characterId.trim();
  const explicitName = id ? settings.characterDisplayNames[id]?.trim() : "";
  return explicitName ? `name:${explicitName}` : `id:${id}`;
}

export function applySpritePlacementToNodes(
  nodes: EditorNode[],
  sceneId: string,
  characterId: string,
  layout: CharacterSpriteLayoutSettings,
  scope: SpritePlacementScope,
  settings: Pick<ProjectSettings, "characterDisplayNames">,
): SpritePlacementApplyResult {
  const targetDisplayName = resolveSpriteScaleDisplayName(characterId, settings);
  const targetMatchKey = spritePlacementMatchKey(characterId, settings);
  const matchingCharacterIds = new Set<string>();
  let changedCommands = 0;
  const nextNodes = nodes.map((node) => {
    if (node.data.nodeKind !== "scene" || !node.data.scene) return node;
    if (scope === "scene" && node.data.scene.scene_id !== sceneId) return node;
    let sceneChanged = false;
    const commands = node.data.scene.commands.map((command) => {
      if (command.type !== "sprite") return command;
      if (spritePlacementMatchKey(command.character_id, settings) !== targetMatchKey) return command;
      matchingCharacterIds.add(command.character_id.trim());
      if (samePlacement(command, layout)) return command;
      sceneChanged = true;
      changedCommands += 1;
      return applySpritePlacementToCommand(command, layout);
    });
    return sceneChanged
      ? { ...node, data: { ...node.data, scene: { ...node.data.scene, commands } } }
      : node;
  });
  if (characterId.trim()) matchingCharacterIds.add(characterId.trim());
  return {
    nodes: nextNodes,
    changedCommands,
    targetDisplayName,
    matchingCharacterIds: [...matchingCharacterIds],
  };
}

export function countSpritePlacementTargets(
  nodes: EditorNode[],
  sceneId: string,
  characterId: string,
  scope: SpritePlacementScope,
  settings: Pick<ProjectSettings, "characterDisplayNames">,
): number {
  const targetMatchKey = spritePlacementMatchKey(characterId, settings);
  return nodes.reduce((total, node) => {
    if (node.data.nodeKind !== "scene" || !node.data.scene) return total;
    if (scope === "scene" && node.data.scene.scene_id !== sceneId) return total;
    return total + node.data.scene.commands.filter(
      (command) => command.type === "sprite"
        && spritePlacementMatchKey(command.character_id, settings) === targetMatchKey,
    ).length;
  }, 0);
}
