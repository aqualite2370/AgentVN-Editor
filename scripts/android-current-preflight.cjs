"use strict";
// QA preparation and independent audit. No Android build or UI pass is inferred.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Android-Package-20261021-01";
const out = path.join(qa, "preflight-01");
const checkpoint = "F:/AgentVN/Checkpoints/Android-Package-20261021-01";
const mode = process.argv[2]; assert(["prepare", "audit"].includes(mode));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const tools = ["scripts/android-current-preflight.cjs", "scripts/android-current-admin-gate.ps1",
  "scripts/android-acceptance-preflight.ps1"];
const scope = "ANDROID_PERMISSION_GATE_ONLY_NOT_BUILD_OR_DEVICE";
if (mode === "prepare") {
  assert(!fs.existsSync(out) && !fs.existsSync(checkpoint), "Fresh immutable preflight required");
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const report = { status: "RUNNING", scope, startedAt: new Date().toISOString(),
    tools: tools.map(t => desc(path.join(root, t))), protected: [], snapshots: [],
    symlinkTool: desc(path.join(root, tools[2])), apkBuilds: 0, apkInstalls: 0, modelRequests: 0 };
  try {
    for (const relative of [...tools, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
      const source = path.join(root, relative), target = path.join(checkpoint, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target)); report.snapshots.push(desc(target));
    }
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"),
      execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }),
      { flag: "wx" });
    for (const f of [".git/index", "AgentVN Dev.exe", "editor/src/app/App.tsx",
      "editor/src/app/App.css", "editor/src/styles/editor-tokens.css", "GameCli_framework/src/styles/shell.css"])
      report.protected.push(desc(path.join(root, f)));
    report.protected.push(desc("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"));
    report.candidate = read("F:/AgentVN/QA/MSI-Location-Repair-20261021-01/payload-01/report.json").archived;
    assert.equal(report.candidate.length, 3);
    for (const f of report.candidate) assert.equal(sha(f.path), f.sha256);
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, scope, out, checkpoint, error: report.error }));
} else {
  const dest = path.join(out, "audit-01.json"); assert(!fs.existsSync(dest));
  const prep = read(path.join(out, "preparation.json"));
  const request = read(path.join(out, "admin-request.json"));
  const result = read(path.join(out, "admin-result.json"));
  const report = { status: "RUNNING", scope, at: new Date().toISOString(), groups: [], sources: [] };
  function group(name, check) {
    const row = { name, status: "RUNNING" }; report.groups.push(row);
    try { row.detail = check(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  }
  try {
    group("Actual non-admin origin and completed same-user elevated helper, no APK operations", () => {
      assert.equal(prep.status, "PASS"); assert.equal(request.status, "PASS");
      assert.equal(request.originIsElevated, false); assert(request.finishedAt);
      assert.equal(result.status, "PASS"); assert.equal(result.isElevated, true);
      assert.equal(request.helperPid, result.processId); assert.equal(request.userSid, result.userSid);
      assert.equal(request.originProcessId, result.originProcessId);
      assert.notEqual(request.originProcessId, result.processId);
      assert.equal(result.scope, scope); assert(result.finishedAt); assert(!result.error);
      assert(Date.parse(result.startedAt) >= Date.parse(request.requestedAt));
      for (const key of ["apkBuilds", "apkInstalls", "modelRequests"]) assert.equal(result[key], 0);
      return { origin: request.originProcessId, elevated: result.processId };
    });
    group("Successful fresh administrator symlink and exact temporary-probe cleanup", () => {
      const probe = read(path.join(out, "permission/acceptance-permission.json"));
      assert.deepEqual(probe, result.probe); assert(probe.success && probe.isElevated);
      assert.equal(result.exitCode, 0); assert(!probe.error);
      assert.equal(path.dirname(path.resolve(probe.probeRoot)), path.resolve(out, "permission"));
      assert(!fs.existsSync(probe.probeRoot)); return probe;
    });
    group("Original products, database, index and prepared tool bytes remain unchanged", () => {
      for (const f of [...prep.protected, ...prep.candidate, ...prep.tools, ...prep.snapshots])
        assert.equal(sha(f.path), f.sha256, f.path);
      return { protected: prep.protected.length, tools: prep.tools.length, candidates: prep.candidate.length };
    });
    for (const name of ["preparation.json", "admin-request.json", "admin-result.json",
      "permission/acceptance-permission.json"]) report.sources.push(desc(path.join(out, name)));
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, scope, groups: report.groups, error: report.error }));
}
