"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = path.resolve(__dirname, "../output/installed-real-model-20261019-01");
const out = path.join(run, "terminal-audit-01.json");
assert(!fs.existsSync(out));
const report = { status: "RUNNING", productConclusion: "FAILED", startedAt: new Date().toISOString(),
  scope: "INDEPENDENT_EVIDENCE_AND_RESTORATION_AUDIT_NOT_A_NEW_PRODUCT_PASS", checks: [], sources: [] };
const read = file => {
  report.sources.push({ path: file, sha256: sha256(fs.readFileSync(file)) });
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
};
const source = name => read(path.join(run, name));
function check(name, operation) {
  try { report.checks.push({ name, status: "PASS", detail: operation() }); }
  catch (e) { report.checks.push({ name, status: "FAILED", error: String(e.message) }); }
}
check("two-real-once-only-http-calls-and-honest-product-classification", () => {
  const transport = read("F:/AgentVN-QA-InstalledRealModel-20261019-01/model-transport/http-accounting.json");
  assert.equal(transport.attempts.length, 2); assert.equal(transport.automaticRetries, 0);
  const results = ["existing-control-01", "new-component-01"].map((dir, i) => {
    const raw = source(`${dir}/report.json`), intent = source(`${dir}/submission-intent.json`);
    assert.equal(raw.requests.length, 1); assert.equal(raw.process.status, "failed");
    assert.equal(raw.process.errorCode, "provider_error"); assert.equal(raw.process.toolEvents.length, 0);
    const request = transport.attempts[i];
    assert.equal(request.httpStatus, 200); assert.equal(request.status, "SUCCEEDED");
    assert.equal(request.requestSha256, request.forwardedRequestSha256);
    assert.equal(request.responseSha256, request.forwardedResponseSha256);
    return { task: intent.task, processId: raw.process.id, productStatus: "FAILED",
      originalRawStatusPreserved: raw.status, requests: 1, tokens: request.usage.total_tokens,
      reviewMergeReopenExport: "NOT_RUN_DEPENDENT_ON_FAILED_AGENT",
      reason: raw.process.errorMessage };
  });
  assert.equal(results.reduce((n, a) => n + a.tokens, 0), 6456);
  return results;
});
check("twelve-real-webview-parameter-and-native-pixel-proofs", () => {
  const probe = source("native-entry-motion-probe-02/report.json");
  assert.equal(probe.status, "FAILED"); assert.equal(probe.error, null);
  assert.equal(probe.novelEntry.length, 12); assert.equal(probe.motion.length, 36);
  assert.equal(probe.screenshots.length, 12); assert.equal(probe.modelSubmissions, 0);
  const combinations = new Set(probe.novelEntry.map(c => [c.width,c.height,c.dpr,c.reduced].join("/")));
  assert.equal(combinations.size, 12);
  assert(probe.novelEntry.every(c => c.status === "FAILED" && !c.entry[0].hit
    && c.entry[0].hiddenAncestors.some(a => a.display === "none") && c.visibleAlternativesInAI === 0));
  for (const s of probe.screenshots) {
    assert.equal(sha256(fs.readFileSync(s.path)), s.sha256);
    assert.deepEqual(s.before, s.after);
    assert.equal(s.png.width, s.before.width * s.before.dpr);
    assert.equal(s.png.height, s.before.height * s.before.dpr);
  }
  // Raw RAF callbacks can share a timestamp. Count distinct rendered timestamps,
  // not callbacks, and do not call sampled wall-clock duration animation time.
  const uniqueFrames = probe.motion.map(c => {
    assert.equal(c.status, "PASS"); assert.equal(c.settledGeometryDelta, 0);
    const count = new Set(c.frames.map(f => f.time)).size;
    assert(count > 1);
    return { viewport: `${c.width}x${c.height}`, dpr: c.dpr, reduced: c.reduced,
      target: c.target, distinctRafTimestamps: count, rawCallbacks: c.frames.length };
  });
  return { actualInstalledWebviewEmulationNotPhysical4K: true, novelEntry: "FAILED",
    novelModel: "NOT_RUN", navigationSettledGeometryOnly: "PASS",
    screenshotMotionIssue: "NOT_YET_REPRODUCED_OR_FIXED", uniqueFrames };
});
check("failed-work-no-merge-and-isolated-key-cleaned", () => {
  const close = source("live-closeout.json"), clean = source("private-cleanup.json");
  assert.equal(close.status, "PASS"); assert.equal(clean.status, "PASS");
  assert(close.endpointRestored && close.isolatedCredentialCleared);
  assert(clean.isolatedDatabase.vacuumAndWalTruncation);
  return { noMergeChecks: 2, noKeyValuesReadOrReported: true, isolatedDatabaseVacuumed: true };
});
check("attributed-process-stop-not-normal-close", () => {
  const stop = source("attributed-stop-01.json");
  assert.equal(stop.status, "PASS"); assert.equal(stop.normalWindowClose, "NOT_RUN");
  assert.equal(stop.before.length, 3); assert.equal(stop.after.length, 0);
  return { ownedProcesses: 3, normalClose: "NOT_RUN", relayStopped: true };
});
check("four-original-profiles-55-independent-byte-checks", () => {
  const prep = source("preparation.json"), restore = source("profile-restoration.json");
  assert.equal(restore.status, "PASS");
  let count = 0;
  for (const p of prep.profiles) {
    assert(!fs.existsSync(p.held));
    for (const f of p.files) {
      assert.equal(sha256(fs.readFileSync(path.join(p.original, f.relative))), f.sha256);
      assert.equal(sha256(fs.readFileSync(f.backup)), f.sha256); count++;
    }
  }
  assert.equal(count, 55); return { profiles: 4, files: count };
});
check("frozen-560-product-sources-installed-exe-and-dev-still-unchanged", () => {
  const frozen = read(path.resolve(__dirname, "../output/full-regression-20261017-01/candidate-02/manifest.json"));
  assert.equal(frozen.source.length, 560);
  for (const f of frozen.source) assert.equal(sha256(fs.readFileSync(f.path)), f.sha256);
  const dev = "D:/AgentVN/AgentVN Dev.exe";
  assert.equal(sha256(fs.readFileSync(dev)), "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
  const exe = "F:/AgentVN-QA-HostUpgrade-20261018-02/installed-editor/agentvn-editor.exe";
  assert.equal(sha256(fs.readFileSync(exe)), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
  return { sourceFiles: 560, newProductBuilds: 0, frozenCandidate: "1.9.9" };
});
check("no-owned-agentvn-processes-or-four-listeners", () => {
  const data = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "$rows=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});$ports=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(8278,64184,64185,63950)});@{processCount=$rows.Count;listenerCount=$ports.Count}|ConvertTo-Json"],
  { windowsHide: true, encoding: "utf8" }));
  assert.equal(data.processCount, 0); assert.equal(data.listenerCount, 0); return data;
});
report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
report.finishedAt = new Date().toISOString();
fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify(report));
if (report.status !== "PASS") process.exitCode = 1;
