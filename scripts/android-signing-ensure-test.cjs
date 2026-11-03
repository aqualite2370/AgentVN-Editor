const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const helper = path.join(root, "scripts", "android-release-signing.ps1");
const windowsPowerShell = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-signing-ensure-"));
const keystorePath = path.join(fixtureRoot, "release-key.jks");
const reportPath = path.join(fixtureRoot, "ensure-report.json");
const cleanPowerShellEnv = {
  ...process.env,
  PSModulePath: path.join(fixtureRoot, "isolated-module-path"),
};

try {
  const result = childProcess.spawnSync(
    windowsPowerShell,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-Action",
      "ensure",
      "-KeystorePath",
      keystorePath,
      "-ReportPath",
      reportPath,
      "-Json",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, env: cleanPowerShellEnv },
  );
  assert.equal(
    result.status,
    0,
    `Android signing ensure failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(fs.existsSync(keystorePath), true);
  assert.equal(fs.existsSync(`${keystorePath}.password.dpapi`), true);
  assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).keystorePath, keystorePath);
  fs.writeFileSync(`${keystorePath}.password.dpapi`, "not-a-dpapi-payload\n", "ascii");
  const corrupt = childProcess.spawnSync(
    windowsPowerShell,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
      "-Action",
      "ensure",
      "-KeystorePath",
      keystorePath,
      "-ReportPath",
      reportPath,
      "-Json",
    ],
    { cwd: root, encoding: "utf8", windowsHide: true, env: cleanPowerShellEnv },
  );
  assert.notEqual(corrupt.status, 0, "corrupt DPAPI material must fail closed");
  assert.equal(corrupt.stderr.includes("\uFFFD"), false, `signing errors must remain UTF-8:\n${corrupt.stderr}`);
  assert.match(corrupt.stderr, /ANDROID_SIGNING_PASSWORD_INVALID/, "corrupt DPAPI material needs a stable failure code");
  console.log("PASS Android signing ensure creates a protected keystore on a clean profile");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
