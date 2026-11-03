const assert = require("node:assert/strict");
const {
  activateLayoutTab,
  getActivationInput,
  getPerformanceEntryMode,
  getPrewarmLayoutFromSettingsDiagnostic,
  getPrewarmLayoutGeometryMode,
  getWarmLayerOpacityDiagnostic,
  getTraceFromNavigationDiagnostic,
  retainLayoutMountedOnSettingsReturnDiagnostic,
  getHiddenWarmLayoutFailures,
  preMountLayoutTabDiagnostic,
  getWarmGeometryEquivalenceFailures,
  getTransitionMode,
  getVisualEffectsMode,
  getCanvasFilterMode,
  canvasFilterOverrideCss,
  getLayoutStagePaintMode,
  layoutStagePaintOverrideCss,
  getLayoutCheckboxLayerMode,
  layoutCheckboxLayerOverrideCss,
  getStageGridMode,
  stageGridOverrideCss,
  reorderWideModeBeforeLayoutMountDiagnostic,
  assertProductionPreviewForWideModeDiagnostic,
  getLoafPerformanceFailures,
  getTargetReadinessFailures,
  visualEffectsOverrideCss,
} = require("./lib/advanced-layout-transition-activation.cjs");

async function main() {
  assert.equal(getActivationInput(undefined), "mouse-click");
  assert.equal(getActivationInput("mouse-click"), "mouse-click");
  assert.equal(getActivationInput("keyboard-enter"), "keyboard-enter");
  assert.throws(() => getActivationInput("instant"), /mouse-click|keyboard-enter/);
  assert.equal(getPerformanceEntryMode(undefined), "warm");
  assert.equal(getPerformanceEntryMode("warm"), "warm");
  assert.equal(getPerformanceEntryMode("cold"), "cold");
  assert.throws(() => getPerformanceEntryMode("instant"), /must be warm or cold/);
  assert.equal(getPrewarmLayoutFromSettingsDiagnostic(undefined, {
    entryMode: "cold", targetTab: "layout", warmWideTab: false,
  }), false);
  assert.equal(getPrewarmLayoutFromSettingsDiagnostic("1", {
    entryMode: "cold", targetTab: "layout", warmWideTab: false,
  }), true);
  assert.throws(() => getPrewarmLayoutFromSettingsDiagnostic("1", {
    entryMode: "warm", targetTab: "layout", warmWideTab: false,
  }), /requires cold layout entry/);
  assert.throws(() => getPrewarmLayoutFromSettingsDiagnostic("1", {
    entryMode: "cold", targetTab: "theme", warmWideTab: false,
  }), /requires AGENTVN_ADVANCED_PERF_TARGET_TAB=layout/);
  assert.throws(() => getPrewarmLayoutFromSettingsDiagnostic("1", {
    entryMode: "cold", targetTab: "layout", warmWideTab: true,
  }), /cannot be combined with warm-wide control/);
  assert.throws(() => getPrewarmLayoutFromSettingsDiagnostic("2", {
    entryMode: "cold", targetTab: "layout", warmWideTab: false,
  }), /must be 0 or 1/);
  assert.equal(getPrewarmLayoutGeometryMode(undefined, false), "compact");
  assert.equal(getPrewarmLayoutGeometryMode("0", false), "compact");
  assert.equal(getPrewarmLayoutGeometryMode("wide", true), "wide");
  assert.throws(() => getPrewarmLayoutGeometryMode("wide", false), /requires AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_FROM_SETTINGS=1/);
  assert.throws(() => getPrewarmLayoutGeometryMode("compact", true), /must be compact or wide/);
  assert.equal(getWarmLayerOpacityDiagnostic(undefined), 0);
  assert.equal(getWarmLayerOpacityDiagnostic("0"), 0);
  assert.equal(getWarmLayerOpacityDiagnostic("0.001"), 0.001);
  assert.throws(() => getWarmLayerOpacityDiagnostic("0.01"), /must be 0 or 0.001/);
  assert.equal(getTraceFromNavigationDiagnostic(undefined, {
    traceEnabled: false, layerTreeEnabled: false, entryMode: "cold",
    targetTab: "layout", preMountLayout: true,
  }), false);
  assert.equal(getTraceFromNavigationDiagnostic("1", {
    traceEnabled: true, layerTreeEnabled: true, entryMode: "cold",
    targetTab: "layout", preMountLayout: true,
  }), true);
  assert.throws(() => getTraceFromNavigationDiagnostic("1", {
    traceEnabled: false, layerTreeEnabled: true, entryMode: "cold",
    targetTab: "layout", preMountLayout: true,
  }), /requires AGENTVN_ADVANCED_PERF_TRACE=1/);
  assert.throws(() => getTraceFromNavigationDiagnostic("1", {
    traceEnabled: true, layerTreeEnabled: false, entryMode: "cold",
    targetTab: "layout", preMountLayout: true,
  }), /requires AGENTVN_ADVANCED_PERF_LAYER_TREE_TRACE_JOIN=1/);
  assert.throws(() => getTraceFromNavigationDiagnostic("1", {
    traceEnabled: true, layerTreeEnabled: true, entryMode: "warm",
    targetTab: "layout", preMountLayout: true,
  }), /requires cold initial layout pre-mount/);
  const retainedLayout = retainLayoutMountedOnSettingsReturnDiagnostic(
    'C(new Set([r]))',
  );
  assert.equal(retainedLayout.source,
    'C(new Set(r==="settings"?["settings","layout"]:[r]))');
  assert.equal(retainedLayout.matches, 1);
  assert.throws(
    () => retainLayoutMountedOnSettingsReturnDiagnostic("no production mount cleanup"),
    /expected one exact match/,
  );
  assert.deepEqual(getHiddenWarmLayoutFailures({
    selectedTab: "settings",
    workspaceRectStable: true,
    warmLayerAriaHidden: true,
    warmLayerInert: true,
    warmLayerOpacity: 0,
    warmLayerPointerEvents: "none",
    activeElementInsideWarmLayer: false,
    designerReady: true,
    stageWidth: 2728,
    stageHeight: 1534,
    expectedWideStageWidth: 2728,
    expectedWideStageHeight: 1534,
  }), []);
  assert.deepEqual(getHiddenWarmLayoutFailures({
    selectedTab: "settings",
    workspaceRectStable: true,
    warmLayerAriaHidden: true,
    warmLayerInert: true,
    warmLayerOpacity: 0,
    warmLayerPointerEvents: "none",
    activeElementInsideWarmLayer: false,
    designerReady: true,
    stageWidth: 480,
    stageHeight: 269,
    expectedWideStageWidth: 2728,
    expectedWideStageHeight: 1534,
  }), ["Warm layout stage has not reached the final wide geometry"]);
  assert.deepEqual(getHiddenWarmLayoutFailures({
    selectedTab: "settings",
    workspaceRectStable: false,
    warmLayerAriaHidden: false,
    warmLayerInert: false,
    warmLayerOpacity: 0.4,
    warmLayerPointerEvents: "auto",
    activeElementInsideWarmLayer: true,
    designerReady: true,
    stageWidth: 2728,
    stageHeight: 1534,
    expectedWideStageWidth: 2728,
    expectedWideStageHeight: 1534,
  }), [
    "Settings workspace geometry changed while warming the hidden layout",
    "Warm layout is not aria-hidden",
    "Warm layout is not inert",
    "Warm layout is visually exposed",
    "Warm layout accepts pointer input",
    "Focus entered the hidden warm layout",
  ]);
  const initialWarmBundle = preMountLayoutTabDiagnostic(
    'const ce,C]=n.useState(()=>new Set(["settings"])),x=1',
  );
  assert.equal(
    initialWarmBundle.source,
    'const ce,C]=n.useState(()=>new Set(["settings","layout"])),x=1',
  );
  assert.equal(initialWarmBundle.matches, 1);
  assert.throws(
    () => preMountLayoutTabDiagnostic('const ce,C=n.useState(()=>new Set(["other"]))'),
    /expected one exact initial mounted-tabs initializer/,
  );
  const sameWarmGeometry = {
    content: { width: 3404, height: 1936 },
    designer: { width: 3404, height: 1840 },
    grid: { width: 3404, height: 1700 },
    stageWrap: { width: 2728, height: 1534 },
    stage: { width: 2726, height: 1532 },
  };
  assert.deepEqual(getWarmGeometryEquivalenceFailures({
    hidden: sameWarmGeometry,
    active: sameWarmGeometry,
    tolerancePx: 2,
  }), []);
  assert.deepEqual(getWarmGeometryEquivalenceFailures({
    hidden: sameWarmGeometry,
    active: {
      ...sameWarmGeometry,
      content: { width: 2958, height: 1925 },
    },
    tolerancePx: 2,
  }), ["Active layout geometry differs from the hidden warm layer at content"]);
  assert.equal(getTransitionMode(false), "product-default");
  assert.equal(getTransitionMode(true), "reduced-motion");
  assert.equal(getVisualEffectsMode(undefined), "product-default");
  assert.equal(getVisualEffectsMode("1"), "backdrop-filters-disabled-diagnostic");
  assert.equal(getVisualEffectsMode("0"), "product-default");
  assert.equal(getVisualEffectsMode("all-advanced"), "all-advanced-backdrop-filters-disabled-diagnostic");
  assert.throws(() => getVisualEffectsMode("2"), /must be 0 or 1/);
  assert.equal(getCanvasFilterMode(undefined), "product-default");
  assert.equal(getCanvasFilterMode("0"), "product-default");
  assert.equal(getCanvasFilterMode("1"), "canvas-filter-disabled-diagnostic");
  assert.throws(() => getCanvasFilterMode("2"), /must be 0 or 1/);
  const validWindow = { start: 10, end: 60, durationMs: 50, source: "trusted-pointerdown", valid: true };
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "layout",
    trials: [{ mode: "low-intrusion", repeat: 1, interactionWindow: validWindow,
      longAnimationFrameSupported: true, maxLongAnimationFrameMs: 50 }],
  }), []);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "theme",
    trials: [{ mode: "low-intrusion", repeat: 2, interactionWindow: validWindow,
      longAnimationFrameSupported: true, maxLongAnimationFrameMs: 50.1 }],
  }), ["low-intrusion repeat 2: LoAF 50.1ms > 50ms"]);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "layout",
    trials: [{ mode: "low-intrusion", repeat: 1, interactionWindow: validWindow,
      longAnimationFrameSupported: false, maxLongAnimationFrameMs: 0 }],
  }), ["low-intrusion repeat 1: Long Animation Frame API unavailable"]);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "providers",
    trials: [{ mode: "low-intrusion", repeat: 1, longAnimationFrameSupported: true, maxLongAnimationFrameMs: 70 }],
  }), []);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "layout",
    trials: [{ mode: "detailed", repeat: 1, longAnimationFrameSupported: true, maxLongAnimationFrameMs: 70 }],
  }), ["No low-intrusion trials executed"]);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "theme",
    trials: [{ mode: "low-intrusion", repeat: 1, interactionWindow: validWindow,
      longAnimationFrameSupported: true }],
  }), ["low-intrusion repeat 1: Invalid Long Animation Frame measurement"]);
  assert.deepEqual(getLoafPerformanceFailures({
    targetTab: "layout",
    trials: [{ mode: "low-intrusion", repeat: 1, longAnimationFrameSupported: true, maxLongAnimationFrameMs: 95 }],
  }), ["low-intrusion repeat 1: Missing trusted interaction timing window"]);
  assert.deepEqual(getTargetReadinessFailures({
    targetTab: "theme",
    trials: [{ mode: "low-intrusion", repeat: 1,
      targetReadiness: [{ event: "snapshot-captured", targetMounted: false, targetFallback: true }] }],
  }), ["low-intrusion repeat 1: Theme geometry handoff started before actual content was ready"]);
  assert.deepEqual(getTargetReadinessFailures({
    targetTab: "theme",
    trials: [{ mode: "low-intrusion", repeat: 1,
      targetReadiness: [{ event: "snapshot-captured", targetMounted: true, targetFallback: false }] }],
  }), []);
  assert.deepEqual(getTargetReadinessFailures({
    targetTab: "theme",
    trials: [{ mode: "low-intrusion", repeat: 1, targetReadiness: [] }],
  }), ["low-intrusion repeat 1: Missing theme geometry handoff observation"]);
  assert.equal(visualEffectsOverrideCss("product-default"), "");
  assert.match(
    visualEffectsOverrideCss("backdrop-filters-disabled-diagnostic"),
    /\.liquid-glass-adapter, \.toolbar-popover\.advanced \{ backdrop-filter: none !important; -webkit-backdrop-filter: none !important; \}/,
  );
  const nestedBackdropCss = visualEffectsOverrideCss("all-advanced-backdrop-filters-disabled-diagnostic");
  assert.match(nestedBackdropCss, /\.toolbar-popover\.workspace-task-panel\.advanced \*/);
  assert.match(nestedBackdropCss, /backdrop-filter: none !important/);
  assert.doesNotMatch(nestedBackdropCss, /transform|opacity|animation|transition|flow-surface/);
  assert.equal(canvasFilterOverrideCss("product-default"), "");
  const canvasFilterCss = canvasFilterOverrideCss("canvas-filter-disabled-diagnostic");
  assert.match(canvasFilterCss, /\.editor-workspace-body \.editor-workspace > \.flow-surface/);
  assert.match(canvasFilterCss, /filter: none !important/);
  assert.doesNotMatch(canvasFilterCss, /backdrop-filter|transform|opacity|animation|transition/);
  assert.equal(getLayoutStagePaintMode(undefined), "product-default");
  assert.equal(getLayoutStagePaintMode("0"), "product-default");
  assert.equal(getLayoutStagePaintMode("1"), "stage-paint-contained-diagnostic");
  assert.throws(() => getLayoutStagePaintMode("2"), /must be 0 or 1/);
  const stagePaintCss = layoutStagePaintOverrideCss("stage-paint-contained-diagnostic");
  assert.match(stagePaintCss, /\.runtime-layout-stage \{ contain: paint !important; \}/);
  assert.doesNotMatch(stagePaintCss, /visibility|display|content-visibility|transform|opacity|filter|animation/);
  assert.equal(getLayoutStagePaintMode("content"), "layout-content-paint-contained-diagnostic");
  const contentPaintCss = layoutStagePaintOverrideCss("layout-content-paint-contained-diagnostic");
  assert.match(contentPaintCss, /\.toolbar-popover\.advanced:not\(\.toolbar-popover-morph-ghost\)/);
  assert.match(contentPaintCss, /\.advanced-tab-content\[data-tab="layout"\]/);
  assert.match(contentPaintCss, /contain: size layout paint style !important/);
  assert.doesNotMatch(contentPaintCss, /visibility|display|content-visibility|transform|opacity|filter|animation|overflow|width|height/);
  assert.equal(layoutStagePaintOverrideCss("product-default"), "");
  assert.equal(getLayoutCheckboxLayerMode(undefined), "product-default");
  assert.equal(getLayoutCheckboxLayerMode("0"), "product-default");
  assert.equal(getLayoutCheckboxLayerMode("1"), "layout-checkbox-2d-layer-diagnostic");
  assert.throws(() => getLayoutCheckboxLayerMode("any"), /must be 0 or 1/);
  assert.equal(layoutCheckboxLayerOverrideCss("product-default"), "");
  const checkboxLayerCss = layoutCheckboxLayerOverrideCss("layout-checkbox-2d-layer-diagnostic");
  assert.match(checkboxLayerCss, /\.runtime-layout-designer input\[type="checkbox"\]:not\(:active\)/);
  assert.match(checkboxLayerCss, /transform: translate\(0px, 0px\) !important/);
  assert.doesNotMatch(checkboxLayerCss, /translateZ|animation|transition|opacity|display|filter|width|height|background|shadow/);
  assert.equal(getStageGridMode(undefined), "product-default");
  assert.equal(getStageGridMode("0"), "product-default");
  assert.equal(getStageGridMode("1"), "stage-grid-disabled-diagnostic");
  assert.throws(() => getStageGridMode("2"), /must be 0 or 1/);
  const stageGridCss = stageGridOverrideCss("stage-grid-disabled-diagnostic");
  assert.match(stageGridCss, /\.runtime-layout-stage:after \{ display: none !important; \}/);
  assert.doesNotMatch(stageGridCss, /visibility|contain|transform|opacity|filter|animation/);
  const reordered = reorderWideModeBeforeLayoutMountDiagnostic(
    'if(p(s),b(s),!await O(_,s))throw 0;v(s),u(Z(s),!r.instant),L("crossfading")',
  );
  assert.equal(
    reordered.source,
    'u(Z(s),!r.instant);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)")?.classList.contains("is-layout-mode"))throw new Error("Wide-mode diagnostic did not commit before target mount");if(p(s),b(s),!await O(_,s))throw 0;v(s),L("crossfading")',
  );
  assert.doesNotMatch(reordered.source, /_!==h\.current/);
  assert.equal(reordered.mountOrderMatches, 1);
  assert.equal(reordered.commitOrderMatches, 1);
  assert.throws(
    () => reorderWideModeBeforeLayoutMountDiagnostic('if(p(s),b(s),!await O(_,s))'),
    /expected one exact match/,
  );
  assert.doesNotThrow(() => assertProductionPreviewForWideModeDiagnostic(true, true));
  assert.doesNotThrow(() => assertProductionPreviewForWideModeDiagnostic(false, false));
  assert.throws(
    () => assertProductionPreviewForWideModeDiagnostic(true, false),
    /requires the editor\/dist production preview/,
  );

  const calls = [];
  const locator = {
    async click(options) {
      calls.push(["click", options]);
    },
    async focus() {
      calls.push(["focus"]);
    },
  };
  const keyboard = {
    async press(key) {
      calls.push(["press", key]);
    },
  };

  await activateLayoutTab({ input: "mouse-click", locator, keyboard });
  assert.deepEqual(calls, [["click", undefined]]);

  calls.length = 0;
  await activateLayoutTab({ input: "keyboard-enter", locator, keyboard });
  assert.deepEqual(calls, [["focus"], ["press", "Enter"]]);

  console.log("PASS advanced layout transition activation input contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
