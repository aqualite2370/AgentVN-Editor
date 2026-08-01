import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
} from "react";
import { assetResolver } from "../../engine/assetResolver";
import type { BackgroundFit } from "../../types/manifest";
import type { RuntimeAnimationEffect } from "../../types/settings";
import type { NormalizedVisualTransitionConfig } from "../../../../shared/animation/visualTransition";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { backgroundFitStyle } from "../../utils/backgroundFit";
import { latestEffect, useRuntimeAnimation } from "./runtimeAnimation";

interface BackgroundFrame {
  background?: string;
  backgroundFit: BackgroundFit;
  transitionKey: number;
  url?: string;
  isPlaceholder: boolean;
}

interface BackgroundPresentation {
  current: BackgroundFrame;
  previous?: BackgroundFrame;
  transition?: NormalizedVisualTransitionConfig;
  generation: number;
  transitionDeadline?: number;
  interrupted?: boolean;
}

type BackgroundTransitionStyle = CSSProperties & {
  "--visual-transition-duration"?: string;
  "--visual-transition-easing"?: string;
};

function resolveFrame(
  background: string | undefined,
  backgroundFit: BackgroundFit | undefined,
  transitionKey: number,
): BackgroundFrame {
  return {
    background,
    backgroundFit: backgroundFit ?? "stretch",
    transitionKey,
    url: assetResolver.resolveBackground(background),
    isPlaceholder: assetResolver.isPlaceholderAsset(background),
  };
}

function frameSignature(frame: BackgroundFrame): string {
  return [
    frame.transitionKey,
    frame.background ?? "",
    frame.backgroundFit,
    frame.url ?? "",
    frame.isPlaceholder ? "placeholder" : "asset",
  ].join("|");
}

function hasVisualContent(frame: BackgroundFrame): boolean {
  return Boolean(frame.background || frame.url || frame.isPlaceholder);
}

function BackgroundTransitionFrame({
  frame,
  role,
  transitionKind,
  onAnimationEnd,
}: {
  frame: BackgroundFrame;
  role: "previous" | "current";
  transitionKind?: NormalizedVisualTransitionConfig["kind"];
  onAnimationEnd?: (event: AnimationEvent<HTMLDivElement>) => void;
}) {
  const missing = !frame.url;
  const className = [
    "background-transition-frame",
    `is-${role}`,
    missing ? "is-missing" : "",
    frame.isPlaceholder ? "is-placeholder" : "",
    transitionKind ? `transition-${transitionKind}` : "",
  ].filter(Boolean).join(" ");
  const style: CSSProperties = {
    ...backgroundFitStyle(frame.backgroundFit),
    ...(frame.url ? { backgroundImage: `url(${frame.url})` } : {}),
  };

  return (
    <div
      className={className}
      data-transition-role={role}
      data-background-id={frame.background ?? ""}
      data-background-fit={frame.backgroundFit}
      data-transition-key={frame.transitionKey}
      aria-hidden={role === "previous" ? "true" : undefined}
      onAnimationEnd={onAnimationEnd}
      style={style}
    >
      {(missing || frame.isPlaceholder) && (
        <div className="background-placeholder-note">
          <strong>{frame.isPlaceholder ? "视觉占位背景" : "缺少背景素材"}</strong>
          <span>{frame.background ? `asset_id: ${frame.background}` : "当前场景没有背景命令"}</span>
          <small>
            {frame.isPlaceholder
              ? "placeholder=true，发布前请替换为最终背景。"
              : "GameCli 已显示说明性占位，避免出现无法解释的空白画面。"}
          </small>
        </div>
      )}
    </div>
  );
}

