import { localStorageAdapter } from "../utils/storage";

const PREFIX = "vn.runtime.read.";

function keyForGame(gameId?: string) {
  return `${PREFIX}${gameId || "unknown"}`;
}

export function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createTextKey(gameId: string | undefined, sceneId: string, commandIndex: number, text: string): string {
  return `${gameId || "unknown"}:${sceneId}:${commandIndex}:${hashText(text)}`;
}

export function readTextKeys(gameId?: string): string[] {
  return localStorageAdapter.get<string[]>(keyForGame(gameId), []);
}

export function isTextRead(gameId: string | undefined, textKey?: string): boolean {
  if (!textKey) return true;
  return readTextKeys(gameId).includes(textKey);
}

export function markTextRead(gameId: string | undefined, textKey?: string): void {
  if (!textKey) return;
  const key = keyForGame(gameId);
  const current = new Set(readTextKeys(gameId));
  if (current.has(textKey)) return;
  current.add(textKey);
  localStorageAdapter.set(key, [...current]);
}
