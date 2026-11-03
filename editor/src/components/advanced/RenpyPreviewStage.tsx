import { useLayoutEffect, useRef, type ReactNode } from "react";
import { readEditorMotionTokens } from "../../utils/editorTransitionPresentation";
import "./renpy-runtime-preview.css";

/** Editor-only frame geometry. The retained logical canvas uses a uniform
 * transform, so changing a device frame never stretches text or restarts Runtime. */
export function RenpyPreviewStage({ width, height, children, className, phase, page }: {
  width: number;
  height: number;
  children: ReactNode;
  className: string;
  phase?: string;
  page?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const previousRef = useRef<{ width: number; height: number; fitWidth: number; fitHeight: number } | null>(null);
  const animationsRef = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const stage = stageRef.current, frame = frameRef.current, canvas = canvasRef.current;
    if (!stage || !frame || !canvas) return;
    const present = () => {
      // The enclosing Editor workbench has its own FLIP transform. Its visual
      // bounds are not the available layout space and may never trigger another
      // ResizeObserver notification when that ancestor animation finishes.
      const bounds = stage.getBoundingClientRect();
      const style = getComputedStyle(stage);
      const layoutWidth = parseFloat(style.width), layoutHeight = parseFloat(style.height);
      if (bounds.width <= 0 || bounds.height <= 0 || layoutWidth <= 0 || layoutHeight <= 0) return;
      const scale = Math.min(layoutWidth / width, layoutHeight / height);
      const target = { width: width * scale, height: height * scale };
      const previous = previousRef.current;
      // ResizeObserver delivers its initial notification after the first frame.
      // The same target must not cancel the transition that present() just started.
      if (previous?.width === width && previous.height === height
        && Math.abs(previous.fitWidth - target.width) < .1
        && Math.abs(previous.fitHeight - target.height) < .1) return;
      // Freeze the current rendered frame before cancelling, including reversal.
      const current = frame.getBoundingClientRect();
      const currentWidth = current.width * layoutWidth / bounds.width;
      const currentHeight = current.height * layoutHeight / bounds.height;
      const oldAnimations = animationsRef.current;
      const hadFrame = previous !== null;
      const changing = hadFrame && (Math.abs(currentWidth - target.width) > .5
        || Math.abs(currentHeight - target.height) > .5);
      const fromScaleX = currentWidth / Math.max(target.width, 1);
      const fromScaleY = currentHeight / Math.max(target.height, 1);
      oldAnimations.forEach(animation => animation.cancel());
      animationsRef.current = [];
      frame.style.width = `${target.width}px`;
      frame.style.height = `${target.height}px`;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.transform = `scale(${scale})`;
      previousRef.current = { width, height, fitWidth: target.width, fitHeight: target.height };
      if (!changing) { frame.dataset.framePhase = "idle"; return; }
      const tokens = readEditorMotionTokens();
      const duration = 960 * Math.max(1, tokens.motionScale);
      const easing = tokens.containerEasing;
      frame.dataset.framePhase = "moving";
      // Only the visual frame morphs; neither its grid track nor logical canvas
      // is resized per frame. Counter-scale the child on the same clock so the
      // composed text/image transform remains uniform throughout the morph.
      const counterFrames: Keyframe[] = Array.from({ length: 101 }, (_, index) => {
        const progress = index / 100;
        const x = fromScaleX + (1 - fromScaleX) * progress;
        const y = fromScaleY + (1 - fromScaleY) * progress;
        const uniform = Math.min(x, y);
        return { offset: progress, transform: `scale(${scale * uniform / x}, ${scale * uniform / y})` };
      });
      const animations = [
        frame.animate([
          { transform: `translate(-50%, -50%) scale(${fromScaleX}, ${fromScaleY})` },
          { transform: "translate(-50%, -50%) scale(1, 1)" },
        ],
        { duration, easing, fill: "both" }),
        canvas.animate(counterFrames, { duration, easing, fill: "both" }),
      ];
      const startTime = document.timeline.currentTime;
      if (typeof startTime === "number") animations.forEach(animation => { animation.startTime = startTime; });
      animationsRef.current = animations;
      void Promise.all(animations.map(animation => animation.finished)).then(() => {
        if (animationsRef.current !== animations) return;
        animationsRef.current = [];
        frame.dataset.framePhase = "idle";
        animations.forEach(animation => animation.cancel());
      }, () => { /* A newer device/resize owns the presentation. */ });
    };
    present();
    const observer = new ResizeObserver(present);
    observer.observe(stage);
    return () => {
      observer.disconnect();
      // Keep in-flight animation until the next effect reads its live geometry.
      // Actual unmount is separately cleaned below.
    };
  }, [width, height]);

  useLayoutEffect(() => () => {
    animationsRef.current.forEach(animation => animation.cancel());
    animationsRef.current = [];
  }, []);

  return <div ref={stageRef} className="renpy-editor-preview-stage is-device-stage">
    <div ref={frameRef} className={`${className} renpy-editor-device-frame`}
      data-preview-phase={phase} data-preview-page={page} data-frame-phase="idle">
      <div ref={canvasRef} className="renpy-editor-device-canvas">{children}</div>
    </div>
  </div>;
}
