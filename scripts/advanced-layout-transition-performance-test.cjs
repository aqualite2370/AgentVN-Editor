const assert = require("node:assert/strict");
const {
  filterEntriesByTimeWindow,
  summarizeLongAnimationFrame,
  summarizeFramePhases,
  alignTraceClock,
  alignMonotonicClocks,
  mapBrowserMonotonicToEpochMs,
  selectPreparationClockAnchors,
  summarizeLayerTree,
  matchRasterTasksToLayerSnapshots,
  matchGpuRasterTasksToSourceTiles,
  summarizeLayerIdentityContinuity,
  summarizeReactCommitProbe,
  summarizeReactFiberPathCapture,
  summarizeEditorMotionTimeline,
  auditStagePreviewSamples,
  auditSnapGuideSamples,
  validateBrowserGpuProvenance,
  summarizeTargetModuleResourceReadiness,
  summarizeFirstPresentationResourceReadiness,
  summarizeGlassAnimationTimeline,
  summarizeGlassStyleWriteTimeline,
  getGlassStyleWriteMode,
  getGlassAnimationTimelineSetupFailures,
  getGenericCompositorWarmupSetupFailures,
  getStagePromotionSetupFailures,
  summarizeStagePromotionEvidence,
  getLayoutStageWillChangeSetupFailures,
  summarizeLayoutStageWillChangeEvidence,
  getLayoutLayerTreeTimelineSetupFailures,
  summarizeLayoutLayerTreeTimeline,
  getEtwTriggerGateSetupFailures,
  getAnimationStartDelayDiagnostic,
  getAnimationStartDelaySetupFailures,
  getLayoutHealthStateFailures,
  getWarmLayoutReadinessFailures,
  getWarmLayerVisualEquivalenceFailures,
  getSourceWarmOpacitySetupFailures,
  getSourceWarmOpacityStateFailures,
  getSyncPhaseProbeSetupFailures,
  summarizeSyncPhaseProbeEvidence,
  instrumentPopoverSnapshotSource,
} = require("./lib/advanced-layout-transition-performance.cjs");

const sourceProbeFixture = [
  "function capturePopoverRect(options = {}) {",
  "    removePopoverMorphGhost();",
  "    retainPopoverMorphGhostRef.current = Boolean(options.preserveSnapshot);",
  "    const rect = previousPopoverRectRef.current;",
  "    const ghost = node.cloneNode(true);",
  "    ghost.classList.remove(",
  "    ghost.style.setProperty(\"position\", \"fixed\", \"important\");",
  "    document.body.appendChild(ghost);",
  "    for (const { element, top, left } of scrollPositions) {",
  "      if (!ghost.contains(element)) continue;",
  "      element.scrollTop = top;",
  "      element.scrollLeft = left;",
  "    }",
  "    popoverMorphGhostRef.current = ghost;",
  "    // The snapshot owns this exact outgoing page",
  "    const bridgedContent = node.querySelector(\".advanced-tab-content.is-active\");",
  "    if (!options.preserveSnapshot && bridgedContent) {",
  "      bridgedContent.setAttribute(\"data-geometry-snapshot-owner\", \"true\");",
  "      popoverMorphBridgedContentRef.current = bridgedContent;",
  "    }",
  "",
  "    const easing = motionTokens.containerEasing;",
  "    const reduced = prefersReducedMotion();",
  "    const surfaceHandoff = Boolean(options.preserveSnapshot);",
  "    const ghostFade = ghost.animate(",
  "  }",
].join("\n");
const sourceProbePatch = instrumentPopoverSnapshotSource(sourceProbeFixture);
assert.deepEqual(sourceProbePatch.failures, []);
assert.equal(sourceProbePatch.matches, 9);
for (const phase of [
  "after-old-ghost-remove",
  "after-clone-created",
  "after-clone-content-copy",
  "after-ghost-mounted",
  "after-scroll-restored",
  "after-content-bridge",
  "after-motion-token-read",
  "after-reduced-motion-read",
  "before-ghost-animation",
]) {
  assert.ok(sourceProbePatch.source.includes(`mark(\"${phase}\")`), `source probe must mark ${phase}`);
}
assert.ok(instrumentPopoverSnapshotSource(sourceProbeFixture.replace(
  "document.body.appendChild(ghost);",
  "document.body.appendChild(other);",
)).failures.some(failure => failure.includes("after-ghost-mounted")));

assert.deepEqual(getSyncPhaseProbeSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  currentSource: true,
  hardwareGpuRequired: true,
  reactCommitProbeEnabled: true,
  profilerEnabled: false,
  singleLowIntrusionTrial: true,
  diagnosticOnly: true,
  isolatedProject: true,
  diagnosticRepeats: 1,
  width: 3840,
  height: 2160,
  dpr: 1,
  headful: true,
}), []);
assert.ok(getSyncPhaseProbeSetupFailures({
  enabled: true,
  entryMode: "warm",
  targetTab: "theme",
  currentSource: false,
  hardwareGpuRequired: false,
  reactCommitProbeEnabled: false,
  profilerEnabled: true,
  singleLowIntrusionTrial: false,
  diagnosticOnly: false,
  isolatedProject: false,
  diagnosticRepeats: 3,
  width: 1920,
  height: 1080,
  dpr: 2,
  headful: false,
}).length >= 13, "synchronous phase probe must reject invalid scope and contaminated runs");
assert.deepEqual(summarizeSyncPhaseProbeEvidence({
  trustedTargetClicks: 1,
  captureEnvelopes: [{
    start: 100,
    end: 119,
    cloneDurationMs: 1.2,
    phaseMarks: [
      { name: "after-old-ghost-remove", at: 101 },
      { name: "after-clone-created", at: 103 },
      { name: "after-clone-content-copy", at: 105 },
      { name: "after-ghost-mounted", at: 107 },
      { name: "after-scroll-restored", at: 108 },
      { name: "after-content-bridge", at: 110 },
      { name: "after-motion-token-read", at: 112 },
      { name: "after-reduced-motion-read", at: 114 },
      { name: "before-ghost-animation", at: 117 },
    ],
  }],
  longAnimationFrames: [{ startTime: 102, duration: 55 }],
  reactCommits: [{ at: 99 }, { at: 103 }, { at: 107 }],
}), {
  valid: true,
  failures: [],
  trustedTargetClicks: 1,
  captureCount: 1,
  captureTotalMs: 19,
  captureMaxMs: 19,
  cloneTotalMs: 1.2,
  captureOverlapWithLongFramesMs: 17,
  reactCommitsDuringCapture: 2,
  nearestReactCommitDistanceMs: 0,
  phaseTotalsMs: {
    rectAndOldGhostRemoval: 1,
    clone: 2,
    normalizationAndStateCopy: 2,
    styleAndAppend: 2,
    scrollRestoration: 1,
    contentBridge: 2,
    motionTokenRead: 2,
    reducedMotionQuery: 2,
    animationPreparation: 3,
    animationCreation: 2,
  },
});
assert.equal(summarizeSyncPhaseProbeEvidence({
  trustedTargetClicks: 0,
  captureEnvelopes: [],
  longAnimationFrames: [],
  reactCommits: [],
}).valid, false, "probe must reject a run without a real target click and capture hit");

