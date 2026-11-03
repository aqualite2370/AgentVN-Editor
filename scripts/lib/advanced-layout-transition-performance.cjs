function summarizeLongAnimationFrame(entry) {
  return {
    startTime: entry.startTime,
    duration: entry.duration,
    blockingDuration: entry.blockingDuration,
    renderStart: entry.renderStart ?? 0,
    styleAndLayoutStart: entry.styleAndLayoutStart ?? 0,
    scripts: (entry.scripts ?? []).slice(0, 8).map((script) => ({
      invoker: script.invoker ?? "",
      invokerType: script.invokerType ?? "",
      sourceURL: script.sourceURL ?? "",
      sourceFunctionName: script.sourceFunctionName ?? "",
      sourceCharPosition: script.sourceCharPosition ?? -1,
      duration: script.duration ?? 0,
      executionStart: script.executionStart ?? 0,
      forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? 0,
    })),
  };
}

function validateBrowserGpuProvenance(browserEvidence, expectedGpu = "") {
  const failures = [];
  const browserMode = String(browserEvidence?.browserMode ?? "");
  const userAgent = String(browserEvidence?.userAgent ?? "");
  const webglRenderer = String(browserEvidence?.webglRenderer ?? "");
  if (browserMode !== "headful-visible")
    failures.push("browser was not launched in visible headful mode");
  if (/headless/i.test(userAgent))
    failures.push("browser user agent identifies a headless runtime");
  if (!webglRenderer.trim() || /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver/i.test(webglRenderer))
    failures.push("WebGL renderer is missing or software-rendered");
  const expected = String(expectedGpu ?? "").trim();
  if (expected && !webglRenderer.toLowerCase().includes(expected.toLowerCase()))
    failures.push(`WebGL renderer does not match expected GPU: ${expected}`);
  return { ok: failures.length === 0, failures };
}

function getAnimationStartDelayDiagnostic(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return 0;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("Animation diagnostic delay must be a positive integer between 1 and 240 milliseconds.");
  }
  const delayMs = Number(value);
  if (!Number.isSafeInteger(delayMs) || delayMs > 240) {
    throw new Error("Animation diagnostic delay must be a positive integer between 1 and 240 milliseconds.");
  }
  return delayMs;
}

function getAnimationStartDelaySetupFailures({
  delayMs,
  entryMode,
  targetTab,
  productionPreview,
  layoutPreMounted,
  warmLayerOpacity,
} = {}) {
  if (!(Number(delayMs) > 0)) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("animation start-delay diagnostic requires a cold entry");
  if (targetTab !== "layout") failures.push("animation start-delay diagnostic requires the layout target");
  if (productionPreview !== true) failures.push("animation start-delay diagnostic requires the production preview");
  const opacity = Number(warmLayerOpacity);
  const expectedOpacity = layoutPreMounted === true ? 0.001 : 0;
  if (!Number.isFinite(opacity) || opacity !== expectedOpacity) {
    failures.push(layoutPreMounted === true
      ? "pre-mounted animation diagnostic requires warm-layer opacity 0.001"
      : "default cold animation diagnostic must not pre-mount the layout layer");
  }
  return failures;
}

function getLayoutHealthStateFailures({
  targetTab,
  layoutPreMounted = false,
  layoutMountedBeforeInteraction = false,
  layoutReadyBeforeInteraction = false,
  healthStates = [],
} = {}) {
  if (targetTab !== "layout") return [];
  const states = Array.isArray(healthStates) ? healthStates : [];
  const failures = [];
  if (!layoutPreMounted
    && !layoutMountedBeforeInteraction
    && !layoutReadyBeforeInteraction
    && !states.includes("pending")) {
    failures.push("layout health did not expose its pending state during first paint");
  }
  if (states.at(-1) === "pending") {
    failures.push("layout health did not finish after the page became ready");
  }
  return failures;
}

function getWarmLayoutReadinessFailures({ waitForReady = false, evidence } = {}) {
  if (!waitForReady) return [];
  if (evidence?.readyAtInteraction === true
    && Number(evidence.stageWidth) > 0
    && Number(evidence.stageHeight) > 0) {
    return [];
  }
  return ["layout warm readiness was not confirmed immediately before interaction"];
}

function getWarmLayerVisualEquivalenceFailures({
  baseline,
  candidate,
  pixelDiff,
  controlPixelDiff,
  geometryTolerance = 0.5,
} = {}) {
  const failures = [];
  const states = [
    ["selectedTab", "settings"],
    ["panelWideMode", false],
    ["ariaHidden", true],
    ["inert", true],
    ["pointerEvents", "none"],
    ["activeElementInside", false],
    ["designerReady", true],
    ["previewMounted", true],
  ];
  if (!baseline || !candidate) return ["missing hidden-layer state snapshot"];
  for (const [key, expected] of states) {
    if (baseline[key] !== expected)
      failures.push(`baseline hidden-layer state ${key} was not ${String(expected)}`);
    if (candidate[key] !== expected)
      failures.push(`candidate hidden-layer state ${key} was not ${String(expected)}`);
  }
  for (const key of ["popover", "viewport", "stage"]) {
    const before = baseline.geometry?.[key];
    const after = candidate.geometry?.[key];
    if (!before || !after) {
      failures.push(`missing ${key} geometry for hidden-layer comparison`);
      continue;
    }
    for (const dimension of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(Number(before[dimension]))
        || !Number.isFinite(Number(after[dimension]))) {
        failures.push(`${key} ${dimension} geometry is not finite`);
      } else if (Math.abs(Number(before[dimension]) - Number(after[dimension])) > geometryTolerance) {
        failures.push(`${key} ${dimension} geometry changed`);
      }
    }
  }

  const sameDimensions = (left, right) => Number(left?.width) > 0
    && Number(left?.height) > 0
    && left.width === right?.width
    && left.height === right?.height;
  if (!sameDimensions(pixelDiff, controlPixelDiff))
    failures.push("candidate and same-opacity control screenshots have different dimensions");
  for (const [label, evidence] of [
    ["control", controlPixelDiff],
    ["candidate", pixelDiff],
  ]) {
    for (const key of ["maxChannelDelta", "changedPixels", "pixelsOverOneLevel"]) {
      if (!Number.isFinite(Number(evidence?.[key])) || Number(evidence[key]) < 0)
        failures.push(`${label} screenshot ${key} is not a valid measurement`);
    }
  }
  for (const key of ["pixelsOutsideControlNoise", "pixelsExceedingControlEnvelope"]) {
    if (!Number.isFinite(Number(pixelDiff?.[key])) || Number(pixelDiff[key]) < 0)
      failures.push(`candidate screenshot is missing ${key} comparison`);
    else if (Number(pixelDiff[key]) > 0)
      failures.push(`warm-layer opacity produced ${pixelDiff[key]} ${key}`);
  }
  return failures;
}

function getSourceWarmOpacitySetupFailures({
  enabled = false,
  opacity = 0,
  entryMode,
  targetTab,
  developmentSource,
  layoutPreMountedByBundlePatch,
  otherWarmupEnabled,
} = {}) {
  if (!enabled || Number(opacity) === 0) return [];
  const failures = [];
  if (Number(opacity) !== 0.001) failures.push("source warm-layer opacity must be 0.001");
  if (entryMode !== "cold") failures.push("source warm-layer opacity requires a cold entry");
  if (targetTab !== "layout") failures.push("source warm-layer opacity requires the layout target");
  if (developmentSource !== true) failures.push("source warm-layer opacity requires the current development source");
  if (layoutPreMountedByBundlePatch === true)
    failures.push("source warm-layer opacity cannot combine with a bundle pre-mount patch");
  if (otherWarmupEnabled === true)
    failures.push("source warm-layer opacity cannot combine with another warm-up diagnostic");
  return failures;
}

function getSourceWarmOpacityStateFailures({ before, after, geometryTolerance = 0.5 } = {}) {
  const failures = [];
  if (!before || !after) return ["missing source warm-opacity state snapshots"];
  const expected = {
    selectedTab: "settings",
    opacity: 0,
    ariaHidden: true,
    inert: true,
    pointerEvents: "none",
    activeElementInside: false,
    designerReady: true,
    previewMounted: true,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (before[key] !== value) failures.push(`source warm-opacity baseline ${key} was not ${String(value)}`);
  }
  for (const [key, value] of Object.entries({ ...expected, opacity: 0.001 })) {
    if (after[key] !== value) failures.push(`source warm-opacity candidate ${key} was not ${String(value)}`);
  }
  for (const key of ["viewport", "stage"]) {
    const baseline = before.geometry?.[key];
    const candidate = after.geometry?.[key];
    if (!baseline || !candidate) {
      failures.push(`missing ${key} geometry for source warm-opacity comparison`);
      continue;
    }
    for (const dimension of ["x", "y", "width", "height"]) {
      if (!Number.isFinite(Number(baseline[dimension]))
        || !Number.isFinite(Number(candidate[dimension]))) {
        failures.push(`${key} ${dimension} geometry is not finite`);
      } else if (Math.abs(Number(baseline[dimension]) - Number(candidate[dimension])) > geometryTolerance) {
        failures.push(`${key} ${dimension} geometry changed under source warm opacity`);
      }
    }
  }
  return failures;
}

