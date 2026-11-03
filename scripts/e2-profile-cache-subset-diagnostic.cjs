"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { cloneProfileForCacheSubset, inventoryProfile } = require("./lib/e2-profile-cache-subset.cjs");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "output", "playwright");
const runId = process.env.AGENTVN_E2_SUBSET_RUN_ID;
if (!runId || !/^[a-z0-9-]+$/i.test(runId))
  throw new Error("Set a unique AGENTVN_E2_SUBSET_RUN_ID.");
const experiment = path.join(outputRoot, `e2-persistent-profile-subset-${runId}`);
if (fs.existsSync(experiment)) throw new Error("Experiment directory already exists.");

const sourceNames = [
  "e2-persistent-profile-cache-pair-20261011-03",
  "e2-persistent-profile-cache-05-20261011",
  "e2-persistent-profile-cache-06-20261011",
];
const fileHash = target => createHash("sha256").update(fs.readFileSync(target)).digest("hex");
const inventoryHash = target => createHash("sha256")
  .update(JSON.stringify(inventoryProfile(target))).digest("hex");
const protectedPaths = [
  "editor/dist/index.html", "AgentVN Dev.exe",
  "editor/src/styles/layout.css", "editor/src/styles/editor-shell.css",
  "scripts/advanced-layout-transition-audit.cjs",
];
const beforeHashes = Object.fromEntries(protectedPaths.map(relative => [relative, fileHash(path.join(root, relative))]));
const report = {
  status: "RUNNING", kind: "profile-cache-subset-attribution-not-acceptance",
  productLayer: "Editor", performanceAcceptance: false,
  hypothesis: "Omitting only the root GrShaderCache from a byte-identical warmed profile restores the first-presentation long frame.",
  unchanged: "All other profile files; browser version, switches, default presentation and actual settings-to-layout interaction.",
  startedAt: new Date().toISOString(), owner: { pid: process.pid }, beforeHashes,
  viewport: { width: 3840, height: 2160 }, dpr: 1,
  viewportMode: "headful CSS viewport simulation; not physical 4K or installed acceptance",
  project: path.join(root, "scripts", "fixtures", "editor-isolated-small.vnproj"),
  pairs: [],
};
const save = () => fs.writeFileSync(path.join(experiment, "report.json"), JSON.stringify(report, null, 2), "utf8");

async function runAudit(output, profile) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AGENTVN_ADVANCED_") || key.startsWith("AGENTVN_AUDIT_"))
      delete env[key];
  }
  Object.assign(env, {
    AGENTVN_TEST_PROJECT: report.project,
    AGENTVN_WORKSPACE_OUTPUT: output,
    AGENTVN_AUDIT_VIEWPORT: "4k", ADVANCED_TOOLS_DPR: "1",
    AGENTVN_ADVANCED_LAYOUT_HEADFUL: "1",
    AGENTVN_ADVANCED_PERF_DIAGNOSTIC: "1",
    AGENTVN_ADVANCED_PERF_DIAGNOSTIC_ASSERT: "1",
    AGENTVN_ADVANCED_PERF_ENFORCE_LOAF: "1",
    AGENTVN_ADVANCED_PERF_PREVIEW: "1",
    AGENTVN_ADVANCED_PERF_REQUIRE_HARDWARE_GPU: "1",
    AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS: "1",
    AGENTVN_ADVANCED_PERF_ENTRY_MODE: "cold",
    AGENTVN_ADVANCED_PERF_TARGET_TAB: "layout",
    AGENTVN_ADVANCED_PERF_PERSISTENT_PROFILE: "1",
    AGENTVN_ADVANCED_PERF_PERSISTENT_PROFILE_PHASE: "reuse",
    AGENTVN_ADVANCED_PERF_PROFILE_DIR: profile,
  });
  const settings = Object.fromEntries(Object.entries(env).filter(([key]) =>
    key.startsWith("AGENTVN_ADVANCED_") || key.startsWith("AGENTVN_AUDIT_")
    || ["AGENTVN_TEST_PROJECT", "AGENTVN_WORKSPACE_OUTPUT", "ADVANCED_TOOLS_DPR"].includes(key)));
  const child = spawn(process.execPath, ["scripts/advanced-layout-transition-audit.cjs"], {
    cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let raw = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { raw += chunk; });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  fs.writeFileSync(`${output}.runner.log`, raw, "utf8");
  const reportPath = path.join(output, "performance-diagnostic-only.json");
  const audit = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(audit.kind, "diagnostic-only-not-acceptance");
  assert.equal(audit.serverMode, "owned-vite-production-preview");
  assert.equal(audit.isolation?.fixtureProjectId, "editor_isolated_small");
  assert.equal(audit.gpuProvenance?.ok, true);
  assert.equal(audit.persistentBrowserProfileDiagnostic?.launchEvidence?.sameProfile, true);
  assert.equal(audit.persistentBrowserProfileDiagnostic?.launchEvidence?.valid, true);
  assert(!audit.persistentBrowserProfileDiagnostic?.cleanupError);
  assert.equal(audit.diagnosticResults?.length, 1);
  const diagnostic = audit.diagnosticResults[0];
  assert.equal(diagnostic.visualEffectsMode, "product-default");
  assert.equal(diagnostic.transitionMode, "product-default");
  const trials = diagnostic.trials.filter(trial => trial.mode === "low-intrusion");
  assert.equal(trials.length, 1);
  const trial = trials[0];
  assert.equal(trial.interactionWindow.valid, true);
  assert.equal(trial.interactionWindow.source, "trusted-pointerdown");
  assert.equal(trial.viewport, "3840x2160");
  assert.equal(trial.dpr, 1);
  assert.equal(trial.longAnimationFrameSupported, true);
  assert.equal(result.signal, null);
  assert.equal(result.exitCode, audit.ok ? 0 : 1);
  return {
    ...result, command: "node scripts/advanced-layout-transition-audit.cjs", settings,
    reportPath, auditOwner: audit.owner, url: audit.editorUrl,
    browserVersion: audit.persistentBrowserProfileDiagnostic.launchEvidence.browserVersion,
    beforeCacheDirectories: audit.persistentBrowserProfileDiagnostic.before.cacheDirectories,
    afterCacheDirectories: audit.persistentBrowserProfileDiagnostic.after.cacheDirectories,
    maxLoafMs: trial.maxLongAnimationFrameMs, maxFrameGapMs: trial.maxFrameGapMs,
    performanceFailures: diagnostic.performanceFailures,
    valid: true,
  };
}

