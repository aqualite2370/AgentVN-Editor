"use strict";

function getWarmTopLayerOpacity(value) {
  if (value === undefined || value === "") return 0.001;
  const opacity = Number(value);
  // 1 is an explicitly visible paint counterfactual, not an invisible
  // preparation candidate or a product default.
  if (![0.001, 0.0005, 1].includes(opacity)) throw new Error("Warm top-layer opacity must be 0.001, 0.0005 or explicit visible diagnostic 1.");
  return opacity;
}

function getWarmTopLayerRestoreMode(value) {
  const mode = value || "input";
  if (!["input", "pre-measurement"].includes(mode))
    throw new Error("Warm top-layer restoration must be input or pre-measurement.");
  return mode;
}

async function settleWarmTopLayerRestoration(page) {
  return page.evaluate(async () => {
    if (typeof window.__e2RestoreWarmTopLayer !== "function")
      throw new Error("Warm top-layer restore handle missing");
    const startedAt = performance.now();
    window.__e2RestoreWarmTopLayer();
    const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    if (!(warm instanceof HTMLElement)) throw new Error("Original warm layout missing after restoration");
    const rect = warm.getBoundingClientRect();
    const opacity = getComputedStyle(warm).opacity;
    const synchronousEnd = performance.now();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = {
      startedAt, synchronousEnd, synchronousMs: synchronousEnd - startedAt, settledAt: performance.now(),
      warmRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      opacity, style: warm.getAttribute("style"), popover: warm.getAttribute("popover"),
      topLayer: warm.matches(":popover-open"), restored: window.__e2WarmTopLayerDiagnostic?.restored,
      restoreCount: window.__e2WarmTopLayerDiagnostic?.restoreCount,
    };
    if (state.opacity !== "0" || state.popover !== null || state.topLayer
      || !state.restored || state.restoreCount !== 1) throw new Error("Warm restoration failed original-state verification");
    return state;
  });
}

