"use strict";

// Editor E2 only. Owned fixtures, reports and process handles; does not run
// installed Release, user projects, Runtime/device acceptance or model calls.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { e2PerformancePolicy } = require("./lib/e2-functional-priority-policy.cjs");
const {
  assertOwnedCheckEvidence,
  validatedPrefix,
  assertSameInvocation,
} = require("./lib/e2-gate-evidence-reuse.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output", "editor-e2-final-gates", runId);
const deliver = process.argv.includes("--deliver-dev");
const previewMotionSlice = process.argv.includes("--preview-motion-slice");
const guiSlice = process.argv.includes("--gui-dialog-slice");
const previewSlice = process.argv.includes("--preview-geometry-slice") || guiSlice || previewMotionSlice;
const controlsSlice = process.argv.includes("--controls-slice") || previewSlice;
const performancePolicy = e2PerformancePolicy(process.argv.slice(2));
assert(performancePolicy.coldEntryRequired || !controlsSlice,
  "recorded first-click deferral requires the complete E2 functional matrix, not a partial slice");
fs.mkdirSync(output, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceFiles = [
  "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/components/advanced/AdvancedToolsPanel.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
  "editor/src/utils/editorTransitionPresentation.ts", "editor/src/styles/layout.css",
  "editor/src/styles/variables.css",
  "editor/src/styles/editor-topbar.css", "scripts/build-game-shell-windows.ps1",
  "editor/src/styles/editor-shell.css", "editor/src/styles/editor-responsive.css",
  "editor/src/components/advanced/CustomComponentLibraryPanel.tsx",
  "editor/src/components/advanced/custom-component-library.css",
  "editor/src/components/advanced/RenpyTitleEditor.tsx",
  "editor/src/components/advanced/RenpyRuntimePreview.tsx",
  "editor/src/components/advanced/RenpyPreviewStage.tsx",
  "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
  "editor/src/components/advanced/renpy-title-editor.css",
  "editor/src/components/advanced/renpy-runtime-preview.css",
  "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
  "editor/src/components/advanced/useGuiImportDialog.ts",
  "editor/src/components/common/RichSelect.tsx",
  "scripts/editor-renpy-preview-motion-playwright.cjs",
  "scripts/editor-renpy-preview-geometry-playwright.cjs",
  "scripts/renpy-title-logical-scale-playwright.cjs",
  "scripts/editor-workspace-native-motion-playwright.cjs",
  "scripts/editor-e2-final-gates.cjs",
  "scripts/editor-workspace-response-playwright.cjs",
  "scripts/lib/editor-early-rendered-response.cjs",
  "scripts/editor-early-rendered-response-test.cjs",
  "scripts/lib/e2-gate-evidence-reuse.cjs",
  "scripts/e2-gate-evidence-reuse-test.cjs",
  "scripts/editor-transition-presentation-test.cjs",
  "scripts/editor-options-motion-playwright.cjs",
  "scripts/advanced-tools-transition-regression-playwright.cjs",
  "scripts/advanced-layout-warm-opacity-equivalence-playwright.cjs",
  "scripts/advanced-layout-warm-workspace-geometry-playwright.cjs",
  "scripts/e2-options-layout-sequence-diagnostic.cjs",
  "scripts/lib/e2-first-options-probes.cjs",
  "scripts/lib/e2-first-options-dom-reads.cjs",
  "scripts/lib/editor-ui-acceptance.cjs",
  "scripts/e2-first-options-probes-test.cjs",
  "scripts/lib/e2-functional-priority-policy.cjs",
  "scripts/e2-functional-priority-policy-test.cjs",
  "scripts/lib/e2-section-omission.cjs",
  "scripts/e2-section-omission-test.cjs",
  "scripts/lib/e2-workspace-inert-ownership.cjs",
  "scripts/e2-workspace-inert-ownership-test.cjs",
  "scripts/lib/e2-style-subtree-attribution.cjs",
  "scripts/e2-style-subtree-attribution-test.cjs",
  "scripts/lib/e2-layout-structure.cjs",
  "scripts/e2-layout-structure-test.cjs",
  "scripts/e2-options-diagnostic-mode-test.cjs",
  "scripts/lib/e2-frame-task-attribution.cjs",
  "scripts/e2-frame-task-attribution-test.cjs",
  "scripts/prepaint-animation-pause-playwright.cjs",
  "scripts/editor-snapshot-visible-state-playwright.cjs",
  "scripts/advanced-layout-transition-audit.cjs",
  "scripts/lib/advanced-layout-transition-performance.cjs",
  "scripts/lib/advanced-layout-transition-activation.cjs",
  "scripts/lib/e2-shader-cache-evidence.cjs",
  "scripts/e2-shader-cache-evidence-test.cjs",
  "scripts/lib/e2-hover-help-attribution.cjs",
  "scripts/e2-hover-help-attribution-test.cjs",
];
const sourceHashes = () => Object.fromEntries(sourceFiles.map(file => [file, sha(path.join(root, file))]));
const report = { runId, scope: "Editor E2 source/production and optional native Dev; not installed Release or Android",
  slice: previewMotionSlice ? "renpy-preview-device-motion-not-full-E2"
    : guiSlice ? "gui-import-dialog-not-full-E2" : previewSlice ? "renpy-preview-geometry-not-full-E2"
    : controlsSlice ? "node-rail-and-component-controls-not-full-E2" : "full-E2",
  status: "RUNNING", checks: [], performancePolicy, sourceHashes: sourceHashes(), output,
  browserScope: "Chromium CSS viewport/DPR source checks use explicitly recorded headless/headful modes; native Dev verified separately",
  fixture: path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"),
  matrix: { viewports: ["1920x1080", "2560x1440", "3840x2160"], dpr: [1, 2],
    modes: ["ordinary", "reduced"], lowResolution: "excluded by user request" } };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
persist();
const reuseArgument = process.argv.find(arg => arg.startsWith("--reuse-unchanged-evidence="));
let reusePrefix = [], reuseCursor = 0, reuseDirectory, reuseReport, reuseReportPath;
function initializeEvidenceReuse() {
  if (!reuseArgument) return;
  const file = path.resolve(reuseArgument.slice("--reuse-unchanged-evidence=".length));
  const evidenceRoot = path.join(root, "output/editor-e2-final-gates") + path.sep;
  assert(file.startsWith(evidenceRoot) && path.basename(file) === "report.json", "Reuse must name an owned E2 report");
  const previous = JSON.parse(fs.readFileSync(file, "utf8"));
  reuseReport = previous;
  reuseReportPath = file;
  reuseDirectory = path.dirname(file);
  assert.equal(path.basename(reuseDirectory), previous.runId, "Reuse directory/run identity mismatch");
  reusePrefix = validatedPrefix(previous, report);
  report.evidenceReuse = { report: file, sha256: sha(file), checks: reusePrefix.length,
    reason: "Same-day unchanged recorded source-hash scope; each command, mode, isolated fixture and log revalidated",
    scope: "Only sourceHashes recorded in both reports; not a claim of exhaustive repository dependency hashing" };
  persist();
}
const modes = [
  { name: "normal", dpr: "1", reduced: "0" },
  { name: "dpr2", dpr: "2", reduced: "0" },
  { name: "reduced", dpr: "1", reduced: "1" },
  { name: "reduced-dpr2", dpr: "2", reduced: "1" },
];
async function execute(label, command, args, overrides = {}) {
  assert.deepEqual(sourceHashes(), report.sourceHashes, "product changed while verifying this build");
  const work = path.join(output, label);
  fs.mkdirSync(work);
  const fixture = path.join(work, "isolated-small.vnproj");
  fs.copyFileSync(report.fixture, fixture);
  const evidence = path.join(work, "evidence");
  const logFile = path.join(work, "command.log");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("AGENTVN_ADVANCED_PERF_") || key.startsWith("ADVANCED_TOOLS_")
      || key.startsWith("AGENTVN_E2_OPTIONS_")
      || /^(MOTION_|WORKBENCH_MORPH_|EDITOR_SURFACE_|EDITOR_TRANSITION_)/.test(key)) delete env[key];
  }
  const recordedEnv = {
    AGENTVN_TEST_PROJECT: fixture, AGENTVN_WORKSPACE_OUTPUT: evidence,
    AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
    ADVANCED_TOOLS_VIEWPORT: "1080p,1440p,4k", ADVANCED_TOOLS_HEADFUL: "1",
    WORKBENCH_MORPH_VIEWPORTS: "1080p,1440p,4k", WORKBENCH_MORPH_HEADFUL: "1",
    MOTION_VIEWPORTS: "1080p,1440p,4k",
    EDITOR_SURFACE_VIEWPORTS: "1080p,1440p,4k", EDITOR_SURFACE_HEADFUL: "1",
    EDITOR_TRANSITION_VIEWPORTS: "1080p,1440p,4k", EDITOR_TRANSITION_HEADFUL: "1",
    LAYOUT_POLISH_VIEWPORTS: "1080p,1440p,4k", LAYOUT_POLISH_HEADFUL: "0",
    RENPY_GEOMETRY_VIEWPORTS: "1080p,1440p,4k", RENPY_GEOMETRY_HEADFUL: "0",
    RENPY_MOTION_VIEWPORTS: "1080p,1440p,4k", RENPY_MOTION_HEADFUL: "0",
    RESPONSE_HEADFUL: "1",
    RESPONSE_VIEWPORTS: "1080p,1440p,4k",
    ...overrides,
  };
  Object.assign(env, recordedEnv);
  if (label !== "e2-gate-evidence-reuse-test" && reuseCursor < reusePrefix.length) {
    const previous = reusePrefix[reuseCursor];
    const libraryCheck = label === "gamecli-library-build-isolation-test";
    if (libraryCheck) assert.equal(previous.env.AGENTVN_LIBRARY_BUILD_TEST_OUTPUT,
      path.join(reuseDirectory, "library-isolation"), "Reused build output ownership mismatch");
    assertSameInvocation(previous, label, [command, ...args],
      libraryCheck ? { ...recordedEnv,
        AGENTVN_LIBRARY_BUILD_TEST_OUTPUT: previous.env.AGENTVN_LIBRARY_BUILD_TEST_OUTPUT } : recordedEnv);
    assertOwnedCheckEvidence(previous, reuseReport, reuseReportPath,
      path.join(root, "output", "editor-e2-final-gates"),
      reportPath => JSON.parse(fs.readFileSync(reportPath, "utf8")), sha);
    assert.equal(sha(previous.env.AGENTVN_TEST_PROJECT), sha(fixture), "Reused fixture content changed");
    reuseCursor++;
    if (!libraryCheck) {
      report.checks.push({ ...previous, reusedFrom: report.evidenceReuse.report,
        reusedLogSha256: sha(previous.logFile), revalidatedAt: new Date().toISOString() });
      persist();
      console.log(`VERIFIED REUSE ${label}`);
      return;
    }
    // Its output directory is run-specific. Execute this cheap check again
    // rather than attributing an earlier build directory to this run.
  }
  const check = { label, command: [command, ...args], env: recordedEnv,
    startedAt: new Date().toISOString(), status: "RUNNING", logFile, evidence };
  report.checks.push(check);
  persist();
  console.log(`START ${label}`);
  const stream = fs.createWriteStream(logFile, { flags: "wx" });
  let commandError;
  const code = await new Promise(resolve => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    check.pid = child.pid;
    persist();
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.on("error", error => { commandError = String(error); });
    child.on("close", code => { stream.end(); resolve(code); });
  });
  Object.assign(check, { exitCode: code, status: code === 0 && !commandError ? "PASS" : "FAILED",
    finishedAt: new Date().toISOString(), ...(commandError ? { error: commandError } : {}) });
  persist();
  console.log(`${check.status} ${label}`);
  assert.equal(check.status, "PASS", `Required gate failed: ${label}; see ${logFile}. Dev prohibited.`);
}
const test = (script, label = script, env = {}, extraArgs = []) =>
  execute(label, process.execPath, [`scripts/${script}.cjs`, ...extraArgs], env);
