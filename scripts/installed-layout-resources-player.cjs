"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { InstalledRuntimeSession, sha } = require("./lib/installed-runtime-session.cjs");
const { sha256, settleRuntime } = require("./lib/installed-acceptance.cjs");
const run = "D:/AgentVN/output/installed-layout-resources-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const out = process.argv[2]; assert(out && path.dirname(path.resolve(out)) === path.resolve(run) && !fs.existsSync(out));
const prep = read(path.join(run, "preparation.json")), fixture = read(path.join(run, "fixtures.json"));
const source = path.join(run, "export-02/report.json"), exported = read(source);
// Do not turn the retained export failure into PASS. This only tests independent
// consumption of the preserved valid active/protected resources.
assert.equal(exported.status, "FAILED"); assert.equal(exported.error, null); assert.equal(exported.cartridges.length, 2);
assert(exported.checks.filter(c => c.name.includes("real UI game export")).every(c => c.status === "PASS"));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), path.resolve(run)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], matrix: [], screenshots: [],
  launches: [], pageErrors: [], productChanges: 0, realModelRequests: 0, error: null,
  source: { path: source, sha256: sha(source), originalStatus: exported.status },
  scope: "ACTUAL_INSTALLED_PLAYER_LIBRARY_CONSUMPTION_NOT_STANDALONE_WINDOWS_OR_ANDROID; no product repair" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
report.tools = ["scripts/installed-layout-resources-player.cjs", "scripts/lib/installed-runtime-session.cjs",
  "scripts/lib/installed-webview-capture.cjs"].map(p => ({ path: path.resolve(p), sha256: sha(p) }));
let s;
async function check(name, body) {
  const row = { name, layout: s.layout, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await body(); row.status = "PASS"; console.log(`PASS ${s.layout} ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function actualBytes(locator, background = false) {
  const item = await locator.evaluate(async (node, background) => {
    const src = background
      ? getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]
      : node.currentSrc || node.src;
    if (!src) throw new Error("Actual displayed resource URL missing");
    const response = await fetch(src); if (!response.ok) throw new Error(`Resource HTTP ${response.status}`);
    const bytes = [...new Uint8Array(await response.arrayBuffer())];
    return { sourceKind: src.split(":")[0], bytes };
  }, background);
  return { sha256: sha256(Buffer.from(item.bytes)), bytes: item.bytes.length, sourceKind: item.sourceKind };
}
(async () => {
  for (const type of ["agentvn", "renpy"]) {
    s = new InstalledRuntimeSession({ prep, fixture,
      cartridges: exported.cartridges.map(c => ({ ...c, layout: c.type })), out, report, save,
      installId: `qa_layout_res_${type}_20261018` });
    await s.start(type, false);
    const expectedHero = fixture.resources.find(r => r.role === `${type === "agentvn" ? "agent" : "renpy"}-only`);
    await check("Active layout title image actually decoded from this cartridge and has original bytes", async () => {
      const hero = s.page.locator(".main-menu-title-hero-background:visible").first();
      await hero.waitFor();
      const bytes = await actualBytes(hero, true); assert.equal(bytes.sha256, expectedHero.sha256);
      return { id: expectedHero.id, ...bytes };
    });
    await check("Twelve title WebView combinations retain active artwork and reachable actual navigation", async () => {
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2])
        for (const reduced of [false, true]) {
          await s.viewport({ width, height, dpr, reduced }); await settleRuntime(s.page);
          const start = s.page.getByTestId("start-new-game");
          await start.click({ trial: true }); await start.focus();
          const geometry = await start.evaluate(node => {
            const r = node.getBoundingClientRect();
            return { rect: r.toJSON(), hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
              focused: document.activeElement === node, clipped: node.scrollWidth > node.clientWidth + 1,
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(geometry.hit && geometry.focused && !geometry.clipped && geometry.overflow <= 1
            && geometry.rect.x >= -1 && geometry.rect.y >= -1 && geometry.rect.right <= width + 1 && geometry.rect.bottom <= height + 1);
          const image = await actualBytes(s.page.locator(".main-menu-title-hero-background:visible").first(), true);
          assert.equal(image.sha256, expectedHero.sha256);
          report.matrix.push({ layout: type, ...s.expected, status: "PASS", geometry, actualArtwork: image }); save();
          await s.shot(`title-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
        }
      return { combinations: 12, screenshotOnlyClaim: false, fullMotionClaim: false };
    });
    await s.viewport({ width: 1920, height: 1080, dpr: 1, reduced: false });
    await check("Protected story image is displayed by real engine then advances to original narration", async () => {
      await s.page.getByTestId("start-new-game").click(); await s.ready("playing");
      const image = s.page.getByTestId("focused-image"); await image.waitFor();
      await s.page.waitForFunction(() => {
        const n = document.querySelector('[data-testid="focused-image"]'); return n?.complete && n.naturalWidth > 0;
      });
      const actual = await actualBytes(image); const expected = fixture.resources.find(r => r.role === "story-protected");
      assert.equal(actual.sha256, expected.sha256);
      await s.shot("actual-story-resource");
      await s.page.getByTestId("focused-image-overlay").click(); await s.command("ui_acceptance", 1);
      assert((await s.page.locator(".dialog-box").innerText()).includes("RESOURCE_STORY"));
      return { id: expected.id, ...actual, nextScene: "ui_acceptance", nextCommand: 1 };
    });
    await s.stop(); s = null;
  }
  assert.equal(report.matrix.length, 24); assert.equal(report.checks.length, 6);
  assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  if (s) try { await s.stop(); } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, matrix: report.matrix.length, error: report.error, out }));
});
