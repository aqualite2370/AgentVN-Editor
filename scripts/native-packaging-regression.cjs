"use strict";
// Runs existing product tests, not an installer or a new release build.
// Explicit destination, fresh evidence, real Cargo output, no zero-test PASS.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Pass a new F:\\AgentVN\\QA\\Native-Packaging-Regression-* directory");
const out = path.resolve(process.argv[2]);
assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\native-packaging-regression-"));
assert(!fs.existsSync(out), "Never overwrite previous evidence");
fs.mkdirSync(out, { recursive: true });
const temporary = path.join(out, "temporary");
fs.mkdirSync(temporary);
const checkpoint = path.join("F:\\AgentVN\\Checkpoints", path.basename(out));
assert(!fs.existsSync(checkpoint), "Never overwrite a checkpoint");
fs.mkdirSync(checkpoint, { recursive: true });
fs.copyFileSync(path.join(root, "plans/ACTIVE_TASKS.md"), path.join(checkpoint, "ACTIVE_TASKS.md"),
  fs.constants.COPYFILE_EXCL);
fs.copyFileSync(__filename, path.join(checkpoint, path.basename(__filename)), fs.constants.COPYFILE_EXCL);
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceNames = [
  "editor/src-tauri/src/main.rs", "editor/src-tauri/Cargo.toml", "editor/src-tauri/Cargo.lock",
  "GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src-tauri/src/save_location.rs",
  "GameCli_framework/src-tauri/src/portable_save_migration.rs",
  "GameCli_framework/src-tauri/Cargo.toml", "GameCli_framework/src-tauri/Cargo.lock",
  "GameCli_framework/src/utils/runtimeSaveQueue.ts",
  "GameCli_framework/src/utils/runtimeExitFlow.ts",
  "GameCli_framework/src/utils/quickSavePolicy.ts", "GameCli_framework/src/engine/StoryEngine.ts",
  "GameCli_framework/src/engine/validation.ts",
  "scripts/resolve-msvc-environment.ps1", "scripts/runtime-save-queue-test.cjs",
  "scripts/runtime-exit-flow-test.cjs", "scripts/quick-save-policy-test.cjs",
  "scripts/runtime-terminal-save-test.cjs", "editor/src-tauri/tests/standalone_bundled_workspace.rs",
];
const artifactNames = [
  "AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe",
];
const describe = relative => {
  const file = path.join(root, relative), stat = fs.statSync(file);
  return { path: file, sha256: hash(file), bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
};
const report = {
  status: "RUNNING", scope: "SOURCE_NATIVE_PACKAGING_AND_SAVE_CORE_NOT_INSTALLED_ACCEPTANCE",
  startedAt: new Date().toISOString(), cwd: root, out, checkpoint,
  modelRequests: 0, releaseBuilds: 0, installs: 0, deviceOperations: 0,
  sources: sourceNames.map(describe), artifactsBefore: artifactNames.map(describe),
  steps: [], errors: [],
  notProven: [
    "Actual native file/directory pickers", "Current Release installation and upgrades",
    "Windows exported setup/portable UI and ACL", "Android build/device/upgrade",
    "OPACITY-02 semantics", "Animation JSON consumption contract", "Live models",
  ],
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const baseEnv = {
  ...process.env, TEMP: temporary, TMP: temporary,
  PSModulePath: [
    path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
    path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
    path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules"),
  ].join(path.delimiter),
};
async function command(label, executable, args, environment, isCargo = false) {
  const step = {
    label, command: [executable, ...args], startedAt: new Date().toISOString(), status: "RUNNING",
    stdout: path.join(out, `${label}.stdout.log`), stderr: path.join(out, `${label}.stderr.log`),
  };
  report.steps.push(step);
  save();
  console.log(`START ${label}`);
  const stdout = fs.createWriteStream(step.stdout, { flags: "wx" });
  const stderr = fs.createWriteStream(step.stderr, { flags: "wx" });
  let text = "", errorText = "";
  let timer;
  try {
    const child = spawn(executable, args, {
      cwd: root, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    step.pid = child.pid;
    save();
    timer = setTimeout(() => {
      step.timedOut = true;
      // This is an execution deadline, never a successful cleanup assertion.
      child.kill();
    }, 15 * 60 * 1000);
    child.stdout.on("data", bytes => { text += bytes.toString(); stdout.write(bytes); });
    child.stderr.on("data", bytes => { errorText += bytes.toString(); stderr.write(bytes); });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    Object.assign(step, result);
    assert.equal(step.timedOut, undefined, `${label}: execution deadline exceeded`);
    assert.equal(result.exitCode, 0, `${label}: ${errorText.slice(-3500)}\n${text.slice(-3500)}`);
    if (isCargo) {
      step.suites = [...text.matchAll(
        /test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g,
      )].map(match => ({
        status: match[1], passed: +match[2], failed: +match[3], ignored: +match[4],
        measured: +match[5], filtered: +match[6],
      }));
      step.passedTests = step.suites.reduce((sum, suite) => sum + suite.passed, 0);
      assert(step.suites.length > 0 && step.passedTests > 0, `${label}: zero tests cannot PASS`);
      assert(step.suites.every(suite => suite.status === "ok" && suite.failed === 0));
      step.ignoredTests = text.split(/\r?\n/).filter(line => /^test .* \.\.\. ignored/.test(line));
    } else if (label !== "msvc-environment") {
      assert(/\bPASS\b/.test(text), `${label}: expected existing test success output`);
    }
    step.status = "PASS";
    console.log(`PASS ${label}${isCargo ? ` (${step.passedTests} tests)` : ""}`);
    return { stdout: text, stderr: errorText };
  } catch (error) {
    step.status = "FAILED";
    step.error = String(error.stack || error);
    throw error;
  } finally {
    clearTimeout(timer);
    await Promise.all([
      new Promise(resolve => stdout.end(resolve)), new Promise(resolve => stderr.end(resolve)),
    ]);
    step.finishedAt = new Date().toISOString();
    save();
  }
}
(async () => {
  const setup = await command("msvc-environment", "powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/resolve-msvc-environment.ps1", "-Json",
  ], baseEnv);
  const msvc = JSON.parse(setup.stdout.replace(/^\uFEFF/, ""));
  assert.equal(msvc.status, "PASS", msvc.message);
  report.compilerEnvironment = { status: msvc.status, linker: msvc.linkPath, vsDevCmd: msvc.vsDevCmdPath };
  const environment = { ...baseEnv, ...msvc.environment, TEMP: temporary, TMP: temporary };
  for (const filter of ["standalone_package_upload_tests", "project_export_directory_tests"]) {
    await command(filter, "cargo", [
      "test", "--offline", "--locked", "--manifest-path", "editor/src-tauri/Cargo.toml",
      "--bin", "agentvn-editor", filter, "--", "--nocapture",
    ], environment, true);
  }
  await command("player-native-library", "cargo", [
    "test", "--offline", "--locked", "--manifest-path", "GameCli_framework/src-tauri/Cargo.toml",
    "--lib", "--", "--nocapture",
  ], environment, true);
  for (const name of [
    "runtime-save-queue-test", "runtime-exit-flow-test", "quick-save-policy-test", "runtime-terminal-save-test",
  ]) await command(name, process.execPath, [`scripts/${name}.cjs`], environment);
  assert.equal(report.steps.length, 8);
  report.status = "SOURCE_NATIVE_CORE_PASS";
})().catch(error => {
  report.status = "FAILED";
  report.errors.push(String(error.stack || error));
  console.error(report.errors.at(-1));
  process.exitCode = 1;
}).finally(() => {
  report.sourcesAfter = sourceNames.map(describe);
  report.artifactsAfter = artifactNames.map(describe);
  const same = (before, after) => before.every((row, index) => row.sha256 === after[index].sha256);
  report.productSourcesUnchanged = same(report.sources, report.sourcesAfter);
  report.deliveredArtifactsUnchanged = same(report.artifactsBefore, report.artifactsAfter);
  if (!report.productSourcesUnchanged || !report.deliveredArtifactsUnchanged) {
    report.status = "FAILED";
    report.errors.push("Product source or delivered executable changed during a QA-only block");
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`Evidence: ${path.join(out, "report.json")}`);
});
