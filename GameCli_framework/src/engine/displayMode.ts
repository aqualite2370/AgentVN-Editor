function runtimeWindowTitle(gameTitle?: string): string {
  const trimmedTitle = gameTitle?.trim();
  return trimmedTitle ? `${trimmedTitle} - AgentVN Player` : "AgentVN Player";
}

async function getTauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function setRuntimeWindowTitle(gameTitle?: string): Promise<boolean> {
  const title = runtimeWindowTitle(gameTitle);
  document.title = title;
  if (!("__TAURI_INTERNALS__" in window)) return true;
  try {
    const currentWindow = await getTauriWindow();
    await currentWindow.setTitle(title);
    return true;
  } catch (error) {
    console.warn("[GameCli] Tauri window title update failed", error);
    return false;
  }
}
