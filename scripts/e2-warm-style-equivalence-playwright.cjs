"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { readState, comparePngBuffers, freezeSettledVisualAnimations, verifyPointerOwnership } =
  require("./advanced-layout-warm-opacity-equivalence-playwright.cjs");
const { installWarmDescendantStyleDiagnostic, installScopedRootMotionTokenCache, instrumentWarmStartOpacitySource,
  pruneHiddenSnapshotLayers } =
  require("./lib/e2-warm-descendant-style.cjs");
const { validateBrowserGpuProvenance } = require("./lib/advanced-layout-transition-performance.cjs");

const mode = process.env.AGENTVN_E2_PREPAINT_MODE || "style-only";
if (!["style-only", "style-opacity"].includes(mode)) throw new Error("Unsupported prepaint equivalence mode");
const ghostPruneEquivalence = process.env.AGENTVN_E2_GHOST_PRUNE_EQUIVALENCE === "1";
const zeroWarmStart = process.env.AGENTVN_E2_ZERO_WARM_START === "1";
const productMode = process.env.AGENTVN_E2_PRODUCT_MODE === "1";
if (productMode && (zeroWarmStart || mode !== "style-opacity" || !ghostPruneEquivalence))
  throw new Error("Product equivalence requires plain source, style-opacity expectations and snapshot comparison.");
const pruneStrategy = process.env.AGENTVN_E2_GHOST_PRUNE_STRATEGY || "root";
const replayInsertion = process.env.AGENTVN_E2_GHOST_REPLAY_INSERTION || "mutate-painted";
const localizeGhost = process.env.AGENTVN_E2_GHOST_LOCALIZE || "";
if (!["", "1", "groups"].includes(localizeGhost)) throw new Error("Unknown ghost localization mode");
if (!["mutate-painted", "prune-before-append"].includes(replayInsertion)) throw new Error("Unknown replay insertion");
if (replayInsertion !== "mutate-painted" && !ghostPruneEquivalence)
  throw new Error("Replay insertion probe requires ghost equivalence.");
if (!["root", "shell", "columns", "keep-inspector"].includes(pruneStrategy))
  throw new Error("Unknown ghost pruning strategy");
if (pruneStrategy !== "root" && !ghostPruneEquivalence) throw new Error("Shell probe requires ghost equivalence.");
if (zeroWarmStart && !ghostPruneEquivalence) throw new Error("Zero warm start requires ghost/cache equivalence.");
if (ghostPruneEquivalence && mode !== "style-opacity")
  throw new Error("Ghost prune equivalence requires the same style-opacity candidate basis.");
const visibleProperties = [
  "color", "backgroundColor", "backgroundImage", "fontFamily", "fontSize", "fontWeight", "lineHeight",
  "borderColor", "borderWidth", "borderRadius", "padding", "boxShadow", "textShadow",
  "filter", "backdropFilter", "display", "gridTemplateColumns", "gridTemplateRows",
];

async function visibleState(page, layout = false) {
  return page.evaluate(({ properties, layout }) => {
    const panel = document.querySelector(
      '.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden="true"]):not([inert])');
    const selectors = layout
      ? [".runtime-layout-designer", ".runtime-layout-grid", ".runtime-layout-stage",
        ".runtime-layout-expected-preview", ".runtime-layout-sidebar", ".runtime-layout-inspector"]
      : [".advanced-tools-panel", ".advanced-tools-panel>nav",
        '.advanced-tab-content.is-active[data-tab="settings"]', ".node-palette", ".react-flow", ".inspector-panel"];
    return Object.fromEntries(selectors.map(selector => {
      const node = selector.startsWith(".runtime-layout") ? panel?.querySelector(selector)
        : document.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error(`missing visible target: ${selector}`);
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return [selector, { rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        style: Object.fromEntries(properties.map(key => [key, style[key]])) }];
    }));
  }, { properties: visibleProperties, layout });
}

