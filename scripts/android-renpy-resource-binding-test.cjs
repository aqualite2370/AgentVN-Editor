"use strict";
// Replay the original failing first step using the captured real device bytes.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const candidate = require("./android-candidate-renpy.cjs");
const root = "F:/AgentVN/QA/Android-Package-20261021-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const audit = read(path.join(root, "renpy-artifact-29-audit-04/report.json"));
const failure = read(path.join(root, "device-renpy-29-01/runtime/navigation-report.json"));
const firstCapture = failure.renderedResources[0];
function context() {
  let finished = 0;
  const stop = new Error("NEXT_CASE_NOT_REPLAYED");
  return { stop, completed: () => finished, value: {
    q: { resourceAssets: audit.embeddedAssets }, r: {}, save() {},
    getClient: () => ({ evaluate: async source => source.startsWith("(async()=>")
      ? structuredClone(firstCapture) : true }),
    step: async (name, fn) => { if (finished) throw stop; await fn(); finished++; },
  }};
}
async function main() {
  const c = context();
  const load = candidate.loadResourceFlow ?? (() => require("./lib/renpy-official-android-flow.cjs"));
  await assert.rejects(() => load().verifyRenpyOfficialFlow(c.value), e => e === c.stop);
  assert.equal(c.completed(), 1);
  const roles = ["title", "font", "textbox", "quickIdle", "choiceIdle"];
  for (const role of roles) {
    const asset = candidate.findBoundResource(audit.embeddedAssets, role);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => candidate.findBoundResource(audit.embeddedAssets.filter(a => a.id !== asset.id), role));
    assert.throws(() => candidate.findBoundResource([...audit.embeddedAssets, asset], role));
    const bad = audit.embeddedAssets.map(a => a === asset ? { ...a, path: "assets/ui/unrelated.webp" } : a);
    assert.throws(() => candidate.findBoundResource(bad, role));
  }
  const missing = context();
  missing.value.getClient = () => ({ evaluate: async source => source.startsWith("(async()=>")
    ? { ...firstCapture, resources: firstCapture.resources.filter(r => !r.url.includes(".woff2")) } : true });
  await assert.rejects(() => candidate.loadResourceFlow().verifyRenpyOfficialFlow(missing.value), /assert/);
  assert.equal(missing.completed(), 0);
  const offline = read(path.join(root, "device-renpy-29-02/runtime/navigation-report.json"));
  const failedRead = offline.commands.find(c => c.args.join(" ") === "shell cat /proc/sys/kernel/random/boot_id");
  assert.equal(failedRead.status, 1); assert.match(failedRead.stderr, /device offline/);
  const id = read(path.join(root, "device-renpy-29-02/runtime/cold-boot.json")).bootId;
  let reads = 0;
  const boot = await candidate.readOwnedBootId(() => ++reads === 1 ? failedRead : { status: 0, stdout: id },
    async fn => { let value = await fn(); if (!value) value = await fn(); assert(value); return value; });
  assert.equal(boot, id); assert.equal(reads, 2);
  await assert.rejects(() => candidate.readOwnedBootId(() => ({ status: 1, stderr: "Permission denied" }),
    async fn => fn()), /Permission denied/);
  await assert.rejects(() => candidate.readOwnedBootId(() => ({ status: 0, stdout: "garbage" }),
    async fn => fn()));
  console.log(JSON.stringify({ status: "PASS", realFailureReplay: "PASS", roles: roles.length,
    rejectedResources: roles.length * 3 + 1, transportReplay: "PASS_BOUNDED_READ_NO_RESTART",
    deviceOperations: 0, productChanges: 0 }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
