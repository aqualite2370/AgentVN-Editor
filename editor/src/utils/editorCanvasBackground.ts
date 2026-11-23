import { backendClient } from "../api/backendClient";
import type { EditorCanvasBackgroundImage } from "../types/project";

export function editorCanvasBackgroundSource(image?: EditorCanvasBackgroundImage): string | undefined {
  const source = image?.dataUrl ?? image?.url;
  // Relative URLs from older projects are sidecar routes, not editor routes.
  return source?.startsWith("/api/project/assets/") ? backendClient.resolveProjectAssetUrl(source) : source;
}
