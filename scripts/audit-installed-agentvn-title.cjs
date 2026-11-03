"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { validateInstalledDefaultTitle } = require("./lib/installed-agentvn-title-prerequisite.cjs");
const { sha256 } = require("./lib/installed-acceptance.cjs");
assert.equal(process.argv.length, 4, "node script <Windows-title-report> <fresh-audit-output.json>");
const file = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]);
assert(!fs.existsSync(output));
const originalHash = sha256(fs.readFileSync(file)), r = JSON.parse(fs.readFileSync(file, "utf8"));
const audit = { status: "RUNNING", scope: "Read-only installed title identity, actual evidence and owned-process terminal audit",
  report: { path: file, sha256: originalHash }, cases: [] };
try {
  const verification = validateInstalledDefaultTitle(file, { auditFile: r.installationAudit.path, fixture: r.fixture });
  audit.verification = verification; audit.cases.push({ name: "installation/export/title bytes and 12 actual parameter combinations", status: "PASS" });
  const owned = [{ pid: r.owner.editorPid, port: r.owner.cdpPort }, { pid: r.owner.backendPid, port: r.owner.backendPort },
    ...r.processes.map(p => ({ pid: p.pid, port: p.port }))];
  const ids = owned.map(p => p.pid), ports = owned.map(p => p.port);
  const query = `$taskPids = @(${ids.join(",")}); $taskPorts = @(${ports.join(",")}); ` +
    `$active = @(Get-CimInstance Win32_Process | Where-Object { $taskPids -contains $_.ProcessId } | Select-Object ProcessId,Name,ExecutablePath,CreationDate); ` +
    `$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $taskPorts -contains $_.LocalPort } | Select-Object LocalPort,OwningProcess); ` +
    `[pscustomobject]@{processes=$active;listeners=$listeners} | ConvertTo-Json -Depth 5 -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", query], { windowsHide: true, encoding: "utf8",
    timeout: 60000, env: { ...process.env,
      PSModulePath: "C:\\Users\\1\\Documents\\WindowsPowerShell\\Modules;C:\\Program Files\\WindowsPowerShell\\Modules;C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\Modules" } });
  assert.equal(result.status, 0, result.stderr);
  audit.terminal = JSON.parse(result.stdout); audit.owned = owned;
  assert.deepEqual(audit.terminal.processes, [], "Owned PID remains or requires identity review");
  assert.deepEqual(audit.terminal.listeners, [], "Owned port remains or requires identity review");
  audit.cases.push({ name: "14 owned PIDs and ports have no remaining process/listener", status: "PASS" });
  assert.equal(sha256(fs.readFileSync(file)), originalHash);
  audit.cases.push({ name: "original report unchanged", status: "PASS" }); audit.status = "PASS";
} catch (error) { audit.status = "FAILED"; audit.error = String(error.stack || error); process.exitCode = 1; }
finally {
  audit.checkedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(audit, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: audit.status, output, error: audit.error }));
}
