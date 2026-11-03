"use strict";
// QA only: fresh source clone, original repository Android pipeline, actual RunAs.
// This is not an installed Editor export or a replacement for frozen APK evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence, verifyProvenance } = require("./android-acceptance-evidence.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Android-Exit-20261024-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const same = f => assert.equal(fileEvidence(f.path).sha256, f.sha256, f.path);
function prerequisites(buildAttempt = "01", nativeAttempt = "02") {
  assert.match(buildAttempt, /^\d{2}$/); assert.match(nativeAttempt, /^\d{2}$/);
  const buildFile = path.join(base, `build-${buildAttempt}/report.json`), build = read(buildFile);
  assert.equal(build.status, "PASS"); assert(build.finishedAt && build.commands.length === 4);
  assert(build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  const nativeFile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/android-exit-20261024-${nativeAttempt}/report.json`;
  const native = read(nativeFile);
  assert.equal(native.status, "PASS"); assert.equal(native.cleanup, "PASS");
  assert(native.finishedAt && native.cells.length === 6);
  assert(native.cells.every(c => c.status === "PASS" && c.exits.length === 2
    && c.exits.every(e => e.code === 0 && e.forcedBeforeExit === false)));
  [...build.sources, ...build.frozen, ...build.bundled, build.dev, build.player].forEach(same);
  return { build: fileEvidence(buildFile), native: fileEvidence(nativeFile), frozen: build.frozen };
}
function directory(attempt) {
  assert.match(attempt || "", /^\d{2}$/);
  return path.resolve(base, `apk-build-${attempt}`);
}
function validatePrepared(p, out) {
  assert.equal(p.scope, "SOURCE_CLONE_ANDROID_BUILD_NOT_INSTALLED_EXPORT");
  assert.equal(p.out, out); assert.equal(p.workspace, path.join(out, "workspace"));
  assert.equal(p.cells.length, 2);
  assert.deepEqual(p.cells.map(c => c.layout), ["agentvn", "renpy"]);
  assert.equal(p.sources.length, p.copies.length); assert(p.sources.length > 100);
  [...p.sources, ...p.copies, ...p.tools, p.prerequisites.build, p.prerequisites.native,
    ...p.prerequisites.frozen, ...p.cells.map(c => c.cartridge)].forEach(same);
  for (const c of p.cells) {
    assert.equal(path.dirname(c.outputDir), out);
    assert.equal(path.dirname(c.diagnosticsDir), out);
    assert.match(c.releaseIdentity.androidApplicationId, /^com\.agentvn\.qa\.exit(agentvn|renpy)20261024$/);
  }
  for (const name of ["GameCli_framework", "editor"]) {
    assert.equal(fs.realpathSync.native(path.join(p.workspace, name, "node_modules")),
      fs.realpathSync.native(path.join(root, name, "node_modules")));
  }
}
async function prepare(attempt, buildAttempt = "01", nativeAttempt = "02") {
  const out = directory(attempt), required = prerequisites(buildAttempt, nativeAttempt);
  assert(!fs.existsSync(out), "Fresh evidence directory required");
  fs.mkdirSync(out);
  const p = { status: "PREPARING", scope: "SOURCE_CLONE_ANDROID_BUILD_NOT_INSTALLED_EXPORT",
    out, workspace: path.join(out, "workspace"), startedAt: new Date().toISOString(), modelRequests: 0,
    prerequisites: required, prerequisiteAttempts: { build: buildAttempt, native: nativeAttempt },
    sources: [], copies: [], cells: [],
    tools: [__filename, path.join(root, "scripts/android-exit-source-package.ps1")].map(fileEvidence) };
  const save = () => fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(p, null, 2));
  save();
  try {
    // Do not copy generated Android projects, old embedded games, caches, or binaries.
    const skip = new Set(["node_modules", "target", "dist", "gen", ".git", "binaries"]);
    function copy(relative) {
      const source = path.join(root, relative), destination = path.join(p.workspace, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, filter: f => {
        const rel = path.relative(root, f).replaceAll("\\", "/");
        if (f !== source && skip.has(path.basename(f))) return false;
        if (require("./android-exit-built-artifacts-audit.cjs").generatedAndroidOutput(rel + "/")) return false;
        if (/^GameCli_framework\/(?:public|src-tauri\/resources)\/embedded-cartridge(?:\/|$)/.test(rel)) return false;
        const s = fs.lstatSync(f);
        assert(!s.isSymbolicLink(), `Source clone must not follow an unreviewed link: ${rel}`);
        if (s.isFile()) p.sources.push(fileEvidence(f));
        return true;
      } });
    }
    for (const f of ["LICENSE", "shared", "scripts", "editor/src-tauri/tauri.conf.json"]) copy(f);
    if (fs.existsSync(path.join(root, "build-versions.json"))) copy("build-versions.json");
    for (const f of ["src", "public", "vendor", "src-tauri", "index.html", "package.json",
      "package-lock.json", "tsconfig.json", "vite.config.cjs"])
      copy("GameCli_framework/" + f);
    for (const name of ["editor", "GameCli_framework"]) {
      fs.mkdirSync(path.join(p.workspace, name), { recursive: true });
      fs.symlinkSync(path.join(root, name, "node_modules"), path.join(p.workspace, name, "node_modules"), "junction");
    }
    p.copies = p.sources.map(f => {
      const copy = fileEvidence(path.join(p.workspace, path.relative(root, f.path)));
      assert.equal(copy.sha256, f.sha256); return copy;
    });
    const old = read("F:/AgentVN/QA/Android-Package-20261021-01/editor-12/report.json").cartridge;
    const narrative = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json");
    assert.equal(narrative.status, "PASS");
    for (const layout of ["agentvn", "renpy"]) {
      const cartridge = layout === "agentvn" ? old : narrative.cartridges.find(c => c.layout === "renpy");
      same(cartridge);
      const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const ui = JSON.parse(await zip.file("ui/layout.json").async("string"));
      assert.equal(ui.layout_type || "agentvn", layout);
      p.cells.push({ layout, cartridge: fileEvidence(cartridge.path),
        manifest: { gameId: manifest.game_id, version: manifest.version, entry: manifest.entry_scene_id },
        outputDir: path.join(out, layout + "-apk"), diagnosticsDir: path.join(out, layout + "-diagnostics"),
        releaseIdentity: { schemaVersion: 1, title: layout === "agentvn" ? "AVN Exit AgentVN QA" : "AVN Exit Renpy QA",
          gameId: manifest.game_id, versionName: manifest.version, versionCode: 1001,
          androidApplicationId: `com.agentvn.qa.exit${layout}20261024` } });
    }
    p.status = "PREPARED"; p.finishedAt = new Date().toISOString(); save();
    validatePrepared(p, out);
    console.log(JSON.stringify({ status: p.status, out, files: p.sources.length, layouts: p.cells.map(c => c.layout) }));
  } catch (e) { p.status = "FAILED"; p.error = String(e.stack || e); save(); throw e; }
}
async function build(attempt) {
  const out = directory(attempt), p = read(path.join(out, "preparation.json"));
  assert.equal(p.status, "PREPARED"); validatePrepared(p, out);
  prerequisites(p.prerequisiteAttempts?.build, p.prerequisiteAttempts?.native);
  const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"],
    { encoding: "utf8", windowsHide: true });
  assert.equal(token.status, 0); assert.equal(token.stdout.trim().toLowerCase(), "true");
  const r = { status: "RUNNING", startedAt: new Date().toISOString(), scope: p.scope,
    isElevated: true, modelRequests: 0, preparation: fileEvidence(path.join(out, "preparation.json")), cells: [] };
  const reportFile = path.join(out, "build-report.json");
  assert(!fs.existsSync(reportFile));
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(r, null, 2));
  save();
  try {
    for (const c of p.cells) {
      const cell = { ...c, status: "RUNNING", startedAt: new Date().toISOString(), log: path.join(out, c.layout + "-runner.log") };
      r.cells.push(cell); save();
      const fd = fs.openSync(cell.log, "wx");
      try {
        const args = [path.join(p.workspace, "scripts/build-runtime-standalone-android.cjs"),
          "--OutputDir", c.outputDir, "--DiagnosticsDir", c.diagnosticsDir,
          "--CartridgePath", c.cartridge.path, "--ReleaseIdentity",
          "base64:" + Buffer.from(JSON.stringify(c.releaseIdentity)).toString("base64"),
          "--IconSource", "default", "--OptimizationProfile", "off",
          "--RunId", `qa-exit-20261024-${attempt}-${c.layout}`];
        cell.command = [process.execPath, ...args];
        const temp = path.join(out, "temporary"); fs.mkdirSync(temp, { recursive: true });
        const child = spawn(process.execPath, args, { cwd: p.workspace, windowsHide: true,
          env: { ...process.env, TEMP: temp, TMP: temp }, stdio: ["ignore", fd, fd] });
        cell.pid = child.pid; save();
        cell.exitCode = await new Promise((resolve, reject) => {
          child.once("error", reject); child.once("close", resolve);
        });
        assert.equal(cell.exitCode, 0, cell.log);
      } finally { fs.closeSync(fd); }
      cell.manifest = fileEvidence(path.join(c.diagnosticsDir, "package-build-manifest.json"));
      const manifest = read(cell.manifest.path);
      assert.equal(manifest.status, "PASS"); assert(manifest.artifacts.length >= 1);
      const apk = manifest.artifacts.filter(a => /\.apk$/i.test(a.path)); assert.equal(apk.length, 1);
      cell.apk = fileEvidence(apk[0].path);
      const evidenceFile = cell.apk.path + ".acceptance.json", evidence = read(evidenceFile);
      assert.equal(verifyProvenance(cell.apk.path, evidence).status, "PASS");
      assert.equal(evidence.sourceCartridge.sha256, c.cartridge.sha256);
      assert.equal(evidence.packageName, c.releaseIdentity.androidApplicationId);
      assert(evidence.symlinkProbe.success && evidence.symlinkProbe.isElevated);
      cell.provenance = fileEvidence(evidenceFile);
      cell.signingReports = fs.readdirSync(c.diagnosticsDir).filter(n => /^android-signing-.*\.json$/.test(n))
        .map(n => fileEvidence(path.join(c.diagnosticsDir, n)));
      assert.equal(cell.signingReports.length, 1);
      assert.equal(read(cell.signingReports[0].path).signed, true);
      cell.compilerSnapshot = require("./lib/android-compiler-snapshot.cjs").captureCompilerSnapshot(
        path.join(p.workspace, "GameCli_framework/src-tauri/gen/android/agentvn-runtime"),
        c.releaseIdentity.androidApplicationId, path.join(out, c.layout + "-compiler-snapshot"));
      cell.status = "PASS"; cell.finishedAt = new Date().toISOString(); save();
    }
    assert.equal(r.cells.length, 2); validatePrepared(p, out);
    r.status = "SOURCE_APKS_BUILT_DEVICE_NOT_RUN";
  } catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    // Pipeline finally restores original cloned source bytes; leave source tree and frozen products untouched.
    try { validatePrepared(p, out); r.sourceAndCloneRestoration = "PASS"; }
    catch (e) { r.status = "FAILED"; r.restorationError = String(e.stack || e); process.exitCode = 1; }
    r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, out, error: r.error, restorationError: r.restorationError }));
  }
}
if (require.main === module) {
  const [phase, attempt, buildAttempt, nativeAttempt] = process.argv.slice(2);
  assert(["prepare", "build"].includes(phase));
  (phase === "prepare" ? prepare(attempt, buildAttempt, nativeAttempt) : build(attempt))
    .catch(e => { console.error(e); process.exitCode = 1; });
}
module.exports = { directory, validatePrepared, prerequisites };