assert.deepEqual(getSourceWarmOpacitySetupFailures({
  enabled: true,
  opacity: 0.001,
  entryMode: "cold",
  targetTab: "layout",
  developmentSource: true,
  layoutPreMountedByBundlePatch: false,
  otherWarmupEnabled: false,
}), []);
assert.deepEqual(getSourceWarmOpacitySetupFailures({
  enabled: true,
  opacity: 0.001,
  entryMode: "warm",
  targetTab: "theme",
  developmentSource: false,
  layoutPreMountedByBundlePatch: true,
  otherWarmupEnabled: true,
}), [
  "source warm-layer opacity requires a cold entry",
  "source warm-layer opacity requires the layout target",
  "source warm-layer opacity requires the current development source",
  "source warm-layer opacity cannot combine with a bundle pre-mount patch",
  "source warm-layer opacity cannot combine with another warm-up diagnostic",
]);
assert.deepEqual(getSourceWarmOpacityStateFailures({
  before: {
    selectedTab: "settings",
    opacity: 0,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: { viewport: { x: 10, y: 20, width: 300, height: 200 }, stage: { x: 20, y: 30, width: 270, height: 150 } },
  },
  after: {
    selectedTab: "settings",
    opacity: 0.001,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: { viewport: { x: 10, y: 20, width: 300, height: 200 }, stage: { x: 20, y: 30, width: 270, height: 150 } },
  },
}), []);
assert.ok(getSourceWarmOpacityStateFailures({
  before: { selectedTab: "settings", opacity: 0, geometry: { viewport: { x: 0, y: 0, width: 10, height: 10 } } },
  after: { selectedTab: "layout", opacity: 0.001, geometry: { viewport: { x: 0, y: 0, width: 11, height: 10 } } },
}).length > 0, "source opacity override must reject state or geometry changes");

assert.deepEqual(getWarmLayerVisualEquivalenceFailures({
  baseline: {
    selectedTab: "settings",
    panelWideMode: false,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: {
      popover: { x: 100, y: 50, width: 900, height: 700 },
      viewport: { x: 110, y: 120, width: 880, height: 620 },
      stage: { x: 400, y: 180, width: 800, height: 450 },
    },
  },
  candidate: {
    selectedTab: "settings",
    panelWideMode: false,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: {
      popover: { x: 100, y: 50, width: 900, height: 700 },
      viewport: { x: 110, y: 120, width: 880, height: 620 },
      stage: { x: 400, y: 180, width: 800, height: 450 },
    },
  },
  pixelDiff: {
    width: 880,
    height: 620,
    maxChannelDelta: 0,
    changedPixels: 0,
    pixelsOverOneLevel: 0,
    pixelsOutsideControlNoise: 0,
    pixelsExceedingControlEnvelope: 0,
  },
  controlPixelDiff: {
    width: 880,
    height: 620,
    maxChannelDelta: 17,
    changedPixels: 2400,
    pixelsOverOneLevel: 2100,
  },
}), []);
assert.ok(getWarmLayerVisualEquivalenceFailures({
  baseline: { selectedTab: "settings", ariaHidden: true, inert: true },
  candidate: { selectedTab: "layout", ariaHidden: false, inert: false },
  pixelDiff: { width: 10, height: 10, maxChannelDelta: 16, pixelsOverOneLevel: 5 },
  controlPixelDiff: { width: 10, height: 10, maxChannelDelta: 0, pixelsOverOneLevel: 0 },
}).length > 0, "visual-equivalence gate must reject a visible or interactive warm layer");
assert.ok(getWarmLayerVisualEquivalenceFailures({
  baseline: {
    selectedTab: "settings",
    panelWideMode: false,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: {
      popover: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { x: 0, y: 0, width: 10, height: 10 },
      stage: { x: 0, y: 0, width: 10, height: 10 },
    },
  },
  candidate: {
    selectedTab: "settings",
    panelWideMode: false,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
    geometry: {
      popover: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { x: 0, y: 0, width: 10, height: 10 },
      stage: { x: 0, y: 0, width: 10, height: 10 },
    },
  },
  pixelDiff: {
    width: 10,
    height: 10,
    maxChannelDelta: 4,
    changedPixels: 1,
    pixelsOverOneLevel: 1,
    pixelsOutsideControlNoise: 1,
    pixelsExceedingControlEnvelope: 1,
  },
  controlPixelDiff: {
    width: 10,
    height: 10,
    maxChannelDelta: 0,
    changedPixels: 0,
    pixelsOverOneLevel: 0,
  },
}).length > 0, "pixel changes outside same-state screenshot noise must fail visual equivalence");

assert.deepEqual(getEtwTriggerGateSetupFailures({
  enabled: false,
}), []);
assert.deepEqual(getEtwTriggerGateSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  traceEnabled: true,
  diagnosticRepeats: 1,
}), []);
assert.ok(getEtwTriggerGateSetupFailures({
  enabled: true,
  entryMode: "warm",
  targetTab: "layout",
  productionPreview: true,
  traceEnabled: true,
  diagnosticRepeats: 1,
}).length > 0);
assert.ok(getEtwTriggerGateSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "theme",
  productionPreview: true,
  traceEnabled: true,
  diagnosticRepeats: 1,
}).length > 0);
assert.ok(getEtwTriggerGateSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: false,
  traceEnabled: true,
  diagnosticRepeats: 1,
}).length > 0);
assert.ok(getEtwTriggerGateSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  traceEnabled: false,
  diagnosticRepeats: 1,
}).length > 0);

assert.equal(getAnimationStartDelayDiagnostic(undefined), 0);
assert.equal(getAnimationStartDelayDiagnostic("120"), 120);
assert.throws(() => getAnimationStartDelayDiagnostic("0"), /between 1 and 240/);
assert.throws(() => getAnimationStartDelayDiagnostic("241"), /between 1 and 240/);
assert.throws(() => getAnimationStartDelayDiagnostic("120ms"), /positive integer/);
assert.deepEqual(getAnimationStartDelaySetupFailures({
  delayMs: 120,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: false,
  warmLayerOpacity: 0,
}), []);
assert.deepEqual(getAnimationStartDelaySetupFailures({
  delayMs: 120,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: true,
  warmLayerOpacity: 0.001,
}), []);
assert.ok(getAnimationStartDelaySetupFailures({
  delayMs: 120,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: false,
  warmLayerOpacity: 0.001,
}).length > 0);
assert.ok(getAnimationStartDelaySetupFailures({
  delayMs: 120,
  entryMode: "warm",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: false,
  warmLayerOpacity: 0,
}).length > 0);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutPreMounted: false,
  healthStates: ["pending", "warning"],
}), []);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutPreMounted: true,
  layoutReadyBeforeInteraction: true,
  healthStates: ["warning"],
}), []);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutMountedBeforeInteraction: true,
  healthStates: ["warning"],
}), []);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutPreMounted: false,
  layoutReadyBeforeInteraction: true,
  healthStates: ["warning"],
}), []);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutPreMounted: false,
  layoutReadyBeforeInteraction: false,
  healthStates: ["warning"],
}), ["layout health did not expose its pending state during first paint"]);
assert.deepEqual(getLayoutHealthStateFailures({
  targetTab: "layout",
  layoutPreMounted: true,
  healthStates: ["pending"],
}), ["layout health did not finish after the page became ready"]);
assert.deepEqual(getWarmLayoutReadinessFailures({
  waitForReady: true,
  evidence: { readyAtInteraction: true, stageWidth: 2728, stageHeight: 1534 },
}), []);
assert.deepEqual(getWarmLayoutReadinessFailures({
  waitForReady: true,
  evidence: { readyAtInteraction: false, stageWidth: 0, stageHeight: 0 },
}), ["layout warm readiness was not confirmed immediately before interaction"]);
assert.deepEqual(getWarmLayoutReadinessFailures({
  waitForReady: false,
  evidence: null,
}), []);

