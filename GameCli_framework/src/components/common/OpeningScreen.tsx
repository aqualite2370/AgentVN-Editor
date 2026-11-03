import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { LoadingAnimationConfig } from "../../types/script";
import { BootAnimation } from "./BootAnimation";

/** Authored opening media owns a viewport, never the loader's card or morph. */
export function OpeningScreen({ animation, assetUrls, complete, onCycleComplete, onComplete, onError }: {
  animation: LoadingAnimationConfig;
  assetUrls: Record<string, string>;
  complete: boolean;
  onCycleComplete: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<Animation>();

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    // Keep the backdrop opaque while the movie enters; fading the entire
    // stage would reveal title controls through the playing opening.
    const node = complete ? rootRef.current : mediaRef.current;
    if (!node) return;
    const from = getComputedStyle(node).opacity;
    fadeRef.current?.cancel();
    // Release CSS can serialize 420ms as .42s. WAAPI always expects ms.
    const clock = getComputedStyle(node).getPropertyValue("--opening-fade-duration").trim();
    const time = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/i.exec(clock);
    const duration = time ? Number(time[1]) * (time[2].toLowerCase() === "s" ? 1000 : 1) : NaN;
    const easing = getComputedStyle(node).getPropertyValue("--ease-out").trim();
    const fade = node.animate([{ opacity: from }, { opacity: complete ? 0 : 1 }], {
      duration: Number.isFinite(duration) && duration > 0 ? duration : 420, easing: easing || "ease-out", fill: "both",
    });
    fadeRef.current = fade;
    let disposed = false;
    void fade.finished.then(() => {
      if (!disposed && complete) onComplete();
    }, () => { /* Cancellation belongs to the next presentation or unmount. */ });
    return () => {
      disposed = true;
      node.style.opacity = getComputedStyle(node).opacity;
      fade.cancel();
    };
  }, [complete, onComplete]);

  return createPortal(
    <div ref={rootRef} className="runtime-opening-screen" data-testid="runtime-opening-screen"
      role="status" aria-label="正在播放开场动画" tabIndex={-1}
      onKeyDown={event => { event.preventDefault(); event.stopPropagation(); }}>
      <div ref={mediaRef} className="runtime-opening-media">
        <BootAnimation animation={animation} assetUrls={assetUrls} presentation="fullscreen"
          onCycleComplete={onCycleComplete} onError={onError} />
      </div>
    </div>,
    document.body,
  );
}
