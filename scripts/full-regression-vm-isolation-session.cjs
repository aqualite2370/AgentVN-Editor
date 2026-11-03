"use strict";
// Bounded QA-only lease: restore the approved global share after saving the clone.
// No product changes, source-VM startup, credential entry, or guest installation.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const cli = "C:/Program Files/Oracle/VirtualBox/VBoxManage.exe";
const source = "9215edc0-b3a5-43fe-80bf-888b3b1ef97e";
const clone = "bb73ce25-e07d-4810-926f-e8a88da40527";
const [action, outArg, secondsArg = "480", launchMode = "cli"] = process.argv.slice(2);
assert(["open", "close"].includes(action) && outArg,
  "Use open <fresh-evidence-directory> [seconds] or close <same-directory>");
const out = path.resolve(outArg);
const allowed = path.resolve("D:/AgentVN/output/full-regression-20261017-01") + path.sep;
assert(out.startsWith(allowed), "Evidence must stay within the current run");
if (action === "close") {
  const prior = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
  assert.equal(prior.clone, clone);
  assert.equal(prior.status, "RUNNING");
  fs.writeFileSync(path.join(out, "close-request.json"),
    JSON.stringify({ requestedAt: new Date().toISOString() }), { flag: "wx" });
  console.log("Close requested; wait for restorationStatus=PASS in report.json");
  return;
}
const seconds = Number(secondsArg);
assert(Number.isInteger(seconds) && seconds >= 30 && seconds <= 900);
assert(["cli", "manager"].includes(launchMode));
assert(!fs.existsSync(out), "Never overwrite an earlier attempt");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "TINY11_ISOLATION_BOOT_ONLY_NOT_PRODUCT_ACCEPTANCE",
  startedAt: new Date().toISOString(), source, clone, pid: process.pid,
  maxSessionSeconds: seconds, launchMode, commands: [], isolationStatus: "NOT_RUN",
  restorationStatus: "NOT_RUN", sourcePreservationStatus: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function run(args, timeout = 60000) {
  const result = spawnSync(cli, args, { encoding: "utf8", windowsHide: true, timeout });
  report.commands.push({ at: new Date().toISOString(), args, exitCode: result.status,
    stdout: result.stdout, stderr: result.stderr, error: result.error ? String(result.error) : null });
  save();
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
function field(text, key) {
  const raw = text.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1];
  assert(raw, `Missing ${key}`);
  return key === "VMStateFile" ? raw.slice(1, -1) : JSON.parse(raw);
}
function shares(xml) {
  return [...xml.matchAll(/<SharedFolder\s+([^>]+?)\/>/g)].map(match =>
    Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)]
      .map(attribute => [attribute[1], attribute[2]])))
    .sort((a, b) => a.name.localeCompare(b.name));
}
async function hash(file) {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
let removed = false;
let stopRequested = false;
process.on("SIGINT", () => { stopRequested = true; });
process.on("SIGTERM", () => { stopRequested = true; });
save();
(async () => {
  const globalConfig = "C:/Users/1/.VirtualBox/VirtualBox.xml";
  const xml = fs.readFileSync(globalConfig, "utf8");
  report.originalShares = shares(xml);
  const target = report.originalShares.find(item => item.name === "AgentVN");
  // Reject unknown settings instead of restoring guessed defaults.
  assert.deepEqual(target, {
    name: "AgentVN", hostPath: "D:\\AgentVN", writable: "true", autoMount: "true",
  });
  fs.copyFileSync(globalConfig, path.join(out, "global-before.xml"), fs.constants.COPYFILE_EXCL);
  report.restoreCommand = [cli, "sharedfolder", "add", "global",
    "--name=AgentVN", "--hostpath=D:\\AgentVN", "--automount"];
  assert.equal(run(["list", "runningvms"]).trim(), "", "Another VM is running; do not change global sharing");
  const original = run(["showvminfo", source, "--machinereadable"]);
  assert.equal(field(original, "VMState"), "saved");
  report.original = {
    config: field(original, "CfgFile"), state: field(original, "VMStateFile"),
  };
  report.original.configSha256 = await hash(report.original.config);
  report.original.stateSha256 = await hash(report.original.state);
  const before = run(["showvminfo", clone, "--machinereadable"]);
  assert(["poweroff", "saved"].includes(field(before, "VMState")));
  assert.equal(field(before, "UUID"), clone);
  assert.equal(path.dirname(path.resolve(field(before, "CfgFile"))),
    path.resolve("F:/WinENV/AgentVN-QA/AgentVN-Full-Regression-20261017-01"));
  save();
  run(["sharedfolder", "remove", "global", "--name=AgentVN"]);
  removed = true;
  const isolated = run(["showvminfo", clone, "--machinereadable"]);
  assert(!/^SharedFolderPath/gm.test(isolated), "Clone still has a host-folder mapping");
  assert(!shares(fs.readFileSync(globalConfig, "utf8")).some(item => item.name === "AgentVN"));
  report.isolationStatus = "PASS";
  if (launchMode === "cli") {
    run(["startvm", clone, "--type=gui"]);
    report.bootStartedAt = new Date().toISOString();
  }
  report.deadline = new Date(Date.now() + seconds * 1000).toISOString();
  save();
  console.log(JSON.stringify({ phase: launchMode === "cli"
    ? "CLONE_BOOTED_SHARE_DISABLED" : "SHARE_DISABLED_AWAIT_MANAGER_START", out,
    deadline: report.deadline, close: ["node", __filename, "close", out] }));
  while (!stopRequested && !fs.existsSync(path.join(out, "close-request.json"))
    && Date.now() < Date.parse(report.deadline)) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  report.closeReason = stopRequested ? "SIGNAL" :
    fs.existsSync(path.join(out, "close-request.json")) ? "REQUESTED" : "BOUNDED_DEADLINE";
})().catch(error => {
  report.error = String(error.stack || error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (removed) {
      let state = field(run(["showvminfo", clone, "--machinereadable"]), "VMState");
      if (state === "running" || state === "paused") {
        run(["controlvm", clone, "savestate"], 180000);
        state = field(run(["showvminfo", clone, "--machinereadable"]), "VMState");
      }
      assert(["saved", "poweroff", "aborted"].includes(state),
        "Clone must be stopped before restoring developer share");
      report.cloneFinalState = state;
      const existing = shares(fs.readFileSync("C:/Users/1/.VirtualBox/VirtualBox.xml", "utf8"));
      assert(!existing.some(item => item.name === "AgentVN"), "Global share was changed by another actor");
      run(report.restoreCommand.slice(1));
      const restored = shares(fs.readFileSync("C:/Users/1/.VirtualBox/VirtualBox.xml", "utf8"));
      assert.deepEqual(restored, report.originalShares, "Original global share settings not exactly restored");
      assert.match(run(["showvminfo", clone, "--machinereadable"]),
        /SharedFolderPathGlobalMapping\d+="D:\\\\AgentVN"/);
      report.restorationStatus = "PASS";
    }
    if (report.original) {
      assert.equal(await hash(report.original.config), report.original.configSha256);
      assert.equal(await hash(report.original.state), report.original.stateSha256);
      assert.equal(field(run(["showvminfo", source, "--machinereadable"]), "VMState"), "saved");
      report.sourcePreservationStatus = "PASS";
    }
  } catch (error) {
    report.cleanupError = String(error.stack || error);
    report.restorationStatus = "FAILED";
    process.exitCode = 1;
  }
  report.status = report.error || report.cleanupError ? "FAILED" : "PASS";
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ status: report.status, isolation: report.isolationStatus,
    restoration: report.restorationStatus, source: report.sourcePreservationStatus,
    out, error: report.error, cleanupError: report.cleanupError }));
});
