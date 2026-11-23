/** Presentation-only copies: never mount a second functional page or engine. */
function visualCopy(source: HTMLElement, separatelyComposed?: HTMLElement): HTMLElement {
  const copy = source.cloneNode(true) as HTMLElement;
  // The retained snapshot can already be a child of a full-frame surface.
  // It is composed separately below, so do not also capture it inside current.
  const originals = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const copies = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  originals.forEach((node, index) => {
    let target = copies[index];
    if (!(target instanceof HTMLElement)) return;
    if (node === separatelyComposed) {
      target.remove();
      return;
    }
    if (node instanceof HTMLMediaElement) {
      // cloneNode does not copy video pixels and may start a second autoplay
      // decoder/audio track when attached. Retain a still frame instead.
      const still = node instanceof HTMLVideoElement
        ? document.createElement("canvas") : document.createElement("span");
      for (const attribute of target.attributes) {
        if (!["src", "autoplay", "loop", "preload", "poster"].includes(attribute.name))
          still.setAttribute(attribute.name, attribute.value);
      }
      const computed = getComputedStyle(node);
      for (let property = 0; property < computed.length; property++) {
        const name = computed.item(property);
        still.style.setProperty(name, computed.getPropertyValue(name));
      }
      if (still instanceof HTMLCanvasElement && node instanceof HTMLVideoElement) {
        still.width = node.videoWidth || 1;
        still.height = node.videoHeight || 1;
        if (node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)
          still.getContext("2d")?.drawImage(node, 0, 0);
      }
      target.replaceWith(still);
      target = still;
    } else if (node instanceof HTMLCanvasElement && target instanceof HTMLCanvasElement) {
      target.getContext("2d")?.drawImage(node, 0, 0);
    }
    if (node.getAnimations().some(animation => animation.playState === "running")) {
      target.style.opacity = getComputedStyle(node).opacity;
      target.style.transform = getComputedStyle(node).transform;
    }
    const hasInteractiveVisualState = node.matches(
      ":hover, :focus-visible, [aria-current], [aria-selected='true'], [aria-pressed='true'], .active",
    );
    if (hasInteractiveVisualState) {
      const computed = getComputedStyle(node);
      const animated = node.getAnimations().some(animation => animation.playState === "running");
      for (const property of [
        "color", "background-color", "background-image", "border-color",
        "border-width", "box-shadow", "filter",
      ]) {
        target.style.setProperty(property, computed.getPropertyValue(property), "important");
      }
      if (!animated) target.style.setProperty("opacity", computed.opacity, "important");
    }
    target.removeAttribute("id");
    target.removeAttribute("data-testid");
    target.removeAttribute("data-ui-screen");
    target.removeAttribute("data-runtime-motion-surface");
    target.removeAttribute("data-runtime-transition-snapshot");
    target.removeAttribute("data-settings-tab-current");
    target.removeAttribute("data-settings-transition");
    target.removeAttribute("data-settings-tab-duration");
    target.removeAttribute("data-save-page-layer");
    // A presentation copy must never match functional-layer ownership queries.
    target.classList.remove("runtime-screen-transition-current", "runtime-screen-transition-layer");
    target.removeAttribute("autofocus");
    target.removeAttribute("aria-current");
    target.removeAttribute("role");
    target.setAttribute("tabindex", "-1");
    target.style.animation = "none";
    target.style.transition = "none";
  });
  // Keep an already-visible nested presentation (for example a settings
  // category fade) inside the outer page snapshot. Removing it here creates a
  // one-frame hard cut when the user leaves the page mid-transition. The
  // recursive pass above strips ownership/test markers from the copy, so it
  // remains presentation-only and cannot become the active layer.
  copy.inert = true;
  copy.setAttribute("aria-hidden", "true");
  return copy;
}

export function captureRuntimePage(surface: HTMLElement, previous?: HTMLElement): HTMLElement {
  const snapshot = document.createElement("div");
  snapshot.dataset.runtimeTransitionSnapshot = "";
  snapshot.inert = true;
  snapshot.setAttribute("aria-hidden", "true");
  snapshot.style.cssText = `position:absolute;left:${surface.offsetLeft}px;top:${surface.offsetTop}px;width:${surface.offsetWidth}px;height:${surface.offsetHeight}px;overflow:hidden;pointer-events:none;z-index:1`;
  const computed = getComputedStyle(surface);
  for (let index = 0; index < computed.length; index++) {
    const name = computed.item(index);
    if (name.startsWith("--")) snapshot.style.setProperty(name, computed.getPropertyValue(name));
  }
  const current = visualCopy(surface, previous);
  current.style.position = "absolute";
  current.style.inset = "0";
  current.style.width = "100%";
  current.style.height = "100%";
  current.style.opacity = computed.opacity;
  snapshot.append(current);
  if (previous) {
    const old = visualCopy(previous);
    old.style.left = "0";
    old.style.top = "0";
    old.style.opacity = getComputedStyle(previous).opacity;
    snapshot.append(old);
  }
  return snapshot;
}
