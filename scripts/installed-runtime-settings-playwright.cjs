"use strict";
// Acceptance tooling only. UI writes are trusted clicks/keys, never store injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const nativeIndex = process.argv.indexOf("--current-native-preparation");
const currentNative = nativeIndex >= 0;
const { readInstalledViewport } = require(currentNative
  ? "./lib/current-native-capture.cjs" : "./lib/installed-webview-capture.cjs");
const { measureSettingsIconProportions, assertSettingsIconProportions } = require("./lib/runtime-settings-proportions.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const run = "D:/AgentVN/output/installed-runtime-settings-20261018-01";
const previous = "D:/AgentVN/output/installed-runtime-persistence-20261018-01";
const prep = read(currentNative ? process.argv[nativeIndex + 1] : path.join(run, "preparation.json"));
const out = currentNative ? prep.sessionRoot : process.argv[2];
assert(out);
if (currentNative) {
  assert.equal(path.dirname(path.resolve(out)), path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261020-01"));
  assert.equal(prep.defaultStorage, "PHYSICAL_DEFAULT_PATH");
  assert(!fs.existsSync(path.join(out, "report.json")));
} else assert(path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const fixture = currentNative ? prep.fixture : read(path.join(previous, "fixtures.json"));
const source = currentNative ? prep.originalExport.path : path.join(previous, "export-02/report.json"), exported = read(source);
assert.equal(prep.status, "PASS"); assert.equal(exported.status, "PASS");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(currentNative ? out : run));
if (!currentNative) fs.mkdirSync(out);
const groups = [
  { id: "display", label: "显示", controls: [
    ["fontScale", "Font scale", 0.75, 0.05, 1, 1.35, 1.1],
    ["lineSpacing", "Line spacing", 0.8, 0.05, 1, 1.25, 1.15],
    ["highContrastText", "High contrast text", null, null, false, true, true],
  ] },
  { id: "text", label: "文字", controls: [
    ["textSpeedCps", "Text speed", 0, 2, 36, 74, 92],
    ["autoForwardTime", "Auto forward time", 0, 0.5, 6, 11.5, 9],
    ["autoForwardAfterClick", "Auto forward after click", null, null, false, true, true],
  ] },
  { id: "audio", label: "音频", controls: [
    ["volumeMaster", "Master volume", 0, 0.05, 1, 0.55, 0.7],
    ["volumeBgm", "Background music volume", 0, 0.05, 0.8, 0.25, 0.35],
    ["muteBgm", "Mute background music", null, null, false, true, true],
    ["volumeSfx", "Sound effects volume", 0, 0.05, 0.9, 0.45, 0.5],
    ["muteSfx", "Mute sound effects", null, null, false, true, true],
    ["volumeVoice", "Voice volume", 0, 0.05, 0.9, 0.65, 0.4],
    ["muteVoice", "Mute voice", null, null, false, true, true],
    ["muteAll", "Mute all", null, null, false, true, true],
  ] },
  { id: "skip", label: "跳过", controls: [
    ["skipUnread", "Skip unread text", null, null, false, true, true],
    ["skipAfterChoices", "Skip after choices", null, null, false, true, true],
  ] },
  { id: "system", label: "系统", controls: [
    ["autoSaveEnabled", "自动存档", null, null, true, false, false],
  ] },
];
const controls = groups.flatMap(g => g.controls);
assert.equal(controls.length, 17);
const defaults = Object.fromEntries(controls.map(c => [c[0], c[4]]));
const values = Object.fromEntries(["agentvn", "renpy"].map((l, i) =>
  [l, Object.fromEntries(controls.map(c => [c[0], c[5 + i]]))]));
const ids = Object.fromEntries(["agentvn", "renpy"].map(layout => [layout, currentNative
  ? `${prep.installId}_${layout}` : `qa_settings_${layout}_20261018`]));
const report = {
  status: "RUNNING", at: new Date().toISOString(), checks: [], matrix: [], screenshots: [], launches: [],
  pageErrors: [], interactions: [], productChanges: 0, realModelRequests: 0, error: null,
  scope: "INSTALLED_NSIS_PLAYER_LIBRARY_SETTINGS_PERSISTENCE_NOT_STANDALONE_SETUP_ANDROID",
  controlledBoundary: "Existing real UI exports; public native cartridge-library preparation only; all preference writes use actual UI",
  source: { path: source, sha256: sha(source) }, fixture: { path: fixture.input, sha256: sha(fixture.input) },
  runnerAtInvocation: { path: __filename, sha256: sha(__filename) },
  currentNative, notRun: ["Windows standalone/setup/upgrade", "Android settings/audio", "Physical native window close",
    "Physical 4K display", "New Editor exports", "Full Editor motion", "New audio listening"],
  inventory: { groups, editableControls: 17, sliders: 8, checkboxes: 9, language: "中文 (read-only)",
    hiddenSchemaFieldsAreNotNewUserSettings: true },
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
report.tools = ["scripts/installed-runtime-settings-playwright.cjs", "scripts/lib/installed-runtime-session.cjs",
  "scripts/lib/runtime-settings-proportions.cjs", currentNative
    ? "scripts/lib/current-native-capture.cjs" : "scripts/lib/installed-webview-capture.cjs"]
  .map(p => ({ path: path.resolve(p), sha256: sha(p) }));
let s, current;
async function check(name, fn) {
  const row = { name, layout: current, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(row); row.status = "PASS"; }
  catch (e) {
    row.status = "FAILED"; row.error = String(e.stack || e);
    if (s?.page) {
      row.body = (await s.page.locator("body").innerText().catch(() => "")).slice(-4000);
      await s.shot(`failure-${report.checks.length}`).catch(() => {});
    }
  } finally { save(); console.log(`${row.status} ${current} ${name}`); }
  return row.status === "PASS";
}
async function start(layout, id = ids[layout]) {
  current = layout;
  s = new InstalledRuntimeSession({ prep, fixture, cartridges: currentNative ? prep.cartridges : exported.cartridges,
    out, report, save, installId: id, currentNative });
  await s.start(layout, false);
  await s.page.evaluate(() => {
    window.__qaPreferenceInput = [];
    for (const type of ["click", "keydown"]) document.addEventListener(type, e => {
      const n = e.target?.closest("button,input");
      if (n) window.__qaPreferenceInput.push({ type, trusted: e.isTrusted, key: e.key,
        label: n.getAttribute("aria-label") || n.getAttribute("data-testid") || n.textContent.trim() });
    }, true);
  });
  await s.openSettings();
}
async function stop(nativeExit = true) {
  if (!s?.page) { await s?.stop(); return; }
  // Native exit is driven from the actual root settings page, not an invoke.
  if (nativeExit) {
    if (await s.screen() !== "settings") await s.openSettings();
    await s.page.getByTestId("open-exit-confirmation").click();
    await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
  }
  const inputs = await s.page.evaluate(() => window.__qaPreferenceInput);
  report.interactions.push({ pid: s.child.pid, layout: s.layout, installId: s.installId, inputs }); save();
  if (nativeExit) {
    await s.page.getByTestId("confirm-exit-game").click();
    await s.stop(true);
  } else await s.stop();
}
async function tab(group) {
  await s.page.locator(".settings-tabs").getByRole("button", { name: group.label, exact: true }).click();
  await s.page.locator(`[data-settings-tab-current="${group.id}"]`).waitFor();
  await settleRuntime(s.page);
}
function control(c) { return s.page.getByRole(c[2] === null ? "checkbox" : "slider", { name: c[1], exact: true }); }
function equal(actual, expected, label) {
  if (typeof expected === "number") assert(Math.abs(Number(actual) - expected) < 0.00001, `${label}: ${actual} != ${expected}`);
  else assert.equal(actual, expected, label);
}
function assertPrefs(prefs, expected) {
  assert(prefs); assert.equal(prefs.schemaVersion, 8); assert.equal(prefs.language, "zh-CN");
  assert.equal(prefs.transitions, "all");
  for (const c of controls) equal(prefs[c[0]], expected[c[0]], c[0]);
  equal(prefs.textSpeed, expected.textSpeedCps, "legacy text speed compatibility alias");
  for (const key of ["rollbackSideDesktop", "rollbackSideMobile", "titleBackgroundDimmingOverride", "settingsPanelBackgroundDimmingOverride"])
    assert(!Object.hasOwn(prefs, key), `Retired preference must not reappear: ${key}`);
}
async function readAll(expected) {
  const rows = [];
  for (const g of groups) {
    await tab(g);
    assert.equal(await s.page.locator(".settings-category-content input").count(), g.controls.length);
    for (const c of g.controls) {
      const n = control(c), value = c[2] === null ? await n.isChecked() : Number(await n.inputValue());
      equal(value, expected[c[0]], c[0]);
      rows.push({ key: c[0], label: c[1], value });
    }
  }
  const prefs = await s.prefs(); assertPrefs(prefs, expected);
  return { controls: rows, prefs };
}
async function changeAll(expected) {
  const rows = [];
  for (const g of groups) {
    await tab(g);
    for (const c of g.controls) {
      const n = control(c);
      if (c[2] === null) {
        if (await n.isChecked() !== expected[c[0]]) await n.click();
      } else {
        await n.focus(); await n.press("Home");
        const steps = Math.round((expected[c[0]] - c[2]) / c[3]); assert(steps >= 0 && steps <= 100);
        for (let i = 0; i < steps; i++) await n.press("ArrowRight");
      }
      const value = c[2] === null ? await n.isChecked() : Number(await n.inputValue());
      equal(value, expected[c[0]], c[0]); rows.push({ key: c[0], value });
      const state = await n.evaluate(e => ({ focused: document.activeElement === e, inert: Boolean(e.closest("[inert]")) }));
      assert(state.focused && !state.inert, "Actual changed control must own keyboard focus");
    }
  }
  const prefs = await s.prefs(); assertPrefs(prefs, expected);
  return { controls: rows, prefs };
}
async function geometry() {
  return s.page.locator(".settings-renpy").evaluate(panel => {
    const rect = n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right,
      bottom: r.bottom, width: r.width, height: r.height }; };
    const nodes = [...panel.querySelectorAll("button,input")];
    return { panel: rect(panel), overflow: document.documentElement.scrollWidth - innerWidth,
      categoryScroll: panel.querySelector(".settings-tabs").scrollHeight - panel.querySelector(".settings-tabs").clientHeight,
      current: panel.querySelector("[data-settings-tab-current]").dataset.settingsTabCurrent,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      controls: nodes.map(e => {
        const r = rect(e); let clipped = false;
        for (let p = e.parentElement; p && p !== panel.parentElement; p = p.parentElement) {
          const css = getComputedStyle(p), pr = rect(p);
          if (/^(hidden|clip|auto|scroll)$/.test(css.overflowX) && (r.x < pr.x - 1 || r.right > pr.right + 1)) clipped = true;
          if (/^(hidden|clip|auto|scroll)$/.test(css.overflowY) && (r.y < pr.y - 1 || r.bottom > pr.bottom + 1)) clipped = true;
        }
        return { label: e.getAttribute("aria-label") || e.getAttribute("data-testid") || e.textContent.trim(),
          rect: r, clipped, disabled: e.disabled, inert: Boolean(e.closest("[inert]")),
          hit: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }) };
  });
}
function assertGeometry(g, expected, group) {
  assert.equal(g.current, group.id); assert(g.overflow <= 1); assert(g.categoryScroll <= 1);
  assert(g.panel.x >= -1 && g.panel.y >= -1 && g.panel.right <= expected.width + 1 && g.panel.bottom <= expected.height + 1);
  assert(g.panel.width < expected.width * 0.95, "Desktop settings must remain a bounded panel, not full screen");
  assert.equal(g.controls.length, 8 + group.controls.length, "All five tabs, three footer buttons and active inputs required");
  for (const c of g.controls) {
    assert(c.hit && !c.disabled && !c.inert && !c.clipped, `Unavailable control: ${c.label}`);
    assert(c.rect.width > 0 && c.rect.height > 0 && c.rect.x >= -1 && c.rect.y >= -1
      && c.rect.right <= expected.width + 1 && c.rect.bottom <= expected.height + 1, `Out-of-viewport: ${c.label}`);
  }
  for (let i = 0; i < g.controls.length; i++) for (let j = i + 1; j < g.controls.length; j++) {
    const a = g.controls[i], b = g.controls[j];
    assert(!(Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.x, b.rect.x) > 1
      && Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.y, b.rect.y) > 1), `Overlapping controls: ${a.label}/${b.label}`);
  }
}
async function matrix(layout) {
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const r = { layout, width, height, dpr, reduced, status: "RUNNING", categories: [] };
      report.matrix.push(r); save();
      try {
        await s.viewport({ width, height, dpr, reduced }); await settleRuntime(s.page);
        for (const g of groups) {
          await tab(g);
          const first = control(g.controls[0]); await first.focus();
          assert(await first.evaluate(e => document.activeElement === e && !e.closest("[inert]")));
          const measured = await geometry(), icons = await s.page.evaluate(measureSettingsIconProportions);
          r.categories.push({ id: g.id, geometry: measured, icons }); save();
          assertGeometry(measured, { width, height }, g); assertSettingsIconProportions(icons);
          for (const c of g.controls) equal(c[2] === null ? await control(c).isChecked() : Number(await control(c).inputValue()),
            values[layout][c[0]], c[0]);
        }
        await readInstalledViewport(s.page, { width, height, dpr, reduced });
        assertPrefs(await s.prefs(), values[layout]);
        await s.shot(`settings-${width}-${dpr}-${reduced}`);
        r.status = "PASS";
      } catch (e) {
        r.status = "FAILED"; r.error = String(e.stack || e);
        await s.shot(`matrix-failure-${width}-${dpr}-${reduced}`).catch(() => {});
      }
      save();
    }
  const rows = report.matrix.filter(r => r.layout === layout);
  assert.equal(rows.length, 12); assert(rows.every(r => r.status === "PASS"));
  return { combinations: rows.length, actualCategoryClicks: rows.reduce((n, r) => n + r.categories.length, 0) };
}
async function session(layout, id, fn) {
  try { await start(layout, id); await fn(); }
  finally { await stop(); }
}
(async () => {
  for (const layout of ["agentvn", "renpy"]) {
    await session(layout, ids[layout], async () => {
      await check("New game identity has all17 default UI values without borrowing another game's preferences", async () => {
        const initial = await readAll(defaults);
        const otherId = ids.agentvn;
        const other = layout === "renpy" ? await s.page.evaluate(id => JSON.parse(localStorage.getItem(`vn.runtime.settings.${id}`)), otherId) : null;
        if (other) assertPrefs(other, values.agentvn);
        return { ...initial, otherIdentityUnchanged: other };
      });
      await check("Change all17 legal controls via real clicks/keyboard; complete and reopen retain values", async () => {
        const changed = await changeAll(values[layout]);
        await s.finishSettings(); assert.equal(await s.screen(), "title_menu");
        await s.openSettings(); const reopened = await readAll(values[layout]);
        await s.shot("modified-all17");
        return { changed, reopened, completedToRealTitle: true };
      });
    });
  }
  for (const layout of ["agentvn", "renpy"]) {
    await session(layout, ids[layout], async () => {
      await check("Actual new native process preserves all17 values and every hidden preference byte", async () => {
        const initial = report.checks.find(c => c.layout === layout && c.name.startsWith("Change all17"));
        assert.equal(initial.status, "PASS"); const actual = await readAll(values[layout]);
        assert.deepEqual(actual.prefs, initial.detail.reopened.prefs);
        return { ...actual, realNativeRestart: true };
      });
      await check("All five categories/control geometry and icon proportions in12 WebView combinations", () => matrix(layout));
    });
  }
  await session("renpy", ids.agentvn, async () => {
    await check("Switching the same game's layout preserves its settings; resetting it does not reset other game", async () => {
      const before = await readAll(values.agentvn);
      const other = await s.page.evaluate(id => JSON.parse(localStorage.getItem(`vn.runtime.settings.${id}`)), ids.renpy);
      assertPrefs(other, values.renpy);
      await s.page.getByTestId("settings-reset-default").click();
      const reset = await readAll(defaults);
      const after = await s.page.evaluate(id => JSON.parse(localStorage.getItem(`vn.runtime.settings.${id}`)), ids.renpy);
      assert.deepEqual(after, other); await s.shot("cross-layout-reset-default");
      return { sameInstallId: ids.agentvn, before, reset, otherBefore: other, otherAfter: after };
    });
  });
  await session("agentvn", ids.agentvn, async () => {
    await check("Reset defaults survive native restart and switch back to original layout", () => readAll(defaults));
  });
  await session("renpy", ids.renpy, async () => {
    await check("Other game still retains all17 custom values after first game's reset; own reset restores all17", async () => {
      const before = await readAll(values.renpy);
      await s.page.getByTestId("settings-reset-default").click();
      const reset = await readAll(defaults); await s.shot("reset-default");
      return { before, reset };
    });
  });
  await session("renpy", ids.renpy, async () => {
    await check("Second game's reset defaults also survive actual native restart", () => readAll(defaults));
  });
  assert.equal(report.checks.length, 12); assert.equal(report.launches.length, 8); assert.equal(report.matrix.length, 24);
  report.status = report.checks.every(c => c.status === "PASS") && report.matrix.every(r => r.status === "PASS")
    && !report.pageErrors.length ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  try { await s?.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.map(c => ({ name: c.name, layout: c.layout, status: c.status, error: c.error })),
    matrix: report.matrix.length, launches: report.launches.length, error: report.error, cleanupError: report.cleanupError, out }, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
});