const npm = (project, task) => execute(`${project}-${task}`, "cmd.exe",
  ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${project} run ${task}`]);
const perf = (label, production) => test("advanced-layout-transition-audit", label, {
  AGENTVN_AUDIT_VIEWPORT: "4k", ADVANCED_TOOLS_DPR: "1",
  AGENTVN_ADVANCED_LAYOUT_HEADFUL: "1", AGENTVN_ADVANCED_PERF_DIAGNOSTIC: "1",
  AGENTVN_ADVANCED_PERF_DIAGNOSTIC_ASSERT: "1", AGENTVN_ADVANCED_PERF_ENFORCE_LOAF: "1",
  AGENTVN_ADVANCED_PERF_REQUIRE_HARDWARE_GPU: "1",
  AGENTVN_ADVANCED_PERF_DIAGNOSTIC_REPEATS: "1", AGENTVN_ADVANCED_PERF_ENTRY_MODE: "cold",
  ...(production ? { AGENTVN_ADVANCED_PERF_PREVIEW: "1" } : {}),
});
async function main() {
  initializeEvidenceReuse();
  await test("e2-gate-evidence-reuse-test");
  for (const mode of modes) await test("editor-workspace-response-playwright", `workspace-response-${mode.name}`, {
    RESPONSE_DPR: mode.dpr, RESPONSE_REDUCED: mode.reduced,
  });
  if (previewMotionSlice || !controlsSlice) for (const mode of modes) {
    // Source/browser frames must not depend on desktop window occlusion. Keep
    // native Dev/WebView verification below separate; this is not a native PASS.
    const env = { RENPY_MOTION_DPR: mode.dpr, RENPY_MOTION_REDUCED: mode.reduced,
      RENPY_MOTION_HEADFUL: "0" };
    await test("editor-renpy-preview-motion-playwright", `preview-motion-${mode.name}`, env);
    await test("renpy-title-logical-scale-playwright", `runtime-title-default-scale-${mode.name}`, env);
  }
  if (guiSlice) {
    for (const mode of modes) await test("editor-gui-import-dialog-playwright", `gui-dialog-${mode.name}`, {
      GUI_DIALOG_DPR: mode.dpr, GUI_DIALOG_REDUCED: mode.reduced, GUI_DIALOG_HEADFUL: "1",
    });
    for (const script of ["renpy-gui-import-contract-test", "renpy-gui-archive-scan-test",
      "renpy-gui-import-apply-test", "renpy-gui-import-roundtrip-test"]) await test(script);
    for (const mode of modes) await test("runtime-layout-profiles-playwright", `gui-import-${mode.name}`, {
      PROFILE_DPR: mode.dpr, PROFILE_REDUCED: mode.reduced,
    }, ["--gui-import"]);
  }
  if (previewSlice || !controlsSlice) for (const mode of modes) {
    await test("editor-renpy-preview-geometry-playwright", `preview-geometry-${mode.name}`, {
      RENPY_GEOMETRY_DPR: mode.dpr, RENPY_GEOMETRY_REDUCED: mode.reduced,
    });
  }
  for (const mode of modes) {
    await test("editor-layout-workbench-polish-playwright", `controls-${mode.name}`, {
      LAYOUT_POLISH_DPR: mode.dpr, LAYOUT_POLISH_REDUCED: mode.reduced,
      // Indicator frame-count checks need the visible compositor path. Keep
      // the explicit scoped mode in the report, rather than treating a skipped
      // offscreen frame as proof of a product hard-cut.
      LAYOUT_POLISH_HEADFUL: "1",
    });
    await test("editor-snapshot-visible-state-playwright", `snapshot-state-${mode.name}`, {
      SNAPSHOT_STATE_VIEWPORTS: "1080p,1440p,4k",
      SNAPSHOT_STATE_DPR: mode.dpr, SNAPSHOT_STATE_REDUCED: mode.reduced,
    });
    await test("editor-snapshot-visible-state-playwright", `assistant-snapshot-state-${mode.name}`, {
      SNAPSHOT_STATE_VIEWPORTS: "1080p,1440p,4k",
      SNAPSHOT_STATE_DPR: mode.dpr, SNAPSHOT_STATE_REDUCED: mode.reduced,
    }, ["--assistant-scroll-only"]);
  }
  for (const mode of modes) await test("advanced-layout-warm-workspace-geometry-playwright",
    `warm-workspace-geometry-${mode.name}`, {
      WARM_GEOMETRY_DPR: mode.dpr, WARM_GEOMETRY_REDUCED: mode.reduced,
    });
  await test("custom-component-library-playwright");
  await test("e2-first-options-probes-test");
  await test("e2-functional-priority-policy-test");
  await test("editor-early-rendered-response-test");
  await test("e2-section-omission-test");
  await test("e2-workspace-inert-ownership-test");
  await test("e2-style-subtree-attribution-test");
  await test("e2-layout-structure-test");
  await test("e2-options-diagnostic-mode-test");
  await test("e2-frame-task-attribution-test");
  if (!controlsSlice) await test("e2-options-layout-sequence-diagnostic", "workspace-inert-ownership-source", {
    AGENTVN_E2_OPTIONS_ASSERT_INERT_OWNERSHIP: "1",
  });
  if (!controlsSlice && performancePolicy.coldEntryRequired) await test("e2-options-layout-sequence-diagnostic", "first-options-mount-regression", {
    AGENTVN_E2_OPTIONS_DOM_READS: "1", AGENTVN_E2_OPTIONS_ASSERT_MOUNT_READS: "1",
  });
  for (const script of ["editor-transition-presentation-test", "e2-hidden-snapshot-pruning-test",
    "e2-warm-descendant-style-test", "e2-shader-cache-evidence-test", "e2-hover-help-attribution-test",
    "advanced-layout-transition-performance-test",
    "advanced-layout-transition-activation-test", "editor-ui-acceptance-isolation-contract-test",
    "owned-vite-server-test", "prepaint-animation-pause-playwright",
    "editor-workspace-contract", "gamecli-library-build-isolation-test"]) {
    await test(script, script, script === "gamecli-library-build-isolation-test"
      ? { AGENTVN_LIBRARY_BUILD_TEST_OUTPUT: path.join(output, "library-isolation") } : {});
  }
  for (const mode of modes.filter(mode => !controlsSlice || mode.name !== "reduced")) {
    await test("advanced-tools-transition-regression-playwright", `advanced-${mode.name}`, {
      ADVANCED_TOOLS_DPR: mode.dpr, ADVANCED_TOOLS_REDUCED_MOTION: mode.reduced,
    });
    if (!controlsSlice) await test("editor-workbench-container-morph-playwright", `morph-${mode.name}`, {
      WORKBENCH_MORPH_DPR: mode.dpr, WORKBENCH_MORPH_REDUCED: mode.reduced,
    });
  }
  for (const mode of modes.filter(mode => mode.name !== "reduced")) {
    if (!controlsSlice) await test("editor-options-motion-playwright", `options-${mode.name}`, {
      MOTION_DPR: mode.dpr, MOTION_REDUCED: mode.reduced,
    });
    await test("editor-workspace-surface-transition-playwright", `surface-${mode.name}`, {
      EDITOR_SURFACE_DPR: mode.dpr, EDITOR_SURFACE_REDUCED: mode.reduced,
    });
    if (!controlsSlice) await test("editor-page-transition-regression-playwright", `page-${mode.name}`, {
      EDITOR_TRANSITION_DPR: mode.dpr, EDITOR_TRANSITION_REDUCED: mode.reduced,
    });
  }
  if (!controlsSlice) for (const name of ["selection", "supersede", "rapid", "loaderror", "timeout",
    "workspace-load", "workspace-error", "workspace-motion", "initial-request"]) {
    await test("editor-options-motion-playwright", `options-${name}`, {}, [`--case=${name}`]);
  }
  if (performancePolicy.coldEntryRequired) for (const round of [1, 2, 3]) await perf(`source-cold-4k-${round}`, false);
  if (!controlsSlice && performancePolicy.coldEntryRequired) for (const round of [1, 2, 3])
    await test("e2-options-layout-sequence-diagnostic", `source-whole-first-options-${round}`, {
      AGENTVN_E2_OPTIONS_ASSERT_PERFORMANCE: "1",
    });
  report.sourceStatus = "PASS";
  persist();
  await npm("editor", "typecheck");
  await npm("editor", "build");
  await npm("GameCli_framework", "build");
  if (!controlsSlice) await test("e2-options-layout-sequence-diagnostic", "workspace-inert-ownership-production", {
    AGENTVN_E2_OPTIONS_LAYOUT_PRODUCTION: "1", AGENTVN_E2_OPTIONS_ASSERT_INERT_OWNERSHIP: "1",
  });
  if (!controlsSlice && performancePolicy.coldEntryRequired) await test("e2-options-layout-sequence-diagnostic", "first-options-mount-regression-production", {
    AGENTVN_E2_OPTIONS_LAYOUT_PRODUCTION: "1",
    AGENTVN_E2_OPTIONS_DOM_READS: "1", AGENTVN_E2_OPTIONS_ASSERT_MOUNT_READS: "1",
  });
  if (performancePolicy.coldEntryRequired) for (const round of [1, 2, 3]) await perf(`production-cold-4k-${round}`, true);
  if (!controlsSlice && performancePolicy.coldEntryRequired) for (const round of [1, 2, 3])
    await test("e2-options-layout-sequence-diagnostic", `production-whole-first-options-${round}`, {
      AGENTVN_E2_OPTIONS_LAYOUT_PRODUCTION: "1", AGENTVN_E2_OPTIONS_ASSERT_PERFORMANCE: "1",
    });
  await test("editor-workspace-playwright");
  report.productionStatus = "PASS";
  persist();
  if (deliver) {
    await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
      "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
    const target = path.join(root, "AgentVN Dev.exe");
    const binary = path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe");
    assert.equal(sha(target), sha(binary), "Root Dev was not actually overwritten");
    report.dev = { status: "PASS", path: target, sha256: sha(target), outputSha256: sha(binary),
      modifiedAt: fs.statSync(target).mtime.toISOString() };
    persist();
    await test("editor-workspace-native-motion-playwright", "editor-workspace-native-motion-playwright", {},
      previewMotionSlice ? ["--preview-geometry", "--preview-motion"]
        : guiSlice ? ["--preview-geometry", "--gui-dialog"]
        : previewSlice || !controlsSlice ? ["--preview-geometry"] : []);
    report.nativeStatus = "PASS";
  }
  assert(report.checks.length > 0 && report.checks.every(check => check.status === "PASS"));
  assert.equal(reuseCursor, reusePrefix.length, "Unused/mismatched evidence prefix");
  report.status = previewMotionSlice
    ? (deliver ? "EDITOR_RENPY_PREVIEW_MOTION_DEV_PASS" : "EDITOR_RENPY_PREVIEW_MOTION_SOURCE_PASS")
    : guiSlice
    ? (deliver ? "EDITOR_GUI_IMPORT_DIALOG_DEV_PASS" : "EDITOR_GUI_IMPORT_DIALOG_SOURCE_PASS")
    : previewSlice
    ? (deliver ? "EDITOR_RENPY_PREVIEW_GEOMETRY_DEV_PASS" : "EDITOR_RENPY_PREVIEW_GEOMETRY_SOURCE_PASS")
    : controlsSlice
    ? (deliver ? "EDITOR_NODE_RAIL_CONTROLS_DEV_PASS" : "EDITOR_NODE_RAIL_CONTROLS_SOURCE_PASS")
    : performancePolicy.coldEntryRequired
      ? (deliver ? "EDITOR_E2_DEV_GATES_PASS" : "EDITOR_E2_SOURCE_PRODUCTION_GATES_PASS")
      : (deliver ? "EDITOR_E2_FUNCTIONAL_DEV_PASS_PERFORMANCE_DEFERRED"
        : "EDITOR_E2_FUNCTIONAL_SOURCE_PRODUCTION_PASS_PERFORMANCE_DEFERRED");
}
main().catch(error => {
  report.status = "FAILED";
  report.error = error.stack;
  if (!report.dev) report.dev = { status: "NOT_BUILT" };
  process.exitCode = 1;
  console.error(error.stack);
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(`Evidence: ${path.join(output, "report.json")}`);
});
