const fs = require("fs");
const path = require("path");
const net = require("node:net");
const { performance: nodePerformance } = require("node:perf_hooks");
const { randomUUID, createHash } = require("node:crypto");
const { spawn, execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { installPerformanceObservers, finishPerformanceObservation } = require("./lib/e2-performance-observers.cjs");
const { installMeasurementVisibilityTracking, getMeasurementVisibilityFailures } =
  require("./lib/e2-measurement-visibility.cjs");
const {
  getPostSnapshotSetupFailures,
  instrumentPostSnapshotSource,
  summarizePostSnapshotEvidence,
} = require("./lib/e2-post-snapshot-timing.cjs");
const {
  getRasterBackendDiagnostic,
  validateRasterBackendEvidence,
  extractBrowserSwitches,
} = require("./lib/e2-raster-backend-diagnostic.cjs");
const { getAngleBackendDiagnostic, validateAngleBackendEvidence } =
  require("./lib/e2-angle-backend-diagnostic.cjs");
const {
  getShaderCacheEvidenceEnabled, validateShaderCacheLaunch,
  captureShaderCacheSnapshot, summarizeShaderCacheDelta,
  getShaderTraceEnabled, getShaderAttributionTraceMode, getShaderAttributionControl,
  summarizeShaderTrace,
  getShaderDriverTraceArgs,
} = require("./lib/e2-shader-cache-evidence.cjs");
const {
  getPersistentBrowserProfileDiagnostic,
  getPersistentBrowserProfileState,
} = require("./lib/e2-persistent-browser-profile.cjs");
const {
  getHoverHelpAttributionMode,
  summarizeHoverHelpTimeline,
} = require("./lib/e2-hover-help-attribution.cjs");
const { installWarmDescendantStyleDiagnostic, getWarmDescendantStyleDiagnostic, getWarmDescendantPrepaintMode,
  getWarmDescendantReadAttribution, installScopedRootMotionTokenCache, instrumentWarmStartOpacitySource,
  pruneHiddenSnapshotLayers } =
  require("./lib/e2-warm-descendant-style.cjs");
const {
  getWarmTopLayerSetupFailures,
  installWarmTopLayerDiagnostic,
  summarizeWarmTopLayerEvidence,
  getWarmTopLayerOpacity,
  getWarmTopLayerRestoreMode,
  settleWarmTopLayerRestoration,
} = require("./lib/e2-warm-top-layer.cjs");
const {
  activateLayoutTab,
  getActivationInput,
  getLoafPerformanceFailures,
  getTargetReadinessFailures,
  getPerformanceEntryMode,
  getPrewarmLayoutFromSettingsDiagnostic,
  getPrewarmLayoutGeometryMode,
  getWarmLayerOpacityDiagnostic,
  getTraceFromNavigationDiagnostic,
  retainLayoutMountedOnSettingsReturnDiagnostic,
  preMountLayoutTabDiagnostic,
  getHiddenWarmLayoutFailures,
  getWarmGeometryEquivalenceFailures,
  getTransitionMode,
  getVisualEffectsMode,
  getCanvasFilterMode,
  getLayoutStagePaintMode,
  getStageGridMode,
  stageGridOverrideCss,
  assertProductionPreviewForWideModeDiagnostic,
  reorderWideModeBeforeLayoutMountDiagnostic,
  canvasFilterOverrideCss,
  layoutStagePaintOverrideCss,
  getLayoutCheckboxLayerMode,
  layoutCheckboxLayerOverrideCss,
  visualEffectsOverrideCss,
} = require("./lib/advanced-layout-transition-activation.cjs");
const {
  alignTraceClock,
  alignMonotonicClocks,
  mapBrowserMonotonicToEpochMs,
  selectPreparationClockAnchors,
  filterEntriesByTimeWindow,
  matchGpuRasterTasksToSourceTiles,
  matchRasterTasksToLayerSnapshots,
  summarizeLayerIdentityContinuity,
  summarizeFramePhases,
  summarizeLongAnimationFrame,
  summarizeLayerTree,
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
  getAnimationStartDelayDiagnostic,
  getAnimationStartDelaySetupFailures,
  getGlassAnimationTimelineSetupFailures,
  getGenericCompositorWarmupSetupFailures,
  getStagePromotionSetupFailures,
  summarizeStagePromotionEvidence,
  getLayoutStageWillChangeSetupFailures,
  summarizeLayoutStageWillChangeEvidence,
  getLayoutLayerTreeTimelineSetupFailures,
  summarizeLayoutLayerTreeTimeline,
  getEtwTriggerGateSetupFailures,
  getLayoutHealthStateFailures,
  getWarmLayoutReadinessFailures,
  getSourceWarmOpacitySetupFailures,
  getSourceWarmOpacityStateFailures,
  getSyncPhaseProbeSetupFailures,
  summarizeSyncPhaseProbeEvidence,
  instrumentPopoverSnapshotSource,
} = require("./lib/advanced-layout-transition-performance.cjs");

const ROOT = path.resolve(__dirname, "..");
let EDITOR_URL;
let persistentBrowserContext = null;
const acceptancePaths = resolveAcceptancePaths();
const OUT_DIR = acceptancePaths.output;
const TEST_PROJECT_PATH = acceptancePaths.input;
const REPORT_PATH = path.join(OUT_DIR, "advanced-layout-transition-audit.json");
const PERFORMANCE_DIAGNOSTIC_PATH = path.join(OUT_DIR, "performance-diagnostic-only.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const ENFORCE_PERFORMANCE = process.env.AGENTVN_ENFORCE_ADVANCED_PERF === "1";
const PERFORMANCE_DIAGNOSTIC_ONLY = process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC === "1";
const REQUIRE_HARDWARE_GPU_PROVENANCE = process.env.AGENTVN_ADVANCED_PERF_REQUIRE_HARDWARE_GPU === "1";
const SYNC_PHASE_TIMING_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_SYNC_PHASE_TIMING === "1";
const POST_SNAPSHOT_TIMING_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_POST_SNAPSHOT_TIMING === "1";
const FREEZE_STAGE_SIZE_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_FREEZE_STAGE_SIZE === "1";
if (FREEZE_STAGE_SIZE_DIAGNOSTIC && !POST_SNAPSHOT_TIMING_DIAGNOSTIC) {
  throw new Error("Stage-state suppression requires the post-snapshot attribution probe.");
}
const EXPECTED_GPU_RENDERER = process.env.AGENTVN_ADVANCED_PERF_EXPECTED_GPU || "NVIDIA GeForce GTX 1050 Ti";
const ENFORCE_LOW_INTRUSION_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_ASSERT === "1";
const ENFORCE_LAYOUT_LOAF_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_ENFORCE_LOAF === "1";
const ENFORCE_THEME_READINESS_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_ENFORCE_THEME_READINESS === "1";
const REACT_COMMIT_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_REACT_COMMITS === "1";
const REACT_FIBER_CAPTURE_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_REACT_FIBER_CAPTURE === "1";
const LAYER_TREE_TRACE_JOIN_DIAGNOSTIC = process.env.AGENTVN_ADVANCED_PERF_LAYER_TREE_TRACE_JOIN === "1";
const LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_LAYOUT_LAYER_TREE_TIMELINE === "1";
const LAYOUT_LOAF_THRESHOLD_MS = 50;
const ACTIVATION_INPUT = getActivationInput(process.env.AGENTVN_ADVANCED_PERF_ACTIVATION_INPUT);
const PERFORMANCE_ENTRY_MODE = getPerformanceEntryMode(process.env.AGENTVN_ADVANCED_PERF_ENTRY_MODE);
const WAIT_FOR_WARM_LAYOUT_READY = process.env.AGENTVN_ADVANCED_PERF_WAIT_WARM_LAYOUT_READY === "1";
const VISUAL_EFFECTS_MODE = getVisualEffectsMode(process.env.AGENTVN_ADVANCED_PERF_DISABLE_BACKDROP_FILTERS);
const CANVAS_FILTER_MODE = getCanvasFilterMode(process.env.AGENTVN_ADVANCED_PERF_DISABLE_CANVAS_FILTER);
const SHELL_BACKGROUND_FILTER_MODE =
  process.env.AGENTVN_ADVANCED_PERF_DISABLE_SHELL_BACKGROUND_FILTER === "1"
    ? "shell-background-filter-disabled-diagnostic"
    : "product-default";
const LAYOUT_STAGE_PAINT_MODE = getLayoutStagePaintMode(
  process.env.AGENTVN_ADVANCED_PERF_CONTAIN_LAYOUT_STAGE_PAINT,
);
const LAYOUT_CHECKBOX_LAYER_MODE = getLayoutCheckboxLayerMode(
  process.env.AGENTVN_ADVANCED_PERF_LAYOUT_CHECKBOX_2D,
);
if (LAYOUT_CHECKBOX_LAYER_MODE !== "product-default" && LAYOUT_STAGE_PAINT_MODE !== "product-default")
  throw new Error("Checkbox-layer and content-paint diagnostics must run as separate single-variable trials.");
const STAGE_GRID_MODE = getStageGridMode(
  process.env.AGENTVN_ADVANCED_PERF_DISABLE_STAGE_GRID,
);
const REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT =
  process.env.AGENTVN_ADVANCED_PERF_WIDE_MODE_BEFORE_LAYOUT_MOUNT === "1";
assertProductionPreviewForWideModeDiagnostic(
  REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT,
  process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
);
if (REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT
  && process.env.AGENTVN_ADVANCED_PERF_FIRST_MOUNT_OBSERVERS !== "1") {
  throw new Error(
    "Wide-mode-before-layout-mount diagnostics require AGENTVN_ADVANCED_PERF_FIRST_MOUNT_OBSERVERS=1 to verify the stage geometry change.",
  );
}
const PERFORMANCE_TARGET_TAB = process.env.AGENTVN_ADVANCED_PERF_TARGET_TAB || "layout";
if (!["layout", "theme", "providers"].includes(PERFORMANCE_TARGET_TAB)) {
  throw new Error("AGENTVN_ADVANCED_PERF_TARGET_TAB must be layout, theme, or providers.");
}
const shaderEvidenceScope = {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY, isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
    productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
    cold: PERFORMANCE_ENTRY_MODE === "cold", target: PERFORMANCE_TARGET_TAB,
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT,
    dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    lowIntrusion: ENFORCE_LOW_INTRUSION_DIAGNOSTIC,
    trace: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    profiler: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1",
    presentationChanged: VISUAL_EFFECTS_MODE !== "product-default"
      || CANVAS_FILTER_MODE !== "product-default"
      || SHELL_BACKGROUND_FILTER_MODE !== "product-default"
      || LAYOUT_STAGE_PAINT_MODE !== "product-default"
      || LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
      || STAGE_GRID_MODE !== "product-default"
      || REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT
      || Object.entries(process.env).some(([key, value]) =>
        key.startsWith("AGENTVN_ADVANCED_PERF_") && value === "1"
        && /PREWARM|PREMOUNT|PRE_MOUNT|WARM_TARGET|HIDE_|SUPPRESS_|FREEZE_|CONTAIN_|PROMOT|WILL_CHANGE/.test(key)),
  };
const hoverHelpAttributionMode = getHoverHelpAttributionMode(
  process.env.AGENTVN_ADVANCED_PERF_HOVER_HELP,
  {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY,
    isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
    productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
    cold: PERFORMANCE_ENTRY_MODE === "cold",
    target: PERFORMANCE_TARGET_TAB,
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT,
    dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    lowIntrusion: ENFORCE_LOW_INTRUSION_DIAGNOSTIC,
    trace: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE_RENDERER === "1",
    profiler: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1",
  },
);
const SHADER_ATTRIBUTION_MODE = getShaderAttributionTraceMode(
  process.env.AGENTVN_ADVANCED_PERF_SHADER_ATTRIBUTION,
  {
    ...shaderEvidenceScope,
    trace: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    rendererTrace: process.env.AGENTVN_ADVANCED_PERF_TRACE_RENDERER === "1",
    control: process.env.AGENTVN_ADVANCED_PERF_SHADER_ATTRIBUTION_CONTROL,
    controlCount: process.env.AGENTVN_ADVANCED_PERF_SHADER_ATTRIBUTION === "1" ? 1 : 0,
  },
);
const SHADER_CACHE_EVIDENCE_ENABLED = getShaderCacheEvidenceEnabled(
  process.env.AGENTVN_ADVANCED_PERF_SHADER_CACHE_EVIDENCE, shaderEvidenceScope,
);
const SHADER_TRACE_ENABLED = SHADER_ATTRIBUTION_MODE.enabled || getShaderTraceEnabled(
  process.env.AGENTVN_ADVANCED_PERF_TRACE_SKIA_SHADERS,
  { ...shaderEvidenceScope,
    rendererTrace: process.env.AGENTVN_ADVANCED_PERF_TRACE_RENDERER === "1",
    reusePair: process.env.AGENTVN_ADVANCED_PERF_SHADER_REUSE_PAIR === "1",
  },
);
const SHADER_TRACE_REUSE_PAIR = process.env.AGENTVN_ADVANCED_PERF_SHADER_REUSE_PAIR === "1";
if (SHADER_TRACE_REUSE_PAIR && !SHADER_TRACE_ENABLED)
  throw new Error("Shared GPU-cache reuse pair requires the bounded shader trace diagnostic.");
const SHADER_DRIVER_TRACE_ARGS = getShaderDriverTraceArgs(
  process.env.AGENTVN_ADVANCED_PERF_TRACE_GL_DRIVER, SHADER_TRACE_ENABLED,
);
const PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC = getPersistentBrowserProfileDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_PERSISTENT_PROFILE,
  {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY,
    isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
    productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
    cold: PERFORMANCE_ENTRY_MODE === "cold",
    target: PERFORMANCE_TARGET_TAB,
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT,
    dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    lowIntrusion: ENFORCE_LOW_INTRUSION_DIAGNOSTIC,
    trace: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE_RENDERER === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE_SKIA_SHADERS === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE_GL_DRIVER === "1",
    profiler: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1",
    presentationChanged: shaderEvidenceScope.presentationChanged
      || SHADER_TRACE_ENABLED
      || SHADER_CACHE_EVIDENCE_ENABLED
      || SHADER_ATTRIBUTION_MODE.enabled
      || hoverHelpAttributionMode.enabled,
    phase: process.env.AGENTVN_ADVANCED_PERF_PERSISTENT_PROFILE_PHASE,
    profileDirectory: process.env.AGENTVN_ADVANCED_PERF_PROFILE_DIR,
    outputRoot: path.join(ROOT, "output", "playwright"),
  },
);
const syncPhaseProbeSetupFailures = getSyncPhaseProbeSetupFailures({
  enabled: SYNC_PHASE_TIMING_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  currentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
  reactCommitProbeEnabled: REACT_COMMIT_DIAGNOSTIC,
  profilerEnabled: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1",
  singleLowIntrusionTrial: ENFORCE_LOW_INTRUSION_DIAGNOSTIC
    && process.env.AGENTVN_ADVANCED_PERF_PROFILE !== "1",
  diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY,
  isolatedProject: acceptancePaths.isolated,
  diagnosticRepeats: Number.parseInt(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || "3", 10),
  width: process.env.AGENTVN_AUDIT_VIEWPORT === "4k" ? 3840 : 0,
  height: process.env.AGENTVN_AUDIT_VIEWPORT === "4k" ? 2160 : 0,
  dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
  headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
});
if (syncPhaseProbeSetupFailures.length > 0) {
  throw new Error(`Synchronous phase timing diagnostic rejected: ${syncPhaseProbeSetupFailures.join("; ")}`);
}
const postSnapshotSetupFailures = getPostSnapshotSetupFailures({
  enabled: POST_SNAPSHOT_TIMING_DIAGNOSTIC,
  baseProbeEnabled: SYNC_PHASE_TIMING_DIAGNOSTIC,
  traceEnabled: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
  profilerEnabled: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1",
  cold: PERFORMANCE_ENTRY_MODE === "cold",
  source: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  viewport: process.env.AGENTVN_AUDIT_VIEWPORT,
  dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
  headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
  hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
  isolated: acceptancePaths.isolated,
  repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
  reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
});
if (postSnapshotSetupFailures.length) {
  throw new Error(`Post-snapshot timing diagnostic rejected: ${postSnapshotSetupFailures.join("; ")}`);
}
const RASTER_BACKEND_DIAGNOSTIC = getRasterBackendDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_RASTER_BACKEND, {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY,
    isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
    cold: PERFORMANCE_ENTRY_MODE === "cold",
    currentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT,
    dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    singleTrial: ENFORCE_LOW_INTRUSION_DIAGNOSTIC,
    target: PERFORMANCE_TARGET_TAB,
    injection: SYNC_PHASE_TIMING_DIAGNOSTIC || POST_SNAPSHOT_TIMING_DIAGNOSTIC
      || REACT_COMMIT_DIAGNOSTIC || FREEZE_STAGE_SIZE_DIAGNOSTIC,
    profiling: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
  });
const angleConfigurationKeys = new Set([
  "ANGLE_BACKEND", "DIAGNOSTIC", "DIAGNOSTIC_ASSERT", "DIAGNOSTIC_REPEATS",
  "ENTRY_MODE", "TARGET_TAB", "REQUIRE_HARDWARE_GPU", "EXPECTED_GPU", "ENFORCE_LOAF",
].map(key => `AGENTVN_ADVANCED_PERF_${key}`));
const ANGLE_BACKEND_DIAGNOSTIC = getAngleBackendDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_ANGLE_BACKEND, {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY, isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE, cold: PERFORMANCE_ENTRY_MODE === "cold",
    currentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT, dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    singleTrial: ENFORCE_LOW_INTRUSION_DIAGNOSTIC, target: PERFORMANCE_TARGET_TAB,
    profiling: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
    otherInterventions: Object.entries(process.env).some(([key, value]) =>
      key.startsWith("AGENTVN_ADVANCED_PERF_") && value && value !== "0" && !angleConfigurationKeys.has(key)),
  });
const warmStyleConfigurationKeys = new Set([...angleConfigurationKeys]
  .filter(key => !key.endsWith("ANGLE_BACKEND")));
warmStyleConfigurationKeys.add("AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_STYLE");
warmStyleConfigurationKeys.add("AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_PREPAINT");
const WARM_DESCENDANT_READ_ATTRIBUTION = getWarmDescendantReadAttribution(
  process.env.AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_ATTRIBUTION, {
    warmStyleEnabled: process.env.AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_STYLE === "1",
    prepaintMode: process.env.AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_PREPAINT,
    slowDomReads: process.env.AGENTVN_ADVANCED_PERF_SLOW_DOM_READS === "1",
    pruneHiddenSnapshot: process.env.AGENTVN_ADVANCED_PERF_PRUNE_HIDDEN_SNAPSHOT === "1",
  });
if (WARM_DESCENDANT_READ_ATTRIBUTION.enabled) {
  warmStyleConfigurationKeys.add("AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_ATTRIBUTION");
  if (WARM_DESCENDANT_READ_ATTRIBUTION.mode.endsWith("slow-dom-read"))
    warmStyleConfigurationKeys.add("AGENTVN_ADVANCED_PERF_SLOW_DOM_READS");
  if (WARM_DESCENDANT_READ_ATTRIBUTION.mode.startsWith("cache-pruned-"))
    warmStyleConfigurationKeys.add("AGENTVN_ADVANCED_PERF_PRUNE_HIDDEN_SNAPSHOT");
}
const WARM_ROOT_TOKEN_CACHE_ENABLED = ["root-token-cache", "cached-slow-dom-read", "cache-pruned-snapshot",
  "cache-pruned-zero-warm-start", "cache-pruned-inspector-zero-warm-start"]
  .includes(WARM_DESCENDANT_READ_ATTRIBUTION.mode);
const WARM_DESCENDANT_STYLE_DIAGNOSTIC = getWarmDescendantStyleDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_STYLE === "1", {
    diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY, isolated: acceptancePaths.isolated,
    headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
    hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE, cold: PERFORMANCE_ENTRY_MODE === "cold",
    currentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
    viewport: process.env.AGENTVN_AUDIT_VIEWPORT, dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
    singleTrial: ENFORCE_LOW_INTRUSION_DIAGNOSTIC, target: PERFORMANCE_TARGET_TAB,
    profiling: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
      || process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
    otherInterventions: Object.entries(process.env).some(([key, value]) =>
      key.startsWith("AGENTVN_ADVANCED_PERF_") && value && value !== "0"
      && !warmStyleConfigurationKeys.has(key)),
  });
const WARM_DESCENDANT_PREPAINT_MODE = getWarmDescendantPrepaintMode(
  process.env.AGENTVN_ADVANCED_PERF_WARM_DESCENDANT_PREPAINT, WARM_DESCENDANT_STYLE_DIAGNOSTIC.enabled);
const WARM_TOP_LAYER_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER === "1";
const WARM_TOP_LAYER_OPACITY = getWarmTopLayerOpacity(process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER_OPACITY);
const WARM_TOP_LAYER_RESTORE_MODE = getWarmTopLayerRestoreMode(process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER_RESTORE);
if ((process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER_OPACITY
  || process.env.AGENTVN_ADVANCED_PERF_WARM_TOP_LAYER_RESTORE) && !WARM_TOP_LAYER_DIAGNOSTIC)
  throw new Error("Top-layer opacity/restoration selection requires its diagnostic.");
const warmTopLayerSetupFailures = getWarmTopLayerSetupFailures({
  enabled: WARM_TOP_LAYER_DIAGNOSTIC, diagnosticOnly: PERFORMANCE_DIAGNOSTIC_ONLY,
  isolated: acceptancePaths.isolated,
  source: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  cold: PERFORMANCE_ENTRY_MODE === "cold", target: PERFORMANCE_TARGET_TAB,
  viewport: process.env.AGENTVN_AUDIT_VIEWPORT, dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
  headful: process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1",
  hardwareGpu: REQUIRE_HARDWARE_GPU_PROVENANCE,
  repeats: Number(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || 3),
  singleTrial: ENFORCE_LOW_INTRUSION_DIAGNOSTIC,
  reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
  injection: SYNC_PHASE_TIMING_DIAGNOSTIC || POST_SNAPSHOT_TIMING_DIAGNOSTIC
    || REACT_COMMIT_DIAGNOSTIC || FREEZE_STAGE_SIZE_DIAGNOSTIC || RASTER_BACKEND_DIAGNOSTIC.enabled,
  profiling: process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
    || process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
});
if (warmTopLayerSetupFailures.length) throw new Error(warmTopLayerSetupFailures.join("; "));
const GLASS_ANIMATION_TIMELINE_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_GLASS_ANIMATION_TIMELINE === "1";
const GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_GLASS_STYLE_WRITES === "1";
const GLASS_STYLE_WRITE_MODE = getGlassStyleWriteMode(
  process.env.AGENTVN_ADVANCED_PERF_GLASS_STYLE_WRITE_MODE,
);
const GENERIC_COMPOSITOR_WARMUP_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_GENERIC_COMPOSITOR_WARMUP === "1";
const STAGE_PROMOTION_DIAGNOSTIC =
  process.env.AGENTVN_ADVANCED_PERF_PROMOTE_LAYOUT_STAGE === "1";
const STAGE_PROMOTION_MODE = STAGE_PROMOTION_DIAGNOSTIC
  ? process.env.AGENTVN_ADVANCED_PERF_STAGE_PROMOTION_MODE
    || (process.env.AGENTVN_ADVANCED_PERF_PREMOUNT_LAYOUT_INITIAL === "1"
      ? "pre-mounted"
      : "first-render")
  : "";
const LAYOUT_STAGE_WILL_CHANGE_MODE =
  process.env.AGENTVN_ADVANCED_PERF_LAYOUT_STAGE_WILL_CHANGE_MODE || "";
const WARM_LAYER_WILL_CHANGE_MODE =
  process.env.AGENTVN_ADVANCED_PERF_WARM_LAYER_WILL_CHANGE_MODE || "";
if (WARM_LAYER_WILL_CHANGE_MODE && WARM_LAYER_WILL_CHANGE_MODE !== "auto") {
  throw new Error("AGENTVN_ADVANCED_PERF_WARM_LAYER_WILL_CHANGE_MODE must be auto.");
}
const layoutStageWillChangeSetupFailures = getLayoutStageWillChangeSetupFailures({
  enabled: Boolean(LAYOUT_STAGE_WILL_CHANGE_MODE),
  mode: LAYOUT_STAGE_WILL_CHANGE_MODE,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  developmentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
});
if (layoutStageWillChangeSetupFailures.length > 0) {
  throw new Error(
    `Layout stage will-change diagnostic rejected: ${layoutStageWillChangeSetupFailures.join("; ")}`,
  );
}
const layoutLayerTreeTimelineSetupFailures = getLayoutLayerTreeTimelineSetupFailures({
  enabled: LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  developmentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
  diagnosticRepeats: Number.parseInt(
    process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || "3",
    10,
  ),
});
if (layoutLayerTreeTimelineSetupFailures.length > 0) {
  throw new Error(
    `Layout layer-tree timeline diagnostic rejected: ${layoutLayerTreeTimelineSetupFailures.join("; ")}`,
  );
}
const ETW_TRIGGER_READY_FILE = process.env.AGENTVN_ADVANCED_PERF_ETW_READY_FILE || "";
const ETW_TRIGGER_RELEASE_FILE = process.env.AGENTVN_ADVANCED_PERF_ETW_RELEASE_FILE || "";
const ETW_CAPTURE_DONE_FILE = process.env.AGENTVN_ADVANCED_PERF_ETW_DONE_FILE || "";
const ETW_TRIGGER_GATE_FAILURES = getEtwTriggerGateSetupFailures({
  enabled: Boolean(ETW_TRIGGER_READY_FILE || ETW_TRIGGER_RELEASE_FILE),
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  traceEnabled: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
  diagnosticRepeats: Number.parseInt(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || "3", 10),
});
if (Boolean(ETW_TRIGGER_READY_FILE) !== Boolean(ETW_TRIGGER_RELEASE_FILE)
  || Boolean(ETW_TRIGGER_READY_FILE) !== Boolean(ETW_CAPTURE_DONE_FILE)) {
  ETW_TRIGGER_GATE_FAILURES.push("ETW trigger gate requires ready, release, and done file paths together");
}
if (ETW_TRIGGER_GATE_FAILURES.length > 0) {
  throw new Error(`ETW trigger gate rejected: ${ETW_TRIGGER_GATE_FAILURES.join("; ")}`);
}
if (GLASS_STYLE_WRITE_MODE === "suppress" && !GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC) {
  throw new Error("Suppressing glass style writes requires the glass style-write diagnostic to be enabled.");
}
const glassAnimationTimelineSetupFailures = getGlassAnimationTimelineSetupFailures({
  enabled: GLASS_ANIMATION_TIMELINE_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
});
if (glassAnimationTimelineSetupFailures.length > 0) {
  throw new Error(`Glass animation timeline diagnostic rejected: ${glassAnimationTimelineSetupFailures.join("; ")}`);
}
const glassStyleWriteTimelineSetupFailures = getGlassAnimationTimelineSetupFailures({
  enabled: GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
});
if (glassStyleWriteTimelineSetupFailures.length > 0) {
  throw new Error(`Glass style-write timeline diagnostic rejected: ${glassStyleWriteTimelineSetupFailures.join("; ")}`);
}
const genericCompositorWarmupSetupFailures = getGenericCompositorWarmupSetupFailures({
  enabled: GENERIC_COMPOSITOR_WARMUP_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
});
if (genericCompositorWarmupSetupFailures.length > 0) {
  throw new Error(
    `Generic compositor warm-up diagnostic rejected: ${genericCompositorWarmupSetupFailures.join("; ")}`,
  );
}
const PREWARM_LAYOUT_FROM_SETTINGS = getPrewarmLayoutFromSettingsDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_FROM_SETTINGS,
  {
    entryMode: PERFORMANCE_ENTRY_MODE,
    targetTab: PERFORMANCE_TARGET_TAB,
    warmWideTab: process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1",
  },
);
const PREWARM_LAYOUT_GEOMETRY_MODE = getPrewarmLayoutGeometryMode(
  process.env.AGENTVN_ADVANCED_PERF_PREWARM_LAYOUT_GEOMETRY,
  PREWARM_LAYOUT_FROM_SETTINGS,
);
const PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS =
  process.env.AGENTVN_ADVANCED_PERF_PREMOUNT_LAYOUT_INITIAL === "1";
const TRACE_FROM_NAVIGATION_DIAGNOSTIC = getTraceFromNavigationDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_TRACE_FROM_NAVIGATION,
  {
    traceEnabled: process.env.AGENTVN_ADVANCED_PERF_TRACE === "1",
    layerTreeEnabled: process.env.AGENTVN_ADVANCED_PERF_LAYER_TREE_TRACE_JOIN === "1",
    entryMode: PERFORMANCE_ENTRY_MODE,
    targetTab: PERFORMANCE_TARGET_TAB,
    preMountLayout: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS,
  },
);
const WARM_LAYER_OPACITY_DIAGNOSTIC = getWarmLayerOpacityDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_WARM_LAYER_OPACITY,
);
const SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC =
  WARM_LAYER_OPACITY_DIAGNOSTIC > 0 && !PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS;
const sourceWarmLayerOpacitySetupFailures = getSourceWarmOpacitySetupFailures({
  enabled: SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC,
  opacity: WARM_LAYER_OPACITY_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  developmentSource: process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1",
  layoutPreMountedByBundlePatch: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS,
  otherWarmupEnabled: Boolean(
    PREWARM_LAYOUT_FROM_SETTINGS || GENERIC_COMPOSITOR_WARMUP_DIAGNOSTIC
      || STAGE_PROMOTION_DIAGNOSTIC || process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1",
  ),
});
if (sourceWarmLayerOpacitySetupFailures.length > 0) {
  throw new Error(
    `Current-source warm-layer opacity diagnostic rejected: ${sourceWarmLayerOpacitySetupFailures.join("; ")}`,
  );
}
const stagePromotionSetupFailures = getStagePromotionSetupFailures({
  enabled: STAGE_PROMOTION_DIAGNOSTIC,
  mode: STAGE_PROMOTION_MODE,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  layoutPreMounted: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS,
  warmLayerOpacity: WARM_LAYER_OPACITY_DIAGNOSTIC,
  prewarmLayoutFromSettings: PREWARM_LAYOUT_FROM_SETTINGS,
  hardwareGpuRequired: REQUIRE_HARDWARE_GPU_PROVENANCE,
});
if (stagePromotionSetupFailures.length > 0) {
  throw new Error(`Stage promotion diagnostic rejected: ${stagePromotionSetupFailures.join("; ")}`);
}
const MORPH_START_DELAY_DIAGNOSTIC = getAnimationStartDelayDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_MORPH_START_DELAY_MS,
);
const TAB_CROSSFADE_START_DELAY_DIAGNOSTIC = getAnimationStartDelayDiagnostic(
  process.env.AGENTVN_ADVANCED_PERF_TAB_CROSSFADE_START_DELAY_MS,
);
const START_DELAY_SETUP = {
  delayMs: MORPH_START_DELAY_DIAGNOSTIC,
  entryMode: PERFORMANCE_ENTRY_MODE,
  targetTab: PERFORMANCE_TARGET_TAB,
  productionPreview: process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1",
  layoutPreMounted: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS,
  warmLayerOpacity: WARM_LAYER_OPACITY_DIAGNOSTIC,
};
const START_DELAY_SETUP_FAILURES = [
  ...getAnimationStartDelaySetupFailures(START_DELAY_SETUP),
  ...getAnimationStartDelaySetupFailures({
    ...START_DELAY_SETUP,
    delayMs: TAB_CROSSFADE_START_DELAY_DIAGNOSTIC,
  }),
];
if (START_DELAY_SETUP_FAILURES.length > 0) {
  throw new Error(`Invalid animation start-delay diagnostic setup: ${START_DELAY_SETUP_FAILURES.join("; ")}`);
}
if (WARM_LAYER_OPACITY_DIAGNOSTIC > 0
  && !PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
  && !SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC) {
  throw new Error(
    "A non-zero warm-layer opacity requires AGENTVN_ADVANCED_PERF_PREMOUNT_LAYOUT_INITIAL=1.",
  );
}
if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
  && (PERFORMANCE_ENTRY_MODE !== "cold"
    || PERFORMANCE_TARGET_TAB !== "layout"
    || PREWARM_LAYOUT_FROM_SETTINGS
    || process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1")) {
  throw new Error(
    "Initial hidden layout pre-mount requires cold layout entry, production preview, and no other prewarm mode.",
  );
}
const INITIAL_WIDE_LAYOUT_WARM_CSS = `
.advanced-tab-content.is-warm[data-tab="layout"] {
  width: 3404px !important; height: 1936px !important;
  right: auto !important; bottom: auto !important; overflow: hidden !important;
  opacity: ${WARM_LAYER_OPACITY_DIAGNOSTIC} !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] > .advanced-tab-scroll {
  display: grid !important; width: 100% !important; height: 100% !important;
  min-height: 0 !important; overflow: hidden !important; padding: 0 !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-designer {
  display: grid !important; width: 100% !important; height: 100% !important;
  min-height: 0 !important; max-height: none !important; overflow: hidden !important;
  grid-template-rows: auto auto minmax(0, 1fr) auto !important; gap: 6px !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-grid {
  display: grid !important; width: 100% !important; height: 1776px !important;
  min-height: 0 !important; overflow: hidden !important;
  grid-template-columns: minmax(232px, 260px) minmax(0, 1fr) minmax(326px, 372px) !important;
  gap: 8px !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] :is(
  .runtime-layout-sidebar, .runtime-layout-center, .runtime-layout-inspector
) { min-height: 0 !important; height: 100% !important; overflow: hidden !important; }
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-center {
  display: grid !important; grid-template-rows: auto minmax(0, 1fr) !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage-wrap {
  display: grid !important; width: 2748px !important; min-height: 0 !important; height: 1724px !important;
  overflow: hidden !important; padding: 8px !important; contain: layout paint !important;
}
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage {
  width: 2730px !important; height: 1536px !important;
  max-width: none !important; max-height: none !important; aspect-ratio: auto !important;
}
${STAGE_PROMOTION_DIAGNOSTIC && STAGE_PROMOTION_MODE === "pre-mounted" ? `
.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage,
.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-stage {
  will-change: transform !important;
}
` : ""}
`;
if (PREWARM_LAYOUT_FROM_SETTINGS && process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1") {
  throw new Error("Prewarming the layout from settings requires the editor/dist production preview.");
}
const PERFORMANCE_WARM_WIDE_END_TAB = process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_END_TAB || "theme";
if (PERFORMANCE_ENTRY_MODE === "cold"
  && ["AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB", "AGENTVN_ADVANCED_PERF_WARM_TARGET",
    "AGENTVN_ADVANCED_PERF_PREPARE_WIDE_TARGET_GEOMETRY"].some(name => process.env[name] === "1")) {
  throw new Error("Cold first-entry diagnostics cannot prewarm or measure target wide geometry.");
}
if (!["layout", "theme"].includes(PERFORMANCE_WARM_WIDE_END_TAB)) {
  throw new Error("AGENTVN_ADVANCED_PERF_WARM_WIDE_END_TAB must be layout or theme.");
}
if (REACT_FIBER_CAPTURE_DIAGNOSTIC && !REACT_COMMIT_DIAGNOSTIC) {
  throw new Error("React Fiber attribution requires AGENTVN_ADVANCED_PERF_REACT_COMMITS=1.");
}
if (LAYER_TREE_TRACE_JOIN_DIAGNOSTIC
  && (process.env.AGENTVN_ADVANCED_PERF_TRACE !== "1"
    || process.env.AGENTVN_ADVANCED_PERF_PREVIEW !== "1")) {
  throw new Error("Layer-tree/raster attribution requires a production preview trace.");
}
if (process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1"
  && (PERFORMANCE_TARGET_TAB === "providers" || PERFORMANCE_WARM_WIDE_END_TAB === PERFORMANCE_TARGET_TAB)) {
  throw new Error("Warm-wide control must switch between distinct layout/theme tabs.");
}

const viewports = [
  { label: "1080p", width: 1920, height: 1080, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "1440p", width: 2560, height: 1440, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "4k", width: 3840, height: 2160, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "desktop-1440", width: 1440, height: 1000, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "desktop-1336", width: 1336, height: 768, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "desktop-1280", width: 1280, height: 720, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "desktop-900", width: 900, height: 720, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "desktop-760", width: 760, height: 720, stableMs: 1200, longTaskMs: 100, frameGapMs: 120 },
  { label: "mobile-440", width: 440, height: 900, stableMs: 1200, longTaskMs: 140, frameGapMs: 160 },
  { label: "mobile-390", width: 390, height: 844, stableMs: 1200, longTaskMs: 140, frameGapMs: 160 },
].filter((viewport) => (process.env.AGENTVN_AUDIT_VIEWPORT
  ? viewport.label === process.env.AGENTVN_AUDIT_VIEWPORT
  : ["1080p", "1440p", "4k"].includes(viewport.label)));

