"use strict";
// Evidence replay only. Never launch a product or modify protected profiles.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const root = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-motion-current-30";
const raw = JSON.parse(fs.readFileSync(path.join(root, "motion.json"), "utf8"));
const session = JSON.parse(fs.readFileSync(path.join(root, "installed-session.json"), "utf8"));
assert.equal(session.version, "1.9.30");
assert.equal(session.executable.sha256, "296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa");
assert.equal(raw.matrix.length, 24);
const matrices = raw.matrix.filter(m => m.layout === "renpy");
assert.equal(matrices.length, 12);
for (const m of matrices) {
  assert.throws(() => assert.equal(m.quickGeometry.buttons.length, 8), /9 !== 8/);
}
const { buildMotionAudit } = require("./candidate-1930-menu-resume.cjs");
const original = fs.readFileSync(path.join(__dirname, "installed-runtime-motion-current-audit.cjs"), "utf8");
const result = buildMotionAudit(original);
const current = require("./candidate-1930-menus.cjs").buildAudit("motion", original);
const before = "const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);";
assert.equal(result.source, current.source.replace(before,
  'const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 9);\n' +
  '        assert.equal(require("./lib/installed-runtime-motion-1922-policy.cjs")\n' +
  '          .validateQuickBar({ ...m.quickGeometry, width: m.width }).status, "PASS");'));
assert.throws(() => buildMotionAudit(original.replace(before, "")));
assert.throws(() => buildMotionAudit(original + "\n" + before));
const { validateQuickBar } = require("./lib/installed-runtime-motion-1922-policy.cjs");
let rejected = 0;
for (const m of matrices) {
  const geometry = { ...m.quickGeometry, width: m.width };
  assert.equal(validateQuickBar(geometry).status, "PASS");
  for (const mutate of [
    g => g.buttons.pop(), g => g.buttons.push(g.buttons[0]),
    g => { g.buttons[8].id = "settings"; }, g => { g.buttons[8].hit = false; },
    g => { g.buttons[8].rect.top += 30; }, g => { g.buttons[8].rect.right = g.width + 100; },
    g => { g.buttons[8].rect.left = g.buttons[7].rect.left; },
    g => { g.buttons[8].rect.width = 0; },
  ]) {
    const invalid = structuredClone(geometry); mutate(invalid);
    assert.equal(validateQuickBar(invalid).status, "FAILED"); rejected++;
  }
}
console.log(JSON.stringify({ status: "PASS", legacyEightFailureReproduced: 12,
  exactCurrentOrderAndGeometry: 12, invalidVariantsRejected: rejected,
  oldFullFrameAndCleanupOraclePreserved: true, launches: 0, modelRequests: 0 }));
