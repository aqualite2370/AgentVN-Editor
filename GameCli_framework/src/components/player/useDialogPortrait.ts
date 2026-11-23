import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import { dialogPortraitStagePlacement, type DialogPortraitLayout } from "../../../../shared/cartridge/dialogPortraitLayout";
import { useRuntimeStore } from "../../store/runtimeStore";

const panelProperties = ["--dialog-portrait-left", "--dialog-portrait-top", "--dialog-portrait-size",
  "--dialog-portrait-width", "--dialog-portrait-height", "--dialog-portrait-z"];

function clampPortraitStart(start: number, extent: number, safeStart: number, safeEnd: number, offset: number) {
  // Manual offsets can put part of the portrait past the stage edge, but
  // keep at least a quarter of each axis inside. Automatic placement stays inset.
  const extra = offset === 0 ? 0 : 12 + extent * 0.75;
  return Math.max(safeStart - extra, Math.min(safeEnd + extra - extent, start));
}

/** Presentation geometry only. Author coordinates and saved dialogue stay intact. */
export function useDialogPortrait({
  source, assetId, panelRef, textRef, speakerRef, layoutKey, config,
}: {
  source?: string;
  assetId?: string | null;
  panelRef: RefObject<HTMLElement | null>;
  textRef: RefObject<HTMLElement | null>;
  speakerRef: RefObject<HTMLElement | null>;
  layoutKey: string;
  config?: DialogPortraitLayout;
}) {
  const [loadedSource, setLoadedSource] = useState<string>();
  const [failedSource, setFailedSource] = useState<string>();
  const imageRef = useRef<HTMLImageElement>(null);
  const presentationReady = useRuntimeStore(state => state.launchTransition === "idle");
  const ready = Boolean(source && loadedSource === source && failedSource !== source);
  const { offsetX = 0, offsetY = 0, size: authoredSize } = config ?? {};
  // Preserve existing explicit nameplate coordinates. New automatic placement
  // uses its own display area, never the nameplate's line height as a size cap.
  const stagePlacement = dialogPortraitStagePlacement(config);
  const width = config?.width ?? 208, height = config?.height ?? 240;
  const entrance = config?.entrance ?? "slide-left";

  useLayoutEffect(() => {
    const panel = panelRef.current, text = textRef.current;
    if (!panel || !text || !ready) return;
    const speaker = speakerRef.current;
    const originals = [text, ...(speaker ? [speaker] : [])].map(element => ({
      element, padding: element.style.paddingLeft, base: parseFloat(getComputedStyle(element).paddingLeft) || 0,
      justify: element.style.justifyContent, items: element.style.justifyItems, align: element.style.textAlign,
      margin: element.style.marginLeft, baseMargin: parseFloat(getComputedStyle(element).marginLeft) || 0, shift: 0,
    }));
    let frame = 0, disposed = false;
    const measure = () => {
      if (disposed) return;
      const speaker = speakerRef.current;
      const style = getComputedStyle(text), parentStyle = getComputedStyle(panel);
      const number = (value: string) => parseFloat(value) || 0;
      const panelRect = panel.getBoundingClientRect();
      const stageRect = panel.closest(".story-player")?.getBoundingClientRect();
      const anchor = (speaker ?? text).getBoundingClientRect();
      // Convert rendered coordinates to the panel's padding-box coordinates
      // exactly once. This includes a nameplate's own anchor/translation and
      // follows a scaled dialogue panel without scaling its offset twice.
      const scaleX = panelRect.width / panel.offsetWidth || 1;
      const scaleY = panelRect.height / panel.offsetHeight || 1;
      const scale = number(parentStyle.getPropertyValue("--runtime-ui-scale")) || 1;
      const gap = 12 * scale;
      const safeLeft = Math.max(0, stageRect?.left ?? 0) + 12;
      const safeRight = Math.min(window.innerWidth, stageRect?.right ?? window.innerWidth) - 12;
      const safeTop = Math.max(0, stageRect?.top ?? 0) + 12;
      const safeBottom = Math.min(window.innerHeight, stageRect?.bottom ?? window.innerHeight) - 12;
      const size = Math.max(0, Math.min(authoredSize !== undefined ? authoredSize * scale : 64 * scale,
        authoredSize === undefined && speaker ? anchor.height / scaleY : Infinity,
        authoredSize === undefined && offsetX === 0 ? (anchor.left - safeLeft) / scaleX - gap : (safeRight - safeLeft) / scaleX,
        (safeBottom - safeTop) / scaleY));
      if (stagePlacement) {
        const availableWidth = (safeRight - safeLeft) / scaleX;
        const displayWidth = Math.min(width * scale, availableWidth * .28);
        const displayHeight = Math.min(height * scale, (safeBottom - safeTop) / scaleY * .55);
        const renderedWidth = displayWidth * scaleX, renderedHeight = displayHeight * scaleY;
        const left = clampPortraitStart(panelRect.left + offsetX * scale * scaleX,
          renderedWidth, safeLeft, safeRight, offsetX);
        const top = clampPortraitStart(panelRect.bottom + offsetY * scale * scaleY - renderedHeight,
          renderedHeight, safeTop, safeBottom, offsetY);
        panel.style.setProperty("--dialog-portrait-left", `${(left - panelRect.left) / scaleX - panel.clientLeft}px`);
        panel.style.setProperty("--dialog-portrait-top", `${(top - panelRect.top) / scaleY - panel.clientTop}px`);
        panel.style.setProperty("--dialog-portrait-width", `${displayWidth}px`);
        panel.style.setProperty("--dialog-portrait-height", `${displayHeight}px`);
        panel.style.setProperty("--dialog-portrait-z", `${Math.max(number(style.zIndex),
          speaker ? number(getComputedStyle(speaker).zIndex) : 0) + 1}`);
        for (const original of originals) {
          let rect = original.element.getBoundingClientRect();
          const baseLeft = rect.left - original.shift * scaleX;
          const portraitRight = left + renderedWidth;
          // A portrait outside the leading text area should not move text or
          // consume the whole line just because it is far to the right.
          const reservesGutter = top < rect.bottom && top + renderedHeight > rect.top &&
            portraitRight > baseLeft && left < baseLeft + rect.width / 2;
          if (original.element === speaker) {
            // A narrow name container cannot absorb a portrait-width padding:
            // its text would be clipped inside its unchanged box. Move the
            // presentation box as a whole, preserving its authored width and
            // alignment. Subtract our previous shift so ResizeObserver cannot
            // accumulate movement on subsequent measurements.
            const wanted = reservesGutter ? Math.max(0, (portraitRight + gap * scaleX - baseLeft) / scaleX) : 0;
            const available = Math.max(0, (safeRight - baseLeft - rect.width) / scaleX);
            original.shift = Math.min(wanted, available);
            original.element.style.marginLeft = `${original.baseMargin + original.shift}px`;
            rect = original.element.getBoundingClientRect();
          }
          // Reserve only the overlap in the existing content box. Coordinates,
          // authored rectangles and the remaining text area keep their owner.
          const inset = reservesGutter
            ? Math.max(original.base, Math.min(rect.width / (2 * scaleX), (portraitRight + gap * scaleX - rect.left) / scaleX))
            : original.base;
          original.element.style.paddingLeft = `${inset}px`;
          if (inset > original.base) {
            original.element.style.justifyContent = "start";
            original.element.style.justifyItems = "start";
            original.element.style.textAlign = "left";
          }
        }
        return;
      }
      const intendedLeft = anchor.left + (-gap - size + offsetX * scale) * scaleX;
      const left = (clampPortraitStart(intendedLeft, size * scaleX, safeLeft, safeRight, offsetX) - panelRect.left)
        / scaleX - panel.clientLeft;
      const centeredTop = speaker ? anchor.top + (anchor.height - size * scaleY) / 2
        : anchor.top - (size + gap) * scaleY;
      const top = (clampPortraitStart(centeredTop + offsetY * scale * scaleY, size * scaleY, safeTop, safeBottom, offsetY) - panelRect.top)
        / scaleY - panel.clientTop;
      panel.style.setProperty("--dialog-portrait-left", `${left}px`);
      panel.style.setProperty("--dialog-portrait-top", `${top}px`);
      panel.style.setProperty("--dialog-portrait-size", `${size}px`);
      panel.style.setProperty("--dialog-portrait-width", `${size}px`);
      panel.style.setProperty("--dialog-portrait-height", `${size}px`);
      panel.style.setProperty("--dialog-portrait-z", `${Math.max(number(style.zIndex),
        speaker ? number(getComputedStyle(speaker).zIndex) : 0) + 1}`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(panel); observer.observe(text);
    if (speakerRef.current) observer.observe(speakerRef.current);
    window.addEventListener("resize", schedule);
    void document.fonts.ready.then(() => { if (!disposed) schedule(); });
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      panelProperties.forEach(property => panel.style.removeProperty(property));
      for (const original of originals) {
        original.element.style.paddingLeft = original.padding;
        original.element.style.justifyContent = original.justify;
        original.element.style.justifyItems = original.items;
        original.element.style.textAlign = original.align;
        original.element.style.marginLeft = original.margin;
      }
    };
  }, [ready, source, layoutKey, panelRef, textRef, speakerRef, offsetX, offsetY, authoredSize, stagePlacement, width, height]);

  useLayoutEffect(() => {
    const image = imageRef.current;
    if (!ready || !presentationReady || !image || entrance === "none") return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const style = getComputedStyle(image);
    const token = style.getPropertyValue(reduced ? "--motion-fast" : "--motion").trim();
    const duration = (parseFloat(token) || (reduced ? 140 : 240)) * (/^[\d.]+s$/.test(token) ? 1000 : 1);
    const animation = image.animate([
      { opacity: 0, transform: `translateX(${reduced ? -6 : -32}px)` },
      { opacity: 1, transform: "translateX(0px)" },
    ], { duration, easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.23,1,0.32,1)", fill: "both" });
    void animation.finished.then(() => animation.cancel()).catch(() => {});
    return () => animation.cancel();
  }, [ready, presentationReady, source, entrance]);

  return {
    ready: ready && presentationReady,
    imageRef,
    stagePlacement,
    onLoad: () => { if (source) setLoadedSource(source); },
    onError: () => {
      if (!source) return;
      setFailedSource(source);
      reportFrontendError("player.dialog-portrait", new Error("对白头像资源加载失败，已保留完整正文区域。"), {
        assetId: assetId ?? null,
      });
    },
  };
}
