"use strict";

function getPostSnapshotSetupFailures(options = {}) {
  if (!options.enabled) return [];
  const checks = [
    [options.baseProbeEnabled === true, "requires synchronous snapshot probe"],
    [options.traceEnabled !== true, "cannot combine with trace"],
    [options.profilerEnabled !== true, "cannot combine with CPU profiler"],
    [options.cold === true, "requires cold navigation"],
    [options.source === true, "requires current development source"],
    [options.viewport === "4k" && Number(options.dpr) === 1, "requires 4K/DPR=1"],
    [options.headful === true && options.hardwareGpu === true, "requires visible hardware GPU"],
    [options.isolated === true, "requires isolated project"],
    [Number(options.repeats) === 1, "requires single repeat"],
    [options.reducedMotion !== true, "requires ordinary motion for this attribution scope"],
  ];
  return checks.filter(([valid]) => !valid).map(([, reason]) => `post-snapshot timing ${reason}`);
}

function instrumentPostSnapshotSource(source, moduleName, options = {}) {
  const mark = (name, detail = "") =>
    `window.__e2PostSnapshotTiming?.mark("${name}"${detail ? `, ${detail}` : ""});`;
  const definitions = {
    EditorToolbar: [
      ['    const nextRect = node.getBoundingClientRect();',
        `    ${mark("morph:geometry:begin")}\n    const nextRect = node.getBoundingClientRect();\n    ${mark("morph:geometry:end")}`],
      ['    node.classList.add("is-morphing");\n    const motionScale =',
        `    node.classList.add("is-morphing");\n    ${mark("morph:scale-token:begin")}\n    const motionScale =`],
      ['    const duration = reduced',
        `    ${mark("morph:scale-token:end")}\n    const duration = reduced`],
      ['    const tokens = getComputedStyle(document.documentElement);',
        `    ${mark("morph:tokens:begin")}\n    const tokens = getComputedStyle(document.documentElement);`],
      ['    const content = node.querySelector(".advanced-tools-panel");',
        `    ${mark("morph:tokens:end")}\n    const content = node.querySelector(".advanced-tools-panel");`],
      ['    popoverMorphRef.current = animation;',
        `    popoverMorphRef.current = animation;\n    ${mark("morph:animation:created")}`],
    ],
    AdvancedToolsPanel: [
      ['    if (transitionPhase !== "crossfading" || !enteringTab) return;',
        `    if (transitionPhase !== "crossfading" || !enteringTab) return;\n    ${mark("crossfade:begin")}`],
      ['    const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-editor-crossfade").trim();',
        `    ${mark("crossfade:token:begin")}\n    const easing = getComputedStyle(document.documentElement).getPropertyValue("--ease-editor-crossfade").trim();\n    ${mark("crossfade:token:end")}`],
      ['    layerAnimationsRef.current = animations;',
        `    layerAnimationsRef.current = animations;\n    ${mark("crossfade:animations:created")}`],
    ],
    RuntimeLayoutDesigner: [
      ['export function RuntimeLayoutDesigner({ sessionRef }) {',
        'export function RuntimeLayoutDesigner({ sessionRef }) {\n  window.__e2PostSnapshotTiming?.render("designer");'],
      ['  const layoutSessionRef = useRef((() => {',
        `  ${mark("designer:session-init:begin")}\n  const layoutSessionRef = useRef((() => {`],
      ['  })());',
        `  })());\n  ${mark("designer:session-init:end")}`],
      ['  const screen = getScreen(draft, screenId);',
        `  ${mark("designer:derive-screen:begin")}\n  const screen = getScreen(draft, screenId);\n  ${mark("designer:derive-screen:end")}`],
      ['  onQuickMenuToggle\n}) {\n  const titleBackground =',
        '  onQuickMenuToggle\n}) {\n  window.__e2PostSnapshotTiming?.render("preview");\n  const titleBackground ='],
      ['      const next = { width, height };\n      stageSizeReadyRef.current = true;',
        `      const next = { width, height };\n      ${mark("stage:size-observed", "{ width, height }")}\n` +
        (options.freezeStageSizeDuringTransition
          ? `      if (window.__advancedLayoutTransitionAudit?.running) {\n        ${mark("stage:size-suppressed", "{ width, height }")}\n        return;\n      }\n`
          : "") +
        `      stageSizeReadyRef.current = true;`],
    ],
  };
  const replacements = definitions[moduleName];
  if (!replacements) return { source, matches: 0, failures: ["unsupported module"], valid: false };
  const failures = [];
  for (const [needle] of replacements) {
    const count = String(source).split(needle).length - 1;
    if (count !== 1) failures.push(`${moduleName} expected one anchor: ${needle}; found ${count}`);
  }
  if (failures.length) return { source, matches: 0, failures, valid: false };
  let result = source;
  for (const [needle, replacement] of replacements) result = result.replace(needle, replacement);
  return { source: result, matches: replacements.length, failures, valid: true };
}

