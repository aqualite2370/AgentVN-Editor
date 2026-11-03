function getActivationInput(value) {
  const input = value ?? "mouse-click";
  if (input !== "mouse-click" && input !== "keyboard-enter") {
    throw new Error(
      "AGENTVN_ADVANCED_PERF_ACTIVATION_INPUT must be mouse-click or keyboard-enter.",
    );
  }
  return input;
}

function getTransitionMode(reducedMotion) {
  return reducedMotion ? "reduced-motion" : "product-default";
}

function getPerformanceEntryMode(value) {
  const mode = value ?? "warm";
  if (mode === "warm" || mode === "cold") return mode;
  throw new Error("AGENTVN_ADVANCED_PERF_ENTRY_MODE must be warm or cold.");
}

function getPrewarmLayoutFromSettingsDiagnostic(value, {
  entryMode,
  targetTab,
  warmWideTab,
}) {
  if (value === undefined || value === "0") return false;
  if (value !== "1") {
    throw new Error("AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_FROM_SETTINGS must be 0 or 1.");
  }
  if (entryMode !== "cold") {
    throw new Error("Prewarming the layout target requires cold layout entry.");
  }
  if (targetTab !== "layout") {
    throw new Error("Prewarming the layout target requires AGENTVN_ADVANCED_PERF_TARGET_TAB=layout.");
  }
  if (warmWideTab) {
    throw new Error("Prewarming from settings cannot be combined with warm-wide control.");
  }
  return true;
}

function getPrewarmLayoutGeometryMode(value, prewarmFromSettings) {
  if (value === undefined || value === "0") return "compact";
  if (value !== "wide") {
    throw new Error("AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_GEOMETRY must be compact or wide.");
  }
  if (!prewarmFromSettings) {
    throw new Error("Wide warm geometry requires AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_FROM_SETTINGS=1.");
  }
  return "wide";
}

function getWarmLayerOpacityDiagnostic(value) {
  if (value === undefined || value === "0") return 0;
  if (value === "0.001") return 0.001;
  throw new Error("AGENTVN_ADVANCED_PERF_WARM_LAYER_OPACITY must be 0 or 0.001.");
}

function getTraceFromNavigationDiagnostic(value, {
  traceEnabled,
  layerTreeEnabled,
  entryMode,
  targetTab,
  preMountLayout,
}) {
  if (value === undefined || value === "0") return false;
  if (value !== "1") {
    throw new Error("AGENTVN_ADVANCED_PERF_TRACE_FROM_NAVIGATION must be 0 or 1.");
  }
  if (!traceEnabled) {
    throw new Error("Navigation-start trace requires AGENTVN_ADVANCED_PERF_TRACE=1.");
  }
  if (!layerTreeEnabled) {
    throw new Error("Navigation-start trace requires AGENTVN_ADVANCED_PERF_LAYER_TREE_TRACE_JOIN=1.");
  }
  if (entryMode !== "cold" || targetTab !== "layout" || !preMountLayout) {
    throw new Error(
      "Navigation-start trace requires cold initial layout pre-mount.",
    );
  }
  return true;
}

function retainLayoutMountedOnSettingsReturnDiagnostic(source) {
  const needle = "C(new Set([r]))";
  const matches = source.split(needle).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Prewarmed-layout diagnostic expected one exact match for tab mount cleanup; got ${matches}.`,
    );
  }
  return {
    source: source.replace(
      needle,
      'C(new Set(r==="settings"?["settings","layout"]:[r]))',
    ),
    matches,
  };
}

function preMountLayoutTabDiagnostic(source) {
  const needle = 'C]=n.useState(()=>new Set(["settings"]))';
  const matches = source.split(needle).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Pre-mounted-layout diagnostic expected one exact initial mounted-tabs initializer; got ${matches}.`,
    );
  }
  return {
    source: source.replace(
      needle,
      'C]=n.useState(()=>new Set(["settings","layout"]))',
    ),
    matches,
  };
}

