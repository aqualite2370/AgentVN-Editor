import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { DialogState } from "../../types/settings";
import { isTextRead } from "../../engine/readProgress";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { LibraryGame } from "../../types/cartridge";
import type { NvlLineState } from "../../types/save";
import type { UILayoutRect } from "../../../../shared/cartridge/uiSkin";
import { DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX } from "../../../../shared/cartridge/dialogText";
import { resolveRenpyQuickBar } from "../../../../shared/cartridge/renpyQuickBar";
import { placeSpeechBubble, type BubblePlacementRect } from "../../../../shared/cartridge/bubblePlacement";
import {
  fontFamilyForAsset,
  useDialogueModeLayoutStyle,
  useRenpyButtonRoleStyle,
  useRuntimeUILayout,
  useUILayoutFrameSize,
  useUILayoutSafeBounds,
  useUILayoutStyle,
} from "../../uiSkin/uiSkinRuntime";
import { clearRuntimeAnimationSettled } from "../../utils/animationResidue";
import { backgroundFitSize } from "../../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { TypewriterText } from "./TypewriterText";
import { latestEffect, useRuntimeAnimation } from "./runtimeAnimation";
import { useDialogPortrait } from "./useDialogPortrait";
import { ChoicePanel } from "./ChoicePanel";
import { PresentedControl } from "../../uiSkin/PresentedControl";

const CENTERED_NARRATION_DIM_DURATION_MS = 280;
const CENTERED_NARRATION_REDUCED_MOTION_DELAY_MS = 80;

function choosePageBreak(text: string, limit: number): number {
  if (text.length <= limit) return text.length;
  const minimum = Math.max(1, Math.floor(limit * 0.58));
  const windowStart = Math.max(minimum, limit - 48);
  const search = text.slice(windowStart, limit);
  const punctuationIndex = Math.max(
    search.lastIndexOf("\u3002"),
    search.lastIndexOf("\uff0c"),
    search.lastIndexOf("\uff1b"),
    search.lastIndexOf("\u3001"),
    search.lastIndexOf(";"),
    search.lastIndexOf("."),
    search.lastIndexOf("!"),
    search.lastIndexOf("?"),
    search.lastIndexOf("\n"),
  );
  if (punctuationIndex >= 0) return windowStart + punctuationIndex + 1;
  const whitespaceIndex = search.search(/\s[^\s]*$/);
  if (whitespaceIndex >= 0) return windowStart + whitespaceIndex + 1;
  return limit;
}

interface DialogTextMeasurer {
  baseFontSize: number;
  fits: (text: string, fontSize: number) => boolean;
  remove: () => void;
}

type DialogFontMode = "configured" | "adaptive";

function playerTextFontSize(fontSize: CSSProperties["fontSize"], scale: number): CSSProperties["fontSize"] {
  if (fontSize === undefined || scale === 1) return fontSize;
  return typeof fontSize === "number" ? fontSize * scale : `calc(${fontSize} * ${scale})`;
}

function textAppearance(style?: CSSProperties): CSSProperties {
  const { color, fontSize, fontWeight, fontStyle, fontFamily, textAlign } = style ?? {};
  return { color, fontSize, fontWeight, fontStyle, fontFamily, textAlign };
}

interface DialogTextMeasurement {
  pages: string[];
  fontSize: number;
  fontMode: DialogFontMode;
  fontScale: number;
}

interface DialogTextMeasureBounds {
  width: number;
  height: number;
}

function createDialogTextMeasurer(
  element: HTMLElement,
  bounds?: DialogTextMeasureBounds,
  targetFontSize?: CSSProperties["fontSize"],
): DialogTextMeasurer | null {
  const style = window.getComputedStyle(element);
  // clientWidth rounds fractional layout widths to the nearest CSS pixel.
  // Measuring that wider integer can fit one fewer row than the real text,
  // especially at 4K. Keep the local (untransformed) CSS width as the ceiling.
  const layoutWidth = Number.parseFloat(style.width);
  const width = Math.floor(Math.min(
    bounds?.width ?? Number.POSITIVE_INFINITY,
    Number.isFinite(layoutWidth) && layoutWidth > 0
      ? layoutWidth : element.clientWidth || element.getBoundingClientRect().width,
  ));
  const height = Math.floor(bounds?.height ?? (element.clientHeight || element.getBoundingClientRect().height));
  if (width < 32 || height < DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX) return null;

  const renderedFontSize = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(renderedFontSize) || renderedFontSize <= 0) return null;
  const computedLineHeight = Number.parseFloat(style.lineHeight);
  const lineHeightRatio = Number.isFinite(computedLineHeight) && computedLineHeight > 0
    ? computedLineHeight / renderedFontSize
    : 1.58;
  const measurer = document.createElement("p");
  const copiedProperties = [
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "wordBreak",
    "overflowWrap",
    "hyphens",
    "padding",
    "boxSizing",
  ] as const;
  for (const property of copiedProperties) {
    measurer.style[property] = style[property];
  }
  measurer.style.position = "fixed";
  measurer.style.left = "-10000px";
  measurer.style.top = "0";
  measurer.style.visibility = "hidden";
  measurer.style.pointerEvents = "none";
  measurer.style.whiteSpace = "pre-wrap";
  measurer.style.width = String(width) + "px";
  measurer.style.height = "auto";
  measurer.style.maxHeight = "none";
  measurer.style.overflow = "visible";
  measurer.style.margin = "0";
  // Binary search reads each candidate synchronously. The global reduced
  // motion rule also reaches this offscreen paragraph and can start a font
  // transition, causing every candidate to be measured at the previous size.
  // Isolate measurement only; visible dialogue keeps its presentation rules.
  measurer.style.setProperty("transition", "none", "important");
  measurer.style.setProperty("animation", "none", "important");
  // A rendered font may still be interpolating after the configured size
  // changes. Measure the target on this isolated node, not that intermediate
  // value, so a menu remount cannot select a different "configured" font.
  measurer.style.fontSize = typeof targetFontSize === "number"
    ? `${targetFontSize}px`
    : targetFontSize ?? style.fontSize;
  document.body.appendChild(measurer);
  const baseFontSize = Number.parseFloat(window.getComputedStyle(measurer).fontSize);
  if (!Number.isFinite(baseFontSize) || baseFontSize <= 0) {
    measurer.remove();
    return null;
  }

  const fits = (value: string, fontSize: number) => {
    measurer.style.fontSize = `${fontSize}px`;
    measurer.style.lineHeight = String(lineHeightRatio);
    measurer.textContent = value || " ";
    return measurer.scrollHeight <= height + 1 && measurer.scrollWidth <= width + 1;
  };

  return {
    baseFontSize,
    fits,
    remove: () => measurer.remove(),
  };
}

function paginateDialogText(text: string, measurer: DialogTextMeasurer, fontSize: number): string[] {
  const fits = (value: string) => measurer.fits(value, fontSize);
  if (!text || fits(text)) return [text];

  const pages: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    let low = 1;
    let high = remaining.length;
    let best = 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(remaining.slice(0, middle))) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const breakAt = choosePageBreak(remaining, Math.max(1, best));
    // Page boundaries are presentation only. Preserve the author's spaces,
    // indentation and line breaks, and never silently drop pages after a cap.
    pages.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return pages.length > 0 ? pages : [text];
}

