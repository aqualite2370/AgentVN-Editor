import { backendClient } from "../api/backendClient";
import type {
  AssistantComponentDraftRequest,
  AssistantComponentDraftResponse,
  AssistantCreationProcess as ApiAssistantCreationProcess,
  AssistantCreationProcessStatus as ApiAssistantCreationProcessStatus,
  AssistantCreationLocalToolResult,
} from "../api/types";

export type AssistantCreationProcessStatus = ApiAssistantCreationProcessStatus;
export type AssistantCreationProcess = Omit<ApiAssistantCreationProcess, "result">;

export interface EnqueueAssistantCreationProcessOptions {
  id?: string;
  projectId: string;
  projectTitle: string;
  conversationId: string;
  onLocalTool?: (process: ApiAssistantCreationProcess) => Promise<AssistantCreationLocalToolResult | undefined>;
}

const listeners = new Set<() => void>();
let processes: AssistantCreationProcess[] = [];
let polling = false;
let refreshInFlight: Promise<void> | undefined;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let visibilityListenerAttached = false;
const terminalStatuses = new Set<AssistantCreationProcessStatus>([
  "completed", "failed", "cancelled",
]);

function publish(): void {
  for (const listener of listeners) listener();
}

function mergeProcesses(next: ApiAssistantCreationProcess[]): void {
  const merged = next.map(({ result: _result, localToolRequest: _localToolRequest, ...process }) => process)
    .sort((left, right) => left.submittedAt - right.submittedAt);
  if (JSON.stringify(merged) === JSON.stringify(processes)) return;
  processes = merged;
  publish();
}

function upsertProcess(next: AssistantCreationProcess): void {
  const merged = [
    ...processes.filter((process) => process.id !== next.id),
    next,
  ].sort((left, right) => left.submittedAt - right.submittedAt);
  if (JSON.stringify(merged) === JSON.stringify(processes)) return;
  processes = merged;
  publish();
}

function refreshProcesses(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = backendClient.listAssistantCreationProcesses()
    .then(mergeProcesses)
    .catch(() => {
      // A temporary backend interruption must not erase the last known process state.
    })
    .finally(() => {
      refreshInFlight = undefined;
    });
  return refreshInFlight;
}

function scheduleRefresh(): void {
  if (pollTimer) clearTimeout(pollTimer);
  if (listeners.size === 0 || polling) return;
  const hidden = typeof document !== "undefined" && document.hidden;
  const hasActiveProcesses = processes.some((process) => !terminalStatuses.has(process.status));
  const delayMs = hidden ? 5000 : hasActiveProcesses ? 500 : 2500;
  pollTimer = setTimeout(async () => {
    polling = true;
    await refreshProcesses();
    polling = false;
    scheduleRefresh();
  }, delayMs);
}

function onDocumentVisibilityChange(): void {
  if (typeof document !== "undefined" && !document.hidden) void refreshProcesses().finally(scheduleRefresh);
}

export function subscribeAssistantCreationProcesses(listener: () => void): () => void {
  listeners.add(listener);
  if (!visibilityListenerAttached && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onDocumentVisibilityChange);
    visibilityListenerAttached = true;
  }
  void refreshProcesses().finally(scheduleRefresh);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    if (listeners.size === 0 && visibilityListenerAttached && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onDocumentVisibilityChange);
      visibilityListenerAttached = false;
    }
  };
}

export function getAssistantCreationProcesses(): AssistantCreationProcess[] {
  return processes;
}

function abortError(): DOMException {
  return new DOMException("创作进程已取消。", "AbortError");
}

async function waitForCreationProcess(
  id: string,
  signal: AbortSignal,
  onLocalTool?: EnqueueAssistantCreationProcessOptions["onLocalTool"],
): Promise<AssistantComponentDraftResponse> {
  let cancelRequested = false;
  const onAbort = () => {
    cancelRequested = true;
    void backendClient.cancelAssistantCreationProcess(id).catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (cancelRequested && signal.aborted) throw abortError();
      const process = await backendClient.getAssistantCreationProcess(id);
      const { result, localToolRequest: _localToolRequest, ...publicProcess } = process;
      upsertProcess(publicProcess);
      if (process.localToolRequest && onLocalTool && process.status === "running") {
        await onLocalTool(process);
      }
      if (process.status === "completed" && result) return result;
      if (process.status === "failed") {
        throw new Error(process.errorMessage || "创造进程失败，请查看任务详情后重试。");
      }
      if (process.status === "cancelled") throw abortError();
      if (signal.aborted) {
        cancelRequested = true;
        throw abortError();
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function createAssistantCreationProcessId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `creation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueAssistantCreationProcess(
  options: EnqueueAssistantCreationProcessOptions,
  request: AssistantComponentDraftRequest,
): { id: string; result: Promise<AssistantComponentDraftResponse> } {
  const id = options.id ?? createAssistantCreationProcessId();
  const submittedAt = Date.now();
  processes = [...processes, {
    id,
    projectId: options.projectId,
    projectTitle: options.projectTitle,
    conversationId: options.conversationId,
    status: "queued",
    submittedAt,
  }];
  publish();

  const controller = new AbortController();
  const result = backendClient.enqueueAssistantCreationProcess({
    id,
    project_id: options.projectId,
    project_title: options.projectTitle,
    conversation_id: options.conversationId,
    request,
  }).then(() => waitForCreationProcess(id, controller.signal, options.onLocalTool)).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const message = error instanceof Error ? error.message : "创造进程提交失败。";
    processes = processes.map((process) => process.id === id ? {
      ...process,
      status: "failed",
      finishedAt: Date.now(),
    errorMessage: message,
    } : process);
    publish();
    throw error;
  });
  scheduleRefresh();
  return { id, result };
}

export function cancelAssistantCreationProcess(id: string): boolean {
  const process = processes.find((item) => item.id === id);
  if (!process || terminalStatuses.has(process.status) || process.status === "cancelling") return false;
  processes = processes.map((item) => item.id === id ? { ...item, status: "cancelling" } : item);
  publish();
  void backendClient.cancelAssistantCreationProcess(id).then((updated) => {
    const { result: _result, ...publicProcess } = updated;
    processes = processes.map((item) => item.id === id ? publicProcess : item);
    publish();
  }).catch((error) => {
    processes = processes.map((item) => item.id === id ? {
      ...item,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : "取消创造进程失败。",
    } : item);
    publish();
  });
  return true;
}