function getHiddenWarmLayoutFailures({
  selectedTab,
  workspaceRectStable,
  warmLayerAriaHidden,
  warmLayerInert,
  warmLayerOpacity,
  warmLayerPointerEvents,
  activeElementInsideWarmLayer,
  designerReady,
  stageWidth,
  stageHeight,
  expectedWideStageWidth,
  expectedWideStageHeight,
  geometryTolerance = 2,
}) {
  const failures = [];
  if (selectedTab !== "settings") failures.push("Settings is not the active tab during hidden warm-up");
  if (!workspaceRectStable) failures.push("Settings workspace geometry changed while warming the hidden layout");
  if (!warmLayerAriaHidden) failures.push("Warm layout is not aria-hidden");
  if (!warmLayerInert) failures.push("Warm layout is not inert");
  if (!(Number.isFinite(warmLayerOpacity) && warmLayerOpacity <= 0.001)) {
    failures.push("Warm layout is visually exposed");
  }
  if (warmLayerPointerEvents !== "none") failures.push("Warm layout accepts pointer input");
  if (activeElementInsideWarmLayer) failures.push("Focus entered the hidden warm layout");
  if (!designerReady) failures.push("Warm layout designer is not ready");
  const dimensionsAreValid = [
    stageWidth,
    stageHeight,
    expectedWideStageWidth,
    expectedWideStageHeight,
    geometryTolerance,
  ].every(Number.isFinite)
    && stageWidth > 0
    && stageHeight > 0
    && expectedWideStageWidth > 0
    && expectedWideStageHeight > 0
    && geometryTolerance >= 0;
  if (!dimensionsAreValid
    || Math.abs(stageWidth - expectedWideStageWidth) > geometryTolerance
    || Math.abs(stageHeight - expectedWideStageHeight) > geometryTolerance) {
    failures.push("Warm layout stage has not reached the final wide geometry");
  }
  return failures;
}

function getWarmGeometryEquivalenceFailures({
  hidden,
  active,
  tolerancePx = 2,
  geometryKeys = ["content", "designer", "grid", "stageWrap", "stage"],
}) {
  const failures = [];
  if (!hidden || !active || !Array.isArray(geometryKeys) || !Number.isFinite(tolerancePx) || tolerancePx < 0) {
    return ["Warm/active layout geometry evidence is invalid"];
  }
  for (const key of geometryKeys) {
    const hiddenRect = hidden[key];
    const activeRect = active[key];
    if (!hiddenRect || !activeRect
      || !Number.isFinite(hiddenRect.width)
      || !Number.isFinite(hiddenRect.height)
      || !Number.isFinite(activeRect.width)
      || !Number.isFinite(activeRect.height)
      || Math.abs(hiddenRect.width - activeRect.width) > tolerancePx
      || Math.abs(hiddenRect.height - activeRect.height) > tolerancePx
      || (Number.isFinite(hiddenRect.scrollWidth)
        && Number.isFinite(activeRect.scrollWidth)
        && Math.abs(hiddenRect.scrollWidth - activeRect.scrollWidth) > tolerancePx)
      || (Number.isFinite(hiddenRect.scrollHeight)
        && Number.isFinite(activeRect.scrollHeight)
        && Math.abs(hiddenRect.scrollHeight - activeRect.scrollHeight) > tolerancePx)) {
      failures.push(`Active layout geometry differs from the hidden warm layer at ${key}`);
    }
  }
  return failures;
}

function getVisualEffectsMode(value) {
  if (value === undefined || value === "0") return "product-default";
  if (value === "1") return "backdrop-filters-disabled-diagnostic";
  if (value === "all-advanced") return "all-advanced-backdrop-filters-disabled-diagnostic";
  throw new Error("AGENTVN_ADVANCED_PERF_DISABLE_BACKDROP_FILTERS must be 0 or 1 or all-advanced.");
}

