"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const paths = resolveAcceptancePaths();
const viewports = currentAcceptanceViewports(process.env.PRESENTATION_VIEWPORTS
  ? JSON.parse(process.env.PRESENTATION_VIEWPORTS) : undefined);
const dpr = Number(process.env.PRESENTATION_DPR || 1);
const reduced = process.env.PRESENTATION_REDUCED === "1";
const report = { status: "RUNNING", scope: "Editor real node iframe presentation defaults",
  isolation: paths, dpr, reduced, cases: [], startedAt: new Date().toISOString() };
async function pick(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name, exact: true })
    .getByRole("option", { name: value, exact: true }).click();
}
async function main() {
  let env, browser, activePage;
  try {
    env = await startEditorAcceptance(paths.output);
    browser = await chromium.launch();
    report.owner = { serverPid: env.server.pid, backendPid: env.backendPid, url: env.url };
    await env.server.run(async () => {
      for (const [width, height] of viewports) {
        const page = activePage = await browser.newPage({ viewport: { width, height },
          deviceScaleFactor: dpr, reducedMotion: reduced ? "reduce" : "no-preference" });
        await env.open(page);
        await page.evaluate(() => {
          window.__nodePreviewMessages = [];
          window.addEventListener("message", event => {
            if (event.data?.type?.startsWith("agentvn.")) window.__nodePreviewMessages.push({
              type: event.data.type, revision: event.data.revision,
              requestId: event.data.requestId, sceneId: event.data.sceneId,
              message: event.data.message,
            });
          });
        });
        await page.locator('.react-flow__node[data-id="scene"]').click();
        const card = page.locator(".command-card").filter({ hasText: "对白呈现创作验收" }).first();
        await card.locator(".command-card-summary").click();
        if (await page.locator(".preview-rail-button").isVisible())
          await page.locator(".preview-rail-button").click();
        await page.locator(".embedded-runtime-preview-status.is-ready").waitFor({ timeout: 45000 });
        const iframe = page.frameLocator('iframe[title="GameCLI 内嵌预览"]');
        const dialog = iframe.locator(".dialog-box");
        await dialog.waitFor();
        const assertMode = async mode => {
          await iframe.locator(".game-launch-blackout").waitFor({ state: "detached", timeout: 15000 });
          const selector = mode === "bubble" ? ".dialog-box.is-bubble-presentation"
            : mode === "nvl" ? ".dialog-box.is-nvl-presentation"
              : ".dialog-box:not(.is-nvl-presentation):not(.is-bubble-presentation)";
          await iframe.locator(selector).waitFor({ timeout: 8000 });
          const geometry = await dialog.evaluate(node => {
            const box = node.getBoundingClientRect(), stage = node.closest(".story-player").getBoundingClientRect();
            return { box: box.toJSON(), stage: stage.toJSON(), text: node.textContent,
              dialogLabel: node.getAttribute("aria-label"),
              sceneId: node.closest(".story-player").dataset.currentSceneId,
              pages: Number(node.dataset.dialogPages),
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert(geometry.sceneId === "dialog_presentation_acceptance"
            && geometry.dialogLabel.includes("对白呈现创作验收"),
          "Node preview must retain the selected scene and its current authored line");
          assert(geometry.box.width > 0 && geometry.box.height > 0
            && geometry.box.left >= geometry.stage.left - 1 && geometry.box.right <= geometry.stage.right + 1
            && geometry.box.top >= geometry.stage.top - 1 && geometry.box.bottom <= geometry.stage.bottom + 1
            && geometry.overflow <= 1, "Preview dialog must remain inside its actual iframe game frame");
          return geometry;
        };
        await assertMode("dialog");
        // These controls only change project settings. No command or scene edit
        // should be needed to refresh the actual mounted node preview.
        await pick(page, "角色默认呈现方式", "气泡对白");
        const bubble = await assertMode("bubble");
        await pick(page, "角色默认呈现方式", "NVL 累积阅读");
        const nvl = await assertMode("nvl");
        await pick(page, "角色默认呈现方式", "继承工程默认");
        await assertMode("dialog");
        await page.locator('[data-workspace-surface="options"]:visible').click();
        await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
        await pick(page, "工程默认呈现方式", "气泡对白");
        await page.locator('[data-workspace-surface="edit"]:visible').click();
        await page.waitForFunction(() => !document.querySelector(".toolbar-popover.advanced.is-open"));
        const inherited = await assertMode("bubble");
        await pick(page, "对白呈现方式", "普通对白框");
        await assertMode("dialog");
        await pick(page, "对白呈现方式", "继承角色 / 工程默认");
        await assertMode("bubble");
        assert.equal(await page.locator('iframe[title="GameCLI 内嵌预览"]').count(), 1,
          "Defaults must update one existing node runtime, not mount a duplicate");
        await page.screenshot({ path: path.join(paths.output, `node-preview-${width}-dpr${dpr}.png`) });
        report.cases.push({ width, height, dpr, reduced, status: "PASS", bubble, nvl, inherited });
        await page.close();
      }
    });
    assert.equal(report.cases.length, viewports.length, "Nonempty complete node preview matrix required");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    if (activePage && !activePage.isClosed()) {
      report.failureState = await activePage.evaluate(() => ({
        previewStatus: document.querySelector(".embedded-runtime-preview-status")?.textContent,
        messages: window.__nodePreviewMessages,
        iframe: document.querySelector('iframe[title="GameCLI 内嵌预览"]')?.contentDocument
          ?.querySelector(".dialog-box")?.outerHTML.slice(0, 1600),
      })).catch(() => null);
      report.runtimeState = await activePage.frameLocator('iframe[title="GameCLI 内嵌预览"]').locator("body")
        .evaluate(node => ({
          screen: node.querySelector("[data-runtime-screen]")?.getAttribute("data-runtime-screen"),
          blackout: node.querySelector(".game-launch-blackout")?.outerHTML.slice(0, 600),
          dialog: node.querySelector(".dialog-box")?.outerHTML.slice(0, 1200),
        })).catch(() => null);
      await activePage.screenshot({ path: path.join(paths.output, "failure.png") }).catch(() => {});
    }
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await env?.stop();
    report.finishedAt = new Date().toISOString();
    fs.mkdirSync(paths.output, { recursive: true });
    fs.writeFileSync(path.join(paths.output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${paths.output}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