function summarizePostSnapshotEvidence({
  trustedClicks, captureEnd, patches = {}, events = [], initialRenderCounts = {},
  renderCounts = {}, longAnimationFrames = [],
} = {}) {
  const failures = [];
  if (trustedClicks !== 1) failures.push("requires exactly one trusted target click");
  if (!Number.isFinite(captureEnd)) failures.push("missing valid snapshot end time");
  for (const moduleName of ["EditorToolbar", "AdvancedToolsPanel", "RuntimeLayoutDesigner"]) {
    if (!patches[moduleName]?.valid) failures.push(`missing exact ${moduleName} source patch`);
  }
  const transitionRenderCounts = {};
  for (const name of ["designer", "preview"]) {
    const initial = initialRenderCounts[name];
    const final = renderCounts[name];
    if (!Number.isInteger(initial) || initial < 1
      || !Number.isInteger(final) || final < initial) {
      failures.push(`invalid ${name} initial/final render counts`);
    }
    transitionRenderCounts[name] = final - initial;
  }
  if (events.some(event => !Number.isFinite(event?.at))) failures.push("invalid event timestamp");
  const requiredNames = [
    "crossfade:begin", "crossfade:token:begin", "crossfade:token:end",
    "crossfade:animations:created", "morph:geometry:begin", "morph:geometry:end",
    "morph:scale-token:begin", "morph:scale-token:end",
    "morph:tokens:begin", "morph:tokens:end", "morph:animation:created",
  ];
  const selected = {};
  for (const name of requiredNames) {
    const hits = events.filter(event => event.name === name);
    if (hits.length !== 1) failures.push(`expected exactly one ${name} hit; got ${hits.length}`);
    else selected[name] = hits[0].at;
  }
  const overlap = (start, end) => longAnimationFrames.reduce((sum, frame) =>
    sum + Math.max(0, Math.min(end, frame.startTime + frame.duration) - Math.max(start, frame.startTime)), 0);
  const definitions = {
    crossfadeToken: ["crossfade:token:begin", "crossfade:token:end"],
    crossfadeSetup: ["crossfade:begin", "crossfade:animations:created"],
    morphGeometry: ["morph:geometry:begin", "morph:geometry:end"],
    morphScaleToken: ["morph:scale-token:begin", "morph:scale-token:end"],
    morphTokens: ["morph:tokens:begin", "morph:tokens:end"],
    morphSetup: ["morph:geometry:begin", "morph:animation:created"],
  };
  const phases = {};
  for (const [name, [beginName, endName]] of Object.entries(definitions)) {
    const start = selected[beginName];
    const end = selected[endName];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start < captureEnd) {
      failures.push(`invalid ${name} interval after snapshot`);
      continue;
    }
    phases[name] = { start, end, durationMs: end - start,
      overlapWithLongFramesMs: overlap(start, end) };
  }
  const firstLongFrame = longAnimationFrames.filter(frame => frame.startTime >= captureEnd)
    .sort((a, b) => a.startTime - b.startTime)[0];
  const repeatedPhases = {};
  for (const name of ["designer:session-init", "designer:derive-screen"]) {
    const starts = events.filter(event => event.name === `${name}:begin`);
    const ends = events.filter(event => event.name === `${name}:end`);
    if (starts.length !== transitionRenderCounts.designer || ends.length !== starts.length) {
      failures.push(`missing paired ${name} events for every transition render`);
    }
    repeatedPhases[name] = starts.map((start, index) => {
      const end = ends[index]?.at;
      if (!Number.isFinite(end) || end < start.at) {
        failures.push(`invalid paired ${name} interval ${index}`);
        return null;
      }
      return { start: start.at, end, durationMs: end - start.at,
        overlapWithLongFramesMs: overlap(start.at, end) };
    });
  }
  return {
    valid: failures.length === 0, failures, transitionRenderCounts, phases,
    repeatedPhases,
    stageSizeObservations: events.filter(event => event.name === "stage:size-observed"),
    firstLongFrameAfterCaptureMs: firstLongFrame ? firstLongFrame.startTime - captureEnd : null,
    lastMeasuredSyncEnd: Math.max(...Object.values(selected).filter(Number.isFinite),
      ...Object.values(repeatedPhases).flat().map(phase => phase?.end).filter(Number.isFinite)),
  };
}

module.exports = { getPostSnapshotSetupFailures, instrumentPostSnapshotSource, summarizePostSnapshotEvidence };
