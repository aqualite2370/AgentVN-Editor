"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");
const { createHash, randomUUID } = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { installPerformanceObservers, finishPerformanceObservation } = require("./lib/e2-performance-observers.cjs");
const { settle, read } = require("./advanced-layout-warm-workspace-geometry-playwright.cjs");
const { modes, transformOptionsModule, transformProductionStageRead, transformGlassInitialRead,
  transformProgressiveSections, transformDesignerGlassMount, hasFullSizeContainment } = require("./lib/e2-first-options-probes.cjs");
const { transformDesignerStaticGlass } = require("./lib/e2-first-options-probes.cjs");
const { transformHasBlurRules } = require("./lib/e2-first-options-probes.cjs");
const { installFirstOptionsDomReadProbe } = require("./lib/e2-first-options-dom-reads.cjs");
const { getWarmGeometryEquivalenceFailures } = require("./lib/advanced-layout-transition-activation.cjs");
const { installWorkspaceInertOwnershipProbe, inspectWorkspaceInertOwnership } =
  require("./lib/e2-workspace-inert-ownership.cjs");
const { attributeStyleInvalidations } = require("./lib/e2-style-subtree-attribution.cjs");
const { readLayoutStructure, compareLayoutStructure } = require("./lib/e2-layout-structure.cjs");
const { inspectFrameTrace } = require("./lib/e2-frame-task-attribution.cjs");
const { getSectionSelector, installSectionOmission, inspectSectionOmission } =
  require("./lib/e2-section-omission.cjs");
const paths = resolveAcceptancePaths();
const mode = process.env.AGENTVN_E2_OPTIONS_LAYOUT_CONTROL || "current";
assert(modes.includes(mode), "unsupported first Options counterfactual");
const production = process.env.AGENTVN_E2_OPTIONS_LAYOUT_PRODUCTION === "1";
const domReads = process.env.AGENTVN_E2_OPTIONS_DOM_READS === "1";
const assertMountReads = process.env.AGENTVN_E2_OPTIONS_ASSERT_MOUNT_READS === "1";
const assertPerformance = process.env.AGENTVN_E2_OPTIONS_ASSERT_PERFORMANCE === "1";
const cpuCounters = process.env.AGENTVN_E2_OPTIONS_CPU_COUNTERS === "1";
const styleTrace = process.env.AGENTVN_E2_OPTIONS_STYLE_TRACE === "1";
const nativeStyleTrace = process.env.AGENTVN_E2_OPTIONS_NATIVE_STYLE_TRACE === "1";
const traceInvalidations = process.env.AGENTVN_E2_OPTIONS_TRACE_INVALIDATIONS !== "0";
const fontTrace = process.env.AGENTVN_E2_OPTIONS_FONT_TRACE === "1";
const frameTaskTrace = process.env.AGENTVN_E2_OPTIONS_FRAME_TASK_TRACE === "1";
const nativeCpuTrace = process.env.AGENTVN_E2_OPTIONS_NATIVE_CPU_TRACE === "1";
const assertInertOwnership = process.env.AGENTVN_E2_OPTIONS_ASSERT_INERT_OWNERSHIP === "1";
const structureAttribution = process.env.AGENTVN_E2_OPTIONS_STRUCTURE === "1";
const controlAttribution = process.env.AGENTVN_E2_OPTIONS_CONTROLS === "1";
const platformFonts = process.env.AGENTVN_E2_OPTIONS_PLATFORM_FONTS === "1";
const omitLayoutSection = process.env.AGENTVN_E2_OPTIONS_OMIT_SECTION || "";
const omittedLayoutSections = ["header", "toolbar", "sidebar", "center", "inspector"];
assert(!assertMountReads || domReads && mode === "current", "mount regression requires current DOM attribution");
assert(!assertPerformance || !domReads && mode === "current",
  "performance gate requires unchanged current behavior and no DOM attribution");
assert(!domReads || ["current", "stage-initial-read-omitted", "glass-initial-read-observed"].includes(mode),
  "DOM attribution is restricted to current or the single stage-read counterfactual");
assert(!production || ["current", "prepatch-css", "canvas-blur-omitted", "stage-initial-read-omitted", "glass-initial-read-observed", "warm-size-contained", "warm-display-grid", "panel-layout-contained", "has-blur-rules-omitted", "layout-native-appearance-none", "layout-explicit-cjk-fallback", "layout-columns-flex", "layout-designer-static-glass", "layout-section-omitted"].includes(mode),
  "served-source probes are not supported against minified production code");
assert(!styleTrace || production && mode === "current" && !domReads && !assertPerformance,
  "bounded layout trace is production attribution only, not a performance gate");
assert(!nativeStyleTrace || styleTrace && !structureAttribution,
  "native style trace requires isolated attribution with no structure sampling");
