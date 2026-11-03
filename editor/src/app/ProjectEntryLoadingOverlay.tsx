import { useEffect, useRef, type AnimationEvent } from "react";
import { RoseTwoLoader } from "../components/common/RoseTwoLoader";

type ProjectEntryLoadingState = "loading" | "ready" | "closing";

interface ProjectEntryLoadingOverlayProps {
  kind: "home-hydration" | "project-entry";
  state: ProjectEntryLoadingState;
  onReadyCycleComplete?: () => void;
}

export function ProjectEntryLoadingOverlay({ kind, state, onReadyCycleComplete }: ProjectEntryLoadingOverlayProps) {
  const stateRef = useRef(state);
  const onReadyRef = useRef(onReadyCycleComplete);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    onReadyRef.current = onReadyCycleComplete;
  }, [onReadyCycleComplete]);

  useEffect(() => {
    if (state !== "ready" || !onReadyRef.current || typeof window === "undefined") return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      let firstFrame = 0;
      let secondFrame = 0;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => onReadyRef.current?.());
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
      };
    }
    const timer = window.setTimeout(() => onReadyRef.current?.(), 320);
    return () => window.clearTimeout(timer);
  }, [state]);

  function handleCycleIteration(event: AnimationEvent<HTMLSpanElement>) {
    if (event.animationName !== "project-entry-flow-sentinel" && event.animationName !== "project-entry-rose-cycle") return;
    if (stateRef.current === "ready") onReadyCycleComplete?.();
  }

  return (
    <div
      className={`project-entry-loading-overlay is-${state}`}
      data-overlay-kind={kind}
      aria-live="polite"
      aria-label="正在装载项目"
      role="status"
    >
      <div className="project-entry-loader" aria-hidden="true">
        <RoseTwoLoader />
        <span className="project-entry-cycle-sentinel" onAnimationIteration={handleCycleIteration} />
      </div>
    </div>
  );
}
