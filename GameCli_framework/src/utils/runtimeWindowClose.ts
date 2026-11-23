import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { isEmbeddedRuntime, isTauriRuntime } from "./platform";

export type RuntimeWindowCloseResult =
  | { status: "closed" }
  | { status: "preview" }
  | { status: "failed" };

interface RuntimeWindowCloseDependencies {
  isEmbedded?: () => boolean;
  isTauri?: () => boolean;
  closeWindow?: () => Promise<void>;
  reportError?: (error: unknown) => void;
}

export function routeRuntimeWindowCloseRequest(
  event: { preventDefault: () => void },
  openExitConfirmation: () => void,
): "confirmation-required" {
  event.preventDefault();
  openExitConfirmation();
  return "confirmation-required";
}

async function closeCurrentTauriWindow(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  // The native host selects application exit on Android and window destruction
  // on desktop. Android's window-destroy IPC can remain unanswered with the
  // activity still visible. This command is reached only after the save barrier
  // or the player's explicit discard confirmation.
  await invoke("exit_runtime");
}

export async function closeStandaloneRuntimeWindow(
  dependencies: RuntimeWindowCloseDependencies = {},
): Promise<RuntimeWindowCloseResult> {
  const embedded = dependencies.isEmbedded ?? isEmbeddedRuntime;
  const tauri = dependencies.isTauri ?? isTauriRuntime;
  if (embedded() || !tauri()) return { status: "preview" };

  try {
    await (dependencies.closeWindow ?? closeCurrentTauriWindow)();
    return { status: "closed" };
  } catch (error) {
    (dependencies.reportError ?? ((cause) => {
      reportFrontendError("player.window", cause, { operation: "close-runtime-window" });
    }))(error);
    return { status: "failed" };
  }
}
