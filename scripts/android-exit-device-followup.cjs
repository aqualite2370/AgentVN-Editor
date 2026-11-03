"use strict";
// Continue exactly the already-started elevated build; never start/retry a build.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const base = "F:/AgentVN/QA/Android-Exit-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const buildRoot = path.join(base, "apk-build-02"), out = path.join(base, "device-followup-01");
assert(!fs.existsSync(out)); assert(!fs.existsSync(path.join(base, "device-01")));
const original = read(path.join(buildRoot, "administrator.json"));
assert(original.isElevated && original.permission.isElevated && original.permission.success);
assert(original.finishedAt || rows().some(p => p.ProcessId === original.processId && p.Created === original.created));
fs.mkdirSync(out);
const r = { status: "WAIT_SAME_ELEVATED_BUILD", startedAt: new Date().toISOString(), modelRequests: 0,
  owner: { pid: original.processId, created: original.created, startedAt: original.startedAt },
  tools: [__filename, path.resolve("scripts/android-exit-device.cjs"),
    path.resolve("scripts/android-exit-device.ps1")].map(fileEvidence), commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
(async () => {
  save();
  while (true) {
    const receipt = read(path.join(buildRoot, "administrator.json"));
    assert.equal(receipt.processId, r.owner.pid); assert.equal(receipt.created, r.owner.created);
    assert.equal(receipt.startedAt, r.owner.startedAt);
    if (receipt.finishedAt) {
      assert.equal(receipt.status, "SOURCE_APKS_BUILT_DEVICE_NOT_RUN"); assert.equal(receipt.exitCode, 0);
      const build = read(path.join(buildRoot, "build-report.json"));
      assert.equal(build.status, "SOURCE_APKS_BUILT_DEVICE_NOT_RUN"); assert.equal(build.cells.length, 2);
      assert(build.cells.every(c => c.status === "PASS"));
      r.build = fileEvidence(path.join(buildRoot, "build-report.json")); break;
    }
    assert(rows().some(p => p.ProcessId === r.owner.pid && p.Created === r.owner.created),
      "Same helper disappeared without a terminal receipt; do not restart");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  for (const t of r.tools) assert.equal(fileEvidence(t.path).sha256, t.sha256);
  const c = { command: [process.execPath, "scripts/android-exit-device.cjs", "launch", "01", "02"],
    status: "RUNNING", log: path.join(out, "device.log"), startedAt: new Date().toISOString() };
  r.commands.push(c); r.status = "REAL_DEVICE_RUNNING"; save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(process.execPath, c.command.slice(1), { cwd: path.resolve(__dirname, ".."),
      windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, c.log); c.status = "PASS";
  } finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); }
  r.device = fileEvidence(path.join(base, "device-01/runtime/report.json"));
  assert.equal(read(r.device.path).status, "PASS_LIMITED_EXIT_AND_RESTART");
  for (const t of r.tools) assert.equal(fileEvidence(t.path).sha256, t.sha256);
  r.status = "LIMITED_SOURCE_ANDROID_EXIT_RESTART_PASS_AUDIT_PENDING";
})().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, out, error: r.error })); });
