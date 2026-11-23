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

export class AssistantCreationOutcomeUnknownError extends Error {
  constructor() {
    super("尚未确认原创造任务的结果；不会重新提交。请查询原任务。");
    this.name = "AssistantCreationOutcomeUnknownError";
  }
}

export async function queryAssistantCreationProcess(
  id: string,
  owner: Pick<EnqueueAssistantCreationProcessOptions, "projectId" | "conversationId">,
): Promise<ApiAssistantCreationProcess> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const process = await backendClient.getAssistantCreationProcess(id, 2500).catch(() => undefined);
    if (process) {
      if (process.id !== id || process.projectId !== owner.projectId || process.conversationId !== owner.conversationId
        || (process.status === "completed" && !process.result)) break;
      const { result: _result, localToolRequest: _localToolRequest, ...publicProcess } = process;
      upsertProcess(publicProcess);
      return process;
    }
    if (attempt < 2) await wait(350 * (attempt + 1));
  }
  throw new AssistantCreationOutcomeUnknownError();
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForCreationProcess(
  id: string,
  owner: Pick<EnqueueAssistantCreationProcessOptions, "projectId" | "conversationId">,
  onLocalTool?: EnqueueAssistantCreationProcessOptions["onLocalTool"],
): Promise<{ result: AssistantComponentDraftResponse; finalChecks?: ApiAssistantCreationProcess["finalChecks"] }> {
  while (true) {
    const process = await queryAssistantCreationProcess(id, owner);
    if (process.localToolRequest && onLocalTool && process.status === "running") {
      await onLocalTool(process).catch(() => undefined);
    }
    if (process.status === "completed" && process.result) return { result: process.result, finalChecks: process.finalChecks };
    if (process.status === "failed") {
      throw new Error(process.errorMessage || "创造进程失败，请查看任务详情后重试。");
    }
    if (process.status === "cancelled") throw new DOMException("创作进程已取消。", "AbortError");
    await wait(350);
  }
}

export function createAssistantCreationProcessId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `creation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function enqueueAssistantCreationProcess(
  options: EnqueueAssistantCreationProcessOptions,
  request: AssistantComponentDraftRequest,
): { id: string; result: ReturnType<typeof waitForCreationProcess> } {
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

  const result = backendClient.enqueueAssistantCreationProcess({
    id,
    project_id: options.projectId,
    project_title: options.projectTitle,
    conversation_id: options.conversationId,
    request,
  // Once attempted, a submission is never repeated here. Even an HTTP error
  // can come from an intermediary, after the backend committed the original.
  }).catch(() => undefined).then(() => waitForCreationProcess(id, options, options.onLocalTool));
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
  }).catch(() => {
    processes = processes.map((item) => item.id === id ? {
      ...(item.status === "cancelling" ? process : item),
      errorMessage: "尚未收到取消回执；请查询原任务。",
    } : item);
    publish();
  });
  return true;
}
