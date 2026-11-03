"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const [phase = "check", destination = "output/host-lifecycle-20261019-01/gates-01"] = process.argv.slice(2);
assert(["check", "native-build", "dev"].includes(phase));
const root = path.resolve(__dirname, ".."), output = path.resolve(root, destination);
assert(!fs.existsSync(output), "Preserve previous logs");
fs.mkdirSync(output, { recursive: true });
const commands = phase === "check" ? [
  "cargo test --manifest-path editor/src-tauri/Cargo.toml owned_process::tests -- --nocapture",
  "node scripts/installed-backend-port-contract-test.cjs",
  "node scripts/installer-backend-upgrade-contract.cjs",
  "node scripts/editor-workspace-contract.cjs",
  "cargo test --manifest-path editor/src-tauri/Cargo.toml preview_process -- --nocapture",
  "cargo test --manifest-path editor/src-tauri/Cargo.toml standalone_package_upload_tests -- --nocapture",
  "npm --prefix D:\\AgentVN\\editor run typecheck",
  "npm --prefix D:\\AgentVN\\editor run build",
  "npm --prefix D:\\AgentVN\\GameCli_framework run build",
  "cargo build --manifest-path editor/src-tauri/Cargo.toml",
] : phase === "native-build" ? [
  "npm --prefix D:\\AgentVN\\editor run tauri -- build --no-bundle",
] : ["powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\\AgentVN\\scripts\\build-dev-launcher.ps1"];
if (phase === "native-build") {
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,
    "output/host-lifecycle-20261019-01/gates-01/report.json"))).status, "PASS");
}
if (phase === "dev") {
  const gates = JSON.parse(fs.readFileSync(path.join(root, "output/host-lifecycle-20261019-01/gates-01/report.json")));
  assert.equal(gates.status, "PASS");
  for (const folder of ["green-release-01", "green-release-02", "reuse-after", "green-cancel"]) {
    const native = JSON.parse(fs.readFileSync(path.join(root, "output/host-lifecycle-20261019-01", folder, "report.json")));
    assert.equal(native.status, "PASS", folder);
    assert(native.assertions.length >= 4 && native.cleanupSurvivors.length === 0);
  }
}
const report = { status: "RUNNING", phase, at: new Date().toISOString(), commands: [] };
(async () => {
  for (const [index, command] of commands.entries()) {
    console.log(`Running ${command}`);
    const logFile = path.join(output, `${String(index + 1).padStart(2, "0")}.log`);
    const log = fs.openSync(logFile, "wx");
    const child = spawn("powershell.exe", ["-NoProfile", "-Command",
      `$ErrorActionPreference='Stop'; ${command}; exit $LASTEXITCODE`],
    { cwd: root, stdio: ["ignore", log, log], windowsHide: true });
    const row = { command, pid: child.pid, startedAt: new Date().toISOString(), logFile };
    report.commands.push(row);
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    }).finally(() => fs.closeSync(log));
    row.finishedAt = new Date().toISOString();
    row.status = row.exitCode === 0 ? "PASS" : "FAILED";
    if (row.status !== "PASS") throw Error(`Gate failed: ${command}; see ${logFile}`);
  }
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
  });