const requiredTargets = [
  { name: "layout designer", selector: ".advanced-tab-content.is-active .runtime-layout-designer" },
  { name: "game client tab", selector: '[data-help-key="advanced.tab.layout"]', button: true },
  { name: "game client heading", selector: ".advanced-tab-content.is-active .runtime-layout-header h3" },
  { name: "save layout", selector: '.advanced-tab-content.is-active [data-help-key="layout.save"]', button: true },
  { name: "layout stage", selector: ".advanced-tab-content.is-active .runtime-layout-stage" },
  { name: "layout sidebar", selector: ".advanced-tab-content.is-active .runtime-layout-sidebar" },
  { name: "layout inspector", selector: ".advanced-tab-content.is-active .runtime-layout-inspector" },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

function buildAuditProject() {
  const project = JSON.parse(fs.readFileSync(TEST_PROJECT_PATH, "utf8"));
  if (project.project_id !== acceptancePaths.fixtureProjectId)
    throw new Error("Advanced layout audit fixture identity changed during startup.");
  if (!Array.isArray(project.nodes) || !Array.isArray(project.edges))
    throw new Error("Advanced layout audit requires a valid isolated project graph.");
  return project;
}

function toSharedProjectState(project) {
  return {
    project_graph: {
      nodes: project.nodes,
      edges: project.edges,
      viewport: project.viewport,
      memoryMode: project.memory_mode,
    },
    project_metadata: {
      projectId: project.project_id,
      title: project.title,
      author: project.author,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      assetManifest: project.asset_manifest,
      settings: project.editor_settings,
      schemaVersion: project.schema_version,
    },
    recent_projects: [],
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isListening(url) {
  try {
    const response = await fetch(url);
    return response.status < 500;
  } catch {
    return false;
  }
}

function startService(report) {
  const logFile = path.join(OUT_DIR, "advanced-layout-transition-editor.log");
  const child = spawn(NPM, ["run", "dev"], {
    cwd: path.join(ROOT, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logFile, chunk));
  report.logs.push(logFile);
  return child;
}

async function ensureEditor(report) {
  const logFile = path.join(OUT_DIR, "advanced-layout-transition-editor.log");
  if (process.env.AGENTVN_ADVANCED_PERF_PREVIEW === "1") {
    const editorRoot = path.join(ROOT, "editor");
    const viteModule = await import(pathToFileURL(path.join(editorRoot, "node_modules", "vite", "dist", "node", "index.js")).href);
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not obtain an ephemeral preview port."));
          return;
        }
        probe.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
    const previewServer = await viteModule.preview({
      root: editorRoot,
      configFile: path.join(editorRoot, "vite.config.ts"),
      preview: { host: "127.0.0.1", port, strictPort: true, open: false },
    });
    const address = previewServer.httpServer.address();
    if (!address || typeof address === "string" || !previewServer.httpServer.listening) {
      await previewServer.close();
      throw new Error("Owned Vite preview did not bind its expected local port.");
    }
    EDITOR_URL = `http://127.0.0.1:${address.port}`;
    const runId = randomUUID();
    report.editorUrl = EDITOR_URL;
    report.serverMode = "owned-vite-production-preview";
    report.owner = { pid: process.pid, runId };
    return {
      async assertAlive() {
        if (!previewServer.httpServer.listening) throw new Error(`Owned Vite preview stopped: ${runId}`);
        const response = await fetch(EDITOR_URL, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error(`Owned Vite preview health check failed (${response.status}): ${runId}`);
      },
      async run(operation) {
        await this.assertAlive();
        return operation();
      },
      async stop() {
        if (previewServer.httpServer.listening) await previewServer.close();
      },
    };
  }
  const server = await startOwnedViteServer({ root: path.join(ROOT, "editor"), logFile });
  EDITOR_URL = server.url;
  report.editorUrl = server.url;
  report.serverMode = "owned-vite-development";
  report.owner = { pid: server.pid, runId: server.runId };
  report.logs.push(logFile);
  return server;
}

function stopServices(started) {
  for (const child of started) {
    if (!child.pid) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Already stopped.
    }
  }
}

async function openAdvancedSettings(page, onDocumentReady) {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await onDocumentReady?.();
  await page.waitForFunction(() => {
    const stage = document.querySelector(".app-transition-stage");
    return !document.querySelector(".project-entry-loading-overlay") &&
      (!stage ||
        (!stage.classList.contains("is-home-hydrating") &&
          !stage.classList.contains("is-switching") &&
          !stage.classList.contains("is-enter-cartridge") &&
          !stage.classList.contains("is-project-entry-loading")));
  }, null, { timeout: 12000 }).catch(() => {});

  if (!(await page.locator(".editor-toolbar").isVisible({ timeout: 800 }).catch(() => false))) {
    await page.waitForFunction(() => {
      const candidates = [...document.querySelectorAll('[data-help-key="home.recentProject"], [data-help-key="home.openDraft"], [data-help-key="home.createProject"]')];
      return candidates.some((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && !element.disabled;
      });
    }, null, { timeout: 30000 });
    await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('[data-help-key="home.recentProject"], [data-help-key="home.openDraft"], [data-help-key="home.createProject"]')];
      const target = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !element.disabled;
      });
      if (!(target instanceof HTMLElement)) throw new Error("No visible project entry action.");
      target.click();
    });
    await page.waitForTimeout(500);
  }
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator(".advanced-tools-panel").waitFor({ state: "visible", timeout: 30000 });
  const settingsTab = page.locator('[data-help-key="advanced.tab.settings"]').first();
  if (await settingsTab.isVisible().catch(() => false)) {
    await settingsTab.hover().catch(() => {});
    await settingsTab.click();
  }
  await page.locator(".project-settings-panel").waitFor({ state: "visible", timeout: 30000 });
}

async function readSourceWarmOpacityState(page) {
  return page.evaluate(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const settings = popover?.querySelector('.advanced-tab-content.is-active[data-tab="settings"]');
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const designer = layout?.querySelector(".runtime-layout-designer");
    const stage = layout?.querySelector(".runtime-layout-stage");
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    const style = layout instanceof HTMLElement ? getComputedStyle(layout) : null;
    return {
      selectedTab: settings instanceof HTMLElement ? "settings" : null,
      opacity: style ? Number.parseFloat(style.opacity) : Number.NaN,
      ariaHidden: layout?.getAttribute("aria-hidden") === "true",
      inert: layout?.hasAttribute("inert") ?? false,
      pointerEvents: style?.pointerEvents ?? null,
      activeElementInside: Boolean(layout?.contains(document.activeElement)),
      designerReady: designer?.getAttribute("data-advanced-tab-ready") === "true",
      previewMounted: Boolean(layout?.querySelector(".runtime-layout-expected-preview")),
      geometry: {
        viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
        stage: rect(stage),
      },
    };
  });
}

async function applySourceWarmOpacityDiagnostic(page) {
  const before = await readSourceWarmOpacityState(page);
  await page.addStyleTag({
    content: '.advanced-tab-content.is-warm[data-tab="layout"]{opacity:0.001!important}',
  });
  await page.waitForFunction(() => {
    const layout = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    return layout instanceof HTMLElement
      && getComputedStyle(layout).opacity === "0.001"
      && layout.getAttribute("aria-hidden") === "true"
      && layout.hasAttribute("inert");
  }, null, { timeout: 30_000 });
  const after = await readSourceWarmOpacityState(page);
  const failures = getSourceWarmOpacityStateFailures({ before, after });
  return {
    property: "opacity",
    value: 0.001,
    overrideCount: 1,
    before,
    after,
    failures,
    ok: failures.length === 0,
  };
}

async function installDeterministicProjectFixture(page) {
  const project = buildAuditProject();
  const sharedState = toSharedProjectState(project);
  await page.addInitScript(({ fixtureProject, disableHoverHelp }) => {
    localStorage.setItem("agentvn.currentProjectDraft", JSON.stringify(fixtureProject));
    localStorage.setItem("agentvn.recentProjects", JSON.stringify([{
      project_id: fixtureProject.project_id,
      title: fixtureProject.title,
      author: fixtureProject.author,
      created_at: fixtureProject.created_at,
      updated_at: fixtureProject.updated_at,
      node_count: fixtureProject.nodes.length,
      edge_count: fixtureProject.edges.length,
      schema_version: fixtureProject.schema_version,
      has_detail: true,
      project: fixtureProject,
    }]));
    if (disableHoverHelp) localStorage.setItem("agentvn.hoverHelpEnabled", "false");
  }, { fixtureProject: project, disableHoverHelp: hoverHelpAttributionMode.enabled });
  await page.route("http://127.0.0.1:8278/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    if (url.pathname === "/api/project/state") {
      const submitted = request.postDataJSON?.() ?? {};
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: method === "GET" ? sharedState : { ...sharedState, ...submitted },
        }),
      });
      return;
    }
    if (url.pathname === "/api/project/catalog") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: [] }),
      });
      return;
    }
    if (url.pathname.startsWith("/api/project/projects/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: method === "GET" ? project : (request.postDataJSON?.() ?? project) }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: {} }),
    });
  });
}

async function waitForCenterHit(page, selector, timeout = 15000) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForFunction((targetSelector) => {
    const el = document.querySelector(targetSelector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity || "1") <= 0.01) return false;
    const x = Math.min(innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === el || el.contains(hit) || hit.contains(el)));
  }, selector, { timeout });
}

async function installPerformanceProbe(page) {
  await page.evaluate((targetTab) => {
    const state = {
      running: false,
      start: 0,
      lastFrame: 0,
      frameGaps: [],
      longTasks: [],
      observer: null,
      longAnimationFrames: [],
      longAnimationFrameObserver: null,
      longAnimationFrameSupported: false,
      interactionStart: null,
      interactionSource: null,
      traceClockMarker: "agentvn-advanced-interaction-start",
      traceEnabled: false,
      onObservationEnd() {
        state.samplePageVisibility?.("end");
        const geometryReads = window.__advancedNavGeometryReadProbe;
        if (geometryReads) geometryReads.running = false;
        const clone = window.__advancedPopoverCloneProbe;
        if (clone) clone.running = false;
        window.__e2TargetReadinessProbe?.stop();
        window.__e2ReactFiberStageProbe?.stop?.();
      },
    };
    window.__advancedLayoutTransitionAudit = state;
    const targetSelector = `[data-help-key="advanced.tab.${targetTab}"]`;
    document.addEventListener("pointerdown", (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)
        || !event.target.closest(targetSelector) || state.interactionStart !== null) return;
      state.interactionStart = performance.now();
      state.interactionSource = "trusted-pointerdown";
      state.samplePageVisibility?.("input");
      if (state.traceEnabled) console.timeStamp(state.traceClockMarker);
    }, true);
    document.addEventListener("keydown", (event) => {
      if (!event.isTrusted || event.key !== "Enter"
        || !(event.target instanceof Element)
        || !event.target.closest(targetSelector) || state.interactionStart !== null) return;
      state.interactionStart = performance.now();
      state.interactionSource = "trusted-keyboard-enter";
      state.samplePageVisibility?.("input");
      if (state.traceEnabled) console.timeStamp(state.traceClockMarker);
    }, true);
  }, PERFORMANCE_TARGET_TAB);
  await page.evaluate(installMeasurementVisibilityTracking);
  await page.evaluate(installPerformanceObservers);
}

async function installSlowDomReadProbe(page) {
  await page.evaluate(() => {
    const state = { calls: {}, totalMs: {}, slowReads: [] };
    const record = (name, startedAt, target) => {
      const audit = window.__advancedLayoutTransitionAudit;
      if (!audit?.running) return;
      const duration = performance.now() - startedAt;
      state.calls[name] = (state.calls[name] ?? 0) + 1;
      state.totalMs[name] = (state.totalMs[name] ?? 0) + duration;
      if (duration < 8 || state.slowReads.length >= 24) return;
      state.slowReads.push({
        name, durationMs: duration, at: startedAt,
        target: target instanceof Element
          ? `${target.tagName}.${String(target.className).slice(0, 160)}`
          : String(target),
        stack: new Error("[DEBUG-e2-slow-dom-read]").stack,
      });
    };
    const wrap = (prototype, method) => {
      const original = prototype[method];
      prototype[method] = function (...args) {
        const startedAt = performance.now();
        try { return original.apply(this, args); }
        finally { record(method, startedAt, this); }
      };
    };
    wrap(Element.prototype, "getBoundingClientRect");
    wrap(Element.prototype, "getClientRects");
    wrap(CSSStyleDeclaration.prototype, "getPropertyValue");
    const originalComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function (...args) {
      const startedAt = performance.now();
      try { return originalComputedStyle.apply(this, args); }
      finally { record("getComputedStyle", startedAt, args[0]); }
    };
    window.__e2SlowDomReadProbe = state;
  });
}

async function installTargetReadinessProbe(
  page,
  targetTab,
  morphStartDelayMs = 0,
  tabCrossfadeStartDelayMs = 0,
) {
  await page.evaluate(({ tab, morphStartDelayMs, tabCrossfadeStartDelayMs }) => {
    const observations = [];
    const motionEvents = [];
    const trackedAnimations = new WeakMap();
    const motionEventCleanups = [];
    const morphDelayDiagnostic = {
      kind: "diagnostic-only-morph-start-delay",
      requestedDelayMs: morphStartDelayMs,
      interceptedCount: 0,
      animations: [],
    };
    const tabCrossfadeDelayDiagnostic = {
      kind: "diagnostic-only-tab-crossfade-start-delay",
      requestedDelayMs: tabCrossfadeStartDelayMs,
      interceptedCount: 0,
      animations: [],
    };
    let nextAnimationId = 1;
    const rootSelector = ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)";
    const contentSelector = tab === "theme" ? ".runtime-theme-designer" : ".runtime-layout-designer";
    const sample = (event, detail = {}) => {
      if (!window.__advancedLayoutTransitionAudit?.running || observations.length >= 60) return;
      const panel = document.querySelector(rootSelector);
      const layer = panel?.querySelector(`.advanced-tab-content[data-tab="${tab}"]`);
      observations.push({
        at: performance.now(), event, ...detail,
        tab,
        activeTab: panel?.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab"),
        targetClass: layer?.className ?? null,
        targetMounted: Boolean(layer?.querySelector(contentSelector)),
        targetFallback: Boolean(layer?.querySelector(".advanced-tab-loading")),
        explicitReady: layer?.querySelector("[data-advanced-tab-ready]")?.getAttribute("data-advanced-tab-ready") ?? null,
        phase: panel?.querySelector(".advanced-tools-panel")?.className ?? null,
      });
    };
    const recordMotion = (animationId, type, owner, detail = {}) => {
      if (!window.__advancedLayoutTransitionAudit?.running || motionEvents.length >= 160) return;
      motionEvents.push({ animationId, type, owner, at: performance.now(), ...detail });
    };
    const ownerFor = (element) => {
      if (element.matches(".toolbar-popover-morph-ghost")) return "snapshot:ghost";
      if (element.matches(rootSelector)) return "container:morph";
      if (element.matches(".advanced-tab-content[data-tab]")) {
        return `tab:${element.getAttribute("data-tab")}`;
      }
      if (element.matches(".advanced-tools-panel")) return "container:content-opacity";
      return "";
    };
    const captureStarted = (animation, record) => {
      let ready;
      try { ready = animation.ready; } catch { return; }
      Promise.resolve(ready).then(() => {
        if (record.started) return;
        record.started = true;
        recordMotion(record.animationId, "started", record.owner, {
          startTime: Number.isFinite(Number(animation.startTime)) ? Number(animation.startTime) : null,
          currentTime: Number.isFinite(Number(animation.currentTime)) ? Number(animation.currentTime) : null,
        });
      }).catch(() => {});
    };
    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const owner = this instanceof HTMLElement ? ownerFor(this) : "";
      const animation = originalAnimate.apply(this, args);
      if (owner) {
        const animationId = `${tab}-motion-${nextAnimationId++}`;
        let timing = animation.effect?.getTiming?.() ?? {};
        if (owner === "container:morph" && morphStartDelayMs > 0) {
          const originalDelayMs = Number.isFinite(Number(timing.delay)) ? Number(timing.delay) : 0;
          const originalDurationMs = Number.isFinite(Number(timing.duration)) ? Number(timing.duration) : null;
          const keyframes = animation.effect?.getKeyframes?.() ?? [];
          const properties = [...new Set(keyframes.flatMap((frame) => Object.keys(frame))
            .filter((key) => !["offset", "computedOffset", "easing", "composite", "compositeOperation"].includes(key)))];
          animation.effect?.updateTiming?.({ delay: originalDelayMs + morphStartDelayMs });
          timing = animation.effect?.getTiming?.() ?? timing;
          morphDelayDiagnostic.interceptedCount += 1;
          morphDelayDiagnostic.animations.push({
            animationId,
            originalDelayMs,
            appliedDelayMs: Number(timing.delay),
            durationMs: Number.isFinite(Number(timing.duration)) ? Number(timing.duration) : null,
            originalDurationMs,
            properties,
          });
        }
        if (owner.startsWith("tab:") && tabCrossfadeStartDelayMs > 0) {
          const originalDelayMs = Number.isFinite(Number(timing.delay)) ? Number(timing.delay) : 0;
          const originalDurationMs = Number.isFinite(Number(timing.duration)) ? Number(timing.duration) : null;
          const keyframes = animation.effect?.getKeyframes?.() ?? [];
          const properties = [...new Set(keyframes.flatMap((frame) => Object.keys(frame))
            .filter((key) => !["offset", "computedOffset", "easing", "composite", "compositeOperation"].includes(key)))];
          animation.effect?.updateTiming?.({ delay: originalDelayMs + tabCrossfadeStartDelayMs });
          timing = animation.effect?.getTiming?.() ?? timing;
          tabCrossfadeDelayDiagnostic.interceptedCount += 1;
          tabCrossfadeDelayDiagnostic.animations.push({
            animationId,
            owner,
            originalDelayMs,
            appliedDelayMs: Number(timing.delay),
            durationMs: Number.isFinite(Number(timing.duration)) ? Number(timing.duration) : null,
            originalDurationMs,
            properties,
          });
        }
        let properties = [];
        try {
          properties = [...new Set((animation.effect?.getKeyframes?.() ?? [])
            .flatMap((frame) => Object.keys(frame))
            .filter((key) => !["offset", "computedOffset", "easing", "composite", "compositeOperation"].includes(key)))];
        } catch {}
        const record = { animationId, owner, started: false };
        trackedAnimations.set(animation, record);
        recordMotion(animationId, "created", owner, {
          durationMs: Number.isFinite(Number(timing.duration)) ? Number(timing.duration) : null,
          delayMs: Number.isFinite(Number(timing.delay)) ? Number(timing.delay) : 0,
          easing: String(timing.easing ?? ""),
          properties,
        });
        const onFinish = () => recordMotion(animationId, "finished", owner, {
          currentTime: Number.isFinite(Number(animation.currentTime)) ? Number(animation.currentTime) : null,
        });
        const onCancel = () => recordMotion(animationId, "cancelled", owner, {
          currentTime: Number.isFinite(Number(animation.currentTime)) ? Number(animation.currentTime) : null,
        });
        animation.addEventListener("finish", onFinish);
        animation.addEventListener("cancel", onCancel);
        motionEventCleanups.push(() => {
          animation.removeEventListener("finish", onFinish);
          animation.removeEventListener("cancel", onCancel);
        });
        captureStarted(animation, record);
        sample("animation-created", {
          owner: this.className,
          duration: timing.duration,
        });
      }
      return animation;
    };
    const animationPrototype = window.Animation?.prototype;
    const originalPlay = animationPrototype?.play;
    if (typeof originalPlay === "function") {
      animationPrototype.play = function (...args) {
        const record = trackedAnimations.get(this);
        const result = originalPlay.apply(this, args);
        if (record) {
          recordMotion(record.animationId, "play-requested", record.owner);
          captureStarted(this, record);
        }
        return result;
      };
    }
    const originalAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (node) {
      if (node instanceof HTMLElement && node.matches(".toolbar-popover-morph-ghost")) {
        sample("snapshot-captured");
      }
      return originalAppend.call(this, node);
    };
    const observer = new MutationObserver(() => sample("dom-change"));
    const panel = document.querySelector(rootSelector);
    if (panel) observer.observe(panel, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["class", "aria-hidden", "data-advanced-tab-ready"] });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element
        && event.target.closest(`[data-help-key="advanced.tab.${tab}"]`)) {
        sample("trusted-click", { isTrusted: event.isTrusted });
      }
    }, true);
    window.__e2TargetReadinessProbe = {
      observations,
      motionEvents,
      morphDelayDiagnostic,
      tabCrossfadeDelayDiagnostic,
      stop: () => {
        observer.disconnect();
        Element.prototype.animate = originalAnimate;
        if (animationPrototype && originalPlay) animationPrototype.play = originalPlay;
        motionEventCleanups.forEach((cleanup) => cleanup());
      },
    };
  }, { tab: targetTab, morphStartDelayMs, tabCrossfadeStartDelayMs });
}

async function installFirstMountObserverProbe(page) {
  await page.evaluate(() => {
    const NativeResizeObserver = window.ResizeObserver;
    const state = { kind: "diagnostic-only-observer-timing", observers: [], calls: [] };
    window.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
        const observed = new Set();
        const owner = { id: state.observers.length, targets: [] };
        state.observers.push(owner);
        super((entries, observer) => {
          if (!window.__advancedLayoutTransitionAudit?.running) return callback(entries, observer);
          const startedAt = performance.now();
          try {
            return callback(entries, observer);
          } finally {
            state.calls.push({ id: owner.id, at: startedAt, durationMs: performance.now() - startedAt,
              entries: entries.map(entry => ({
                target: `${entry.target.tagName}.${String(entry.target.className).slice(0, 160)}`,
                width: entry.contentRect.width, height: entry.contentRect.height,
              })) });
          }
        });
        this.observed = observed;
        this.owner = owner;
      }
      observe(target, options) {
        if (!this.observed.has(target)) {
          this.observed.add(target);
          this.owner.targets.push(`${target.tagName}.${String(target.className).slice(0, 160)}`);
        }
        return super.observe(target, options);
      }
    };
    window.__e2FirstMountObserverProbe = state;
  });
}

async function installReactCommitProbe(page) {
  await page.addInitScript(() => {
    const rendererRoots = new Map();
    let nextRendererId = 1;
    const probe = {
      installed: true,
      hookAlreadyPresent: Boolean(window.__REACT_DEVTOOLS_GLOBAL_HOOK__),
      commits: [],
      fiberCaptures: [],
      pendingFiberCapture: null,
      fiberCaptureAttempts: 0,
      rendererCount: 0,
    };
    if (probe.hookAlreadyPresent) {
      probe.installed = false;
      window.__e2ReactCommitProbe = probe;
      return;
    }
    const hook = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) {
        const rendererId = nextRendererId++;
        this.renderers.set(rendererId, renderer);
        rendererRoots.set(rendererId, new Set());
        probe.rendererCount = this.renderers.size;
        return rendererId;
      },
      onScheduleFiberRoot() {},
      onCommitFiberRoot(rendererId, root) {
        let roots = rendererRoots.get(rendererId);
        if (!roots) {
          roots = new Set();
          rendererRoots.set(rendererId, roots);
        }
        roots.add(root);
        const audit = window.__advancedLayoutTransitionAudit;
        if (audit?.running && probe.commits.length < 1000) {
          probe.commits.push({ at: performance.now(), rendererId });
        }
        const pending = probe.pendingFiberCapture;
        if (pending && probe.fiberCaptures.length === 0 && probe.fiberCaptureAttempts < 8) {
          probe.fiberCaptureAttempts += 1;
          const startedAt = performance.now();
          const stack = [root?.current].filter(Boolean);
          let stageFiber = null;
          let totalFiberCount = 0;
          while (stack.length && totalFiberCount < 50000) {
            const fiber = stack.pop();
            if (!fiber) continue;
            totalFiberCount += 1;
            if (fiber.stateNode === pending.stageElement) stageFiber = fiber;
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child) stack.push(fiber.child);
          }
          if (stageFiber) {
            const fiberName = (fiber) => {
              const type = fiber?.elementType ?? fiber?.type;
              if (typeof type === "string") {
                const className = fiber.stateNode instanceof Element
                  ? String(fiber.stateNode.className ?? "").trim().replace(/\s+/g, ".").slice(0, 180)
                  : "";
                return className ? `${type}.${className}` : type;
              }
              return String(type?.displayName ?? type?.name ?? "");
            };
            const childCount = (fiber) => {
              let count = 0;
              for (let child = fiber?.child; child; child = child.sibling) count += 1;
              return count;
            };
            const subtreeFiberCount = (fiber) => {
              const nodes = fiber ? [fiber] : [];
              let count = 0;
              while (nodes.length && count < 50000) {
                const current = nodes.pop();
                count += 1;
                for (let child = current.child; child; child = child.sibling) nodes.push(child);
              }
              return count;
            };
            const path = [];
            for (let fiber = stageFiber; fiber; fiber = fiber.return) {
              path.push({
                tag: fiber.tag,
                name: fiberName(fiber),
                flags: fiber.flags,
                subtreeFlags: fiber.subtreeFlags,
                childCount: childCount(fiber),
              });
            }
            const layoutDesignerHostPathIndex = path.findIndex((item) => (
              item.name.includes(".runtime-layout-designer")
            ));
            const componentPathIndex = layoutDesignerHostPathIndex >= 0
              ? path.findIndex((item, index) => index > layoutDesignerHostPathIndex
                && [0, 1, 11, 14, 15].includes(item.tag))
              : -1;
            const designerComponentFiber = componentPathIndex >= 0
              ? (() => {
                let fiber = stageFiber;
                for (let index = 0; index < componentPathIndex; index += 1) fiber = fiber?.return;
                return fiber;
              })()
              : null;
            const capturedAt = performance.now();
            probe.fiberCaptures.push({
              rendererId,
              observerAt: pending.observerAt,
              capturedAt,
              captureDurationMs: capturedAt - startedAt,
              stageSize: pending.stageSize,
              totalFiberCount,
              layoutDesignerHostPathIndex: layoutDesignerHostPathIndex >= 0
                ? layoutDesignerHostPathIndex
                : null,
              designerComponentPathIndex: componentPathIndex >= 0 ? componentPathIndex : null,
              designerComponentFiberCount: designerComponentFiber
                ? subtreeFiberCount(designerComponentFiber)
                : null,
              path,
            });
            probe.pendingFiberCapture = null;
          }
        }
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      getFiberRoots(rendererId) {
        return rendererRoots.get(rendererId) ?? new Set();
      },
      checkDCE() {},
    };
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      configurable: true,
      enumerable: false,
      value: hook,
    });
    window.__e2ReactCommitProbe = probe;
  });
}

async function installReactFiberStageCommitProbe(page) {
  await page.evaluate(() => {
    const probe = window.__e2ReactCommitProbe;
    if (!probe?.installed) throw new Error("React Fiber attribution requires the active production React commit hook.");
    const NativeResizeObserver = window.ResizeObserver;
    if (typeof NativeResizeObserver !== "function") throw new Error("ResizeObserver is unavailable.");
    const state = { kind: "diagnostic-only-one-shot-react-fiber-path", wrapped: true, initialSize: null,
      expansionObserved: null, observerToCommitAttempts: 0, stageObservationCount: 0 };
    const WrappedResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
        super((entries, observer) => {
          for (const entry of entries) {
            const target = entry.target;
            if (!(target instanceof Element) || !target.matches(".runtime-layout-stage")) continue;
            const size = { width: entry.contentRect.width, height: entry.contentRect.height };
            state.stageObservationCount += 1;
            if (!state.initialSize) {
              state.initialSize = size;
              continue;
            }
            if (state.expansionObserved
              || size.width < state.initialSize.width * 1.5
              || size.height < state.initialSize.height * 1.5) continue;
            state.expansionObserved = { at: performance.now(), size };
            probe.pendingFiberCapture = {
              stageElement: target,
              observerAt: state.expansionObserved.at,
              stageSize: size,
            };
            state.observerToCommitAttempts = probe.fiberCaptureAttempts;
          }
          callback(entries, observer);
        });
      }
    };
    window.ResizeObserver = WrappedResizeObserver;
    state.stop = () => {
      if (window.ResizeObserver === WrappedResizeObserver) {
        window.ResizeObserver = NativeResizeObserver;
      }
    };
    window.__e2ReactFiberStageProbe = state;
  });
}

async function installAdvancedNavGeometryReadProbe(page) {
  await page.evaluate(() => {
    const roots = [...document.querySelectorAll(
      ".advanced-tools-panel > nav.glass-selection-group",
    )];
    const targets = new WeakSet();
    for (const root of roots) {
      targets.add(root);
      root.querySelectorAll("*").forEach((element) => targets.add(element));
    }
    const state = {
      roots: roots.length,
      running: false,
      calls: {
        getBoundingClientRect: 0,
        getClientRects: 0,
      },
      totalDurationMs: {
        getBoundingClientRect: 0,
        getClientRects: 0,
      },
      maxDurationMs: {
        getBoundingClientRect: 0,
        getClientRects: 0,
      },
      triggerEvents: [],
    };
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    const originalGetClientRects = Element.prototype.getClientRects;
    const wrap = (method, original) => function (...args) {
      if (!state.running || !targets.has(this)) return original.apply(this, args);
      const startedAt = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const duration = performance.now() - startedAt;
        state.calls[method] += 1;
        state.totalDurationMs[method] += duration;
        state.maxDurationMs[method] = Math.max(state.maxDurationMs[method], duration);
      }
    };
    Element.prototype.getBoundingClientRect = wrap("getBoundingClientRect", originalGetBoundingClientRect);
    Element.prototype.getClientRects = wrap("getClientRects", originalGetClientRects);
    document.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-help-key="advanced.tab.layout"]')
        : null;
      if (!target) return;
      state.running = true;
      state.triggerEvents.push({ type: "pointerdown", isTrusted: event.isTrusted, at: performance.now() });
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-help-key="advanced.tab.layout"]')
        : null;
      if (!target) return;
      state.triggerEvents.push({ type: "click", isTrusted: event.isTrusted, at: performance.now() });
    }, true);
    window.__advancedNavGeometryReadProbe = state;
  });
}

async function installPopoverCloneProbe(page) {
  await page.evaluate(() => {
    const originalCloneNode = Node.prototype.cloneNode;
    const state = {
      running: false,
      calls: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      samples: [],
    };
    Node.prototype.cloneNode = function (deep) {
      if (!(this instanceof HTMLElement)
        || !this.matches(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)")
        || !deep
        || !state.running) {
        return originalCloneNode.call(this, deep);
      }
      const startedAt = performance.now();
      let result;
      try {
        result = originalCloneNode.call(this, deep);
        return result;
      } finally {
        const duration = performance.now() - startedAt;
        state.calls += 1;
        state.totalDurationMs += duration;
        state.maxDurationMs = Math.max(state.maxDurationMs, duration);
        state.samples.push({
          durationMs: duration,
        });
      }
    };
    document.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-help-key="advanced.tab.layout"], [data-help-key="advanced.tab.theme"]')
        : null;
      if (target) state.running = true;
    }, true);
    window.__advancedPopoverCloneProbe = state;
  });
}

async function installSyncPhaseTimingProbe(page) {
  await page.evaluate(() => {
    const popoverSelector = ".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)";
    const state = {
      kind: "diagnostic-only-synchronous-snapshot-phase-timing",
      trustedTargetClicks: 0,
      armed: false,
      activeCapture: null,
      captureEnvelopes: [],
      mark(name) {
        if (!this.activeCapture) return;
        this.activeCapture.phaseMarks ??= [];
        this.activeCapture.phaseMarks.push({ name: String(name), at: performance.now() });
      },
    };
    const targetSelector =
      '[data-help-key="advanced.tab.layout"], [data-help-key="advanced.tab.theme"]';
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalClone = Node.prototype.cloneNode;
    const originalAnimate = Element.prototype.animate;

    document.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element ? event.target.closest(targetSelector) : null;
      if (!target || !event.isTrusted) return;
      state.trustedTargetClicks += 1;
      state.armed = true;
    }, true);

    Element.prototype.getBoundingClientRect = function (...args) {
      const beginCapture = state.armed && !state.activeCapture
        && this instanceof HTMLElement && this.matches(popoverSelector);
      const startedAt = beginCapture ? performance.now() : null;
      if (beginCapture) {
        state.armed = false;
        state.activeCapture = {
          start: startedAt,
          rectReadStartedAt: startedAt,
          cloneDurationMs: 0,
        };
      }
      const rect = originalRect.apply(this, args);
      if (beginCapture && state.activeCapture) {
        state.activeCapture.rectReadDurationMs = performance.now() - startedAt;
      }
      return rect;
    };

    Node.prototype.cloneNode = function (deep) {
      const isPopoverClone = state.activeCapture
        && deep
        && this instanceof HTMLElement
        && this.matches(popoverSelector);
      const startedAt = isPopoverClone ? performance.now() : null;
      try {
        return originalClone.call(this, deep);
      } finally {
        if (isPopoverClone && state.activeCapture) {
          state.activeCapture.cloneDurationMs += performance.now() - startedAt;
        }
      }
    };

    Element.prototype.animate = function (...args) {
      const isGhost = state.activeCapture
        && this instanceof HTMLElement
        && this.matches(".toolbar-popover-morph-ghost");
      const animation = originalAnimate.apply(this, args);
      if (isGhost && state.activeCapture) {
        const end = performance.now();
        state.captureEnvelopes.push({
          ...state.activeCapture,
          end,
          durationMs: end - state.activeCapture.start,
        });
        state.activeCapture = null;
      }
      return animation;
    };
    window.__e2SyncPhaseTimingProbe = state;
  });
}

async function installPostSnapshotTimingInit(page) {
  await page.addInitScript(() => {
    window.__e2PostSnapshotTiming = {
      renderCounts: { designer: 0, preview: 0 },
      initialRenderCounts: null,
      events: [],
      mark(name, detail = {}) {
        if (!window.__advancedLayoutTransitionAudit?.running || this.events.length >= 120) return;
        this.events.push({ name, at: performance.now(), ...detail });
      },
      render(name) {
        this.renderCounts[name] = (this.renderCounts[name] ?? 0) + 1;
        this.mark(`render:${name}`);
      },
    };
  });
}

async function runGenericCompositorWarmup(page, viewport) {
  return page.evaluate(async ({ width, height }) => {
    const readWorkspaceState = () => {
      const popover = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
      )].find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const selectedTab = popover?.querySelector('[data-glass-selected="true"]')
        ?.getAttribute("data-help-key") ?? null;
      const activeContent = popover?.querySelector(".advanced-tab-content.is-active");
      const rect = popover?.getBoundingClientRect();
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      return {
        selectedTab,
        activeContentTab: activeContent?.getAttribute("data-tab") ?? null,
        targetDesignerCount: popover?.querySelectorAll(".runtime-layout-designer").length ?? 0,
        activePopoverCount: document.querySelectorAll(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
        ).length,
        popoverRect: rect ? {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        } : null,
        focus: activeElement ? {
          tagName: activeElement.tagName,
          id: activeElement.id,
          helpKey: activeElement.getAttribute("data-help-key"),
        } : null,
      };
    };
    const before = readWorkspaceState();
    if (before.activePopoverCount !== 1
      || before.selectedTab !== "advanced.tab.settings"
      || before.activeContentTab !== "settings"
      || before.targetDesignerCount !== 0
      || !before.popoverRect) {
      throw new Error(`Generic compositor warm-up requires the untouched settings workspace: ${JSON.stringify(before)}`);
    }

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.dataset.e2GenericCompositorWarmup = "true";
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      width: `${width}px`,
      height: `${height}px`,
      opacity: "1",
      visibility: "visible",
      pointerEvents: "none",
      transform: "translateZ(0)",
    });
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Could not create the generic compositor warm-up canvas.");

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#14283b");
    background.addColorStop(0.48, "#263142");
    background.addColorStop(1, "#40324a");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 0.28;
    context.fillStyle = "#c6d5e8";
    for (let x = 0; x < width; x += 128) context.fillRect(x, 0, 1, height);
    for (let y = 0; y < height; y += 96) context.fillRect(0, y, width, 1);
    context.globalAlpha = 1;

    const drawCompletedAt = performance.now();
    document.body.appendChild(canvas);
    const renderedFrames = [];
    for (let index = 0; index < 2; index += 1) {
      renderedFrames.push(await new Promise((resolve) => requestAnimationFrame(resolve)));
      const style = getComputedStyle(canvas);
      const rect = canvas.getBoundingClientRect();
      if (!canvas.isConnected
        || style.visibility !== "visible"
        || style.opacity !== "1"
        || rect.width !== width
        || rect.height !== height) {
        canvas.remove();
        throw new Error("Generic compositor warm-up canvas did not remain visibly rendered for two frames.");
      }
    }
    canvas.remove();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const after = readWorkspaceState();
    const rectDelta = before.popoverRect && after.popoverRect
      ? Math.max(
        Math.abs(before.popoverRect.x - after.popoverRect.x),
        Math.abs(before.popoverRect.y - after.popoverRect.y),
        Math.abs(before.popoverRect.width - after.popoverRect.width),
        Math.abs(before.popoverRect.height - after.popoverRect.height),
      )
      : Number.POSITIVE_INFINITY;
    if (JSON.stringify(before.focus) !== JSON.stringify(after.focus)
      || before.selectedTab !== after.selectedTab
      || before.activeContentTab !== after.activeContentTab
      || before.targetDesignerCount !== after.targetDesignerCount
      || before.activePopoverCount !== after.activePopoverCount
      || rectDelta > 0.5
      || canvas.isConnected) {
      throw new Error(`Generic compositor warm-up changed the app state or geometry: ${JSON.stringify({ before, after, rectDelta, canvasConnected: canvas.isConnected })}`);
    }
    return {
      kind: "diagnostic-only-full-viewport-canvas-raster-warmup",
      presentationAlteredForDiagnostic: true,
      viewport: { width, height, dpr: devicePixelRatio },
      canvasBackingSize: { width: canvas.width, height: canvas.height },
      renderedFrameCount: renderedFrames.length,
      renderedFrameTimes: renderedFrames,
      drawCompletedAt,
      canvasRemovedBeforeMeasurement: !canvas.isConnected,
      workspaceStateUnchanged: true,
      popoverGeometryDeltaPx: rectDelta,
      before,
      after,
    };
  }, viewport);
}

