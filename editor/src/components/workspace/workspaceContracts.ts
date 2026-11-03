import type { ReactNode } from "react";

export type WorkspaceSurface =
  | "edit"
  | "options"
  | "assets"
  | "preview"
  | "publish"
  | "advanced"
  | "assistant"
  | "import"
  | "timeline"
  | "settings";

export interface WorkspaceLayoutModel {
  palette: "visible" | "collapsed";
  inspector: "visible" | "collapsed";
  surface: WorkspaceSurface;
}

export interface WorkspaceSurfaceModule {
  id: WorkspaceSurface;
  title: string;
  render: () => ReactNode;
  canLeave: () => boolean;
  requestLeave: () => Promise<boolean>;
}

export type BackSource = "escape" | "toolbar" | "history" | "system";

export type BackResult =
  | { handled: true; surface?: WorkspaceSurface }
  | { handled: false };

export interface GenerationRequest {
  nodeId: string;
  prompt?: string;
}

export interface GenerationResult {
  ok: boolean;
  message?: string;
}

export interface SaveResult {
  ok: boolean;
  message?: string;
}

export interface WorkspaceController {
  openSurface: (surface: WorkspaceSurface) => void;
  requestBack: (source: BackSource) => BackResult;
  requestSave: () => Promise<SaveResult>;
  requestGeneration: (input: GenerationRequest) => Promise<GenerationResult>;
}

export const workspaceBackEventName = "agentvn:workspace-request-back";
export const workspaceOpenSurfaceEventName = "agentvn:workspace-open-surface";
export const workspaceGenerationEventName = "agentvn:workspace-request-generation";
export const workspaceSurfaceChangedEventName = "agentvn:workspace-surface-changed";
export const canvasNodeFocusEventName = "agentvn:focus-canvas-node";
export const novelTaskCardRevealEventName = "agentvn:novel-task-card-reveal";

/** Toolbar recovery is scoped to the current project; it never starts a task. */
export function revealNovelTaskCard(projectId: string) {
  window.dispatchEvent(new CustomEvent(novelTaskCardRevealEventName, { detail: { projectId } }));
}

export interface OwnedCanvasNodeFocusRequest {
  signal: AbortSignal;
  isCurrent: () => boolean;
  resolve: (focused: boolean) => void;
}

/** Resolve only after the real canvas has rendered and focused the requested node. */
export function requestCanvasNodeFocus(
  nodeId: string, zoom: number, isCurrent: () => boolean, signal: AbortSignal,
): Promise<boolean> {
  if (typeof window === "undefined" || signal.aborted || !isCurrent()) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = (focused: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve(focused);
    };
    const abort = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), 5000);
    signal.addEventListener("abort", abort, { once: true });
    window.dispatchEvent(new CustomEvent(canvasNodeFocusEventName, {
      detail: { nodeId, select: false, zoom, duration: 0,
        focusRequest: { signal, isCurrent: () => !settled && isCurrent(), resolve: finish } },
    }));
  });
}

export function openWorkspaceSurface(surface: WorkspaceSurface): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(workspaceOpenSurfaceEventName, { detail: { surface } }));
}

export function requestGeneration(input: GenerationRequest): Promise<GenerationResult> {
  if (typeof window === "undefined") return Promise.resolve({ ok: false, message: "当前环境不支持生成。" });
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    const settle = (result: GenerationResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      resolve(result);
    };
    timeoutId = window.setTimeout(() => settle({ ok: false, message: "生成入口未就绪或响应超时。" }), 120_000);
    window.dispatchEvent(new CustomEvent(workspaceGenerationEventName, {
      detail: { input, resolve: settle },
    }));
  });
}

export function requestBack(source: BackSource): BackResult {
  if (typeof window === "undefined") return { handled: false };
  const detail: { source: BackSource; handled: boolean } = { source, handled: false };
  const event = new CustomEvent(workspaceBackEventName, { cancelable: true, detail });
  window.dispatchEvent(event);
  return detail.handled || event.defaultPrevented ? { handled: true } : { handled: false };
}
