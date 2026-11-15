"use strict";
// Reuse the closed-host upgrade workflow with two actual, immutable release installers.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), cp = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { upgradeScope } = require("./lib/editor-upgrade-scope.cjs");
const { cross, current1973, current1974, current1975, cross1973, visibleCross1973, crossRetry, oldCode, newCode, oldVersion, newVersion, base } =
  upgradeScope(process.argv.slice(2));
const current = current1973 || current1974 || current1975;
const previous = "F:/testavn/Windows-Isolated-1972-20261114-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const assertFresh = !fs.existsSync(base); assert(assertFresh, "Never overwrite an upgrade session");
const oldReceipt = `F:/testavn/Windows-Isolated-${oldCode}-${current1975 ? "20261115" : "20261114"}-01/installation.json`;
const newReceipt = `F:/testavn/Windows-Isolated-${newCode}-${current1975 ? "20261116" : current1974 ? "20261115" : "20261114"}-01/installation.json`;
let old = read(oldReceipt); const next = read(newReceipt);
if (cross) {
  const legacyReceipt = "F:/AgentVN/QA/Editor-Cross-1944-20261105-01/session-01/InstallOld.json";
  const legacy = read(legacyReceipt);
  assert.equal(legacy.status, "PASS"); assert.equal(legacy.actualVersion, "1.7.1");
  assert.equal(legacy.sha256, "07126f13c50aa329babd5d87268057d19e11f79823cc5c551200f951a137adbf");
  old = { status: "PASS", package: { ...desc(legacy.executable), sha256: legacy.sha256 },
    executable: { version: "1.7.1", sha256: "e1ef3723b8c2bbe7ae8855d54daf07a890abcd1aa251c9e24483bab1a00279a5" },
    provenance: desc(legacyReceipt) };
}
assert.equal(old.status, "PASS"); assert.equal(next.status, "PASS");
assert.equal(old.executable.version, cross ? "1.7.1" : oldVersion); assert.equal(next.executable.version, newVersion);
for (const [r, digest] of [[old, cross ? "07126f13c50aa329babd5d87268057d19e11f79823cc5c551200f951a137adbf" :
  current1975 ? "4c453f88f007ba29de820c9307fb8a0570c316a7d52a6afed5231e6b7b4df2cb" :
  current1974 ? "7f943f48c059c84eba3377d3df2d3f7069cc251527e330e684126b77e5aa6da2" :
  current1973 ? "38f642f35106e39369ada3402ee185a92c038300d375142bf15523c049527bd2" : "a81faf1a81eec71dcb10a2f0afea1351f486ea106709b06f59a8a0028400da88"],
  [next, current1975 ? "58c1f44ba6f227c9db4a6a40c3280c97fe502b6538ed7762dd52339c60954e09" :
  current1974 ? "4c453f88f007ba29de820c9307fb8a0570c316a7d52a6afed5231e6b7b4df2cb" :
  current1973 ? "7f943f48c059c84eba3377d3df2d3f7069cc251527e330e684126b77e5aa6da2" : "38f642f35106e39369ada3402ee185a92c038300d375142bf15523c049527bd2"]]) {
  assert.equal(sha(r.package.path), digest); assert.equal(r.package.sha256, digest);
  assert.equal(fs.statSync(r.package.path).size, r.package.bytes);
}
fs.mkdirSync(path.join(base, "jobs"), { recursive: true });
fs.mkdirSync(path.join(base, "checkpoint"));
for (const file of ["AGENTS.md", "plans/ACTIVE_TASKS.md"])
  fs.copyFileSync(path.join(root, file), path.join(base, "checkpoint", path.basename(file)), fs.constants.COPYFILE_EXCL);
