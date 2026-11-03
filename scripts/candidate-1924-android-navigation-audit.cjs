"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), Module = require("node:module"), vm = require("node:vm");
const { validateImmediateActivityReopen } = require("./android-exit-device.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const original = path.join(__dirname, "android-current-navigation-audit.cjs");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),
  "320a700c887f90f35c35000d71e48632b102d72e933df361b3300215bdfbfa5b");
function validateRun(runtime) {
  if (runtime.status === "FAILED") {
    assert(runtime.error && runtime.cases.some(row => row.status === "FAILED")); return;
  }
  assert(["BLOCKED_RENDERER_REVIEW", "PASS_LIMITED_AGENTVN_NAVIGATION"].includes(runtime.status));
  assert.equal(runtime.cases.length, 5); assert(runtime.cases.every(row => row.status === "PASS"));
  assert.equal(runtime.activityExits.length, 2);
  const [first, second] = runtime.activityExits;
  validateImmediateActivityReopen(first);
  assert(second.before.live.length > 0); assert.equal(second.after.closed, true);
  assert.equal(second.after.live.length, 0); assert(second.after.resumed.length > 0);
  assert.equal(second.basis, "ACTIVITY_FINISH"); assert.equal(second.forcedBeforeExit, false);
  assert.equal(second.confirmationClicks, 1); assert.deepEqual(second.fatalBeforeReclaim, []);
  assert(second.elapsedMs >= 0 && second.elapsedMs < 15000);
  assert(first.closedCommandIndex < first.reopened.commandIndex && first.reopened.commandIndex < second.closedCommandIndex);
  const commands = runtime.commands.slice(0, second.closedCommandIndex + 1);
  assert(!commands.some(row => row.args.slice(0, 3).join(" ") === "shell am force-stop"));
  assert(!commands.some(row => row.args[0] === "uninstall" || row.args.slice(0, 3).join(" ") === "shell pm clear"));
  const evidence = runtime.cases[4].evidence;
  assert.equal(evidence.restoredRuntimeOperable, true); assert.equal(evidence.confirmationClicks, 2);
  assert.deepEqual(evidence.continued, runtime.cases[1].evidence.position);
  assert.equal(Number(evidence.advanced.command), 1);
  assert(evidence.advanced.text.startsWith("QA_ANDROID_UPGRADE_NEW_1："));
}
function verifyFiles(runtime) {
  if (runtime.status === "FAILED") return;
  const [first, second] = runtime.activityExits;
  for (const item of [first.beforeEvidence, first.afterEvidence, first.reopened.evidence,
    first.reopened.targetSnapshot, first.reopened.nativeLog, second.beforeEvidence, second.afterEvidence]) {
    assert.equal(fileEvidence(item.path).sha256, item.sha256);
  }
  const e = runtime.cases[4].evidence;
  for (const [rows, expected] of [[e.saved, e.continued], [e.savedAfterSecond, e.advanced]]) {
    assert(rows.some(row => row.value.save_kind === "auto" && row.value.scene_id === expected.scene
      && row.value.command_index === Number(expected.command)));
    for (const row of rows) {
      assert.equal(fileEvidence(row.path).sha256, row.sha256);
      assert.deepEqual(JSON.parse(fs.readFileSync(row.path, "utf8")), row.value);
    }
  }
}
function adapt(input) {
  let source = input;
  for (const [before, after, count] of [
    ["device-navigation-12-", "device-navigation-17-", 1],
    ["device-navigation-audit-12-", "device-navigation-audit-17-", 1],
    ["118f2efe1ffedd860d444e704e23904e1295559f5a0d6d8bf8eb61a46511a8e0",
      "e4493327d8fdcc48440cb75aa6adff4a9a0720b59de3207f1f2aa0d304115c8e", 1],
    ["        assert.equal(runtime.cases[4].evidence.confirmationClicks, 1);",
      "        assert.equal(runtime.cases[4].evidence.confirmationClicks, 2);", 1],
    ['      assert(runtime.touches.length > 0);',
      '      assert(runtime.touches.length > 0);\n      module.validateRun(runtime); module.verifyFiles(runtime);', 1],
    ['    const owner = load(path.join(source, "report.json"));',
      '    for(const [name,text] of [["executed-audit.cjs",module.auditSource],["adapter.cjs",fs.readFileSync(__filename,"utf8")]]) {\n' +
      '      const file=path.join(output,name);fs.writeFileSync(file,text,{flag:"wx"});r.sources.push(fileEvidence(file));}\n' +
      '    const owner = load(path.join(source, "report.json"));', 1],
    ["if (require.main === module)", "if (module.qaRun)", 1],
  ]) {
    assert.equal(source.split(before).length - 1, count, before); source = source.split(before).join(after);
  }
  new vm.Script(Module.wrap(source), { filename: __filename }); return source;
}
const input = fs.readFileSync(original, "utf8"), source = adapt(input);
if (process.argv[2] === "--self-test") {
  assert.throws(() => validateRun({ status: "PASS_LIMITED_AGENTVN_NAVIGATION", cases: [] }));
  assert.throws(() => validateRun({ status: "BLOCKED_RENDERER_REVIEW", cases: Array.from({ length: 5 }, () => ({ status: "PASS" })), activityExits: [] }));
  assert.throws(() => validateRun({ status: "FAILED", cases: [] }));
  validateRun({ status: "FAILED", error: "original failure", cases: [{ status: "FAILED" }] });
  for (const before of ["device-navigation-12-", "if (require.main === module)"])
    assert.throws(() => adapt(input.replace(before, "SOURCE_DRIFT")));
  console.log(JSON.stringify({ status: "PASS", invalidCompletionReceiptsRejected: 3, sourceDriftRejected: 2, deviceOperations: 0 }));
} else {
  assert.deepEqual(process.argv.slice(2), ["01", "01"]);
  const worker = new Module(__filename, module); worker.filename = __filename; worker.paths = module.paths;
  Object.assign(worker, { qaRun: true, validateRun, verifyFiles, auditSource: source });
  worker._compile(source, __filename);
}