const validStageSamples = auditStagePreviewSamples([
  {
    designerReady: "true",
    stageSize: { width: 480, height: 270 },
    stageLayoutSize: { width: 480, height: 270 },
    previewVisible: true,
    previewRenderScale: 0.375,
    previewAuthoredFrame: { width: 1280, height: 720 },
    pixelReadoutText: "x 120px / y 80px / 240 x 80px",
    snapGuides: [{ axis: "x", left: "50%", top: "0px" }],
  },
  {
    designerReady: "true",
    stageSize: { width: 2728, height: 1534.5 },
    stageLayoutSize: { width: 2728, height: 1534 },
    previewVisible: true,
    previewRenderScale: 2728 / 3840,
    previewAuthoredFrame: { width: 3840, height: 2160 },
    pixelReadoutText: "x 682px / y 455px / 1364 x 455px",
    snapGuides: [{ axis: "y", left: "0px", top: "50%" }],
  },
]);
assert.equal(validStageSamples.ok, true);
assert.equal(validStageSamples.readySampleCount, 2);
assert.equal(validStageSamples.previewVisibleSampleCount, 2);
assert.equal(validStageSamples.pixelReadoutSampleCount, 2);
assert.equal(validStageSamples.snapGuideSampleCount, 2);

const oneFrameStageConvergence = auditStagePreviewSamples([
  {
    time: 10,
    designerReady: "true",
    stageLayoutSize: { width: 2728, height: 1534 },
    previewVisible: true,
    previewRenderScale: 0.125,
    previewAuthoredFrame: { width: 3840, height: 2160 },
  },
  {
    time: 26,
    designerReady: "true",
    stageLayoutSize: { width: 2728, height: 1534 },
    previewVisible: true,
    previewRenderScale: 2728 / 3840,
    previewAuthoredFrame: { width: 3840, height: 2160 },
  },
]);
assert.equal(oneFrameStageConvergence.ok, true);
assert.equal(oneFrameStageConvergence.initialStaleScaleFrameCount, 1);
assert.equal(oneFrameStageConvergence.initialStaleScaleDurationMs, 16);

const brokenStageSamples = auditStagePreviewSamples([
  {
    time: 10,
    designerReady: "true",
    stageSize: { width: 2728, height: 1534.5 },
    stageLayoutSize: { width: 2728, height: 1534 },
    previewVisible: false,
    previewRenderScale: 0.375,
    previewAuthoredFrame: { width: 3840, height: 2160 },
    pixelReadoutText: "等待画布测量",
    snapGuides: [{ axis: "x", left: "103%", top: "0px" }],
  },
]);
assert.equal(brokenStageSamples.ok, false);
assert.ok(brokenStageSamples.failures.some(item => item.includes("hid or unmounted")));
assert.ok(brokenStageSamples.failures.some(item => item.includes("preview render scale")));
assert.ok(brokenStageSamples.failures.some(item => item.includes("outside stage")));

const validSnapGuideSamples = auditSnapGuideSamples([
  { stageLayoutSize: { width: 2728, height: 1534 }, guides: [] },
  {
    stageLayoutSize: { width: 2728, height: 1534 },
    guides: [
      { axis: "x", visible: true, source: "grid", positionPercent: "25%" },
      { axis: "y", visible: true, source: "frame-center", positionPercent: "50%" },
    ],
  },
]);
assert.equal(validSnapGuideSamples.ok, true);
assert.equal(validSnapGuideSamples.guideSampleCount, 1);
assert.deepEqual(validSnapGuideSamples.axes, ["x", "y"]);

const missingSnapGuides = auditSnapGuideSamples([
  { stageLayoutSize: { width: 2728, height: 1534 }, guides: [] },
]);
assert.equal(missingSnapGuides.ok, false);
assert.ok(missingSnapGuides.failures.some(item => item.includes("no visible snap-guide samples")));

const invalidSnapGuides = auditSnapGuideSamples([
  {
    stageLayoutSize: { width: 0, height: 1534 },
    guides: [{ axis: "x", visible: false, source: "", positionPercent: "103%" }],
  },
]);
assert.equal(invalidSnapGuides.ok, false);
assert.ok(invalidSnapGuides.failures.some(item => item.includes("invalid stage geometry")));

assert.deepEqual(summarizeReactFiberPathCapture({
  rendererId: 1,
  observerAt: 12.25,
  capturedAt: 12.75,
  captureDurationMs: 0.3,
  stageSize: { width: 2728, height: 1533.625 },
  totalFiberCount: 42,
  layoutDesignerHostPathIndex: 1,
  designerComponentPathIndex: 2,
  designerComponentFiberCount: 123,
  path: [
    { tag: 3, name: "HostRoot", flags: 0, subtreeFlags: 1, childCount: 1 },
    { tag: 0, name: "RuntimeLayoutDesigner", flags: 1, subtreeFlags: 3, childCount: 5 },
    { tag: 5, name: "DIV.runtime-layout-stage", flags: 0, subtreeFlags: 0, childCount: 2 },
  ],
}), {
  rendererId: "1",
  observerAt: 12.25,
  capturedAt: 12.75,
  observerToCommitMs: 0.5,
  captureDurationMs: 0.3,
  stageSize: { width: 2728, height: 1533.625 },
  totalFiberCount: 42,
  layoutDesignerHostPathIndex: 1,
  designerComponentPathIndex: 2,
  designerComponentFiberCount: 123,
  path: [
    { tag: 3, name: "HostRoot", flags: 0, subtreeFlags: 1, childCount: 1 },
    { tag: 0, name: "RuntimeLayoutDesigner", flags: 1, subtreeFlags: 3, childCount: 5 },
    { tag: 5, name: "DIV.runtime-layout-stage", flags: 0, subtreeFlags: 0, childCount: 2 },
  ],
});
assert.equal(summarizeReactFiberPathCapture({
  observerAt: 20,
  capturedAt: 19,
  captureDurationMs: 0.1,
  stageSize: { width: 2728, height: 1533 },
  totalFiberCount: 1,
  path: [{ tag: 5, name: "DIV.runtime-layout-stage", flags: 0, subtreeFlags: 0, childCount: 0 }],
}), null);
assert.equal(summarizeReactFiberPathCapture(null), null);

