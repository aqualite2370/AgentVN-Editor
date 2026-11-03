"use strict";
// Compile the frozen source in a new Rust target/cache. No Dev replacement,
// installation, UI launch, real model request, or device task is performed.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const base = "F:/AgentVN/QA/Source-Delivery-20261103-01";
const attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const reuse = process.argv.find(a => a.startsWith("--reuse-native="))?.slice(15);
if (reuse) assert.match(reuse, /^\d{2}$/);
const resumeEditor = process.argv.find(a => a.startsWith("--resume-editor="))?.slice(16);
if (resumeEditor) { assert.match(resumeEditor, /^\d{2}$/); assert(reuse); }
const out = path.join(base, `native-clean-${attempt}`);
const cacheRoot = reuse ? path.join(base, `native-clean-${reuse}`) : out;
assert(!fs.existsSync(out), "Never overwrite evidence");
const frozenRoot = path.join(base, "snapshot-02", "source");
const receiptFile = path.join(base, "snapshot-02", "report.json");
const prepared = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
assert.equal(prepared.status, "PREPARED_NOT_BUILT");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
assert.equal(sha(prepared.archive.path), prepared.archive.sha256);
for (const f of prepared.files) assert.equal(sha(path.join(frozenRoot, f.relative)), f.sha256);
const gated = JSON.parse(fs.readFileSync(path.join(base, "snapshot-02", "gates-report.json"), "utf8"));
assert.equal(gated.status, "PASS");
const backend = JSON.parse(fs.readFileSync(path.join(base, "backend-clean-04", "report.json"), "utf8"));
assert.equal(backend.status, "PASS");
const python = path.join(base, "backend-clean-01", "python-env", "Scripts", "python.exe");
assert(fs.existsSync(python));
const cargoHome = process.env.CARGO_HOME, rustupHome = process.env.RUSTUP_HOME;
assert(cargoHome && rustupHome);
const cargo = path.join(cargoHome, "bin", "cargo.exe");
const rustc = path.join(cargoHome, "bin", "rustc.exe");
assert(fs.existsSync(cargo) && fs.existsSync(rustc));
fs.mkdirSync(out);
for (const dir of ["temporary", "local-app-data", "roaming-app-data",
  "python-config", "backend-dist", "backend-work", "backend-spec"])
  fs.mkdirSync(path.join(out, dir));
