"use strict";
// Single fresh source APK for the reproduced quickload/exit defect.
// Never substitutes for an installed Editor publishing flow or old APK evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const { validateBuild } = require("./runtime-quickload-exit-native.cjs");
const root = path.resolve(__dirname, ".."), base = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const same = row => assert.equal(fileEvidence(row.path).sha256, row.sha256, row.path);
function directory(attempt) {
  assert.match(attempt || "", /^\d{2}$/); return path.join(base, "quickload-apk-" + attempt);
}
function validateReleaseIdentity(release, source) {
  assert.equal(release.gameId, source.gameId);
  assert.equal(release.versionName, source.version, "QA release identity must use the actual source cartridge version");
  assert.equal(release.androidApplicationId, "com.agentvn.qa.renpygui20261025");
  assert(Number.isInteger(release.versionCode) && release.versionCode > 1000);
}
function prerequisites() {
  const buildFile = path.join(base, "exit-after-quickload-build-01/report.json"), build = read(buildFile);
  validateBuild(build);
  const nativeFile = "F:\\AgentVN\\QA\\Native-Runtime-State-20261020-01\\quickload-exit-20261025-02\\report.json";
  const native = read(nativeFile);
  assert.equal(native.status, "PASS"); assert.equal(native.cleanup, "PASS"); assert(native.finishedAt);
  assert.equal(native.prep.executable.sha256, build.player.sha256);
  assert.equal(native.cells.length, 2);
  for (const cell of native.cells) {
    assert.equal(cell.status, "PASS"); assert.equal(cell.exits.length, 2);
    assert(cell.exits.every(e => e.code === 0 && e.forcedBeforeExit === false));
    assert.deepEqual(cell.restored, cell.before);
  }
  for (const row of [...build.sources, ...build.bundled, ...build.frozen, build.dev, build.player]) same(row);
  return { build: fileEvidence(buildFile), native: fileEvidence(nativeFile), frozen: build.frozen };
}
function validatePrepared(p, out) {
  assert.equal(p.status, "PREPARED");
  assert.equal(p.scope, "SOURCE_QUICKLOAD_EXIT_ANDROID_BUILD_NOT_INSTALLED_EXPORT");
  assert.equal(p.out, out); assert.equal(p.workspace, path.join(out, "workspace"));
  assert(p.sources.length > 100); assert.equal(p.sources.length, p.copies.length);
  validateReleaseIdentity(p.releaseIdentity, p.sourceIdentity);
  assert.equal(p.releaseIdentity.versionCode, 1001);
  assert.equal(path.dirname(p.outputDir), out); assert.equal(path.dirname(p.diagnosticsDir), out);
  for (const row of [...p.sources, ...p.copies, ...p.tools, ...p.prerequisites.frozen,
    p.prerequisites.build, p.prerequisites.native, p.cartridge]) same(row);
  for (const name of ["editor", "GameCli_framework"])
    assert.equal(fs.realpathSync.native(path.join(p.workspace, name, "node_modules")),
      fs.realpathSync.native(path.join(root, name, "node_modules")));
}
async function prepare(attempt) {
  const out = directory(attempt), required = prerequisites();
  fs.mkdirSync(out);
  const p = { status: "PREPARING", scope: "SOURCE_QUICKLOAD_EXIT_ANDROID_BUILD_NOT_INSTALLED_EXPORT",
    out, workspace: path.join(out, "workspace"), startedAt: new Date().toISOString(), modelRequests: 0,
    prerequisites: required, sources: [], copies: [],
    tools: [__filename, path.join(root, "scripts/runtime-quickload-android-build.ps1")].map(fileEvidence) };
  const save = () => fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(p, null, 2));
  save();
  try {
    const excluded = new Set(["node_modules", "target", "dist", "gen", ".git", "binaries"]);
    const generatedAndroidOutput = require("./android-exit-built-artifacts-audit.cjs").generatedAndroidOutput;
    function copy(relative) {
      const source = path.join(root, relative), destination = path.join(p.workspace, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, filter: file => {
        const rel = path.relative(root, file).replaceAll("\\", "/");
        if (file !== source && excluded.has(path.basename(file))) return false;
        if (generatedAndroidOutput(rel + "/")) return false;
        if (/^GameCli_framework\/(?:public|src-tauri\/resources)\/embedded-cartridge(?:\/|$)/.test(rel)) return false;
        const stat = fs.lstatSync(file); assert(!stat.isSymbolicLink(), "Unreviewed source link: " + rel);
        if (stat.isFile()) p.sources.push(fileEvidence(file)); return true;
      } });
    }
    for (const file of ["LICENSE", "shared", "scripts", "editor/src-tauri/tauri.conf.json", "build-versions.json"])
      if (fs.existsSync(path.join(root, file))) copy(file);
    for (const file of ["src", "public", "vendor", "src-tauri", "index.html", "package.json",
      "package-lock.json", "tsconfig.json", "vite.config.cjs"]) copy("GameCli_framework/" + file);
    for (const name of ["editor", "GameCli_framework"]) {
      fs.mkdirSync(path.join(p.workspace, name), { recursive: true });
      fs.symlinkSync(path.join(root, name, "node_modules"), path.join(p.workspace, name, "node_modules"), "junction");
    }
    p.copies = p.sources.map(row => {
      const copied = fileEvidence(path.join(p.workspace, path.relative(root, row.path)));
      assert.equal(copied.sha256, row.sha256); return copied;
    });
    const exported = read(path.join(base, "editor-19/report.json"));
    same(exported.cartridge); p.cartridge = fileEvidence(exported.cartridge.path);
    const zip = await JSZip.loadAsync(fs.readFileSync(p.cartridge.path));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
    assert.equal(layout.layout_type, "renpy");
    p.sourceIdentity = { gameId: manifest.game_id, version: manifest.version };
    p.releaseIdentity = { schemaVersion: 1, title: "Renpy Quickload Exit QA", gameId: manifest.game_id,
      versionName: manifest.version, versionCode: 1001, androidApplicationId: "com.agentvn.qa.renpygui20261025" };
    validateReleaseIdentity(p.releaseIdentity, p.sourceIdentity);
    p.outputDir = path.join(out, "apk"); p.diagnosticsDir = path.join(out, "diagnostics");
    // Reuse only the completed source Cargo cache. Preserve its old libraries first;
    // new Android project, Kotlin, Gradle, final APK and evidence are generated anew.
    const oldRoot = "F:\\AgentVN\\QA\\Android-Exit-20261024-01\\apk-build-10";
    const old = read(path.join(oldRoot, "build-report.json"));
    assert.equal(old.status, "SOURCE_APKS_BUILT_DEVICE_NOT_RUN");
    assert(old.finishedAt); assert.equal(old.sourceAndCloneRestoration, "PASS");
    const cache = fs.realpathSync.native(path.join(oldRoot, "workspace/GameCli_framework/src-tauri/target"));
    assert(cache.toLowerCase().startsWith("f:\\agentvn\\qa\\android-exit-20261024-01\\apk-build-"));
    p.cacheReuse = { source: cache, priorLibraries: [] };
    for (const abi of ["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"]) {
      const library = path.join(cache, abi, "release/libagentvn_player_lib.so");
      const backup = path.join(out, "prior-libraries", abi, "libagentvn_player_lib.so");
      fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(library, backup, fs.constants.COPYFILE_EXCL);
      assert.equal(fileEvidence(backup).sha256, fileEvidence(library).sha256);
      p.cacheReuse.priorLibraries.push(fileEvidence(backup));
    }
    fs.symlinkSync(cache, path.join(p.workspace, "GameCli_framework/src-tauri/target"), "junction");
    p.status = "PREPARED"; p.finishedAt = new Date().toISOString(); save();
    validatePrepared(p, out);
    console.log(JSON.stringify({ status: p.status, out, sourceFiles: p.sources.length, apkBuilds: 0 }));
  } catch (error) { p.status = "FAILED"; p.error = String(error.stack || error); save(); throw error; }
}
async function build(attempt) {
  const out = directory(attempt), p = read(path.join(out, "preparation.json"));
  validatePrepared(p, out); prerequisites();
  const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", windowsHide: true });
  assert.equal(token.status, 0); assert.equal(token.stdout.trim().toLowerCase(), "true");
  const reportFile = path.join(out, "build-report.json"); assert(!fs.existsSync(reportFile));
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: p.scope, isElevated: true,
    preparation: fileEvidence(path.join(out, "preparation.json")), modelRequests: 0, buildInvocations: 1 };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  save();
  try {
    r.log = path.join(out, "builder.log");
    const fd = fs.openSync(r.log, "wx");
    const args = [path.join(p.workspace, "scripts/build-runtime-standalone-android.cjs"),
      "--OutputDir", p.outputDir, "--DiagnosticsDir", p.diagnosticsDir,
      "--CartridgePath", p.cartridge.path, "--ReleaseIdentity",
      "base64:" + Buffer.from(JSON.stringify(p.releaseIdentity)).toString("base64"),
      "--IconSource", "default", "--OptimizationProfile", "off", "--RunId", "quickload-exit-20261025-" + attempt];
    r.command = [process.execPath, ...args]; save();
    const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
    try {
      const child = spawn(process.execPath, args, { cwd: p.workspace, windowsHide: true,
        env: { ...process.env, TEMP: temporary, TMP: temporary }, stdio: ["ignore", fd, fd] });
      r.pid = child.pid; save();
      r.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(r.exitCode, 0, r.log);
    } finally { fs.closeSync(fd); }
    r.manifest = fileEvidence(path.join(p.diagnosticsDir, "package-build-manifest.json"));
    const manifest = read(r.manifest.path); assert.equal(manifest.status, "PASS");
    const apks = manifest.artifacts.filter(a => /\.apk$/i.test(a.path)); assert.equal(apks.length, 1);
    r.apk = fileEvidence(apks[0].path);
    r.provenance = fileEvidence(r.apk.path + ".acceptance.json");
    const evidence = read(r.provenance.path);
    assert.equal(verifyProvenance(r.apk.path, evidence).status, "PASS");
    assert.equal(evidence.sourceCartridge.sha256, p.cartridge.sha256);
    assert.equal(evidence.packageName, p.releaseIdentity.androidApplicationId);
    assert.equal(evidence.symlinkProbe.isElevated, true); assert.equal(evidence.symlinkProbe.success, true);
    r.signingReports = fs.readdirSync(p.diagnosticsDir).filter(n => /^android-signing-.*\.json$/.test(n))
      .map(n => fileEvidence(path.join(p.diagnosticsDir, n)));
    assert.equal(r.signingReports.length, 1); assert.equal(read(r.signingReports[0].path).signed, true);
    r.compilerSnapshot = require("./lib/android-compiler-snapshot.cjs").captureCompilerSnapshot(
      path.join(p.workspace, "GameCli_framework/src-tauri/gen/android/agentvn-runtime"),
      p.releaseIdentity.androidApplicationId, path.join(out, "compiler-snapshot"));
    r.status = "SOURCE_QUICKLOAD_APK_BUILT_DEVICE_NOT_RUN";
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
  finally {
    try { validatePrepared(p, out); r.sourceAndCloneRestoration = "PASS"; }
    catch (error) { r.status = "FAILED"; r.restorationError = String(error.stack || error); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, restorationError: r.restorationError }));
  }
}
if (require.main === module) {
  const [phase, attempt] = process.argv.slice(2);
  if (phase === "--self-test") {
    const source = { gameId: "qa", version: "0.1.0" };
    const release = { gameId: "qa", versionName: "0.1.0", versionCode: 1001,
      androidApplicationId: "com.agentvn.qa.renpygui20261025" };
    validateReleaseIdentity(release, source);
    for (const change of [v => { v.versionName = "0.1.1"; }, v => { v.gameId = "wrong"; },
      v => { v.versionCode = 1000; }, v => { v.androidApplicationId += ".wrong"; }]) {
      const value = structuredClone(release); change(value); assert.throws(() => validateReleaseIdentity(value, source));
    }
    console.log(JSON.stringify({ status: "PASS", rejectedIdentityMismatches: 4, builds: 0 }));
  } else {
    assert(["prepare", "build"].includes(phase));
    (phase === "prepare" ? prepare(attempt) : build(attempt)).catch(error => { console.error(error); process.exitCode = 1; });
  }
}
module.exports = { directory, prerequisites, validatePrepared, validateReleaseIdentity };
