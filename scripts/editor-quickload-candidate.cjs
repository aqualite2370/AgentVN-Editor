"use strict";
// Distinct 1.9.26 repair candidate; publication never implies functional acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto"), { spawn, execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), version = "1.9.26", date = "20261026";
const [phase, attempt = "01"] = process.argv.slice(2);
assert(["checkpoint", "build", "package", "payload", "install"].includes(phase));
assert.match(attempt, /^\d{2}$/);
const base = `F:/AgentVN/QA/Editor-${version}-${date}-01`, out = path.join(base, `${phase}-${attempt}`);
assert(!fs.existsSync(out), "Fresh evidence only");
fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  modifiedUtc: fs.statSync(f).mtime.toISOString() });
const unchanged = files => files.forEach(f => assert.equal(sha(f.path), f.sha256, f.path));
const priorBuildFile = "F:/AgentVN/QA/Editor-1.9.25-20261025-01/build-01/report.json";
const oldInstallFile = "F:/AgentVN/QA/Editor-1.9.25-20261025-01/installation.json";
const previous = read(priorBuildFile), installed = read(oldInstallFile);
assert.equal(previous.status, "PASS"); assert.equal(installed.status, "PASS");
const priorFrozenProducts = previous.frozen ?? previous.frozenProducts;
assert(Array.isArray(priorFrozenProducts), "Prior build report must expose frozen products");
const frozenProducts = [...priorFrozenProducts, installed.package, installed.executable, ...installed.resources];
const report = { status: "RUNNING", startedAt: new Date().toISOString(), phase, candidateVersion: version,
  scope: "NEW_EDITOR_NSIS_CANDIDATE_NOT_FUNCTIONAL_ACCEPTANCE_OR_UPGRADE", modelRequests: 0,
  priorBuild: desc(priorBuildFile), frozenInstallation: desc(oldInstallFile), frozenProducts, commands: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 192 * 1024 * 1024 });
const sourceNames = () => git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .toString("utf8").split("\0").filter(n => /^(editor|GameCli_framework|backend|shared|scripts)\//.test(n)
    && fs.existsSync(path.join(root, n)) && fs.lstatSync(path.join(root, n)).isFile());
const productSources = files => files.filter(f => /^(editor|GameCli_framework|backend|shared)[\\/]/.test(path.relative(root, f.path))
  && !/[\\/]agentvnDocIndex\.generated\.ts$/.test(f.path));
