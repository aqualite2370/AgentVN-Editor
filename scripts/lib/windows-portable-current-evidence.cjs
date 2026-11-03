"use strict";
const assert = require("node:assert/strict");
function validatePortableEvidence(r, { editorVersion = "1.9.16", candidateBinding, nativeAuditPath } = {}) {
  assert.equal(r.status, "PASS"); assert(!r.error && !r.cleanupError && r.profilesRestored);
  assert.equal(r.scope, "ACTUAL_INSTALLED_EDITOR_GENERATED_WINDOWS_PORTABLE");
  if (candidateBinding) {
    assert.match(editorVersion, /^1\.\d+\.\d+$/);
    assert.deepEqual(r.nativeCandidateBinding, candidateBinding);
    assert.equal(r.sourceAudit.path, nativeAuditPath);
    assert.equal(r.nativeUIBuildSource, true);
    assert(/editor-\d{2}[\\/]report\.json$/.test(r.sourceReport.path));
  } else assert(["1.9.16", "1.9.22"].includes(editorVersion));
  assert.equal(r.editorVersion, editorVersion);
  if (editorVersion === "1.9.22" && !candidateBinding) {
    assert.equal(r.nativeUIBuildSource, true);
    assert(/editor-\d{2}[\\/]report\.json$/.test(r.sourceReport.path));
    assert(/native-ui-audit-02[\\/]report\.json$/.test(r.sourceAudit.path));
  }
  for (const key of ["builds", "productChanges", "modelRequests"]) assert.equal(r[key], 0);
  assert.deepEqual(r.errors, []); assert.equal(r.checks.length, 4);
  assert(r.checks.every(c => c.status === "PASS"));
  assert.equal(r.launches.length, 2); assert.equal(r.cleanups.length, 2);
  for (const l of r.launches) {
    assert.deepEqual(l.args, []);
    assert.equal(l.storage.portable, true);
    assert.equal(l.executableSha256, r.sourceArtifact.sha256);
    assert.equal(l.packageMarkers["runtime-mode.json"].mode, "fixed");
    assert.equal(l.packageMarkers["fixed-only.json"].fixedOnly, true);
    assert.equal(l.packageMarkers["release-package.json"].presentationMode, "release");
  }
  assert(r.launches[0].pid !== r.launches[1].pid || r.launches[0].created !== r.launches[1].created);
  for (const c of r.cleanups) { assert.deepEqual(c.remaining, []); assert.equal(c.method, "ATTRIBUTED_TERMINATION_NOT_PHYSICAL_CLOSE"); }
  const expected = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
    [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
  assert.deepEqual(r.matrix.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), expected);
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS");
    const g = m.geometry;
    assert(g.focusInside && !g.clipped && g.overflow <= 1);
    assert(g.panel.x >= -1 && g.panel.y >= -1 && g.panel.right <= m.width + 1 && g.panel.bottom <= m.height + 1);
    assert(g.buttons.length >= 3 && g.buttons.every(b => b.hit && !b.disabled && b.x >= g.panel.x - 1
      && b.y >= g.panel.y - 1 && b.right <= g.panel.right + 1 && b.bottom <= g.panel.bottom + 1));
    for (let i = 0; i < g.buttons.length; i++) for (let j = i + 1; j < g.buttons.length; j++)
      assert(!(Math.min(g.buttons[i].right, g.buttons[j].right) - Math.max(g.buttons[i].x, g.buttons[j].x) > 1
        && Math.min(g.buttons[i].bottom, g.buttons[j].bottom) - Math.max(g.buttons[i].y, g.buttons[j].y) > 1));
  }
  assert.equal(r.screenshots.length, 15);
  assert.equal(r.acls.length, 2);
  assert.equal(r.acls[0].isElevated, false); assert(r.acls[0].probe.accessDenied && !r.acls[0].probe.allowed);
  assert(r.acls[1].probe.allowed && r.acls[1].comparison.permissionsMatch
    && r.acls[1].comparison.daclBytesMatch && r.acls[1].comparison.ownerGroupMatch
    && r.acls[1].comparison.allOtherFlagsMatch);
  assert.equal(r.checks[0].result.value.command_index, 0);
  assert.equal(r.checks[3].result.command, 1);
  assert.equal(r.checks[3].result.scene, "ui_acceptance");
  assert(r.checks[2].result.saveError.includes("不会回退"));
  assert(r.checks[2].result.migrationError.includes("不会回退"));
  assert.deepEqual(r.finalSaves.map(f => f.name),
    ["auto-01.json", "quick-06.json", "slot-01.json", "slot-02.json", "slot-05.json", "slot-06.json"]);
  assert.deepEqual(r.finalLegacy, r.checks[1].result.legacy);
  for (const name of ["slot-02.json", "auto-01.json", "quick-06.json"])
    assert.equal(r.finalSaves.find(f => f.name === name).sha256, r.finalLegacy.find(f => f.name === name).sha256);
  for (const f of r.checks[1].result.target)
    assert.equal(r.finalSaves.find(n => n.name === f.name).sha256, f.sha256);
  return { runtimeStatus: "PASS_LIMITED", actualLoadedKinds: ["manual"],
    autoQuickScope: "Migrated bytes and UI readability; not actual load or quick-save retention proof",
    matrixScope: "Migration dialog only, not every Runtime page" };
}
module.exports = { validatePortableEvidence };
