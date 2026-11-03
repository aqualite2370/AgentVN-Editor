"use strict";
// Actual installed library Player consumes the untouched UI-exported cartridge.
// Public native import prepares the test library; subsequent navigation is UI.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2] || "01"; assert(/^\d{2}$/.test(attempt));
const out = path.join(run, `authored-player-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(run, "fixtures.json"));
const exported = read(path.join(run, "export-01/report.json")), authored = read(path.join(run, "save-01/report.json"));
assert.equal(exported.status, "PASS"); assert.equal(authored.status, "PASS");
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const active = authored.authored.settings.runtimeUILayoutProfiles.profiles.renpy;
const rgb = c => `rgb(${[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).join(", ")})`;
const pages = [
  ["preferences", "settings", "renpy-menu-settings", ".settings-renpy", "settings_group"],
  ["save_load", "save_load", "renpy-menu-save-load", ".save-grid", "save_grid"],
  ["history", "history", "renpy-menu-history", ".history-list", "history_list"],
  ["about", "about", "renpy-menu-about", ".about-card", "about_panel"],
  ["help", "help", "renpy-menu-help", ".help-card", "help_panel"],
];
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], matrix: [], launches: [],
  screenshots: [], pageErrors: [], error: null, productChanges: 0, realModelRequests: 0,
  scope: "ACTUAL_INSTALLED_LIBRARY_PLAYER_AUTHORED_MENU_CONSUMPTION_NOT_STANDALONE_SETUP_OR_ANDROID",
  libraryImport: "Controlled real public native command, not a native file picker",
  source: { path: exported.cartridge.path, sha256: exported.cartridge.sha256 },
  untested: ["gallery unavailable in this fixture", "ordinary/choice/quickbar author workflow",
    "all four states of all six roles", "physical4K display", "complete motion/interruption"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let s;
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function measure(id, content, component, role) {
  await settleRuntime(s.page);
  const n = s.page.locator(content); await n.waitFor();
  const actual = await s.page.evaluate(({ content, title }) => {
    const host = document.querySelector(title ? ".renpy-title-view" : "[data-renpy-menu-frame]");
    const nav = host?.querySelector(title ? ".renpy-title-navigation" : ".renpy-menu-navigation");
    const p = document.querySelector(content);
    if (!host || !nav || !p) throw Error("Real player page missing");
    return { background: getComputedStyle(p).backgroundColor,
      overflow: document.documentElement.scrollWidth - innerWidth, panelOverflow: p.scrollWidth - p.clientWidth,
      viewport: { width: innerWidth, height: innerHeight }, host: host.getBoundingClientRect().toJSON(),
      buttons: [...nav.querySelectorAll("button")].map(b => {
        const r = b.getBoundingClientRect();
        return { label: b.textContent, rect: r.toJSON(), disabled: b.disabled,
          hit: b.disabled || b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
          clipped: b.scrollWidth > b.clientWidth + 1, color: getComputedStyle(b).color,
          state: b.dataset.renpyRoleState, custom: b.dataset.renpyRoleCustom };
      }) };
  }, { content, title: id === "title" });
  const expected = active.screens.find(p => p.screen_id === id).components.find(c => c.component_id === component);
  assert.equal(actual.background, rgb(expected.style.backgroundColor));
  assert(actual.overflow <= 1 && actual.panelOverflow <= 1 && actual.buttons.length > 0);
  for (const b of actual.buttons) {
    const r = b.rect;
    assert(b.hit && !b.clipped && r.width > 0 && r.height > 0
      && r.left >= -1 && r.top >= -1 && r.right <= actual.viewport.width + 1 && r.bottom <= actual.viewport.height + 1,
    JSON.stringify(b));
    assert.equal(b.custom, "true");
    assert.equal(b.color, rgb(active.renpy.shared.buttonRoles[role].states[b.state || "normal"].textColor),
      `${id}/${b.label}/${b.state}`);
  }
  for (let i = 1; i < actual.buttons.length; i++)
    assert(actual.buttons[i - 1].rect.bottom <= actual.buttons[i].rect.top + 1);
  return actual;
}
(async () => {
  await check("Actual installed Player loads unchanged exported bytes, not an author iframe or rewritten cartridge", async () => {
    s = new InstalledRuntimeSession({ prep, fixture, cartridges: [{ ...exported.cartridge, layout: "renpy" }],
      out, report, save, installId: "qa_layout_author_player_20261019" });
    await s.start("renpy", false);
    assert.equal(sha(s.launch.library.record.cartridgePath), exported.cartridge.sha256);
    return { executable: s.exe, sha256: sha(s.exe), librarySource: s.launch.library,
      nativeFilePickerClaim: false };
  });
  await check("Six authored pages and normal/selected role colors are consumed across12 actual desktop combinations", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }; await s.viewport(v); await s.page.mouse.move(0, 0);
        const row = { viewport: v, status: "RUNNING", pages: [] }; report.matrix.push(row); save();
        row.pages.push({ id: "title", actual: await measure("title", ".main-menu-title-hero-background", "title_hero", "title_action") });
        await s.page.getByTestId("open-settings").click(); await s.ready("settings");
        for (const [id, screen, testId, content, component] of pages) {
          await s.page.getByTestId(testId).click(); await s.ready(screen); await s.page.mouse.move(0, 0);
          row.pages.push({ id, actual: await measure(id, content, component, "page_navigation") }); save();
        }
        const gallery = s.page.getByTestId("renpy-menu-gallery");
        assert.equal(await gallery.count(), 0, "Fixture has no gallery; do not force a hidden route");
        await s.shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}-authored-help`);
        await s.page.getByTestId("renpy-menu-return").click(); await s.ready("title_menu");
        row.status = "PASS"; save();
        console.log(`PASS ${width}x${height} dpr${dpr} reduced=${reduced}`);
      }
    assert.equal(report.matrix.length, 12);
    assert(report.matrix.every(r => r.status === "PASS" && r.pages.length === 6));
    return { combinations: 12, actualPageConsumptions: 72, gallery: "NOT_AVAILABLE_IN_FIXTURE",
      otherRoleStates: "NOT_RUN", screenshotOnlyClaim: false };
  });
  assert.deepEqual(report.pageErrors, []); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  if (s) try { await s.stop(); }
  catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    matrix: report.matrix.length, error: report.error, out }));
});
