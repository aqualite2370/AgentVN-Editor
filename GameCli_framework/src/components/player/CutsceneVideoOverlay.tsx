import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type SyntheticEvent } from "react";
import { assetResolver } from "../../engine/assetResolver";
import { useRuntimeStore } from "../../store/runtimeStore";
import { reportFrontendError } from "../../../../shared/logging/frontendErrorLogger";

const skipHoldMs = 5000;
const doubleTapMs = 320;

export function CutsceneVideoOverlay() {
  const activeVideo = useRuntimeStore((state) => state.engineState.activeVideo);
  const completeActiveVideo = useRuntimeStore((state) => state.completeActiveVideo);
  const [armed, setArmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exiting, setExiting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState("");
  const lastTapRef = useRef(0);
  const holdStartedRef = useRef<number>();
  const holdOriginRef = useRef<{ x: number; y: number }>();
  const holdFrameRef = useRef<number>();
  const completionTimerRef = useRef<number>();
  const completedRef = useRef(false);

  useEffect(() => {
    setArmed(false);
    setProgress(0);
    setExiting(false);
    setEnding(false);
    setError("");
    completedRef.current = false;
    return () => {
      if (holdFrameRef.current) cancelAnimationFrame(holdFrameRef.current);
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
    };
  }, [activeVideo?.video_id]);

  const source = activeVideo ? assetResolver.resolveAsset(activeVideo.video_id) : undefined;

  useEffect(() => {
    if (!activeVideo || source) return;
    reportFrontendError("player.video", "找不到过场视频素材。", {
      operation: "resolve",
      videoId: activeVideo.video_id,
    });
  }, [activeVideo?.video_id, source]);

  if (!activeVideo) return null;
  const fit = activeVideo.video_fit === "stretch" ? "fill" : activeVideo.video_fit;

  function finish(afterFade = true) {
    if (completedRef.current) return;
    completedRef.current = true;
    setExiting(true);
    const delay = afterFade ? activeVideo!.fade_out_ms : 0;
    completionTimerRef.current = window.setTimeout(completeActiveVideo, delay);
  }

  function cancelHold() {
    holdStartedRef.current = undefined;
    holdOriginRef.current = undefined;
    if (holdFrameRef.current) cancelAnimationFrame(holdFrameRef.current);
    holdFrameRef.current = undefined;
    if (!completedRef.current) setProgress(0);
  }

  function updateHold(now: number) {
    const startedAt = holdStartedRef.current;
    if (startedAt === undefined || completedRef.current) return;
    const nextProgress = Math.min(1, (now - startedAt) / skipHoldMs);
    setProgress(nextProgress);
    if (nextProgress >= 1) {
      holdStartedRef.current = undefined;
      finish(true);
      return;
    }
    holdFrameRef.current = requestAnimationFrame(updateHold);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!armed || event.button !== 0 || completedRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdStartedRef.current = performance.now();
    holdOriginRef.current = { x: event.clientX, y: event.clientY };
    setProgress(0);
    holdFrameRef.current = requestAnimationFrame(updateHold);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const origin = holdOriginRef.current;
    if (!origin) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 20) cancelHold();
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const now = performance.now();
    if (holdStartedRef.current !== undefined) {
      cancelHold();
      return;
    }
    if (now - lastTapRef.current <= doubleTapMs) {
      setArmed(true);
      lastTapRef.current = 0;
      return;
    }
    lastTapRef.current = now;
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (!Number.isFinite(video.duration) || activeVideo!.fade_out_ms <= 0) return;
    if (video.duration - video.currentTime <= activeVideo!.fade_out_ms / 1000) setEnding(true);
  }

  const circumference = 2 * Math.PI * 42;
  return (
    <div
      className={`cutscene-video-overlay${exiting ? " is-exiting" : ""}${ending ? " is-ending" : ""}`}
      style={{
        "--cutscene-fade-in": `${activeVideo.fade_in_ms}ms`,
        "--cutscene-fade-out": `${activeVideo.fade_out_ms}ms`,
      } as CSSProperties}
      data-testid="cutscene-video-overlay"
      data-no-advance
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
    >
      {source && !error ? (
        <video
          src={source}
          autoPlay
          playsInline
          preload="auto"
          style={{ objectFit: fit }}
          onTimeUpdate={handleTimeUpdate}
          onCanPlay={(event) => {
            void event.currentTarget.play().catch((playError) => {
              reportFrontendError("player.video", playError, {
                operation: "play",
                videoId: activeVideo.video_id,
              });
              setError("浏览器阻止了有声视频自动播放。");
            });
          }}
          onEnded={() => finish(false)}
          onError={(event) => {
            reportFrontendError("player.video", "视频无法加载或当前设备不支持该编码。", {
              operation: "load",
              videoId: activeVideo.video_id,
              mediaErrorCode: event.currentTarget.error?.code,
            });
            setError("视频无法加载或当前设备不支持该编码。");
          }}
        />
      ) : (
        <div className="cutscene-video-error" role="alert">
          <strong>无法播放过场视频</strong>
          <span>{error || `找不到视频素材：${activeVideo.video_id}`}</span>
          <button type="button" onClick={() => finish(false)}>继续剧情</button>
        </div>
      )}

      {armed && (
        <div className="cutscene-skip-prompt" aria-live="polite">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="cutscene-progress-track" cx="50" cy="50" r="42" />
            <circle
              className="cutscene-progress-value"
              cx="50"
              cy="50"
              r="42"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset: circumference * (1 - progress),
              }}
            />
          </svg>
          <strong>{progress > 0 ? `长按中 ${Math.ceil((1 - progress) * 5)} 秒` : "长按 5 秒跳过"}</strong>
        </div>
      )}
    </div>
  );
}
