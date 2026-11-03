"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const JSZip = require("../editor/node_modules/jszip");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT, "Explicit test isolation required");
const output = path.join(process.env.AGENTVN_WORKSPACE_OUTPUT, "project-assets", runId);
const report = { runId, status: "RUNNING", cases: [],
  environment: "product workbench browser harness; external process API controlled; not installed/live-model evidence" };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  let server;
  let browser;
  try {
    server = await startOwnedViteServer({ root: path.join(root, "editor"), port: 0, logFile: path.join(output, "server.log") });
    report.service = { url: server.url, pid: server.pid, runId: server.runId };
    browser = await chromium.launch();
    await server.run(async () => {
      for (const dpr of [1, 2]) for (const motion of ["no-preference", "reduce"]) for (const [width, height] of desktopViewports) {
        const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, reducedMotion: motion });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        const records = new Map();
        page.on("pageerror", error => errors.push(String(error)));
        page.on("console", message => { if (message.type() === "error") report.lastConsoleError = message.text(); });
        await page.route("**/api/assistant/creation/processes**", async route => {
          const request = route.request();
          const pathname = new URL(request.url()).pathname;
          if (request.method() === "POST" && pathname.endsWith("/processes")) {
            const body = request.postDataJSON();
            requests.push(body.request);
            records.set(body.id, { id: body.id, projectId: body.project_id, projectTitle: body.project_title,
              conversationId: body.conversation_id, submittedAt: Date.now(), status: "completed", result: {
                name: "工程图片新组件", description: "使用本会话工程素材，尚未修改工程。",
                html: '<div class="root"><img class="icon" data-asset="project-asset-1" aria-label="工程徽章" /></div>',
                css: ".root { display: flex; } .icon { width: 24px; height: 24px; }",
              } });
            await route.fulfill({ status: 202, json: records.get(body.id) });
          } else if (pathname.endsWith("/processes")) {
            await route.fulfill({ json: { processes: [...records.values()] } });
          } else {
            await route.fulfill({ json: records.get(pathname.split("/").at(-1)) });
          }
        });
        await page.goto(`${server.url}/assistant-creation-authorization-harness.html`);
        await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
        await page.getByRole("button", { name: "打开创造工作台" }).click();
        const workbench = page.getByTestId("assistant-creation-workbench-window");
        const assets = workbench.getByTestId("assistant-creation-authorized-project-assets");
        await assets.waitFor({ timeout: 5000 });
        const selected = assets.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
        const unselected = assets.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true });
        assert.equal(await selected.isChecked(), false);
        assert.equal(await unselected.isChecked(), false);
        assert.equal(await assets.getByRole("checkbox", { name: "授权工程素材 背景音乐", exact: true }).isEnabled(), false,
          "Unsupported media must be explained rather than silently authorized");
        await selected.check();
        await page.reload();
        await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
        await page.getByRole("button", { name: "打开创造工作台" }).click();
        await selected.waitFor();
        await page.waitForFunction(() => document.querySelector('[aria-label="授权工程素材 工程徽章"]')?.checked);
        await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("请用我选中的工程图片构建组件。");
        await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
        const draft = workbench.getByTestId("assistant-creation-draft");
        try {
          await draft.getByRole("img", { name: "工程徽章", exact: true }).waitFor({ timeout: 10000 });
        } catch (error) {
          const failedRequest = requests[requests.length - 1];
          report.lastRequest = failedRequest && { ...failedRequest, provider_selection: "[redacted]" };
          report.lastStatus = await workbench.innerText();
          report.pageErrors = errors;
          throw error;
        }
        assert.equal(requests.length, 1);
        assert.deepEqual(requests[0].authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
        for (const privateField of ["private-project-badge", "private-unselected", "private-generation-prompt", "C:\\private", "data:image"]) {
          assert(!JSON.stringify(requests[0]).includes(privateField), `Private field must not be disclosed: ${privateField}`);
        }
        const imageSource = await draft.getByRole("img", { name: "工程徽章", exact: true }).getAttribute("src");
        assert.match(imageSource, /^data:image\/png;base64,/);
        await selected.uncheck();
        assert.equal(await selected.isChecked(), false);
        assert.equal(await draft.getByRole("img", { name: "工程徽章", exact: true }).getAttribute("src"), imageSource,
          "Revocation changes future authorization, not the already-reviewed snapshot");
        await workbench.getByRole("button", { name: "预览完整 Runtime 页面", exact: true }).click();
        const frame = workbench.frameLocator('iframe[title="Ren\'Py（进阶）实际页面预览"]');
        const runtimeImage = frame.getByTestId("runtime-custom-component").getByRole("img", { name: "工程徽章", exact: true });
        await runtimeImage.waitFor({ timeout: 15000 });
        assert.notEqual(await runtimeImage.getAttribute("data-asset-missing"), "true");
        const merge = workbench.getByTestId("assistant-creation-merge-button");
        await merge.click();
        await workbench.getByText(/已将“工程图片新组件”应用到“title”页面/).waitFor();
        const merged = await page.evaluate(() => {
          const state = window.__assistantCreationTestStore.getState();
          const component = state.settings.runtimeUILayout.screens.find(screen => screen.screen_id === "title")
            .components.find(item => item.label === "工程图片新组件");
          const id = component.customComponent.root.children[0].assetId;
          const asset = state.assetManifest.find(item => item.asset_id === id);
          return { id, dataUrl: asset.metadata.data_url, originalCount: state.assetManifest.filter(item => item.asset_id === "private-project-badge").length };
        });
        assert.notEqual(merged.id, "private-project-badge");
        assert.equal(merged.dataUrl, imageSource);
        assert.equal(merged.originalCount, 1);
        const exportResult = await page.evaluate(() => window.__assistantProjectAssetExport());
        assert.deepEqual(exportResult.errors, [], "Public cartridge exporter must accept the reviewed component");
        const vnproj = await JSZip.loadAsync(Uint8Array.from(exportResult.bundle));
        const projectJson = JSON.parse(await vnproj.file("project.json").async("string"));
        assert(!JSON.stringify(projectJson).includes("authorizedProjectAssetIds"), "Permissions must remain local, outside .vnproj");
        const exportedAsset = projectJson.asset_manifest.find(asset => asset.asset_id === merged.id);
        const expectedBytes = Buffer.from(imageSource.split(",")[1], "base64");
        assert.deepEqual(await vnproj.file(exportedAsset.metadata.project_path).async("nodebuffer"), expectedBytes,
          ".vnproj must contain the exact authorized bytes");
        const reopenedAsset = exportResult.reopened.asset_manifest.find(asset => asset.asset_id === merged.id);
        assert.equal(reopenedAsset.metadata.data_url, imageSource, "Reopened project must still carry the reviewed copy");
        const cartridge = await JSZip.loadAsync(Uint8Array.from(exportResult.cartridge));
        const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
        const cartridgeAsset = manifest.assets.find(asset => asset.asset_id === merged.id);
        assert(cartridgeAsset, "Merged image must be an actual cartridge dependency");
        assert.deepEqual(await cartridge.file(cartridgeAsset.path).async("nodebuffer"), expectedBytes,
          ".vncart bytes must match the local preview and reopened project");
        const reopenedComponent = exportResult.reopened.editor_settings.runtimeUILayout.screens
          .find(screen => screen.screen_id === "title").components.find(item => item.label === "工程图片新组件");
        assert.equal(reopenedComponent.customComponent.root.children[0].assetId, merged.id);
        await selected.check();
        await page.getByTestId("switch-owned-project").click();
        await assets.getByText("当前工程没有素材", { exact: false }).waitFor();
        assert.equal(await assets.getByRole("checkbox").count(), 0, "Other project must not inherit A resources or consent");
        await page.getByTestId("switch-owned-project").click();
        await page.waitForFunction(() => document.querySelector('[aria-label="授权工程素材 工程徽章"]')?.checked);
        await page.getByTestId("assistant-creation-workbench-chat").getByTestId("assistant-new-conversation").click();
        await selected.waitFor();
        assert.equal(await selected.isChecked(), false, "New conversation must not inherit another session's permissions");
        await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("未选择图片时不得使用上一会话的授权。");
        await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
        await workbench.locator(".assistant-inline-status").filter({ hasText: "未创建草稿" }).waitFor();
        assert.equal(requests.length, 2);
        assert.deepEqual(requests[1].authorized_assets, [], "New unconsented session must transmit no project assets");
        assert.equal(await workbench.getByTestId("assistant-creation-draft").count(), 0,
          "A provider response referring to previous consent must be locally rejected");
        const geometry = await assets.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth, documentWidth: document.documentElement.scrollWidth };
        });
        assert(geometry.scrollWidth <= geometry.clientWidth + 1 && geometry.documentWidth <= width + 1);
        await selected.scrollIntoViewIfNeeded();
        await selected.focus();
        assert(await selected.evaluate(element => document.activeElement === element));
        assert.deepEqual(errors, []);
        await workbench.screenshot({ path: path.join(output, `${width}-${dpr}-${motion}.png`) });
        report.cases.push({ width, height, dpr, motion, requests: requests.length, geometry,
          vnprojByteMatch: true, reopenByteMatch: true, cartridgeByteMatch: true, projectIsolation: true, status: "PASS" });
        await context.close();
      }
    });
    assert.equal(report.cases.length, 12);
    await server.run(async () => {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const page = await context.newPage();
      const errors = [];
      let modelSubmissions = 0;
      page.on("pageerror", error => errors.push(String(error)));
      await page.route("**/api/assistant/creation/processes**", async route => {
        if (route.request().method() === "POST") modelSubmissions++;
        await route.fulfill({ json: { processes: [] } });
      });
      await page.goto(`${server.url}/assistant-creation-authorization-harness.html`);
      await page.getByTestId("authorization-harness-ready").filter({ hasText: "ready" }).waitFor();
      await page.getByRole("button", { name: "打开创造工作台" }).click();
      const workbench = page.getByTestId("assistant-creation-workbench-window");
      const selected = workbench.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
      await selected.check();
      await page.route("**/private-source-unavailable.png", route => route.fulfill({ status: 404, body: "unavailable" }));
      await page.evaluate(url => {
        const store = window.__assistantCreationTestStore;
        store.getState().setAssetManifest(store.getState().assetManifest.map(asset => asset.asset_id === "private-project-badge"
          ? { ...asset, metadata: { display_name: "工程徽章", filename: "徽章.png", mime_type: "image/png", url } } : asset));
      }, `${server.url}/private-source-unavailable.png`);
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("读取失败不得发送。");
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await workbench.locator(".assistant-inline-status").filter({ hasText: "读取失败" }).waitFor();
      assert.equal(modelSubmissions, 0);
      assert(!(await workbench.locator(".assistant-inline-status").innerText()).includes("private-source-unavailable"));
      report.cases.push({ case: "source-failure-before-model-submission", modelSubmissions, status: "PASS" });

      let sourceStartedResolve;
      let sourceReleaseResolve;
      let sourceFinishedResolve;
      const sourceStarted = new Promise(resolve => { sourceStartedResolve = resolve; });
      const sourceRelease = new Promise(resolve => { sourceReleaseResolve = resolve; });
      const sourceFinished = new Promise(resolve => { sourceFinishedResolve = resolve; });
      await page.route("**/delayed-authorized-source.png", async route => {
        sourceStartedResolve();
        await sourceRelease;
        await route.fulfill({ contentType: "image/png", body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=", "base64") });
        sourceFinishedResolve();
      });
      await page.evaluate(url => {
        const store = window.__assistantCreationTestStore;
        store.getState().setAssetManifest(store.getState().assetManifest.map(asset => asset.asset_id === "private-project-badge"
          ? { ...asset, metadata: { ...asset.metadata, url } } : asset));
      }, `${server.url}/delayed-authorized-source.png`);
      await workbench.getByLabel("向大模型助手提问", { exact: true }).fill("延迟读取期间切换工程。");
      await workbench.getByRole("button", { name: "生成创作提案", exact: true }).click();
      await sourceStarted;
      await page.getByTestId("switch-owned-project").click();
      await workbench.getByText("当前工程没有素材", { exact: false }).waitFor();
      await page.getByTestId("switch-owned-project").click();
      await page.waitForFunction(() => document.querySelector('[aria-label="授权工程素材 工程徽章"]')?.checked);
      sourceReleaseResolve();
      await sourceFinished;
      await page.waitForFunction(() => {
        const send = document.querySelector("[data-testid='assistant-creation-workbench-chat'] [data-help-key='assistant.send']");
        return send && !send.textContent.includes("生成中");
      });
      // One event turn after the fetch completion: no arbitrary animation readiness delay.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(modelSubmissions, 0, "A→B→A must invalidate the original read generation, even when IDs match again");
      assert.equal(await workbench.getByTestId("assistant-creation-draft").count(), 0);
      assert.deepEqual(errors, []);
      report.cases.push({ case: "A-B-A-delayed-source-does-not-submit-or-contaminate", modelSubmissions, status: "PASS" });
      await context.close();
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await server?.stop();
    report.cleanup = "owned browser/server stopped";
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, output, error: report.error }));
  }
}
main();
