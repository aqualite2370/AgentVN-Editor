import { useEffect, useLayoutEffect, useRef } from "react";
import { captureRuntimePage } from "../../app/runtimePageCrossfade";
import {
  RUNTIME_BLACKOUT_COVER_DURATION_MS,
  RUNTIME_BLACKOUT_REVEAL_DURATION_MS,
  RUNTIME_BLACKOUT_REDUCED_DURATION_MS,
} from "../../store/runtimeStore";

/** Runtime categories share one settings controller and one functional form.
 * Only the outgoing pixels are retained; repeated selection never restarts a
 * transition and a redirect captures the currently displayed composite. */
export function useSettingsContentTransition<T extends string>(selected: T, commit: (tab: T) => void) {
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selected);
  const generation = useRef(0);
  const snapshot = useRef<HTMLElement | undefined>(undefined);
  const animations = useRef<Animation[]>([]);
  const restoreFocus = useRef(false);

  const clear = () => {
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    snapshot.current?.remove();
    snapshot.current = undefined;
    contentRef.current?.parentElement?.setAttribute("data-settings-transition", "idle");
  };

  function select(tab: T) {
    if (tab === selectedRef.current) return;
    const current = contentRef.current;
    const retained = current ? captureRuntimePage(current, snapshot.current) : undefined;
    restoreFocus.current = Boolean(current?.contains(document.activeElement));
    ++generation.current;
    clear();
    snapshot.current = retained;
    if (retained) current?.parentElement?.append(retained);
    selectedRef.current = tab;
    commit(tab);
  }

  useLayoutEffect(() => {
    const current = contentRef.current;
    const outgoing = snapshot.current;
    if (!current || !outgoing) return;
    const token = generation.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 2 * RUNTIME_BLACKOUT_REDUCED_DURATION_MS
      : RUNTIME_BLACKOUT_COVER_DURATION_MS + RUNTIME_BLACKOUT_REVEAL_DURATION_MS;
    const host = current.parentElement!;
    host.setAttribute("data-settings-transition", "crossfading");
    host.setAttribute("data-settings-tab-duration", String(duration));
    const options: KeyframeAnimationOptions = {
      duration, easing: getComputedStyle(host).getPropertyValue("--ease-out").trim()
        || "cubic-bezier(.23,1,.32,1)", fill: "both",
    };
    const entering = current.animate([{ opacity: 0 }, { opacity: 1 }], options);
    const leaving = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], options);
    animations.current = [entering, leaving];
    if (restoreFocus.current) current.focus({ preventScroll: true });
    void Promise.all([entering.finished, leaving.finished]).then(() => {
      if (generation.current === token) clear();
    }).catch(() => { /* A newer selection owns the presentation and cleanup. */ });
  }, [selected]);

  useEffect(() => () => { ++generation.current; clear(); }, []);
  return { contentRef, select };
}
