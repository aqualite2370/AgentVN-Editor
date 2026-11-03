"use strict";
// Exact generated-file retention, not a Downloads cleanup or wildcard delete.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-project-directory-20261018-01";
const work = "F:/AgentVN-QA-InstalledProjectDirectory-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const fixture = read(path.join(run, "fixtures.json"));
const prior = read(path.join(run, "default-restart-01/report.json"));
const collision = read(path.join(run, "collision-01/report.json"));
const destination = path.join(work, "retained-default-packages"), journal = path.join(run, "download-retention.json");
assert.equal(prior.status, "PASS"); assert.equal(collision.status, "PASS");
assert(!fs.existsSync(destination) && !fs.existsSync(journal));
const rows = [...prior.artifacts, ...collision.collisionSetup.files, ...collision.artifacts];
assert.equal(rows.length, 34); assert.equal(new Set(rows.map(r => r.path)).size, 34);
for (const row of rows) {
  assert.equal(path.dirname(path.resolve(row.path)).toLowerCase(), path.resolve("C:/Users/1/Downloads").toLowerCase());
  assert(path.basename(row.path).startsWith(fixture.title + "_") && row.path.endsWith(".vnproj"));
  assert(fs.lstatSync(row.path).isFile() && !fs.lstatSync(row.path).isSymbolicLink());
  assert.equal(sha256(fs.readFileSync(row.path)), row.sha256);
}
fs.mkdirSync(destination);
const report = { status: "RUNNING", at: new Date().toISOString(), rows: [], error: null };
const save = () => fs.writeFileSync(journal, JSON.stringify(report, null, 2));
save();
try {
  for (const source of rows) {
    const target = path.join(destination, path.basename(source.path));
    assert.equal(path.dirname(path.resolve(target)), path.resolve(destination));
    fs.copyFileSync(source.path, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha256(fs.readFileSync(target)), source.sha256);
    assert.equal(sha256(fs.readFileSync(source.path)), source.sha256);
    const row = { source: source.path, retained: target, sha256: source.sha256,
      bytes: fs.statSync(target).size, copyVerified: true, sourceRemoved: false };
    report.rows.push(row); save();
    fs.unlinkSync(source.path); row.sourceRemoved = true; save();
  }
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); save(); }
console.log(JSON.stringify({ status: report.status, files: report.rows.length, retainedAt: destination, error: report.error }, null, 2));
