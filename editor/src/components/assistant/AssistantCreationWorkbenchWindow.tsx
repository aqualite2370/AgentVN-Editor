import { LocateFixed, Maximize2, Minus, PanelLeft, PanelRight, Sparkles, X } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { AssistantCreationDraft } from "../../assistant/creationAgent";
import "./assistant-creation-workbench.css";

const AssistantChatPanel = lazy(() =>
  import("./AssistantChatPanel").then((module) => ({ default: module.AssistantChatPanel })));

interface WorkbenchGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface AssistantCreationWorkbenchWindowProps {
  onClose: () => void;
  openRequestId?: number;
  recoveryConversationId?: string;
  returnFocusTarget?: HTMLElement | null;
  fallbackFocusTarget?: () => HTMLElement | null;
}

const preferenceKey = "agentvn.assistant.creation-workbench.geometry.v1";
const minimumWidth = 720;
const minimumHeight = 520;
const edgeGap = 12;

function defaultGeometry(viewportWidth: number, viewportHeight: number): WorkbenchGeometry {
  const width = Math.min(1160, Math.max(720, viewportWidth - 64));
  const height = Math.min(760, Math.max(520, viewportHeight - 64));
  return clampGeometry({
    left: Math.max(edgeGap, (viewportWidth - width) / 2),
    top: Math.max(edgeGap, (viewportHeight - height) / 2),
    width,
    height,
  }, viewportWidth, viewportHeight);
}

function clampGeometry(geometry: WorkbenchGeometry, viewportWidth: number, viewportHeight: number): WorkbenchGeometry {
  const width = Math.max(Math.min(minimumWidth, viewportWidth - edgeGap * 2), Math.min(geometry.width, viewportWidth - edgeGap * 2));
  const height = Math.max(Math.min(minimumHeight, viewportHeight - edgeGap * 2), Math.min(geometry.height, viewportHeight - edgeGap * 2));
  return {
    left: Math.max(edgeGap, Math.min(geometry.left, viewportWidth - width - edgeGap)),
    top: Math.max(edgeGap, Math.min(geometry.top, viewportHeight - height - edgeGap)),
    width,
    height,
  };
}

function initialGeometry(): WorkbenchGeometry {
  const fallback = defaultGeometry(window.innerWidth, window.innerHeight);
  try {
    const stored = localStorage.getItem(preferenceKey);
    if (!stored) return clampGeometry(fallback, window.innerWidth, window.innerHeight);
    const parsed = JSON.parse(stored) as Partial<WorkbenchGeometry>;
    if (![parsed.left, parsed.top, parsed.width, parsed.height].every(Number.isFinite)) {
      return clampGeometry(fallback, window.innerWidth, window.innerHeight);
    }
    return clampGeometry(parsed as WorkbenchGeometry, window.innerWidth, window.innerHeight);
  } catch {
    return clampGeometry(fallback, window.innerWidth, window.innerHeight);
  }
}

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startRect: DOMRect;
  kind: "move" | "resize";
  moved: boolean;
};