async function startPerformanceProbe(page) {
  if (page.__e2CaptureNativeWindowState) {
    page.__e2NativeWindowStates = [];
    await page.__e2CaptureNativeWindowState("before-measurement-start");
  }
  await page.evaluate(() => {
    const state = window.__advancedLayoutTransitionAudit;
    const reactCommitProbe = window.__e2ReactCommitProbe;
    if (reactCommitProbe) reactCommitProbe.commits.length = 0;
    const postSnapshotTiming = window.__e2PostSnapshotTiming;
    if (postSnapshotTiming) {
      postSnapshotTiming.events = [];
      postSnapshotTiming.initialRenderCounts = { ...postSnapshotTiming.renderCounts };
    }
    state.running = true;
    state.observationEnd = null;
    state.observationFailure = null;
    state.start = performance.now();
    state.lastFrame = state.start;
    state.interactionStart = null;
    state.interactionSource = null;
    state.frameGaps = [];
    state.longTasks = [];
    state.longAnimationFrames = [];
    state.visibilitySamples = [];
    state.samplePageVisibility?.("start");
    const step = (time) => {
      if (!state.running) return;
      state.frameGaps.push({
        startTime: state.lastFrame,
        duration: time - state.lastFrame,
      });
      state.lastFrame = time;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function installHoverHelpTimelineProbe(page) {
  await page.evaluate(() => {
    const state = { start: null, recording: false, events: [] };
    const onAnimation = (event) => {
      if (!state.recording || !(event.target instanceof Element)
        || !event.target.closest(".hover-help-card")) return;
      state.events.push({
        type: event.type,
        animationName: event.animationName,
        timeMs: performance.now() - state.start,
      });
    };
    for (const type of ["animationstart", "animationend", "animationcancel"]) {
      document.addEventListener(type, onAnimation, true);
    }
    state.begin = () => {
      state.events.length = 0;
      state.start = performance.now();
      state.recording = true;
    };
    state.finish = () => {
      state.recording = false;
      const card = document.querySelector(".hover-help-card");
      const style = card instanceof HTMLElement ? getComputedStyle(card) : null;
      const rect = card?.getBoundingClientRect();
      return {
        preference: localStorage.getItem("agentvn.hoverHelpEnabled"),
        cardPresent: Boolean(card),
        cardPhase: card?.classList.contains("is-closing") ? "closing" : card ? "open" : "absent",
        cardRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        cardOpacity: style ? Number(style.opacity) : null,
        cardBackdropFilter: style?.backdropFilter ?? null,
        events: state.events.slice(),
      };
    };
    window.__e2HoverHelpTimelineProbe = state;
  });
}

async function stopPerformanceProbe(page, startTime, { includeFullWindow = false } = {}) {
  const observationBoundary = await page.evaluate(finishPerformanceObservation);
  await page.__e2CaptureNativeWindowState?.("after-observer-delivery");
  const sample = await page.evaluate(({ startedAt, includeFullWindow, observationBoundary }) => {
    const state = window.__advancedLayoutTransitionAudit;
    state.running = false;
    const interactionEnd = observationBoundary.end;
    const interactionStart = includeFullWindow ? startedAt : state.interactionStart;
    const interactionSource = includeFullWindow ? "idle-observation-window" : state.interactionSource;
    const geometryReadProbe = window.__advancedNavGeometryReadProbe;
    const popoverCloneProbe = window.__advancedPopoverCloneProbe;
    const readinessProbe = window.__e2TargetReadinessProbe;
    const reactFiberStageProbe = window.__e2ReactFiberStageProbe;
    const reactCommitProbe = window.__e2ReactCommitProbe;
    return {
      observationBoundary,
      pageVisibility: state.visibilitySamples,
      pageVisibilityProvenance: "Playwright-default-focus-emulation; DOM visibility is not native window foreground proof",
      interactionWindow: {
        start: interactionStart,
        end: interactionEnd,
        durationMs: interactionStart === null ? null : interactionEnd - interactionStart,
        source: interactionSource,
        valid: Number.isFinite(interactionStart) && interactionEnd >= interactionStart,
      },
      longTasks: state.longTasks,
      frameGaps: state.frameGaps,
      reactCommits: window.__e2ReactCommitProbe?.commits ?? null,
      reactCommitProbeInstalled: window.__e2ReactCommitProbe?.installed ?? false,
      reactCommitRendererCount: window.__e2ReactCommitProbe?.rendererCount ?? 0,
      syncPhaseTimingProbe: window.__e2SyncPhaseTimingProbe ?? null,
      postSnapshotTiming: window.__e2PostSnapshotTiming ? {
        events: window.__e2PostSnapshotTiming.events,
        initialRenderCounts: window.__e2PostSnapshotTiming.initialRenderCounts,
        renderCounts: window.__e2PostSnapshotTiming.renderCounts,
      } : null,
      reactFiberCaptures: reactCommitProbe?.fiberCaptures ?? null,
      reactFiberStageProbe: reactFiberStageProbe ? {
        kind: reactFiberStageProbe.kind,
        wrapped: reactFiberStageProbe.wrapped,
        initialSize: reactFiberStageProbe.initialSize,
        expansionObserved: reactFiberStageProbe.expansionObserved,
        stageObservationCount: reactFiberStageProbe.stageObservationCount,
        observerToCommitAttempts: reactFiberStageProbe.observerToCommitAttempts,
        finalCaptureAttempts: reactCommitProbe?.fiberCaptureAttempts ?? 0,
      } : null,
      advancedNavGeometryReads: geometryReadProbe
        ? {
          roots: geometryReadProbe.roots,
          calls: geometryReadProbe.calls,
          totalDurationMs: geometryReadProbe.totalDurationMs,
          maxDurationMs: geometryReadProbe.maxDurationMs,
          triggerEvents: geometryReadProbe.triggerEvents,
        }
        : null,
      popoverClone: popoverCloneProbe
        ? {
          calls: popoverCloneProbe.calls,
          totalDurationMs: popoverCloneProbe.totalDurationMs,
          maxDurationMs: popoverCloneProbe.maxDurationMs,
          samples: popoverCloneProbe.samples,
        }
        : null,
      longAnimationFrameCount: state.longAnimationFrames.length,
      longAnimationFrameSupported: state.longAnimationFrameSupported,
      longAnimationFrames: state.longAnimationFrames,
      slowDomReads: window.__e2SlowDomReadProbe ?? null,
      scopedMotionTokenCache: window.__e2ScopedMotionTokenCache?.finish?.() ?? null,
      targetReadiness: readinessProbe?.observations ?? null,
      editorMotionEvents: readinessProbe?.motionEvents ?? null,
      morphStartDelayDiagnostic: readinessProbe?.morphDelayDiagnostic ?? null,
      tabCrossfadeStartDelayDiagnostic: readinessProbe?.tabCrossfadeDelayDiagnostic ?? null,
    };
  }, { startedAt: startTime, includeFullWindow, observationBoundary });
  sample.nativeWindowStates = page.__e2NativeWindowStates;
  sample.nativeWindowSampling = "CDP snapshots outside measurement boundaries; not continuous native occlusion proof";
  const visibilityFailures = getMeasurementVisibilityFailures(sample.pageVisibility,
    { inputRequired: !includeFullWindow, windowStates: sample.nativeWindowStates });
  if (visibilityFailures.length)
    throw new Error(`Measurement visibility invalid: ${visibilityFailures.join("; ")}`);
  const inWindow = (entries) => filterEntriesByTimeWindow(
    entries,
    sample.interactionWindow.start,
    sample.interactionWindow.end,
  );
  const frameGaps = inWindow(sample.frameGaps);
  const longTasks = inWindow(sample.longTasks);
  const longAnimationFrames = inWindow(sample.longAnimationFrames)
    .map(summarizeLongAnimationFrame)
    .sort((left, right) => right.blockingDuration - left.blockingDuration || right.duration - left.duration)
    .slice(0, 8);
  const syncPhaseTimingProbe = sample.syncPhaseTimingProbe
    ? {
      ...sample.syncPhaseTimingProbe,
      summary: summarizeSyncPhaseProbeEvidence({
        trustedTargetClicks: sample.syncPhaseTimingProbe.trustedTargetClicks,
        captureEnvelopes: sample.syncPhaseTimingProbe.captureEnvelopes,
        longAnimationFrames,
        reactCommits: sample.reactCommits ?? [],
      }),
    }
    : null;
  return {
    ...sample,
    frameGaps,
    longTasks,
    longAnimationFrames,
    editorMotionTimeline: sample.editorMotionEvents
      ? summarizeEditorMotionTimeline(sample.editorMotionEvents, longAnimationFrames)
      : null,
    morphStartDelayDiagnostic: sample.morphStartDelayDiagnostic,
    tabCrossfadeStartDelayDiagnostic: sample.tabCrossfadeStartDelayDiagnostic,
    reactCommitDiagnostic: sample.reactCommits
      ? {
        installed: sample.reactCommitProbeInstalled,
        rendererCount: sample.reactCommitRendererCount,
        ...summarizeReactCommitProbe(sample.reactCommits, sample.interactionWindow),
        commits: sample.reactCommits,
      }
      : null,
    reactFiberPathDiagnostic: {
      probe: sample.reactFiberStageProbe,
      captures: (sample.reactFiberCaptures ?? [])
        .map(summarizeReactFiberPathCapture)
        .filter(Boolean),
    },
    syncPhaseTimingProbe,
    maxLongTaskMs: longTasks.reduce((max, item) => Math.max(max, item.duration), 0),
    maxFrameGapMs: frameGaps.reduce((max, item) => Math.max(max, item.duration), 0),
    longAnimationFrameCount: longAnimationFrames.length,
    maxLongAnimationFrameMs: longAnimationFrames.reduce((max, item) => Math.max(max, item.duration), 0),
    maxLongAnimationFrameBlockingMs: longAnimationFrames.reduce((max, item) => Math.max(max, item.blockingDuration), 0),
    longAnimationFrames,
  };
}

async function auditTarget(page, target) {
  const locator = page.locator(target.selector).first();
  if (!(await locator.count())) return { ...target, ok: false, failures: ["missing"] };
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  return locator.evaluate((el, meta) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const failures = [];
    const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    if (!visible) failures.push("not visible");
    const disabled = Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true";
    if (meta.button && disabled) failures.push("disabled");
    let hit = "";
    let hitHelpKey = "";
    let hitRect;
    if (visible && rect.width >= 8 && rect.height >= 8) {
      const visibleLeft = Math.max(1, rect.left);
      const visibleTop = Math.max(1, rect.top);
      const visibleRight = Math.min(window.innerWidth - 1, rect.right);
      const visibleBottom = Math.min(window.innerHeight - 1, rect.bottom);
      const x = visibleLeft + Math.max(0, visibleRight - visibleLeft) / 2;
      const y = visibleTop + Math.max(0, visibleBottom - visibleTop) / 2;
      const hitEl = document.elementFromPoint(x, y);
      hit = hitEl ? hitEl.tagName.toLowerCase() + (hitEl.className ? `.${String(hitEl.className).trim().replace(/\s+/g, ".")}` : "") : "";
      hitHelpKey = hitEl?.closest?.("[data-help-key]")?.getAttribute("data-help-key") ?? "";
      const hitBounds = hitEl?.getBoundingClientRect();
      hitRect = hitBounds ? {
        left: hitBounds.left,
        top: hitBounds.top,
        right: hitBounds.right,
        bottom: hitBounds.bottom,
      } : undefined;
      if (!hitEl || !(hitEl === el || el.contains(hitEl) || hitEl.contains(el))) failures.push(`center blocked by ${hit || "unknown"}`);
    }
    return {
      name: meta.name,
      selector: meta.selector,
      ok: failures.length === 0,
      failures,
      disabled,
      hit,
      hitHelpKey,
      hitRect,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      computed: {
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
      },
    };
  }, target);
}

async function auditVisibleGlassGroups(page) {
  return page.evaluate(() => {
    const designer = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
    if (!designer) return [{ ok: false, className: "runtime-layout-designer", failures: ["active designer missing"] }];
    const groups = [...designer.querySelectorAll(".glass-selection-group")];
    if (groups.length === 0)
      return [{ ok: false, className: "runtime-layout-designer", failures: ["active designer has no glass groups"] }];
    return groups.flatMap((group, index) => {
    const selected = group.querySelector('[data-glass-selected="true"]');
    const indicator = group.querySelector(".glass-selection-indicator");
    const material = group.querySelector(".glass-selection-material");
    const press = group.querySelector(".glass-selection-press");
    const rim = group.querySelector(".glass-selection-rim");
    if (
      !(selected instanceof HTMLElement)
      || !(indicator instanceof HTMLElement)
      || indicator.dataset.glassVisible !== "true"
      || indicator.dataset.glassState !== "settled"
      || group.closest('[data-layout-transitioning="true"]')
    ) return [];
    const selectedRect = selected.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const selectedStyle = getComputedStyle(selected);
    const indicatorStyle = getComputedStyle(indicator);
    const materialStyle = material ? getComputedStyle(material) : undefined;
    const materialBeforeStyle = material ? getComputedStyle(material, "::before") : undefined;
    const materialAfterStyle = material ? getComputedStyle(material, "::after") : undefined;
    const pressStyle = press ? getComputedStyle(press) : undefined;
    const rimStyle = rim ? getComputedStyle(rim) : undefined;
    const centerDelta = Math.hypot(
      selectedRect.left + selectedRect.width / 2 - (indicatorRect.left + indicatorRect.width / 2),
      selectedRect.top + selectedRect.height / 2 - (indicatorRect.top + indicatorRect.height / 2),
    );
    const sizeDelta = Math.max(
      Math.abs(selectedRect.width - indicatorRect.width),
      Math.abs(selectedRect.height - indicatorRect.height),
    );
    const failures = [];
    if (centerDelta > 1) failures.push(`center delta ${centerDelta.toFixed(2)}px`);
    if (sizeDelta > 1) failures.push(`size delta ${sizeDelta.toFixed(2)}px`);
    if (indicator.style.transform.includes("scale")) failures.push("position layer owns scale");
    if (!material || !material.style.transform.includes("scale")) failures.push("material layer missing scale");
    if (!press) failures.push("press layer missing");
    if (!indicatorStyle.filter.includes("drop-shadow")) {
      failures.push(`position layer is missing exterior depth shadow: ${indicatorStyle.filter}`);
    }
    if (materialStyle && materialStyle.borderRadius !== indicatorStyle.borderRadius) {
      failures.push(`material radius ${materialStyle.borderRadius} != indicator radius ${indicatorStyle.borderRadius}`);
    }
    if (!rim) failures.push("rim layer missing");
    if (rimStyle && rimStyle.borderRadius !== indicatorStyle.borderRadius) {
      failures.push(`rim radius ${rimStyle.borderRadius} != indicator radius ${indicatorStyle.borderRadius}`);
    }
    if (pressStyle && pressStyle.borderRadius !== indicatorStyle.borderRadius) {
      failures.push(`press radius ${pressStyle.borderRadius} != indicator radius ${indicatorStyle.borderRadius}`);
    }
    if (selectedStyle.backgroundImage !== "none" || !selectedStyle.backgroundColor.includes("rgba(0, 0, 0, 0)")) {
      failures.push("selected button has colored fill");
    }
    if (materialBeforeStyle?.content !== "none" || materialAfterStyle?.content !== "none") {
      failures.push("material pseudo overlay is still active");
    }
    return [{
      index,
      className: group.className,
      ok: failures.length === 0,
      failures,
      centerDelta,
      sizeDelta,
    }];
    });
  });
}

async function auditAdvancedTabStrip(page) {
  const strip = page.locator(".advanced-tools-panel > nav.glass-selection-group").first();
  const viewport = strip.locator(":scope > .glass-selection-viewport");
  const buttons = viewport.locator("[data-help-key^='advanced.tab.']");
  await viewport.waitFor({ state: "visible", timeout: 30000 });
  const buttonCount = await buttons.count();
  if (buttonCount < 8) {
    return {
      ok: false,
      failures: [`expected at least 8 advanced tabs, found ${buttonCount}`],
      states: [],
    };
  }

  const states = [];
  const failures = [];
  for (let index = 0; index < buttonCount; index += 1) {
    const button = buttons.nth(index);
    await button.focus();
    await button.hover();
    await page.waitForTimeout(180);
    const state = await button.evaluate((element) => {
      const root = element.closest(".glass-selection-group");
      const viewport = root?.querySelector(":scope > .glass-selection-viewport");
      const panel = element.closest(".advanced-tools-panel");
      if (!(root instanceof HTMLElement) || !(viewport instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return { helpKey: element.getAttribute("data-help-key"), failures: ["missing strip structure"] };
      }
      const rootRect = root.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const buttonRect = element.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const style = getComputedStyle(element);
      const viewportStyle = getComputedStyle(viewport);
      const localFailures = [];
      if (buttonRect.left < viewportRect.left - 0.25 || buttonRect.right > viewportRect.right + 0.25) {
        localFailures.push("focused tab is horizontally clipped");
      }
      if (buttonRect.top < viewportRect.top - 0.25 || buttonRect.bottom > viewportRect.bottom + 0.25) {
        localFailures.push("hovered tab is vertically clipped");
      }
      if (element.scrollWidth > element.clientWidth + 1) localFailures.push("tab label is truncated");
      return {
        helpKey: element.getAttribute("data-help-key"),
        text: element.textContent?.trim() ?? "",
        failures: localFailures,
        rect: {
          left: buttonRect.left,
          top: buttonRect.top,
          right: buttonRect.right,
          bottom: buttonRect.bottom,
          width: buttonRect.width,
          height: buttonRect.height,
        },
        viewportRect: {
          left: viewportRect.left,
          top: viewportRect.top,
          right: viewportRect.right,
          bottom: viewportRect.bottom,
          width: viewportRect.width,
          height: viewportRect.height,
        },
        rootRect: {
          left: rootRect.left,
          right: rootRect.right,
          width: rootRect.width,
        },
        panelRect: {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width,
        },
        scrollLeft: viewport.scrollLeft,
        scrollWidth: viewport.scrollWidth,
        clientWidth: viewport.clientWidth,
        overflowX: viewportStyle.overflowX,
        overflowY: viewportStyle.overflowY,
        paddingTop: viewportStyle.paddingTop,
        paddingBottom: viewportStyle.paddingBottom,
        whiteSpace: style.whiteSpace,
        pageWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        activeHelpKey: document.activeElement?.getAttribute("data-help-key") ?? null,
        scrollAxis: root.getAttribute("data-glass-scroll-axis"),
      };
    });
    states.push(state);
    if (state.failures.length > 0) {
      failures.push(`${state.helpKey ?? `tab ${index}`}: ${state.failures.join(", ")}`);
    }
  }

  const providerTab = page.locator('[data-help-key="advanced.tab.providers"]').first();
  await providerTab.click();
  await page.waitForFunction(() => (
    document.querySelector('[data-help-key="advanced.tab.providers"]')?.getAttribute("data-glass-selected") === "true"
  ), null, { timeout: 30000 });
  await page.waitForTimeout(80);
  const selectedState = await providerTab.evaluate((element) => {
    const viewport = element.closest(".glass-selection-group")?.querySelector(":scope > .glass-selection-viewport");
    if (!(viewport instanceof HTMLElement)) return null;
    const viewportRect = viewport.getBoundingClientRect();
    const buttonRect = element.getBoundingClientRect();
    return {
      fullyVisible: buttonRect.left >= viewportRect.left - 1
        && buttonRect.right <= viewportRect.right + 1
        && buttonRect.top >= viewportRect.top - 1
        && buttonRect.bottom <= viewportRect.bottom + 1,
      scrollLeft: viewport.scrollLeft,
      maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
      pageWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
    };
  });
  if (!selectedState?.fullyVisible) failures.push("selected providers tab did not scroll fully into view");
  if (selectedState && selectedState.pageWidth > selectedState.pageClientWidth + 1) {
    failures.push(`tab strip created page overflow ${selectedState.pageWidth}px > ${selectedState.pageClientWidth}px`);
  }

  await page.locator('[data-help-key="advanced.tab.settings"]').first().click();
  await page.waitForFunction(() => (
    document.querySelector('[data-help-key="advanced.tab.settings"]')?.getAttribute("data-glass-selected") === "true"
  ), null, { timeout: 30000 });
  await page.locator(".project-settings-panel").waitFor({ state: "visible", timeout: 30000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  return {
    ok: failures.length === 0,
    failures,
    states,
    selectedState,
  };
}

async function captureResizeGlassMotion(page, clickAction) {
  const samplesPromise = page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    const startedAt = performance.now();
    const sample = (time) => {
      const popover = document.querySelector(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
      const panel = popover?.querySelector(".advanced-tools-panel.layout-mode");
      const designer = panel?.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
      const glassGroup = designer?.querySelector(".glass-selection-group");
      const selected = glassGroup?.querySelector('[data-glass-selected="true"]');
      const indicator = glassGroup?.querySelector(".glass-selection-indicator");
      const material = glassGroup?.querySelector(".glass-selection-material");
      const rim = glassGroup?.querySelector(".glass-selection-rim");
      const selectedRect = selected?.getBoundingClientRect();
      const indicatorRect = indicator?.getBoundingClientRect();
      const materialStyle = material ? getComputedStyle(material) : undefined;
      const rimStyle = rim ? getComputedStyle(rim) : undefined;
      const popoverRect = popover?.getBoundingClientRect();
      const popoverStyle = popover ? getComputedStyle(popover) : undefined;
      const stage = designer?.querySelector(".runtime-layout-stage");
      const stageRect = stage?.getBoundingClientRect();
      const preview = stage?.querySelector(".runtime-layout-expected-preview");
      const quickMenuPreview = stage?.querySelector(".preview-quick-menu-preview");
      const pixelReadout = designer?.querySelector(".runtime-layout-pixel-readout span");
      const snapGuides = stage ? [...stage.querySelectorAll(".runtime-layout-snap-guide")].map((guide) => ({
        axis: guide.classList.contains("is-x") ? "x" : "y",
        kind: [...guide.classList].find((name) => name.startsWith("is-") && name !== "is-x" && name !== "is-y")
          ?.slice(3) ?? null,
        left: getComputedStyle(guide).left,
        top: getComputedStyle(guide).top,
      })) : [];
      samples.push({
        time: time - startedAt,
        stageSize: stageRect ? { width: stageRect.width, height: stageRect.height } : null,
        stageLayoutSize: stage ? {
          width: stage.clientWidth,
          height: stage.clientHeight,
        } : null,
        designerReady: designer?.getAttribute("data-advanced-tab-ready") ?? null,
        previewVisible: preview ? getComputedStyle(preview).visibility === "visible"
          && getComputedStyle(preview).display !== "none" : false,
        previewRenderScale: quickMenuPreview
          ? Number(quickMenuPreview.getAttribute("data-preview-quick-menu-render-scale")) : null,
        previewAuthoredFrame: quickMenuPreview ? {
          width: Number(quickMenuPreview.getAttribute("data-preview-quick-menu-authored-frame-width")),
          height: Number(quickMenuPreview.getAttribute("data-preview-quick-menu-authored-frame-height")),
        } : null,
        pixelReadoutText: pixelReadout?.textContent?.trim() ?? null,
        snapGuides,
        popoverLeft: popoverRect?.left ?? 0,
        popoverRight: popoverRect?.right ?? 0,
        popoverWidth: popoverRect?.width ?? 0,
        popoverHeight: popoverRect?.height ?? 0,
        popoverClassName: popover?.className ?? "",
        popoverAnimationName: popoverStyle?.animationName ?? "none",
        popoverTransform: popoverStyle?.transform ?? "none",
        popoverAnimations: popover?.getAnimations().map((animation) => ({
          playState: animation.playState,
          currentTime: animation.currentTime,
          id: animation.id,
        })) ?? [],
        layoutTransitioning: panel?.getAttribute("data-layout-transitioning") === "true",
        visible: indicator?.getAttribute("data-glass-visible"),
        state: indicator?.getAttribute("data-glass-state"),
        moving: indicator?.getAttribute("data-glass-moving"),
        opacity: indicator ? Number(getComputedStyle(indicator).opacity) : 0,
        rimOpacity: rimStyle ? Number(rimStyle.opacity) : 0,
        rimTransform: rimStyle?.transform ?? "",
        materialTransform: materialStyle?.transform ?? "",
        borderColor: rimStyle?.borderColor ?? "",
        boxShadow: rimStyle?.boxShadow ?? "",
        centerDelta: selectedRect && indicatorRect ? Math.hypot(
          selectedRect.left + selectedRect.width / 2 - (indicatorRect.left + indicatorRect.width / 2),
          selectedRect.top + selectedRect.height / 2 - (indicatorRect.top + indicatorRect.height / 2),
        ) : null,
        sizeDelta: selectedRect && indicatorRect ? Math.max(
          Math.abs(selectedRect.width - indicatorRect.width),
          Math.abs(selectedRect.height - indicatorRect.height),
        ) : null,
      });
      if (time - startedAt < 980) requestAnimationFrame(sample);
      else resolve(samples);
    };
    requestAnimationFrame(sample);
  }));
  await clickAction();
  return samplesPromise;
}

function auditResizeGlassSamples(samples) {
  const failures = [];
  const widths = samples.map((sample) => sample.popoverWidth).filter((value) => value > 0);
  const minWidth = widths.length > 0 ? Math.min(...widths) : 0;
  const maxWidth = widths.length > 0 ? Math.max(...widths) : 0;
  const startWidth = minWidth;
  const endWidth = maxWidth;
  const intermediateWidths = new Set(widths
    .filter((value) => value > minWidth + 1 && value < maxWidth - 1)
    .map((value) => Math.round(value)));
  const requiredIntermediateCount = maxWidth - minWidth > 40 ? 8 : 2;
  if (maxWidth - minWidth > 2 && intermediateWidths.size < requiredIntermediateCount) {
    failures.push(`container width exposed ${intermediateWidths.size} intermediate samples, expected ${requiredIntermediateCount}`);
  }
  const firstTransformedStartIndex = samples.findIndex((sample) => (
    Math.abs(sample.popoverWidth - minWidth) < 1
    && sample.popoverTransform
    && sample.popoverTransform !== "none"
    && !sample.popoverTransform.startsWith("matrix(1, 0, 0, 1,")
  ));
  const firstStartIndex = firstTransformedStartIndex >= 0
    ? firstTransformedStartIndex
    : samples.findIndex((sample) => Math.abs(sample.popoverWidth - minWidth) < 1);
  const edgeSamples = samples.slice(Math.max(0, firstStartIndex)).filter((sample) => sample.popoverWidth > 0 && sample.time < 390);
  const growing = maxWidth > minWidth + 2;
  if (growing && edgeSamples.length > 2) {
    const maximumRightStep = edgeSamples.slice(1).reduce(
      (maximum, sample, index) => Math.max(maximum, Math.abs(sample.popoverRight - edgeSamples[index].popoverRight)),
      0,
    );
    const leftBacktracks = edgeSamples.slice(1).filter((sample, index) => (
      sample.popoverLeft > edgeSamples[index].popoverLeft + 1
    ));
    if (maximumRightStep > 12) failures.push(`expansion right edge jumped ${maximumRightStep.toFixed(2)}px in one frame`);
    if (leftBacktracks.length > 0) failures.push("expansion left edge reversed direction");
  }
  const transformedLayoutSamples = samples.filter((sample) => (
    sample.layoutTransitioning
    && sample.popoverTransform
    && sample.popoverTransform !== "none"
  ));
  if (growing && transformedLayoutSamples.length < 4) {
    failures.push("container resize did not stay on a compositor transform");
  }
  const duringLayout = samples.filter((sample) => sample.layoutTransitioning && sample.time > 24);
  if (duringLayout.length === 0) failures.push("container never exposed data-layout-transitioning");
  if (duringLayout.some((sample) => sample.visible === "true" || sample.moving === "true")) {
    failures.push("glass became visible or entered selection spring during container resize");
  }
  const firstVisible = samples.find((sample) => !sample.layoutTransitioning && sample.visible === "true");
  if (!firstVisible) failures.push("glass never formed after container resize");
  else {
    if ((firstVisible.centerDelta ?? Infinity) > 1) failures.push(`first visible glass center delta ${firstVisible.centerDelta}px`);
    if ((firstVisible.sizeDelta ?? Infinity) > 1) failures.push(`first visible glass size delta ${firstVisible.sizeDelta}px`);
  }
  const formingSamples = samples.filter((sample) => sample.state === "forming");
  if (formingSamples.length < 2) failures.push("glass formation did not expose multiple frames");
  else {
    const opacities = formingSamples.map((sample) => sample.rimOpacity);
    if (Math.max(...opacities) - Math.min(...opacities) < 0.2) failures.push("glass formation opacity did not progress continuously");
  }
  const settled = samples.filter((sample) => sample.state === "settled" && sample.time > 650);
  if (settled.length >= 2) {
    const first = settled[0];
    const last = settled.at(-1);
    if (
      first.borderColor !== last.borderColor
      || first.boxShadow !== last.boxShadow
      || Math.abs(first.rimOpacity - last.rimOpacity) > 0.001
    ) {
      failures.push("settled glass material changed after formation completed");
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    startWidth,
    endWidth,
    intermediateWidthCount: intermediateWidths.size,
    layoutSampleCount: duringLayout.length,
    formingSampleCount: formingSamples.length,
  };
}

async function auditSelectedHoverMotion(page) {
  const selector = '[data-help-key="advanced.tab.layout"]';
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.locator('[data-help-key="advanced.tab.settings"]').first().hover();
  await page.waitForTimeout(220);
  const baseline = await page.locator(selector).first().evaluate((button) => {
    const panel = button.closest(".advanced-tools-panel");
    const group = button.closest(".glass-selection-group");
    const indicator = panel?.querySelector(".glass-selection-indicator");
    const press = panel?.querySelector(".glass-selection-press");
    const buttonRect = button.getBoundingClientRect();
    const indicatorRect = indicator?.getBoundingClientRect();
    const pressRect = press?.getBoundingClientRect();
    return {
      buttonTop: buttonRect.top,
      buttonHeight: buttonRect.height,
      indicatorTop: indicatorRect?.top ?? 0,
      pressTop: pressRect?.top ?? 0,
      pressTransform: press ? getComputedStyle(press).transform : "",
      pressTranslateY: press ? new DOMMatrix(getComputedStyle(press).transform).m42 : 0,
      indicatorHover: indicator?.getAttribute("data-glass-hover"),
      groupHover: group?.getAttribute("data-glass-hover"),
    };
  });
  await page.locator(selector).first().hover();
  await page.waitForTimeout(75);
  let middle = await page.locator(selector).first().evaluate((button) => {
    const panel = button.closest(".advanced-tools-panel");
    const group = button.closest(".glass-selection-group");
    const indicator = panel?.querySelector(".glass-selection-indicator");
    const press = panel?.querySelector(".glass-selection-press");
    const buttonRect = button.getBoundingClientRect();
    const indicatorRect = indicator?.getBoundingClientRect();
    const pressRect = press?.getBoundingClientRect();
    return {
      buttonTop: buttonRect.top,
      buttonHeight: buttonRect.height,
      indicatorTop: indicatorRect?.top ?? 0,
      pressTop: pressRect?.top ?? 0,
      pressTransform: press ? getComputedStyle(press).transform : "",
      pressTranslateY: press ? new DOMMatrix(getComputedStyle(press).transform).m42 : 0,
      indicatorHover: indicator?.getAttribute("data-glass-hover"),
      groupHover: group?.getAttribute("data-glass-hover"),
    };
  });
  if (Math.abs(middle.pressTranslateY - baseline.pressTranslateY) < 0.01) {
    await page.waitForTimeout(35);
    middle = await page.locator(selector).first().evaluate((button) => {
      const panel = button.closest(".advanced-tools-panel");
      const group = button.closest(".glass-selection-group");
      const indicator = panel?.querySelector(".glass-selection-indicator");
      const press = panel?.querySelector(".glass-selection-press");
      const buttonRect = button.getBoundingClientRect();
      const indicatorRect = indicator?.getBoundingClientRect();
      const pressRect = press?.getBoundingClientRect();
      return {
        buttonTop: buttonRect.top,
        buttonHeight: buttonRect.height,
        indicatorTop: indicatorRect?.top ?? 0,
        pressTop: pressRect?.top ?? 0,
        pressTransform: press ? getComputedStyle(press).transform : "",
        pressTranslateY: press ? new DOMMatrix(getComputedStyle(press).transform).m42 : 0,
        indicatorHover: indicator?.getAttribute("data-glass-hover"),
        groupHover: group?.getAttribute("data-glass-hover"),
      };
    });
  }
  await page.waitForTimeout(110);
  const hovered = await page.locator(selector).first().evaluate((button) => {
    const panel = button.closest(".advanced-tools-panel");
    const group = button.closest(".glass-selection-group");
    const indicator = panel?.querySelector(".glass-selection-indicator");
    const press = panel?.querySelector(".glass-selection-press");
    const buttonRect = button.getBoundingClientRect();
    const indicatorRect = indicator?.getBoundingClientRect();
    const pressRect = press?.getBoundingClientRect();
    return {
      buttonTop: buttonRect.top,
      buttonHeight: buttonRect.height,
      indicatorTop: indicatorRect?.top ?? 0,
      pressTop: pressRect?.top ?? 0,
      pressTransform: press ? getComputedStyle(press).transform : "",
      pressTranslateY: press ? new DOMMatrix(getComputedStyle(press).transform).m42 : 0,
      indicatorHover: indicator?.getAttribute("data-glass-hover"),
      groupHover: group?.getAttribute("data-glass-hover"),
    };
  });
  const failures = [];
  if (Math.abs(baseline.buttonHeight - hovered.buttonHeight) > 0.1) failures.push("hover changed real button height");
  const buttonLift = baseline.buttonTop - hovered.buttonTop;
  const pressLift = baseline.pressTranslateY - hovered.pressTranslateY;
  if (Math.abs(buttonLift) > 0.1) failures.push(`hover moved the real button box ${buttonLift.toFixed(2)}px`);
  const finePointer = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
  // The navigation marker deliberately does not float on hover.  The
  // interaction still exposes the hover state, while the stationary material
  // keeps the same geometry and only changes its visual treatment.  This
  // matches the editor contract that removed the old upward hover base.
  if (finePointer && (hovered.indicatorHover !== "true" || hovered.groupHover !== "true")) {
    failures.push("selected navigation did not receive the real hover state");
  }
  if (finePointer && Math.abs(pressLift) > 0.1) {
    failures.push(`glass hover moved the marker ${pressLift.toFixed(2)}px`);
  }
  if (
    finePointer
    && (
      Math.abs(middle.pressTranslateY - baseline.pressTranslateY) > 0.1
      || Math.abs(middle.pressTranslateY - hovered.pressTranslateY) > 0.1
    )
  ) {
    failures.push("glass hover introduced an unexpected intermediate transform");
  }
  if (Math.abs(middle.buttonTop - baseline.buttonTop) > 0.1
    || Math.abs(middle.buttonHeight - baseline.buttonHeight) > 0.1) {
    failures.push("hover changed the real button geometry during feedback");
  }
  return { ok: failures.length === 0, failures, baseline, middle, hovered };
}

async function auditStageSnapGuideInteraction(page) {
  const designer = page.locator(".advanced-tab-content.is-active .runtime-layout-designer");
  const details = designer.locator(".runtime-layout-menu").filter({ hasText: "吸附" }).first();
  if (!(await details.evaluate(node => node instanceof HTMLDetailsElement && node.open))) {
    await details.locator("summary").click();
  }
  const gridToggle = details.locator('[data-help-key="layout.snapGrid"]');
  if (!(await gridToggle.isChecked())) await gridToggle.check();

  // Built-in player controls are intentionally locked. Create a temporary,
  // ordinary user mask through the real UI, then place it in the empty upper
  // safe area so pointer hit-testing reaches the movable component.
  await designer.locator('[data-help-key="layout.addMask"]').click();
  const rectInputs = designer.locator('.runtime-layout-inspector input[type="number"][data-help-key="layout.rect"]');
  await rectInputs.first().waitFor({ state: "visible", timeout: 5000 });
  if (await rectInputs.count() !== 4) throw new Error("Snap drag fixture expected four editable mask geometry fields.");
  for (const [index, value] of [8, 8, 16, 12].entries()) {
    await rectInputs.nth(index).fill(String(value));
  }
  await waitForActiveAdvancedPanelIdle(page);
  const stage = designer.locator(".runtime-layout-stage");
  const drag = await stage.evaluate(stageNode => {
    if (!(stageNode instanceof HTMLElement)) throw new Error("Drag test could not locate the layout stage.");
    const stageRect = stageNode.getBoundingClientRect();
    const width = stageNode.clientWidth;
    const height = stageNode.clientHeight;
    const frameWidth = stageRect.width;
    const frameHeight = stageRect.height;
    if (!(width > 0) || !(height > 0)
      || Math.abs(frameWidth - width) > 4 || Math.abs(frameHeight - height) > 4)
      throw new Error(`Snap drag requires a settled, untransformed stage: ${JSON.stringify({ stageRect: { width: stageRect.width, height: stageRect.height }, width, height })}`);
    const preferredTypes = ["dialog_text", "speaker_name", "choice_list", "dialog_panel"];
    const candidates = [...stageNode.querySelectorAll(".runtime-layout-block:not(.is-locked):not(.is-hidden)")]
      .map(button => {
        const rect = button.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        const hitSelf = hit === button || button.contains(hit);
        return {
          button,
          rect,
          x,
          y,
          hitSelf,
          type: button.getAttribute("data-component-type") ?? "",
          id: button.getAttribute("data-component-id") ?? "",
          hit: hit instanceof HTMLElement
            ? { tag: hit.tagName, className: typeof hit.className === "string" ? hit.className : "" }
            : null,
        };
      })
      .filter(candidate => candidate.hitSelf && candidate.rect.width > 4 && candidate.rect.height > 4)
      .sort((left, right) => {
        const leftRank = preferredTypes.indexOf(left.type);
        const rightRank = preferredTypes.indexOf(right.type);
        return (leftRank < 0 ? preferredTypes.length : leftRank)
          - (rightRank < 0 ? preferredTypes.length : rightRank);
      });
    const selected = candidates[0];
    if (!selected) {
      const blocked = [...stageNode.querySelectorAll(".runtime-layout-block:not(.is-locked):not(.is-hidden)")]
        .slice(0, 12).map(button => {
          const rect = button.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            id: button.getAttribute("data-component-id"),
            type: button.getAttribute("data-component-type"),
            hit: hit instanceof HTMLElement
              ? { tag: hit.tagName, className: typeof hit.className === "string" ? hit.className : "" }
              : null,
          };
        });
      throw new Error(`No draggable layout component passes real hit testing: ${JSON.stringify(blocked)}`);
    }
    const button = selected.button;
    const buttonRect = selected.rect;
    const nearestGridOrigin = (origin, size, frameSize) => {
      const step = frameSize * 0.05;
      const candidates = [];
      for (let line = 0; line <= frameSize + 0.01; line += step) {
        candidates.push(line, line - size);
      }
      return candidates.reduce((best, candidate) => (
        Math.abs(candidate - origin) < Math.abs(best - origin) ? candidate : best
      ), candidates[0]);
    };
    const left = buttonRect.left - stageRect.left;
    const top = buttonRect.top - stageRect.top;
    let dx = nearestGridOrigin(left, buttonRect.width, frameWidth) - left;
    let dy = nearestGridOrigin(top, buttonRect.height, frameHeight) - top;
    if (Math.abs(dx) < 1) dx = 2;
    if (Math.abs(dy) < 1) dy = 2;
    const startX = selected.x;
    const startY = selected.y;
    return {
      startX, startY, dx, dy,
      moveX: startX + dx,
      moveY: startY + dy,
      componentId: button.dataset.componentId ?? "",
      componentType: button.dataset.componentType ?? "",
      startHit: selected.hitSelf,
      stageLayoutSize: { width, height },
      stageFrameSize: { width: frameWidth, height: frameHeight },
    };
  });
  if (!drag.startHit) throw new Error(`Snap drag pointer is covered: ${JSON.stringify(drag)}`);

  await page.mouse.move(drag.startX, drag.startY);
  await page.mouse.down();
  await page.mouse.move(drag.moveX, drag.moveY, { steps: 4 });
  await page.waitForFunction(() => document.querySelectorAll(
    ".advanced-tab-content.is-active .runtime-layout-snap-guide",
  ).length > 0, null, { timeout: 5000 });
  const samples = await page.evaluate(() => new Promise(resolve => {
    const captured = [];
    let frame = 0;
    const sample = () => {
      const designerNode = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
      const stageNode = designerNode?.querySelector(".runtime-layout-stage");
      const stageRect = stageNode?.getBoundingClientRect();
      const guides = [...(stageNode?.querySelectorAll(".runtime-layout-snap-guide") ?? [])].map(guide => {
        const style = getComputedStyle(guide);
        const rect = guide.getBoundingClientRect();
        return {
          axis: guide.getAttribute("data-snap-guide-axis"),
          source: guide.getAttribute("data-snap-guide-source"),
          positionPercent: guide.style[guide.getAttribute("data-snap-guide-axis") === "x" ? "left" : "top"],
          visible: style.display !== "none" && style.visibility === "visible"
            && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        };
      });
      captured.push({
        stageLayoutSize: stageNode ? { width: stageNode.clientWidth, height: stageNode.clientHeight } : null,
        stageRect: stageRect ? { left: stageRect.left, top: stageRect.top, right: stageRect.right, bottom: stageRect.bottom } : null,
        guides,
      });
      frame += 1;
      if (frame < 5) requestAnimationFrame(sample);
      else resolve(captured);
    };
    requestAnimationFrame(sample);
  }));
  await page.mouse.up();
  const guideAudit = auditSnapGuideSamples(samples);
  return {
    ...guideAudit,
    failures: guideAudit.failures,
    drag: {
      componentId: drag.componentId,
      componentType: drag.componentType,
      delta: { x: drag.dx, y: drag.dy },
      stageLayoutSize: drag.stageLayoutSize,
      stageFrameSize: drag.stageFrameSize,
      startHit: drag.startHit,
    },
    samples,
  };
}

async function auditRuntimeLayoutComponentList(page) {
  return page.evaluate(() => {
    const activeContent = document.querySelector(".advanced-tab-content.is-active");
    const sidebar = activeContent?.querySelector(".runtime-layout-sidebar");
    const list = activeContent?.querySelector(".runtime-layout-component-list");
    const labels = [...(activeContent?.querySelectorAll(".runtime-layout-component-list label") ?? [])];
    const failures = [];
    if (!(sidebar instanceof HTMLElement) || !(list instanceof HTMLElement)) {
      return { ok: false, failures: ["component list or sidebar missing"] };
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const nestedViewport = sidebar.querySelector(":scope > .glass-selection-viewport");
    if (nestedViewport) failures.push("component sidebar still uses a nested glass scroll viewport");
    if (list.clientHeight < 140) failures.push(`component list client height ${list.clientHeight}px is too short`);
    if (listRect.bottom > sidebarRect.bottom + 1) failures.push("component list escapes sidebar bounds");
    if (labels.length > 0) {
      const previousScrollTop = list.scrollTop;
      list.scrollTop = list.scrollHeight;
      const lastRect = labels[labels.length - 1].getBoundingClientRect();
      const visibleTop = list.getBoundingClientRect().top;
      const visibleBottom = list.getBoundingClientRect().bottom;
      if (lastRect.bottom > visibleBottom + 1 || lastRect.top < visibleTop - 1) {
        failures.push("last component cannot be fully revealed inside its scroll region");
      }
      list.scrollTop = previousScrollTop;
    }
    return {
      ok: failures.length === 0,
      failures,
      layoutChrome: [".runtime-layout-header", ".runtime-layout-header h3",
        ".runtime-layout-header .row-actions", ".runtime-layout-component-heading",
        ".runtime-layout-screen-list"].map((selector) => {
        const element = activeContent.querySelector(selector);
        const style = getComputedStyle(element);
        return { selector, rect: element.getBoundingClientRect().toJSON(),
          flexShrink: style.flexShrink, minHeight: style.minHeight,
          flexWrap: style.flexWrap, overflow: style.overflow };
      }),
      sidebarRect: { top: sidebarRect.top, bottom: sidebarRect.bottom, height: sidebarRect.height },
      listRect: { top: listRect.top, bottom: listRect.bottom, height: listRect.height },
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      labelCount: labels.length,
    };
  });
}

async function auditSidebarInteraction(page) {
  const failures = [];
  const designer = page.locator(".advanced-tab-content.is-active .runtime-layout-designer");
  const sidebar = designer.locator(".runtime-layout-sidebar");
  const list = sidebar.locator(".runtime-layout-component-list");
  const lastComponent = list.locator("label").last();
  await lastComponent.scrollIntoViewIfNeeded();
  const componentId = await lastComponent.getAttribute("data-component-id");
  const componentButton = lastComponent.locator("button");
  const geometry = await componentButton.evaluate(button => {
    const rect = button.getBoundingClientRect();
    const listRect = button.closest(".runtime-layout-component-list").getBoundingClientRect();
    const sidebarRect = button.closest(".runtime-layout-sidebar").getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom, listTop: listRect.top, listBottom: listRect.bottom,
      sidebarTop: sidebarRect.top, sidebarBottom: sidebarRect.bottom,
      hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
    };
  });
  if (geometry.top < geometry.listTop - 1 || geometry.bottom > geometry.listBottom + 1
    || geometry.top < geometry.sidebarTop - 1 || geometry.bottom > geometry.sidebarBottom + 1) {
    failures.push("last component click target is clipped or outside the sidebar");
  }
  if (!geometry.hit) failures.push("last component pointer target is covered");
  // No forced clicks: exercise the same scroll and hit testing as a user.
  if (geometry.hit) {
    await componentButton.click();
    if (!await lastComponent.evaluate(label => label.classList.contains("is-active"))) {
      failures.push("last component click did not select the component");
    }
  }
  const pages = sidebar.locator(".runtime-layout-screen-list");
  const originalPage = await pages.locator('button[data-glass-selected="true"]').innerText();
  const lastPage = pages.locator("button").last();
  await lastPage.scrollIntoViewIfNeeded();
  await lastPage.click();
  if (!await lastPage.evaluate(button => button.dataset.glassSelected === "true")) {
    failures.push("last page click did not change the selected page");
  }
  await pages.getByRole("button", { name: originalPage, exact: true }).click();
  return { ok: failures.length === 0, failures, componentId, geometry, originalPage };
}

async function auditUnifiedGameClientControls(page) {
  return page.evaluate(() => {
    const designer = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
    const layoutTab = document.querySelector('[data-help-key="advanced.tab.layout"]');
    const heading = designer?.querySelector(".runtime-layout-header h3");
    const forbiddenSelectors = [
      '[data-help-key="layout.desktop"]',
      '[data-help-key="layout.mobile"]',
      '[data-help-key="layout.copyBreakpoint"]',
      '[data-layout-mode="pc"]',
    ];
    const forbiddenText = [
      "应用统一布局坐标",
      "应用到桌面",
      "应用到手机",
      "同步两端",
      "桌面布局",
      "手机布局",
      "手机横屏布局",
    ];
    const text = designer?.textContent ?? "";
    const failures = [];
    if (layoutTab?.textContent?.trim() !== "游戏客户端") {
      failures.push(`layout tab label is ${JSON.stringify(layoutTab?.textContent?.trim() ?? "")}`);
    }
    if (heading?.textContent?.trim() !== "游戏客户端") {
      failures.push(`layout heading is ${JSON.stringify(heading?.textContent?.trim() ?? "")}`);
    }
    for (const selector of forbiddenSelectors) {
      if (designer?.querySelector(selector)) failures.push(`forbidden control exists: ${selector}`);
    }
    for (const label of forbiddenText) {
      if (text.includes(label)) failures.push(`forbidden label exists: ${label}`);
    }
    return {
      ok: failures.length === 0,
      failures,
      tabLabel: layoutTab?.textContent?.trim() ?? "",
      heading: heading?.textContent?.trim() ?? "",
    };
  });
}

async function waitForActiveAdvancedPanelIdle(page) {
  await page.waitForFunction(() => {
    const activePopovers = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    });
    if (activePopovers.length !== 1) return false;
    return activePopovers[0].querySelector(".advanced-tools-panel")?.getAttribute("data-layout-transitioning") !== "true";
  }, null, { timeout: 30000 });
}

async function waitForAdvancedWorkspaceGeometryStable(page) {
  await page.waitForFunction(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => {
      const rect = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return rect.width > 0 && rect.height > 0
        && style.visibility !== "hidden"
        && Number(style.opacity || "1") > 0.01;
    });
    const viewport = popover?.querySelector(".advanced-tab-viewport");
    if (!(popover instanceof HTMLElement) || !(viewport instanceof HTMLElement)) return false;
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return [value.x, value.y, value.width, value.height].map(number => Math.round(number * 4) / 4);
    };
    const sample = [...rect(popover), ...rect(viewport)].join(":");
    const previous = window.__e2WorkspaceGeometryStability;
    const stableFrames = previous?.sample === sample ? previous.stableFrames + 1 : 0;
    window.__e2WorkspaceGeometryStability = { sample, stableFrames };
    return stableFrames >= 3;
  }, null, { timeout: 30000 });
}

