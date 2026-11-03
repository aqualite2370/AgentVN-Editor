import { useLayoutEffect, useState, type RefObject } from "react";

export interface NvlPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rendered NVL geometry in the same logical frame as the quick-menu solver.
 * Read-only presentation state: never rewrites the authored ordinary dialog. */
export function useNvlPanelRect(controlRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [rect, setRect] = useState<NvlPanelRect>();
  useLayoutEffect(() => {
    if (!enabled) { setRect(undefined); return; }
    const stage = controlRef.current?.closest<HTMLElement>(".story-player");
    const panel = stage?.querySelector<HTMLElement>(".dialog-box.is-nvl-presentation");
    if (!stage || !panel) return;
    let frame = 0, disposed = false;
    const measure = () => {
      if (disposed) return;
      const parent = stage.getBoundingClientRect(), child = panel.getBoundingClientRect();
      if (parent.width <= 0 || parent.height <= 0) return;
      const next = { x: (child.left - parent.left) / parent.width * 100,
        y: (child.top - parent.top) / parent.height * 100,
        width: child.width / parent.width * 100, height: child.height / parent.height * 100 };
      setRect(previous => previous && (Object.keys(next) as (keyof NvlPanelRect)[])
        .every(key => Math.abs(previous[key] - next[key]) < 0.01) ? previous : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(stage); observer.observe(panel);
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [controlRef, enabled]);
  return enabled ? rect : undefined;
}
