"use strict";
// Serializable browser observation: hidden UI intentionally stays mounted.
function runtimeInterfaceVisibility() {
  const layer = document.querySelector('[data-testid="story-interface"]');
  if (!layer) return { hidden: false, restored: false };
  const style = getComputedStyle(layer);
  const inert = layer.inert === true;
  const focusOutside = !layer.contains(document.activeElement);
  return {
    hidden: inert && layer.getAttribute("aria-hidden") === "true"
      && Number(style.opacity) <= .001 && style.pointerEvents === "none" && focusOutside,
    restored: !inert && layer.getAttribute("aria-hidden") === "false"
      && Number(style.opacity) >= .999 && Boolean(layer.querySelector(".dialog-box"))
      && Boolean(layer.querySelector(".playback-controls")),
    opacity: Number(style.opacity), inert, focusOutside,
  };
}
module.exports = { runtimeInterfaceVisibility };
