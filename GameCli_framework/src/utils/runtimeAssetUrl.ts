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

const mediaBlobUrls = new Map<string, Promise<string>>();

/**
 * Android WebView cannot reliably sniff media served from the custom
 * `agentvn-resource` protocol because its HEAD response is normalized to a
 * zero-length response. Fetching the same resource once and giving the media
 * element a Blob URL preserves streaming/range semantics for all other
 * assets while making audio decoding deterministic.
 */
export function resolvePlayableMediaUrl(source?: string | null): Promise<string | undefined> {
  const url = toRuntimeAssetUrl(source);
  if (!url || !/^https?:\/\/agentvn-resource\.localhost\//i.test(url)) {
    return Promise.resolve(url);
  }
  const cached = mediaBlobUrls.get(url);
  if (cached) return cached.then((value) => value);
  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Media resource request failed: ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      if (!blob.size) throw new Error("Media resource response was empty.");
      const blobUrl = URL.createObjectURL(blob);
      return blobUrl;
    })
    .catch((error) => {
      mediaBlobUrls.delete(url);
      throw error;
    });
  mediaBlobUrls.set(url, pending);
  return pending;
}
