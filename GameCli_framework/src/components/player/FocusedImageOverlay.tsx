import { useEffect, useRef, useState, type AnimationEvent, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { assetResolver } from "../../engine/assetResolver";
import { useRuntimeStore } from "../../store/runtimeStore";

type FocusedImageStyle = CSSProperties & {
  "--focused-image-backdrop-opacity": number;
  "--focused-image-backdrop-blur": string;
};

function recordFocusedImageProbe(event: string, details?: Record<string, unknown>) {
  const host = window as Window & { __AGENTVN_FOCUSED_IMAGE_LOG__?: Array<Record<string, unknown>> };
  const log = host.__AGENTVN_FOCUSED_IMAGE_LOG__ ?? [];
  log.push({ event, at: performance.now(), ...details });
  host.__AGENTVN_FOCUSED_IMAGE_LOG__ = log.slice(-100);
}

function runtimeMotionScale(element: HTMLElement): number {
  const scope = element.closest<HTMLElement>(".ui-skin-scope");
  const value = Number.parseFloat(getComputedStyle(scope ?? element).getPropertyValue("--runtime-skin-motion-scale"));
  return Number.isFinite(value) ? Math.max(0, value) : 1;
}

export function FocusedImageOverlay() {
  const focusedImage = useRuntimeStore((store) => store.engineState.focusedImage);
  const dismissFocusedImage = useRuntimeStore((store) => store.dismissFocusedImage);
  const [phase, setPhase] = useState<"visible" | "exiting">("visible");
  const [imageFailed, setImageFailed] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dismissTimerRef = useRef<number>();
  const mountedAtRef = useRef(performance.now());

  useEffect(() => {
    setPhase("visible");
    setImageFailed(false);
    mountedAtRef.current = performance.now();
    recordFocusedImageProbe("mounted", { image_id: focusedImage?.image_id });
    overlayRef.current?.focus();
    return () => {
      if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    };
  }, [focusedImage?.image_id]);

  if (!focusedImage) return null;

  const imageUrl = assetResolver.resolveAsset(focusedImage.image_id);
  const displayName = focusedImage.image_display_name?.trim() || focusedImage.image_id;
  const style: FocusedImageStyle = {
    "--focused-image-backdrop-opacity": focusedImage.backdrop_opacity,
    "--focused-image-backdrop-blur": `${focusedImage.backdrop_blur_px}px`,
  };

  function dismiss() {
    const overlay = overlayRef.current;
    if (!overlay || phase === "exiting") return;
    setPhase("exiting");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const duration = reducedMotion ? 0 : Math.round(220 * runtimeMotionScale(overlay));
    if (duration <= 0) {
      recordFocusedImageProbe("dismiss-immediate");
      dismissFocusedImage();
      return;
    }
    recordFocusedImageProbe("dismiss-requested", { duration });
    dismissTimerRef.current = window.setTimeout(() => {
      recordFocusedImageProbe("dismiss-timeout-fired");
      dismissFocusedImage();
    }, duration + 50);
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (performance.now() - mountedAtRef.current < 120) return;
    dismiss();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["Enter", " ", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || phase !== "exiting") return;
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    recordFocusedImageProbe("dismiss-animation-ended");
    dismissFocusedImage();
  }

  return (
    <div
      ref={overlayRef}
      className={`focused-image-overlay is-${phase}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={`关闭图片展示：${displayName}`}
      data-testid="focused-image-overlay"
      data-phase={phase}
      data-image-id={focusedImage.image_id}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="focused-image-backdrop" aria-hidden="true" data-testid="focused-image-backdrop" />
      <figure className="focused-image-figure">
        <div className="focused-image-media">
          {imageUrl && !imageFailed ? (
            <img
              src={imageUrl}
              alt={focusedImage.alt?.trim() || displayName}
              style={{ objectFit: focusedImage.image_fit === "stretch" ? "fill" : focusedImage.image_fit }}
              data-testid="focused-image"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <div className="focused-image-missing" role="img" aria-label={`图片素材缺失：${displayName}`}>
              <strong>图片素材无法显示</strong>
              <span>{displayName}</span>
              <small>点击任意位置可继续剧情</small>
            </div>
          )}
        </div>
        {focusedImage.caption?.trim() && <figcaption>{focusedImage.caption.trim()}</figcaption>}
      </figure>
    </div>
  );
}
