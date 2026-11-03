"use strict";
// Real WM_CLOSE and natural process exit; not Computer Use or physical input.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { rows, listeners, until } = require("./current-native-editor-session.cjs");
const { sha } = require("./installed-runtime-session.cjs");
const native = require("./windows-repository-native.cjs");
const METHOD = "Windows Process.CloseMainWindow (WM_CLOSE), not physical input";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
function validate(receipt, launch, known) {
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.method, METHOD);
  assert.equal(receipt.label, launch.label);
  assert.equal(receipt.pid, launch.pid);
  assert.equal(receipt.created, launch.created);
  assert.equal(receipt.normalClose, true);
  assert.equal(receipt.physicalInput, false);
  assert.deepEqual(receipt.killed, []);
  assert.deepEqual(receipt.remainingListeners, []);
  assert.deepEqual(receipt.survivingOwned, []);
  assert.equal(receipt.request.sha256, sha(receipt.request.path));
  assert.equal(receipt.nativeEvidence.sha256, sha(receipt.nativeEvidence.path));
  const request = read(receipt.request.path), sent = read(receipt.nativeEvidence.path);
  assert.equal(request.name, "editor-" + launch.label + "-normal-close");
  assert.equal(request.ownerPid, launch.pid);
  assert.equal(request.created, launch.created);
  assert.equal(path.resolve(request.executable), path.resolve(launch.exe));
  assert.equal(sent.ownerPid, launch.pid);
  assert.equal(sent.created, launch.created);
  assert.equal(path.resolve(sent.executable), path.resolve(launch.exe));
  assert.equal(sent.accepted, true);
  assert(Number.isSafeInteger(sent.handle) && sent.handle !== 0);
  assert(Date.parse(receipt.finishedAt) >= Date.parse(sent.at));
  assert(!rows().some(p => known.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
  assert.equal(listeners(launch.ports).length, 0);
  return { pid: launch.pid, created: launch.created, method: METHOD, normalClose: true };
}
async function close({ launch, known, out }) {
  const identity = rows().find(p => p.ProcessId === launch.pid && p.Created === launch.created);
  assert(identity && path.resolve(identity.ExecutablePath) === path.resolve(launch.exe),
    "Exact installed Editor process must own the close request");
  const request = native.freshRequest(out, "editor-" + launch.label + "-normal-close", identity);
  const requestFile = path.join(out, launch.label + "-close-request.json");
  fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), { flag: "wx" });
  const nativeEvidence = native.sendClose(request, out);
  await until(() => !rows().some(p => known.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created))
    && listeners(launch.ports).length === 0, "WM_CLOSE naturally exits Editor, Backend and owned WebViews", 45000);
  const receipt = {
    label: launch.label, pid: launch.pid, created: launch.created, status: "PASS",
    method: METHOD, normalClose: true, physicalInput: false, killed: [],
    request: { path: requestFile, sha256: sha(requestFile) }, nativeEvidence,
    survivingOwned: [], remainingListeners: [], finishedAt: new Date().toISOString(),
  };
  validate(receipt, launch, known);
  fs.writeFileSync(path.join(out, launch.label + "-close-completed.json"),
    JSON.stringify(receipt, null, 2), { flag: "wx" });
  return receipt;
}
function selfTest() {
  const launch = { label: "old", pid: 5, created: "owned", exe: __filename, ports: [] };
  const receipt = { status: "PASS", method: METHOD, label: "old", pid: 5, created: "owned",
    normalClose: true, physicalInput: false, killed: [], remainingListeners: [], survivingOwned: [] };
  const poisons = [
    r => r.status = "FAILED", r => r.method = "Computer Use Alt+F4",
    r => r.label = "new", r => r.pid = 6, r => r.created = "reused",
    r => r.normalClose = false, r => r.physicalInput = true,
    r => r.killed = [{ pid: 5 }], r => r.remainingListeners = [{ port: 8278 }],
    r => r.survivingOwned = [{ ProcessId: 5 }],
  ];
  for (const poison of poisons) {
    const copy = structuredClone(receipt); poison(copy);
    assert.throws(() => validate(copy, launch, []), assert.AssertionError);
  }
  return { status: "PASS", rejectedCloseMisattributions: poisons.length, productLaunches: 0 };
}
module.exports = { close, validate, selfTest, METHOD };
