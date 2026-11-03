"use strict";
const assert = require("node:assert/strict");
const {
  getHoverHelpAttributionMode,
  summarizeHoverHelpTimeline,
} = require("./lib/e2-hover-help-attribution.cjs");

const validScope = {
  diagnosticOnly: true,
  isolated: true,
  headful: true,
  hardwareGpu: true,
  productionPreview: true,
  cold: true,
  target: "layout",
  viewport: "4k",
  dpr: 1,
  repeats: 1,
  lowIntrusion: true,
  trace: false,
  profiler: false,
};

assert.deepEqual(getHoverHelpAttributionMode(undefined, {}), {
  enabled: false,
  mode: "product-default",
});
assert.equal(getHoverHelpAttributionMode("disabled", validScope).performanceAcceptance, false);
assert.equal(getHoverHelpAttributionMode("disabled", validScope).presentationChanged, true);
assert.equal(getHoverHelpAttributionMode("disabled", {
  ...validScope,
  trace: true,
}).enabled, true);
for (const [key, value] of Object.entries({
  diagnosticOnly: false,
  isolated: false,
  headful: false,
  hardwareGpu: false,
  productionPreview: false,
  cold: false,
  target: "theme",
  viewport: "1080p",
  dpr: 2,
  repeats: 3,
  lowIntrusion: false,
  profiler: true,
})) {
  assert.throws(
    () => getHoverHelpAttributionMode("disabled", { ...validScope, [key]: value }),
    new RegExp(key),
  );
}
assert.throws(() => getHoverHelpAttributionMode("1", validScope), /disabled|0/);

const timeline = summarizeHoverHelpTimeline([
  { type: "animationstart", animationName: "hover-card-fade-in", timeMs: 80 },
  { type: "animationend", animationName: "hover-help-copy-fill", timeMs: 305 },
  { type: "animationcancel", animationName: "unknown", timeMs: 310 },
  { type: "animationstart", animationName: "private-animation", timeMs: 320 },
  { type: "animationend", animationName: "hover-card-fade-out", timeMs: Number.NaN },
]);
assert.equal(timeline.eventCount, 2);
assert.equal(timeline.firstEventMs, 80);
assert.deepEqual(timeline.animationNames, ["hover-card-fade-in", "hover-help-copy-fill"]);
assert.equal(JSON.stringify(timeline).includes("private-animation"), false);

console.log("PASS: hover-help attribution is bounded to diagnostic-only 4K hardware-GPU runs");
