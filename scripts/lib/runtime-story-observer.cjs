"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const { ownedProcessTree } = require("./owned-process-tree.cjs");
function observeStoryTree(processes, launch, known, executable) {
  const identity = processes.find(p => p.ProcessId === launch.pid);
  if (!identity) return { recorded: 0 };
  const key = `${identity.ProcessId}:${identity.Created}`;
  if (launch.identity?.CreationDate) {
    const created = launch.identity.CreationDate.match(/\d+/)?.[0];
    assert(created, "Recorded process creation date is required");
    if (Date.parse(identity.Created) !== Number(created)) return { recorded: 0, recycled: true };
  }
  const prior = known.get(key);
  if (!identity.ExecutablePath) {
    assert(prior && prior.ExecutablePath, "Cannot accept an unverified process without its path");
    assert.equal(path.resolve(prior.ExecutablePath), path.resolve(executable));
    return { recorded: 0, transient: true, pid: identity.ProcessId, created: identity.Created };
  }
  assert.equal(path.resolve(identity.ExecutablePath), path.resolve(executable));
  const tree = ownedProcessTree(processes, identity.ProcessId, identity.Created);
  for (const p of tree) {
    const k = `${p.ProcessId}:${p.Created}`;
    const old = known.get(k);
    if (!p.ExecutablePath && old?.ExecutablePath) continue;
    known.set(k, p);
  }
  return { recorded: tree.length };
}
function validateResume(prior, current) {
  assert.equal(prior.status, "FAILED"); assert(prior.finishedAt);
  assert(!prior.cleanupError && prior.restoration);
  assert.match(prior.observerError, /paths\[0\].*string.*null/s);
  assert.match(prior.observerError, /at observe /);
  assert.match(prior.error, /ERR_INVALID_ARG_TYPE/);
  assert.equal(prior.physicalRoaming, true);
  assert.equal(prior.normalCloseClaimed, false);
  for (const key of ["productChanges", "builds", "modelRequests"]) assert.equal(prior[key], 0);
  for (const key of ["executable", "installation", "originalExport"])
    assert.equal(prior[key].sha256, current[key].sha256);
  assert.equal(prior.fixture.inputSha256, current.fixture.inputSha256);
  assert(prior.cells.length > 0 && prior.cells.length < 12);
  assert(prior.cells.every(c => c.status === "PASS"));
  assert.equal(prior.commands.length, prior.cells.length + 2);
  assert(prior.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
  return prior.cells.length;
}
module.exports = { observeStoryTree, validateResume };
