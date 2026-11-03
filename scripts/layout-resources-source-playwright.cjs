"use strict";
// Source browser acceptance: real toolbar/navigation, backend, downloads and ZIP bytes.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { root, sources, sha, verifyZip } = require("./layout-resources-source-test.cjs");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { captureSourceBrowser } = require("./lib/source-browser-capture.cjs");
const isolation = resolveAcceptancePaths(), smoke = process.argv.includes("--smoke");
const prep = JSON.parse(fs.readFileSync(path.join(root, "output/layout-resources-source-20261020-01/preparation.json")));
assert.equal(path.resolve(isolation.input), path.resolve(prep.input));
assert.equal(sha(fs.readFileSync(isolation.input)), prep.inputSha256);
const report = { status: "RUNNING", at: new Date().toISOString(), isolation, cases: [], modelRequests: 0,
  sources: sources.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  testSha256: sha(fs.readFileSync(__filename)),
  tools: ["scripts/layout-resources-source-test.cjs", "scripts/lib/source-browser-capture.cjs"]
    .map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))) })),
  scope: "Source Chromium, real isolated backend and toolbar downloads; NOT native Dev/Release or standalone export" };
let browser, host;
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const p = useProjectStore.getState(), g = useEditorStore.getState();
    return { id: p.projectId, profiles: p.settings.runtimeUILayoutProfiles, layout: p.settings.runtimeUILayout,
      assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
}
function check(item, name, fn) {
  try { fn(); item.checks.push({ name, status: "PASS" }); }
  catch (e) { item.checks.push({ name, status: "FAILED", error: String(e.stack || e) }); }
}
async function closePublish(page) {
  const close = page.getByRole("button", { name: "关闭发布与打包", exact: true });
  if (await close.isVisible()) { await close.click(); await settleEditor(page); }
}
async function switchType(page, type) {
  await closePublish(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const button = page.locator(`.runtime-layout-type-switch [data-layout-type-option="${type}"]:visible`);
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]:visible`).waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await settleEditor(page);
  const geometry = await page.locator(".runtime-layout-type-switch:visible").evaluate(group => {
    const buttons = [...group.querySelectorAll("button")].map(n => {
      const r = n.getBoundingClientRect();
      return { type: n.dataset.layoutTypeOption, rect: r.toJSON(),
        hit: n.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { buttons, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.equal(geometry.buttons.length, 2); assert(geometry.overflow <= 1);
  for (const b of geometry.buttons) {
    assert(b.hit && b.rect.width > 0 && b.rect.height > 0 && b.rect.left >= 0 && b.rect.top >= 0);
    const viewport = page.viewportSize(); assert(b.rect.right <= viewport.width && b.rect.bottom <= viewport.height);
  }
  const [first, second] = geometry.buttons;
  assert(first.rect.right <= second.rect.left + 1 || second.rect.right <= first.rect.left + 1);
  return geometry;
}
async function publish(page, item, type, suffix = "") {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.locator(".cartridge-export-panel").waitFor();
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warn = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warn.isVisible()) await warn.click();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await confirm.isVisible()) await confirm.check();
  const target = page.locator('[data-help-key="package.export"]:visible');
  await target.scrollIntoViewIfNeeded(); await target.click({ trial: true });
  const downloadPromise = page.waitForEvent("download");
  await target.click(); const download = await downloadPromise;
  const file = path.join(isolation.output, `${item.key}-${type}${suffix}.vncart`);
  await download.saveAs(file); const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const state = await snapshot(page);
  assert.equal(layout.layout_type || "agentvn", type); assert.equal(layout.name, state.profiles.profiles[type].name);
  assert.equal(manifest.game_id, isolation.fixtureProjectId);
  assert.equal(manifest.shell.background, "qa-res-shell-protected"); assert(!zip.file("project.json"));
  assert(!layout.runtimeUILayoutProfiles && !layout.profiles);
  const artifact = { path: file, sha256: sha(bytes), bytes: bytes.length,
    generatedAt: fs.statSync(file).mtime.toISOString(), type, actualIds: manifest.assets.map(a => a.asset_id),
    scriptSha256: sha(await zip.file("script.json").async("nodebuffer")) };
  item.cartridges.push(artifact);
  check(item, `${type}-minimal-manifest-and-real-ZIP-bytes`, () => {});
  try {
    artifact.dependencies = await verifyZip(bytes, type, prep.resources);
  } catch (e) {
    item.checks[item.checks.length - 1] = { name: `${type}-minimal-manifest-and-real-ZIP-bytes`,
      status: "FAILED", error: String(e.stack || e) };
  }
  return artifact;
}
async function portable(page, item) {
  await closePublish(page); await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const before = await snapshot(page), pending = page.waitForEvent("download");
  await page.locator('[data-help-key="toolbar.saveProject"]').click();
  const download = await pending, file = path.join(isolation.output, `${item.key}.vnproj`);
  await download.saveAs(file);
  const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, before.profiles);
  assert.equal(project.asset_manifest.length, 7);
  for (const r of prep.resources) {
    const asset = project.asset_manifest.find(a => a.asset_id === r.id); assert(asset);
    assert.equal(sha(await zip.file(asset.metadata.project_path).async("nodebuffer")), r.sha256);
  }
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  await page.reload(); await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
    .some(n => n instanceof HTMLInputElement && !n.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(file);
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const after = await snapshot(page);
  assert.deepEqual(after.profiles, before.profiles); assert.equal(after.assets.length, 7);
  assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
  item.portable = { path: file, sha256: sha(bytes), bytes: bytes.length, resources: 7, reimported: true };
}
(async () => {
  host = await startEditorAcceptance(isolation.output);
  fs.copyFileSync(__filename, path.join(isolation.output, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  report.service = { url: host.url, backendUrl: host.backendUrl, backendPid: host.backendPid,
    frontendPid: host.server.pid, runId: host.server.runId };
  browser = await chromium.launch();
  for (const [width, height] of smoke ? desktopViewports.slice(0, 1) : desktopViewports)
    for (const dpr of smoke ? [1] : [1, 2]) for (const reduced of smoke ? [false] : [false, true]) {
      const item = { key: `${width}-dpr${dpr}-${reduced ? "reduce" : "normal"}`, width, height, dpr, reduced,
        status: "RUNNING", checks: [], cartridges: [], geometry: [], pageErrors: [] }; report.cases.push(item);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference", acceptDownloads: true });
      const page = await context.newPage(); page.setDefaultTimeout(45000);
      page.on("pageerror", e => item.pageErrors.push(String(e)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelRequests++; return route.abort();
      });
      try {
        await host.open(page); await settleEditor(page);
        const before = await snapshot(page);
        for (const type of ["agentvn", "renpy"]) {
          item.geometry.push({ type, ...await switchType(page, type) });
          const after = await snapshot(page);
          assert.deepEqual(after.profiles.profiles, before.profiles.profiles);
          assert.deepEqual(after.assets, before.assets); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
          item.checks.push({ name: `${type}-real-switch-hit-geometry-and-source-unchanged`, status: "PASS" });
          await publish(page, item, type);
        }
        assert.equal(item.cartridges[0].scriptSha256, item.cartridges[1].scriptSha256);
        await portable(page, item); item.checks.push({ name: "portable-seven-original-assets-both-profiles-and-real-reimport", status: "PASS" });
        await switchType(page, "agentvn");
        item.reimportExport = await publish(page, item, "agentvn", "-reimport");
      } catch (e) { item.error = String(e.stack || e); }
      finally {
        try {
          item.screenshot = await captureSourceBrowser(page, path.join(isolation.output, `${item.key}.png`),
            { width, height, dpr, reduced });
          item.checks.push({ name: "actual-viewport-DPR-PNG-and-media-match", status: "PASS" });
        } catch (e) { item.captureError = String(e.stack || e); }
        item.status = !item.error && !item.captureError && item.checks.length >= 7
          && item.checks.every(c => c.status === "PASS") && item.pageErrors.length === 0 ? "PASS" : "FAILED";
        await context.close();
        fs.writeFileSync(path.join(isolation.output, "progress.json"), JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ key: item.key, status: item.status, error: item.error,
          failed: item.checks.filter(c => c.status === "FAILED").map(c => c.name) }));
      }
    }
  assert.equal(report.cases.length, smoke ? 1 : 12); assert.equal(report.modelRequests, 0);
  for (const s of report.sources) assert.equal(sha(fs.readFileSync(path.join(root, s.file))), s.sha256, "Product changed during test");
  report.status = report.cases.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await host?.stop();
  const responds = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
  report.cleanup = { frontendResponds: host ? await responds(host.url) : false,
    backendResponds: host ? await responds(`${host.backendUrl}/api/health`) : false };
  report.cleanup.status = !report.cleanup.frontendResponds && !report.cleanup.backendResponds ? "PASS" : "FAILED";
  if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: isolation.output }));
});
