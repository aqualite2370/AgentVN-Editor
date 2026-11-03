"use strict";
// Read-only postcondition audit after the recorded clone-state continuation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const [priorArg, outArg] = process.argv.slice(2);
assert(priorArg && outArg && !fs.existsSync(outArg), "Pass continuation report and fresh evidence path");
const prior = JSON.parse(fs.readFileSync(priorArg, "utf8"));
const cli = "C:/Program Files/Oracle/VirtualBox/VBoxManage.exe";
assert.equal(prior.clone, "bb73ce25-e07d-4810-926f-e8a88da40527");
assert(prior.cloneRecovery && prior.sourceSerialization.exitCode === 0);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  previous: path.resolve(priorArg), commands: [], scope: "CLONE_ISOLATION_ONLY_NOT_GUEST_ACCEPTANCE" };
const run = args => {
  const text = execFileSync(cli, args, { encoding: "utf8", windowsHide: true });
  report.commands.push({ args, stdout: text }); return text;
};
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
(async () => {
  const clone = run(["showvminfo", prior.clone, "--machinereadable"]);
  assert.match(clone, /VMState="poweroff"/);
  const config = JSON.parse(clone.match(/^CfgFile=(.+)$/m)[1]);
  assert.equal(path.dirname(path.resolve(config)),
    path.resolve("F:/WinENV/AgentVN-QA/AgentVN-Full-Regression-20261017-01"));
  assert.equal(await hash(prior.cloneRecovery.path), prior.cloneRecovery.sha256);
  assert.equal(await hash(prior.original.config), prior.original.configSha256);
  assert.equal(await hash(prior.original.state), prior.original.stateSha256);
  assert.match(run(["showvminfo", prior.source, "--machinereadable"]), /VMState="saved"/);
  report.clone = { uuid: prior.clone, config, shares: [], state: "poweroff",
    recovery: prior.cloneRecovery };
  report.original = { ...prior.original, unchangedSinceContinuation: true,
    configSerializationOnly: prior.sourceSerialization };
  report.clone.shares = [...clone.matchAll(/^SharedFolder(?:Name|Path)[^\r\n]+/gm)]
    .map(match => match[0]);
  report.sourcePreservationStatus = "PASS";
  report.environmentStatus = report.clone.shares.length ? "BLOCKED" : "PASS";
  assert(!/^SharedFolderPath/gm.test(clone), "Developer global share still present; no per-VM share to remove");
  report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(outArg, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out: outArg, error: report.error }));
});
