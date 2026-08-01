import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { getDefaultUISkinLayout, SAFE_DIALOG_PLAYER_RECTS, type UILayoutBreakpoint, type UILayoutComponent, type UILayoutComponentStyle, type UILayoutComponentType, type UILayoutRect, type UILayoutScreenId, type UISkinLayout } from "../../../shared/cartridge/uiSkin";
import { reportFrontendError } from "../../../shared/logging/frontendErrorLogger";
import { useRuntimeStore } from "../store/runtimeStore";
import { backgroundFitStyle } from "../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../utils/runtimeAssetUrl";
import { resolveUILayoutAssetUrl } from "../utils/uiLayoutAssetUrl";
import type { GameManifest } from "../types/manifest";
import { resolveRuntimeTextScale, useRuntimeViewport, type RuntimeFormFactor, type RuntimePlatform, type RuntimeSafeInsets, type RuntimeTextScale } from "./runtimeViewport";

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
});

const runtimeFontFallback = `Inter, "Segoe UI", system-ui, sans-serif`;

function fontFamilyName(assetId: string): string {
  return `AgentVNFont_${assetId.replace(/[^a-z0-9_-]/gi, "_")}`;
}

export function fontFamilyForAsset(assetId?: string | null): string | undefined {
  const normalized = assetId?.trim();
  if (!normalized) return undefined;
  return `"${fontFamilyName(normalized)}", ${runtimeFontFallback}`;
}

function cssUrl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "");
}

function fontFaceFormat(filename?: string, mimeType?: string): string | undefined {
  const lower = `${filename ?? ""} ${mimeType ?? ""}`.toLowerCase();
  if (lower.includes("woff2")) return "woff2";
  if (lower.includes("woff")) return "woff";
  if (lower.includes("ttf") || lower.includes("truetype")) return "truetype";
  if (lower.includes("otf") || lower.includes("opentype")) return "opentype";
  return undefined;
}

function useLandscapeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const orientation = window.screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
      unlock?: () => void;
    };
    void orientation.lock?.("landscape").catch((error) => {
      reportFrontendError("player.orientation", error, { operation: "lock-landscape" });
    });
    return () => {
      orientation.unlock?.();
    };
  }, [active]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function layoutScale(breakpoint: "desktop" | "mobile", formFactor: RuntimeFormFactor, width: number, height: number): number {
  const landscapeWidth = Math.max(width, height);
  const landscapeHeight = Math.min(width, height);
  const designWidth = breakpoint === "mobile" ? 844 : 1280;
  const designHeight = breakpoint === "mobile" ? 390 : 720;
  const rawScale = Math.min(landscapeWidth / designWidth, landscapeHeight / designHeight);
  return formFactor === "handheld" ? clamp(rawScale, 0.82, 1.12) : clamp(rawScale, 0.72, 1.75);
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
  "main_menu_library_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
  "main_menu_custom_button",
]);

