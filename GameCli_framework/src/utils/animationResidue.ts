export const runtimeAnimationSettledClass = "runtime-animation-settled";

const textSurfaceAnimationNames = new Set([
  "dialog-rise",
  "choice-fade-in",
  "runtime-hint-pop",
  "game-entry-fade",
  "runtime-screen-enter",
]);

function isTextSurfaceAnimation(animationName: string): boolean {
  return textSurfaceAnimationNames.has(animationName);
}

function animationTarget(event: AnimationEvent): HTMLElement | undefined {
  return event.target instanceof HTMLElement ? event.target : undefined;
}

export function clearRuntimeAnimationSettled(element: HTMLElement | null | undefined): void {
  element?.classList.remove(runtimeAnimationSettledClass);
}

export function clearRuntimeAnimationSettledWithin(element: HTMLElement | null | undefined): void {
  if (!element) return;
  clearRuntimeAnimationSettled(element);
  element.querySelectorAll<HTMLElement>(`.${runtimeAnimationSettledClass}`).forEach(clearRuntimeAnimationSettled);
}

export function installRuntimeAnimationResidueCleanup(root: Document | HTMLElement): () => void {
  function handleAnimationStart(event: AnimationEvent) {
    if (!isTextSurfaceAnimation(event.animationName)) return;
    animationTarget(event)?.classList.remove(runtimeAnimationSettledClass);
  }

  function handleAnimationDone(event: AnimationEvent) {
    if (!isTextSurfaceAnimation(event.animationName)) return;
    animationTarget(event)?.classList.add(runtimeAnimationSettledClass);
  }

  root.addEventListener("animationstart", handleAnimationStart as EventListener, true);
  root.addEventListener("animationend", handleAnimationDone as EventListener, true);
  root.addEventListener("animationcancel", handleAnimationDone as EventListener, true);
  return () => {
    root.removeEventListener("animationstart", handleAnimationStart as EventListener, true);
    root.removeEventListener("animationend", handleAnimationDone as EventListener, true);
    root.removeEventListener("animationcancel", handleAnimationDone as EventListener, true);
  };
}
