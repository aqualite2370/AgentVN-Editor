import { captureRuntimePage } from "../app/runtimePageCrossfade";

type ExitPresentation = { snapshot: HTMLElement; animations: Animation[] };
const exits = new WeakMap<HTMLElement, Map<string, ExitPresentation>>();

/** Presentation only: focus, actions and modal ownership end synchronously.
 * An interrupted close can be adopted by the next instance without retaining
 * a second functional dialog or restarting its opacity from zero. */
export function presentRuntimeModal(panel: HTMLElement, title: string): () => void {
  const backdrop = panel.parentElement;
  const parent = backdrop?.parentElement;
  if (!backdrop || !parent) return () => {};
  const style = getComputedStyle(backdrop);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const durationToken = style.getPropertyValue(reduced ? "--motion-fast" : "--motion").trim();
  const duration = (parseFloat(durationToken) || (reduced ? 140 : 220))
    * (/^[\d.]+s$/.test(durationToken) ? 1000 : 1);
  const options: KeyframeAnimationOptions = {
    duration, easing: style.getPropertyValue("--ease-out").trim() || "cubic-bezier(0.23,1,0.32,1)",
    fill: "both",
  };
  const baseTransform = getComputedStyle(panel).transform;
  const compactTransform = reduced ? baseTransform
    : `${baseTransform === "none" ? "" : baseTransform} scale(0.96)`;
  const pending = exits.get(parent)?.get(title);
  let initialOpacity = "0", initialTransform = compactTransform;
  if (pending) {
    const oldBackdrop = pending.snapshot.firstElementChild;
    const oldPanel = pending.snapshot.querySelector<HTMLElement>(".modal-panel");
    initialOpacity = String(Number(getComputedStyle(pending.snapshot).opacity)
      * Number(oldBackdrop ? getComputedStyle(oldBackdrop).opacity : 1));
    if (oldPanel) initialTransform = getComputedStyle(oldPanel).transform;
    pending.animations.forEach(a => a.cancel());
    pending.snapshot.remove();
    exits.get(parent)?.delete(title);
  }
  const entering = [
    backdrop.animate([{ opacity: initialOpacity }, { opacity: style.opacity }], options),
    panel.animate([{ transform: initialTransform }, { transform: baseTransform }], options),
  ];
  void Promise.all(entering.map(a => a.finished)).then(() => entering.forEach(a => a.cancel()))
    .catch(() => { /* A close captures current presentation before cancelling. */ });
  return () => {
    if (!backdrop.isConnected) {
      entering.forEach(a => a.cancel());
      return;
    }
    const snapshot = captureRuntimePage(backdrop);
    snapshot.removeAttribute("data-runtime-transition-snapshot");
    snapshot.dataset.runtimeModalExit = "";
    snapshot.style.zIndex = getComputedStyle(backdrop).zIndex;
    for (const node of [snapshot, ...snapshot.querySelectorAll<HTMLElement>("*")]) {
      node.removeAttribute("data-runtime-modal");
      node.removeAttribute("aria-modal");
    }
    parent.append(snapshot);
    entering.forEach(a => a.cancel());
    const leavingPanel = snapshot.querySelector<HTMLElement>(".modal-panel");
    const leaving = [snapshot.animate([{ opacity: 1 }, { opacity: 0 }], options)];
    if (leavingPanel) leaving.push(leavingPanel.animate([
      { transform: getComputedStyle(leavingPanel).transform }, { transform: compactTransform },
    ], options));
    const entry = { snapshot, animations: leaving };
    const map = exits.get(parent) ?? new Map<string, ExitPresentation>();
    exits.set(parent, map);
    map.set(title, entry);
    void Promise.all(leaving.map(a => a.finished)).catch(() => {
      // Reopening explicitly cancels and adopts these pixels.
    }).finally(() => {
      snapshot.remove();
      if (map.get(title) === entry) map.delete(title);
    });
  };
}