function getCanvasFilterMode(value) {
  if (value === undefined || value === "0") return "product-default";
  if (value === "1") return "canvas-filter-disabled-diagnostic";
  throw new Error("AGENTVN_ADVANCED_PERF_DISABLE_CANVAS_FILTER must be 0 or 1.");
}

function getLayoutStagePaintMode(value) {
  if (value === undefined || value === "0") return "product-default";
  if (value === "1") return "stage-paint-contained-diagnostic";
  if (value === "content") return "layout-content-paint-contained-diagnostic";
  throw new Error("AGENTVN_ADVANCED_PERF_CONTAIN_LAYOUT_STAGE_PAINT must be 0 or 1 or content.");
}

function layoutStagePaintOverrideCss(mode) {
  if (mode === "stage-paint-contained-diagnostic")
    return ".runtime-layout-stage { contain: paint !important; }";
  if (mode === "layout-content-paint-contained-diagnostic")
    return '.toolbar-popover.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content[data-tab="layout"] { contain: size layout paint style !important; }';
  return "";
}

function getLayoutCheckboxLayerMode(value) {
  if (value === undefined || value === "0") return "product-default";
  if (value === "1") return "layout-checkbox-2d-layer-diagnostic";
  throw new Error("AGENTVN_ADVANCED_PERF_LAYOUT_CHECKBOX_2D must be 0 or 1.");
}

function layoutCheckboxLayerOverrideCss(mode) {
  return mode === "layout-checkbox-2d-layer-diagnostic"
    ? '.runtime-layout-designer input[type="checkbox"]:not(:active) { transform: translate(0px, 0px) !important; }'
    : "";
}

function getStageGridMode(value) {
  if (value === undefined || value === "0") return "product-default";
  if (value === "1") return "stage-grid-disabled-diagnostic";
  throw new Error("AGENTVN_ADVANCED_PERF_DISABLE_STAGE_GRID must be 0 or 1.");
}

function stageGridOverrideCss(mode) {
  return mode === "stage-grid-disabled-diagnostic"
    ? ".runtime-layout-stage:after { display: none !important; }"
    : "";
}

function assertProductionPreviewForWideModeDiagnostic(
  enabled,
  productionPreviewEnabled,
) {
  if (enabled && !productionPreviewEnabled) {
    throw new Error(
      "The wide-mode-before-layout-mount diagnostic requires the editor/dist production preview.",
    );
  }
}

function reorderWideModeBeforeLayoutMountDiagnostic(source) {
  const mountOrderNeedle = "if(p(s),b(s),!await O(_,s))";
  const commitOrderNeedle = 'v(s),u(Z(s),!r.instant),L("crossfading")';
  const mountOrderMatches = source.split(mountOrderNeedle).length - 1;
  const commitOrderMatches = source.split(commitOrderNeedle).length - 1;
  if (mountOrderMatches !== 1 || commitOrderMatches !== 1) {
    throw new Error(
      `Early wide-mode diagnostic expected one exact match for each order marker; got mount=${mountOrderMatches}, commit=${commitOrderMatches}.`,
    );
  }
  return {
    source: source
      .replace(
        mountOrderNeedle,
        'u(Z(s),!r.instant);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));if(!document.querySelector(".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)")?.classList.contains("is-layout-mode"))throw new Error("Wide-mode diagnostic did not commit before target mount");if(p(s),b(s),!await O(_,s))',
      )
      .replace(commitOrderNeedle, 'v(s),L("crossfading")'),
    mountOrderMatches,
    commitOrderMatches,
  };
}

function visualEffectsOverrideCss(mode) {
  if (mode === "all-advanced-backdrop-filters-disabled-diagnostic") {
    // Diagnostic only. Include vendor children with inline backdrop filters,
    // but preserve the editor canvas blur and all presentation motion.
    return ".toolbar-popover.workspace-task-panel.advanced, .toolbar-popover.workspace-task-panel.advanced * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }";
  }
  return mode === "backdrop-filters-disabled-diagnostic"
    ? ".liquid-glass-adapter, .toolbar-popover.advanced { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }"
    : "";
}

