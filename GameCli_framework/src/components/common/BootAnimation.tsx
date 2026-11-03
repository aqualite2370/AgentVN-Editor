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
    if (!complete || resolvedRef.current) return;
    const timer = window.setTimeout(resolveAtCycleBoundary, 1800);
    return () => window.clearTimeout(timer);
  }, [complete, resolveAtCycleBoundary]);

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
  presentation?: "card" | "fullscreen";
  onCycleComplete?: () => void;
  onError?: (message: string) => void;
}

export function BootAnimation({ animation, assetUrls = {}, complete = false, onComplete, onCycleComplete, onError, presentation = "card" }: BootAnimationProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const customCompleteRef = useRef<number>();
  const customCycleRef = useRef(false);
  const imageIds = animation?.kind === "image_sequence" ? animation.image_asset_ids.filter(Boolean) : [];
  const imageUrls = useMemo(() => imageIds.map((assetId) => toRuntimeAssetUrl(assetUrls[assetId])).filter((url): url is string => Boolean(url)), [assetUrls, imageIds]);
  const videoUrl = animation?.kind === "video" ? toRuntimeAssetUrl(assetUrls[animation.video_asset_id]) : undefined;
  const frameDurationMs = animation?.kind === "image_sequence" ? Math.max(100, animation.frame_duration_ms ?? 1000) : 1000;
  const hasCustomAnimation = Boolean(videoUrl || imageUrls.length > 0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    let disposed = false;
    // React StrictMode replays effects. Reattach the source and resume after
    // its cleanup rather than leaving the replayed element paused/source-less.
    if (video.getAttribute("src") !== videoUrl) video.src = videoUrl;
    void video.play().catch(() => {
      if (!disposed) errorRef.current?.("开屏视频无法解码或播放，请检查视频素材格式后重新导出。");
    });
    return () => {
      disposed = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [videoUrl]);

  useEffect(() => {
    setFrameIndex(0);
    customCycleRef.current = false;
  }, [animation]);

  useEffect(() => {
    setMediaAspectRatio(undefined);
  }, [animation, frameIndex, videoUrl, imageUrls.length]);

  useEffect(() => {
    if (!hasCustomAnimation || !complete) return;
    customCompleteRef.current = window.setTimeout(() => onComplete?.(), bootLoaderSettleMs);
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

  useEffect(() => {
    if (!hasCustomAnimation || imageUrls.length === 0 || customCycleRef.current) return;
    const timer = window.setTimeout(() => {
      if (customCycleRef.current) return;
      customCycleRef.current = true;
      onCycleComplete?.();
    }, imageUrls.length * frameDurationMs);
    return () => window.clearTimeout(timer);
  }, [frameDurationMs, hasCustomAnimation, imageUrls.length, onCycleComplete]);

  const customAnimationStyle = (mediaAspectRatio && Number.isFinite(mediaAspectRatio)
    ? { "--boot-animation-aspect-ratio": String(mediaAspectRatio) }
    : undefined) as CSSProperties | undefined;
  const mediaClassName = `custom-loading-animation${presentation === "fullscreen" ? " is-fullscreen" : ""}${complete ? " is-complete" : ""}`;

  if (videoUrl) {
    return (
      <div className={mediaClassName} style={customAnimationStyle} aria-hidden="true">
        <video
          ref={videoRef}
          src={videoUrl}
          autoPlay
          muted
          loop={false}
          playsInline
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            if (videoWidth > 0 && videoHeight > 0) setMediaAspectRatio(videoWidth / videoHeight);
          }}
          onEnded={() => {
            if (customCycleRef.current) return;
            customCycleRef.current = true;
            onCycleComplete?.();
          }}
          onError={() => {
            onError?.("开屏视频无法解码或播放，请检查视频素材格式后重新导出。");
          }}
        />
      </div>
    );
  }

  if (imageUrls.length > 0) {
    return (
      <div className={mediaClassName} style={customAnimationStyle} aria-hidden="true">
        <img
          src={imageUrls[frameIndex % imageUrls.length]}
          alt=""
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setMediaAspectRatio(naturalWidth / naturalHeight);
          }}
          onError={() => onError?.("开屏图片无法加载，请检查图片素材是否仍存在并重新导出。")}
        />
      </div>
    );
  }

  return <BootCircleLoader complete={complete} onComplete={onComplete} />;
}
