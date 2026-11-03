"use strict";

function getCheckboxPaintDiagnostic(mode = "default") {
  if (!["default", "checkbox-paint-omitted"].includes(mode))
    throw new Error("checkbox paint diagnostic mode must be default or checkbox-paint-omitted");
  return {
    mode, performanceAcceptance: false,
    css: mode === "default" ? "" :
      '.runtime-layout-designer input[type="checkbox"] { opacity: 0 !important; }',
  };
}

function validateCheckboxPaintEvidence(mode, before, after) {
  getCheckboxPaintDiagnostic(mode);
  const failures = [];
  if (!before.length || before.length !== after.length)
    failures.push("nonempty identical control population required");
  for (let index = 0; index < before.length; index++) {
    const source = before[index], target = after[index];
    if (!target) continue;
    for (const key of ["id", "checked", "disabled", "display", "visibility", "transform"]) {
      if (source[key] !== target[key]) failures.push(`control ${index} changed ${key}`);
    }
    for (const key of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(source.rect?.[key]) || source.rect[key] !== target.rect?.[key])
        failures.push(`control ${index} changed rectangle ${key}`);
    }
    const expected = mode === "default" ? source.opacity : "0";
    if (target.opacity !== expected) failures.push(`control ${index} unexpected opacity`);
  }
  return { mode, matched: failures.length === 0, count: before.length, failures, performanceAcceptance: false };
}

// Browser-serialized; capture all mounted controls, including the inert warm
// page. Read before and immediately after the one-property diagnostic override,
// before navigation. These reads never enter the performance interval.
function captureCheckboxPaintState() {
  return [...document.querySelectorAll('.runtime-layout-designer input[type="checkbox"]')].map((node, id) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { id, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      checked: node.checked, disabled: node.disabled, opacity: style.opacity,
      display: style.display, visibility: style.visibility, transform: style.transform };
  });
}

module.exports = { getCheckboxPaintDiagnostic, validateCheckboxPaintEvidence, captureCheckboxPaintState };