async function readLayoutTreeGeometry(page, state) {
  return page.evaluate((requestedState) => {
    const root = requestedState === "warm"
      ? document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]')
      : document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]');
    if (!(root instanceof HTMLElement)) return null;
    const measure = (element) => element instanceof HTMLElement ? {
      width: element.clientWidth,
      height: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    } : null;
    return {
      content: measure(root),
      designer: measure(root.querySelector(".runtime-layout-designer")),
      grid: measure(root.querySelector(".runtime-layout-grid")),
      stageWrap: measure(root.querySelector(".runtime-layout-stage-wrap")),
      stage: measure(root.querySelector(".runtime-layout-stage")),
    };
  }, state);
}

async function readWarmLayoutReadiness(page) {
  return page.evaluate(() => {
    const warm = document.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const designer = warm?.querySelector(".runtime-layout-designer");
    const stage = warm?.querySelector(".runtime-layout-stage");
    return {
      capturedAt: performance.now(),
      present: warm instanceof HTMLElement,
      readyAtInteraction: designer?.getAttribute("data-advanced-tab-ready") === "true"
        && stage instanceof HTMLElement
        && stage.clientWidth > 0
        && stage.clientHeight > 0,
      readyAttribute: designer?.getAttribute("data-advanced-tab-ready") ?? null,
      stageWidth: stage instanceof HTMLElement ? stage.clientWidth : 0,
      stageHeight: stage instanceof HTMLElement ? stage.clientHeight : 0,
    };
  });
}

async function warmLayoutTransitionPath(page) {
  const activePopover = page.locator(
    ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert]):visible",
  );
  const activePopoverCount = await activePopover.count();
  if (activePopoverCount !== 1) {
    throw new Error(`Expected one interactive advanced workspace before warming, found ${activePopoverCount}.`);
  }
  const layoutTab = activePopover.locator('[data-help-key="advanced.tab.layout"]').first();
  const settingsTab = activePopover.locator('[data-help-key="advanced.tab.settings"]').first();

  await layoutTab.click();
  await activePopover.locator('.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-designer')
    .waitFor({ state: "visible", timeout: 30000 });
  await activePopover.locator('.advanced-tab-content.is-active [data-help-key="layout.save"]')
    .waitFor({ state: "visible", timeout: 30000 });
  await waitForActiveAdvancedPanelIdle(page);

  if (PREWARM_LAYOUT_FROM_SETTINGS) {
    const wideGeometry = PREWARM_LAYOUT_GEOMETRY_MODE === "wide"
      ? await activePopover.locator(".advanced-tab-viewport").evaluate((viewport) => {
        const designer = viewport.querySelector(
          '.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-designer',
        );
        const selectors = [
          ".runtime-layout-designer",
          ".runtime-layout-grid",
          ".runtime-layout-sidebar",
          ".runtime-layout-center",
          ".runtime-layout-inspector",
          ".runtime-layout-stage-wrap",
        ];
        const computed = (selector) => {
          const element = designer?.querySelector(selector)
            ?? (selector === ".runtime-layout-designer" ? designer : null);
          if (!(element instanceof HTMLElement)) return null;
          const style = getComputedStyle(element);
          return {
            width: element.clientWidth,
            height: element.clientHeight,
            display: style.display,
            gridTemplateRows: style.gridTemplateRows,
            gridTemplateColumns: style.gridTemplateColumns,
            gap: style.gap,
            padding: style.padding,
            overflow: style.overflow,
          };
        };
        const stage = designer?.querySelector(".runtime-layout-stage");
        return {
          viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
          stage: stage instanceof HTMLElement
            ? { width: stage.clientWidth, height: stage.clientHeight }
            : null,
          rules: Object.fromEntries(selectors.map((selector) => [selector, computed(selector)])),
        };
      })
      : null;
    if (PREWARM_LAYOUT_GEOMETRY_MODE === "wide"
      && (!wideGeometry?.viewport.width || !wideGeometry?.viewport.height
        || !wideGeometry?.stage?.width || !wideGeometry?.stage?.height
        || Object.values(wideGeometry.rules).some((rule) => !rule))) {
      throw new Error(`Could not capture the settled wide layout geometry: ${JSON.stringify(wideGeometry)}`);
    }
    await settingsTab.click();
    await page.waitForFunction(() => {
      const popover = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
      )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
        ?.getAttribute("data-glass-selected") === "true");
      const settings = popover?.querySelector(
        '.advanced-tab-content.is-active[data-tab="settings"] .project-settings-panel',
      );
      const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
      const designer = layout?.querySelector(".runtime-layout-designer");
      const stage = designer?.querySelector(".runtime-layout-stage");
      const layoutStyle = layout instanceof HTMLElement ? getComputedStyle(layout) : null;
      return settings instanceof HTMLElement
        && settings.getBoundingClientRect().width > 0
        && layout instanceof HTMLElement
        && layout.getAttribute("aria-hidden") === "true"
        && layout.hasAttribute("inert")
        && layoutStyle?.opacity === "0"
        && layoutStyle.pointerEvents === "none"
        && designer instanceof HTMLElement
        && stage instanceof HTMLElement
        && stage.clientWidth > 0
        && (!window.__e2LayoutWideWarmGeometryExpected || stage.clientWidth < 1000)
        && !popover?.classList.contains("is-layout-mode");
    }, null, { timeout: 30000 });
    await waitForActiveAdvancedPanelIdle(page);
    await waitForAdvancedWorkspaceGeometryStable(page);
    const settingsWorkspaceBeforeWarm = PREWARM_LAYOUT_GEOMETRY_MODE === "wide"
      ? await page.evaluate(() => {
        const popover = [...document.querySelectorAll(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
        )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
          ?.getAttribute("data-glass-selected") === "true");
        const rect = (element) => {
          const value = element?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        return {
          popover: rect(popover),
          viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
        };
      })
      : null;
    if (wideGeometry) {
      const warmRoot = '.advanced-tab-content.is-warm[data-tab="layout"]';
      const cssRules = [
        `${warmRoot}{width:${wideGeometry.viewport.width}px!important;height:${wideGeometry.viewport.height}px!important;right:auto!important;bottom:auto!important;overflow:hidden!important}`,
        `${warmRoot}>.advanced-tab-scroll{display:grid!important;width:100%!important;height:100%!important;min-height:0!important;overflow:hidden!important;padding:0!important}`,
      ];
      for (const [selector, rule] of Object.entries(wideGeometry.rules)) {
        const scopedSelector = `${warmRoot} ${selector}`;
        const declarations = [
          `width:${rule.width}px!important`,
          `height:${rule.height}px!important`,
          `min-height:0!important`,
          `max-height:none!important`,
          `display:${rule.display}!important`,
          `overflow:hidden!important`,
        ];
        if (rule.gridTemplateRows && rule.gridTemplateRows !== "none") {
          declarations.push(`grid-template-rows:${rule.gridTemplateRows}!important`);
        }
        if (rule.gridTemplateColumns && rule.gridTemplateColumns !== "none") {
          declarations.push(`grid-template-columns:${rule.gridTemplateColumns}!important`);
        }
        if (rule.gap) declarations.push(`gap:${rule.gap}!important`);
        if (selector === ".runtime-layout-stage-wrap" && rule.padding) {
          declarations.push(`padding:${rule.padding}!important`);
        }
        cssRules.push(`${scopedSelector}{${declarations.join(";")}}`);
      }
      cssRules.push(
        `${warmRoot} .runtime-layout-stage{width:${wideGeometry.stage.width}px!important;height:${wideGeometry.stage.height}px!important;min-width:0!important;max-width:none!important;max-height:none!important;aspect-ratio:auto!important}`,
      );
      await page.addStyleTag({ content: cssRules.join("\n") });
      await page.evaluate((geometry) => {
        window.__e2LayoutWideWarmGeometryExpected = geometry.stage.width;
      }, wideGeometry);
      await page.waitForFunction((geometry) => {
        const popover = [...document.querySelectorAll(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
        )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
          ?.getAttribute("data-glass-selected") === "true");
        const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
        const designer = layout?.querySelector(".runtime-layout-designer");
        const stage = designer?.querySelector(".runtime-layout-stage");
        return layout instanceof HTMLElement
          && designer instanceof HTMLElement
          && designer.getAttribute("data-advanced-tab-ready") === "true"
          && stage instanceof HTMLElement
          && Math.abs(stage.clientWidth - geometry.stage.width) <= 2
          && Math.abs(stage.clientHeight - geometry.stage.height) <= 2;
      }, wideGeometry, { timeout: 30000 });
      await waitForAdvancedWorkspaceGeometryStable(page);
    }
    const preparation = await page.evaluate((wideGeometry) => {
      const popover = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
      )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
        ?.getAttribute("data-glass-selected") === "true");
      const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
      const designer = layout?.querySelector(".runtime-layout-designer");
      const stage = layout?.querySelector(".runtime-layout-stage");
      const preview = layout?.querySelector(".runtime-layout-expected-preview");
      const rect = (element) => {
        const value = element?.getBoundingClientRect();
        return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
      };
      const currentWorkspaceGeometry = {
        popover: rect(popover),
        viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
      };
      const activeElementInsideWarmLayer = Boolean(
        layout?.contains(document.activeElement),
      );
      return {
        selectedTab: popover?.querySelector('[data-help-key="advanced.tab.settings"]')
          ?.getAttribute("data-glass-selected") === "true" ? "settings" : null,
        panelWideMode: popover?.classList.contains("is-layout-mode") ?? null,
        layoutLayerState: layout?.className ?? null,
        layoutAriaHidden: layout?.getAttribute("aria-hidden") ?? null,
        layoutInert: layout?.hasAttribute("inert") ?? false,
        layoutOpacity: layout instanceof HTMLElement ? getComputedStyle(layout).opacity : null,
        layoutPointerEvents: layout instanceof HTMLElement ? getComputedStyle(layout).pointerEvents : null,
        layoutMounted: Boolean(layout?.querySelector(".runtime-layout-designer")),
        stageLayoutSize: stage instanceof HTMLElement
          ? { width: stage.clientWidth, height: stage.clientHeight }
          : null,
        previewMounted: Boolean(preview),
        activeElementInsideWarmLayer,
        currentWorkspaceGeometry,
        expectedWorkspaceGeometry: wideGeometry?.settingsWorkspaceBeforeWarm ?? null,
        wideGeometryMode: wideGeometry ? "wide" : "compact",
        warmLayerAriaHidden: layout?.getAttribute("aria-hidden") === "true",
        warmLayerInert: layout?.hasAttribute("inert") ?? false,
        warmLayerOpacity: layout instanceof HTMLElement ? Number.parseFloat(getComputedStyle(layout).opacity) : Number.NaN,
        warmLayerPointerEvents: layout instanceof HTMLElement ? getComputedStyle(layout).pointerEvents : null,
        designerReady: designer instanceof HTMLElement
          && designer.getAttribute("data-advanced-tab-ready") === "true",
      };
    }, wideGeometry ? {
      ...wideGeometry,
      settingsWorkspaceBeforeWarm,
    } : null);
    if (wideGeometry) {
      const stableRect = (before, after) => before && after
        && ["x", "y", "width", "height"].every((key) =>
          Math.abs(before[key] - after[key]) <= 0.5);
      preparation.hiddenWarmFailures = getHiddenWarmLayoutFailures({
        selectedTab: preparation.selectedTab,
        workspaceRectStable: stableRect(
          settingsWorkspaceBeforeWarm?.popover,
          preparation.currentWorkspaceGeometry?.popover,
        ) && stableRect(
          settingsWorkspaceBeforeWarm?.viewport,
          preparation.currentWorkspaceGeometry?.viewport,
        ),
        warmLayerAriaHidden: preparation.warmLayerAriaHidden,
        warmLayerInert: preparation.warmLayerInert,
        warmLayerOpacity: preparation.warmLayerOpacity,
        warmLayerPointerEvents: preparation.warmLayerPointerEvents,
        activeElementInsideWarmLayer: preparation.activeElementInsideWarmLayer,
        designerReady: preparation.designerReady,
        stageWidth: preparation.stageLayoutSize?.width ?? 0,
        stageHeight: preparation.stageLayoutSize?.height ?? 0,
        expectedWideStageWidth: wideGeometry.stage.width,
        expectedWideStageHeight: wideGeometry.stage.height,
      });
    }
    if (PREWARM_LAYOUT_GEOMETRY_MODE === "wide" && preparation.hiddenWarmFailures.length) {
      throw new Error(`Hidden wide-layout warm layer failed ownership/geometry checks: ${JSON.stringify(preparation)}`);
    }
    if (preparation.selectedTab !== "settings"
      || preparation.panelWideMode
      || !preparation.layoutMounted
      || !preparation.stageLayoutSize
      || (PREWARM_LAYOUT_GEOMETRY_MODE === "compact" && preparation.stageLayoutSize.width >= 1000)
      || (PREWARM_LAYOUT_GEOMETRY_MODE === "wide" && preparation.stageLayoutSize.width < 1000)
      || !preparation.previewMounted) {
      throw new Error(`Prewarmed layout did not reach the requested geometry while settings remained active: ${JSON.stringify(preparation)}`);
    }
    return preparation;
  }

  if (process.env.AGENTVN_ADVANCED_PERF_PREPARE_WIDE_TARGET_GEOMETRY === "1") {
    if (PERFORMANCE_TARGET_TAB !== "theme") throw new Error("Prepared geometry probe currently requires theme.");
    await activePopover.locator(".advanced-tab-viewport").evaluate((viewport) => {
      // Layout dimensions, not the current FLIP-transformed presentation.
      window.__e2WarmWideViewportGeometry = { width: viewport.offsetWidth, height: viewport.offsetHeight };
    });
  }

  if (process.env.AGENTVN_ADVANCED_PERF_WARM_TARGET === "1" && PERFORMANCE_TARGET_TAB === "theme") {
    await activePopover.locator('[data-help-key="advanced.tab.theme"]').first().click();
    await activePopover.locator('.advanced-tab-content.is-active[data-tab="theme"] .runtime-theme-designer')
      .waitFor({ state: "visible", timeout: 30000 });
    await waitForActiveAdvancedPanelIdle(page);
  }

  if (process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1") {
    const themeTab = activePopover.locator('[data-help-key="advanced.tab.theme"]').first();
    const switchToTheme = async () => {
      await themeTab.click();
      await page.waitForFunction(() => (
        document.querySelector('.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) [data-help-key="advanced.tab.theme"]')
          ?.getAttribute("data-glass-selected") === "true"
        && document.querySelector('.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-active[data-tab="theme"]')
      ), null, { timeout: 30000 });
      await activePopover.locator('.advanced-tab-content.is-active[data-tab="theme"] .runtime-theme-designer')
        .waitFor({ state: "visible", timeout: 30000 });
      await waitForActiveAdvancedPanelIdle(page);
    };
    await switchToTheme();
    await layoutTab.click();
    await page.waitForFunction(() => (
      document.querySelector('.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) [data-help-key="advanced.tab.layout"]')
        ?.getAttribute("data-glass-selected") === "true"
      && document.querySelector('.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-active[data-tab="layout"]')
    ), null, { timeout: 30000 });
    await activePopover.locator('.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-designer')
      .waitFor({ state: "visible", timeout: 30000 });
    await waitForActiveAdvancedPanelIdle(page);
    if (PERFORMANCE_WARM_WIDE_END_TAB === "theme") await switchToTheme();
    await page.waitForTimeout(120);
    return;
  }

  await page.evaluate(() => {
    window.__e2LayoutWarmClickTrace = [];
    document.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-help-key="advanced.tab.settings"]')
        : null;
      if (target) window.__e2LayoutWarmClickTrace.push({
        type: "pointerdown",
        isTrusted: event.isTrusted,
        target: target.outerHTML.slice(0, 240),
        x: event.clientX,
        y: event.clientY,
      });
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-help-key="advanced.tab.settings"]')
        : null;
      if (target) window.__e2LayoutWarmClickTrace.push({
        type: "click",
        isTrusted: event.isTrusted,
        selectedAtClick: target.getAttribute("data-glass-selected"),
      });
    }, true);
  });
  await settingsTab.click();
  try {
    await page.waitForFunction(() => {
      const popover = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
      )].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
      });
      if (!popover) return false;
      const settingsTab = popover.querySelector('[data-help-key="advanced.tab.settings"]');
      const activeSettings = popover.querySelector('.advanced-tab-content.is-active[data-tab="settings"] .project-settings-panel');
      return settingsTab?.getAttribute("data-glass-selected") === "true"
        && activeSettings instanceof HTMLElement
        && activeSettings.getBoundingClientRect().width > 0
        && activeSettings.getBoundingClientRect().height > 0;
    }, null, {
      timeout: 6000,
    });
  } catch (error) {
    const state = await page.evaluate(() => {
      const summarize = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          dataTab: element.dataset.tab ?? null,
          selected: element.getAttribute("data-glass-selected"),
          transitioning: element.getAttribute("data-layout-transitioning"),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          visibility: style.visibility,
          opacity: style.opacity,
          inert: element.inert,
          ariaHidden: element.getAttribute("aria-hidden"),
        };
      };
      const popovers = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced",
      )].map((popover) => ({
        ...summarize(popover),
        tabs: [...popover.querySelectorAll('[data-help-key^="advanced.tab."]')].map((tab) => ({
          label: tab.textContent?.trim() ?? "",
          key: tab.getAttribute("data-help-key"),
          selected: tab.getAttribute("data-glass-selected"),
          disabled: tab.getAttribute("aria-disabled"),
        })),
        activeContents: [...popover.querySelectorAll(".advanced-tab-content.is-active")].map((content) => ({
          ...summarize(content),
          layoutDesigner: summarize(content.querySelector(".runtime-layout-designer")),
          settingsPanel: summarize(content.querySelector(".project-settings-panel")),
        })),
        allSettingsPanels: [...popover.querySelectorAll(".project-settings-panel")].map(summarize),
      }));
      return {
        capturedAt: performance.now(),
        popovers,
        settingsTabDetails: [...document.querySelectorAll('[data-help-key="advanced.tab.settings"]')].map((tab) => {
          const rect = tab.getBoundingClientRect();
          const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return {
            ...summarize(tab),
            text: tab.textContent?.trim() ?? "",
            hitTarget: center instanceof Element ? center.outerHTML.slice(0, 240) : null,
          };
        }),
        clickTrace: window.__e2LayoutWarmClickTrace ?? [],
        activeElement: summarize(document.activeElement),
        transitionStates: [...document.querySelectorAll(".advanced-tools-panel")].map((panel) => ({
          className: panel.className,
          transitioning: panel.getAttribute("data-layout-transitioning"),
          tabContents: [...panel.querySelectorAll(".advanced-tab-content")].map((content) => ({
            tab: content.dataset.tab,
            active: content.classList.contains("is-active"),
            ariaHidden: content.getAttribute("aria-hidden"),
          })),
        })),
        activeWorkspaces: document.querySelectorAll(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
        ).length,
      };
    });
    throw new Error(`Timed out waiting for the settings workspace after layout warm-up: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
  await activePopover.locator('.advanced-tab-content.is-active[data-tab="settings"] .project-settings-panel')
    .waitFor({ state: "visible", timeout: 30000 });
  await waitForActiveAdvancedPanelIdle(page);
  await page.waitForTimeout(120);
}

async function prepareInitiallyMountedHiddenWideLayout(page) {
  await waitForActiveAdvancedPanelIdle(page);
  await waitForAdvancedWorkspaceGeometryStable(page);
  const settingsWorkspaceBeforeWarm = await page.evaluate(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    return {
      selectedTab: popover?.querySelector('[data-help-key="advanced.tab.settings"]')
        ?.getAttribute("data-glass-selected") === "true" ? "settings" : null,
      popover: rect(popover),
      viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
    };
  });
  if (settingsWorkspaceBeforeWarm.selectedTab !== "settings") {
    throw new Error(`Initial warm-layer setup did not start on settings: ${JSON.stringify(settingsWorkspaceBeforeWarm)}`);
  }
  await page.waitForFunction(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    return layout instanceof HTMLElement
      && layout.querySelector(".runtime-layout-designer")
      && layout.hasAttribute("inert")
      && layout.getAttribute("aria-hidden") === "true";
  }, null, { timeout: 30000 });
  await page.addStyleTag({ content: INITIAL_WIDE_LAYOUT_WARM_CSS });
  await page.waitForFunction(() => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const designer = layout?.querySelector(".runtime-layout-designer");
    const stage = designer?.querySelector(".runtime-layout-stage");
    return designer instanceof HTMLElement
      && designer.getAttribute("data-advanced-tab-ready") === "true"
      && stage instanceof HTMLElement
      && Math.abs(stage.clientWidth - 2728) <= 2
      && Math.abs(stage.clientHeight - 1534) <= 2;
  }, null, { timeout: 30000 });
  await waitForAdvancedWorkspaceGeometryStable(page);
  const preparation = await page.evaluate((baseline) => {
    const popover = [...document.querySelectorAll(
      ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
    )].find(candidate => candidate.querySelector('[data-help-key="advanced.tab.settings"]')
      ?.getAttribute("data-glass-selected") === "true");
    const layout = popover?.querySelector('.advanced-tab-content.is-warm[data-tab="layout"]');
    const designer = layout?.querySelector(".runtime-layout-designer");
    const stage = designer?.querySelector(".runtime-layout-stage");
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    return {
      selectedTab: popover?.querySelector('[data-help-key="advanced.tab.settings"]')
        ?.getAttribute("data-glass-selected") === "true" ? "settings" : null,
      panelWideMode: popover?.classList.contains("is-layout-mode") ?? null,
      layoutLayerState: layout?.className ?? null,
      layoutAriaHidden: layout?.getAttribute("aria-hidden") === "true",
      layoutInert: layout?.hasAttribute("inert") ?? false,
      layoutOpacity: layout instanceof HTMLElement ? Number.parseFloat(getComputedStyle(layout).opacity) : Number.NaN,
      layoutPointerEvents: layout instanceof HTMLElement ? getComputedStyle(layout).pointerEvents : null,
      activeElementInsideWarmLayer: Boolean(layout?.contains(document.activeElement)),
      designerReady: designer instanceof HTMLElement
        && designer.getAttribute("data-advanced-tab-ready") === "true",
      stageLayoutSize: stage instanceof HTMLElement
        ? { width: stage.clientWidth, height: stage.clientHeight }
        : null,
      stageWillChange: stage instanceof HTMLElement ? getComputedStyle(stage).willChange : null,
      previewMounted: Boolean(layout?.querySelector(".runtime-layout-expected-preview")),
      settingsWorkspaceBeforeWarm: baseline,
      currentWorkspaceGeometry: {
        popover: rect(popover),
        viewport: rect(popover?.querySelector(".advanced-tab-viewport")),
      },
    };
  }, settingsWorkspaceBeforeWarm);
  const stableRect = (before, after) => before && after
    && ["x", "y", "width", "height"].every(key => Math.abs(before[key] - after[key]) <= 0.5);
  preparation.hiddenWarmFailures = getHiddenWarmLayoutFailures({
    selectedTab: preparation.selectedTab,
    workspaceRectStable: stableRect(
      settingsWorkspaceBeforeWarm.popover,
      preparation.currentWorkspaceGeometry?.popover,
    ) && stableRect(
      settingsWorkspaceBeforeWarm.viewport,
      preparation.currentWorkspaceGeometry?.viewport,
    ),
    warmLayerAriaHidden: preparation.layoutAriaHidden,
    warmLayerInert: preparation.layoutInert,
    warmLayerOpacity: preparation.layoutOpacity,
    warmLayerPointerEvents: preparation.layoutPointerEvents,
    activeElementInsideWarmLayer: preparation.activeElementInsideWarmLayer,
    designerReady: preparation.designerReady,
    stageWidth: preparation.stageLayoutSize?.width ?? 0,
    stageHeight: preparation.stageLayoutSize?.height ?? 0,
    expectedWideStageWidth: 2728,
    expectedWideStageHeight: 1534,
  });
  if (preparation.hiddenWarmFailures.length) {
    throw new Error(`Initially pre-mounted hidden wide layout failed checks: ${JSON.stringify(preparation)}`);
  }
  preparation.layoutGeometry = await readLayoutTreeGeometry(page, "warm");
  return preparation;
}

async function waitForMeasuredTransitionToSettle(page, targetTab) {
  try {
    await page.waitForFunction((tab) => {
      const popover = document.querySelector(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)",
      );
      const panel = popover?.querySelector(".advanced-tools-panel");
      const active = popover?.querySelector(".advanced-tab-content.is-active");
      if (!popover || !panel || active?.dataset.tab !== tab
        || !panel.classList.contains("is-tab-idle")
        || popover.querySelector(".advanced-tab-content.is-entering, .advanced-tab-content.is-leaving")
        || document.querySelector(".toolbar-popover-morph-ghost, [data-geometry-snapshot-owner]")) return false;
      const animations = [
        ...popover.getAnimations(),
        ...active.getAnimations(),
        ...[...popover.querySelectorAll(".advanced-tab-content")].flatMap(node => node.getAnimations()),
      ];
      return animations.every(animation => !animation.pending && animation.playState !== "running");
    }, targetTab, { timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate((tab) => {
      const popover = document.querySelector(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)",
      );
      const panel = popover?.querySelector(".advanced-tools-panel");
      const active = popover?.querySelector(".advanced-tab-content.is-active");
      const stage = popover?.querySelector(".runtime-layout-stage");
      const stageRect = stage?.getBoundingClientRect();
      const animationState = (animation, owner) => ({
        owner,
        name: animation.animationName ?? animation.effect?.getTiming?.().easing ?? null,
        playState: animation.playState,
        pending: animation.pending,
        currentTime: animation.currentTime,
        duration: animation.effect?.getTiming?.().duration ?? null,
        target: animation.effect?.target instanceof Element
          ? `${animation.effect.target.tagName}.${String(animation.effect.target.className).slice(0, 100)}`
          : null,
      });
      return {
        targetTab: tab,
        activeTab: active?.dataset.tab ?? null,
        popover: popover ? {
          className: popover.className,
          ariaHidden: popover.getAttribute("aria-hidden"),
          inert: popover.hasAttribute("inert"),
          rect: (() => {
            const rect = popover.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          })(),
        } : null,
        panelClassName: panel?.className ?? null,
        stage: stageRect ? {
          width: stageRect.width,
          height: stageRect.height,
          className: stage?.className ?? null,
        } : null,
        firstMountObserverCalls: window.__e2FirstMountObserverProbe?.calls ?? null,
        tabs: [...(popover?.querySelectorAll(".advanced-tab-content") ?? [])].map((node) => ({
          tab: node.dataset.tab,
          className: node.className,
          ariaHidden: node.getAttribute("aria-hidden"),
          inert: node.hasAttribute("inert"),
        })),
        ghosts: [...document.querySelectorAll(".toolbar-popover-morph-ghost, [data-geometry-snapshot-owner]")]
          .map((node) => `${node.tagName}.${String(node.className).slice(0, 120)}`),
        animations: [
          ...(popover?.getAnimations() ?? []).map(animation => animationState(animation, "popover")),
          ...(active?.getAnimations() ?? []).map(animation => animationState(animation, "active")),
          ...[...(popover?.querySelectorAll(".advanced-tab-content") ?? [])]
            .flatMap(node => node.getAnimations().map(animation =>
              animationState(animation, `tab:${node.dataset.tab}`))),
        ],
        focusedElement: document.activeElement instanceof Element
          ? `${document.activeElement.tagName}.${String(document.activeElement.className).slice(0, 120)}`
          : null,
      };
    }, targetTab).catch((diagnosticError) => ({ diagnosticError: String(diagnosticError) }));
    throw new Error(
      `Timed out waiting for measured transition to settle; state=${JSON.stringify(state)}`,
      { cause: error },
    );
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function readAnimationTimelineClockAnchor(page, phase) {
  const nodeBefore = nodePerformance.now();
  const browserTime = await page.evaluate(() => performance.now());
  const nodeAfter = nodePerformance.now();
  return { phase, nodeBefore, browserTime, nodeAfter };
}

async function startGlassAnimationTimelineCapture(page) {
  const session = await page.context().newCDPSession(page);
  const events = [];
  await session.send("DOM.enable");
  await session.send("Runtime.enable");
  await session.send("Animation.enable");
  session.on("Animation.animationStarted", ({ animation }) => {
    events.push({
      event: "started",
      animationId: String(animation?.id ?? ""),
      backendNodeId: Number(animation?.source?.backendNodeId) || null,
      receivedAt: nodePerformance.now(),
      sourceStartTime: Number(animation?.startTime),
      durationMs: Number(animation?.source?.duration),
      animationType: String(animation?.type ?? ""),
      animationName: String(animation?.name ?? ""),
    });
  });
  session.on("Animation.animationCanceled", ({ id }) => {
    events.push({
      event: "canceled",
      animationId: String(id ?? ""),
      receivedAt: nodePerformance.now(),
    });
  });
  return { session, events };
}

async function resolveGlassAnimationTarget(session, backendNodeId) {
  if (!Number.isFinite(Number(backendNodeId))) return null;
  let objectId;
  try {
    const resolved = await session.send("DOM.resolveNode", {
      backendNodeId: Number(backendNodeId),
    });
    objectId = resolved?.object?.objectId;
    if (!objectId) return null;
    const response = await session.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function () {
        const indicator = this.closest?.(".glass-selection-indicator")
          ?? (this.matches?.(".glass-selection-indicator") ? this : null);
        const group = indicator?.closest(".glass-selection-group");
        if (!indicator || !group) return null;
        if (group.matches(".advanced-tools-panel > nav.glass-selection-group"))
          return ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator";
        if (group.classList.contains("runtime-layout-sidebar"))
          return ".runtime-layout-sidebar .glass-selection-indicator";
        return null;
      }`,
      returnByValue: true,
    });
    return typeof response?.result?.value === "string" ? response.result.value : null;
  } catch {
    return null;
  } finally {
    if (objectId) await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  }
}