async function waitSettled(page) {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".advanced-tools-panel");
    const popover = document.querySelector(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
    const finite = [...(panel?.getAnimations({ subtree: true }) ?? []), ...(popover?.getAnimations() ?? [])]
      .filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    return panel?.classList.contains("is-tab-idle")
      && finite.every(animation => !animation.pending && animation.playState !== "running")
      && !document.querySelector(".toolbar-popover-morph-ghost");
  }, null, { timeout: 30_000 });
}

function installGhostPruneCapture({ strategy, productMode }) {
  const nativeAppend = Node.prototype.appendChild;
  const nativeAnimate = Element.prototype.animate;
  const nativeRemove = Element.prototype.remove;
  const captured = new WeakMap();
  const state = { snapshots: [], originals: [], animations: [] };
  const remove = function () {
    const ghost = this.closest(".toolbar-popover-morph-ghost");
    if (productMode && ghost && !ghost.isConnected && !ghost.hasAttribute("data-e2-ghost-replay")
      && !captured.has(ghost)) captured.set(ghost, ghost.cloneNode(true));
    return nativeRemove.call(this);
  };
  const append = function (node) {
    if (node instanceof HTMLElement && node.matches(".toolbar-popover-morph-ghost")
      && !node.hasAttribute("data-e2-ghost-replay")) {
      const original = productMode
        ? captured.get(node) ?? (node.hasAttribute("data-editor-snapshot-layout-pruned") ? null : node.cloneNode(true))
        : node.cloneNode(true);
      if (!(original instanceof HTMLElement)) throw new Error("missing actual pre-pruning snapshot");
      state.originals.push(original);
      const layers = productMode ? [...original.querySelectorAll(".advanced-tab-content[aria-hidden='true']")]
        .map(layer => {
          const after = node.querySelector(`.advanced-tab-content[data-tab="${layer.dataset.tab}"]`);
          const descendants = layer.querySelectorAll("*").length;
          return { tab: layer.dataset.tab, descendants,
            removedNodeCount: descendants - (after?.querySelectorAll("*").length ?? -1), strategy: "source-keep-inspector" };
        })
        : window.__e2PruneHiddenSnapshotLayers(node, strategy).layers;
      state.snapshots.push({ removed: layers,
        retainedActiveTabs: [...node.querySelectorAll(".advanced-tab-content.is-active")]
        .map(layer => layer.dataset.tab) });
    }
    return nativeAppend.call(this, node);
  };
  const animate = function (keyframes, timing) {
    const animation = nativeAnimate.call(this, keyframes, timing);
    if (this.matches(".toolbar-popover-morph-ghost,.toolbar-popover.advanced,.advanced-tab-content,.advanced-tools-panel")) {
      const record = { target: this.className, at: performance.now(), keyframes,
        timing: animation.effect.getTiming(), events: [] };
      state.animations.push(record);
      for (const name of ["finish", "cancel"])
        animation.addEventListener(name, () => record.events.push({ type: name, at: performance.now() }), { once: true });
    }
    return animation;
  };
  Node.prototype.appendChild = append;
  Element.prototype.animate = animate;
  if (productMode) Element.prototype.remove = remove;
  state.dispose = () => {
    if (Node.prototype.appendChild === append) Node.prototype.appendChild = nativeAppend;
    if (Element.prototype.animate === animate) Element.prototype.animate = nativeAnimate;
    if (Element.prototype.remove === remove) Element.prototype.remove = nativeRemove;
  };
  window.__e2GhostPruneCapture = state;
}

