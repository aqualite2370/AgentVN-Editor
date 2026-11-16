"use strict";
// One native Runtime 0.32 delivery. Existing frozen releases remain immutable.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01";
const version = "1.9.81", previous = "1.9.80";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: "wx" });
};
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"];
const sources = ["shared/cartridge/renpyQuickBar.ts", "shared/cartridge/uiSkin.ts",
  "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
  "GameCli_framework/src/components/player/RenpyQuickBar.tsx",
  "GameCli_framework/src/components/player/DialogBox.tsx",
  "editor/src/components/advanced/RuntimeLayoutDesigner.tsx"];
const git = args => cp.execFileSync("git", args, {
  cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
}).trim();
const state = () => ({ head: git(["rev-parse", "HEAD"]), index: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"]))) });
function assertPreserved(checkpoint) {
  assert.equal(sha(checkpoint.daily.path), checkpoint.daily.sha256, "Do not replace the daily D Dev");
  assert.equal(sha(checkpoint.frozen.installer.path), checkpoint.frozen.installer.sha256);
  assert.equal(sha(checkpoint.frozen.player.path), checkpoint.frozen.player.sha256);
  const current = state();
  assert.equal(current.head, checkpoint.git.head); assert.equal(current.index.sha256, checkpoint.git.index.sha256);
  for (const source of checkpoint.sources) assert.equal(sha(source.path), source.sha256);
}
const mode = process.argv[2];
assert.equal(process.argv.length, 3);
assert(["--checkpoint", "--build", "--seal"].includes(mode));
(async () => {
  if (mode === "--checkpoint") {
    assert(!fs.existsSync(base), "Never overwrite prior evidence");
    const installerDirs = new Set();
    function visit(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) visit(file);
        else if (/^AgentVN_Editor_.*\.exe$/i.test(entry.name)) installerDirs.add(path.dirname(file));
      }
    }
    visit(path.join(root, "releases"));
    for (const entry of fs.readdirSync("F:/testavn", { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      for (const relative of ["installers/editor", "release/installers/editor"]) {
        const directory = path.join("F:/testavn", entry.name, relative);
        if (fs.existsSync(directory)) installerDirs.add(directory);
      }
    }
    const query = "$ErrorActionPreference='Stop';$dirs=ConvertFrom-Json $env:AGENTVN_QUICK_RELEASE_DIRS;" +
      "ConvertTo-Json -Compress -InputObject @($dirs|ForEach-Object{Get-ChildItem -LiteralPath $_ -File -Filter '*.exe'}|" +
      "ForEach-Object{@{path=$_.FullName;version=$_.VersionInfo.ProductVersion;bytes=$_.Length}})";
    const history = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", query], {
      encoding: "utf8", windowsHide: true,
      env: { ...process.env, AGENTVN_QUICK_RELEASE_DIRS: JSON.stringify([...installerDirs]) },
    }).replace(/^\uFEFF/, ""));
    const comparable = history.filter(r => /^\d+\.\d+\.\d+$/.test(r.version || ""));
    comparable.sort((a, b) => {
      const aa = a.version.split(".").map(Number), bb = b.version.split(".").map(Number);
      for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i];
      return 0;
    });
    assert.equal(comparable[0]?.version, previous, "Reassess candidate against the highest actual PE version");
    assert.equal(read(path.join(root, versions[0])).version, previous);
    const frozenBuild = read("F:/testavn/Editor-History-Release-1980-20261116-01/release/build.json");
    assert.equal(sha(frozenBuild.installer.path), frozenBuild.installer.sha256);
    // Use an actual retained byte copy, never a path that a subsequent build overwrites.
    const files = [];
    for (const relative of [...versions, ...sources, "AgentVN Dev.exe",
      "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe",
      "GameCli_framework/src-tauri/target/release/agentvn-player.exe",
      "editor/src-tauri/bundle-workspace/build-versions.json",
      "GameCli_framework/src-tauri/tauri.conf.json", "GameCli_framework/public/runtime-mode.json",
      "scripts/build-dev-launcher.ps1", "scripts/build-game-shell-windows.ps1",
      "scripts/package-installers.ps1", "plans/ACTIVE_TASKS.md", "AGENTS.md"]) {
      const source = path.join(root, relative);
      if (!fs.existsSync(source)) continue;
      assert(fs.lstatSync(source).isFile(), "Only regular checkpoint files");
      const target = path.join(base, "before", relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target)); files.push({ source: desc(source), retained: desc(target) });
    }
    const player = files.find(f => f.source.path === path.resolve(root, "editor/src-tauri/binaries/agentvn-player.exe")).retained;
    assert.equal(player.sha256, frozenBuild.player.sha256);
    const checkpoint = { status: "PASS_CHECKPOINT_NOT_BUILD", at: new Date().toISOString(), version,
      highestHistorical: comparable[0], history, files, sources: sources.map(f => desc(path.join(root, f))),
      daily: desc("D:/AgentVN/AgentVN Dev.exe"),
      frozen: { installer: frozenBuild.installer, player }, git: state(), modelRequests: 0, installations: 0 };
    assertPreserved(checkpoint); write(path.join(base, "checkpoint.json"), checkpoint);
    console.log(JSON.stringify({ status: checkpoint.status, version, files: files.length, base, highest: comparable[0] }));
    return;
  }
  const checkpoint = read(path.join(base, "checkpoint.json"));
  assertPreserved(checkpoint);
  assert.equal(read(path.join(root, versions[0])).version, version);
  if (mode === "--build") {
    assert(!fs.existsSync(path.join(base, "build-stages.json")), "Do not restart an existing build batch");
    const temp = path.join(base, "temp"); fs.mkdirSync(temp);
    const env = { ...process.env, TEMP: temp, TMP: temp, PYTHONDONTWRITEBYTECODE: "1" };
    const stages = { status: "RUNNING", startedAt: new Date().toISOString(), stages: [],
      nativePlayerBuilds: 0, standalonePlayerInstallers: 0, androidBuilds: 0, modelRequests: 0 };
    const save = () => fs.writeFileSync(path.join(base, "build-stages.json"), JSON.stringify(stages, null, 2));
    async function stage(name, command, args) {
      const log = path.join(base, name + ".log"), fd = fs.openSync(log, "wx");
      const row = { name, command, args, cwd: root, startedAt: new Date().toISOString(), status: "RUNNING" };
      stages.stages.push(row); save(); console.log("START", name);
      try {
        row.exitCode = await new Promise((resolve, reject) => {
          const child = cp.spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", fd, fd] });
          row.pid = child.pid; save(); child.once("error", reject); child.once("exit", resolve);
        });
        assert.equal(row.exitCode, 0, name + " failed; preserve its log");
        row.status = "PASS";
      } catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
      finally { fs.closeSync(fd); row.finishedAt = new Date().toISOString(); row.log = desc(log); save(); console.log(JSON.stringify(row)); }
    }
    try {
      await stage("typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix editor run typecheck"]);
      await stage("frontend-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix editor run build"]);
      await stage("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", path.join(root, "scripts/build-dev-launcher.ps1")]);
      assert(fs.readFileSync(path.join(base, "dev-build.log"), "utf8").includes("Dev container built:"));
      stages.nativePlayerBuilds = 1; save();
      assert.notEqual(sha(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")), checkpoint.frozen.player.sha256);
      await stage("package-editor-1981", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", path.join(root, "scripts/package-installers.ps1"), "-Target", "editor", "-Version", version,
        "-ReleaseRoot", "releases/editor-quick-placement-1981", "-ExpectedRoot", root, "-SkipClean"]);
      assertPreserved(checkpoint); stages.status = "PASS_BUILD_NOT_INSTALLED";
    } catch (error) { stages.status = "FAILED"; stages.error = error.stack; throw error; }
    finally { stages.finishedAt = new Date().toISOString(); save(); }
    return;
  }
  const stages = read(path.join(base, "build-stages.json"));
  assert.equal(stages.status, "PASS_BUILD_NOT_INSTALLED");
  assert.equal(stages.stages.length, 4); assert(stages.stages.every(s => s.status === "PASS"));
  const out = path.join(base, "release"); assert(!fs.existsSync(out));
  const sourceDir = path.join(root, "releases/editor-quick-placement-1981/editor");
  const names = fs.readdirSync(sourceDir).filter(n => n.startsWith(`AgentVN_Editor_v${version}_`) && n.endsWith(".exe"));
  assert.equal(names.length, 1);
  assert(!fs.readdirSync(sourceDir).some(n => /\.msi$/i.test(n)));
  const installerDir = path.join(out, "installers/editor"); fs.mkdirSync(installerDir, { recursive: true });
  const installer = path.join(installerDir, names[0]);
  fs.copyFileSync(path.join(sourceDir, names[0]), installer, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(installer), sha(path.join(sourceDir, names[0])));
  assert.equal(sha(path.join(root, "AgentVN Dev.exe")), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
  const audit = cp.spawnSync(process.execPath, [path.join(root, "scripts/editor-installer-resources-acceptance.cjs"),
    path.join(out, "payload"), version, installerDir], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 240000, maxBuffer: 24 * 1024 * 1024,
    env: { ...process.env, TEMP: path.join(base, "temp"), TMP: path.join(base, "temp") },
  });
  fs.writeFileSync(path.join(out, "payload.log"), (audit.stdout || "") + (audit.stderr || ""), { flag: "wx" });
  assert.ifError(audit.error); assert.equal(audit.status, 0);
  const payloadReport = path.join(out, "payload/installer-resource-report.json");
  assert.equal(read(payloadReport).status, "PASS");
  const bundle = path.join(root, "editor/src-tauri/bundle-workspace");
  const bundledSources = sources.filter(f => !f.startsWith("editor/")).map(f => {
    const bundled = path.join(bundle, f); assert.equal(sha(bundled), sha(path.join(root, f)));
    return { source: desc(path.join(root, f)), bundled: desc(bundled) };
  });
  const buildVersions = read(path.join(bundle, "build-versions.json"));
  assert.equal(buildVersions.editorVersion, version);
  assert.match(fs.readFileSync(path.join(bundle, "shared/cartridge/constants.ts"), "utf8"), /SUPPORTED_RUNTIME_VERSION = "0\.32\.0"/);
  assertPreserved(checkpoint);
  write(path.join(out, "build.json"), { status: "PASS_EDITOR_DEV_NSIS_RUNTIME032_PAYLOAD_NOT_INSTALLED",
    version, runtimeVersion: "0.32.0", at: new Date().toISOString(), installer: desc(installer),
    sourceInstaller: desc(path.join(sourceDir, names[0])), dev: desc(path.join(root, "AgentVN Dev.exe")),
    player: desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")),
    backend: desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe")),
    oldPlayer: checkpoint.frozen.player, sources: checkpoint.sources, bundledSources,
    buildVersions, payloadReport: desc(payloadReport), stages: desc(path.join(base, "build-stages.json")),
    checkpoint: desc(path.join(base, "checkpoint.json")), nativePlayerBuilds: 1,
    standalonePlayerInstallers: 0, msiInstallers: 0, androidBuilds: 0, modelRequests: 0,
    boundaries: ["Actual installed authoring/export/new Player consumption/old binary rejection still NOT_RUN",
      "No new device/upgrade matrix; daily D and frozen 1.9.80 unchanged"] });
  console.log(JSON.stringify({ status: "PASS_RELEASE_NOT_INSTALLED", version, base, installer: desc(installer) }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
