"use strict";
const fs = require("node:fs"), assert = require("node:assert/strict"), path = require("node:path"), crypto = require("node:crypto");
const root = "F:/AgentVN/QA/Novel-Branch-Completion-20261103-01";
const [browserAttempt, attempt] = process.argv.slice(2);
assert(/^\d{2}$/.test(browserAttempt || "") && /^\d{2}$/.test(attempt || ""));
const output = path.join(root, "audit-" + attempt + ".json");
assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const file = path.join(root, `browser-${browserAttempt}/report.json`), report = read(file);
const audit = { status: "RUNNING", at: new Date().toISOString(), scope: "SOURCE_FUNCTION_BROWSER_AND_EXPORT_ONLY",
  browser: { path: file, sha256: sha(file) }, checks: [], paidRequests: 0,
  notCovered: ["New installed candidate", "New paid novel generation", "Windows/Android standalone export", "Final user project"] };
function check(name, action) {
  try { audit.checks.push({ name, status: "PASS", detail: action() }); }
  catch (e) { audit.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
check("failed-reproduction-and-exact-historical-output-regression", () => {
  const red = read(path.join(root, "red-01/report.json")), green = read(path.join(root, "green-03/report.json"));
  assert.equal(red.status, "FAILED"); assert.equal(red.cases.filter(c => c.status === "FAILED").length, 2);
  assert.equal(green.status, "PASS"); assert.equal(green.cases.length, 6); assert(green.cases.every(c => c.status === "PASS"));
  const replay = green.cases.find(c => c.name.startsWith("same-historical")).detail;
  assert.equal(sha(replay.original), replay.originalSHA256); assert.equal(replay.additionalModelRequests, 0);
  const chapters = read(path.join(root, "chapter-idempotence-01/report.json"));
  assert.equal(chapters.status, "PASS"); assert.equal(chapters.cases.length, 6);
  assert(chapters.cases.every(c => c.status === "PASS")); assert.equal(chapters.transport.modelRequests, 0);
  return { directCases: 6, chapterIdempotence: 6, preservedFailedReproduction: true };
});
check("actual-author-chain-no-regeneration-and-unchanged-product-sources", () => {
  assert.equal(report.status, "PASS"); assert.equal(report.cases.length, 15);
  assert(report.cases.every(c => c.status === "PASS")); assert.equal(report.paidRequests, 0);
  let author = report;
  if (report.continuation) {
    assert.equal(sha(report.continuation.path), report.continuation.sha256);
    author = read(report.continuation.path); assert.equal(author.status, "FAILED");
    assert(author.cases.slice(0, 3).every(c => c.status === "PASS"));
    assert.equal(report.model.length, 0); assert.equal(report.inheritedLocalModelRequests, 20);
  }
  assert.equal(author.model.length, 20); assert(author.model.every(m => !m.error));
  for (const source of author.source) assert.equal(sha(source.path), source.sha256);
  assert.equal(sha(author.exported.file.path), author.exported.file.sha256);
  assert.equal(sha(author.saved.path), author.saved.sha256);
  return { authorCases: 3, localHttpCallsInAuthor: 20, repeatedModelCallsInContinuation: report.model.length };
});
check("all-twelve-player-cells-actually-select-two-mainlines-and-end", () => {
  const cells = report.cases.slice(3); assert.equal(cells.length, 12);
  const unique = new Set();
  for (const cell of cells) {
    const d = cell.detail; assert.equal(d.mainlineClicks, 2); assert(d.actualEndReached);
    assert(d.reached.includes("qa_multi_scene_1") && d.reached.includes("qa_multi_scene_2"));
    unique.add(JSON.stringify(d.metrics));
  }
  assert.equal(unique.size, 12); return { combinations: 12, mainlineSelections: 24 };
});
check("twelve-PNGs-match-actual-DPR-and-cleanup-is-complete", () => {
  assert.equal(report.screenshots.length, 12);
  for (const shot of report.screenshots) {
    assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
    const png = fs.readFileSync(shot.path);
    assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
    assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
  }
  assert.equal(report.cleanup, "PASS"); assert.deepEqual(report.remainingPorts, []);
  assert.deepEqual(report.errors, []); return { PNGs: 12, liveOwnedPorts: 0 };
});
audit.status = audit.checks.length === 4 && audit.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
fs.writeFileSync(output, JSON.stringify(audit, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: audit.status, output, checks: audit.checks.map(c => [c.name, c.status]) }));
if (audit.status !== "PASS") process.exitCode = 1;
