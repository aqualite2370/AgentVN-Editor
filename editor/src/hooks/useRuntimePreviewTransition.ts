import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type RuntimePreviewTransitionPhase =
  | "ready"
  | "capturing"
  | "masked"
  | "changing"
  | "settling"
  | "reloading";

interface RuntimePreviewTransitionOptions {
  containerRef: RefObject<HTMLElement>;
  initialize: () => void | Promise<void>;
  requestFreezeFrame: () => string | undefined;
  pause: () => void;
  resume: () => void;
  reducedMotion?: boolean;
  active?: boolean;
  settleMs?: number;
  captureTimeoutMs?: number;
  revealMs?: number;
}

export function useRuntimePreviewTransition({
  containerRef,
  initialize,
  requestFreezeFrame,
  pause,
  resume,
  reducedMotion = false,
  active = true,
  settleMs = 180,
  captureTimeoutMs = 120,
  revealMs = 140,
}: RuntimePreviewTransitionOptions) {
  const [phase, setPhase] = useState<RuntimePreviewTransitionPhase>("ready");
  const [snapshot, setSnapshot] = useState<string>();
  const phaseRef = useRef<RuntimePreviewTransitionPhase>("ready");
  const tokenRef = useRef(0);
  const freezeRequestRef = useRef("");
  const settleRequestedRef = useRef(false);
  const captureTimerRef = useRef<number>();
  const settleTimerRef = useRef<number>();
  const revealTimerRef = useRef<number>();
  const geometryAnimationRef = useRef<Animation>();
  const initializeRef = useRef(initialize);
  const requestFreezeFrameRef = useRef(requestFreezeFrame);
  const pauseRef = useRef(pause);
  const resumeRef = useRef(resume);

  initializeRef.current = initialize;
  requestFreezeFrameRef.current = requestFreezeFrame;
  pauseRef.current = pause;
  resumeRef.current = resume;

  const updatePhase = useCallback((next: RuntimePreviewTransitionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const clearTimers = useCallback(() => {
    if (captureTimerRef.current !== undefined) window.clearTimeout(captureTimerRef.current);
    if (settleTimerRef.current !== undefined) window.clearTimeout(settleTimerRef.current);
    if (revealTimerRef.current !== undefined) window.clearTimeout(revealTimerRef.current);
    captureTimerRef.current = undefined;
    settleTimerRef.current = undefined;
    revealTimerRef.current = undefined;
  }, []);

  const reloadAfterSettle = useCallback((token: number) => {
    if (token !== tokenRef.current) return;
    updatePhase("reloading");
    void initializeRef.current();
  }, [updatePhase]);

  const armSettle = useCallback((token: number) => {
    if (!settleRequestedRef.current || token !== tokenRef.current) return;
    if (settleTimerRef.current !== undefined) window.clearTimeout(settleTimerRef.current);
    updatePhase("settling");
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = undefined;
      reloadAfterSettle(token);
    }, settleMs);
  }, [reloadAfterSettle, settleMs, updatePhase]);

  const beginTransition = useCallback(() => {
    clearTimers();
    geometryAnimationRef.current?.cancel();
    geometryAnimationRef.current = undefined;
    tokenRef.current += 1;
    settleRequestedRef.current = false;
    updatePhase("capturing");
    freezeRequestRef.current = requestFreezeFrameRef.current() ?? "";
    pauseRef.current();
    const token = tokenRef.current;
    captureTimerRef.current = window.setTimeout(() => {
      captureTimerRef.current = undefined;
      if (token !== tokenRef.current || phaseRef.current !== "capturing") return;
      updatePhase("masked");
    }, captureTimeoutMs);
    return token;
  }, [captureTimeoutMs, clearTimers, updatePhase]);

  const finishTransition = useCallback(() => {
    settleRequestedRef.current = true;
    armSettle(tokenRef.current);
  }, [armSettle]);

  const animateLayoutChange = useCallback((applyLayout: () => void) => {
    const shell = containerRef.current;
    const first = shell?.getBoundingClientRect();
    const token = beginTransition();
    applyLayout();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (token !== tokenRef.current) return;
        const currentShell = containerRef.current;
        const last = currentShell?.getBoundingClientRect();
        if (!currentShell || !first || !last || reducedMotion) {
          finishTransition();
          return;
        }
        const scaleX = first.width / Math.max(1, last.width);
        const scaleY = first.height / Math.max(1, last.height);
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        geometryAnimationRef.current = currentShell.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})` },
            { transform: "translate(0, 0) scale(1, 1)" },
          ],
          {
            duration: 260,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          },
        );
        geometryAnimationRef.current.onfinish = () => {
          geometryAnimationRef.current = undefined;
          finishTransition();
        };
        geometryAnimationRef.current.oncancel = () => {
          geometryAnimationRef.current = undefined;
        };
      });
    });
  }, [beginTransition, containerRef, finishTransition, reducedMotion]);

  const acceptFreezeFrame = useCallback((requestId: string, image?: string) => {
    if (!requestId || requestId !== freezeRequestRef.current) return false;
    if (captureTimerRef.current !== undefined) window.clearTimeout(captureTimerRef.current);
    captureTimerRef.current = undefined;
    if (image) setSnapshot(image);
    if (phaseRef.current === "capturing") updatePhase("masked");
    return true;
  }, [updatePhase]);

  const markReady = useCallback(() => {
    if (phaseRef.current !== "reloading") return;
    if (revealTimerRef.current !== undefined) window.clearTimeout(revealTimerRef.current);
    const token = tokenRef.current;
    revealTimerRef.current = window.setTimeout(() => {
      revealTimerRef.current = undefined;
      if (token !== tokenRef.current) return;
      resumeRef.current();
      updatePhase("ready");
    }, revealMs);
  }, [revealMs, updatePhase]);

  const forceReload = useCallback(() => {
    beginTransition();
    finishTransition();
  }, [beginTransition, finishTransition]);

  const completeWithoutReload = useCallback(() => {
    settleRequestedRef.current = false;
    if (settleTimerRef.current !== undefined) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
    updatePhase("ready");
  }, [updatePhase]);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const observer = new ResizeObserver(() => {
      if (phaseRef.current === "ready" || phaseRef.current === "reloading") return;
      updatePhase("changing");
      armSettle(tokenRef.current);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [active, armSettle, containerRef, updatePhase]);

  useEffect(() => () => {
    clearTimers();
    geometryAnimationRef.current?.cancel();
  }, [clearTimers]);

  return {
    phase,
    snapshot,
    maskVisible: phase !== "ready",
    beginTransition,
    finishTransition,
    animateLayoutChange,
    acceptFreezeFrame,
    markReady,
    forceReload,
    completeWithoutReload,
  };
}
