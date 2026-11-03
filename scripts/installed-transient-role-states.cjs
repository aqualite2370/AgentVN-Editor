"use strict";
// Observe only natural user-triggered states in the frozen installed Player.
// No delayed IPC, state mutation, timing override, rewritten cartridge or DOM styling.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-transient-role-states-20261019-01";
const work = "F:/AgentVN/QA/Transient-Role-States-20261019-01";
const old = "D:/AgentVN/output/installed-layout-author-review-20261019-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const prep = read(`${base}/preparation.json`), fixture = read(`${old}/ordinary-fixtures.json`);
const exported = read(`${old}/ordinary-export-01/report.json`);
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
assert.equal(exported.status, "PASS"); assert.equal(sha(exported.cartridge.path), exported.cartridge.sha256);
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [],
  pageErrors: [], source: exported.cartridge, productChanges: 0, newBuilds: 0, modelRequests: 0,
  scope: "NATURAL_TITLE_LAUNCH_AND_EXIT_PENDING_OBSERVATION_IN_INSTALLED_LIBRARY_PLAYER",
  allRoleStatesClaim: false, standaloneOrAndroidClaim: false, coverage: {} };
const save = () => fs.writeFileSync(`${base}/player.json`, JSON.stringify(report, null, 2));
let s;
async function observe() {
  await s.page.evaluate(() => {
    const o = { frames: [], inputs: [], start: performance.now() };
    window.__qaTransientRoles = o;
    const snapshot = source => {
      const controls = [...document.querySelectorAll(
        ".renpy-title-action, .renpy-menu-navigation-action, .modal-panel button")].map(n => {
        const c = getComputedStyle(n), r = n.getBoundingClientRect();
        const chain = []; for (let p = n; p instanceof Element; p = p.parentElement) {
          const cs = getComputedStyle(p);
          chain.push({ opacity: +cs.opacity, visibility: cs.visibility, display: cs.display, inert: !!p.inert });
        }
        return { testId: n.dataset.testid || null, label: n.textContent.trim(),
          kind: n.matches(".renpy-title-action") ? "title" : n.closest(".modal-panel") ? "modal" : "navigation",
          disabled: n.disabled, busy: n.getAttribute("aria-busy"), roleState: n.dataset.renpyRoleState,
          color: c.color, background: c.backgroundColor, rect: r.toJSON(),
          visible: n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), chain };
      });
      const blackout = document.querySelector('[data-testid="game-launch-blackout"]');
      o.frames.push({ at: performance.now(), source, controls,
        blackout: blackout ? { opacity: +getComputedStyle(blackout).opacity,
          rect: blackout.getBoundingClientRect().toJSON() } : null });
      if (o.frames.length > 4000) o.frames.shift();
    };
    o.input = e => { o.inputs.push({ type: e.type, trusted: e.isTrusted, at: performance.now(),
      testId: e.target.closest("button")?.dataset.testid || null }); };
    document.addEventListener("pointerdown", o.input, true);
    document.addEventListener("click", o.input, true);
    const frame = () => { snapshot("raf"); o.raf = requestAnimationFrame(frame); };
    o.snapshot = snapshot; snapshot("initial"); o.raf = requestAnimationFrame(frame);
  });
}
async function collected() {
  return s.page.evaluate(() => {
    const o = window.__qaTransientRoles; o.snapshot("collected");
    return { start: o.start, end: performance.now(), frames: o.frames, inputs: o.inputs };
  });
}
function disabledSamples(record, kind) {
  return record.frames.flatMap(f => f.controls.filter(c => c.kind === kind && c.disabled && c.visible
    && c.chain.every(p => p.opacity > 0 && p.display !== "none" && p.visibility === "visible"))
    .map(c => ({ at: f.at, blackout: f.blackout, ...c })));
}
async function snapshotControls() {
  return s.page.locator(".modal-panel").evaluate(n => {
    const r = n.getBoundingClientRect();
    return { rect: r.toJSON(), width: innerWidth, height: innerHeight,
      buttons: [...n.querySelectorAll("button")].map(b => {
        const r = b.getBoundingClientRect(); const c = getComputedStyle(b);
        return { testId: b.dataset.testid || null, label: b.textContent.trim(), rect: r.toJSON(), color: c.color,
          scrollWidth: b.scrollWidth, clientWidth: b.clientWidth, disabled: b.disabled,
          hit: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      }), overflow: document.documentElement.scrollWidth - innerWidth };
  });
}
(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(exported.cartridge.path), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  report.authoredRoles = { title: layout.renpy.shared.buttonRoles.title_action,
    modal: layout.renpy.shared.buttonRoles.modal_action };
  save();
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const v = { width, height, dpr, reduced }, id = `${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`;
      const cell = { viewport: v, status: "RUNNING", at: new Date().toISOString() };
      report.cells.push(cell); save();
      s = new InstalledRuntimeSession({ prep, fixture, cartridges: [{ ...exported.cartridge, layout: "renpy" }],
        out: work, report, save, installId: `qa-transient-roles-${width}-${dpr}-${reduced ? "r" : "n"}` });
      await s.start("renpy", false); await s.viewport(v);
      await s.setAuto(true, true);
      await s.page.mouse.move(0, 0); await observe();
      await s.page.getByTestId("start-new-game").click();
      await s.ready("playing"); await s.command("ui_acceptance", 0);
      cell.launch = await collected();
      cell.titleDisabled = disabledSamples(cell.launch, "title");
      assert(cell.launch.inputs.some(i => i.type === "click" && i.trusted && i.testId === "start-new-game"));
      await s.page.keyboard.press("Escape"); await s.ready("main_menu");
      await s.page.getByTestId("open-exit-confirmation").click();
      await s.page.getByRole("dialog", { name: "退出游戏？", exact: true }).waitFor();
      await s.page.mouse.move(0, 0);
      cell.modal = await snapshotControls();
      assert(cell.modal.overflow <= 1);
      const mr = cell.modal.rect;
      assert(mr.left >= -1 && mr.top >= -1 && mr.right <= width + 1 && mr.bottom <= height + 1);
      for (const b of cell.modal.buttons) assert(b.hit && b.rect.width > 0 && b.rect.height > 0);
      await s.shot(`${id}-before-save-exit`);
      await observe();
      // Collect frames as soon as the genuine save makes the UI pending.
      // The window may close before a subsequent frame, which is a coverage
      // gap, not evidence that the product never disabled its buttons.
      const collection = s.page.waitForFunction(() =>
        window.__qaTransientRoles.frames.some(f =>
          f.controls.some(c => c.kind === "modal" && c.disabled)), null, { timeout: 10000 })
        .then(() => collected()).then(x => ({ status: "CAPTURED", data: x }),
          e => ({ status: "NOT_CAPTURED_BEFORE_WINDOW_CLOSED", error: String(e) }));
      const before = s.files();
      await s.page.getByTestId("confirm-exit-game").click().catch(e => {
        if (!s.page.isClosed()) throw e; cell.exitClickClosedPage = String(e);
      });
      cell.exit = await collection;
      if (cell.exit.data) cell.modalDisabled = disabledSamples(cell.exit.data, "modal");
      await s.stop(true);
      cell.saves = s.files();
      assert(cell.saves.length > 0);
      cell.newWrites = cell.saves.filter(f => !before.some(b => b.name === f.name && b.sha256 === f.sha256));
      assert(cell.newWrites.length > 0, "Native exit must really write a fresh autosave");
      cell.savedState = cell.newWrites.map(f => ({ path: f.path, sha256: f.sha256, data: read(f.path) }));
      cell.executed = true; cell.status = "PASS"; cell.finishedAt = new Date().toISOString(); save();
      console.log(`PASS natural transient observation ${id} title=${cell.titleDisabled.length} modal=${cell.modalDisabled?.length || 0}`);
      s = null;
    }
  assert.equal(report.cells.length, 12); assert(report.cells.every(c => c.executed));
  assert.deepEqual(report.pageErrors, []);
  report.coverage = {
    titleDisabledObserved: report.cells.filter(c => c.titleDisabled.length > 0).length,
    modalDisabledObserved: report.cells.filter(c => c.modalDisabled?.length > 0).length,
    limitation: "Rendered disabled frames and colors must be independently reviewed; a busy DOM flag alone is not final-state visual coverage.",
    completeSixRoleCoverage: false };
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  if (s) try { await s.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length, coverage: report.coverage, error: report.error }));
});
