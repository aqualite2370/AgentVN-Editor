import { nanoid } from "nanoid";
import type {
  AdaptSceneRequest,
  AdaptSceneResponse,
  BranchSuggestion,
  ChapterCandidate,
  CharacterCandidate,
  ConflictPoint,
  NovelAiChunkAnalysis,
  NovelAiChunkEntityIndex,
  NovelAiChunkSummary,
  NovelAiChunkTimelineNotes,
  NovelAiOutline,
  NovelAiOutlineBatchCheckpoint,
  NovelAiOutlineIndex,
  NovelAiOutlineMainline,
  NovelAiOutlineStructure,
  SceneCandidate,
  SourceDocument,
} from "./types";
import type { ProviderSelectionPayload } from "../providers/types";
import { backendClient } from "../api/backendClient";
import { createSourceMapping } from "./sourceMapping";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

function getNovelBackendBaseUrl(): string {
  return backendClient.getBaseUrl();
}

function getNovelWebsocketBaseUrl(): string {
  return getNovelBackendBaseUrl().replace(/^http/i, "ws");
}
const defaultNovelAiRequestTimeoutSeconds = 300;
const novelAiRequestTimeoutBufferSeconds = 30;
const minNovelAiRequestTimeoutSeconds = 30;
const maxNovelAiRequestTimeoutSeconds = 900;
const novelAiRoutes = [
  "/api/novel/import/ai_scan_chunk",
  "/api/novel/import/ai_scan_chunk_stream",
  "/api/novel/import/ai_build_outline",
  "/api/novel/import/ai_build_outline_stream",
  "/api/novel/import/ai_plan_chapter",
  "/api/novel/import/ai_plan_chapter_stream",
  "/api/novel/import/ai_adapt_scene",
  "/api/novel/import/ai_adapt_scene_stream",
];

export interface AiTraceEvent {
  id?: string;
  time?: string;
  phase?: string;
  level?: string;
  title?: string;
  message?: string;
  details?: unknown;
}

export interface AiCheckpointEvent {
  stage: string;
  payload: unknown;
  warnings?: unknown;
}

export interface NovelAiStreamHandlers {
  signal?: AbortSignal;
  /** Only direct adaptation has a durable result consumer for this identity. */
  adaptationFingerprint?: string;
  onDelta?: (delta: string) => void;
  onStatus?: (status: string) => void;
  onTrace?: (trace: AiTraceEvent) => void;
  onCheckpoint?: (checkpoint: AiCheckpointEvent) => void;
  onFinal?: (payload: unknown) => void;
  onError?: (message: string) => void;
}

type NovelWsOperation = "scan_chunk" | "build_outline" | "plan_chapter" | "adapt_scene";
const activeNovelRequests = new Set<AbortController>();
export async function cancelActiveNovelAiRequests(): Promise<"terminal" | "unknown" | "local"> {
  for (const controller of activeNovelRequests) controller.abort();
  const cancellations = [...pendingNovelCancellations.values()];
  if (!cancellations.length) return "local";
  return (await Promise.all(cancellations)).every(Boolean) ? "terminal" : "unknown";
}

interface NovelWsEvent {
  type: string;
  seq?: number;
  jobId?: string;
  requestId?: string;
  phase?: string;
  agentId?: string;
  timestamp?: string | null;
  payload?: unknown;
}

const progressWsEventTypes = new Set(["message_delta", "agent_delta", "checkpoint"]);

function redactError(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***")
    .replace(/"api_key"\s*:\s*"[^"]+"/gi, "\"api_key\":\"***\"");
}

function normalizePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload;
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function novelAiRequestTimeoutMs(payload: unknown): number {
  const selection = (payload as { provider_selection?: { parameters?: { request_timeout_seconds?: unknown } } } | undefined)?.provider_selection;
  const raw = selection?.parameters?.request_timeout_seconds;
  const seconds = typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(maxNovelAiRequestTimeoutSeconds, Math.max(minNovelAiRequestTimeoutSeconds, raw))
    : defaultNovelAiRequestTimeoutSeconds;
  return Math.round((seconds + novelAiRequestTimeoutBufferSeconds) * 1000);
}