assert.deepEqual(summarizeReactCommitProbe([
  { at: 9, rendererId: 1 },
  { at: 10, rendererId: 1 },
  { at: 15, rendererId: 2 },
  { at: 21, rendererId: 1 },
], { start: 10, end: 20 }), {
  totalObservedCommitCount: 4,
  interactionCommitCount: 2,
  firstInteractionCommitAt: 10,
  lastInteractionCommitAt: 15,
  maxInteractionCommitGapMs: 5,
  commitsByRenderer: { 1: 1, 2: 1 },
});
assert.deepEqual(summarizeReactCommitProbe([], { start: 10, end: 20 }), {
  totalObservedCommitCount: 0,
  interactionCommitCount: 0,
  firstInteractionCommitAt: null,
  lastInteractionCommitAt: null,
  maxInteractionCommitGapMs: 0,
  commitsByRenderer: {},
});

assert.deepEqual(Object.fromEntries(Object.entries(summarizeFramePhases({
  startTime: 100, duration: 54.2, renderStart: 152.2, styleAndLayoutStart: 153.3,
})).map(([key, value]) => [key, Number(value.toFixed(1))])), {
  beforeRenderMs: 52.2, renderToStyleAndLayoutMs: 1.1, styleAndLayoutToEndMs: 0.9,
});
assert.equal(summarizeFramePhases({ startTime: 100, duration: 54.2, renderStart: 0 }), null);
assert.equal(summarizeFramePhases({ startTime: 100, duration: 54.2, renderStart: 160 }), null);
assert.deepEqual(alignTraceClock([
  { name: "e2-clock", ts: 1_000_000, ph: "R" },
  { name: "RunTask", ts: 1_005_000, dur: 2000, ph: "X" },
], { name: "e2-clock", startTime: 200 }), {
  traceOriginUs: 800_000,
  events: [
    { name: "e2-clock", ts: 1_000_000, ph: "R", performanceStartTime: 200 },
    { name: "RunTask", ts: 1_005_000, dur: 2000, ph: "X", performanceStartTime: 205 },
  ],
});
assert.throws(() => alignTraceClock([], { name: "e2-clock", startTime: 200 }), /clock marker/);
assert.throws(() => alignTraceClock([{ name: "e2-clock", ts: 1000 }], { name: "e2-clock", startTime: NaN }), /clock marker/);
const gpuRasterSourceTiles = matchGpuRasterTasksToSourceTiles([
  {
    name: "RasterTask",
    ph: "X",
    pid: 11,
    tid: 7,
    ts: 1_000_000,
    dur: 30_000,
    args: { tileData: { layerId: 147, sourceFrameNumber: 1553, tileResolution: "HIGH_RESOLUTION" } },
  },
  {
    name: "RasterImplementation::RasterCHROMIUM",
    ph: "X",
    pid: 11,
    tid: 7,
    ts: 1_010_000,
    dur: 2_000,
    args: { raster_chromium_id: 98 },
  },
  {
    name: "RasterDecoderImpl::DoRasterCHROMIUM",
    ph: "X",
    pid: 22,
    tid: 8,
    ts: 2_010_000,
    dur: 5_000,
    args: { raster_id: 98 },
  },
  {
    name: "RasterDecoderImpl::DoRasterCHROMIUM",
    ph: "X",
    pid: 22,
    tid: 8,
    ts: 2_020_000,
    dur: 1_000,
    args: { raster_id: 99 },
  },
  {
    name: "GPUTask",
    ph: "X",
    pid: 22,
    tid: 8,
    ts: 2_000_000,
    dur: 40_000,
    args: { data: { renderer_pid: 11, used_bytes: 512_000_000 } },
  },
], { minGpuTaskDurationMs: 0 });
assert.deepEqual(gpuRasterSourceTiles.matches.map((match) => ({
  status: match.status,
  gpuTaskStartTimeUs: match.gpuTaskStartTimeUs,
  gpuTaskDurationMs: match.gpuTaskDurationMs,
  rasterId: match.rasterId,
  sourceFrameNumber: match.sourceFrameNumber ?? null,
  layerId: match.layerId ?? null,
  reason: match.reason ?? null,
})), [
  {
    status: "matched",
    gpuTaskStartTimeUs: 2_000_000,
    gpuTaskDurationMs: 40,
    rasterId: "98",
    sourceFrameNumber: 1553,
    layerId: "147",
    reason: null,
  },
  {
    status: "unmatched",
    gpuTaskStartTimeUs: 2_000_000,
    gpuTaskDurationMs: 40,
    rasterId: "99",
    sourceFrameNumber: null,
    layerId: null,
    reason: "renderer-raster-call-not-found",
  },
]);
assert.deepEqual(gpuRasterSourceTiles.summary, {
  matchedCount: 1,
  unmatchedCount: 1,
  minGpuTaskDurationMs: 0,
});
assert.deepEqual(alignMonotonicClocks([
  { nodeBefore: 100, browserTime: 210, nodeAfter: 102 },
  { nodeBefore: 200, browserTime: 310, nodeAfter: 202 },
]), {
  offsetMs: 109,
  uncertaintyMs: 1,
  anchorCount: 2,
  anchors: [
    { nodeBefore: 100, nodeAfter: 102, browserTime: 210, offsetMs: 109, roundTripUncertaintyMs: 1 },
    { nodeBefore: 200, nodeAfter: 202, browserTime: 310, offsetMs: 109, roundTripUncertaintyMs: 1 },
  ],
});
assert.throws(() => alignMonotonicClocks([{ nodeBefore: 1, browserTime: 2, nodeAfter: 3 }]), /two valid/);
assert.equal(mapBrowserMonotonicToEpochMs({
  timeOriginEpochMs: 1_700_000_000_000,
  monotonicTimeMs: 125.5,
  wallClockEpochMs: 1_700_000_000_125,
}, 150.25), 1_700_000_000_150.25);
assert.throws(() => mapBrowserMonotonicToEpochMs({
  timeOriginEpochMs: 1_700_000_000_000,
  monotonicTimeMs: Number.NaN,
  wallClockEpochMs: 1_700_000_000_125,
}, 150), /valid browser clock anchor/);
assert.throws(() => mapBrowserMonotonicToEpochMs({
  timeOriginEpochMs: 1_700_000_000_000,
  monotonicTimeMs: 125.5,
  wallClockEpochMs: 1_700_000_000_125,
}, Number.POSITIVE_INFINITY), /finite browser performance time/);
assert.deepEqual(summarizeEditorMotionTimeline([
  { animationId: "tab", type: "created", owner: "tab:layout", at: 90, durationMs: 400, delayMs: 0, easing: "ease-in-out" },
  { animationId: "tab", type: "started", owner: "tab:layout", at: 100, startTime: 100 },
  { animationId: "popover", type: "created", owner: "container:morph", at: 95, durationMs: 960, delayMs: 0, easing: "ease-in-out" },
  { animationId: "popover", type: "started", owner: "container:morph", at: 101, startTime: 101 },
  { animationId: "ghost", type: "created", owner: "snapshot:ghost", at: 96, durationMs: 360, delayMs: 120, easing: "ease-in-out" },
  { animationId: "ghost", type: "started", owner: "snapshot:ghost", at: 102, startTime: 102 },
  { animationId: "tab", type: "finished", owner: "tab:layout", at: 500 },
  { animationId: "popover", type: "finished", owner: "container:morph", at: 1061 },
  { animationId: "ghost", type: "cancelled", owner: "snapshot:ghost", at: 370 },
], [
  { startTime: 200, duration: 80 },
  { startTime: 320, duration: 80 },
]), {
  animationCount: 3,
  completedCount: 2,
  cancelledCount: 1,
  incompleteCount: 0,
  animations: [
    {
      animationId: "tab",
      owner: "tab:layout",
      durationMs: 400,
      delayMs: 0,
      easing: "ease-in-out",
      status: "finished",
      effectiveStartTime: 100,
      endTime: 500,
      longFrameOverlapMs: 160,
    },
    {
      animationId: "popover",
      owner: "container:morph",
      durationMs: 960,
      delayMs: 0,
      easing: "ease-in-out",
      status: "finished",
      effectiveStartTime: 101,
      endTime: 1061,
      longFrameOverlapMs: 160,
    },
    {
      animationId: "ghost",
      owner: "snapshot:ghost",
      durationMs: 360,
      delayMs: 120,
      easing: "ease-in-out",
      status: "cancelled",
      effectiveStartTime: 222,
      endTime: 370,
      longFrameOverlapMs: 108,
    },
  ],
});
assert.equal(summarizeEditorMotionTimeline([], []).animationCount, 0);
const preparationClockAnchors = selectPreparationClockAnchors([
  { phase: "page-ready", nodeBefore: 0, browserTime: 100, nodeAfter: 56 },
  { phase: "preparation-start", nodeBefore: 100, browserTime: 210, nodeAfter: 102 },
  { phase: "preparation-start", nodeBefore: 110, browserTime: 220, nodeAfter: 112 },
  { phase: "preparation-start", nodeBefore: 120, browserTime: 230, nodeAfter: 122 },
  { phase: "preparation-end", nodeBefore: 200, browserTime: 310, nodeAfter: 202 },
  { phase: "preparation-end", nodeBefore: 210, browserTime: 320, nodeAfter: 212 },
  { phase: "preparation-end", nodeBefore: 220, browserTime: 330, nodeAfter: 222 },
  { phase: "trace-end", nodeBefore: 1000, browserTime: 1110, nodeAfter: 1070 },
]);
assert.deepEqual(preparationClockAnchors.map((anchor) => anchor.phase), [
  "preparation-start",
  "preparation-end",
]);
assert.equal(
  Math.max(...preparationClockAnchors.map(anchor => (anchor.nodeAfter - anchor.nodeBefore) / 2)),
  1,
);
assert.equal(alignMonotonicClocks(preparationClockAnchors).uncertaintyMs, 1);
assert.throws(() => selectPreparationClockAnchors([
  { phase: "preparation-start", nodeBefore: 1, browserTime: 2, nodeAfter: 2 },
]), /start and end/);

