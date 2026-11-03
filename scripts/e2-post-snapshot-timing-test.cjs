"use strict";
const assert = require("node:assert/strict");
const {
  instrumentPostSnapshotSource,
  getPostSnapshotSetupFailures,
  summarizePostSnapshotEvidence,
} = require("./lib/e2-post-snapshot-timing.cjs");

const setup = {
  enabled: true, baseProbeEnabled: true, traceEnabled: false, profilerEnabled: false,
  cold: true, source: true, viewport: "4k", dpr: 1, headful: true,
  isolated: true, hardwareGpu: true, repeats: 1, reducedMotion: false,
};
assert.deepEqual(getPostSnapshotSetupFailures(setup), []);
for (const [key, value] of Object.entries({
  baseProbeEnabled: false, traceEnabled: true, profilerEnabled: true, cold: false,
  source: false, viewport: "1080p", dpr: 2, headful: false, isolated: false,
  hardwareGpu: false, repeats: 3, reducedMotion: true,
})) {
  assert(getPostSnapshotSetupFailures({ ...setup, [key]: value }).length,
    `invalid ${key} must be rejected`);
}

const sources = {
  EditorToolbar: [
    '    const nextRect = node.getBoundingClientRect();',
    '    const fullDeltaX = previousRect.left - nextRect.left;',
    '    node.classList.add("is-morphing");',
    '    const motionScale = Number(getComputedStyle(document.documentElement).getPropertyValue("--motion-scale").trim());',
    '    const duration = reduced',
    '    const tokens = getComputedStyle(document.documentElement);',
    '    const easing = tokens.getPropertyValue("--ease-ui-in-out").trim();',
    '    const contentEasing = tokens.getPropertyValue("--ease-ui-out").trim();',
    '    const content = node.querySelector(".advanced-tools-panel");',
    '    popoverMorphRef.current = animation;',
  ].join("\n"),
  AdvancedToolsPanel: [
    '    if (transitionPhase !== "crossfading" || !enteringTab) return;',
    '    const token = transitionTokenRef.current;',
    '    const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-editor-crossfade").trim();',
    '    const timing = { duration,',
    '    for (const animation of animations) animation.pause();',
    '    layerAnimationsRef.current = animations;',
  ].join("\n"),
  RuntimeLayoutDesigner: [
    'export function RuntimeLayoutDesigner({ sessionRef }) {',
    '  const savedSkin',
    '  const layoutSessionRef = useRef((() => {',
    '    return saved;',
    '  })());',
    '  const screen = getScreen(draft, screenId);',
    '  onQuickMenuToggle',
    '}) {',
    '  const titleBackground =',
    '      const next = { width, height };',
    '      stageSizeReadyRef.current = true;',
  ].join("\n"),
};
for (const [moduleName, source] of Object.entries(sources)) {
  const patch = instrumentPostSnapshotSource(source, moduleName);
  assert.equal(patch.failures.length, 0, moduleName);
  assert(patch.matches > 0);
  assert(patch.source.includes("__e2PostSnapshotTiming"));
  const doubled = instrumentPostSnapshotSource(`${source}\n${source}`, moduleName);
  assert(doubled.failures.length, `${moduleName}: duplicate anchors must fail closed`);
  assert.equal(doubled.source, `${source}\n${source}`, "failed patch must return original bytes");
}
assert(instrumentPostSnapshotSource("", "unknown").failures.length);
const frozenPatch = instrumentPostSnapshotSource(sources.RuntimeLayoutDesigner,
  "RuntimeLayoutDesigner", { freezeStageSizeDuringTransition: true });
assert(frozenPatch.valid);
assert(frozenPatch.source.includes('mark("stage:size-suppressed"'),
  "diagnostic intervention must record every suppressed stage-state update");
assert(!instrumentPostSnapshotSource(sources.RuntimeLayoutDesigner,
  "RuntimeLayoutDesigner").source.includes('mark("stage:size-suppressed"'),
  "default probe must never suppress product state updates");

const events = [
  { name: "crossfade:begin", at: 110 },
  { name: "crossfade:token:begin", at: 111 },
  { name: "crossfade:token:end", at: 126 },
  { name: "crossfade:animations:created", at: 127 },
  { name: "morph:geometry:begin", at: 128 },
  { name: "morph:geometry:end", at: 130 },
  { name: "morph:scale-token:begin", at: 131 },
  { name: "morph:scale-token:end", at: 136 },
  { name: "morph:tokens:begin", at: 137 },
  { name: "morph:tokens:end", at: 139 },
  { name: "morph:animation:created", at: 140 },
];
const evidence = {
  trustedClicks: 1, captureEnd: 105,
  patches: Object.fromEntries(Object.keys(sources).map(name => [name, { valid: true }])),
  initialRenderCounts: { designer: 2, preview: 2 },
  renderCounts: { designer: 2, preview: 2 },
  events,
  longAnimationFrames: [{ startTime: 120, duration: 60 }],
};
const summary = summarizePostSnapshotEvidence(evidence);
assert.equal(summary.valid, true);
assert.deepEqual(summary.transitionRenderCounts, { designer: 0, preview: 0 });
assert.equal(summary.phases.crossfadeToken.durationMs, 15);
assert.equal(summary.phases.crossfadeToken.overlapWithLongFramesMs, 6);
assert.equal(summary.firstLongFrameAfterCaptureMs, 15);
assert.equal(summary.lastMeasuredSyncEnd, 140);
assert.equal(summarizePostSnapshotEvidence({ ...evidence, events: [] }).valid, false);
assert.equal(summarizePostSnapshotEvidence({ ...evidence,
  initialRenderCounts: { designer: 0, preview: 0 } }).valid, false,
"zero render count cannot prove the source probe executed");
assert.equal(summarizePostSnapshotEvidence({ ...evidence,
  events: [{ name: "crossfade:begin", at: Number.NaN }, ...events.slice(1)] }).valid, false);
const renderedEvidence = {
  ...evidence,
  renderCounts: { designer: 3, preview: 3 },
  events: [...events,
    { name: "designer:session-init:begin", at: 141 },
    { name: "designer:session-init:end", at: 149 },
    { name: "designer:derive-screen:begin", at: 150 },
    { name: "designer:derive-screen:end", at: 152 }],
};
assert.equal(summarizePostSnapshotEvidence(renderedEvidence).valid, true);
assert.equal(summarizePostSnapshotEvidence(renderedEvidence)
  .repeatedPhases["designer:session-init"][0].durationMs, 8);
assert.equal(summarizePostSnapshotEvidence(renderedEvidence).lastMeasuredSyncEnd, 152);
assert.equal(summarizePostSnapshotEvidence({ ...renderedEvidence, events }).valid, false,
  "each transition render must have measured synchronous work");
console.log("PASS E2 post-snapshot timing scope, exact-source anchors and hit evidence");