function summarizeTargetModuleResourceReadiness(resourceEntries, targetNameFragment, interactionStartTime) {
  const fragment = String(targetNameFragment ?? "").trim();
  const interactionStart = Number(interactionStartTime);
  const resources = (Array.isArray(resourceEntries) ? resourceEntries : [])
    .filter(entry => String(entry?.name ?? "").includes(fragment))
    .map(entry => ({
      name: String(entry.name).split(/[\\/]/).at(-1) ?? "",
      startTime: Number(entry.startTime),
      responseEnd: Number(entry.responseEnd),
      transferSize: Number(entry.transferSize),
    }));
  return {
    matchedResourceCount: resources.length,
    loadedBeforeInteraction: resources.length > 0
      && Number.isFinite(interactionStart)
      && resources.every(resource => Number.isFinite(resource.responseEnd)
        && resource.responseEnd > 0
        && resource.responseEnd <= interactionStart),
    resources,
  };
}

function summarizeFirstPresentationResourceReadiness({
  interactionWindow,
  resources = [],
  images = [],
  fonts = {},
} = {}) {
  const start = Number(interactionWindow?.start);
  const end = Number(interactionWindow?.end);
  const validWindow = Number.isFinite(start) && Number.isFinite(end) && end >= start;
  const lateResources = (Array.isArray(resources) ? resources : [])
    .filter((entry) => {
      const resourceStart = Number(entry?.startTime);
      return validWindow && Number.isFinite(resourceStart) && resourceStart >= start && resourceStart <= end;
    })
    .map((entry) => ({
      name: String(entry?.name ?? "").split(/[\\/]/).at(-1) ?? "",
      initiatorType: String(entry?.initiatorType ?? ""),
      startTime: Number(entry.startTime),
      responseEnd: Number(entry?.responseEnd) || 0,
      transferSize: Number(entry?.transferSize) || 0,
    }));
  const normalizedImages = (Array.isArray(images) ? images : []).map((image) => {
    const rawSource = String(image?.source ?? "");
    let source = "[unavailable]";
    if (/^data:/i.test(rawSource)) {
      source = "data:";
    } else if (rawSource) {
      try {
        const url = new URL(rawSource);
        source = url.pathname.split("/").filter(Boolean).at(-1) ?? url.protocol;
      } catch {
        source = "[invalid-url]";
      }
    }
    return {
      source,
      complete: image?.complete === true,
      naturalWidth: Number(image?.naturalWidth) || 0,
      naturalHeight: Number(image?.naturalHeight) || 0,
    };
  });
  const pendingFontFaces = (Array.isArray(fonts?.faces) ? fonts.faces : [])
    .filter((face) => String(face?.status ?? "") !== "loaded")
    .map((face) => String(face?.family ?? "[unnamed]"))
    .filter((family, index, all) => all.indexOf(family) === index);
  const fontSetStatus = String(fonts?.status ?? "");
  return {
    window: {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      valid: validWindow,
    },
    lateResources,
    lateResourceCount: lateResources.length,
    imageCount: normalizedImages.length,
    completeImageCount: normalizedImages.filter((image) => (
      image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
    )).length,
    incompleteImages: normalizedImages.filter((image) => (
      !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0
    )),
    fontSetStatus,
    pendingFontFaces,
  };
}

function summarizeGlassAnimationTimeline(events, longAnimationFrames) {
  const targetSelector = /(?:\.advanced-tools-panel\s*>\s*nav\.glass-selection-group|\.runtime-layout-sidebar).*\.glass-selection-indicator/;
  const animations = new Map();
  let startCount = 0;
  let cancelCount = 0;
  let unmatchedCancelCount = 0;
  let invalidEventCount = 0;

  for (const event of Array.isArray(events) ? events : []) {
    const kind = String(event?.event ?? "");
    const animationId = String(event?.animationId ?? "");
    const target = String(event?.target ?? "");
    const at = Number(event?.at);
    if (!targetSelector.test(target)) continue;
    if (!animationId || !Number.isFinite(at) || at < 0) {
      invalidEventCount += 1;
      continue;
    }
    if (kind === "started") {
      const durationMs = Number(event?.durationMs);
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        invalidEventCount += 1;
        continue;
      }
      startCount += 1;
      const existing = animations.get(animationId);
      animations.set(animationId, {
        animationId,
        target,
        startTime: at,
        endTime: at + durationMs,
        durationMs,
        animationType: String(event?.animationType ?? ""),
        cancelledAt: existing?.cancelledAt ?? null,
      });
      continue;
    }
    if (kind === "canceled") {
      cancelCount += 1;
      const existing = animations.get(animationId);
      if (!existing) {
        unmatchedCancelCount += 1;
      } else {
        existing.cancelledAt = at;
        existing.endTime = Math.min(existing.endTime, at);
      }
      continue;
    }
    invalidEventCount += 1;
  }

  const frames = (Array.isArray(longAnimationFrames) ? longAnimationFrames : [])
    .map((frame) => ({
      startTime: Number(frame?.startTime),
      duration: Number(frame?.duration),
    }))
    .filter(frame => Number.isFinite(frame.startTime)
      && frame.startTime >= 0
      && Number.isFinite(frame.duration)
      && frame.duration >= 0);
  const overlappingAnimationIds = [...animations.values()]
    .filter(animation => frames.some(frame => (
      animation.startTime < frame.startTime + frame.duration
      && animation.endTime > frame.startTime
    )))
    .map(animation => animation.animationId)
    .sort();

  return {
    targetAnimationCount: animations.size,
    startCount,
    cancelCount,
    unmatchedCancelCount,
    loafOverlapCount: overlappingAnimationIds.length,
    overlappingAnimationIds,
    invalidEventCount,
  };
}

function summarizeGlassStyleWriteTimeline(events, longAnimationFrames) {
  const targetPatterns = [
    ["advancedToolsNavigation", /^\.advanced-tools-panel\s*>\s*nav\.glass-selection-group\s+\.glass-selection-indicator$/],
    ["runtimeLayoutSidebar", /^\.runtime-layout-sidebar\s+\.glass-selection-indicator$/],
  ];
  const allowedProperties = new Set(["width", "height", "transform", "opacity"]);
  const frames = (Array.isArray(longAnimationFrames) ? longAnimationFrames : [])
    .map((frame) => ({
      startTime: Number(frame?.startTime),
      duration: Number(frame?.duration),
    }))
    .filter((frame) => Number.isFinite(frame.startTime)
      && frame.startTime >= 0
      && Number.isFinite(frame.duration)
      && frame.duration >= 0);
  const targetCounts = {
    advancedToolsNavigation: 0,
    runtimeLayoutSidebar: 0,
  };
  const propertyCounts = {};
  let targetWriteCount = 0;
  let requestedChangeCount = 0;
  let effectiveWriteCount = 0;
  let sameValueWriteCount = 0;
  let writesDuringLongAnimationFrames = 0;
  let appliedWriteCount = 0;
  let suppressedWriteCount = 0;
  let invalidEventCount = 0;

  for (const event of Array.isArray(events) ? events : []) {
    if (String(event?.event ?? "") !== "style-write") continue;
    const target = String(event?.target ?? "");
    const targetEntry = targetPatterns.find(([, pattern]) => pattern.test(target));
    const property = String(event?.property ?? "");
    const at = Number(event?.at);
    if (!targetEntry || !allowedProperties.has(property) || !Number.isFinite(at) || at < 0) {
      invalidEventCount += 1;
      continue;
    }
    targetWriteCount += 1;
    targetCounts[targetEntry[0]] += 1;
    propertyCounts[property] = (propertyCounts[property] ?? 0) + 1;
    const previousValue = String(event?.previousValue ?? "");
    const nextValue = String(event?.nextValue ?? "");
    const requestedValue = String(event?.requestedValue ?? nextValue);
    if (previousValue !== requestedValue) requestedChangeCount += 1;
    if (event?.applied === false) {
      suppressedWriteCount += 1;
    } else {
      appliedWriteCount += 1;
      if (previousValue === nextValue) sameValueWriteCount += 1;
    }
    if (previousValue !== nextValue) effectiveWriteCount += 1;
    if (frames.some((frame) => at >= frame.startTime && at < frame.startTime + frame.duration)) {
      writesDuringLongAnimationFrames += 1;
    }
  }

  return {
    targetWriteCount,
    requestedChangeCount,
    effectiveWriteCount,
    sameValueWriteCount,
    invalidEventCount,
    writesDuringLongAnimationFrames,
    appliedWriteCount,
    suppressedWriteCount,
    targetCounts,
    propertyCounts,
  };
}

function getGlassStyleWriteMode(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value || value === "observe") return "observe";
  if (value === "suppress") return "suppress";
  throw new Error("Glass style-write diagnostic mode must be observe or suppress.");
}