export function BackgroundLayer({
  background,
  backgroundFit,
  transition,
  transitionKey,
  effects = [],
}: {
  background?: string;
  backgroundFit?: BackgroundFit;
  transition?: NormalizedVisualTransitionConfig;
  transitionKey: number;
  effects?: RuntimeAnimationEffect[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const layout = useUILayoutStyle("player", "stage_background");
  const incomingFrame = resolveFrame(background, backgroundFit, transitionKey);
  const incomingSignature = frameSignature(incomingFrame);
  const observedSignatureRef = useRef(incomingSignature);
  const [presentation, setPresentation] = useState<BackgroundPresentation>(() => ({
    current: incomingFrame,
    generation: 0,
  }));

  useRuntimeAnimation(ref, latestEffect(effects, (effect) => effect.target_kind === "background"));

  const clearPrevious = useCallback((activeGeneration: number) => {
    setPresentation((current) => {
      if (!current.previous || current.generation !== activeGeneration) return current;
      return {
        current: current.current,
        generation: current.generation,
      };
    });
  }, []);

  useLayoutEffect(() => {
    if (observedSignatureRef.current === incomingSignature) return;
    observedSignatureRef.current = incomingSignature;
    setPresentation((current) => {
      const generation = current.generation + 1;
      const shouldAnimate = (
        hasVisualContent(current.current)
        && transition !== undefined
        && transition.kind !== "none"
        && transition.duration_ms > 0
        && transitionKey > 0
      );
      if (!shouldAnimate) {
        return {
          current: incomingFrame,
          generation,
        };
      }
      return {
        previous: current.current,
        current: incomingFrame,
        transition,
        generation,
        transitionDeadline: Date.now() + transition.duration_ms,
        interrupted: Boolean(current.previous),
      };
    });
  }, [
    incomingFrame.background,
    incomingFrame.backgroundFit,
    incomingFrame.isPlaceholder,
    incomingFrame.transitionKey,
    incomingFrame.url,
    incomingSignature,
    transition,
    transitionKey,
  ]);

  useEffect(() => {
    if (!presentation.previous || !presentation.transition || !presentation.transitionDeadline) return;
    const activeGeneration = presentation.generation;
    const finishIfExpired = () => {
      if (Date.now() >= presentation.transitionDeadline!) {
        clearPrevious(activeGeneration);
      }
    };
    const timer = window.setTimeout(
      () => clearPrevious(activeGeneration),
      Math.max(0, presentation.transitionDeadline + 180 - Date.now()),
    );
    document.addEventListener("visibilitychange", finishIfExpired);
    window.addEventListener("focus", finishIfExpired);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", finishIfExpired);
      window.removeEventListener("focus", finishIfExpired);
    };
  }, [
    clearPrevious,
    presentation.generation,
    presentation.previous,
    presentation.transition,
    presentation.transitionDeadline,
  ]);

  function handleCurrentAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target || !presentation.previous) return;
    clearPrevious(presentation.generation);
  }

  const currentMissing = !presentation.current.url;
  const transitionKind = presentation.transition?.kind;
  const transitionStyle: BackgroundTransitionStyle = {
    ...layout,
    ...(presentation.transition
      ? {
          "--visual-transition-duration": `${presentation.transition.duration_ms}ms`,
          "--visual-transition-easing": presentation.transition.easing,
        }
      : {}),
  };
  const className = [
    "background-layer",
    "ui-layouted",
    currentMissing ? "is-missing" : "",
    presentation.current.isPlaceholder ? "is-placeholder" : "",
    presentation.previous ? "is-transitioning" : "",
    presentation.previous && transitionKind ? `transition-${transitionKind}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      ref={ref}
      data-background-id={presentation.current.background ?? ""}
      data-background-fit={presentation.current.backgroundFit}
      data-transition-key={presentation.current.transitionKey}
      data-transition-kind={transitionKind ?? transition?.kind ?? ""}
      data-transition-duration={presentation.transition?.duration_ms ?? transition?.duration_ms ?? ""}
      data-transition-easing={presentation.transition?.easing ?? transition?.easing ?? ""}
      data-transition-phase={presentation.previous ? "active" : "idle"}
      data-transition-generation={presentation.generation}
      data-transition-interrupted={presentation.interrupted ? "true" : "false"}
      style={transitionStyle}
    >
      {presentation.previous && (
        <BackgroundTransitionFrame
          key={`previous:${frameSignature(presentation.previous)}`}
          frame={presentation.previous}
          role="previous"
          transitionKind={transitionKind}
        />
      )}
      <BackgroundTransitionFrame
        key={`current:${frameSignature(presentation.current)}`}
        frame={presentation.current}
        role="current"
        transitionKind={transitionKind}
        onAnimationEnd={handleCurrentAnimationEnd}
      />
    </div>
  );
}
