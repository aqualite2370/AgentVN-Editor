import type {
  ApplyMemoryUpdateResponse,
  EpisodicMemory,
  ExtractMemoryRequest,
  GenerateSceneRequest,
  GenerationTraceEvent,
  HealthResponse,
  MemoryModeResponse,
  MemoryUpdate,
  RelationEdge,
  TestProviderConnectionRequest,
  TestProviderConnectionResponse,
  TestProviderGenerationRequest,
  TestProviderGenerationResponse,
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantCitationResponse,
  ProjectSummary,
  SharedEditorState,
  SharedEditorStateUpdate,
} from "./types";
import type { MemoryMode } from "../types/memory";
import type { SceneBeat } from "../types/scene";
import type { NovelProcessEvent, NovelProcessJob } from "../novel-import/processJobTypes";
import type { ProviderSelectionPayload } from "../providers/types";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";

const defaultModelRequestTimeoutSeconds = 300;
const modelRequestTimeoutBufferSeconds = 30;
const minModelRequestTimeoutSeconds = 30;
const maxModelRequestTimeoutSeconds = 900;

export const PROVIDER_API_ROUTES = {
  testConnection: "/api/providers/test_connection",
  testConnectionAlias: "/api/providers/test-connection",
  testGeneration: "/api/providers/test_generation",
} as const;