async function parseBackendError(response: Response, path: string): Promise<string> {
  let detail = "";
  try {
    const body = await response.json();
    detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body);
  } catch {
    // error-log-ignore: 错误响应可能不是 JSON，下面会读取同一个响应的纯文本内容。
    detail = await response.text().catch(() => {
      // error-log-ignore: 响应体不可重复读取时仍会使用状态码生成错误说明。
      return "";
    });
  }
  if (response.status === 404 && novelAiRoutes.includes(path)) {
    return `Backend route is missing or outdated: ${path}. Restart the AgentVN backend and try again.`;
  }
  return `${path} returned HTTP ${response.status}: ${redactError(detail || response.statusText || "unknown error")}`;
}

async function postJson<T>(path: string, payload: unknown, baseUrl = getNovelBackendBaseUrl(), timeoutMs = novelAiRequestTimeoutMs(payload)): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizePayload(payload)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parseBackendError(response, path));
    return (await response.json()) as T;
  } catch (error) {
    let reportedError = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      reportedError = new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    reportFrontendError("editor.novel-import-api", reportedError, { path, transport: "json", timeoutMs });
    throw reportedError;
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseSseBlock(block: string): { event: string; data: unknown } | undefined {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return undefined;
  const raw = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    // error-log-ignore: SSE 协议允许普通文本进度消息，最终错误由流处理器记录。
    return { event, data: raw };
  }
}

async function postSse<T>(
  path: string,
  payload: unknown,
  handlers: NovelAiStreamHandlers = {},
  baseUrl = getNovelBackendBaseUrl(),
  timeoutMs = novelAiRequestTimeoutMs(payload),
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  handlers.signal?.addEventListener("abort", abort, { once: true });
  if (handlers.signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(normalizePayload(payload)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parseBackendError(response, path));
    if (!response.body) throw new Error(`${path} did not return a readable stream.`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: T | undefined;
    let streamError: string | undefined;

    const handleBlock = (block: string) => {
      const parsed = parseSseBlock(block);
      if (!parsed) return;
      const { event, data } = parsed;
      if (event === "delta") handlers.onDelta?.(typeof data === "string" ? data : JSON.stringify(data, null, 2));
      else if (event === "status") handlers.onStatus?.(typeof data === "string" ? data : String(data));
      else if (event === "trace" && data && typeof data === "object") handlers.onTrace?.(data as AiTraceEvent);
      else if (event === "checkpoint" && data && typeof data === "object") handlers.onCheckpoint?.(data as AiCheckpointEvent);
      else if (event === "final") {
        finalPayload = data as T;
        handlers.onFinal?.(data);
      } else if (event === "error") {
        const message = data && typeof data === "object" && "message" in data ? String((data as { message?: unknown }).message ?? "") : String(data);
        streamError = redactError(message || "streaming model call failed");
        handlers.onError?.(streamError);
      }
    };

    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex >= 0) {
        const block = buffer.slice(0, splitIndex).trimEnd();
        buffer = buffer.slice(splitIndex + 2);
        if (block) handleBlock(block);
        splitIndex = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) handleBlock(buffer.trim());
    if (streamError) throw new Error(streamError);
    if (!finalPayload) throw new Error(`${path} finished without a final structured payload.`);
    return finalPayload;
  } catch (error) {
    if (handlers.signal?.aborted) throw new Error("解析已停止等待，成功断点保留。");
    let reportedError = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      reportedError = new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    reportFrontendError("editor.novel-import-api", reportedError, { path, transport: "stream", timeoutMs });
    throw reportedError;
  } finally {
    window.clearTimeout(timeout);
    handlers.signal?.removeEventListener("abort", abort);
  }
}

function payloadMessage(payload: unknown, fallback = ""): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const candidate = payload as { message?: unknown; status?: unknown; delta?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
    if (typeof candidate.status === "string") return candidate.status;
    if (typeof candidate.delta === "string") return candidate.delta;
  }
  return fallback || JSON.stringify(payload ?? "");
}

