"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const cli = "C:/Program Files/Oracle/VirtualBox/VBoxManage.exe";
const source = "9215edc0-b3a5-43fe-80bf-888b3b1ef97e";
const snapshot = "4834f052-a83c-443e-9f76-617871f6650c";
const name = "AgentVN-Full-Regression-20261017-01";
const base = "F:/WinENV/AgentVN-QA";
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Pass fresh run evidence directory");
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", source, snapshot, name, base, commands: [], startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function run(args, timeout = 30000) {
  const result = spawnSync(cli, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
  report.commands.push({ args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr,
    error: result.error ? String(result.error) : null }); save();
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout;
}
try {
  const original = run(["showvminfo", source, "--machinereadable"]);
  assert.match(original, /VMState="saved"/, "Original saved VM must not be disturbed");
  const config = JSON.parse(original.match(/^CfgFile=(.+)$/m)[1]);
  report.originalConfig = { path: config, sha256: hash(config) };
  assert.match(run(["snapshot", source, "list", "--machinereadable"]), new RegExp(snapshot));
  assert(!fs.existsSync(path.join(base, name)), "No previous clone may be overwritten");
  assert(!run(["list", "vms"]).includes(`"${name}"`), "Clone name already exists");
  save();
  run(["clonevm", source, `--snapshot=${snapshot}`, "--mode=machine",
    `--name=${name}`, `--basefolder=${base}`, "--register"], 600000);
  let clone = run(["showvminfo", name, "--machinereadable"]);
  for (const match of clone.matchAll(/^SharedFolderNameGlobalMapping\d+="([^"]+)"$/gm))
    run(["sharedfolder", "remove", name, `--name=${match[1]}`]);
  clone = run(["showvminfo", name, "--machinereadable"]);
  assert(!/^SharedFolderPath/gm.test(clone), "No host developer folder may remain shared");
  assert.equal(hash(config), report.originalConfig.sha256, "Original VM config changed");
  assert.match(run(["showvminfo", source, "--machinereadable"]), /VMState="saved"/);
  report.cloneUuid = JSON.parse(clone.match(/^UUID=(.+)$/m)[1]);
  report.cloneConfig = JSON.parse(clone.match(/^CfgFile=(.+)$/m)[1]);
  assert(path.resolve(report.cloneConfig).startsWith(path.resolve(base) + path.sep));
  report.scope = "TINY11_FULL_CLONE_NO_SHARED_DEVELOPER_FOLDER_NOT_YET_GUEST_INSTALLATION_ACCEPTANCE";
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status,
  name, cloneUuid: report.cloneUuid, error: report.error, out })); }
