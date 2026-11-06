import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { getDefaultUISkinLayout, normalizeUISkinLayoutForRuntime, resolveUILayoutBackgroundOpacity, hasUILayoutOpacityLayers, supportsUILayoutOpacityLayers, type UILayoutBreakpoint, type UILayoutComponent, type UILayoutComponentStyle, type UILayoutComponentType, type UILayoutRect, type UILayoutScreenId, type UISkinLayout } from "../../../shared/cartridge/uiSkin";
import { normalizeQuickMenuVariant } from "../../../shared/cartridge/quickMenuMetrics";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { isEmbeddedRuntime } from "../utils/platform";
import { useRuntimeStore } from "../store/runtimeStore";
import { useSettingsStore } from "../store/settingsStore";
import { backgroundFitStyle } from "../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../utils/runtimeAssetUrl";
import { resolveUILayoutAssetUrl } from "../utils/uiLayoutAssetUrl";
import { RuntimeCustomComponentLayer } from "./RuntimeCustomComponentLayer";
import { PresentedControl } from "./PresentedControl";
import { assetIdFromUILayoutReference } from "../../../shared/cartridge/uiAssetReference";
import {
  RENPY_BUTTON_STATES,
  resolveRenpyButtonRole,
  type RenpyButtonRole,
  type RenpyButtonRolePage,
  type RenpyNavigationPage,
  type ResolvedRenpyButtonRole,
} from "../../../shared/cartridge/renpyGui";
import type { GameManifest } from "../types/manifest";
import { resolveRuntimeTextScale, useRuntimeViewport, type RuntimeFormFactor, type RuntimePlatform, type RuntimeSafeInsets, type RuntimeTextScale, type RuntimeViewportPhase } from "./runtimeViewport";
import { resolveDialogueModeLayout, type DialogueLayoutMode } from "../../../shared/cartridge/dialogueModeLayout";
import { fitGameViewport, gameFrameSafeInsets, resolveGameViewport, resolvePlayerGameViewport } from "../../../shared/cartridge/gameViewport";
import { fontFamilyForAsset, runtimeFontFaceRule } from "./runtimeFont";
export { fontFamilyForAsset } from "./runtimeFont";

function cssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

interface UISkinContextValue {
  skin: UISkinLayout;
  breakpoint: "desktop" | "mobile";
  orientation: "landscape" | "portrait";
  scale: number;
  fontScale: number;
  touchScale: number;
  platform: RuntimePlatform;
  formFactor: RuntimeFormFactor;
  safeInsets: RuntimeSafeInsets;
  safeBounds: UILayoutRect;
  textScale: RuntimeTextScale;
  viewportWidth: number;
  viewportHeight: number;
  viewportReady: boolean;
  viewportPhase: RuntimeViewportPhase;
  scopeRef: RefObject<HTMLDivElement>;
}

const UISkinContext = createContext<UISkinContextValue>({
  skin: getDefaultUISkinLayout(),
  breakpoint: "desktop",
  orientation: "landscape",
  scale: 1,
  fontScale: 1,
  touchScale: 1,
  platform: "web",
  formFactor: "desktop",
  safeInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  safeBounds: { x: 0, y: 0, width: 100, height: 100 },
  textScale: { platform: "web", uiScale: 1, fontScale: 1, dialogFontScale: 1.15, choiceFontScale: 1.1, fontSource: "desktop_viewport" },
  viewportWidth: 1,
  viewportHeight: 1,
  viewportReady: true,
  viewportPhase: "stable",
  scopeRef: { current: null },
});

