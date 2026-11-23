import type { RuntimeAutoSaveResult } from "../store/runtimeStore";
import type { RuntimeWindowCloseResult } from "./runtimeWindowClose";

export type RuntimeExitFlowResult =
  | RuntimeWindowCloseResult
  | { status: "save-failed"; message: string };

export async function closeAfterSave(
  flushAutoSave: () => Promise<RuntimeAutoSaveResult>,
  closeWindow: () => Promise<RuntimeWindowCloseResult>,
): Promise<RuntimeExitFlowResult> {
  try {
    const save = await flushAutoSave();
    if (save.status === "failed") return { status: "save-failed", message: save.message };
  } catch (error) {
    return { status: "save-failed", message: error instanceof Error ? error.message : String(error) };
  }
  return closeWindow();
}

export function closeWithoutSave(
  closeWindow: () => Promise<RuntimeWindowCloseResult>,
): Promise<RuntimeWindowCloseResult> {
  return closeWindow();
}
