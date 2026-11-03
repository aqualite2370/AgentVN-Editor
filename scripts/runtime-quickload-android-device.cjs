"use strict";
// The shared ADB runner keeps its real inputs, read-only CDP and finally.
// Bind this run to a new source-built APK, never to frozen installed evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { allocateAndroidDevicePorts } = require("./lib/android-device-ports.cjs");
const root = "F:\\AgentVN\\QA\\Android-Package-20261021-01";
const original = path.join(__dirname, "android-current-navigation.cjs");
const pkg = "com.agentvn.qa.renpygui20261025";
const scope = "source-quickload-renpy-navigation";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function validateShape(q) {
  assert.equal(q.scope, scope); assert.equal(q.package, pkg);
  assert.equal(q.serial, "emulator-5554"); assert.equal(q.coldBoot?.avd, "AgentVN_API35");
  assert.equal(q.sdk, "D:\\Android_dev\\Sdk");
  assert.equal(q.exitProbe, undefined); assert.equal(q.traceExitBoundary, undefined);
  assert.match(q.outputDir, /^F:\\AgentVN\\QA\\Android-Package-20261021-01\\quickload-device-\d{2}\\runtime$/);
  assert.match(q.buildAttempt, /^\d{2}$/);
  assert.equal(path.resolve(q.packageAudit.path), path.join(root, "quickload-apk-" + q.buildAttempt, "audit/report.json"));
  assert.equal(q.resourceAssets.length, 7);
  for (const asset of q.resourceAssets) {
    assert.equal(typeof asset.id, "string"); assert(asset.id.length);
    assert.equal(typeof asset.path, "string"); assert(asset.path.length);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert(asset.bytes > 0);
  }
  const ports = [q.adbPort, q.cdpPort, q.coldBoot.adbPort, q.coldBoot.grpcPort];
  assert.equal(new Set(ports).size, 4);
  assert(ports.every(p => Number.isInteger(p) && p > 1024 && p <= 65535));
}
async function auditedResources(audit, buildAttempt) {
  const preparationFile = path.join(root, "quickload-apk-" + buildAttempt, "preparation.json");
  const recorded = audit.sources.find(row => path.resolve(row.path) === preparationFile);
  assert(recorded); assert.equal(fileEvidence(preparationFile).sha256, recorded.sha256);
  const preparation = read(preparationFile), cartridge = preparation.cartridge;
  assert.equal(fileEvidence(cartridge.path).sha256, cartridge.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.assets.length, 7); assert.equal(audit.embeddedAssets.length, 7);
  return manifest.assets.map(asset => {
    assert.equal(typeof asset.asset_id, "string"); assert(asset.asset_id.length);
    const matches = audit.embeddedAssets.filter(row => row.path === asset.path);
    assert.equal(matches.length, 1);
    return { id: asset.asset_id, path: asset.path, sha256: matches[0].sha256, bytes: matches[0].bytes };
  });
}
async function validateRequest(q) {
  validateShape(q);
  assert.equal(fileEvidence(q.apk.path).sha256, q.apk.sha256);
  assert.equal(fileEvidence(q.packageAudit.path).sha256, q.packageAudit.sha256);
  const audit = read(q.packageAudit.path);
  assert.equal(audit.status, "SOURCE_QUICKLOAD_APK_STATIC_PASS_DEVICE_NOT_RUN");
  assert(audit.finishedAt); assert.equal(audit.apk.sha256, q.apk.sha256);
  assert.equal(audit.identity.packageName, pkg);
  assert.deepEqual(await auditedResources(audit, q.buildAttempt), q.resourceAssets);
}
async function verifyFlow(c) {
  const flow = require("./lib/renpy-official-android-flow.cjs");
  await flow.verifyRenpyOfficialFlow({ ...c,
    step: (name, fn) => c.step(name.replace(/^Installed official/, "Source-built official"), fn) });
  const result = c.r.cases.at(-1).evidence;
  assert(result.exitedWithoutForceStop && result.restoredRuntimeOperable);
  const check = (saves, expected) => {
    assert(saves.some(row => row.value.save_kind === "auto" && row.value.command_index === 0
      && row.value.history.length === expected && row.value.history.every(h => h.text.startsWith("GUI_CONSUMPTION："))),
    "Actual disk must retain the current command and full loop history");
  };
  check(result.saved, 2); check(result.savedAfterSecond, 3);
  c.r.currentHistoryOnDisk = { status: "PASS", afterQuickloadLoop: 2, afterRecreatedLoop: 3 };
  c.save();
}
function adapt(input = fs.readFileSync(original)) {
  assert.equal(hash(input), "32a67b718db769d78f0b049935c5514d545aea19d9e3a2fb2902edcedcea17f7");
  let source = input.toString("utf8");
  const changes = [];
  function replace(before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    source = source.replace(before, after); changes.push({ before, after });
  }
  replace('const pkg = "com.agentvn.qa.androidcurrent20261021";', `const pkg = "${pkg}";`);
  const start = source.indexOf("function validateNavigationRequest(q) {"), end = source.indexOf("class Client {");
  assert(start > 0 && end > start);
  replace(source.slice(start, end), "function validateNavigationRequest(q) { return module.validateRequest(q); }\n");
  replace("  const q = read(requestFile); validateNavigationRequest(q);",
    "  const q = read(requestFile); await validateNavigationRequest(q);");
  replace("    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);",
    '    const rootResult = text(["shell","id","-u"]) === "0" ? {status:0,stdout:"already running as root",stderr:""} : cmd(["root"],false,true);\n' +
    '    r.adbRoot=rootResult;\n' +
    '    r.rootTransport=await require("./lib/android-adb-root-recovery.cjs").recoverOwnedRootTransport(rootResult,\n' +
    '      async()=>{assert(ownedAdb);text(["kill-server"]);text(["start-server"]);},async()=>{\n' +
    '        await wait(()=>cmd(["get-state"],false,true).stdout?.trim()==="device","same owned root transport");\n' +
    '        assert.equal(text(["shell","cat","/proc/sys/kernel/random/boot_id"]),r.coldBoot.observedBootId);\n' +
    '        await wait(()=>cmd(["shell","id","-u"],false,true).stdout?.trim()==="0","read-only native saves");});\n' +
    "    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);");
  replace('    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });',
    '    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });\n' +
    '    if(selector===\'[data-testid="confirm-exit-game"]\')return;');
  const scenarioStart = source.indexOf("    if (q.exitProbe) {");
  const scenarioEnd = source.indexOf('    const logs = text(["logcat"', scenarioStart);
  assert(scenarioStart > 0 && scenarioEnd > scenarioStart);
  replace(source.slice(scenarioStart, scenarioEnd),
    "    await module.verifyFlow({q,r,cmd,text,wait,tap,evalWait,idle,shot,position,out,Client,save,back,step,\n" +
    "      priorTabId:tab.id,getClient:()=>client,setClient:value=>{client=value;}});\n");
  replace("PASS_LIMITED_AGENTVN_NAVIGATION", "PASS_SOURCE_QUICKLOAD_RENPY_NAVIGATION");
  replace("if (require.main === module)", "if (module.qaRun)");
  new vm.Script(Module.wrap(source), { filename: __filename }); return { source, changes };
}
const adapted = adapt(), worker = new Module(__filename, module);
worker.filename = __filename; worker.paths = module.paths; worker.validateRequest = validateRequest; worker.verifyFlow = verifyFlow;
worker.qaRun = require.main === module && /\.json$/i.test(process.argv[2] || "");
worker._compile(adapted.source, __filename);
async function launch(attempt, buildAttempt) {
  assert.match(attempt || "", /^\d{2}$/); assert.match(buildAttempt || "", /^\d{2}$/);
  const auditFile = path.join(root, "quickload-apk-" + buildAttempt, "audit/report.json"), audit = read(auditFile);
  assert.equal(audit.status, "SOURCE_QUICKLOAD_APK_STATIC_PASS_DEVICE_NOT_RUN");
  const out = path.join(root, "quickload-device-" + attempt); fs.mkdirSync(out);
  const r = { status: "PREPARING", startedAt: new Date().toISOString(), scope,
    modelRequests: 0, productChanges: 0, packageAudit: fileEvidence(auditFile) };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  try {
    const previous = read(path.join(root, "device-renpy-19-02/request-submitted.json"));
    const [adbPort, cdpPort, bootPort, grpcPort] = await allocateAndroidDevicePorts();
    const q = { scope, package: pkg, runId: "quickload-renpy-20261025-" + attempt, buildAttempt,
      outputDir: path.join(out, "runtime"), sdk: previous.sdk, serial: previous.serial, adbPort, cdpPort,
      apk: audit.apk, packageAudit: fileEvidence(auditFile), resourceAssets: await auditedResources(audit, buildAttempt),
      coldBoot: { ...previous.coldBoot, adbPort: bootPort, grpcPort } };
    await validateRequest(q);
    const tools = [__filename, path.join(__dirname, "runtime-quickload-android-device.ps1"), original,
      ...["start-android-acceptance.ps1", "android-acceptance-preflight.ps1", "android-cold-boot.ps1",
        "lib/renpy-official-android-flow.cjs", "lib/current-android-navigation-exit.cjs",
        "lib/android-activity-exit.cjs", "lib/android-adb-root-recovery.cjs",
        "android-runtime-log-analysis.cjs"].map(f => path.join(__dirname, f))];
    r.tools = tools.map(file => {
      fs.copyFileSync(file, path.join(out, path.basename(file)), fs.constants.COPYFILE_EXCL);
      return fileEvidence(file);
    });
    const request = path.join(out, "request.json");
    fs.writeFileSync(request, JSON.stringify(q, null, 2), { flag: "wx" });
    fs.copyFileSync(request, path.join(out, "request-submitted.json"), fs.constants.COPYFILE_EXCL);
    r.status = "AWAITING_SAME_OWNED_DEVICE_RUN"; save();
    r.launchOutput = execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "runtime-quickload-android-device.ps1"), "-RequestPath", request],
    { windowsHide: true, encoding: "utf8", timeout: 120000 }); save();
    const deadline = Date.now() + 25 * 60000, launchFile = path.join(q.outputDir, "acceptance-launch.json");
    while (Date.now() < deadline) {
      if (fs.existsSync(launchFile)) {
        let value; try { value = read(launchFile); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        if (value?.finishedAt) { r.launch = { ...fileEvidence(launchFile), value }; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    assert(r.launch, "Observation expired; inspect same owner, never relaunch");
    assert.equal(r.launch.value.isElevated, true); assert.equal(r.launch.value.emulatorCleanupStatus, "PASS");
    const file = path.join(q.outputDir, "navigation-report.json");
    r.runtime = { ...fileEvidence(file), value: read(file) };
    const value = r.runtime.value;
    assert(value.finishedAt); assert.equal(value.scope, scope);
    for (const field of ["uninstallStatus", "apkCleanupStatus", "adbCleanupStatus"]) assert.equal(value[field], "PASS");
    assert.equal(value.cleanupError, null);
    if (value.status !== "FAILED") {
      assert.equal(value.cases.length, 5); assert(value.cases.every(c => c.status === "PASS"));
      assert.equal(value.activityExits.length, 2); assert.equal(value.quickSaveSnapshots.length, 7);
      assert.equal(value.currentHistoryOnDisk.status, "PASS");
    }
    for (const tool of r.tools) assert.equal(fileEvidence(tool.path).sha256, tool.sha256);
    assert.equal(fileEvidence(auditFile).sha256, r.packageAudit.sha256);
    assert(["PASS_SOURCE_QUICKLOAD_RENPY_NAVIGATION", "BLOCKED_RENDERER_REVIEW", "FAILED"].includes(value.status));
    r.status = value.status; if (value.status === "FAILED") process.exitCode = 1;
  } catch (error) { r.status = "FAILED"; r.error = String(error.stack || error); process.exitCode = 1; }
  finally { r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, out, error: r.error })); }
}
module.exports = { validateShape, validateRequest, adapt };
if (require.main === module && process.argv[2] === "--self-test") {
  const q = { scope, package: pkg, serial: "emulator-5554", sdk: "D:\\Android_dev\\Sdk", buildAttempt: "01",
    packageAudit: { path: path.join(root, "quickload-apk-01/audit/report.json") },
    outputDir: path.join(root, "quickload-device-01/runtime"),
    resourceAssets: Array.from({ length: 7 }, (_, i) => ({ id: "qa-" + i, path: "assets/" + i,
      sha256: "a".repeat(64), bytes: 1 })), adbPort: 51001, cdpPort: 51002,
    coldBoot: { avd: "AgentVN_API35", adbPort: 51003, grpcPort: 51004 } };
  validateShape(q);
  const bad = [v => { v.scope = "installed-renpy-resource-navigation"; }, v => { v.package += ".bad"; },
    v => { v.resourceAssets.pop(); }, v => { v.cdpPort = v.adbPort; },
    v => { v.outputDir = "D:\\AgentVN"; }, v => { v.exitProbe = true; },
    v => { v.packageAudit.path = path.join(root, "renpy-artifact-19-audit-01/report.json"); },
    v => { delete v.resourceAssets[0].id; }];
  for (const change of bad) { const v = structuredClone(q); change(v); assert.throws(() => validateShape(v)); }
  assert.throws(() => adapt(Buffer.from("source drift")));
  require("./lib/renpy-official-android-flow.cjs").currentExitVerifier();
  console.log(JSON.stringify({ status: "PASS", rejectedInvalidRequests: bad.length, transformations: adapted.changes.length,
    sourceDriftRejected: 1, deviceOperations: 0 }));
} else if (require.main === module && process.argv[2] === "launch")
  launch(process.argv[3], process.argv[4]).catch(error => { console.error(error); process.exitCode = 1; });