async function finishGlassAnimationTimelineCapture(page, capture, loafFrames) {
  if (!capture) return null;
  const afterAnchors = [];
  for (let index = 0; index < 3; index += 1) {
    afterAnchors.push(await readAnimationTimelineClockAnchor(page, `after-${index + 1}`));
  }
  const alignment = alignMonotonicClocks([...capture.beforeAnchors, ...afterAnchors]);
  const targetByNodeId = new Map();
  const backendNodeIds = [...new Set(capture.events
    .map(event => event.backendNodeId)
    .filter(Number.isFinite))];
  for (const backendNodeId of backendNodeIds) {
    targetByNodeId.set(
      backendNodeId,
      await resolveGlassAnimationTarget(capture.session, backendNodeId),
    );
  }
  const targetByAnimationId = new Map(capture.events
    .filter(event => event.event === "started")
    .map(event => [event.animationId, targetByNodeId.get(event.backendNodeId) ?? null]));
  const normalizedEvents = capture.events.map(event => ({
    event: event.event,
    animationId: event.animationId,
    target: event.event === "started"
      ? targetByNodeId.get(event.backendNodeId) ?? null
      : targetByAnimationId.get(event.animationId) ?? null,
    at: event.receivedAt + alignment.offsetMs,
    ...(event.event === "started" ? {
      durationMs: event.durationMs,
      animationType: event.animationType,
      animationName: event.animationName,
      sourceStartTime: Number.isFinite(event.sourceStartTime) ? event.sourceStartTime : null,
    } : {}),
  }));
  const resolvedEvents = normalizedEvents.filter(event => event.target);
  const summary = summarizeGlassAnimationTimeline(resolvedEvents, loafFrames);
  return {
    clock: {
      basis: "Node monotonic event-receipt time aligned to browser performance.now()",
      offsetMs: alignment.offsetMs,
      uncertaintyMs: alignment.uncertaintyMs,
      anchorCount: alignment.anchorCount,
      anchors: alignment.anchors,
    },
    eventDeliveryLatencyMeasured: false,
    scopeLimitations: [
      "CDP event delivery latency is not measured; overlaps are coarse timeline evidence, not frame-level causality.",
      "Animation-domain events do not observe JavaScript requestAnimationFrame style writes or spring state.",
    ],
    nonTargetOrUnresolvedEventCount: normalizedEvents.length - resolvedEvents.length,
    events: normalizedEvents,
    summary,
  };
}

