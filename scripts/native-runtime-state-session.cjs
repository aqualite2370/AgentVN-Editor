"use strict";
// Current real Player state/saves continuation. Historical exports are inputs,
// not proof of a fresh Editor export, Windows setup or Android installation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const iteration = process.argv[2] || "01"; assert(/^\d{2}$/.test(iteration));
const nativeRoaming = process.argv.includes("--native-roaming");
const quickExceptions = process.argv.includes("--quick-exceptions");
const exitSafety = process.argv.includes("--exit-safety");
const runtimeMotion = process.argv.includes("--runtime-motion");
const smoke = process.argv.includes("--smoke");
assert([quickExceptions, exitSafety, runtimeMotion].filter(Boolean).length <= 1, "One acceptance block per session");
if (quickExceptions || exitSafety || runtimeMotion) assert(nativeRoaming, "Native tests require a physical, isolated default Roaming directory");
const out = path.join(base, `${runtimeMotion ? "motion" : exitSafety ? "exit" : quickExceptions ? "quick" : "session"}-${iteration}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "CURRENT_NATIVE_PLAYER_NOT_RELEASE_INSTALL_OR_NEW_EXPORT",
  commands: [], nativeRoaming, quickExceptions, exitSafety, runtimeMotion, smoke,
  productChanges: 0, builds: 0, modelRequests: 0, installs: 0, deviceOperations: 0 };
const save = () => fs.writeFileSync(path.join(out, "session.json"), JSON.stringify(report, null, 2));
const env = { ...process.env, AGENTVN_WORKSPACE_OUTPUT: out };
let profileJournal = false;
const profileTool = path.join(root, "scripts/native-dev-preview-profile.ps1");
async function command(exe, args, label) {
  const row = { command: [exe, ...args], at: new Date().toISOString(), status: "RUNNING",
    log: path.join(out, `${label}.log`) }; report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  let child;
  try {
    child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save();
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    row.exitCode = code; row.status = code === 0 ? "PASS" : "FAILED";
    assert.equal(code, 0, `${label}: ${row.log}`);
  } finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); save(); }
}
(async () => {
  for (const file of ["scripts/native-runtime-state-session.cjs", "scripts/installed-runtime-abilities-playwright.cjs",
    "scripts/native-dev-preview-profile.ps1", "scripts/lib/owned-process-tree.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/native-runtime-state-viewport-test.cjs",
    ...(quickExceptions ? ["scripts/lib/installed-runtime-session.cjs",
      "scripts/installed-runtime-quick-gaps-playwright.cjs", "scripts/installed-runtime-quick-gaps-lock.ps1",
      "scripts/installed-runtime-quick-observation.cjs"] : []),
    ...(exitSafety ? ["scripts/lib/installed-runtime-session.cjs", "scripts/native-runtime-exit-playwright.cjs",
      "scripts/native-runtime-exit-acl.ps1", "scripts/lib/runtime-qa-acl.ps1"] : []),
    ...(runtimeMotion ? ["scripts/lib/installed-runtime-session.cjs", "scripts/native-runtime-motion-playwright.cjs",
      "scripts/lib/installed-runtime-motion-sampler.cjs", "scripts/lib/native-runtime-motion-oracle.cjs"] : [])]) {
    const target = path.join(out, path.basename(file)); fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL);
    (report.tools ??= []).push(desc(target));
  }
  const originalExportPath = path.join(root, "output/installed-runtime-abilities-20261018-01/export-03/report.json");
  const originalFixturePath = path.join(root, "output/installed-runtime-abilities-20261018-01/fixtures-02.json");
  const exported = read(originalExportPath), fixture = read(originalFixturePath);
  assert.equal(exported.status, "PASS"); assert.equal(exported.cartridges.length, 2);
  assert.equal(sha(fixture.input), fixture.inputSha256);
  const project = path.join(out, "剧情状态 隔离临时工程.vnproj");
  fs.copyFileSync(fixture.input, project, fs.constants.COPYFILE_EXCL);
  const cartridges = exported.cartridges.map(c => {
    assert.equal(sha(c.path), c.sha256);
    const to = path.join(out, `${c.layout}.vncart`);
    fs.copyFileSync(c.path, to, fs.constants.COPYFILE_EXCL);
    return { ...c, original: c.path, path: to };
  });
  const executable = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
  const build = read("F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01/verified-build.json");
  assert.equal(executable.sha256, build.products[2].sha256);
  assert.equal(executable.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
  report.products = build.products.map(p => { assert.equal(sha(p.path), p.sha256); return desc(p.path); });
  report.originalExport = desc(originalExportPath); report.originalFixture = desc(originalFixturePath);
  report.nativeAvailability = runtimeMotion
    ? read(path.join(root, "output/native-portable-saves-20261020-01/computer-use-availability.json"))
    : { at: "2026-10-20T05:42:16.749Z", method: "sky.list_apps", status: "BLOCKED",
      inputSent: false, error: "Computer Use native pipe unavailable, os error 2" };
  env.AGENTVN_TEST_PROJECT = project;
  profileJournal = true;
  await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileTool,
    "-Action", "Prepare", "-RunDirectory", out, "-Storage", nativeRoaming ? "NativeRoaming" : "Junction"], "profile-prepare");
  const journal = read(path.join(out, "profile-protection.json"));
  const preparation = { status: "PASS", at: new Date().toISOString(), sessionRoot: out,
    defaultStorage: nativeRoaming ? "PHYSICAL_DEFAULT_PATH" : "PROTECTED_JUNCTION_TO_F",
    executable, originalExport: desc(originalExportPath), originalFixture: desc(originalFixturePath),
    profiles: journal.records.filter(p => p.existed), allProfiles: journal.records,
    fixture: { ...fixture, input: project, inputSha256: sha(project) }, cartridges,
    installId: runtimeMotion ? `qa_native_motion_20261020_${iteration}`
      : exitSafety ? `qa_native_exit_20261020_${iteration}`
      : quickExceptions ? `qa_native_quick_20261020_${iteration}`
      : `qa_native_runtime_state_20261020_${iteration}`,
    webview: path.join(out, "webview"), temporary: path.join(out, "temporary"),
    controlledBoundary: "Public native library insertion of historical real UI exports; actual progression/save/load input" };
  fs.mkdirSync(preparation.temporary);
  const prepPath = path.join(out, "preparation.json");
  fs.writeFileSync(prepPath, JSON.stringify(preparation, null, 2), { flag: "wx" });
  if (runtimeMotion) {
    await command(process.execPath, ["scripts/native-runtime-motion-playwright.cjs",
      "--current-native-preparation", prepPath, ...(smoke ? ["--smoke"] : [])], "motion");
    const result = read(path.join(out, "motion.json"));
    assert.equal(result.status, "PASS"); assert.equal(result.matrix.length, smoke ? 4 : 24);
    report.status = smoke ? "CURRENT_NATIVE_RUNTIME_MOTION_SMOKE_PASS" : "CURRENT_NATIVE_RUNTIME_MOTION_PASS";
    return;
  }
  if (exitSafety) {
    await command(process.execPath, ["scripts/native-runtime-exit-playwright.cjs",
      "--current-native-preparation", prepPath, ...(smoke ? ["--smoke"] : [])], "exit");
    const result = read(path.join(out, "exit.json"));
    assert.equal(result.status, "PASS");
    assert.equal(result.cases.length, smoke ? 4 : 8);
    report.status = smoke ? "CURRENT_NATIVE_EXIT_SMOKE_PASS" : "CURRENT_NATIVE_EXIT_SAFETY_PASS";
    return;
  }
  if (quickExceptions) {
    await command(process.execPath, ["scripts/installed-runtime-quick-gaps-playwright.cjs",
      "--current-native-preparation", prepPath, ...(smoke ? ["--smoke"] : [])], "quick");
    const quick = read(path.join(out, "player-01.json"));
    assert.equal(quick.status, "PASS"); assert.equal(quick.cells.length, smoke ? 1 : 12);
    report.status = smoke ? "CURRENT_NATIVE_QUICK_SMOKE_PASS" : "CURRENT_NATIVE_QUICK_EXCEPTIONS_PASS";
    return;
  }
  await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", path.join(out, "flow"),
    "--current-native-preparation", prepPath], "flow");
  const flow = read(path.join(out, "flow/report.json"));
  assert.equal(flow.status, "PASS"); assert.equal(flow.matrix.length, 24);
  assert(flow.checks.length >= 12 && flow.checks.every(c => c.status === "PASS"));
  await command(process.execPath, ["scripts/installed-runtime-abilities-playwright.cjs", path.join(out, "cross-layout"),
    "--current-native-preparation", prepPath, "--native-matrix-source", path.join(out, "flow/report.json"),
    "--cross-layout-only"], "cross-layout");
  report.status = "CURRENT_NATIVE_RUNTIME_FLOW_PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  try {
    if (profileJournal && fs.existsSync(path.join(out, "profile-protection.json"))) {
      if (runtimeMotion) {
        const literal = "'" + path.resolve(out).replaceAll("'", "''") + "'";
        await command("powershell.exe", ["-NoProfile", "-Command",
          `$qaRun=${literal};$qaActive=@(Get-CimInstance Win32_Process|Where-Object {` +
          `($_.Name -eq 'agentvn-player.exe') -or ` +
          `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like ('*'+$qaRun+'*'))});` +
          `if($qaActive.Count){throw 'Player or owned WebView still active; refuse restoring user profile'};` +
          `Write-Output 'PASS Player and owned WebView absent before original-profile restoration'`], "profile-process-guard");
      }
      await command("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", profileTool,
        "-Action", "Restore", "-RunDirectory", out], "profile-restore");
      const restored = read(path.join(out, "profile-restoration.json"));
      assert.equal(restored.status, "PASS"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
    }
    for (const p of report.products || []) assert.equal(sha(p.path), p.sha256);
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
