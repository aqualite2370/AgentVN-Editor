"use strict";
// Wait for exactly the existing matrix, then build and test this one repair.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { rows } = require("./lib/current-native-editor-session.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const [attempt = "01", nativeAttempt = attempt, checkpointAttempt = attempt] = process.argv.slice(2);
assert.match(attempt, /^\d{2}$/); assert.match(nativeAttempt, /^\d{2}$/);
assert.match(checkpointAttempt, /^\d{2}$/);
const base = "F:/AgentVN/QA/Android-Exit-20261024-01", out = path.join(base, "followup-" + attempt);
const matrixFile = path.join(base, `matrix-${attempt}/report.json`), original = read(matrixFile);
assert(!fs.existsSync(out)); assert(!fs.existsSync(path.join(base, "build-" + attempt)));
const live = rows().filter(p => p.Name === "node.exe" && (p.CommandLine || "").includes(
  `scripts/android-exit-stage-gates.cjs matrix ${attempt}`));
assert(original.finishedAt || live.length === 1, "Require the actual live matrix identity, not a lock/status file");
fs.mkdirSync(out);
const r = { status: "WAIT_SAME_MATRIX", startedAt: new Date().toISOString(), matrixStartedAt: original.startedAt,
  owner: live[0] && { pid: live[0].ProcessId, created: live[0].Created }, commands: [], checkpointAttempt,
  modelRequests: 0, tools: [__filename, path.resolve("scripts/android-exit-stage-gates.cjs"),
    path.resolve("scripts/android-exit-desktop-native.cjs"), path.resolve("scripts/lib/dev-narrative-player.cjs")].map(fileEvidence) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
async function command(label, args) {
  const c = { label, command: [process.execPath, ...args], status: "RUNNING", log: path.join(out, label + ".log"),
    startedAt: new Date().toISOString() }; r.commands.push(c); save();
  const fd = fs.openSync(c.log, "wx");
  try {
    const child = spawn(process.execPath, args, { cwd: path.resolve(__dirname, ".."),
      windowsHide: true, stdio: ["ignore", fd, fd] });
    c.pid = child.pid; save();
    c.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(c.exitCode, 0, c.log); c.status = "PASS";
  } catch (e) { c.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); c.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(c)); }
}
(async () => {
  save();
  while (true) {
    const m = read(matrixFile); assert.equal(m.startedAt, r.matrixStartedAt);
    if (m.finishedAt) {
      assert.equal(m.status, "PASS"); assert.equal(m.totalCases, 24);
      assert.equal(m.commands.length, 4); assert(m.commands.every(c => c.status === "PASS" && c.exitCode === 0));
      r.matrix = fileEvidence(matrixFile); break;
    }
    assert(rows().some(p => p.ProcessId === r.owner.pid && p.Created === r.owner.created),
      "Original matrix disappeared without terminal evidence; do not restart it");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  for (const f of r.tools) assert.equal(fileEvidence(f.path).sha256, f.sha256);
  r.status = "BUILDING"; save();
  await command("build", ["scripts/android-exit-stage-gates.cjs", "build", attempt, attempt, checkpointAttempt]);
  r.status = "NATIVE_DESKTOP"; save();
  await command("native-preparation", ["scripts/android-exit-desktop-native.cjs", nativeAttempt, attempt, "--validate-only"]);
  await command("native-desktop", ["scripts/android-exit-desktop-native.cjs", nativeAttempt, attempt]);
  for (const f of r.tools) assert.equal(fileEvidence(f.path).sha256, f.sha256);
  r.status = "SOURCE_BUILD_DESKTOP_PASS_ANDROID_NOT_RUN";
})().catch(e => { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error })); });