function parseWsEvent(raw: MessageEvent<string>): NovelWsEvent | undefined {
  try {
    return JSON.parse(raw.data) as NovelWsEvent;
  } catch (error) {
    reportFrontendError("editor.novel-import-api", error, {
      operation: "parse-event",
      transport: "websocket",
    });
    return undefined;
  }
}

interface NovelStopIdentity { baseUrl: string; jobId: string; requestId: string; lastSeq: number }
const unresolvedNovelStops = new Map<string, NovelStopIdentity>();
const pendingNovelCancellations = new Map<string, Promise<boolean>>();
const stopUnknown = "本地已暂停，但尚未确认原任务结束。再次点击继续只会查询原任务，不会重新提交。";
const terminalNovelJobStatuses = new Set(["completed", "failed", "cancelled"]);
export class NovelStopUnconfirmedError extends Error {
  constructor(message = stopUnknown) { super(message); this.name = "NovelStopUnconfirmedError"; }
}

type NovelAdaptationJournal = Omit<NovelStopIdentity, "lastSeq"> & { fingerprint: string };
const adaptationJournalKey = (scope: string) => `${scope}:adaptation`;
const readAdaptationJournal = (key: string): NovelAdaptationJournal | undefined => {
  const saved = window.localStorage.getItem(key);
  if (saved === null) return;
  const value = JSON.parse(saved);
  if (!value || typeof value.baseUrl !== "string" || typeof value.jobId !== "string"
    || typeof value.requestId !== "string" || typeof value.fingerprint !== "string") throw new Error("Invalid adaptation journal");
  return value;
};

function clearAdaptationJournal(key: string, matches: (record: NovelAdaptationJournal) => boolean): void {
  try {
    const record = readAdaptationJournal(key);
    if (record && matches(record)) window.localStorage.removeItem(key);
  } catch (error) {
    reportFrontendError("editor.novel-import-api", error, { operation: "clear-adaptation-receipt" });
  }
}

export function acknowledgeNovelAdaptationReceipt(owner: { projectId: string; sessionId: string }, fingerprint: string): void {
  clearAdaptationJournal(adaptationJournalKey(novelStopScope(owner)), record => record.fingerprint === fingerprint);
}

function knownNovelStop(scope: string): NovelStopIdentity | undefined {
  const current = unresolvedNovelStops.get(scope);
  if (current) return current;
  try {
    const record = JSON.parse(window.sessionStorage.getItem(scope) ?? "null");
    if (record?.baseUrl === getNovelWebsocketBaseUrl() && typeof record.jobId === "string"
      && typeof record.requestId === "string" && Number.isSafeInteger(record.lastSeq)) return record;
  } catch { /* in-memory protection is still available */ }
  return undefined;
}

function novelStopScope(owner: { projectId: string; sessionId: string }): string {
  return `agentvn:novel-stop:${JSON.stringify([owner.projectId, owner.sessionId])}`;
}

export function confirmPriorNovelStop(owner: { projectId: string; sessionId: string }): Promise<boolean> | undefined {
  const scope = novelStopScope(owner);
  const unresolved = knownNovelStop(scope);
  return unresolved ? cancelSubmittedNovelJob(scope, unresolved, false) : undefined;
}

