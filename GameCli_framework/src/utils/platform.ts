export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isMobileViewport(): boolean {
  return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
}
