"use strict";
// Reuse the existing 32 functional opening flows with the frozen installation.
// Timing, frame counts and easing are deliberately outside this functional run.
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const vm = require("node:vm"), assert = require("node:assert/strict");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows } = require("./lib/current-native-editor-session.cjs");
const out = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/opening-functional-1935-01";
const qa = "F:/AgentVN/QA/Opening-Functional-1.9.35-20261102-01";
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
const original = path.join(__dirname, "candidate-1924-opening-playwright.cjs");
const sessionFile = path.join(__dirname, "lib/candidate-1924-opening-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function evidence(f, directory) {
  assert.equal(path.resolve(f), path.resolve(receipt)); assert.equal(path.resolve(directory), path.resolve(out));
  const installed = descriptor(); assert.deepEqual(read(f).executable, installed.executable);
  return { executable: installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe"), receipt: desc(f) };
}
function build() {
  let source = fs.readFileSync(original, "utf8"); const edits = [];
  function change(before, after) {
    assert.equal(source.split(before).length - 1, 1, "Exact QA adaptation required: " + before);
    source = source.replace(before, () => after); edits.push({ before, after });
  }
  function region(start, end, after) {
    const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
    assert(a > 0 && b > a); change(source.slice(a, b), after);
  }
  change('require("./lib/candidate-1924-opening-session.cjs")', 'module.qaSession');
  change('const out=`F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-installed-1924-${attempt}`;',
    `const out=${JSON.stringify(out)};`);
  change('const installationFile="F:/AgentVN/QA/Editor-1.9.24-20261024-01/installation.json";',
    `const installationFile=${JSON.stringify(receipt)};`);
  change('"INSTALLED_1_9_24_BUNDLED_NATIVE_PREVIEW_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"',
    '"ACTUAL_CURRENT_INSTALLED_FUNCTIONAL_OPENING_NOT_AUTHOR_EXPORT_STANDALONE_UPGRADE_OR_ANDROID"');
  change('    __filename,"scripts/lib/candidate-1924-opening-session.cjs","scripts/lib/current-native-capture.cjs",\n    "scripts/native-dev-preview-profile.ps1"].map(desc)};',
    `    module.qaAdapter,module.qaExecuted,"scripts/lib/current-native-capture.cjs",${JSON.stringify(helper)}].map(desc),
    qaBinding:module.qaBinding,productChanges:0,builds:0,
    excludedAssertions:["Motion frame counts, CSS durations, opacity curves, transition black-frame timing"]};`);
  change('path.join(root,"scripts/native-dev-preview-profile.ps1")', JSON.stringify(helper));
  region("async function record(page){", "async function runCase(params,kind,layout){", `async function record(page){
  await page.evaluate(()=>{
    window.__openingFrames=[];window.__openingEvents=[];window.__openingMediaEvents=[];
    document.addEventListener("ended",e=>{
      if(e.target instanceof HTMLVideoElement)window.__openingEvents.push({event:"ended",time:e.target.currentTime});
    },true);
    for(const type of ["loadedmetadata","loadeddata","canplay","playing"])document.addEventListener(type,e=>{
      if(e.target instanceof HTMLVideoElement)window.__openingMediaEvents.push({
        event:type,time:e.target.currentTime,ready:e.target.readyState});
    },true);
  });
}
`);
  change('      assert(await page.getByRole("button",{name:"重试",exact:true}).isVisible());row.errorVisible=true;',
    `      assert(await page.getByRole("button",{name:"重试",exact:true}).isVisible());row.errorVisible=true;
      await page.getByRole("button",{name:"重试",exact:true}).click();
      await page.locator(".boot-card .project-entry-loader").waitFor();
      await page.evaluate(cartridgeBase64=>window.postMessage({
        type:"agentvn.runtime.preview",cartridgeBase64,fileName:"recovered.vncart",previewNonce:"functional-retry"},"*"),
        fs.readFileSync(fixture("default",layout)).toString("base64"));
      await page.getByTestId("start-new-game").click();
      await page.getByTestId("game-state-playing").waitFor();
      assert.equal(await page.getByRole("alert").count(),0);
      row.actualRetryAndNewCartridgeRecovery=true;`);
  region('      const frames=await page.evaluate(()=>window.__openingFrames);', '    }\n    if(kind!=="broken"){',
    `      if(kind==="video"){
        row.events=await page.evaluate(()=>window.__openingEvents);
        if(params.interrupt){
          assert.equal(row.events.length,0);
          assert(await page.evaluate(()=>window.__abandonedOpeningVideo.paused&&!window.__abandonedOpeningVideo.hasAttribute("src")));
        }else assert.equal(row.events.filter(e=>e.event==="ended").length,1);
      }
`);
  change('      await page.getByTestId("start-new-game").click();await page.getByTestId("game-launch-blackout").waitFor();',
    '      await page.getByTestId("start-new-game").click();');
  change('row.storyBlackoutPreserved=true;', 'row.storyReachedAfterOpening=true;');
  region('  report.boundaryChecks=[];', '  for(const f of prior.fixtures){',
    '  report.boundaryChecks=[{status:"PASS",scope:"Exact current receipt and F drive output enforced by adapter"}];\n');
  // Stop on a discovered product defect instead of replaying it in every display.
  change('    console.log(JSON.stringify({kind,layout,...params,status:row.status,error:row.error}));',
    '    console.log(JSON.stringify({kind,layout,...params,status:row.status,error:row.error}));\n' +
    '    assert.equal(row.status,"PASS","Preserve first failed opening flow; no automatic replay");');
  new vm.Script(Module.wrap(source));
  for (const assertion of ['row.input.focused&&row.input.backgroundInert&&row.input.titleBlocked',
    'g.media.width>=params.width-1&&g.media.height>=params.height-1',
    'assert.equal(report.cases.length,32)', 'assert.equal(report.screenshots.length,28)',
    'row.events.filter(e=>e.event==="ended").length,1'])
    assert(source.includes(assertion), assertion);
  return { source, edits };
}
function sessionSource() {
  let s = fs.readFileSync(sessionFile, "utf8");
  const a = s.indexOf("function openingCandidateEvidence(file,out){"), b = s.indexOf("async function candidateOpeningSession(", a);
  assert(a > 0 && b > a);
  s = s.slice(0, a) + "const openingCandidateEvidence=module.qaEvidence;\n" + s.slice(b);
  assert(s.includes('assert.equal(gpu.featureStatus.gpu_compositing,"enabled");'));
  s = s.replace('assert.equal(gpu.featureStatus.gpu_compositing,"enabled");', '');
  const wait = 'page=await until(()=>browser.contexts().flatMap(c=>c.pages()).find(p=>/tauri\\.localhost/.test(p.url())),"candidate opening page");';
  assert(s.includes(wait)); s = s.replace(wait, 'page=await require("./wait-native-runtime-page.cjs").waitNativeRuntimePage(browser);');
  new vm.Script(Module.wrap(s)); return s;
}
function main() {
  const mode = process.argv[2]; assert(["self-test", "run"].includes(mode));
  evidence(receipt, out); const b = build(), session = sessionSource();
  const prior = read("F:/AgentVN/QA/Native-Runtime-State-20261020-01/opening-native-time02-01/report.json");
  assert.equal(prior.status, "PASS"); assert.equal(prior.cases.length, 32);
  for (const f of prior.fixtures) assert.equal(sha(f.path), f.sha256);
  if (mode === "self-test") {
    console.log(JSON.stringify({ status: "PASS", functionalFlows: 32, fixtureCount: prior.fixtures.length,
      starts: 0, pureMotionAssertions: 0 })); return;
  }
  assert(!rows().some(p => /^(agentvn-editor|agentvn-player|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  assert(!fs.existsSync(qa) && !fs.existsSync(out)); fs.mkdirSync(qa);
  const executed = path.join(qa, "executed.cjs"), sessionExecuted = path.join(qa, "session-executed.cjs");
  fs.writeFileSync(executed, b.source, { flag: "wx" }); fs.writeFileSync(sessionExecuted, session, { flag: "wx" });
  const binding = path.join(qa, "binding.json");
  fs.writeFileSync(binding, JSON.stringify({ original: desc(original), adapter: desc(__filename), executed: desc(executed),
    originalSession: desc(sessionFile), executedSession: desc(sessionExecuted), helper: desc(helper), installation: desc(receipt),
    edits: b.edits, productChanges: 0, modelRequests: 0, builds: 0 }, null, 2), { flag: "wx" });
  const factory = new Module(sessionFile, module);
  Object.assign(factory, { filename: sessionFile, paths: Module._nodeModulePaths(path.dirname(sessionFile)), qaEvidence: evidence });
  factory._compile(session, sessionFile);
  const worker = new Module(original, module);
  Object.assign(worker, { filename: original, paths: Module._nodeModulePaths(__dirname), qaSession: factory.exports,
    qaAdapter: __filename, qaExecuted: executed, qaBinding: desc(binding) });
  process.argv.splice(2, process.argv.length - 2, "01");
  worker._compile(b.source, original);
}
if (require.main === module) main();