function measureDialogText(
  text: string,
  element: HTMLElement,
  bounds?: DialogTextMeasureBounds,
  targetFontSize?: CSSProperties["fontSize"],
): DialogTextMeasurement {
  const measurer = createDialogTextMeasurer(element, bounds, targetFontSize);
  if (!measurer) {
    return {
      pages: [text],
      fontSize: Number.NaN,
      fontMode: "configured",
      fontScale: 1,
    };
  }

  const configuredFontSize = measurer.baseFontSize;
  const minimumFontSize = Math.min(configuredFontSize, DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX);
  let fontSize = configuredFontSize;
  let fontMode: DialogFontMode = "configured";
  if (!measurer.fits(text, configuredFontSize)) {
    fontMode = "adaptive";
    if (measurer.fits(text, minimumFontSize)) {
      let low = minimumFontSize;
      let high = configuredFontSize;
      let best = minimumFontSize;
      for (let iteration = 0; iteration < 18 && high - low > 0.05; iteration += 1) {
        const middle = (low + high) / 2;
        if (measurer.fits(text, middle)) {
          best = middle;
          low = middle;
        } else {
          high = middle;
        }
      }
      // Rounding upward can cross a line-wrap boundary: the font that fits
      // in the binary search then gains an extra line and is paginated.
      fontSize = Math.floor(best * 100) / 100;
    } else {
      fontSize = minimumFontSize;
    }
  }
  const pages = paginateDialogText(text, measurer, fontSize);
  measurer.remove();
  return {
    pages,
    fontSize,
    fontMode,
    fontScale: configuredFontSize > 0 ? fontSize / configuredFontSize : 1,
  };
}

function applyConfiguredFontSize(element: HTMLElement, fontSize: CSSProperties["fontSize"] | undefined) {
  if (typeof fontSize === "number") {
    element.style.fontSize = `${fontSize}px`;
  } else if (typeof fontSize === "string") {
    element.style.fontSize = fontSize;
  } else {
    element.style.removeProperty("font-size");
  }
}

function resolveGameAsset(game: LibraryGame | undefined, assetId?: string | null): string | undefined {
  if (!game || !assetId) return undefined;
  const assetPath = game.manifest.assets.find((asset) => asset.asset_id === assetId)?.path;
  return toRuntimeAssetUrl(game.assetUrls[assetId] ?? (assetPath ? game.assetUrls[assetPath] : undefined));
}


function percent(value: number): string {
  return `${Math.round(value * 10000) / 10000}%`;
}

function localizeChildLayoutStyle(style: CSSProperties | undefined, childRect: UILayoutRect | undefined, parentRect: UILayoutRect | undefined): CSSProperties | undefined {
  if (!style || !childRect || !parentRect || parentRect.width <= 0 || parentRect.height <= 0) return style;
  return {
    ...style,
    left: percent(((childRect.x - parentRect.x) / parentRect.width) * 100),
    top: percent(((childRect.y - parentRect.y) / parentRect.height) * 100),
    width: percent((childRect.width / parentRect.width) * 100),
    height: percent((childRect.height / parentRect.height) * 100),
    right: "auto",
    bottom: "auto",
  };
}

function dialogPanelLayoutStyle(style?: CSSProperties, hasChildLayout = false): CSSProperties {
  if (!style) return {};
  return {
    ...style,
    boxSizing: "border-box",
    ...(hasChildLayout ? { padding: 0 } : {}),
  };
}

function nvlReadingHeight(element: HTMLElement, hasAuthoredRect: boolean): number {
  const style = window.getComputedStyle(element);
  const rawMaximum = Number.parseFloat(style.maxHeight);
  const maximum = hasAuthoredRect
    ? element.clientHeight
    : Number.isFinite(rawMaximum)
    ? style.maxHeight.trim().endsWith("%")
      ? (element.parentElement?.clientHeight ?? element.clientHeight) * rawMaximum / 100
      : rawMaximum
    : element.clientHeight;
  const choices = element.querySelector<HTMLElement>(".choice-panel.is-nvl-choices");
  const choiceSpace = choices ? choices.offsetHeight + (Number.parseFloat(style.rowGap) || 0) : 0;
  return Math.max(1, maximum - choiceSpace
    - Number.parseFloat(style.paddingTop || "0")
    - Number.parseFloat(style.paddingBottom || "0")
    - Number.parseFloat(style.borderTopWidth || "0")
    - Number.parseFloat(style.borderBottomWidth || "0"));
}

function nvlLineReservedHeight(textElement: HTMLElement): number {
  const line = textElement.closest<HTMLElement>("[data-nvl-measure-line]");
  if (!line) return 20;
  const style = getComputedStyle(line);
  const decoration = (["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"] as const)
    .reduce((sum, property) => sum + (Number.parseFloat(style[property]) || 0), 0);
  const speaker = line.querySelector<HTMLElement>(".nvl-page-speaker");
  // The inline speaker consumes the start of the first row. Measuring only
  // the text can otherwise fit one more row than the rendered named line.
  const speakerRow = speaker ? Math.max(Number.parseFloat(style.lineHeight) || 0,
    Number.parseFloat(getComputedStyle(speaker).lineHeight) || 0) : 0;
  return Math.max(20, decoration + speakerRow);
}

function preventDialogTextIndicatorOverlap(
  style: CSSProperties | undefined,
  textRect: UILayoutRect | undefined,
  continueRect: UILayoutRect | undefined,
): CSSProperties | undefined {
  if (!style || !textRect || !continueRect) return style;
  const overlaps =
    textRect.x < continueRect.x + continueRect.width &&
    textRect.x + textRect.width > continueRect.x &&
    textRect.y < continueRect.y + continueRect.height &&
    textRect.y + textRect.height > continueRect.y;
  if (!overlaps) return style;
  const safeWidth = Math.max(1, continueRect.x - textRect.x - 0.8);
  return {
    ...style,
    width: `${safeWidth}%`,
    paddingRight: 0,
  };
}

interface DialogBoxProps {
  onStoryInteraction?: () => void;
}

