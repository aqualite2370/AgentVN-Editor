"use strict";
// One new Editor-only candidate for the metadata recovery product delta.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const homeOrdering = process.argv[3] === "--home-ordering";
const graphIntegrity = process.argv[3] === "--graph-integrity";
const eventIntegrity = process.argv[3] === "--event-integrity";
const historyRevision = process.argv[3] === "--history-revision";
const base = historyRevision ? "F:/testavn/Editor-History-Release-1980-20261116-01"
  : eventIntegrity ? "F:/testavn/Editor-Event-Release-1979-20261116-01"
  : graphIntegrity ? "F:/testavn/Editor-Graph-Release-1978-20261116-01"
  : homeOrdering ? "F:/testavn/Editor-Home-Save-Release-1977-20261116-01"
  : "F:/testavn/Editor-Autosave-Release-1976-20261116-01";
const version = historyRevision ? "1.9.80" : eventIntegrity ? "1.9.79" : graphIntegrity ? "1.9.78" : homeOrdering ? "1.9.77" : "1.9.76";
const previousVersion = historyRevision ? "1.9.79" : eventIntegrity ? "1.9.78" : graphIntegrity ? "1.9.77" : homeOrdering ? "1.9.76" : "1.9.75";
const releaseDirectory = historyRevision ? "editor-history-1980" : eventIntegrity ? "editor-events-1979" : graphIntegrity ? "editor-graph-1978" : homeOrdering ? "editor-home-save-1977" : "editor-autosave-1976";
const packageLogName = historyRevision ? "package-editor-1980.log" : eventIntegrity ? "package-editor-1979.log" : graphIntegrity ? "package-editor-1978-02.log" : homeOrdering ? "package-editor-1977.log" : "package-editor-1976.log";
const historySources = ["editor/src/utils/editorProjectPersistence.ts",
  "editor/src/components/timeline/ProjectTimelinePanel.tsx",
  "editor/src/components/editor/GraphHistoryShortcuts.tsx", "editor/src/utils/graphHistoryDescription.ts"];
const eventSources = ["editor/src/components/command-editors/CommandListEditor.tsx",
  "editor/src/components/editor/InspectorPanel.tsx", "editor/src/components/timeline/ProjectTimelinePanel.tsx"];