function cancelSubmittedNovelJob(scope: string, identity: NovelStopIdentity, requestStop = true): Promise<boolean> {
  const active = pendingNovelCancellations.get(scope);
  if (active) return active;
  const { baseUrl, jobId, requestId, lastSeq } = identity;
  unresolvedNovelStops.set(scope, identity);
  try { window.sessionStorage.setItem(scope, JSON.stringify(identity)); } catch { /* retain memory copy */ }
  const confirmation = new Promise<boolean>((resolve) => {
    // This connection can only send a cancellation for the original job. It
    // cannot submit another model request or fall back to SSE.
    const connection = new WebSocket(`${baseUrl}/api/ws/novel`);
    const timer = window.setTimeout(() => finish(false), 3000);
    let done = false;
    let replayed = false;
    function finish(terminal: boolean) {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (connection.readyState <= WebSocket.OPEN) connection.close();
      resolve(terminal);
    }
    const subscribe = () => connection.send(JSON.stringify({ command: "subscribe_job", jobId, requestId, lastSeq }));
    connection.onopen = () => {
      try {
        if (requestStop) connection.send(JSON.stringify({ command: "cancel_job", jobId, requestId }));
        else subscribe();
      }
      catch { finish(false); }
    };
    connection.onmessage = message => {
      const event = parseWsEvent(message);
      if (!event || event.jobId !== jobId || event.requestId !== requestId) return;
      const status = (event.payload as { status?: string; accepted?: unknown } | undefined)?.status;
      if (event.type === "cancel_ack") {
        if (status === "cancelled" || status === "failed") {
          clearAdaptationJournal(adaptationJournalKey(scope), record => record.jobId === jobId && record.requestId === requestId);
        }
        if (status && terminalNovelJobStatuses.has(status)) { finish(true); return; }
        try { subscribe(); }
        catch { finish(false); }
      } else if (event.type === "snapshot_required" && !replayed) {
        replayed = true;
        try { connection.send(JSON.stringify({ command: "subscribe_job", jobId, requestId, lastSeq: 0 })); }
        catch { finish(false); }
      } else if ((event.type === "lifecycle" || event.type === "agent_completed") && status && terminalNovelJobStatuses.has(status)) {
        if (status === "cancelled" || status === "failed") {
          clearAdaptationJournal(adaptationJournalKey(scope), record => record.jobId === jobId && record.requestId === requestId);
        }
        finish(true);
      }
    };
    connection.onerror = () => finish(false);
    connection.onclose = () => finish(false);
  }).catch(() => false).then(terminal => {
    pendingNovelCancellations.delete(scope);
    if (terminal) {
      unresolvedNovelStops.delete(scope);
      try { window.sessionStorage.removeItem(scope); } catch { /* storage is optional */ }
    } else reportFrontendError("editor.novel-import-api", new Error(stopUnknown), { operation: "cancel-original-job", jobId });
    return terminal;
  });
  pendingNovelCancellations.set(scope, confirmation);
  return confirmation;
}

