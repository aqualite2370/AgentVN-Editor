export type RuntimeDiagnosticEvent =
  | "screen"
  | "layout"
  | "pointerdown"
  | "pointerup"
  | "resource"
  | "audio"
  | "error";

export interface RuntimeDiagnosticEntry {
  event: RuntimeDiagnosticEvent;
  at: string;
  payload: Record<string, unknown>;
}

export interface RuntimeSmokeReport {
  schemaVersion: 1;
  artifactPath?: string;
  artifactSha256?: string;
  platform?: string;
  device?: string;
  coldStart?: Record<string, unknown>;
  screens: RuntimeDiagnosticEntry[];
  clicks: RuntimeDiagnosticEntry[];
  layout: RuntimeDiagnosticEntry[];
  resources: RuntimeDiagnosticEntry[];
  audio: RuntimeDiagnosticEntry[];
  consoleErrors: RuntimeDiagnosticEntry[];
  nativeErrors: RuntimeDiagnosticEntry[];
  status: "PASS" | "FAIL" | "STATIC_ONLY";
  failureCode?: string;
}

interface RuntimeDiagnosticsWindow extends Window {
  __AGENTVN_RUNTIME_DIAGNOSTICS__?: RuntimeSmokeReport;
  __AGENTVN_RUNTIME_DIAGNOSTICS_ENABLED__?: boolean;
}

const runtimeWindow = (): RuntimeDiagnosticsWindow | undefined => (
  typeof window === "undefined" ? undefined : window as RuntimeDiagnosticsWindow
);

function enabled(): boolean {
  const current = runtimeWindow();
  if (!current) return false;
  if (current.__AGENTVN_RUNTIME_DIAGNOSTICS_ENABLED__ === true) return true;
  try {
    const query = new URLSearchParams(current.location.search);
    return query.get("runtimeDiagnostics") === "1"
      || query.get("diagnostics") === "1"
      || current.localStorage.getItem("agentvn.runtimeDiagnostics") === "1";
  } catch {
    return false;
  }
}

function report(): RuntimeSmokeReport {
  const current = runtimeWindow();
  if (current?.__AGENTVN_RUNTIME_DIAGNOSTICS__) return current.__AGENTVN_RUNTIME_DIAGNOSTICS__;
  const next: RuntimeSmokeReport = {
    schemaVersion: 1,
    screens: [],
    clicks: [],
    layout: [],
    resources: [],
    audio: [],
    consoleErrors: [],
    nativeErrors: [],
    status: "STATIC_ONLY",
  };
  if (current) current.__AGENTVN_RUNTIME_DIAGNOSTICS__ = next;
  return next;
}

export function runtimeDiagnosticsEnabled(): boolean {
  return enabled();
}

export function recordRuntimeDiagnostic(
  event: RuntimeDiagnosticEvent,
  payload: Record<string, unknown>,
): void {
  if (!enabled()) return;
  const entry: RuntimeDiagnosticEntry = {
    event,
    at: new Date().toISOString(),
    payload,
  };
  const target = report();
  const bucket = event === "screen"
    ? target.screens
    : event === "pointerdown" || event === "pointerup"
      ? target.clicks
      : event === "resource"
        ? target.resources
        : event === "audio"
          ? target.audio
          : event === "error"
            ? target.consoleErrors
            : target.layout;
  bucket.push(entry);
  if (bucket.length > 500) bucket.splice(0, bucket.length - 500);
  runtimeWindow()?.dispatchEvent(new CustomEvent("agentvn:runtime-diagnostic", { detail: entry }));
}

export function recordRuntimeScreen(screen: string): void {
  recordRuntimeDiagnostic("screen", { screen });
}

export function recordRuntimeLayout(payload: Record<string, unknown>): void {
  recordRuntimeDiagnostic("layout", payload);
}

export function recordRuntimeResource(payload: Record<string, unknown>): void {
  recordRuntimeDiagnostic("resource", payload);
}

export function recordRuntimeAudio(payload: Record<string, unknown>): void {
  recordRuntimeDiagnostic("audio", payload);
}

export function recordRuntimeError(payload: Record<string, unknown>): void {
  recordRuntimeDiagnostic("error", payload);
}

export function getRuntimeSmokeReport(): RuntimeSmokeReport {
  return structuredClone(report());
}

export function installRuntimeDiagnostics(): () => void {
  if (!enabled() || typeof document === "undefined") return () => undefined;
  const onPointer = (event: PointerEvent) => {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const frame = document.querySelector<HTMLElement>(".runtime-layout-frame");
    const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : undefined;
    const frameRect = frame?.getBoundingClientRect();
    recordRuntimeDiagnostic(event.type === "pointerdown" ? "pointerdown" : "pointerup", {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: event.pointerType,
      targetTag: target?.tagName,
      targetTestId: target?.getAttribute("data-testid"),
      targetComponentId: target?.getAttribute("data-ui-component-id"),
      targetRect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined,
      frameRect: frameRect ? { left: frameRect.left, top: frameRect.top, width: frameRect.width, height: frameRect.height } : undefined,
      screen: document.querySelector("[data-ui-screen]")?.getAttribute("data-ui-screen"),
    });
  };
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener("pointerup", onPointer, true);
  return () => {
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("pointerup", onPointer, true);
  };
}
