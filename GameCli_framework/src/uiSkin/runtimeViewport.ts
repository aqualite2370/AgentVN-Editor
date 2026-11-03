import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { isTauriRuntime } from "../utils/platform";
import { normalizeNativeSafeInsets, resolveBrowserViewportSize, syncHandheldDocumentViewport } from "./runtimeViewportMath.mjs";

export type RuntimePlatform = "android" | "ios" | "desktop" | "web";
export type RuntimeFormFactor = "handheld" | "desktop";
export type RuntimeViewportPhase = "booting" | "recovering" | "stable";

export interface RuntimeSafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RuntimeViewportState {
  platform: RuntimePlatform;
  formFactor: RuntimeFormFactor;
  breakpoint: "desktop" | "mobile";
  orientation: "landscape" | "portrait";
  width: number;
  height: number;
  safeInsets: RuntimeSafeInsets;
  revision: number;
  ready: boolean;
  phase: RuntimeViewportPhase;
}

export interface RuntimeTextScale {
  platform: RuntimePlatform;
  uiScale: number;
  fontScale: number;
  dialogFontScale: number;
  choiceFontScale: number;
  fontSource: "desktop_viewport" | "handheld_viewport";
}

export function resolveRuntimeTextScale(
  platform: RuntimePlatform,
  formFactor: RuntimeFormFactor,
  uiScale: number,
): RuntimeTextScale {
  if (formFactor === "handheld") {
    const fontScale = Math.min(1.08, Math.max(0.88, uiScale));
    return {
      platform,
      uiScale,
      fontScale,
      dialogFontScale: Math.min(1.08, Math.max(0.92, fontScale)),
      choiceFontScale: Math.min(1.06, Math.max(0.92, fontScale)),
      fontSource: "handheld_viewport",
    };
  }
  const fontScale = Math.min(1.55, Math.max(1, uiScale));
  return {
    platform,
    uiScale,
    fontScale,
    dialogFontScale: Math.min(1.55, Math.max(1.15, fontScale)),
    choiceFontScale: Math.min(1.5, Math.max(1.1, fontScale)),
    fontSource: "desktop_viewport",
  };
}

interface AndroidInsetsEventDetail extends Partial<RuntimeSafeInsets> {
  revision?: number;
  coordinateSpace?: "physical" | "css";
}

const EMPTY_INSETS: RuntimeSafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export function detectRuntimePlatform(userAgent = navigator.userAgent): RuntimePlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (isTauriRuntime()) return "desktop";
  return "web";
}

export function resolveRuntimeViewportState(
  previous?: RuntimeViewportState,
  nativeInsets: RuntimeSafeInsets = previous?.safeInsets ?? EMPTY_INSETS,
  revision = previous?.revision ?? 0,
  measuredSize?: { width: number; height: number },
): RuntimeViewportState {
  const visualViewport = window.visualViewport;
  const platform = detectRuntimePlatform();
  // Android/iOS WebViews can leave the document root at the pre-immersive
  // height for one or more frames.  The visual viewport is the compositor's
  // current usable window and must win for handheld runtimes; otherwise every
  // screen inherits the stale frame size (not just the title page).
  const viewportSize = resolveBrowserViewportSize(
    platform,
    measuredSize,
    visualViewport?.width && visualViewport?.height
      ? { width: visualViewport.width, height: visualViewport.height }
      : undefined,
    { width: window.innerWidth, height: window.innerHeight },
    previous ? { width: previous.width, height: previous.height } : undefined,
  );
  const width = Math.max(1, Math.round(viewportSize.width));
  const height = Math.max(1, Math.round(viewportSize.height));
  const orientation = width >= height ? "landscape" : "portrait";
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const handheldPlatform = platform === "android" || platform === "ios";
  const formFactor: RuntimeFormFactor = handheldPlatform || (coarsePointer && shortSide <= 760)
    ? "handheld"
    : "desktop";
  // Native handheld playback intentionally uses the PC-authored composition.
  // Keep the form factor as handheld for touch targets/insets, but expose the
  // desktop breakpoint so layout geometry, typography and frame orientation
  // all resolve from the same PC design as the desktop player.
  // Handheld playback is the same PC-authored composition at a uniform
  // scale.  Touch/insets remain form-factor concerns, but breakpoint
  // selection must never switch to a second mobile geometry schema.
  const breakpoint = formFactor === "handheld"
    ? "desktop"
    : orientation === "portrait"
      ? (shortSide <= 900 ? "mobile" : "desktop")
      : (shortSide <= 520 && longSide <= 980 ? "mobile" : "desktop");
  const requiresLandscape = platform === "android" || platform === "ios";
  const ready = !requiresLandscape || orientation === "landscape";
  const phase: RuntimeViewportPhase = ready ? "stable" : "booting";

  return {
    platform,
    formFactor,
    breakpoint,
    orientation,
    width,
    height,
    safeInsets: nativeInsets,
    revision,
    ready,
    phase,
  };
}

