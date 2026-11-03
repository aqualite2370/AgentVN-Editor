"use strict";
// Candidate publication only. Functional, installed and device verdicts remain separate.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), phase = process.argv[2], attempt = process.argv[3];
assert(["checkpoint", "build", "package"].includes(phase)); assert.match(attempt || "", /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-Repair-Release-20261024-01", out = path.join(base, phase + "-" + attempt);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size,
  modifiedUtc: fs.statSync(p).mtime.toISOString() });
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sourcePaths = () => execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0").filter(n =>
    /^(editor|GameCli_framework|backend|shared|scripts)\//.test(n) && fs.existsSync(path.join(root, n))
    && fs.lstatSync(path.join(root, n)).isFile());
const frozenReceipt = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const frozen = read(frozenReceipt);
assert.equal(frozen.status, "PASS");
const report = { status: "RUNNING", phase, startedAt: new Date().toISOString(), candidateVersion: "1.9.23",
  scope: "NEW_EDITOR_EXE_BUILD_NOT_INSTALLED_OR_UPGRADE_OR_ANDROID_ACCEPTANCE",
  modelRequests: 0, commands: [], installationReceipt: desc(frozenReceipt),
  frozenProducts: [frozen.executable, ...frozen.resources].map(f => {
    assert.equal(sha(f.path), f.sha256); return desc(f.path);
  }) };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function command(label, exe, args, expectedCode = 0) {
  const temp = path.join(out, "temporary"); fs.mkdirSync(temp, { recursive: true });
  const row = { label, command: [exe, ...args], status: "RUNNING", expectedCode,
    log: path.join(out, label + ".log"), startedAt: new Date().toISOString() };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ["ignore", fd, fd],
      env: { ...process.env, TEMP: temp, TMP: temp,
        AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Project-Directory-Write-20261024-01/red-02/isolated-small.vnproj",
        AGENTVN_WORKSPACE_OUTPUT: path.join(out, label + "-evidence") } });
    row.pid = child.pid; save();
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, expectedCode, `${label}: ${row.log}`);
    row.status = expectedCode === 0 ? "PASS" : "EXPECTED_REJECTION";
  } catch (error) { row.status = "FAILED"; throw error; }
  finally {
    fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.logIdentity = desc(row.log);
    save(); console.log(JSON.stringify({ label, status: row.status, log: row.log }));
  }
}
function prior(phaseName) {
  const file = path.join(base, phaseName + "-" + attempt, "report.json"), value = read(file);
  assert.equal(value.status, "PASS");
  for (const f of value.frozenProducts) assert.equal(sha(f.path), f.sha256);
  (report.prerequisites ??= []).push(desc(file)); return value;
}
function matchingProductSources(old) {
  return old.filter(f => /^(?:editor|GameCli_framework|backend|shared)[\\/]/.test(path.relative(root, f.path))
    && !/[\\/]agentvnDocIndex\.generated\.ts$/.test(f.path));
}
(async () => {
  save();
  if (phase === "checkpoint") {
    const checkpoint = `F:/AgentVN/Checkpoints/Editor-Repair-Release-20261024-${attempt}`;
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true }); report.checkpoint = checkpoint;
    const names = [...new Set(execFileSync("git", ["ls-files", "--modified", "--others", "--exclude-standard", "-z"],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean))];
    report.snapshots = [];
    for (const name of names) {
      const source = path.resolve(root, name); assert(source.startsWith(root + path.sep));
      if (!fs.existsSync(source)) { report.snapshots.push({ file: name, deleted: true }); continue; }
      const stat = fs.lstatSync(source); assert(stat.isFile(), "Do not follow checkpoint links: " + source);
      const copy = path.join(checkpoint, "worktree", name); fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(copy)); report.snapshots.push({ file: name, source: desc(source), copy: desc(copy) });
    }
    fs.writeFileSync(path.join(checkpoint, "worktree.patch"), execFileSync("git", ["diff", "--binary", "HEAD"],
      { cwd: root, maxBuffer: 128 * 1024 * 1024 }), { flag: "wx" });
    report.priorProducts = [];
    for (const name of ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe",
      "editor/src-tauri/binaries/agentvn-player.exe", "editor/src-tauri/binaries/creator-backend.exe"]) {
      const source = path.join(root, name), copy = path.join(checkpoint, "prior-products", name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(copy)); report.priorProducts.push({ original: desc(source), copy: desc(copy) });
    }
    const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
    if (fs.existsSync(bundle)) fs.cpSync(bundle, path.join(checkpoint, "prior-bundle"), { recursive: true, errorOnExist: true, force: false });
    await command("version-red", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "version-red.json")], 1);
    const red = read(path.join(out, "version-red.json"));
    assert.equal(red.current, "1.9.22"); assert.equal(red.highestHistorical.version, "1.9.22");
    assert(red.error.includes("must be newer than actual historical PE"));
    report.sources = sourcePaths().map(n => desc(path.join(root, n)));
    fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  } else if (phase === "build") {
    prior("checkpoint");
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, report.candidateVersion);
    report.sources = sourcePaths().map(n => desc(path.join(root, n)));
    await command("version-green", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "version-green.json")]);
    for (const name of ["package-version-contract", "package-version-encoding-regression-test",
      "renpy-title-text-runtime-test", "runtime-layout-profiles-test", "title-text-button-export-contract",
      "editor-transition-presentation-test", "project-export-directory-preferences-test",
      "project-save-asset-payload-contract", "runtime-save-queue-test", "runtime-exit-flow-test", "runtime-terminal-save-test"])
      await command(name, process.execPath, [`scripts/${name}.cjs`]);
    await command("exe-only", process.execPath, ["scripts/exe-only-installers-test.cjs", path.join(out, "exe-only")]);
    await command("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
    await command("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
    await command("gamecli-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
    await command("full-dev", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
    report.dev = desc(path.join(root, "AgentVN Dev.exe"));
    assert.equal(report.dev.sha256, sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
    assert(new Date(report.dev.modifiedUtc) >= new Date(report.commands.at(-1).startedAt));
    report.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    assert.equal(report.player.sha256, sha(path.join(root, "GameCli_framework/src-tauri/target/release/agentvn-player.exe")));
    await command("version-resources", process.execPath, ["scripts/editor-installed-version-resources-test.cjs"]);
    for (const f of matchingProductSources(report.sources)) assert.equal(sha(f.path), f.sha256);
  } else {
    const build = prior("build"); report.sources = build.sources;
    assert(build.commands.length > 10 && build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    for (const f of matchingProductSources(build.sources)) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(build.dev.path), build.dev.sha256); assert.equal(sha(build.player.path), build.player.sha256);
    const releaseDir = path.join(root, "releases/editor"), before = new Set(fs.readdirSync(releaseDir));
    await command("editor-nsis-package", "cmd.exe", ["/d", "/s", "/c", "package-installers.bat editor 1.9.23 --preserve-build-cache"]);
    const added = fs.readdirSync(releaseDir).filter(n => !before.has(n));
    assert.equal(added.length, 1); assert(/^AgentVN_Editor_v1\.9\.23_.*\.exe$/.test(added[0]));
    report.installer = desc(path.join(releaseDir, added[0]));
    report.editor = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
    report.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    report.backend = desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
    const versionsFile = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(read(versionsFile).editorVersion, report.candidateVersion); report.versions = desc(versionsFile);
    const retained = path.join(out, path.basename(report.installer.path));
    fs.copyFileSync(report.installer.path, retained, fs.constants.COPYFILE_EXCL); assert.equal(sha(retained), report.installer.sha256);
    report.retainedInstaller = desc(retained);
    for (const f of matchingProductSources(build.sources)) assert.equal(sha(f.path), f.sha256);
  }
  for (const f of report.frozenProducts) assert.equal(sha(f.path), f.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({
    status: report.status, phase, out, commands: report.commands.length, error: report.error })); });
