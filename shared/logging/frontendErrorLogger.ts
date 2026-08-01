export type FrontendErrorApp = "editor" | "player";
export type FrontendErrorWriter = (source: string, message: string) => Promise<unknown>;

interface ErrorContext {
  [key: string]: unknown;
}

const MAX_LOG_BYTES = 8 * 1024;
const MAX_SERIALIZED_STRING_LENGTH = 2_000;
const OMITTED_CONTENT_KEYS = /^(raw_text|normalized_text|source_text|novel_text|prompt|messages|project|nodes|edges)$/i;

const secretPatterns: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_\-]{6,}\b/g, "sk-***"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}\b/gi, "Bearer ***"],
  [/(authorization|api[_-]?key|token|secret|password)(\s*[:=]\s*)(["']?)[^"',\s}]+/gi, "$1$2$3***"],
  [/([?&](?:api[_-]?key|token)=)[^&\s]+/gi, "$1***"],
  [/([?&][^=\s&#]+)=([^&\s#"',}]*)/g, "$1=***"],
];

let installedFor: FrontendErrorApp | undefined;
let errorWriter: FrontendErrorWriter | undefined;
let writeQueue = Promise.resolve();
const recentFingerprints = new Map<string, number>();

function redact(value: string): string {
  return secretPatterns.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function truncateUtf8(value: string, maxBytes = MAX_LOG_BYTES): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  const suffix = "\n[后续内容已省略]";
  const suffixBytes = new TextEncoder().encode(suffix).byteLength;
  let end = Math.max(0, maxBytes - suffixBytes);
  while (end > 0 && (encoded[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return new TextDecoder().decode(encoded.slice(0, end)) + suffix;
}

function isTauriRuntime(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || navigator.userAgent.includes("Tauri");
}

function isExpectedCapabilityProbe(url: string, status: number): boolean {
  if (status !== 404) return false;
  try {
    const path = new URL(url, window.location.href).pathname;
    return path.endsWith("/runtime-mode.json") || path.endsWith("/fixed-only.json");
  } catch {
    return false;
  }
}

function serialize(value: unknown, seen = new WeakSet<object>(), key = ""): unknown {
  if (OMITTED_CONTENT_KEYS.test(key)) return "[内容已省略]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateUtf8(redact(value.message), MAX_SERIALIZED_STRING_LENGTH),
      stack: truncateUtf8(redact(value.stack ?? ""), MAX_LOG_BYTES),
      cause: serialize((value as Error & { cause?: unknown }).cause, seen, "cause"),
    };
  }
  if (typeof value === "string") {
    return truncateUtf8(redact(value), MAX_SERIALIZED_STRING_LENGTH);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[循环引用]";
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((item) => serialize(item, seen, key));
    if (value.length > items.length) items.push(`[其余 ${value.length - items.length} 项已省略]`);
    return items;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /api[_-]?key|token|authorization|secret|password/i.test(key) ? "***" : serialize(item, seen, key),
    ]),
  );
}

function toLogText(error: unknown, context?: ErrorContext): string {
  const payload = {
    time: new Date().toISOString(),
    page: redact(window.location.href),
    error: serialize(error),
    context: serialize(context ?? {}),
  };
  try {
    return truncateUtf8(JSON.stringify(payload));
  } catch {
    return truncateUtf8(redact(String(error)));
  }
}

function shouldWrite(source: string, text: string): boolean {
  const fingerprint = `${source}\n${text.slice(0, 1200)}`;
  const now = Date.now();
  const previous = recentFingerprints.get(fingerprint) ?? 0;
  recentFingerprints.set(fingerprint, now);
  for (const [key, timestamp] of recentFingerprints) {
    if (now - timestamp > 30_000) recentFingerprints.delete(key);
  }
  return now - previous > 1000;
}

export function reportFrontendError(source: string, error: unknown, context?: ErrorContext): void {
  if (!isTauriRuntime() || !errorWriter) return;
  const text = toLogText(error, context);
  let fingerprint = redact(String(error));
  try {
    fingerprint = JSON.stringify({
      error: serialize(error),
      context: serialize(context ?? {}),
    });
  } catch {
    // The fallback string is sufficient for duplicate suppression.
  }
  if (!shouldWrite(source, fingerprint)) return;
  writeQueue = writeQueue
    .then(async () => {
      await errorWriter?.(source, text);
    })
    .catch(() => {
      // Logging must never replace the user's original error or create a rejection loop.
    });
}

export function installGlobalErrorLogging(app: FrontendErrorApp, writer: FrontendErrorWriter): void {
  if (installedFor) return;
  installedFor = app;
  errorWriter = writer;

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    reportFrontendError(`${app}.console`, args);
    originalConsoleError(...args);
  };
  console.warn = (...args: unknown[]) => {
    reportFrontendError(`${app}.warning`, args);
    originalConsoleWarn(...args);
  };

  window.addEventListener("error", (event) => {
    reportFrontendError(`${app}.window`, event.error ?? event.message, {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportFrontendError(`${app}.promise`, event.reason);
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const url = input instanceof Request ? input.url : String(input);
    try {
      const response = await originalFetch(input, init);
      if (!response.ok && !isExpectedCapabilityProbe(url, response.status)) {
        const detail = await response.clone().text().catch(() => "");
        reportFrontendError(`${app}.request`, `请求返回 ${response.status} ${response.statusText}`, {
          method,
          url,
          status: response.status,
          detail,
        });
      }
      return response;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        reportFrontendError(`${app}.request`, error, { method, url });
      }
      throw error;
    }
  };
}