function prior(kind) {
  const file = path.join(base, `${kind}-${attempt}/report.json`), r = read(file);
  assert.equal(r.status, "PASS"); assert.equal(r.candidateVersion, version); unchanged(r.frozenProducts);
  (report.prerequisites ??= []).push(desc(file)); return r;
}
async function command(label, exe, args, expected = 0) {
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary, { recursive: true });
  const row = { label, command: [exe, ...args], expected, status: "RUNNING", startedAt: new Date().toISOString(),
    log: path.join(out, `${label}.log`) };
  report.commands.push(row); save();
  const fd = fs.openSync(row.log, "wx");
  try {
    const env = { ...process.env, TEMP: temporary, TMP: temporary,
      PSModulePath: path.join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/Modules"),
      AGENTVN_TEST_PROJECT: "F:/AgentVN/QA/Project-Directory-Write-20261024-01/red-02/isolated-small.vnproj",
      AGENTVN_WORKSPACE_OUTPUT: path.join(out, `${label}-evidence`) };
    delete env.AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED;
    const child = spawn(exe, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
    row.pid = child.pid; save(); console.log(`START ${label} PID=${child.pid}`);
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, expected, row.log); row.status = expected === 0 ? "PASS" : "EXPECTED_REJECTION";
  } catch (e) { row.status = "FAILED"; throw e; }
  finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.logIdentity = desc(row.log); save();
    console.log(`${label} ${row.status}`); }
}
(async () => {
  save(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  unchanged(frozenProducts);
  if (phase === "checkpoint") {
    unchanged([previous.dev, previous.player]);
    unchanged(previous.sources.filter(f => /[\\/]GameCli_framework[\\/]src[\\/]store[\\/]runtimeStore\.ts$/.test(f.path)));
    const deviceFile = "F:/AgentVN/QA/Android-Package-20261021-01/quickload-device-02/terminal-audit.json";
    assert.equal(read(deviceFile).status, "PASS_SCOPED_SOURCE_DEVICE_EVIDENCE"); report.sourceDeviceAudit = desc(deviceFile);
    const checkpoint = `F:/AgentVN/Checkpoints/Editor-${version}-${date}-01`;
    assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint); report.checkpoint = checkpoint;
    const names = [...new Set(git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"])
      .toString("utf8").split("\0").filter(Boolean))];
    report.snapshots = [];
    for (const name of names) {
      const file = path.resolve(root, name); assert(file.startsWith(root + path.sep));
      if (!fs.existsSync(file)) { report.snapshots.push({ file: name, deleted: true }); continue; }
      assert(fs.lstatSync(file).isFile(), "Never follow checkpoint links");
      const copy = path.join(checkpoint, "worktree", name); fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(file), sha(copy));
      report.snapshots.push({ file: name, source: desc(file), copy: desc(copy) });
    }
    fs.writeFileSync(path.join(checkpoint, "tracked.patch"),
      git(["-c", "core.safecrlf=false", "diff", "--binary", "HEAD"]), { flag: "wx" });
    report.priorProducts = [];
    for (const name of ["AgentVN Dev.exe", "editor/src-tauri/binaries/agentvn-player.exe",
      "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]) {
      const source = path.join(root, name), copy = path.join(checkpoint, "prior-products", name);
      fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(copy)); report.priorProducts.push({ source: desc(source), copy: desc(copy) });
    }
    const bundle = path.join(root, "editor/src-tauri/target/release/bundle");
    if (fs.existsSync(bundle)) fs.cpSync(bundle, path.join(checkpoint, "prior-bundle"),
      { recursive: true, errorOnExist: true, force: false });
    const reportFile = "F:/AgentVN/QA/Android-Package-20261021-01/EXIT-AFTER-QUICKLOAD-20261025.md";
    fs.copyFileSync(reportFile, path.join(checkpoint, path.basename(reportFile)), fs.constants.COPYFILE_EXCL);
    await command("version-green", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "version-green.json")]);
    const green = read(path.join(out, "version-green.json"));
    assert.equal(green.current, version);
    assert.equal(green.highestHistorical.version, "1.9.25");
    report.versionGreen = desc(path.join(out, "version-green.json"));
    report.sources = sourceNames().map(n => desc(path.join(root, n)));
  } else if (phase === "build") {
    const cp = prior("checkpoint"); unchanged(cp.snapshots.filter(f => f.copy).map(f => f.copy));
    assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, version);
    report.sources = sourceNames().map(n => desc(path.join(root, n)));
    await command("version-green", process.execPath, ["scripts/editor-forward-version-test.cjs", path.join(out, "version-green.json")]);
    for (const name of ["package-version-contract", "package-version-encoding-regression-test", "installer-payload-provenance-test",
      "renpy-title-text-runtime-test", "runtime-layout-profiles-test", "title-text-button-export-contract",
      "editor-transition-presentation-test", "project-export-directory-preferences-test", "project-save-asset-payload-contract",
      "preview-save-isolation-contract", "quick-save-runtime-test", "runtime-save-queue-test", "runtime-exit-flow-test",
      "runtime-terminal-save-test", "main-menu-exit-contract"])
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
    unchanged(productSources(report.sources));
  } else if (phase === "package") {
    const build = prior("build");
    assert.equal(build.commands.length, 22); assert(build.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    unchanged(productSources(build.sources)); unchanged([build.dev, build.player]); report.sources = build.sources;
    const release = path.join(root, "releases/editor"), before = new Set(fs.readdirSync(release));
    await command("editor-nsis-package", "cmd.exe", ["/d", "/s", "/c", `package-installers.bat editor ${version} --preserve-build-cache`]);
    const added = fs.readdirSync(release).filter(n => !before.has(n));
    assert.equal(added.length, 1); assert(added[0].startsWith(`AgentVN_Editor_v${version}_`) && added[0].endsWith(".exe"));
    report.installer = desc(path.join(release, added[0]));
    const retained = path.join(out, added[0]); fs.copyFileSync(report.installer.path, retained, fs.constants.COPYFILE_EXCL);
    report.retainedInstaller = desc(retained); assert.equal(report.retainedInstaller.sha256, report.installer.sha256);
    report.editor = desc(path.join(root, "editor/src-tauri/target/release/agentvn-editor.exe"));
    report.player = desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe"));
    report.backend = desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe"));
    const metadata = path.join(root, "editor/src-tauri/bundle-workspace/build-versions.json");
    assert.equal(read(metadata).editorVersion, version); report.versions = desc(metadata);
    unchanged(productSources(build.sources));
  } else if (phase === "payload") {
    const packaged = prior("package"); unchanged([packaged.installer, packaged.retainedInstaller]);
    await command("actual-nsis-payload", process.execPath, ["scripts/editor-installer-resources-acceptance.cjs",
      path.join(out, "deployments"), version, path.dirname(packaged.installer.path)]);
    const file = path.join(out, "deployments/installer-resource-report.json"), payload = read(file);
    assert.equal(payload.status, "PASS"); assert.equal(payload.installers.length, 1); assert.equal(payload.deployments.length, 1);
    assert.equal(payload.installerFormat, "nsis"); assert.equal(payload.installers[0].sha256, packaged.installer.sha256);
    report.installerFormat = "nsis"; report.payloadReport = desc(file); report.deployments = payload.deployments;
    report.archived = [packaged.retainedInstaller];
  } else {
    prior("payload"); prior("checkpoint");
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/current-candidate-install-session.ps1",
      "-QaRoot", base, "-ExpectedVersion", version, "-CandidateDate", date];
    await command("install-boundaries", "powershell.exe", [...args, "-Action", "SelfTest"]);
    await command("actual-nsis-install", "powershell.exe", [...args, "-Action", "Install"]);
    const file = path.join(base, "installation.json"), r = read(file);
    assert.equal(r.status, "PASS"); assert.equal(r.metadataRestoration, "PASS");
    assert.equal(r.executable.version, version); unchanged([r.executable, ...r.resources, ...r.protectedFiles]);
    report.installation = desc(file);
  }
  unchanged(frozenProducts); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    if (phase === "checkpoint" && report.status === "PASS")
      fs.writeFileSync(path.join(report.checkpoint, "manifest.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ phase, status: report.status, out, commands: report.commands.length, error: report.error })); });
