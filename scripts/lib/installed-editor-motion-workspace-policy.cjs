"use strict";
// User-approved 2026-10-21 complex workbench envelope. Legacy tests keep their
// original policy unless they explicitly opt in through the frozen preparation.
const assert = require("node:assert/strict");
const policy = "APPROVED_COMPLEX_WORKBENCH_20261021";
const wideTabs = new Set(["layout", "theme", "assets", "animation", "novel"]);
const intersects = (a, b) => a && b && a.left < b.right - 1 && a.right > b.left + 1
  && a.top < b.bottom - 1 && a.bottom > b.top + 1;
const delta = (a, b) => a && b ? Math.max(...["left", "top", "width", "height"].map(k => Math.abs(a[k] - b[k]))) : Infinity;
const identity = t => ["none", "matrix(1, 0, 0, 1, 0, 0)", "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"].includes(t);
const visible = v => v && v.display !== "none" && v.visibility !== "hidden" && v.opacity > .01;
function workspaceFrameFailures(f, baseline, viewport, requestedPolicy, observedWideSource = false) {
  assert.equal(requestedPolicy, policy, "Explicit current workbench policy required");
  const errors = [];
  for (const [key, baselineKey] of [["palette", "paletteRect"], ["flow", "flowRect"], ["inspector", "inspectorRect"]])
    if (delta(f[key]?.rect, baseline[baselineKey]) > 1.5) errors.push(`${key} track changed or missing`);
  for (const key of ["palette", "inspector"]) if (!visible(f[key])) errors.push(`${key} hidden or missing`);
  if (f.paletteFilteredAncestors.length) errors.push("palette blurred");
  const p = f.palette?.rect, panel = f.panel?.rect;
  if (p && (p.left < -1 || p.top < -1 || p.right > viewport.width + 1 || p.bottom > viewport.height + 1))
    errors.push("palette outside viewport");
  if (panel && (panel.left < -1 || panel.top < -1 || panel.right > viewport.width + 1 || panel.bottom > viewport.height + 1))
    errors.push("workbench outside viewport");
  if (intersects(panel, p)) errors.push("workbench covers palette");
  if (intersects(panel, f.inspector?.rect)) {
    const presentedWide = (f.layers || []).some(l => wideTabs.has(l.tab)
      && /(?:^| )is-(?:active|leaving)(?: |$)/.test(l.className));
    const wideFinal = /\bis-layout-mode\b/.test(f.panel.className) && wideTabs.has(f.activeTab) && presentedWide;
    const observedShrink = /\bis-morphing\b/.test(f.panel.className) && !identity(f.panel.transform)
      && ((wideTabs.has(f.leavingTab) && presentedWide) || observedWideSource);
    if (!(f.task === "options" && (wideFinal || observedShrink)))
      errors.push("unapproved Inspector overlap");
  }
  return errors;
}
function workspaceSequenceFailures(frames, baseline, viewport, requestedPolicy) {
  let observedWideSource = false;
  return frames.flatMap(f => {
    if (f.task === "options" && /\bis-layout-mode\b/.test(f.panel?.className || "")
      && wideTabs.has(f.activeTab) && f.layers?.some(l => l.tab === f.activeTab && /\bis-active\b/.test(l.className)))
      observedWideSource = true;
    const errors = workspaceFrameFailures(f, baseline, viewport, requestedPolicy, observedWideSource);
    if (!f.panel || !/\bis-morphing\b/.test(f.panel.className) && !/\bis-layout-mode\b/.test(f.panel.className))
      observedWideSource = false;
    return errors.length ? [{ at: f.at, reasons: errors }] : [];
  });
}
module.exports = { policy, workspaceFrameFailures, workspaceSequenceFailures };