const graphSources = ["editor/src/store/editorStore.ts", "editor/src/utils/nodeFactory.ts",
  "editor/src/components/editor/VisualNovelEditor.tsx", "editor/src/components/editor/InspectorPanel.tsx",
  "editor/src/components/editor/EditorToolbar.tsx"];
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
function write(f, value) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(value, null, 2), { flag: "wx" });
}
const mode = process.argv[2];
assert(["--checkpoint", "--seal"].includes(mode)); assert.equal(process.argv.length, homeOrdering || graphIntegrity || eventIntegrity || historyRevision ? 4 : 3);
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
    if (graphIntegrity || eventIntegrity || historyRevision) {
      const dir = path.join("F:/testavn", item.name, "release/installers/editor");
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
    "editor/src-tauri/binaries/creator-backend.exe",
    ...(historyRevision ? historySources : eventIntegrity ? eventSources : graphIntegrity ? graphSources : ["editor/src-tauri/target/release/bundle"]),
    "editor/src/components/editor/useEditorProjectAutosave.ts", "editor/src/api/backendClient.ts",
    "plans/ACTIVE_TASKS.md", "AGENTS.md"]) backup(relative);
  const frozenPrevious = historyRevision ? read("F:/testavn/Editor-Event-Release-1979-20261116-01/release/build.json")
    : eventIntegrity ? read("F:/testavn/Editor-Graph-Release-1978-20261116-01/release/build.json")
    : graphIntegrity ? read("F:/testavn/Editor-Home-Save-Release-1977-20261116-01/release/build.json") : null;
  if (frozenPrevious) {
    assert.equal(frozenPrevious.version, previousVersion);
    assert.equal(sha(frozenPrevious.installer.path), frozenPrevious.installer.sha256);
  }
  const daily = "D:/AgentVN/AgentVN Dev.exe";
  write(path.join(base, "checkpoint.json"), { status: "PASS_CHECKPOINT_NOT_BUILD", at: new Date().toISOString(),
    nextVersion: version, history, highestHistorical: comparable[0], files, daily: desc(daily),
    frozenPrevious: frozenPrevious?.installer,
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
  if (before.frozenPrevious) assert.equal(sha(before.frozenPrevious.path), before.frozenPrevious.sha256);
  const audit = cp.spawnSync(process.execPath, [path.join(root, "scripts/editor-installer-resources-acceptance.cjs"),
    path.join(out, "payload"), version, target], { encoding: "utf8", windowsHide: true, timeout: 240000,
    maxBuffer: 24 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, "payload.log"), (audit.stdout || "") + (audit.stderr || ""), { flag: "wx" });
  assert.ifError(audit.error); assert.equal(audit.status, 0, "Keep failed payload audit");
  const payloadReport = path.join(out, "payload/installer-resource-report.json");
  assert.equal(read(payloadReport).status, "PASS");
  if (graphIntegrity) {
    const rejected = fs.readFileSync(path.join(base, "package-editor-1978.log"), "utf8");
    assert(rejected.includes("ReleaseRoot must stay inside the canonical workspace"));
    assert(!rejected.includes("Packaging complete."));
    assert(fs.readFileSync(path.join(base, "dev-build.log"), "utf8").includes("Dev container built:"));
    assert(fs.readFileSync(path.join(base, "frontend-build.log"), "utf8").includes("built in"));
  }
  if (eventIntegrity) {
    assert(fs.readFileSync(path.join(base, "dev-build.log"), "utf8").includes("Dev container built:"));
    assert(fs.readFileSync(path.join(base, "frontend-build.log"), "utf8").includes("built in"));
    assert.equal(read("F:/testavn/Editor-Event-Boundaries-20261116-01/terminal-audit-01.json").status,
      "PASS_SOURCE_EVENT_AND_TIMELINE_BOUNDARIES");
  }
  if (historyRevision) {
    const evidence = read("F:/testavn/Editor-Timeline-Revision-20261116-01/terminal-audit-02.json");
    assert.equal(evidence.status, "PASS_SOURCE_HISTORY_AND_CONFIRMED_TIMELINE_REVISION_NOT_INSTALLED");
    for (const name of ["dev-build.log", "frontend-build.log", "typecheck.log"]) assert(fs.statSync(path.join(base, name)).size > 0);
    assert(fs.readFileSync(path.join(base, "dev-build.log"), "utf8").includes("Dev container built:"));
    assert(fs.readFileSync(path.join(base, "frontend-build.log"), "utf8").includes("built in"));
    const delivery = read("F:/testavn/Editor-Timeline-Revision-20261116-01/source-delivery-01.json");
    assert.equal(delivery.status, "PASS");
    for (const relative of historySources) {
      const original = before.files.find(f => path.resolve(f.source) === path.resolve(root, relative));
      assert(original); assert.equal(sha(path.join(root, relative)), original.retained.sha256);
    }
  }
  write(path.join(out, "build.json"), { status: "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN",
    version, at: new Date().toISOString(), installer: desc(installer), sourceInstaller: desc(path.join(source, names[0])),
    dev: desc(path.join(root, "AgentVN Dev.exe")), player: desc(path.join(root, "editor/src-tauri/binaries/agentvn-player.exe")),
    backend: desc(path.join(root, "editor/src-tauri/binaries/creator-backend.exe")), payloadReport: desc(payloadReport),
    source: desc(path.join(root, historyRevision ? historySources[0] : eventIntegrity ? eventSources[0] : graphIntegrity ? graphSources[0] : homeOrdering ? "editor/src/api/backendClient.ts" :
      "editor/src/components/editor/useEditorProjectAutosave.ts")),
    ...(graphIntegrity ? { graphSources: graphSources.map(f => desc(path.join(root, f))) } : {}),
    ...(eventIntegrity ? { eventSources: eventSources.map(f => desc(path.join(root, f))),
      logs: ["typecheck.log", "frontend-build.log", "dev-build.log"].map(f => desc(path.join(base, f))) } : {}),
    ...(historyRevision ? { historySources: historySources.map(f => desc(path.join(root, f))),
      sourceEvidence: desc("F:/testavn/Editor-Timeline-Revision-20261116-01/terminal-audit-02.json"),
      logs: ["typecheck.log", "frontend-build.log", "dev-build.log"].map(f => desc(path.join(base, f))) } : {}),
    ...(graphIntegrity ? { logs: ["typecheck.log", "frontend-build.log", "dev-build.log"].map(f => desc(path.join(base, f))),
      rejectedPackagingPreflight: { ...desc(path.join(base, "package-editor-1978.log")),
        reason: "ReleaseRoot outside canonical workspace rejected before product packaging; guard preserved",
        productPackageBuilds: 0 } } : {}),
    packageLog: desc(packageLog), checkpoint: desc(path.join(base, "checkpoint.json")),
    standalonePlayerBuilds: 0, androidBuilds: 0, modelRequests: 0,
    boundaries: [`New Editor ${historyRevision ? "confirmed timeline revision and specific undo feedback" : eventIntegrity ? "event reorder and timeline restoration ownership" : graphIntegrity ? "atomic graph deletion and route import" : homeOrdering ? "home-save ordering" : "metadata recovery"} delta; frozen ${previousVersion} and D daily unchanged; actual install still pending`] });
  console.log(JSON.stringify(read(path.join(out, "build.json"))));
}
