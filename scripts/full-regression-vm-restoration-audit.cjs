"use strict";
// Recovery is deliberately separate: never overwrite an earlier failed cleanup.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const [sessionArg, outArg] = process.argv.slice(2);
assert(sessionArg && outArg && !fs.existsSync(outArg));
const prior = JSON.parse(fs.readFileSync(path.join(sessionArg, "report.json"), "utf8"));
assert.equal(prior.clone, "bb73ce25-e07d-4810-926f-e8a88da40527");
assert.equal(prior.source, "9215edc0-b3a5-43fe-80bf-888b3b1ef97e");
assert.deepEqual(prior.originalShares, [{
  name: "AgentVN", hostPath: "D:\\AgentVN", writable: "true", autoMount: "true",
}]);
const cli = "C:/Program Files/Oracle/VirtualBox/VBoxManage.exe";
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  session: path.resolve(sessionArg), commands: [], guestAcceptanceStatus: "BLOCKED",
  reason: "Both CLI and manager fail in VirtualBox before reaching the guest",
  sourcePreservationStatus: "NOT_RUN", restorationStatus: "NOT_RUN" };
function run(args) {
  const result = spawnSync(cli, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
  report.commands.push({ args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
function readShares() {
  return [...fs.readFileSync("C:/Users/1/.VirtualBox/VirtualBox.xml", "utf8")
    .matchAll(/<SharedFolder\s+([^>]+?)\/>/g)].map(match =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(item => [item[1], item[2]]))).sort((a, b) => a.name.localeCompare(b.name));
}
(async () => {
  assert.equal(run(["list", "runningvms"]).trim(), "");
  assert.match(run(["showvminfo", prior.clone, "--machinereadable"]), /VMState="poweroff"/);
  report.beforeShares = readShares();
  if (!report.beforeShares.some(item => item.name === "AgentVN")) {
    run(["sharedfolder", "add", "global", "--name=AgentVN",
      "--hostpath=D:\\AgentVN", "--automount"]);
    report.recoveryAction = "RESTORED_ABSENT_APPROVED_SHARE";
  } else report.recoveryAction = "INDEPENDENT_VERIFICATION_ONLY";
  report.afterShares = readShares();
  assert.deepEqual(report.afterShares, prior.originalShares);
  report.restorationStatus = "PASS";
  const processes = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "@(Get-CimInstance Win32_Process -Filter \"Name='VirtualBoxVM.exe' OR Name='VBoxHeadless.exe'\" | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress"],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(processes.status, 0, processes.stderr);
  report.vmProcesses = processes.stdout.trim() ? JSON.parse(processes.stdout) : [];
  assert.deepEqual(report.vmProcesses, [], "VM runtime process remains after failed startup");
  assert.match(run(["showvminfo", prior.source, "--machinereadable"]), /VMState="saved"/);
  report.source = {
    configSha256: await hash(prior.original.config),
    stateSha256: await hash(prior.original.state),
  };
  assert.equal(report.source.configSha256, prior.original.configSha256);
  assert.equal(report.source.stateSha256, prior.original.stateSha256);
  report.sourcePreservationStatus = "PASS";
  report.dev = { path: "D:/AgentVN/AgentVN Dev.exe",
    sha256: await hash("D:/AgentVN/AgentVN Dev.exe") };
  assert.equal(report.dev.sha256, "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(outArg, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
});
