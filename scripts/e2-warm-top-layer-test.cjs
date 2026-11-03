"use strict";
const assert = require("node:assert/strict");
const { intersectClipRects, getWarmTopLayerSetupFailures, summarizeWarmTopLayerEvidence, getWarmTopLayerOpacity,
  getWarmTopLayerRestoreMode } =
  require("./lib/e2-warm-top-layer.cjs");
const stage = { x: 3126, y: 456.4375, width: 2738, height: 1540.125 };
assert.equal(getWarmTopLayerOpacity(), 0.001);
assert.equal(getWarmTopLayerOpacity("0.0005"), 0.0005);
assert.equal(getWarmTopLayerOpacity("1"), 1, "explicit visible material preparation counterfactual");
assert.throws(() => getWarmTopLayerOpacity("0"));
assert.throws(() => getWarmTopLayerOpacity("0.1"));
assert.throws(() => getWarmTopLayerOpacity("garbage"));
assert.equal(getWarmTopLayerRestoreMode(), "input");
assert.equal(getWarmTopLayerRestoreMode("pre-measurement"), "pre-measurement");
assert.throws(() => getWarmTopLayerRestoreMode("never"));
const viewport = { x: 2849, y: 211, width: 950, height: 1924 };
const result = intersectClipRects(stage, [viewport, { x: 0, y: 0, width: 3840, height: 2160 }]);
assert.equal(result.rect.width, 673);
assert(Math.abs(result.areaRatio - 673 / 2738) < 0.000001);
assert.equal(intersectClipRects(stage, [{ x: 0, y: 0, width: 50, height: 50 }]).areaRatio, 0);
assert.equal(intersectClipRects({ ...stage, width: 0 }, []).valid, false);
const scope = {
  enabled: true, diagnosticOnly: true, isolated: true, source: true,
  cold: true, target: "layout", viewport: "4k", dpr: 1, headful: true,
  hardwareGpu: true, repeats: 1, injection: false, profiling: false,
  reducedMotion: false, singleTrial: true,
};
assert.deepEqual(getWarmTopLayerSetupFailures(scope), []);
for (const [key, value] of Object.entries({
  diagnosticOnly: false, isolated: false, source: false, cold: false,
  target: "theme", viewport: "1080p", dpr: 2, headful: false,
  hardwareGpu: false, repeats: 3, injection: true, profiling: true,
  reducedMotion: true, singleTrial: false,
})) {
  assert(getWarmTopLayerSetupFailures({ ...scope, [key]: value }).length, key);
}
const afterStage = { ...stage, x: 672 };
const evidence = {
  before: { stage, clips: [viewport] },
  after: { stage: afterStage, clips: [], topLayer: true, inert: true,
    ariaHidden: "true", pointerEvents: "none", activeElementInside: false, opacity: "0.001" },
  screen: { x: 0, y: 0, width: 3840, height: 2160 },
};
assert.equal(summarizeWarmTopLayerEvidence(evidence).valid, true);
assert.equal(summarizeWarmTopLayerEvidence({ ...evidence,
  after: { ...evidence.after, stage: { ...afterStage, width: 2800 } } }).valid, false);
assert.equal(summarizeWarmTopLayerEvidence({ ...evidence,
  after: { ...evidence.after, inert: false } }).valid, false);
assert.equal(summarizeWarmTopLayerEvidence({ ...evidence,
  after: { ...evidence.after, clips: [{ x: 0, y: 0, width: 750, height: 2160 }] } }).valid, false);
assert.equal(summarizeWarmTopLayerEvidence(undefined).valid, false);
console.log("PASS E2 warm clipping intersection and top-layer attribution scope");
