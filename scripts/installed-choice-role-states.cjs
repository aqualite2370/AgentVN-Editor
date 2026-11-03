"use strict";
// Natural authored choice selection/rollback and transient disable states.
// No store mutation, synthetic chosen state, timing override or rewritten cartridge.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { settlePresentation } = require("./lib/installed-player-authoring.cjs");
const base = "D:/AgentVN/output/installed-choice-role-states-20261019-01", work = "F:/AgentVN/QA/Choice-Role-States-20261019-01";
const previous = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), fixture = read(`${previous}/ordinary-fixtures.json`), exported = read(`${previous}/ordinary-export-01/report.json`);
assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
assert.equal(exported.status, "PASS"); assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [], pageErrors: [],
  source: exported.cartridge, productChanges: 0, modelRequests: 0, newBuilds: 0,
  scope: "FROZEN_INSTALLED_LIBRARY_PLAYER_REAL_AUTHOR_UI_EXPORTED_STORY_CHOICE_NORMAL_HOVER_ROLLBACK_SELECTED_TRANSIENT_DISABLED",
  fullSixRoleClaim: false, fixedChoiceDisabledClaim: false, standaloneSetupOrAndroidClaim: false };
const save = () => fs.writeFileSync(`${base}/player.json`, JSON.stringify(report, null, 2));
const rgb = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
let s;
async function sample(locator) {
  return locator.evaluate(n => {
    const r = n.getBoundingClientRect(), c = getComputedStyle(n);
    const ranges = [], walker = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      ranges.push(...[...range.getClientRects()].map(r => r.toJSON()));
    }
    return { label: n.textContent.trim(), rect: r.toJSON(), color: c.color, disabled: n.disabled,
      selected: n.getAttribute("aria-current"), state: n.dataset.renpyRoleState,
      visible: n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      clipped: n.scrollWidth > n.clientWidth + 1, textRects: ranges, width: innerWidth, height: innerHeight };
  });
}
function geometry(item) {
  const r = item.rect;
  assert(item.visible && item.hit && !item.clipped && !item.horizontalOverflow && r.width > 0 && r.height > 0
    && r.left >= -1 && r.top >= -1 && r.right <= item.width + 1 && r.bottom <= item.height + 1, JSON.stringify(item));
  for (const t of item.textRects) assert(t.left >= r.left - 1 && t.top >= r.top - 1 && t.right <= r.right + 1 && t.bottom <= r.bottom + 1, JSON.stringify(item));
}
function envelope(a, b) {
  for (const k of ["x", "y", "width", "height"]) assert(Math.abs(a.rect[k] - b.rect[k]) <= .2, `${k}: ${JSON.stringify([a.rect,b.rect])}`);
}
async function startObserver() {
  await s.page.evaluate(() => {
    const o = { active: true, frames: [], startedAt: performance.now() }; window.__qaChoiceRoleObservation = o;
    function sample() {
      if (!o.active) return;
      const choices = [...document.querySelectorAll(".choice-option")].map(n => {
        const c = getComputedStyle(n), r = n.getBoundingClientRect();
        return { label: n.textContent.trim(), disabled: n.disabled, state: n.dataset.renpyRoleState, color: c.color,
          opacity: Number(c.opacity), visible: n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), rect: r.toJSON() };
      });
      o.frames.push({ at: performance.now(), choices }); if (o.frames.length > 4000) o.frames.shift();
      o.frame = requestAnimationFrame(sample);
    }
    o.frame = requestAnimationFrame(sample);
  });
}
async function stopObserver() {
  return s.page.evaluate(() => {
    const o = window.__qaChoiceRoleObservation; o.active = false; cancelAnimationFrame(o.frame);
    return { startedAt: o.startedAt, finishedAt: performance.now(), frames: o.frames };
  });
}
(async () => {
  save();
  const zip = await JSZip.loadAsync(fs.readFileSync(exported.cartridge.path));
  const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const roles = skin.renpy.player.buttonRoles.story_choice.states;
  for (const state of ["normal", "hover", "selected", "disabled"]) assert(roles[state].textColor);
  report.authoredStates = roles; save();
  s = new InstalledRuntimeSession({ prep, fixture, cartridges: [{ ...exported.cartridge, layout: "renpy" }],
    out: work, report, save, installId: "qa-choice-role-states-20261019" });
  await s.start("renpy", false);
  for (const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]) for (const dpr of [1,2]) for (const reduced of [false,true]) {
    const viewport = { width,height,dpr,reduced }, cell = { viewport, status: "RUNNING", at: new Date().toISOString(), assertions: [] };
    report.cells.push(cell); save();
    try {
      await s.viewport(viewport);
      await s.page.getByTestId("start-new-game").click(); await s.ready("playing"); await s.command("ui_acceptance",0);
      await s.page.mouse.move(0,0); await startObserver();
      await s.page.locator(".dialog-box").click();
      const chosen = s.page.getByRole("button",{ name:"选择：继续", exact:true });
      await chosen.waitFor(); await s.page.waitForFunction(() => document.querySelector(".choice-panel") &&
        [...document.querySelectorAll(".choice-option")].every(n => !n.disabled));
      await settlePresentation(s.page);
      cell.normal = await sample(chosen); geometry(cell.normal); assert.equal(cell.normal.color,rgb(roles.normal.textColor));
      await chosen.hover(); await settlePresentation(s.page);
      cell.hover = await sample(chosen); geometry(cell.hover); envelope(cell.normal,cell.hover); assert.equal(cell.hover.color,rgb(roles.hover.textColor));
      await chosen.click(); await s.command("ui_acceptance",0); await s.page.mouse.move(0,0);
      cell.transient = await stopObserver();
      await s.page.keyboard.press("PageUp");
      await s.page.locator('.choice-option[aria-current="true"]').waitFor();
      await settlePresentation(s.page);
      cell.selected = await sample(s.page.locator('.choice-option[aria-current="true"]'));
      geometry(cell.selected); envelope(cell.normal,cell.selected);
      assert.equal(cell.selected.label,"继续"); assert.equal(cell.selected.state,"selected");
      assert.equal(cell.selected.color,rgb(roles.selected.textColor));
      cell.assertions.push("NATURAL_ROLLBACK_SELECTED_COLOR", "UNCHANGED_STATE_GEOMETRY", "VISIBLE_HIT_TEXT_BOUNDS_NO_HORIZONTAL_OVERFLOW");
      const disabled = cell.transient.frames.flatMap(f => f.choices.map(c => ({at:f.at,...c}))).filter(c => c.disabled && c.visible && c.opacity > 0);
      cell.disabledSamples = disabled.length;
      if (!reduced) {
        assert(disabled.length > 0, "Normal-mode natural choice disable interval was not observed");
        assert(disabled.some(c => c.color === rgb(roles.disabled.textColor)), "No real visible disabled sample reaches its authored text color");
        cell.assertions.push("NATURAL_VISIBLE_TRANSIENT_DISABLED_COLOR");
      } else {
        cell.transientDisabledScope = "No disabled interval required by this unfixed reduced-mode choice path; no fixed-choice disabled claim";
      }
      await s.shot(`${width}x${height}-dpr${dpr}-${reduced ? "reduced":"normal"}-selected`);
      cell.executed = true; cell.status = "PASS"; cell.finishedAt = new Date().toISOString(); save();
      await s.page.keyboard.press("Escape"); await s.ready("main_menu");
      console.log(`PASS choice roles ${width}x${height} dpr${dpr} reduced=${reduced} disabledSamples=${disabled.length}`);
    } catch (e) {
      cell.status = "FAILED"; cell.error = String(e.stack || e); cell.finishedAt = new Date().toISOString(); save();
      await s.shot("failure").catch(() => {}); throw e;
    }
  }
  assert.equal(report.cells.length,12); assert(report.cells.every(c => c.executed)); assert.deepEqual(report.pageErrors,[]);
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  try { await s?.stop(); } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status:report.status, cells:report.cells.length, completed:report.cells.filter(c=>c.executed).length, error:report.error }));
});
