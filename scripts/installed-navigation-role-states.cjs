"use strict";
// The missing natural navigation state: settings, entered from playing,
// returns to the live game through resumeActiveGame and its real launch cover.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-navigation-role-states-20261019-01";
const work = "F:/AgentVN/QA/Navigation-Role-States-20261019-01";
const old = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), fixture = read(`${old}/fixtures.json`);
const exported = read(`${old}/export-01/report.json`);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
assert.equal(exported.status, "PASS"); assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [], pageErrors: [],
  source: exported.cartridge, scope: "NATURAL_AUTHORED_NAVIGATION_DISABLE_DURING_RETURN_TO_PLAYING_IN_INSTALLED_LIBRARY",
  productChanges: 0, newBuilds: 0, modelRequests: 0, fullRoleGeometryClaim: false, standaloneOrAndroidClaim: false };
const save = () => fs.writeFileSync(`${base}/player.json`, JSON.stringify(report, null, 2));
const rgb = h => `rgb(${[1,3,5].map(i => parseInt(h.slice(i,i+2),16)).join(", ")})`;
let s;
async function beginObservation() {
  await s.page.evaluate(() => {
    const o = { frames: [], inputs: [], active: true, at: performance.now() };
    window.__qaNavigationRoles = o;
    o.input = e => { o.inputs.push({ at: performance.now(), type: e.type, trusted: e.isTrusted,
      testId: e.target.closest("button")?.dataset.testid }); };
    document.addEventListener("click", o.input, true);
    function frame() {
      if (!o.active) return;
      const controls = [...document.querySelectorAll(".renpy-menu-navigation-action")].map(n => {
        const c = getComputedStyle(n), r = n.getBoundingClientRect();
        const chain = [];
        for (let a = n; a instanceof Element; a = a.parentElement) {
          const p = getComputedStyle(a);
          chain.push({ opacity: +p.opacity, visibility: p.visibility, display: p.display, inert: !!a.inert });
        }
        return { id: n.dataset.testid, disabled: n.disabled, state: n.dataset.renpyRoleState, color: c.color,
          rect: r.toJSON(), visible: n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), chain };
      });
      const blackout = document.querySelector('[data-testid="game-launch-blackout"]');
      o.frames.push({ at: performance.now(), blackoutOpacity: blackout ? +getComputedStyle(blackout).opacity : 0, controls });
      o.raf = requestAnimationFrame(frame);
    }
    o.raf = requestAnimationFrame(frame);
  });
}
async function endObservation() {
  return s.page.evaluate(() => {
    const o = window.__qaNavigationRoles;
    o.active = false; cancelAnimationFrame(o.raf); document.removeEventListener("click", o.input, true);
    return { at: o.at, finishedAt: performance.now(), inputs: o.inputs, frames: o.frames };
  });
}
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(exported.cartridge.path), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  report.authoredRole = layout.renpy.shared.buttonRoles.page_navigation;
  assert.equal(report.authoredRole.states.disabled.textColor, "#95b7c3"); save();
  s = new InstalledRuntimeSession({ prep, fixture, cartridges: [{ ...exported.cartridge, layout: "renpy" }],
    out: work, report, save, installId: "qa-navigation-role-states-20261019" });
  await s.start("renpy", false);
  await s.page.getByTestId("start-new-game").click(); await s.ready("playing"); await s.command("ui_acceptance", 0);
  for (const [width,height] of [[1920,1080],[2560,1440],[3840,2160]]) for (const dpr of [1,2])
    for (const reduced of [false,true]) {
      const viewport = { width,height,dpr,reduced }, cell = { viewport, status: "RUNNING", at: new Date().toISOString() };
      report.cells.push(cell); save(); await s.viewport(viewport);
      await s.openSettings();
      const back = s.page.getByTestId("renpy-menu-return");
      assert(await back.isEnabled());
      cell.before = await back.evaluate(n => {
        const r = n.getBoundingClientRect();
        return { rect: r.toJSON(), hit: n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
          overflow: document.documentElement.scrollWidth-innerWidth };
      });
      assert(cell.before.hit && cell.before.overflow <= 1);
      await s.shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}-before-return`);
      await s.page.mouse.move(0,0); await beginObservation(); await back.click();
      await s.ready("playing"); await s.command("ui_acceptance", 0);
      cell.observation = await endObservation();
      assert(cell.observation.inputs.some(e => e.trusted && e.type === "click" && e.testId === "renpy-menu-return"));
      cell.samples = cell.observation.frames.flatMap(f => f.controls.filter(n => n.id === "renpy-menu-return"
        && n.disabled && n.state === "disabled" && n.visible && f.blackoutOpacity < .95
        && n.chain.every(a => a.opacity > 0 && a.visibility === "visible" && a.display !== "none"))
        .map(n => ({ at: f.at, blackoutOpacity: f.blackoutOpacity, ...n })));
      cell.exactColorSamples = cell.samples.filter(n => n.color === rgb(report.authoredRole.states.disabled.textColor));
      // Keep the whole matrix if a color observation fails; do not weaken it.
      cell.violations = [];
      if (!cell.exactColorSamples.length) cell.violations.push("No authored disabled return color actually rendered before opaque cover");
      for (const n of cell.samples) {
        if (["x","y","width","height"].some(k => Math.abs(n.rect[k]-cell.before.rect[k]) > .2))
          cell.violations.push("Return button geometry changed while disabled");
        if (n.rect.left < -1 || n.rect.top < -1 || n.rect.right > width+1 || n.rect.bottom > height+1)
          cell.violations.push("Disabled return button leaves viewport");
      }
      cell.executed = true; cell.status = cell.violations.length ? "FAILED" : "PASS";
      cell.finishedAt = new Date().toISOString(); save();
      console.log(`${cell.status} navigation disabled ${width} dpr${dpr} reduced=${reduced} exactColor=${cell.exactColorSamples.length}`);
    }
  assert.equal(report.cells.length, 12); assert(report.cells.every(c => c.executed)); assert.deepEqual(report.pageErrors, []);
  report.status = report.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status === "FAILED") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  if (s) try { await s.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length,
    passingCells: report.cells.filter(c => c.status === "PASS").length, error: report.error }));
});
