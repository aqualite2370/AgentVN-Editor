"use strict";
// Keep the historical navigation cases; use current APK and confirmed Activity semantics.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "android-current-navigation.cjs");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(hash(original), "32a67b718db769d78f0b049935c5514d545aea19d9e3a2fb2902edcedcea17f7");
const oldExit = fs.readFileSync(original, "utf8").slice(
  fs.readFileSync(original, "utf8").indexOf('    await step("Current APK actual exit confirmation'),
  fs.readFileSync(original, "utf8").indexOf('    }\n    const logs = text(["logcat"'));
assert(oldExit.endsWith("    });\n"));
function adapt(input) {
  let source = input;
  const pairs = [
    ["device-navigation-12-", "device-navigation-17-"],
    ["118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0",
      "e4493327d8fdcc48440cb75aa6adff4a9a0720b59de3207f1f2aa0d304115c8e"],
    ['  assert.equal(q.sdk, "D:\\\\Android_dev\\\\Sdk");',
      '  assert.equal(q.sdk, "D:\\\\Android_dev\\\\Sdk");\n  assert.equal(q.exitProbe, undefined); assert.equal(q.traceExitBoundary, undefined);'],
    ['    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });',
      '    cmd(["shell", "input", "tap", String(x), String(y)]); r.touches.push({ selector, label, x, y, hit });\n' +
      '    if (selector === \'[data-testid="confirm-exit-game"]\') return; // Native teardown has no next DOM frame.'],
    ['    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);',
      '    const rootResult = text(["shell", "id", "-u"]) === "0" ? {status:0,stdout:"already running as root",stderr:""} : cmd(["root"],false,true);\n' +
      '    r.adbRoot=rootResult;\n' +
      '    r.rootTransport=await require("./lib/android-adb-root-recovery.cjs").recoverOwnedRootTransport(rootResult,\n' +
      '      async()=>{assert(ownedAdb);text(["kill-server"]);text(["start-server"]);},async()=>{\n' +
      '        await wait(()=>cmd(["get-state"],false,true).stdout?.trim()==="device","same owned root transport");\n' +
      '        assert.equal(text(["shell","cat","/proc/sys/kernel/random/boot_id"]),r.coldBoot.observedBootId);\n' +
      '        await wait(()=>cmd(["shell","id","-u"],false,true).stdout?.trim()==="0","read-only native save inspection");});\n' +
      '    fs.copyFileSync(q.apk.path, staging, fs.constants.COPYFILE_EXCL);'],
    [oldExit, '    await step("Actual Activity finish, immediate cached Runtime recreation, saved continuation and second finish", async () => {\n' +
      '      await back("playing to menu for explicit exit");\n' +
      '      await evalWait(`Boolean(document.querySelector(\'[data-testid="continue-game"]\'))`, "menu before exit");\n' +
      '      await tap(\'[data-testid="open-settings"]\', "settings exit link");\n' +
      '      await evalWait(`Boolean(document.querySelector(".settings-screen"))`, "settings before exit");\n' +
      '      await tap(\'[data-testid="open-exit-confirmation"]\', "current explicit exit");\n' +
      '      await evalWait(`Boolean(document.querySelector(\'[data-testid="confirm-exit-game"]\'))`, "current exit confirmation");\n' +
      '      await shot("current-exit-confirmation");\n' +
      '      return require("./lib/current-android-navigation-exit.cjs").verifyCurrentNavigationExit({\n' +
      '        q,r,cmd,text,wait,tap,evalWait,idle,shot,position,first,out,Client,save,back,\n' +
      '        priorTabId:tab.id,getClient:()=>client,setClient:value=>{client=value;}});\n' +
      '    });\n'],
    ["if (require.main === module)", "if (module.qaRun)"],
  ];
  for (const [before, after] of pairs) {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename }); return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
worker.qaRun = require.main === module && process.argv[2] !== "--self-test";
worker._compile(source, __filename); module.exports = worker.exports;
if (require.main === module && process.argv[2] === "--self-test") {
  const request = JSON.parse(fs.readFileSync(
    "F:/AgentVN/QA/Android-Package-20261021-01/device-upgrade-17-03/request-submitted.json", "utf8"));
  Object.assign(request, { scope: "installed-current-navigation",
    outputDir: "F:\\AgentVN\\QA\\Android-Package-20261021-01\\device-navigation-17-01\\runtime" });
  worker.exports.validateNavigationRequest(request);
  const bad = [
    q => q.scope = "other", q => q.package = "com.other", q => q.apk.sha256 = "0".repeat(64),
    q => q.apk = q.oldApk, q => q.outputDir = "D:\\AgentVN", q => q.cdpPort = q.adbPort,
    q => q.coldBoot = null, q => q.exitProbe = "no-game-autosave-disabled",
    q => q.traceExitBoundary = true, q => q.serial = "emulator-5556",
  ];
  for (const change of bad) { const value = structuredClone(request); change(value); assert.throws(() => worker.exports.validateNavigationRequest(value)); }
  for (const before of ["device-navigation-12-", oldExit, "if (require.main === module)"])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  require("./lib/current-android-navigation-exit.cjs");
  console.log(JSON.stringify({ status: "PASS", invalidRequestsRejected: bad.length,
    sourceDriftRejected: 3, deviceOperations: 0, productChanges: 0 }));
}
