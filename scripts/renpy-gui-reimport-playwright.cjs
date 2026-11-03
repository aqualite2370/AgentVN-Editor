"use strict";
// Real Editor entry and import UI. Read-only store observations; no AI requests.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { resolveAcceptancePaths, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { startFrames, stopFrames, assertMotion } = require("./editor-gui-import-dialog-playwright.cjs");
const isolation = resolveAcceptancePaths();
const dpr = Number(process.env.GUI_DIALOG_DPR || 1);
const reduced = process.env.GUI_DIALOG_REDUCED === "1";
const report = { status: "RUNNING", scope: "Editor GUI reimport; isolated browser, not installed Release",
  isolation, dpr, reduced, cases: [], errors: [] };
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const baseImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Lz4AAAAASUVORK5CYII=", "base64");

async function archive(x, spacing, marker) {
  const zip = new JSZip();
  zip.file("gui.rpy", `define gui.navigation_xpos = ${x}\ndefine gui.navigation_spacing = ${spacing}\n`);
  zip.file("gui/button/idle.png", Buffer.concat([baseImage, Buffer.from([marker])]));
  return zip.generateAsync({ type: "nodebuffer" });
}
async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { backendClient } = await import("/src/api/backendClient.ts");
    const state = useProjectStore.getState();
    const assets = await Promise.all(state.assetManifest.map(async asset => {
      const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
      if (!source) throw Error(`No bytes for ${asset.asset_id}`);
      const response = await fetch(backendClient.resolveProjectAssetUrl(source));
      if (!response.ok) throw Error(`Asset HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return { id: asset.asset_id, tags: asset.metadata.tags, path: asset.metadata.project_path,
        sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map(byte => byte.toString(16).padStart(2, "0")).join("") };
    }));
    return { settings: structuredClone(state.settings), assets };
  });
}
async function select(page, name, option) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name, exact: true })
    .getByRole("option", { name: option, exact: true }).click();
}
async function main() {
  let env, browser, page;
  fs.mkdirSync(isolation.output, { recursive: true });
  try {
    env = await startEditorAcceptance(isolation.output);
    report.owner = { backendPid: env.backendPid, vitePid: env.server.pid, runId: env.server.runId };
    browser = await chromium.launch({ headless: process.env.GUI_DIALOG_HEADFUL !== "1" });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr,
      reducedMotion: reduced ? "reduce" : "no-preference" });
    page.setDefaultTimeout(30000);
    page.on("pageerror", error => report.errors.push(String(error)));
    await env.open(page);
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
    await page.waitForFunction(() => document.querySelector(".advanced-tools-panel")?.classList.contains("is-tab-idle")
      && !document.querySelector(".toolbar-popover.advanced.is-morphing"));
    const editor = page.locator(".toolbar-popover.advanced:not(.toolbar-popover-morph-ghost)");
    await editor.locator('[data-layout-type-option="renpy"]').click();
    const dialog = page.getByTestId("renpy-gui-import-dialog");
    const trigger = editor.getByTestId("renpy-gui-import-open");
    const first = await archive(52, 16, 1), second = await archive(84, 24, 2);
    const parameter = name => dialog.locator(".renpy-gui-import-row").filter({ hasText: name }).getByRole("checkbox");
    const apply = () => dialog.getByRole("button", { name: "确认应用已选项目", exact: true });
    async function scan(buffer) {
      await startFrames(page);
      await trigger.click();
      const frames = await stopFrames(page, true);
      fs.writeFileSync(path.join(isolation.output, `entry-${report.cases.length}-${Date.now()}.json`),
        JSON.stringify(frames, null, 2));
      assertMotion(frames, "reimport entry");
      await page.getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles({
        name: "中文 重导入 GUI.zip", mimeType: "application/zip", buffer });
      await dialog.locator(".renpy-gui-import-summary").waitFor();
    }
    async function cancel() {
      await dialog.getByRole("button", { name: "取消，不修改工程", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    }
    async function save() {
      await editor.locator('[data-save-state]').filter({ hasText: /保存布局|已保存/ }).first().click();
      await page.waitForFunction(() => document.querySelector('[data-save-state="saved"]'));
    }
    await scan(first);
    await select(page, "gui/button/idle.png 游戏界面用途", "标题页主视觉");
    await dialog.locator(".renpy-gui-import-license input").check();
    await apply().click();
    await dialog.waitFor({ state: "detached" });
    await save();
    const baseline = await snapshot(page);
    const original = baseline.assets.find(asset => asset.tags?.includes("renpy_gui_import"));
    assert(original, "First import must persist the actual asset");
    assert.equal(original.sha256, hash(Buffer.concat([baseImage, Buffer.from([1])])));

    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
      await page.setViewportSize({ width, height });
      await scan(second);
      assert.equal(await parameter("shared.x").isChecked(), false, "Reimport must preserve explicit parameters by default");
      assert.equal(await parameter("shared.spacing").isChecked(), false);
      assert.match(await page.getByRole("combobox", { name: "gui/button/idle.png 导入操作" }).innerText(), /跳过/);
      await select(page, "gui/button/idle.png 导入操作", "替换同来源导入");
      await parameter("shared.x").check();
      await dialog.locator(".renpy-gui-import-license input").check();
      const geometry = await dialog.evaluate(node => {
        const box = node.getBoundingClientRect(), footer = node.querySelector("footer").getBoundingClientRect();
        const body = node.querySelector(".renpy-gui-import-body").getBoundingClientRect();
        return { box: box.toJSON(), footer: footer.toJSON(), body: body.toJSON(),
          overflow: node.scrollWidth - node.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          buttons: [...node.querySelectorAll("footer button")].map(button => {
            const rect = button.getBoundingClientRect();
            return button.disabled || button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          }) };
      });
      assert(geometry.box.left >= 0 && geometry.box.top >= 0
        && geometry.box.right <= width + 1 && geometry.box.bottom <= height + 1);
      assert(geometry.overflow <= 1 && geometry.pageOverflow <= 1);
      assert(geometry.body.bottom <= geometry.footer.top + 1 && geometry.buttons.every(Boolean));
      await page.screenshot({ path: path.join(isolation.output, `reimport-${width}.png`) });
      await cancel();
      assert.deepEqual(await snapshot(page), baseline, "Cancelled reimport must not change assets or layout");
      report.cases.push({ name: `${width}:cancel-and-geometry`, status: "PASS", geometry });
    }

    await scan(second);
    await select(page, "gui/button/idle.png 导入操作", "替换同来源导入");
    await parameter("shared.x").check();
    await dialog.locator(".renpy-gui-import-license input").check();
    await apply().click();
    await dialog.waitFor({ state: "detached" });
    await save();
    const replacement = await snapshot(page);
    assert.equal(replacement.assets.length, baseline.assets.length);
    assert.equal(replacement.assets[0].id, original.id, "Replacement must preserve reference identity");
    assert.equal(replacement.assets[0].sha256, hash(Buffer.concat([baseImage, Buffer.from([2])])));
    assert.equal(replacement.settings.runtimeUILayout.renpy.shared.x, 84);
    assert.equal(replacement.settings.runtimeUILayout.renpy.shared.spacing, 16, "Unselected manual value must remain");
    assert.deepEqual(replacement.settings.runtimeUILayoutProfiles.profiles.agentvn,
      baseline.settings.runtimeUILayoutProfiles.profiles.agentvn, "Other layout must not change");
    report.cases.push({ name: "selected-overwrite-preserves-reference-and-other-profile", status: "PASS", replacement });

    // Rebinding an existing asset is a legitimate selection even with every import checkbox clear.
    await scan(second);
    assert.equal(await apply().isEnabled(), false, "Empty selection remains disabled");
    await select(page, "gui/button/idle.png 游戏界面用途", "对白面板背景");
    assert.equal(await apply().isEnabled(), true, "Existing asset binding-only reimport must be applicable");
    await startFrames(page);
    await apply().click();
    const exit = assertMotion(await stopFrames(page, false), "binding-only exit");
    await save();
    const rebound = await snapshot(page);
    assert.deepEqual(rebound.assets, replacement.assets, "Binding-only reimport must not duplicate or replace bytes");
    assert.equal(rebound.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "player")
      .components.find(component => component.component_id === "dialog_panel").style.backgroundImage, `asset:${original.id}`);
    report.cases.push({ name: "binding-only-existing-asset", status: "PASS", exit });

    // Unsafe input is rejected before mutation; original records remain intact.
    const malicious = new JSZip();
    malicious.file("gui.rpy", "define gui.navigation_xpos = 999");
    malicious.file("gui/bad.png", baseImage);
    let bad = await malicious.generateAsync({ type: "nodebuffer", compression: "STORE" });
    bad = Buffer.from(bad);
    const from = Buffer.from("gui/bad.png"), to = Buffer.from("../bad.png "); // Same byte length.
    for (let index = 0; (index = bad.indexOf(from, index)) >= 0; index += from.length) to.copy(bad, index);
    await scan(bad);
    assert.equal(await apply().isDisabled(), true);
    assert.match(await dialog.locator('[aria-label="扫描问题"]').innerText(), /unsafe_path/);
    await cancel();
    assert.deepEqual(await snapshot(page), rebound, "Failed scan must not partially change project");
    report.cases.push({ name: "failed-reimport-no-partial-mutation", status: "PASS" });
    assert.deepEqual(report.errors, []);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = error.stack;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(isolation.output, "failure.png") }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser?.close(); await env?.stop();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(isolation.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, output: isolation.output }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