assert(!fontTrace || nativeStyleTrace && !traceInvalidations,
  "font attribution requires native tracing without per-node invalidation overhead");
assert(!frameTaskTrace || styleTrace && !traceInvalidations && !fontTrace && !structureAttribution,
  "frame task attribution requires isolated tracing without per-node, font or structure probes");
assert(!nativeCpuTrace || frameTaskTrace,
  "native CPU sampling requires the owned frame task attribution trace");
assert(mode !== "has-blur-rules-omitted" || production,
  "blur selector counterfactual currently supports the exact production stylesheet only");
assert(!assertInertOwnership || mode === "current" && !domReads && !styleTrace && !assertPerformance,
  "inert ownership contract requires unchanged behavior and no timing acceptance");
assert(!structureAttribution || !assertPerformance && !domReads && !styleTrace,
  "computed structure inspection is separate attribution, never performance acceptance");
assert(mode !== "warm-display-grid" || structureAttribution,
  "warm display control requires structural geometry and ownership evidence");
assert(!controlAttribution || !assertPerformance && !styleTrace,
  "control geometry is separate attribution, never performance acceptance");
assert(!omitLayoutSection || mode === "layout-section-omitted",
  "layout section omission is restricted to its explicit diagnostic mode");
assert(mode !== "layout-section-omitted" && !omitLayoutSection
  || omittedLayoutSections.includes(omitLayoutSection),
  `layout section omission must be one of: ${omittedLayoutSections.join(", ")}`);
assert(mode !== "layout-designer-static-glass" || production,
  "static glass probe requires the exact production designer module");
assert(!omitLayoutSection || !structureAttribution && !controlAttribution && !platformFonts
  && !assertMountReads && !assertInertOwnership,
  "omitted section diagnosis cannot substitute for geometry, readiness or ownership acceptance");
assert(mode !== "layout-native-appearance-none" || controlAttribution,
  "native appearance control requires explicit control geometry evidence");
assert(mode !== "layout-explicit-cjk-fallback" || platformFonts,
  "explicit font fallback control requires actual rendered font evidence");
assert(mode !== "layout-columns-flex" || structureAttribution,
  "column layout control requires actual geometry and ownership evidence");
const prepatchCss = `
@media(min-width:1280px) and (min-height:720px) {
 body .advanced-tab-content.is-warm[data-tab="layout"] {
  width:var(--advanced-warm-layout-width,calc(100vw - var(--editor-shell-padding) - clamp(196px,10.5vw,252px) - var(--editor-gap) - 44px))!important;
  height:var(--advanced-warm-layout-height,calc(100dvh - var(--workspace-task-top,100px) - 118px))!important;
 }
}
body .toolbar-popover.workspace-task-panel.advanced.is-layout-mode {width:auto!important;overflow:auto}
`;
const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHashes = Object.fromEntries(["editor/src/styles/layout.css", "editor/src/styles/editor-responsive.css",
  "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"].map(file => [file, hash(path.join(__dirname, "..", file))]));
const report = { status: "RUNNING", productLayer: "Editor", performanceAcceptance: false,
  kind: "whole-options-entry-and-layout-navigation-diagnostic", mode, isolation: paths, sourceHashes,
  viewport: { width: 3840, height: 2160 }, dpr: 1, startedAt: new Date().toISOString(),
  buildMode: production ? "owned-production-preview" : "owned-source-development",
  domReadAttribution: domReads,
  cpuCounterAttribution: cpuCounters,
  boundedStyleTrace: styleTrace,
  nativeStyleTrace,
  traceInvalidations: styleTrace ? traceInvalidations : false,
  fontTrace,
  frameTaskTrace,
  nativeCpuTrace,
  requiredMountRegression: assertMountReads, requiredWholePerformance: assertPerformance,
  requiredInertOwnership: assertInertOwnership,
  structureAttribution,
  controlAttribution,
  platformFonts,
  omittedLayoutSection: omitLayoutSection || null,
  productionIndexHash: production ? hash(path.join(__dirname, "../editor/dist/index.html")) : null,
  owner: { pid: process.pid }, errors: [] };

