"use strict";
// Pure evidence oracle: no launches, product writes, screenshots or relaxed UI assertions.
const assert = require("node:assert/strict");
const { assertSettingsIconProportions } = require("./runtime-settings-proportions.cjs");
const near = (a, b) => typeof b === "number" ? Number.isFinite(Number(a)) && Math.abs(Number(a) - b) < 1e-5 : a === b;
function validateSettings(r, { executable, current = false } = {}) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert(!r.error && !r.cleanupError);
  assert.equal(r.scope, "INSTALLED_NSIS_PLAYER_LIBRARY_SETTINGS_PERSISTENCE_NOT_STANDALONE_SETUP_ANDROID");
  assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0);
  assert.deepEqual(r.pageErrors, []);
  const groups = r.inventory.groups, controls = groups.flatMap(g => g.controls);
  assert.deepEqual(groups.map(g => g.id), ["display", "text", "audio", "skip", "system"]);
  assert.equal(controls.length, 17); assert.equal(new Set(controls.map(c => c[0])).size, 17);
  assert.equal(controls.filter(c => c[2] === null).length, 9);
  assert.equal(controls.filter(c => c[2] !== null).length, 8);
  assert.equal(r.checks.length, 12); assert(r.checks.every(c => c.status === "PASS"));
  function prefs(p, column) {
    assert(p); assert.equal(p.schemaVersion, 8); assert.equal(p.language, "zh-CN"); assert.equal(p.transitions, "all");
    for (const c of controls) assert(near(p[c[0]], c[column]), `Persisted ${c[0]}`);
    assert(near(p.textSpeed, p.textSpeedCps));
    for (const k of ["rollbackSideDesktop", "rollbackSideMobile", "titleBackgroundDimmingOverride", "settingsPanelBackgroundDimmingOverride"])
      assert(!Object.hasOwn(p, k), `Retired ${k}`);
  }
  function state(s, column) {
    assert.equal(s.controls.length, 17); prefs(s.prefs, column);
    assert.equal(new Set(s.controls.map(c => c.key)).size, 17);
    for (const c of controls) assert(near(s.controls.find(v => v.key === c[0])?.value, c[column]), `UI ${c[0]}`);
  }
  const find = (name, layout) => {
    const list = r.checks.filter(c => c.name.startsWith(name) && (!layout || c.layout === layout));
    assert.equal(list.length, 1, name); return list[0].detail;
  };
  for (const [layout, column] of [["agentvn", 5], ["renpy", 6]]) {
    const initial = find("New game identity", layout), changed = find("Change all17", layout);
    const restarted = find("Actual new native process", layout);
    state(initial, 4); state(changed.changed, column); state(changed.reopened, column); state(restarted, column);
    assert(changed.completedToRealTitle && restarted.realNativeRestart);
    assert.deepEqual(changed.changed.prefs, changed.reopened.prefs);
    assert.deepEqual(changed.reopened.prefs, restarted.prefs);
    if (layout === "renpy") prefs(initial.otherIdentityUnchanged, 5);
    assert.equal(find("All five categories", layout).combinations, 12);
    assert.equal(find("All five categories", layout).actualCategoryClicks, 60);
  }
  const cross = find("Switching the same"), other = find("Other game still");
  state(cross.before, 5); state(cross.reset, 4); prefs(cross.otherBefore, 6);
  assert.deepEqual(cross.otherBefore, cross.otherAfter);
  state(find("Reset defaults survive"), 4);
  state(other.before, 6); state(other.reset, 4); state(find("Second game's reset"), 4);
  assert.equal(r.matrix.length, 24);
  const keys = new Set(r.matrix.map(m => `${m.layout}:${m.width}:${m.height}:${m.dpr}:${m.reduced}`));
  assert.equal(keys.size, 24);
  for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const d of [1, 2]) for (const v of [false, true]) assert(keys.has(`${l}:${w}:${h}:${d}:${v}`));
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS"); assert.equal(m.categories.length, 5);
    assert.deepEqual(m.categories.map(c => c.id), groups.map(g => g.id));
    for (const [i, c] of m.categories.entries()) {
      const g = c.geometry; assert.equal(g.current, groups[i].id);
      assert.equal(g.viewport.width, m.width); assert.equal(g.viewport.height, m.height);
      assert(Math.abs(g.viewport.dpr - m.dpr) < 1e-6);
      assert(g.overflow <= 1 && g.categoryScroll <= 1);
      assert(g.panel.x >= -1 && g.panel.y >= -1 && g.panel.right <= m.width + 1 && g.panel.bottom <= m.height + 1);
      assert(g.panel.width > 0 && g.panel.width < m.width * .95 && g.panel.height > 0);
      assert.equal(g.controls.length, 8 + groups[i].controls.length);
      for (const b of g.controls) {
        assert(b.hit && !b.clipped && !b.disabled && !b.inert, b.label);
        assert(b.rect.width > 0 && b.rect.height > 0 && b.rect.x >= -1 && b.rect.y >= -1
          && b.rect.right <= m.width + 1 && b.rect.bottom <= m.height + 1, b.label);
      }
      for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
        const x = g.controls[a].rect, y = g.controls[b].rect;
        assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
          && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1), "Overlapping controls");
      }
      assertSettingsIconProportions(c.icons);
    }
  }
  assert.equal(r.launches.length, 8); assert.equal(r.interactions.length, 8);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.identity.CreationDate}`)).size, 8);
  for (const l of r.launches) {
    assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "REAL_UI_CONFIRMED_NATIVE_DESTROY");
    assert(l.library.controlledPublicNativePreparation); assert.equal(l.library.storage.portable, false);
    assert.equal(l.library.savesBefore.length, 0);
    if (executable) assert.equal(l.identity.ExecutablePath.toLowerCase(), executable.toLowerCase());
    if (current) assert(l.executableSha256 && l.libraryStorage === "PHYSICAL_DEFAULT_PATH");
  }
  const inputs = r.interactions.flatMap(i => i.inputs);
  assert(inputs.length >= 350 && inputs.every(i => i.trusted));
  assert(inputs.filter(i => i.type === "click").length >= 200);
  assert(inputs.filter(i => i.type === "keydown").length >= 100);
  assert.equal(r.screenshots.length, 28);
  for (const image of r.screenshots) {
    assert.deepEqual(image.before, image.after);
    const d = Math.round(image.before.dpr); assert([1, 2].includes(d) && Math.abs(d - image.before.dpr) < 1e-6);
    assert.equal(image.png.width, image.before.width * d); assert.equal(image.png.height, image.before.height * d);
  }
  return { controls: 17, businessChecks: 12, displayCombinations: 24, categoryNavigations: 120,
    nativeProcesses: 8, trustedInputs: inputs.length, screenshots: 28 };
}
module.exports = { validateSettings };
