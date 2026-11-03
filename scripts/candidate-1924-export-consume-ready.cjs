"use strict";
// Preserve the sealed failed consumer; adapt only actionability and receipt
// selection. All original geometry, story, byte and cleanup checks remain.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), Module = require("node:module"), vm = require("node:vm");
const original = path.join(__dirname, "candidate-1924-export-consume.cjs");
const expected = "f02c3d25e30d1739bf172b303231caaad4c4d79ab1f3a9aaa25cc0ec709aea70";
const diagnosis = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/choice-entry-probe-1924-01/report.json";
function once(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, `Expected one adaptation: ${before}`);
  return source.replace(before, after);
}
function adapt(source) {
  assert.equal(crypto.createHash("sha256").update(source).digest("hex"), expected, "Sealed consumer changed");
  // The source expression appears once for reading and once for description.
  assert.equal(source.split("`narrative-followup-${attempt}/report.json`").length - 1, 2);
  source = source.replaceAll("`narrative-followup-${attempt}/report.json`", '"narrative-followup-01/report.json"');
  source = once(source, "`author-export-${attempt}/report.json`", '"author-export-01/report.json"');
  source = once(source, 'tools: [__filename, "scripts/lib/dev-narrative-player.cjs"',
    'hitChecks: [], readinessPolicy: "PLAYWRIGHT_TRIAL_BEFORE_UNCHANGED_GEOMETRY",\n' +
    '  choiceEntryDiagnosis: desc("F:/AgentVN/QA/Native-Runtime-State-20261020-01/choice-entry-probe-1924-01/report.json"),\n' +
    '  tools: [__filename, "scripts/candidate-1924-export-consume.cjs", "scripts/lib/dev-narrative-player.cjs"');
  source = once(source, '  await locator.waitFor({ state: "visible" });\n  const actual =',
    '  await locator.waitFor({ state: "visible" });\n' +
    '  const evidence = { at: new Date().toISOString(), before: await locator.evaluate(e => ({\n' +
    '    label: e.getAttribute("aria-label") || e.getAttribute("data-testid") || e.textContent?.slice(0, 80),\n' +
    '    disabled: Boolean(e.disabled), opacity: getComputedStyle(e).opacity })) };\n' +
    '  report.hitChecks.push(evidence); save();\n' +
    '  await locator.click({ trial: true });\n  const actual =');
  source = once(source, '  const r = actual.rect;\n  assert(',
    '  evidence.actual = actual; save();\n  const r = actual.rect;\n  assert(');
  new vm.Script(Module.wrap(source), { filename: __filename });
  return source;
}
function load() {
  const evidence = JSON.parse(fs.readFileSync(diagnosis, "utf8"));
  assert.equal(evidence.status, "PASS"); assert(evidence.finishedAt && !evidence.cleanupError);
  assert.equal(evidence.productChanges, 0); assert.equal(evidence.cells.length, 4);
  for (const cell of evidence.cells) {
    assert.equal(cell.status, "PASS"); assert.equal(cell.selectedExpectedScene, true);
    assert(Object.values(cell.actionabilityPredicates).every(Boolean));
    assert.equal(cell.visibilityPredicates.enabled, cell.reduced);
    assert(Object.entries(cell.visibilityPredicates).filter(([k]) => k !== "enabled").every(([, v]) => v));
  }
  const source = adapt(fs.readFileSync(original, "utf8"));
  const adapted = new Module(__filename, module); adapted.filename = __filename; adapted.paths = module.paths;
  adapted._compile(source, __filename);
}
if (require.main === module) {
  if (process.argv.includes("--self-test")) {
    const text = fs.readFileSync(original, "utf8");
    const source = adapt(text);
    assert.throws(() => adapt(text + "\n"));
    assert.throws(() => once("a a", "a", "b"));
    assert.throws(() => once("a", "missing", "b"));
    assert(source.includes("actual.hit && actual.enabled && actual.overflow <= 1"));
    assert(source.includes("assert.equal(report.cells.length, 24)"));
    console.log("PASS sealed source, unique edits, retained geometry and complete matrix guards");
  } else {
    assert.equal(process.argv[2], "02", "Receipt02 consumes actual author01; never fabricate author02");
    load();
  }
}
module.exports = { adapt };