function installNaturalNavigationFrames() {
  const state = { frames: [], running: true, request: null };
  const rect = node => {
    const r = node?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  };
  const opacity = node => {
    if (!(node instanceof HTMLElement)) return 0;
    let value = 1;
    for (let current = node; current instanceof HTMLElement; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      value *= Number(style.opacity);
    }
    return value;
  };
  const tick = () => {
    if (!state.running) return;
    const panel = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    const ghost = document.querySelector(".toolbar-popover-morph-ghost");
    const layers = [...(panel?.querySelectorAll(".advanced-tab-content.is-active,.advanced-tab-content.is-leaving") ?? [])];
    state.frames.push({
      at: performance.now(), panel: rect(panel), ghost: rect(ghost), ghostOpacity: opacity(ghost),
      ghostOwnsInput: Boolean(ghost && (!ghost.inert || ghost.getAttribute("aria-hidden") !== "true"
        || getComputedStyle(ghost).pointerEvents !== "none")),
      layers: layers.map(node => ({ tab: node.dataset.tab, opacity: opacity(node),
        active: node.classList.contains("is-active"), inert: node.inert,
        pointerEvents: getComputedStyle(node).pointerEvents })),
      background: Object.fromEntries([".node-palette", ".react-flow", ".inspector-panel"]
        .map(selector => [selector, rect(document.querySelector(selector))])),
      ghostHasFocus: Boolean(ghost?.contains(document.activeElement)),
    });
    state.request = requestAnimationFrame(tick);
  };
  state.request = requestAnimationFrame(tick);
  state.stop = () => { state.running = false; cancelAnimationFrame(state.request); return state.frames; };
  window.__e2NaturalNavigationFrames = state;
}

function assertNaturalNavigationFrames(frames) {
  assert(frames.length > 3, "natural navigation must collect actual intermediate frames");
  assert(frames.filter(frame => frame.ghostOpacity > 0 && frame.ghostOpacity < 1).length > 2,
    "outgoing ghost must have a visible continuous fade");
  const background = frames[0].background;
  for (const frame of frames) {
    assert(!frame.ghostOwnsInput && !frame.ghostHasFocus, "snapshot must stay outside focus/input ownership");
    assert(frame.ghostOpacity > 0 || frame.layers.some(layer => layer.opacity > 0),
      "natural navigation must not have a blank content frame");
    assert(frame.layers.filter(layer => !layer.inert && layer.pointerEvents !== "none").length <= 1,
      "natural navigation must have at most one live input owner");
    assert.deepEqual(frame.background, background, "snapshot candidate moves the underlying workspace");
  }
}

async function compareCapturedGhostPixels(page, paths, report) {
  // Replay the actual outgoing DOM at fixed opacity poses against one stable
  // background. This isolates snapshot pixels; it is not a clock/perf test.
  const geometry = await visibleState(page, true);
  report.ghostPixelReplay = { kind: "captured-real-outgoing-ghost-pixels-only-not-natural-motion-acceptance",
    replayInsertion, poses: [] };
  await page.evaluate(() => {
    const state = window.__e2GhostPruneCapture;
    const ghost = state.originals[0];
    if (!(ghost instanceof HTMLElement)) throw new Error("missing actual outgoing ghost capture");
    ghost.setAttribute("data-e2-ghost-replay", "true");
    ghost.inert = true;
    ghost.setAttribute("aria-hidden", "true");
    window.__e2GhostPixelReplay = { ghost, removed: [] };
    document.body.appendChild(ghost);
  });
  try {
    await freezeSettledVisualAnimations(page);
    for (const opacity of [1, 0.5, 0.1]) {
      await page.evaluate(opacity => {
        const { ghost } = window.__e2GhostPixelReplay;
        ghost.style.setProperty("opacity", String(opacity), "important");
        for (const animation of ghost.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 0;
        }
      }, opacity);
      const filename = `ghost-opacity-${opacity}`;
      const baseline = await page.screenshot({ path: path.join(paths.output, `${filename}-original.png`), scale: "css" });
      const control = await page.screenshot({ path: path.join(paths.output, `${filename}-control.png`), scale: "css" });
      const controlDiff = await comparePngBuffers(page, baseline, control);
      assert.equal(controlDiff.pixelsOverOneLevel, 0, "ghost same-state screenshot control must be stable");
      const ghostBefore = await readGhostGeometry(page);
      if (opacity === 1 && localizeGhost) {
        report.ghostLocalizations = await localizeGhostPruning(page, paths, baseline, control);
      }
      const removed = await page.evaluate(({ strategy, replayInsertion }) => {
        const state = window.__e2GhostPixelReplay;
        if (replayInsertion === "prune-before-append") {
          // Match the actual append interception: prune an unpainted copy,
          // rather than invalidate the already composited baseline snapshot.
          state.original = state.ghost;
          state.ghost = state.original.cloneNode(true);
        }
        const hidden = [...(state.original ?? state.ghost)
          .querySelectorAll(".advanced-tab-content[aria-hidden='true']")];
        if (hidden.some(node => Number(getComputedStyle(node).opacity) !== 0))
          throw new Error("snapshot-only hidden layer incorrectly inherits live prepaint opacity");
        const result = window.__e2PruneHiddenSnapshotLayers(state.ghost, strategy);
        state.removed = result.records;
        if (replayInsertion === "prune-before-append") {
          state.original.remove();
          document.body.appendChild(state.ghost);
        }
        return result.layers;
      }, { strategy: pruneStrategy, replayInsertion });
      assert(removed.some(layer => layer.tab === "layout" && layer.descendants > 100),
        "must remove the captured hidden layout, not the visible outgoing page");
      await page.evaluate(() => {
        for (const animation of window.__e2GhostPixelReplay.ghost.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = 0;
        }
      });
      const candidate = await page.screenshot({ path: path.join(paths.output, `${filename}-pruned.png`), scale: "css" });
      const diff = await comparePngBuffers(page, baseline, candidate, control);
      const ghostAfter = await readGhostGeometry(page);
      report.ghostPixelReplay.poses.push({ opacity, controlDiff, diff, removed, ghostBefore, ghostAfter });
      assert.deepEqual(await visibleState(page, true), geometry, "ghost pruning changes actual live layout/workspace");
      await page.evaluate(() => {
        const state = window.__e2GhostPixelReplay;
        if (state.original) {
          state.ghost.remove();
          state.ghost = state.original;
          state.original = null;
          document.body.appendChild(state.ghost);
        } else {
          for (const { node, parent, next } of [...state.removed].reverse())
            parent.insertBefore(node, next?.parentNode === parent ? next : null);
        }
        state.removed = [];
      });
    }
  } finally {
    await page.evaluate(() => {
      window.__e2GhostPixelReplay?.ghost.remove();
      delete window.__e2GhostPixelReplay;
    });
  }
  assert.equal(report.ghostPixelReplay.poses.filter(pose => pose.diff.pixelsExceedingControlEnvelope > 0).length,
    0, "hidden ghost pruning changes captured outgoing pixels");
}