export function DialogBox({ onStoryInteraction }: DialogBoxProps) {
  const dialog = useRuntimeStore((state) => state.engineState.dialog);
  const dialogPageIndex = useRuntimeStore((state) => state.engineState.dialogPageIndex);
  const setDialogPagePosition = useRuntimeStore((state) => state.setDialogPagePosition);
  const effects = useRuntimeStore((state) => state.engineState.animationEffects);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const isSkipMode = useRuntimeStore((state) => state.engineState.isSkipMode);
  const typingRevealRequested = useRuntimeStore((state) => state.engineState.typingRevealRequested);
  const isTyping = useRuntimeStore((state) => state.engineState.isTyping);
  const nvlPresentationMode = useRuntimeStore((state) => state.engineState.nvlPresentationMode);
  const nvlPage = useRuntimeStore((state) => state.engineState.nvlPage);
  const choices = useRuntimeStore((state) => state.engineState.choices);
  const sprites = useRuntimeStore((state) => state.engineState.sprites);
  const isPreviewFrame = useRuntimeStore((state) => state.engineState.isPreviewFrame);
  const markCurrentDialogRead = useRuntimeStore((state) => state.markCurrentDialogRead);
  const completeCurrentTyping = useRuntimeStore((state) => state.completeCurrentTyping);
  const next = useRuntimeStore((state) => state.next);
  const settings = useSettingsStore((state) => state.settings);
  const ref = useRef<HTMLElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const speakerRef = useRef<HTMLSpanElement | null>(null);
  const nvlPageRef = useRef<HTMLSpanElement | null>(null);
  const nvlMeasureRef = useRef<HTMLDivElement | null>(null);
  const rippleTimerRef = useRef<number | null>(null);
  const pendingPointerClickRef = useRef<number | null>(null);
  const nvlPointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const layout = useUILayoutStyle("player", "dialog_panel");
  const speakerLayout = useUILayoutStyle("player", "speaker_label");
  const textLayout = useUILayoutStyle("player", "dialog_text");
  const continueLayout = useUILayoutStyle("player", "continue_indicator");
  const runtimeUILayout = useRuntimeUILayout();
  const frameSize = useUILayoutFrameSize();
  const safeBounds = useUILayoutSafeBounds();
  const quickBarRoleStyle = useRenpyButtonRoleStyle("quick_bar", "player", "var(--renpy-quick-scale)");
  const quickBarGeometry = resolveRenpyQuickBar(frameSize, safeBounds, quickBarRoleStyle.enabled
    ? quickBarRoleStyle.geometry
    : { width: 62, height: 32 });
  const renpyDialogTextMaxHeight = Math.max(1,
    quickBarGeometry.y - (textLayout.rect?.y ?? 80) / 100 * frameSize.height - 8 * quickBarGeometry.scale);
  // The native bottom inset moves the quick bar upwards. The shared NVL
  // frame must reserve that same dock, rather than keep its legacy 7% gap.
  const nvlBottomOffset = Math.max(frameSize.height * 0.07,
    frameSize.height - quickBarGeometry.y + 8 * quickBarGeometry.scale);
  const nvlReadingMaxHeight = Math.max(1, Math.min(frameSize.height * 0.7,
    frameSize.height - nvlBottomOffset - safeBounds.y / 100 * frameSize.height));
  const activeDialog = dialog;
  const isNvlPresentation = nvlPresentationMode === "nvl" && nvlPage.length > 0;
  const isBubblePresentation = nvlPresentationMode === "bubble";
  const dialogueModeLayout = useDialogueModeLayoutStyle(
    isNvlPresentation ? "nvl" : isBubblePresentation ? "bubble" : "dialog",
  );
  const dialogueModeLayoutKey = JSON.stringify(dialogueModeLayout.config ?? null);
  const modeControl = (region: "panel" | "text" | "speaker") => {
    const base = region === "panel" ? layout.component : region === "text" ? textLayout.component : speakerLayout.component;
    if (!isNvlPresentation && !isBubblePresentation) return base;
    return { ...base, component_type: base?.component_type ?? "dialog_panel" as const,
      component_id: `${isNvlPresentation ? "nvl" : "bubble"}_${region}Style`,
      presentation: dialogueModeLayout.config?.[`${region}Presentation`] ?? base?.presentation };
  };
  const presentationScale = Math.min(frameSize.width / 1280, frameSize.height / 720);
  const isCenteredNarration = Boolean(activeDialog?.isNarration && activeDialog.narration_style === "centered");
  const portraitSource = !activeDialog?.isNarration && !isNvlPresentation
    ? resolveGameAsset(currentGame, activeDialog?.portrait)
    : undefined;
  const portrait = useDialogPortrait({
    source: portraitSource, assetId: activeDialog?.portrait, panelRef: ref, textRef, speakerRef,
    config: runtimeUILayout.dialogPortrait,
    layoutKey: JSON.stringify([layout.rect, textLayout.rect, textLayout.style,
      speakerLayout.rect, speakerLayout.style, activeDialog?.speaker, dialogueModeLayoutKey, isBubblePresentation]),
  });
  const dialogIdentity = activeDialog?.text_key ?? activeDialog?.text ?? "";
  const previousNarrationPresentationRef = useRef<{ centered: boolean } | null>(null);
  const isEnteringCenteredNarration = isCenteredNarration && previousNarrationPresentationRef.current?.centered !== true;
  const [centeredNarrationTextReady, setCenteredNarrationTextReady] = useState(() => !isCenteredNarration);
  const characterStyle = activeDialog?.character_id && activeDialog.dialog_style_mode !== "manual"
    ? currentGame?.script.characters?.find((character) => character.character_id === activeDialog.character_id)?.dialog_style
    : undefined;
  const effectiveDialogStyle = activeDialog?.dialog_style_mode === "manual"
    ? activeDialog.dialog_style
    : (activeDialog?.dialog_style ?? characterStyle);
  const dialogTextFontSize = typeof effectiveDialogStyle?.font_size === "number" && Number.isFinite(effectiveDialogStyle.font_size)
    ? Math.min(96, Math.max(10, Math.round(effectiveDialogStyle.font_size)))
    : undefined;
  const mobileDialogFontCap = typeof window !== "undefined" && (window.innerWidth <= 600 || window.innerHeight <= 520)
    ? Math.max(DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX, Math.min(20, window.innerWidth * 0.052))
    : undefined;
  // Scale the authored target before fitting, not the fitted inline result:
  // the latter would either defeat the preference or overflow a measured page.
  const baseDialogTextFontSize: CSSProperties["fontSize"] | undefined = dialogTextFontSize
    ? `${Math.min(Math.round(dialogTextFontSize * textLayout.textScale.dialogFontScale), mobileDialogFontCap ?? Number.POSITIVE_INFINITY)}px`
    : !isCenteredNarration && dialogueModeLayout.textStyle.fontSize
      ? dialogueModeLayout.textStyle.fontSize
      : !isCenteredNarration && textLayout.component
      ? (mobileDialogFontCap ? `${mobileDialogFontCap}px` : textLayout.style?.fontSize)
      : undefined;
  const configuredDialogTextFontSize = playerTextFontSize(baseDialogTextFontSize, settings.fontScale);
  const dialogMeasureKey = [
    activeDialog?.text_key ?? "",
    activeDialog?.text ?? "",
    String(configuredDialogTextFontSize ?? "default"),
    settings.fontScale,
    settings.lineSpacing,
    textLayout.rect?.width ?? "",
    textLayout.rect?.height ?? "",
    isCenteredNarration ? "centered" : "dialog",
  ].join("\u0000");
  const [dialogPages, setDialogPages] = useState<string[]>([]);
  const measuredDialogPagesRef = useRef<string[]>([]);
  const [isDialogPageDone, setIsDialogPageDone] = useState(false);
  const [forceRevealPage, setForceRevealPage] = useState(false);
  const [dialogPhysicallyOverflows, setDialogPhysicallyOverflows] = useState(false);
  const [dialogFontSizePx, setDialogFontSizePx] = useState<number | null>(null);
  const [dialogFontMode, setDialogFontMode] = useState<DialogFontMode>("configured");
  const [dialogFontScale, setDialogFontScale] = useState(1);
  const [nvlPageStartIndex, setNvlPageStartIndex] = useState(0);
  const [nvlVisiblePageCount, setNvlVisiblePageCount] = useState(1);
  const [bubblePlacement, setBubblePlacement] = useState<{
    x: number;
    y: number;
    anchor: "character" | "fallback" | "fixed";
    tail: "top" | "bottom" | "left" | "right";
  } | null>(null);
  useRuntimeAnimation(ref, latestEffect(effects, (effect) => effect.target_kind === "dialog" || effect.target_kind === "ui"));

  useEffect(() => {
    if (rippleTimerRef.current) window.clearTimeout(rippleTimerRef.current);
    return () => {
      if (rippleTimerRef.current) window.clearTimeout(rippleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    clearRuntimeAnimationSettled(ref.current);
  }, [dialog?.text, dialog?.text_key]);

  useLayoutEffect(() => {
    measuredDialogPagesRef.current = [];
    setDialogPages([]);
    setIsDialogPageDone(false);
    setForceRevealPage(false);
    setDialogPhysicallyOverflows(false);
    setDialogFontSizePx(null);
    setDialogFontMode("configured");
    setDialogFontScale(1);
  }, [dialog?.text_key, dialog?.text, isCenteredNarration, layout.component, textLayout.component]);

  useLayoutEffect(() => {
    const dialogElement = ref.current;
    const stage = dialogElement?.closest<HTMLElement>(".story-player");
    if (!isBubblePresentation || !dialogElement || !stage) {
      setBubblePlacement(null);
      return;
    }

    let animationFrame = 0;
    let disposed = false;
    const toStageRect = (element: Element): BubblePlacementRect => {
      const rect = element.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      return {
        x: rect.left - stageRect.left,
        y: rect.top - stageRect.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const measure = () => {
      if (disposed) return;
      const stageRect = stage.getBoundingClientRect();
      const dialogRect = dialogElement.getBoundingClientRect();
      const anchor = activeDialog?.character_id
        ? Array.from(stage.querySelectorAll<HTMLElement>(".sprite-slot[data-character-id]"))
            .find((slot) =>
              slot.dataset.characterId === activeDialog.character_id
              && slot.dataset.spritePhase !== "exiting"
              && sprites[activeDialog.character_id!]?.visible !== false,
            )
        : undefined;
      const visibleSprite = anchor?.querySelector<HTMLElement>(".sprite-visual, .sprite-placeholder") ?? anchor;
      const visibleSpriteRect = visibleSprite ? toStageRect(visibleSprite) : undefined;
      const headAnchor = visibleSpriteRect
        ? {
            x: visibleSpriteRect.x,
            y: visibleSpriteRect.y,
            width: visibleSpriteRect.width,
            height: Math.min(84, Math.max(32, visibleSpriteRect.height * 0.16)),
          }
        : undefined;
      const quickBar = stage.querySelector<HTMLElement>(".renpy-quick-bar, .playback-controls");
      const obstacles = quickBar ? [toStageRect(quickBar)] : [];
      const position = activeDialog?.bubble_position;
      const placement = placeSpeechBubble({
        viewport: { x: 0, y: 0, width: stageRect.width, height: stageRect.height },
        bubble: { width: dialogRect.width, height: dialogRect.height },
        ...(headAnchor ? { anchor: headAnchor } : {}),
        ...(position?.mode === "fixed"
          ? { fixed: { x: position.x, y: position.y } }
          : position?.mode === "character"
            ? { offset: { x: stageRect.width * (position.offset_x ?? 0) / 100,
                y: stageRect.height * (position.offset_y ?? 0) / 100 } } : {}),
        obstacles,
        ...(dialogueModeLayout.config?.rect ? {
          fallback: { x: dialogueModeLayout.config.rect.x, y: dialogueModeLayout.config.rect.y },
        } : {}),
      });
      setBubblePlacement((current) => {
        if (current
          && Math.abs(current.x - placement.x) < 0.5
          && Math.abs(current.y - placement.y) < 0.5
          && current.anchor === placement.anchor
          && current.tail === placement.tail) {
          return current;
        }
        return { x: placement.x, y: placement.y, anchor: placement.anchor, tail: placement.tail };
      });

      const movingElements = stage.querySelectorAll<HTMLElement>(".sprite-slot, .camera-pose, .camera-impulse");
      if (Array.from(movingElements).some((element) =>
        element.getAnimations().some((animation) => animation.playState === "running"),
      )) {
        animationFrame = window.requestAnimationFrame(measure);
      }
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(stage);
    resizeObserver?.observe(dialogElement);
    if (activeDialog?.character_id) {
      const anchor = Array.from(stage.querySelectorAll<HTMLElement>(".sprite-slot[data-character-id]"))
        .find((slot) => slot.dataset.characterId === activeDialog.character_id);
      if (anchor) {
        resizeObserver?.observe(anchor);
        const visual = anchor.querySelector<HTMLElement>(".sprite-visual, .sprite-placeholder");
        if (visual) resizeObserver?.observe(visual);
      }
    }
    const quickBar = stage.querySelector<HTMLElement>(".renpy-quick-bar, .playback-controls");
    if (quickBar) resizeObserver?.observe(quickBar);
    stage.addEventListener("animationstart", scheduleMeasure, true);
    stage.addEventListener("animationend", scheduleMeasure, true);
    stage.addEventListener("transitionrun", scheduleMeasure, true);
    stage.addEventListener("transitionend", scheduleMeasure, true);
    window.addEventListener("resize", scheduleMeasure);
    measure();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      stage.removeEventListener("animationstart", scheduleMeasure, true);
      stage.removeEventListener("animationend", scheduleMeasure, true);
      stage.removeEventListener("transitionrun", scheduleMeasure, true);
      stage.removeEventListener("transitionend", scheduleMeasure, true);
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [activeDialog?.character_id, activeDialog?.text_key, activeDialog?.bubble_position,
    isBubblePresentation, sprites, dialogueModeLayoutKey]);

  useLayoutEffect(() => {
    if (!isNvlPresentation || nvlPage.length === 0) {
      setNvlPageStartIndex(0);
      setNvlVisiblePageCount(1);
      return;
    }

    const dialogElement = ref.current;
    const measureElement = nvlMeasureRef.current;
    if (!dialogElement || !measureElement) return;

    let animationFrame = 0;
    const measurePages = () => {
      const availableHeight = nvlReadingHeight(dialogElement, Boolean(dialogueModeLayout.config?.rect));
      const rowGap = Number.parseFloat(window.getComputedStyle(measureElement).rowGap || "0") || 0;
      const lineHeights = Array.from(measureElement.querySelectorAll<HTMLElement>("[data-nvl-measure-line]"))
        .map((line) => line.getBoundingClientRect().height);
      const pageStarts = [0];
      let pageHeight = 0;
      for (let index = 0; index < lineHeights.length; index += 1) {
        const lineHeight = lineHeights[index];
        const nextHeight = pageHeight === 0 ? lineHeight : pageHeight + rowGap + lineHeight;
        if (pageHeight > 0 && nextHeight > availableHeight) {
          pageStarts.push(index);
          pageHeight = lineHeight;
        } else {
          pageHeight = nextHeight;
        }
      }
      const nextStartIndex = pageStarts[pageStarts.length - 1] ?? 0;
      setNvlPageStartIndex((current) => current === nextStartIndex ? current : nextStartIndex);
      setNvlVisiblePageCount((current) => current === pageStarts.length ? current : pageStarts.length);
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measurePages);
    };

    measurePages();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(dialogElement);
    resizeObserver?.observe(measureElement);
    const choicesElement = dialogElement.querySelector(".choice-panel");
    if (choicesElement) resizeObserver?.observe(choicesElement);
    window.addEventListener("resize", scheduleMeasure);
    void document.fonts?.ready.then(scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isNvlPresentation, nvlPage, textLayout.textScale.dialogFontScale, dialogueModeLayoutKey,
    settings.fontScale, settings.lineSpacing,
    nvlReadingMaxHeight, choices]);

  useLayoutEffect(() => {
    previousNarrationPresentationRef.current = {
      centered: isCenteredNarration,
    };
    if (!isEnteringCenteredNarration || isPreviewFrame) {
      setCenteredNarrationTextReady(true);
      return;
    }
    setCenteredNarrationTextReady(false);
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const delayMs = prefersReducedMotion
      ? CENTERED_NARRATION_REDUCED_MOTION_DELAY_MS
      : CENTERED_NARRATION_DIM_DURATION_MS;
    const timer = window.setTimeout(() => setCenteredNarrationTextReady(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [dialogIdentity, isCenteredNarration, isPreviewFrame]);

  useLayoutEffect(() => {
    const text = dialog?.text;
    const measureTextElements = nvlMeasureRef.current?.querySelectorAll<HTMLElement>(".nvl-page-measure .nvl-page-text");
    const textElement = isNvlPresentation
      ? measureTextElements?.[Math.max(0, measureTextElements.length - 1)] ?? null
      : textRef.current;
    if (!text || !textElement) return;
    let animationFrame = 0;
    const measure = () => {
      if (!isNvlPresentation && configuredDialogTextFontSize === undefined) {
        applyConfiguredFontSize(textElement, configuredDialogTextFontSize);
      }
      const pageElement = nvlPageRef.current;
      const bubbleElement = isBubblePresentation ? ref.current : null;
      const bubbleStage = bubbleElement?.closest<HTMLElement>(".story-player");
      const bubbleStyle = bubbleElement ? getComputedStyle(bubbleElement) : null;
      const speaker = bubbleElement?.querySelector<HTMLElement>(".speaker");
      const indicator = bubbleElement?.querySelector<HTMLElement>(".continue-indicator");
      const bubbleReservedHeight = bubbleStyle
        ? parseFloat(bubbleStyle.paddingTop || "0") + parseFloat(bubbleStyle.paddingBottom || "0")
          + parseFloat(bubbleStyle.borderTopWidth || "0") + parseFloat(bubbleStyle.borderBottomWidth || "0")
          + (speaker?.getBoundingClientRect().height ?? 0) + (indicator?.getBoundingClientRect().height ?? 0)
          + (parseFloat(bubbleStyle.rowGap) || 0) * (speaker ? 2 : 1)
        : 0;
      // In the Editor's node frame the legacy 48% cap can leave less than
      // one line after the name, padding and continue hint. Reserve two
      // minimum-readable lines before fitting the complete text. The budget
      // is independent of the current page fragment and never expands an
      // explicitly authored rectangle or the frame's safe outer bounds.
      const bodyStyle = bubbleElement ? getComputedStyle(textElement) : null;
      const bodyFontSize = parseFloat(bodyStyle?.fontSize || "0");
      const bodyLineHeight = parseFloat(bodyStyle?.lineHeight || "0");
      const minimumLineHeight = DIALOG_TEXT_MIN_AUTO_FONT_SIZE_PX
        * (bodyFontSize > 0 && bodyLineHeight > 0 ? bodyLineHeight / bodyFontSize : 1.5);
      const bubbleHeightBudget = bubbleStage && !dialogueModeLayout.config?.rect
        ? Math.max(1, Math.min(420, bubbleStage.clientHeight - 32,
          Math.max(bubbleStage.clientHeight * 0.48, bubbleReservedHeight + minimumLineHeight * 2)))
        : undefined;
      if (bubbleElement && bubbleHeightBudget !== undefined) {
        bubbleElement.style.setProperty("--bubble-default-max-height", `${bubbleHeightBudget}px`);
      }
      const bounds = bubbleElement && bubbleStage
        ? { width: Math.min(textElement.clientWidth,
              parseFloat(bodyStyle?.width || "0") || textElement.clientWidth),
            // Use the available frame, never the current fragment's height:
            // measuring the displayed fragment would re-paginate on every click.
            height: Math.max(1, (dialogueModeLayout.config?.rect
              ? Math.min(bubbleStage.clientHeight * dialogueModeLayout.config.rect.height / 100, bubbleStage.clientHeight - 32)
              : bubbleHeightBudget!) - bubbleReservedHeight) }
        : isNvlPresentation && pageElement && ref.current
        ? {
            width: pageElement.clientWidth,
            // The compact frame follows its rendered fragment. Using that
            // fragment's height to paginate the complete line creates a
            // feedback loop and different pages after a menu remount.
            // Share the same authored/maximum reading budget as NVL page flow.
            // Leave room for the line's bottom rule, padding and the speaker
            // baseline so a page never clips the final measured row.
            height: Math.max(1, nvlReadingHeight(ref.current, Boolean(dialogueModeLayout.config?.rect))
              - nvlLineReservedHeight(textElement)),
          }
        : runtimeUILayout.layout_type === "renpy" && !isCenteredNarration
        ? {
            width: textElement.clientWidth,
            height: Math.min(textElement.clientHeight || renpyDialogTextMaxHeight, renpyDialogTextMaxHeight),
          }
        : undefined;
      const measurement = measureDialogText(text, textElement, bounds,
        isNvlPresentation ? undefined : configuredDialogTextFontSize);
      const previousPages = measuredDialogPagesRef.current;
      const pagesChanged = previousPages.length !== measurement.pages.length
        || previousPages.some((page, index) => page !== measurement.pages[index]);
      if (pagesChanged) {
        measuredDialogPagesRef.current = measurement.pages;
        setDialogPages(measurement.pages);
        setDialogPagePosition(
          Math.min(dialogPageIndex, Math.max(0, measurement.pages.length - 1)),
          measurement.pages.length,
        );
        // Late font/layout measurement can refine page boundaries after a menu
        // return. Preserve the engine's completed line instead of resetting only
        // the local done flag (the unchanged typewriter key may not emit again).
        setIsDialogPageDone(!useRuntimeStore.getState().engineState.isTyping);
        setForceRevealPage(false);
      }
      setDialogFontSizePx(Number.isFinite(measurement.fontSize) ? measurement.fontSize : null);
      setDialogFontMode(measurement.fontMode);
      setDialogFontScale(measurement.fontScale);
      // A page is measured at the final font size. It must never fall back to
      // an internal scrolling text box merely because the source string was
      // split into pages.
      setDialogPhysicallyOverflows(false);
      if (!isNvlPresentation) {
        applyConfiguredFontSize(
          textElement,
          Number.isFinite(measurement.fontSize)
            ? `${measurement.fontSize}px`
            : configuredDialogTextFontSize,
        );
      }
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(measure);
    };
    measure();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(isNvlPresentation && nvlPageRef.current ? nvlPageRef.current : textElement);
    const choicesElement = ref.current?.querySelector(".choice-panel");
    if (choicesElement) resizeObserver?.observe(choicesElement);
    window.addEventListener("resize", scheduleMeasure);
    void document.fonts?.ready.then(scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [configuredDialogTextFontSize, dialog?.text, dialog?.text_key, dialogMeasureKey, dialogPageIndex,
    isNvlPresentation, isBubblePresentation, nvlPage, setDialogPagePosition, textLayout.component, dialogueModeLayoutKey,
    runtimeUILayout.layout_type, renpyDialogTextMaxHeight, nvlReadingMaxHeight, choices,
    settings.fontScale, settings.lineSpacing]);

  if (!activeDialog) return null;

  const progressGameId = currentGame?.install_id ?? currentGame?.game_id;
  const skipAllowed = isSkipMode && (settings.skipUnread || isTextRead(progressGameId, activeDialog.text_key));
  const pages = dialogPages.length > 0 ? dialogPages : [activeDialog.text];
  const safePageIndex = Math.min(dialogPageIndex, Math.max(0, pages.length - 1));
  const isPaginated = pages.length > 1;
  const visibleText = isPaginated ? (pages[safePageIndex] ?? activeDialog.text) : activeDialog.text;
  // Menus unmount this view while the engine retains the dialogue's completion
  // state. A finished line must not restart its typewriter when the view returns.
  const instantReveal = isPreviewFrame || !isTyping || skipAllowed || typingRevealRequested || forceRevealPage;
  const centeredNarrationContentReady = !isCenteredNarration || centeredNarrationTextReady || instantReveal;
  const dialogBackgroundUrl = isCenteredNarration
    ? undefined
    : resolveGameAsset(currentGame, effectiveDialogStyle?.background_asset_id);
  const dialogBackgroundPresentation = dialogBackgroundUrl || effectiveDialogStyle?.background_fit
    ? {
        ...(dialogBackgroundUrl ? { backgroundImage: `url("${dialogBackgroundUrl}")` } : {}),
        backgroundSize: backgroundFitSize(effectiveDialogStyle?.background_fit ?? "cover"),
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }
    : {};
  const dialogThemeColor = /^#[0-9a-f]{6}$/i.test(effectiveDialogStyle?.theme_color ?? "") ? effectiveDialogStyle?.theme_color ?? undefined : undefined;
  const dialogTextFont = fontFamilyForAsset(activeDialog.font_asset_id);
  const dialogTextColor = /^#[0-9a-f]{6}$/i.test(effectiveDialogStyle?.text_color ?? "") ? effectiveDialogStyle?.text_color ?? undefined : undefined;
  const dialogTextFontWeight = typeof effectiveDialogStyle?.font_weight === "number" && Number.isFinite(effectiveDialogStyle.font_weight)
    ? Math.min(900, Math.max(100, Math.round(effectiveDialogStyle.font_weight / 50) * 50))
    : undefined;
  const dialogTextFontStyle = effectiveDialogStyle?.font_style === "normal" || effectiveDialogStyle?.font_style === "italic" ? effectiveDialogStyle.font_style : undefined;
  const nvlTextStyleForLine = (line: NvlLineState): CSSProperties => {
    const lineCharacterStyle = line.character_id && line.dialog_style_mode !== "manual"
      ? currentGame?.script.characters?.find((character) => character.character_id === line.character_id)?.dialog_style
      : undefined;
    const lineStyle = line.dialog_style_mode === "manual"
      ? line.dialog_style
      : line.dialog_style ?? lineCharacterStyle;
    const fontSize = typeof lineStyle?.font_size === "number" && Number.isFinite(lineStyle.font_size)
      ? Math.min(96, Math.max(10, Math.round(lineStyle.font_size * textLayout.textScale.dialogFontScale)))
      : undefined;
    const color = /^#[0-9a-f]{6}$/i.test(lineStyle?.text_color ?? "") ? lineStyle?.text_color ?? undefined : undefined;
    const weight = typeof lineStyle?.font_weight === "number" && Number.isFinite(lineStyle.font_weight)
      ? Math.min(900, Math.max(100, Math.round(lineStyle.font_weight / 50) * 50))
      : undefined;
    const fontStyle = lineStyle?.font_style === "normal" || lineStyle?.font_style === "italic"
      ? lineStyle.font_style
      : undefined;
    return {
      ...dialogueModeLayout.textStyle,
      ...(fontFamilyForAsset(line.font_asset_id) ? { fontFamily: fontFamilyForAsset(line.font_asset_id) } : {}),
      ...(fontSize || dialogueModeLayout.textStyle.fontSize !== undefined
        ? { fontSize: playerTextFontSize(fontSize ? `${fontSize}px` : dialogueModeLayout.textStyle.fontSize, settings.fontScale) }
        : {}),
      ...(color ? { color } : {}),
      ...(weight ? { fontWeight: weight } : {}),
      ...(fontStyle ? { fontStyle } : {}),
    };
  };
  const childGeometryEnabled = !isCenteredNarration && !isBubblePresentation && Boolean(textLayout.component || speakerLayout.component || continueLayout.component);
  const dialogPanelStyle = {
    ...(!isCenteredNarration ? dialogPanelLayoutStyle(layout.style, childGeometryEnabled && !isNvlPresentation) : {}),
    ...(isBubblePresentation
      ? {
          left: bubblePlacement?.x ?? 0,
          top: bubblePlacement?.y ?? 0,
          right: "auto",
          bottom: "auto",
          width: "min(560px, calc(100% - 32px))",
          height: "auto",
          minWidth: "min(280px, calc(100% - 32px))",
          minHeight: "0",
          maxHeight: "var(--bubble-default-max-height, min(48%, 420px))",
          padding: "clamp(12px, 2vw, 20px) clamp(14px, 2.4vw, 24px)",
          visibility: bubblePlacement ? "visible" : "hidden",
          ...(dialogueModeLayout.config?.rect ? {
            width: `min(${dialogueModeLayout.config.rect.width}%, calc(100% - 32px))`,
            minWidth: 0,
            maxHeight: `min(${dialogueModeLayout.config.rect.height}%, calc(100% - 32px))`,
          } : {}),
        }
      : {}),
    ...dialogueModeLayout.panelStyle,
    ...(isNvlPresentation && runtimeUILayout.layout_type === "renpy" && !dialogueModeLayout.config?.rect ? {
      "--nvl-bottom-offset": `${nvlBottomOffset}px`,
      "--nvl-reading-max-height": `${nvlReadingMaxHeight}px`,
    } : {}),
    ...(isNvlPresentation && dialogueModeLayout.config?.rect ? {
      ...dialogueModeLayout.rectStyle,
      "--dialog-mode-x": dialogueModeLayout.rectStyle.left,
      "--dialog-mode-y": dialogueModeLayout.rectStyle.top,
      "--dialog-mode-width": dialogueModeLayout.rectStyle.width,
      "--dialog-mode-height": dialogueModeLayout.rectStyle.height,
      "--dialog-mode-transform": dialogueModeLayout.rectStyle.transform ?? "none",
    } : {}),
    "--runtime-continue-pulse-ms": activeDialog.isNarration ? "1680ms" : "1440ms",
    ...(isCenteredNarration
      ? { "--centered-narration-dim-duration": `${isPreviewFrame ? 1 : CENTERED_NARRATION_DIM_DURATION_MS}ms` }
      : {}),
    ...dialogBackgroundPresentation,
    ...(dialogBackgroundUrl
      ? {
          backgroundColor: "transparent",
          borderColor: "transparent",
          borderWidth: 0,
          boxShadow: "none",
          backdropFilter: "none",
        }
      : {}),
    ...(dialogThemeColor
      ? ({
          "--runtime-dialog-accent": dialogThemeColor,
          borderColor: dialogBackgroundUrl ? "transparent" : dialogThemeColor,
          boxShadow: dialogBackgroundUrl ? "none" : `0 22px 72px color-mix(in srgb, ${dialogThemeColor} 28%, transparent)`,
        } as CSSProperties)
      : {}),
  } as CSSProperties;
  const speakerStyle = (!isCenteredNarration && speakerLayout.component) || dialogThemeColor
    ? {
        ...(!isCenteredNarration && speakerLayout.component
          ? isBubblePresentation ? textAppearance(speakerLayout.style)
            : localizeChildLayoutStyle(speakerLayout.style, speakerLayout.rect, layout.rect) : {}),
        ...dialogueModeLayout.speakerStyle,
        ...(dialogThemeColor ? { color: dialogThemeColor, borderColor: dialogThemeColor } : {}),
      }
    : undefined;
  const continueStyle = (!isCenteredNarration && continueLayout.component) || dialogThemeColor
    ? {
        ...(!isCenteredNarration && continueLayout.component
          ? isBubblePresentation ? textAppearance(continueLayout.style)
            : localizeChildLayoutStyle(continueLayout.style, continueLayout.rect, layout.rect) : {}),
        ...(dialogThemeColor ? { color: dialogThemeColor } : {}),
      }
    : undefined;
  const dialogTextStyle: CSSProperties | undefined = (!isCenteredNarration && textLayout.component) || dialogTextFont || dialogTextColor || dialogTextFontSize || dialogTextFontWeight || dialogTextFontStyle
    ? {
        ...(!isCenteredNarration && textLayout.component
          ? isBubblePresentation ? textAppearance(textLayout.style)
            : localizeChildLayoutStyle(textLayout.style, textLayout.rect, layout.rect) : {}),
        ...dialogueModeLayout.textStyle,
        // Bubbles size their own reading region. A one-em mobile line box
        // clips CJK glyphs even for a single short line; use the bubble's
        // existing line height for both rendering and pagination measurement.
        ...(mobileDialogFontCap && !isBubblePresentation ? { lineHeight: 1 } : {}),
        ...(dialogTextFont ? { fontFamily: dialogTextFont } : {}),
        ...(dialogTextColor ? { color: dialogTextColor } : {}),
        ...(dialogFontSizePx !== null
          ? { fontSize: `${dialogFontSizePx}px` }
          : configuredDialogTextFontSize
            ? { fontSize: configuredDialogTextFontSize }
            : {}),
        ...(dialogTextFontWeight ? { fontWeight: dialogTextFontWeight } : {}),
        ...(dialogTextFontStyle ? { fontStyle: dialogTextFontStyle } : {}),
        ...(runtimeUILayout.layout_type === "renpy" && !isCenteredNarration && !isBubblePresentation && !isNvlPresentation
          ? { maxHeight: `${renpyDialogTextMaxHeight}px`, overflowY: "hidden", boxSizing: "border-box" }
          : {}),
      }
      : undefined;
  const safeDialogTextStyle = isCenteredNarration || isBubblePresentation
    ? dialogTextStyle
    : preventDialogTextIndicatorOverlap(dialogTextStyle, textLayout.rect, continueLayout.rect);
  const showSpeaker = !activeDialog.isNarration && Boolean(activeDialog.speaker);

  function stopPlayerAdvance(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as Element).closest(".choice-panel")) return;
    event.stopPropagation();
    if (!isNvlPresentation) return;
    const start = nvlPointerStartRef.current;
    if (!start || start.id !== event.pointerId) return;
    nvlPointerStartRef.current = null;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= 8) {
      advance(event);
    }
  }

  function advanceFromPointer(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as Element).closest(".choice-panel")) return;
    event.stopPropagation();
    if (!event.isPrimary || event.button !== 0) return;
    // A pointer gesture can also produce a compatibility click after release.
    // Retain ownership until that click, regardless of how long it is held.
    pendingPointerClickRef.current = event.pointerId;
    if (isNvlPresentation) {
      nvlPointerStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
      return;
    }
    advance(event);
  }

  function cancelPointerAdvance(event: ReactPointerEvent<HTMLElement>) {
    if ((event.target as Element).closest(".choice-panel")) return;
    event.stopPropagation();
    if (nvlPointerStartRef.current?.id === event.pointerId) {
      nvlPointerStartRef.current = null;
    }
    // Keep suppressing a possible trailing click from the cancelled gesture.
    // The next primary pointerdown replaces this token; keyboard clicks do not.
  }

  function advanceFromClick(event: MouseEvent<HTMLElement>) {
    if ((event.target as Element).closest(".choice-panel")) return;
    // Pointer compatibility clicks have a positive detail; keyboard activation
    // and the global Space/Enter forwarder use detail=0 and are separate input.
    if (event.detail > 0 && pendingPointerClickRef.current !== null) {
      pendingPointerClickRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    advance(event);
  }

  function advance(event?: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement> | ReactKeyboardEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    onStoryInteraction?.();
    const target = ref.current;
    if (target && event && "clientX" in event && "clientY" in event) {
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--dialog-ripple-x", `${event.clientX - rect.left}px`);
      target.style.setProperty("--dialog-ripple-y", `${event.clientY - rect.top}px`);
    }
    if (target) {
      target.classList.remove("is-rippling");
      void target.offsetWidth;
      target.classList.add("is-rippling");
      if (rippleTimerRef.current) window.clearTimeout(rippleTimerRef.current);
      rippleTimerRef.current = window.setTimeout(() => target.classList.remove("is-rippling"), 460);
    }
    if (isPaginated) {
      if (!isDialogPageDone) {
        if (isTyping) next();
        setForceRevealPage(true);
        return;
      }
      if (safePageIndex < pages.length - 1) {
        setDialogPagePosition(safePageIndex + 1, pages.length);
        setIsDialogPageDone(false);
        setForceRevealPage(false);
        return;
      }
    }
    next();
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if ((event.target as Element).closest(".choice-panel")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    advance(event);
  }

  function renderNvlLine(line: NvlLineState, index: number) {
    const isCurrentLine = index === nvlPage.length - 1;
    const lineSpeaker = !line.isNarration ? line.speaker : undefined;
    const lineTextPages = isCurrentLine ? pages : [line.text];
    const visibleLineText = isCurrentLine ? (lineTextPages[safePageIndex] ?? line.text) : line.text;
    const baseLineStyle = nvlTextStyleForLine(line);
    const lineStyle = isCurrentLine && dialogFontMode === "adaptive" && dialogFontSizePx !== null
      ? { ...baseLineStyle, fontSize: `${dialogFontSizePx}px` }
      : baseLineStyle;
    return (
      <span
        className={`nvl-page-line${isCurrentLine ? " is-current" : " is-history"}${line.isNarration ? " is-narration" : ""}`}
        data-nvl-line=""
        data-nvl-kind={line.isNarration ? "narration" : "dialog"}
        data-nvl-current={isCurrentLine ? "true" : "false"}
        key={`${line.scene_id}:${line.command_index}:${line.text_key ?? line.text}`}
        style={lineStyle}
      >
        {lineSpeaker && <PresentedControl layout={runtimeUILayout} component={modeControl("speaker")}
          assetUrls={currentGame?.assetUrls} scale={presentationScale} applyBaseStyle={false}>
          <span className="nvl-page-speaker" style={{ ...lineStyle, ...dialogueModeLayout.speakerStyle }}>{lineSpeaker}</span>
        </PresentedControl>}
        <PresentedControl layout={runtimeUILayout} component={modeControl("text")}
          assetUrls={currentGame?.assetUrls} scale={presentationScale} applyBaseStyle={false}>
        <span className="nvl-page-text" style={lineStyle}>
          {isCurrentLine ? (
            <TypewriterText
              key={(line.text_key ?? line.text) + ":nvl:" + safePageIndex}
              text={visibleLineText}
              textKey={(line.text_key ?? line.text) + ":nvl:" + safePageIndex}
              charactersPerSecond={settings.textSpeed}
              instantReveal={instantReveal}
              variant={line.isNarration ? "narration" : "dialog"}
              onDone={() => {
                setIsDialogPageDone(true);
                if (safePageIndex >= lineTextPages.length - 1) {
                  markCurrentDialogRead(line.text_key);
                  completeCurrentTyping(line.text_key);
                }
              }}
            />
          ) : line.text}
        </span>
        </PresentedControl>
      </span>
    );
  }

  function renderNvlMeasureLine(line: NvlLineState, index: number) {
    const lineSpeaker = !line.isNarration ? line.speaker : undefined;
    return (
      <span
        className={`nvl-page-line${line.isNarration ? " is-narration" : ""}`}
        data-nvl-measure-line=""
        key={`${line.scene_id}:${line.command_index}:${line.text_key ?? line.text}:measure:${index}`}
        style={nvlTextStyleForLine(line)}
      >
        {lineSpeaker && <PresentedControl layout={runtimeUILayout} component={modeControl("speaker")}
          assetUrls={currentGame?.assetUrls} scale={presentationScale} applyBaseStyle={false}>
          <span className="nvl-page-speaker" style={{ ...nvlTextStyleForLine(line), ...dialogueModeLayout.speakerStyle }}>{lineSpeaker}</span>
        </PresentedControl>}
        <PresentedControl layout={runtimeUILayout} component={modeControl("text")}
          assetUrls={currentGame?.assetUrls} scale={presentationScale} applyBaseStyle={false}>
        <span className="nvl-page-text" style={nvlTextStyleForLine(line)}>{line.text}</span>
        </PresentedControl>
      </span>
    );
  }

  // NVL choices share the visual frame, not an interactive button ancestor.
  // Ordinary dialogue retains its existing native button and input contract.
  const DialogRoot = isNvlPresentation ? "div" : "button";
  const advanceLabel = `\u7ee7\u7eed\u5267\u60c5\u3002${activeDialog.isNarration ? "\u65c1\u767d\uff1a" : activeDialog.speaker ? `${activeDialog.speaker}\uff1a` : ""}${activeDialog.text}`;
  return (
    <PresentedControl layout={runtimeUILayout} component={modeControl("panel")} applyBaseStyle={false}
      assetUrls={currentGame?.assetUrls} scale={Math.min(frameSize.width / 1280, frameSize.height / 720)}>
    <DialogRoot
      type={isNvlPresentation ? undefined : "button"}
      role={isNvlPresentation ? "group" : undefined}
      tabIndex={isNvlPresentation ? -1 : undefined}
      className={`dialog-box ui-layouted${dialogBackgroundUrl || dialogThemeColor ? " has-dialog-visual-style" : ""}${childGeometryEnabled && !isNvlPresentation ? " has-child-layout" : ""}${portrait.ready ? " has-dialog-portrait" : ""}${isNvlPresentation ? " is-nvl-presentation" : ""}${isBubblePresentation ? " is-bubble-presentation" : ""}${isPaginated ? " is-paginated" : ""}${activeDialog.isNarration ? " is-narration" : ""}${isCenteredNarration ? " is-centered-narration" : ""}${isCenteredNarration && centeredNarrationContentReady ? " is-centered-narration-ready" : ""}`}
      data-ui-frame-mode={isCenteredNarration ? "css_owned" : layout.visualMode}
      data-runtime-layout-type={runtimeUILayout.layout_type ?? "agentvn"}
      data-dialog-presentation={runtimeUILayout.layout_type === "renpy" ? "renpy" : "agentvn"}
      data-dialog-content-mode={isNvlPresentation ? "nvl" : "dialog"}
      data-dialogue-layout-mode={isNvlPresentation ? "nvl" : isBubblePresentation ? "bubble" : "dialog"}
      data-dialogue-layout-source={dialogueModeLayout.config ? "override" : "shared"}
      data-dialog-mode-layout-geometry={dialogueModeLayout.config?.rect ? "true" : undefined}
      data-dialog-character-id={activeDialog.character_id ?? ""}
      data-dialog-bubble-anchor={isBubblePresentation ? bubblePlacement?.anchor ?? "pending" : undefined}
      data-dialog-bubble-tail={isBubblePresentation ? bubblePlacement?.tail ?? "pending" : undefined}
      data-ui-text-scale={textLayout.textScale.dialogFontScale}
      data-dialog-layout-mode="fixed"
      data-dialog-overflow={dialogPhysicallyOverflows ? "scroll" : "none"}
      data-dialog-font-mode={dialogFontMode}
      data-dialog-font-scale={dialogFontScale.toFixed(4)}
      data-centered-narration-ready={isCenteredNarration ? (centeredNarrationContentReady ? "true" : "false") : undefined}
      data-dialog-page={safePageIndex + 1}
      data-dialog-pages={pages.length}
      data-dialog-page-done={isDialogPageDone ? "true" : "false"}
      ref={(element: HTMLDivElement | HTMLButtonElement | null) => { ref.current = element; }}
      style={dialogPanelStyle}
      aria-label={isNvlPresentation ? "NVL 剧情与分支" : advanceLabel}
      onPointerDown={advanceFromPointer}
      onPointerUp={stopPlayerAdvance}
      onPointerCancel={cancelPointerAdvance}
      onLostPointerCapture={cancelPointerAdvance}
      onKeyDownCapture={handleDialogKeyDown}
      onClick={advanceFromClick}
    >
      {isBubblePresentation && <span className="dialog-bubble-tail" aria-hidden="true" />}
      {portraitSource && (
        <img
          key={portraitSource}
          className="dialog-portrait"
          data-dialog-portrait={activeDialog.portrait}
          data-portrait-ready={portrait.ready ? "true" : "false"}
          src={portraitSource}
          alt={`${activeDialog.speaker || "角色"}的头像`}
          draggable={false}
          onLoad={portrait.onLoad}
          onError={portrait.onError}
        />
      )}
      {isNvlPresentation ? (
        <>
          <button type="button" className="nvl-advance-surface" aria-label={advanceLabel}>
          <span
            key={nvlPageStartIndex}
            ref={nvlPageRef}
            className="nvl-page"
            aria-label={`NVL 对话页，第${nvlVisiblePageCount}页，共${nvlVisiblePageCount}页`}
            data-nvl-page-index={nvlVisiblePageCount}
            data-nvl-page-count={nvlVisiblePageCount}
            data-nvl-total-lines={nvlPage.length}
            data-nvl-current-text-page={isNvlPresentation ? safePageIndex + 1 : undefined}
            data-nvl-current-text-pages={isNvlPresentation ? pages.length : undefined}
            data-testid="nvl-page"
          >
            {nvlPage.slice(nvlPageStartIndex).map((line, index) => renderNvlLine(line, nvlPageStartIndex + index))}
          </span>
          </button>
          <span className="nvl-page-measure" ref={nvlMeasureRef} aria-hidden="true">
            {nvlPage.map(renderNvlMeasureLine)}
          </span>
          <ChoicePanel embeddedNvl />
        </>
      ) : (
      <>
      {showSpeaker && (
        <PresentedControl layout={runtimeUILayout} component={modeControl("speaker")} applyBaseStyle={false}
          assetUrls={currentGame?.assetUrls} scale={Math.min(frameSize.width / 1280, frameSize.height / 720)}>
        <span
          ref={speakerRef}
          className={`${childGeometryEnabled && speakerLayout.component ? "speaker ui-layouted has-layout-style" : "speaker"}`}
          style={speakerStyle}
          title={activeDialog.speaker}
        >
          {activeDialog.speaker}
        </span>
        </PresentedControl>
      )}
      <PresentedControl layout={runtimeUILayout} component={modeControl("text")} applyBaseStyle={false}
        assetUrls={currentGame?.assetUrls} scale={Math.min(frameSize.width / 1280, frameSize.height / 720)}>
      <p
        ref={textRef}
        className={`${childGeometryEnabled && textLayout.component ? "dialog-text ui-layouted has-layout-style" : "dialog-text"}${isPaginated ? " is-paginated" : ""}${activeDialog.isNarration ? " is-narration" : ""}`}
        style={safeDialogTextStyle}
      >
        {centeredNarrationContentReady && (
          <TypewriterText
            key={(activeDialog.text_key ?? activeDialog.text) + ":page:" + safePageIndex}
            text={visibleText}
            textKey={(activeDialog.text_key ?? activeDialog.text) + ":page:" + safePageIndex}
            charactersPerSecond={settings.textSpeed}
            instantReveal={instantReveal}
            variant={activeDialog.isNarration ? "narration" : "dialog"}
            onDone={() => {
              setIsDialogPageDone(true);
              if (!isPaginated || safePageIndex === pages.length - 1) {
                markCurrentDialogRead(activeDialog.text_key);
                completeCurrentTyping(activeDialog.text_key);
              }
            }}
          />
        )}
      </p>
      </PresentedControl>
      <PresentedControl layout={runtimeUILayout} component={continueLayout.component} applyBaseStyle={false}
        assetUrls={currentGame?.assetUrls} scale={Math.min(frameSize.width / 1280, frameSize.height / 720)}>
      <span
        className={`${childGeometryEnabled && continueLayout.component ? "continue-indicator ui-layouted has-layout-style" : "continue-indicator"}`}
        style={continueStyle}
      >
        {"\u70b9\u51fb\u7ee7\u7eed"}
      </span>
      </PresentedControl>
      </>
      )}
    </DialogRoot>
    </PresentedControl>
  );
}
