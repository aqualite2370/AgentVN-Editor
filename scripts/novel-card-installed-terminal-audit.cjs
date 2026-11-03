"use strict";
// Read-only evidence and owned-process audit; never changes prior results.
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const A = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 6, "node script <release-root> <crash-root> <installed-flow-root> <fresh-audit-file>");
const [releaseRoot, crashRoot, flowRoot, target] = process.argv.slice(2).map(p => path.resolve(p));
const root = path.resolve(__dirname, "..");
for (const file of [releaseRoot, crashRoot, flowRoot, target]) assert(A.inside(path.join(root, "output"), file));
assert(!fs.existsSync(target));
const inputs = [releaseRoot, crashRoot, flowRoot].map(directory => {
  const file = path.join(directory, "report.json"), bytes = fs.readFileSync(file);
  return { file, sha256: A.sha256(bytes), value: JSON.parse(bytes) };
});
const report = { status: "RUNNING", scope: "CARD_POSITION_ACTUAL_INSTALLATION_AND_OWNED_CLEANUP_NOT_RUNTIME_EXPORT",
  startedAt: new Date().toISOString(), inputs: inputs.map(({ value, ...identity }) => identity), cases: [] };
async function portClosed(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", error => { socket.destroy(); error.code === "ECONNREFUSED" ? resolve(true) : reject(error); });
    socket.setTimeout(1000, () => { socket.destroy(); reject(Error(`Unknown port cleanup state: ${port}`)); });
  });
}
(async () => {
  const [release, crash, flow] = inputs.map(item => item.value);
  assert.equal(release.status, "INSTALLED_RUNTIME_WEBVIEW_RELEASE_READY");
  assert.equal(crash.status, "PASS"); assert.equal(crash.requireCommit, true);
  assert.equal(crash.cases.length, 4); assert(crash.cases.every(c => c.status === "PASS"));
  assert.deepEqual(crash.errors, []); assert.deepEqual(crash.forbiddenRequests, []);
  assert.equal(flow.status, "PASS"); assert.equal(flow.cases.length, 8);
  assert(flow.cases.every(c => c.status === "PASS"));
  assert.equal(flow.sourceUnchanged, true); assert.equal(flow.portCleanup.status, "PASS");
  assert.deepEqual(flow.errors, []); assert.deepEqual(flow.forbiddenRequests, []);
  const exe = release.installation.executable;
  assert.equal(A.sha256(fs.readFileSync(exe.path)), exe.sha256);
  for (const launch of [...crash.launches, ...flow.launches]) assert.equal(launch.exeSha256, exe.sha256);
  const auditFile = path.join(releaseRoot, "actual-installation/installer-resource-report.json");
  assert.equal(A.sha256(fs.readFileSync(auditFile)), crash.audit.sha256);
  assert.equal(A.sha256(fs.readFileSync(path.join(flowRoot, "installer-resource-report.json"))), crash.audit.sha256);
  report.cases.push({ name: "same-new-installation-native-crash-and-eight-real-flows", status: "PASS" });
  // The durable position was subsequently reset by the test; verify the
  // preserved original bytes and the final tombstone separately.
  const preserved = path.join(crashRoot, "preserved-before-controlled-path-block.json");
  assert.equal(A.sha256(fs.readFileSync(preserved)), crash.nativeAfterCrash.sha256);
  assert.deepEqual(JSON.parse(fs.readFileSync(crash.resetAfterCrash.file)), crash.resetAfterCrash.tombstone);
  assert.equal(crash.resetAfterCrash.tombstone.position, null);
  assert.deepEqual(crash.trigger.profile, crash.restored.profile);
  report.cases.push({ name: "native-commit-original-bytes-and-final-reset-evidence", status: "PASS" });
  assert.equal(flow.matrix.length, 12);
  const unique = new Set();
  for (const row of flow.matrix) {
    const expected = { width: row.width, height: row.height, dpr: row.dpr, reduced: row.reduced };
    unique.add(JSON.stringify(expected));
    assert.equal(row.status, "PASS"); assert.deepEqual(row.actualBefore, expected); assert.deepEqual(row.actualAfter, expected);
    const shot = row.screenshot, png = fs.readFileSync(shot.path);
    assert.equal(A.sha256(png), shot.sha256);
    assert.deepEqual(shot.before, expected); assert.deepEqual(shot.after, expected);
    assert.equal(png.readUInt32BE(16), row.width * row.dpr);
    assert.equal(png.readUInt32BE(20), row.height * row.dpr);
  }
  assert.equal(unique.size, 12);
  report.cases.push({ name: "twelve-actual-dpr-media-matrices-and-native-png-pixels", status: "PASS" });
  const launches = [...crash.launches, ...flow.launches];
  const pids = [...new Set(launches.flatMap(l => [l.editorPid, l.backendPid]))];
  assert(pids.length > 0 && pids.every(p => Number.isSafeInteger(p) && p > 0));
  const processes = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$ids=@(${pids.join(",")}); @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8", timeout: 15000 });
  assert.equal(processes.status, 0, processes.stderr);
  assert.equal(processes.stdout.trim(), "", "A reported owned process remains alive");
  const ports = [...new Set(launches.flatMap(l => [l.backendPort, l.cdpPort]))];
  assert(ports.length > 0 && ports.every(p => Number.isSafeInteger(p) && p > 0 && p < 65536));
  assert((await Promise.all(ports.map(portClosed))).every(Boolean), "An owned endpoint is still listening");
  report.cleanup = { status: "PASS", pids, ports,
    note: "Bootstrap taskkill 128 is retained in the crash report; independent PID/port checks confirm it already exited normally." };
  report.cases.push({ name: "owned-editor-backend-pids-and-ports-fully-exited", status: "PASS" });
  for (const input of inputs) assert.equal(A.sha256(fs.readFileSync(input.file)), input.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, target, cases: report.cases.length, error: report.error }));
  });
