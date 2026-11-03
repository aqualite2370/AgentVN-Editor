import { useLayoutEffect, useState, type RefObject } from "react";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";
import type { DialogPortraitLayout } from "../../../../shared/cartridge/dialogPortraitLayout";

const panelProperties = ["--dialog-portrait-left", "--dialog-portrait-top", "--dialog-portrait-size", "--dialog-portrait-z"];

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
  const ready = Boolean(source && loadedSource === source && failedSource !== source);
  const { offsetX = 0, offsetY = 0, size: authoredSize } = config ?? {};

  useLayoutEffect(() => {
    const panel = panelRef.current, text = textRef.current;
    if (!panel || !text || !ready) return;
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
      const intendedLeft = anchor.left + (-gap - size + offsetX * scale) * scaleX;
      const left = (Math.min(safeRight - size * scaleX, Math.max(safeLeft, intendedLeft)) - panelRect.left)
        / scaleX - panel.clientLeft;
      const centeredTop = speaker ? anchor.top + (anchor.height - size * scaleY) / 2
        : anchor.top - (size + gap) * scaleY;
      const top = (Math.min(safeBottom - size * scaleY, Math.max(safeTop, centeredTop + offsetY * scale * scaleY)) - panelRect.top)
        / scaleY - panel.clientTop;
      panel.style.setProperty("--dialog-portrait-left", `${left}px`);
      panel.style.setProperty("--dialog-portrait-top", `${top}px`);
      panel.style.setProperty("--dialog-portrait-size", `${size}px`);
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
    };
  }, [ready, source, layoutKey, panelRef, textRef, speakerRef, offsetX, offsetY, authoredSize]);

  return {
    ready,
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