async function postWs<T>(
  scope: string,
  operation: NovelWsOperation,
  payload: unknown,
  handlers: NovelAiStreamHandlers = {},
  baseUrl = getNovelWebsocketBaseUrl(),
  timeoutMs = novelAiRequestTimeoutMs(payload),
): Promise<T> {
  const journalKey = handlers.adaptationFingerprint ? adaptationJournalKey(scope) : undefined;
  let journal: NovelAdaptationJournal | undefined;
  if (journalKey) {
    try { journal = readAdaptationJournal(journalKey); }
    catch { throw new NovelStopUnconfirmedError("无法读取原场景任务回执，未重新提交；请检查本机存储后再继续。"); }
    if (journal && (journal.baseUrl !== baseUrl || journal.fingerprint !== handlers.adaptationFingerprint)) {
      throw new NovelStopUnconfirmedError("原场景任务尚未确认，且工作内容、模型或后端已变化。恢复原配置后可查询原任务；未重新提交。");
    }
  }
  const jobId = journal?.jobId ?? `novel_job_${nanoid(10)}`;
  const requestId = journal?.requestId ?? `novel_ws_${nanoid(10)}`;
  let lastSeq = 0;
  let settled = false;
  let socket: WebSocket | undefined;
  let heartbeat: number | undefined;
  let idleTimer: number | undefined;
  let reconnectTimer: number | undefined;
  let reconnects = 0;
  let replayedSnapshot = false;
  let legacySnapshotSeq = 0;
  // A lost first acknowledgement does not mean the start command was lost.
  // Once submission is attempted, only resubscribe to this job, never POST SSE.
  let startSubmitted = Boolean(journal);

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      settled = true;
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      handlers.signal?.removeEventListener("abort", abort);
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };

    const fail = (message: string, allowSseFallback = !startSubmitted, uncertain = Boolean(journalKey && startSubmitted)) => {
      if (settled) return;
      cleanup();
      const error = uncertain
        ? new NovelStopUnconfirmedError(`${redactError(message)} 原场景任务尚未确认，继续只会查询原任务。`)
        : new Error(redactError(message));
      if (!allowSseFallback) (error as Error & { skipSseFallback?: boolean }).skipSseFallback = true;
      reject(error);
    };
    const abort = () => {
      if (startSubmitted) void cancelSubmittedNovelJob(scope, { baseUrl, jobId, requestId, lastSeq });
      fail("解析已停止等待，成功断点保留。", false, false);
    };
    handlers.signal?.addEventListener("abort", abort, { once: true });
    if (handlers.signal?.aborted) { abort(); return; }

    const armIdleTimer = () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (settled) return;
        fail(`WebSocket stream idle for ${Math.round(timeoutMs / 1000)} seconds without model output, checkpoint, final response, or error.`, false);
      }, timeoutMs);
    };

    const markProgress = () => {
      reconnects = 0;
      armIdleTimer();
    };

    const connect = (resume: boolean) => {
      if (settled) return;
      reconnectTimer = undefined;
      armIdleTimer();
      let connection: WebSocket;
      try {
        connection = new WebSocket(`${baseUrl}/api/ws/novel`);
      } catch {
        fail("WebSocket connection could not be created.");
        return;
      }
      socket = connection;
      connection.onopen = () => {
        if (settled || socket !== connection) return;
        if (heartbeat !== undefined) window.clearInterval(heartbeat);
        heartbeat = window.setInterval(() => {
          if (!settled && socket === connection && connection.readyState === WebSocket.OPEN) {
            connection.send(JSON.stringify({ command: "ping", requestId, jobId, seq: lastSeq }));
          }
        }, 15_000);
        const command = resume
          ? { command: "subscribe_job", requestId, jobId, lastSeq }
          : { command: "start_novel_job", requestId, jobId, operation, payload: normalizePayload(payload), lastSeq };
        const encoded = JSON.stringify(command);
        if (!resume) {
          if (journalKey && handlers.adaptationFingerprint) {
            try {
              window.localStorage.setItem(journalKey, JSON.stringify({ baseUrl, jobId, requestId,
                fingerprint: handlers.adaptationFingerprint } satisfies NovelAdaptationJournal));
            } catch {
              fail("本机无法保存场景任务回执。未提交改编，请检查存储后再继续。", false, true);
              return;
            }
          }
          startSubmitted = true;
        }
        try {
          connection.send(encoded);
        } catch {
          fail("WebSocket command could not be sent; the task was not resubmitted.", false);
        }
      };
      connection.onerror = () => {
        if (settled || socket !== connection) return;
        if (!startSubmitted) fail("WebSocket connection failed before the stream started.");
      };
      connection.onclose = () => {
        if (settled || socket !== connection) return;
        if (heartbeat !== undefined) window.clearInterval(heartbeat);
        heartbeat = undefined;
        if (startSubmitted) reconnect();
        else fail("WebSocket connection closed before the start command was submitted.");
      };
      connection.onmessage = (message) => {
        if (settled || socket !== connection) return;
        const event = parseWsEvent(message);
        if (!event) return;
        if (event.type === "connected" || event.type === "pong") return;
        if (journalKey && (event.jobId !== jobId || event.requestId !== requestId)) {
          // Older backends use the connection ID for a missing job response.
          if (resume && event.type === "error" && event.jobId === jobId && /job not found/i.test(payloadMessage(event.payload))) {
            fail("后端找不到原场景任务；已保留本机断点，未重新提交。", false);
          }
          return;
        }
        const seq = Number(event.seq ?? 0);
        if (event.type === "snapshot_required") {
          if (seq > 0 && seq === legacySnapshotSeq) return; // older hubs buffered this control frame
          if (journalKey && !replayedSnapshot) {
            replayedSnapshot = true;
            legacySnapshotSeq = seq;
            lastSeq = 0;
            try { connection.send(JSON.stringify({ command: "subscribe_job", jobId, requestId, lastSeq })); }
            catch { fail("原场景任务的缓存无法接续。", false); }
          } else fail("WebSocket resume buffer expired; no new request was submitted.", false);
          return;
        }
        if (seq > 0) {
          if (seq <= lastSeq) return;
          lastSeq = seq;
          if (socket?.readyState === WebSocket.OPEN && seq % 8 === 0) {
            socket.send(JSON.stringify({ command: "ack", jobId, requestId, seq }));
          }
        }
        if (progressWsEventTypes.has(event.type)) markProgress();
        if (event.type === "message_delta" || event.type === "agent_delta") {
          handlers.onDelta?.(payloadMessage(event.payload));
          return;
        }
        if (event.type === "lifecycle" || event.type === "agent_started" || event.type === "agent_completed") {
          const status = (event.payload as { status?: string } | undefined)?.status;
          if (journalKey && seq > 0 && (status === "cancelled" || (status === "failed" && event.type === "agent_completed"))) {
            clearAdaptationJournal(journalKey, record => record.jobId === jobId);
            fail(status === "cancelled" ? "原场景任务已取消，已保留断点。" : payloadMessage(event.payload, "原场景任务已明确失败。"), false, false);
            return;
          }
          if (journalKey && seq > 0 && event.type === "agent_completed" && status === "completed") {
            fail("原场景任务已结束，但没有收到可保存的完整结果。", false);
            return;
          }
          handlers.onStatus?.(payloadMessage(event.payload, event.type));
          if (event.type !== "lifecycle") {
            handlers.onTrace?.({
              id: `${event.jobId ?? jobId}-${event.seq ?? 0}`,
              time: event.timestamp ?? undefined,
              phase: event.phase,
              level: event.type === "agent_completed" ? "success" : "info",
              title: event.agentId ?? event.type,
              message: payloadMessage(event.payload, event.type),
              details: event.payload,
            });
          }
          return;
        }
        if (event.type === "tool_event" && event.payload && typeof event.payload === "object") {
          handlers.onTrace?.(event.payload as AiTraceEvent);
          return;
        }
        if (event.type === "metric") {
          handlers.onTrace?.({
            id: `${event.jobId ?? jobId}-metric-${event.seq ?? 0}`,
            time: event.timestamp ?? undefined,
            phase: event.phase,
            level: "info",
            title: "stream metric",
            message: payloadMessage(event.payload, "metric"),
            details: event.payload,
          });
          return;
        }
        if (event.type === "checkpoint" && event.payload && typeof event.payload === "object") {
          handlers.onCheckpoint?.(event.payload as AiCheckpointEvent);
          return;
        }
        if (event.type === "final") {
          cleanup();
          handlers.onFinal?.(event.payload);
          resolve(event.payload as T);
          return;
        }
        if (event.type === "error") {
          const messageText = payloadMessage(event.payload, "streaming model call failed");
          if (resume && /job not found/i.test(messageText)) {
            const reason = "后端任务已失去连接记录。已保存断点保留，请点击继续解析；未自动重新提交模型请求。";
            handlers.onError?.(reason);
            fail(reason, false);
            return;
          }
          handlers.onError?.(messageText);
          // Socket-level errors are not evidence that the original work ended.
          const terminal = !journalKey || seq > 0;
          if (journalKey && terminal) clearAdaptationJournal(journalKey, record => record.jobId === jobId);
          fail(messageText, false, !terminal);
        }
      };
    };

    const reconnect = () => {
      if (settled || reconnectTimer !== undefined) return;
      reconnects += 1;
      if (reconnects > 3) {
        fail("WebSocket stream disconnected and could not resume.", false);
        return;
      }
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => connect(true), Math.min(1000 * reconnects, 3000));
    };

    connect(Boolean(journal));
  });
}

