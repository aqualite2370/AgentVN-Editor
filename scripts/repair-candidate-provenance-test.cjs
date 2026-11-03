"use strict";
const assert = require("node:assert/strict");
const { sourceEntries, latestSourceMap, verifyLatestSource, latestQaSourceMap, checkHistoricalGroups } =
  require("./lib/repair-candidate-provenance.cjs");
let cases = 0;
function test(name, fn) { fn(); cases++; console.log(`PASS ${name}`); }
const a = "a".repeat(64), b = "b".repeat(64);
test("accept array, singleton and changedProduct receipt forms", () => {
  for (const data of [
    { sources: [{ file: "editor/a.ts", sha256: a }] },
    { source: { path: "editor/a.ts", sha256: a } },
    { changedProduct: { path: "editor/a.ts", sha256: a } },
  ]) assert.equal(sourceEntries(data).length, 1);
});
test("latest declared source wins; earlier hashes remain historical", () => {
  const [entry] = latestSourceMap(process.cwd(), [
    { id: "earlier", data: { source: { file: "editor/a.ts", sha256: a } } },
    { id: "later", data: { sources: [{ file: "editor/a.ts", sha256: b }] } },
  ]);
  assert.equal(entry.sha256, b);
  assert.deepEqual(entry.previous, [{ receiptId: "earlier", sha256: a }]);
  assert.equal(verifyLatestSource(entry, b).status, "PASS");
  assert.throws(() => verifyLatestSource(entry, a), /Unaccounted/);
});
test("source not declared by later receipts cannot silently drift", () => {
  const [entry] = latestSourceMap(process.cwd(), [
    { id: "only", data: { source: { file: "editor/a.ts", sha256: a } } },
  ]);
  assert.throws(() => verifyLatestSource(entry, b), /Unaccounted/);
  assert.throws(() => verifyLatestSource(entry, null), /Unaccounted/);
});
test("reject empty receipts and empty source evidence", () => {
  assert.throws(() => latestSourceMap(process.cwd(), []));
  assert.throws(() => latestSourceMap(process.cwd(), [{ id: "empty", data: {} }]));
});
test("include declared bundled, frontend and backend resource sources", () => {
  const entries = sourceEntries({ resources: {
    bundled: [{ file: "shared/new.ts", sha256: a }],
    frontendSources: [{ file: "editor/src/new.tsx", sha256: a }],
    backendSources: [{ file: "backend/app/new.py", sha256: a }],
  } });
  assert.equal(entries.length, 3, "Nested source receipts must not silently disappear");
});
test("combine top-level forms and nested resources even when sources is empty", () => {
  const entries = sourceEntries({ sources: [], source: { file: "shared/one.ts", sha256: a },
    changedProduct: [{ file: "shared/two.ts", sha256: a }],
    resources: { bundled: [{ file: "shared/three.ts", sha256: a }] } });
  assert.equal(entries.length, 3);
});
test("new nested declaration supersedes old hash and preserves its provenance", () => {
  const [entry] = latestSourceMap(process.cwd(), [
    { id: "earlier", data: { sources: [{ file: "shared/a.ts", sha256: a }] } },
    { id: "later", data: { resources: { bundled: [{ file: "shared/a.ts", sha256: b }] } } },
  ]);
  assert.equal(entry.sha256, b);
  assert.deepEqual(entry.previous, [{ receiptId: "earlier", sha256: a }]);
  assert.equal(verifyLatestSource(entry, b).status, "PASS");
});
test("identical duplicate source declarations do not invent a previous revision", () => {
  const [entry] = latestSourceMap(process.cwd(), [{ id: "same", data: {
    sources: [{ file: "shared/a.ts", sha256: a }],
    resources: { bundled: [{ file: "shared/a.ts", sha256: a }] },
  } }]);
  assert.deepEqual(entry.previous, []);
});
test("reject contradictory same-receipt declarations including absolute aliases", () => {
  assert.throws(() => latestSourceMap(process.cwd(), [{ id: "conflict", data: {
    sources: [{ file: "shared/a.ts", sha256: a }],
    resources: { bundled: [{ path: require("node:path").resolve("shared/a.ts"), sha256: b }] },
  } }]), /Conflicting source/);
});
test("do not turn historical nested evidence or compiled assets into product sources", () => {
  assert.equal(sourceEntries({ reports: [{ sources: [{ file: "shared/history.ts", sha256: a }] }],
    compiled: [{ file: "editor/dist/current.js", sha256: a }] }).length, 0);
});
const groups = Array.from({ length: 18 }, (_, i) => ({
  id: `G${String(i + 1).padStart(2, "0")}`,
  status: i < 9 ? "FAILED" : i < 15 ? "BLOCKED" : "PASS",
}));
test("preserve complete frozen-install ledger rather than promoting source PASS", () => {
  assert.deepEqual(checkHistoricalGroups(groups), { FAILED: 9, BLOCKED: 6, PASS: 3 });
});
test("reject missing, duplicated, unknown or silently promoted groups", () => {
  assert.throws(() => checkHistoricalGroups(groups.slice(1)));
  assert.throws(() => checkHistoricalGroups([...groups.slice(1), groups[1]]));
  assert.throws(() => checkHistoricalGroups(groups.map((g, i) => i ? g : { ...g, status: "GREEN" })));
  assert.throws(() => checkHistoricalGroups(groups.map((g, i) => i ? g : { ...g, status: "PASS" })));
});
test("QA identity changes require an explicit later QA declaration", () => {
  assert.equal(typeof latestQaSourceMap, "function");
  const [entry] = latestQaSourceMap(process.cwd(), [{ file: "scripts/old.cjs", sha256: a }], [
    { id: "DATAURL", data: { qaSources: [{ file: "scripts/old.cjs", sha256: b }] } },
  ]);
  assert.equal(verifyLatestSource(entry, b).status, "PASS");
  assert.deepEqual(entry.previous, [{ receiptId: "HISTORICAL-QA-TOOL", sha256: a }]);
  assert.equal(entry.receiptId, "DATAURL");
});
test("product source declarations cannot authorize QA identity drift", () => {
  const [entry] = latestQaSourceMap(process.cwd(), [{ file: "scripts/old.cjs", sha256: a }], [
    { id: "PRODUCT", data: { sources: [{ file: "scripts/old.cjs", sha256: b }] } },
  ]);
  assert.throws(() => verifyLatestSource(entry, b), /Unaccounted/);
});
test("QA declarations cannot promote historical installed groups", () => {
  latestQaSourceMap(process.cwd(), [{ file: "scripts/old.cjs", sha256: a }], [
    { id: "QA-ONLY", data: { qaSources: [{ file: "scripts/old.cjs", sha256: b }] } },
  ]);
  assert.deepEqual(checkHistoricalGroups(groups), { FAILED: 9, BLOCKED: 6, PASS: 3 });
});
test("conflicting aliases in a new QA declaration fail instead of silently winning", () => {
  assert.throws(() => latestQaSourceMap(process.cwd(), [{ file: "scripts/old.cjs", sha256: a }], [
    { id: "BAD-QA", data: { qaSources: [
      { file: "scripts/old.cjs", sha256: a },
      { path: require("node:path").resolve("scripts/old.cjs"), sha256: b },
    ] } },
  ]), /Conflicting source/);
});
console.log(JSON.stringify({ status: "PASS", cases,
  scope: "QA_PROVENANCE_VALIDATOR_ONLY_NOT_PRODUCT_ACCEPTANCE" }));
