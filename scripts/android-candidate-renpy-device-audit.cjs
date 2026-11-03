"use strict";
// Reuse the full frozen device auditor with explicit candidate/source binding.
// Renderer errors omitted by the historical parser are reviewed independently.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const Module = require("node:module"), vm = require("node:vm");
const candidate = require("./android-candidate-renpy.cjs");
const { fileEvidence } = require("./android-acceptance-evidence.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const original = path.join(__dirname, "candidate-1924-renpy-android-device-audit.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function rendererReview(runtime, text) {
  const pids = new Set(runtime.pids.map(String)), events = [];
  for (const line of text.split(/\r?\n/)) {
    const row = line.match(/^\d\d-\d\d (\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+\d+\s+\w\s+.*Renderer process \((\d+)\) crash detected \(code (-?\d+)\)/);
    if (row && pids.has(row[2])) events.push({
      time: row[1], ownerPid: row[2], rendererPid: row[3], code: Number(row[4]), line,
    });
  }
  return {
    status: events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW" : "NO_RENDERER_TERMINATION_RECORD",
    events,
    limitation: "No automatic exemption for code -1 or Activity finish; raw functional PASS is not full lifecycle acceptance",
  };
}
function verifyExitHistory(runtime) {
  const quick = runtime.quickSaveSnapshots.at(-1)
    .reduce((a, b) => a.value.created_at > b.value.created_at ? a : b).value;
  const exits = runtime.cases[4].evidence;
  const latestAuto = rows => rows.filter(s => s.value.save_kind === "auto")
    .sort((a, b) => b.value.created_at.localeCompare(a.value.created_at))[0].value;
  const first = latestAuto(exits.saved), second = latestAuto(exits.savedAfterSecond);
  assert.equal(first.history.length, quick.history.length + 1);
  assert.equal(second.history.length, first.history.length + 1);
  assert.notEqual(first.history.at(-1).id, quick.history.at(-1).id);
  assert.notEqual(second.history.at(-1).id, first.history.at(-1).id);
  assert.deepEqual(first.variables, quick.variables); assert.deepEqual(second.variables, first.variables);
  const proof = { quickHistory: quick.history.length, firstHistory: first.history.length,
    secondHistory: second.history.length, firstLastId: first.history.at(-1).id, secondLastId: second.history.at(-1).id };
  assert.deepEqual(runtime.exitSnapshotHistoryProof, proof);
  return proof;
}
function sourceFor(binding, bindingFile, auditNumber) {
  assert.equal(sha(original), "d3bebdf755436860a6a7da39b07b47e1bbd74b9e55a71b0802214cbac29bc8f5");
  let source = fs.readFileSync(original, "utf8");
  const replace = (before, after) => {
    assert.equal(source.split(before).length - 1, 1, before); source = source.replace(before, after);
  };
  replace('const { validateRenpyRequest } = require("./candidate-1924-renpy-android-device.cjs");',
    "const validateRenpyRequest = module.validateRequest;");
  replace("  assert.equal(process.argv.length, 4);", "  assert.equal(module.bindingVerified, true);");
  replace("  const [attempt, auditAttempt] = process.argv.slice(2);",
    `  const [attempt, auditAttempt] = ${JSON.stringify([path.basename(binding.output).split("-").at(-1), auditNumber])};`);
  replace('  const source = path.join(root, "device-renpy-19-" + attempt);',
    `  const source = ${JSON.stringify(binding.output)};`);
  const output = `${binding.output}-audit-${auditNumber}`;
  replace('  const out = path.join(root, `device-renpy-19-${attempt}-audit-${auditAttempt}`);',
    `  const out = ${JSON.stringify(output)};`);
  replace("      for (const item of owner.tools) verify({ ...item, path: path.join(source, path.basename(item.path)) });",
    "      for (const item of module.executionSources) verify(item);\n" +
    "      assert.deepEqual(owner.candidateBinding, module.bindingReceipt);");
  replace("copiedTools: owner.tools.length", "copiedTools: module.executionSources.length");
  replace('    r.trialStatus = runtime.status; r.status = "EVIDENCE_AUDIT_PASS_FEATURE_" + runtime.status;',
    `    await check("Actual persisted exit history advances beyond quick-load and the reopened branch",
      () => module.verifyExitHistory(runtime));
    r.trialStatus = runtime.status;
    r.rendererTerminationReview = module.rendererReview(runtime,
      fs.readFileSync(path.join(source, "runtime", runtime.status === "FAILED" ? "failure-logcat.txt" : "logcat.txt"), "utf8"));
    r.status = r.rendererTerminationReview.events.length ? "BLOCKED_RENDERER_TERMINATION_REVIEW"
      : "EVIDENCE_AUDIT_PASS_FEATURE_" + runtime.status;
    r.candidateBinding = module.bindingReceipt;
    r.limitations = read(path.join(source, "report.json")).limitations;`);
  replace('if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });',
    "module.exports = { main, validateFlow };");
  new vm.Script(Module.wrap(source));
  return { source, output };
}
async function audit(bindingFile, auditNumber) {
  assert.match(auditNumber, /^\d{2}$/);
  const binding = read(bindingFile), receipt = fileEvidence(bindingFile);
  const q = read(path.join(binding.output, "request-submitted.json"));
  assert.equal(q.candidateBinding.path, receipt.path); assert.equal(q.candidateBinding.sha256, receipt.sha256);
  candidate.validateDevice(q, binding, q.candidateBinding);
  for (const f of binding.sources) assert.equal(sha(f.path), f.sha256);
  const adapted = sourceFor(binding, bindingFile, auditNumber);
  const worker = new Module(original, module); worker.filename = original; worker.paths = module.paths;
  Object.assign(worker, { bindingVerified: true, bindingReceipt: q.candidateBinding,
    executionSources: [...binding.sources, receipt], rendererReview, verifyExitHistory,
    validateRequest: value => candidate.validateDevice(value, binding, q.candidateBinding) });
  worker._compile(adapted.source, original);
  await worker.exports.main();
  fs.writeFileSync(path.join(adapted.output, "executed-adapted-audit.cjs"), adapted.source, { flag: "wx" });
}
function selfTest() {
  const runtime = read(path.join(root, "device-renpy-29-03/runtime/navigation-report.json"));
  const text = fs.readFileSync(path.join(root, "device-renpy-29-03/runtime/logcat.txt"), "utf8");
  const reviewed = rendererReview(runtime, text);
  assert.equal(reviewed.status, "BLOCKED_RENDERER_TERMINATION_REVIEW");
  assert.equal(reviewed.events.length, 4); assert.equal(new Set(reviewed.events.map(e => e.rendererPid)).size, 2);
  assert.equal(rendererReview({ pids: ["99999"] }, text).events.length, 0);
  assert.equal(rendererReview(runtime, "unrelated crash detected").events.length, 0);
  const bindingFile = "F:/AgentVN/QA/Editor-1.9.31-20261027-01/android-renpy-29-03/binding.json";
  const binding = read(bindingFile), adapted = sourceFor(binding, bindingFile, "01");
  assert(adapted.source.includes("module.rendererReview(runtime"));
  const worker = new Module(original, module); worker.filename = original; worker.paths = module.paths;
  worker._compile(adapted.source, original);
  worker.exports.validateFlow(runtime);
  verifyExitHistory(runtime);
  const bad = [
    r => r.cases = [], r => r.quickSaveSnapshots = [], r => r.activityExits.pop(),
    r => r.activityExits[0].reopened.titleReady = false,
    r => r.cases[2].evidence.writes = 0,
    r => r.cleanupError = "failed", r => r.uninstallStatus = "FAILED",
  ];
  for (const change of bad) { const r = structuredClone(runtime); change(r); assert.throws(() => worker.exports.validateFlow(r)); }
  for (const value of [undefined, { ...runtime.exitSnapshotHistoryProof, firstHistory: 1 }]) {
    const r = structuredClone(runtime); r.exitSnapshotHistoryProof = value;
    assert.throws(() => verifyExitHistory(r));
  }
  console.log(JSON.stringify({ status: "PASS", realRendererEventsFlagged: reviewed.events.length,
    unrelatedPidExcluded: true, rejectedReceipts: bad.length + 2, deviceOperations: 0 }));
}
module.exports = { rendererReview, sourceFor, audit, selfTest };
if (require.main === module) {
  if (process.argv[2] === "--self-test") selfTest();
  else audit(...process.argv.slice(2)).catch(e => { console.error(e); process.exitCode = 1; });
}
