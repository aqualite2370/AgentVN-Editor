"use strict";
// One current-APK navigation run, separate from the completed upgrade flow.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "android-current-navigation-launch.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "10dd571d1e3cf800184b604749453b8451e6ae6398ad90f1f8fa99598510943a");
function adapt(input) {
  let source = input;
  for (const [before, after, count] of [
    ["android-current-navigation.cjs", "candidate-1924-android-navigation.cjs", 2],
    ["android-current-navigation-launch.cjs", "candidate-1924-android-navigation-launch.cjs", 1],
    ["start-android-acceptance.ps1", "candidate-1924-android-navigation-start.ps1", 2],
    ["device-navigation-12-", "device-navigation-17-", 1],
    ["android-navigation-12-", "android-navigation-17-", 1],
    ["device-upgrade-12-08/request-submitted.json", "device-upgrade-17-03/request-submitted.json", 1],
    ['"lib/android-exit-observer.cjs"].map(name => {',
      '"lib/android-exit-observer.cjs", "lib/current-android-navigation-exit.cjs", "lib/android-activity-exit.cjs",\n' +
      '      "android-exit-device.cjs", "android-current-navigation.cjs", "android-current-navigation-launch.cjs",\n' +
      '      "start-android-acceptance.ps1", "lib/android-adb-root-recovery.cjs"].map(name => {', 1],
    ['      "Source Editor12 normal close FAILED and old APK exit FAILED remain unchanged",',
      '      "Source Editor17 normal close FAILED and prior intermittent load remain unresolved",', 1],
    ["if (require.main === module)", "if (module.qaRun)", 1],
  ]) {
    assert.equal(source.split(before).length - 1, count, before); source = source.split(before).join(after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename }); return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
if (process.argv[2] === "--self-test") {
  const text = require("node:child_process").execFileSync("powershell.exe", ["-NoProfile",
    "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "candidate-1924-android-navigation-start.ps1"), "-SelfTest"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.match(text, /PASS: native navigation runner/);
  for (const before of ["device-navigation-12-", "device-upgrade-12-08/request-submitted.json", "if (require.main === module)"])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  require("./candidate-1924-android-navigation.cjs");
  console.log(JSON.stringify({ status: "PASS", sourceDriftRejected: 3, nodeToPowerShellSelfTest: "PASS", launches: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["01"]);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  worker.qaRun = true; worker._compile(source, __filename);
}
