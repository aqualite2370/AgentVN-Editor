"use strict";
// Retain the real UI/touch/upgrade workflow; substitute only its version-bound QA runner.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "android-native-upgrade-device-launch.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "7a2b47e62a8c96240e3d9b1b23daca4728f56390b0cb66dfaee968d57a1f19fd");
function adapt(input) {
  let source = input;
  for (const [before, after, count] of [
    ["android-native-upgrade-device.cjs", "candidate-1924-android-upgrade-device.cjs", 2],
    ["start-android-acceptance.ps1", "candidate-1924-android-device-start.ps1", 2],
    ['    r.tools = tools.map(file => {',
      '    tools.push(path.join(__dirname, "android-native-upgrade-device.cjs"), path.join(__dirname, "start-android-acceptance.ps1"), path.join(__dirname, "android-native-upgrade-device-launch.cjs"));\n    r.tools = tools.map(file => {', 1],
    ["if (require.main === module)", "if (module.qaRun)", 1],
  ]) {
    assert.equal(source.split(before).length - 1, count, before);
    source = source.split(before).join(after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename });
  return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
if (process.argv[2] === "--self-test") {
  for (const before of ["android-native-upgrade-device.cjs", "start-android-acceptance.ps1",
    "    r.tools = tools.map(file => {", "if (require.main === module)"])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  require("./candidate-1924-android-upgrade-device.cjs");
  const childSelfTest = require("node:child_process").execFileSync("powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "candidate-1924-android-device-start.ps1"), "-SelfTest"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.match(childSelfTest, /PASS: one exact runner adaptation/);
  console.log(JSON.stringify({ status: "PASS", sourceDriftRejected: 4, actualRunnerLoad: true,
    nodeToPowerShellSelfTest: "PASS", deviceOperations: 0, launches: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["17", "01", "03", "--background-auto"]);
  const worker = new Module(__filename, module);
  worker.filename = __filename; worker.paths = module.paths; worker.qaRun = true;
  worker._compile(source, __filename);
}
