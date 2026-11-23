/** Editor task surfaces share the UI curve without changing Runtime motion. */
export function novelTaskMotion(element: HTMLElement, normalDuration: number) {
  const style = getComputedStyle(element);
  const scale = Number(style.getPropertyValue("--motion-scale").trim() || 1);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    || !Number.isFinite(scale) || scale <= 0;
  return {
    reduced,
    duration: reduced ? 80 : normalDuration * scale,
    easing: style.getPropertyValue("--ease-ui-out").trim() || "cubic-bezier(0.23,1,0.32,1)",
  };
}
