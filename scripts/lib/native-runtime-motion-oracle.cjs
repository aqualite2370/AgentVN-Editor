"use strict";
const assert = require("node:assert/strict");
function check(row, name, ok, detail) {
  row.checks.push({ name, status: ok ? "PASS" : "FAILED", ...(ok ? {} : { detail }) });
}
function common(row, trace, expected) {
  check(row, "Nonempty visible sequence and trusted input", trace.frames.length >= 3 && !trace.limitReached
    && trace.inputs.some(i => i.trusted) && trace.frames.every(f => !f.hidden),
  { frames: trace.frames.length, inputs: trace.inputs, cap: trace.limitReached });
  check(row, "Every frame has actual viewport/DPR/media", trace.frames.every(f =>
    f.width === expected.width && f.height === expected.height && Math.abs(f.dpr - expected.dpr) <= 1e-6
    && f.reduced === expected.reduced));
  check(row, "No horizontal overflow or second functional page/player", trace.frames.every(f =>
    f.horizontalOverflow <= 1 && f.functionalLayerCount === 1 && f.playerCount <= 1),
  trace.frames.filter(f => f.horizontalOverflow > 1 || f.functionalLayerCount !== 1 || f.playerCount > 1).slice(0, 2));
  check(row, "Page snapshots and modal exits cannot receive input or focus", trace.frames.every(f =>
    !f.snapshotFocus && f.snapshots.every(s => s.inert && s.ariaHidden === "true" && s.pointerEvents === "none")
    && f.modalExits.every(s => s.inert && s.ariaHidden === "true" && s.pointerEvents === "none"
      && !s.focus && s.functionalModals === 0)));
}
function transition(row, trace, expected, { from, to, style, stableNav = false }) {
  const frames = trace.frames, last = frames.at(-1);
  const changing = frames.filter(f => !["idle", "loading"].includes(f.phase));
  const total = expected.reduced ? 816 : 1632;
  check(row, "Correct unique final page and focus owner", last.screen === to && last.committed === to
    && last.phase === "idle" && !last.snapshots.length && !last.unavailableFocus, last);
  check(row, "Full duration equals existing cover plus reveal token", changing.length >= 2
    && changing.every(f => f.duration === total && f.coverMs + f.revealMs === total), changing.slice(0, 2));
  if (style === "crossfade") {
    const cross = changing.filter(f => f.phase === "crossfading");
    check(row, "Non-story Renpy page change has continuous fade without black", cross.length >= 3
      && changing.every(f => f.style === "crossfade" && f.black < .01), changing.slice(0, 2));
    check(row, "Entering and inert outgoing pixels overlap without blank/double flash",
      cross.filter(f => f.surface?.opacity > .01 && f.surface.opacity < .99).length >= 2
      && cross.every(f => f.snapshots.some(s => !s.category && Math.abs(s.opacity + f.surface.opacity - 1) <= .1)),
    cross.slice(0, 2));
    if (stableNav) {
      const start = frames.find(f => f.nav)?.nav.rect;
      check(row, "Shared menu rail remains mounted and geometrically stable", Boolean(start)
        && frames.every(f => f.sameNavigation && f.nav
          && ["x", "y", "width", "height"].every(k => Math.abs(f.nav.rect[k] - start[k]) <= 1)),
      frames.filter(f => !f.sameNavigation).slice(0, 2));
    }
  } else {
    check(row, "Story/AgentVN seam retains visible cover, swap and reveal",
      ["covering", "swap", "revealing"].every(p => changing.some(f => f.phase === p))
      && changing.some(f => f.phase === "covering" && f.black > .01 && f.black < .99)
      && changing.some(f => f.phase === "revealing" && f.black > .01 && f.black < .99), changing.slice(0, 2));
    const committed = frames.find(f => f.screen === to && f.committed === to);
    check(row, "Page replacement occurs behind opaque black", committed && committed.black >= .99, committed);
  }
  row.timings = { from, to, expectedMs: total,
    observedChangingSpanMs: changing.length ? changing.at(-1).at - changing[0].at : null };
}
function validateReport(r, smoke, { preview1922 = false } = {}) {
  assert.equal(r.status, "PASS"); assert.equal(r.error, null); assert.equal(r.cleanupError, null);
  assert.equal(r.scope, preview1922
    ? "ACTUAL_1922_NSIS_SHIPPED_PLAYER_PREVIEW_MOTION_NOT_STANDALONE_SETUP_ANDROID"
    : "CURRENT_NATIVE_LIBRARY_MOTION_NOT_INSTALL_SETUP_UPGRADE_ANDROID");
  assert.equal(r.smoke, smoke);
  assert.equal(r.matrix.length, smoke ? 4 : 24); assert.equal(r.launches.length, 2);
  assert.deepEqual(r.pageErrors, []);
  for (const name of ["productChanges", "builds", "modelRequests"]) assert.equal(r[name], 0);
  const expected = ["agentvn", "renpy"].flatMap(layout =>
    (smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]).flatMap(([width, height]) =>
      (smoke ? [1] : [1, 2]).flatMap(dpr => [false, true].map(reduced => ({ layout, width, height, dpr, reduced })))));
  assert.deepEqual(r.matrix.map(({ layout, width, height, dpr, reduced }) =>
    ({ layout, width, height, dpr, reduced })), expected);
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS"); assert.equal(m.episodes.length, 19);
    assert(m.episodes.every(e => e.status === "PASS" && !e.actionError && e.checks.length >= 5
      && e.checks.every(c => c.status === "PASS") && e.trace.frames >= 3));
    if (m.layout === "renpy") assert.equal(m.quickGeometry.status, "PASS");
  }
  for (const l of r.launches) {
    assert(l.identity && l.executableSha256);
    assert.equal(l.scope, "CURRENT_NATIVE_NOT_RELEASE_INSTALL");
    assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
  }
}
module.exports = { check, common, transition, validateReport };
