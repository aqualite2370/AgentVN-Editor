"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("../../editor/node_modules/jszip");
const { startOwnedViteServer } = require("./owned-vite-server.cjs");
const { currentAcceptanceViewports } = require("./current-acceptance-viewports.cjs");
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

async function snapshot(page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import("/src/store/projectStore.ts");
    const { backendClient } = await import("/src/api/backendClient.ts");
    const state = useProjectStore.getState();
    const assets = await Promise.all(state.assetManifest.map(async asset => {
      const source = asset.metadata.data_url ?? asset.metadata.blob_url ?? asset.metadata.url;
      if (!source) throw Error(`Unreadable test asset ${asset.asset_id}`);
      const response = await fetch(backendClient.resolveProjectAssetUrl(source));
      if (!response.ok) throw Error(`Asset ${asset.asset_id}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return { id: asset.asset_id, path: asset.metadata.project_path, bytes: bytes.byteLength,
        sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
          .map(byte => byte.toString(16).padStart(2, "0")).join("") };
    }));
    return { profiles: structuredClone(state.settings.runtimeUILayoutProfiles), assets };
  });
}

async function waitRuntime(page, screen) {
  await page.waitForFunction(screen => {
    const owner = document.querySelector("[data-runtime-transition-phase]");
    return owner?.dataset.runtimeTransitionPhase === "idle"
      && !!document.querySelector(`[data-ui-screen="${screen}"]`);
  }, screen);
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function runResourceUserFlow({ page, browser, output, report, root, title, deviceScaleFactor }) {
  // The preceding GUI checks mock native directory transport only. All real
  // project/download/publishing operations below must use browser transport.
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
  const sidebar = page.locator(".renpy-title-editor .runtime-layout-sidebar");
  await sidebar.getByRole("button", { name: "标题主页", exact: true }).click();
  const libraryDetails = page.locator("details.renpy-personal-component-library");
  if (!await libraryDetails.evaluate(node => node.open)) await libraryDetails.locator("summary").click();
  const library = page.getByTestId("custom-component-library");
  const componentName = "资源完整闭环组件";
  const imageBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i0AAAAASUVORK5CYII=", "base64");
  await library.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles({
    name: "分享 图标.png", mimeType: "image/png", buffer: imageBytes,
  });
  await library.getByText(/已添加 1 个图片依赖/).waitFor();
  const dependencyId = await library.locator(".custom-component-dependencies code").innerText();
  await library.getByLabel("组件名称", { exact: true }).fill(componentName);
  await library.getByLabel("组件 HTML", { exact: true }).fill(
    `<div class="root"><span class="title" data-bind="project.title">作品标题</span>`
    + `<img class="icon" data-asset="${dependencyId}" aria-label="分享图标" />`
    + `<button type="button" class="button" aria-label="组件打开关于" data-action="open_about">关于</button></div>`);
  await library.getByLabel("组件 CSS", { exact: true }).fill(
    ".root { display: flex; flex-direction: column; gap: 8px; padding: 8px; }"
    + ".title { font-size: 16px; color: #ffffff; }"
    + ".icon { width: 32px; height: 32px; object-fit: contain; }"
    + ".button { color: #ffffff; background-color: #24324d; padding: 4px 8px; }");
  await library.getByTestId("component-save").click();
  await library.getByText(`“${componentName}”已保存到本机个人组件库。`).waitFor();
  const originalId = await library.locator(".custom-component-list li").first().getAttribute("data-testid");
  const original = library.getByTestId(originalId);
  await original.getByRole("checkbox").check();
  const zipDownload = page.waitForEvent("download");
  await library.getByTestId("component-export").click();
  const zip = await zipDownload;
  const componentZipPath = path.join(output, "分享 组件.zip");
  await zip.saveAs(componentZipPath);
  const componentArchive = await JSZip.loadAsync(fs.readFileSync(componentZipPath));
  const sharedManifest = JSON.parse(await componentArchive.file("manifest.json").async("string"));
  assert.deepEqual(Object.keys(sharedManifest).sort(), ["components", "format", "schemaVersion"],
    "分享包不能携带工程、会话或凭据");
  assert.equal(sharedManifest.components.length, 1);
  for (const asset of sharedManifest.components[0].assets) {
    assert.equal(hash(await componentArchive.file(asset.path).async("nodebuffer")), hash(imageBytes));
  }

  const hostile = new JSZip();
  hostile.file("../escape.txt", "unsafe", { createFolders: false });
  const countBefore = await library.locator(".custom-component-list li").count();
  await library.getByTestId("component-import-file").setInputFiles({
    name: "越界.zip", mimeType: "application/zip",
    buffer: await hostile.generateAsync({ type: "nodebuffer" }),
  });
  await library.getByText(/组件包未通过检查/).waitFor();
  assert.equal(await library.locator(".custom-component-list li").count(), countBefore,
    "扫描失败不得污染个人库");
  await library.getByTestId("component-import-file").setInputFiles(componentZipPath);
  await library.getByText(/扫描通过：1 个组件/).waitFor();
  assert.equal(await library.locator(".custom-component-list li").count(), countBefore,
    "仅扫描预览不得提前导入");
  await library.getByTestId("component-confirm-import").click();
  await library.getByText(/已将 1 个组件另存为本机副本/).waitFor();
  assert.equal(await library.locator(".custom-component-list li").count(), countBefore + 1);
  const copy = library.locator(".custom-component-list li").filter({ hasText: "（副本）" });
  const copiedName = await copy.locator("label span").innerText();
  assert.notEqual(copiedName, componentName, "重名导入必须另存副本");
  await copy.getByRole("button", { name: `添加 ${copiedName} 到当前页面`, exact: true }).click();
  await library.getByText(/已复制到当前工程页面/).waitFor();
  const projectCopies = page.locator("details.renpy-project-components");
  if (!await projectCopies.evaluate(node => node.open)) await projectCopies.locator("summary").click();
  await projectCopies.locator("fieldset").filter({ hasText: copiedName })
    .getByLabel("height", { exact: true }).fill("32");
  const onDialog = dialog => dialog.accept();
  page.on("dialog", onDialog);
  try {
    await original.getByRole("button", { name: `删除 ${componentName}`, exact: true }).click();
    const deletion = page.getByTestId("editor-delete-confirmation");
    await deletion.waitFor();
    await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
    await deletion.waitFor({ state: "detached" });
  } finally { page.removeListener("dialog", onDialog); }
  await library.getByText(/已从本机个人库删除/).waitFor();
  assert.equal(await projectCopies.locator("fieldset").count(), 1,
    "删除库原件不得删除工程副本");
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await page.locator(".runtime-layout-save-feedback.is-saved").waitFor();
  const saved = await snapshot(page);
  assert.equal(saved.assets.length, 7, "GUI六资源与组件独立图片应一同持久化");
  const projectComponent = saved.profiles.profiles.renpy.screens.find(screen => screen.screen_id === "title")
    .components.find(component => component.component_type === "custom_component");
  assert(projectComponent);
  report.cases.push({ case: "gui-and-component-real-library-share-project-copy", status: "PASS",
    componentZipPath, componentZipSha256: hash(fs.readFileSync(componentZipPath)), saved });

  await page.locator('[data-workspace-surface="edit"]:visible').click();
  const projectPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "保存工程", exact: true }).click();
  const project = await projectPromise;
  const projectPath = path.join(output, project.suggestedFilename());
  await project.saveAs(projectPath);
  await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".app-transition-stage.is-switching")
    && [...document.querySelectorAll(".project-import-button input")].some(node => !node.disabled));
  await page.locator(".project-import-button input").first().setInputFiles(projectPath);
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay")
    && !document.querySelector(".app-transition-stage.is-switching"));
  const reopened = await snapshot(page);
  assert.deepEqual(reopened.profiles, saved.profiles, "真实便携工程重开必须保留双布局和组件");
  assert.deepEqual(reopened.assets.map(asset => [asset.id, asset.sha256]).sort(),
    saved.assets.map(asset => [asset.id, asset.sha256]).sort(), "重开工程后资源ID和字节必须一致");
  report.cases.push({ case: "resources-real-vnproj-save-home-reopen", status: "PASS" });

  await page.locator('[data-workspace-surface="publish"]:visible').click();
  const publish = page.locator(".cartridge-export-panel");
  await publish.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await publish.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
  const warning = publish.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await warning.count()) await warning.check();
  const cartridgePromise = page.waitForEvent("download", { timeout: 60000 });
  await publish.locator(".package-primary-action").click();
  const download = await cartridgePromise;
  const cartridgePath = path.join(output, download.suggestedFilename());
  await download.saveAs(cartridgePath);
  const archive = await JSZip.loadAsync(fs.readFileSync(cartridgePath));
  const manifest = JSON.parse(await archive.file("manifest.json").async("string"));
  const layoutBytes = await archive.file("ui/layout.json").async("nodebuffer");
  const layout = JSON.parse(layoutBytes.toString("utf8"));
  assert.equal(layout.layout_type, "renpy");
  assert.deepEqual(layout.renpy, saved.profiles.profiles.renpy.renpy);
  for (const asset of saved.assets) {
    const entry = manifest.assets.find(item => item.asset_id === asset.id);
    assert(entry, `卡带应声明活动GUI/组件资源${asset.id}`);
    assert.equal(hash(await archive.file(entry.path).async("nodebuffer")), asset.sha256,
      `卡带资源${asset.id}必须与源字节一致`);
  }
  report.artifacts = [componentZipPath, projectPath, cartridgePath].map(file => ({
    path: file, sha256: hash(fs.readFileSync(file)), bytes: fs.statSync(file).size,
    generatedAt: fs.statSync(file).mtime.toISOString(), source: "real Editor UI download",
  }));
  report.layoutArtifact = { archive: cartridgePath, sha256: hash(layoutBytes), entry: "ui/layout.json" };
  await publish.getByRole("button", { name: "关闭发布与打包", exact: true }).click();

  let server, player;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      logFile: path.join(output, "resource-export-gamecli.log") });
    report.resourcePlayerServer = { url: server.url, pid: server.pid, runId: server.runId };
    player = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor });
    const errors = [];
    player.on("pageerror", error => errors.push(String(error)));
    await server.run(async () => {
      await player.goto(`${server.url}?mode=library`);
      await player.getByTestId("game-state-library").waitFor();
      await player.getByTestId("web-cartridge-file").setInputFiles(cartridgePath);
      await player.locator(".cartridge-spine").filter({ hasText: title }).waitFor();
      await player.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
      await player.locator(".boot-overlay").waitFor({ state: "detached" });
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await player.emulateMedia({ reducedMotion });
        for (const [width, height] of currentAcceptanceViewports()) {
          await player.setViewportSize({ width, height });
          await waitRuntime(player, "title");
          const component = player.getByTestId("runtime-custom-component");
          assert.equal(await component.count(), 1);
          const actual = await component.evaluate(async node => {
            const button = node.querySelector("button"), image = node.querySelector("img");
            await image.decode();
            const rect = button.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return { title: node.querySelector('[data-binding="project.title"]').textContent,
              imageWidth: image.naturalWidth, button: rect.toJSON(), component: node.getBoundingClientRect().toJSON(),
              hit: button.contains(hit), overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert.equal(actual.title, title);
          assert(actual.imageWidth > 0 && actual.hit && actual.overflow <= 1);
          assert(actual.button.top >= actual.component.top && actual.button.bottom <= actual.component.bottom,
            "组件动作必须位于其作者外框内");
          await component.getByRole("button", { name: "组件打开关于", exact: true }).click();
          await waitRuntime(player, "about");
          await player.getByTestId("renpy-menu-return").click();
          await waitRuntime(player, "title");
          report.cases.push({ case: "exported-gui-component-player-action", width, height,
            dpr: deviceScaleFactor, reducedMotion, actual, status: "PASS" });
          if (width === 1920) await player.screenshot({ path: path.join(output, `resource-player-${reducedMotion}.png`) });
        }
      }
      assert.deepEqual(errors, []);
    });
    assert.equal(report.cases.filter(row => row.case === "exported-gui-component-player-action").length, 6,
      "资源发布流程必须完成三横屏及普通/减少动效矩阵，不能空跑");
  } catch (error) {
    await player?.screenshot({ path: path.join(output, "resource-player-failure.png") }).catch(() => {});
    throw error;
  } finally { await player?.close(); await server?.stop(); }
}

module.exports = { runResourceUserFlow };
