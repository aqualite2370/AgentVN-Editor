import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { LoadingAnimationConfig } from "../../types/script";
import { BootAnimation } from "./BootAnimation";
import { openingPresentationStyle, resolveOpeningPresentation } from "../../../../shared/cartridge/openingPresentation";
import { Button } from "./Button";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

/** Authored opening media owns a viewport, never the loader's card or morph. */
export function OpeningScreen({ animation, assetUrls, complete, onCycleComplete, onSkip, onComplete, onError }: {
  animation: LoadingAnimationConfig;
  assetUrls: Record<string, string>;
  complete: boolean;
  onCycleComplete: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<Animation>();
  const skipRequestedRef = useRef(false);
  const pressedRef = useRef<{ id: number; x: number; y: number }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const recoveryRef = useRef<HTMLDivElement>(null);
  const reportErrorRef = useRef(onError);
  reportErrorRef.current = onError;
  const handleError = useCallback((message: string) => {
    setError(message);
    reportErrorRef.current(message);
  }, []);
  const presentation = resolveOpeningPresentation(animation.presentation);
  const mediaStyle = openingPresentationStyle(animation.presentation);
  const mediaLabel = animation.kind === "video" ? "视频" : "图片";

  function skip() {
    if (complete || skipRequestedRef.current) return;
    skipRequestedRef.current = true;
    rootRef.current?.querySelector("video")?.pause();
    onSkip();
  }

  function consumePointer(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (error) return;
    if (event.type === "pointerdown") {
      if (!event.isPrimary || event.button !== 0 || pressedRef.current) return;
      pressedRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const pressed = pressedRef.current;
    if (!pressed || pressed.id !== event.pointerId) return;
    pressedRef.current = undefined;
    if (event.type === "pointerup" && event.button === 0 && !complete && !skipRequestedRef.current
      && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) <= 8) {
      event.preventDefault();
      skip();
    }
  }

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (error) recoveryRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    else rootRef.current?.focus({ preventScroll: true });
  }, [error]);

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
      role={error ? undefined : "status"} aria-label={error ? undefined : "正在播放开场动画，点击或轻触跳过"} tabIndex={-1}
      onPointerDown={consumePointer} onPointerUp={consumePointer} onPointerCancel={consumePointer}
      onLostPointerCapture={() => { pressedRef.current = undefined; }}
      onClick={event => { event.preventDefault(); event.stopPropagation(); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (!error || complete) { event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); skip(); return; }
        if (event.key !== "Tab") return;
        event.preventDefault();
        const buttons = Array.from(recoveryRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }}>
      <div ref={mediaRef} className="runtime-opening-media" data-presentation={presentation.mode}
        {...(error || complete ? { inert: "" } : {})}
        style={{ width: mediaStyle.width, height: mediaStyle.height,
          "--opening-media-fit": mediaStyle.fit } as CSSProperties}>
        {!error && <BootAnimation key={attempt} complete={complete} animation={animation} assetUrls={assetUrls} presentation="fullscreen"
          onCycleComplete={onCycleComplete} onError={handleError} />}
      </div>
      {error && <div ref={recoveryRef} className="opening-media-recovery" data-testid="opening-media-error"
        role="alertdialog" aria-modal="true" aria-labelledby="opening-error-title" aria-describedby="opening-error-message"
        {...(complete ? { inert: "" } : {})}>
        <strong id="opening-error-title">片头{mediaLabel}暂时无法播放</strong>
        <p id="opening-error-message">可以重试{mediaLabel}，或跳过片头进入游戏。</p>
        <pre>{error}</pre>
        <div className="card-actions">
          <Button onClick={() => {
            setCopyStatus(""); setAttempt(value => value + 1); setError(undefined);
          }}>重试{mediaLabel}</Button>
          <Button onClick={skip}>跳过片头</Button>
          <Button variant="ghost" onClick={() => {
            void (async () => {
              try {
                if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持剪贴板");
                await navigator.clipboard.writeText(error);
                setCopyStatus("已复制诊断");
              } catch (failure) {
                setCopyStatus("复制失败，请记录下方诊断");
                reportFrontendError("player.opening-clipboard", failure);
              }
            })();
          }}>复制诊断</Button>
        </div>
        <span role="status">{copyStatus}</span>
      </div>}
    </div>,
    document.body,
  );
}