async function localizeGhostPruning(page, paths, baseline, control) {
  const results = [];
  const selectors = localizeGhost === "groups" ? [
    "fresh-unpruned-copy",
    ".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-inspector",
    ".runtime-layout-header,.runtime-layout-sidebar,.runtime-layout-center",
    ".runtime-layout-header,.runtime-layout-inspector,.runtime-layout-center",
    ".runtime-layout-sidebar,.runtime-layout-inspector,.runtime-layout-center",
  ] : [
    "fresh-unpruned-copy", ".runtime-layout-header", ".runtime-layout-sidebar",
    ".runtime-layout-inspector", ".runtime-layout-expected-preview", ".runtime-layout-stage",
    ".runtime-layout-center", ".runtime-layout-grid",
  ];
  for (const [index, selector] of selectors.entries()) {
    const evidence = await page.evaluate(selector => {
      const state = window.__e2GhostPixelReplay;
      const candidate = state.ghost.cloneNode(true);
      const hidden = candidate.querySelector(".advanced-tab-content[aria-hidden='true'][data-tab='layout']");
      if (!(hidden instanceof HTMLElement)) throw new Error("localization requires actual hidden layout");
      const targets = selector === "fresh-unpruned-copy" ? [] : [...hidden.querySelectorAll(selector)];
      if (selector !== "fresh-unpruned-copy" && targets.length !== selector.split(",").length)
        throw new Error(`missing localization subtree: ${selector}`);
      const count = targets.reduce((sum, target) => sum + target.querySelectorAll("*").length + 1, 0);
      targets.forEach(target => target.remove());
      state.localizationOriginal = state.ghost;
      state.ghost.remove();
      state.ghost = candidate;
      document.body.appendChild(candidate);
      for (const animation of candidate.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 0;
      }
      return { selector, removedNodeCount: count };
    }, selector);
    const screenshot = await page.screenshot({ path: path.join(paths.output, `localize-${index}.png`), scale: "css" });
    const diff = await comparePngBuffers(page, baseline, screenshot, control);
    results.push({ ...evidence, diff, ghostGeometry: await readGhostGeometry(page) });
    await page.evaluate(() => {
      const state = window.__e2GhostPixelReplay;
      state.ghost.remove();
      state.ghost = state.localizationOriginal;
      delete state.localizationOriginal;
      document.body.appendChild(state.ghost);
      for (const animation of state.ghost.getAnimations({ subtree: true })) {
        animation.pause();
        animation.currentTime = 0;
      }
    });
  }
  return results;
}