function tokenStyle(skin: UISkinLayout): CSSProperties {
  const tokens = skin.tokens ?? {};
  const runtimeFontFamily = fontFamilyForAsset(tokens.fontAssetId);
  const focusColor = tokens.colorFocus ?? tokens.colorAccent;
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
    "--runtime-panel-text": tokens.colorPanelText ?? tokens.colorInk,
    "--runtime-control": tokens.colorControl ?? tokens.colorSurfaceStrong,
    "--runtime-control-hover": tokens.colorControlHover ?? tokens.colorSurface,
    "--runtime-control-active": tokens.colorControlActive ?? tokens.colorAccent,
    "--runtime-control-text": tokens.colorControlText ?? tokens.colorInk,
    "--runtime-slider-track": tokens.colorSliderTrack ?? tokens.colorLine,
    "--runtime-slider-active": tokens.colorSliderActive ?? tokens.colorControlActive ?? tokens.colorAccent,
    "--runtime-slider-thumb": tokens.colorSliderThumb ?? tokens.colorControl ?? tokens.colorSurfaceStrong,
    "--runtime-dialog": tokens.colorDialog ?? tokens.colorSurface,
    "--runtime-dialog-text": tokens.colorDialogText ?? tokens.colorInk,
    "--runtime-speaker": tokens.colorSpeakerPlate ?? tokens.colorSurfaceStrong,
    "--runtime-speaker-text": tokens.colorSpeakerText ?? tokens.colorAccent,
    "--runtime-choice": tokens.colorChoice ?? tokens.colorAccent,
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

function runtimeFrameStyle(scale: number, fontScale: number, touchScale: number, safeInsets: RuntimeSafeInsets): CSSProperties {
  const themeFontScale = "var(--runtime-theme-font-scale, 1)";
  return {
    "--runtime-frame-aspect": "16 / 9",
    "--runtime-ui-scale": String(scale),
    "--runtime-font-scale": String(fontScale),
    "--runtime-touch-scale": String(touchScale),
    "--runtime-touch-size": `${Math.round(42 * touchScale)}px`,
    "--runtime-page-padding": `${Math.round(28 * scale)}px`,
    "--runtime-dialog-font-size": `calc(${Math.round(22 * fontScale)}px * ${themeFontScale})`,
    "--runtime-body-font-size": `calc(${Math.round(15 * fontScale)}px * ${themeFontScale})`,
    "--runtime-small-font-size": `calc(${Math.round(12 * fontScale)}px * ${themeFontScale})`,
    "--runtime-safe-top": `max(${safeInsets.top}px, env(safe-area-inset-top, 0px))`,
    "--runtime-safe-right": `max(${safeInsets.right}px, env(safe-area-inset-right, 0px))`,
    "--runtime-safe-bottom": `max(${safeInsets.bottom}px, env(safe-area-inset-bottom, 0px))`,
    "--runtime-safe-left": `max(${safeInsets.left}px, env(safe-area-inset-left, 0px))`,
    "--runtime-safe-width": "calc(100% - var(--runtime-safe-left) - var(--runtime-safe-right))",
    "--runtime-safe-height": "calc(100% - var(--runtime-safe-top) - var(--runtime-safe-bottom))",
  } as CSSProperties;
}

function colorWithAlpha(color: string, alpha: number): string {
  if (!color.startsWith("#")) return color;
  const hex = color.slice(1);
  const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex.slice(0, 6);
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function anchorTransform(anchor?: string): string | undefined {
  if (anchor === "top_center" || anchor === "bottom_center") return "translateX(-50%)";
  if (anchor === "top_right" || anchor === "bottom_right") return "translateX(-100%)";
  if (anchor === "center") return "translate(-50%, -50%)";
  return undefined;
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
    transform: componentType === "quick_menu" ? undefined : anchorTransform(rect.anchor),
  };
}

export type UILayoutSource = "explicit_mobile" | "safe_clamped" | "mobile_fallback" | "desktop";
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

function defaultMobileRect(screenId: UILayoutScreenId, component: UILayoutComponent | undefined): UILayoutRect | undefined {
  if (!component) return undefined;
  if (screenId === "player" && component.component_type in SAFE_DIALOG_PLAYER_RECTS) {
    return SAFE_DIALOG_PLAYER_RECTS[component.component_type as keyof typeof SAFE_DIALOG_PLAYER_RECTS].mobileRect;
  }
  const defaultScreen = getDefaultUISkinLayout().screens.find((screen) => screen.screen_id === screenId);
  const fallback = defaultScreen?.components.find((item) => item.component_id === component.component_id)
    ?? defaultScreen?.components.find((item) => item.component_type === component.component_type);
  return fallback?.mobileRect ?? fallback?.rect;
}

function resolveLayoutGeometry(
  screenId: UILayoutScreenId,
  component: UILayoutComponent | undefined,
  breakpoint: UILayoutBreakpoint,
  safeBounds: UILayoutRect,
): ResolvedLayoutGeometry {
  if (!component) return { source: breakpoint === "mobile" ? "mobile_fallback" : "desktop" };
  if (breakpoint !== "mobile") return { rect: component.rect, source: "desktop" };
  const explicitMobile = Boolean(component.mobileRect);
  const desktopButtonLayout = screenId === "title" && titleButtonComponentTypes.has(component.component_type);
  const sourceRect = desktopButtonLayout
    ? component.rect ?? defaultMobileRect(screenId, component)
    : component.mobileRect ?? defaultMobileRect(screenId, component);
  if (!sourceRect) return { source: "mobile_fallback" };
  if (safeAreaExemptTypes.has(component.component_type)) {
    return { rect: sourceRect, source: explicitMobile ? "explicit_mobile" : "mobile_fallback" };
  }
  const clamped = clampRectToBounds(sourceRect, safeBounds);
  return {
    rect: clamped.rect,
    source: clamped.changed ? "safe_clamped" : explicitMobile ? "explicit_mobile" : "mobile_fallback",
  };
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
  const quickMenuSafetyStyle = componentType === "quick_menu" ? {
    overflow: "hidden",
  } : {};
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
    const localBackground = style.backgroundColor ? colorWithAlpha(style.backgroundColor, style.opacity ?? 1) : undefined;
    const quickPadding = typeof style.padding === "number" ? `${Math.round(clamp(style.padding, 2, 8) * 100) / 100}px` : undefined;
    const quickGap = typeof style.gap === "number" ? `${Math.round(clamp(style.gap, 2, 8) * 100) / 100}px` : undefined;
      return {
      "--runtime-quick-menu-padding": quickPadding,
      "--runtime-quick-menu-gap": quickGap,
      "--runtime-control-active": style.accentColor,
      "--runtime-control": localBackground,
      "--runtime-control-hover": style.accentColor ?? localBackground,
      backgroundColor: backgroundImage ? undefined : localBackground,
      backgroundImage,
      ...imageFitStyle,
      color: style.color,
      borderColor: style.borderColor,
      borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
      borderRadius: useStrictDialogSizing ? (typeof style.borderRadius === "number" ? `${style.borderRadius}px` : undefined) : scalePx(style.borderRadius, scale),
      opacity: style.opacity,
      fontFamily: componentFontFamily,
      fontSize: componentFontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      boxShadow: style.shadow === "none" ? "none" : style.shadow === "soft" ? "0 10px 24px rgba(0,0,0,0.24)" : style.shadow === "strong" ? "0 16px 40px rgba(0,0,0,0.36)" : undefined,
      backdropFilter: typeof style.backdropBlur === "number" ? `blur(${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px)` : undefined,
      textAlign: style.textAlign,
      overflow: "hidden",
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  if (titleButtonComponentTypes.has(componentType)) {
    const localBackground = style.backgroundColor ? colorWithAlpha(style.backgroundColor, style.opacity ?? 1) : undefined;
    const localAccent = style.accentColor ?? style.backgroundColor;
    return {
      "--runtime-choice": localAccent,
      "--runtime-choice-text": style.color,
      "--runtime-control": localBackground,
      "--runtime-control-hover": localAccent ? colorWithAlpha(localAccent, 0.92) : undefined,
      "--runtime-control-active": localAccent,
      "--runtime-control-text": style.color,
      backgroundColor: backgroundImage ? undefined : localBackground,
      backgroundImage,
      ...imageFitStyle,
      color: style.color,
      borderColor: style.borderColor,
      borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
      borderRadius: useStrictDialogSizing ? (typeof style.borderRadius === "number" ? `${style.borderRadius}px` : undefined) : scalePx(style.borderRadius, scale),
      opacity: style.opacity,
      fontFamily: componentFontFamily,
      fontSize: componentFontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      padding: useStrictDialogSizing ? (typeof style.padding === "number" ? `${style.padding}px` : undefined) : scalePx(style.padding, scale),
      gap: useStrictDialogSizing ? (typeof style.gap === "number" ? `${style.gap}px` : undefined) : scalePx(style.gap, scale),
      boxShadow: style.shadow === "none" ? "none" : style.shadow === "soft" ? "0 10px 24px rgba(0,0,0,0.24)" : style.shadow === "strong" ? "0 16px 40px rgba(0,0,0,0.36)" : undefined,
      backdropFilter: typeof style.backdropBlur === "number" ? `blur(${Math.round(style.backdropBlur * (useStrictDialogSizing ? 1 : scale))}px)` : undefined,
      textAlign: style.textAlign,
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  if (componentType === "choice_list") {
    return {
      "--runtime-choice-local-bg": style.backgroundColor ? colorWithAlpha(style.backgroundColor, style.opacity ?? 1) : undefined,
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
      opacity: style.opacity,
      fontFamily: componentFontFamily,
      textAlign: style.textAlign,
      ...frameReset,
      "--runtime-frame-mode": visualMode,
    } as unknown as CSSProperties;
  }
  return {
    "--runtime-choice": style.accentColor,
    "--runtime-control-active": style.accentColor,
    "--runtime-slider-active": style.accentColor,
    "--runtime-slider-track": style.borderColor,
    "--runtime-slider-thumb": style.backgroundColor,
    backgroundColor: style.backgroundColor ? colorWithAlpha(style.backgroundColor, style.opacity ?? 0.78) : undefined,
    backgroundImage,
    ...imageFitStyle,
    color: style.color,
    borderColor: style.borderColor,
    borderWidth: useStrictDialogSizing ? (typeof style.borderWidth === "number" ? `${style.borderWidth}px` : undefined) : scalePx(style.borderWidth, scale),
    borderRadius: useStrictDialogSizing ? (typeof style.borderRadius === "number" ? `${style.borderRadius}px` : undefined) : scalePx(style.borderRadius, scale),
    opacity: style.opacity,
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
  if (!style?.backgroundImage || !["dialog_panel", "choice_list", "choice_option", "main_menu_custom_button"].includes(componentType ?? "")) return "default_frame";
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
  const rect = resolvedRect ?? (breakpoint === "mobile" ? component?.mobileRect ?? component?.rect : component?.rect);
  return {
    display: component?.visible === false ? "none" : undefined,
    ...rectStyle(rect, componentType),
    ...(componentType ? componentStyle(componentType, component?.style, runtimeAssets, scale, fontScale, textScale ?? { platform: "web", uiScale: scale, fontScale, dialogFontScale: fontScale, choiceFontScale: fontScale, fontSource: "desktop_viewport" }, visualMode) : {}),
    zIndex: component?.zIndex,
  };
}

export function UISkinProvider({ children }: { children: ReactNode }) {
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const runtimeScreen = useRuntimeStore((state) => state.screen);
  const viewport = useRuntimeViewport();
  const { breakpoint, orientation, platform, formFactor, safeInsets } = viewport;
  const skin = useMemo(() => currentGame?.uiSkin ?? getDefaultUISkinLayout(), [currentGame?.uiSkin]);
  const scale = layoutScale(breakpoint, formFactor, viewport.width, viewport.height);
  const textScale = resolveRuntimeTextScale(platform, formFactor, scale);
  const fontScale = textScale.fontScale;
  const touchScale = formFactor === "handheld" ? clamp(scale, 0.95, 1.05) : clamp(scale, 0.9, 1.36);
  const frameWidth = Math.min(viewport.width, viewport.height * (16 / 9));
  const frameHeight = frameWidth * (9 / 16);
  const frameOffsetX = Math.max(0, (viewport.width - frameWidth) / 2);
  const frameOffsetY = Math.max(0, (viewport.height - frameHeight) / 2);
  const safeLeft = clamp(((Math.max(0, safeInsets.left - frameOffsetX)) / frameWidth) * 100, 0, 45);
  const safeRight = clamp(((Math.max(0, safeInsets.right - frameOffsetX)) / frameWidth) * 100, 0, 45);
  const safeTop = clamp(((Math.max(0, safeInsets.top - frameOffsetY)) / frameHeight) * 100, 0, 45);
  const safeBottom = clamp(((Math.max(0, safeInsets.bottom - frameOffsetY)) / frameHeight) * 100, 0, 45);
  const safeMargin = formFactor === "handheld" ? 0.6 : 0;
  const safeBounds = {
    x: safeLeft + safeMargin,
    y: safeTop + safeMargin,
    width: Math.max(10, 100 - safeLeft - safeRight - safeMargin * 2),
    height: Math.max(10, 100 - safeTop - safeBottom - safeMargin * 2),
  };
  useEffect(() => {
    const fontAssets = currentGame?.manifest.assets.filter((asset) => asset.asset_type === "font") ?? [];
    if (fontAssets.length === 0) return;
    const rules = fontAssets
      .map((asset) => {
        const source = toRuntimeAssetUrl(currentGame?.assetUrls[asset.asset_id] ?? currentGame?.assetUrls[asset.path]);
        if (!source) return undefined;
        const format = fontFaceFormat(asset.filename, asset.mime_type);
        return `@font-face{font-family:"${fontFamilyName(asset.asset_id)}";src:url("${cssUrl(source)}")${format ? ` format("${format}")` : ""};font-display:swap;}`;
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
  useLandscapeLock(runtimeScreen === "playing" && breakpoint === "mobile");
  return <UISkinContext.Provider value={{ skin, breakpoint, orientation, scale, fontScale, touchScale, platform, formFactor, safeInsets, safeBounds, textScale }}>{children}</UISkinContext.Provider>;
}

export function UISkinScreen({ screen, children }: { screen: UILayoutScreenId; children: ReactNode }) {
  const { skin, breakpoint, orientation, scale, fontScale, touchScale, platform, formFactor, safeInsets, textScale } = useContext(UISkinContext);
  return (
    <div
      className="ui-skin-scope"
      data-ui-screen={screen}
      data-ui-breakpoint={breakpoint}
      data-ui-orientation={orientation}
      data-runtime-platform={platform}
      data-ui-form-factor={formFactor}
      data-runtime-safe-revision={safeInsets.top + safeInsets.right + safeInsets.bottom + safeInsets.left}
      data-ui-platform={platform}
      data-ui-text-scale={textScale.fontScale}
      data-ui-font-source={textScale.fontSource}
      style={{ ...tokenStyle(skin), ...runtimeFrameStyle(scale, fontScale, touchScale, safeInsets) }}
    >
      <div className="runtime-layout-frame" data-ui-screen-frame={screen}>
        {children}
      </div>
    </div>
  );
}

export function useUILayoutStyle(screenId: UILayoutScreenId, componentType: UILayoutComponentType): { style: CSSProperties; component?: UILayoutComponent; rect?: UILayoutRect; layoutSource: UILayoutSource; visualMode: UILayoutVisualMode; textScale: RuntimeTextScale } {
  const { skin, breakpoint, scale, fontScale, safeBounds, textScale } = useContext(UISkinContext);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const component = findComponent(skin, screenId, componentType);
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
