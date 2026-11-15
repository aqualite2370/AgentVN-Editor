"use strict";
// Seal a single targeted actual upgrade/recovery job; do not reuse retired profiles.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const remaining = process.argv[2] === "--remaining";
const followup = remaining || process.argv[2] === "--followup";
assert(process.argv.length === (followup ? 3 : 2));
const root = path.resolve(__dirname, ".."), base = path.resolve("F:/testavn/Windows-Isolated-1976-20261116-" + (remaining ? "05" : followup ? "04" : "01"));
const priorScope = "F:/testavn/Windows-Isolated-1972-20261114-01";
const release = "F:/testavn/Editor-Autosave-Release-1976-20261116-01/release";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const build = read(path.join(release, "build.json"));
const old = read("F:/testavn/Editor-Recovery-20261115-01/release/build.json");
assert.equal(build.status, "PASS_EDITOR_DEV_NSIS_AND_PAYLOAD_ACTUAL_INSTALL_NOT_RUN");
assert.equal(build.version, "1.9.76"); assert.equal(old.version, "1.9.75");
assert.equal(sha(build.installer.path), build.installer.sha256); assert.equal(sha(old.installer.path), old.installer.sha256);
assert.equal(sha(build.payloadReport.path), build.payloadReport.sha256);
assert.equal(read(build.payloadReport.path).status, "PASS");
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
for (const name of ["windows-isolated-account-controller.ps1", "final-project-qa-retire-1956.ps1",
  "audit-installed-editor-marker.cjs", "editor-autosave-installed-1976.cjs"]) write(name, name);
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
const fixture = remaining ? read("F:/testavn/Windows-Isolated-1976-20261116-04/resource-01/recovery-files/setting.json") :
  read(path.join(root, "scripts/fixtures/editor-isolated-small.vnproj"));
fixture.project_id = "qa-editor-autosave-upgrade-1976";
if (!remaining) { fixture.title = "安装版保存恢复1976"; fixture.author = "隔离验收"; }
fs.writeFileSync(path.join(base, "fixture.vnproj"), JSON.stringify(fixture, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(base, "candidate.json"), JSON.stringify({
  version: build.version, installer: build.installer, payloadReport: build.payloadReport,
}, null, 2), { flag: "wx" });
fs.writeFileSync(path.join(base, "upgrade-candidate.json"), JSON.stringify({
  old: { ...old.installer, version: old.version }, current: { ...build.installer, version: build.version },
}, null, 2), { flag: "wx" });
const entry = path.join(scripts, "editor-autosave-installed-1976.cjs");
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
  scope: followup ? "REUSE_ACTUAL_1976_INSTALL_FRESH_DEFAULT_PROFILE_METADATA_NATIVE_FAILURE_RETRY_RESTORE_RESTART_RETIRE_NO_REINSTALL" :
    "TARGETED_1975_TO_1976_DEFAULT_PROFILE_UPGRADE_METADATA_NATIVE_FAILURE_RETRY_TIMELINE_RESTORE_RESTART_RETIRE",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "STAGED", base, guards, packages: packages.size }));
