"use strict";
// Retain the complete historical 204 natural menu samples and add real story
// choice/quickbar states. Bind to current authored export and shipped Player.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { InstalledPreview1922Session } = require("./lib/installed-runtime-preview-1922-session.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const [mode, authorAttempt, playerAttempt, configArg] = process.argv.slice(2);
assert(["self-test", "run"].includes(mode)); assert.match(authorAttempt, /^\d{2}$/); assert.match(playerAttempt, /^\d{2}$/);
assert(configArg.startsWith("--candidate-config="));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const configFile = configArg.slice(19), config = validateCandidateConfig(read(configFile));
const actual = deriveActual(config.actual, config.version);
const authorFile = `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${authorAttempt}/report.json`;
const authored = read(authorFile);
assert.equal(authored.status, "PASS"); assert.equal(authored.version, config.version);
assert.equal(authored.nativeCacheRestoration, "PASS");
assert.equal(authored.cases.length, 4); assert(authored.cases.every(c => c.status === "PASS"));
assert.equal(authored.matrix.length, 12); assert(authored.matrix.every(c => c.status === "PASS" && c.controls.length === 24));
for (const f of [authored.fixture, authored.installation, authored.cartridge, authored.tool, authored.originalBusiness])
  assert.equal(sha(f.path), f.sha256);