export function useRuntimeViewport(containerRef?: RefObject<HTMLElement>): RuntimeViewportState {
  const measure = useCallback(() => {
    const rect = containerRef?.current?.getBoundingClientRect();
    if (rect?.width && rect?.height) {
      return { width: rect.width, height: rect.height };
    }
    const rootRect = document.documentElement.getBoundingClientRect();
    if (rootRect.width && rootRect.height) {
      return { width: rootRect.width, height: rootRect.height };
    }
    return undefined;
  }, [containerRef]);
  const measuredSizeRef = useRef<{ width: number; height: number } | undefined>(undefined);
  const [state, setState] = useState(() => resolveRuntimeViewportState(undefined, EMPTY_INSETS, 0, measure()));
  const stateRef = useRef(state);
  const nativeInsetsRef = useRef<AndroidInsetsEventDetail>({ ...EMPTY_INSETS, coordinateSpace: "physical" });

  useEffect(() => {
    let revision = stateRef.current.revision;
    let recoveryPending = false;
    let resizeObserver: ResizeObserver | undefined;
    let recoveryAnimationFrame = 0;
    const recoveryTimeouts = new Set<number>();
    const requestNativeInsets = () => {
      if (detectRuntimePlatform() !== "android") return;
      const bridge = (window as Window & { AgentVNViewport?: { requestInsets?: () => void } }).AgentVNViewport;
      bridge?.requestInsets?.();
    };
    const update = () => {
      measuredSizeRef.current = measure();
      const insets = normalizeNativeSafeInsets(nativeInsetsRef.current, window.devicePixelRatio);
      const resolved = resolveRuntimeViewportState(stateRef.current, insets, revision, measuredSizeRef.current);
      const next = recoveryPending && resolved.ready
        ? { ...resolved, phase: "recovering" as const }
        : resolved;
      if (next.ready) recoveryPending = false;
      stateRef.current = next;
      syncHandheldDocumentViewport(next.platform, next);
      setState(next);
    };
    const clearRecoveryMeasurements = () => {
      if (recoveryAnimationFrame) {
        window.cancelAnimationFrame(recoveryAnimationFrame);
        recoveryAnimationFrame = 0;
      }
      for (const timeout of recoveryTimeouts) window.clearTimeout(timeout);
      recoveryTimeouts.clear();
    };
    const scheduleRecoveryMeasurements = () => {
      clearRecoveryMeasurements();
      recoveryPending = true;
      requestNativeInsets();
      update();
      recoveryAnimationFrame = window.requestAnimationFrame(() => {
        update();
        recoveryAnimationFrame = window.requestAnimationFrame(() => {
          recoveryAnimationFrame = 0;
          update();
        });
      });
      for (const delay of [120, 360]) {
        const timeout = window.setTimeout(() => {
          recoveryTimeouts.delete(timeout);
          update();
        }, delay);
        recoveryTimeouts.add(timeout);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRecoveryMeasurements();
    };
    const handleInsets = (event: Event) => {
      const detail = (event as CustomEvent<AndroidInsetsEventDetail>).detail ?? {};
      const nextRevision = Number.isFinite(detail.revision) ? Number(detail.revision) : revision + 1;
      if (nextRevision < revision) return;
      revision = nextRevision;
      nativeInsetsRef.current = { ...detail };
      update();
    };

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    window.addEventListener("focus", scheduleRecoveryMeasurements);
    window.addEventListener("pageshow", scheduleRecoveryMeasurements);
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("agentvn:android-insets", handleInsets);
    window.addEventListener("agentvn:android-resume", scheduleRecoveryMeasurements);
    window.addEventListener("agentvn:android-surface-ready", scheduleRecoveryMeasurements);
    // A display/DPI change need not resize the CSS viewport.
    let resolutionQuery: MediaQueryList | undefined;
    const watchResolution = () => {
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolutionQuery.addEventListener("change", handleResolutionChange);
    };
    const handleResolutionChange = () => {
      watchResolution();
      update();
    };
    watchResolution();
    const observed = containerRef?.current ?? document.documentElement;
    if (typeof ResizeObserver !== "undefined" && observed) {
      resizeObserver = new ResizeObserver(update);
      resizeObserver.observe(observed);
    }
    let unlistenScaleFactor: (() => void) | undefined;
    if (isTauriRuntime()) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().onScaleChanged(update))
        .then((unlisten) => {
          unlistenScaleFactor = unlisten;
        })
        .catch(() => {
          // error-log-ignore: Browser previews do not expose Tauri window events.
        });
    }
    // Native startup notifications may precede React mounting. Register first,
    // then replay the current native value rather than waiting for rotation.
    requestNativeInsets();
    update();
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      window.removeEventListener("focus", scheduleRecoveryMeasurements);
      window.removeEventListener("pageshow", scheduleRecoveryMeasurements);
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("agentvn:android-insets", handleInsets);
      window.removeEventListener("agentvn:android-resume", scheduleRecoveryMeasurements);
      window.removeEventListener("agentvn:android-surface-ready", scheduleRecoveryMeasurements);
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      resizeObserver?.disconnect();
      unlistenScaleFactor?.();
      clearRecoveryMeasurements();
    };
  }, [containerRef, measure]);

  return state;
}