function canvasFilterOverrideCss(mode) {
  return mode === "canvas-filter-disabled-diagnostic"
    ? ".editor-workspace-body .editor-workspace > .flow-surface { filter: none !important; }"
    : "";
}

function getLoafPerformanceFailures({
  targetTab,
  trials,
  thresholdMs = 50,
}) {
  if (!["layout", "theme"].includes(targetTab)) return [];
  const measuredTrials = trials.filter((trial) => trial.mode === "low-intrusion");
  if (measuredTrials.length === 0) return ["No low-intrusion trials executed"];
  return measuredTrials
    .flatMap((trial) => {
      if (trial.interactionWindow?.valid !== true) {
        return [`${trial.mode} repeat ${trial.repeat}: Missing trusted interaction timing window`];
      }
      if (!trial.longAnimationFrameSupported) {
        return [`${trial.mode} repeat ${trial.repeat}: Long Animation Frame API unavailable`];
      }
      if (!Number.isFinite(trial.maxLongAnimationFrameMs)) {
        return [`${trial.mode} repeat ${trial.repeat}: Invalid Long Animation Frame measurement`];
      }
      return trial.maxLongAnimationFrameMs > thresholdMs
        ? [`${trial.mode} repeat ${trial.repeat}: LoAF ${trial.maxLongAnimationFrameMs.toFixed(1)}ms > ${thresholdMs}ms`]
        : [];
    });
}

function getTargetReadinessFailures({ targetTab, trials }) {
  if (targetTab !== "theme") return [];
  const measured = trials.filter((trial) => trial.mode === "low-intrusion");
  if (!measured.length) return ["No low-intrusion readiness trials executed"];
  return measured.flatMap((trial) => {
    const snapshots = trial.targetReadiness?.filter((event) => event.event === "snapshot-captured") ?? [];
    if (!snapshots.length) return [`${trial.mode} repeat ${trial.repeat}: Missing theme geometry handoff observation`];
    return snapshots.some((event) => !event.targetMounted || event.targetFallback)
      ? [`${trial.mode} repeat ${trial.repeat}: Theme geometry handoff started before actual content was ready`]
      : [];
  });
}

async function activateLayoutTab({ input, locator, keyboard }) {
  if (input === "keyboard-enter") {
    await locator.focus();
    await keyboard.press("Enter");
    return;
  }
  if (input === "mouse-click") {
    await locator.click();
    return;
  }
  throw new Error(`Unsupported layout activation input: ${String(input)}`);
}

module.exports = {
  activateLayoutTab,
  getActivationInput,
  getPerformanceEntryMode,
  getPrewarmLayoutFromSettingsDiagnostic,
  getPrewarmLayoutGeometryMode,
  getWarmLayerOpacityDiagnostic,
  getTraceFromNavigationDiagnostic,
  retainLayoutMountedOnSettingsReturnDiagnostic,
  getHiddenWarmLayoutFailures,
  getWarmGeometryEquivalenceFailures,
  preMountLayoutTabDiagnostic,
  getTransitionMode,
  getVisualEffectsMode,
  getCanvasFilterMode,
  getLayoutStagePaintMode,
  layoutStagePaintOverrideCss,
  getLayoutCheckboxLayerMode,
  layoutCheckboxLayerOverrideCss,
  getStageGridMode,
  stageGridOverrideCss,
  assertProductionPreviewForWideModeDiagnostic,
  reorderWideModeBeforeLayoutMountDiagnostic,
  canvasFilterOverrideCss,
  getLoafPerformanceFailures,
  getTargetReadinessFailures,
  visualEffectsOverrideCss,
};
