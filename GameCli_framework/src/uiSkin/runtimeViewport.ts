import { useEffect, useState } from "react";

export type RuntimePlatform = "android" | "ios" | "desktop" | "web";
export type RuntimeFormFactor = "handheld" | "desktop";

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
}

const EMPTY_INSETS: RuntimeSafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function finiteInset(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function detectRuntimePlatform(userAgent = navigator.userAgent): RuntimePlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) return "desktop";
  return "web";
}

export function resolveRuntimeViewportState(
  previous?: RuntimeViewportState,
  nativeInsets: RuntimeSafeInsets = previous?.safeInsets ?? EMPTY_INSETS,
  revision = previous?.revision ?? 0,
): RuntimeViewportState {
  const visualViewport = window.visualViewport;
  const width = Math.max(1, Math.round(visualViewport?.width ?? window.innerWidth));
  const height = Math.max(1, Math.round(visualViewport?.height ?? window.innerHeight));
  const platform = detectRuntimePlatform();
  const orientation = width >= height ? "landscape" : "portrait";
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const handheldPlatform = platform === "android" || platform === "ios";
  const formFactor: RuntimeFormFactor = handheldPlatform || (coarsePointer && shortSide <= 760)
    ? "handheld"
    : "desktop";
  const breakpoint = formFactor === "handheld"
    ? "mobile"
    : orientation === "portrait"
      ? (shortSide <= 900 ? "mobile" : "desktop")
      : (shortSide <= 520 && longSide <= 980 ? "mobile" : "desktop");

  return {
    platform,
    formFactor,
    breakpoint,
    orientation,
    width,
    height,
    safeInsets: nativeInsets,
    revision,
  };
}

export function useRuntimeViewport(): RuntimeViewportState {
  const [state, setState] = useState(() => resolveRuntimeViewportState());

  useEffect(() => {
    let insets = state.safeInsets;
    let revision = state.revision;
    const update = () => setState((previous) => resolveRuntimeViewportState(previous, insets, revision));
    const handleInsets = (event: Event) => {
      const detail = (event as CustomEvent<AndroidInsetsEventDetail>).detail ?? {};
      const nextRevision = Number.isFinite(detail.revision) ? Number(detail.revision) : revision + 1;
      if (nextRevision < revision) return;
      revision = nextRevision;
      insets = {
        top: finiteInset(detail.top),
        right: finiteInset(detail.right),
        bottom: finiteInset(detail.bottom),
        left: finiteInset(detail.left),
      };
      update();
    };

    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    document.addEventListener("fullscreenchange", update);
    window.addEventListener("agentvn:android-insets", handleInsets);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("fullscreenchange", update);
      window.removeEventListener("agentvn:android-insets", handleInsets);
    };
  }, []);

  return state;
}
