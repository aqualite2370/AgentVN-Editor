import type { ApiKeyStorageMode } from "./types";

const sessionKeys = new Map<string, string>();
let localSecrets: Record<string, string> = {};

export function hydrateApiKeys(secrets: Record<string, string> | undefined): void {
  localSecrets = secrets ? { ...secrets } : {};
}

export function getPersistedApiKeys(): Record<string, string> {
  return { ...localSecrets };
}

export function saveApiKey(providerId: string, apiKey: string, mode: ApiKeyStorageMode): void {
  if (mode === "session") {
    if (apiKey) sessionKeys.set(providerId, apiKey);
    else sessionKeys.delete(providerId);
    return;
  }
  if (mode === "local") {
    if (apiKey) localSecrets[providerId] = apiKey;
    else delete localSecrets[providerId];
    return;
  }
  if (mode === "none" || mode === "relay_account") return;
  throw new Error(`${mode} is reserved and not implemented in this build.`);
}

export function getApiKey(providerId: string): string | undefined {
  return sessionKeys.get(providerId) ?? localSecrets[providerId];
}

export function clearApiKey(providerId: string): void {
  sessionKeys.delete(providerId);
  if (providerId in localSecrets) {
    delete localSecrets[providerId];
  }
}
