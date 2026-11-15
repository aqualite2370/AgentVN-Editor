"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { upgradeScope } = require("./lib/editor-upgrade-scope.cjs");
const attempt = process.argv[2];
assert(["01", "02"].includes(attempt)); assert.equal(process.argv.length, 3);
const base = "F:/testavn/Editor-Upgrade-1975-Preparation-20261116-01";
fs.mkdirSync(base, { recursive: true });
const output = path.join(base, `scope-tests-${attempt}.json`);
assert(!fs.existsSync(output));
const report = { at: new Date().toISOString(), productStarts: 0, accountsCreated: 0, cases: [] };
function test(name, fn) {
  try { fn(); report.cases.push({ name, status: "PASS" }); }
  catch (error) { report.cases.push({ name, status: "FAILED", error: error.stack }); }
}
test("1974 to 1975 uses one fresh exact recent-upgrade root", () => {
  const v = upgradeScope(["--current-1975"]);
  assert.equal(v.base, "F:/testavn/Windows-Isolated-1975-20261116-02");
  assert.equal(v.oldVersion, "1.9.74"); assert.equal(v.newVersion, "1.9.75");
  assert.equal(v.oldCode, "1974"); assert.equal(v.newCode, "1975");
  assert.equal(v.cross, false); assert.equal(v.current1975, true);
});
for (const extra of ["--cross", "--cross-retry", "--cross-final", "--current-1973", "--cross-1973",
  "--cross-1973-visible", "--current-1974", "--cross-1974", "--current-1975", "../other", "--other"])
  test("reject ambiguous 1975 entry " + extra, () => assert.throws(() => upgradeScope(["--current-1975", extra])));
for (const [args, versions, suffix] of [
  [[], ["1.9.71", "1.9.72"], "1972-20261114-02"],
  [["--current-1973"], ["1.9.72", "1.9.73"], "1973-20261114-03"],
  [["--cross-1973-visible"], ["1.7.1", "1.9.73"], "1973-20261115-02"],
  [["--current-1974"], ["1.9.73", "1.9.74"], "1974-20261115-02"],
  [["--cross-1974"], ["1.7.1", "1.9.74"], "1974-20261115-05"],
]) test("preserve existing closed evidence scope " + JSON.stringify(args), () => {
  const v = upgradeScope(args);
  assert.deepEqual([v.oldVersion, v.newVersion], versions);
  assert.equal(v.base, "F:/testavn/Windows-Isolated-" + suffix);
});
report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output }));
if (report.status !== "PASS") process.exitCode = 1;
