"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

async function compareRestartScreenshots(screenshotPath, referencePath) {
  const sharp = require(path.join(__dirname, "..", "GameCli_framework", "node_modules", "sharp"));
  const decode = async file => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const [sample, reference] = await Promise.all([decode(screenshotPath), decode(referencePath)]);
  const { width, height, channels } = sample.info;
  if (width !== reference.info.width || height !== reference.info.height || channels !== reference.info.channels || channels !== 3) {
    throw new Error("RESTART_SCREENSHOT_DIMENSIONS_MISMATCH");
  }
  const blocksAcross = Math.ceil(width / 64);
  const blocks = new Float64Array(blocksAcross * Math.ceil(height / 64));
  const blockChannels = new Uint32Array(blocks.length);
  let difference = 0;
  let largeDifferencePixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels;
      const block = Math.floor(y / 64) * blocksAcross + Math.floor(x / 64);
      let largeDifference = false;
      for (let channel = 0; channel < channels; channel++) {
        const delta = Math.abs(sample.data[offset + channel] - reference.data[offset + channel]);
        difference += delta;
        blocks[block] += delta;
        blockChannels[block]++;
        if (delta > 16) largeDifference = true;
      }
      if (largeDifference) largeDifferencePixels++;
    }
  }
  const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return {
    screenshotPath, screenshotSha256: sha256(screenshotPath),
    referencePath, referenceSha256: sha256(referencePath),
    width, height,
    meanAbsoluteDifference: difference / (width * height * channels),
    maxBlockMeanAbsoluteDifference: Math.max(...blocks.map((value, index) => value / blockChannels[index])),
    largeDifferencePixelRatio: largeDifferencePixels / (width * height),
  };
}

function runtimeFailures(input, packageName, knownPids = []) {
  const lines = Array.isArray(input) ? input : String(input).split(/\r?\n/);
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const packagePattern = new RegExp(`\\b${escaped}(?=$|[\\s,/:)])`);
  const pids = new Set(knownPids.map(String));
  const pidOf = line => line.match(/^\d\d-\d\d\s+\S+\s+(\d+)\s+\d+\s+[VDIWEF]\s/)?.[1];
  // AndroidRuntime emits the process identity after the FATAL EXCEPTION line.
  for (const line of lines) {
    if (/AndroidRuntime: Process:/.test(line) && packagePattern.test(line)) {
      const pid = pidOf(line);
      if (pid) pids.add(pid);
    }
  }
  return [...new Set(lines.filter(line => {
    if (/ANR in |Input dispatching timed out|Unable to start activity/.test(line) && packagePattern.test(line)) return true;
    // Bionic FORTIFY aborts can precede process termination without logcat ever
    // receiving the later tombstone/Fatal signal line (actual device-05 case).
    return /FATAL EXCEPTION|SIGSEGV|Fatal signal|FORTIFY:|panicked at|Native crash/i.test(line)
      && (pids.has(pidOf(line)) || packagePattern.test(line));
  }))];
}

function scopedRuntimeLog(input, packageName, knownPids = []) {
  const lines = Array.isArray(input) ? input : String(input).split(/\r?\n/);
  const pids = new Set(knownPids.map(String));
  // Isolated WebView renderers run under a generic Google package name.
  // ActivityManager's service owner maps them to this app without guessing.
  for (const line of lines) {
    const start = line.match(/Start proc (\d+):.*sandboxed_process/);
    if (start && line.includes(`{${packageName}/`)) pids.add(start[1]);
  }
  const scoped = lines.filter(line => pids.has(line.trim().split(/\s+/)[2]));
  // Keep upstream cache errors even when their message omits the word "cache".
  // Detection is not an allowlist: previously unseen failures remain blocking.
  const cacheImplementationError = /\[ERROR:(?:simple_[a-z_]+|disk_cache)\.cc\(\d+\)\]/i;
  const warnings = scoped.filter(line => cacheImplementationError.test(line)
    || /cache.*(inaccessible|fail)|Unable to create cache|tile memory limits|simple_file_enumerator|Could not reconstruct index/i.test(line));
  return { pids: [...pids], lines: scoped, warnings: [...new Set(warnings)], fatal: runtimeFailures(lines, packageName, [...pids]) };
}