const temporallyMatchedRasterTasks = matchRasterTasksToLayerSnapshots([
  {
    receivedAt: 100,
    layers: [{ layerId: "7", backendNodeId: 11, width: 2400, height: 1350 }],
  },
  {
    receivedAt: 150,
    layers: [{ layerId: "7", backendNodeId: 29, width: 800, height: 450 }],
  },
], [
  { layerId: "7", startTime: 102, durationMs: 4 },
  { layerId: "7", startTime: 148, durationMs: 4 },
  { layerId: "7", startTime: 220, durationMs: 5 },
], {
  maxSnapshotDistanceMs: 12,
  clockUncertaintyMs: 1,
});
assert.deepEqual(temporallyMatchedRasterTasks.matches.map((match) => ({
  status: match.status,
  snapshotIndex: match.snapshotIndex,
  backendNodeId: match.layer?.backendNodeId ?? null,
})), [
  { status: "matched", snapshotIndex: 0, backendNodeId: 11 },
  { status: "matched", snapshotIndex: 1, backendNodeId: 29 },
  { status: "unmatched", snapshotIndex: null, backendNodeId: null },
]);
assert.equal(temporallyMatchedRasterTasks.summary.matchedCount, 2);
assert.equal(temporallyMatchedRasterTasks.summary.unmatchedCount, 1);
assert.equal(temporallyMatchedRasterTasks.summary.clockUncertaintyMs, 1);
assert.equal(temporallyMatchedRasterTasks.summary.maxObservedSnapshotDistanceMs, 4);

assert.deepEqual(summarizeLayerIdentityContinuity([
  {
    layers: [
      { layerId: "7", backendNodeId: 11, width: 2400, height: 1350 },
      { layerId: "8", width: 100, height: 40 },
    ],
  },
  {
    layers: [
      { layerId: "7", backendNodeId: 29, width: 800, height: 450 },
      { layerId: "8", backendNodeId: 32, width: 100, height: 40 },
    ],
  },
]), {
  snapshotCount: 2,
  uniqueLayerIdCount: 2,
  reusedLayerIdCount: 1,
  reusedLayerIds: [{
    layerId: "7",
    snapshotCount: 2,
    backendNodeIds: [11, 29],
    missingBackendNodeCount: 0,
    distinctDimensions: 2,
  }],
  layerIdsWithMissingBackendNode: 1,
});

assert.equal(matchRasterTasksToLayerSnapshots([
  { receivedAt: 100, layers: [{ layerId: "old" }] },
], [
  { layerId: "old", startTime: 99, durationMs: 2 },
], {
  maxSnapshotDistanceMs: 10,
  clockUncertaintyMs: 11,
}).matches[0].status, "uncertain");

assert.deepEqual(filterEntriesByTimeWindow([
  { startTime: 10, duration: 20, id: "before" },
  { startTime: 29, duration: 2, id: "cross-start" },
  { startTime: 30, duration: 1, id: "inside" },
  { startTime: 49, duration: 2, id: "cross-end" },
  { startTime: 52, duration: 2, id: "after" },
], 30, 50).map(entry => entry.id), ["cross-start", "inside", "cross-end"]);
assert.deepEqual(filterEntriesByTimeWindow([], 30, 50), []);
assert.deepEqual(filterEntriesByTimeWindow([{ startTime: 30, duration: 0 }], 30, 30).length, 1);

