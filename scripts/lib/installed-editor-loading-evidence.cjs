"use strict";
const assert = require("node:assert/strict");
const scope = "CURRENT_INSTALLED_RELEASE_EDITOR_CONTROLLED_MODULE_NETWORK_FAULTS";
function validateLoadingEvidence(raw) {
  assert.equal(raw.status, "PASS"); assert.equal(raw.scope, scope);
  for (const key of ["sourceServer", "timerMock", "storeMutation"]) assert.equal(raw[key], false);
  assert.equal(raw.realModelRequests, 0); assert.equal(raw.productChanges, 0);
  assert.deepEqual(raw.pageErrors, []); assert.deepEqual(raw.forbiddenRequests, []); assert.equal(raw.error, null);
  assert.equal(raw.matrix.length, 12); assert.equal(raw.timeoutCases.length, 2); assert.equal(raw.screenshots.length, 26);
  const check = e => {
    assert.equal(e.status, "PASS"); assert(e.checks.length > 0 && e.checks.every(c => c.status === "PASS"));
    assert(e.trace?.path && /^[a-f\d]{64}$/.test(e.trace.sha256) && e.trace.frames >= 3);
  };
  for (const [width, height] of [[1920,1080],[2560,1440],[3840,2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const groups = raw.matrix.filter(m => m.width === width && m.height === height && m.dpr === dpr && m.reduced === reduced);
      assert.equal(groups.length, 1); const m = groups[0]; assert.equal(m.status, "PASS");
      for (const v of [m.actualBefore, m.actualAfter]) {
        assert.equal(v.width, width); assert.equal(v.height, height);
        assert(Math.abs(v.dpr - dpr) <= 1e-6); assert.equal(v.reduced, reduced);
      }
      assert.deepEqual(m.episodes.map(e => e.name), [
        "module-error-original-page-and-real-retry", "rapid-retarget-and-late-module-result"
      ]);
      m.episodes.forEach(check);
      const failure = m.episodes[0].checks.find(c => c.name.startsWith("Failure retains")).detail;
      assert.equal(failure.active, "settings"); assert.equal(failure.inert, false); assert.equal(failure.retryHit, true);
      assert(failure.error && failure.errorRect.left >= 0 && failure.errorRect.right <= width + 1 && failure.overflow <= 1);
      const final = m.episodes[1].checks.find(c => c.name.startsWith("Latest actual")).detail;
      assert.equal(final.active, "settings"); assert(!final.inert && !final.error && !final.pending && final.overflow <= 1);
    }
  for (const reduced of [false, true]) {
    const groups = raw.timeoutCases.filter(c => c.reduced === reduced); assert.equal(groups.length, 1);
    const c = groups[0]; assert.equal(c.status, "PASS");
    assert.equal(c.width, 1920); assert.equal(c.height, 1080); assert.equal(c.dpr, 1);
    assert(c.checks.length > 0 && c.checks.every(k => k.status === "PASS"));
    const { elapsedMs, failed } = c.checks[0].detail;
    assert(elapsedMs >= 29000 && failed.error.includes("超时"));
    assert.equal(failed.active, "settings"); assert(!failed.inert && failed.retryHit);
    assert.equal(c.episodes.length, 1); check(c.episodes[0]);
    assert.equal(c.episodes[0].checks[0].detail.active, "animation");
  }
  const aborted = raw.transport.filter(t => t.mode === "abort"), held = raw.transport.filter(t => t.mode === "hold");
  assert(aborted.length >= 12 && held.length >= 14);
  assert(aborted.every(t => t.aborted && new URL(t.url).hostname === "tauri.localhost"
    && /\/assets\/GenerationHistoryPanel-.*\.js/.test(new URL(t.url).pathname)));
  assert(held.every(t => t.releasedAt && !t.releaseError && new URL(t.url).hostname === "tauri.localhost"
    && /\/assets\/AnimationEditorPanel-.*\.js/.test(new URL(t.url).pathname)));
  return { combinations: 12, moduleEpisodes: 24, realTimeouts: 2,
    staleResponseScope: "Final ownership after delayed-module consumption/reselect; not isolated pre-reselect timing oracle" };
}
module.exports = { scope, validateLoadingEvidence };