async function readGhostGeometry(page) {
  return page.evaluate(() => {
    const ghost = window.__e2GhostPixelReplay.ghost;
    const selectors = [":scope", ".advanced-tools-panel", "nav", ".advanced-tab-viewport",
      '.advanced-tab-content.is-active[data-tab="settings"]',
      '.advanced-tab-content.is-active[data-tab="settings"]>.advanced-tab-scroll'];
    return Object.fromEntries(selectors.map(selector => {
      const node = selector === ":scope" ? ghost : ghost.querySelector(selector);
      if (!(node instanceof HTMLElement)) throw new Error(`missing ghost geometry: ${selector}`);
      const r = node.getBoundingClientRect(), style = getComputedStyle(node);
      return [selector, { rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        opacity: style.opacity, backdropFilter: style.backdropFilter, filter: style.filter,
        transform: style.transform, overflow: style.overflow, willChange: style.willChange }];
    }));
  });
}

async function main() {
  const paths = resolveAcceptancePaths();
  fs.mkdirSync(paths.output, { recursive: true });
  const report = {
    status: "RUNNING", kind: "warm-style-prepaint-equivalence-not-performance-or-installed-acceptance",
    productLayer: "Editor", project: paths.input, projectId: paths.fixtureProjectId,
    viewport: { width: 3840, height: 2160 }, dpr: 1, mode,
    viewportMode: "headful CSS viewport simulation, not physical 4K", ghostPruneEquivalence, zeroWarmStart,
    pruneStrategy, replayInsertion, localizeGhost, productMode,
    failures: [], tests: [],
  };
  let env, browser;
  const fail = (condition, reason) => { if (!condition) report.failures.push(reason); };
  try {
    env = await startEditorAcceptance(paths.output);
    report.owner = { pid: env.server.pid, runId: env.server.runId, url: env.server.url };
    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
    const cdp = await browser.newBrowserCDPSession();
    const gpu = await cdp.send("SystemInfo.getInfo");
    await cdp.detach();
    report.gpu = { features: gpu.gpu?.featureStatus, renderer: gpu.gpu?.auxAttributes?.glRenderer,
      implementation: gpu.gpu?.auxAttributes?.glImplementationParts };
    const runtime = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return { userAgent: navigator.userAgent,
        webglRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
    });
    report.gpuProvenance = validateBrowserGpuProvenance({
      browserMode: "headful-visible", ...runtime,
    }, "NVIDIA GeForce GTX 1050 Ti");
    assert.equal(report.gpuProvenance.ok, true, JSON.stringify(report.gpuProvenance));
    assert.equal(report.gpu.features?.rasterization, "enabled");
    assert.equal(report.gpu.features?.gpu_compositing, "enabled");
    await env.server.run(async () => {
      if (zeroWarmStart) {
        await page.route(/\/src\/components\/advanced\/AdvancedToolsPanel\.tsx(?:\?.*)?$/, async route => {
          const response = await route.fetch();
          const original = await response.text();
          const patch = instrumentWarmStartOpacitySource(original);
          report.warmStartPatch = { valid: patch.valid, matches: patch.matches, url: route.request().url(),
            originalSha256: createHash("sha256").update(original).digest("hex"),
            modifiedSha256: createHash("sha256").update(patch.source).digest("hex"),
            kind: "response-only-warm-hidden-start-zero-not-product-delivery" };
          await route.fulfill({ response, body: patch.source });
        });
      }
      await env.open(page);
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await page.waitForFunction(() => {
        const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        return warm?.querySelector(".runtime-layout-designer")?.getAttribute("data-advanced-tab-ready") === "true"
          && warm.querySelector(".runtime-layout-stage")?.clientWidth > 2000;
      }, null, { timeout: 60_000 });
      await waitSettled(page);
      const focus = page.locator('[data-help-key="advanced.tab.settings"]:visible').first();
      await focus.focus();
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => !document.querySelector(".hover-help-card"), null, { timeout: 30_000 });
      report.pausedAnimations = await freezeSettledVisualAnimations(page);
      report.before = await readState(page);
      report.visibleBefore = await visibleState(page);
      const snap = filename => page.screenshot({ path: path.join(paths.output, filename), scale: "css" });
      const baseline = await snap("settings-baseline.png");
      const control = await snap("settings-control.png");
      report.controlDiff = await comparePngBuffers(page, baseline, control);
      if (report.controlDiff.pixelsOverOneLevel) {
        report.invalidBaseline = true;
        throw new Error("same-state control screenshots are unstable");
      }
      report.styleEvidence = productMode
        ? { kind: "ordinary-product-source-no-style-injection" }
        : await page.evaluate(installWarmDescendantStyleDiagnostic, { prepaint: mode === "style-opacity" });
      report.after = await readState(page);
      report.visibleAfter = await visibleState(page);
      report.pixelDiffs = [];
      for (let index = 0; index < 3; index++) {
        const candidate = await snap(`settings-candidate-${index + 1}.png`);
        report.pixelDiffs.push(await comparePngBuffers(page, baseline, candidate, control));
      }
      fail(report.pixelDiffs.every(diff => diff.pixelsExceedingControlEnvelope === 0),
        "candidate exceeds the unchanged one-level same-state pixel noise allowance");
      fail(JSON.stringify(report.visibleBefore) === JSON.stringify(report.visibleAfter),
        "candidate changes visible settings/workspace geometry or materials");
      fail(report.before.activeElementPath === report.after.activeElementPath, "candidate steals active focus");
      fail(report.after.inert && report.after.ariaHidden && report.after.pointerEvents === "none"
        && report.after.opacity === (mode === "style-opacity" ? 0.001 : 0),
        "hidden candidate loses ownership/opacity constraints");
      report.tests.push({ name: "settings-full-viewport-equivalence", status: report.failures.length ? "FAILED" : "PASS" });

      const pointer = await verifyPointerOwnership(page);
      assert.equal(pointer.ok, true, JSON.stringify(pointer));
      await page.mouse.click(pointer.target.x, pointer.target.y);
      report.pointer = await page.evaluate(() => {
        const probe = window.__e2WarmOpacityPointerProbe;
        const counts = { ...probe.clicks };
        probe.layout.removeEventListener("pointerdown", probe.onWarm, true);
        probe.activeViewport?.removeEventListener("pointerdown", probe.onSettings, true);
        delete window.__e2WarmOpacityPointerProbe;
        return counts;
      });
      fail(report.pointer.warm === 0 && report.pointer.settings === 1, "hidden candidate intercepts settings input");
      report.focus = await page.evaluate(() => {
        const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const current = document.activeElement;
        warm?.querySelector("button")?.focus();
        return { entered: warm?.contains(document.activeElement), unchanged: current === document.activeElement };
      });
      fail(!report.focus.entered && report.focus.unchanged, "hidden candidate accepts keyboard focus");
      report.tests.push({ name: "settings-input-and-focus-ownership", status:
        report.pointer.warm === 0 && report.pointer.settings === 1 && !report.focus.entered && report.focus.unchanged
          ? "PASS" : "FAILED" });

      if (ghostPruneEquivalence) {
        await page.evaluate(() => { window.__advancedLayoutTransitionAudit = { running: true }; });
        if (!productMode) report.tokenCacheSetup = await page.evaluate(installScopedRootMotionTokenCache);
        await page.evaluate(`window.__e2PruneHiddenSnapshotLayers = (${pruneHiddenSnapshotLayers.toString()})`);
        await page.evaluate(installGhostPruneCapture, { strategy: pruneStrategy, productMode });
      }
      if (ghostPruneEquivalence) await page.evaluate(installNaturalNavigationFrames);
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
      await waitSettled(page);
      if (ghostPruneEquivalence) {
        report.naturalNavigationFrames = await page.evaluate(() => window.__e2NaturalNavigationFrames.stop());
        assertNaturalNavigationFrames(report.naturalNavigationFrames);
        report.tests.push({ name: "natural-cold-navigation-intermediate-frames-and-ownership", status: "PASS" });
      }
      await page.mouse.move(0, 0);
      await page.waitForFunction(() => !document.querySelector(".hover-help-card"), null, { timeout: 30_000 });
      await freezeSettledVisualAnimations(page);
      if (ghostPruneEquivalence) {
        report.firstGhostCapture = await page.evaluate(() => ({
          snapshots: window.__e2GhostPruneCapture.snapshots,
          animations: window.__e2GhostPruneCapture.animations,
        }));
        assert.equal(report.firstGhostCapture.snapshots.length, 1, "real layout click must create one geometry snapshot");
        if (zeroWarmStart) assert.equal(report.warmStartPatch?.valid, true);
        assert(report.firstGhostCapture.snapshots[0].retainedActiveTabs.includes("settings"));
        assert(report.firstGhostCapture.snapshots[0].removed.some(layer => layer.tab === "layout"));
        await compareCapturedGhostPixels(page, paths, report);
        if (!productMode) {
          report.tokenCacheResult = await page.evaluate(() => {
            window.__advancedLayoutTransitionAudit.running = false;
            return window.__e2ScopedMotionTokenCache.finish();
          });
          assert.equal(report.tokenCacheResult.stable, true);
          assert(report.tokenCacheResult.intercepted["--ease-editor-crossfade"] > 0);
          assert(report.tokenCacheResult.intercepted["--ease-ui-in-out"] > 0);
        }
        report.tests.push({ name: "captured-outgoing-ghost-pixel-and-live-geometry-equivalence", status: "PASS" });
      }
      report.activeWithCandidate = await visibleState(page, true);
      const activeBaseline = await snap("layout-with-hidden-style.png");
      const activeControl = await snap("layout-control.png");
      report.activeControlDiff = await comparePngBuffers(page, activeBaseline, activeControl);
      assert.equal(report.activeControlDiff.pixelsOverOneLevel, 0, "active layout comparison baseline must be stable");
      await page.evaluate(() => document.querySelector('style[data-e2-warm-descendant-style]')?.remove());
      report.activeWithoutCandidate = await visibleState(page, true);
      const activeWithout = await snap("layout-original-style.png");
      report.activePixelDiff = await comparePngBuffers(page, activeBaseline, activeWithout, activeControl);
      fail(JSON.stringify(report.activeWithCandidate) === JSON.stringify(report.activeWithoutCandidate)
        && report.activePixelDiff.pixelsExceedingControlEnvelope === 0,
        "hidden-only style rules alter active layout pixels/materials/geometry");
      const layer = page.locator('.advanced-tab-content.is-active[data-tab="layout"]:not([inert])');
      assert.equal(await layer.count(), 1);
      // Test actual authoring controls after the handoff, not just presence.
      await layer.locator('[data-help-key="layout.screen"]').filter({ hasText: "标题" }).first().click();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-designer")
        ?.getAttribute("data-active-screen") === "title");
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
      await waitSettled(page);
      assert.equal(await page.locator('.advanced-tab-content.is-active[data-tab="settings"]:not([inert])').count(), 1);
      if (ghostPruneEquivalence) {
        report.ghostCapture = await page.evaluate(() => {
          const state = window.__e2GhostPruneCapture;
          state.dispose();
          return { snapshots: state.snapshots, animations: state.animations };
        });
        assert(report.ghostCapture.snapshots.length >= 2, "must exercise real return navigation with pruning enabled");
      }
      report.tests.push({ name: "real-layout-handoff-authoring-and-return", status: "PASS" });
      assert.deepEqual(report.failures, [], JSON.stringify(report.failures));
      report.status = "PASS";
    });
  } catch (error) {
    report.status = report.invalidBaseline ? "BLOCKED" : "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    await env?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`${report.status}: ${path.join(paths.output, "report.json")}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