assert.deepEqual(summarizeLayerTree([
  { layerId: "stage", backendNodeId: 12, offsetX: 10, offsetY: 20,
    width: 2400, height: 1350, drawsContent: true, paintCount: 3 },
  { layerId: "overlay", backendNodeId: 13, offsetX: 0, offsetY: 0,
    width: 100, height: 40, drawsContent: false, paintCount: 0 },
], {
  12: { nodeName: "DIV", attributes: ["class", "runtime-layout-stage", "data-tab", "layout"] },
  13: { nodeName: "DIV", attributes: ["class", "toolbar-popover-morph-ghost"] },
}, {
  stage: ["Is a transform node", "Has a will-change transform"],
}), [
  {
    layerId: "stage",
    parentLayerId: null,
    backendNodeId: 12,
    nodeName: "DIV",
    className: "runtime-layout-stage",
    dataTab: "layout",
    width: 2400,
    height: 1350,
    area: 3_240_000,
    drawsContent: true,
    paintCount: 3,
    compositingReasons: ["Is a transform node", "Has a will-change transform"],
  },
  {
    layerId: "overlay",
    parentLayerId: null,
    backendNodeId: 13,
    nodeName: "DIV",
    className: "toolbar-popover-morph-ghost",
    dataTab: "",
    width: 100,
    height: 40,
    area: 4000,
    drawsContent: false,
    paintCount: 0,
    compositingReasons: [],
  },
]);

const controlLayer = summarizeLayerTree([
  { layerId: "checkbox", backendNodeId: 42, width: 36, height: 37, drawsContent: true },
], {
  42: { nodeName: "INPUT", attributes: [
    "type", "checkbox", "data-help-key", "layout.component", "data-component-id", "dialog_panel",
    "value", "must-not-be-recorded", "title", "private-user-text", "data-user-secret", "private",
  ] },
})[0];
assert.deepEqual(controlLayer.controlIdentity, {
  type: "checkbox", helpKey: "layout.component", componentId: "dialog_panel",
});
assert.doesNotMatch(JSON.stringify(controlLayer), /must-not-be-recorded|private-user-text|data-user-secret/);

const summary = summarizeLongAnimationFrame({
  startTime: 12.5,
  duration: 83.2,
  blockingDuration: 41.7,
  renderStart: 40,
  styleAndLayoutStart: 49,
  scripts: [
    {
      invoker: "BUTTON#layout",
      invokerType: "event-listener",
      sourceURL: "http://127.0.0.1/assets/layout.js",
      sourceFunctionName: "switchTab",
      sourceCharPosition: 280,
      duration: 24.1,
      executionStart: 18,
      forcedStyleAndLayoutDuration: 20.5,
    },
  ],
});

assert.deepEqual(summary, {
  startTime: 12.5,
  duration: 83.2,
  blockingDuration: 41.7,
  renderStart: 40,
  styleAndLayoutStart: 49,
  scripts: [{
    invoker: "BUTTON#layout",
    invokerType: "event-listener",
    sourceURL: "http://127.0.0.1/assets/layout.js",
    sourceFunctionName: "switchTab",
    sourceCharPosition: 280,
    duration: 24.1,
    executionStart: 18,
    forcedStyleAndLayoutDuration: 20.5,
  }],
});
assert.deepEqual(summarizeLongAnimationFrame({
  startTime: 2,
  duration: 51,
  blockingDuration: 0,
  renderStart: 0,
  styleAndLayoutStart: 0,
}), {
  startTime: 2,
  duration: 51,
  blockingDuration: 0,
  renderStart: 0,
  styleAndLayoutStart: 0,
  scripts: [],
});

const validGpuProvenance = validateBrowserGpuProvenance({
  browserMode: "headful-visible",
  userAgent: "Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36",
  webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00002F58) Direct3D11 vs_5_0 ps_5_0, D3D11)",
}, "NVIDIA GeForce GTX 1050 Ti");
assert.deepEqual(validGpuProvenance, { ok: true, failures: [] });

assert.deepEqual(validateBrowserGpuProvenance({
  browserMode: "headless",
  userAgent: "Mozilla/5.0 HeadlessChrome/148.0.0.0 Safari/537.36",
  webglRenderer: "ANGLE (Google, Vulkan, SwiftShader Device (Subzero))",
}, "NVIDIA GeForce GTX 1050 Ti"), {
  ok: false,
  failures: [
    "browser was not launched in visible headful mode",
    "browser user agent identifies a headless runtime",
    "WebGL renderer is missing or software-rendered",
    "WebGL renderer does not match expected GPU: NVIDIA GeForce GTX 1050 Ti",
  ],
});

assert.deepEqual(validateBrowserGpuProvenance({
  browserMode: "headful-visible",
  userAgent: "Mozilla/5.0 Chrome/148.0.0.0 Safari/537.36",
  webglRenderer: "ANGLE (Microsoft, Basic Render Driver, D3D11)",
}, "NVIDIA GeForce GTX 1050 Ti"), {
  ok: false,
  failures: [
    "WebGL renderer is missing or software-rendered",
    "WebGL renderer does not match expected GPU: NVIDIA GeForce GTX 1050 Ti",
  ],
});

assert.deepEqual(summarizeTargetModuleResourceReadiness([
  {
    name: "http://127.0.0.1/assets/RuntimeLayoutDesigner-CWn0LkEf.js",
    startTime: 120,
    responseEnd: 240,
    transferSize: 83_500,
  },
], "RuntimeLayoutDesigner-", 600), {
  matchedResourceCount: 1,
  loadedBeforeInteraction: true,
  resources: [{
    name: "RuntimeLayoutDesigner-CWn0LkEf.js",
    startTime: 120,
    responseEnd: 240,
    transferSize: 83_500,
  }],
});

assert.equal(summarizeTargetModuleResourceReadiness([
  {
    name: "http://127.0.0.1/assets/RuntimeLayoutDesigner-CWn0LkEf.js",
    startTime: 540,
    responseEnd: 740,
    transferSize: 83_500,
  },
], "RuntimeLayoutDesigner-", 600).loadedBeforeInteraction, false);

assert.deepEqual(summarizeTargetModuleResourceReadiness([], "RuntimeLayoutDesigner-", 600), {
  matchedResourceCount: 0,
  loadedBeforeInteraction: false,
  resources: [],
});

assert.deepEqual(summarizeFirstPresentationResourceReadiness({
  interactionWindow: { start: 100, end: 200 },
  resources: [
    { name: "http://127.0.0.1/assets/preloaded.css", initiatorType: "link", startTime: 40, responseEnd: 60 },
    { name: "http://127.0.0.1/assets/layout.png", initiatorType: "img", startTime: 120, responseEnd: 180, transferSize: 512 },
    { name: "http://127.0.0.1/assets/after.json", initiatorType: "fetch", startTime: 201, responseEnd: 240 },
  ],
  images: [
    { source: "http://127.0.0.1/assets/layout.png", complete: true, naturalWidth: 1280, naturalHeight: 720 },
    { source: "data:image/png;base64,secret-payload", complete: true, naturalWidth: 0, naturalHeight: 0 },
  ],
  fonts: {
    status: "loaded",
    faces: [{ family: "Inter", status: "loaded" }, { family: "ProjectFont", status: "loading" }],
  },
}), {
  window: { start: 100, end: 200, valid: true },
  lateResources: [{
    name: "layout.png",
    initiatorType: "img",
    startTime: 120,
    responseEnd: 180,
    transferSize: 512,
  }],
  lateResourceCount: 1,
  imageCount: 2,
  completeImageCount: 1,
  incompleteImages: [{
    source: "data:",
    complete: true,
    naturalWidth: 0,
    naturalHeight: 0,
  }],
  fontSetStatus: "loaded",
  pendingFontFaces: ["ProjectFont"],
});