if (!reuse) for (const dir of ["cargo-home", "target"]) fs.mkdirSync(path.join(out, dir));
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "FROZEN_SOURCE_WINDOWS_NATIVE_DEBUG_COMPILATION_AND_TESTS",
  source: describe(receiptFile), archive: prepared.archive,
  frontendGates: describe(path.join(base, "snapshot-02", "gates-report.json")),
  backendGates: describe(path.join(base, "backend-clean-04", "report.json")),
  commands: [], artifacts: [], protectedFiles: [], productChanges: 0, modelRequests: 0,
  devicesStarted: 0, devReplacements: 0, installersBuilt: 0, cleanup: "PENDING",
  boundaries: ["Existing Rust compiler/MSVC toolchain; fresh Cargo registry/target on F.",
    "Generated resources come from frozen source and its independently installed dependencies.",
    "Windows debug tests/compilation are not Release installation or device acceptance."],
};
if (reuse) {
  const priorFile = path.join(cacheRoot, "report.json");
  const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
  assert.equal(prior.cleanup, "PASS");
  assert.equal(prior.sourceBytesPreserved, true);
  assert.equal(prior.protectedFilesPreserved, true);
  assert(prior.finishedAt && prior.commands.every(c => c.finishedAt));
  assert.equal(prior.archive.sha256, prepared.archive.sha256);
  report.reusedNativeEnvironment = { receipt: describe(priorFile),
    reason: "Prior run is terminal; preserve its QA rejection and reuse compiled dependencies." };
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const protectedPaths = [
  path.join(root, "AgentVN Dev.exe"), "D:/AgentVN/AgentVN Dev.exe",
  path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"),
  path.join(root, "editor/src-tauri/binaries/creator-backend.exe"),
  path.join(root, "editor/src-tauri/tauri.conf.json"),
  path.join(root, "GameCli_framework/src-tauri/tauri.conf.json"),
];
for (const file of protectedPaths) report.protectedFiles.push({
  path: path.resolve(file), ...(fs.existsSync(file) ? describe(file) : { absent: true }),
});
function environment(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(?:AGENTVN_|VITE_|WEBVIEW2_|OPENAI_|DEEPSEEK_|ANTHROPIC_|LLM_|PIP_|PYTHON|PYTEST|CARGO_|RUSTFLAGS$|TAURI_)/i.test(key)
      || /(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD|PROXY)$/i.test(key)
      || ["DATABASE_PATH", "VIRTUAL_ENV"].includes(key)) delete env[key];
  }
  return Object.assign(env, {
    CARGO_HOME: path.join(cacheRoot, "cargo-home"), CARGO_TARGET_DIR: path.join(cacheRoot, "target"),
    CARGO_BUILD_JOBS: "4", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_INCREMENTAL: "0", RUSTUP_HOME: rustupHome,
    TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary"),
    LOCALAPPDATA: path.join(out, "local-app-data"), APPDATA: path.join(out, "roaming-app-data"),
    PYTHONNOUSERSITE: "1", PYINSTALLER_CONFIG_DIR: path.join(out, "python-config"),
    PYTHONPATH: path.join(frozenRoot, "backend"),
  }, extra);
}
const vswhere = "C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe";
function loadMSVC() {
  assert(fs.existsSync(vswhere));
  const found = spawnSync(vswhere, ["-latest", "-products", "*", "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
  { encoding: "utf8", windowsHide: true });
  assert.equal(found.status, 0);
  const vsDevCmdPath = path.join(found.stdout.trim(), "Common7", "Tools", "VsDevCmd.bat");
  assert(fs.existsSync(vsDevCmdPath));
  const loaded = spawnSync(process.env.ComSpec || "cmd.exe",
    ["/d", "/s", "/c", "call", vsDevCmdPath, "-arch=x64", "-host_arch=x64", ">nul", "&&", "set"],
    { env: environment(), encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(loaded.status, 0, "MSVC environment unavailable");
  const values = {};
  for (const line of loaded.stdout.split(/\r?\n/)) {
    const split = line.indexOf("=");
    if (split > 0) values[line.slice(0, split)] = line.slice(split + 1);
  }
  assert(values.VCToolsInstallDir && values.WindowsSdkDir);
  // Do not persist inherited environment values or credentials.
  report.toolchainEnvironment = { vsDevCmd: describe(vsDevCmdPath),
    vcTools: values.VCToolsVersion, windowsSDK: values.WindowsSDKVersion };
  return values;
}
let msvc;
async function command(name, exe, args, cwd, extra = {}) {
  const file = path.join(out, `${name}.log`);
  const log = fs.createWriteStream(file, { flags: "wx" });
  const row = { name, executable: exe, arguments: args, cwd,
    startedAt: new Date().toISOString(), status: "RUNNING" };
  report.commands.push(row); save(); console.log("START", name);
  await new Promise((resolve, reject) => {
    const env = { ...msvc };
    for (const [key, value] of Object.entries(environment(extra))) {
      if (/^(?:path|include|lib|libpath)$/i.test(key)) continue;
      const existing = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
      if (existing && existing !== key) delete env[existing];
      env[key] = value;
    }
    const child = spawn(exe, args, { cwd, env,
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once("error", error => log.end(() => {
      row.status = "FAILED"; row.spawnError = String(error); row.exitCode = null;
      row.finishedAt = new Date().toISOString(); row.log = describe(file); save(); reject(error);
    }));
    child.once("close", code => {
      if (row.finishedAt) return;
      log.end(() => {
        row.status = code === 0 ? "PASS" : "FAILED"; row.exitCode = code;
        row.finishedAt = new Date().toISOString(); row.log = describe(file);
        save(); console.log(row.status, name);
        code === 0 ? resolve() : reject(new Error(`${name}: exit ${code}; ${file}`));
      });
    });
  });
}
function checkTests(name, expectedIgnored = [], selected = false) {
  const row = report.commands.find(c => c.name === name);
  const text = fs.readFileSync(row.log.path, "utf8");
  const matches = [...text.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/g)];
  assert(matches.length > 0 && matches.every(m =>
    Number(m[2]) === 0 && Number(m[4]) === 0 && (selected || Number(m[5]) === 0)));
  const ignoredNames = [...text.matchAll(/^test (\S+) \.\.\. ignored,/gm)].map(m => m[1]).sort();
  assert.deepEqual(ignoredNames, [...expectedIgnored].sort(), "Unexpected ignored native test");
  assert.equal(matches.reduce((sum, m) => sum + Number(m[3]), 0), expectedIgnored.length);
  const count = matches.reduce((sum, m) => sum + Number(m[1]), 0);
  assert(count > 0, "Do not accept zero native tests");
  row.tests = { passed: count, failed: 0, ignored: expectedIgnored,
    filtered: matches.reduce((sum, m) => sum + Number(m[5]), 0) }; save();
}
function verify() {
  for (const f of prepared.files) assert.equal(sha(path.join(frozenRoot, f.relative)), f.sha256, f.relative);
  for (const f of report.protectedFiles) {
    if (f.absent) assert(!fs.existsSync(f.path));
    else assert.equal(sha(f.path), f.sha256, f.path);
  }
  report.sourceBytesPreserved = true; report.protectedFilesPreserved = true;
}
(async () => {
  save(); msvc = loadMSVC();
  await command("cargo-version", cargo, ["--version", "--verbose"], frozenRoot);
  await command("rustc-version", rustc, ["--version", "--verbose"], frozenRoot);
  const player = path.join(frozenRoot, "GameCli_framework", "src-tauri");
  const editor = path.join(frozenRoot, "editor", "src-tauri");
  // Same library identity/resource isolation used by build-game-shell-windows.
  const playerConfig = JSON.stringify({ productName: "AgentVN Player", version: "1.9.1",
    identifier: "com.agentvn.player", bundle: { resources: [] } });
  report.playerConfigOverride = JSON.parse(playerConfig); save();
  if (!resumeEditor) {
  const junction = path.join(out, "qa_junction_rust_native_" + attempt);
  const physical = path.join(out, "junction-rust-physical");
  fs.mkdirSync(physical);
  report.junction = { path: junction, physical, status: "PREPARING" }; save();
  fs.symlinkSync(physical, junction, "junction");
  assert.equal(fs.realpathSync(junction), fs.realpathSync(physical));
  report.junction.status = "PREPARED"; save();
  await command("player-tests", cargo, ["test", "--locked", "--lib", "--", "--include-ignored",
    "--test-threads=1"], player, { TAURI_CONFIG: playerConfig,
    AGENTVN_SAVE_JUNCTION_TEST_ROOT: junction, AGENTVN_SAVE_JUNCTION_PHYSICAL_ROOT: physical });
  checkTests("player-tests");
  assert.deepEqual(fs.readdirSync(physical).sort(), ["auto-01.json", "quick-01.json", "slot-01.json"]);
  report.junction.files = fs.readdirSync(physical).map(f => describe(path.join(physical, f))); save();
  await command("player-build", cargo, ["build", "--locked", "--bin", "agentvn-player"],
    player, { TAURI_CONFIG: playerConfig });
  const playerExe = path.join(cacheRoot, "target", "debug", "agentvn-player.exe");
  assert(fs.existsSync(playerExe)); report.artifacts.push(describe(playerExe));
  const binaryDir = path.join(editor, "binaries");
  fs.mkdirSync(binaryDir, { recursive: true });
  for (const file of ["agentvn-player.exe", "creator-backend.exe"])
    assert(!fs.existsSync(path.join(binaryDir, file)), "Never overwrite an existing source-side executable");
  fs.copyFileSync(playerExe, path.join(binaryDir, "agentvn-player.exe"), fs.constants.COPYFILE_EXCL);
  const excluded = ["torch", "torchvision", "torchaudio", "pandas", "scipy", "sklearn",
    "numba", "matplotlib", "pygame", "playwright", "onnxruntime"];
  await command("backend-package", python, ["-m", "PyInstaller", "--noconfirm", "--clean",
    "--onefile", "--noconsole", "--name", "creator-backend", "--paths", ".",
    "--hidden-import", "sqlite_vec", "--collect-binaries", "sqlite_vec",
    "--distpath", path.join(out, "backend-dist"), "--workpath", path.join(out, "backend-work"),
    "--specpath", path.join(out, "backend-spec"),
    ...excluded.flatMap(name => ["--exclude-module", name]), "backend_launcher.py"],
    path.join(frozenRoot, "backend"));
  const backendExe = path.join(out, "backend-dist", "creator-backend.exe");
  assert(fs.existsSync(backendExe)); report.artifacts.push(describe(backendExe));
  fs.copyFileSync(backendExe, path.join(binaryDir, "creator-backend.exe"), fs.constants.COPYFILE_EXCL);
  await command("prepare-runtime-resources", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", path.join(frozenRoot, "scripts", "prepare-editor-runtime-resources.ps1"), "-SkipGameCliPlayer"],
    frozenRoot);
  } else {
    const priorFile = path.join(base, `native-clean-${resumeEditor}`, "report.json");
    const prior = JSON.parse(fs.readFileSync(priorFile, "utf8"));
    assert.equal(prior.cleanup, "PASS");
    assert.equal(prior.sourceBytesPreserved, true);
    assert.equal(prior.protectedFilesPreserved, true);
    assert(prior.finishedAt && prior.commands.every(c => c.finishedAt));
    assert.equal(prior.archive.sha256, prepared.archive.sha256);
    assert.deepEqual(prior.playerConfigOverride, report.playerConfigOverride);
    report.reusedStages = { receipt: describe(priorFile), executedThisRun: false, commands: [] };
    for (const name of ["player-tests", "player-build", "backend-package", "prepare-runtime-resources"]) {
      const row = prior.commands.find(c => c.name === name);
      assert.equal(row.status, "PASS"); assert.equal(row.exitCode, 0);
      assert.equal(sha(row.log.path), row.log.sha256);
      if (name === "player-tests") assert.deepEqual(row.tests, { passed: 29, failed: 0, ignored: [], filtered: 0 });
      report.reusedStages.commands.push(row);
    }
    for (const artifact of prior.artifacts) {
      assert.equal(sha(artifact.path), artifact.sha256);
      report.artifacts.push(artifact);
      assert.equal(sha(path.join(editor, "binaries", path.basename(artifact.path))), artifact.sha256);
    }
    assert.equal(report.artifacts.length, 2);
    const metadata = JSON.parse(fs.readFileSync(path.join(editor, "bundle-workspace", "build-versions.json"), "utf8"));
    assert.equal(metadata.editorVersion, "1.9.40");
    save();
  }
  await command("editor-tests", cargo, ["test", "--locked", "--bin", "agentvn-editor", "--",
    "--test-threads=1"], editor, { AGENTVN_NATIVE_TEST_OUTPUT: path.join(out, "native-fixtures") });
  checkTests("editor-tests", [
    "native_cartridge::tests::streams_full_imported_project_asset_set",
    "standalone_package_upload_tests::materialize_real_workspace_for_acceptance",
  ]);
  await command("editor-real-materialization", cargo, ["test", "--locked", "--bin", "agentvn-editor",
    "standalone_package_upload_tests::materialize_real_workspace_for_acceptance", "--", "--ignored", "--exact", "--test-threads=1"],
    editor, { AGENTVN_ACCEPTANCE_SOURCE: path.join(editor, "bundle-workspace"),
      AGENTVN_ACCEPTANCE_DESTINATION: path.join(out, "materialized-workspace") });
  checkTests("editor-real-materialization", [], true);
  await command("editor-integration", cargo, ["test", "--locked", "--test", "standalone_bundled_workspace",
    "--", "--test-threads=1"], editor);
  checkTests("editor-integration");
  await command("editor-build", cargo, ["build", "--locked", "--bin", "agentvn-editor"], editor);
  const editorExe = path.join(cacheRoot, "target", "debug", "agentvn-editor.exe");
  assert(fs.existsSync(editorExe)); report.artifacts.push(describe(editorExe));
  report.excludedManualTests = [{
    name: "native_cartridge::tests::streams_full_imported_project_asset_set",
    status: "NOT_RUN",
    reason: "Requires a genuinely imported project with >450MiB and >=100 assets; final user project remains last.",
  }];
  verify(); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(() => {
  if (report.junction?.status === "PREPARED") {
    try {
      assert.equal(path.dirname(path.resolve(report.junction.path)), path.resolve(out));
      assert(fs.lstatSync(report.junction.path).isSymbolicLink());
      assert.equal(fs.realpathSync(report.junction.path), fs.realpathSync(report.junction.physical));
      fs.unlinkSync(report.junction.path);
      report.junction.cleanup = "PASS";
    } catch (error) {
      report.status = "FAILED"; report.junction.cleanup = "FAILED";
      report.junction.cleanupError = String(error); process.exitCode = 1;
    }
  }
  try { verify(); } catch (error) {
    report.status = "FAILED"; report.protectionError = String(error.stack || error); process.exitCode = 1;
  }
  report.cleanup = report.commands.every(c => c.finishedAt) ? "PASS" : "FAILED";
  if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error }));
});
