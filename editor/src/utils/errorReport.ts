import { useEditorStore, type EditorNotice } from "../store/editorStore";
import { useProjectStore } from "../store/projectStore";

export interface ErrorReportFile {
  fileName: string;
  text: string;
}

interface ErrorReportInput {
  notice: EditorNotice;
  fileName?: string;
  timestamp?: number;
}

const secretKeyPattern = /(api[_-]?key|token|authorization|bearer|provider[_-]?tokens?|secret|password)/i;
const redactionRules: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_\-]{8,}\b/g, "sk-[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [REDACTED]"],
  [/(authorization\s*[:=]\s*)(["']?)[^"',\s}]+/gi, "$1$2[REDACTED]"],
  [/(api[_-]?key\s*[:=]\s*)(["']?)[^"',\s}]+/gi, "$1$2[REDACTED]"],
  [/(token\s*[:=]\s*)(["']?)[^"',\s}]+/gi, "$1$2[REDACTED]"],
];

function createReportFileName(timestamp = Date.now()): string {
  return `AgentVN-Error-${timestamp}.txt`;
}

function redactText(value: string): string {
  return redactionRules.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function sanitizeForReport(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitizeForReport(item, seen));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (secretKeyPattern.test(key)) return [key, "[REDACTED]"];
      return [key, sanitizeForReport(item, seen)];
    })
  );
}

function stringify(value: unknown): string {
  return redactText(JSON.stringify(sanitizeForReport(value), null, 2));
}

function browserLanguage(): string {
  return [navigator.language, ...Array.from(navigator.languages ?? [])].filter(Boolean).join(", ");
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window || navigator.userAgent.includes("Tauri");
}

function likelyDiagnosis(notice: EditorNotice): string[] {
  const haystack = `${notice.source ?? ""}\n${notice.message}\n${notice.detail ?? ""}`.toLowerCase();
  if (haystack.includes("gamecli") || haystack.includes("preview")) {
    return [
      "确认当前是否在 AgentVN 桌面版中运行。浏览器开发模式无法启动本地 GameCLI 进程。",
      "确认 GameCLI 可执行文件已经构建，必要时运行 scripts/build-game-shell-windows.ps1。",
      "如果使用自定义路径，检查 AGENTVN_GAMECLI_EXE 是否指向存在且可执行的文件。",
      "检查临时目录是否有写入权限，并确认导出的临时 .vncart 可通过校验。",
    ];
  }
  if (haystack.includes("ai") || haystack.includes("model") || haystack.includes("provider")) {
    return [
      "检查模型连接是否启用，并确认所选模型具备当前功能需要的能力。",
      "检查 Base URL、Token、模型 ID 和温度/Token 上限参数。",
      "查看后端日志中是否存在 AI provider 错误、超时或结构化输出解析失败。",
    ];
  }
  if (haystack.includes("export") || haystack.includes("cartridge") || haystack.includes("vncart")) {
    return [
      "检查导出校验结果中是否存在未连接节点、缺失资源或非法 UI skin。",
      "确认 asset_manifest 中登记的资源可以被读取并进入卡带资源清单。",
      "用 scripts/verify-vncart.cjs 对导出的卡带进行独立校验。",
    ];
  }
  return [
    "先定位 Error Source 和 Original Error，再对照 Project Snapshot 复现当前工程状态。",
    "如果是交互触发的问题，优先检查 Selected Context 中的选中节点/边和当前页面状态。",
    "如果错误和环境相关，优先检查 Runtime Environment 与 Encoding Notes。",
  ];
}

export function normalizeEditorNotice(input?: string | EditorNotice): EditorNotice | undefined {
  if (!input) return undefined;
  if (typeof input === "string") {
    return {
      message: input,
      tone: "error",
      occurredAt: new Date().toISOString(),
    };
  }
  return {
    ...input,
    tone: input.tone ?? "error",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export function getNoticeMessage(notice: EditorNotice): string {
  return notice.message;
}

export function buildErrorReport({ notice, fileName, timestamp = Date.now() }: ErrorReportInput): ErrorReportFile {
  const editorState = useEditorStore.getState();
  const projectState = useProjectStore.getState();
  const selectedNode = editorState.nodes.find((node) => node.id === editorState.selectedNodeId);
  const selectedEdge = editorState.edges.find((edge) => edge.id === editorState.selectedEdgeId);
  const reportFileName = fileName ?? createReportFileName(timestamp);
  const originalError = notice.error instanceof Error
    ? {
        name: notice.error.name,
        message: notice.error.message,
        stack: notice.error.stack,
        cause: (notice.error as unknown as { cause?: unknown }).cause,
      }
    : notice.error;

  const sections = [
    "AgentVN Error Report",
    `File: ${reportFileName}`,
    `Generated at: ${new Date(timestamp).toISOString()}`,
    "",
    "== Summary ==",
    `Source: ${notice.source ?? "Unknown"}`,
    `Tone: ${notice.tone ?? "error"}`,
    `Message: ${notice.message}`,
    notice.detail ? `Detail: ${notice.detail}` : "Detail: (none)",
    notice.action ? `Suggested action: ${notice.action}` : "Suggested action: (see Developer Diagnosis)",
    `Occurred at: ${notice.occurredAt ?? "(unknown)"}`,
    "",
    "== Developer Diagnosis ==",
    likelyDiagnosis(notice).map((item, index) => `${index + 1}. ${item}`).join("\n"),
    "",
    "== Runtime Environment ==",
    stringify({
      url: window.location.href,
      origin: window.location.origin,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: browserLanguage(),
      viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      theme: document.documentElement.dataset.theme ?? "(unset)",
      colorScheme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      tauriRuntime: isTauriRuntime(),
      appVersion: projectState.editorVersion,
    }),
    "",
    "== Project Snapshot ==",
    stringify({
      project: {
        projectId: projectState.projectId,
        title: projectState.title,
        author: projectState.author,
        schemaVersion: projectState.schemaVersion,
        editorVersion: projectState.editorVersion,
        createdAt: projectState.createdAt,
        updatedAt: projectState.updatedAt,
        assetManifest: projectState.assetManifest,
        settings: projectState.settings,
      },
      editor: {
        nodes: editorState.nodes,
        edges: editorState.edges,
        viewport: editorState.viewport,
        memoryMode: editorState.memoryMode,
        dirty: editorState.dirty,
        selectedNodeId: editorState.selectedNodeId,
        selectedEdgeId: editorState.selectedEdgeId,
        activeGeneration: editorState.activeGeneration,
        generationDebug: editorState.generationDebug,
      },
    }),
    "",
    "== Selected Context ==",
    stringify({
      selectedNode,
      selectedEdge,
      customContext: notice.context ?? {},
    }),
    "",
    "== Original Error ==",
    stringify({
      message: notice.message,
      detail: notice.detail,
      action: notice.action,
      error: originalError,
    }),
    "",
    "== Encoding Notes ==",
    stringify({
      documentCharset: document.characterSet,
      navigatorLanguage: navigator.language,
      navigatorLanguages: navigator.languages,
      reportEncoding: "UTF-8",
      note: "If Chinese text appears garbled, verify the source file and terminal are both using UTF-8.",
    }),
    "",
    "== Redaction Notes ==",
    [
      "The report contains a full project snapshot by request, but secret-looking fields are redacted.",
      "Redacted key names include api_key, token, authorization, bearer, provider_tokens, secret and password.",
      "Inline values matching sk-* and Bearer tokens are replaced before writing the report.",
    ].join("\n"),
    "",
  ];

  return { fileName: reportFileName, text: redactText(sections.join("\n")) };
}
