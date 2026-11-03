"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = path.join(root, "output/role-geometry-source-20261020-01/cleanup-02.json"); assert(!fs.existsSync(out));
const qa = "F:/AgentVN/QA/Role-Geometry-Source-20261020-02";
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const receipt = read(path.join(root, "output/role-geometry-source-20261020-01/receipt.json"));
const editor = read(path.join(qa, "build-01/editor-role-preview/report.json"));
const services = [...receipt.checks.at(-1).detail.services, editor.server];
const pids = services.map(s => s.pid), ports = services.map(s => +new URL(s.url).port);
const ps = `$taskPids = @(${pids.join(",")}); $taskPorts = @(${ports.join(",")}); ` +
  `$live = @(Get-Process -Id $taskPids -ErrorAction SilentlyContinue | Select-Object Id,ProcessName); ` +
  `$listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $taskPorts -contains $_.LocalPort } | Select-Object LocalPort,OwningProcess); ` +
  `$backends = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^python(w)?\\.exe$' -and $_.CommandLine -like '*backend_launcher.py*' } | Select-Object ProcessId,ParentProcessId,ExecutablePath); ` +
  `@{ liveOwnedPids=$live; listeningOwnedPorts=$listening; currentBackendLaunchers=$backends } | ConvertTo-Json -Depth 5 -Compress`;
const report = { at: new Date().toISOString(), status: "RUNNING", services,
  scope: "Supplement includes Editor Vite and port snapshot; old Editor runner did not record individual Python backend PID",
  individualBackendPidProvenance: "NOT_RECORDED_BY_EXISTING_RUNNER" };
try {
  report.actual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", ps],
    { windowsHide: true, encoding: "utf8" }));
  assert.equal(report.actual.liveOwnedPids.length, 0);
  assert.equal(report.actual.listeningOwnedPorts.length, 0);
  assert.equal(report.actual.currentBackendLaunchers.length, 0);
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, ownedPids: pids.length, ownedPorts: ports.length, out, error: report.error }));
}
