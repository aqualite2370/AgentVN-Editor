import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import { captureRuntimePage } from "../../app/runtimePageCrossfade";

export interface SavePageTransitionHandle {
  prepare: (direction: number) => void;
}

/** One functional grid. Retained pages are inert pixels/DOM without handlers. */
export const SavePageTransition = forwardRef<SavePageTransitionHandle, { pageKey: string; children: ReactNode }>(
  function SavePageTransition({ pageKey, children }, ref) {
    const viewport = useRef<HTMLDivElement>(null);
    const current = useRef<HTMLDivElement>(null);
    const retained = useRef<HTMLElement>();
    const animations = useRef<Animation[]>([]);
    const direction = useRef(1);
    const generation = useRef(0);
    const discard = () => {
      generation.current += 1;
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
      retained.current?.remove();
      retained.current = undefined;
    };
    useImperativeHandle(ref, () => ({
      prepare(nextDirection) {
        const node = viewport.current;
        if (!node) return;
        // Capture the entire visible composition before cancelling a previous
        // flip. Rapid reversal therefore starts at the displayed frame.
        const snapshot = captureRuntimePage(node);
        snapshot.querySelectorAll("[data-save-page-layer]").forEach(child => child.removeAttribute("data-save-page-layer"));
        snapshot.removeAttribute("data-runtime-transition-snapshot");
        snapshot.dataset.savePageLayer = "retained";
        snapshot.style.left = "0";
        snapshot.style.top = "0";
        discard();
        retained.current = snapshot;
        direction.current = nextDirection;
        node.append(snapshot);
      },
    }));
    useLayoutEffect(() => {
      const layer = current.current, snapshot = retained.current;
      if (!layer || !snapshot) return;
      const token = ++generation.current;
      const css = getComputedStyle(viewport.current!);
      // Production CSS can serialize 420ms/220ms as .42s/.22s.
      // WAAPI consumes milliseconds, never the bare numeric part of a token.
      const clock = css.getPropertyValue("--save-page-duration").trim();
      const time = /^(\d+(?:\.\d+)?|\.\d+)(ms|s)$/i.exec(clock);
      const milliseconds = time ? Number(time[1]) * (time[2].toLowerCase() === "s" ? 1000 : 1) : NaN;
      const duration = Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 420;
      const easing = css.getPropertyValue("--ease-out").trim() || "ease-out";
      const distance = Number.parseFloat(css.getPropertyValue("--save-page-distance")) || 12;
      const offset = direction.current * distance;
      const outgoing = snapshot.animate([
        { opacity: 1, transform: "translateX(0px)" },
        { opacity: 0, transform: `translateX(${-offset}px)` },
      ], { duration, easing, fill: "both" });
      const incoming = layer.animate([
        { opacity: 0, transform: `translateX(${offset}px)` },
        { opacity: 1, transform: "translateX(0px)" },
      ], { duration, easing, fill: "both" });
      animations.current = [outgoing, incoming];
      void Promise.all(animations.current.map(animation => animation.finished)).then(() => {
        if (generation.current === token) discard();
      }).catch(() => { /* A newer flip or unmount owns cleanup. */ });
    }, [pageKey]);
    useLayoutEffect(() => () => discard(), []);
    return <div className="save-page-viewport" ref={viewport}>
      <div className="save-page-current" ref={current} data-save-page-layer={pageKey}>{children}</div>
    </div>;
  },
);
