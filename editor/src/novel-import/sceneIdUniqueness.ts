import type { GameCommand } from "../types/commands";
import type { SceneBeat } from "../types/scene";

export function sceneIdBase(value: string | undefined | null, fallback: string): string {
  const normalized = (value?.trim() || fallback)
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 80) || fallback;
}

export function nextUniqueSceneId(
  preferred: string | undefined | null,
  usedSceneIds: Set<string>,
  fallback: string,
): string {
  const base = sceneIdBase(preferred, fallback);
  let candidate = base;
  let index = 2;
  while (usedSceneIds.has(candidate)) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, Math.max(1, 96 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedSceneIds.add(candidate);
  return candidate;
}

export function remapSceneSelfTargets(
  commands: GameCommand[],
  fromSceneId: string,
  toSceneId: string,
): GameCommand[] {
  if (!fromSceneId || fromSceneId === toSceneId) return commands;
  return commands.map((command) => {
    if (command.type === "conditional_jump") {
      return {
        ...command,
        target_scene_id: command.target_scene_id === fromSceneId ? toSceneId : command.target_scene_id,
        else_target_scene_id: command.else_target_scene_id === fromSceneId ? toSceneId : command.else_target_scene_id,
      };
    }
    if (command.type === "jump") {
      return {
        ...command,
        target_scene_id: command.target_scene_id === fromSceneId ? toSceneId : command.target_scene_id,
      };
    }
    if (command.type !== "choice") return command;
    return {
      ...command,
      choices: command.choices.map((choice) =>
        choice.target_scene_id === fromSceneId ? { ...choice, target_scene_id: toSceneId } : choice
      ),
    };
  });
}

export function ensureUniqueSceneBeatId(
  scene: SceneBeat,
  usedSceneIds: Set<string>,
  fallbackSeed: string,
): { scene: SceneBeat; renamedFrom?: string } {
  const previousSceneId = scene.scene_id.trim();
  const fallback = `novel_scene_${sceneIdBase(fallbackSeed, "scene")}`;
  const sceneId = nextUniqueSceneId(previousSceneId, usedSceneIds, fallback);
  if (sceneId === previousSceneId) return { scene };
  return {
    renamedFrom: previousSceneId,
    scene: {
      ...scene,
      scene_id: sceneId,
      commands: remapSceneSelfTargets(scene.commands, previousSceneId, sceneId),
    },
  };
}
