"use strict";
// Evidence-integrity review only: does not launch products, rebuild, or modify old reports.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const resolve = p => path.resolve(root, p);
const read = p => JSON.parse(fs.readFileSync(resolve(p), "utf8").replace(/^\uFEFF/, ""));
function sha(file) {
  const fd = fs.openSync(resolve(file), "r");
  const buffer = Buffer.alloc(1024 * 1024), hash = crypto.createHash("sha256");
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}
function verifyFile(file, expected) {
  const actual = sha(file);
  if (expected) assert.equal(actual, expected.toLowerCase(), `Byte identity: ${file}`);
  return { path: resolve(file), sha256: actual, bytes: fs.statSync(resolve(file)).size };
}
function group(file, status, arrays, partial = false) {
  const value = read(file);
  assert.equal(value.status, status, `Report status: ${file}`);
  const counts = {};
  for (const [key, expected] of Object.entries(arrays)) {
    const count = typeof expected === "number" ? expected : expected.total;
    assert(Array.isArray(value[key]) && count > 0, `Nonempty evidence: ${file}/${key}`);
    assert.equal(value[key].length, count, `Evidence count: ${file}/${key}`);
    const notPassed = value[key].filter(row => row?.status && row.status !== "PASS")
      .map(row => ({ name: row.name, status: row.status }));
    assert.deepEqual(notPassed, typeof expected === "number" ? [] : expected.nonPassed,
      `Unexpected unpassed child: ${file}/${key}`);
    counts[key] = { total: count, nonPassed: notPassed };
  }
  return { ...verifyFile(file), originalStatus: value.status, counts,
    interpretation: partial ? "ONLY_COMPLETED_CHILDREN; ORIGINAL_FAILURE_PRESERVED" : "HISTORICAL_SCOPE_NOT_A_NEW_PRODUCT_RUN" };
}
const specs = [
  ["E2", "output/editor-e2-final-gates/2026-10-11T16-22-59-928Z/report.json",
    "EDITOR_E2_FUNCTIONAL_DEV_PASS_PERFORMANCE_DEFERRED", { checks: 89 }],
  ["E3-source", "output/novel-card-position-gates/2026-10-17T01-11-44-737Z/report.json",
    "NOVEL_CARD_POSITION_SOURCE_AND_DEV_PASS", { steps: 28 }],
  ["Release", "output/novel-card-position-release-20261017-01/report.json",
    "INSTALLED_RUNTIME_WEBVIEW_RELEASE_READY", { steps: 3 }],
  ["E3-crash", "output/novel-card-position-crash-20261017-01/report.json", "PASS", { cases: 4 }],
  ["E3-installed", "output/novel-card-position-installed-20261017-01/report.json",
    "PASS", { cases: 8, matrix: 12 }],
  ["E3-terminal", "output/novel-card-position-installed-20261017-01/installed-terminal-audit-01.json",
    "PASS", { cases: 4 }],
  ["E4-B", "output/e4b-installed-final-20261014-01/nsis-session-03/repository-flow-20261014-03/report.json",
    "PASS", { cases: 7, runtimeMatrix: 12 }],
  ["E4-author-reference", "output/e4ac-installed-authoring-20261016-02/report.json",
    "FAILED", { cases: 5, matrix: 12 }, true],
  ["E4-author", "output/e4ac-installed-authoring-20261016-05/report.json",
    "PASS", { cases: 7, matrix: 12, playerMatrix: 12 }],
  ["E4-profiles", "output/e4ac-installed-profile-safety-20261016-01/report.json",
    "PASS", { cases: 6, matrix: 12 }],
  ["E4-story-author", "output/e4ac-player-authoring-release-20261016-02/authoring-01/report.json",
    "PASS", { cases: 6, matrix: 12, playerMatrix: 12 }],
  ["E4-font-node", "output/e4ac-font-node-release-20261016-01/authoring-01/report.json",
    "PASS", { cases: 5, fontMatrix: 12, nodeMatrix: 12, playerMatrix: 12 }],
  ["E4-runtime", "output/dialog-presentation-gates/2026-10-12T20-04-04-365Z-artifact-final/report.json",
    "E4_DIALOGUE_BROWSER_DEV_PASS", { steps: 35 }],
  ["E4-native", "output/playwright/dialog-native-preview/2026-10-12T20-14-09-221Z/report.json",
    "PASS", { cases: 24 }],
  ["E5-agent", "output/e5-complete-installed-20261014-01/agent-flow-01/report.json",
    "PASS", { cases: 7, matrix: 12, queueMatrix: 12 }],
  ["E5-lifecycle", "output/e5-complete-installed-20261014-01/lifecycle-final-01/report.json",
    "PASS", { cases: 11, matrix: 12, lockMatrix: 12 }],
  ["E5-component", "output/e5-component-installed-20261014-01/session-02/component-repair-replay-01/report.json",
    "PASS", { cases: 8, matrix: 12 }],
  ["E5-live-original", "output/e5-component-installed-20261014-01/session-01/components-flow-01/report.json",
    "FAILED", { cases: 8, matrix: 12 }, true],
  ["R1", "output/r1-runtime-settings-gates/2026-10-14T03-28-50-024Z/report.json",
    "R1_SOURCE_AND_DEV_GATES_PASS", { checks: 29 }],
  ["R2", "output/r2-runtime-flow-gates/2026-10-14T05-32-43-337Z/report.json",
    "R2_SOURCE_AND_DEV_PASS", { checks: 26 }],
  ["R2-behavior", "output/playwright/runtime-r2-flow/2026-10-14T05-18-29-534Z/report.json",
    "PASS", { cases: 288 }],
  ["P1-assets", "output/p1-installed-final-20261014-03/nsis-session-01/p1-native-resource-01/report.json",
    "PASS", { cases: 17 }],
  ["P1-directory", "output/p1-installed-final-20261014-03/nsis-session-01/p1-directory-roundtrip-01/report.json",
    "PASS", { cases: 3 }],
  ["Windows-save-partial", "output/portable-save-release-20261016-02/portable-saves-01/continuations/20261016-safe-04/report.json",
    "FAILED", { cases: { total: 4, nonPassed: [
      { name: "normal-exit-new-process-real-native-load", status: "FAILED" },
    ] }, nativeMatrix: 12 }, true],
  ["Windows-save-partial-ACL", "output/portable-save-release-20261016-02/portable-saves-01/continuations/20261016-safe-06/report.json",
    "BLOCKED", { cases: 5, nativeMatrix: 12 }, true],
  ["Windows-save-closure", "output/portable-save-release-20261016-02/portable-saves-01/continuations/authorized-quick-01/report.json",
    "INSTALLED_PORTABLE_SAVE_FLOW_PASS", { cases: 5 }],
  ["F1-Windows", "output/final-hidden-growth-installed-20261017-01/windows-terminal-audit-01.json",
    "INSTALLED_FINAL_WINDOWS_TERMINAL_AUDIT_PASS", { checks: 5 }],
  ["F1-Windows-runtime", "output/final-hidden-growth-installed-20261017-01/native-runtime-01/report.json",
    "INSTALLED_FINAL_WINDOWS_NATIVE_MATRIX_PASS", { cases: 12 }],
  ["F1-Android", "output/final-hidden-growth-installed-20261017-01/android-device-02/terminal-audit-01.json",
    "INSTALLED_FINAL_HIDDEN_GROWTH_ANDROID_TERMINAL_PASS", { checks: 5 }],
  ["Cleanup", "output/cleanup-audit-20261017-output-01/verification.json", "PASS", { checks: 5 }],
];
const finalRoot = "output/final-hidden-growth-installed-20261017-01";
const output = resolve(process.argv[2] || "");
assert(process.argv.length === 3, "node delivery-completion-audit.cjs <fresh-output.json>");
assert(output.startsWith(resolve("output") + path.sep), "Report must be inside output");
assert(!fs.existsSync(output), "Never overwrite existing evidence");
fs.mkdirSync(path.dirname(output), { recursive: true });
const result = { status: "RUNNING", scope: "READ_ONLY_EXISTING_EVIDENCE_AND_ARTIFACT_INTEGRITY",
  startedAt: new Date().toISOString(), newProductTests: false, requirements: [], checks: [],
  deferred: ["D-01: user Android<10 device", "D-02: Editor first-open cold performance"],
  limitations: [
    "Historical functional reports apply to their recorded builds, not a new full rerun on today's hash.",
    "Native WebView logical viewport/DPR emulation is not a physical 4K monitor.",
    "Final game exercised a representative original branch, not every authored route.",
    "Audio remains historical user confirmation; no new listening or recording.",
    "Live-model original FAILED is retained; repaired regression replays its recorded proposal.",
    "WebView124/API35 cache warnings are scoped nonblocking, not universally suppressed.",
  ] };
