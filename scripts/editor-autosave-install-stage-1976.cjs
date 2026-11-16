"use strict";
// Seal a single targeted actual upgrade/recovery job; do not reuse retired profiles.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const homeFollowup = process.argv[2] === "--home-ordering-followup";
const homeOrdering = homeFollowup || process.argv[2] === "--home-ordering";
const graphFollowup = process.argv[2] === "--graph-integrity-followup";
const graphIntegrity = graphFollowup || process.argv[2] === "--graph-integrity";
const eventRemaining = process.argv[2] === "--event-integrity-remaining";
const eventFollowup = eventRemaining || process.argv[2] === "--event-integrity-followup";
const eventIntegrity = eventFollowup || process.argv[2] === "--event-integrity";
const historyRevision = process.argv[2] === "--history-revision";
const remaining = process.argv[2] === "--remaining";
const followup = remaining || process.argv[2] === "--followup";
assert(process.argv.length === (followup || homeOrdering || graphIntegrity || eventIntegrity || historyRevision ? 3 : 2));
const root = path.resolve(__dirname, ".."), base = path.resolve(historyRevision
  ? "F:/testavn/Windows-Isolated-1980-20261116-01" : eventIntegrity
  ? "F:/testavn/Windows-Isolated-1979-20261116-" + (eventRemaining ? "03" : eventFollowup ? "02" : "01") : graphIntegrity
  ? "F:/testavn/Windows-Isolated-1978-20261116-" + (graphFollowup ? "02" : "01") : homeOrdering
  ? "F:/testavn/Windows-Isolated-1977-20261116-" + (homeFollowup ? "02" : "01")
  : "F:/testavn/Windows-Isolated-1976-20261116-" + (remaining ? "05" : followup ? "04" : "01"));
const priorScope = "F:/testavn/Windows-Isolated-1972-20261114-01";
const release = historyRevision ? "F:/testavn/Editor-History-Release-1980-20261116-01/release"
  : eventIntegrity ? "F:/testavn/Editor-Event-Release-1979-20261116-01/release"
  : graphIntegrity ? "F:/testavn/Editor-Graph-Release-1978-20261116-01/release"
  : homeOrdering ? "F:/testavn/Editor-Home-Save-Release-1977-20261116-01/release"
  : "F:/testavn/Editor-Autosave-Release-1976-20261116-01/release";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const build = read(path.join(release, "build.json"));
const old = read(historyRevision ? "F:/testavn/Editor-Event-Release-1979-20261116-01/release/build.json"
  : eventIntegrity ? "F:/testavn/Editor-Graph-Release-1978-20261116-01/release/build.json"
  : graphIntegrity ? "F:/testavn/Editor-Home-Save-Release-1977-20261116-01/release/build.json"
  : homeOrdering ? "F:/testavn/Editor-Autosave-Release-1976-20261116-01/release/build.json"
  : "F:/testavn/Editor-Recovery-20261115-01/release/build.json");
assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
assert.equal(build.version, historyRevision ? "1.9.80" : eventIntegrity ? "1.9.79" : graphIntegrity ? "1.9.78" : homeOrdering ? "1.9.77" : "1.9.76");
assert.equal(old.version, historyRevision ? "1.9.79" : eventIntegrity ? "1.9.78" : graphIntegrity ? "1.9.77" : homeOrdering ? "1.9.76" : "1.9.75");
assert.equal(sha(build.installer.path), build.installer.sha256); assert.equal(sha(old.installer.path), old.installer.sha256);
assert.equal(sha(build.payloadReport.path), build.payloadReport.sha256);
assert.equal(read(build.payloadReport.path).status, "PASS");
if (eventFollowup) {
  const previous = "F:/testavn/Windows-Isolated-1979-20261116-01";
  const retired = read(path.join(previous, "account-retirement-01.json"));
  assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
  const failure = read(path.join(previous, "resource-01/report.json"));
  assert.equal(failure.status, "FAILED"); assert.equal(failure.cleanupStatus, "PASS");
  assert(failure.stages[2].error.includes("command-card-summary"));
  assert.equal(sha(read(path.join(previous, "install-new.json")).executable.path),
    read(path.join(previous, "install-new.json")).executable.sha256);
}
if (eventRemaining) {
  const previous = "F:/testavn/Windows-Isolated-1979-20261116-02";
  const retired = read(path.join(previous, "account-retirement-01.json"));
  assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
  const failure = read(path.join(previous, "resource-01/report.json"));
  assert.equal(failure.status, "FAILED"); assert.equal(failure.cleanupStatus, "PASS");
  assert(failure.stages.slice(0, 4).every(s => s.status === "PASS"));
  assert(failure.stages[4].error.includes("exact newer graph"));
  const capture = read(path.join(previous, "backup-diagnostic-01.json"));
  assert.equal(capture.status, "PASS_CAPTURE_ONLY_NOT_PRODUCT_ASSERTION");
  for (const file of capture.files) assert.equal(sha(file.path), file.sha256);
}
let inheritedFixture;
if (graphFollowup) {
  const previous = "F:/testavn/Windows-Isolated-1978-20261116-01";
  const retired = read(path.join(previous, "account-retirement-01.json"));
  assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
  assert.equal(read(path.join(previous, "account-controller.json")).status, "FINISHED");
  const failure = read(path.join(previous, "resource-01/report.json"));
  assert.equal(failure.status, "FAILED"); assert.equal(failure.cleanupStatus, "PASS");
  assert(failure.stages.slice(0, 4).every(s => s.status === "PASS"));
  assert(failure.stages[4].error.includes("0 !== 100"));
  assert.equal(sha(retired.databaseEvidence.path), retired.databaseEvidence.sha256);
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(retired.databaseEvidence.path, { readOnly: true });
  try {
    const row = database.prepare("SELECT project_json FROM editor_project_details WHERE project_id = ?")
      .get("qa-editor-graph-integrity-1978");
    assert(row); inheritedFixture = JSON.parse(row.project_json); assert.equal(inheritedFixture.nodes.length, 103);
  } finally { database.close(); }
}
if (homeFollowup) {
  const previous = "F:/testavn/Windows-Isolated-1977-20261116-01";
  const control = read(path.join(previous, "account-controller.json"));
  assert.equal(control.status, "FINISHED"); assert.equal(control.cleanup.profileLoaded, false);
  assert.equal(control.cleanup.ownedProcesses.length, 0); assert.equal(control.cleanup.accountDisabled, true);
  const failed = read(path.join(previous, "resource-01/report.json"));
  assert.equal(failed.status, "FAILED"); assert(failed.error.includes("strict mode violation"));
  assert.equal(failed.stages[0].status, "PASS"); assert.equal(failed.stages[1].status, "PASS");
  const existing = read(path.join(previous, "install-new.json"));
  assert.equal(existing.status, "PASS"); assert.equal(sha(existing.executable.path), existing.executable.sha256);
}
if (followup) {
  const nativePoints = require("./lib/native-editor-recovery-files.cjs").recoveryPoints(
    "F:/testavn/Editor-Recovery-20261115-01/native-metadata-01/data/backup-timeline", "project_mwiaqn42_0_af61e3cf18");
  assert(nativePoints.length >= 3, "Parse existing real native project/sidecar bytes before any new account");
  assert(nativePoints.every(p => p.meta.projectId === p.value.project_id && p.meta.trigger === "auto_save"));
  const prior = "F:/testavn/Windows-Isolated-1976-20261116-01";
  assert.equal(read(path.join(prior, "account-retirement-01.json")).status, "PASS");
  const installed = read(path.join(prior, "install-new.json"));
  assert.equal(installed.status, "PASS"); assert.equal(sha(installed.executable.path), installed.executable.sha256);
  if (remaining) {
    assert.equal(read("F:/testavn/Windows-Isolated-1976-20261116-04/account-retirement-01.json").status, "PASS");
    const previous = read("F:/testavn/Windows-Isolated-1976-20261116-04/resource-01/report.json");
    assert.equal(previous.status, "FAILED"); assert.equal(previous.stages[2].status, "PASS");
    assert.equal(previous.backupEvidence.length, 3);
  }
}
assert(!fs.existsSync(base), "Use a fresh sealed scope");
const scripts = path.join(base, "harness/scripts"), copies = [], packages = new Map();
fs.mkdirSync(scripts, { recursive: true }); fs.mkdirSync(path.join(base, "jobs"));
const scope = text => text.replaceAll(priorScope, base.replaceAll("\\", "/"))
  .replaceAll(priorScope.replaceAll("/", "\\"), base);