const glassAnimationTimeline = summarizeGlassAnimationTimeline([
  {
    event: "started",
    animationId: "nav-morph-1",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    at: 100,
    durationMs: 120,
    animationType: "WebAnimation",
  },
  {
    event: "canceled",
    animationId: "nav-morph-1",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    at: 160,
  },
  {
    event: "started",
    animationId: "nav-morph-2",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    at: 170,
    durationMs: 120,
    animationType: "WebAnimation",
  },
  {
    event: "started",
    animationId: "designer-indicator",
    target: ".runtime-layout-sidebar .glass-selection-indicator",
    at: 110,
    durationMs: 300,
    animationType: "CSSTransition",
  },
  {
    event: "started",
    animationId: "outside-target",
    target: ".unrelated",
    at: 100,
    durationMs: 1000,
    animationType: "WebAnimation",
  },
], [
  { startTime: 150, duration: 50 },
  { startTime: 260, duration: 40 },
]);
assert.deepEqual(glassAnimationTimeline, {
  targetAnimationCount: 3,
  startCount: 3,
  cancelCount: 1,
  unmatchedCancelCount: 0,
  loafOverlapCount: 3,
  overlappingAnimationIds: ["designer-indicator", "nav-morph-1", "nav-morph-2"],
  invalidEventCount: 0,
});
assert.deepEqual(summarizeGlassAnimationTimeline([
  {
    event: "started",
    animationId: "bad-time",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    at: NaN,
    durationMs: 80,
  },
  {
    event: "canceled",
    animationId: "missing",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    at: 10,
  },
], []), {
  targetAnimationCount: 0,
  startCount: 0,
  cancelCount: 1,
  unmatchedCancelCount: 1,
  loafOverlapCount: 0,
  overlappingAnimationIds: [],
  invalidEventCount: 1,
});
assert.deepEqual(getGlassAnimationTimelineSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  hardwareGpuRequired: true,
}), []);
assert.deepEqual(getGlassAnimationTimelineSetupFailures({
  enabled: true,
  entryMode: "warm",
  targetTab: "theme",
  productionPreview: false,
  hardwareGpuRequired: false,
}), [
  "glass animation timeline requires a cold entry",
  "glass animation timeline requires the layout target",
  "glass animation timeline requires the production preview",
  "glass animation timeline requires hardware-GPU provenance validation",
]);
assert.deepEqual(getGenericCompositorWarmupSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  hardwareGpuRequired: true,
}), []);
assert.deepEqual(getGenericCompositorWarmupSetupFailures({
  enabled: true,
  entryMode: "warm",
  targetTab: "theme",
  productionPreview: false,
  hardwareGpuRequired: false,
}), [
  "generic compositor warm-up requires a cold entry",
  "generic compositor warm-up requires the layout target",
  "generic compositor warm-up requires the production preview",
  "generic compositor warm-up requires hardware-GPU provenance validation",
]);
assert.deepEqual(getGenericCompositorWarmupSetupFailures({ enabled: false }), []);
assert.deepEqual(getStagePromotionSetupFailures({
  enabled: true,
  mode: "pre-mounted",
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: true,
  warmLayerOpacity: 0.001,
  prewarmLayoutFromSettings: false,
  hardwareGpuRequired: true,
}), []);
assert.deepEqual(getStagePromotionSetupFailures({ enabled: false }), []);
assert.deepEqual(getStagePromotionSetupFailures({
  enabled: true,
  mode: "pre-mounted",
  entryMode: "warm",
  targetTab: "theme",
  productionPreview: false,
  layoutPreMounted: false,
  warmLayerOpacity: 0,
  prewarmLayoutFromSettings: true,
  hardwareGpuRequired: false,
}), [
  "stage promotion requires a cold entry",
  "stage promotion requires the layout target",
  "stage promotion requires the production preview",
  "stage promotion requires the initially pre-mounted layout",
  "stage promotion requires warm-layer opacity 0.001",
  "stage promotion cannot combine with settings-to-layout prewarming",
  "stage promotion requires hardware-GPU provenance validation",
]);
assert.deepEqual(summarizeStagePromotionEvidence({
  enabled: true,
  mode: "pre-mounted",
  warmWillChange: "transform",
  activeWillChange: "transform",
  activeTab: "layout",
  activePreviewVisible: true,
  activeStageSize: { width: 2728, height: 1534 },
}), {
  enabled: true,
  mode: "pre-mounted",
  property: "will-change",
  expectedValue: "transform",
  warmWillChange: "transform",
  activeWillChange: "transform",
  activeTab: "layout",
  activePreviewVisible: true,
  activeStageSize: { width: 2728, height: 1534 },
  failures: [],
  ok: true,
});

