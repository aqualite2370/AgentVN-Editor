"use strict";
// Fresh, exact ordinary-account scope; never resume or mutate an old QA lifecycle.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const remaining = ["--remaining", "--remaining-03", "--remaining-04"].includes(process.argv[2]);
assert.equal(process.argv.length, remaining ? 3 : 2);
const root = path.resolve(__dirname, ".."), base = path.resolve("F:/testavn/Windows-Isolated-1981-20261116-" +
  (process.argv[2] === "--remaining-04" ? "04" : process.argv[2] === "--remaining-03" ? "03" : remaining ? "02" : "01"));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size, sha256: sha(file) });
const release = read("F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01/release/build.json");
assert.equal(release.status, "PASS_EDITOR_DEV_NSIS_RUNTIME032_PAYLOAD_NOT_INSTALLED");
assert.equal(release.version, "1.9.81"); assert.equal(release.runtimeVersion, "0.32.0");
for (const file of [release.installer, release.payloadReport, release.oldPlayer]) assert.equal(sha(file.path), file.sha256);
assert(!fs.existsSync(base), "Never overwrite or recreate a prior test account scope");
const staged = path.join(base, "harness/scripts"), copies = [], modules = new Map();
fs.mkdirSync(staged, { recursive: true }); fs.mkdirSync(path.join(base, "jobs"));
const oldScope = "F:/testavn/Windows-Isolated-1972-20261114-01";
const scope = text => text.replaceAll(oldScope, base.replaceAll("\\", "/")).replaceAll(oldScope.replaceAll("/", "\\"), base);
function sliceReplace(text, begin, end, replacement) {
  const start = text.indexOf(begin), finish = text.indexOf(end, start);
  assert(start >= 0 && finish > start);
  return text.slice(0, start) + replacement + "\n" + text.slice(finish);
}
function stage(name, source = name, transform = scope) {
  const original = path.join(root, "scripts", source), target = path.join(staged, name);
  fs.writeFileSync(target, transform(fs.readFileSync(original, "utf8")), { flag: "wx" });
  copies.push({ source: desc(original), staged: desc(target) });
  if (target.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", target], { windowsHide: true });
  else cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `$e=$null;$t=$null;[void][Management.Automation.Language.Parser]::ParseFile('${target}',[ref]$t,[ref]$e);if($e.Count){throw($e|Out-String)}`],
  { windowsHide: true });
}
stage("windows-isolated-account-controller.ps1", undefined, text => sliceReplace(text,
  "$SessionRoot = [IO.Path]", "if (!(Test-Path",
  `$SessionRoot = [IO.Path]::GetFullPath($SessionRoot)
if ($SessionRoot -cne '${base}') { throw 'Exact current QA root required' }
$resource1957 = $true`));
stage("windows-isolated-account-child.ps1", undefined, text => {
  text = sliceReplace(text, "$SessionRoot=[IO.Path]", "if ([IO.Path]::GetFullPath($JobFile)",
    `$SessionRoot=[IO.Path]::GetFullPath($SessionRoot)
if ($SessionRoot -cne '${base}') { throw 'Exact current QA root required' }`);
  const marker = "& 'C:\\Program Files\\nodejs\\node.exe' $script @($job.arguments)";
  assert(text.includes(marker));
  return text.replace(marker, `$qaTemporary=Join-Path $SessionRoot 'qa-temp'
if(Test-Path -LiteralPath $qaTemporary){throw 'Fresh temporary scope required'}
New-Item -ItemType Directory -Path $qaTemporary -ErrorAction Stop|Out-Null
$env:TEMP=$qaTemporary
$env:TMP=$qaTemporary
` + marker);
});
stage("final-project-qa-retire-1956.ps1", undefined, text => sliceReplace(text,
  "$base=[IO.Path]", "$principal=",
  `$base=[IO.Path]::GetFullPath($SessionRoot)
if ($base -cne '${base}') { throw 'Exact current QA root required' }
$resource1957=$true
$android09=$false`));
stage("editor-autosave-upgrade-install.ps1", "editor-upgrade-1945-install.ps1", text => {
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
for (const name of ["renpy-quick-placement-installed.cjs", "audit-installed-editor-marker.cjs"]) stage(name);
fs.cpSync(path.join(root, "scripts/lib"), path.join(staged, "lib"), {
  recursive: true, errorOnExist: true, force: false,
  filter: file => { assert(!fs.lstatSync(file).isSymbolicLink()); return true; },
});
for (const name of ["qa-default-editor-session.cjs", "windows-repository-native.cjs"]) {
  const target = path.join(staged, "lib", name), original = path.join(root, "scripts/lib", name);
  let text = scope(fs.readFileSync(target, "utf8"));
  if (remaining && name === "qa-default-editor-session.cjs") {
    const marker = `resolved === path.resolve("${base.replaceAll("\\", "/")}/installed-editor")`;
    assert(text.includes(marker));
    text = text.replace(marker, `(${marker} || resolved === path.resolve("F:/testavn/Windows-Isolated-1981-20261116-01/installed-editor"))`);
  }
  fs.writeFileSync(target, text);
  copies.push({ source: desc(original), staged: desc(target) });
}
const moduleRoot = path.join(base, "harness/editor/node_modules");
function pkg(name, from) {
  if (modules.has(name) || name === "fsevents") return;
  const manifest = require.resolve(name + "/package.json", { paths: [from] }), meta = read(manifest), source = path.dirname(manifest);
  fs.cpSync(source, path.join(moduleRoot, name), { recursive: true, errorOnExist: true, force: false,
    filter: file => { assert(!fs.lstatSync(file).isSymbolicLink()); return true; } });
  modules.set(name, meta.version);
  for (const dependency of Object.keys(meta.dependencies || {})) pkg(dependency, source);
}
for (const name of ["playwright", "jszip"]) pkg(name, path.join(root, "editor"));
let fixture;
if (remaining) {
  const prior = "F:/testavn/Windows-Isolated-1981-20261116-01", retirement = read(path.join(prior, "account-retirement-01.json"));
  assert.equal(retirement.status, "PASS");
  assert(retirement.cleanup.accountDeleted && retirement.cleanup.profileDeleted);
  assert.equal(sha(retirement.databaseEvidence.path), retirement.databaseEvidence.sha256);
  const { DatabaseSync } = require("node:sqlite"), database = new DatabaseSync(retirement.databaseEvidence.path, { readOnly: true });
  try {
    const row = database.prepare("SELECT project_json FROM editor_project_details WHERE project_id = ?").get("qa-editor-quick-placement-1981");
    assert(row); fixture = JSON.parse(row.project_json);
  } finally { database.close(); }
  fs.writeFileSync(path.join(base, "inherited-fixture.json"), JSON.stringify({ source: retirement.databaseEvidence,
    scope: "Actual saved author layout restored into fresh default QA profile; no reinstall or repeated authoring" }, null, 2), { flag: "wx" });
} else fixture = read("F:/testavn/Renpy-Quick-Placement-20261116-01/browser03/fixture.vnproj");
fixture.project_id = "qa-editor-quick-placement-1981"; fixture.title = "安装版快捷栏位置1981"; fixture.author = "隔离验收";
assert.equal(fixture.nodes.length, 2);
const active = fixture.editor_settings.runtimeUILayoutProfiles.profiles.renpy;
assert.equal(active.layout_type, "renpy");
assert.equal(active.screens.find(s => s.screen_id === "player").components.find(c => c.component_type === "quick_menu").style.quickMenuPlacement, remaining ? "custom" : undefined);
for (const [name, value] of [
  ["fixture.vnproj", fixture], ["candidate.json", release],
  ["upgrade-candidate.json", { current: { ...release.installer, version: release.version } }],
]) fs.writeFileSync(path.join(base, name), JSON.stringify(value, null, 2), { flag: "wx" });
const entry = path.join(staged, "renpy-quick-placement-installed.cjs");
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
  const text = fs.readFileSync(path.join(staged, name), "utf8"), start = text.indexOf(begin), finish = text.indexOf(end, start);
  assert(start >= 0 && finish > start);
  for (const [input, allowed] of [[base, true], [base + "-evil", false], [path.dirname(base), false],
    [base.replace(/-\d{2}$/, "-99"), false]]) {
    const command = `$ErrorActionPreference='Stop';$${variable}='${input}';try{${text.slice(start, finish)};'ALLOWED'}catch{'REFUSED'}`;
    assert.equal(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true }).trim(), allowed ? "ALLOWED" : "REFUSED");
    guards++;
  }
}
const sessions = require(path.join(staged, "lib/qa-default-editor-session.cjs"));
const native = require(path.join(staged, "lib/windows-repository-native.cjs"));
assert(sessions.isDefaultQaInstallRoot(path.join(base, "installed-editor")));
assert(!sessions.isDefaultQaInstallRoot(path.join(base + "-evil", "installed-editor")));
assert(native.validNativeOutput(path.join(base, "resource-01")));
assert(!native.validNativeOutput(base + "-evil/resource-01"));
const closes = require(path.join(staged, "lib/editor-upgrade-wm-close.cjs")).selfTest();
fs.writeFileSync(path.join(base, "staging.json"), JSON.stringify({
  status: "STAGED_NOT_NATIVE_ACCEPTANCE", at: new Date().toISOString(), copies, packages: [...modules],
  guards, closes, fixture: desc(path.join(base, "fixture.vnproj")), installations: 0, modelRequests: 0,
  scope: "NEW1981_DEFAULT_QA_INSTALL_UI_AUTHOR_RESTART_UI_EXPORT_NATIVE032_AND_REAL031_REFUSAL_NOT_UPGRADE",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base, guards, packages: modules.size }));
