import { convertFileSrc } from "@tauri-apps/api/core";

import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

function isLocalFilePath(source: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\)/.test(source) || source.includes("\\");
}

function normalizeWindowsPathForTauri(source: string): string {
  if (source.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${source.slice("\\\\?\\UNC\\".length)}`;
  }
  if (source.startsWith("\\\\?\\")) {
    return source.slice("\\\\?\\".length);
  }
  return source;
}

export function toRuntimeAssetUrl(source?: string | null): string | undefined {
  if (!source) return undefined;
  if (/^(?:blob:|https?:|data:|file:)/i.test(source)) return source;
  if (!isLocalFilePath(source)) return source;
  const normalizedSource = normalizeWindowsPathForTauri(source);
  try {
    return convertFileSrc(normalizedSource);
  } catch (error) {
    reportFrontendError("player.asset-url", error, {
      operation: "convert-local-file-url",
      source: normalizedSource,
    });
    return normalizedSource;
  }
}