if (current1975) {
  const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]));
  fs.writeFileSync(path.join(base, "checkpoint/protected.json"), JSON.stringify({
    at: new Date().toISOString(), head: git(["rev-parse", "HEAD"]),
    index: desc(index), dailyDev: desc("D:/AgentVN/AgentVN Dev.exe"),
    oldReceipt: desc(oldReceipt), newReceipt: desc(newReceipt),
  }, null, 2), { flag: "wx" });
}
const copies = [], scriptsRoot = path.join(base, "harness/scripts");
const scope = text => text.replaceAll(previous, base).replaceAll(previous.replaceAll("/", "\\"), base.replaceAll("/", "\\"));
function script(relative, source = relative, transform = text => text) {
  const from = path.join(root, "scripts", source), to = path.join(scriptsRoot, relative);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, transform(fs.readFileSync(from, "utf8")), { flag: "wx" });
  copies.push({ source: desc(from), staged: desc(to) });
}
for (const f of ["windows-isolated-account-controller.ps1", "windows-isolated-account-child.ps1",
  "final-project-qa-retire-1956.ps1", "gui-directory-picker-uia.ps1"]) script(f, f, text => {
  text = scope(text);
  if (current && f === "windows-isolated-account-child.ps1") {
    const marker = "& 'C:\\Program Files\\nodejs\\node.exe' $script @($job.arguments)";
    assert(text.includes(marker));
    text = text.replace(marker, `$qaTemporary = Join-Path $SessionRoot 'qa-temp'
if (Test-Path -LiteralPath $qaTemporary) { throw 'Fresh QA temp required' }
New-Item -ItemType Directory -Path $qaTemporary -ErrorAction Stop | Out-Null
$env:TEMP = $qaTemporary
$env:TMP = $qaTemporary
` + marker);
  }
  return text;
});
fs.cpSync(path.join(root, "scripts/lib"), path.join(scriptsRoot, "lib"), {
  recursive: true, force: false, errorOnExist: true, filter: f => { assert(!fs.lstatSync(f).isSymbolicLink()); return true; },
});
for (const f of ["qa-default-editor-session.cjs", "windows-repository-native.cjs"]) {
  const target = path.join(scriptsRoot, "lib", f);
  let text = scope(fs.readFileSync(target, "utf8"));
  if (cross && f === "qa-default-editor-session.cjs") {
    assert(text.includes("isolatedBackendPort, previewCdpPort })"));
    text = text.replace("isolatedBackendPort, previewCdpPort })", "isolatedBackendPort, previewCdpPort, databasePath, onLaunched })")
      .replace('database: path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db")',
        'database: databasePath || path.join(process.env.APPDATA, "com.agentvn.editor/backend/vn_engine.db")')
      .replace("report.launches.push(current); remember();", "report.launches.push(current); remember();\n      if (onLaunched) await onLaunched(current);");
  }
  fs.writeFileSync(target, text);
  copies.push({ source: desc(path.join(root, "scripts/lib", f)), staged: desc(target) });
}
if (crossRetry) {
  const file = path.join(scriptsRoot, "lib/editor-cross-computer-use-await.cjs");
  let text = fs.readFileSync(file, "utf8");
  text = text.replace('"Computer Use migration receipt", 240000', '"Computer Use migration receipt", 600000');
  text = text.replace('assert(receipt.observedText.includes(request.source)); assert(receipt.observedText.includes("目标共享数据库"));',
    `assert.equal(receipt.displayedSourcePrefix, path.dirname(path.dirname(path.dirname(request.source))));
  assert(receipt.observedText.includes(receipt.displayedSourcePrefix));
  assert(receipt.observedText.includes(path.basename(request.source)));
  assert(receipt.observedText.includes("目标共享数据库"));
  assert.equal(receipt.displayedTargetPrefix, path.join(process.env.APPDATA, "com.agentvn.editor"));
  assert(receipt.observedText.includes(receipt.displayedTargetPrefix));
  assert.equal(receipt.after.migrationDialogAbsent, true);
  // The native TaskDialog ellipsizes the middle of both paths. Full paths are
  // independently tied to the launch request, original DB hash and decision file.
  assert.equal(receipt.sourceObservationBoundary, "Native paths are ellipsized; full source verified by request/hash and actual migration decision");`);
  fs.writeFileSync(file, text);
  copies.push({ source: desc(path.join(root, "scripts/lib/editor-cross-computer-use-await.cjs")), staged: desc(file) });
  const source = path.join(base, "installed-editor/data/backend/vn_engine.db");
  const visible = path.join(base, "installed-editor") + "\\data...\\vn_engine.db";
  assert(visible.includes(path.dirname(path.dirname(path.dirname(source)))));
  assert(visible.includes(path.basename(source)));
  for (const wrong of [source.replace("installed-editor", "other-editor"), source.replace("vn_engine.db", "other.db")]) {
    assert(!(visible.includes(path.dirname(path.dirname(path.dirname(wrong)))) && visible.includes(path.basename(wrong))));
  }
}
script("editor-upgrade-1972-install.ps1", "editor-upgrade-1945-install.ps1", text => {
  let guards = 0;
  const result = text.split(/\r?\n/).map(line => {
    if (line.includes("Exact QA session required")) { guards++; return `if ($SessionRoot -cne '${base.replaceAll("/", "\\")}') { throw 'Exact QA session required' }`; }
    if (line.includes("Dedicated QA identity required")) { guards++; return `$ownerReceipt=Get-Content -LiteralPath "$SessionRoot\\account-controller.json" -Raw -Encoding UTF8|ConvertFrom-Json
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -cne $ownerReceipt.account.sid) { throw 'Dedicated QA identity required' }`; }
    return line;
  }).join("\n");
  assert.equal(guards, 2); return result;
});
if (cross) script("editor-upgrade-1972.cjs", "editor-cross-171-1952.cjs", text => {
  const before = text.indexOf("  try {\n    state.window = JSON.parse(ps(");
  const after = text.indexOf("  try {\n    state.dom", before);
  assert(before > 0 && after > before);
  text = text.slice(0, before) + "  // Native confirmation is exclusively observed and operated with Computer Use.\n" + text.slice(after);
  return text.replaceAll("F:/AgentVN/QA/Windows-Isolated-1944-20261107-38", base)
    .replaceAll("1952", newCode).replaceAll("1.9.52", newVersion)
    .replaceAll(`editor-cross-171-${newCode}-install.ps1`, "editor-upgrade-1972-install.ps1")
    .replace("./lib/editor-cross-consent-win32.cjs", "./lib/editor-cross-computer-use-await.cjs")
    .replace('path.join(base, "cross-01")', 'path.join(base, "resource-01")')
    .replace('report.cleanup = "PASS";', 'report.cleanup = "PASS"; report.cleanupStatus = "PASS";');
});
else script("editor-upgrade-1972.cjs", "editor-upgrade-1949.cjs", text => {
  assert(text.includes("F:/AgentVN/QA/Windows-Isolated-1944-20261106-23"));
  return text.replaceAll("F:/AgentVN/QA/Windows-Isolated-1944-20261106-23", base)
    .replaceAll("1949", "__NEW__").replaceAll("1948", oldCode).replaceAll("__NEW__", newCode)
    .replaceAll("1.9.49", "__VER__").replaceAll("1.9.48", oldVersion).replaceAll("__VER__", newVersion)
    .replaceAll(`editor-upgrade-${newCode}-install.ps1`, "editor-upgrade-1972-install.ps1")
    .replace('path.join(base, "upgrade-01")', 'path.join(base, "resource-01")')
    .replace('[data-help-key="home.recentProject"]:visible', ".recent-project-open:not(:disabled)")
    .replace('report.cleanup = "PASS"; report.downloadsRemoved', 'report.cleanup = "PASS"; report.cleanupStatus = "PASS"; report.downloadsRemoved');
});
const modules = path.join(base, "harness/editor/node_modules"), packages = new Map();
function pkg(name, from) {
  if (packages.has(name) || name === "fsevents") return;
  const file = require.resolve(name + "/package.json", { paths: [from] }), source = path.dirname(file), metadata = read(file);
  fs.cpSync(source, path.join(modules, name), { recursive: true, errorOnExist: true, force: false,
    filter: f => { assert(!fs.lstatSync(f).isSymbolicLink()); return true; } });
  packages.set(name, metadata.version);
  for (const dependency of Object.keys(metadata.dependencies || {})) pkg(dependency, source);
}
pkg("playwright", path.join(root, "editor")); pkg("jszip", path.join(root, "editor"));
const project = read(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"));
project.project_id = `qa-editor-upgrade-${oldCode}-${newCode}`; project.title = `覆盖升级${oldCode}到${newCode}隔离工程`;
const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#314a62"/></svg>');
project.asset_manifest.push({ asset_id: "qa_opening", asset_type: "ui", metadata: { filename: "qa-opening.svg",
  mime_type: "image/svg+xml", data_url: "data:image/svg+xml;base64," + image.toString("base64"),
  project_path: "assets/ui/qa-opening.svg", source: "imported" } });
project.nodes.find(n => n.id === "start").data.loadingAnimation = {
  kind: "image_sequence", image_asset_ids: ["qa_opening"], frame_duration_ms: 60000 };
const fixture = path.join(base, "old-project.vnproj");
fs.writeFileSync(fixture, JSON.stringify(project, null, 2), { flag: "wx" });
const seal = { old: { ...old.package, version: cross ? "1.7.1" : oldVersion }, current: { ...next.package, version: newVersion },
  oldExecutable: old.executable, newExecutable: next.executable, newPayload: desc(newReceipt),
  oldInstallation: cross ? old.provenance : desc(oldReceipt), project: desc(fixture), copies };
fs.writeFileSync(path.join(base, "upgrade-candidate.json"), JSON.stringify(seal, null, 2), { flag: "wx" });
const runner = path.join(scriptsRoot, "editor-upgrade-1972.cjs");
fs.writeFileSync(path.join(base, "jobs/job-01.json"),
  JSON.stringify({ script: runner, sha256: sha(runner), arguments: [base] }, null, 2), { flag: "wx" });
for (const entry of copies) {
  const f = entry.staged.path;
  if (f.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", f], { windowsHide: true });
  if (f.endsWith(".ps1")) cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${f.replaceAll("'", "''")}',[ref]$t,[ref]$e);if($e.Count){throw ($e|Out-String)}`],
  { windowsHide: true });
}
// Actual scope probes without launching products or native input.
const sessions = require(path.join(scriptsRoot, "lib/qa-default-editor-session.cjs"));
const native = require(path.join(scriptsRoot, "lib/windows-repository-native.cjs"));
assert(sessions.isDefaultQaInstallRoot(path.join(base, "installed-editor")));
assert(!sessions.isDefaultQaInstallRoot(path.join(base + "-evil", "installed-editor")));
assert(native.validNativeOutput(path.join(base, "resource-01")));
assert(!native.validNativeOutput(base + "-evil/resource-01"));
assert.equal(require(path.join(scriptsRoot, "lib/editor-upgrade-wm-close.cjs")).selfTest().status, "PASS");
let actualPowerShellGuardCases = 0;
if (current) {
  for (const [name, start, end, variable] of [
    ["windows-isolated-account-controller.ps1", "$SessionRoot = [IO.Path]", "if (!(Test-Path", "SessionRoot"],
    ["windows-isolated-account-child.ps1", "$SessionRoot=[IO.Path]", "if ([IO.Path]::GetFullPath($JobFile)", "SessionRoot"],
    ["final-project-qa-retire-1956.ps1", "$base=[IO.Path]", "$principal=", "SessionRoot"],
    ["editor-upgrade-1972-install.ps1", "$SessionRoot=[IO.Path]", "$ownerReceipt=", "SessionRoot"],
  ]) {
    const text = fs.readFileSync(path.join(scriptsRoot, name), "utf8");
    const begin = text.indexOf(start), finish = text.indexOf(end, begin);
    assert(begin >= 0 && finish > begin); const guard = text.slice(begin, finish);
    for (const [input, allowed] of [[base, true], [base + "-evil", false],
      [base.replace(/-\d\d$/, "-99"), false], [path.join(base, "..", "wrong-root"), false]]) {
      const command = `$ErrorActionPreference='Stop';$${variable}='${input.replaceAll("'", "''")}';try{${guard};'ALLOWED'}catch{'REFUSED'}`;
      const value = cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
        { windowsHide: true, encoding: "utf8", timeout: 15000 }).trim();
      assert.equal(value, allowed ? "ALLOWED" : "REFUSED", `${name}:${input}`); actualPowerShellGuardCases++;
    }
  }
}
fs.writeFileSync(path.join(base, "staging.json"), JSON.stringify({ status: "STAGED_NOT_UPGRADE_ACCEPTANCE",
  at: new Date().toISOString(), scope: cross ? `REAL_171_TO_${newCode}_CROSS_GENERATION` : `REAL_${oldCode}_TO_${newCode}_CLOSED_HOST_UPGRADE`, copies, packages: [...packages],
  currentCross1973: cross1973,
  interactiveEditorVisible: visibleCross1973 || (current1974 && cross),
  scopeChecks: 4, actualPowerShellGuardCases, closeNegativeChecks: 10, productLaunches: 0, builds: 0, modelRequests: 0,
  limits: ["Current machine fresh standard QA account, not a clean VM",
    cross ? "Known immutable old close defect remains separate; native migration by Computer Use" : "Recent-version upgrade only; cross-generation remains separate"] }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base, scripts: copies.length, packages: packages.size }));