function write(name, source, transform = scope) {
  const from = path.join(root, "scripts", source), to = path.join(scripts, name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, transform(fs.readFileSync(from, "utf8")), { flag: "wx" });
  copies.push({ source: desc(from), staged: desc(to) });
  if (to.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", to], { windowsHide: true });
  else cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${to}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
  { windowsHide: true });
}
const runner = historyRevision ? "editor-history-installed-1980.cjs" : eventIntegrity ? "editor-event-installed-1979.cjs" : graphIntegrity ? "editor-graph-installed-1978.cjs"
  : homeOrdering ? "editor-home-save-installed-1977.cjs" : "editor-autosave-installed-1976.cjs";
for (const name of ["windows-isolated-account-controller.ps1", "final-project-qa-retire-1956.ps1",
  "audit-installed-editor-marker.cjs", runner]) write(name, name);
write("windows-isolated-account-child.ps1", "windows-isolated-account-child.ps1", text => {
  const marker = "& 'C:\\Program Files\\nodejs\\node.exe' $script @($job.arguments)";
  assert(text.includes(marker));
  return scope(text).replace(marker, `$qaTemporary=Join-Path $SessionRoot 'qa-temp'
if(Test-Path -LiteralPath $qaTemporary){throw 'Fresh temporary scope required'}
New-Item -ItemType Directory -Path $qaTemporary -ErrorAction Stop|Out-Null
$env:TEMP=$qaTemporary
$env:TMP=$qaTemporary
` + marker);
});
write("editor-autosave-upgrade-install.ps1", "editor-upgrade-1945-install.ps1", text => {
  let guards = 0;
  const result = text.split(/\r?\n/).map(line => {
    if (line.includes("Exact QA session required")) {
      guards++; return `if($SessionRoot -cne '${base}'){throw 'Exact QA session required'}`;
    }
    if (line.includes("Dedicated QA identity required")) {
      guards++; return `$ownerReceipt=Get-Content -LiteralPath "$SessionRoot\\account-controller.json" -Raw -Encoding UTF8|ConvertFrom-Json
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $ownerReceipt.account.sid){throw 'Dedicated QA identity required'}`;
    }
    return line;
  }).join("\n");
  assert.equal(guards, 2); return result;
});
fs.cpSync(path.join(root, "scripts/lib"), path.join(scripts, "lib"), {
  recursive: true, errorOnExist: true, force: false, filter: f => { assert(!fs.lstatSync(f).isSymbolicLink()); return true; },
});
for (const name of ["qa-default-editor-session.cjs", "windows-repository-native.cjs"]) {
  const f = path.join(scripts, "lib", name);
  let text = scope(fs.readFileSync(f, "utf8"));
  if (followup && name === "qa-default-editor-session.cjs") {
    const marker = `resolved === path.resolve("${base.replaceAll("\\", "/")}/installed-editor")`;
    assert(text.includes(marker));
    text = text.replace(marker, `(${marker} || resolved === path.resolve("F:/testavn/Windows-Isolated-1976-20261116-01/installed-editor"))`);
  }
  if (homeFollowup && name === "qa-default-editor-session.cjs") {
    const marker = `resolved === path.resolve("${base.replaceAll("\\", "/")}/installed-editor")`;
    assert(text.includes(marker));
    text = text.replace(marker, `(${marker} || resolved === path.resolve("F:/testavn/Windows-Isolated-1977-20261116-01/installed-editor"))`);
  }
  if (graphFollowup && name === "qa-default-editor-session.cjs") {
    const marker = `resolved === path.resolve("${base.replaceAll("\\", "/")}/installed-editor")`;
    assert(text.includes(marker));
    text = text.replace(marker, `(${marker} || resolved === path.resolve("F:/testavn/Windows-Isolated-1978-20261116-01/installed-editor"))`);
  }
  if (eventFollowup && name === "qa-default-editor-session.cjs") {
    const marker = `resolved === path.resolve("${base.replaceAll("\\", "/")}/installed-editor")`;
    assert(text.includes(marker));
    text = text.replace(marker, `(${marker} || resolved === path.resolve("F:/testavn/Windows-Isolated-1979-20261116-01/installed-editor"))`);
  }
  fs.writeFileSync(f, text);
  copies.push({ source: desc(path.join(root, "scripts/lib", name)), staged: desc(f) });
}
const modules = path.join(base, "harness/editor/node_modules");
function pkg(name, from) {
  if (packages.has(name) || name === "fsevents") return;
  const f = require.resolve(name + "/package.json", { paths: [from] }), meta = read(f), src = path.dirname(f);
  fs.cpSync(src, path.join(modules, name), { recursive: true, errorOnExist: true, force: false,
    filter: f => { assert(!fs.lstatSync(f).isSymbolicLink()); return true; } });
  packages.set(name, meta.version);
  for (const dep of Object.keys(meta.dependencies || {})) pkg(dep, src);
}
for (const name of ["playwright", "jszip"]) pkg(name, path.join(root, "editor"));
const fixture = eventRemaining
  ? read("F:/testavn/Windows-Isolated-1979-20261116-02/resource-01/recovery-files/event-order.json")
  : graphFollowup ? inheritedFixture : graphIntegrity
  ? read("F:/testavn/Editor-Delete-Integrity-20261116-01/browser-complete-01/fixture.vnproj")
  : remaining ? read("F:/testavn/Windows-Isolated-1976-20261116-04/resource-01/recovery-files/setting.json") :
  read(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"));
if ((eventIntegrity && !eventRemaining) || historyRevision) {
  const scene = fixture.nodes.find(n => n.data.scene), entry = fixture.nodes.find(n => n.data.nodeKind === "start");
  assert(scene && entry); scene.id = "scene"; scene.data.scene.scene_id = historyRevision ? "history1980" : "events1979";
  if (historyRevision) scene.data.label = scene.data.scene.title = "雨夜车站";
  scene.data.scene.commands = [100, 200, 300].map(duration_ms => ({ type: "wait", duration_ms }));
  fixture.nodes = [entry, scene];
  fixture.edges = [{ id: "entry-scene", source: entry.id, target: scene.id, sourceHandle: "default" }];
}
fixture.project_id = historyRevision ? "qa-editor-history-revision-1980" : eventIntegrity ? "qa-editor-event-integrity-1979" : graphIntegrity ? "qa-editor-graph-integrity-1978"
  : homeOrdering ? "qa-editor-home-save-ordering-1977" : "qa-editor-autosave-upgrade-1976";
if (!remaining) { fixture.title = historyRevision ? "安装版时间线与撤销反馈1980" : eventIntegrity ? "安装版事件保存与时间线1979" : graphIntegrity ? "安装版删除与完整线路1978"
  : homeOrdering ? "安装版首页保存顺序1977" : "安装版保存恢复1976"; fixture.author = "隔离验收"; }
fs.writeFileSync(path.join(base, "fixture.vnproj"), JSON.stringify(fixture, null, 2), { flag: "wx" });
if (graphFollowup) {
  const retired = read("F:/testavn/Windows-Isolated-1978-20261116-01/account-retirement-01.json");
  fs.writeFileSync(path.join(base, "inherited-fixture.json"), JSON.stringify({
    sourceDatabase: retired.databaseEvidence, projectId: fixture.project_id, nodes: fixture.nodes.length,
    fixture: desc(path.join(base, "fixture.vnproj")), scope: "Actual prior saved graph restored through public import into fresh default QA profile",
  }, null, 2), { flag: "wx" });
}
if (graphIntegrity) {
  const route = read(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"));
  const prototype = structuredClone(route.nodes.find(n => n.data.scene));
  const entry = route.nodes.find(n => n.id === "start");
  assert(prototype && entry); route.nodes = [entry]; route.edges = [];
  for (let i = 0; i < 100; i++) {
    const node = structuredClone(prototype); node.id = "incoming_" + i;
    node.data.scene.scene_id = "route_" + i; node.data.scene.title = node.data.label = "导入场景 " + i;
    node.position = { x: i * 300, y: 200 }; route.nodes.push(node);
    route.edges.push({ id: "route_edge_" + i, source: i ? "incoming_" + (i - 1) : "start",
      target: node.id, sourceHandle: "default" });
  }
  fs.writeFileSync(path.join(base, "route.vnproj"), JSON.stringify(route, null, 2), { flag: "wx" });
}
fs.writeFileSync(path.join(base, "candidate.json"), JSON.stringify({
  version: build.version, installer: build.installer, payloadReport: build.payloadReport,
}, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(base, "upgrade-candidate.json"), JSON.stringify({
  old: { ...old.installer, version: old.version }, current: { ...build.installer, version: build.version },
}, null, 2), { flag: "wx" });
const entry = path.join(scripts, runner);
fs.writeFileSync(path.join(base, "jobs/job-01.json"), JSON.stringify({
  script: entry, sha256: sha(entry), arguments: [base],
}, null, 2), { flag: "wx" });
let guards = 0;
for (const [name, begin, end, variable] of [
  ["windows-isolated-account-controller.ps1", "$SessionRoot = [IO.Path]", "if (!(Test-Path", "SessionRoot"],
  ["windows-isolated-account-child.ps1", "$SessionRoot=[IO.Path]", "if ([IO.Path]::GetFullPath($JobFile)", "SessionRoot"],
  ["final-project-qa-retire-1956.ps1", "$base=[IO.Path]", "$principal=", "SessionRoot"],
  ["editor-autosave-upgrade-install.ps1", "$SessionRoot=[IO.Path]", "$ownerReceipt=", "SessionRoot"],
]) {
  const text = fs.readFileSync(path.join(scripts, name), "utf8"), start = text.indexOf(begin), finish = text.indexOf(end, start);
  assert(start >= 0 && finish > start);
  for (const [input, allowed] of [[base, true], [base + "-evil", false], [path.dirname(base), false],
    [base.replace(/-\d{2}$/, "-99"), false]]) {
    const command = `$ErrorActionPreference='Stop';$${variable}='${input}';try{${text.slice(start, finish)};'ALLOWED'}catch{'REFUSED'}`;
    assert.equal(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true }).trim(), allowed ? "ALLOWED" : "REFUSED", `${name}: ${input}`);
    guards++;
  }
}
const sessions = require(path.join(scripts, "lib/qa-default-editor-session.cjs"));
const native = require(path.join(scripts, "lib/windows-repository-native.cjs"));
assert(sessions.isDefaultQaInstallRoot(path.join(base, "installed-editor")));
assert(!sessions.isDefaultQaInstallRoot(path.join(base + "-evil", "installed-editor")));
assert(native.validNativeOutput(path.join(base, "resource-01")));
assert(!native.validNativeOutput(base + "-evil/resource-01"));
const closes = require(path.join(scripts, "lib/editor-upgrade-wm-close.cjs")).selfTest();
fs.writeFileSync(path.join(base, "staging.json"), JSON.stringify({
  status: "STAGED_NOT_NATIVE_ACCEPTANCE", at: new Date().toISOString(), copies, packages: [...packages], guards, closes,
  fixture: desc(path.join(base, "fixture.vnproj")), installations: 0, models: 0,
  scope: historyRevision ? "ACTUAL_1980_INSTALL_UNDO_FEEDBACK_NATIVE_TIMELINE_DEFAULT_PROFILE_RESTART_AND_RETIRE_NOT_UPGRADE"
    : eventIntegrity ? "ACTUAL_1979_INSTALL_EVENT_EDIT_UNDO_NATIVE_TIMELINE_DEFAULT_PROFILE_RESTART_AND_RETIRE_NOT_UPGRADE"
    : graphIntegrity ? "ACTUAL_1978_INSTALL_GRAPH_DELETE_ROUTE_UNDO_REDO_DEFAULT_PROFILE_RESTART_AND_RETIRE_NOT_UPGRADE"
    : homeOrdering ? "ACTUAL_1977_INSTALL_HOME_SAVE_ORDERING_DEFAULT_PROFILE_RESTART_AND_RETIRE_NOT_UPGRADE" :
    followup ? "REUSE_ACTUAL_1976_INSTALL_FRESH_DEFAULT_PROFILE_METADATA_NATIVE_FAILURE_RETRY_RESTORE_RESTART_RETIRE_NO_REINSTALL" :
    "TARGETED_1975_TO_1976_DEFAULT_PROFILE_UPGRADE_METADATA_NATIVE_FAILURE_RETRY_TIMELINE_RESTORE_RESTART_RETIRE",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base, guards, packages: packages.size }));