function check(name, fn) {
  const item = { name, status: "RUNNING" }; result.checks.push(item);
  item.evidence = fn(); item.status = "PASS";
}
try {
  for (const [id, file, status, arrays, partial] of specs)
    result.requirements.push({ id, ...group(file, status, arrays, partial) });
  check("Referenced partial reports retain their actual hashes and FAILED/BLOCKED statuses", () => {
    const author = read(specs.find(x => x[0] === "E4-author")[1]).referencedAuthoring;
    const save = read(specs.find(x => x[0] === "Windows-save-closure")[1]).priorPassedEvidence;
    assert.equal(read(author.path).status, "FAILED");
    assert.equal(read(save.path).status, "BLOCKED");
    return [verifyFile(author.path, author.sha256), verifyFile(save.path, save.sha256)];
  });
  check("Current Dev really matches full-build artifact, with no pending replacement", () => {
    const gate = read(specs.find(x => x[0] === "E3-source")[1]);
    assert.equal(gate.dev.pending, false);
    const a = verifyFile(gate.dev.path, gate.dev.sha256);
    const b = verifyFile("editor/src-tauri/target/debug/agentvn-editor.exe", a.sha256);
    assert(!fs.existsSync(resolve("AgentVN Dev.pending.exe")));
    for (const source of gate.sources) verifyFile(source.file, source.sha256);
    return { executable: a, compiled: b, sourceFiles: gate.sources.length };
  });
  check("Three actual installers and their deployed version/runtime bytes", () => {
    const resources = read("output/novel-card-position-release-20261017-01/resources/installer-resource-report.json");
    const install = read("output/novel-card-position-release-20261017-01/actual-installation/actual-installation.json");
    assert.equal(resources.status, "PASS"); assert.equal(install.status, "PASS");
    assert.equal(resources.installers.length, 3); assert.equal(resources.deployments.length, 3);
    const installers = resources.installers.map(v => verifyFile(v.path, v.sha256));
    for (const deployment of resources.deployments) {
      verifyFile(deployment.versionResource.path, deployment.versionResource.sha256);
      assert.equal(read(deployment.versionResource.path).editorVersion, resources.version);
      verifyFile(deployment.executable.path, deployment.executable.sha256);
      for (const runtime of deployment.runtimeProvenance) verifyFile(runtime.path, runtime.sha256);
    }
    return { installers, actualInstallation: verifyFile(install.executable.path, install.executable.sha256) };
  });
  check("Final installed source resources still match recorded, bundled, and current source bytes", () => {
    const run = read(`${finalRoot}/android-device-02/report.json`);
    assert(run.resources.length > 100);
    for (const item of run.resources) {
      verifyFile(item.relative, item.sha256);
      verifyFile(path.join(run.installRoot, item.relative), item.sha256);
    }
    return { resources: run.resources.length, installRoot: run.installRoot };
  });
  check("Terminal evidence links, screenshots/XML and save-byte copies still exist unchanged", () => {
    const files = new Map();
    function walk(value) {
      if (!value || typeof value !== "object") return;
      // This is the retained provenance snapshot, not a promise that successful
      // build-workspace cleanup retained its temporary engine/protocol inputs.
      if (value.versionEvidence && value.sourceCartridge && value.prepackageLayout) return;
      if (typeof value.path === "string" && /^[a-f0-9]{64}$/i.test(value.sha256 || "")
          && !value.path.includes("!/") && !value.cleaned) files.set(value.path, value.sha256);
      if (value.copy && value.sha256) files.set(value.copy, value.sha256);
      for (const child of Object.values(value)) walk(child);
    }
    walk(read(`${finalRoot}/windows-terminal-audit-01.json`).checks);
    walk(read(`${finalRoot}/android-device-02/terminal-audit-01.json`).checks);
    for (const [file, hash] of files) verifyFile(file, hash);
    return { verifiedFiles: files.size };
  });
  check("Final APK actual version, signature evidence, real touch and cleanup", () => {
    const runtime = read(`${finalRoot}/android-device-02/installed-session/android-runtime/runtime-smoke-report.json`);
    assert.equal(runtime.status, "RUNTIME_PASS");
    assert.equal(runtime.isElevated, true);
    assert.equal(runtime.touches.length, 51); assert.equal(runtime.restartTrials.length, 6);
    assert.equal(runtime.layoutChecks.length, 18);
    assert(Object.values(runtime.requiredCoverage).every(v => v === "PASS"));
    assert.equal(runtime.uninstallStatus, "PASS"); assert.equal(runtime.apkCleanupStatus, "PASS");
    assert.equal(runtime.cleanupError, null);
    const terminal = read(`${finalRoot}/android-device-02/terminal-audit-01.json`);
    const provenance = terminal.checks[0].evidence;
    assert.equal(provenance.signature.status, "PASS");
    verifyFile(provenance.apk.path, provenance.apk.sha256);
    verifyFile(provenance.apk.metadata.path, provenance.apk.metadata.sha256);
    const metadata = read(provenance.apk.metadata.path);
    assert.equal(metadata.isElevated, true); assert.equal(metadata.symlinkProbe.success, true);
    assert.equal(metadata.prepackageLayout.sha256, metadata.embeddedLayout.sha256);
    return { apk: provenance.apk, gameVersion: metadata.gameVersion,
      editorVersion: metadata.editorVersion, engineVersion: metadata.engineVersion,
      runtimeProtocolVersion: metadata.runtimeProtocolVersion,
      minimumRuntimeVersion: metadata.minimumRuntimeVersion,
      note: "Original F1 prose says minimum 0.18.0; actual final original-project APK records 0.5.0. Do not rewrite original JSON." };
  });
  check("Authorized cleanup remains selective and all protected file bytes survive", () => {
    const cleanup = read("output/cleanup-audit-20261017-output-01/verification.json");
    const execution = read(cleanup.execution.path), inventory = read(cleanup.inventory.path);
    verifyFile(cleanup.execution.path, cleanup.execution.sha256);
    verifyFile(cleanup.inventory.path, cleanup.inventory.sha256);
    assert.equal(cleanup.deletedDirectories, 488);
    for (const row of execution.rows) if (row.status === "DELETED")
      assert(!fs.existsSync(row.path), `Cache regenerated since cleanup: ${row.path}`);
    for (const file of inventory.protectedFiles) verifyFile(file.path, file.sha256);
    assert.equal(cleanup.userDataDeleted, false);
    return { deletedDirectories: 488, logicalBytes: cleanup.logicalBytesRemoved,
      protectedFiles: inventory.protectedFiles.length, duplicateBuildCopiesDeleted: false };
  });
  result.status = "SCOPED_DELIVERY_EVIDENCE_REVIEW_PASS_WITH_USER_DEFERRALS";
} catch (error) {
  result.status = "FAILED"; result.error = String(error.stack || error);
  const pending = result.checks.find(x => x.status === "RUNNING");
  if (pending) pending.status = "FAILED";
  process.exitCode = 1;
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, requirements: result.requirements.length,
    checks: result.checks.map(x => ({ name: x.name, status: x.status })), output, error: result.error }));
}