function assessRestartTrials(trials) {
  if (trials.length !== 6 || trials.some(trial => trial.fatal?.length)) return { status: 'BLOCKED', reason: 'SIX_NON_FATAL_TRIALS_REQUIRED' };
  const cachePattern = /Code Cache\/(?:js|wasm)(?:\/[^:\r\n]*)?: No such file or directory|Could not get file info for .*\/Code Cache\/(?:js|wasm)\/|readdir .*\/Code Cache\/(?:js|wasm): No such file or directory|Could not reconstruct index from disk/i;
  const tilePattern = /tile memory limits exceeded/i;
  const warningTrials = trials.flatMap((trial, index) => trial.warnings?.length ? [index + 1] : []);
  const allWarnings = trials.flatMap(trial => trial.warnings || []);
  const unknownWarnings = allWarnings.filter(line => !cachePattern.test(line) && !tilePattern.test(line));
  const tileWarnings = allWarnings.filter(line => tilePattern.test(line));
  const layerKeys = ['documents', 'nodes', 'jsEventListeners'];
  const lifecycleKinds = [...new Set(trials.map(trial => trial.kind).filter(Boolean))];
  const bands = lifecycleKinds.length
    ? lifecycleKinds.map(kind => ({ kind, trials: trials.filter(trial => trial.kind === kind) }))
    : [{ kind: 'all', trials }];
  const bandAssessments = bands.map(({ kind, trials: bandTrials }) => {
    const layerRanges = Object.fromEntries(layerKeys.map(key => {
      const values = bandTrials.map(trial => Number(trial.layers?.[key])).filter(Number.isFinite);
      return [key, values.length
        ? { min: Math.min(...values), max: Math.max(...values), delta: Math.max(...values) - Math.min(...values) }
        : null];
    }));
    const layerGrowth = layerKeys.some(key => {
      const values = bandTrials.map(trial => Number(trial.layers?.[key]));
      return values.length >= 3
        && values.every(Number.isFinite)
        && values.slice(1).every((value, index) => value > values[index])
        && values.at(-1) - values[0] > (key === 'documents' ? 1 : key === 'nodes' ? 100 : 15);
    });
    const pssValues = bandTrials.map(trial => Number(trial.pssKb)).filter(Number.isFinite);
    const monotonicPssGrowth = pssValues.length >= 3
      && pssValues.slice(1).every((value, index) => value > pssValues[index] + 4096);
    /*
     * Clean-install trials intentionally measure initialization. A cold
     * WebView may report its pre-hydration DOM in one trial and its hydrated
     * title DOM in another; that is not retained-data growth. Retained-data
     * trials are the authoritative band for leak detection.
     */
    const isStable = kind === 'clean-install'
      ? Boolean(
        layerRanges.documents
        && layerRanges.documents.delta <= 1
        && layerRanges.jsEventListeners
        && layerRanges.jsEventListeners.delta <= 25
        && !monotonicPssGrowth,
      )
      : Boolean(
        layerRanges.documents
        && layerRanges.documents.delta <= 1
        && layerRanges.nodes
        && layerRanges.nodes.delta <= 200
        && layerRanges.jsEventListeners
        && layerRanges.jsEventListeners.delta <= 25
        && !layerGrowth
        && !monotonicPssGrowth,
      );
    return { kind, layerRanges, layerGrowth, monotonicPssGrowth, isStable };
  });
  const primaryBand = bandAssessments.find(band => band.kind === 'retained-data') || bandAssessments[0];
  const layerRanges = primaryBand.layerRanges;
  const stableLayers = bandAssessments.every(band => band.isStable);
  const pss = trials.map(trial => Number(trial.pssKb));
  const monotonicGrowth = pss.every(Number.isFinite) && pss.slice(1).every((value, index) => value > pss[index] + 4096);
  const allTrialsWarn = warningTrials.length === trials.length;
  const stableVisuals = trials.every(trial => Array.isArray(trial.images));
  const screenshotHashes = trials.map(trial => trial.screenshotSha256).filter(Boolean);
  const tileVisualComparisons = trials
    .filter(trial => (trial.warnings || []).some(line => tilePattern.test(line)))
    .map(trial => trial.visualComparison)
    .filter(Boolean);
  const tileVisualMatch = !tileWarnings.length || (
    (screenshotHashes.length === trials.length && trials.every((trial, index) =>
      !(trial.warnings || []).some(line => tilePattern.test(line))
      || screenshotHashes.some((hash, other) => other !== index && hash === trial.screenshotSha256)))
    || tileVisualComparisons.length === trials.filter(trial => (trial.warnings || []).some(line => tilePattern.test(line))).length
      && tileVisualComparisons.every(comparison =>
        screenshotHashes.includes(comparison.screenshotSha256)
        && screenshotHashes.includes(comparison.referenceSha256)
        && comparison.screenshotSha256 !== comparison.referenceSha256
        && Number(comparison.width) > 0 && Number(comparison.height) > 0
        && Number(comparison.meanAbsoluteDifference) <= 1
        && Number(comparison.maxBlockMeanAbsoluteDifference) <= 2
        && Number(comparison.largeDifferencePixelRatio) <= 0.001)
  );
  const status = !unknownWarnings.length && !allTrialsWarn && stableLayers && !monotonicGrowth && stableVisuals && tileVisualMatch
    ? tileWarnings.length ? 'PASS_WITH_NON_BLOCKING_WEBVIEW_TILE_WARNING'
      : warningTrials.length ? 'PASS_WITH_NON_BLOCKING_WEBVIEW_CACHE_WARNING' : 'PASS'
    : 'BLOCKED';
  return { status, warningTrials, unknownWarnings, tileWarningCount: tileWarnings.length, tileVisualMatch, stableLayers, monotonicGrowth, pssKb: pss,
    layerRanges, lifecycleBands: bandAssessments,
    reason: status === 'BLOCKED' ? 'PERSISTENT_UNKNOWN_OR_GROWING_RUNTIME_EVIDENCE' : 'STABLE_REPEATED_RUNTIME_EVIDENCE' };
}

module.exports = { runtimeFailures, scopedRuntimeLog, assessRestartTrials, compareRestartScreenshots };
