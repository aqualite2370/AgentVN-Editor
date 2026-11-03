"use strict";
// Synthetic archives exercise the acceptance guard only: these are not built,
// signed, installed or run as game APKs.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const sharp = require("../GameCli_framework/node_modules/sharp");
const { validateDefaultTitleApk, measureAndroidDefaultTitle } = require("./lib/android-default-title-flow.cjs");
assert(process.argv[2], "Explicit isolated default fixture report required");
const fixtureFile = path.resolve(process.argv[2]), fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
const root = path.resolve(__dirname, ".."), out = path.join(root, "output/default-title-apk-guard-tests",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "Synthetic evidence-guard unit tests, not APK build or device acceptance", cases: [] };
const mod = { exports: {} };
new Function("module", "exports", buildSync({ stdin: { resolveDir: root, loader: "ts",
  contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";' },
  bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text)(mod, mod.exports);
async function test(name, run) {
  const row = { name, status: "RUNNING" }; report.cases.push(row);
  try { await run(); row.status = "PASS"; } catch (error) { row.status = "FAILED"; throw error; }
}
(async () => {
  const layout = mod.exports.getDefaultUISkinLayout();
  for (const kind of ["default", "renpy", "hero-color", "ink-token", "wrong-project", "missing-layout", "ambiguous-layout"]) {
    const zip = new JSZip(), changed = structuredClone(layout);
    if (kind === "renpy") changed.layout_type = "renpy";
    if (kind === "ink-token") changed.tokens.colorInk = "#ffc278";
    if (kind === "hero-color") changed.screens.find(s => s.screen_id === "title").components
      .find(c => c.component_type === "main_menu_hero").style = { color: "#f6f8ff" };
    zip.file("assets/embedded-cartridge/manifest.json", JSON.stringify({ game_id: kind === "wrong-project" ? "other" : fixture.projectId }));
    if (kind !== "missing-layout") zip.file("assets/embedded-cartridge/ui/layout.json", JSON.stringify(changed));
    if (kind === "ambiguous-layout") zip.file("duplicate/embedded-cartridge/ui/layout.json", JSON.stringify(changed));
    const file = path.join(out, `${kind}.synthetic.apk`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
    await test(`${kind} archive ${kind === "default" ? "accepted" : "rejected"}`, async () => {
      if (kind === "default") assert.equal((await validateDefaultTitleApk(file, fixtureFile)).layoutType, "agentvn");
      else await assert.rejects(validateDefaultTitleApk(file, fixtureFile));
    });
  }
  const rect = { width: 800, height: 100, left: 100, top: 100, right: 900, bottom: 200 };
  const sample = { text: fixture.title, color: "rgb(246, 248, 255)", viewport: { width: 1920, height: 1080, dpr: 1 },
    rect, glyphs: [rect], overflow: 0, renpyCount: 0 };
  const image = path.join(out, "synthetic-dark-background.png");
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 11, g: 29, b: 46 } } }).png().toFile(image);
  const cdp = { evaluate: async () => structuredClone(sample) };
  await test("stable physical 1080p screenshot measurement", async () => {
    assert((await measureAndroidDefaultTitle(cdp, image, fixture.title)).contrast > 3);
  });
  await test("old dark inherited color rejected", async () => {
    await assert.rejects(measureAndroidDefaultTitle({ evaluate: async () => ({ ...sample, color: "rgb(11, 29, 46)" }) }, image, fixture.title));
  });
  await test("changing measurements rejected", async () => {
    let n = 0;
    await assert.rejects(measureAndroidDefaultTitle({ evaluate: async () => ({ ...sample, fontSize: `${n++}px` }) }, image, fixture.title));
  });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out, error: report.error }));
  });