async function postRealtime<T>(
  operation: NovelWsOperation,
  ssePath: string,
  payload: unknown,
  handlers?: NovelAiStreamHandlers,
): Promise<T> {
  // Runtime import avoids the client/store initialization cycle. The backend
  // owns one retry budget; reconnecting never creates a second retry loop.
  const { useNovelImportStore, captureNovelTaskOwnership, isNovelTaskOwnershipCurrent } = await import("../store/novelImportStore");
  payload = { ...(payload as Record<string, unknown>),
    max_retries: useNovelImportStore.getState().processing.config.maxRetryCount };
  const controller = new AbortController();
  const owner = captureNovelTaskOwnership(`transport:${operation}`);
  const stopScope = novelStopScope(owner);
  const ownershipTimer = window.setInterval(() => {
    if (!isNovelTaskOwnershipCurrent(owner)) controller.abort();
  }, 200);
  activeNovelRequests.add(controller);
  handlers = { ...handlers, signal: controller.signal };
  try {
    const confirmation = confirmPriorNovelStop(owner);
    if (confirmation && !await confirmation) throw new NovelStopUnconfirmedError();
    if (controller.signal.aborted || !isNovelTaskOwnershipCurrent(owner)) {
      throw new Error("解析已停止等待，成功断点保留。");
    }
    try {
      const stream = () => postWs<T>(stopScope, operation, payload, handlers);
      const locks = globalThis.navigator?.locks;
      if (handlers.adaptationFingerprint && locks) {
        return await locks.request(adaptationJournalKey(stopScope), { ifAvailable: true }, lock => {
          if (!lock) throw new NovelStopUnconfirmedError("另一个窗口正在查询或处理此场景。未重复提交。");
          return stream();
        });
      }
      return await stream();
    } catch (error) {
      if (error instanceof NovelStopUnconfirmedError
        || (error instanceof Error && (error as Error & { skipSseFallback?: boolean }).skipSseFallback)) {
        reportFrontendError("editor.novel-import-api", error, { operation, transport: "websocket" });
        throw error;
      }
      reportFrontendError("editor.novel-import-api", error, {
        operation,
        transport: "websocket-fallback",
      });
      handlers?.onTrace?.({
        phase: "websocket",
        level: "warning",
        title: "WebSocket fallback",
        message: error instanceof Error ? error.message : String(error),
      });
      if (controller.signal.aborted) throw error;
      return await postSse<T>(ssePath, payload, handlers);
    }
  } finally { window.clearInterval(ownershipTimer); activeNovelRequests.delete(controller); }
}