async function main() {
  const env = await startEditorAcceptance(paths.output);
  report.server = { url: env.url, backendUrl: env.backendUrl, backendPid: env.backendPid,
    sourceOwner: { pid: env.server.pid, runId: env.server.runId } };
  let browser, context, preview, performanceCdp, closing = false;
  try {
    if (production) {
      const port = await new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", () => {
          const port = probe.address().port;
          probe.close(error => error ? reject(error) : resolve(port));
        });
      });
      const runId = randomUUID(), ownerPath = `/__agentvn_acceptance_owner/${runId}`;
      const editorRoot = path.join(__dirname, "../editor");
      const vite = await import(pathToFileURL(path.join(editorRoot, "node_modules/vite/dist/node/index.js")).href);
      preview = await vite.preview({ root: editorRoot, configFile: false,
        preview: { host: "127.0.0.1", port, strictPort: true, open: false },
        plugins: [{ name: "first-options-preview-owner", configurePreviewServer(server) {
          server.middlewares.use((request, response, next) => {
            if (request.url !== ownerPath) return next();
            response.setHeader("Content-Type", "application/json");
            response.end(JSON.stringify({ runId, pid: process.pid }));
          });
        } }],
      });
      report.server.productionUrl = `http://127.0.0.1:${port}`;
      report.server.previewOwner = { runId, pid: process.pid, port };
      const identity = await (await fetch(report.server.productionUrl + ownerPath)).json();
      assert.deepEqual(identity, { runId, pid: process.pid });
    }
    browser = await chromium.launch({ headless: false });
    context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
    if (production) await context.route("http://127.0.0.1:8278/**", async route => {
      try {
        const requestUrl = new URL(route.request().url());
        const response = await route.fetch({
          url: env.backendUrl + requestUrl.pathname + requestUrl.search, timeout: 10000,
        });
        await route.fulfill({ response });
      } catch (error) {
        (report.routeErrors ||= []).push({ duringCleanup: closing, error: String(error) });
        if (!closing) report.errors.push(`owned backend routing failed: ${error}`);
        await route.abort().catch(() => {});
      }
    });
    report.moduleProbe = { mode, applied: 0 };
    if (mode === "has-blur-rules-omitted") {
      const assets = path.join(__dirname, "../editor/dist/assets");
      const candidates = fs.readdirSync(assets).filter(file => file.endsWith(".css")
        && fs.readFileSync(path.join(assets, file), "utf8")
          .includes("body:has(.toolbar-popover.workspace-task-panel"));
      assert.equal(candidates.length, 1, "one production stylesheet must contain both blur :has rules");
      transformHasBlurRules(fs.readFileSync(path.join(assets, candidates[0]), "utf8"));
      await context.route(`**/assets/${candidates[0]}`, async route => {
        try {
          const response = await route.fetch();
          const transformed = transformHasBlurRules(await response.text());
          report.moduleProbe.applied += transformed.applied;
          report.moduleProbe.stylesheet = candidates[0];
          await route.fulfill({ response, body: transformed.source });
        } catch (error) {
          report.errors.push(`stylesheet probe failed: ${error.stack || error}`);
          await route.abort();
        }
      });
    }
    if (mode === "designer-glass-after-positive-size") {
      await context.route("**/src/components/common/GlassSelectionGroup.tsx*", async route => {
        try {
          const response = await route.fetch();
          const transformed = transformDesignerGlassMount(await response.text());
          report.moduleProbe.applied += transformed.applied;
          await route.fulfill({ response, body: transformed.source });
        } catch (error) {
          report.errors.push(`module probe failed: ${error.stack || error}`);
          await route.abort();
        }
      });
    }
    if (mode === "glass-initial-read-observed") {
      let pattern = "**/node_modules/.vite/deps/liquid-glass-react.js*";
      if (production) {
        const assets = path.join(__dirname, "../editor/dist/assets");
        const candidates = fs.readdirSync(assets).filter(file => file.startsWith("vendor-")
          && file.endsWith(".js") && fs.readFileSync(path.join(assets, file), "utf8")
            .includes("width:270,height:69"));
        assert.equal(candidates.length, 1, "exactly one production vendor contains LiquidGlass");
        transformGlassInitialRead(fs.readFileSync(path.join(assets, candidates[0]), "utf8"), true);
        pattern = `**/assets/${candidates[0]}`;
        report.moduleProbe.asset = candidates[0];
      }
      await context.route(pattern,
        async route => {
          try {
            const response = await route.fetch();
            const transformed = transformGlassInitialRead(await response.text(), production);
            report.moduleProbe.applied += transformed.applied;
            await route.fulfill({ response, body: transformed.source });
          } catch (error) {
            report.errors.push(`module probe failed: ${error.stack || error}`);
            await route.abort();
          }
        });
    }
    if (["initial-layout-unmounted", "batch-preloads-omitted", "stage-initial-read-omitted", "layout-after-entry", "preview-after-stage-size", "layout-progressive-sections", "layout-designer-static-glass"].includes(mode)) {
      const moduleName = ["stage-initial-read-omitted", "preview-after-stage-size", "layout-progressive-sections", "layout-designer-static-glass"].includes(mode)
        ? "RuntimeLayoutDesigner"
        : "AdvancedToolsPanel";
      const pattern = production ? "**/assets/RuntimeLayoutDesigner-*.js" : `**/src/components/advanced/${moduleName}.tsx*`;
      await context.route(pattern, async route => {
        try {
          const response = await route.fetch();
          const moduleSource = await response.text();
          const transformed = mode === "layout-progressive-sections" ? transformProgressiveSections(moduleSource)
            : mode === "layout-designer-static-glass" ? transformDesignerStaticGlass(moduleSource, production)
              : production ? transformProductionStageRead(moduleSource) : transformOptionsModule(moduleSource, mode);
          report.moduleProbe.applied += transformed.applied;
          await route.fulfill({ response, body: transformed.source });
        } catch (error) {
          report.errors.push(`module probe failed: ${error.stack || error}`);
          await route.abort();
        }
      });
    }
    const page = await context.newPage();
    const readCpuCounters = async () => {
      const values = (await performanceCdp.send("Performance.getMetrics")).metrics;
      const names = ["LayoutDuration", "RecalcStyleDuration", "ScriptDuration",
        "TaskDuration", "LayoutCount", "RecalcStyleCount", "Nodes"];
      return Object.fromEntries(names.map(name => {
        const metric = values.find(item => item.name === name);
        assert(metric && Number.isFinite(metric.value), `required performance counter missing: ${name}`);
        return [name, metric.value];
      }));
    };
    const styleTraceEvents = [];
    if (cpuCounters || styleTrace || platformFonts) {
      performanceCdp = await context.newCDPSession(page);
      if (cpuCounters) {
        await performanceCdp.send("Performance.enable");
        report.cpuCounters = {};
      }
    }
    page.on("pageerror", error => report.errors.push(String(error)));
    if (!production) await env.open(page);
    else {
      await env.server.assertAlive();
      assert(preview.httpServer.listening, "owned production preview must remain live");
      await page.goto(report.server.productionUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
        .some(node => node instanceof HTMLInputElement && !node.disabled), undefined, { timeout: 60_000 });
      await page.locator(".project-import-button input").first().setInputFiles(paths.input);
      await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60_000 });
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
    }
    if (mode === "prepatch-css") await page.addStyleTag({ content: prepatchCss });
    if (mode === "canvas-blur-omitted") await page.addStyleTag({ content:
      "body .editor-workspace .flow-surface {filter:none!important}" });
    if (mode === "warm-size-contained") await page.addStyleTag({ content:
      '.advanced-tab-content.is-warm[data-tab="layout"]{contain:size layout paint style!important}' });
    if (mode === "warm-display-grid") await page.addStyleTag({ content:
      '.advanced-tab-content.is-warm[data-tab="layout"]{display:grid!important}' });
    if (mode === "layout-native-appearance-none") await page.addStyleTag({ content:
      '.runtime-layout-designer input{appearance:none!important}' });
    if (mode === "layout-explicit-cjk-fallback") await page.addStyleTag({ content:
      '.runtime-layout-designer{font-family:Inter,"Segoe UI","Microsoft YaHei UI",system-ui,sans-serif!important}' });
    if (mode === "layout-columns-flex") await page.addStyleTag({ content: `
      .runtime-layout-designer .runtime-layout-grid{display:flex!important}
      .runtime-layout-designer .runtime-layout-grid>.runtime-layout-sidebar{flex:0 0 300px!important}
      .runtime-layout-designer .runtime-layout-grid>.runtime-layout-inspector{flex:0 0 340px!important}
      .runtime-layout-designer .runtime-layout-grid>.runtime-layout-center{flex:1 1 0!important;min-width:0!important}
    ` });
    if (mode === "layout-section-omitted") {
      await page.evaluate(installSectionOmission, getSectionSelector(omitLayoutSection));
    }
    if (mode === "panel-layout-contained") await page.addStyleTag({ content:
      '.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost){contain:layout style!important}' });
    await page.evaluate(traceEnabled => {
      const state = window.__advancedLayoutTransitionAudit = {
        start: performance.now(), running: true, longTasks: [], longAnimationFrames: [], frameGaps: [],
        lastFrame: performance.now(), interactionStart: null, layoutStart: null,
        traceEnabled,
      };
      document.addEventListener("pointerdown", event => {
        if (!event.isTrusted || !(event.target instanceof Element)) return;
        if (state.interactionStart == null && event.target.closest('[data-workspace-surface="options"]')) {
          state.interactionStart = performance.now();
          if (state.traceEnabled) console.timeStamp("agentvn-e2-first-options-style-start");
        }
        if (event.target.closest('[data-help-key="advanced.tab.layout"]'))
          state.layoutStart = performance.now();
      }, true);
      const frame = time => {
        if (!state.running) return;
        state.frameGaps.push({ startTime: state.lastFrame, duration: time - state.lastFrame });
        state.lastFrame = time;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, styleTrace);
    await page.evaluate(installPerformanceObservers);
    if (domReads) await page.evaluate(installFirstOptionsDomReadProbe);
    if (assertInertOwnership) await page.evaluate(installWorkspaceInertOwnershipProbe);
    if (cpuCounters) report.cpuCounters.beforeOptions = await readCpuCounters();
    if (styleTrace) {
      performanceCdp.on("Tracing.dataCollected", event => styleTraceEvents.push(...event.value));
      const extraCategories = nativeStyleTrace
        ? ["blink_style", "disabled-by-default-blink.debug.layout"] : [];
      if (fontTrace) extraCategories.push("fonts", "disabled-by-default-fonts");
      if (frameTaskTrace) extraCategories.push("toplevel", "renderer.scheduler", "cc", "viz");
      if (nativeCpuTrace) extraCategories.push("disabled-by-default-cpu_profiler");
      if (extraCategories.length) {
        const available = (await performanceCdp.send("Tracing.getCategories")).categories;
        assert(extraCategories.every(category => available.includes(category)),
          "native style trace categories must be available in this browser");
      }
      const categories = ["devtools.timeline",
        ...(traceInvalidations ? ["disabled-by-default-devtools.timeline.invalidationTracking"] : []),
        ...extraCategories];
      const traceSettings = nativeCpuTrace
        ? { traceConfig: { recordMode: "recordAsMuchAsPossible",
            includedCategories: categories, enableSampling: true } }
        : { categories: categories.join(","), options: "record-as-much-as-possible" };
      report.traceConfiguration = traceSettings;
      await performanceCdp.send("Tracing.start", traceSettings);
    }
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
    await settle(page, "settings");
    report.optionsSettled = await page.evaluate(inspectContainment => ({
      time: performance.now(),
      canvasFilter: getComputedStyle(document.querySelector(".flow-surface")).filter,
      hiddenLayoutPresent: Boolean(document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]')),
      resizeObserverSupported: typeof ResizeObserver === "function",
      warmContainment: (() => {
        if (!inspectContainment) return null;
        const node = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        return node ? getComputedStyle(node).contain : null;
      })(),
    }), mode === "warm-size-contained");
    if (mode === "layout-section-omitted") {
      await page.waitForFunction(() => document.querySelector(
        '.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-designer'),
      undefined, { timeout: 30_000 });
      report.sectionOmission = { warm: await page.evaluate(inspectSectionOmission, true) };
      assert.equal(report.sectionOmission.warm.display, "none", "omission must affect real target");
      assert.equal(report.sectionOmission.warm.restored, false);
    } else if (mode !== "initial-layout-unmounted") {
      await page.waitForFunction(() => document.querySelector(
        '.advanced-tab-content.is-warm[data-tab="layout"] [data-advanced-tab-ready="true"]'),
      undefined, { timeout: 30_000 });
    } else assert.equal(report.optionsSettled.hiddenLayoutPresent, false);
    report.hidden = await read(page, true);
    if (controlAttribution) {
      report.nativeControls = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll(".runtime-layout-designer input")];
        return nodes.map(node => ({
          type: node.type, appearance: getComputedStyle(node).appearance,
          helpKey: node.dataset.helpKey || null, componentId: node.dataset.componentId || null,
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
          checked: node.checked, disabled: node.disabled,
        }));
      });
      assert(report.nativeControls.length > 0, "native appearance counterfactual must affect real controls");
      if (mode === "layout-native-appearance-none") assert(report.nativeControls.every(node => node.appearance === "none"),
        "native appearance counterfactual must take effect on all targeted controls");
    }
    if (structureAttribution) report.warmStructure = await page.evaluate(readLayoutStructure, true);
    if (cpuCounters) report.cpuCounters.beforeLayout = await readCpuCounters();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await settle(page, "layout");
    const boundary = await page.evaluate(finishPerformanceObservation);
    if (assertInertOwnership) {
      report.inertOwnership = await page.evaluate(() => {
        const probe = window.__advancedLayoutTransitionAudit.inertOwnershipProbe;
        probe.cleanup();
        return { records: probe.records, restored: probe.restored,
          finalInert: document.querySelector(".editor-workspace-body")?.inert };
      });
      report.inertOwnership.analysis = inspectWorkspaceInertOwnership(report.inertOwnership.records);
    }
    if (styleTrace) {
      const tracingComplete = new Promise(resolve => performanceCdp.once("Tracing.tracingComplete", resolve));
      await performanceCdp.send("Tracing.end");
      await Promise.race([tracingComplete, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("bounded layout trace did not complete")), 5000);
        timer.unref();
      })]);
      const marker = styleTraceEvents.find(event => event.name === "TimeStamp"
        && event.args?.data?.message === "agentvn-e2-first-options-style-start");
      assert(marker, "trusted Options trace clock marker required");
      const durationMs = boundary.end - await page.evaluate(() => window.__advancedLayoutTransitionAudit.interactionStart);
      const endUs = marker.ts + durationMs * 1000;
      const inWindow = event => event.ts >= marker.ts && event.ts <= endUs;
      const layoutEvents = styleTraceEvents.filter(event => inWindow(event) && event.ph === "X"
        && ["Layout", "UpdateLayoutTree", "RecalculateStyles", "RecalcStyle", "PrePaint", "Paint"].includes(event.name));
      report.styleTrace = { performanceAcceptance: false, marker, durationMs,
        layoutEvents: layoutEvents.sort((a, b) => (b.dur || 0) - (a.dur || 0)),
        invalidations: styleTraceEvents.filter(event => inWindow(event) && event.name.includes("InvalidationTracking")) };
      if (nativeCpuTrace) {
        const samples = styleTraceEvents.filter(event => event.cat?.includes("cpu_profiler"));
        report.styleTrace.nativeCpu = {
          interpretation: "Owned Chromium native sample evidence only. Zero events or unsymbolized addresses do not prove native hotspots.",
          eventCount: samples.length,
          stackSampleCount: samples.filter(event => event.ph === "P").length,
          usableNativeHotspotEvidence: false,
          names: samples.reduce((counts, event) => {
            counts[event.name] = (counts[event.name] || 0) + 1;
            return counts;
          }, {}),
          examples: samples.slice(0, 12),
          rawTracePath: path.join(paths.output, "native-frame-trace.json"),
        };
        fs.writeFileSync(report.styleTrace.nativeCpu.rawTracePath,
          JSON.stringify({ traceEvents: styleTraceEvents }), "utf8");
      }
      if (nativeStyleTrace) {
        const nativeEvents = styleTraceEvents.filter(event => inWindow(event)
          && event.ph === "X" && event.cat.split(",").some(category =>
            category === "blink_style" || category === "disabled-by-default-blink.debug.layout"
            || fontTrace && (category === "fonts" || category === "disabled-by-default-fonts")));
        report.styleTrace.native = {
          interpretation: "Native nested slices are attribution only; durations overlap and must not be summed or used for performance acceptance.",
          eventCount: nativeEvents.length,
          names: nativeEvents.reduce((counts, event) => {
            counts[event.name] = (counts[event.name] || 0) + 1;
            return counts;
          }, {}),
          maximumDurationMs: nativeEvents.reduce((maximums, event) => {
            maximums[event.name] = Math.max(maximums[event.name] || 0, (event.dur || 0) / 1000);
            return maximums;
          }, {}),
          longestSlices: nativeEvents.sort((a, b) => (b.dur || 0) - (a.dur || 0)).slice(0, 60),
        };
      }
      // Expensive DOM traversal is strictly after performance observers and
      // tracing have stopped. It cannot contribute to the sampled interval.
      const { root: documentRoot } = await performanceCdp.send("DOM.getDocument", { depth: -1, pierce: true });
      report.styleTrace.subtreeAttribution = {
        interpretation: "Post-measurement ancestry and event counts, not per-subtree timing. Deleted or detached nodes remain unresolved.",
        whole: attributeStyleInvalidations(documentRoot, report.styleTrace.invalidations),
        largestLayouts: report.styleTrace.layoutEvents.filter(event => event.name === "Layout")
          .slice(0, 3).map(event => ({
            traceStartUs: event.ts, durationMs: event.dur / 1000,
            scope: "invalidations since the preceding Layout; counts do not apportion its duration",
            attribution: attributeStyleInvalidations(documentRoot, report.styleTrace.invalidations
              .filter(invalidation => {
                const previous = layoutEvents.filter(item => item.name === "Layout" && item.ts < event.ts)
                  .reduce((time, item) => Math.max(time, item.ts + (item.dur || 0)), marker.ts);
                return invalidation.ts >= previous && invalidation.ts <= event.ts + event.dur;
              })),
          })),
      };
    }
    if (cpuCounters) {
      report.cpuCounters.afterLayout = await readCpuCounters();
      report.cpuCounters.optionsDelta = Object.fromEntries(
        Object.keys(report.cpuCounters.beforeOptions).map(name => [name,
          report.cpuCounters.beforeLayout[name] - report.cpuCounters.beforeOptions[name]]));
      report.cpuCounters.wholeDelta = Object.fromEntries(
        Object.keys(report.cpuCounters.beforeOptions).map(name => [name,
          report.cpuCounters.afterLayout[name] - report.cpuCounters.beforeOptions[name]]));
      report.cpuCounters.interpretation = "Cumulative CDP counters include the complete entry and preparation; attribution only, not performance acceptance.";
    }
    if (domReads) report.domReads = await page.evaluate(() => {
      const probe = window.__advancedLayoutTransitionAudit.domReadProbe;
      probe.cleanup();
      return { records: probe.records, mountReads: probe.mountReads, restored: probe.restored };
    });
    report.measurement = await page.evaluate(boundary => {
      const state = window.__advancedLayoutTransitionAudit;
      state.observer?.disconnect();
      state.longAnimationFrameObserver?.disconnect();
      if (!state.interactionStart || !state.layoutStart) throw new Error("trusted entry boundaries missing");
      const summarize = (start, end) => {
        const overlap = entry => entry.startTime < end && entry.startTime + entry.duration > start;
        const frames = state.longAnimationFrames.filter(overlap), gaps = state.frameGaps.filter(overlap);
        return { start, end, durationMs: end - start, longAnimationFrames: frames,
          maxLoafMs: Math.max(0, ...frames.map(item => item.duration)),
          maxFrameGapMs: Math.max(0, ...gaps.map(item => item.duration)),
          frameCount: gaps.length, longTasks: state.longTasks.filter(overlap) };
      };
      return { supported: state.longAnimationFrameSupported, boundary,
        wholeSequence: summarize(state.interactionStart, boundary.end),
        optionsAndReadiness: summarize(state.interactionStart, state.layoutStart),
        layoutNavigation: summarize(state.layoutStart, boundary.end) };
    }, boundary);
    assert.equal(report.measurement.supported, true);
    assert(report.measurement.wholeSequence.frameCount > 0);
    if (frameTaskTrace) {
      report.frameTaskAttribution = inspectFrameTrace({
        events: styleTraceEvents, marker: report.styleTrace.marker,
        interactionStartMs: report.measurement.wholeSequence.start,
        frames: report.measurement.wholeSequence.longAnimationFrames,
      });
      assert(report.frameTaskAttribution.mainThreadEventCount > 0,
        "frame task evidence must include the trusted marker renderer thread");
    }
    if (mode === "has-blur-rules-omitted") assert.equal(report.moduleProbe.applied, 2);
    else if (mode === "layout-designer-static-glass") assert.equal(report.moduleProbe.applied, 2);
    else if (["initial-layout-unmounted", "batch-preloads-omitted", "stage-initial-read-omitted", "layout-after-entry", "glass-initial-read-observed", "preview-after-stage-size", "layout-progressive-sections", "designer-glass-after-positive-size"].includes(mode))
      assert.equal(report.moduleProbe.applied, 1, "exactly one served module changed");
    if (mode === "stage-initial-read-omitted") assert.equal(report.optionsSettled.resizeObserverSupported, true);
    if (mode === "canvas-blur-omitted") assert.equal(report.optionsSettled.canvasFilter, "none");
    report.active = await read(page, false);
    if (mode === "layout-section-omitted") {
      report.sectionOmission.active = await page.evaluate(inspectSectionOmission, false);
      assert.equal(report.sectionOmission.active.restored, true, "real navigation must restore target");
      assert.equal(report.sectionOmission.active.restores, 1);
      assert.notEqual(report.sectionOmission.active.display, "none");
      assert(report.sectionOmission.active.rect.width > 0 && report.sectionOmission.active.rect.height > 0,
        "navigation destination must naturally lay out the restored target");
      assert.equal(report.sectionOmission.active.childCount, report.sectionOmission.warm.childCount,
        "omission must not replace or remove target contents");
      report.sectionOmission.finalGeometryFailures = getWarmGeometryEquivalenceFailures({
        hidden: report.hidden.geometry, active: report.active.geometry,
      });
      await page.evaluate(() => window.__e2SectionOmission.cleanup());
    }
    if (platformFonts) {
      await performanceCdp.send("DOM.enable");
      await performanceCdp.send("CSS.enable");
      const { root: documentRoot } = await performanceCdp.send("DOM.getDocument", { depth: 0 });
      const selectors = [
        ".runtime-layout-header h3",
        ".runtime-layout-sidebar strong",
        ".runtime-layout-component-list button span",
        ".runtime-layout-inspector label",
        ".runtime-layout-stage button",
        ".runtime-layout-stage span",
      ];
      report.platformFonts = {
        interpretation: "Actual fonts of sampled live nodes, queried after measurement; not font timing attribution.",
        nodes: [],
      };
      for (const selector of selectors) {
        const { nodeIds } = await performanceCdp.send("DOM.querySelectorAll", {
          nodeId: documentRoot.nodeId, selector,
        });
        for (const nodeId of nodeIds.slice(0, 4)) {
          const { fonts } = await performanceCdp.send("CSS.getPlatformFontsForNode", { nodeId });
          report.platformFonts.nodes.push({ selector, nodeId, fonts });
        }
      }
      assert(report.platformFonts.nodes.some(node => node.fonts.some(font => font.glyphCount > 0)),
        "font evidence must include actual rendered glyphs");
    }
    if (structureAttribution) {
      report.activeStructure = await page.evaluate(readLayoutStructure, false);
      report.structureDifferences = compareLayoutStructure(report.warmStructure, report.activeStructure);
    }
    if (["warm-size-contained", "warm-display-grid", "panel-layout-contained", "layout-columns-flex"].includes(mode)) {
      if (mode === "warm-size-contained") assert(hasFullSizeContainment(report.optionsSettled.warmContainment));
      else if (mode === "warm-display-grid") {
        assert.equal(report.warmStructure?.content.styles.display, "grid");
        assert.equal(report.activeStructure?.content.styles.display, "grid");
        assert.deepEqual(report.structureDifferences.replaced, []);
        assert.deepEqual(report.structureDifferences.reparented, []);
      } else if (mode === "layout-columns-flex") {
        assert.equal(report.warmStructure?.grid.styles.display, "flex");
        assert.equal(report.activeStructure?.grid.styles.display, "flex");
        assert.deepEqual(report.structureDifferences.replaced, []);
        assert.deepEqual(report.structureDifferences.reparented, []);
      } else assert(report.active.panel && await page.evaluate(() => {
        const node = document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)");
        return getComputedStyle(node).contain === "layout style";
      }));
      report.geometryEquivalenceFailures = getWarmGeometryEquivalenceFailures({
        hidden: report.hidden.geometry, active: report.active.geometry,
      });
      assert.deepEqual(report.geometryEquivalenceFailures, [], "size containment must retain final geometry");
    }
    const cdp = await browser.newBrowserCDPSession();
    try {
      const info = await cdp.send("SystemInfo.getInfo");
      report.gpu = { featureStatus: info.gpu.featureStatus, commandLine: info.commandLine,
        renderer: info.gpu.auxAttributes?.glRenderer };
    } finally { await cdp.detach(); }
    assert(report.gpu.renderer?.includes("NVIDIA GeForce GTX 1050 Ti"));
    assert.equal(report.gpu.featureStatus.gpu_compositing, "enabled");
    assert.equal(report.gpu.featureStatus.rasterization, "enabled");
    assert.deepEqual(report.errors, [], "unexpected page error during actual Options entry");
    assert.deepEqual(Object.fromEntries(Object.keys(sourceHashes).map(file =>
      [file, hash(path.join(__dirname, "..", file))])), sourceHashes,
    "source changed during first Options verification");
    if (production) assert.equal(hash(path.join(__dirname, "../editor/dist/index.html")),
      report.productionIndexHash, "production build changed during verification");
    await page.screenshot({ path: path.join(paths.output, "active-layout.png") });
    report.performanceStatus = report.measurement.wholeSequence.maxLoafMs > 50
      ? "FAILED" : "NO_LOAF_OBSERVED_DIAGNOSTIC_ONLY";
    if (assertMountReads) {
      report.mountMeasurementStatus = report.domReads.mountReads.length ? "FAILED" : "PASS";
      assert.equal(report.domReads.mountReads.length, 0,
        "layout first mount must not force geometry or read motion tokens after attaching the unready tree");
    }
    if (assertInertOwnership) {
      assert.equal(report.inertOwnership.finalInert, true, "Options retains background input ownership");
      assert.deepEqual(report.inertOwnership.analysis.transientUnlocks, [],
        "loading-to-active handoff must not transiently unlock the same modal background");
      assert.deepEqual(report.inertOwnership.analysis.redundantWrites, [],
        "same ownership must not repeatedly invalidate background inert");
      report.inertOwnershipStatus = "PASS";
    }
    if (assertPerformance) assert(report.measurement.wholeSequence.maxLoafMs <= 50,
      "whole first Options entry, preparation and layout navigation exceed the 50ms LoAF gate");
    report.status = "DIAGNOSTIC_COMPLETED";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    closing = true;
    await performanceCdp?.detach().catch(() => {});
    await context?.unrouteAll({ behavior: "wait" }).catch(error => {
      (report.cleanupErrors ||= []).push(String(error));
      report.status = "FAILED";
      process.exitCode = 1;
    });
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await preview?.close();
    await env.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ status: report.status, performanceStatus: report.performanceStatus, mode,
      wholeMaxLoaf: report.measurement?.wholeSequence.maxLoafMs,
      optionsMaxLoaf: report.measurement?.optionsAndReadiness.maxLoafMs,
      layoutMaxLoaf: report.measurement?.layoutNavigation.maxLoafMs,
      error: report.error, reportPath: path.join(paths.output, "report.json") }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
