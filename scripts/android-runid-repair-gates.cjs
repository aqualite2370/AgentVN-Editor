"use strict";
// Source/Dev validation only. Immutable failed installed 1.9.18 is not promoted.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Android-RunId-Repair-20261021-01";
const [mode, attempt = "01"] = process.argv.slice(2);
assert(["red", "check", "dev"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `${mode}-${attempt}`);
assert(!fs.existsSync(out), "Fresh immutable evidence required"); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const checkpoint = read(path.join(qa, "checkpoint.json")); assert.equal(checkpoint.status, "PASS");
const report = { status: "RUNNING", mode, startedAt: new Date().toISOString(),
  scope: "ANDROID_RUNID_SOURCE_DEV_NOT_INSTALLED_OR_DEVICE", commands: [], modelRequests: 0,
  sources: ["editor/src-tauri/src/main.rs", "scripts/android-runid-repair-gates.cjs",
    "scripts/build-runtime-standalone-android.cjs", "scripts/build-runtime-standalone-android.ps1",
    "editor/src-tauri/Cargo.toml", "editor/src-tauri/tauri.conf.json",
    "scripts/android-direct-runner-cache-test.cjs"].map(f => desc(path.join(root, f))),
  beforeDev: desc(path.join(root, "AgentVN Dev.exe")), protected: checkpoint.protected };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const verify = files => { for (const f of files) assert.equal(sha(f.path), f.sha256, f.path); };
async function command(label, exe, args, expectedExit = 0) {
  const log = path.join(out, `${report.commands.length + 1}.log`), fd = fs.openSync(log, "wx");
  const row = { label, command: [exe, ...args], startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log("START " + label);
  try {
    const env = { ...process.env, TEMP: out, TMP: out,
      AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED: "",
      AGENTVN_TEST_PROJECT: path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj"),
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, `test-${report.commands.length}`) };
    if (exe.toLowerCase().endsWith("powershell.exe")) env.PSModulePath = [
      path.join(process.env.USERPROFILE, "Documents/WindowsPowerShell/Modules"),
      path.join(process.env.ProgramFiles, "WindowsPowerShell/Modules"),
      path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules")].join(path.delimiter);
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("exit", resolve); child.once("error", reject);
    });
    assert.equal(row.exitCode, expectedExit, log); row.status = "PASS";
  } finally {
    fs.closeSync(fd); row.log = desc(log); row.finishedAt = new Date().toISOString(); save();
  }
  console.log("PASS " + label); return fs.readFileSync(log, "utf8");
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  verify(report.protected);
  if (mode === "red") {
    const text = await command("Expected native run ID reproduction", "cargo",
      ["test", "--manifest-path", "editor/src-tauri/Cargo.toml", "native_runner_", "--", "--nocapture"], 101);
    assert.match(text, /running 2 tests/); assert.match(text, /0 passed; 2 failed/);
    assert.match(text, /RunId|original build run ID was lost/);
    report.expectedProductFailure = true;
  } else if (mode === "check") {
    const red = read(path.join(qa, "red-01/report.json"));
    assert.equal(red.status, "PASS"); assert.equal(red.expectedProductFailure, true);
    const text = await command("All native tests, including real runner children", "cargo",
      ["test", "--manifest-path", "editor/src-tauri/Cargo.toml", "--", "--nocapture"]);
    const summary = text.match(/test result: ok\. (\d+) passed; 0 failed; (\d+) ignored; 0 measured; 0 filtered out/);
    assert(summary && Number(summary[1]) > 50, "Native full suite must be nonempty and unfiltered");
    report.nativeTests = { passed: Number(summary[1]), ignored: Number(summary[2]) };
    for (const name of ["android-runner-arguments-test", "android-runner-failure-test",
      "android-acceptance-evidence-test", "android-version-provenance-test", "android-cleanup-behavior-test",
      "android-build-diagnostics-behavior-test", "android-diagnostics-bundled-workspace-test",
      "editor-workspace-contract", "editor-runtime-resource-wiring-contract"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    for (const [folder, task] of [["editor", "typecheck"], ["editor", "build"], ["GameCli_framework", "build"]])
      await command(`${folder} ${task}`, process.execPath, [npm, "--prefix", path.join(root, folder), "run", task]);
    assert.equal(sha(report.beforeDev.path), report.beforeDev.sha256, "No premature Dev build");
  } else {
    const checkFile = path.join(qa, "check-01/report.json"), check = read(checkFile);
    assert.equal(check.status, "PASS"); assert(check.commands.length >= 13);
    assert(check.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    verify(check.sources); report.precondition = desc(checkFile);
    await command("Full Dev build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/build-dev-launcher.ps1")]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    report.debug = desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"));
    assert.equal(report.dev.sha256, report.debug.sha256);
    assert(fs.statSync(report.dev.path).mtimeMs >= Date.parse(report.startedAt), "Actual root Dev overwrite required");
    await command("Installed version resource failure regression", process.execPath,
      ["scripts/editor-installed-version-resources-test.cjs"]);
  }
  verify([...report.sources, ...report.protected]); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, mode, out, nativeTests: report.nativeTests,
      dev: report.dev, expectedProductFailure: report.expectedProductFailure, error: report.error }, null, 2)); });