async function installGlassStyleWriteTimelineCapture(page, mode) {
  return page.evaluate((diagnosticMode) => {
    const selector = ".advanced-tools-panel > nav.glass-selection-group .glass-selection-indicator";
    const indicator = document.querySelector(selector);
    if (!(indicator instanceof HTMLElement)) {
      return { installed: false, selector, error: "advanced navigation indicator was not present" };
    }
    const style = indicator.style;
    const properties = ["width", "height", "transform", "opacity"];
    const events = [];
    const state = {
      mode: diagnosticMode,
      active: false,
      droppedEventCount: 0,
      instrumentedProperties: [],
      errors: [],
      begin() { this.active = true; },
      stop() {
        this.active = false;
        return {
          events: [...events],
          droppedEventCount: this.droppedEventCount,
          instrumentedProperties: [...this.instrumentedProperties],
          errors: [...this.errors],
        };
      },
    };
    for (const property of properties) {
      try {
        const read = () => style.getPropertyValue(property);
        Object.defineProperty(style, property, {
          configurable: true,
          enumerable: false,
          get: read,
          set(value) {
            const previousValue = read();
            if (state.mode !== "suppress") style.setProperty(property, String(value));
            if (!state.active) return;
            if (events.length >= 4096) {
              state.droppedEventCount += 1;
              return;
            }
            events.push({
              event: "style-write",
              target: selector,
              property,
              at: performance.now(),
              previousValue,
              requestedValue: String(value),
              nextValue: read(),
              applied: state.mode !== "suppress",
            });
          },
        });
        state.instrumentedProperties.push(property);
      } catch (error) {
        state.errors.push(`${property}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    window.__e2GlassStyleWriteTimeline = state;
    return {
      installed: state.instrumentedProperties.length === properties.length,
      selector,
      mode: diagnosticMode,
      instrumentedProperties: state.instrumentedProperties,
      errors: state.errors,
    };
  }, mode);
}

async function openAuditPage(browser, options = {}) {
  if (!persistentBrowserContext) return browser.newPage(options);
  const page = await persistentBrowserContext.newPage();
  if (options.viewport) await page.setViewportSize(options.viewport);
  return page;
}

function getPersistentProfileDiskEvidence(profileDirectory) {
  if (!fs.existsSync(profileDirectory)) {
    return {
      exists: false,
      localStatePresent: false,
      gpuCacheFileCount: 0,
      gpuCacheBytes: 0,
      cacheDirectories: [],
    };
  }

  const rootStat = fs.lstatSync(profileDirectory);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Persistent browser profile must be a real directory, not a link.");
  }

  const cacheDirectories = [];
  const countFiles = (directory, depth = 0) => {
    if (depth > 8) return { fileCount: 0, bytes: 0 };
    let fileCount = 0;
    let bytes = 0;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        const nested = countFiles(entryPath, depth + 1);
        fileCount += nested.fileCount;
        bytes += nested.bytes;
      } else if (stat.isFile()) {
        fileCount += 1;
        bytes += stat.size;
      }
    }
    return { fileCount, bytes };
  };
  const visit = (directory, depth = 0) => {
    if (depth > 8) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(directory, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (/^(?:GPUCache|GrShaderCache|ShaderCache)$/i.test(entry.name)) {
        const contents = countFiles(entryPath);
        cacheDirectories.push({
          directory: path.relative(profileDirectory, entryPath),
          fileCount: contents.fileCount,
          bytes: contents.bytes,
        });
      } else {
        visit(entryPath, depth + 1);
      }
    }
  };
  visit(profileDirectory);
  return {
    exists: true,
    localStatePresent: fs.existsSync(path.join(profileDirectory, "Local State")),
    gpuCacheFileCount: cacheDirectories.reduce((total, entry) => total + entry.fileCount, 0),
    gpuCacheBytes: cacheDirectories.reduce((total, entry) => total + entry.bytes, 0),
    cacheDirectories,
  };
}

async function runPerformanceDiagnosticTrial(browser, viewport, mode, repeat) {
  const page = await openAuditPage(browser, {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1" ? "reduce" : "no-preference",
  });
  await page.bringToFront();
  const nativeWindowSession = await browser.newBrowserCDPSession();
  const nativePageSession = await page.context().newCDPSession(page);
  const { targetInfo: nativeTargetInfo } = await nativePageSession.send("Target.getTargetInfo");
  const nativeWindow = await nativeWindowSession.send("Browser.getWindowForTarget",
    { targetId: nativeTargetInfo.targetId });
  await nativePageSession.detach();
  page.__e2CaptureNativeWindowState = async phase => {
    const requestedAt = new Date().toISOString();
    const state = await nativeWindowSession.send("Browser.getWindowBounds", { windowId: nativeWindow.windowId });
    const sample = { phase, windowId: nativeWindow.windowId, requestedAt,
      receivedAt: new Date().toISOString(), ...state };
    (page.__e2NativeWindowStates ??= []).push(sample);
    return sample;
  };
  let profiler;
  let tracer;
  let layerTreeSession;
  let glassAnimationSession;
  let glassAnimationCapture;
  let glassAnimationTimelineDiagnostic;
  let glassStyleWriteTimelineSetup;
  let glassStyleWriteTimelineCapture;
  let glassStyleWriteTimelineDiagnostic;
  let genericCompositorWarmupDiagnostic = null;
  let latestLayerTree = [];
  const layerTreeSnapshotRecords = [];
  const layerTreeClockAnchors = [];
  let layerTreeBrowserSnapshots = [];
  let layerTreeClockAlignment;
  let layerTreeChangeCount = 0;
  let layerTreeSnapshots = 0;
  let profile;
  let traceEvents;
  let hoverHelpEvidence = null;
  let readinessConditionDiagnostic;
  let earlyWideModeBundlePatch;
  let prewarmedLayoutBundlePatch;
  let initialLayoutBundlePatch;
  let syncPhaseSourcePatch;
  const postSnapshotSourcePatches = {};
  let entryPreparationWindow;
  let warmLayoutReadinessEvidence = null;
  let sourceWarmOpacityEvidence = null;
  let warmDescendantStyleEvidence = null;
  let warmStartOpacityPatch = null;
  let warmTopLayerEvidence = null;
  let shaderCacheBefore;
  let shaderCacheAfter;
  const captureLayerTreeClockAnchor = async (phase = "") => {
    const nodeBefore = nodePerformance.now();
    const browserTime = await page.evaluate(() => performance.now());
    const nodeAfter = nodePerformance.now();
    return { phase, nodeBefore, browserTime, nodeAfter };
  };
  const captureLayerTreeClockAnchorGroup = async (phase, sampleCount = 3) => {
    for (let index = 0; index < sampleCount; index += 1) {
      layerTreeClockAnchors.push(await captureLayerTreeClockAnchor(phase));
    }
  };
  const getLayerTreeClockAnchorsForAlignment = () => (
    TRACE_FROM_NAVIGATION_DIAGNOSTIC
      ? selectPreparationClockAnchors(layerTreeClockAnchors)
      : layerTreeClockAnchors
  );
  const alignLayerTreeClockAndSnapshots = () => {
    layerTreeClockAlignment = alignMonotonicClocks(getLayerTreeClockAnchorsForAlignment());
    layerTreeBrowserSnapshots = layerTreeSnapshotRecords.map((snapshot, index) => ({
      index,
      receivedAt: snapshot.receivedAt + layerTreeClockAlignment.offsetMs,
      layers: snapshot.layers,
    }));
  };
  const startTraceCapture = async () => {
    if (tracer) return;
    tracer = await page.context().newCDPSession(page);
    traceEvents = [];
    tracer.on("Tracing.dataCollected", (event) => traceEvents.push(...event.value));
    await tracer.send("Tracing.start", {
      categories: process.env.AGENTVN_ADVANCED_PERF_TRACE_RENDERER === "1"
        ? "devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,toplevel,cc,viz,gpu,renderer.scheduler"
          + (SHADER_TRACE_ENABLED ? ",disabled-by-default-skia.shaders" : "")
        : "devtools.timeline,disabled-by-default-devtools.timeline",
      transferMode: "ReportEvents",
    });
  };
  const startLayerTreeCapture = async () => {
    if (layerTreeSession) return;
    layerTreeSession = await page.context().newCDPSession(page);
    await layerTreeSession.send("DOM.enable");
    layerTreeSession.on("LayerTree.layerTreeDidChange", recordLayerTreeSnapshot);
    await layerTreeSession.send("LayerTree.enable");
    if (layerTreeChangeCount === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (layerTreeChangeCount === 0) {
      throw new Error("Layer-tree/raster attribution received no initial LayerTree snapshot.");
    }
  };
  const recordLayerTreeSnapshot = (event) => {
    const receivedAt = nodePerformance.now();
    const layers = Array.isArray(event.layers) ? event.layers.map((layer) => ({ ...layer })) : [];
    layerTreeChangeCount += 1;
    layerTreeSnapshots += 1;
    latestLayerTree = layers;
    layerTreeSnapshotRecords.push({ receivedAt, layers });
  };
  try {
    if (POST_SNAPSHOT_TIMING_DIAGNOSTIC && mode === "low-intrusion" && repeat === 1) {
      await installPostSnapshotTimingInit(page);
      for (const moduleName of ["AdvancedToolsPanel", "RuntimeLayoutDesigner"]) {
        await page.route(new RegExp(`/src/components/advanced/${moduleName}\\.tsx(?:\\?.*)?$`), async (route) => {
          const response = await route.fetch();
          const original = await response.text();
          const patch = instrumentPostSnapshotSource(original, moduleName, {
            freezeStageSizeDuringTransition: FREEZE_STAGE_SIZE_DIAGNOSTIC,
          });
          if (!patch.valid) throw new Error(`Post-snapshot source probe failed: ${patch.failures.join("; ")}`);
          postSnapshotSourcePatches[moduleName] = {
            valid: true, matches: patch.matches,
            originalSha256: createHash("sha256").update(original).digest("hex"),
            instrumentedSha256: createHash("sha256").update(patch.source).digest("hex"),
          };
          await route.fulfill({ response, body: patch.source });
        });
      }
    }
    if (SYNC_PHASE_TIMING_DIAGNOSTIC && mode === "low-intrusion" && repeat === 1) {
      await page.route(/\/src\/components\/editor\/EditorToolbar\.tsx(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const transformed = instrumentPopoverSnapshotSource(original);
        if (transformed.failures.length > 0 || transformed.matches !== 9) {
          throw new Error(
            `Synchronous snapshot source probe failed exact-anchor validation: ${transformed.failures.join("; ")}`,
          );
        }
        syncPhaseSourcePatch = {
          url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          instrumentedSha256: createHash("sha256").update(transformed.source).digest("hex"),
          originalSourceUnchanged: true,
          anchorCount: transformed.matches,
          markerCount: transformed.markerNames.length,
          markerNames: transformed.markerNames,
        };
        let source = transformed.source;
        if (POST_SNAPSHOT_TIMING_DIAGNOSTIC) {
          const patch = instrumentPostSnapshotSource(source, "EditorToolbar");
          if (!patch.valid) throw new Error(`Post-snapshot source probe failed: ${patch.failures.join("; ")}`);
          postSnapshotSourcePatches.EditorToolbar = {
            valid: true, matches: patch.matches,
            originalSha256: createHash("sha256").update(original).digest("hex"),
            instrumentedSha256: createHash("sha256").update(patch.source).digest("hex"),
          };
          source = patch.source;
        }
        syncPhaseSourcePatch.instrumentedSha256 = createHash("sha256").update(source).digest("hex");
        await route.fulfill({ response, body: source });
      });
    }
    if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS) {
      await page.route(/\/assets\/AdvancedToolsPanel-[^/]+\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const transformed = preMountLayoutTabDiagnostic(original);
        initialLayoutBundlePatch = {
          url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          modifiedSha256: createHash("sha256").update(transformed.source).digest("hex"),
          originalBuildUnchanged: true,
          initializerMatches: transformed.matches,
          change: "diagnostic-only: include layout in the initially mounted tabs while settings remains the active owner",
        };
        await route.fulfill({ response, body: transformed.source });
      });
    } else if (PREWARM_LAYOUT_FROM_SETTINGS) {
      await page.route(/\/assets\/AdvancedToolsPanel-[^/]+\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const transformed = retainLayoutMountedOnSettingsReturnDiagnostic(original);
        prewarmedLayoutBundlePatch = {
          url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          modifiedSha256: createHash("sha256").update(transformed.source).digest("hex"),
          originalBuildUnchanged: true,
          cleanupMatches: transformed.matches,
          change: "diagnostic-only: retain the mounted layout tab as its existing warm/inert layer when returning to settings",
        };
        await route.fulfill({ response, body: transformed.source });
      });
    }
    if (REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT) {
      await page.route(/\/assets\/AdvancedToolsPanel-[^/]+\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const transformed = reorderWideModeBeforeLayoutMountDiagnostic(original);
        earlyWideModeBundlePatch = {
          url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          modifiedSha256: createHash("sha256").update(transformed.source).digest("hex"),
          originalBuildUnchanged: true,
          mountOrderMatches: transformed.mountOrderMatches,
          commitOrderMatches: transformed.commitOrderMatches,
          change: "begin the existing wide-mode morph before mounting/measuring the target layout page; deduplicated later mode sync remains removed",
        };
        await route.fulfill({ response, body: transformed.source });
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_REQUIRE_THEME_CONTENT === "1") {
      await page.route(/\/assets\/AdvancedToolsPanel-[^/]+\.js(?:\?.*)?$/, async (route) => {
        const response = await route.fetch();
        const original = await response.text();
        const needle = 'const I=P==null?void 0:P.querySelector("[data-advanced-tab-ready]");';
        if (original.split(needle).length !== 2) {
          throw new Error("Readiness code probe does not match this production bundle exactly once.");
        }
        const modified = original.replace(needle, `${needle}if(r==="theme"&&(!P.querySelector(".runtime-theme-designer")||P.querySelector(".advanced-tab-loading"))){p=0;continue}`);
        readinessConditionDiagnostic = {
          url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          modifiedSha256: createHash("sha256").update(modified).digest("hex"),
          condition: "theme requires actual designer with no fallback before two ready frames",
          originalBuildUnchanged: true,
        };
        await route.fulfill({ response, body: modified });
      });
    }
    if (TRACE_FROM_NAVIGATION_DIAGNOSTIC
      && mode === "low-intrusion"
      && repeat === 1) {
      await startTraceCapture();
    }
    if (REACT_COMMIT_DIAGNOSTIC) await installReactCommitProbe(page);
    if (WARM_DESCENDANT_READ_ATTRIBUTION.mode?.endsWith("zero-warm-start") && mode === "low-intrusion") {
      await page.route(/\/src\/components\/advanced\/AdvancedToolsPanel\.tsx(?:\?.*)?$/, async route => {
        const response = await route.fetch();
        const original = await response.text();
        const patch = instrumentWarmStartOpacitySource(original);
        warmStartOpacityPatch = { valid: patch.valid, matches: patch.matches, url: route.request().url(),
          originalSha256: createHash("sha256").update(original).digest("hex"),
          modifiedSha256: createHash("sha256").update(patch.source).digest("hex"),
          originalSourceFileUnchanged: true, kind: "response-only-warm-hidden-start-opacity-zero-not-acceptance" };
        await route.fulfill({ response, body: patch.source });
      });
    }
    await installDeterministicProjectFixture(page);
    await openAdvancedSettings(
      page,
      TRACE_FROM_NAVIGATION_DIAGNOSTIC
        && mode === "low-intrusion"
        && repeat === 1
        ? startLayerTreeCapture
        : undefined,
    );
    if (PERFORMANCE_DIAGNOSTIC_ONLY) await installHoverHelpTimelineProbe(page);
    if (WARM_DESCENDANT_STYLE_DIAGNOSTIC.enabled && mode === "low-intrusion") {
      await page.waitForFunction(() => document.querySelector(
        '.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-designer')
        ?.getAttribute("data-advanced-tab-ready") === "true", null, { timeout: 30_000 });
      warmDescendantStyleEvidence = await page.evaluate(installWarmDescendantStyleDiagnostic,
        { prepaint: WARM_DESCENDANT_PREPAINT_MODE === "style-opacity" });
      warmDescendantStyleEvidence.state = await readSourceWarmOpacityState(page);
      const warmState = warmDescendantStyleEvidence.state;
      if (!warmState.inert || !warmState.ariaHidden || warmState.pointerEvents !== "none"
        || warmState.activeElementInside || !warmState.designerReady || !warmState.previewMounted
        || warmState.opacity !== warmDescendantStyleEvidence.hiddenOpacity)
        throw new Error(`Warm-style preparation violates hidden ownership: ${JSON.stringify(warmState)}`);
    }
    if (SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC) {
      sourceWarmOpacityEvidence = await applySourceWarmOpacityDiagnostic(page);
      if (!sourceWarmOpacityEvidence.ok) {
        throw new Error(
          `Current-source opacity override changed hidden layout state: ${JSON.stringify(sourceWarmOpacityEvidence)}`,
        );
      }
    }
    if (GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC && mode === "low-intrusion") {
      glassStyleWriteTimelineSetup = await installGlassStyleWriteTimelineCapture(
        page,
        GLASS_STYLE_WRITE_MODE,
      );
      if (!glassStyleWriteTimelineSetup.installed) {
        throw new Error(`Glass style-write timeline instrumentation failed: ${JSON.stringify(glassStyleWriteTimelineSetup)}`);
      }
    }
    if (REACT_COMMIT_DIAGNOSTIC) {
      const reactProbe = await page.evaluate(() => window.__e2ReactCommitProbe ?? null);
      if (!reactProbe?.installed || reactProbe.rendererCount < 1) {
        throw new Error(`React commit hook was not installed by the production renderer: ${JSON.stringify(reactProbe)}`);
      }
    }
    if (REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT && !earlyWideModeBundlePatch) {
      throw new Error(
        "Early wide-mode diagnostic route did not intercept the production AdvancedToolsPanel bundle.",
      );
    }
    if (PREWARM_LAYOUT_FROM_SETTINGS
      && (!prewarmedLayoutBundlePatch
        || prewarmedLayoutBundlePatch.cleanupMatches !== 1
        || !prewarmedLayoutBundlePatch.originalBuildUnchanged)) {
      throw new Error(
        "Prewarmed-layout diagnostic route did not intercept the exact production tab-cleanup call.",
      );
    }
    if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
      && (!initialLayoutBundlePatch
        || initialLayoutBundlePatch.initializerMatches !== 1
        || !initialLayoutBundlePatch.originalBuildUnchanged)) {
      throw new Error("Initial hidden-layout diagnostic did not intercept the exact production tab initializer.");
    }
    await installPerformanceProbe(page);
    let entryPreparation = null;
    if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS) {
      if (TRACE_FROM_NAVIGATION_DIAGNOSTIC && layerTreeSession) {
        await captureLayerTreeClockAnchorGroup("preparation-start");
      }
      entryPreparationWindow = {
        start: await page.evaluate(() => performance.now()),
        startReason: "before-diagnostic-wide-hidden-layout-css-and-ready-measurement",
      };
      await page.addStyleTag({ content: INITIAL_WIDE_LAYOUT_WARM_CSS });
      entryPreparation = await prepareInitiallyMountedHiddenWideLayout(page);
      entryPreparationWindow.end = await page.evaluate(() => performance.now());
      if (TRACE_FROM_NAVIGATION_DIAGNOSTIC && layerTreeSession) {
        await captureLayerTreeClockAnchorGroup("preparation-end");
      }
    } else if (PREWARM_LAYOUT_FROM_SETTINGS) {
      entryPreparation = await warmLayoutTransitionPath(page);
    } else if (PERFORMANCE_ENTRY_MODE === "warm") {
      entryPreparation = await warmLayoutTransitionPath(page);
    } else {
      await waitForActiveAdvancedPanelIdle(page);
    }
    let layoutStageWillChangeBefore = null;
    if (LAYOUT_STAGE_WILL_CHANGE_MODE) {
      layoutStageWillChangeBefore = await page.evaluate(() => {
        const warm = document.querySelector(
          '.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage',
        );
        if (!(warm instanceof HTMLElement)) return null;
        const preview = warm.querySelector(".runtime-layout-expected-preview");
        const rect = preview?.getBoundingClientRect();
        return {
          warmWillChangeBefore: getComputedStyle(warm).willChange,
          warmStageSize: { width: warm.clientWidth, height: warm.clientHeight },
          warmHidden: warm.closest(".advanced-tab-content")?.getAttribute("aria-hidden") === "true",
          warmInert: warm.closest(".advanced-tab-content")?.hasAttribute("inert") === true,
          warmPreviewVisible: preview instanceof HTMLElement
            && getComputedStyle(preview).visibility !== "hidden"
            && Number(getComputedStyle(preview).opacity) > 0
            && Boolean(rect && rect.width > 0 && rect.height > 0),
        };
      });
      if (!layoutStageWillChangeBefore?.warmHidden
        || !layoutStageWillChangeBefore.warmInert
        || !(layoutStageWillChangeBefore.warmStageSize.width > 0
          && layoutStageWillChangeBefore.warmStageSize.height > 0)) {
        throw new Error(
          `Current-source cold entry did not provide a hidden, measured warm layout stage: ${JSON.stringify(layoutStageWillChangeBefore)}`,
        );
      }
      if (LAYOUT_STAGE_WILL_CHANGE_MODE === "auto") {
        await page.addStyleTag({
          content: `
            .advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage,
            .advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-stage {
              will-change: auto !important;
            }
          `,
        });
      }
      if (WARM_LAYER_WILL_CHANGE_MODE === "auto") {
        await page.addStyleTag({
          content: `
            .advanced-tab-content.is-warm,
            .advanced-tab-content.is-preparing {
              will-change: auto !important;
            }
          `,
        });
      }
      const warmWillChangeAfter = await page.evaluate(() => {
        const stage = document.querySelector(
          '.advanced-tab-content.is-warm[data-tab="layout"] .runtime-layout-stage',
        );
        return stage instanceof HTMLElement ? {
          willChange: getComputedStyle(stage).willChange,
          stageSize: { width: stage.clientWidth, height: stage.clientHeight },
        } : null;
      });
      entryPreparation = {
        ...(entryPreparation || {}),
        layoutStageWillChangeDiagnostic: {
          mode: LAYOUT_STAGE_WILL_CHANGE_MODE,
          ...layoutStageWillChangeBefore,
          warmWillChangeAfter: warmWillChangeAfter?.willChange ?? "",
          warmStageSizeAfter: warmWillChangeAfter?.stageSize ?? { width: 0, height: 0 },
        },
      };
    }
    if (process.env.AGENTVN_ADVANCED_PERF_TARGET_READINESS === "1"
      || ENFORCE_THEME_READINESS_DIAGNOSTIC
      || MORPH_START_DELAY_DIAGNOSTIC > 0
      || TAB_CROSSFADE_START_DELAY_DIAGNOSTIC > 0) {
      await installTargetReadinessProbe(
        page,
        PERFORMANCE_TARGET_TAB,
        MORPH_START_DELAY_DIAGNOSTIC,
        TAB_CROSSFADE_START_DELAY_DIAGNOSTIC,
      );
    }
    if (process.env.AGENTVN_ADVANCED_PERF_FIRST_MOUNT_OBSERVERS === "1") {
      await installFirstMountObserverProbe(page);
    }
    if (STAGE_PROMOTION_DIAGNOSTIC && STAGE_PROMOTION_MODE === "first-render") {
      // Diagnostic only: promote the real stage immediately before the cold
      // click. No hidden warm layout is mounted or made visible.
      await page.addStyleTag({
        content: `.advanced-tab-content[data-tab="layout"] .runtime-layout-stage {
          will-change: transform !important;
        }`,
      });
    }
    if (REACT_FIBER_CAPTURE_DIAGNOSTIC) {
      await installReactFiberStageCommitProbe(page);
    }
    if (process.env.AGENTVN_ADVANCED_PERF_HIDE_LAYOUT_PREVIEW === "1") {
      await page.addStyleTag({
        content: ".runtime-layout-stage > *, .runtime-layout-stage::after { visibility: hidden !important; }",
      });
    }
    const layoutStagePaintCss = layoutStagePaintOverrideCss(LAYOUT_STAGE_PAINT_MODE);
    if (layoutStagePaintCss) await page.addStyleTag({ content: layoutStagePaintCss });
    const checkboxLayerCss = layoutCheckboxLayerOverrideCss(LAYOUT_CHECKBOX_LAYER_MODE);
    if (checkboxLayerCss) await page.addStyleTag({ content: checkboxLayerCss });
    if (process.env.AGENTVN_ADVANCED_PERF_HIDE_MORPH_GHOST === "1") {
      await page.addStyleTag({
        content: ".toolbar-popover-morph-ghost { display: none !important; }",
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_FREEZE_MORPH_CONTENT_OPACITY === "1") {
      await page.evaluate(() => {
        const originalAnimate = Element.prototype.animate;
        const diagnostic = { kind: "diagnostic-only-parent-opacity-frozen", animations: [] };
        Element.prototype.animate = function (keyframes, options) {
          if (this instanceof HTMLElement && this.matches(".advanced-tools-panel")
            && this.parentElement?.matches(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)")) {
            diagnostic.animations.push({ at: performance.now(), keyframes, options });
            const frames = Array.isArray(keyframes)
              ? keyframes.map(frame => ({ ...frame, opacity: 1 })) : keyframes;
            return originalAnimate.call(this, frames, options);
          }
          return originalAnimate.call(this, keyframes, options);
        };
        window.__e2MorphContentOpacityDiagnostic = diagnostic;
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_PREPARE_WIDE_TARGET_GEOMETRY === "1") {
      const reference = await page.evaluate(() => window.__e2WarmWideViewportGeometry);
      if (!reference || !Number.isFinite(reference.width) || !Number.isFinite(reference.height)
        || reference.width <= 0 || reference.height <= 0) throw new Error("Missing real wide-viewport geometry.");
      await page.addStyleTag({
        content: `.advanced-tab-content.is-warm[data-tab="theme"] {
          width: ${reference.width}px; height: ${reference.height}px; right: auto; bottom: auto;
        }
        .advanced-tab-content.is-warm[data-tab="theme"] > .advanced-tab-scroll {
          display: grid; height: 100%; overflow: hidden; padding-block-end: 0;
        }
        .advanced-tab-content.is-warm[data-tab="theme"] .runtime-theme-designer {
          height: 100% !important; max-height: none !important; min-height: 0 !important;
          grid-template-rows: auto minmax(0, 1fr) auto !important; overflow: hidden !important;
        }
        .advanced-tab-content.is-warm[data-tab="theme"] :is(
          .runtime-theme-grid, .runtime-theme-presets, .runtime-theme-preview-panel, .runtime-theme-inspector) {
          height: 100% !important; min-height: 0 !important;
        }`,
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_SUPPRESS_DUPLICATE_OUTGOING === "1") {
      await page.addStyleTag({
        content: `body:has(.toolbar-popover-morph-ghost)
          .toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost).is-layout-mode
          .advanced-tab-content.is-leaving { display: none !important; }`,
      });
      await page.evaluate(() => {
        const observations = [];
        const sample = () => {
          if (!window.__advancedLayoutTransitionAudit?.running || observations.length >= 40) return;
          const root = document.querySelector(
            ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)",
          );
          const leaving = root?.querySelector(".advanced-tab-content.is-leaving");
          if (!leaving) return;
          observations.push({ at: performance.now(), tab: leaving.getAttribute("data-tab"),
            wide: root.classList.contains("is-layout-mode"),
            snapshotPresent: Boolean(document.querySelector(".toolbar-popover-morph-ghost")) });
        };
        const observer = new MutationObserver(sample);
        observer.observe(document.body, { childList: true, subtree: true,
          attributes: true, attributeFilter: ["class"] });
        window.__e2DuplicateOutgoingDiagnostic = { observations, stop: () => observer.disconnect() };
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_CONTAIN_WIDE_CONTENT === "1") {
      await page.addStyleTag({
        content: ".advanced-tools-panel.layout-mode .advanced-tab-content { contain: size layout style; }",
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_PRUNE_HIDDEN_SNAPSHOT === "1") {
      await page.evaluate(`window.__e2PruneHiddenSnapshotLayers = (${pruneHiddenSnapshotLayers.toString()})`);
      await page.evaluate(strategy => {
        const original = Node.prototype.appendChild;
        const diagnostic = { snapshots: 0, prunedLayers: [], removedNodeCount: 0, strategy };
        Node.prototype.appendChild = function (node) {
          if (node instanceof HTMLElement && node.matches(".toolbar-popover-morph-ghost")) {
            diagnostic.snapshots += 1;
            const result = window.__e2PruneHiddenSnapshotLayers(node, strategy);
            diagnostic.prunedLayers.push(...result.layers);
            diagnostic.removedNodeCount += result.layers.reduce((sum, layer) => sum + layer.removedNodeCount, 0);
          }
          return original.call(this, node);
        };
        window.__e2PrunedSnapshotDiagnostic = diagnostic;
      }, WARM_DESCENDANT_READ_ATTRIBUTION.mode === "cache-pruned-inspector-zero-warm-start"
        ? "keep-inspector" : "root");
    }
    if (process.env.AGENTVN_ADVANCED_PERF_CONTAIN_WIDE_VIEWPORT === "1") {
      await page.addStyleTag({
        content: ".advanced-tools-panel.layout-mode .advanced-tab-viewport { contain: size layout; }",
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_CONTAIN_POPOVER_LAYOUT === "1") {
      // Diagnostic only: isolate the fixed workbench's layout root while
      // retaining the real geometry, content, snapshot and motion clocks.
      await page.addStyleTag({
        content: ".toolbar-popover.workspace-task-panel.advanced { contain: layout style; }",
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_CONTAIN_POPOVER_SIZE_LAYOUT === "1") {
      await page.addStyleTag({
        content: ".toolbar-popover.workspace-task-panel.advanced { contain: size layout style; }",
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_FREEZE_OUTGOING_GEOMETRY === "1") {
      const outgoing = await page.locator(".advanced-tab-content.is-active").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { tab: element.getAttribute("data-tab"), width: rect.width, height: rect.height };
      });
      await page.addStyleTag({
        content: `.advanced-tools-panel .advanced-tab-content[data-tab="${outgoing.tab}"].is-leaving {
          width: ${outgoing.width}px !important; height: ${outgoing.height}px !important;
          right: auto !important; bottom: auto !important;
        }`,
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_CACHE_CROSSFADE_TOKEN === "1") {
      await page.evaluate(() => {
        const original = CSSStyleDeclaration.prototype.getPropertyValue;
        const token = "--ease-editor-crossfade";
        const value = getComputedStyle(document.documentElement).getPropertyValue(token);
        const diagnostic = { token, value, intercepted: 0 };
        CSSStyleDeclaration.prototype.getPropertyValue = function (name) {
          if (name === token) {
            diagnostic.intercepted += 1;
            return value;
          }
          return original.call(this, name);
        };
        window.__e2CrossfadeTokenDiagnostic = diagnostic;
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_PRE_READ_MOTION_TOKENS === "1") {
      await page.evaluate(() => {
        const original = CSSStyleDeclaration.prototype.getPropertyValue;
        const rootStyle = getComputedStyle(document.documentElement);
        const values = Object.fromEntries([
          "--ease-editor-crossfade", "--ease-ui-in-out", "--ease-ui-out", "--motion-scale",
        ].map((token) => [token, original.call(rootStyle, token)]));
        const diagnostic = { values, intercepted: {} };
        CSSStyleDeclaration.prototype.getPropertyValue = function (name) {
          if (Object.hasOwn(values, name)) {
            diagnostic.intercepted[name] = (diagnostic.intercepted[name] ?? 0) + 1;
            return values[name];
          }
          return original.call(this, name);
        };
        window.__e2PreReadMotionTokensDiagnostic = diagnostic;
      });
    }
    if (process.env.AGENTVN_ADVANCED_PERF_SLOW_DOM_READS === "1") {
      await installSlowDomReadProbe(page);
    }
    if (WARM_ROOT_TOKEN_CACHE_ENABLED && mode === "low-intrusion") {
      await page.evaluate(installScopedRootMotionTokenCache);
    }
    if (process.env.AGENTVN_ADVANCED_PERF_GLASS_GEOMETRY_READS === "1") {
      await installAdvancedNavGeometryReadProbe(page);
    }
    if (process.env.AGENTVN_ADVANCED_PERF_MEASURE_POPOVER_CLONE === "1") {
      await installPopoverCloneProbe(page);
    }
    if (SYNC_PHASE_TIMING_DIAGNOSTIC && mode === "low-intrusion" && repeat === 1) {
      await installSyncPhaseTimingProbe(page);
    }
    const visualEffectsCss = visualEffectsOverrideCss(VISUAL_EFFECTS_MODE);
    if (visualEffectsCss) await page.addStyleTag({ content: visualEffectsCss });
    if (SHADER_ATTRIBUTION_MODE.enabled) {
      const control = getShaderAttributionControl(SHADER_ATTRIBUTION_MODE.control);
      await page.addStyleTag({
        content: `${control.selector} { ${control.declarations} }`,
      });
    }
    const canvasFilterCss = canvasFilterOverrideCss(CANVAS_FILTER_MODE);
    if (canvasFilterCss) await page.addStyleTag({ content: canvasFilterCss });
    if (SHELL_BACKGROUND_FILTER_MODE === "shell-background-filter-disabled-diagnostic") {
      await page.addStyleTag({
        content: `
          .editor-shell > .editor-canvas-background-layer.is-shell {
            filter: none !important;
          }
        `,
      });
    }
    const stageGridCss = stageGridOverrideCss(STAGE_GRID_MODE);
    if (stageGridCss) await page.addStyleTag({ content: stageGridCss });
    if (process.env.AGENTVN_ADVANCED_PERF_FREEZE_OUTER_MORPH_TRANSFORM === "1") {
      await page.evaluate(() => {
        const prototype = Element.prototype;
        const nativeAnimate = prototype.animate;
        const diagnostic = { intercepted: 0, animations: [] };
        prototype.animate = function (keyframes, options) {
          if (this instanceof HTMLElement
            && this.matches(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)")) {
            const duration = typeof options === "number" ? options : options?.duration;
            diagnostic.intercepted += 1;
            diagnostic.animations.push({
              originalDurationMs: typeof duration === "number" ? duration : null,
              keyframeCount: Array.isArray(keyframes) ? keyframes.length : null,
              originalProperties: Array.isArray(keyframes)
                ? [...new Set(keyframes.flatMap((frame) => Object.keys(frame)))]
                : [],
              override: "constant-transform-preserve-options",
            });
            const transformFrozenFrames = Array.isArray(keyframes)
              ? keyframes.map((frame) => ({ ...frame, transform: "none" }))
              : keyframes;
            return nativeAnimate.call(this, transformFrozenFrames, options);
          }
          return nativeAnimate.call(this, keyframes, options);
        };
        window.__e2OuterMorphDiagnostic = diagnostic;
      });
    }
    await page.waitForTimeout(250);
    if (process.env.AGENTVN_ADVANCED_PERF_SKIP_ADVANCED_TAB_SCROLL === "1") {
      await page.evaluate(() => {
        const original = HTMLElement.prototype.scrollIntoView;
        HTMLElement.prototype.scrollIntoView = function (...args) {
          if (this.matches('[data-help-key^="advanced.tab."]')) return;
          return original.apply(this, args);
        };
      });
    }

    const targetTab = page.locator(`[data-help-key="advanced.tab.${PERFORMANCE_TARGET_TAB}"]`).first();
    const targetContentSelector = PERFORMANCE_TARGET_TAB === "layout"
      ? ".runtime-layout-designer"
      : PERFORMANCE_TARGET_TAB === "theme"
        ? ".runtime-theme-designer"
        : ".provider-settings-panel";
    const expectedStartingTab = process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1"
      ? PERFORMANCE_WARM_WIDE_END_TAB
      : "settings";
    await page.waitForFunction((tab) => {
      const activePopover = [...document.querySelectorAll(
        ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost):not([aria-hidden='true']):not([inert])",
      )].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return activePopover?.querySelector(`[data-help-key="advanced.tab.${tab}"]`)
        ?.getAttribute("data-glass-selected") === "true";
    }, expectedStartingTab, { timeout: 10000 });
    if (WAIT_FOR_WARM_LAYOUT_READY && PERFORMANCE_TARGET_TAB === "layout") {
      warmLayoutReadinessEvidence = {
        waitEnabled: true,
        beforeWait: await readWarmLayoutReadiness(page),
        afterWait: null,
        atInteraction: null,
      };
      await page.waitForFunction(() => {
        const warm = document.querySelector(
          '.advanced-tab-content.is-warm[data-tab="layout"]',
        );
        const designer = warm?.querySelector(".runtime-layout-designer");
        const stage = warm?.querySelector(".runtime-layout-stage");
        return warm instanceof HTMLElement
          && designer?.getAttribute("data-advanced-tab-ready") === "true"
          && stage instanceof HTMLElement
          && stage.clientWidth > 0
          && stage.clientHeight > 0;
      }, null, { timeout: 30000 });
      warmLayoutReadinessEvidence.afterWait = await readWarmLayoutReadiness(page);
    }

    if (GENERIC_COMPOSITOR_WARMUP_DIAGNOSTIC && mode === "low-intrusion") {
      genericCompositorWarmupDiagnostic = await runGenericCompositorWarmup(page, viewport);
    }
    if (WARM_TOP_LAYER_DIAGNOSTIC && mode === "low-intrusion") {
      const preparationStart = await page.evaluate(() => performance.now());
      await startPerformanceProbe(page);
      warmTopLayerEvidence = await installWarmTopLayerDiagnostic(page, { opacity: WARM_TOP_LAYER_OPACITY });
      warmTopLayerEvidence.summary = summarizeWarmTopLayerEvidence(warmTopLayerEvidence);
      if (!warmTopLayerEvidence.summary.valid) {
        throw new Error(`Warm top-layer evidence invalid: ${warmTopLayerEvidence.summary.failures.join("; ")}`);
      }
      warmTopLayerEvidence.restoreMode = WARM_TOP_LAYER_RESTORE_MODE;
      warmTopLayerEvidence.visualEquivalence = "not-proven-or-failed-no-product-candidate";
      if (WARM_TOP_LAYER_RESTORE_MODE === "pre-measurement") {
        warmTopLayerEvidence.preMeasurementRestoration = await settleWarmTopLayerRestoration(page);
      }
      const preparation = await stopPerformanceProbe(page, preparationStart, { includeFullWindow: true });
      warmTopLayerEvidence.preparationPerformance = {
        maxLongTaskMs: preparation.maxLongTaskMs,
        maxFrameGapMs: preparation.maxFrameGapMs,
        maxLongAnimationFrameMs: preparation.maxLongAnimationFrameMs,
        longTasks: preparation.longTasks,
        longAnimationFrames: preparation.longAnimationFrames,
        kind: "separate-perturbed-preparation-window-not-acceptance",
      };
    }

      if (mode === "idle") {
      const startedAt = await page.evaluate(() => performance.now());
      await startPerformanceProbe(page);
      await page.waitForTimeout(1100);
      const perf = await stopPerformanceProbe(page, startedAt, { includeFullWindow: true });
      return {
        mode,
        repeat,
        viewport: `${viewport.width}x${viewport.height}`,
        dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
        reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
        transitionMode: getTransitionMode(process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1"),
        visualEffectsMode: VISUAL_EFFECTS_MODE,
        canvasFilterMode: CANVAS_FILTER_MODE,
        maxLongTaskMs: perf.maxLongTaskMs,
        observationBoundary: perf.observationBoundary,
        maxFrameGapMs: perf.maxFrameGapMs,
        longTaskCount: perf.longTasks.length,
        frameSampleCount: perf.frameGaps.length,
        longAnimationFrameCount: perf.longAnimationFrameCount,
        longAnimationFrameSupported: perf.longAnimationFrameSupported,
        maxLongAnimationFrameMs: perf.maxLongAnimationFrameMs,
        maxLongAnimationFrameBlockingMs: perf.maxLongAnimationFrameBlockingMs,
        genericCompositorWarmupDiagnostic,
        longTasks: perf.longTasks.slice(0, 8),
        longAnimationFrames: perf.longAnimationFrames,
      };
    }

    await page.evaluate(() => {
      const observations = [];
      let statusObserver;
      const documentObserver = new MutationObserver(() => {
        const status = document.querySelector('[data-testid="runtime-layout-health-status"]');
        if (!(status instanceof HTMLElement)) return;
        observations.push(status.dataset.healthState ?? "");
        documentObserver.disconnect();
        statusObserver = new MutationObserver(() => observations.push(status.dataset.healthState ?? ""));
        statusObserver.observe(status, { attributes: true, attributeFilter: ["data-health-state"] });
      });
      documentObserver.observe(document.documentElement, { childList: true, subtree: true });
      (window).__advancedLayoutHealthStateObservation = { observations, stop: () => {
        documentObserver.disconnect();
        statusObserver?.disconnect();
      } };
    });

    if ((LAYER_TREE_TRACE_JOIN_DIAGNOSTIC || LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC)
      && mode === "low-intrusion"
      && repeat === 1) {
      await startLayerTreeCapture();
      if (LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC) {
        layerTreeClockAnchors.push(await captureLayerTreeClockAnchor("layout-entry-before-interaction"));
      }
    }
    const targetModuleResourceReadiness = PERFORMANCE_TARGET_TAB === "layout" && mode === "low-intrusion"
      ? await page.evaluate(() => {
        const interactionStartTime = performance.now();
        const resources = performance.getEntriesByType("resource")
          .filter(entry => entry.name.includes("RuntimeLayoutDesigner-"))
          .map(entry => ({
            name: entry.name,
            startTime: entry.startTime,
            responseEnd: entry.responseEnd,
            transferSize: entry.transferSize,
          }));
        return { interactionStartTime, resources };
      }).then(evidence => ({
        interactionStartTime: evidence.interactionStartTime,
        ...summarizeTargetModuleResourceReadiness(
          evidence.resources,
          "RuntimeLayoutDesigner-",
          evidence.interactionStartTime,
        ),
      }))
      : null;
    let firstPresentationResourceReadiness = null;
    if (GLASS_ANIMATION_TIMELINE_DIAGNOSTIC && mode === "low-intrusion" && repeat === 1) {
      glassAnimationCapture = await startGlassAnimationTimelineCapture(page);
      glassAnimationSession = glassAnimationCapture.session;
      glassAnimationCapture.beforeAnchors = [];
      for (let index = 0; index < 3; index += 1) {
        glassAnimationCapture.beforeAnchors.push(
          await readAnimationTimelineClockAnchor(page, `before-${index + 1}`),
        );
      }
    }
    // Read before the start clock as well as before installing the observer,
    // so the CDP round trip cannot inflate the measured transition interval.
    if (SHADER_CACHE_EVIDENCE_ENABLED && mode === "low-intrusion") {
      shaderCacheBefore = await captureShaderCacheSnapshot(nativeWindowSession);
    }
    const browserClockAnchor = await page.evaluate(() => {
      const timeOriginEpochMs = performance.timeOrigin;
      const monotonicTimeMs = performance.now();
      const wallClockEpochMs = Date.now();
      return {
        timeOriginEpochMs,
        monotonicTimeMs,
        wallClockEpochMs,
        wallClockOffsetMs: wallClockEpochMs - (timeOriginEpochMs + monotonicTimeMs),
      };
    });
    if (PERFORMANCE_TARGET_TAB === "layout") {
      warmLayoutReadinessEvidence ??= {
        waitEnabled: false,
        beforeWait: null,
        afterWait: null,
        atInteraction: null,
      };
      warmLayoutReadinessEvidence.atInteraction = await readWarmLayoutReadiness(page);
    }
    const layoutMountStateBeforeInteraction = PERFORMANCE_TARGET_TAB === "layout"
      ? await page.evaluate(() => {
        const content = document.querySelector('.advanced-tab-content[data-tab="layout"]');
        const designer = content?.querySelector(".runtime-layout-designer");
        return {
          mounted: Boolean(designer),
          contentHidden: content instanceof HTMLElement ? content.hidden : null,
          ariaHidden: content?.getAttribute("aria-hidden") ?? null,
          inert: content?.hasAttribute("inert") ?? false,
          activeTab: document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") ?? null,
        };
      })
      : null;
    const startedAt = browserClockAnchor.monotonicTimeMs;
    if (GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC && mode === "low-intrusion") {
      await page.evaluate(() => window.__e2GlassStyleWriteTimeline?.begin());
    }
    if (PERFORMANCE_DIAGNOSTIC_ONLY) {
      await page.evaluate(() => window.__e2HoverHelpTimelineProbe?.begin());
    }
    await startPerformanceProbe(page);
    if (
      process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
      && mode === "low-intrusion"
      && repeat === 1
    ) {
      profiler = await page.context().newCDPSession(page);
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.setSamplingInterval", { interval: 500 });
      await profiler.send("Profiler.start");
    }
    if (
      process.env.AGENTVN_ADVANCED_PERF_TRACE === "1"
      && mode === "low-intrusion"
      && (repeat === 1 || SHADER_TRACE_REUSE_PAIR)
    ) {
      await startTraceCapture();
      await page.evaluate(() => { window.__advancedLayoutTransitionAudit.traceEnabled = true; });
    }
    if (ETW_TRIGGER_READY_FILE && mode === "low-intrusion" && repeat === 1) {
      fs.writeFileSync(ETW_TRIGGER_READY_FILE, JSON.stringify({
        readyAt: new Date().toISOString(),
        browserMonotonicMs: await page.evaluate(() => performance.now()),
        targetTab: PERFORMANCE_TARGET_TAB,
      }), { flag: "wx" });
      const releaseDeadline = Date.now() + 30000;
      while (!fs.existsSync(ETW_TRIGGER_RELEASE_FILE) && Date.now() < releaseDeadline) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      if (!fs.existsSync(ETW_TRIGGER_RELEASE_FILE)) {
        throw new Error("Timed out waiting for the external ETW collector to release the cold-entry interaction.");
      }
    }
    let detailedSamples = [];
    if (mode === "detailed") {
      detailedSamples = await captureResizeGlassMotion(page, () => targetTab.click());
    } else {
      await activateLayoutTab({
        input: ACTIVATION_INPUT,
        locator: targetTab,
        keyboard: page.keyboard,
      });
      try {
        await waitForMeasuredTransitionToSettle(page, PERFORMANCE_TARGET_TAB);
      } catch (error) {
        if (REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT && error instanceof Error) {
          error.message += `; earlyWideModeBundlePatch=${JSON.stringify(earlyWideModeBundlePatch)}`;
        }
        throw error;
      }
    }
    await page.locator(
      `.advanced-tab-content.is-active[data-tab="${PERFORMANCE_TARGET_TAB}"] ${targetContentSelector}`,
    )
      .waitFor({ state: "visible", timeout: 30000 });
    let perf;
    if (WARM_DESCENDANT_READ_ATTRIBUTION.mode?.endsWith("zero-warm-start")
      && mode === "low-intrusion" && !warmStartOpacityPatch?.valid)
      throw new Error("Warm hidden-start opacity diagnostic missed the exact source response.");
    if (mode === "low-intrusion") {
      // The first interaction budget ends here. Non-critical health
      // validation is intentionally scheduled after this window and must not
      // be counted as part of the tab transition itself.
      perf = await stopPerformanceProbe(page, startedAt);
      if (PERFORMANCE_DIAGNOSTIC_ONLY) {
        const rawHoverHelpEvidence = await page.evaluate(
          () => window.__e2HoverHelpTimelineProbe?.finish?.() ?? null,
        );
        hoverHelpEvidence = rawHoverHelpEvidence ? {
          ...rawHoverHelpEvidence,
          timeline: summarizeHoverHelpTimeline(rawHoverHelpEvidence.events),
          attributionMode: hoverHelpAttributionMode,
        } : null;
        if (hoverHelpAttributionMode.enabled
          && (hoverHelpEvidence?.cardPresent || hoverHelpEvidence?.timeline.eventCount !== 0)) {
          throw new Error(`Hover-help diagnostic suppression did not hold during measurement: ${JSON.stringify(hoverHelpEvidence)}`);
        }
      }
      if (SHADER_CACHE_EVIDENCE_ENABLED) {
        shaderCacheAfter = await captureShaderCacheSnapshot(nativeWindowSession);
      }
      if (WARM_ROOT_TOKEN_CACHE_ENABLED
        && (!perf.scopedMotionTokenCache?.stable
          || !perf.scopedMotionTokenCache.intercepted["--ease-editor-crossfade"]
          || !perf.scopedMotionTokenCache.intercepted["--ease-ui-in-out"]))
        throw new Error("Root token cache attribution missed required owners or changed actual token values.");
      if (ETW_CAPTURE_DONE_FILE && repeat === 1) {
        fs.writeFileSync(ETW_CAPTURE_DONE_FILE, JSON.stringify({
          doneAt: new Date().toISOString(),
          browserMonotonicMs: await page.evaluate(() => performance.now()),
          targetTab: PERFORMANCE_TARGET_TAB,
          maxLongAnimationFrameMs: perf.maxLongAnimationFrameMs,
          maxFrameGapMs: perf.maxFrameGapMs,
        }), { flag: "wx" });
      }
      if (GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC && mode === "low-intrusion") {
        glassStyleWriteTimelineCapture = await page.evaluate(
          () => window.__e2GlassStyleWriteTimeline?.stop?.() ?? null,
        );
        if (glassStyleWriteTimelineCapture) {
          glassStyleWriteTimelineDiagnostic = {
            setup: glassStyleWriteTimelineSetup,
            mode: GLASS_STYLE_WRITE_MODE,
            presentationAlteredForDiagnostic: GLASS_STYLE_WRITE_MODE === "suppress",
            suppressedStyleProperties: GLASS_STYLE_WRITE_MODE === "suppress"
              ? glassStyleWriteTimelineCapture.instrumentedProperties
              : [],
            droppedEventCount: glassStyleWriteTimelineCapture.droppedEventCount,
            instrumentedProperties: glassStyleWriteTimelineCapture.instrumentedProperties,
            instrumentationErrors: glassStyleWriteTimelineCapture.errors,
            summary: summarizeGlassStyleWriteTimeline(
              glassStyleWriteTimelineCapture.events,
              perf.longAnimationFrames,
            ),
            events: glassStyleWriteTimelineCapture.events,
          };
        }
      }
      if (glassAnimationCapture) {
        await glassAnimationSession.send("Runtime.evaluate", { expression: "0" });
        glassAnimationTimelineDiagnostic = await finishGlassAnimationTimelineCapture(
          page,
          glassAnimationCapture,
          perf.longAnimationFrames,
        );
      }
      if (PERFORMANCE_TARGET_TAB === "layout") {
        await page.waitForFunction(() => {
          const status = document.querySelector('[data-testid="runtime-layout-health-status"]');
          return status instanceof HTMLElement && status.dataset.healthState !== "pending";
        }, null, { timeout: 5000 });
      }
    }
    const healthStates = await page.evaluate(() => {
      const observation = (window).__advancedLayoutHealthStateObservation;
      observation?.stop?.();
      return observation?.observations ?? [];
    });
    if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
      && PERFORMANCE_TARGET_TAB === "layout"
      && entryPreparation
      && mode !== "idle") {
      entryPreparation.activeLayoutGeometry = await readLayoutTreeGeometry(page, "active");
      entryPreparation.geometryEquivalenceFailures = getWarmGeometryEquivalenceFailures({
        hidden: entryPreparation.layoutGeometry,
        active: entryPreparation.activeLayoutGeometry,
        tolerancePx: 2,
      });
      if (STAGE_PROMOTION_DIAGNOSTIC && mode === "low-intrusion") {
        const activeStage = await page.evaluate(() => {
          const active = document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]');
          const stage = active?.querySelector(".runtime-layout-stage");
          const preview = stage?.querySelector(".runtime-layout-expected-preview");
          if (!(stage instanceof HTMLElement)) return null;
          const previewRect = preview?.getBoundingClientRect();
          return {
            activeTab: active?.getAttribute("data-tab") ?? "",
            activeWillChange: getComputedStyle(stage).willChange,
            activePreviewVisible: preview instanceof HTMLElement
              && getComputedStyle(preview).visibility !== "hidden"
              && Number(getComputedStyle(preview).opacity) > 0
              && Boolean(previewRect && previewRect.width > 0 && previewRect.height > 0),
            activeStageSize: { width: stage.clientWidth, height: stage.clientHeight },
          };
        });
        entryPreparation.stagePromotionDiagnostic = summarizeStagePromotionEvidence({
          enabled: true,
          mode: STAGE_PROMOTION_MODE,
          warmWillChange: entryPreparation.stageWillChange,
          ...activeStage,
        });
        if (!entryPreparation.stagePromotionDiagnostic.ok) {
          throw new Error(
            `Stage promotion diagnostic did not preserve the expected active presentation: ${JSON.stringify(entryPreparation.stagePromotionDiagnostic)}`,
          );
        }
      }
    }
    if (LAYOUT_STAGE_WILL_CHANGE_MODE && mode === "low-intrusion") {
      const activeStage = await page.evaluate(() => {
        const active = document.querySelector(
          '.advanced-tab-content.is-active[data-tab="layout"]',
        );
        const stage = active?.querySelector(".runtime-layout-stage");
        const preview = stage?.querySelector(".runtime-layout-expected-preview");
        const rect = preview?.getBoundingClientRect();
        return {
          activeWillChange: stage instanceof HTMLElement
            ? getComputedStyle(stage).willChange
            : "",
          activeTab: active?.getAttribute("data-tab") ?? "",
          activePreviewVisible: preview instanceof HTMLElement
            && getComputedStyle(preview).visibility !== "hidden"
            && Number(getComputedStyle(preview).opacity) > 0
            && Boolean(rect && rect.width > 0 && rect.height > 0),
          activeStageSize: stage instanceof HTMLElement
            ? { width: stage.clientWidth, height: stage.clientHeight }
            : { width: 0, height: 0 },
        };
      });
      const diagnostic = entryPreparation?.layoutStageWillChangeDiagnostic;
      entryPreparation.layoutStageWillChangeDiagnostic =
        summarizeLayoutStageWillChangeEvidence({
          enabled: true,
          mode: LAYOUT_STAGE_WILL_CHANGE_MODE,
          warmWillChangeBefore: diagnostic?.warmWillChangeBefore,
          warmWillChangeAfter: diagnostic?.warmWillChangeAfter,
          warmStageSizeBefore: diagnostic?.warmStageSize,
          warmStageSizeAfter: diagnostic?.warmStageSizeAfter,
          ...activeStage,
        });
      if (!entryPreparation.layoutStageWillChangeDiagnostic.ok) {
        throw new Error(
          `Layout stage will-change diagnostic changed or obscured presentation: ${JSON.stringify(entryPreparation.layoutStageWillChangeDiagnostic)}`,
        );
      }
    }
    if (STAGE_PROMOTION_DIAGNOSTIC
      && STAGE_PROMOTION_MODE === "first-render"
      && mode === "low-intrusion") {
      const activeStage = await page.evaluate(() => {
        const active = document.querySelector('.advanced-tab-content.is-active[data-tab="layout"]');
        const stage = active?.querySelector(".runtime-layout-stage");
        const preview = stage?.querySelector(".runtime-layout-expected-preview");
        if (!(stage instanceof HTMLElement)) return null;
        const previewRect = preview?.getBoundingClientRect();
        return {
          activeTab: active?.getAttribute("data-tab") ?? "",
          activeWillChange: getComputedStyle(stage).willChange,
          activePreviewVisible: preview instanceof HTMLElement
            && getComputedStyle(preview).visibility !== "hidden"
            && Number(getComputedStyle(preview).opacity) > 0
            && Boolean(previewRect && previewRect.width > 0 && previewRect.height > 0),
          activeStageSize: { width: stage.clientWidth, height: stage.clientHeight },
        };
      });
      entryPreparation = {
        ...(entryPreparation || {}),
        stagePromotionDiagnostic: summarizeStagePromotionEvidence({
          enabled: true,
          mode: STAGE_PROMOTION_MODE,
          warmWillChange: "not-mounted",
          ...activeStage,
        }),
      };
      if (!entryPreparation.stagePromotionDiagnostic.ok) {
        throw new Error(
          `Stage promotion diagnostic did not preserve the expected first-render presentation: ${JSON.stringify(entryPreparation.stagePromotionDiagnostic)}`,
        );
      }
    }
    if ((process.env.AGENTVN_ADVANCED_PERF_LAYER_TREE === "1"
      || LAYER_TREE_TRACE_JOIN_DIAGNOSTIC
      || LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC)
      && mode === "low-intrusion"
      && repeat === 1) {
      if (!layerTreeSession) {
        layerTreeSession = await page.context().newCDPSession(page);
        await layerTreeSession.send("DOM.enable");
        layerTreeClockAnchors.push(await captureLayerTreeClockAnchor("measurement-start"));
        layerTreeSession.on("LayerTree.layerTreeDidChange", recordLayerTreeSnapshot);
        await layerTreeSession.send("LayerTree.enable");
      }
      if (layerTreeChangeCount === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    let layerTreeDiagnostic;
    if (layerTreeSession) {
      if (LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC) {
        const snapshotsBeforeRefresh = layerTreeChangeCount;
        await layerTreeSession.send("LayerTree.disable");
        await layerTreeSession.send("LayerTree.enable");
        const refreshDeadline = Date.now() + 1500;
        while (layerTreeChangeCount <= snapshotsBeforeRefresh && Date.now() < refreshDeadline) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (layerTreeChangeCount <= snapshotsBeforeRefresh) {
          throw new Error("LayerTree did not emit a post-transition snapshot after re-enabling the domain.");
        }
        layerTreeClockAnchors.push(await captureLayerTreeClockAnchor("layout-entry-after-interaction"));
      } else if (!TRACE_FROM_NAVIGATION_DIAGNOSTIC) {
        layerTreeClockAnchors.push(await captureLayerTreeClockAnchor("measurement-end"));
      }
      try {
        alignLayerTreeClockAndSnapshots();
      } catch (error) {
        layerTreeClockAlignment = {
          error: error instanceof Error ? error.message : String(error),
          anchorCount: layerTreeClockAnchors.length,
        };
        layerTreeBrowserSnapshots = [];
      }
      const observedLayerTree = latestLayerTree;
      const layersByArea = [...observedLayerTree]
        .filter((layer) => Number.isFinite(Number(layer.width)) && Number.isFinite(Number(layer.height)))
        .sort((left, right) => right.width * right.height - left.width * left.height);
      const nodesByBackendId = {};
      const reasonsByLayerId = {};
      const layersToMap = LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC
        ? layerTreeSnapshotRecords.flatMap(snapshot => snapshot.layers)
        : layersByArea;
      const uniqueLayersToMap = [...new Map(layersToMap
        .filter(layer => Number.isFinite(Number(layer.backendNodeId)))
        .map(layer => [String(layer.backendNodeId), layer])).values()];
      for (const layer of uniqueLayersToMap) {
        if (!Number.isFinite(Number(layer.backendNodeId))) continue;
        try {
          const { node } = await layerTreeSession.send("DOM.describeNode", {
            backendNodeId: Number(layer.backendNodeId),
            depth: 0,
            pierce: true,
          });
          nodesByBackendId[String(layer.backendNodeId)] = {
            nodeName: node?.nodeName ?? "",
            attributes: node?.attributes ?? [],
            className: (() => {
              const attributes = node?.attributes ?? [];
              const classIndex = attributes.indexOf("class");
              return classIndex >= 0 ? attributes[classIndex + 1] ?? "" : "";
            })(),
          };
        } catch {
          nodesByBackendId[String(layer.backendNodeId)] = {};
        }
      }
      for (const layer of layersByArea.filter((item) => item.drawsContent)) {
        try {
          const result = await layerTreeSession.send("LayerTree.compositingReasons", {
            layerId: layer.layerId,
          });
          reasonsByLayerId[String(layer.layerId)] = result.compositingReasons ?? [];
        } catch {
          reasonsByLayerId[String(layer.layerId)] = [];
        }
      }
      const layoutEntryTimeline = LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC
        ? summarizeLayoutLayerTreeTimeline({
          snapshots: layerTreeBrowserSnapshots.map(snapshot => ({
            atMs: snapshot.receivedAt,
            layers: snapshot.layers.map(layer => ({
              ...layer,
              nodeName: nodesByBackendId[String(layer.backendNodeId)]?.nodeName ?? "",
              className: nodesByBackendId[String(layer.backendNodeId)]?.className ?? "",
            })),
          })),
          interactionStartMs: perf.interactionWindow?.start,
          interactionEndMs: perf.interactionWindow?.end,
        })
        : null;
      if (LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC && !layoutEntryTimeline?.ok) {
        throw new Error(
          `Layout layer-tree timeline was incomplete: ${JSON.stringify(layoutEntryTimeline)}`,
        );
      }
      layerTreeDiagnostic = {
        enabled: true,
        capturedAfterInteractionMeasurement: true,
        enabledBeforeInteraction: LAYER_TREE_TRACE_JOIN_DIAGNOSTIC
          || LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC,
        layoutEntryTimeline,
        layerTreeChangeCount,
        layerTreeSnapshots,
        layerCount: latestLayerTree.length,
        observedSnapshotCount: layerTreeSnapshotRecords.length,
        observedLayerCount: observedLayerTree.length,
        snapshotTimeBasis: "Node monotonic receive time mapped to browser performance.now",
        snapshotClockAlignment: layerTreeClockAlignment,
        clockAnchorSamples: layerTreeClockAnchors,
        snapshotTransportDelay: "CDP event delivery delay is not included in clock uncertainty",
        layerIdentityContinuity: summarizeLayerIdentityContinuity(layerTreeSnapshotRecords),
        mappedNodeCount: Object.keys(nodesByBackendId).filter((id) => nodesByBackendId[id]?.nodeName).length,
        layers: summarizeLayerTree(observedLayerTree, nodesByBackendId, reasonsByLayerId),
      };
    }
    if (profiler) {
      profile = (await profiler.send("Profiler.stop")).profile;
      await profiler.send("Profiler.disable").catch(() => {});
      const nodesById = new Map(profile.nodes.map((node) => [node.id, node]));
      const parentsById = new Map();
      for (const node of profile.nodes) {
        for (const childId of node.children ?? []) parentsById.set(childId, node.id);
      }
      const sampledTimeByNode = new Map();
      for (let index = 0; index < profile.samples.length; index += 1) {
        const nodeId = profile.samples[index];
        const durationUs = profile.timeDeltas[index] ?? 0;
        sampledTimeByNode.set(nodeId, (sampledTimeByNode.get(nodeId) ?? 0) + durationUs);
      }
      const inclusiveTimeByNode = new Map();
      for (const [sampledNodeId, durationUs] of sampledTimeByNode) {
        let nodeId = sampledNodeId;
        const visited = new Set();
        while (nodesById.has(nodeId) && !visited.has(nodeId)) {
          visited.add(nodeId);
          inclusiveTimeByNode.set(nodeId, (inclusiveTimeByNode.get(nodeId) ?? 0) + durationUs);
          nodeId = parentsById.get(nodeId);
          if (nodeId === undefined) break;
        }
      }
      profile.topSampledFunctions = [...sampledTimeByNode.entries()]
        .map(([nodeId, durationUs]) => {
          const node = nodesById.get(nodeId);
          const frame = node?.callFrame ?? {};
          return {
            functionName: frame.functionName || "(anonymous)",
            url: frame.url || "",
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber,
            sampledMs: durationUs / 1000,
            hitCount: node?.hitCount ?? 0,
          };
        })
        .sort((left, right) => right.sampledMs - left.sampledMs)
        .slice(0, 100);
      profile.topInclusiveCallers = [...inclusiveTimeByNode.entries()]
        .map(([nodeId, durationUs]) => {
          const node = nodesById.get(nodeId);
          const frame = node?.callFrame ?? {};
          return {
            functionName: frame.functionName || "(anonymous)",
            url: frame.url || "",
            lineNumber: frame.lineNumber,
            columnNumber: frame.columnNumber,
            inclusiveSampledMs: durationUs / 1000,
            hitCount: node?.hitCount ?? 0,
          };
        })
        .sort((left, right) => right.inclusiveSampledMs - left.inclusiveSampledMs)
        .slice(0, 100);
      delete profile.nodes;
      delete profile.samples;
      delete profile.timeDeltas;
      delete profile.startTime;
      delete profile.endTime;
    }
    let traceSummary;
    if (tracer) {
      const complete = new Promise((resolve) => tracer.once("Tracing.tracingComplete", resolve));
      await tracer.send("Tracing.end");
      await complete;
      if (layerTreeSession) {
        layerTreeClockAnchors.push(await captureLayerTreeClockAnchor("trace-end"));
        try {
          alignLayerTreeClockAndSnapshots();
        } catch (error) {
          layerTreeClockAlignment = {
            error: error instanceof Error ? error.message : String(error),
            anchorCount: layerTreeClockAnchors.length,
          };
          layerTreeBrowserSnapshots = [];
        }
      }
      const events = traceEvents.filter((event) => (
        event.ph === "X" && Number.isFinite(event.dur) && event.dur >= 1000
      ));
      const totalsByName = new Map();
      for (const event of events) {
        const entry = totalsByName.get(event.name) ?? { name: event.name, count: 0, totalMs: 0, maxMs: 0 };
        const durationMs = event.dur / 1000;
        entry.count += 1;
        entry.totalMs += durationMs;
        entry.maxMs = Math.max(entry.maxMs, durationMs);
        totalsByName.set(event.name, entry);
      }
      const traceClockMarker = await page.evaluate(() => {
        const state = window.__advancedLayoutTransitionAudit;
        return {
          name: state?.traceClockMarker ?? "agentvn-advanced-interaction-start",
          startTime: state?.interactionStart,
        };
      });
      let alignedTrace;
      try {
        alignedTrace = alignTraceClock(traceEvents, traceClockMarker);
      } catch (error) {
        alignedTrace = {
          error: error instanceof Error ? error.message : String(error),
          traceClockMarker,
        };
      }
      const traceEventsInWindow = alignedTrace?.events?.filter((event) => (
        Number.isFinite(event.performanceStartTime)
        && Number.isFinite(perf?.interactionWindow?.start)
        && Number.isFinite(perf?.interactionWindow?.end)
        && event.performanceStartTime < perf.interactionWindow.end
        && (event.performanceStartTime + (Number(event.dur) || 0) / 1000) > perf.interactionWindow.start
      )) ?? [];
      const preparationEndTime = perf?.interactionWindow?.start;
      const preparationTraceEvents = alignedTrace?.events && entryPreparationWindow
        && Number.isFinite(preparationEndTime)
        ? filterEntriesByTimeWindow(
            alignedTrace.events.map((event) => ({
              ...event,
              startTime: event.performanceStartTime,
              duration: Number(event.dur ?? 0) / 1000,
            })),
            entryPreparationWindow.start,
            preparationEndTime,
          )
        : [];
      const preparationRasterTasks = preparationTraceEvents
        .filter((event) => event.name === "RasterTask"
          && event.args?.tileData?.layerId !== undefined
          && Number.isFinite(Number(event.performanceStartTime)))
        .map((event) => ({
          layerId: String(event.args.tileData.layerId),
          startTime: Number(event.performanceStartTime),
          durationMs: Math.max(0, Number(event.dur ?? 0) / 1000),
          sourceFrameNumber: Number.isFinite(Number(event.args?.tileData?.sourceFrameNumber))
            ? Number(event.args.tileData.sourceFrameNumber)
            : null,
        }));
      let preparationRasterEvidence;
      if (TRACE_FROM_NAVIGATION_DIAGNOSTIC && layerTreeSession) {
        let temporalJoin;
        try {
          temporalJoin = matchRasterTasksToLayerSnapshots(
            layerTreeBrowserSnapshots,
            preparationRasterTasks,
            {
              maxSnapshotDistanceMs: 25,
              clockUncertaintyMs: Number.isFinite(Number(layerTreeClockAlignment?.uncertaintyMs))
                ? Number(layerTreeClockAlignment.uncertaintyMs)
                : 1e9,
            },
          );
        } catch (error) {
          temporalJoin = {
            matches: preparationRasterTasks.map((task) => ({
              task,
              status: "uncertain",
              reason: error instanceof Error ? error.message : String(error),
              snapshotIndex: null,
              layer: null,
              snapshotDistanceMs: null,
            })),
            summary: {
              matchedCount: 0,
              uncertainCount: preparationRasterTasks.length,
              unmatchedCount: 0,
              clockUncertaintyMs: null,
              maxObservedSnapshotDistanceMs: null,
            },
          };
        }
        const backendIds = [...new Set(temporalJoin.matches
          .map((match) => Number(match.layer?.backendNodeId))
          .filter(Number.isFinite))];
        const nodesByBackendId = {};
        for (const backendNodeId of backendIds) {
          try {
            const { node } = await layerTreeSession.send("DOM.describeNode", {
              backendNodeId,
              depth: 0,
              pierce: true,
            });
            nodesByBackendId[String(backendNodeId)] = {
              nodeName: node?.nodeName ?? "",
              attributes: node?.attributes ?? [],
            };
          } catch {
            nodesByBackendId[String(backendNodeId)] = {};
          }
        }
        preparationRasterEvidence = {
          window: {
            start: entryPreparationWindow?.start ?? null,
            end: preparationEndTime ?? null,
            source: "diagnostic wide-hidden-layout styling/ready window through trusted user interaction",
          },
          taskCount: preparationRasterTasks.length,
          temporalJoin: temporalJoin.summary,
          matchingPolicy: {
            maxSnapshotDistanceMs: 25,
            causalLimitation: "CDP event transport delay is unmeasured; snapshot matches indicate temporal proximity, not proven frame causality",
          },
          matches: temporalJoin.matches.map((match) => ({
            status: match.status,
            reason: match.reason ?? null,
            rasterTask: match.task,
            snapshotIndex: match.snapshotIndex,
            snapshotDistanceMs: match.snapshotDistanceMs,
            layer: match.layer
              ? summarizeLayerTree([match.layer], nodesByBackendId)[0] ?? null
              : null,
          })),
        };
      }
      const rawTracePath = path.join(OUT_DIR, `performance-trace-${viewport.label}-${mode}-${repeat}.json`);
      fs.writeFileSync(rawTracePath, JSON.stringify({
        traceEvents,
        metadata: {
          kind: "diagnostic-only-not-acceptance",
          entryMode: PERFORMANCE_ENTRY_MODE,
          traceFromNavigation: TRACE_FROM_NAVIGATION_DIAGNOSTIC,
          entryPreparationWindow,
          interactionWindow: perf?.interactionWindow,
          traceClockMarker,
          traceOriginUs: alignedTrace?.traceOriginUs ?? null,
          clockAlignmentError: alignedTrace?.error ?? null,
        },
      }), "utf8");
      const rasterLayerEvidence = LAYER_TREE_TRACE_JOIN_DIAGNOSTIC
        ? await (async () => {
            const rasterTasks = traceEventsInWindow
              .filter((event) => event.name === "RasterTask"
                && event.args?.tileData?.layerId !== undefined
                && Number.isFinite(Number(event.performanceStartTime)))
              .map((event) => ({
                layerId: String(event.args.tileData.layerId),
                startTime: Number(event.performanceStartTime),
                durationMs: Math.max(0, Number(event.dur ?? 0) / 1000),
                sourceFrameNumber: Number.isFinite(Number(event.args?.tileData?.sourceFrameNumber))
                  ? Number(event.args.tileData.sourceFrameNumber)
                  : null,
              }));
            const clockUncertaintyMs = Number(layerTreeClockAlignment?.uncertaintyMs);
            let temporalJoin;
            try {
              temporalJoin = matchRasterTasksToLayerSnapshots(
                layerTreeBrowserSnapshots,
                rasterTasks,
                {
                  maxSnapshotDistanceMs: 25,
                  clockUncertaintyMs: Number.isFinite(clockUncertaintyMs) ? clockUncertaintyMs : 1e9,
                },
              );
            } catch (error) {
              temporalJoin = {
                matches: rasterTasks.map((task) => ({
                  task,
                  status: "uncertain",
                  reason: error instanceof Error ? error.message : String(error),
                  snapshotIndex: null,
                  layer: null,
                  snapshotDistanceMs: null,
                })),
                summary: {
                  matchedCount: 0,
                  uncertainCount: rasterTasks.length,
                  unmatchedCount: 0,
                  clockUncertaintyMs: null,
                  maxObservedSnapshotDistanceMs: null,
                },
              };
            }
            const backendIds = [...new Set(temporalJoin.matches
              .map((match) => Number(match.layer?.backendNodeId))
              .filter(Number.isFinite))];
            const nodesByBackendId = {};
            for (const backendNodeId of backendIds) {
              try {
                const { node } = await layerTreeSession.send("DOM.describeNode", {
                  backendNodeId,
                  depth: 0,
                  pierce: true,
                });
                nodesByBackendId[String(backendNodeId)] = {
                  nodeName: node?.nodeName ?? "",
                  attributes: node?.attributes ?? [],
                };
              } catch {
                nodesByBackendId[String(backendNodeId)] = {};
              }
            }
            return {
              summary: temporalJoin.summary,
              matchingPolicy: {
                maxSnapshotDistanceMs: 25,
                timestampSemantics: "Node-side CDP event receive time, converted to browser performance time",
                causalLimitation: "CDP event transport delay is unmeasured; matches indicate temporal proximity, not proven frame causality",
              },
              matches: temporalJoin.matches.map((match) => ({
                status: match.status,
                reason: match.reason ?? null,
                rasterTask: match.task,
                snapshotIndex: match.snapshotIndex,
                snapshotDistanceMs: match.snapshotDistanceMs,
                layer: match.layer
                  ? summarizeLayerTree([match.layer], nodesByBackendId)[0] ?? null
                  : null,
              })),
            };
          })()
        : undefined;
      const gpuRasterTaskEvidence = LAYER_TREE_TRACE_JOIN_DIAGNOSTIC
        ? (() => {
            const links = matchGpuRasterTasksToSourceTiles(traceEventsInWindow, {
              minGpuTaskDurationMs: 5,
            });
            const toPerformanceMs = (timestampUs) => (
              Number.isFinite(Number(alignedTrace?.traceOriginUs))
                ? (Number(timestampUs) - Number(alignedTrace.traceOriginUs)) / 1000
                : null
            );
            const matches = links.matches.map((link) => {
              const rasterTaskStartTime = toPerformanceMs(link.rasterTaskStartTimeUs);
              const layerCandidates = (rasterLayerEvidence?.matches ?? [])
                .filter((candidate) => candidate.rasterTask?.sourceFrameNumber === link.sourceFrameNumber
                  && String(candidate.layer?.layerId ?? "") === String(link.layerId ?? ""));
              const nearestLayerSnapshot = Number.isFinite(rasterTaskStartTime)
                ? layerCandidates.sort((left, right) => (
                    Math.abs(left.rasterTask.startTime - rasterTaskStartTime)
                    - Math.abs(right.rasterTask.startTime - rasterTaskStartTime)
                  ))[0] ?? null
                : null;
              return {
                ...link,
                gpuTaskStartTimeMs: toPerformanceMs(link.gpuTaskStartTimeUs),
                gpuRasterStartTimeMs: toPerformanceMs(link.gpuRasterStartTimeUs),
                rendererRasterStartTimeMs: toPerformanceMs(link.rendererRasterStartTimeUs),
                rasterTaskStartTimeMs: rasterTaskStartTime,
                layerSnapshot: nearestLayerSnapshot
                  ? {
                      status: nearestLayerSnapshot.status,
                      snapshotIndex: nearestLayerSnapshot.snapshotIndex,
                      distanceMs: nearestLayerSnapshot.snapshotDistanceMs,
                      layer: nearestLayerSnapshot.layer,
                    }
                  : null,
              };
            });
            return {
              summary: {
                ...links.summary,
                layerSnapshotMatchedCount: matches.filter((match) => (
                  match.layerSnapshot?.status === "matched"
                )).length,
                layerSnapshotUncertainCount: matches.filter((match) => (
                  match.layerSnapshot?.status === "uncertain"
                )).length,
                layerSnapshotUnmatchedCount: matches.filter((match) => (
                  match.layerSnapshot?.status === "unmatched"
                )).length,
                layerSnapshotMissingCount: matches.filter((match) => !match.layerSnapshot).length,
              },
              matchingPolicy: {
                minimumGpuTaskMs: 5,
                commandIdentity: "GPU raster_id matched to renderer raster_chromium_id for the same renderer PID",
                sourceTileIdentity: "renderer RasterImplementation interval matched to its containing RasterTask on the same thread",
                layerSnapshotIdentity: "sourceFrameNumber and layerId matched to the nearest timed LayerTree snapshot",
                causalLimitation: "trace IDs link the GPU raster command to a renderer tile/layer; the LayerTree DOM attribution remains time-nearest, and this does not prove that one layer exclusively caused the enclosing GPU wait",
              },
              matches,
            };
          })()
        : undefined;
      traceSummary = {
        eventCount: traceEvents.length,
        rawTracePath,
        shaderCompilationEvidence: SHADER_TRACE_ENABLED ? summarizeShaderTrace(traceEventsInWindow) : undefined,
        shaderTraceCategory: SHADER_TRACE_ENABLED ? "disabled-by-default-skia.shaders" : undefined,
        sharedGpuCacheReusePair: SHADER_TRACE_REUSE_PAIR,
        traceClockMarker,
        traceClockAlignment: alignedTrace?.error
          ? { error: alignedTrace.error, traceClockMarker: alignedTrace.traceClockMarker }
          : { traceOriginUs: alignedTrace.traceOriginUs },
        preparationRasterEvidence,
        layerTreeClockAlignment,
        layerTreeClockAnchorSamples: layerTreeClockAnchors,
        rasterLayerEvidence,
        gpuRasterTaskEvidence,
        interactionWindowEvents: traceEventsInWindow
          .filter((event) => event.ph === "X" && Number.isFinite(event.dur))
          .sort((left, right) => right.dur - left.dur)
          .slice(0, 60)
          .map((event) => ({
            name: event.name,
            category: event.cat,
            startMs: event.performanceStartTime,
            durationMs: event.dur / 1000,
            url: event.args?.data?.url ?? event.args?.beginData?.url ?? "",
            stack: event.args?.data?.stackTrace?.slice?.(0, 8) ?? [],
          })),
        layoutEvents: traceEvents.filter((event) => event.ph === "X"
          && ["Layout", "UpdateLayoutTree", "PrePaint", "Paint"].includes(event.name))
          .sort((left, right) => right.dur - left.dur)
          .slice(0, 60).map((event) => ({
            name: event.name, durationMs: event.dur / 1000,
            at: event.ts / 1000,
            args: event.args ?? {},
          })),
        topEvents: [...totalsByName.values()]
          .sort((left, right) => right.maxMs - left.maxMs)
          .slice(0, 40),
        longestEvents: events
          .map((event) => ({
            name: event.name,
            category: event.cat,
            durationMs: event.dur / 1000,
            url: event.args?.data?.url ?? event.args?.beginData?.url ?? "",
            stack: event.args?.data?.stackTrace?.slice?.(0, 8) ?? [],
          }))
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 40),
      };
    }
    if (!perf) perf = await stopPerformanceProbe(page, startedAt);
    if (mode === "low-intrusion" && PERFORMANCE_TARGET_TAB === "layout") {
      const readiness = await page.evaluate((interactionWindow) => {
        const activeLayout = document.querySelector(
          '.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-designer',
        );
        const resources = performance.getEntriesByType("resource").map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize,
        }));
        const images = [...(activeLayout?.querySelectorAll("img") ?? [])].map((image) => ({
          source: image.currentSrc || image.src,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        }));
        const fontSet = document.fonts;
        return {
          activeLayoutFound: Boolean(activeLayout),
          interactionWindow,
          resources,
          images,
          fonts: {
            status: fontSet?.status ?? "",
            faces: fontSet ? [...fontSet].map((face) => ({
              family: face.family,
              status: face.status,
            })) : [],
          },
        };
      }, perf.interactionWindow);
      firstPresentationResourceReadiness = {
        activeLayoutFound: readiness.activeLayoutFound,
        ...summarizeFirstPresentationResourceReadiness(readiness),
      };
    }
    const detailedGaps = detailedSamples.slice(1).map((sample, index) => sample.time - detailedSamples[index].time);
    if (warmTopLayerEvidence) {
      const restoration = await page.evaluate(() => ({
        restored: window.__e2WarmTopLayerDiagnostic?.restored,
        restoreCount: window.__e2WarmTopLayerDiagnostic?.restoreCount,
        restoredAt: window.__e2WarmTopLayerDiagnostic?.restoredAt,
      }));
      Object.assign(warmTopLayerEvidence, restoration);
    }
    const postSnapshotTimingDiagnostic = POST_SNAPSHOT_TIMING_DIAGNOSTIC && mode === "low-intrusion"
      ? {
        ...perf.postSnapshotTiming,
        stageSizeSuppressed: FREEZE_STAGE_SIZE_DIAGNOSTIC,
        equivalence: FREEZE_STAGE_SIZE_DIAGNOSTIC
          ? "not-equivalent-attribution-only-stale-preview-metrics"
          : "timing-probe-only",
        sourcePatches: postSnapshotSourcePatches,
        summary: summarizePostSnapshotEvidence({
          ...perf.postSnapshotTiming,
          trustedClicks: perf.syncPhaseTimingProbe?.trustedTargetClicks,
          captureEnd: perf.syncPhaseTimingProbe?.captureEnvelopes?.[0]?.end,
          patches: postSnapshotSourcePatches,
          longAnimationFrames: perf.longAnimationFrames,
        }),
      } : null;
    return {
      mode,
      repeat,
      viewport: `${viewport.width}x${viewport.height}`,
      dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
      reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
      transitionMode: getTransitionMode(process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1"),
      activationInput: ACTIVATION_INPUT,
      visualEffectsMode: VISUAL_EFFECTS_MODE,
      canvasFilterMode: CANVAS_FILTER_MODE,
      stageGridMode: STAGE_GRID_MODE,
      entryMode: PERFORMANCE_ENTRY_MODE,
      entryPreparation,
      entryPreparationWindow,
      warmLayoutReadinessEvidence,
      sourceWarmOpacityEvidence,
      warmDescendantStyleEvidence,
      warmStartOpacityPatch,
      warmDescendantReadAttribution: WARM_DESCENDANT_READ_ATTRIBUTION,
      warmTopLayerEvidence,
      layoutMountStateBeforeInteraction,
      traceFromNavigation: TRACE_FROM_NAVIGATION_DIAGNOSTIC,
      targetModuleResourceReadiness,
      firstPresentationResourceReadiness,
      genericCompositorWarmupDiagnostic,
      shaderCacheEvidence: shaderCacheBefore ? {
        kind: "outside-measurement-browser-global-histogram-not-causal-proof",
        before: shaderCacheBefore, after: shaderCacheAfter,
        summary: summarizeShaderCacheDelta(shaderCacheBefore, shaderCacheAfter),
      } : undefined,
      hoverHelpEvidence,
      browserClockAnchor,
      prewarmedLayoutBundlePatch,
      initialLayoutBundlePatch,
      syncPhaseSourcePatch,
      interactionWindow: perf.interactionWindow,
      pageVisibility: perf.pageVisibility,
      pageVisibilityProvenance: perf.pageVisibilityProvenance,
      nativeWindowStates: perf.nativeWindowStates,
      nativeWindowSampling: perf.nativeWindowSampling,
      observationBoundary: perf.observationBoundary,
      reactCommitDiagnostic: perf.reactCommitDiagnostic,
      reactFiberPathDiagnostic: perf.reactFiberPathDiagnostic,
      syncPhaseTimingProbe: perf.syncPhaseTimingProbe,
      postSnapshotTimingDiagnostic,
      maxLongTaskMs: perf.maxLongTaskMs,
      maxFrameGapMs: perf.maxFrameGapMs,
      longTaskCount: perf.longTasks.length,
      frameSampleCount: perf.frameGaps.length,
      longAnimationFrameCount: perf.longAnimationFrameCount,
      longAnimationFrameSupported: perf.longAnimationFrameSupported,
      maxLongAnimationFrameMs: perf.maxLongAnimationFrameMs,
      maxLongAnimationFrameBlockingMs: perf.maxLongAnimationFrameBlockingMs,
      detailedSampleCount: detailedSamples.length,
      maxDetailedSampleGapMs: detailedGaps.length ? Math.max(...detailedGaps) : null,
      longTasks: perf.longTasks.slice(0, 8),
      longAnimationFrames: perf.longAnimationFrames,
      longAnimationFramesWallClock: perf.longAnimationFrames.map((frame) => ({
        startEpochMs: mapBrowserMonotonicToEpochMs(browserClockAnchor, frame.startTime),
        endEpochMs: mapBrowserMonotonicToEpochMs(
          browserClockAnchor,
          frame.startTime + frame.duration,
        ),
        durationMs: frame.duration,
      })),
      longAnimationFramePhases: perf.longAnimationFrames.map((frame) => ({
        startTime: frame.startTime,
        phases: summarizeFramePhases(frame),
      })),
      longestFrameGaps: [...perf.frameGaps].sort((left, right) => right.duration - left.duration).slice(0, 16),
      advancedNavGeometryReads: perf.advancedNavGeometryReads,
      popoverClone: perf.popoverClone,
      outerMorphDiagnostic: await page.evaluate(() => window.__e2OuterMorphDiagnostic ?? null),
      slowDomReads: perf.slowDomReads,
      scopedMotionTokenCache: perf.scopedMotionTokenCache,
      targetReadiness: perf.targetReadiness,
      editorMotionTimeline: perf.editorMotionTimeline,
      glassAnimationTimelineDiagnostic,
      glassStyleWriteTimelineDiagnostic,
      morphStartDelayDiagnostic: perf.morphStartDelayDiagnostic,
      tabCrossfadeStartDelayDiagnostic: perf.tabCrossfadeStartDelayDiagnostic,
      // Outside the stopped measurement window: verify the nested-material
      // counterfactual actually took effect, rather than just assuming CSS did.
      visualEffectsEvidence: await page.evaluate(() => {
        const root = document.querySelector(
          ".toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost)",
        );
        if (!root) return { rootPresent: false };
        const elements = [root, ...root.querySelectorAll("*")];
        const filters = elements.flatMap((element) => {
          const style = getComputedStyle(element);
          return style.backdropFilter !== "none"
            ? [{ className: String(element.className), backdropFilter: style.backdropFilter }]
            : [];
        });
        const canvas = document.querySelector(".editor-workspace > .flow-surface");
        return { rootPresent: true, elementCount: elements.length,
          backdropFilterCount: filters.length, filters: filters.slice(0, 32),
          canvasFilter: canvas ? getComputedStyle(canvas).filter : null };
      }),
      shaderAttributionEvidence: SHADER_ATTRIBUTION_MODE.enabled
        ? await page.evaluate(({ control, selector, kind }) => {
          const targets = [...document.querySelectorAll(selector)];
          const disabledCount = targets.filter(element => {
            const style = getComputedStyle(element);
            return kind === "filter" ? style.filter === "none" : style.backdropFilter === "none";
          }).length;
          return { control, targetCount: targets.length, disabledCount };
        }, getShaderAttributionControl(SHADER_ATTRIBUTION_MODE.control))
        : null,
      preparedGeometryDiagnostic: await page.evaluate(() => {
        const reference = window.__e2WarmWideViewportGeometry;
        if (!reference) return null;
        const layer = document.querySelector(
          '.toolbar-popover.workspace-task-panel.advanced:not(.toolbar-popover-morph-ghost) .advanced-tab-content.is-active',
        );
        const size = layer ? { width: layer.offsetWidth, height: layer.offsetHeight } : null;
        return { reference, finalContentSize: size,
          dimensionMatch: Boolean(size && Math.abs(size.width - reference.width) <= 1
            && Math.abs(size.height - reference.height) <= 1) };
      }),
      duplicateOutgoingDiagnostic: await page.evaluate(() => {
        const probe = window.__e2DuplicateOutgoingDiagnostic;
        probe?.stop();
        return probe?.observations ?? null;
      }),
      crossfadeTokenDiagnostic: await page.evaluate(() => window.__e2CrossfadeTokenDiagnostic ?? null),
      preReadMotionTokensDiagnostic: await page.evaluate(() => window.__e2PreReadMotionTokensDiagnostic ?? null),
      prunedSnapshotDiagnostic: await page.evaluate(() => window.__e2PrunedSnapshotDiagnostic ?? null),
      firstMountObserverDiagnostic: await page.evaluate(() => window.__e2FirstMountObserverProbe ?? null),
      earlyWideModeDiagnostic: REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT
        ? {
          bundlePatch: earlyWideModeBundlePatch,
          ...(await page.evaluate(() => {
            const probe = window.__e2FirstMountObserverProbe;
            const events = (probe?.calls ?? []).flatMap((call) => call.entries
              .filter((entry) => entry.target.includes("runtime-layout-stage"))
              .map((entry) => ({
                at: call.at,
                width: entry.width,
                height: entry.height,
              }))).sort((left, right) => left.at - right.at);
            return {
              stageResizeEvents: events,
              startsAtFinalWideGeometry: events.length > 0 && events[0].width >= 2000,
              observedSizeTransitions: Math.max(0, events.length - 1),
            };
          })),
        }
        : null,
      morphContentOpacityDiagnostic: await page.evaluate(() => window.__e2MorphContentOpacityDiagnostic ?? null),
      hiddenLayoutPreviewDiagnostic: process.env.AGENTVN_ADVANCED_PERF_HIDE_LAYOUT_PREVIEW === "1"
        ? await page.locator('.advanced-tab-content.is-active .runtime-layout-expected-preview')
          .evaluate(element => ({ visibility: getComputedStyle(element).visibility,
            stageWidth: element.parentElement.offsetWidth, stageHeight: element.parentElement.offsetHeight }))
        : null,
      layoutStagePaintDiagnostic: LAYOUT_STAGE_PAINT_MODE !== "product-default"
        ? await page.locator(".advanced-tab-content.is-active .runtime-layout-stage")
          .evaluate((stage, paintMode) => {
            const preview = stage.querySelector(".runtime-layout-expected-preview");
            const layer = stage.closest(".advanced-tab-content");
            const boundary = paintMode === "layout-content-paint-contained-diagnostic" ? layer : stage;
            const rect = (element) => {
              const value = element.getBoundingClientRect();
              return { x: value.x, y: value.y, width: value.width, height: value.height };
            };
            return {
              mode: paintMode,
              contain: getComputedStyle(boundary).contain,
              boundaryRect: rect(boundary),
              liveOwner: layer?.classList.contains("is-active")
                && !stage.closest(".toolbar-popover-morph-ghost")
                && !stage.closest("[inert], [aria-hidden='true']"),
              stageRect: rect(stage),
              previewVisibility: preview ? getComputedStyle(preview).visibility : null,
              previewDisplay: preview ? getComputedStyle(preview).display : null,
              previewRect: preview ? rect(preview) : null,
            };
          }, LAYOUT_STAGE_PAINT_MODE)
        : null,
      checkboxLayerDiagnostic: LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
        ? await inspectLayoutCheckboxLayers(page) : null,
      stageGridDiagnostic: STAGE_GRID_MODE === "stage-grid-disabled-diagnostic"
        ? await page.locator(".advanced-tab-content.is-active .runtime-layout-stage")
          .evaluate((stage) => {
            const pseudo = getComputedStyle(stage, "::after");
            const rect = stage.getBoundingClientRect();
            return {
              stagePresent: true,
              stageRect: { width: rect.width, height: rect.height },
              wrapperHasNoGrid: Boolean(stage.parentElement?.classList.contains("no-grid")),
              pseudoDisplay: pseudo.display,
              pseudoBackgroundImage: pseudo.backgroundImage,
              gridSuppressed: pseudo.display === "none",
            };
          })
        : null,
      layerTreeDiagnostic,
      hiddenMorphGhostDiagnostic: process.env.AGENTVN_ADVANCED_PERF_HIDE_MORPH_GHOST === "1"
        ? await page.evaluate(() => ({
          count: document.querySelectorAll(".toolbar-popover-morph-ghost").length,
          displays: [...document.querySelectorAll(".toolbar-popover-morph-ghost")].map(element => getComputedStyle(element).display),
          morphs: [...document.querySelectorAll(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)")].flatMap(element =>
            element.getAnimations().map(animation => ({ playState: animation.playState,
              duration: animation.effect?.getTiming().duration ?? null }))),
        }))
        : null,
      readinessConditionDiagnostic,
      cpuProfile: profile,
      traceSummary,
      healthStates,
    };
  } catch (error) {
    if (WARM_DESCENDANT_READ_ATTRIBUTION.enabled) {
      const diagnosticEvidencePath = path.join(OUT_DIR, `failed-read-attribution-${mode}-${repeat}.json`);
      const raw = await page.evaluate(() => {
        const state = window.__advancedLayoutTransitionAudit;
        return {
          capturedAt: performance.now(),
          pageVisibility: { state: document.visibilityState, hidden: document.hidden,
            hasFocus: document.hasFocus(),
            provenance: "Playwright-default-focus-emulation; native foreground not established" },
          audit: state ? {
            start: state.start, interactionStart: state.interactionStart,
            interactionSource: state.interactionSource, observationEnd: state.observationEnd,
            observationFailure: state.observationFailure, running: state.running,
            longTasks: state.longTasks, longAnimationFrames: state.longAnimationFrames,
            frameGaps: state.frameGaps,
            visibilitySamples: state.visibilitySamples,
          } : null,
          slowDomReads: window.__e2SlowDomReadProbe ?? null,
          scopedMotionTokenCache: window.__e2ScopedMotionTokenCache?.finish?.() ?? null,
          prunedSnapshot: window.__e2PrunedSnapshotDiagnostic ?? null,
        };
      }).catch(captureError => ({ captureError: String(captureError) }));
      raw.nativeWindowStates = page.__e2NativeWindowStates;
      raw.nativeWindowAtFailure = await page.__e2CaptureNativeWindowState?.("failure-after-measurement")
        .catch(error => ({ error: String(error) }));
      fs.writeFileSync(diagnosticEvidencePath, JSON.stringify({
        kind: "failed-perturbed-read-attribution-not-performance-acceptance",
        originalError: String(error), mode, repeat, raw,
      }, null, 2), "utf8");
      if (error instanceof Error) error.diagnosticEvidencePath = diagnosticEvidencePath;
    }
    throw error;
  } finally {
    await nativeWindowSession.detach().catch(() => {});
    if (profiler) await profiler.detach().catch(() => {});
    if (tracer) await tracer.detach().catch(() => {});
    if (layerTreeSession) await layerTreeSession.detach().catch(() => {});
    if (glassAnimationSession) await glassAnimationSession.detach().catch(() => {});
    await page.close().catch(() => {});
  }
}

async function runPerformanceDiagnostic(browser, viewport) {
  const trials = [];
  const repeatsPerMode = Math.max(1, Math.min(3,
    Number.parseInt(process.env.AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS || "3", 10) || 3));
  // Rotate the active probe order between fresh pages to reduce order and
  // browser-warmup bias. This report is diagnostic only, never acceptance.
  for (let repeat = 1; repeat <= repeatsPerMode; repeat += 1) {
    trials.push(await runPerformanceDiagnosticTrial(browser, viewport, "idle", repeat));
    const activeModes = ENFORCE_LOW_INTRUSION_DIAGNOSTIC || process.env.AGENTVN_ADVANCED_PERF_PROFILE === "1"
      ? ["low-intrusion"]
      : repeat % 2 === 1 ? ["low-intrusion", "detailed"] : ["detailed", "low-intrusion"];
    for (const mode of activeModes) {
      trials.push(await runPerformanceDiagnosticTrial(browser, viewport, mode, repeat));
    }
  }
  const summarize = (mode) => {
    const values = trials.filter((trial) => trial.mode === mode);
    const sorted = (key) => values.map((trial) => trial[key]).filter(Number.isFinite).sort((a, b) => a - b);
    const median = (items) => items.length ? items[Math.floor(items.length / 2)] : null;
    return {
      mode,
      runs: values.length,
      medianMaxLongTaskMs: median(sorted("maxLongTaskMs")),
      medianMaxFrameGapMs: median(sorted("maxFrameGapMs")),
      medianFrameSampleCount: median(sorted("frameSampleCount")),
      medianDetailedSampleGapMs: median(sorted("maxDetailedSampleGapMs")),
    };
  };
  const lowIntrusionTrials = trials.filter((trial) => trial.mode === "low-intrusion");
  const performanceFailures = ENFORCE_LOW_INTRUSION_DIAGNOSTIC
    ? lowIntrusionTrials.flatMap((trial) => {
      const failures = [];
      if (trial.maxLongTaskMs > viewport.longTaskMs) {
        failures.push(`${trial.mode} repeat ${trial.repeat}: long task ${Math.round(trial.maxLongTaskMs)}ms > ${viewport.longTaskMs}ms`);
      }
      if (trial.maxFrameGapMs > viewport.frameGapMs) {
        failures.push(`${trial.mode} repeat ${trial.repeat}: frame gap ${Math.round(trial.maxFrameGapMs)}ms > ${viewport.frameGapMs}ms`);
      }
      failures.push(...getLayoutHealthStateFailures({
        targetTab: PERFORMANCE_TARGET_TAB,
        layoutPreMounted: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS,
        layoutMountedBeforeInteraction: trial.layoutMountStateBeforeInteraction?.mounted === true,
        layoutReadyBeforeInteraction: WAIT_FOR_WARM_LAYOUT_READY,
        healthStates: trial.healthStates,
      }).map(failure => `${trial.mode} repeat ${trial.repeat}: ${failure}`));
      failures.push(...getWarmLayoutReadinessFailures({
        waitForReady: WAIT_FOR_WARM_LAYOUT_READY,
        evidence: trial.warmLayoutReadinessEvidence?.atInteraction,
      }).map(failure => `${trial.mode} repeat ${trial.repeat}: ${failure}`));
      return failures;
    })
    : [];
  if (SYNC_PHASE_TIMING_DIAGNOSTIC) {
    const probeTrials = lowIntrusionTrials.filter((trial) => trial.repeat === 1);
    if (probeTrials.length !== 1) {
      performanceFailures.push(
        `synchronous phase probe expected exactly one low-intrusion trial, received ${probeTrials.length}`,
      );
    }
    for (const trial of probeTrials) {
      if (trial.syncPhaseSourcePatch?.anchorCount !== 9
        || trial.syncPhaseSourcePatch?.markerCount !== 9
        || trial.syncPhaseSourcePatch?.originalSourceUnchanged !== true) {
        performanceFailures.push(
          `synchronous phase probe repeat ${trial.repeat} did not instrument the exact current-source implementation`,
        );
      }
      const summary = trial.syncPhaseTimingProbe?.summary;
      if (summary?.valid !== true) {
        performanceFailures.push(
          `synchronous phase probe repeat ${trial.repeat} invalid: ${(summary?.failures ?? ["missing probe summary"]).join("; ")}`,
        );
      }
    }
  }
  if (POST_SNAPSHOT_TIMING_DIAGNOSTIC) {
    for (const trial of lowIntrusionTrials) {
      if (!trial.postSnapshotTimingDiagnostic?.summary?.valid) {
        performanceFailures.push(`post-snapshot probe invalid: ${
          (trial.postSnapshotTimingDiagnostic?.summary?.failures ?? ["missing evidence"]).join("; ")
        }`);
      }
      if (FREEZE_STAGE_SIZE_DIAGNOSTIC
        && !trial.postSnapshotTimingDiagnostic?.events?.some(event => event.name === "stage:size-suppressed")) {
        performanceFailures.push("Stage-state suppression diagnostic never hit its intervention.");
      }
    }
  }
  if (WARM_TOP_LAYER_DIAGNOSTIC) {
    for (const trial of lowIntrusionTrials) {
      if (!trial.warmTopLayerEvidence?.summary?.valid || !trial.warmTopLayerEvidence.restored
        || trial.warmTopLayerEvidence.restoreCount !== 1) {
        performanceFailures.push("Warm top-layer diagnostic failed geometry/ownership/restoration validation.");
      }
    }
  }
  if (ENFORCE_LAYOUT_LOAF_DIAGNOSTIC) {
    performanceFailures.push(...getLoafPerformanceFailures({
      targetTab: PERFORMANCE_TARGET_TAB,
      trials: lowIntrusionTrials,
      thresholdMs: LAYOUT_LOAF_THRESHOLD_MS,
    }));
  }
  if (MORPH_START_DELAY_DIAGNOSTIC > 0) {
    for (const trial of lowIntrusionTrials) {
      const probe = trial.morphStartDelayDiagnostic;
      if (probe?.interceptedCount !== 1
        || probe.animations?.length !== 1
        || probe.animations[0]?.originalDurationMs !== 960
        || probe.animations[0]?.durationMs !== 960
        || probe.animations[0]?.appliedDelayMs !== MORPH_START_DELAY_DIAGNOSTIC) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: morph-only timing diagnostic did not apply exactly once while preserving the 960ms duration`,
        );
      }
    }
  }
  if (TAB_CROSSFADE_START_DELAY_DIAGNOSTIC > 0) {
    for (const trial of lowIntrusionTrials) {
      const probe = trial.tabCrossfadeStartDelayDiagnostic;
      const owners = new Set((probe?.animations ?? []).map(animation => animation.owner));
      if (probe?.interceptedCount !== 2
        || probe.animations?.length !== 2
        || probe.animations.some(animation => (
          animation.originalDurationMs !== 400
          || animation.durationMs !== 400
          || animation.appliedDelayMs !== TAB_CROSSFADE_START_DELAY_DIAGNOSTIC
          || !["tab:layout", "tab:settings"].includes(animation.owner)
        ))
        || owners.size !== 2
        || !owners.has("tab:layout")
        || !owners.has("tab:settings")) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: tab crossfade timing diagnostic did not delay exactly the layout/settings 400ms animations while preserving duration`,
        );
      }
    }
  }
  if (REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT) {
    for (const trial of lowIntrusionTrials) {
      const diagnostic = trial.earlyWideModeDiagnostic;
      if (!diagnostic?.bundlePatch?.originalBuildUnchanged
        || diagnostic.bundlePatch.mountOrderMatches !== 1
        || diagnostic.bundlePatch.commitOrderMatches !== 1) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: exact production-bundle order probe was not applied`,
        );
      }
      if (diagnostic?.startsAtFinalWideGeometry !== true
        || diagnostic.observedSizeTransitions !== 0) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: target stage did not mount directly at final wide geometry`,
        );
      }
    }
  }
  if (ENFORCE_THEME_READINESS_DIAGNOSTIC) {
    performanceFailures.push(...getTargetReadinessFailures({ targetTab: PERFORMANCE_TARGET_TAB, trials }));
  }
  if (PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS) {
    for (const trial of lowIntrusionTrials) {
      const failures = trial.entryPreparation?.geometryEquivalenceFailures ?? [
        "Missing hidden/active layout geometry equivalence evidence",
      ];
      for (const failure of failures) {
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: ${failure}`);
      }
    }
  }
  if (SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC) {
    for (const trial of lowIntrusionTrials) {
      const evidence = trial.sourceWarmOpacityEvidence;
      if (evidence?.ok !== true || evidence.overrideCount !== 1
        || evidence.value !== WARM_LAYER_OPACITY_DIAGNOSTIC) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: current-source warm opacity did not apply as a single verified state-preserving override`,
        );
      }
    }
  }
  if (process.env.AGENTVN_ADVANCED_PERF_PREPARE_WIDE_TARGET_GEOMETRY === "1") {
    for (const trial of lowIntrusionTrials) {
      if (trial.preparedGeometryDiagnostic?.dimensionMatch !== true) {
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: prepared geometry differs from final content size`);
      }
    }
  }
  if (VISUAL_EFFECTS_MODE === "all-advanced-backdrop-filters-disabled-diagnostic") {
    for (const trial of lowIntrusionTrials) {
      if (trial.visualEffectsEvidence?.rootPresent !== true
        || trial.visualEffectsEvidence.backdropFilterCount !== 0) {
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: nested backdrop override was not verified`);
      }
    }
  }
  if (SHADER_ATTRIBUTION_MODE.enabled) {
    for (const trial of lowIntrusionTrials) {
      const evidence = trial.shaderAttributionEvidence;
      if (evidence?.targetCount < 1 || evidence.disabledCount !== evidence.targetCount) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: shader attribution control was not verified`,
        );
      }
    }
  }
  if (CANVAS_FILTER_MODE === "canvas-filter-disabled-diagnostic") {
    for (const trial of lowIntrusionTrials) {
      if (trial.visualEffectsEvidence?.canvasFilter !== "none") {
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: editor canvas filter override was not verified`);
      }
    }
  }
  if (STAGE_GRID_MODE === "stage-grid-disabled-diagnostic") {
    for (const trial of lowIntrusionTrials) {
      if (trial.stageGridDiagnostic?.stagePresent !== true
        || trial.stageGridDiagnostic.wrapperHasNoGrid
        || trial.stageGridDiagnostic.gridSuppressed !== true) {
        performanceFailures.push(
          `low-intrusion repeat ${trial.repeat}: stage grid diagnostic did not suppress a visible stage grid`,
        );
      }
    }
  }
  if (LAYOUT_STAGE_PAINT_MODE !== "product-default") {
    for (const trial of lowIntrusionTrials) {
      const evidence = trial.layoutStagePaintDiagnostic;
      const contain = new Set(evidence?.contain?.split(/\s+/));
      const expected = LAYOUT_STAGE_PAINT_MODE === "layout-content-paint-contained-diagnostic"
        ? ["size", "layout", "paint", "style"] : ["paint"];
      if (!expected.every(value => contain.has(value) || contain.has("strict"))
        || evidence?.liveOwner !== true
        || evidence?.previewVisibility !== "visible"
        || evidence?.previewDisplay === "none"
        || !(evidence?.stageRect?.width > 0 && evidence?.stageRect?.height > 0)
        || !(evidence?.previewRect?.width > 0 && evidence?.previewRect?.height > 0)) {
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: paint boundary override was not verified with the live preview owner`);
      }
    }
  }
  if (LAYOUT_CHECKBOX_LAYER_MODE !== "product-default") {
    for (const trial of lowIntrusionTrials) {
      const controls = trial.checkboxLayerDiagnostic;
      if (!controls?.length || controls.some(control => control.is2D !== true
        || control.rect.width <= 0 || control.rect.height <= 0))
        performanceFailures.push(`low-intrusion repeat ${trial.repeat}: 2D checkbox layer override was not verified`);
    }
  }
  return {
    kind: "diagnostic-only-not-acceptance",
    viewport: { width: viewport.width, height: viewport.height },
    dpr: Number(process.env.ADVANCED_TOOLS_DPR || 1),
    reducedMotion: process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1",
    transitionMode: getTransitionMode(process.env.AGENTVN_ADVANCED_PERF_REDUCED_MOTION === "1"),
    activationInput: ACTIVATION_INPUT,
    visualEffectsMode: VISUAL_EFFECTS_MODE,
    hoverHelpAttributionMode,
    shaderAttributionMode: SHADER_ATTRIBUTION_MODE,
    canvasFilterMode: CANVAS_FILTER_MODE,
    layoutStagePaintMode: LAYOUT_STAGE_PAINT_MODE,
    checkboxLayerMode: LAYOUT_CHECKBOX_LAYER_MODE,
    stageGridMode: STAGE_GRID_MODE,
    reactFiberCaptureEnabled: REACT_FIBER_CAPTURE_DIAGNOSTIC,
    targetTab: PERFORMANCE_TARGET_TAB,
    entryMode: PERFORMANCE_ENTRY_MODE,
    warmLayerOpacityDiagnostic: WARM_LAYER_OPACITY_DIAGNOSTIC,
    sourceWarmLayerOpacityDiagnostic: SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC,
    stagePromotionDiagnosticEnabled: STAGE_PROMOTION_DIAGNOSTIC,
    stagePromotionDiagnosticMode: STAGE_PROMOTION_MODE,
    layoutStageWillChangeDiagnosticMode: LAYOUT_STAGE_WILL_CHANGE_MODE || null,
    layoutLayerTreeTimelineDiagnosticEnabled: LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC,
    syncPhaseTimingDiagnosticEnabled: SYNC_PHASE_TIMING_DIAGNOSTIC,
    postSnapshotTimingDiagnosticEnabled: POST_SNAPSHOT_TIMING_DIAGNOSTIC,
    waitForWarmLayoutReady: WAIT_FOR_WARM_LAYOUT_READY,
    morphStartDelayDiagnosticMs: MORPH_START_DELAY_DIAGNOSTIC,
    tabCrossfadeStartDelayDiagnosticMs: TAB_CROSSFADE_START_DELAY_DIAGNOSTIC,
    interactionPath: PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
      ? "initial-settings-with-hidden-wide-layout-premounted"
      : SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC
      ? "current-source-cold-settings-to-layout-with-hidden-layer-opacity-warmup"
      : PREWARM_LAYOUT_FROM_SETTINGS
      ? PREWARM_LAYOUT_GEOMETRY_MODE === "wide"
        ? "settings-to-layout-wide-mode-entry-prewarmed-hidden-at-final-wide-geometry"
        : "settings-to-layout-wide-mode-entry-prewarmed-at-compact-geometry"
      : process.env.AGENTVN_ADVANCED_PERF_WARM_WIDE_TAB === "1"
      ? `${PERFORMANCE_WARM_WIDE_END_TAB}-to-${PERFORMANCE_TARGET_TAB}-wide-mode-control`
      : PERFORMANCE_ENTRY_MODE === "cold"
        ? `cold-settings-to-${PERFORMANCE_TARGET_TAB}-wide-mode-entry`
      : ["layout", "theme"].includes(PERFORMANCE_TARGET_TAB)
        ? `settings-to-${PERFORMANCE_TARGET_TAB}-wide-mode-entry`
        : `settings-to-${PERFORMANCE_TARGET_TAB}-regular-mode-control`,
    performanceVariant: GLASS_STYLE_WRITE_TIMELINE_DIAGNOSTIC
      ? `diagnostic-only-advanced-navigation-glass-inline-style-write-timeline-${GLASS_STYLE_WRITE_MODE}`
      : WARM_DESCENDANT_READ_ATTRIBUTION.enabled
        ? `perturbed-attribution-only-warm-style-prepaint-${WARM_DESCENDANT_READ_ATTRIBUTION.mode}-not-acceptance`
      : WARM_DESCENDANT_STYLE_DIAGNOSTIC.enabled
        ? `diagnostic-only-warm-descendant-${WARM_DESCENDANT_PREPAINT_MODE}-not-acceptance`
      : ANGLE_BACKEND_DIAGNOSTIC.enabled
        ? `diagnostic-only-angle-backend-${ANGLE_BACKEND_DIAGNOSTIC.mode}-not-acceptance`
      : RASTER_BACKEND_DIAGNOSTIC.enabled
        ? `diagnostic-only-raster-backend-${RASTER_BACKEND_DIAGNOSTIC.mode}-not-acceptance`
      : WARM_TOP_LAYER_DIAGNOSTIC
        ? "diagnostic-only-unclipped-top-layer-warmup-not-acceptance"
      : POST_SNAPSHOT_TIMING_DIAGNOSTIC
      ? FREEZE_STAGE_SIZE_DIAGNOSTIC
        ? "diagnostic-only-stage-state-suppression-not-equivalent"
        : "diagnostic-only-post-snapshot-commit-and-render-timing"
      : SYNC_PHASE_TIMING_DIAGNOSTIC
      ? "diagnostic-only-synchronous-popover-snapshot-phase-timing"
      : GLASS_ANIMATION_TIMELINE_DIAGNOSTIC
      ? "diagnostic-only-cdp-glass-animation-lifecycle-timeline"
      : STAGE_PROMOTION_DIAGNOSTIC
      ? STAGE_PROMOTION_MODE === "first-render"
        ? "diagnostic-only-promote-first-render-layout-stage-transform-layer"
        : "diagnostic-only-pre-promote-layout-stage-transform-layer"
      : LAYOUT_STAGE_WILL_CHANGE_MODE
      ? `diagnostic-only-layout-stage-will-change-${LAYOUT_STAGE_WILL_CHANGE_MODE}`
      : LAYOUT_LAYER_TREE_TIMELINE_DIAGNOSTIC
      ? "diagnostic-only-current-source-layout-layer-tree-entry-timeline"
      : SOURCE_WARM_LAYER_OPACITY_DIAGNOSTIC
      ? "diagnostic-only-current-source-hidden-layout-opacity-0.001"
      : PREMOUNT_LAYOUT_AT_INITIAL_SETTINGS
      ? "diagnostic-only-initial-hidden-layout-pre-mount-at-final-wide-geometry"
      : PREWARM_LAYOUT_FROM_SETTINGS
      ? PREWARM_LAYOUT_GEOMETRY_MODE === "wide"
        ? "diagnostic-only-hidden-layout-content-prewarmed-at-final-wide-geometry"
        : "diagnostic-only-layout-content-prewarmed-at-compact-settings-geometry"
      : REORDER_WIDE_MODE_BEFORE_LAYOUT_MOUNT
      ? "diagnostic-only-wide-mode-morph-before-target-mount"
      : REACT_FIBER_CAPTURE_DIAGNOSTIC
      ? "diagnostic-only-one-shot-react-fiber-path-after-stage-expansion"
      : process.env.AGENTVN_ADVANCED_PERF_LAYER_TREE === "1"
      ? "diagnostic-only-composited-layer-tree"
      : STAGE_GRID_MODE === "stage-grid-disabled-diagnostic"
      ? "diagnostic-only-layout-stage-grid-disabled"
      : LAYOUT_STAGE_PAINT_MODE === "stage-paint-contained-diagnostic"
      ? "diagnostic-only-layout-preview-stage-paint-containment"
      : LAYOUT_STAGE_PAINT_MODE === "layout-content-paint-contained-diagnostic"
      ? "diagnostic-only-layout-content-paint-containment-not-acceptance"
      : LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
      ? "diagnostic-only-layout-checkbox-2d-layers-not-acceptance"
      : CANVAS_FILTER_MODE === "canvas-filter-disabled-diagnostic"
      ? "diagnostic-only-editor-canvas-filter-disabled"
      : process.env.AGENTVN_ADVANCED_PERF_HIDE_LAYOUT_PREVIEW === "1"
      ? "diagnostic-only-layout-preview-paint-hidden-geometry-preserved"
      : process.env.AGENTVN_ADVANCED_PERF_HIDE_MORPH_GHOST === "1"
      ? "diagnostic-only-morph-ghost-hidden-container-morph-preserved"
      : process.env.AGENTVN_ADVANCED_PERF_FIRST_MOUNT_OBSERVERS === "1"
      ? "diagnostic-only-first-mount-resize-observer-timing"
      : process.env.AGENTVN_ADVANCED_PERF_FREEZE_MORPH_CONTENT_OPACITY === "1"
      ? "diagnostic-only-morph-parent-content-opacity-frozen"
      : MORPH_START_DELAY_DIAGNOSTIC > 0 && TAB_CROSSFADE_START_DELAY_DIAGNOSTIC > 0
      ? "diagnostic-only-transition-animation-group-start-stagger-preserving-durations"
      : MORPH_START_DELAY_DIAGNOSTIC > 0
      ? "diagnostic-only-morph-start-stagger-preserving-duration"
      : TAB_CROSSFADE_START_DELAY_DIAGNOSTIC > 0
      ? "diagnostic-only-tab-crossfade-start-stagger-preserving-duration"
      : process.env.AGENTVN_ADVANCED_PERF_REQUIRE_THEME_CONTENT === "1"
      ? "diagnostic-only-transformed-theme-readiness-condition"
      : process.env.AGENTVN_ADVANCED_PERF_PREPARE_WIDE_TARGET_GEOMETRY === "1"
      ? "diagnostic-only-prepare-hidden-theme-at-measured-wide-geometry"
      : process.env.AGENTVN_ADVANCED_PERF_SUPPRESS_DUPLICATE_OUTGOING === "1"
      ? "diagnostic-only-suppress-real-outgoing-layout-while-geometry-snapshot-exists"
      : process.env.AGENTVN_ADVANCED_PERF_CONTAIN_POPOVER_LAYOUT === "1"
      ? "diagnostic-only-popover-layout-root-containment"
      : process.env.AGENTVN_ADVANCED_PERF_CONTAIN_POPOVER_SIZE_LAYOUT === "1"
      ? "diagnostic-only-popover-size-layout-root-containment"
      : process.env.AGENTVN_ADVANCED_PERF_PRE_READ_MOTION_TOKENS === "1"
      ? "diagnostic-only-pre-read-unchanged-root-motion-tokens"
      : process.env.AGENTVN_ADVANCED_PERF_TARGET_READINESS === "1"
      ? "diagnostic-only-target-readiness-timeline"
      : process.env.AGENTVN_ADVANCED_PERF_CONTAIN_WIDE_CONTENT === "1"
      ? "diagnostic-only-wide-content-layer-size-layout-containment"
      : process.env.AGENTVN_ADVANCED_PERF_WARM_TARGET === "1"
      ? "diagnostic-only-target-component-first-render-warmed"
      : process.env.AGENTVN_ADVANCED_PERF_PRUNE_HIDDEN_SNAPSHOT === "1"
      ? "diagnostic-only-prune-invisible-snapshot-pages"
      : process.env.AGENTVN_ADVANCED_PERF_CONTAIN_WIDE_VIEWPORT === "1"
      ? "diagnostic-only-wide-content-viewport-size-layout-containment"
      : process.env.AGENTVN_ADVANCED_PERF_FREEZE_OUTGOING_GEOMETRY === "1"
      ? "diagnostic-only-outgoing-content-original-geometry"
      : process.env.AGENTVN_ADVANCED_PERF_CACHE_CROSSFADE_TOKEN === "1"
      ? "diagnostic-only-pre-read-crossfade-token"
      : process.env.AGENTVN_ADVANCED_PERF_SLOW_DOM_READS === "1"
      ? "diagnostic-only-slow-dom-read-stacks"
      : process.env.AGENTVN_ADVANCED_PERF_FREEZE_OUTER_MORPH_TRANSFORM === "1"
      ? "diagnostic-only-outer-popover-transform-frozen-duration-preserved"
      : process.env.AGENTVN_ADVANCED_PERF_GLASS_GEOMETRY_READS === "1"
        ? "diagnostic-only-glass-navigation-geometry-read-timing"
        : process.env.AGENTVN_ADVANCED_PERF_MEASURE_POPOVER_CLONE === "1"
          ? "diagnostic-only-popover-snapshot-clone-timing"
        : PERFORMANCE_TARGET_TAB !== "layout"
          ? "diagnostic-control-target-page"
      : PERFORMANCE_ENTRY_MODE === "cold"
        ? "product-default-cold-entry"
        : "product-default",
    browser: "Playwright Chromium",
    repeatsPerMode,
    enforcedLowIntrusionThresholds: ENFORCE_LOW_INTRUSION_DIAGNOSTIC
      ? { maxLongTaskMs: viewport.longTaskMs, maxFrameGapMs: viewport.frameGapMs }
      : undefined,
    enforcedLayoutLoafThresholdMs: ENFORCE_LAYOUT_LOAF_DIAGNOSTIC
      && ["layout", "theme"].includes(PERFORMANCE_TARGET_TAB)
      ? LAYOUT_LOAF_THRESHOLD_MS
      : undefined,
    performanceFailures,
    ok: performanceFailures.length === 0,
    summaries: ["idle", "low-intrusion", "detailed"].map(summarize),
    trials,
  };
}

