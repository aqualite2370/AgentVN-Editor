import { useCallback, useEffect, useMemo, useRef, useState, type AnimationEvent, type CSSProperties } from "react";
import { RoseTwoLoader } from "./RoseTwoLoader";
import type { LoadingAnimationConfig } from "../../types/script";
import { toRuntimeAssetUrl } from "../../utils/runtimeAssetUrl";

const bootLoaderSettleMs = 320;

export interface BootCircleLoaderProps {
  complete?: boolean;
  onComplete?: () => void;
}

export function BootCircleLoader({ complete = false, onComplete }: BootCircleLoaderProps) {
  const completeRef = useRef(complete);
  const resolvedRef = useRef(false);
  const settleTimerRef = useRef<number>();
  const [resolved, setResolved] = useState(false);

  const resolveAtCycleBoundary = useCallback(() => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setResolved(true);
    if (onComplete) {
      settleTimerRef.current = window.setTimeout(onComplete, bootLoaderSettleMs);
    }
  }, [onComplete]);

  useEffect(() => {
    completeRef.current = complete;
    if (!complete) {
      resolvedRef.current = false;
      setResolved(false);
    }
  }, [complete]);

  useEffect(() => () => {
    if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
  }, []);

  useEffect(() => {
    if (!complete || !onComplete) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!media.matches) return;
    const timer = window.setTimeout(resolveAtCycleBoundary, 80);
    return () => window.clearTimeout(timer);
  }, [complete, onComplete, resolveAtCycleBoundary]);

  function handleIteration(event: AnimationEvent<HTMLSpanElement>) {
    if (event.animationName !== "project-entry-rose-cycle") return;
    if (completeRef.current) resolveAtCycleBoundary();
  }

  return (
    <div className={`project-entry-loader${resolved ? " is-complete" : ""}`} aria-hidden="true">
      <RoseTwoLoader />
      <span className="project-entry-cycle-sentinel" onAnimationIteration={handleIteration} />
    </div>
  );
}

interface BootAnimationProps extends BootCircleLoaderProps {
  animation?: LoadingAnimationConfig;
  assetUrls?: Record<string, string>;
}

export function BootAnimation({ animation, assetUrls = {}, complete = false, onComplete }: BootAnimationProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number>();
  const customCompleteRef = useRef<number>();
  const imageIds = animation?.kind === "image_sequence" ? animation.image_asset_ids.filter(Boolean) : [];
  const imageUrls = useMemo(() => imageIds.map((assetId) => toRuntimeAssetUrl(assetUrls[assetId])).filter((url): url is string => Boolean(url)), [assetUrls, imageIds]);
  const videoUrl = animation?.kind === "video" ? toRuntimeAssetUrl(assetUrls[animation.video_asset_id]) : undefined;
  const frameDurationMs = animation?.kind === "image_sequence" ? Math.max(100, animation.frame_duration_ms ?? 1000) : 1000;
  const hasCustomAnimation = Boolean(videoUrl || imageUrls.length > 0);

  useEffect(() => {
    setFrameIndex(0);
  }, [animation]);

  useEffect(() => {
    setMediaAspectRatio(undefined);
  }, [animation, frameIndex, videoUrl, imageUrls.length]);

  useEffect(() => {
    if (!hasCustomAnimation || !complete || !onComplete) return;
    customCompleteRef.current = window.setTimeout(onComplete, bootLoaderSettleMs);
    return () => {
      if (customCompleteRef.current) window.clearTimeout(customCompleteRef.current);
    };
  }, [complete, hasCustomAnimation, onComplete]);

  useEffect(() => {
    if (!hasCustomAnimation || imageUrls.length <= 1) return;
    const interval = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % imageUrls.length);
    }, frameDurationMs);
    return () => window.clearInterval(interval);
  }, [frameDurationMs, hasCustomAnimation, imageUrls.length]);

  const customAnimationStyle = (mediaAspectRatio && Number.isFinite(mediaAspectRatio)
    ? { "--boot-animation-aspect-ratio": String(mediaAspectRatio) }
    : undefined) as CSSProperties | undefined;

  if (videoUrl) {
    return (
      <div className={`custom-loading-animation${complete ? " is-complete" : ""}`} style={customAnimationStyle} aria-hidden="true">
        <video
          src={videoUrl}
          autoPlay
          muted
          loop
          playsInline
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            if (videoWidth > 0 && videoHeight > 0) setMediaAspectRatio(videoWidth / videoHeight);
          }}
        />
      </div>
    );
  }

  if (imageUrls.length > 0) {
    return (
      <div className={`custom-loading-animation${complete ? " is-complete" : ""}`} style={customAnimationStyle} aria-hidden="true">
        <img
          src={imageUrls[frameIndex % imageUrls.length]}
          alt=""
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setMediaAspectRatio(naturalWidth / naturalHeight);
          }}
        />
      </div>
    );
  }

  return <BootCircleLoader complete={complete} onComplete={onComplete} />;
}