export interface BackendClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class BackendClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(options: BackendClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8278";
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/api/health");
  }

  async generateScene(payload: GenerateSceneRequest): Promise<SceneBeat> {
    return this.request<SceneBeat>("/api/generate_scene", {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: modelRequestTimeoutMs(payload.provider_selection) });
  }

  async generateSceneStream(payload: GenerateSceneRequest, handlers: StreamHandlers<SceneBeat>): Promise<SceneBeat> {
    return this.streamRequest<SceneBeat>("/api/generate_scene_stream", stripBackendIncompatibleProviderFields(payload), handlers, modelRequestTimeoutMs(payload.provider_selection));
  }

  async extractMemory(payload: ExtractMemoryRequest): Promise<MemoryUpdate> {
    return this.request<MemoryUpdate>("/api/extract_memory", {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: modelRequestTimeoutMs(payload.provider_selection) });
  }

  async extractMemoryStream(payload: ExtractMemoryRequest, handlers: StreamHandlers<MemoryUpdate>): Promise<MemoryUpdate> {
    return this.streamRequest<MemoryUpdate>("/api/extract_memory_stream", stripBackendIncompatibleProviderFields(payload), handlers, modelRequestTimeoutMs(payload.provider_selection));
  }

  async applyMemoryUpdate(update: MemoryUpdate, chapter: number): Promise<ApplyMemoryUpdateResponse> {
    return this.request<ApplyMemoryUpdateResponse>(`/api/memory/apply_update?chapter=${chapter}`, {
      method: "POST",
      body: JSON.stringify(update),
    });
  }

  async getRelations(source?: string, target?: string): Promise<RelationEdge[]> {
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (target) params.set("target", target);
    const suffix = params.toString() ? `?${params}` : "";
    return this.request<RelationEdge[]>(`/api/relations${suffix}`);
  }

  async getMemories(characterId?: string): Promise<EpisodicMemory[]> {
    const suffix = characterId ? `?character_id=${encodeURIComponent(characterId)}` : "";
    return this.request<EpisodicMemory[]>(`/api/memories${suffix}`);
  }

  async getMemoryMode(): Promise<MemoryMode> {
    const response = await this.request<MemoryModeResponse>("/api/memory/mode");
    return response.memory_mode;
  }

  async setMemoryMode(memoryMode: MemoryMode): Promise<MemoryMode> {
    const response = await this.request<MemoryModeResponse>("/api/memory/mode", {
      method: "POST",
      body: JSON.stringify({ memory_mode: memoryMode }),
    });
    return response.memory_mode;
  }

  async saveProjectState(data: SharedEditorStateUpdate | Record<string, unknown>): Promise<SharedEditorState> {
    const response = await this.request<{ ok: boolean; data: SharedEditorState }>("/api/project/state", {
      method: "POST",
      body: JSON.stringify(data),
    }, { timeoutMs: 180000 });
    return response.data;
  }

  async loadProjectState(options: { includeProject?: boolean; includeRecentProjects?: boolean } = {}): Promise<SharedEditorState | null> {
    const params = new URLSearchParams();
    if (options.includeProject === false) params.set("include_project", "false");
    if (options.includeRecentProjects === false) params.set("include_recent_projects", "false");
    const suffix = params.toString() ? `?${params}` : "";
    const response = await this.request<{ ok: boolean; data: SharedEditorState | null }>(`/api/project/state${suffix}`);
    return response.data;
  }

  async loadProjectCatalog(): Promise<ProjectSummary[]> {
    const response = await this.request<{ ok: boolean; data: ProjectSummary[] }>("/api/project/catalog");
    return response.data;
  }

  async loadProject(projectId: string): Promise<import("../types/nodes").EditorProjectFile> {
    const response = await this.request<{ ok: boolean; data: import("../types/nodes").EditorProjectFile }>(`/api/project/projects/${encodeURIComponent(projectId)}`);
    return response.data;
  }

  async saveProject(project: import("../types/nodes").EditorProjectFile): Promise<import("../types/nodes").EditorProjectFile> {
    const response = await this.request<{ ok: boolean; data: import("../types/nodes").EditorProjectFile }>(`/api/project/projects/${encodeURIComponent(project.project_id)}`, {
      method: "PUT",
      body: JSON.stringify(project),
    }, { timeoutMs: 180000 });
    return response.data;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const response = await this.request<{ ok: boolean; deleted: boolean }>(`/api/project/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    return response.deleted;
  }

  async testProviderConnection(payload: TestProviderConnectionRequest): Promise<TestProviderConnectionResponse> {
    return this.request<TestProviderConnectionResponse>(PROVIDER_API_ROUTES.testConnection, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async testProviderGeneration(payload: TestProviderGenerationRequest): Promise<TestProviderGenerationResponse> {
    return this.request<TestProviderGenerationResponse>(PROVIDER_API_ROUTES.testGeneration, {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: modelRequestTimeoutMs(payload.provider_selection) });
  }

  async askAssistant(payload: AssistantChatRequest): Promise<AssistantChatResponse> {
    return this.request<AssistantChatResponse>("/api/assistant/chat", {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: modelRequestTimeoutMs(payload.provider_selection) });
  }

  async streamAssistant(payload: AssistantChatRequest, handlers: StreamHandlers<AssistantChatResponse>): Promise<AssistantChatResponse> {
    return this.streamRequest<AssistantChatResponse>(
      "/api/assistant/chat_stream",
      stripBackendIncompatibleProviderFields(payload),
      handlers,
      modelRequestTimeoutMs(payload.provider_selection)
    );
  }

  async getNovelProcessJob(jobId: string): Promise<NovelProcessJob> {
    return this.request<NovelProcessJob>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/panel`);
  }

  async createNovelProcessJob(payload: NovelProcessJobCreatePayload): Promise<NovelProcessJobApiResponse> {
    return this.request<NovelProcessJobApiResponse>("/api/novel/processing/execute/jobs", {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: 60000 });
  }

  async getNovelProcessJobResults(jobId: string): Promise<NovelProcessJobResultsResponse> {
    return this.request<NovelProcessJobResultsResponse>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/results`);
  }

  async polishNovelProcessLinks(payload: SceneLinkPolishPayload): Promise<SceneLinkPolishResponse> {
    return this.request<SceneLinkPolishResponse>("/api/novel/process/link_polish", {
      method: "POST",
      body: JSON.stringify(stripBackendIncompatibleProviderFields(payload)),
    }, { timeoutMs: modelRequestTimeoutMs(payload.providerSelection) });
  }

  async getJobEvents(jobId: string, limit = 50): Promise<NovelProcessEvent[]> {
    return this.request<NovelProcessEvent[]>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/events?limit=${limit}`);
  }

  async retryFailedChunks(jobId: string): Promise<NovelProcessJob> {
    return this.request<NovelProcessJob>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/retry_failed_chunks`, { method: "POST" });
  }

  async pauseNovelProcessJob(jobId: string): Promise<NovelProcessJob> {
    return this.request<NovelProcessJob>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/pause`, { method: "POST" });
  }

  async resumeNovelProcessJob(jobId: string): Promise<NovelProcessJob> {
    return this.request<NovelProcessJob>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/resume`, { method: "POST" });
  }

  async cancelNovelProcessJob(jobId: string): Promise<NovelProcessJob> {
    return this.request<NovelProcessJob>(`/api/novel/processing/execute/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  }

  private async request<T>(path: string, init: RequestInit = {}, options: { timeoutMs?: number } = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        const retryBody = legacyTimeoutCompatibleBody(init.body, text);
        if (retryBody) {
          response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            body: retryBody,
            headers: {
              "Content-Type": "application/json",
              ...(init.headers ?? {}),
            },
            signal: controller.signal,
          });
          if (response.ok) return (await response.json()) as T;
          const retryText = await response.text();
          const retryDetail = parseBackendErrorText(retryText) || response.statusText;
          throw new Error(`鍚庣璇锋眰澶辫触 ${response.status}锛?{retryDetail}`);
        }
        const detail = parseBackendErrorText(text) || response.statusText;
        throw new Error(`后端请求失败 ${response.status}：${detail}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      let reportedError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        reportedError = new Error(`后端请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，请稍后重试或检查模型服务是否响应过慢。`);
      }
      if (error instanceof TypeError && /failed to fetch/i.test(error.message)) {
        reportedError = new Error(`无法连接后端服务 ${this.baseUrl}。请先点击“检查后端”，确认后端正在运行、地址正确，且服务没有在 AI 调用时异常中断。`);
      }
      reportFrontendError("editor.backend-api", reportedError, {
        path,
        method: init.method ?? "GET",
        timeoutMs,
      });
      throw reportedError;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async streamRequest<T>(path: string, payload: unknown, handlers: StreamHandlers<T>, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    let finalValue: T | undefined;
    try {
      let response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        if (isLegacyTimeoutParameterError(text) && hasProviderRequestTimeout(payload)) {
          handlers.onStatus?.("当前后端尚未支持请求超时参数，已自动兼容重试；请重启 AgentVN 以启用长超时。");
          response = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(stripProviderRequestTimeout(payload)),
            signal: controller.signal,
          });
          if (!response.ok) {
            const retryText = await response.text();
            const retryDetail = parseBackendErrorText(retryText) || response.statusText;
            throw new Error(`后端请求失败 ${response.status}：${retryDetail}`);
          }
        } else {
          const detail = parseBackendErrorText(text) || response.statusText;
          throw new Error(`后端请求失败 ${response.status}：${detail}`);
        }
      }
      if (!response.body) throw new Error("后端没有返回可读取的流。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const event = parseSseEvent(part);
          if (!event) continue;
          if (event.event === "delta" && typeof event.data === "string") handlers.onDelta?.(event.data);
          if (event.event === "status" && typeof event.data === "string") handlers.onStatus?.(event.data);
          if (event.event === "citations" && Array.isArray(event.data)) handlers.onCitations?.(event.data);
          if (event.event === "trace" && isGenerationTraceEvent(event.data)) handlers.onTrace?.(event.data);
          if (event.event === "final") {
            finalValue = event.data as T;
            handlers.onFinal?.(finalValue);
          }
          if (event.event === "error") {
            const message = typeof event.data?.message === "string" ? event.data.message : "流式生成失败";
            throw new Error(message);
          }
        }
      }
      if (buffer.trim()) {
        const event = parseSseEvent(buffer);
        if (event?.event === "final") finalValue = event.data as T;
      }
      if (!finalValue) throw new Error("流式生成结束，但没有收到最终结构化结果。");
      return finalValue;
    } catch (error) {
      let reportedError = error;
      if (error instanceof DOMException && error.name === "AbortError") {
        reportedError = new Error(`后端请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，请稍后重试或检查模型服务是否响应过慢。`);
      }
      reportFrontendError("editor.backend-stream", reportedError, {
        path,
        method: "POST",
        timeoutMs,
      });
      throw reportedError;
    } finally {
      window.clearTimeout(timeout);
    }
  }
}

export interface StreamHandlers<T> {
  onDelta?: (delta: string) => void;
  onStatus?: (status: string) => void;
  onCitations?: (citations: AssistantCitationResponse[]) => void;
  onTrace?: (trace: GenerationTraceEvent) => void;
  onFinal?: (finalValue: T) => void;
}

function isGenerationTraceEvent(value: unknown): value is GenerationTraceEvent {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<GenerationTraceEvent>;
  return typeof payload.id === "string" &&
    typeof payload.time === "string" &&
    typeof payload.phase === "string" &&
    typeof payload.level === "string" &&
    typeof payload.title === "string" &&
    typeof payload.message === "string";
}

function parseBackendErrorText(text: string): string {
  if (!text) return "";
  const appendJsonHint = (message: string): string => {
    if (!/(not valid json|invalid json|expecting|jsondecodeerror|结构化 json|合法 json|json 格式|json格式)/i.test(message)) return message;
    if (/deepseek-v4-flash|关闭模型/.test(message)) return message;
    return `${message}\n建议：这是模型输出格式问题。可以关闭模型“思考模式”，或切换到 deepseek-v4-flash / JSON 兼容模式后重试，通常更省配额，也更容易解析。`;
  };
  try {
    const payload = JSON.parse(text) as { message?: unknown; detail?: unknown; code?: unknown };
    if (typeof payload.message === "string") return appendJsonHint(payload.message);
    if (typeof payload.detail === "string") return appendJsonHint(payload.detail);
    if (payload.detail) return appendJsonHint(JSON.stringify(payload.detail));
    if (typeof payload.code === "string") return appendJsonHint(payload.code);
  } catch {
    // error-log-ignore: 非 JSON 错误正文会原样返回，真正的请求失败由调用层统一记录。
    return appendJsonHint(text);
  }
  return appendJsonHint(text);
}

export interface NovelProcessChunkPayload {
  chunkId?: string;
  chapterTitle: string;
  chapterIndex: number;
  chunkIndex: number;
  chunkText: string;
  startOffset: number;
  endOffset: number;
  previousContextSummary?: string;
  nextContextHint?: string;
}

export interface NovelProcessJobCreatePayload {
  bookId: string;
  title: string;
  chunks: NovelProcessChunkPayload[];
  userInstruction: string;
  outputFormat: string;
  promptVersion: string;
  maxConcurrency: number;
  maxRetries: number;
  providerSelection?: ProviderSelectionPayload;
}

export interface NovelProcessJobApiResponse extends NovelProcessJobCreatePayload {
  jobId: string;
  status: string;
}

export interface NovelProcessChunkResult {
  resultId: string;
  chunkId: string;
  chapterTitle: string;
  chapterIndex: number;
  chunkIndex: number;
  status: "completed" | "failed" | "cancelled";
  resultText: string;
  summary: string;
  scenes?: SceneBeat[];
  sceneCount?: number;
  usedFallbackScene?: boolean;
  schemaRepairCount?: number;
  mergeStatus?: "pending" | "merged" | "discarded_cancelled" | "failed" | "cancelled";
  continuityNotes: string[];
  warnings: string[];
  qualityWarnings?: string[];
  qualityIssues?: Array<{
    code: string;
    severity: "info" | "warning" | "danger" | "blocked";
    message: string;
    evidence?: string;
    action?: string;
    sourceChunkId?: string | null;
  }>;
  errorMessage?: string;
  rawOutput: string;
  completedAt: string;
}

export interface NovelProcessJobResultsResponse {
  jobId: string;
  status: string;
  completedResults: NovelProcessChunkResult[];
  failedResults: NovelProcessChunkResult[];
  warnings: string[];
}

export interface SceneLinkPolishItemPayload {
  sourceScene: SceneBeat;
  targetScene: SceneBeat;
  choiceId: string;
  choiceText: string;
  choiceDisplayName?: string | null;
}

export interface SceneLinkPolishPayload {
  links: SceneLinkPolishItemPayload[];
  providerSelection?: ProviderSelectionPayload;
}

export interface SceneLinkPolishPatch {
  choiceId: string;
  choiceText: string;
  choiceDisplayName?: string | null;
  targetSceneId: string;
  targetTitle: string;
  targetSummary: string;
  openingText?: string | null;
  warnings: string[];
}

export interface SceneLinkPolishResponse {
  patches: SceneLinkPolishPatch[];
  warnings: string[];
}

function parseSseEvent(chunk: string): { event: string; data: any } | undefined {
  const lines = chunk.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || dataLines.length === 0) return undefined;
  const event = eventLine.slice("event:".length).trim();
  const rawData = dataLines.map((line) => line.slice("data:".length).trimStart()).join("\n");
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    // error-log-ignore: SSE 数据允许是普通文本，流本身的失败由 streamRequest 记录。
    return { event, data: rawData };
  }
}

function modelRequestTimeoutMs(selection?: { parameters?: { request_timeout_seconds?: number } }): number {
  const raw = selection?.parameters?.request_timeout_seconds;
  const seconds = typeof raw === "number" && Number.isFinite(raw)
    ? Math.min(maxModelRequestTimeoutSeconds, Math.max(minModelRequestTimeoutSeconds, raw))
    : defaultModelRequestTimeoutSeconds;
  return Math.round((seconds + modelRequestTimeoutBufferSeconds) * 1000);
}

function stripBackendIncompatibleProviderFields<T>(payload: T): T {
  return payload;
}

function hasProviderRequestTimeout(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const selection = (payload as { provider_selection?: { parameters?: Record<string, unknown> } }).provider_selection;
  return typeof selection?.parameters?.request_timeout_seconds === "number";
}

function stripProviderRequestTimeout<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const next = structuredClone(payload) as T & {
    provider_selection?: { parameters?: Record<string, unknown> };
  };
  delete next.provider_selection?.parameters?.request_timeout_seconds;
  return next;
}

function isLegacyTimeoutParameterError(text: string): boolean {
  return text.includes("request_timeout_seconds") && text.includes("extra_forbidden");
}

function legacyTimeoutCompatibleBody(body: BodyInit | null | undefined, responseText: string): string | undefined {
  if (typeof body !== "string" || !isLegacyTimeoutParameterError(responseText)) return undefined;
  try {
    const payload = JSON.parse(body) as unknown;
    if (!hasProviderRequestTimeout(payload)) return undefined;
    return JSON.stringify(stripProviderRequestTimeout(payload));
  } catch {
    // error-log-ignore: 这里只判断旧后端请求体能否兼容，不代表一次新的业务失败。
    return undefined;
  }
}

export const backendClient = new BackendClient();