async function main() {
  // Validate all seeds before creating anything; the historical source names
  // are checked instead of guessing a nearby profile.
  for (const name of sourceNames)
    assert(fs.existsSync(path.join(outputRoot, name, "user-data", "GrShaderCache")), `Missing seed ${name}`);
  fs.mkdirSync(experiment);
  try {
    // Three paired repetitions, fixed in advance; alternate order for pair 2.
    for (const [index, sourceName] of sourceNames.entries()) {
      const source = path.join(outputRoot, sourceName, "user-data");
      const pair = {
        index: index + 1, source, sourceHashBefore: inventoryHash(source),
        order: index === 1 ? ["without-gr", "complete"] : ["complete", "without-gr"],
        variants: {},
      };
      report.pairs.push(pair);
      for (const [name, omit] of [["complete", "none"], ["without-gr", "GrShaderCache"]]) {
        const destination = path.join(experiment, `pair-${index + 1}-${name}`, "user-data");
        pair.variants[name] = {
          clone: cloneProfileForCacheSubset({ outputRoot, source, destination, omit }),
        };
      }
      assert.equal(pair.variants.complete.clone.sourceManifestSha256,
        pair.variants["without-gr"].clone.sourceManifestSha256);
      save();
      for (const name of pair.order) {
        console.log(`START pair ${index + 1} ${name}`);
        const output = path.join(outputRoot, `e2-persistent-profile-subset-${runId}-pair-${index + 1}-${name}-run`);
        const variant = pair.variants[name];
        variant.result = await runAudit(output, variant.clone.destination);
        const before = variant.result.beforeCacheDirectories;
        assert.equal(before.some(entry => entry.directory === "GrShaderCache"), name === "complete");
        const regenerated = variant.result.afterCacheDirectories.some(entry =>
          entry.directory === "GrShaderCache" && entry.fileCount > 0);
        assert.equal(regenerated, true);
        pair.sourceHashAfter = inventoryHash(source);
        assert.equal(pair.sourceHashAfter, pair.sourceHashBefore);
        save();
        console.log(`DONE pair ${index + 1} ${name}: LoAF=${variant.result.maxLoafMs.toFixed(1)}ms gap=${variant.result.maxFrameGapMs.toFixed(1)}ms`);
      }
    }
    report.afterHashes = Object.fromEntries(protectedPaths.map(relative => [relative, fileHash(path.join(root, relative))]));
    assert.deepEqual(report.afterHashes, beforeHashes);
    report.summary = report.pairs.map(pair => ({
      pair: pair.index,
      completeLoafMs: pair.variants.complete.result.maxLoafMs,
      withoutGrLoafMs: pair.variants["without-gr"].result.maxLoafMs,
      omittedFileCount: pair.variants["without-gr"].clone.omittedFiles.length,
      omittedBytes: pair.variants["without-gr"].clone.omittedFiles.reduce((sum, file) => sum + file.bytes, 0),
      sourceUnchanged: pair.sourceHashAfter === pair.sourceHashBefore,
    }));
    report.status = "DIAGNOSTIC_COMPLETED";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({ status: report.status, summary: report.summary, error: report.error,
      reportPath: path.join(experiment, "report.json") }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
