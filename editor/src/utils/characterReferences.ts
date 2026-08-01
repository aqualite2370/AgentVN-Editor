import type { GameCommand } from "../types/commands";
import type { EditorNode } from "../types/nodes";

function collectFromCommands(commands: GameCommand[] | undefined, ids: Set<string>): void {
  for (const command of commands ?? []) {
    if ((command.type === "dialog" || command.type === "sprite") && command.character_id.trim()) {
      ids.add(command.character_id.trim());
    }
    if (command.type === "animation") {
      const target = command.target.trim();
      if (target.toLowerCase().startsWith("sprite:")) {
        const characterId = target.slice("sprite:".length).trim();
        if (characterId && characterId !== "selected" && characterId !== "all") ids.add(characterId);
      }
    }
  }
}

export function collectCharacterIdsFromNodes(nodes: EditorNode[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    collectFromCommands(node.data.scene?.commands, ids);
    if (node.data.choice) collectFromCommands([node.data.choice], ids);
    if (node.data.animation) collectFromCommands([node.data.animation], ids);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export function spriteTargetForCharacter(characterId: string): string {
  const trimmed = characterId.trim();
  if (!trimmed || trimmed === "selected" || trimmed === "all") return `sprite:${trimmed || "selected"}`;
  return `sprite:${trimmed}`;
}

export function characterIdFromSpriteTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed.toLowerCase().startsWith("sprite:")) return "";
  return trimmed.slice("sprite:".length).trim();
}