async function inspectLayoutCheckboxLayers(page) {
  return page.locator('.advanced-tab-content.is-active[data-tab="layout"] .runtime-layout-designer input[type="checkbox"]')
    .evaluateAll(controls => controls.filter(control => control.getClientRects().length > 0).map(control => {
      const bounds = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      const transformValue = control.computedStyleMap?.().get("transform");
      return {
        helpKey: control.getAttribute("data-help-key"),
        componentId: control.getAttribute("data-component-id"),
        checked: control.checked,
        disabled: control.disabled,
        transform: style.transform,
        is2D: transformValue?.is2D ?? null,
        rect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      };
    }));
}

async function auditLayoutCheckboxPress(page) {
  const checkbox = page.locator('.advanced-tab-content.is-active .runtime-layout-component-list input[type="checkbox"]:not(:disabled)').first();
  await checkbox.scrollIntoViewIfNeeded();
  const initial = await checkbox.isChecked();
  const bounds = await checkbox.boundingBox();
  if (!bounds) throw new Error("Live component checkbox has no bounds");
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  const hit = await checkbox.evaluate((control, point) => document.elementFromPoint(point.x, point.y) === control, { x, y });
  if (!hit) throw new Error("Component checkbox is not the actual pointer target");
  await page.mouse.move(x, y);
  await page.mouse.down();
  let pressed;
  try {
    await checkbox.evaluate(async control => {
      await Promise.all(control.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    pressed = await checkbox.evaluate(control => ({
      active: control.matches(":active"),
      scale: new DOMMatrixReadOnly(getComputedStyle(control).transform).a,
    }));
  } finally {
    await page.mouse.up();
  }
  await page.waitForFunction(({ helpKey, componentId, initial }) => {
    const controls = document.querySelectorAll('.advanced-tab-content.is-active .runtime-layout-component-list input[type="checkbox"]');
    const control = [...controls].find(node => node.getAttribute("data-help-key") === helpKey
      && node.getAttribute("data-component-id") === componentId);
    return control?.checked === !initial;
  }, { ...await checkbox.evaluate(control => ({
    helpKey: control.getAttribute("data-help-key"), componentId: control.getAttribute("data-component-id"),
  })), initial }, { timeout: 3000 });
  await checkbox.focus();
  await checkbox.press("Space");
  // Space starts the same press/release presentation as the pointer path.
  // Inspect the settled layer after that real transition, not its temporary
  // interpolated matrix. Closed <details> controls have no painted layer.
  await checkbox.evaluate(async control => {
    await Promise.all(control.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
  const restored = await checkbox.isChecked() === initial;
  const focused = await checkbox.evaluate(control => document.activeElement === control);
  return { ok: hit && pressed.active && Math.abs(pressed.scale - .94) < .002 && restored && focused,
    hit, pressed, restored, focused };
}

async function runViewport(browser, viewport) {
  const page = await openAuditPage(browser, { viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: Number(process.env.ADVANCED_TOOLS_DPR || 1) });
  await installDeterministicProjectFixture(page);
  await openAdvancedSettings(page);
  const paintOverrideCss = layoutStagePaintOverrideCss(LAYOUT_STAGE_PAINT_MODE);
  if (paintOverrideCss) await page.addStyleTag({ content: paintOverrideCss });
  const checkboxLayerCss = layoutCheckboxLayerOverrideCss(LAYOUT_CHECKBOX_LAYER_MODE);
  if (checkboxLayerCss) await page.addStyleTag({ content: checkboxLayerCss });
  await installPerformanceProbe(page);
  const advancedTabStrip = await auditAdvancedTabStrip(page);

  const layoutTab = page.locator('[data-help-key="advanced.tab.layout"]').first();
  await waitForCenterHit(page, '[data-help-key="advanced.tab.layout"]', 30000);
  await layoutTab.hover().catch(() => {});
  await page.waitForTimeout(120);
  const browserStart = await page.evaluate(() => performance.now());
  await startPerformanceProbe(page);
  const resizeGlassSamples = await captureResizeGlassMotion(page, () => layoutTab.click());
  const resizeGlassAudit = auditResizeGlassSamples(resizeGlassSamples);
  const stagePreviewAudit = auditStagePreviewSamples(resizeGlassSamples);
  const designerCandidates = await page.locator(".runtime-layout-designer").evaluateAll(elements =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const activeContent = element.closest(".advanced-tab-content.is-active");
      const ghost = element.closest(".toolbar-popover-morph-ghost");
      const accessibilityOwner = element.closest("[aria-hidden='true'], [inert]");
      return {
        className: element.className,
        activeScreen: element.getAttribute("data-active-screen"),
        ready: element.getAttribute("data-advanced-tab-ready"),
        activeContent: Boolean(activeContent),
        morphGhost: Boolean(ghost),
        ghostAriaHidden: ghost?.getAttribute("aria-hidden") ?? null,
        ghostInert: ghost?.hasAttribute("inert") ?? false,
        accessibilityOwner: accessibilityOwner ? {
          className: typeof accessibilityOwner.className === "string" ? accessibilityOwner.className : "",
          ariaHidden: accessibilityOwner.getAttribute("aria-hidden"),
          inert: accessibilityOwner.hasAttribute("inert"),
        } : null,
        display: style.display,
        visibility: style.visibility,
        opacity: Number(style.opacity),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        ancestors: Array.from((function* () {
          for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement)
            yield parent;
        })()).slice(0, 6).map(parent => ({
          tag: parent.tagName,
          className: typeof parent.className === "string" ? parent.className : "",
          ariaHidden: parent.getAttribute("aria-hidden"),
          inert: parent.hasAttribute("inert"),
        })),
      };
    }));
  const activeDesigners = designerCandidates.filter(candidate => candidate.activeContent);
  const morphGhosts = designerCandidates.filter(candidate => candidate.morphGhost);
  if (activeDesigners.length !== 1 || morphGhosts.some(candidate =>
    candidate.ghostAriaHidden !== "true" || !candidate.ghostInert || !candidate.accessibilityOwner?.inert))
    throw new Error(`Layout designer presentation ownership is invalid: ${JSON.stringify(designerCandidates)}`);
  const designerLayerAudit = { candidates: designerCandidates, activeDesignerCount: activeDesigners.length,
    inertMorphGhostCount: morphGhosts.length };
  await page.locator(".advanced-tab-content.is-active .runtime-layout-designer")
    .waitFor({ state: "visible", timeout: 30000 });
  await page.locator('.advanced-tab-content.is-active [data-help-key="layout.save"]')
    .waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const panel = document.querySelector(".advanced-tools-panel");
    const designer = document.querySelector(".advanced-tab-content.is-active .runtime-layout-designer");
    if (!panel || !designer) return false;
    // Older builds exposed animation state classes; current builds settle by
    // the time the designer and save action are visible. Accept either shape
    // so this audit verifies geometry rather than a removed implementation
    // detail.
    return !panel.classList.contains("is-tab-entering") && !designer.classList.contains("is-entering");
  }, null, { timeout: 2000 }).catch(() => {});
  const componentListAudit = await auditRuntimeLayoutComponentList(page);
  const unifiedGameClientControls = await auditUnifiedGameClientControls(page);
  const stableMs = await page.evaluate((startedAt) => performance.now() - startedAt, browserStart);
  await page.waitForTimeout(80);
  const perf = await stopPerformanceProbe(page, browserStart);
  await page.waitForFunction(() => [...document.querySelectorAll(".glass-selection-indicator")].every((indicator) => (
    indicator.getAttribute("data-glass-visible") !== "true"
      || (
        indicator.getAttribute("data-glass-state") === "settled"
        && indicator.getAttribute("data-glass-moving") === "false"
      )
  )), null, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll(".glass-selection-group")].every((group) => {
    const selected = group.querySelector('[data-glass-selected="true"]');
    const indicator = group.querySelector(".glass-selection-indicator");
    if (!(selected instanceof HTMLElement) || !(indicator instanceof HTMLElement) || indicator.dataset.glassVisible !== "true") return true;
    const selectedRect = selected.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const centerDelta = Math.hypot(
      selectedRect.left + selectedRect.width / 2 - (indicatorRect.left + indicatorRect.width / 2),
      selectedRect.top + selectedRect.height / 2 - (indicatorRect.top + indicatorRect.height / 2),
    );
    const sizeDelta = Math.max(
      Math.abs(selectedRect.width - indicatorRect.width),
      Math.abs(selectedRect.height - indicatorRect.height),
    );
    return centerDelta <= 1 && sizeDelta <= 1;
  }), null, { timeout: 10000 }).catch(() => {});

  const targets = [];
  for (const target of requiredTargets) targets.push(await auditTarget(page, target));
  const glassContracts = await auditVisibleGlassGroups(page);
  const hoverMotion = await auditSelectedHoverMotion(page);
  const sidebarInteraction = await auditSidebarInteraction(page);
  const snapGuideAudit = await auditStageSnapGuideInteraction(page);
  const checkboxPressAudit = LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
    ? await auditLayoutCheckboxPress(page) : null;
  const checkboxLayerEvidence = LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
    ? await inspectLayoutCheckboxLayers(page) : null;
  const paintBoundaryEvidence = LAYOUT_STAGE_PAINT_MODE === "layout-content-paint-contained-diagnostic"
    ? await page.locator('.advanced-tab-content.is-active[data-tab="layout"]').evaluate(layer => {
      const contain = getComputedStyle(layer).contain;
      return {
        contain,
        liveOwner: !layer.closest(".toolbar-popover-morph-ghost, [inert], [aria-hidden='true']"),
        applied: contain === "strict"
          || ["size", "layout", "paint", "style"].every(value => contain.split(/\s+/).includes(value)),
      };
    }) : null;

  const screenshot = path.join(OUT_DIR, `${viewport.label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();

  const failures = [];
  const nonBlockingDiagnostics = [];
  if (!stagePreviewAudit.ok) failures.push(...stagePreviewAudit.failures.map((failure) => `stage preview: ${failure}`));
  if (stableMs > viewport.stableMs) nonBlockingDiagnostics.push(`stable time ${Math.round(stableMs)}ms > ${viewport.stableMs}ms`);
  if (perf.maxLongTaskMs > viewport.longTaskMs) nonBlockingDiagnostics.push(`long task ${Math.round(perf.maxLongTaskMs)}ms > ${viewport.longTaskMs}ms`);
  if (perf.maxFrameGapMs > viewport.frameGapMs) nonBlockingDiagnostics.push(`frame gap ${Math.round(perf.maxFrameGapMs)}ms > ${viewport.frameGapMs}ms`);
  for (const target of targets) {
    if (!target.ok) failures.push(`${target.name}: ${target.failures.join(", ")}`);
  }
  for (const contract of glassContracts) {
    if (!contract.ok) nonBlockingDiagnostics.push(`glass group ${contract.className || contract.index}: ${contract.failures.join(", ")}`);
  }
  if (!resizeGlassAudit.ok) nonBlockingDiagnostics.push(...resizeGlassAudit.failures.map((failure) => `resize glass: ${failure}`));
  if (ENFORCE_PERFORMANCE) failures.push(...nonBlockingDiagnostics);
  if (!hoverMotion.ok) failures.push(...hoverMotion.failures.map((failure) => `hover: ${failure}`));
  if (!advancedTabStrip.ok) failures.push(...advancedTabStrip.failures.map((failure) => `advanced tabs: ${failure}`));
  if (!componentListAudit.ok) failures.push(...componentListAudit.failures.map((failure) => `component list: ${failure}`));
  if (!sidebarInteraction.ok) failures.push(...sidebarInteraction.failures.map((failure) => `sidebar interaction: ${failure}`));
  if (!snapGuideAudit.ok) failures.push(...snapGuideAudit.failures.map((failure) => `snap guide: ${failure}`));
  if (!unifiedGameClientControls.ok) failures.push(...unifiedGameClientControls.failures.map((failure) => `unified controls: ${failure}`));
  if (paintBoundaryEvidence && (!paintBoundaryEvidence.applied || !paintBoundaryEvidence.liveOwner))
    failures.push("Layout content paint boundary was not applied to the live owner");
  if (checkboxPressAudit && !checkboxPressAudit.ok)
    failures.push("2D checkbox candidate changed pointer press, check state or keyboard focus");
  if (checkboxLayerEvidence && (!checkboxLayerEvidence.length
    || checkboxLayerEvidence.some(control => control.is2D !== true)))
    failures.push("2D checkbox candidate was not applied to the live controls");

  return {
    viewport,
    layoutStagePaintMode: LAYOUT_STAGE_PAINT_MODE,
    paintBoundaryEvidence,
    checkboxLayerMode: LAYOUT_CHECKBOX_LAYER_MODE,
    checkboxPressAudit,
    checkboxLayerEvidence,
    ok: failures.length === 0,
    failures,
    nonBlockingDiagnostics,
    stableMs,
    maxLongTaskMs: perf.maxLongTaskMs,
    observationBoundary: perf.observationBoundary,
    maxFrameGapMs: perf.maxFrameGapMs,
    longTaskCount: perf.longTasks.length,
    longTasks: perf.longTasks.slice(0, 12),
    longAnimationFrameCount: perf.longAnimationFrameCount,
    maxLongAnimationFrameMs: perf.maxLongAnimationFrameMs,
    maxLongAnimationFrameBlockingMs: perf.maxLongAnimationFrameBlockingMs,
    longAnimationFrames: perf.longAnimationFrames,
    targetAudits: targets,
    glassContracts,
    resizeGlassAudit,
    stagePreviewAudit,
    resizeGlassSamples,
    hoverMotion,
    componentListAudit,
    sidebarInteraction,
    snapGuideAudit,
    unifiedGameClientControls,
    designerLayerAudit,
    advancedTabStrip,
    screenshot,
  };
}

async function collectBrowserRuntimeInfo(browser, viewport) {
  const page = await openAuditPage(browser, {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: Number(process.env.ADVANCED_TOOLS_DPR || 1),
  });
  try {
    return await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        visibilityState: document.visibilityState,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
        webglVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        webglRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
        webglVersion: gl?.getParameter(gl.VERSION) ?? null,
      };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

function assertPersistentProfilePathHasNoLinks(profileDirectory) {
  const outputRoot = path.join(ROOT, "output", "playwright");
  const relative = path.relative(outputRoot, profileDirectory);
  let cursor = outputRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new Error(`Persistent browser profile path contains a link: ${path.relative(outputRoot, cursor)}`);
    }
  }
}

(async () => {
  const report = {
    ok: true,
    kind: PERFORMANCE_DIAGNOSTIC_ONLY ? "diagnostic-only-not-acceptance"
      : LAYOUT_STAGE_PAINT_MODE !== "product-default" || LAYOUT_CHECKBOX_LAYER_MODE !== "product-default"
        ? "diagnostic-only-behavior-not-acceptance" : "acceptance",
    at: new Date().toISOString(),
    isolation: {
      input: TEST_PROJECT_PATH,
      output: OUT_DIR,
      fixtureProjectId: acceptancePaths.fixtureProjectId,
      isolated: acceptancePaths.isolated,
    },
    editorUrl: EDITOR_URL,
    enforcePerformance: ENFORCE_PERFORMANCE,
    hoverHelpAttributionMode,
    persistentBrowserProfileDiagnostic: PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.enabled
      ? {
        ...PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC,
        processId: process.pid,
        before: null,
        after: null,
        launchEvidence: null,
      }
      : null,
    logs: [],
    results: [],
  };
  let browser;
  let server;
  try {
    const headful = process.env.AGENTVN_ADVANCED_LAYOUT_HEADFUL === "1";
    report.browserMode = headful ? "headful-visible" : "headless";
    if (SHADER_TRACE_REUSE_PAIR) report.shaderReusePair = {
      kind: "two-fresh-pages-sharing-one-browser-gpu-cache-not-independent-cold-acceptance",
      comparison: "first visible activation on each fresh page; product hidden pre-mount is preserved and browser GPU/cache is intentionally retained",
    };
    if (REQUIRE_HARDWARE_GPU_PROVENANCE && !PERFORMANCE_DIAGNOSTIC_ONLY) {
      throw new Error(
        "Hardware-GPU provenance gate is only valid for performance diagnostic runs.",
      );
    }
    if (REQUIRE_HARDWARE_GPU_PROVENANCE && !headful) {
      throw new Error(
        "Hardware-GPU diagnostics require AGENTVN_ADVANCED_LAYOUT_HEADFUL=1 before browser launch.",
      );
    }
    if (PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.enabled) {
      assertPersistentProfilePathHasNoLinks(PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.profileDirectory);
      const before = getPersistentProfileDiskEvidence(
        PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.profileDirectory,
      );
      const beforeValidation = getPersistentBrowserProfileState(
        PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.phase,
        before,
      );
      report.persistentBrowserProfileDiagnostic.before = before;
      if (!beforeValidation.valid) {
        throw new Error(`Persistent browser profile state rejected: ${beforeValidation.failures.join("; ")}`);
      }
    }
    server = await ensureEditor(report);
    const browserLaunchOptions = {
      headless: !headful,
      args: [...RASTER_BACKEND_DIAGNOSTIC.args, ...ANGLE_BACKEND_DIAGNOSTIC.args, ...SHADER_DRIVER_TRACE_ARGS],
    };
    if (PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.enabled) {
      persistentBrowserContext = await chromium.launchPersistentContext(
        PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.profileDirectory,
        {
          ...browserLaunchOptions,
          viewport: { width: 3840, height: 2160 },
          deviceScaleFactor: 1,
          reducedMotion: "no-preference",
        },
      );
      browser = persistentBrowserContext.browser();
      if (!browser) throw new Error("Persistent Chromium context did not expose its browser connection.");
      if (persistentBrowserContext.pages().length === 0) {
        await persistentBrowserContext.newPage();
      }
      const session = await browser.newBrowserCDPSession();
      try {
        const info = await session.send("SystemInfo.getInfo");
        const launchEvidence = validateShaderCacheLaunch({
          browserCommandLine: info.commandLine,
          gpuFeatureStatus: info.gpu?.featureStatus,
        });
        const profileArgumentValue = launchEvidence.browserArguments
          .find(argument => argument.startsWith("--user-data-dir="))
          ?.slice("--user-data-dir=".length);
        const profileArgument = profileArgumentValue?.replace(/^"|"$/g, "");
        const actualProfileDirectory = profileArgument ? path.resolve(profileArgument) : "";
        const sameProfile = actualProfileDirectory.toLowerCase()
          === PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.profileDirectory.toLowerCase();
        report.persistentBrowserProfileDiagnostic.launchEvidence = {
          browserVersion: await browser.version(),
          actualProfileDirectory,
          sameProfile,
          browserCommandLine: info.commandLine,
          gpuFeatureStatus: info.gpu?.featureStatus,
          ...launchEvidence,
        };
        if (!launchEvidence.valid || !sameProfile) {
          throw new Error(
            `Persistent profile launch validation failed: ${
              [...launchEvidence.failures, ...(!sameProfile ? ["actual user-data-dir does not match requested profile"] : [])].join("; ")
            }`,
          );
        }
      } finally {
        await session.detach().catch(() => {});
      }
    } else {
      browser = await chromium.launch(browserLaunchOptions);
    }
    if (SHADER_CACHE_EVIDENCE_ENABLED || SHADER_TRACE_ENABLED) {
      const session = await browser.newBrowserCDPSession();
      try {
        const info = await session.send("SystemInfo.getInfo");
        report.shaderCacheLaunchEvidence = {
          browserVersion: await browser.version(),
          browserCommandLine: info.commandLine, gpuFeatureStatus: info.gpu?.featureStatus,
          gpuServiceTracing: SHADER_DRIVER_TRACE_ARGS.length > 0,
          ...validateShaderCacheLaunch({
            browserCommandLine: info.commandLine, gpuFeatureStatus: info.gpu?.featureStatus,
          }),
        };
        if (!report.shaderCacheLaunchEvidence.valid)
          throw new Error(`Shader-cache launch invalid: ${report.shaderCacheLaunchEvidence.failures.join("; ")}`);
        if (SHADER_DRIVER_TRACE_ARGS.length > 0
          && !report.shaderCacheLaunchEvidence.browserArguments.includes("--enable-gpu-service-tracing"))
          throw new Error("GL driver trace launch argument was not confirmed on the actual browser.");
      } finally {
        await session.detach().catch(() => {});
      }
    }
    if (RASTER_BACKEND_DIAGNOSTIC.enabled) {
      const session = await browser.newBrowserCDPSession();
      try {
        const info = await session.send("SystemInfo.getInfo");
        const evidence = {
          gpuFeatureStatus: info.gpu?.featureStatus,
          browserArguments: extractBrowserSwitches(info.commandLine),
          browserCommandLine: info.commandLine,
          gpuDevices: info.gpu?.devices,
        };
        report.rasterBackendDiagnostic = {
          mode: RASTER_BACKEND_DIAGNOSTIC.mode,
          kind: "renderer-configuration-attribution-not-acceptance",
          ...evidence,
          ...validateRasterBackendEvidence(RASTER_BACKEND_DIAGNOSTIC.mode, evidence),
        };
        if (!report.rasterBackendDiagnostic.valid) {
          throw new Error(`Raster backend evidence invalid: ${report.rasterBackendDiagnostic.failures.join("; ")}`);
        }
      } finally {
        await session.detach().catch(() => {});
      }
    }
    if (PERFORMANCE_DIAGNOSTIC_ONLY) {
      report.kind = "diagnostic-only-not-acceptance";
      report.diagnosticResults = [];
      for (const viewport of viewports) {
        report.browserRuntime = await collectBrowserRuntimeInfo(browser, viewport);
        if (ANGLE_BACKEND_DIAGNOSTIC.enabled) {
          const angleSession = await browser.newBrowserCDPSession();
          try {
            const info = await angleSession.send("SystemInfo.getInfo");
            const evidence = {
              gpuFeatureStatus: info.gpu?.featureStatus,
              gpuAuxAttributes: info.gpu?.auxAttributes,
              gpuDevices: info.gpu?.devices,
              browserArguments: extractBrowserSwitches(info.commandLine),
              browserCommandLine: info.commandLine,
            };
            report.angleBackendDiagnostic = {
              kind: "graphics-api-attribution-not-acceptance", mode: ANGLE_BACKEND_DIAGNOSTIC.mode,
              ...evidence, ...validateAngleBackendEvidence(ANGLE_BACKEND_DIAGNOSTIC.mode, evidence),
            };
            if (!report.angleBackendDiagnostic.valid)
              throw new Error(`ANGLE backend evidence invalid: ${report.angleBackendDiagnostic.failures.join("; ")}`);
          } finally {
            await angleSession.detach().catch(() => {});
          }
        }
        if (REQUIRE_HARDWARE_GPU_PROVENANCE) {
          report.gpuProvenance = validateBrowserGpuProvenance({
            browserMode: report.browserMode,
            userAgent: report.browserRuntime.userAgent,
            webglRenderer: report.browserRuntime.webglRenderer,
          }, EXPECTED_GPU_RENDERER);
          report.gpuProvenance.expectedRenderer = EXPECTED_GPU_RENDERER;
          if (!report.gpuProvenance.ok) {
            throw new Error(
              `Hardware-GPU provenance check failed: ${report.gpuProvenance.failures.join("; ")}`,
            );
          }
        }
        const result = await server.run(() => runPerformanceDiagnostic(browser, viewport));
        report.diagnosticResults.push(result);
        if (!result.ok) report.ok = false;
      }
    } else {
      for (const viewport of viewports) {
        const result = await server.run(() => runViewport(browser, viewport));
        report.results.push(result);
        if (!result.ok) report.ok = false;
      }
    }
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? {
      message: error.message, stack: error.stack, diagnosticEvidencePath: error.diagnosticEvidencePath,
    } : { message: String(error) };
  } finally {
    if (persistentBrowserContext) {
      await persistentBrowserContext.close().catch(error => {
        report.ok = false;
        report.persistentBrowserProfileDiagnostic.cleanupError =
          error instanceof Error ? error.message : String(error);
      });
      persistentBrowserContext = null;
    } else if (browser) {
      await browser.close().catch(() => {});
    }
    if (PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.enabled) {
      try {
        const after = getPersistentProfileDiskEvidence(
          PERSISTENT_BROWSER_PROFILE_DIAGNOSTIC.profileDirectory,
        );
        report.persistentBrowserProfileDiagnostic.after = after;
        const afterState = getPersistentBrowserProfileState("reuse", after);
        report.persistentBrowserProfileDiagnostic.persistenceConfirmed = afterState.valid;
        report.persistentBrowserProfileDiagnostic.persistenceFailures = afterState.failures;
        if (!afterState.valid) report.ok = false;
      } catch (error) {
        report.ok = false;
        report.persistentBrowserProfileDiagnostic.persistenceError =
          error instanceof Error ? error.message : String(error);
      }
    }
    await server?.stop();
    const reportPath = PERFORMANCE_DIAGNOSTIC_ONLY ? PERFORMANCE_DIAGNOSTIC_PATH : REPORT_PATH;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({
      ok: report.ok,
      kind: report.kind || "acceptance",
      reportPath,
      results: report.results.map((item) => ({
        viewport: item.viewport.label,
        ok: item.ok,
        stableMs: Math.round(item.stableMs),
        maxLongTaskMs: Math.round(item.maxLongTaskMs),
        maxFrameGapMs: Math.round(item.maxFrameGapMs),
        failures: item.failures,
        screenshot: item.screenshot,
      })),
      diagnosticResults: report.diagnosticResults?.map((result) => ({
        viewport: `${result.viewport.width}x${result.viewport.height}`,
        ok: result.ok,
        performanceFailures: result.performanceFailures,
        summaries: result.summaries,
      })),
      error: report.error,
    }, null, 2));
  }
  if (!report.ok) process.exit(1);
})();