assert.equal(sha(path.join(path.dirname(authorFile), "executed-business.cjs")), authored.executedBusinessSha256);
const installation = read(authored.installation.path);
assert.deepEqual(installation.executable, actual.executable);
const out = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/roles-installed-${config.version.replaceAll(".", "")}-${playerAttempt}`;
const fixture = { input: authored.fixture.path, inputSha256: authored.fixture.sha256 };
const prep = { status: "PASS", profiles: [], sessionRoot: out,
  executable: actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe"),
  current1922Preview: true, defaultStorage: "CODEX_EXPLICIT_PROFILE_JUNCTION_PREVIEW",
  temporary: path.join(out, "temporary") };
const file = path.join(__dirname, "installed-authored-role-states.cjs");
assert.equal(sha(file), "873263c744d0c1a1b31e476a1d0d7ca046840e872cfa6cd767b4a0afe0bc6402");
let source = fs.readFileSync(file, "utf8"); const changes = [];
function replace(before, after) {
  assert.equal(source.split(before).length - 1, 1, before);
  source = source.replace(before, after); changes.push({ before, after });
}
replace('const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");',
  'const { sha } = require("./lib/installed-runtime-session.cjs"); const InstalledRuntimeSession = module.qaSession;');
replace('const run = "D:/AgentVN/output/installed-layout-author-review-20261019-01";', `const run = ${JSON.stringify(config.qa)};`);
replace('const out = path.join(run, `role-states-${attempt}`);\n' +
  'const pictures = `F:/AgentVN/QA/Layout-Author-20261019-01/role-states-${attempt}`;\n' +
  'assert(!fs.existsSync(out) && !fs.existsSync(pictures)); fs.mkdirSync(out); fs.mkdirSync(pictures);',
  `const out = ${JSON.stringify(out)}, pictures = out;\nassert(!fs.existsSync(out)); fs.mkdirSync(out);`);
replace('const prep = read(path.join(run,"preparation.json")), fixture = read(path.join(run,"fixtures.json"));\n' +
  'const exported = read(path.join(run,"export-01/report.json")), saved = read(path.join(run,"save-01/report.json"));',
  'const prep = module.qaPreparation, fixture = module.qaFixture, exported = module.qaAuthor, saved = module.qaAuthor;');
replace('const report = {status:"RUNNING",at:',
  'const report = {status:"RUNNING",version:module.qaConfig.version,author:module.qaAuthorDescription,qaBinding:module.qaBinding,at:');
replace('scope:"ACTUAL_INSTALLED_LIBRARY_PLAYER_NATURAL_AUTHORED_ROLE_STATES_NOT_SETUP_ANDROID_OR_FULL_24_STATE_COVERAGE"',
  'scope:"CURRENT_INSTALLED_PREVIEW_PLAYER_AUTHORED_SIX_ROLE_NATURAL_STATES_NOT_SETUP_ANDROID_OR_FULL_24_STATE_COVERAGE"');
replace('async function sample(locator,role,state) {', 'async function sample(locator,role,state,normalLocalOverride) {');
replace('assert.equal(actual.color,rgb(roles[role].states[state].textColor),',
  'assert.equal(actual.color,normalLocalOverride ?? rgb(roles[role].states[state].textColor),');
replace('(async()=>{\n  s=new InstalledRuntimeSession',
  '(async()=>{\n  module.qaPrepare(report,save);\n  s=new InstalledRuntimeSession');
replace('assert.equal(sha(s.launch.library.record.cartridgePath),exported.cartridge.sha256);',
  'assert.equal(sha(s.cartridges[0].path),exported.cartridge.sha256);\n' +
  '    s.launch.scope="ACTUAL_CURRENT_NSIS_SHIPPED_PLAYER_PUBLIC_PREVIEW_NOT_LIBRARY_OR_STANDALONE";\n' +
  '    s.launch.cartridge=exported.cartridge;save();');
replace('  assert.deepEqual(report.pageErrors,[]);report.status="PASS";',
  `  await check("Natural story choice and quickbar states, actual branch/rollback and stable envelopes in twelve displays", async()=>{
    report.storyMatrix=[];
    await s.page.getByTestId("start-new-game").click();await s.ready("playing");await s.command("ui_acceptance",0);
    const playerLayout=saved.authored.settings.runtimeUILayoutProfiles.profiles.renpy.screens.find(x=>x.screen_id==="player");
    const autoLocal=playerLayout.components.find(c=>c.component_id==="quick_auto_button")?.style?.color;
    for(const [width,height] of [[1920,1080],[2560,1440],[3840,2160]])for(const dpr of [1,2])for(const reduced of [false,true]){
      await s.viewport({width,height,dpr,reduced});const p=s.page,row={display:{...s.expected},status:"RUNNING",samples:[]};
      report.storyMatrix.push(row);save();await p.mouse.move(0,0);
      const auto=p.getByTestId("renpy-quick-auto");
      const normal=await sample(auto,"quick_bar","normal",autoLocal?rgb(autoLocal):undefined);row.samples.push(normal);
      await auto.hover();const hover=await sample(auto,"quick_bar","hover");row.samples.push(hover);envelope(normal,hover);
      await auto.click();await p.mouse.move(0,0);
      const selected=await sample(auto,"quick_bar","selected");row.samples.push(selected);envelope(normal,selected);
      assert.equal(await auto.getAttribute("aria-pressed"),"true");await auto.click();await p.mouse.move(0,0);
      assert.equal(await auto.getAttribute("aria-pressed"),"false");
      const choice=p.getByRole("button",{name:"选择：继续",exact:true});
      if(!await choice.isVisible())await p.locator(".dialog-box").click();
      await choice.waitFor();await p.waitForFunction(()=>[...document.querySelectorAll(".choice-option")].every(n=>!n.disabled));
      await p.mouse.move(0,0);const choiceNormal=await sample(choice,"story_choice","normal");row.samples.push(choiceNormal);
      await choice.hover();const choiceHover=await sample(choice,"story_choice","hover");row.samples.push(choiceHover);envelope(choiceNormal,choiceHover);
      await choice.click();await s.command("ui_acceptance",0);await p.mouse.move(0,0);
      await p.keyboard.press("PageUp");const chosen=p.locator('.choice-option[aria-current="true"]');await chosen.waitFor();
      const chosenState=await sample(chosen,"story_choice","selected");row.samples.push(chosenState);envelope(choiceNormal,chosenState);
      assert.equal(chosenState.label,"继续");assert.equal(chosenState.state,"selected");
      await s.shot(\`\${width}-dpr\${dpr}-\${reduced}-story\`);
      await choice.click();await s.command("ui_acceptance",0);
      row.status="PASS";row.finishedAt=new Date().toISOString();save();console.log(\`PASS story roles \${width}/\${dpr}/\${reduced}\`);
    }
    assert.equal(report.storyMatrix.length,12);assert(report.storyMatrix.every(c=>c.status==="PASS"&&c.samples.length===6));
    assert.equal(report.violations.length,0);
    return {displays:12,actualSamples:72,realBranchAndRollback:true,normalQuickLocalOverridePreserved:autoLocal??null};
  });
  assert.deepEqual(report.pageErrors,[]);report.status="PASS";`);
replace('  report.finishedAt=new Date().toISOString();save();',
  '  try{module.qaRestore(report,save)}catch(e){report.cleanupError=String(e.stack||e);report.status="FAILED";process.exitCode=1}\n' +
  '  report.finishedAt=new Date().toISOString();report.tool={path:__filename,sha256:sha(__filename)};save();');
new vm.Script(Module.wrap(source), { filename: __filename });
if (mode === "self-test") {
  assert(source.includes('r.samples.length===17')); assert(source.includes('actualSamples:72'));
  assert(source.includes('assert.equal(report.violations.length,0')); assert(source.includes('await p.keyboard.press("PageUp")'));
  assert(!fs.existsSync(out));
  console.log(JSON.stringify({ status: "PASS", adaptations: changes.length, menuSamples: 204, storySamples: 72, productStarts: 0 }));
  return;
}
let prepared = false;
function profile(action, report, save) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView", "-Storage", "NativeRoaming"],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.profileCommands ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const worker = new Module(__filename, module);
Object.assign(worker, { filename: __filename, paths: module.paths, qaConfig: config, qaAuthor: authored,
  qaAuthorDescription: desc(authorFile), qaFixture: fixture, qaPreparation: prep,
  qaSession: class extends InstalledPreview1922Session {
    constructor(options) { super({ ...options, currentNative: true }); }
  },
  qaBinding: { config: desc(configFile), installation: authored.installation, business: desc(file), changes,
    executedSourceSha256: require("node:crypto").createHash("sha256").update(source).digest("hex"),
    session: desc(path.join(__dirname, "lib/installed-runtime-preview-1922-session.cjs")) },
  qaPrepare(report, save) {
    fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "executed-business.cjs"), source, { flag: "wx" });
    fs.mkdirSync(prep.temporary); prepared = true; profile("Prepare", report, save);
    prep.profiles = read(path.join(out, "profile-protection.json")).records; assert(prep.profiles.every(p => p.existed));
  },
  qaRestore(report, save) {
    if (prepared && fs.existsSync(path.join(out, "profile-protection.json"))) {
      profile("Restore", report, save); report.profileRestoration = read(path.join(out, "profile-restoration.json"));
      assert.equal(report.profileRestoration.status, "PASS");
    }
    for (const f of [authored.fixture, authored.installation, authored.cartridge, authored.tool, authored.originalBusiness,
      ...actual.resources, ...installation.protectedFiles]) assert.equal(sha(f.path), f.sha256);
  },
});
process.env.AGENTVN_TEST_PROJECT = fixture.input; process.env.AGENTVN_WORKSPACE_OUTPUT = config.qa;
process.argv = [process.execPath, __filename, playerAttempt];
worker._compile(source, __filename);
