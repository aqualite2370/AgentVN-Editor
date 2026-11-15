"use strict";
// One new Editor-only candidate for the metadata recovery product delta.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const homeOrdering = process.argv[3] === "--home-ordering";
const base = homeOrdering ? "F:/testavn/Editor-Home-Save-Release-1977-20261116-01"
  : "F:/testavn/Editor-Autosave-Release-1976-20261116-01";
const version = homeOrdering ? "1.9.77" : "1.9.76";
const previousVersion = homeOrdering ? "1.9.76" : "1.9.75";
const releaseDirectory = homeOrdering ? "editor-home-save-1977" : "editor-autosave-1976";
const packageLogName = homeOrdering ? "package-editor-1977.log" : "package-editor-1976.log";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
function write(f, value) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(value, null, 2), { flag: "wx" });
}
const mode = process.argv[2];
assert(["--checkpoint", "--seal"].includes(mode)); assert.equal(process.argv.length, homeOrdering ? 4 : 3);
if (mode === "--checkpoint") {
  assert(!fs.existsSync(base), "Keep existing evidence");
  const directories = [];
  const visit = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (/^AgentVN_Editor_.*\.exe$/i.test(item.name)) directories.push(path.dirname(file));
    }
  };
  visit(path.join(root, "releases"));
  for (const item of fs.readdirSync("F:/testavn", { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    if (/^Editor-Release-/.test(item.name)) {
      const dir = path.join("F:/testavn", item.name, "installers/editor");
      if (fs.existsSync(dir)) directories.push(dir);
    }
  }
  directories.push("F:/testavn/Editor-Recovery-20261115-01/release/installers/editor");
  const query = "$ErrorActionPreference='Stop';$dirs=ConvertFrom-Json $env:AGENTVN_HISTORY_DIRS;" +
    "ConvertTo-Json -Compress -InputObject @($dirs|ForEach-Object{Get-ChildItem -LiteralPath $_ -File -Filter '*.exe'}|" +
    "ForEach-Object{@{path=$_.FullName;version=$_.VersionInfo.ProductVersion;bytes=$_.Length}})";
  const history = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", query], {
    encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_HISTORY_DIRS: JSON.stringify([...new Set(directories)]) },
  }).replace(/^\uFEFF/, ""));
  const comparable = history.filter(row => /^\d+\.\d+\.\d+$/.test(row.version || ""));
  comparable.sort((a, b) => {
    const aa = a.version.split(".").map(Number), bb = b.version.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i];
    return 0;
  });
  assert.equal(comparable[0].version, previousVersion, "Reassess candidate if a newer real PE exists");
  assert.equal(read(path.join(root, "editor/package.json")).version, previousVersion);
  const files = [];
  function backup(relative) {
    const source = path.join(root, relative), target = path.join(base, "before", relative);
    if (!fs.existsSync(source)) return;
    const item = fs.lstatSync(source); assert(!item.isSymbolicLink());
    if (item.isDirectory()) {
      for (const name of fs.readdirSync(source)) backup(path.join(relative, name));
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(source), sha(target)); files.push({ source, retained: desc(target) });
    }
  }
  for (const relative of ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
    "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json", "AgentVN Dev.exe",
    "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/target/release/bundle",
    "editor/src/components/editor/useEditorProjectAutosave.ts", "editor/src/api/backendClient.ts",
    "plans/ACTIVE_TASKS.md", "AGENTS.md"]) backup(relative);
  const daily = "D:/AgentVN/AgentVN Dev.exe";
  write(path.join(base, "checkpoint.json"), { status: "PASS_CHECKPOINT_NOT_BUILD", at: new Date().toISOString(),
    nextVersion: version, history, highestHistorical: comparable[0], files, daily: desc(daily),
    head: cp.execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
    index: desc(cp.execFileSync("git", ["rev-parse", "--git-path", "index"],
      { cwd: root, encoding: "utf8", windowsHide: true }).trim()),
    models: 0, installations: 0 });
  console.log(JSON.stringify({ status: "PASS", base, version, files: files.length, highest: comparable[0] }));
} else {
  const before = read(path.join(base, "checkpoint.json")), out = path.join(base, "release");
  assert(!fs.existsSync(out));
  const packageLog = path.join(base, packageLogName);
  assert(fs.readFileSync(packageLog, "utf8").includes("Packaging complete."));
  assert.equal(read(path.join(root, "editor/src-tauri/tauri.conf.json")).version, version);
  const source = path.join(root, "releases", releaseDirectory, "editor");
  const names = fs.readdirSync(source).filter(n => n.startsWith(`AgentVN_Editor_v${version}_`) && n.endsWith(".exe"));
  assert.equal(names.length, 1);
  const target = path.join(out, "installers/editor"); fs.mkdirSync(target, { recursive: true });
  const installer = path.join(target, names[0]);
  fs.copyFileSync(path.join(source, names[0]), installer, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(installer), sha(path.join(source, names[0])));
  assert.equal(sha(path.join(root, "AgentVN Dev.exe")), sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")));
  assert.equal(sha(before.daily.path), before.daily.sha256);
  const audit = cp.spawnSync(process.execPath, [path.join(root, "scripts/editor-installer-resources-acceptance.cjs"),
    path.join(out, "payload"), version, target], { encoding: "utf8", windowsHide: true, timeout: 240000,
    maxBuffer: 24 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, "payload.log"), (audit.stdout || "") + (audit.stderr || ""), { flag: "wx" });
  assert.ifError(audit.error); assert.equal(audit.status, 0, "Keep failed payload audit");
  const payloadReport = path.join(out, "payload/installer-resource-report.json");
  assert.equal(read(payloadReport).status, "PASS");
  write(path.join(out, "build.json"), { status: "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN",
    version, at: new Date().toISOString(), installer: desc(installer), sourceInstaller: desc(path.join(source, names[0])),
    dev: desc(path.join(root, "AgentVN Dev.exe")), player: desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")),
    backend: desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe")), payloadReport: desc(payloadReport),
    source: desc(path.join(root, homeOrdering ? "editor/src/api/backendClient.ts" :
      "editor/src/components/editor/useEditorProjectAutosave.ts")),
    packageLog: desc(packageLog), checkpoint: desc(path.join(base, "checkpoint.json")),
    standalonePlayerBuilds: 0, androidBuilds: 0, modelRequests: 0,
    boundaries: [`New Editor ${homeOrdering ? "home-save ordering" : "metadata recovery"} delta; frozen ${previousVersion} and D daily unchanged; actual install still pending`] });
  console.log(JSON.stringify(read(path.join(out, "build.json"))));
}
