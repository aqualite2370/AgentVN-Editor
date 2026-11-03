export function isTauriRuntime(): boolean {
  if (isEmbeddedRuntime()) return false;
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isEmbeddedRuntime(): boolean {
  // Tauri injects its bridge into same-origin iframes as well. The editor's
  // embedded GameCLI preview must stay browser-like: it has no player-side
  // Tauri commands (for example list_saves/write_save) and must use the web
  // save store instead of calling the editor host.
  if (typeof window === "undefined") return false;
  return window.parent !== window
    || new URLSearchParams(window.location.search).get("embedded") === "1";
}

export function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
}