function getGlassAnimationTimelineSetupFailures({
  enabled,
  entryMode,
  targetTab,
  productionPreview,
  hardwareGpuRequired,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("glass animation timeline requires a cold entry");
  if (targetTab !== "layout") failures.push("glass animation timeline requires the layout target");
  if (productionPreview !== true) failures.push("glass animation timeline requires the production preview");
  if (hardwareGpuRequired !== true)
    failures.push("glass animation timeline requires hardware-GPU provenance validation");
  return failures;
}

function getGenericCompositorWarmupSetupFailures({
  enabled,
  entryMode,
  targetTab,
  productionPreview,
  hardwareGpuRequired,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("generic compositor warm-up requires a cold entry");
  if (targetTab !== "layout") failures.push("generic compositor warm-up requires the layout target");
  if (productionPreview !== true) failures.push("generic compositor warm-up requires the production preview");
  if (hardwareGpuRequired !== true)
    failures.push("generic compositor warm-up requires hardware-GPU provenance validation");
  return failures;
}

function getStagePromotionSetupFailures({
  enabled,
  mode,
  entryMode,
  targetTab,
  productionPreview,
  layoutPreMounted,
  warmLayerOpacity,
  prewarmLayoutFromSettings,
  hardwareGpuRequired,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("stage promotion requires a cold entry");
  if (targetTab !== "layout") failures.push("stage promotion requires the layout target");
  if (productionPreview !== true) failures.push("stage promotion requires the production preview");
  if (mode === "pre-mounted") {
    if (layoutPreMounted !== true)
      failures.push("stage promotion requires the initially pre-mounted layout");
    if (Number(warmLayerOpacity) !== 0.001)
      failures.push("stage promotion requires warm-layer opacity 0.001");
  } else if (mode === "first-render") {
    if (layoutPreMounted === true)
      failures.push("first-render stage promotion cannot use a pre-mounted layout");
    if (Number(warmLayerOpacity) !== 0)
      failures.push("first-render stage promotion requires warm-layer opacity 0");
  } else {
    failures.push("stage promotion mode must be pre-mounted or first-render");
  }
  if (prewarmLayoutFromSettings === true)
    failures.push("stage promotion cannot combine with settings-to-layout prewarming");
  if (hardwareGpuRequired !== true)
    failures.push("stage promotion requires hardware-GPU provenance validation");
  return failures;
}

function summarizeStagePromotionEvidence({
  enabled,
  mode,
  warmWillChange,
  activeWillChange,
  activeTab,
  activePreviewVisible,
  activeStageSize,
} = {}) {
  const result = {
    enabled: enabled === true,
    mode: String(mode ?? ""),
    property: "will-change",
    expectedValue: "transform",
    warmWillChange: String(warmWillChange ?? ""),
    activeWillChange: String(activeWillChange ?? ""),
    activeTab: String(activeTab ?? ""),
    activePreviewVisible: activePreviewVisible === true,
    activeStageSize: {
      width: Number(activeStageSize?.width) || 0,
      height: Number(activeStageSize?.height) || 0,
    },
    failures: [],
  };
  if (!result.enabled) return { ...result, ok: true };

  const includesTransform = (value) => value
    .split(",")
    .map((item) => item.trim())
    .includes("transform");
  if (result.mode === "pre-mounted" && !includesTransform(result.warmWillChange))
    result.failures.push("hidden warm stage did not receive will-change: transform");
  if (result.mode === "first-render" && result.warmWillChange !== "not-mounted")
    result.failures.push("first-render stage unexpectedly had a hidden warm stage");
  if (!["pre-mounted", "first-render"].includes(result.mode))
    result.failures.push("stage promotion mode is invalid");
  if (!includesTransform(result.activeWillChange))
    result.failures.push("active stage did not retain will-change: transform");
  if (result.activeTab !== "layout")
    result.failures.push("layout did not become the active page owner");
  if (!result.activePreviewVisible)
    result.failures.push("active runtime preview is missing or hidden");
  if (!(result.activeStageSize.width > 0 && result.activeStageSize.height > 0))
    result.failures.push("active stage geometry is empty");
  return { ...result, ok: result.failures.length === 0 };
}

function getLayoutStageWillChangeSetupFailures({
  enabled,
  mode,
  entryMode,
  targetTab,
  developmentSource,
  hardwareGpuRequired,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (!["product-default", "auto"].includes(mode))
    failures.push("layout stage will-change mode must be product-default or auto");
  if (entryMode !== "cold")
    failures.push("layout stage will-change diagnostic requires a cold entry");
  if (targetTab !== "layout")
    failures.push("layout stage will-change diagnostic requires the layout target");
  if (developmentSource !== true && developmentSource !== false)
    failures.push("layout stage will-change diagnostic requires a known source mode");
  if (hardwareGpuRequired !== true)
    failures.push("layout stage will-change diagnostic requires hardware-GPU provenance validation");
  return failures;
}

function summarizeLayoutStageWillChangeEvidence({
  enabled,
  mode,
  warmWillChangeBefore,
  warmWillChangeAfter,
  activeWillChange,
  activeTab,
  activePreviewVisible,
  warmStageSizeBefore,
  warmStageSizeAfter,
  activeStageSize,
} = {}) {
  const result = {
    enabled: enabled === true,
    mode: String(mode ?? ""),
    property: "will-change",
    expectedValue: mode === "auto" ? "auto" : String(warmWillChangeBefore ?? ""),
    warmWillChangeBefore: String(warmWillChangeBefore ?? ""),
    warmWillChangeAfter: String(warmWillChangeAfter ?? ""),
    activeWillChange: String(activeWillChange ?? ""),
    activeTab: String(activeTab ?? ""),
    activePreviewVisible: activePreviewVisible === true,
    warmStageSizeBefore: {
      width: Number(warmStageSizeBefore?.width) || 0,
      height: Number(warmStageSizeBefore?.height) || 0,
    },
    warmStageSizeAfter: {
      width: Number(warmStageSizeAfter?.width) || 0,
      height: Number(warmStageSizeAfter?.height) || 0,
    },
    activeStageSize: {
      width: Number(activeStageSize?.width) || 0,
      height: Number(activeStageSize?.height) || 0,
    },
    failures: [],
  };
  if (!result.enabled) return { ...result, ok: true };

  if (!["product-default", "auto"].includes(result.mode))
    result.failures.push("layout stage will-change mode is invalid");
  if (!(result.warmStageSizeBefore.width > 0 && result.warmStageSizeBefore.height > 0))
    result.failures.push("hidden warm layout stage geometry is empty");
  if (!(result.warmStageSizeAfter.width > 0 && result.warmStageSizeAfter.height > 0))
    result.failures.push("hidden warm layout stage geometry after style override is empty");
  if (!(result.activeStageSize.width > 0 && result.activeStageSize.height > 0))
    result.failures.push("active layout stage geometry is empty");
  if (Math.abs(result.warmStageSizeBefore.width - result.warmStageSizeAfter.width) > 0.5
    || Math.abs(result.warmStageSizeBefore.height - result.warmStageSizeAfter.height) > 0.5)
    result.failures.push("will-change style override changed hidden warm layout stage geometry");
  if (result.mode === "auto"
    && (result.warmWillChangeAfter !== "auto" || result.activeWillChange !== "auto"))
    result.failures.push("will-change:auto override did not reach both warm and active stages");
  if (result.mode === "product-default"
    && (result.warmWillChangeAfter !== result.warmWillChangeBefore
      || result.activeWillChange !== result.warmWillChangeBefore))
    result.failures.push("product-default warm and active stage styles are not equivalent");
  if (result.activeTab !== "layout")
    result.failures.push("layout did not become the active page owner");
  if (!result.activePreviewVisible)
    result.failures.push("active runtime preview is missing or hidden");
  return { ...result, ok: result.failures.length === 0 };
}

function getLayoutLayerTreeTimelineSetupFailures({
  enabled,
  entryMode,
  targetTab,
  developmentSource,
  hardwareGpuRequired,
  diagnosticRepeats,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold")
    failures.push("layout layer-tree timeline requires a cold entry");
  if (targetTab !== "layout")
    failures.push("layout layer-tree timeline requires the layout target");
  if (developmentSource !== true)
    failures.push("layout layer-tree timeline requires the current-source development server");
  if (hardwareGpuRequired !== true)
    failures.push("layout layer-tree timeline requires hardware-GPU provenance validation");
  if (Number(diagnosticRepeats) !== 1)
    failures.push("layout layer-tree timeline requires exactly one fresh browser trial");
  return failures;
}

function summarizeLayoutLayerTreeTimeline({
  snapshots,
  interactionStartMs,
  interactionEndMs,
} = {}) {
  const failures = [];
  const start = Number(interactionStartMs);
  const end = Number(interactionEndMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    failures.push("layout layer-tree interaction window is invalid");
  const timeline = (Array.isArray(snapshots) ? snapshots : [])
    .filter(snapshot => Number.isFinite(Number(snapshot?.atMs))
      && Array.isArray(snapshot?.layers))
    .sort((left, right) => Number(left.atMs) - Number(right.atMs))
    .map(snapshot => ({
      atMs: Number(snapshot.atMs),
      layerCount: snapshot.layers.length,
      largeDrawingLayers: snapshot.layers
        .filter(layer => layer?.drawsContent === true
          && Number(layer.width) * Number(layer.height) >= 1_000_000)
        .map(layer => ({
          layerId: String(layer.layerId ?? ""),
          nodeName: String(layer.nodeName ?? ""),
          className: String(layer.className ?? ""),
          width: Number(layer.width) || 0,
          height: Number(layer.height) || 0,
          paintCount: Number(layer.paintCount) || 0,
        })),
    }));
  const beforeInteractionCount = timeline.filter(snapshot => snapshot.atMs < start).length;
  const duringInteractionCount = timeline.filter(snapshot => (
    snapshot.atMs >= start && snapshot.atMs <= end
  )).length;
  const afterInteractionCount = timeline.filter(snapshot => snapshot.atMs > end).length;
  if (timeline.length === 0) failures.push("layout layer-tree timeline contains no snapshots");
  if (beforeInteractionCount === 0)
    failures.push("layout layer-tree timeline has no pre-interaction snapshot");
  if (afterInteractionCount === 0)
    failures.push("layout layer-tree timeline has no post-interaction snapshot");
  return {
    ok: failures.length === 0,
    failures,
    snapshotCount: timeline.length,
    beforeInteractionCount,
    duringInteractionCount,
    afterInteractionCount,
    timeline,
  };
}

function getEtwTriggerGateSetupFailures({
  enabled,
  entryMode,
  targetTab,
  productionPreview,
  traceEnabled,
  diagnosticRepeats,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("ETW trigger gate requires a cold entry");
  if (targetTab !== "layout") failures.push("ETW trigger gate requires the layout target");
  if (productionPreview !== true) failures.push("ETW trigger gate requires the production preview");
  if (traceEnabled !== true) failures.push("ETW trigger gate requires Chrome trace capture");
  if (Number(diagnosticRepeats) !== 1) failures.push("ETW trigger gate requires exactly one diagnostic repeat");
  return failures;
}

function summarizeFramePhases(entry) {
  const start = Number(entry?.startTime);
  const duration = Number(entry?.duration);
  const renderStart = Number(entry?.renderStart);
  const styleAndLayoutStart = Number(entry?.styleAndLayoutStart);
  if (![start, duration, renderStart, styleAndLayoutStart].every(Number.isFinite)
    || duration < 0
    || renderStart < start
    || styleAndLayoutStart < renderStart
    || styleAndLayoutStart > start + duration) {
    return null;
  }
  const end = start + duration;
  return {
    beforeRenderMs: renderStart - start,
    renderToStyleAndLayoutMs: styleAndLayoutStart - renderStart,
    styleAndLayoutToEndMs: end - styleAndLayoutStart,
  };
}

function alignTraceClock(events, marker) {
  const markerName = String(marker?.name ?? "");
  const markerStartTime = Number(marker?.startTime);
  const markerEvent = events.find((event) => (
    event?.name === markerName
    || event?.args?.data?.message === markerName
    || event?.args?.beginData?.message === markerName
  ));
  const markerTimestampUs = Number(markerEvent?.ts);
  if (!markerName || !Number.isFinite(markerStartTime) || !Number.isFinite(markerTimestampUs)) {
    throw new Error(`Trace clock marker "${markerName}" is missing or invalid.`);
  }
  const traceOriginUs = markerTimestampUs - markerStartTime * 1000;
  return {
    traceOriginUs,
    events: events.map((event) => ({
      ...event,
      performanceStartTime: Number.isFinite(Number(event.ts))
        ? (Number(event.ts) - traceOriginUs) / 1000
        : null,
    })),
  };
}

function alignMonotonicClocks(anchors) {
  const validAnchors = (Array.isArray(anchors) ? anchors : [])
    .map((anchor) => {
      const nodeBefore = Number(anchor?.nodeBefore);
      const browserTime = Number(anchor?.browserTime);
      const nodeAfter = Number(anchor?.nodeAfter);
      if (![nodeBefore, browserTime, nodeAfter].every(Number.isFinite) || nodeAfter < nodeBefore) {
        return null;
      }
      const nodeMidpoint = (nodeBefore + nodeAfter) / 2;
      return {
        ...(anchor?.phase ? { phase: String(anchor.phase) } : {}),
        nodeBefore,
        nodeAfter,
        browserTime,
        offsetMs: browserTime - nodeMidpoint,
        roundTripUncertaintyMs: (nodeAfter - nodeBefore) / 2,
      };
    })
    .filter(Boolean);
  if (validAnchors.length < 2) {
    throw new Error("At least two valid browser/Node monotonic clock anchors are required.");
  }
  const offsets = validAnchors.map((anchor) => anchor.offsetMs).sort((left, right) => left - right);
  const middle = Math.floor(offsets.length / 2);
  const offsetMs = offsets.length % 2
    ? offsets[middle]
    : (offsets[middle - 1] + offsets[middle]) / 2;
  const uncertaintyMs = Math.max(...validAnchors.map((anchor) => (
    anchor.roundTripUncertaintyMs + Math.abs(anchor.offsetMs - offsetMs)
  )));
  return {
    offsetMs,
    uncertaintyMs,
    anchorCount: validAnchors.length,
    anchors: validAnchors.map(({ nodeBefore, nodeAfter, browserTime, phase,
      offsetMs: anchorOffsetMs, roundTripUncertaintyMs }) => ({
      ...(phase ? { phase } : {}),
      nodeBefore,
      nodeAfter,
      browserTime,
      offsetMs: anchorOffsetMs,
      roundTripUncertaintyMs,
    })),
  };
}

function mapBrowserMonotonicToEpochMs(anchor, performanceTimeMs) {
  const timeOriginEpochMs = Number(anchor?.timeOriginEpochMs);
  const monotonicTimeMs = Number(anchor?.monotonicTimeMs);
  const wallClockEpochMs = Number(anchor?.wallClockEpochMs);
  const eventTimeMs = Number(performanceTimeMs);
  if (![timeOriginEpochMs, monotonicTimeMs, wallClockEpochMs].every(Number.isFinite)
    || timeOriginEpochMs <= 0
    || monotonicTimeMs < 0
    || wallClockEpochMs <= 0) {
    throw new Error("A valid browser clock anchor is required.");
  }
  if (!Number.isFinite(eventTimeMs) || eventTimeMs < 0) {
    throw new Error("A finite browser performance time is required.");
  }
  return timeOriginEpochMs + eventTimeMs;
}

function selectPreparationClockAnchors(anchors) {
  const validAnchors = (Array.isArray(anchors) ? anchors : [])
    .filter((anchor) => ["preparation-start", "preparation-end"].includes(anchor?.phase)
      && Number.isFinite(Number(anchor?.nodeBefore))
      && Number.isFinite(Number(anchor?.browserTime))
      && Number.isFinite(Number(anchor?.nodeAfter))
      && Number(anchor.nodeAfter) >= Number(anchor.nodeBefore));
  const selected = ["preparation-start", "preparation-end"].map((phase) => (
    validAnchors
      .filter((anchor) => anchor.phase === phase)
      .sort((left, right) => (
        (Number(left.nodeAfter) - Number(left.nodeBefore))
        - (Number(right.nodeAfter) - Number(right.nodeBefore))
      ))[0] ?? null
  ));
  if (selected.some((anchor) => !anchor)) {
    throw new Error("Preparation clock calibration requires both start and end anchor groups.");
  }
  return selected;
}

function summarizeLayerIdentityContinuity(snapshots) {
  const identities = new Map();
  const validSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => Array.isArray(snapshot?.layers));
  for (const [snapshotIndex, snapshot] of validSnapshots.entries()) {
    for (const layer of snapshot.layers) {
      if (layer?.layerId == null) continue;
      const layerId = String(layer.layerId);
      const identity = identities.get(layerId) ?? {
        layerId,
        snapshotIndexes: new Set(),
        backendNodeIds: new Set(),
        missingBackendNodeCount: 0,
        dimensions: new Set(),
      };
      identity.snapshotIndexes.add(snapshotIndex);
      const backendNodeId = Number(layer.backendNodeId);
      if (Number.isFinite(backendNodeId)) identity.backendNodeIds.add(backendNodeId);
      else identity.missingBackendNodeCount += 1;
      identity.dimensions.add(`${Number(layer.width) || 0}x${Number(layer.height) || 0}`);
      identities.set(layerId, identity);
    }
  }
  const details = [...identities.values()].map((identity) => ({
    layerId: identity.layerId,
    snapshotCount: identity.snapshotIndexes.size,
    backendNodeIds: [...identity.backendNodeIds].sort((left, right) => left - right),
    missingBackendNodeCount: identity.missingBackendNodeCount,
    distinctDimensions: identity.dimensions.size,
  }));
  const reused = details.filter((identity) => identity.backendNodeIds.length > 1);
  return {
    snapshotCount: validSnapshots.length,
    uniqueLayerIdCount: identities.size,
    reusedLayerIdCount: reused.length,
    reusedLayerIds: reused.slice(0, 32),
    layerIdsWithMissingBackendNode: details
      .filter((identity) => identity.missingBackendNodeCount > 0)
      .length,
  };
}

function matchRasterTasksToLayerSnapshots(snapshots, rasterTasks, options = {}) {
  const maxSnapshotDistanceMs = Number(options.maxSnapshotDistanceMs);
  const clockUncertaintyMs = Number(options.clockUncertaintyMs);
  if (!Number.isFinite(maxSnapshotDistanceMs)
    || !Number.isFinite(clockUncertaintyMs)
    || maxSnapshotDistanceMs < 0
    || clockUncertaintyMs < 0) {
    throw new Error("Layer snapshot matching requires non-negative distance and clock uncertainty.");
  }
  const validSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => Number.isFinite(Number(snapshot?.receivedAt))
      && Array.isArray(snapshot?.layers))
    .map((snapshot, index) => ({
      index,
      receivedAt: Number(snapshot.receivedAt),
      layers: snapshot.layers,
    }))
    .sort((left, right) => left.receivedAt - right.receivedAt);
  const matches = (Array.isArray(rasterTasks) ? rasterTasks : []).map((task) => {
    const startTime = Number(task?.startTime);
    const durationMs = Number(task?.durationMs);
    const layerId = task?.layerId == null ? "" : String(task.layerId);
    if (!Number.isFinite(startTime) || !Number.isFinite(durationMs) || durationMs < 0 || !layerId) {
      return { task, status: "unmatched", snapshotIndex: null, layer: null, snapshotDistanceMs: null };
    }
    const taskMidpoint = startTime + durationMs / 2;
    let nearest = null;
    for (const snapshot of validSnapshots) {
      const distanceMs = Math.abs(snapshot.receivedAt - taskMidpoint);
      if (!nearest || distanceMs < nearest.distanceMs) nearest = { snapshot, distanceMs };
    }
    if (!nearest) {
      return {
        task,
        status: "unmatched",
        reason: "no-timed-layer-snapshot",
        snapshotIndex: null,
        layer: null,
        snapshotDistanceMs: null,
      };
    }
    if (nearest.distanceMs > maxSnapshotDistanceMs) {
      return {
        task,
        status: "unmatched",
        reason: "nearest-snapshot-outside-confidence-window",
        snapshotIndex: null,
        layer: null,
        snapshotDistanceMs: nearest.distanceMs,
      };
    }
    const layer = nearest.snapshot.layers.find((item) => String(item?.layerId ?? "") === layerId) ?? null;
    if (!layer) {
      return {
        task,
        status: "unmatched",
        reason: "layer-id-absent-from-nearest-snapshot",
        snapshotIndex: nearest.snapshot.index,
        layer: null,
        snapshotDistanceMs: nearest.distanceMs,
      };
    }
    if (nearest.distanceMs + clockUncertaintyMs > maxSnapshotDistanceMs) {
      return {
        task,
        status: "uncertain",
        reason: "clock-uncertainty-crosses-confidence-window",
        snapshotIndex: nearest.snapshot.index,
        layer,
        snapshotDistanceMs: nearest.distanceMs,
      };
    }
    return {
      task,
      status: "matched",
      snapshotIndex: nearest.snapshot.index,
      layer,
      snapshotDistanceMs: nearest.distanceMs,
    };
  });
  const matched = matches.filter((match) => match.status === "matched");
  return {
    matches,
    summary: {
      matchedCount: matched.length,
      uncertainCount: matches.filter((match) => match.status === "uncertain").length,
      unmatchedCount: matches.filter((match) => match.status === "unmatched").length,
      clockUncertaintyMs,
      maxObservedSnapshotDistanceMs: matched.length
        ? Math.max(...matched.map((match) => match.snapshotDistanceMs))
        : null,
    },
  };
}

function matchGpuRasterTasksToSourceTiles(traceEvents, options = {}) {
  const minGpuTaskDurationMs = Number(options.minGpuTaskDurationMs ?? 0);
  if (!Number.isFinite(minGpuTaskDurationMs) || minGpuTaskDurationMs < 0) {
    throw new Error("GPU raster matching requires a non-negative minimum task duration.");
  }
  const events = Array.isArray(traceEvents) ? traceEvents : [];
  const eventData = (event) => event?.args?.data ?? event?.args ?? {};
  const eventStartUs = (event) => Number(event?.ts);
  const eventDurationUs = (event) => Math.max(0, Number(event?.dur) || 0);
  const hasValidInterval = (event) => Number.isFinite(eventStartUs(event))
    && Number.isFinite(eventDurationUs(event));
  const rendererRasterCalls = new Map();
  const rasterTasksByThread = new Map();
  const decodersByThread = new Map();
  const threadKey = (pid, tid) => `${String(pid)}:${String(tid)}`;

  for (const event of events) {
    if (!hasValidInterval(event)) continue;
    const key = threadKey(event.pid, event.tid);
    if (event.name === "RasterImplementation::RasterCHROMIUM") {
      const rasterId = eventData(event).raster_chromium_id;
      if (rasterId == null) continue;
      const rendererKey = `${String(event.pid)}:${String(rasterId)}`;
      const calls = rendererRasterCalls.get(rendererKey) ?? [];
      calls.push(event);
      rendererRasterCalls.set(rendererKey, calls);
    } else if (event.name === "RasterTask") {
      const tasks = rasterTasksByThread.get(key) ?? [];
      tasks.push(event);
      rasterTasksByThread.set(key, tasks);
    } else if (event.name === "RasterDecoderImpl::DoRasterCHROMIUM") {
      const decoders = decodersByThread.get(key) ?? [];
      decoders.push(event);
      decodersByThread.set(key, decoders);
    }
  }

  const sortByTimestamp = (left, right) => eventStartUs(left) - eventStartUs(right);
  for (const collection of [
    ...rendererRasterCalls.values(),
    ...rasterTasksByThread.values(),
    ...decodersByThread.values(),
  ]) collection.sort(sortByTimestamp);

  const matches = [];
  for (const gpuTask of events.filter((event) => event.name === "GPUTask" && hasValidInterval(event))) {
    const gpuTaskDurationMs = eventDurationUs(gpuTask) / 1000;
    if (gpuTaskDurationMs < minGpuTaskDurationMs) continue;
    const gpuTaskStartUs = eventStartUs(gpuTask);
    const gpuTaskEndUs = gpuTaskStartUs + eventDurationUs(gpuTask);
    const gpuThreadKey = threadKey(gpuTask.pid, gpuTask.tid);
    const rendererPid = eventData(gpuTask).renderer_pid;
    if (rendererPid == null) continue;
    const decoders = (decodersByThread.get(gpuThreadKey) ?? [])
      .filter((event) => eventStartUs(event) >= gpuTaskStartUs
        && eventStartUs(event) + eventDurationUs(event) <= gpuTaskEndUs);

    for (const decoder of decoders) {
      const rasterIdValue = eventData(decoder).raster_id;
      if (rasterIdValue == null) continue;
      const rasterId = String(rasterIdValue);
      const rendererKey = `${String(rendererPid)}:${rasterId}`;
      const precedingCalls = (rendererRasterCalls.get(rendererKey) ?? [])
        .filter((event) => eventStartUs(event) <= eventStartUs(decoder));
      const rendererCall = precedingCalls.at(-1) ?? null;
      const baseMatch = {
        gpuTaskStartTimeUs: gpuTaskStartUs,
        gpuTaskDurationMs,
        rendererPid: Number(rendererPid),
        rasterId,
        gpuRasterStartTimeUs: eventStartUs(decoder),
        gpuRasterDurationMs: eventDurationUs(decoder) / 1000,
      };
      if (!rendererCall) {
        matches.push({
          ...baseMatch,
          status: "unmatched",
          reason: "renderer-raster-call-not-found",
        });
        continue;
      }

      const rendererThreadKey = threadKey(rendererCall.pid, rendererCall.tid);
      const rendererCallStartUs = eventStartUs(rendererCall);
      const sourceTask = (rasterTasksByThread.get(rendererThreadKey) ?? [])
        .filter((event) => eventStartUs(event) <= rendererCallStartUs
          && eventStartUs(event) + eventDurationUs(event) >= rendererCallStartUs)
        .at(-1) ?? null;
      if (!sourceTask) {
        matches.push({
          ...baseMatch,
          rendererRasterStartTimeUs: rendererCallStartUs,
          status: "unmatched",
          reason: "source-raster-task-not-found",
        });
        continue;
      }

      const tileData = eventData(sourceTask).tileData ?? {};
      const layerId = tileData.layerId == null ? null : String(tileData.layerId);
      const sourceFrameNumber = Number(tileData.sourceFrameNumber);
      if (!layerId || !Number.isFinite(sourceFrameNumber)) {
        matches.push({
          ...baseMatch,
          rendererRasterStartTimeUs: rendererCallStartUs,
          rasterTaskStartTimeUs: eventStartUs(sourceTask),
          rasterTaskDurationMs: eventDurationUs(sourceTask) / 1000,
          status: "unmatched",
          reason: "source-raster-identity-missing",
        });
        continue;
      }
      matches.push({
        ...baseMatch,
        rendererRasterStartTimeUs: rendererCallStartUs,
        rasterTaskStartTimeUs: eventStartUs(sourceTask),
        rasterTaskDurationMs: eventDurationUs(sourceTask) / 1000,
        sourceFrameNumber,
        layerId,
        tileResolution: String(tileData.tileResolution ?? ""),
        status: "matched",
        reason: null,
      });
    }
  }

  return {
    matches,
    summary: {
      matchedCount: matches.filter((match) => match.status === "matched").length,
      unmatchedCount: matches.filter((match) => match.status === "unmatched").length,
      minGpuTaskDurationMs,
    },
  };
}

function filterEntriesByTimeWindow(entries, startTime, endTime) {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return [];
  return entries.filter((entry) => {
    if (!Number.isFinite(entry.startTime) || !Number.isFinite(entry.duration)) return false;
    const entryEnd = entry.startTime + Math.max(0, entry.duration);
    if (entry.duration === 0) return entry.startTime >= startTime && entry.startTime <= endTime;
    return entry.startTime < endTime && entryEnd > startTime;
  });
}

function summarizeLayerTree(layers, nodesByBackendId = {}, reasonsByLayerId = {}) {
  return (Array.isArray(layers) ? layers : [])
    .map((layer) => {
      const width = Number(layer?.width);
      const height = Number(layer?.height);
      const backendNodeId = Number(layer?.backendNodeId);
      const node = nodesByBackendId[String(backendNodeId)] ?? {};
      const attributes = Array.isArray(node.attributes) ? node.attributes : [];
      const classIndex = attributes.indexOf("class");
      const dataTabIndex = attributes.indexOf("data-tab");
      const safeAttribute = name => {
        for (let index = 0; index < attributes.length; index += 2) {
          if (attributes[index] === name) return String(attributes[index + 1] ?? "");
        }
        return "";
      };
      return {
        layerId: String(layer?.layerId ?? ""),
        parentLayerId: layer?.parentLayerId == null ? null : String(layer.parentLayerId),
        backendNodeId: Number.isFinite(backendNodeId) ? backendNodeId : null,
        nodeName: String(node.nodeName ?? ""),
        className: classIndex >= 0 ? String(attributes[classIndex + 1] ?? "") : "",
        dataTab: dataTabIndex >= 0 ? String(attributes[dataTabIndex + 1] ?? "") : "",
        // Control identity only. Never retain form values, free-form labels,
        // titles or the full DOM attribute list in diagnostic reports.
        ...(node.nodeName === "INPUT" ? {
          controlIdentity: {
            type: safeAttribute("type"),
            helpKey: safeAttribute("data-help-key"),
            componentId: safeAttribute("data-component-id"),
          },
        } : {}),
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
        area: Number.isFinite(width * height) ? width * height : 0,
        drawsContent: layer?.drawsContent === true,
        paintCount: Number.isFinite(Number(layer?.paintCount)) ? Number(layer.paintCount) : 0,
        compositingReasons: Array.isArray(reasonsByLayerId[String(layer?.layerId)])
          ? reasonsByLayerId[String(layer.layerId)].map(String)
          : [],
      };
    })
    .sort((left, right) => right.area - left.area);
}

function summarizeEditorMotionTimeline(events, longAnimationFrames = []) {
  const grouped = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const animationId = String(event?.animationId ?? "");
    const type = String(event?.type ?? "");
    const at = Number(event?.at);
    if (!animationId || !["created", "play-requested", "started", "paused", "finished", "cancelled"].includes(type)
      || !Number.isFinite(at)) continue;
    const record = grouped.get(animationId) ?? { animationId, events: [] };
    record.events.push({ ...event, at });
    grouped.set(animationId, record);
  }
  const frames = (Array.isArray(longAnimationFrames) ? longAnimationFrames : [])
    .map((frame) => ({
      start: Number(frame?.startTime),
      end: Number(frame?.startTime) + Number(frame?.duration),
    }))
    .filter((frame) => Number.isFinite(frame.start) && Number.isFinite(frame.end) && frame.end >= frame.start);
  const animations = [...grouped.values()].map(({ animationId, events: records }) => {
    const created = records.find((event) => event.type === "created");
    const started = records.find((event) => event.type === "started")
      ?? records.find((event) => event.type === "play-requested");
    const finished = records.find((event) => event.type === "finished");
    const cancelled = records.find((event) => event.type === "cancelled");
    const terminal = finished ?? cancelled ?? null;
    const durationMs = Number(created?.durationMs);
    const delayMs = Number(created?.delayMs);
    const startBase = Number(started?.startTime);
    const effectiveStartTime = Number.isFinite(startBase)
      ? startBase + (Number.isFinite(delayMs) ? delayMs : 0)
      : started
        ? started.at + (Number.isFinite(delayMs) ? delayMs : 0)
        : null;
    const endTime = terminal?.at ?? null;
    const longFrameOverlapMs = effectiveStartTime !== null && endTime !== null
      ? frames.reduce((total, frame) => total + Math.max(
        0,
        Math.min(endTime, frame.end) - Math.max(effectiveStartTime, frame.start),
      ), 0)
      : null;
    return {
      animationId,
      owner: String(created?.owner ?? started?.owner ?? terminal?.owner ?? "unknown"),
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      delayMs: Number.isFinite(delayMs) ? delayMs : null,
      easing: String(created?.easing ?? ""),
      status: finished ? "finished" : cancelled ? "cancelled" : "incomplete",
      effectiveStartTime,
      endTime,
      longFrameOverlapMs,
    };
  });
  const completedCount = animations.filter((animation) => animation.status === "finished").length;
  const cancelledCount = animations.filter((animation) => animation.status === "cancelled").length;
  return {
    animationCount: animations.length,
    completedCount,
    cancelledCount,
    incompleteCount: animations.length - completedCount - cancelledCount,
    animations,
  };
}

function summarizeReactCommitProbe(commits, interactionWindow) {
  const observed = (Array.isArray(commits) ? commits : [])
    .filter((commit) => Number.isFinite(Number(commit?.at)))
    .map((commit) => ({
      at: Number(commit.at),
      rendererId: Number.isFinite(Number(commit?.rendererId))
        ? String(commit.rendererId)
        : "unknown",
    }))
    .sort((left, right) => left.at - right.at);
  const start = Number(interactionWindow?.start);
  const end = Number(interactionWindow?.end);
  const inWindow = Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? observed.filter((commit) => commit.at >= start && commit.at <= end)
    : [];
  const commitsByRenderer = {};
  for (const commit of inWindow) {
    commitsByRenderer[commit.rendererId] = (commitsByRenderer[commit.rendererId] ?? 0) + 1;
  }
  let maxInteractionCommitGapMs = 0;
  for (let index = 1; index < inWindow.length; index += 1) {
    maxInteractionCommitGapMs = Math.max(
      maxInteractionCommitGapMs,
      inWindow[index].at - inWindow[index - 1].at,
    );
  }
  return {
    totalObservedCommitCount: observed.length,
    interactionCommitCount: inWindow.length,
    firstInteractionCommitAt: inWindow[0]?.at ?? null,
    lastInteractionCommitAt: inWindow.at(-1)?.at ?? null,
    maxInteractionCommitGapMs,
    commitsByRenderer,
  };
}

function summarizeReactFiberPathCapture(capture) {
  const rendererId = capture?.rendererId;
  const observerAt = Number(capture?.observerAt);
  const capturedAt = Number(capture?.capturedAt);
  const captureDurationMs = Number(capture?.captureDurationMs);
  const width = Number(capture?.stageSize?.width);
  const height = Number(capture?.stageSize?.height);
  const totalFiberCount = Number(capture?.totalFiberCount);
  const layoutDesignerHostPathIndex = capture?.layoutDesignerHostPathIndex == null
    ? null
    : Number(capture.layoutDesignerHostPathIndex);
  const designerComponentPathIndex = capture?.designerComponentPathIndex == null
    ? null
    : Number(capture.designerComponentPathIndex);
  const designerComponentFiberCount = capture?.designerComponentFiberCount == null
    ? null
    : Number(capture.designerComponentFiberCount);
  const sourcePath = Array.isArray(capture?.path) ? capture.path : [];
  if (![observerAt, capturedAt, captureDurationMs, width, height, totalFiberCount]
    .every(Number.isFinite)
    || capturedAt < observerAt
    || captureDurationMs < 0
    || width <= 0
    || height <= 0
    || !Number.isInteger(totalFiberCount)
    || totalFiberCount < 1
    || (layoutDesignerHostPathIndex !== null
      && (!Number.isInteger(layoutDesignerHostPathIndex)
        || layoutDesignerHostPathIndex < 0
        || layoutDesignerHostPathIndex >= sourcePath.length))
    || (designerComponentPathIndex !== null
      && (!Number.isInteger(designerComponentPathIndex)
        || designerComponentPathIndex < 0
        || designerComponentPathIndex >= sourcePath.length))
    || (designerComponentFiberCount !== null
      && (!Number.isInteger(designerComponentFiberCount) || designerComponentFiberCount < 1))
    || sourcePath.length < 1) {
    return null;
  }
  const path = sourcePath.map((item) => ({
    tag: Number(item?.tag),
    name: String(item?.name ?? ""),
    flags: Number(item?.flags),
    subtreeFlags: Number(item?.subtreeFlags),
    childCount: Number(item?.childCount),
  }));
  if (path.some((item) => !Number.isInteger(item.tag)
    || !Number.isInteger(item.flags)
    || !Number.isInteger(item.subtreeFlags)
    || !Number.isInteger(item.childCount)
    || item.childCount < 0)) {
    return null;
  }
  return {
    rendererId: Number.isFinite(Number(rendererId)) ? String(rendererId) : "unknown",
    observerAt,
    capturedAt,
    observerToCommitMs: capturedAt - observerAt,
    captureDurationMs,
    stageSize: { width, height },
    totalFiberCount,
    layoutDesignerHostPathIndex,
    designerComponentPathIndex,
    designerComponentFiberCount,
    path,
  };
}

function auditStagePreviewSamples(samples, tolerance = 0.015) {
  const failures = [];
  const readySamples = samples.filter(sample => sample.designerReady === "true");
  const scaleStates = [];
  if (readySamples.length === 0) failures.push("layout designer never reported ready during stage sampling");
  for (const [index, sample] of readySamples.entries()) {
    const width = Number(sample.stageLayoutSize?.width);
    const height = Number(sample.stageLayoutSize?.height);
    if (!(width > 0) || !(height > 0)) {
      failures.push(`ready sample ${index} has invalid untransformed stage layout geometry`);
      continue;
    }
    if (!sample.previewVisible) failures.push(`ready sample ${index} hid or unmounted the Runtime preview`);
    const actualScale = Number(sample.previewRenderScale);
    const authoredWidth = Number(sample.previewAuthoredFrame?.width);
    const authoredHeight = Number(sample.previewAuthoredFrame?.height);
    if (Number.isFinite(actualScale) && authoredWidth > 0 && authoredHeight > 0) {
      const expectedScale = Math.min(width / authoredWidth, height / authoredHeight);
      scaleStates.push({
        index,
        time: Number(sample.time),
        matches: Math.abs(actualScale - expectedScale) <= tolerance,
        actualScale,
        expectedScale,
      });
    }
    for (const guide of sample.snapGuides ?? []) {
      const coordinate = Number.parseFloat(guide.axis === "x" ? guide.left : guide.top);
      if (Number.isFinite(coordinate) && (coordinate < -tolerance || coordinate > 100 + tolerance))
        failures.push(`ready sample ${index} ${guide.axis}-axis snap guide is outside stage: ${coordinate}%`);
    }
  }
  const firstConvergedScale = scaleStates.findIndex(state => state.matches);
  const staleScaleCount = firstConvergedScale < 0 ? scaleStates.length : firstConvergedScale;
  if (firstConvergedScale < 0) {
    failures.push("preview render scale never converged to the measured stage fit");
  } else if (firstConvergedScale > 2) {
    failures.push(`preview render scale took ${firstConvergedScale} ready frames to converge`);
  } else if (scaleStates.slice(firstConvergedScale + 1).some(state => !state.matches)) {
    failures.push("preview render scale diverged from the measured stage after convergence");
  }
  return {
    ok: failures.length === 0,
    failures,
    sampledCount: samples.length,
    readySampleCount: readySamples.length,
    previewVisibleSampleCount: readySamples.filter(sample => sample.previewVisible).length,
    pixelReadoutSampleCount: samples.filter(sample => typeof sample.pixelReadoutText === "string").length,
    snapGuideSampleCount: samples.filter(sample => (sample.snapGuides?.length ?? 0) > 0).length,
    initialStaleScaleFrameCount: staleScaleCount,
    initialStaleScaleDurationMs: firstConvergedScale > 0
      ? Math.max(0, scaleStates[firstConvergedScale].time - scaleStates[0].time) : 0,
    stageLayoutSizeRange: {
      width: readySamples.length ? {
        min: Math.min(...readySamples.map(sample => Number(sample.stageLayoutSize.width))),
        max: Math.max(...readySamples.map(sample => Number(sample.stageLayoutSize.width))),
      } : null,
      height: readySamples.length ? {
        min: Math.min(...readySamples.map(sample => Number(sample.stageLayoutSize.height))),
        max: Math.max(...readySamples.map(sample => Number(sample.stageLayoutSize.height))),
      } : null,
    },
  };
}

function auditSnapGuideSamples(samples) {
  const failures = [];
  const guideSamples = samples.filter(sample => Array.isArray(sample.guides) && sample.guides.length > 0);
  if (guideSamples.length === 0) failures.push("real drag produced no visible snap-guide samples");
  const observedAxes = new Set();
  for (const [index, sample] of guideSamples.entries()) {
    const width = Number(sample.stageLayoutSize?.width);
    const height = Number(sample.stageLayoutSize?.height);
    if (!(width > 0) || !(height > 0)) {
      failures.push(`snap-guide sample ${index} has invalid stage geometry`);
      continue;
    }
    for (const guide of sample.guides) {
      observedAxes.add(guide.axis);
      if (!["x", "y"].includes(guide.axis)) failures.push(`snap guide has invalid axis ${guide.axis}`);
      if (!guide.visible) failures.push(`${guide.axis}-axis snap guide is not visually rendered`);
      if (!guide.source) failures.push(`${guide.axis}-axis snap guide has no source identity`);
      const coordinate = Number.parseFloat(guide.positionPercent);
      if (!Number.isFinite(coordinate) || coordinate < -0.01 || coordinate > 100.01)
        failures.push(`${guide.axis}-axis snap guide is outside its stage (${guide.positionPercent})`);
    }
  }
  if (guideSamples.length > 0 && observedAxes.size === 0)
    failures.push("snap-guide samples did not identify a usable axis");
  return {
    ok: failures.length === 0,
    failures,
    sampleCount: samples.length,
    guideSampleCount: guideSamples.length,
    axes: [...observedAxes].sort(),
    stageLayoutSize: guideSamples.at(-1)?.stageLayoutSize ?? null,
  };
}

function getSyncPhaseProbeSetupFailures({
  enabled,
  entryMode,
  targetTab,
  currentSource,
  hardwareGpuRequired,
  reactCommitProbeEnabled,
  profilerEnabled,
  singleLowIntrusionTrial,
  diagnosticOnly,
  isolatedProject,
  diagnosticRepeats,
  width,
  height,
  dpr,
  headful,
} = {}) {
  if (enabled !== true) return [];
  const failures = [];
  if (entryMode !== "cold") failures.push("synchronous phase probe requires a cold entry");
  if (targetTab !== "layout") failures.push("synchronous phase probe requires the layout target");
  if (currentSource !== true) failures.push("synchronous phase probe requires the current source");
  if (hardwareGpuRequired !== true) failures.push("synchronous phase probe requires hardware-GPU provenance validation");
  if (reactCommitProbeEnabled !== true) failures.push("synchronous phase probe requires React commit clock alignment");
  if (profilerEnabled === true) failures.push("synchronous phase probe cannot run with CPU profiling enabled");
  if (singleLowIntrusionTrial !== true) failures.push("synchronous phase probe requires one low-intrusion trial without a detailed pass");
  if (diagnosticOnly !== true) failures.push("synchronous phase probe must be diagnostic-only");
  if (isolatedProject !== true) failures.push("synchronous phase probe requires an isolated project");
  if (Number(diagnosticRepeats) !== 1) failures.push("synchronous phase probe requires exactly one diagnostic repeat");
  if (Number(width) !== 3840 || Number(height) !== 2160)
    failures.push("synchronous phase probe requires a 3840x2160 viewport");
  if (Number(dpr) !== 1) failures.push("synchronous phase probe requires DPR=1");
  if (headful !== true) failures.push("synchronous phase probe requires a visible headful browser");
  return failures;
}

function instrumentPopoverSnapshotSource(source) {
  const markers = [
    {
      name: "after-old-ghost-remove",
      needle: "    removePopoverMorphGhost();\n    retainPopoverMorphGhostRef.current",
      insertion: "    removePopoverMorphGhost();\n    window.__e2SyncPhaseTimingProbe?.mark(\"after-old-ghost-remove\");\n    retainPopoverMorphGhostRef.current",
    },
    {
      name: "after-clone-created",
      needle: "    const ghost = node.cloneNode(true);\n    ghost.classList.remove(",
      insertion: "    const ghost = node.cloneNode(true);\n    window.__e2SyncPhaseTimingProbe?.mark(\"after-clone-created\");\n    ghost.classList.remove(",
    },
    {
      name: "after-clone-content-copy",
      needle: "    ghost.style.setProperty(\"position\", \"fixed\", \"important\");",
      insertion: "    window.__e2SyncPhaseTimingProbe?.mark(\"after-clone-content-copy\");\n    ghost.style.setProperty(\"position\", \"fixed\", \"important\");",
    },
    {
      name: "after-ghost-mounted",
      needle: "    document.body.appendChild(ghost);",
      insertion: "    document.body.appendChild(ghost);\n    window.__e2SyncPhaseTimingProbe?.mark(\"after-ghost-mounted\");",
    },
    {
      name: "after-scroll-restored",
      needle: "    popoverMorphGhostRef.current = ghost;",
      insertion: "    window.__e2SyncPhaseTimingProbe?.mark(\"after-scroll-restored\");\n    popoverMorphGhostRef.current = ghost;",
    },
    {
      name: "after-content-bridge",
      needle: "    const easing = motionTokens.containerEasing;\n    const reduced = prefersReducedMotion();",
      insertion: "    window.__e2SyncPhaseTimingProbe?.mark(\"after-content-bridge\");\n    const easing = motionTokens.containerEasing;\n    const reduced = prefersReducedMotion();",
    },
    {
      name: "after-motion-token-read",
      needle: "    const easing = motionTokens.containerEasing;\n    const reduced = prefersReducedMotion();",
      insertion: "    const easing = motionTokens.containerEasing;\n    window.__e2SyncPhaseTimingProbe?.mark(\"after-motion-token-read\");\n    const reduced = prefersReducedMotion();",
    },
    {
      name: "after-reduced-motion-read",
      needle: "    const surfaceHandoff = Boolean(options.preserveSnapshot);",
      insertion: "    window.__e2SyncPhaseTimingProbe?.mark(\"after-reduced-motion-read\");\n    const surfaceHandoff = Boolean(options.preserveSnapshot);",
    },
    {
      name: "before-ghost-animation",
      needle: "    const ghostFade = ghost.animate(",
      insertion: "    window.__e2SyncPhaseTimingProbe?.mark(\"before-ghost-animation\");\n    const ghostFade = ghost.animate(",
    },
  ];
  let patchedSource = String(source ?? "");
  const failures = [];
  for (const marker of markers) {
    const matches = patchedSource.split(marker.needle).length - 1;
    if (matches !== 1) {
      failures.push(`${marker.name} expected one exact source anchor; got ${matches}`);
      continue;
    }
    patchedSource = patchedSource.replace(marker.needle, marker.insertion);
  }
  return {
    source: failures.length === 0 ? patchedSource : String(source ?? ""),
    matches: markers.length - failures.length,
    failures,
    markerNames: [
      "after-old-ghost-remove",
      "after-clone-created",
      "after-clone-content-copy",
      "after-ghost-mounted",
      "after-scroll-restored",
      "after-content-bridge",
      "after-motion-token-read",
      "after-reduced-motion-read",
      "before-ghost-animation",
    ],
  };
}

function summarizeSyncPhaseProbeEvidence({
  trustedTargetClicks = 0,
  captureEnvelopes = [],
  longAnimationFrames = [],
  reactCommits = [],
} = {}) {
  const failures = [];
  const captures = Array.isArray(captureEnvelopes) ? captureEnvelopes : [];
  const loafs = Array.isArray(longAnimationFrames) ? longAnimationFrames : [];
  const commits = Array.isArray(reactCommits) ? reactCommits : [];
  if (Number(trustedTargetClicks) !== 1)
    failures.push("synchronous phase probe did not observe exactly one trusted target click");
  if (captures.length === 0)
    failures.push("synchronous phase probe did not observe a popover snapshot capture");
  for (const [index, capture] of captures.entries()) {
    if (!Number.isFinite(Number(capture.start))
      || !Number.isFinite(Number(capture.end))
      || Number(capture.end) < Number(capture.start)) {
      failures.push(`snapshot capture ${index} has an invalid timing interval`);
    }
    if (!Number.isFinite(Number(capture.cloneDurationMs))
      || Number(capture.cloneDurationMs) < 0
      || Number(capture.cloneDurationMs) > Number(capture.end) - Number(capture.start) + 0.25) {
      failures.push(`snapshot capture ${index} has invalid clone timing`);
    }
    const expectedMarks = [
      "after-old-ghost-remove",
      "after-clone-created",
      "after-clone-content-copy",
      "after-ghost-mounted",
      "after-scroll-restored",
      "after-content-bridge",
      "after-motion-token-read",
      "after-reduced-motion-read",
      "before-ghost-animation",
    ];
    const marks = Array.isArray(capture.phaseMarks) ? capture.phaseMarks : [];
    const markTimes = expectedMarks.map(name => {
      const mark = marks.find(candidate => candidate.name === name);
      return Number(mark?.at);
    });
    if (markTimes.some(time => !Number.isFinite(time))) {
      failures.push(`snapshot capture ${index} is missing an internal phase marker`);
      continue;
    }
    const boundaries = [Number(capture.start), ...markTimes, Number(capture.end)];
    if (boundaries.some((time, boundaryIndex) => (
      boundaryIndex > 0 && time < boundaries[boundaryIndex - 1]
    ))) {
      failures.push(`snapshot capture ${index} has out-of-order internal phase markers`);
    }
  }

  const overlapDuration = (intervals, start, end) => intervals.reduce((total, interval) => {
    const intervalStart = Number(interval.startTime ?? interval.start);
    const intervalDuration = Number(interval.duration);
    const intervalEnd = Number(interval.end ?? intervalStart + intervalDuration);
    if (![intervalStart, intervalEnd].every(Number.isFinite) || intervalEnd < intervalStart) return total;
    return total + Math.max(0, Math.min(end, intervalEnd) - Math.max(start, intervalStart));
  }, 0);
  const captureTotalMs = captures.reduce((total, capture) => (
    total + Math.max(0, Number(capture.end) - Number(capture.start))
  ), 0);
  const captureMaxMs = captures.reduce((maximum, capture) => (
    Math.max(maximum, Number(capture.end) - Number(capture.start))
  ), 0);
  const captureOverlapWithLongFramesMs = captures.reduce((total, capture) => (
    total + overlapDuration(loafs, Number(capture.start), Number(capture.end))
  ), 0);
  const commitTimes = commits.map(commit => Number(commit.at ?? commit.startTime))
    .filter(Number.isFinite);
  const reactCommitsDuringCapture = captures.reduce((total, capture) => (
    total + commitTimes.filter(time => time >= Number(capture.start) && time <= Number(capture.end)).length
  ), 0);
  const nearestReactCommitDistanceMs = captures.length > 0 && commitTimes.length > 0
    ? Math.min(...captures.flatMap(capture => commitTimes.map(time => (
      time < Number(capture.start)
        ? Number(capture.start) - time
        : time > Number(capture.end)
          ? time - Number(capture.end)
          : 0
    ))))
    : null;
  const phaseBoundaryNames = [
    "after-old-ghost-remove",
    "after-clone-created",
    "after-clone-content-copy",
    "after-ghost-mounted",
    "after-scroll-restored",
    "after-content-bridge",
    "after-motion-token-read",
    "after-reduced-motion-read",
    "before-ghost-animation",
  ];
  const phaseNames = [
    "rectAndOldGhostRemoval",
    "clone",
    "normalizationAndStateCopy",
    "styleAndAppend",
    "scrollRestoration",
    "contentBridge",
    "motionTokenRead",
    "reducedMotionQuery",
    "animationPreparation",
    "animationCreation",
  ];
  const phaseTotalsMs = Object.fromEntries(phaseNames.map((name, phaseIndex) => [
    name,
    captures.reduce((total, capture) => {
      const markTimes = phaseBoundaryNames.map(markerName => Number(
        capture.phaseMarks?.find(mark => mark.name === markerName)?.at,
      ));
      const boundaries = [Number(capture.start), ...markTimes, Number(capture.end)];
      const start = boundaries[phaseIndex];
      const end = boundaries[phaseIndex + 1];
      return total + (Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0);
    }, 0),
  ]));
  return {
    valid: failures.length === 0,
    failures,
    trustedTargetClicks: Number(trustedTargetClicks),
    captureCount: captures.length,
    captureTotalMs,
    captureMaxMs,
    cloneTotalMs: captures.reduce((total, capture) => total + Number(capture.cloneDurationMs), 0),
    captureOverlapWithLongFramesMs,
    reactCommitsDuringCapture,
    nearestReactCommitDistanceMs,
    phaseTotalsMs,
  };
}

module.exports = {
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
  validateBrowserGpuProvenance,
  getAnimationStartDelayDiagnostic,
  getAnimationStartDelaySetupFailures,
  getLayoutHealthStateFailures,
  getWarmLayoutReadinessFailures,
  getWarmLayerVisualEquivalenceFailures,
  getSourceWarmOpacitySetupFailures,
  getSourceWarmOpacityStateFailures,
  summarizeLayerTree,
  summarizeReactCommitProbe,
  summarizeReactFiberPathCapture,
  summarizeEditorMotionTimeline,
  auditStagePreviewSamples,
  auditSnapGuideSamples,
  getSyncPhaseProbeSetupFailures,
  summarizeSyncPhaseProbeEvidence,
  instrumentPopoverSnapshotSource,
};
