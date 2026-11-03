"use strict";
// Re-audit the existing successful native run, never replay product actions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-export-consume-audit.cjs");
const text = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(text).digest("hex"),
  "6caa53d9c95319c3762595a991f8e3875732a567c5e565e5c5760442c15bfdd4");
assert.equal(process.argv[2], "03", "New audit03 reads original successful native02");
const before = "  report.input = { path: file, sha256: sha(file) };";
assert.equal(text.split(before).length - 1, 1);
const sourceToken = "fresh-export-installed-1924-${attempt}";
assert.equal(text.split(sourceToken).length - 1, 1);
const extra = `
  check("Measured entry, all click samples, and retained failed audit lineage", () => {
    const previous = path.join(base, "fresh-export-audit-02/report.json"), failed = read(previous);
    assert.equal(failed.status, "FAILED"); assert.match(failed.error, /66 !== 64/);
    assert.equal(failed.input.sha256, sha(file));
    report.previousAudit = { path: previous, sha256: sha(previous) };
    assert.equal(r.readinessPolicy, "PLAYWRIGHT_TRIAL_BEFORE_UNCHANGED_GEOMETRY");
    assert.equal(sha(r.choiceEntryDiagnosis.path), r.choiceEntryDiagnosis.sha256);
    const probe = read(r.choiceEntryDiagnosis.path);
    assert.equal(probe.status, "PASS"); assert(probe.finishedAt && !probe.cleanupError);
    assert.equal(probe.cells.length, 4);
    for (const cell of probe.cells) {
      assert.equal(cell.status, "PASS"); assert(cell.selectedExpectedScene);
      assert.equal(cell.visibilityPredicates.enabled, cell.reduced);
      assert(Object.values(cell.actionabilityPredicates).every(Boolean));
    }
    // Per layout: 12 open/back pairs, then settings(4), start(1),
    // entry advance(1), branch(1), next dialogue page(1), resume(1).
    assert.equal(r.hitChecks.length, r.cells.length * 2 + r.stories.length * 9);
    assert.equal(r.hitChecks.length, 66);
    for (const hit of r.hitChecks) {
      assert(hit.before && hit.actual);
      const v = hit.actual, b = v.rect;
      assert(v.enabled && v.hit && v.overflow <= 1);
      assert(b.width > 0 && b.height > 0 && b.x >= -1 && b.y >= -1 &&
        b.right <= v.width + 1 && b.bottom <= v.height + 1);
    }
    assert.equal(r.hitChecks.filter(h => h.before.label === "选择：voice_dialog").length, 2);
    assert.equal(r.hitChecks.filter(h => ["继续游戏", "continue-game"].includes(h.before.label)).length, 2);
    return { sampledHits: 66, previouslyOmittedResumeClicks: 2, diagnosticCells: 4,
      replayedProductActions: 0, failedReportPreserved: true };
  });
`;
const source = text.replace(sourceToken, "fresh-export-installed-1924-02").replace(before, before + extra);
new vm.Script(Module.wrap(source), { filename: __filename });
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
