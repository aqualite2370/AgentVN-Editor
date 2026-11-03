"use strict";
const assert = require("node:assert/strict");
const signature = r => ["layout", "width", "height", "dpr", "reduced"].map(k => r[k]).join(":");
const expectedMatrix = () => ["agentvn", "renpy"].flatMap(layout => [1920, 2560, 3840].flatMap(width =>
  [1, 2].flatMap(dpr => [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
function geometry(g, m, broken, extended) {
  assert.equal(g.cards.length, 1); assert(g.overflow <= 1 && !g.focusUnavailable);
  const c = g.cards[0]; assert(c.hit && !c.disabled);
  assert.equal(c.image.width, broken ? 0 : 320); assert.equal(c.image.height, broken ? 0 : 180);
  assert(c.rect.x >= -1 && c.rect.y >= -1 && c.rect.right <= m.width + 1 && c.rect.bottom <= m.height + 1);
  if (!extended) return;
  assert.equal(g.width, m.width); assert.equal(g.height, m.height); assert.equal(g.reduced, m.reduced);
  assert(Math.abs(g.dpr - m.dpr) < 1e-6); assert(g.controls.length > 1);
  for (const b of g.controls) {
    assert(!b.clipped && !b.inert && (b.disabled || b.hit), b.label);
    assert(b.rect.width > 0 && b.rect.height > 0 && b.rect.x >= -1 && b.rect.y >= -1
      && b.rect.right <= m.width + 1 && b.rect.bottom <= m.height + 1, b.label);
  }
  for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
    const x = g.controls[a].rect, y = g.controls[b].rect;
    assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
      && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1), "Overlapping gallery controls");
  }
}
function validateGallery(r, { installed = false, executable } = {}) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert(!r.error && !r.cleanupError);
  assert.equal(r.scope, installed ? "ACTUAL_NSIS_INSTALLED_PLAYER_CONTROLLED_GALLERY_NOT_EDITOR_EXPORT"
    : "CURRENT_NATIVE_PLAYER_CONTROLLED_GALLERY_NOT_RELEASE_INSTALL_OR_EDITOR_EXPORT");
  assert.equal(r.returnOnly, false);
  for (const k of ["productChanges", "builds", "realModelRequests", "installs"]) assert.equal(r[k], 0);
  assert.deepEqual(r.pageErrors, []);
  assert.equal(r.cases.length, installed ? 16 : 12); assert(r.cases.every(c => c.status === "PASS"));
  function one(layout, prefix) {
    const found = r.cases.filter(c => c.layout === layout && c.name.startsWith(prefix)); assert.equal(found.length, 1, prefix);
    return found[0].detail;
  }
  function story(s, text, index) {
    assert.equal(s.scene, "qa_gallery"); assert.equal(s.index, index); assert.equal(s.playerCount, 1);
    assert(s.text.includes(text)); assert(!s.text.includes("FORBIDDEN_GALLERY_SUCCESSOR"));
  }
  for (const layout of ["agentvn", "renpy"]) {
    const locked = one(layout, "Locked gallery"); assert.deepEqual(locked.unlocks, []);
    assert.equal(locked.state.screen, "title_menu"); assert.equal(locked.state.playerCount, 0);
    const unlock = one(layout, "Real story progression"); story(unlock.before, "GALLERY_AFTER", 2);
    assert.equal(unlock.record.anchor_id, "qa_gallery_anchor"); assert.equal(unlock.record.scene_id, "qa_gallery");
    assert.equal(unlock.assetSha256, r.cartridges.find(c => c.layout === layout).art.sha256);
    assert.equal(one(layout, "Gallery-only display matrix").cells, 12);
    const replay = one(layout, "Replay ends");
    assert.equal(replay.destination, "main_menu"); assert.equal(replay.savesUnchanged, true);
    story(replay.final, "GALLERY_AFTER", 2);
    const restarted = one(layout, "Native unlock"); assert(restarted.unlocks.includes("qa_gallery_anchor"));
    assert(restarted.geometry.cards[0].hit && !restarted.geometry.cards[0].disabled);
    const broken = one(layout, "Invalid image");
    assert(broken.visibleDiagnostic && broken.originalStoryStillPlayable);
    assert.equal(broken.returned, "main_menu"); assert.match(broken.retryDiagnostic, /无法加载|失败|损坏/);
    assert.equal(broken.geometry.cards[0].image.width, 0);
    if (installed) {
      assert.equal(r.rollbackRequired, true); assert.equal(r.installed, true);
      story(replay.rollbackRoundTrip.previous, "GALLERY_OPENING", 0);
      story(replay.rollbackRoundTrip.restored, "GALLERY_AFTER", 2);
      const manual = one(layout, "Manual replay exit");
      assert(manual.savesUnchanged); story(manual.restored, "GALLERY_AFTER", 2);
      story(manual.previous, "GALLERY_OPENING", 0); story(manual.forwarded, "GALLERY_AFTER", 2);
      const title = one(layout, "Title-origin").outcomes;
      assert.deepEqual(title.map(o => o.exit), ["manual", "natural"]);
      for (const o of title) {
        assert(o.savesUnchanged); assert.equal(o.final.screen, "title_menu");
        assert.equal(o.final.scene, null); assert.equal(o.final.playerCount, 0);
      }
    }
  }
  function matrix(list, broken) {
    assert.deepEqual(list.map(signature), expectedMatrix().map(signature));
    for (const m of list) { assert.equal(m.status, "PASS"); geometry(m.geometry, m, broken, installed);
      if (broken) assert.match(m.diagnostic, /无法加载|失败|损坏/); }
  }
  matrix(r.matrix, false);
  assert.equal(r.launches.length, 6);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.identity.CreationDate}`)).size, 6);
  for (const l of r.launches) {
    assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
    assert(l.library.controlledPublicNativePreparation); assert.equal(l.library.storage.portable, false);
    if (executable) assert.equal(l.identity.ExecutablePath.toLowerCase(), executable.toLowerCase());
  }
  assert.equal(r.cartridges.length, 2); assert.equal(r.brokenCartridges.length, 2);
  for (const c of r.cartridges) assert(c.controlledDerivative && !c.art.deliberatelyInvalidImage);
  for (const c of r.brokenCartridges) assert(c.controlledDerivative && c.art.deliberatelyInvalidImage);
  assert.equal(r.screenshots.length, installed ? 12 : 8);
  for (const image of r.screenshots) {
    assert.deepEqual(image.before, image.after);
    const d = Math.round(image.before.dpr); assert([1, 2].includes(d) && Math.abs(d - image.before.dpr) <= 1e-6);
    assert.equal(image.png.width, image.before.width * d); assert.equal(image.png.height, image.before.height * d);
  }
  if (installed) {
    matrix(r.faultMatrix, true); assert.equal(r.interactions.length, 6);
    assert.equal(r.returnTraces.length, 12);
    for (const row of r.returnTraces) {
      assert.equal(row.status, "PASS"); assert.equal(row.final.screen, row.expected);
      assert(row.frames.length > 2); assert.equal(row.frames[0].screen, "gallery");
      assert.equal(row.frames.at(-1).screen, row.expected);
      assert(row.frames.some(f => !["idle", "loading"].includes(f.phase)));
    }
    for (const m of [...r.matrix, ...r.faultMatrix])
      assert.equal(m.geometry.controlsRoot, m.layout === "renpy" ? "shared-renpy-frame" : "agentvn-page");
    const inputs = r.interactions.flatMap(i => i.inputs);
    assert(inputs.length > 60 && inputs.every(i => i.trusted));
    assert(inputs.filter(i => i.key === "PageUp").length >= 4);
    assert(inputs.filter(i => i.key === "PageDown").length >= 4);
    for (const l of r.launches) assert.equal(r.interactions.filter(i => i.pid === l.pid).length, 1);
    for (const n of ["Fresh Editor GUI gallery export", "Windows setup", "Android", "Normal native window close", "New audio listening"])
      assert(r.notRun.includes(n));
  }
  return { businessCases: r.cases.length, displayCases: r.matrix.length,
    faultyImageDisplayCases: r.faultMatrix?.length || 0, actualNativeLaunches: 6, screenshots: r.screenshots.length };
}
module.exports = { validateGallery, geometry };