function intersectClipRects(subject, clips) {
  const validRect = rect => rect && ["x", "y", "width", "height"].every(
    key => Number.isFinite(rect[key])) && rect.width > 0 && rect.height > 0;
  if (!validRect(subject) || !clips.every(validRect)) return { valid: false, areaRatio: null, rect: null };
  let left = subject.x, top = subject.y;
  let right = left + subject.width, bottom = top + subject.height;
  for (const clip of clips) {
    left = Math.max(left, clip.x);
    top = Math.max(top, clip.y);
    right = Math.min(right, clip.x + clip.width);
    bottom = Math.min(bottom, clip.y + clip.height);
  }
  const rect = { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  return { valid: true, rect, areaRatio: rect.width * rect.height / (subject.width * subject.height) };
}

function getWarmTopLayerSetupFailures(scope = {}) {
  if (!scope.enabled) return [];
  const checks = {
    diagnosticOnly: scope.diagnosticOnly === true, isolated: scope.isolated === true,
    source: scope.source === true, cold: scope.cold === true, target: scope.target === "layout",
    viewport: scope.viewport === "4k", dpr: Number(scope.dpr) === 1,
    headful: scope.headful === true, hardwareGpu: scope.hardwareGpu === true,
    repeats: Number(scope.repeats) === 1, injection: scope.injection !== true,
    profiling: scope.profiling !== true,
    reducedMotion: scope.reducedMotion !== true, singleTrial: scope.singleTrial === true,
  };
  return Object.entries(checks).filter(([, valid]) => !valid).map(([key]) => `warm top-layer ${key} scope invalid`);
}

async function installWarmTopLayerDiagnostic(page, options = {}) {
  const opacity = getWarmTopLayerOpacity(options.opacity === undefined ? undefined : String(options.opacity));
  return page.evaluate(async ({ opacity }) => {
    const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const viewport = warm?.parentElement;
    if (!(warm instanceof HTMLElement) || !(viewport instanceof HTMLElement)
      || warm.getAttribute("aria-hidden") !== "true" || !warm.inert
      || typeof warm.showPopover !== "function") throw new Error("Warm top-layer diagnostic prerequisites absent");
    const rect = node => {
      const value = node.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const stage = warm.querySelector(".runtime-layout-stage");
    if (!(stage instanceof HTMLElement)) throw new Error("Warm preview stage absent");
    const before = {
      warm: rect(warm), stage: rect(stage), viewport: rect(viewport),
      clips: [], opacity: getComputedStyle(warm).opacity,
    };
    for (let node = stage.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)
        || ["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) {
        before.clips.push({ ...rect(node), className: String(node.className),
          overflowX: style.overflowX, overflowY: style.overflowY });
      }
    }
    const originalStyle = warm.getAttribute("style");
    const originalPopover = warm.getAttribute("popover");
    const evidence = { before, opacityRequested: opacity, restored: false, restoreCount: 0, restoredAt: null };
    const restore = () => {
      if (evidence.restored) return;
      if (warm.matches(":popover-open")) warm.hidePopover();
      if (originalPopover === null) warm.removeAttribute("popover");
      else warm.setAttribute("popover", originalPopover);
      if (originalStyle === null) warm.removeAttribute("style");
      else warm.setAttribute("style", originalStyle);
      evidence.restored = true;
      evidence.restoreCount += 1;
      evidence.restoredAt = performance.now();
      document.removeEventListener("pointerdown", onInput, true);
      document.removeEventListener("keydown", onInput, true);
    };
    const onInput = event => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      if (event.target.closest('[data-help-key^="advanced.tab."], [data-workspace-surface]')) restore();
    };
    try {
      warm.setAttribute("popover", "manual");
      const values = {
        position: "fixed", inset: "auto", margin: "0", padding: "0", border: "0",
        left: `${Math.max(12, before.viewport.x + before.viewport.width - before.warm.width)}px`,
        top: `${before.warm.y}px`, width: `${before.warm.width}px`, height: `${before.warm.height}px`,
        "max-width": "none", "max-height": "none", opacity: String(opacity),
        "pointer-events": "none", "box-sizing": "border-box",
      };
      for (const [key, value] of Object.entries(values)) warm.style.setProperty(key, value, "important");
      warm.showPopover();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      evidence.after = {
        warm: rect(warm), stage: rect(stage), opacity: getComputedStyle(warm).opacity,
        topLayer: warm.matches(":popover-open"), inert: warm.inert,
        ariaHidden: warm.getAttribute("aria-hidden"), pointerEvents: getComputedStyle(warm).pointerEvents,
        activeElementInside: warm.contains(document.activeElement),
        clips: [],
      };
      // A top-layer element escapes its DOM ancestors' clipping. Its own
      // subtree and the browser viewport still bound the painted area.
      for (let node = stage.parentElement; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (["hidden", "clip", "auto", "scroll"].includes(style.overflowX)
          || ["hidden", "clip", "auto", "scroll"].includes(style.overflowY)) {
          evidence.after.clips.push({ ...rect(node), className: String(node.className),
            overflowX: style.overflowX, overflowY: style.overflowY });
        }
        if (node === warm) break;
      }
      evidence.screen = { x: 0, y: 0, width: innerWidth, height: innerHeight };
      document.addEventListener("pointerdown", onInput, true);
      document.addEventListener("keydown", onInput, true);
      window.__e2WarmTopLayerDiagnostic = evidence;
      window.__e2RestoreWarmTopLayer = restore;
      return evidence;
    } catch (error) {
      restore();
      throw error;
    }
  }, { opacity });
}

function summarizeWarmTopLayerEvidence(evidence) {
  if (!evidence) return { valid: false, failures: ["missing warm top-layer evidence"] };
  const before = intersectClipRects(evidence.before?.stage,
    [...(evidence.before?.clips ?? []), evidence.screen]);
  const after = intersectClipRects(evidence.after?.stage,
    [...(evidence.after?.clips ?? []), evidence.screen]);
  const failures = [];
  if (!before.valid || !after.valid) failures.push("invalid clipping geometry");
  if (!evidence.after?.topLayer || !evidence.after.inert || evidence.after.ariaHidden !== "true"
    || evidence.after.pointerEvents !== "none" || evidence.after.activeElementInside)
    failures.push("warm top layer acquired visual input/focus ownership");
  if (evidence.after?.opacity !== String(evidence.opacityRequested ?? 0.001))
    failures.push("warm opacity was not applied");
  if (!(after.areaRatio >= 0.99)) failures.push("warm stage remains substantially clipped");
  if (Math.abs(evidence.before?.stage.width - evidence.after?.stage.width) > 0.1
    || Math.abs(evidence.before?.stage.height - evidence.after?.stage.height) > 0.1)
    failures.push("top layer changed authored stage dimensions");
  return { valid: failures.length === 0, failures, beforeClip: before, afterClip: after };
}

module.exports = {
  intersectClipRects, getWarmTopLayerSetupFailures,
  installWarmTopLayerDiagnostic, summarizeWarmTopLayerEvidence,
  getWarmTopLayerOpacity,
  getWarmTopLayerRestoreMode, settleWarmTopLayerRestoration,
};
