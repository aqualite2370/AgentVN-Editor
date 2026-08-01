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
  NovelAiOutlineIndex,
  NovelAiOutlineMainline,
  NovelAiOutlineStructure,
  SceneCandidate,
  SourceDocument,
} from "./types";
import type { ProviderSelectionPayload } from "../providers/types";
import { createSourceMapping } from "./sourceMapping";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

const backendBaseUrl = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://127.0.0.1:8278";
const websocketBaseUrl = backendBaseUrl.replace(/^http/i, "ws");
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
}

export interface NovelAiStreamHandlers {
  onDelta?: (delta: string) => void;
  onStatus?: (status: string) => void;
  onTrace?: (trace: AiTraceEvent) => void;
  onCheckpoint?: (checkpoint: AiCheckpointEvent) => void;
  onFinal?: (payload: unknown) => void;
  onError?: (message: string) => void;
}

type NovelWsOperation = "scan_chunk" | "build_outline" | "plan_chapter" | "adapt_scene";

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

async function postJson<T>(path: string, payload: unknown, baseUrl = backendBaseUrl, timeoutMs = novelAiRequestTimeoutMs(payload)): Promise<T> {
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
  baseUrl = backendBaseUrl,
  timeoutMs = novelAiRequestTimeoutMs(payload),
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
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
    let reportedError = error;
    if (error instanceof DOMException && error.name === "AbortError") {
      reportedError = new Error(`${path} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    reportFrontendError("editor.novel-import-api", reportedError, { path, transport: "stream", timeoutMs });
    throw reportedError;
  } finally {
    window.clearTimeout(timeout);
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

async function postWs<T>(
  operation: NovelWsOperation,
  payload: unknown,
  handlers: NovelAiStreamHandlers = {},
  baseUrl = websocketBaseUrl,
  timeoutMs = novelAiRequestTimeoutMs(payload),
): Promise<T> {
  const jobId = `novel_job_${nanoid(10)}`;
  const requestId = `novel_ws_${nanoid(10)}`;
  let lastSeq = 0;
  let settled = false;
  let socket: WebSocket | undefined;
  let heartbeat: number | undefined;
  let idleTimer: number | undefined;
  let reconnects = 0;
  let jobRestarts = 0;
  let streamStarted = false;

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      settled = true;
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };

    const fail = (message: string, allowSseFallback = !streamStarted) => {
      if (settled) return;
      cleanup();
      const error = new Error(redactError(message));
      if (!allowSseFallback) (error as Error & { skipSseFallback?: boolean }).skipSseFallback = true;
      reject(error);
    };

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
      armIdleTimer();
      socket = new WebSocket(`${baseUrl}/api/ws/novel`);
      socket.onopen = () => {
        if (heartbeat !== undefined) window.clearInterval(heartbeat);
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ command: "ping", requestId, jobId, seq: lastSeq }));
          }
        }, 15_000);
        const command = resume
          ? { command: "subscribe_job", requestId, jobId, lastSeq }
          : { command: "start_novel_job", requestId, jobId, operation, payload: normalizePayload(payload), lastSeq };
        socket?.send(JSON.stringify(command));
      };
      socket.onerror = () => {
        if (!resume && lastSeq === 0) fail("WebSocket connection failed before the stream started.");
      };
      socket.onclose = () => {
        if (!settled && lastSeq > 0) reconnect();
      };
      socket.onmessage = (message) => {
        const event = parseWsEvent(message);
        if (!event) return;
        if (event.type === "connected" || event.type === "pong") return;
        const seq = Number(event.seq ?? 0);
        if (seq > 0) {
          if (seq <= lastSeq && event.type !== "snapshot_required") return;
          lastSeq = seq;
          if (socket?.readyState === WebSocket.OPEN && seq % 8 === 0) {
            socket.send(JSON.stringify({ command: "ack", jobId, requestId, seq }));
          }
        }
        if (seq > 0) streamStarted = true;
        if (progressWsEventTypes.has(event.type)) markProgress();
        if (event.type === "message_delta" || event.type === "agent_delta") {
          handlers.onDelta?.(payloadMessage(event.payload));
          return;
        }
        if (event.type === "lifecycle" || event.type === "agent_started" || event.type === "agent_completed") {
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
        if (event.type === "snapshot_required") {
          fail("WebSocket resume buffer expired; restart this novel AI step.", false);
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
          if (resume && /job not found/i.test(messageText) && jobRestarts < 2 && socket?.readyState === WebSocket.OPEN) {
            jobRestarts += 1;
            lastSeq = 0;
            streamStarted = false;
            handlers.onTrace?.({
              id: `${jobId}-restart-${jobRestarts}`,
              phase: "websocket",
              level: "warning",
              title: "Restarting interrupted novel AI job",
              message: "The backend restarted and lost the in-memory job. The same real model request is being started again.",
              details: { operation, attempt: jobRestarts, maximumAttempts: 2 },
            });
            handlers.onStatus?.("Restarting the interrupted novel AI job with the same model request...");
            markProgress();
            socket.send(JSON.stringify({
              command: "start_novel_job",
              requestId,
              jobId,
              operation,
              payload: normalizePayload(payload),
              lastSeq: 0,
            }));
            return;
          }
          handlers.onError?.(messageText);
          fail(messageText, false);
        }
      };
    };

    const reconnect = () => {
      if (settled) return;
      reconnects += 1;
      if (reconnects > 3) {
        fail("WebSocket stream disconnected and could not resume.", false);
        return;
      }
      window.setTimeout(() => connect(true), Math.min(1000 * reconnects, 3000));
    };

    connect(false);
  });
}

async function postRealtime<T>(
  operation: NovelWsOperation,
  ssePath: string,
  payload: unknown,
  handlers?: NovelAiStreamHandlers,
): Promise<T> {
  try {
    return await postWs<T>(operation, payload, handlers);
  } catch (error) {
    if (error instanceof Error && (error as Error & { skipSseFallback?: boolean }).skipSseFallback) {
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
    return postSse<T>(ssePath, payload, handlers);
  }
}

export async function verifyNovelAiRoutes(baseUrl = backendBaseUrl): Promise<void> {
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
  provider_selection?: ProviderSelectionPayload;
}, handlers?: NovelAiStreamHandlers): Promise<NovelAiOutline> {
  return postRealtime<NovelAiOutline>("build_outline", "/api/novel/import/ai_build_outline_stream", payload, handlers);
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