assert.deepEqual(getLayoutStageWillChangeSetupFailures({
  enabled: true,
  mode: "auto",
  entryMode: "cold",
  targetTab: "layout",
  developmentSource: true,
  hardwareGpuRequired: true,
}), []);
assert.ok(getLayoutStageWillChangeSetupFailures({
  enabled: true,
  mode: "auto",
  entryMode: "warm",
  targetTab: "layout",
  developmentSource: true,
  hardwareGpuRequired: true,
}).includes("layout stage will-change diagnostic requires a cold entry"));
assert.deepEqual(getLayoutStageWillChangeSetupFailures({
  enabled: true,
  mode: "auto",
  entryMode: "cold",
  targetTab: "layout",
  developmentSource: false,
  hardwareGpuRequired: true,
}), []);
assert.ok(getLayoutStageWillChangeSetupFailures({
  enabled: true,
  mode: "auto",
  entryMode: "cold",
  targetTab: "layout",
  hardwareGpuRequired: true,
}).includes("layout stage will-change diagnostic requires a known source mode"));
assert.deepEqual(getLayoutStageWillChangeSetupFailures({ enabled: false }), []);
assert.deepEqual(summarizeLayoutStageWillChangeEvidence({
  enabled: true,
  mode: "auto",
  warmWillChangeBefore: "transform",
  warmWillChangeAfter: "auto",
  activeWillChange: "auto",
  activeTab: "layout",
  activePreviewVisible: true,
  warmStageSizeBefore: { width: 2736, height: 1538 },
  warmStageSizeAfter: { width: 2736, height: 1538 },
  activeStageSize: { width: 2728, height: 1534 },
}), {
  enabled: true,
  mode: "auto",
  property: "will-change",
  expectedValue: "auto",
  warmWillChangeBefore: "transform",
  warmWillChangeAfter: "auto",
  activeWillChange: "auto",
  activeTab: "layout",
  activePreviewVisible: true,
  warmStageSizeBefore: { width: 2736, height: 1538 },
  warmStageSizeAfter: { width: 2736, height: 1538 },
  activeStageSize: { width: 2728, height: 1534 },
  failures: [],
  ok: true,
});
assert.equal(summarizeLayoutStageWillChangeEvidence({
  enabled: true,
  mode: "auto",
  warmWillChangeBefore: "transform",
  warmWillChangeAfter: "transform",
  activeWillChange: "transform",
  activeTab: "layout",
  activePreviewVisible: false,
  warmStageSizeBefore: { width: 2736, height: 1538 },
  warmStageSizeAfter: { width: 2736, height: 1538 },
  activeStageSize: { width: 0, height: 0 },
}).ok, false);
assert.deepEqual(getLayoutLayerTreeTimelineSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  developmentSource: true,
  hardwareGpuRequired: true,
  diagnosticRepeats: 1,
}), []);
assert.ok(getLayoutLayerTreeTimelineSetupFailures({
  enabled: true,
  entryMode: "warm",
  targetTab: "layout",
  developmentSource: true,
  hardwareGpuRequired: true,
  diagnosticRepeats: 1,
}).includes("layout layer-tree timeline requires a cold entry"));
assert.ok(getLayoutLayerTreeTimelineSetupFailures({
  enabled: true,
  entryMode: "cold",
  targetTab: "layout",
  developmentSource: false,
  hardwareGpuRequired: true,
  diagnosticRepeats: 1,
}).includes("layout layer-tree timeline requires the current-source development server"));
assert.deepEqual(getLayoutLayerTreeTimelineSetupFailures({ enabled: false }), []);
assert.deepEqual(summarizeLayoutLayerTreeTimeline({
  snapshots: [
    { atMs: 90, layers: [{ layerId: "before", nodeName: "DIV", className: "panel", width: 3600, height: 2200, drawsContent: true, paintCount: 1 }] },
    { atMs: 110, layers: [{ layerId: "during", nodeName: "DIV", className: "panel", width: 3600, height: 2200, drawsContent: true, paintCount: 2 }] },
    { atMs: 150, layers: [{ layerId: "after", nodeName: "DIV", className: "panel", width: 3600, height: 2200, drawsContent: true, paintCount: 3 }] },
  ],
  interactionStartMs: 100,
  interactionEndMs: 140,
}), {
  ok: true,
  failures: [],
  snapshotCount: 3,
  beforeInteractionCount: 1,
  duringInteractionCount: 1,
  afterInteractionCount: 1,
  timeline: [
    { atMs: 90, layerCount: 1, largeDrawingLayers: [{ layerId: "before", nodeName: "DIV", className: "panel", width: 3600, height: 2200, paintCount: 1 }] },
    { atMs: 110, layerCount: 1, largeDrawingLayers: [{ layerId: "during", nodeName: "DIV", className: "panel", width: 3600, height: 2200, paintCount: 2 }] },
    { atMs: 150, layerCount: 1, largeDrawingLayers: [{ layerId: "after", nodeName: "DIV", className: "panel", width: 3600, height: 2200, paintCount: 3 }] },
  ],
});
assert.equal(summarizeStagePromotionEvidence({
  enabled: true,
  mode: "pre-mounted",
  warmWillChange: "auto",
  activeWillChange: "auto",
  activeTab: "settings",
  activePreviewVisible: false,
  activeStageSize: { width: 0, height: 0 },
}).ok, false);
assert.deepEqual(getStagePromotionSetupFailures({
  enabled: true,
  mode: "first-render",
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: false,
  warmLayerOpacity: 0,
  prewarmLayoutFromSettings: false,
  hardwareGpuRequired: true,
}), []);
assert.ok(getStagePromotionSetupFailures({
  enabled: true,
  mode: "first-render",
  entryMode: "cold",
  targetTab: "layout",
  productionPreview: true,
  layoutPreMounted: true,
  warmLayerOpacity: 0.001,
  prewarmLayoutFromSettings: false,
  hardwareGpuRequired: true,
}).includes("first-render stage promotion cannot use a pre-mounted layout"));
assert.deepEqual(summarizeStagePromotionEvidence({
  enabled: true,
  mode: "first-render",
  warmWillChange: "not-mounted",
  activeWillChange: "transform",
  activeTab: "layout",
  activePreviewVisible: true,
  activeStageSize: { width: 2728, height: 1534 },
}), {
  enabled: true,
  mode: "first-render",
  property: "will-change",
  expectedValue: "transform",
  warmWillChange: "not-mounted",
  activeWillChange: "transform",
  activeTab: "layout",
  activePreviewVisible: true,
  activeStageSize: { width: 2728, height: 1534 },
  failures: [],
  ok: true,
});

const glassStyleWriteTimeline = summarizeGlassStyleWriteTimeline([
  {
    event: "style-write",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    property: "transform",
    at: 100,
    previousValue: "translate3d(0px, 0px, 0px)",
    nextValue: "translate3d(12px, 0px, 0px)",
  },
  {
    event: "style-write",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    property: "width",
    at: 101,
    previousValue: "80px",
    nextValue: "80px",
  },
  {
    event: "style-write",
    target: ".runtime-layout-sidebar .glass-selection-indicator",
    property: "transform",
    at: 210,
    previousValue: "translate3d(0px, 0px, 0px)",
    nextValue: "translate3d(24px, 0px, 0px)",
  },
  {
    event: "style-write",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    property: "transform",
    at: 300,
    previousValue: "translate3d(12px, 0px, 0px)",
    nextValue: "translate3d(12px, 0px, 0px)",
    requestedValue: "translate3d(18px, 0px, 0px)",
    applied: false,
  },
  {
    event: "style-write",
    target: ".not-a-glass-group .glass-selection-indicator",
    property: "transform",
    at: 101,
    previousValue: "none",
    nextValue: "translate3d(1px, 0px, 0px)",
  },
  {
    event: "style-write",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    property: "color",
    at: 101,
    previousValue: "red",
    nextValue: "blue",
  },
  {
    event: "style-write",
    target: ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator",
    property: "opacity",
    at: Number.NaN,
    previousValue: "0",
    nextValue: "1",
  },
], [
  { startTime: 99, duration: 5 },
  { startTime: 205, duration: 10 },
]);
assert.deepEqual(glassStyleWriteTimeline, {
  targetWriteCount: 4,
  effectiveWriteCount: 2,
  sameValueWriteCount: 1,
  requestedChangeCount: 3,
  invalidEventCount: 3,
  writesDuringLongAnimationFrames: 3,
  targetCounts: {
    advancedToolsNavigation: 3,
    runtimeLayoutSidebar: 1,
  },
  propertyCounts: {
    width: 1,
    transform: 3,
  },
  appliedWriteCount: 3,
  suppressedWriteCount: 1,
});
assert.equal(getGlassStyleWriteMode(undefined), "observe");
assert.equal(getGlassStyleWriteMode("observe"), "observe");
assert.equal(getGlassStyleWriteMode("suppress"), "suppress");
assert.throws(() => getGlassStyleWriteMode("freeze"), /must be observe or suppress/);

console.log("PASS advanced layout transition long-animation-frame attribution contract");
