"use strict";
// Reuse the existing actual NSIS installation and metadata restoration workflow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), phase = process.argv[2], attempt = process.argv[3];
assert(["payload", "install"].includes(phase)); assert.match(attempt || "", /^\d{2}$/);
// The existing installation helper deliberately permits one exact new root.
assert.equal(attempt, "01");
const qa = "F:/AgentVN/QA/Editor-Repair-Release-20261024-01", out = path.join(qa, phase + "-" + attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const packageFile = path.join(qa, "package-01/report.json"), packaged = read(packageFile);
assert.equal(packaged.status, "PASS"); assert.equal(packaged.candidateVersion, "1.9.23");
const report = { status: "RUNNING", phase, startedAt: new Date().toISOString(), modelRequests: 0,
  scope: "NSIS_PAYLOAD_OR_REAL_NEW_DIRECTORY_INSTALL_NOT_UPGRADE_OR_CLEAN_MACHINE_OR_FUNCTIONAL_ACCEPTANCE",
  version: "1.9.23", installerFormat: "nsis", packageReport: desc(packageFile), commands: [],
  tools: [__filename, "scripts/runtime-dialog-installed-session.ps1",
    "scripts/editor-installer-resources-acceptance.cjs"].map(f => desc(path.resolve(root, f))) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args) {
  const row = { label, command: [exe, ...args], log: path.join(out, label + ".log"), status: "RUNNING",
    startedAt: new Date().toISOString() }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, row.log); row.status = "PASS";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); console.log(label + " " + row.status); }
}
(async () => {
  save();
  assert.equal(sha(packaged.installer.path), packaged.installer.sha256);
  assert.equal(sha(packaged.retainedInstaller.path), packaged.installer.sha256);
  for (const f of packaged.frozenProducts) assert.equal(sha(f.path), f.sha256);
  if (phase === "payload") {
    await command("actual-nsis-payload", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
      path.join(out, "deployments"), "1.9.23", path.dirname(packaged.installer.path)]);
    const payloadFile = path.join(out, "deployments/installer-resource-report.json"), payload = read(payloadFile);
    assert.equal(payload.status, "PASS"); assert.equal(payload.deployments.length, 1);
    assert.equal(payload.installerFormat, "nsis"); assert.equal(payload.installers.length, 1);
    assert.equal(payload.installers[0].sha256, packaged.installer.sha256);
    report.payloadReport = desc(payloadFile); report.deployments = payload.deployments;
    report.archived = [packaged.retainedInstaller];
  } else {
    const payloadFile = path.join(qa, "payload-01/report.json");
    assert.equal(read(payloadFile).status, "PASS"); report.payloadReport = desc(payloadFile);
    const common = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/runtime-dialog-installed-session.ps1",
      "-QaRoot", qa, "-ExpectedVersion", "1.9.23"];
    await command("install-boundaries", "powershell.exe", [...common, "-Action", "SelfTest"]);
    await command("actual-nsis-install", "powershell.exe", [...common, "-Action", "Install"]);
    const installed = read(path.join(qa, "installation.json"));
    assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
    assert.equal(installed.executable.version, "1.9.23"); report.installation = desc(path.join(qa, "installation.json"));
    for (const f of [installed.executable, ...installed.resources, ...installed.protectedFiles])
      assert.equal(sha(f.path), f.sha256);
  }
  for (const f of report.tools) assert.equal(sha(f.path), f.sha256);
  for (const f of packaged.frozenProducts) assert.equal(sha(f.path), f.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({
    phase, status: report.status, out, error: report.error })); });
