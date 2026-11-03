"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { currentExitVerifier } = require("./lib/renpy-official-android-flow.cjs");
const original = path.join(__dirname, "android-current-navigation.cjs");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const packageName = "com.agentvn.qa.renpygui20261025";
function validateRequestShape(q) {
  assert.equal(q.scope, "installed-renpy-resource-navigation"); assert.equal(q.package, packageName);
  assert.equal(q.serial, "emulator-5554"); assert.equal(q.coldBoot?.avd, "AgentVN_API35");
  assert.equal(q.sdk, "D:\\Android_dev\\Sdk");
  assert.equal(q.exitProbe, undefined); assert.equal(q.traceExitBoundary, undefined);
  assert.match(q.outputDir, /^F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-renpy-19-\d{2}\\runtime$/);
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
  assert.equal(q.resourceAssets.length, 7);
}
function validateRenpyRequest(q) {
  validateRequestShape(q);
  assert.equal(fileEvidence(q.apk.path).sha256, q.apk.sha256);
  assert.equal(path.resolve(q.packageAudit.path),
    path.resolve("F:/AgentVN/QA/Android-Package-20261021-01/renpy-artifact-19-audit-01/report.json"));
  assert.equal(fileEvidence(q.packageAudit.path).sha256, q.packageAudit.sha256);
  const audit = read(q.packageAudit.path);
  assert.equal(audit.status, "RENPY_RESOURCE_APK_PASS_SUPPLEMENTAL_NORMAL_PUBLISH_BLOCKED_DEVICE_NOT_RUN");
  assert.equal(audit.apk.sha256, q.apk.sha256); assert.equal(audit.identity.packageName, packageName);
  assert.deepEqual(audit.embeddedAssets, q.resourceAssets);
}
function adapt(input = fs.readFileSync(original)) {
  assert.equal(hash(input), "32a67b718db769d78f0b049935c5514d545aea19d9e3a2fb2902edcedcea17f7");
  let source = input.toString("utf8"); const changes = [];
  function replace(before, after, count = 1) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after); changes.push({ before, after, count });
  }
  replace("const pkg = \"com.agentvn.qa.androidcurrent20261021\";", `const pkg = "${packageName}";`);
  const validationStart = source.indexOf("function validateNavigationRequest(q) {");
  const validationEnd = source.indexOf("class Client {");
  assert(validationStart > 0 && validationEnd > validationStart);
  replace(source.slice(validationStart, validationEnd),
    "function validateNavigationRequest(q) { return module.validateRenpyRequest(q); }\n");
  replace('    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);',
    '    const rootResult = text(["shell","id","-u"]) === "0" ? {status:0,stdout:"already running as root",stderr:""} : cmd(["root"],false,true);\n' +
    '    r.adbRoot=rootResult;\n' +
    '    r.rootTransport=await require("./lib/android-adb-root-recovery.cjs").recoverOwnedRootTransport(rootResult,\n' +
    '      async()=>{assert(ownedAdb);text(["kill-server"]);text(["start-server"]);},async()=>{\n' +
    '        await wait(()=>cmd(["get-state"],false,true).stdout?.trim()==="device","same owned root transport");\n' +
    '        assert.equal(text(["shell","cat","/proc/sys/kernel/random/boot_id"]),r.coldBoot.observedBootId);\n' +
    '        await wait(()=>cmd(["shell","id","-u"],false,true).stdout?.trim()==="0","read-only native saves");});\n' +
    '    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);');
  replace('    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });',
    '    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });\n' +
    '    if(selector===\'[data-testid="confirm-exit-game"]\')return;');
  const scenarioStart = source.indexOf("    if (q.exitProbe) {");
  const scenarioEnd = source.indexOf('    const logs = text(["logcat"', scenarioStart);
  assert(scenarioStart > 0 && scenarioEnd > scenarioStart);
  replace(source.slice(scenarioStart, scenarioEnd),
    '    await require("./lib/renpy-official-android-flow.cjs").verifyRenpyOfficialFlow({\n' +
    '      q,r,cmd,text,wait,tap,evalWait,idle,shot,position,out,Client,save,back,step,\n' +
    '      priorTabId:tab.id,getClient:()=>client,setClient:value=>{client=value;}});\n');
  replace("PASS_LIMITED_AGENTVN_NAVIGATION", "PASS_LIMITED_RENPY_OFFICIAL_GUI");
  replace("if (require.main === module)", "if (module.qaRun)");
  new vm.Script(Module.wrap(source), { filename: __filename }); return { source, changes };
}
const adapted = adapt(), worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths; worker.validateRenpyRequest = validateRenpyRequest;
worker.qaRun = require.main === module && process.argv[2] !== "--self-test";
worker._compile(adapted.source, __filename);
module.exports = { validateRenpyRequest, validateRequestShape };
if (require.main === module && process.argv[2] === "--self-test") {
  const q = { scope: "installed-renpy-resource-navigation", package: packageName, serial: "emulator-5554",
    sdk: "D:\\Android_dev\\Sdk", outputDir: "F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-renpy-19-01\\runtime",
    adbPort: 51001, cdpPort: 51002, coldBoot: { avd: "AgentVN_API35", adbPort: 51003, grpcPort: 51004 },
    resourceAssets: Array.from({ length: 7 }, () => ({})) };
  validateRequestShape(q);
  const bad = [v => { v.scope = "other"; }, v => { v.package += ".wrong"; },
    v => { v.outputDir = "D:\\AgentVN"; }, v => { v.cdpPort = v.adbPort; },
    v => { v.coldBoot = null; }, v => { v.resourceAssets.pop(); },
    v => { v.exitProbe = "anything"; }, v => { v.traceExitBoundary = true; }];
  for (const mutate of bad) { const value = structuredClone(q); mutate(value); assert.throws(() => validateRequestShape(value)); }
  for (const bytes of [Buffer.from("wrong"), Buffer.concat([fs.readFileSync(original), Buffer.from("\n")])])
    assert.throws(() => adapt(bytes));
  currentExitVerifier();
  console.log(JSON.stringify({ status: "PASS", invalidRequestShapesRejected: bad.length, sourceDriftRejected: 2,
    transformations: adapted.changes.length, currentActivityExitLoaded: true,
    actualArtifactProvenance: "NOT_RUN_UNTIL_ARTIFACT_AUDIT", deviceOperations: 0 }));
}
