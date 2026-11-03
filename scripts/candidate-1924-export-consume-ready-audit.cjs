"use strict";
// Same original independent audit, with additive readiness evidence checks.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-export-consume-audit.cjs");
const text = fs.readFileSync(original, "utf8");
assert.equal(crypto.createHash("sha256").update(text).digest("hex"),
  "6caa53d9c95319c3762595a991f8e3875732a567c5e565e5c5760442c15bfdd4");
assert.equal(process.argv[2], "02");
const before = "  report.input = { path: file, sha256: sha(file) };";
assert.equal(text.split(before).length - 1, 1);
const extra = `
  check("Measured choice-entry diagnosis and complete unchanged post-actionability hit checks", () => {
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
    assert.equal(r.hitChecks.length, 64);
    for (const hit of r.hitChecks) {
      assert(hit.before && hit.actual);
      const v = hit.actual, b = v.rect;
      assert(v.enabled && v.hit && v.overflow <= 1);
      assert(b.width > 0 && b.height > 0 && b.x >= -1 && b.y >= -1 &&
        b.right <= v.width + 1 && b.bottom <= v.height + 1);
    }
    assert.equal(r.hitChecks.filter(h => h.before.label === "选择：voice_dialog").length, 2);
    return { originalAuditUnchanged: true, sampledHits: r.hitChecks.length, diagnosticCells: probe.cells.length };
  });
`;
const source = text.replace(before, before + extra);
new vm.Script(Module.wrap(source), { filename: __filename });
const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
adapted._compile(source, __filename);
