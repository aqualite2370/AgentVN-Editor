import { useEffect, useRef, type AnimationEvent } from "react";
import { RoseTwoLoader } from "../components/common/RoseTwoLoader";

type ProjectEntryLoadingState = "loading" | "ready" | "closing";

interface ProjectEntryLoadingOverlayProps {
  state: ProjectEntryLoadingState;
  onReadyCycleComplete?: () => void;
}

export function ProjectEntryLoadingOverlay({ state, onReadyCycleComplete }: ProjectEntryLoadingOverlayProps) {
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state !== "ready" || !onReadyCycleComplete || typeof window === "undefined") return;
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(onReadyCycleComplete, 40);
    return () => window.clearTimeout(timer);
  }, [onReadyCycleComplete, state]);

  function handleCycleIteration(event: AnimationEvent<HTMLSpanElement>) {
    if (event.animationName !== "project-entry-rose-cycle") return;
    if (stateRef.current === "ready") onReadyCycleComplete?.();
  }

  return (
    <div
      className={`project-entry-loading-overlay is-${state}`}
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
