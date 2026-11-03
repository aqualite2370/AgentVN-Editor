"use strict";
// Current-candidate real legacy NSIS upgrade. Reuse the preserved physical
// profile protection and old UI flow; never synthesize a migration decision.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm"), { spawnSync } = require("node:child_process");
const { adapt, validateConfig } = require("./editor-candidate-upgrade.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { ps, rows } = require("./lib/current-native-editor-session.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
const originals = {
  cross: ["candidate-1924-editor-cross.cjs", "a93a434fe5cfdd6c1701e14b5ef398a5af59324841548db31e310d9b0bcd6424"],
  business: ["candidate-1924-editor-upgrade.cjs", "e1f4b9f0c040595d1e84dfc6117c7609d7c7e288308e9907ac67a1c64eb1fcb1"],
  session: ["candidate-1924-editor-upgrade-session.ps1", "46bbca490bcc316d467b97d34dd5ca3c5624db881caeddee9995aec23bc2dbd7"],
};
function validateNativeCloseReceipt(request, result) {
  for (const key of ["pid", "created", "label"]) assert.equal(result[key], request[key], key);
  assert.equal(result.method, "Computer Use Alt+F4");
  assert.equal(result.physicalInput, true);
  assert.equal(result.normalClose, true);
  assert.equal(result.status, "PASS");
  assert(Number.isSafeInteger(result.windowId) && result.windowId > 0);
  return result;
}
function original(kind) {
  const [name, expected] = originals[kind], file = path.join(__dirname, name);
  assert.equal(sha(file), expected); return fs.readFileSync(file, "utf8");
}
function build(c, registered) {
  validateConfig(c); assert.equal(c.oldVersion, "1.7.1"); assert.equal(c.version, "1.9.31");
  assert(c.closeMode === undefined || c.closeMode === "computer-use");
  const wrapper = original("cross"), cutoff = wrapper.indexOf('const filename=path.join(__dirname,');
  assert(cutoff > 0); original("business");
  // Only execute the pinned QA source transformation, stopping before its
  // business code is compiled or any native operation is started.
  let source = new Function("require", "__dirname", wrapper.slice(0, cutoff) + "\nreturn source;")(require, __dirname);
  const changes = [];
  const one = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, "Cross candidate drift: " + before.slice(0, 90));
    source = source.replace(before, () => after); changes.push({ before, after });
  };
  one("F:/AgentVN/QA/Editor-Cross-1924-20261025-03", c.out);
  one('"scripts/candidate-1924-editor-cross-session.ps1"', JSON.stringify(path.join(c.preparation, "session.ps1")));
  one("REAL_NSIS_1_7_1_TO_1_9_24_NATIVE_CONSENT_ON_DEVELOPMENT_HOST",
    "REAL_NSIS_1_7_1_TO_1_9_31_NATIVE_CONSENT_ON_DEVELOPMENT_HOST");
  assert.equal(source.split("Editor跨代1924临时工程").length - 1, 2);
  source = source.replaceAll("Editor跨代1924临时工程", "Editor跨代1931临时工程");
  assert(source.includes('await launch("new","1.9.24")'));
  source = source.replaceAll("1.9.24", c.version);
  const begin = source.indexOf("async function closeNormally(label){"), end = source.indexOf("async function forceCleanup()", begin);
  assert(begin > 0 && end > begin);
  one(source.slice(begin, end), c.closeMode === "computer-use" ? `async function closeNormally(label){
  remember();
  const request={label,pid:current.pid,created:current.created,exe:current.exe,
    requestedAt:new Date().toISOString(),ports:current.ports,
    completion:path.join(out,"native-close-"+label+"-completed.json")};
  fs.writeFileSync(path.join(out,"computer-use-close-"+label+"-request.json"),JSON.stringify(request,null,2),{flag:"wx"});
  console.log("COMPUTER_USE_CLOSE",JSON.stringify(request));
  await until(()=>fs.existsSync(request.completion),"real native close receipt "+label,180000);
  const result=require("./editor-cross-candidate.cjs").validateNativeCloseReceipt(request,read(request.completion));
  await until(()=>!rows().some(p=>p.ProcessId===current.pid&&p.Created===current.created)
    &&listeners(current.ports).length===0,"physical close host/backend shutdown "+label,30000);
  fs.writeFileSync(path.join(out,label+"-close-native.json"),JSON.stringify(result,null,2),{flag:"wx"});
  await browser.close().catch(()=>{});browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,method:result.method,killed:[],ports:current.ports});save();
  return result;
}
` : `async function closeNormally(label){
  remember();
  const helper=require("./lib/installed-background-close.cjs");
  const close=helper.closeInstalledWindow(current);
  close.catch(()=>{});
  let result;
  try{
    result=await Promise.race([close,new Promise((_,reject)=>{
      const timer=setTimeout(()=>reject(Error("Bounded native close did not complete")),45000);timer.unref();
    })]);
  }catch(error){
    result={...error.closeEvidence,status:"FAILED",error:String(error.stack||error),
      method:"Installed native window.close via public Tauri IPC",physicalInput:false,normalClose:false};
    fs.writeFileSync(path.join(out,label+"-close-native.json"),JSON.stringify(result,null,2),{flag:"wx"});
    throw error;
  }
  fs.writeFileSync(path.join(out,label+"-close-native.json"),JSON.stringify(result,null,2),{flag:"wx"});
  assert.equal(result.status,"PASS");assert.equal(result.normalClose,true);
  await browser.close().catch(()=>{});browser=null;child=null;
  report.cleanups.push({label,status:"PASS",normalClose:true,method:result.method,killed:[],ports:current.ports});save();
  return result;
}
`);
  const oldBegin = source.indexOf('    await step("old-install-local-database-after-attributed-stop-NOT-normal-close"');
  const oldEnd = source.indexOf('    await step("real-same-directory-NSIS-upgrade-without-uninstall"', oldBegin);
  assert(oldBegin > 0 && oldEnd > oldBegin);
  one(source.slice(oldBegin, oldEnd), `    await step("old-close-and-authentic-install-local-database",async()=>{
      try{report.oldNativeClose=await closeNormally("old");}
      catch(error){report.oldNativeClose={status:"FAILED",normalClose:false,
        evidence:path.join(out,"old-close-native.json"),error:String(error)};await forceCleanup();}
      const database=path.join(install,"data/backend/vn_engine.db");assert(fs.existsSync(database));
      const retained=path.join(out,"old-install-local.db");
      fs.copyFileSync(database,retained,fs.constants.COPYFILE_EXCL);
      report.legacyDatabase={path:database,backup:retained,sha256:sha(database)};
      assert.equal(sha(retained),report.legacyDatabase.sha256);save();
      return {database:report.legacyDatabase,oldNativeClose:report.oldNativeClose};
    });
`);
  one('    const pending=page.waitForEvent("download");', `    await until(async()=>{
      const s=await snapshot(),n=s.graph.nodes.find(n=>n.id==="node_scene_opening");
      return n?.data?.scene?.summary==="真实旧版1.7.1跨代保留正文与场景"
        && n.data.description===n.data.scene.summary;
    },"old UI summary actually persisted before save",30000);
    const pending=page.waitForEvent("download");`);
  one("const nodes=structuredClone(project.graph.nodes);",
    `const nodes=structuredClone(project.graph.nodes);
  // React Flow recomputes measured size when authored text changes. Do not
  // confuse that presentation cache with authored width/height or positions.
  for(const node of nodes)if(node.measured!==undefined){
    assert(node.measured&&typeof node.measured==="object"&&!Array.isArray(node.measured));
    for(const [key,value]of Object.entries(node.measured)){
      assert(["width","height"].includes(key)&&Number.isFinite(value)&&value>=0);
    }
    delete node.measured;
  }`);
  one('baseline.graph.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary="实际跨代后新保存1.9.31";',
    'baseline.graph.nodes.find(n=>n.id==="node_scene_opening").data.scene.summary="实际跨代后新保存1.9.31";\n' +
    '      baseline.graph.nodes.find(n=>n.id==="node_scene_opening").data.description="实际跨代后新保存1.9.31";\n' +
    '      await until(async()=>{try{retainedFields(comparable(await snapshot()),comparable(baseline));return true;}catch{return false;}},"new UI edit actually persisted",30000);');
  one('"real native migration consent receipt",600000', '"real native migration consent receipt",120000');
  one('report.status="PASS";', 'report.status=report.oldNativeClose.status==="PASS"?"PASS":"PARTIAL_PASS_OLD_CLOSE_FAILED";');
  one('fs.copyFileSync(__filename,path.join(out,"cross-driver.cjs"),fs.constants.COPYFILE_EXCL);',
    'fs.copyFileSync(__filename,path.join(out,"cross-driver.cjs"),fs.constants.COPYFILE_EXCL);\n' +
    '    fs.writeFileSync(path.join(out,"executed-business.cjs"),module.qaSource,{flag:"wx"});');
  new vm.Script(Module.wrap(source));
  let session = adapt("session", original("session"), c, registered).source;
  const psOne = (a, b) => {
    assert.equal(session.split(a).length - 1, 1, "Cross PS drift: " + a);
    session = session.replace(a, () => b);
  };
  psOne("$result.persistenceBefore=@(Files (Join-Path $roots[0] 'backend'))",
    "$result.persistenceBefore=@(Files (Join-Path $install 'data\\backend'))");
  psOne("'D:\\AgentVN\\scripts\\editor-candidate-upgrade.cjs'", `'${__filename}'`);
  return { source, session, changes };
}
function prepare(c, configFile) {
  const registered = JSON.parse(ps("$k=Get-ItemProperty -LiteralPath " +
    "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\AgentVN Editor';" +
    "[PSCustomObject]@{path=([string]$k.InstallLocation).Trim('\"');version=$k.DisplayVersion}|ConvertTo-Json -Compress"));
  assert(path.resolve(registered.path).startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
  const built = build(c, registered);
  const bindingFile = path.join(c.preparation, "binding.json");
  if (fs.existsSync(bindingFile)) {
    const bound = read(bindingFile); assert.deepEqual(bound.config, c);
    for (const f of bound.files) assert.equal(sha(f.path), f.sha256); return bound;
  }
  assert(!fs.existsSync(c.preparation) && !fs.existsSync(c.out) && !fs.existsSync(c.checkpoint));
  assert.equal(sha(c.oldInstaller.path), c.oldInstaller.sha256);
  const actual = deriveActual(c.actualInstallation, c.version);
  const raw = read(c.actualInstallation.path); assert.equal(raw.installer.sha256, c.installerSHA256);
  const candidate = { status: "PASS", executable: { ...actual.executable, version: c.version },
    resources: actual.resources, package: raw.installer,
    protectedFiles: [desc(c.actualInstallation.path), raw.installer, actual.executable, ...actual.resources,
      ...(c.protectedFiles || [])] };
  for (const f of candidate.protectedFiles) assert.equal(sha(f.path), f.sha256);
  fs.mkdirSync(c.preparation);
  for (const [name, text] of [["business.cjs", built.source], ["session.ps1", built.session]])
    fs.writeFileSync(path.join(c.preparation, name), text, { flag: "wx" });
  fs.writeFileSync(path.join(c.preparation, "candidate-installation.json"), JSON.stringify(candidate, null, 2), { flag: "wx" });
  const cleanup = fs.readFileSync(path.join(__dirname, "editor-upgrade-1930-cleanup.ps1"), "utf8")
    .replaceAll("F:\\AgentVN\\QA\\Editor-Upgrade-1930-20261026-01", c.out.replaceAll("/", "\\"))
    .replaceAll("editor-upgrade-1930-20261026-01", path.basename(c.out).toLowerCase());
  fs.writeFileSync(path.join(c.preparation, "cleanup.ps1"), cleanup, { flag: "wx" });
  const binding = { status: "PREPARED_NOT_TESTED", config: c, registered,
    scope: "REAL_CROSS_GENERATION_NSIS_NATIVE_CONSENT_NOT_PROFILE_REPLAY",
    productChanges: 0, modelRequests: 0, changes: built.changes,
    files: [__filename, configFile, c.actualInstallation.path, c.oldInstaller.path,
      ...["business.cjs", "session.ps1", "candidate-installation.json", "cleanup.ps1"].map(n => path.join(c.preparation, n)),
      ...Object.values(originals).map(([n]) => path.join(__dirname, n)),
      path.join(__dirname, "lib/installed-background-close.cjs")].map(desc) };
  fs.writeFileSync(bindingFile, JSON.stringify(binding, null, 2), { flag: "wx" });
  return binding;
}
function main() {
  const [action, file] = process.argv.slice(2); assert(file);
  assert(["self-test", "run", "cleanup", "verify-cleanup"].includes(action));
  const c = read(file), binding = prepare(c, path.resolve(file));
  assert(!rows().some(p => /^(AgentVN Dev|agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
  if (action === "cleanup" || action === "verify-cleanup") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(c.preparation, "cleanup.ps1"), ...(action === "verify-cleanup" ? ["-VerifyOnly"] : [])],
    { windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 5e6 });
    console.log(result.stdout); assert.equal(result.status, 0, result.stderr); return;
  }
  if (action === "self-test") {
    const negative = [
      x => x.oldVersion = "1.9.30", x => x.version = x.oldVersion, x => x.out = "C:/Users/1",
      x => x.checkpoint = "F:/", x => x.preparation = x.out, x => x.oldInstaller.sha256 = "",
      x => x.closeMode = "fake",
    ];
    for (const mutate of negative) {
      const bad = structuredClone(c); mutate(bad); assert.throws(() => build(bad, binding.registered));
    }
    const request = {pid:1,created:"owned",label:"old"};
    const receipt = {...request,method:"Computer Use Alt+F4",physicalInput:true,normalClose:true,status:"PASS",windowId:5};
    validateNativeCloseReceipt(request,receipt);
    const badReceipts = [
      r=>r.pid=2,r=>r.created="stale",r=>r.label="new",r=>r.method="IPC",
      r=>r.physicalInput=false,r=>r.normalClose=false,r=>r.status="FAILED",r=>r.windowId=0,
    ];
    for(const mutate of badReceipts){const bad=structuredClone(receipt);mutate(bad);assert.throws(()=>validateNativeCloseReceipt(request,bad));}
    console.log(JSON.stringify({ configNegativesRejected: negative.length, closeReceiptsRejected:badReceipts.length,
      status: "PASS", nativeApps: 0, modelRequests: 0 }));
  }
  process.argv.splice(2, process.argv.length - 2, action === "run" ? "run" : "--self-test");
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaSource = fs.readFileSync(path.join(c.preparation, "business.cjs"), "utf8");
  worker._compile(worker.qaSource, __filename);
}
module.exports = { build, validateNativeCloseReceipt };
if (require.main === module) main();