export async function verifyNovelAiRoutes(baseUrl = getNovelBackendBaseUrl()): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/openapi.json`, { signal: controller.signal });
    if (!response.ok) throw new Error(`/openapi.json returned HTTP ${response.status}`);
    const openapi = (await response.json()) as { paths?: Record<string, unknown> };
    const paths = openapi.paths ?? {};
    const missing = novelAiRoutes.filter((path) => !(path in paths));
    if (missing.length > 0) throw new Error(`Backend is missing novel AI routes: ${missing.join(", ")}`);
  } catch (error) {
    reportFrontendError("editor.novel-import-api", error, { path: "/openapi.json", operation: "verify-routes" });
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function adaptSceneMock(request: AdaptSceneRequest, document: SourceDocument): Promise<AdaptSceneResponse> {
  const candidate = request.scene_candidate;
  const lines = candidate.source_excerpt.split(/\n+/).filter(Boolean).slice(0, 12);
  const commands = lines.map((line) => {
    const dialogue = line.match(/[“「『"'](.+?)[”」』"']/);
    if (dialogue) {
      const speaker = candidate.characters[0] ?? "unknown_speaker";
      return { type: "dialog" as const, character_id: speaker, text: dialogue[1], emotion: "neutral", portrait: null, voice: null, side: "left" as const };
    }
    return { type: "narration" as const, text: line.slice(0, 180) };
  });
  const scene = {
    scene_id: `scene_${nanoid(8)}`,
    scene_display_name: candidate.display_name || candidate.title || `Scene ${candidate.index + 1}`,
    title: candidate.title,
    summary: candidate.summary,
    commands: [
      { type: "background" as const, background_id: candidate.location_hint ? `bg_${candidate.location_hint}` : "bg_unknown", background_fit: "stretch" as const, transition: "fade", transition_display_name: "淡入过场" },
      ...commands,
    ],
    tags: ["novel_import"],
    chapter: 1,
  };
  const adapted = {
    adapted_scene_id: `adapted_${nanoid(8)}`,
    source_scene_candidate_id: candidate.scene_candidate_id,
    scene_beat: scene,
    source_mapping: createSourceMapping(document, candidate.start_offset, candidate.end_offset, scene),
    warnings: candidate.characters.length === 0 ? ["No clear character was detected; please review manually."] : [],
    needs_review: candidate.characters.length === 0,
  };
  return { adapted_scene: adapted, character_updates: [], asset_suggestions: [], branch_suggestions: [], conflict_points: [], warnings: adapted.warnings };
}

export interface AiScanChunkRequest {
  document_id: string;
  chunk_id: string;
  index: number;
  text: string;
  start_offset: number;
  end_offset: number;
  previous_summary?: string;
  partial_summary?: NovelAiChunkSummary;
  partial_entities?: NovelAiChunkEntityIndex;
  partial_timeline?: NovelAiChunkTimelineNotes;
  provider_selection?: ProviderSelectionPayload;
}

export interface AiPlanChapterRequest {
  document_id: string;
  chapter: ChapterCandidate;
  outline_summary: string;
  known_characters: CharacterCandidate[];
  text: string;
  suggested_scene_count?: number;
  min_scene_count?: number;
  min_branch_suggestion_count?: number;
  allow_branch_suggestions?: boolean;
  partial_batches?: import("./types").NovelAiSceneBatchCheckpoint[];
  provider_selection?: ProviderSelectionPayload;
}

export interface AiScenePlanResponse {
  chapter_id: string;
  scenes: SceneCandidate[];
  conflict_points: ConflictPoint[];
  branch_suggestions: BranchSuggestion[];
  warnings: string[];
  needs_review: boolean;
}

export async function aiScanNovelChunkStream(request: AiScanChunkRequest, handlers?: NovelAiStreamHandlers): Promise<NovelAiChunkAnalysis> {
  return postRealtime<NovelAiChunkAnalysis>("scan_chunk", "/api/novel/import/ai_scan_chunk_stream", request, handlers);
}

export async function aiBuildNovelOutlineStream(payload: {
  document_id: string;
  title: string;
  total_chars: number;
  analyses: NovelAiChunkAnalysis[];
  allow_branch_suggestions?: boolean;
  partial_mainline?: NovelAiOutlineMainline;
  partial_structure?: NovelAiOutlineStructure;
  partial_index?: NovelAiOutlineIndex;
  partial_batches?: NovelAiOutlineBatchCheckpoint[];
  partial_source_hash?: string;
  provider_selection?: ProviderSelectionPayload;
}, handlers?: NovelAiStreamHandlers): Promise<NovelAiOutline> {
  // modelName is local provenance, not part of the strict model-output schema.
  const analyses = payload.analyses.map(({ modelName: _modelName, ...analysis }) => analysis);
  return postRealtime<NovelAiOutline>("build_outline", "/api/novel/import/ai_build_outline_stream",
    { ...payload, analyses }, handlers);
}

export async function aiPlanNovelChapter(request: AiPlanChapterRequest): Promise<AiScenePlanResponse> {
  return postJson<AiScenePlanResponse>("/api/novel/import/ai_plan_chapter", request);
}

export async function aiPlanNovelChapterStream(request: AiPlanChapterRequest, handlers?: NovelAiStreamHandlers): Promise<AiScenePlanResponse> {
  return postRealtime<AiScenePlanResponse>("plan_chapter", "/api/novel/import/ai_plan_chapter_stream", request, handlers);
}

export async function aiAdaptNovelScene(request: AdaptSceneRequest & { outline_summary?: string; provider_selection?: ProviderSelectionPayload }): Promise<AdaptSceneResponse> {
  return postJson<AdaptSceneResponse>("/api/novel/import/ai_adapt_scene", request);
}

export async function aiAdaptNovelSceneStream(request: AdaptSceneRequest & { outline_summary?: string; provider_selection?: ProviderSelectionPayload }, handlers?: NovelAiStreamHandlers): Promise<AdaptSceneResponse> {
  return postRealtime<AdaptSceneResponse>("adapt_scene", "/api/novel/import/ai_adapt_scene_stream", request, handlers);
}
