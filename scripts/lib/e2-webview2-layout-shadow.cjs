"use strict";

function getLayoutShadowDiagnostic(mode = "default") {
  if (!["default", "layout-shadow-omitted"].includes(mode))
    throw new Error("layout shadow mode must be default or layout-shadow-omitted");
  return { mode, performanceAcceptance: false, css: mode === "default" ? "" :
    '.runtime-layout-designer, .runtime-layout-designer *, .runtime-layout-designer::before, ' +
    '.runtime-layout-designer::after, .runtime-layout-designer *::before, .runtime-layout-designer *::after ' +
    '{ box-shadow: none !important; }' };
}

function validateLayoutShadowEvidence(mode, before, after) {
  getLayoutShadowDiagnostic(mode);
  const failures = [];
  if (!before.length || before.length !== after.length)
    failures.push("nonempty identical paint population required");
  if (!before.some(item => item.shadow && item.shadow !== "none"))
    failures.push("control contains no actual shadow");
  for (let index = 0; index < before.length; index++) {
    const source = before[index], target = after[index];
    if (!target) continue;
    for (const key of ["id", "pseudo", "opacity", "transform", "filter", "backdropFilter", "background", "borderRadius"]) {
      if (source[key] !== target[key]) failures.push(`paint node ${index} changed ${key}`);
    }
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(source.rect?.[key]) || source.rect[key] !== target.rect?.[key])
        failures.push(`paint node ${index} changed rectangle ${key}`);
    }
    const expected = mode === "default" ? source.shadow : "none";
    if (target.shadow !== expected) failures.push(`paint node ${index} unexpected box-shadow`);
  }
  return { mode, matched: failures.length === 0, count: before.length,
    authoredShadowCount: before.filter(item => item.shadow !== "none").length,
    failures, performanceAcceptance: false };
}

// Browser-serialized; capture elements and generated before/after decoration.
function captureLayoutShadowState(overrideCss = null) {
  const capture = () => {
    const nodes = [...document.querySelectorAll(".runtime-layout-designer, .runtime-layout-designer *")];
    return nodes.flatMap((node, id) => {
      const rect = node.getBoundingClientRect();
      return [null, "::before", "::after"].map(pseudo => {
        const style = getComputedStyle(node, pseudo);
        return { id, pseudo, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          shadow: style.boxShadow, opacity: style.opacity, transform: style.transform,
          filter: style.filter, backdropFilter: style.backdropFilter,
          background: style.background, borderRadius: style.borderRadius };
      });
    });
  };
  if (overrideCss === null) return capture();
  const before = capture();
  if (overrideCss) {
    const style = document.createElement("style");
    style.dataset.e2LayoutShadowDiagnostic = "not-acceptance";
    style.textContent = overrideCss;
    document.head.append(style);
  }
  const completedShadowTransitions = [];
  if (overrideCss) for (const root of document.querySelectorAll(".runtime-layout-designer")) {
    // Existing CSS transitions outrank even an !important declaration.
    // Finish only the changed property, not navigation/content transforms,
    // filters or background transitions. This is a paint-omission diagnostic.
    for (const animation of root.getAnimations({ subtree: true })) {
      if (animation instanceof CSSTransition && animation.transitionProperty === "box-shadow") {
        animation.finish();
        completedShadowTransitions.push({ property: animation.transitionProperty });
      }
    }
  }
  // One JS task: do not confuse an intervening ResizeObserver update or
  // animation tick with a geometry change caused by this one-property probe.
  return { before, after: capture(), completedShadowTransitions };
}

module.exports = { getLayoutShadowDiagnostic, validateLayoutShadowEvidence, captureLayoutShadowState };
