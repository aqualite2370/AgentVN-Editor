"use strict";
// Real top-level navigation + full official ZIP + real isolated backend.
// Store access is observation only. No mocked Tauri, model requests or writes to store.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor, select } = require("./lib/installed-acceptance.cjs");
const isolation = resolveAcceptancePaths();
const manifest = JSON.parse(fs.readFileSync(
  "F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json", "utf8"));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [], modelSubmissions: 0,
  scope: "source Chromium with isolated real backend; not installed Release or physical 4K",
  isolation, officialArchive: manifest.officialArchive };
let host, browser;
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { useEditorStore } = await import("/src/store/editorStore.ts");
    const p = useProjectStore.getState(), g = useEditorStore.getState();
    return { id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
}
async function openLayout(page) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await settleEditor(page);
  const button = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
}
async function save(page) {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() =>
    document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
}
function check(item, name, callback) {
  try { callback(); item.checks.push({ name, status: "PASS" }); }
  catch (error) { item.checks.push({ name, status: "FAILED", error: String(error.stack || error) }); }
}
(async () => {
  assert.equal(sha(fs.readFileSync(manifest.officialArchive.path)), manifest.officialArchive.sha256);
  host = await startEditorAcceptance(isolation.output);
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    backendUrl: host.backendUrl, frontendUrl: host.url, runId: host.server.runId };
  browser = await chromium.launch();
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2])
    for (const motion of ["no-preference", "reduce"]) {
      const item = { width, height, dpr, motion, checks: [], errors: [], status: "RUNNING" };
      report.cases.push(item);
      const context = await browser.newContext({ viewport: { width, height },
        deviceScaleFactor: dpr, reducedMotion: motion });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on("pageerror", error => item.errors.push(String(error)));
      await page.route(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelSubmissions++; return route.abort();
      });
      try {
        await host.open(page); await settleEditor(page); await openLayout(page);
        const baseline = await snapshot(page), dialog = page.getByTestId("renpy-gui-import-dialog");
        async function scan() {
          await page.getByTestId("renpy-gui-import-open").click();
          await dialog.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true })
            .setInputFiles(manifest.officialArchive.path);
          await dialog.locator(".renpy-gui-import-summary").waitFor();
        }
        await scan();
        item.parameters = await dialog.locator(".renpy-gui-import-row").allTextContents();
        item.issues = await dialog.locator('[aria-label="扫描问题"]').innerText();
        item.geometry = await dialog.evaluate(element => {
          const rect = element.getBoundingClientRect(), body = element.querySelector(".renpy-gui-import-body");
          const footer = element.querySelector("footer");
          return { box: rect.toJSON(), body: body.getBoundingClientRect().toJSON(),
            footer: footer.getBoundingClientRect().toJSON(),
            overflow: document.documentElement.scrollWidth - innerWidth,
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
              reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
            buttons: [...footer.querySelectorAll("button")].map(button => {
              const r = button.getBoundingClientRect();
              return { rect: r.toJSON(), hit: button.contains(document.elementFromPoint(
                r.x + r.width / 2, r.y + r.height / 2)) };
            }) };
        });
        check(item, "scan-shows-desktop-defaults-and-explicit-unimported-context", () => {
          for (const [key, value] of [["shared.fontSize", 22], ["shared.spacing", 4], ["save_load.saveColumns", 3]]) {
            const row = item.parameters.find(row => row.includes(key));
            assert(row?.includes(`资源包：${value}`), `${key}: ${row}`);
          }
          assert(item.issues.includes("unsupported_context") && item.issues.includes("gui.interface_text_size"));
        });
        // Geometry is independent of parameter correctness; retain both results.
        check(item, "dialog-boundaries-hit-targets-and-actual-display", () => {
          const g = item.geometry;
          assert.deepEqual(g.viewport, { width, height, dpr, reduced: motion === "reduce" });
          assert(g.box.left >= 0 && g.box.top >= 0 && g.box.right <= width + 1 && g.box.bottom <= height + 1);
          assert(g.body.bottom <= g.footer.top + 1 && g.overflow <= 1 && g.buttons.every(b => b.hit));
        });
        assert.equal(await dialog.locator(".renpy-gui-import-asset-row").count(), 25);
        await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
        await dialog.waitFor({ state: "detached" });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.locator(".editor-toolbar").waitFor({ state: "visible" });
        await settleEditor(page);
        assert.deepEqual(await snapshot(page), baseline, "Scanning and cancelling cannot mutate the project");
        await scan();
        for (const input of await dialog.locator(".renpy-gui-import-row input[type=checkbox]").all()) await input.check();
        await select(page, "官方模板 中文/game/gui/main_menu.png 游戏界面用途", "标题页主视觉");
        await select(page, "官方模板 中文/game/DejaVuSans.ttf 游戏界面用途", "全局界面字体");
        await dialog.locator(".renpy-gui-import-license input").check();
        await dialog.getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
        const importedPack = dialog.locator("[data-pack-id]").first();
        await importedPack.waitFor();
        await importedPack.getByRole("button", { name: "预览并选择应用", exact: true }).click();
        await dialog.getByTestId("renpy-gui-impact").waitFor();
        for (const input of await dialog.locator(".renpy-gui-import-row input[type=checkbox]").all()) {
          if (!(await input.isDisabled()) && !(await input.isChecked())) await input.check();
        }
        await select(page, "官方模板 中文/game/gui/main_menu.png 游戏界面用途", "标题页主视觉");
        await select(page, "官方模板 中文/game/DejaVuSans.ttf 游戏界面用途", "全局界面字体");
        const applyLicense = dialog.locator(".renpy-gui-import-license input");
        if (!(await applyLicense.isChecked())) await applyLicense.check();
        await dialog.getByRole("button", { name: "确认应用到当前工程", exact: true }).click();
        await dialog.waitFor({ state: "detached" }); await save(page);
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        await page.locator(".editor-toolbar").waitFor({ state: "visible" });
        await settleEditor(page);
        const actual = await snapshot(page);
        item.persistedValues = actual.settings.runtimeUILayout.renpy;
        item.projectId = actual.id;
        check(item, "confirmed-and-saved-desktop-values-with-other-profile-and-story-intact", () => {
          assert.equal(item.persistedValues.shared.fontSize, 22);
          assert.equal(item.persistedValues.shared.spacing, 4);
          assert.equal(item.persistedValues.save_load.saveColumns, 3);
          assert.deepEqual(actual.settings.runtimeUILayoutProfiles.profiles.agentvn,
            baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
          assert.deepEqual(actual.nodes, baseline.nodes); assert.deepEqual(actual.edges, baseline.edges);
        });
        item.assetProofs = await page.evaluate(async () => {
          const { useProjectStore } = await import("/src/store/projectStore.ts");
          const { backendClient } = await import("/src/api/backendClient.ts");
          return Promise.all(useProjectStore.getState().assetManifest.map(async asset => {
            const url = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
            const response = await fetch(backendClient.resolveProjectAssetUrl(url));
            if (!response.ok) throw Error(`Asset HTTP ${response.status}`);
            return { id: asset.asset_id, source: asset.metadata.tags.find(tag => tag.startsWith("renpy_gui_path:"))
              .slice("renpy_gui_path:".length), sha256: [...new Uint8Array(
                await crypto.subtle.digest("SHA-256", await response.arrayBuffer()))]
                .map(byte => byte.toString(16).padStart(2, "0")).join("") };
          }));
        });
        assert.equal(item.assetProofs.length, 25);
        for (const asset of item.assetProofs) assert.equal(asset.sha256,
          manifest.officialFiles.find(f => asset.source === `官方模板 中文/game/${f.relative}`)?.sha256);
        await page.getByTestId("renpy-font-coverage-report").locator("strong", { hasText: "项目字符存在缺字" }).waitFor();
        item.fontCoverage = await page.getByTestId("renpy-font-coverage-report").innerText();
        assert(item.fontCoverage.includes("回退到系统字体"));
        const pngPath = path.join(isolation.output, `${width}-dpr${dpr}-${motion}.png`);
        await page.screenshot({ path: pngPath });
        const png = fs.readFileSync(pngPath);
        assert.equal(png.readUInt32BE(16), width * dpr); assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: pngPath, sha256: sha(png) };
        // Real backend persistence, not simply a saved-looking local draft.
        const backend = await (await fetch(`${host.backendUrl}/api/project/projects/${actual.id}`)).json();
        assert(backend.ok);
        assert.deepEqual(backend.data.editor_settings.runtimeUILayout.renpy, item.persistedValues);
        await page.reload();
        await page.locator('[data-help-key="home.recentProject"]').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLayout(page);
        const reopened = await snapshot(page);
        check(item, "reload-and-reopen-keep-correct-values-and-resource-identities", () => {
          assert.equal(reopened.id, actual.id);
          assert.deepEqual(reopened.settings.runtimeUILayout.renpy, item.persistedValues);
          assert.equal(reopened.settings.runtimeUILayout.renpy.shared.fontSize, 22);
          assert.deepEqual(reopened.assets.map(a => a.asset_id), actual.assets.map(a => a.asset_id));
        });
        assert.deepEqual(item.errors, []);
        item.status = item.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
        await page.screenshot({ path: path.join(isolation.output, `failure-${width}-${dpr}-${motion}.png`) }).catch(() => {});
      } finally { await context.close(); }
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, error: item.error }));
    }
  assert.equal(report.cases.length, 12); assert.equal(report.modelSubmissions, 0);
  report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close(); await host?.stop();
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output: isolation.output }));
});