export function AssistantCreationWorkbenchWindow({
  onClose, openRequestId = 0, recoveryConversationId, returnFocusTarget, fallbackFocusTarget,
}: AssistantCreationWorkbenchWindowProps) {
  const [geometry, setGeometry] = useState<WorkbenchGeometry>(initialGeometry);
  const [creationDraft, setCreationDraft] = useState<AssistantCreationDraft>();
  const [minimized, setMinimized] = useState(false);
  // A repeated open is a new request even while the portal is still mounted.
  // Derive its input ownership from that request, not an old close's boolean.
  const [closingRequestId, setClosingRequestId] = useState<number>();
  const closing = closingRequestId === openRequestId;
  const windowRef = useRef<HTMLElement>(null);
  const gestureRef = useRef<Gesture | undefined>(undefined);
  const closeGenerationRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialReturnFocusRef = useRef(
    returnFocusTarget ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );

  useLayoutEffect(() => {
    // A user-opened nonmodal window owns its initial keyboard interaction.
    // Do not wait for lazy chat/history loading or steal focus on its updates.
    // Background process recovery, unlike an explicit open, must not interrupt
    // typing or the focus owner of a confirmation dialog.
    if (recoveryConversationId || document.querySelector('[aria-modal="true"]')) return;
    initialReturnFocusRef.current = returnFocusTarget
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    windowRef.current?.querySelector<HTMLButtonElement>('button[aria-label="关闭工作台"]')
      ?.focus({ preventScroll: true });
  }, [openRequestId]);

  useLayoutEffect(() => {
    const generation = ++closeGenerationRef.current;
    const element = windowRef.current;
    if (!closing || !element) return;
    // Reading the element's own transitions flushes the new target style.
    // Native CSS transitions reverse from the current presentation; no timer
    // or restarted entrance keyframe can unmount a newer open request.
    const transition = element.getAnimations().find(animation =>
      "transitionProperty" in animation && animation.transitionProperty === "opacity");
    const finish = () => {
      if (generation === closeGenerationRef.current && element.isConnected) onCloseRef.current();
    };
    if (transition) void transition.finished.then(finish, () => {});
    else if (Number(getComputedStyle(element).opacity) === 0) finish();
    return () => { closeGenerationRef.current++; };
  }, [closing, openRequestId]);

  const persist = useCallback((next: WorkbenchGeometry) => {
    const bounded = clampGeometry(next, window.innerWidth, window.innerHeight);
    setGeometry(bounded);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(bounded));
    } catch {
      // Geometry persistence is a convenience; the workbench remains usable if storage is unavailable.
    }
  }, []);

  useEffect(() => {
    const onResize = () => persist(geometry);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [geometry, persist]);

  const closeWindow = () => {
    if (closing) return;
    if (windowRef.current?.contains(document.activeElement)
      && !document.querySelector('[aria-modal="true"]')) {
      // The opener can disappear when the right-side AI workspace leaves.
      // Transfer focus before making this window inert, and never reclaim it
      // later from the decorative exit timer.
      for (const target of [initialReturnFocusRef.current, fallbackFocusTarget?.()]) {
        if (!target?.isConnected || target.closest('[inert],[aria-hidden="true"]')
          || target.matches(":disabled")) continue;
        const rect = target.getBoundingClientRect(), style = getComputedStyle(target);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden") continue;
        target.focus({ preventScroll: true });
        if (document.activeElement === target) break;
      }
    }
    setClosingRequestId(openRequestId);
  };

  const beginGesture = (kind: Gesture["kind"], event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || gestureRef.current) return;
    if (kind === "move" && (event.target as HTMLElement).closest("button")) return;
    const element = windowRef.current;
    if (!element) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: element.getBoundingClientRect(),
      kind,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const element = windowRef.current;
    if (!gesture || !element || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.moved && Math.hypot(deltaX, deltaY) < 6) return;
    gesture.moved = true;
    element.dataset.gestureActive = "true";
    const next = gesture.kind === "move"
      ? clampGeometry({
        ...geometry,
        left: gesture.startRect.left + deltaX,
        top: gesture.startRect.top + deltaY,
      }, window.innerWidth, window.innerHeight)
      : clampGeometry({
        ...geometry,
        width: gesture.startRect.width + deltaX,
        height: gesture.startRect.height + deltaY,
      }, window.innerWidth, window.innerHeight);
    element.style.left = `${next.left}px`;
    element.style.top = `${next.top}px`;
    element.style.width = `${next.width}px`;
    element.style.height = `${next.height}px`;
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    const element = windowRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !element) return;
    gestureRef.current = undefined;
    delete element.dataset.gestureActive;
    if (!gesture.moved) return;
    persist({
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    });
  };

  const dock = (side: "left" | "right") => {
    persist({
      ...geometry,
      left: side === "left" ? edgeGap : window.innerWidth - geometry.width - edgeGap,
    });
  };

  const resetGeometry = () => {
    const next = defaultGeometry(window.innerWidth, window.innerHeight);
    persist(next);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
    } catch {
      // Keep the in-memory reset even when persistent storage is unavailable.
    }
  };
  const onCreationDraftChange = useCallback((draft: AssistantCreationDraft | undefined) => {
    setCreationDraft(current => current === draft ? current : draft);
  }, []);

  const windowStyle = {
    left: geometry.left,
    top: geometry.top,
    width: geometry.width,
    height: minimized ? 54 : geometry.height,
    "--assistant-creation-window-width": `${geometry.width}px`,
  } as CSSProperties;

  if (typeof document === "undefined") return null;
  return createPortal(
    <section
      ref={windowRef}
      className={`assistant-creation-workbench-window${minimized ? " is-minimized" : ""}${closing ? " is-closing" : ""}`}
      style={windowStyle}
      role="region"
      aria-label="独立创造工作台"
      data-testid="assistant-creation-workbench-window"
      data-minimized={minimized}
      data-closing={closing}
      aria-hidden={closing}
      inert={closing}
    >
      <header
        className="assistant-creation-workbench-titlebar"
        onPointerDown={(event) => beginGesture("move", event)}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onLostPointerCapture={endGesture}
      >
        <div className="assistant-creation-workbench-title">
          <Sparkles size={15} aria-hidden="true" />
          <strong>创造工作台</strong>
          <span>构建组件 · 同窗预览 · 审核后保存</span>
        </div>
        <nav aria-label="工作台窗口操作">
          <button type="button" aria-label="停靠左侧" title="停靠左侧" onClick={() => dock("left")}><PanelLeft size={15} /></button>
          <button type="button" aria-label="停靠右侧" title="停靠右侧" onClick={() => dock("right")}><PanelRight size={15} /></button>
          <button type="button" aria-label="恢复默认位置和尺寸" title="恢复默认位置和尺寸" onClick={resetGeometry}><LocateFixed size={15} /></button>
          <button type="button" aria-label={minimized ? "恢复工作台" : "最小化工作台"}
            title={minimized ? "恢复" : "最小化"} onClick={() => setMinimized((value) => !value)}>
            {minimized ? <Maximize2 size={15} /> : <Minus size={15} />}
          </button>
          <button type="button" aria-label="关闭工作台" title="关闭工作台" onClick={closeWindow}><X size={15} /></button>
        </nav>
      </header>
      <div className="assistant-creation-workbench-content" aria-hidden={minimized}>
        <Suspense fallback={<div className="assistant-creation-workbench-loading" role="status">正在打开创造工作台…</div>}>
          <AssistantChatPanel
            initialMode="creation"
            recoveryConversationId={recoveryConversationId}
            creationWorkbenchLayout
            creationDraftOverride={creationDraft}
            onCreationDraftChange={onCreationDraftChange}
          />
        </Suspense>
      </div>
      {!minimized && (
        <div
          className="assistant-creation-workbench-resize"
          role="separator"
          aria-label="调整创造工作台大小"
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={(event) => beginGesture("resize", event)}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onLostPointerCapture={endGesture}
          onKeyDown={(event) => {
            if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
            event.preventDefault();
            const horizontal = event.key === "ArrowLeft" ? -24 : event.key === "ArrowRight" ? 24 : 0;
            const vertical = event.key === "ArrowUp" ? -24 : event.key === "ArrowDown" ? 24 : 0;
            persist({ ...geometry, width: geometry.width + horizontal, height: geometry.height + vertical });
          }}
        />
      )}
    </section>,
    document.body,
  );
}