function useLandscapeLock(active: boolean): void {
  useEffect(() => {
    if (!active || isEmbeddedRuntime()) return;
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
      unlock?: () => void;
    };
    const requestLandscape = () => {
      void orientation.lock?.("landscape").catch((error) => {
        reportFrontendError("player.orientation", error, { operation: "lock-landscape" });
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") requestLandscape();
    };
    requestLandscape();
    window.addEventListener("agentvn:android-resume", requestLandscape);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("agentvn:android-resume", requestLandscape);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      orientation.unlock?.();
    };
  }, [active]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function layoutScale(breakpoint: "desktop" | "mobile", formFactor: RuntimeFormFactor, width: number, height: number,
  design = resolveGameViewport()): number {
  const rawScale = Math.min(width / design.width, height / design.height);
  return formFactor === "handheld" ? clamp(rawScale, 0.3, 1.12) : clamp(rawScale, 0.72, 1.75);
}

function scalePx(value: number | undefined, scale: number): string | undefined {
  return typeof value === "number" ? `${Math.round(value * scale * 100) / 100}px` : undefined;
}

const strictPlayerComponentTypes = new Set<UILayoutComponentType>([
  "dialog_panel",
  "speaker_label",
  "dialog_text",
  "continue_indicator",
]);

const titleButtonComponentTypes = new Set<UILayoutComponentType>([
  "choice_option",
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
  "main_menu_custom_button",
]);

const titleMenuButtonComponentTypes = new Set<UILayoutComponentType>([
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
  "main_menu_custom_button",
]);

function tokenStyle(skin: UISkinLayout): CSSProperties {
  const tokens = skin.tokens ?? {};
  const runtimeFontFamily = fontFamilyForAsset(tokens.fontAssetId);
  const focusColor = tokens.colorFocus ?? tokens.colorAccent;
  const solidPanel = opaqueColor(tokens.colorPanel ?? tokens.colorSurface ?? tokens.colorBackground);
  const solidControl = opaqueColor(tokens.colorControl ?? tokens.colorSurfaceStrong ?? tokens.colorSurface);
  const solidControlHover = opaqueColor(tokens.colorControlHover ?? tokens.colorControl ?? tokens.colorSurfaceStrong);
  const solidControlActive = opaqueColor(tokens.colorControlActive ?? tokens.colorAccent ?? tokens.colorControl);
  const solidChoice = opaqueColor(tokens.colorChoice ?? tokens.colorAccent ?? tokens.colorControl);
  return {
    "--bg": tokens.colorBackground,
    "--surface": tokens.colorSurface ? colorWithAlpha(tokens.colorSurface, 0.88) : undefined,
    "--surface-2": tokens.colorSurfaceStrong ? colorWithAlpha(tokens.colorSurfaceStrong, 0.92) : undefined,
    "--surface-3": tokens.colorSurfaceStrong,
    "--ink": tokens.colorInk,
    "--muted": tokens.colorMuted,
    "--muted-2": tokens.colorMuted ? colorWithAlpha(tokens.colorMuted, 0.78) : undefined,
    "--accent": tokens.colorAccent,
    "--accent-2": tokens.colorAccent2,
    "--line": tokens.colorLine ? colorWithAlpha(tokens.colorLine, 0.28) : undefined,
    "--line-strong": tokens.colorLine ? colorWithAlpha(tokens.colorLine, 0.56) : undefined,
    "--cart-gold": tokens.colorAccent2 ?? tokens.colorAccent,
    "--cart-green": tokens.colorSuccess,
    "--runtime-panel": tokens.colorPanel ?? tokens.colorSurface,
    "--runtime-panel-solid": solidPanel,
    "--runtime-panel-text": tokens.colorPanelText ?? tokens.colorInk,
    "--runtime-control": solidControl,
    "--runtime-control-solid": solidControl,
    "--runtime-control-hover": solidControlHover,
    "--runtime-control-hover-solid": solidControlHover,
    "--runtime-control-active": solidControlActive,
    "--runtime-control-active-solid": solidControlActive,
    "--runtime-control-text": tokens.colorControlText ?? tokens.colorInk,
    "--runtime-slider-track": tokens.colorSliderTrack ?? tokens.colorLine,
    "--runtime-slider-active": tokens.colorSliderActive ?? tokens.colorControlActive ?? tokens.colorAccent,
    "--runtime-slider-thumb": tokens.colorSliderThumb ?? tokens.colorControl ?? tokens.colorSurfaceStrong,
    "--runtime-dialog": tokens.colorDialog ?? tokens.colorSurface,
    "--runtime-dialog-text": tokens.colorDialogText ?? tokens.colorInk,
    "--runtime-speaker": tokens.colorSpeakerPlate ?? tokens.colorSurfaceStrong,
    "--runtime-speaker-text": tokens.colorSpeakerText ?? tokens.colorAccent,
    "--runtime-choice": solidChoice,
    "--runtime-choice-solid": solidChoice,
    "--runtime-choice-text": tokens.colorChoiceText ?? "#ffffff",
    "--runtime-quick-menu": tokens.colorQuickMenu ?? tokens.colorSurface,
    "--runtime-focus": focusColor,
    "--focus-ring": focusColor
      ? `0 0 8px ${colorWithAlpha(focusColor, 0.28)}, 0 0 18px ${colorWithAlpha(focusColor, 0.17)}`
      : undefined,
    "--success": tokens.colorSuccess,
    "--warning": tokens.colorWarning,
    "--danger": tokens.colorDanger,
    "--checkbox-accent": tokens.colorControlActive ?? tokens.colorAccent,
    "--checkbox-accent-strong": tokens.colorAccent2 ?? tokens.colorAccent,
    "--checkbox-border": tokens.colorLine ? colorWithAlpha(tokens.colorLine, 0.54) : undefined,
    "--checkbox-bg": tokens.colorControl ?? tokens.colorSurface,
    "--checkbox-check": tokens.colorChoiceText ?? "#ffffff",
    "--checkbox-glow": focusColor ? colorWithAlpha(focusColor, 0.2) : undefined,
    "--runtime-ui-font-family": runtimeFontFamily,
    "--runtime-text-font-family": runtimeFontFamily,
    "--radius": typeof tokens.radius === "number" ? `${tokens.radius}px` : undefined,
    "--runtime-skin-motion-scale": typeof tokens.motionScale === "number" ? String(tokens.motionScale) : undefined,
    "--runtime-theme-font-scale": typeof tokens.fontScale === "number" ? String(tokens.fontScale) : undefined,
  } as CSSProperties;
}

function runtimeFrameStyle(scale: number, fontScale: number, touchScale: number, safeInsets: RuntimeSafeInsets,
  design = resolveGameViewport(), frameOffset = { x: 0, y: 0 }): CSSProperties {
  const themeFontScale = "var(--runtime-theme-font-scale, 1)";
  return {
    "--runtime-frame-aspect": String(design.ratio),
    "--runtime-frame-ratio": String(design.ratio),
    "--runtime-ui-scale": String(scale),
    "--runtime-font-scale": String(fontScale),
    "--runtime-touch-scale": String(touchScale),
    "--runtime-touch-size": `${Math.round(42 * touchScale)}px`,
    "--runtime-page-padding": `${Math.round(28 * scale)}px`,
    "--runtime-dialog-font-size": `calc(${Math.round(22 * fontScale)}px * ${themeFontScale})`,
    "--runtime-body-font-size": `calc(${Math.round(15 * fontScale)}px * ${themeFontScale})`,
    "--runtime-small-font-size": `calc(${Math.round(12 * fontScale)}px * ${themeFontScale})`,
    "--runtime-safe-top": `max(${safeInsets.top}px, calc(env(safe-area-inset-top, 0px) - ${frameOffset.y}px))`,
    "--runtime-safe-right": `max(${safeInsets.right}px, calc(env(safe-area-inset-right, 0px) - ${frameOffset.x}px))`,
    "--runtime-safe-bottom": `max(${safeInsets.bottom}px, calc(env(safe-area-inset-bottom, 0px) - ${frameOffset.y}px))`,
    "--runtime-safe-left": `max(${safeInsets.left}px, calc(env(safe-area-inset-left, 0px) - ${frameOffset.x}px))`,
    "--runtime-safe-width": "calc(100% - var(--runtime-safe-left) - var(--runtime-safe-right))",
    "--runtime-safe-height": "calc(100% - var(--runtime-safe-top) - var(--runtime-safe-bottom))",
  } as CSSProperties;
}

function colorWithAlpha(color: string, alpha: number): string {
  const normalized = color.trim();
  if (normalized.startsWith("#")) {
    const hex = normalized.slice(1);
    const rgb = (hex.length === 3 || hex.length === 4)
      ? hex.slice(0, 3).split("").map((part) => part + part).join("")
      : hex.slice(0, 6);
    const value = Number.parseInt(rgb, 16);
    if (Number.isFinite(value)) {
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const rgb = normalized.match(/^rgba?\(\s*([+-]?(?:\d+\.?\d*|\.\d+)%?)\s*[, ]\s*([+-]?(?:\d+\.?\d*|\.\d+)%?)\s*[, ]\s*([+-]?(?:\d+\.?\d*|\.\d+)%?)(?:\s*[,/]\s*[+-]?(?:\d+\.?\d*|\.\d+)%?)?\s*\)$/i);
  if (rgb) {
    const [, r, g, b] = rgb;
    return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
  }
  const hsl = normalized.match(/^hsla?\(\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*,|\s)\s*([^, /]+)(?:\s*[,/]\s*[^)]+)?\s*\)$/i);
  if (hsl) {
    const [, h, s, l] = hsl;
    return alpha >= 1 ? `hsl(${h} ${s} ${l})` : `hsl(${h} ${s} ${l} / ${alpha})`;
  }
  return normalized;
}

function opaqueColor(color: string | undefined): string | undefined {
  return color ? colorWithAlpha(color, 1) : undefined;
}

function anchorTransform(anchor?: string): string | undefined {
  const transforms: Record<string, string> = {
    top_center: "translateX(-50%)",
    top_right: "translateX(-100%)",
    center: "translate(-50%, -50%)",
    bottom_left: "translateY(-100%)",
    bottom_center: "translate(-50%, -100%)",
    bottom_right: "translate(-100%, -100%)",
  };
  return anchor ? transforms[anchor] : undefined;
}

function rectStyle(rect?: UILayoutRect, componentType?: UILayoutComponentType): CSSProperties {
  if (!rect) return {};
  return {
    position: "absolute",
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
    right: "auto",
    bottom: "auto",
    transform: anchorTransform(rect.anchor),
  };
}

export type UILayoutSource = "safe_clamped" | "desktop";
export type UILayoutVisualMode = "default_frame" | "image_owned" | "missing_asset_fallback";

interface ResolvedLayoutGeometry {
  rect?: UILayoutRect;
  source: UILayoutSource;
}

const safeAreaExemptTypes = new Set<UILayoutComponentType>(["stage_background"]);

function anchorFactor(anchor?: string): { x: number; y: number } {
  return {
    x: anchor === "top_center" || anchor === "bottom_center" || anchor === "center" ? 0.5 : anchor === "top_right" || anchor === "bottom_right" ? 1 : 0,
    y: anchor === "bottom_left" || anchor === "bottom_center" || anchor === "bottom_right" ? 1 : anchor === "center" ? 0.5 : 0,
  };
}

function clampRectToBounds(rect: UILayoutRect, bounds: UILayoutRect): { rect: UILayoutRect; changed: boolean } {
  const factor = anchorFactor(rect.anchor);
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  const visualLeft = rect.x - width * factor.x;
  const visualTop = rect.y - height * factor.y;
  const left = clamp(visualLeft, bounds.x, bounds.x + bounds.width - width);
  const top = clamp(visualTop, bounds.y, bounds.y + bounds.height - height);
  const next = {
    ...rect,
    x: left + width * factor.x,
    y: top + height * factor.y,
    width,
    height,
  };
  const changed = ["x", "y", "width", "height"].some((field) => Math.abs(Number(next[field as keyof UILayoutRect]) - Number(rect[field as keyof UILayoutRect])) > 0.001);
  return { rect: next, changed };
}

function resolveLayoutGeometry(
  screenId: UILayoutScreenId,
  component: UILayoutComponent | undefined,
  breakpoint: UILayoutBreakpoint,
  safeBounds: UILayoutRect,
): ResolvedLayoutGeometry {
  if (!component) return { source: "desktop" };
  // Every platform renders the same PC-authored rectangle. Safe-area insets
  // must never rewrite the visual geometry: the authored PC layout is the
  // source of truth, while touch targets may be expanded independently by
  // platform interaction styles.
  const sourceRect = component.rect;
  if (!sourceRect) {
    return { source: "desktop" };
  }
  return { rect: sourceRect, source: "desktop" };
}

interface UILayoutRuntimeAssets {
  manifest?: GameManifest;
  assetUrls?: Record<string, string>;
  uiAssetUrls?: Record<string, string>;
}

function componentStyle(
  componentType: UILayoutComponentType,
  style: UILayoutComponentStyle | undefined,
  runtimeAssets: UILayoutRuntimeAssets,
  scale: number,
  fontScale: number,
  textScale: RuntimeTextScale,
  visualMode: UILayoutVisualMode = "default_frame",
): CSSProperties {
  const quickMenuSafetyStyle = {};
  if (componentType === "mask") {
    const maskMode = style?.maskMode ?? "blur";
    const resolvedMaskImage = style?.backgroundImage
      ? resolveUILayoutAssetUrl(style.backgroundImage, runtimeAssets.manifest, runtimeAssets.assetUrls, runtimeAssets.uiAssetUrls)
      : undefined;
    return {
      backgroundColor: resolvedMaskImage ? undefined : (style?.backgroundColor ?? "rgba(8, 13, 22, 0.62)"),
      backgroundImage: resolvedMaskImage ? `url("${cssUrl(resolvedMaskImage)}")` : undefined,
      ...(resolvedMaskImage ? backgroundFitStyle(style?.backgroundFit ?? "cover") : {}),
      opacity: style?.opacity ?? 1,
      borderColor: style?.borderColor ?? "rgba(255, 255, 255, 0.18)",
      borderWidth: `${Math.max(0, style?.borderWidth ?? 1)}px`,
      borderStyle: "solid",
      borderRadius: `${clamp(style?.borderRadius ?? 12, 0, 96)}px`,
      boxShadow: style?.shadow === "none"
        ? "none"
        : style?.shadow === "strong"
          ? "0 18px 48px rgba(0,0,0,0.34)"
          : "0 12px 30px rgba(0,0,0,0.24)",
      backdropFilter: maskMode === "blur" ? `blur(${clamp(style?.backdropBlur ?? 12, 0, 48)}px)` : "none",
      WebkitBackdropFilter: maskMode === "blur" ? `blur(${clamp(style?.backdropBlur ?? 12, 0, 48)}px)` : "none",
      pointerEvents: "none",
      overflow: "hidden",
    } as CSSProperties;
  }
  if (!style) return quickMenuSafetyStyle as CSSProperties;
  const useStrictDialogSizing = strictPlayerComponentTypes.has(componentType);
  const componentFontFamily = fontFamilyForAsset(style.fontAssetId);
  const componentFontScale = strictPlayerComponentTypes.has(componentType)
    ? textScale.dialogFontScale
    : componentType === "choice_option"
      ? textScale.choiceFontScale
      : fontScale;
  const componentFontSize = scalePx(style.fontSize, componentFontScale);
  const mainMenuHeroTypography = componentType === "main_menu_hero" ? {
    "--runtime-main-menu-hero-color": style.color,
    "--runtime-main-menu-hero-label-font-size": componentFontSize ? `clamp(10px, calc(${componentFontSize} * 0.72), 18px)` : undefined,
    "--runtime-main-menu-hero-title-font-size": componentFontSize ? `clamp(24px, calc(${componentFontSize} * 2.6), 96px)` : undefined,
    "--runtime-main-menu-hero-body-font-size": componentFontSize,
    "--runtime-main-menu-hero-font-weight": style.fontWeight,
  } : {};
  const resolvedBackgroundImage = resolveUILayoutAssetUrl(
    style.backgroundImage,
    runtimeAssets.manifest,
    runtimeAssets.assetUrls,
    runtimeAssets.uiAssetUrls,
  );
  const backgroundImage = resolvedBackgroundImage
    ? `url("${cssUrl(resolvedBackgroundImage)}")`
    : undefined;
  const imageOwned = visualMode === "image_owned";
  const frameReset = imageOwned ? {
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: "0px",
    boxShadow: "none",
    backdropFilter: "none",
  } : {};
  const imageFitStyle = backgroundImage ? backgroundFitStyle(style.backgroundFit) : {};
  if (componentType === "quick_menu") {
    const quickOpacity = clamp(resolveUILayoutBackgroundOpacity(componentType, style), 0, 1);
    const localBackground = style.backgroundColor ? colorWithAlpha(style.backgroundColor, quickOpacity) : undefined;
    const solidLocalBackground = opaqueColor(style.backgroundColor);
    const solidLocalAccent = opaqueColor(style.accentColor ?? style.backgroundColor);
    const themeQuickBackground = "var(--runtime-quick-menu, var(--runtime-surface-solid, var(--surface-2)))";
    const themeControlBackground = "var(--runtime-control-solid, var(--surface-2))";
    const themeBorder = "var(--line)";
    const quickPadding = typeof style.padding === "number" ? `${Math.round(clamp(style.padding, 3, 10) * 100) / 100}px` : undefined;
    const quickGap = typeof style.gap === "number" ? `${Math.round(clamp(style.gap, 2, 8) * 100) / 100}px` : undefined;
    const quickRadius = typeof style.borderRadius === "number"
      ? (useStrictDialogSizing ? `${style.borderRadius}px` : scalePx(style.borderRadius, scale))
      : undefined;
    const quickBlur = typeof style.backdropBlur === "number"
      ? `${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px`
      : undefined;
    return {
      "--runtime-quick-menu-padding": quickPadding,
      "--runtime-quick-menu-gap": quickGap,
      "--runtime-quick-menu-skin-background": style.backgroundColor ?? themeQuickBackground,
      "--runtime-quick-menu-skin-border": style.borderColor ?? themeBorder,
      "--runtime-quick-menu-skin-radius": quickRadius,
      "--runtime-quick-menu-skin-blur": quickBlur,
      "--runtime-quick-menu-material-alpha": `${Math.round(quickOpacity * 10_000) / 100}%`,
      "--runtime-quick-menu-direction": style.quickMenuDirection ?? "auto",
      "--runtime-quick-menu-variant": normalizeQuickMenuVariant(style.quickMenuVariant),
      "--runtime-quick-menu-surface-saturation": "0.5",
      "--runtime-control-active": solidLocalAccent,
      "--runtime-control-active-solid": solidLocalAccent,
      "--runtime-control": solidLocalBackground,
      "--runtime-control-solid": solidLocalBackground,
      "--runtime-control-hover": solidLocalAccent ?? solidLocalBackground,
      "--runtime-control-hover-solid": solidLocalAccent ?? solidLocalBackground,
      "--runtime-quick-menu-action-background": solidLocalBackground ?? themeControlBackground,
      "--runtime-quick-menu-action-border": style.borderColor ?? themeBorder,
      "--runtime-control-text": style.color,
      backgroundColor: backgroundImage ? undefined : localBackground,
      backgroundImage,
      ...imageFitStyle,
      color: style.color,
      borderColor: style.borderColor,
      borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
      borderRadius: quickRadius,
      "--runtime-quick-menu-opacity": quickOpacity,
      fontFamily: componentFontFamily,
      fontSize: componentFontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      boxShadow: style.shadow === "none" ? "none" : style.shadow === "soft" ? "0 10px 24px rgba(0,0,0,0.24)" : style.shadow === "strong" ? "0 16px 40px rgba(0,0,0,0.36)" : undefined,
      backdropFilter: quickBlur ? `blur(${quickBlur})` : undefined,
      WebkitBackdropFilter: quickBlur ? `blur(${quickBlur})` : undefined,
      textAlign: style.textAlign,
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  if (titleButtonComponentTypes.has(componentType) || componentType === "quick_button") {
    const quickButton = componentType === "quick_button";
    const quickButtonOpacity = clamp(resolveUILayoutBackgroundOpacity(componentType, style), 0, 1);
    const localBackground = opaqueColor(style.backgroundColor);
    const localMaterialBackground = quickButton && style.backgroundColor
      ? colorWithAlpha(style.backgroundColor, quickButtonOpacity)
      : localBackground;
    const localAccent = opaqueColor(style.accentColor ?? style.backgroundColor);
    const themeControlBackground = "var(--runtime-control-solid, var(--surface-2))";
    const themeBorder = "var(--line)";
    const themeText = "var(--runtime-control-text, var(--ink))";
    const quickButtonBlur = quickButton && typeof style.backdropBlur === "number"
      ? `${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px`
      : undefined;
    return {
      "--runtime-choice": localAccent,
      "--runtime-choice-solid": localAccent,
      "--runtime-choice-text": style.color,
      "--runtime-control": localBackground,
      "--runtime-control-solid": localBackground,
      "--runtime-quick-menu-action-background": localBackground ?? themeControlBackground,
      "--runtime-quick-menu-action-border": style.borderColor ?? themeBorder,
      "--runtime-quick-menu-action-alpha": quickButton ? `${Math.round(quickButtonOpacity * 10_000) / 100}%` : undefined,
      "--runtime-quick-menu-action-blur": quickButtonBlur,
      "--runtime-quick-menu-action-radius": quickButton && typeof style.borderRadius === "number"
        ? (useStrictDialogSizing ? `${style.borderRadius}px` : scalePx(style.borderRadius, scale))
        : undefined,
      "--runtime-control-hover": localAccent,
      "--runtime-control-hover-solid": localAccent,
      "--runtime-control-active": localAccent,
      "--runtime-control-active-solid": localAccent,
      "--runtime-control-text": style.color ?? undefined,
      backgroundColor: backgroundImage ? undefined : localMaterialBackground,
      backgroundImage,
      ...imageFitStyle,
      color: style.color,
      borderColor: style.borderColor,
      borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
      borderRadius: useStrictDialogSizing ? (typeof style.borderRadius === "number" ? `${style.borderRadius}px` : undefined) : scalePx(style.borderRadius, scale),
      "--runtime-button-opacity": 1,
      fontFamily: componentFontFamily,
      fontSize: componentFontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      padding: useStrictDialogSizing ? (typeof style.padding === "number" ? `${style.padding}px` : undefined) : scalePx(style.padding, scale),
      gap: useStrictDialogSizing ? (typeof style.gap === "number" ? `${style.gap}px` : undefined) : scalePx(style.gap, scale),
      boxShadow: style.shadow === "none" ? "none" : style.shadow === "soft"
        ? "0 10px 24px rgba(0,0,0,0.24)"
        : style.shadow === "strong"
          ? "0 16px 40px rgba(0,0,0,0.36)"
          : undefined,
      backdropFilter: quickButtonBlur
        ? `blur(${quickButtonBlur})`
        : typeof style.backdropBlur === "number"
          ? `blur(${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px)`
          : undefined,
      WebkitBackdropFilter: quickButtonBlur
        ? `blur(${quickButtonBlur})`
        : typeof style.backdropBlur === "number"
          ? `blur(${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px)`
          : undefined,
      textAlign: style.textAlign,
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  if (componentType === "choice_list") {
    return {
      "--runtime-choice-local-bg": style.backgroundColor ? colorWithAlpha(style.backgroundColor, resolveUILayoutBackgroundOpacity(componentType, style)) : undefined,
      "--runtime-choice-local-text": style.color,
      "--runtime-choice-local-border": style.borderColor,
      "--runtime-choice-local-accent": style.accentColor,
      "--runtime-choice-local-radius": scalePx(style.borderRadius, scale),
      "--runtime-choice-local-padding": scalePx(style.padding, scale),
      "--runtime-choice-local-font-size": scalePx(style.fontSize, fontScale),
      "--runtime-choice-local-font-weight": style.fontWeight,
      "--runtime-choice-local-gap": scalePx(style.gap, scale),
      "--runtime-choice-local-shadow": style.shadow === "none" ? "none" : style.shadow === "soft" ? "0 10px 24px rgba(0,0,0,0.2)" : style.shadow === "strong" ? "0 16px 40px rgba(0,0,0,0.32)" : undefined,
      "--runtime-choice-option-background-image": backgroundImage,
      "--runtime-choice-option-background-size": imageFitStyle.backgroundSize,
      "--runtime-choice-option-background-repeat": imageFitStyle.backgroundRepeat,
      "--runtime-choice-option-background-position": imageFitStyle.backgroundPosition,
      gap: scalePx(style.gap, scale),
      fontFamily: componentFontFamily,
      textAlign: style.textAlign,
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  const separatedOpacity = supportsUILayoutOpacityLayers(componentType) && hasUILayoutOpacityLayers(style);
  return {
    "--runtime-choice": style.accentColor,
    "--runtime-control-active": style.accentColor,
    "--runtime-slider-active": style.accentColor,
    "--runtime-slider-track": style.borderColor,
    "--runtime-slider-thumb": style.backgroundColor,
    backgroundColor: style.backgroundColor
      ? separatedOpacity
        ? style.backgroundColor
        : colorWithAlpha(style.backgroundColor, resolveUILayoutBackgroundOpacity(componentType, style))
      : undefined,
    backgroundImage,
    ...imageFitStyle,
    color: style.color,
    borderColor: style.borderColor,
    borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
    borderRadius: useStrictDialogSizing ? (typeof style.borderRadius === "number" ? `${style.borderRadius}px` : undefined) : scalePx(style.borderRadius, scale),
    opacity: separatedOpacity ? undefined : style.opacity,
    ...(separatedOpacity ? {
      "--ui-layout-background-opacity": style.backgroundOpacity
        ?? (style.backgroundColor ? resolveUILayoutBackgroundOpacity(componentType, style) : style.opacity ?? 1),
      "--ui-layout-content-opacity": style.contentOpacity ?? style.opacity ?? 1,
    } : {}),
    fontFamily: componentFontFamily,
    fontSize: componentFontSize,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    padding: useStrictDialogSizing ? (typeof style.padding === "number" ? `${style.padding}px` : undefined) : scalePx(style.padding, scale),
    gap: useStrictDialogSizing ? (typeof style.gap === "number" ? `${style.gap}px` : undefined) : scalePx(style.gap, scale),
    boxShadow: style.shadow === "none" ? "none" : style.shadow === "soft" ? "0 18px 46px rgba(0,0,0,0.28)" : style.shadow === "strong" ? "0 24px 80px rgba(0,0,0,0.44)" : undefined,
    backdropFilter: typeof style.backdropBlur === "number" ? `blur(${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px)` : undefined,
    textAlign: style.textAlign,
    gridTemplateColumns: typeof style.columns === "number" ? `repeat(${Math.max(1, Math.round(style.columns))}, minmax(0, 1fr))` : undefined,
    ...mainMenuHeroTypography,
    ...quickMenuSafetyStyle,
    "--runtime-frame-mode": visualMode,
    ...frameReset,
  } as unknown as CSSProperties;
}

function resolveVisualMode(
  componentType: UILayoutComponentType | undefined,
  style: UILayoutComponentStyle | undefined,
  runtimeAssets: UILayoutRuntimeAssets,
): UILayoutVisualMode {
  if (!style?.backgroundImage || !["dialog_panel", "choice_list", "choice_option", "quick_button", "main_menu_custom_button"].includes(componentType ?? "")) return "default_frame";
  return resolveUILayoutAssetUrl(style.backgroundImage, runtimeAssets.manifest, runtimeAssets.assetUrls, runtimeAssets.uiAssetUrls)
    ? "image_owned"
    : "missing_asset_fallback";
}

function findComponent(skin: UISkinLayout, screenId: UILayoutScreenId, componentType: UILayoutComponentType): UILayoutComponent | undefined {
  const screen = skin.screens.find((item) => item.screen_id === screenId);
  return screen?.components.find((item) => item.component_type === componentType);
}

function findComponents(skin: UISkinLayout, screenId: UILayoutScreenId, componentType: UILayoutComponentType): UILayoutComponent[] {
  const screen = skin.screens.find((item) => item.screen_id === screenId);
  return screen?.components.filter((item) => item.component_type === componentType) ?? [];
}

function findComponentById(skin: UISkinLayout, screenId: UILayoutScreenId, componentId: string): UILayoutComponent | undefined {
  const screen = skin.screens.find((item) => item.screen_id === screenId);
  return screen?.components.find((item) => item.component_id === componentId);
}

function buildUILayoutStyle(
  component: UILayoutComponent | undefined,
  componentType: UILayoutComponentType | undefined,
  breakpoint: "desktop" | "mobile",
  runtimeAssets: UILayoutRuntimeAssets,
  scale: number,
  fontScale: number
  , resolvedRect?: UILayoutRect,
  visualMode: UILayoutVisualMode = "default_frame",
  textScale?: RuntimeTextScale
): CSSProperties {
  const rect = resolvedRect ?? component?.rect;
  return {
    display: component?.visible === false ? "none" : undefined,
    ...rectStyle(rect, componentType),
    ...(componentType ? componentStyle(componentType, component?.style, runtimeAssets, scale, fontScale, textScale ?? { platform: "web", uiScale: scale, fontScale, dialogFontScale: fontScale, choiceFontScale: fontScale, fontSource: "desktop_viewport" }, visualMode) : {}),
    zIndex: componentType === "mask"
      ? undefined
      : componentType === "stage_background"
        ? Math.min(component?.zIndex ?? 0, 9)
        : componentType && titleMenuButtonComponentTypes.has(componentType)
          ? Math.max(component?.zIndex ?? 30, 30)
        : Math.max(component?.zIndex ?? 20, 20),
  };
}

export function UISkinProvider({ children }: { children: ReactNode }) {
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const playerRatio = useSettingsStore((state) => state.activeInstallId === currentGame?.install_id
    && state.activeGameId === currentGame?.game_id
    ? state.settings.gameAspectRatio : "default");
  const scopeRef = useRef<HTMLDivElement>(null);
  const viewport = useRuntimeViewport(scopeRef);
  const { breakpoint, orientation, platform, formFactor, safeInsets } = viewport;
  const skin = useMemo(() => {
    const authored = normalizeUISkinLayoutForRuntime(currentGame?.uiSkin).layout;
    if (playerRatio === "default") return authored;
    const { aspectRatio } = resolvePlayerGameViewport(authored.gameViewport, playerRatio);
    return { ...authored, gameViewport: { aspectRatio } };
  }, [currentGame?.uiSkin, playerRatio]);
  const design = resolveGameViewport(skin.gameViewport);
  const scale = layoutScale(breakpoint, formFactor, viewport.width, viewport.height, design);
  const textScale = resolveRuntimeTextScale(platform, formFactor, scale);
  const fontScale = textScale.fontScale;
  const touchScale = formFactor === "handheld" ? clamp(scale, 0.95, 1.05) : clamp(scale, 0.9, 1.36);
  const frame = fitGameViewport(viewport, design);
  const frameInsets = gameFrameSafeInsets(frame, safeInsets);
  const safeLeft = frameInsets.left / frame.width * 100;
  const safeRight = frameInsets.right / frame.width * 100;
  const safeTop = frameInsets.top / frame.height * 100;
  const safeBottom = frameInsets.bottom / frame.height * 100;
  const safeMargin = formFactor === "handheld" ? 0.6 : 0;
  const safeBounds = {
    x: safeLeft + safeMargin,
    y: safeTop + safeMargin,
    width: Math.max(10, 100 - safeLeft - safeRight - safeMargin * 2),
    height: Math.max(10, 100 - safeTop - safeBottom - safeMargin * 2),
  };
  useEffect(() => {
    const fontAssets = currentGame?.manifest.assets
      .filter((asset) => asset.asset_type === "font")
      ?? [];
    if (fontAssets.length === 0) return;
    const rules = fontAssets
      .map((asset) => {
        const source = toRuntimeAssetUrl(currentGame?.assetUrls[asset.asset_id] ?? currentGame?.assetUrls[asset.path]);
        if (!source) return undefined;
        return runtimeFontFaceRule(asset.asset_id, asset.filename, asset.mime_type, source);
      })
      .filter(Boolean)
      .join("\n");
    if (!rules) return;
    const node = document.createElement("style");
    node.dataset.agentvnRuntimeFonts = currentGame?.install_id ?? "runtime";
    node.textContent = rules;
    document.head.appendChild(node);
    return () => node.remove();
  }, [currentGame]);
  useLandscapeLock(formFactor === "handheld" && (platform === "android" || platform === "ios"));
  return <UISkinContext.Provider value={{ skin, breakpoint, orientation, scale, fontScale, touchScale, platform, formFactor, safeInsets, safeBounds, textScale, viewportWidth: viewport.width, viewportHeight: viewport.height, viewportReady: viewport.ready, viewportPhase: viewport.phase, scopeRef }}>{children}</UISkinContext.Provider>;
}

export function UILayoutMaskLayer({ screen }: { screen: UILayoutScreenId }) {
  const { skin, breakpoint, scale, fontScale, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore(state => state.currentGame);
  const masks = findComponents(skin, screen, "mask");
  if (!masks.length || screen === "title") return null;
  return <div className="runtime-layout-masks" aria-hidden="true" data-ui-mask-layer={screen}>
    {masks.map((mask, index) => {
      const geometry = resolveLayoutGeometry(screen, mask, breakpoint, { x: 0, y: 0, width: 100, height: 100 });
      const maskStyle = buildUILayoutStyle(mask, "mask", breakpoint, currentGame ?? {}, scale, fontScale,
        geometry.rect, "default_frame", textScale);
      return <PresentedControl key={mask.component_id} layout={skin} component={mask}
        assetUrls={currentGame?.assetUrls} applyBaseStyle={false}>
        <div className="runtime-layout-mask" data-ui-mask-id={mask.component_id}
        data-ui-mask-mode={mask.style?.maskMode ?? "blur"}
        style={{ ...maskStyle, zIndex: index, display: mask.visible === false ? "none" : maskStyle.display }} />
      </PresentedControl>;
    })}
  </div>;
}

export function UISkinScreen({ screen, children }: { screen: UILayoutScreenId; children: ReactNode }) {
  const { skin, breakpoint, orientation, scale, fontScale, touchScale, platform, formFactor, safeInsets, textScale, viewportWidth, viewportHeight, viewportReady, viewportPhase, scopeRef } = useContext(UISkinContext);
  const frameRef = useRef<HTMLDivElement>(null);
  const design = resolveGameViewport(skin.gameViewport);
  const frame = fitGameViewport({ width: viewportWidth, height: viewportHeight }, design);
  const frameInsets = gameFrameSafeInsets(frame, safeInsets);
  useLayoutEffect(() => {
    if (CSS.supports("width", "1cqw")) return;
    const frame = frameRef.current;
    const scope = frame?.parentElement;
    if (!frame || !scope) return;
    // Older engines have no container units. Measure the actual containing
    // scope, never the browser window or a stale pre-lazy-mount viewport.
    const measure = () => {
      const rect = scope.getBoundingClientRect();
      const { width, height } = fitGameViewport(rect, design);
      frame.style.setProperty("--runtime-legacy-frame-width", `${width}px`);
      frame.style.setProperty("--runtime-legacy-frame-height", `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scope);
    return () => observer.disconnect();
  }, [design.ratio]);
  const stableAndroidViewportStyle: CSSProperties = platform === "android" && viewportReady
    ? {
        width: `${viewportWidth}px`,
        height: `${viewportHeight}px`,
        minWidth: 0,
        minHeight: 0,
        maxWidth: `${viewportWidth}px`,
        maxHeight: `${viewportHeight}px`,
      }
    : {};
  return (
    <div
        ref={scopeRef}
      className="ui-skin-scope"
      data-ui-screen={screen}
      data-layout-type={skin.layout_type ?? "agentvn"}
      data-game-aspect-ratio={design.aspectRatio}
      data-ui-breakpoint={breakpoint}
      data-ui-design={platform === "android" || platform === "ios" ? "pc" : breakpoint}
      data-ui-orientation={orientation}
      data-runtime-platform={platform}
      data-ui-form-factor={formFactor}
      data-runtime-safe-revision={safeInsets.top + safeInsets.right + safeInsets.bottom + safeInsets.left}
      data-ui-platform={platform}
      data-ui-text-scale={textScale.fontScale}
      data-ui-font-source={textScale.fontSource}
      data-ui-viewport-ready={viewportReady ? "true" : "false"}
      data-ui-viewport-phase={viewportPhase}
      style={{ ...tokenStyle(skin), ...runtimeFrameStyle(scale, fontScale, touchScale, frameInsets, design, frame), ...stableAndroidViewportStyle }}
    >
      <div ref={frameRef} className="runtime-layout-frame" data-ui-screen-frame={screen}>
        <UILayoutMaskLayer screen={screen} />
        {children}
        {screen !== "player" && <RuntimeCustomComponentLayer screen={screen} />}
      </div>
    </div>
  );
}

export function useResolvedUILayoutStyle(
  screenId: UILayoutScreenId,
  componentType: UILayoutComponentType,
  overrideStyle?: UILayoutComponentStyle,
): { style: CSSProperties; component?: UILayoutComponent; rect?: UILayoutRect; layoutSource: UILayoutSource; visualMode: UILayoutVisualMode; textScale: RuntimeTextScale } {
  const { skin, breakpoint, scale, fontScale, safeBounds, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const baseComponent = findComponent(skin, screenId, componentType);
  const component = overrideStyle
    ? {
        ...(baseComponent ?? {
          component_id: `${screenId}_${componentType}`,
          component_type: componentType,
        }),
        style: {
          ...(baseComponent?.style ?? {}),
          ...overrideStyle,
        },
      }
    : baseComponent;
  const geometry = resolveLayoutGeometry(screenId, component, breakpoint, safeBounds);
  const visualMode = resolveVisualMode(componentType, component?.style, currentGame ?? {});
  return {
    component,
    rect: geometry.rect,
    layoutSource: geometry.source,
    visualMode,
    textScale,
    style: buildUILayoutStyle(component, componentType, breakpoint, currentGame ?? {}, scale, fontScale, geometry.rect, visualMode, textScale),
  };
}

export function useUILayoutSafeBounds(): UILayoutRect {
  return useContext(UISkinContext).safeBounds;
}

export function useUILayoutFormFactor(): RuntimeFormFactor {
  return useContext(UISkinContext).formFactor;
}

export function useRuntimeUILayout(): UISkinLayout {
  return useContext(UISkinContext).skin;
}

export function useRenpyButtonStateStyle(
  layoutOverride?: UISkinLayout,
  assetUrlsOverride?: Record<string, string | undefined>,
  frameScaleOverride?: number | string,
): CSSProperties {
  const { skin: contextSkin, scale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const skin = layoutOverride ?? contextSkin;
  return useMemo(() => {
    const images = skin.renpy?.shared?.buttonImages;
    const textColors = skin.renpy?.shared?.buttonTextColors;
    const borders = skin.renpy?.shared?.buttonBorders;
    const ink = skin.tokens.colorInk ?? "#ffffff";
    const accent = skin.tokens.colorAccent ?? "#00b8c3";
    const line = skin.tokens.colorLine ?? ink;
    const frameScale = frameScaleOverride ?? scale;
    const resolve = (reference?: string) => {
      if (!reference) return undefined;
      const assetId = assetIdFromUILayoutReference(reference);
      const previewUrl = assetId ? assetUrlsOverride?.[assetId] : undefined;
      return previewUrl
        ? toRuntimeAssetUrl(previewUrl)
        : resolveUILayoutAssetUrl(reference, currentGame?.manifest, currentGame?.assetUrls, currentGame?.uiAssetUrls);
    };
    const normal = resolve(images?.normal);
    const hover = resolve(images?.hover) ?? normal;
    const selected = resolve(images?.selected) ?? hover;
    const disabled = resolve(images?.disabled) ?? normal;
    const cssImage = (url?: string) => url ? `url("${cssUrl(url)}")` : "none";
    return {
      "--renpy-button-image-normal": cssImage(normal),
      "--renpy-button-image-hover": cssImage(hover),
      "--renpy-button-image-selected": cssImage(selected),
      "--renpy-button-image-disabled": cssImage(disabled),
      "--renpy-button-text-normal": textColors?.normal,
      "--renpy-button-text-hover": textColors?.hover,
      "--renpy-button-text-selected": textColors?.selected,
      "--renpy-button-text-disabled": textColors?.disabled,
      "--renpy-button-border-slice": borders
        ? `${borders.top} ${borders.right} ${borders.bottom} ${borders.left}`
        : undefined,
      "--renpy-button-border-width": borders
        ? [borders.top, borders.right, borders.bottom, borders.left]
          .map((edge) => `calc(${edge}px * ${frameScale})`).join(" ")
        : "0",
      "--renpy-button-border-repeat": skin.renpy?.shared?.buttonTile ? "repeat" : "stretch",
      "--renpy-button-background-size": skin.renpy?.shared?.buttonTile ? "auto" : "100% 100%",
      "--renpy-button-background-repeat": skin.renpy?.shared?.buttonTile ? "repeat" : "no-repeat",
      "--renpy-default-button-border": colorWithAlpha(line, 0.72),
      "--renpy-default-button-wash": colorWithAlpha(ink, 0.045),
      "--renpy-default-button-hover-border": colorWithAlpha(accent, 0.9),
      "--renpy-default-button-hover-wash": colorWithAlpha(accent, 0.13),
      "--renpy-default-button-selected-wash": colorWithAlpha(accent, 0.18),
    } as CSSProperties;
  }, [assetUrlsOverride, currentGame, frameScaleOverride, scale, skin.renpy]);
}

export function useRenpyButtonRoleStyle(
  role: RenpyButtonRole,
  page: RenpyButtonRolePage,
  frameScaleOverride?: number | string,
  skinOverride?: UISkinLayout,
): {
  enabled: boolean;
  styled: boolean;
  bordered: boolean;
  opacityConfigured: boolean;
  geometry: ResolvedRenpyButtonRole["geometry"];
  style: CSSProperties;
} {
  const { skin: contextSkin, scale } = useContext(UISkinContext);
  const skin = skinOverride ?? contextSkin;
  const frameScale = frameScaleOverride ?? scale;
  return useMemo(() => {
    const resolved = resolveRenpyButtonRole(skin.renpy, role, page);
    const configured = Boolean(skin.renpy?.shared?.buttonRoles?.[role]
      || skin.renpy?.[page]?.buttonRoles?.[role]);
    if (skin.layout_type !== "renpy" || !configured)
      return { enabled: false, styled: false, bordered: false, opacityConfigured: false, geometry: resolved.geometry, style: {} };
    const styled = RENPY_BUTTON_STATES.some((state) => {
      const value = resolved.states[state];
      return value.textColor !== undefined || value.backgroundColor !== undefined;
    });
    const bordered = RENPY_BUTTON_STATES.some((state) => {
      const value = resolved.states[state];
      return value.borderColor !== undefined || value.borderWidth !== undefined;
    });
    const opacityConfigured = RENPY_BUTTON_STATES.some(state => resolved.states[state].opacity !== undefined);
    const scaled = (value: number) => typeof frameScale === "number"
      ? `${value * frameScale}px`
      : `calc(${value}px * ${frameScale})`;
    const style: Record<string, string | undefined> = {
      "--renpy-role-width": resolved.sizing.width === "content" ? "max-content" : scaled(resolved.geometry.width),
      "--renpy-role-height": resolved.sizing.height === "content" ? "auto" : scaled(resolved.geometry.height),
      "--renpy-role-min-width": resolved.sizing.width === "content" ? scaled(resolved.geometry.width) : "0px",
      "--renpy-role-min-height": resolved.sizing.height === "content" ? scaled(resolved.geometry.height) : "0px",
      "--renpy-role-font-size": scaled(resolved.geometry.fontSize),
      "--renpy-role-padding-x": scaled(resolved.geometry.paddingX),
      "--renpy-role-padding-y": scaled(resolved.geometry.paddingY),
    };
    for (const state of RENPY_BUTTON_STATES) {
      const stateStyle = resolved.states[state];
      const prefix = `--renpy-role-${state}`;
      style[`${prefix}-text`] = stateStyle.textColor;
      style[`${prefix}-background`] = stateStyle.backgroundColor;
      style[`${prefix}-border`] = stateStyle.borderColor;
      style[`${prefix}-border-width`] = stateStyle.borderWidth === undefined ? undefined : scaled(stateStyle.borderWidth);
      style[`${prefix}-opacity`] = stateStyle.opacity === undefined ? undefined : String(stateStyle.opacity);
    }
    return { enabled: true, styled, bordered, opacityConfigured, geometry: resolved.geometry, style: style as CSSProperties };
  }, [frameScale, page, role, skin.layout_type, skin.renpy]);
}

export function useUILayoutFrameSize(): { width: number; height: number } {
  const { skin, viewportWidth, viewportHeight } = useContext(UISkinContext);
  const { width, height } = fitGameViewport(
    { width: viewportWidth, height: viewportHeight }, resolveGameViewport(skin.gameViewport),
  );
  return { width, height };
}

export function useConfirmationLayoutStyle() {
  const { skin, scale, fontScale, textScale } = useContext(UISkinContext);
  const game = useRuntimeStore(state => state.currentGame);
  const config = skin.confirmationLayout;
  const convert = (style: UILayoutComponentStyle | undefined): CSSProperties =>
    Object.fromEntries(Object.entries(componentStyle("about_panel", style, {
      manifest: game?.manifest, assetUrls: game?.assetUrls, uiAssetUrls: game?.uiAssetUrls,
    }, scale, fontScale, textScale)).filter(([, value]) => value !== undefined));
  const rect = config?.rect;
  return {
    configured: Boolean(config && Object.keys(config).length),
    panelStyle: {
      ...rectStyle(rect),
      ...convert(config?.panelStyle),
      ...(rect ? { maxWidth: "none", maxHeight: "none" } : {}),
    },
    titleStyle: convert(config?.titleStyle),
    textStyle: convert(config?.textStyle),
  };
}

export function useDialogueModeLayoutStyle(mode: DialogueLayoutMode) {
  const { skin, scale, fontScale, textScale } = useContext(UISkinContext);
  const game = useRuntimeStore(state => state.currentGame);
  const config = mode === "dialog" ? undefined : skin.dialogueLayouts?.[mode];
  const resolved = mode !== "dialog" && config ? resolveDialogueModeLayout(skin, mode) : undefined;
  const convert = (style: UILayoutComponentStyle | undefined, type: UILayoutComponentType): CSSProperties =>
    Object.fromEntries(Object.entries(componentStyle(type, style, {
      manifest: game?.manifest, assetUrls: game?.assetUrls, uiAssetUrls: game?.uiAssetUrls,
    }, scale, fontScale, textScale)).filter(([, value]) => value !== undefined));
  return {
    config,
    panelStyle: convert(resolved?.panelStyle, "dialog_panel"),
    textStyle: convert(resolved?.textStyle, "dialog_text"),
    speakerStyle: convert(resolved?.speakerStyle, "speaker_label"),
    rectStyle: rectStyle(config?.rect),
  };
}

export function useUILayoutStyle(screenId: UILayoutScreenId, componentType: UILayoutComponentType): { style: CSSProperties; component?: UILayoutComponent; rect?: UILayoutRect; layoutSource: UILayoutSource; visualMode: UILayoutVisualMode; textScale: RuntimeTextScale } {
  return useResolvedUILayoutStyle(screenId, componentType);
}

export function useUILayoutComponentStyle(screenId: UILayoutScreenId, componentId: string, fallbackType?: UILayoutComponentType): { style: CSSProperties; component?: UILayoutComponent; rect?: UILayoutRect; layoutSource: UILayoutSource; visualMode: UILayoutVisualMode; textScale: RuntimeTextScale } {
  const { skin, breakpoint, scale, fontScale, safeBounds, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const component = findComponentById(skin, screenId, componentId)
    ?? (fallbackType ? findComponent(skin, screenId, fallbackType) : undefined);
  const componentType = component?.component_type ?? fallbackType;
  const geometry = resolveLayoutGeometry(screenId, component, breakpoint, safeBounds);
  const visualMode = resolveVisualMode(componentType, component?.style, currentGame ?? {});
  return {
    component,
    rect: geometry.rect,
    layoutSource: geometry.source,
    visualMode,
    textScale,
    style: buildUILayoutStyle(component, componentType, breakpoint, currentGame ?? {}, scale, fontScale, geometry.rect, visualMode, textScale),
  };
}

export interface ResolvedUILayoutComponent {
  component: UILayoutComponent;
  rect?: UILayoutRect;
  style: CSSProperties;
  layoutSource: UILayoutSource;
  visualMode: UILayoutVisualMode;
  textScale: RuntimeTextScale;
}

export function useUILayoutComponents(
  screenId: UILayoutScreenId,
  componentType: UILayoutComponentType,
): ResolvedUILayoutComponent[] {
  const { skin, breakpoint, scale, fontScale, safeBounds, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  return findComponents(skin, screenId, componentType).map((component) => {
    const geometry = resolveLayoutGeometry(screenId, component, breakpoint, safeBounds);
    const visualMode = resolveVisualMode(componentType, component.style, currentGame ?? {});
    return {
      component,
      rect: geometry.rect,
      layoutSource: geometry.source,
      visualMode,
      textScale,
      style: buildUILayoutStyle(component, componentType, breakpoint, currentGame ?? {}, scale, fontScale, geometry.rect, visualMode, textScale),
    };
  });
}

export interface ResolvedUILayoutMask {
  component: UILayoutComponent;
  rect?: UILayoutRect;
  style: CSSProperties;
}

export function useUILayoutMasks(screenId: UILayoutScreenId): ResolvedUILayoutMask[] {
  const { skin, breakpoint, scale, fontScale, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  return findComponents(skin, screenId, "mask").map((component) => {
    const geometry = resolveLayoutGeometry(screenId, component, breakpoint, { x: 0, y: 0, width: 100, height: 100 });
    return {
      component,
      rect: geometry.rect,
      style: buildUILayoutStyle(
        component,
        "mask",
        breakpoint,
        currentGame ?? {},
        scale,
        fontScale,
        geometry.rect,
        "default_frame",
        textScale,
      ),
    };
  });
}
