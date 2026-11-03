"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const esbuild = require("../editor/node_modules/esbuild");
const { assetBytes } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-gui-session-20261018-01", destination = process.argv[2];
assert(destination && !fs.existsSync(destination));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const report = { status: "RUNNING", evidenceStatus: "RUNNING", productStatus: "FAILED",
  defect: "G14_GUI_CONDITIONAL_VARIANT_ASSIGNMENTS_APPLIED_UNCONDITIONALLY",
  at: new Date().toISOString(), checks: [], probes: [], screenshots: [], error: null, realModelRequests: 0,
  scope: "READ_ONLY_REAL_INSTALLED_FAILURE_CONFIRMATION_AND_FROZEN_SOURCE_MINIMIZATION_NO_PRODUCT_FIX" };
let browser;
(async () => {
  const prior = read(path.join(run, "author-01/report.json")), launch = read(path.join(run, "launch.json"));
  const fixture = read(path.join(run, "fixtures.json"));
  assert.equal(prior.status, "FAILED"); assert(prior.error.includes("30 !== 22"));
  assert.equal(prior.checks.length, 2); assert(prior.checks.every(c => c.status === "PASS"));
  assert.equal(prior.matrix.length, 12); assert(prior.matrix.every(c => c.status === "PASS"));
  report.checks.push("Original full-template real UI assertion remains FAILED, prior scan/cancel and twelve combinations retained");
  const candidate = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
  const sourceFile = "D:/AgentVN/shared/cartridge/renpyGui.ts";
  const declared = candidate.source.find(f => path.resolve(f.path).toLowerCase() === path.resolve(sourceFile).toLowerCase());
  assert(declared); assert.equal(sha(fs.readFileSync(sourceFile)), declared.sha256);
  const loaded = { exports: {} };
  const code = esbuild.buildSync({ stdin: { contents: 'export {parseRenpyGUIParameters} from "./shared/cartridge/renpyGui";',
    loader: "ts", resolveDir: "D:/AgentVN" }, platform: "node", format: "cjs", bundle: true, write: false, logLevel: "silent" }).outputFiles[0].text;
  new Function("module", "exports", "require", code)(loaded, loaded.exports, require);
  const base = "define gui.interface_text_size = 22\n";
  for (const [name, source, expected] of [
    ["unconditional-desktop-positive-control", base, 22],
    ["unconditional-later-assignment-control", base + "define gui.interface_text_size = 30\n", 30],
    ["phone-conditional-must-not-overwrite-desktop", base + 'init python:\n    if renpy.variant("small"):\n        gui.interface_text_size = 30\n', 22],
    ["statically-false-branch-must-not-overwrite", base + "init python:\n    if False:\n        gui.interface_text_size = 30\n", 22],
  ]) {
    const result = loaded.exports.parseRenpyGUIParameters(source);
    report.probes.push({ name, source, expected, observed: result.values.shared?.fontSize,
      status: result.values.shared?.fontSize === expected ? "PASS" : "FAILED", result });
  }
  assert.equal(report.probes.filter(p => p.status === "FAILED").length, 2);
  report.checks.push("Deterministic source controls isolate loss of Python/variant block scope, independently of viewport/store");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  const current = await page.evaluate(() => {
    const s = window.__AGENTVN_PROJECT_STORE__.getState();
    return { id: s.projectId, settings: s.settings, assets: s.assetManifest,
      coverage: document.querySelector('[data-testid="renpy-font-coverage-report"]')?.textContent };
  });
  assert.equal(current.id, fixture.projectId);
  const values = current.settings.runtimeUILayout.renpy;
  assert.equal(values.shared.fontSize, 30); assert.equal(values.shared.spacing, 20); assert.equal(values.save_load.saveColumns, 2);
  report.actualLayoutValues = { actual: { fontSize: 30, spacing: 20, saveColumns: 2 },
    desktopTemplate: { fontSize: 22, spacing: 4, saveColumns: 3 }, devicePreviewNotCause: true };
  const saved = await (await fetch(`http://127.0.0.1:8278/api/project/projects/${fixture.projectId}`)).json();
  assert(saved.ok && saved.data.project_id === fixture.projectId);
  assert.equal(saved.data.editor_settings.runtimeUILayout.renpy.shared.fontSize, 30);
  report.persistedProject = { projectId: saved.data.project_id, values: saved.data.editor_settings.runtimeUILayout.renpy };
  report.checks.push("Independent live installed store and per-project backend prove wrong values really saved, not just preview scaling");
  assert.equal(current.assets.length, 25); report.assetProofs = [];
  for (const a of current.assets) {
    const source = a.metadata.tags.find(t => t.startsWith("renpy_gui_path:")).slice("renpy_gui_path:".length);
    const relative = source.slice("官方模板 中文/game/".length);
    const actual = sha(await assetBytes(8278, a));
    assert.equal(actual, fixture.officialFiles.find(f => f.relative === relative).sha256);
    report.assetProofs.push({ id: a.asset_id, relative, sha256: actual });
  }
  assert(current.coverage.includes("项目字符存在缺字") && current.coverage.includes("回退到系统字体"));
  report.fontCoverage = current.coverage;
  report.checks.push("All 25 authentic resource bytes and visible CJK missing-glyph/fallback diagnostic independently pass");
  const cdp = await page.context().newCDPSession(page);
  report.actualBeforeEmulation = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  report.screenshots.push(await captureInstalledWebview(page, cdp, destination.replace(/\.json$/, ".png"),
    { width: 1920, height: 1080, dpr: 1, reduced: false }));
  report.executable = { path: path.join(launch.installRoot, "agentvn-editor.exe"), sha256: launch.executableSha256 };
  assert.equal(sha(fs.readFileSync(report.executable.path)), report.executable.sha256);
  report.source = { path: sourceFile, sha256: declared.sha256 };
  report.cause = "parseRenpyGUIParameters strips indentation and accepts gui.* assignments without conditional/block ownership; later phone variants overwrite desktop values";
  report.impact = "Official default import saves fontSize=30 instead of22, spacing=20 instead of4, saveColumns=2 instead of3. Correct-default downstream acceptance remains BLOCKED. No user project touched.";
  report.status = "FAILED"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    checks: report.checks.length, probes: report.probes.length, error: report.error, destination }, null, 2));
});
