"use strict";
// Existing actual resource/font/action checks, bound to this candidate and
// protected native profiles. No old-candidate business results are inherited.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const { sha } = require("./lib/installed-runtime-session.cjs");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice(19),"utf8"))):null;
const current1930=process.argv.includes("--candidate=1.9.30");
assert(!config||!current1930);
const version=config?.version??(current1930?"1.9.30":"1.9.24");
const authorAttempt=config?process.argv[2]:(current1930?"66":"57");
const playerAttempt=config?process.argv[3]:"01";
assert.match(authorAttempt,/^\d{2}$/);assert.match(playerAttempt,/^\d{2}$/);
const installationFile=config
  ?path.join(config.qa,`gui-author-preparation-${authorAttempt}`,"derived-installed.json"):current1930
  ?"F:/AgentVN/QA/Editor-1.9.30-20261026-01/derived-components-installation-01.json"
  :"F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";
const installed=JSON.parse(fs.readFileSync(installationFile,"utf8").replace(/^\uFEFF/,""));
assert.equal(config||current1930?installed.version:installed.executable.version,version);
if(config)assert.deepEqual(installed,deriveActual(config.actual,version));
if(current1930||config) {
  assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
  const actual=JSON.parse(fs.readFileSync(installed.actualInstallation.path,"utf8").replace(/^\uFEFF/,""));
  assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
}
const playerSHA=config?installed.resources.find(f=>path.basename(f.path)==="agentvn-player.exe").sha256:current1930
  ?"296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa"
  :"6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168";
assert.equal(installed.resources.find(f=>path.basename(f.path)==="agentvn-player.exe").sha256,playerSHA);
const previous = path.join(__dirname, "installed-gui-library-player.cjs");
assert.equal(sha(previous), "e98a9cf36d6db913055846b40c631d4c497fe4c345be26d89df8876c76f6b6a6");
let source = fs.readFileSync(previous, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const { spawn } = require("node:child_process");', 'const { spawn, spawnSync } = require("node:child_process");');
replace('assert.match(inputAttempt, /^\\d{2}$/); assert.match(attempt, /^\\d{2}$/);',
  `assert.equal(inputAttempt, "${authorAttempt}"); assert.equal(attempt, "${playerAttempt}");`);
replace('const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";',
  'const qa = "F:/AgentVN/QA/Installed-Layout-20261021-01";');
replace('const installation = read("F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json");',
  `const installation = read(${JSON.stringify(installationFile)});\n` +
  `assert.equal(${config||current1930?"installation.version":"installation.executable.version"}, "${version}"); assert.equal(installation.metadataRestoration, "PASS");\n` +
  'assert.equal(installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256,\n' +
  `  "${playerSHA}");`);
replace('const out = path.resolve(qa, `player-${attempt}`);',
  'const out = path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01", `gui-library-installed-' + version.replaceAll(".","") + '-${attempt}`);');
replace('let player, current, browser, page, cdp;', `let player, current, browser, page, cdp, profilePrepared = false;
function profiles(action) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/native-dev-preview-profile.ps1",
    "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"];
  const result = spawnSync("powershell.exe", args, { cwd: path.resolve(__dirname, ".."),
    encoding: "utf8", windowsHide: true, timeout: 45000 });
  const log = path.join(out, "profile-" + action + ".log");
  fs.writeFileSync(log, result.stdout + result.stderr, { flag: "wx" });
  (report.commands ??= []).push({ command: ["powershell.exe", ...args], code: result.status, log }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}`);
replace('  const env = { ...process.env };',
  '  profilePrepared = true; profiles("Prepare");\n  const env = { ...process.env };');
replace('  page = await until(() => browser.contexts().flatMap(context => context.pages()).find(page => /tauri\\.localhost|^tauri:/.test(page.url())), "native Player page");',
  '  page = await require("./lib/wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
replace('    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)\n      report.screenshots.push',
  '    report.screenshots.push');
replace('  report.finishedAt = new Date().toISOString(); save();',
  '  try { if (profilePrepared && fs.existsSync(path.join(out, "profile-protection.json"))) {\n' +
  '      profiles("Restore"); assert.equal(read(path.join(out, "profile-restoration.json")).status, "PASS");\n' +
  '      report.profileRestored = true;\n' +
  '    } } catch (error) { report.status = "FAILED"; report.profileRestoreError = String(error.stack || error); process.exitCode = 1; }\n' +
  '  report.finishedAt = new Date().toISOString(); report.tool = { path: __filename, sha256: sha(__filename) }; save();');
if(config) {
  replace('fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);',
    'fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);\n' +
    'fs.writeFileSync(path.join(out, "executed-business.cjs"), module.qaSource, {flag:"wx"});\n' +
    'fs.writeFileSync(path.join(out, "binding.json"), JSON.stringify(module.qaBinding,null,2), {flag:"wx"});');
  replace('const report = { status: "RUNNING", startedAt:',`const report = { version: "${version}", status: "RUNNING", startedAt:`);
}
new vm.Script(Module.wrap(source), { filename: __filename });
if (process.argv.includes("--self-test")) {
  let replay = fs.readFileSync(previous, "utf8");
  for (const c of changes) { assert.equal(replay.split(c.before).length - 1, 1); replay = replay.replace(c.before, c.after); }
  assert.equal(source, replay); assert(source.includes('assert.equal(row.checks.length, 4)'));
  assert(source.includes('font.isCustomFont && /DejaVu/i.test(font.familyName)'));
  assert(source.includes('!font.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(font.familyName)'));
  console.log(JSON.stringify({ status: "PASS", changes: changes.length, scope: "QA_INSTALLED_BINDING_AND_PROFILE_PROTECTION" }));
} else {
  if(config) {
    assert.deepEqual(process.argv.slice(2),[authorAttempt,playerAttempt,configArgs[0]]);
  } else if(current1930) {
    assert.deepEqual(process.argv.slice(2),[authorAttempt,"01","--candidate=1.9.30"]);
    process.argv.splice(4);
  }
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource=source;worker.qaBinding={version,installationFile,actualInstallation:config?.actual,
    source:{path:previous,sha256:sha(previous)},adaptations:changes,authorAttempt,playerAttempt,
    oldResultsInherited:false};
  worker._compile(source, __filename);
}
