"use strict";

// Isolated diagnostic only. Stack allocation is limited to slow reads after
// trusted Options activation. Results are attribution, never performance PASS.
function installFirstOptionsDomReadProbe() {
  const state = window.__advancedLayoutTransitionAudit;
  if (!state || state.domReadProbe) throw new Error("Options observer ownership absent or duplicated");
  const records = [], restores = [], mountReads = [], computedOwners = new WeakMap();
  const wrap = (object, key, kind) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const original = descriptor?.value ?? descriptor?.get;
    if (!descriptor?.configurable || typeof original !== "function")
      throw new Error(`DOM read diagnostic seam unavailable: ${key}`);
    const sampled = function (...args) {
      if (state.interactionStart == null || !state.running) return original.apply(this, args);
      const computedOwner = computedOwners.get(this);
      const unreadyStage = key === "getBoundingClientRect" && this instanceof Element
        && this.classList.contains("runtime-layout-stage")
        && this.closest("[data-advanced-tab-ready]")?.getAttribute("data-advanced-tab-ready") === "false";
      const rootMotionRead = key === "getPropertyValue" && computedOwner === document.documentElement
        && ["--motion-scale", "--ease-ui-out"].includes(args[0])
        && document.querySelector('.advanced-tab-content[data-tab="layout"] [data-advanced-tab-ready="false"]');
      if (unreadyStage || rootMotionRead) mountReads.push({
        kind: unreadyStage ? "synchronous-unready-stage-measurement" : "root-motion-token-read-during-layout-mount",
        name: key, property: key === "getPropertyValue" ? args[0] : null,
        at: performance.now(), stack: new Error("first-options-mount-read-diagnostic").stack,
      });
      const start = performance.now();
      const result = original.apply(this, args);
      if (key === "getComputedStyle" && args[0] instanceof Element) computedOwners.set(result, args[0]);
      const duration = performance.now() - start;
      if (duration >= 2 && records.length < 100) {
        const subject = kind === "method" && this instanceof Element ? this
          : key === "getComputedStyle" && args[0] instanceof Element ? args[0] : this;
        records.push({ name: key, start, duration, tag: subject?.tagName,
          className: typeof subject?.className === "string" ? subject.className : null,
          stack: new Error("first-options-DOM-read-diagnostic").stack });
      }
      return result;
    };
    const installed = { ...descriptor, ...(descriptor.value ? { value: sampled } : { get: sampled }) };
    Object.defineProperty(object, key, installed);
    restores.push(() => {
      const current = Object.getOwnPropertyDescriptor(object, key);
      if ((descriptor.value ? current?.value : current?.get) !== sampled)
        throw new Error(`DOM read diagnostic ownership changed: ${key}`);
      Object.defineProperty(object, key, descriptor);
    });
  };
  try {
    for (const key of ["getBoundingClientRect", "getClientRects", "animate", "scrollIntoView"])
      wrap(Element.prototype, key, "method");
    for (const key of ["scrollHeight", "scrollWidth", "clientWidth", "clientHeight",
      "clientLeft", "clientTop", "scrollTop", "scrollLeft"])
      wrap(Element.prototype, key, "getter");
    for (const key of ["offsetHeight", "offsetWidth", "innerText"])
      wrap(HTMLElement.prototype, key, "getter");
    wrap(HTMLElement.prototype, "focus", "method");
    wrap(CSSStyleDeclaration.prototype, "getPropertyValue", "method");
    for (const key of ["opacity", "transform", "fontSize", "lineHeight", "display", "visibility",
      "width", "height", "color", "backgroundColor"]) {
      const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, key);
      if (descriptor?.configurable && typeof descriptor.get === "function")
        wrap(CSSStyleDeclaration.prototype, key, "getter");
    }
    wrap(SVGGraphicsElement.prototype, "getBBox", "method");
    wrap(window, "getComputedStyle", "method");
  } catch (error) {
    for (const restore of restores.reverse()) restore();
    throw error;
  }
  state.domReadProbe = { records, mountReads, restored: false, cleanup() {
    if (this.restored) return;
    for (const restore of restores.reverse()) restore();
    this.restored = true;
  } };
}
module.exports = { installFirstOptionsDomReadProbe };
