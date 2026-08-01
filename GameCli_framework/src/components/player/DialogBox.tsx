import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { DialogState } from "../../types/settings";
import { isTextRead } from "../../engine/readProgress";
import { useRuntimeStore } from "../../store/runtimeStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { LibraryGame } from "../../types/cartridge";
import type { UILayoutRect } from "../../../../shared/cartridge/uiSkin";
import { fontFamilyForAsset, useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { clearRuntimeAnimationSettled } from "../../utils/animationResidue";
import { backgroundFitSize } from "../../utils/backgroundFit";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";
import { TypewriterText } from "./TypewriterText";
import { latestEffect, useRuntimeAnimation } from "./runtimeAnimation";

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

function measureDialogPages(text: string, element: HTMLElement): string[] {
  const width = Math.floor(element.clientWidth || element.getBoundingClientRect().width);
  const height = Math.floor(element.clientHeight || element.getBoundingClientRect().height);
  if (!text || width < 32 || height < 32) return [text];

  const style = window.getComputedStyle(element);
  const measurer = document.createElement("p");
  const copiedProperties = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
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
  document.body.appendChild(measurer);

  const fits = (value: string) => {
    measurer.textContent = value || " ";
    return measurer.scrollHeight <= height + 1 && measurer.scrollWidth <= width + 1;
  };

  const pages: string[] = [];
  let remaining = text;
  let guard = 0;
  while (remaining.length > 0 && guard < 80) {
    guard += 1;
    if (fits(remaining)) {
      pages.push(remaining);
      break;
    }
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
    pages.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }
  measurer.remove();
  return pages.length > 0 ? pages : [text];
}

function collapsePathologicalDialogPages(text: string, pages: string[]): string[] {
  if (pages.length <= 1) return pages;
  const compactLength = text.replace(/\s+/g, "").length;
  if (compactLength <= 0) return [text];
  const averageCharsPerPage = compactLength / pages.length;
  const tinyPages = pages.filter((page) => page.replace(/\s+/g, "").length <= 2).length;
  const pathological =
    averageCharsPerPage < 10 ||
    tinyPages >= Math.ceil(pages.length * 0.35) ||
    pages.length > Math.max(10, Math.ceil(compactLength / 8));
  return pathological ? [text] : pages;
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

function dialogPanelLayoutStyle(style?: CSSProperties): CSSProperties {
  if (!style) return {};
  return {
    ...style,
    boxSizing: "border-box",
  };
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

export function DialogBox() {
  const dialog = useRuntimeStore((state) => state.engineState.dialog);
  const effects = useRuntimeStore((state) => state.engineState.animationEffects);
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const isSkipMode = useRuntimeStore((state) => state.engineState.isSkipMode);
  const typingRevealRequested = useRuntimeStore((state) => state.engineState.typingRevealRequested);
  const isTyping = useRuntimeStore((state) => state.engineState.isTyping);
  const isPreviewFrame = useRuntimeStore((state) => state.engineState.isPreviewFrame);
  const markCurrentDialogRead = useRuntimeStore((state) => state.markCurrentDialogRead);
  const completeCurrentTyping = useRuntimeStore((state) => state.completeCurrentTyping);
  const next = useRuntimeStore((state) => state.next);
  const settings = useSettingsStore((state) => state.settings);
  const ref = useRef<HTMLButtonElement | null>(null);
  const textRef = useRef<HTMLParagraphElement | null>(null);
  const rippleTimerRef = useRef<number | null>(null);
  const lastPointerAdvanceAtRef = useRef(0);
  const layout = useUILayoutStyle("player", "dialog_panel");
  const speakerLayout = useUILayoutStyle("player", "speaker_label");
  const textLayout = useUILayoutStyle("player", "dialog_text");
  const continueLayout = useUILayoutStyle("player", "continue_indicator");
  const [dialogPages, setDialogPages] = useState<string[]>([]);
  const [dialogPageIndex, setDialogPageIndex] = useState(0);
  const [isDialogPageDone, setIsDialogPageDone] = useState(false);
  const [forceRevealPage, setForceRevealPage] = useState(false);

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
    setDialogPages([]);
    setDialogPageIndex(0);
    setIsDialogPageDone(false);
    setForceRevealPage(false);
  }, [dialog?.text_key, dialog?.text, layout.component, textLayout.component]);

  useLayoutEffect(() => {
    const text = dialog?.text;
    const textElement = textRef.current;
    if (!text || !textElement) return;
    const measure = () => {
      const nextPages = collapsePathologicalDialogPages(text, measureDialogPages(text, textElement));
      setDialogPages(nextPages);
      setDialogPageIndex((value) => Math.min(value, Math.max(0, nextPages.length - 1)));
      setIsDialogPageDone(false);
      setForceRevealPage(false);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [dialog?.text, dialog?.text_key, textLayout.component]);

  const activeDialog = dialog;
  if (!activeDialog) return null;

  const progressGameId = currentGame?.install_id ?? currentGame?.game_id;
  const skipAllowed = isSkipMode && (settings.skipUnread || isTextRead(progressGameId, activeDialog.text_key));
  const pages = dialogPages.length > 0 ? dialogPages : [activeDialog.text];
  const safePageIndex = Math.min(dialogPageIndex, Math.max(0, pages.length - 1));
  const visibleText = pages[safePageIndex] ?? activeDialog.text;
  // A custom UI skin owns the text rectangle.  Pagination used to replace the
  // long string with a measured page before the browser had finished laying
  // out the skin, which made the first page look complete while the remaining
  // text was silently inaccessible.  Keep the full string in the fixed skin
  // rectangle and let that rectangle scroll; the default skin still uses the
  // measured page flow.
  const isPaginated = !textLayout.component && pages.length > 1;
  const instantReveal = isPreviewFrame || skipAllowed || typingRevealRequested || forceRevealPage;
  const characterStyle = activeDialog.character_id && activeDialog.dialog_style_mode !== "manual"
    ? currentGame?.script.characters?.find((character) => character.character_id === activeDialog.character_id)?.dialog_style
    : undefined;
  const effectiveDialogStyle = activeDialog.dialog_style_mode === "manual" ? activeDialog.dialog_style : (activeDialog.dialog_style ?? characterStyle);
  const dialogBackgroundUrl = resolveGameAsset(currentGame, effectiveDialogStyle?.background_asset_id);
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
  const dialogTextFontSize = typeof effectiveDialogStyle?.font_size === "number" && Number.isFinite(effectiveDialogStyle.font_size)
    ? Math.min(96, Math.max(10, Math.round(effectiveDialogStyle.font_size)))
    : undefined;
  const dialogTextFontWeight = typeof effectiveDialogStyle?.font_weight === "number" && Number.isFinite(effectiveDialogStyle.font_weight)
    ? Math.min(900, Math.max(100, Math.round(effectiveDialogStyle.font_weight / 50) * 50))
    : undefined;
  const dialogTextFontStyle = effectiveDialogStyle?.font_style === "normal" || effectiveDialogStyle?.font_style === "italic" ? effectiveDialogStyle.font_style : undefined;
  const dialogPanelStyle = {
    ...dialogPanelLayoutStyle(layout.style),
    "--runtime-continue-pulse-ms": activeDialog.isNarration ? "1680ms" : "1440ms",
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
  const childGeometryEnabled = Boolean(textLayout.component || speakerLayout.component || continueLayout.component);
  const speakerStyle = speakerLayout.component || dialogThemeColor
    ? {
        ...(speakerLayout.component ? localizeChildLayoutStyle(speakerLayout.style, speakerLayout.rect, layout.rect) : {}),
        ...(dialogThemeColor ? { color: dialogThemeColor, borderColor: dialogThemeColor } : {}),
      }
    : undefined;
  const continueStyle = continueLayout.component || dialogThemeColor
    ? {
        ...(continueLayout.component ? localizeChildLayoutStyle(continueLayout.style, continueLayout.rect, layout.rect) : {}),
        ...(dialogThemeColor ? { color: dialogThemeColor } : {}),
      }
    : undefined;
  const dialogTextStyle = textLayout.component || dialogTextFont || dialogTextColor || dialogTextFontSize || dialogTextFontWeight || dialogTextFontStyle
    ? {
        ...(textLayout.component ? localizeChildLayoutStyle(textLayout.style, textLayout.rect, layout.rect) : {}),
        ...(dialogTextFont ? { fontFamily: dialogTextFont } : {}),
        ...(dialogTextColor ? { color: dialogTextColor } : {}),
        ...(dialogTextFontSize ? { fontSize: `${Math.round(dialogTextFontSize * textLayout.textScale.dialogFontScale)}px` } : {}),
        ...(dialogTextFontWeight ? { fontWeight: dialogTextFontWeight } : {}),
        ...(dialogTextFontStyle ? { fontStyle: dialogTextFontStyle } : {}),
      }
      : undefined;
  const safeDialogTextStyle = preventDialogTextIndicatorOverlap(dialogTextStyle, textLayout.rect, continueLayout.rect);
  const showSpeaker = !activeDialog.isNarration && Boolean(activeDialog.speaker);

  function stopPlayerAdvance(event: ReactPointerEvent<HTMLElement>) {
    event.stopPropagation();
  }

  function advanceFromPointer(event: ReactPointerEvent<HTMLElement>) {
    lastPointerAdvanceAtRef.current = performance.now();
    advance(event);
  }

  function advanceFromClick(event: MouseEvent<HTMLElement>) {
    if (performance.now() - lastPointerAdvanceAtRef.current < 420) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    advance(event);
  }

  function advance(event?: MouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    const target = ref.current;
    if (target && event) {
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
        setDialogPageIndex((value) => Math.min(value + 1, pages.length - 1));
        setIsDialogPageDone(false);
        setForceRevealPage(false);
        return;
      }
    }
    next();
  }

  return (
    <button
      type="button"
      className={`dialog-box ui-layouted${dialogBackgroundUrl || dialogThemeColor ? " has-dialog-visual-style" : ""}${childGeometryEnabled ? " has-child-layout" : ""}${isPaginated ? " is-paginated" : ""}${activeDialog.isNarration ? " is-narration" : ""}`}
      data-ui-frame-mode={layout.visualMode}
      data-ui-text-scale={textLayout.textScale.dialogFontScale}
      data-dialog-layout-mode="fixed"
      data-dialog-overflow="none"
      data-dialog-page={safePageIndex + 1}
      data-dialog-pages={pages.length}
      data-dialog-page-done={isDialogPageDone ? "true" : "false"}
      ref={ref}
      style={dialogPanelStyle}
      aria-label={`\u7ee7\u7eed\u5267\u60c5\u3002${activeDialog.isNarration ? "\u65c1\u767d\uff1a" : activeDialog.speaker ? `${activeDialog.speaker}\uff1a` : ""}${activeDialog.text}`}
      onPointerDown={advanceFromPointer}
      onPointerUp={stopPlayerAdvance}
      onClick={advanceFromClick}
    >
      {showSpeaker && (
        <span
          className={`${childGeometryEnabled && speakerLayout.component ? "speaker ui-layouted has-layout-style" : "speaker"}`}
          style={speakerStyle}
          title={activeDialog.speaker}
        >
          {activeDialog.speaker}
        </span>
      )}
      <p
        ref={textRef}
        className={`${childGeometryEnabled && textLayout.component ? "dialog-text ui-layouted has-layout-style" : "dialog-text"}${isPaginated ? " is-paginated" : ""}${activeDialog.isNarration ? " is-narration" : ""}`}
        style={safeDialogTextStyle}
      >
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
      </p>
      <span
        className={`${childGeometryEnabled && continueLayout.component ? "continue-indicator ui-layouted has-layout-style" : "continue-indicator"}`}
        style={continueStyle}
      >
        {"\u70b9\u51fb\u7ee7\u7eed"}
      </span>
    </button>
  );
}
