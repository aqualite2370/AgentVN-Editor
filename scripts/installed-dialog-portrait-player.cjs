"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { validatePortrait } = require("./installed-dialog-portrait-oracle.cjs");
const base = process.env.AGENTVN_PORTRAIT_RUN || "D:/AgentVN/output/installed-dialog-portrait-20261019-01";
const work = process.env.AGENTVN_PORTRAIT_WORK || "F:/AgentVN/QA/Dialog-Portrait-20261019-01";
assert.equal(path.dirname(path.resolve(base)), path.resolve("D:/AgentVN/output"));
assert.equal(path.dirname(path.resolve(work)), path.resolve("F:/AgentVN/QA"));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sourceBase = process.env.AGENTVN_PORTRAIT_AUTHOR_RUN || base;
const fixtureFile = `${sourceBase}/fixtures.json`, editorFile = `${sourceBase}/editor-01.json`;
const prep = read(`${base}/preparation.json`), fixture = read(fixtureFile), editor = read(editorFile);
assert.equal(editor.status, "PASS"); assert.equal(editor.cartridges.length, 2); assert(!fs.existsSync(`${base}/player-01.json`));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(base));
const report = { status: "RUNNING", at: new Date().toISOString(), cells: [], launches: [], screenshots: [], pageErrors: [],
  scope: "REAL_INSTALLED_LIBRARY_PLAYER_AUTHOR_UI_EXPORTED_DIALOGUE_PORTRAIT; NO_GENERIC_IMAGE_SUBSTITUTE",
  authoringEvidence: { directory: sourceBase, reusedWithoutNewExport: sourceBase !== base },
  sources: [fixtureFile, fixture.input, editorFile, ...editor.cartridges.map(c => c.path)].map(p => ({ path: p, sha256: sha(p) })),
  modelRequests: 0, productChanges: 0, newBuilds: 0 };
const save = () => fs.writeFileSync(`${base}/player-01.json`, JSON.stringify(report, null, 2));
let session;
async function observe(bound) {
  const result = await session.page.evaluate(async ({ bound, expectedScene }) => {
    const d = document.querySelector(".dialog-box"), story = document.querySelector('[data-testid="game-state-playing"]');
    const images = [];
    for (const i of document.images) {
      const r = i.getBoundingClientRect(), style = getComputedStyle(i), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const item = { tag: "IMG", src: i.currentSrc || i.src, alt: i.alt, className: i.className,
        width: r.width, height: r.height, naturalWidth: i.naturalWidth, naturalHeight: i.naturalHeight,
        visible: i.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && style.opacity !== "0",
        insideViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        hit: !!hit && (hit === i || i.contains(hit)), inStory: !!i.closest('[data-testid="game-state-playing"]'),
        inDialog: !!i.closest(".dialog-box"), portraitRole: /portrait|avatar/.test(String(i.className)), rect: r.toJSON() };
      try {
        const bytes = await (await fetch(item.src)).arrayBuffer(), hash = await crypto.subtle.digest("SHA-256", bytes);
        item.sha256 = [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
      } catch (e) { item.error = String(e); }
      images.push(item);
    }
    return { boundCommand: bound && story?.getAttribute("data-current-scene-id") === expectedScene
        && Number(story?.getAttribute("data-current-command-index")) === 0 && d?.textContent.includes("PORTRAIT_BOUND"),
      dialogVisible: !!d?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      dialogDone: d?.getAttribute("data-dialog-page-done") === "true",
      scene: story?.getAttribute("data-current-scene-id"), command: story?.getAttribute("data-current-command-index"),
      text: d?.textContent, images, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      otherPrimitives: [...(story?.querySelectorAll("canvas,svg image") || [])].map(n => ({ tag: n.tagName, html: n.outerHTML.slice(0, 500) })),
      backgroundImages: [...(story?.querySelectorAll("*") || [])].map(n => ({ tag: n.tagName, className: String(n.className),
        background: getComputedStyle(n).backgroundImage })).filter(n => n.background.includes("url(")),
      dialogHtml: d?.outerHTML, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  }, { bound, expectedScene: fixture.scene });
  return result;
}
(async () => {
  save();
  for (const layout of ["agentvn", "renpy"]) {
    session = new InstalledRuntimeSession({ prep, fixture, cartridges: editor.cartridges, out: work, report, save,
      installId: `qa-dialog-portrait-${layout}-20261019` });
    await session.start(layout, false);
    await session.page.getByTestId("start-new-game").click(); await session.ready("playing");
    // These are short lines: await natural typing, not a reveal click that
    // can race completion and advance to the unbound control.
    await session.command(fixture.scene, 0);
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const viewport = { width, height, dpr, reduced };
      const cell = { name: `${layout}-${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`,
        layout, viewport, status: "RUNNING", at: new Date().toISOString() }; report.cells.push(cell); save();
      await session.viewport(viewport);
      // Two real animation frames settle resize; no fixed timing or state write.
      await session.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      cell.bound = await observe(true);
      try { cell.validation = validatePortrait(cell.bound, fixture.portrait.sha256); cell.status = "PASS"; }
      catch (e) { cell.status = "FAILED"; cell.error = String(e.message || e); }
      // Keep all failed source observations, including alternative primitives;
      // do not call CSS/canvas absent from a DOM-image count alone.
      await session.shot(`${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
      cell.finishedAt = new Date().toISOString(); save();
      console.log(`${cell.status} ${cell.name}: images=${cell.bound.images.length}, backgrounds=${cell.bound.backgroundImages.length}`);
    }
    await session.page.locator(".dialog-box").click();
    await session.command(fixture.scene, 1);
    (report.controls ||= []).push({ layout, observation: await observe(false), scope: "UNBOUND_CONTROL_DIALOGUE" }); save();
    await session.stop(); session = null;
  }
  assert.equal(report.cells.length, 24);
  report.status = report.cells.every(c => c.status === "PASS") && report.pageErrors.length === 0 ? "PASS" : "FAILED";
  if (report.status === "FAILED") process.exitCode = 1;
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (session?.page) {
    report.failureObservation = await observe(true).catch(e => ({ error: String(e) }));
    await session.shot("unexpected-failure").catch(e => { report.failureCaptureError = String(e); });
  }
})
.finally(async () => {
  try { await session?.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cells: report.cells.length, error: report.error, cleanupError: report.cleanupError }));
});
