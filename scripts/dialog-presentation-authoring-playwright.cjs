"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance, resolveAcceptancePaths } = require("./lib/editor-ui-acceptance.cjs");
const { currentAcceptanceViewports } = require("./lib/current-acceptance-viewports.cjs");
const paths = resolveAcceptancePaths();
const dpr = Number(process.env.PRESENTATION_DPR || 1);
const viewports = currentAcceptanceViewports(process.env.PRESENTATION_VIEWPORTS
  ? JSON.parse(process.env.PRESENTATION_VIEWPORTS) : undefined);
const report = { status: "RUNNING", scope: "Editor dialogue presentation authoring entry",
  startedAt: new Date().toISOString(), isolation: paths, dpr,
  reduced: process.env.PRESENTATION_REDUCED === "1", cases: [] };
async function pick(page, name, option) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("listbox", { name, exact: true })
    .getByRole("option", { name: option, exact: true }).click();
}
async function main() {
  let env, browser;
  try {
    env = await startEditorAcceptance(paths.output);
    browser = await chromium.launch({ headless: process.env.PRESENTATION_HEADFUL !== "1" });
    report.owner = { serverPid: env.server.pid, backendPid: env.backendPid, url: env.url };
    await env.server.run(async () => {
      for (const [width, height] of viewports) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
          reducedMotion: report.reduced ? "reduce" : "no-preference" });
        try {
          await env.open(page);
          await page.locator('[data-workspace-surface="options"]:visible').click();
          await page.locator('[data-help-key="advanced.tab.settings"]:visible').click();
          await pick(page, "工程默认呈现方式", "NVL 累积阅读");
          await page.locator('[data-workspace-surface="edit"]:visible').click();
          await page.waitForFunction(() => !document.querySelector(".toolbar-popover.advanced.is-open"));
          report.cases.push({ name: "project-default-real-settings-control", viewport: { width, height }, dpr,
            status: "PASS" });
          // The fixture contains a real dialogue node. All selection and editing
          // below use actual user controls, not internal navigation events.
          await page.locator('.react-flow__node[data-id="scene"]').click();
          const card = page.locator(".command-card").filter({ hasText: "对白呈现创作验收" }).first();
          await card.waitFor({ state: "visible", timeout: 15000 });
          await card.locator(".command-card-summary").click();
          const mode = page.getByRole("combobox", { name: "对白呈现方式" });
          await mode.click();
          const options = await page.getByRole("option").allTextContents();
          for (const [name, pattern] of [
            ["bubble-creation-entry", /气泡/],
            ["node-inherits-character-and-project", /继承/],
          ]) {
            const row = { name, viewport: { width, height }, dpr, options, status: "RUNNING" };
            try {
              const option = page.getByRole("option").filter({ hasText: pattern });
              assert.equal(await option.count(), 1, `${name}: required user option is missing`);
              const geometry = await option.evaluate(node => {
                const r = node.getBoundingClientRect();
                const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
                  hit: hit === node || node.contains(hit),
                  overflow: document.documentElement.scrollWidth - innerWidth,
                  viewportWidth: innerWidth, viewportHeight: innerHeight };
              });
              row.geometry = geometry;
              assert(geometry.width > 0 && geometry.height > 0 && geometry.hit, `${name}: cannot be clicked`);
              assert(geometry.x >= 0 && geometry.y >= 0 && geometry.right <= geometry.viewportWidth
                && geometry.bottom <= geometry.viewportHeight && geometry.overflow <= 1,
              `${name}: clipped or overflowing`);
              row.status = "PASS";
            } catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); }
            report.cases.push(row);
          }
          await page.screenshot({ path: path.join(paths.output, `authoring-${width}-dpr${dpr}.png`) });
          if (report.cases.slice(-2).some(row => row.status !== "PASS")) continue;
          await page.getByRole("option", { name: "气泡对白", exact: true }).click();
          await page.getByTestId("dialog-presentation-source").filter({ hasText: "当前节点" }).waitFor();
          await pick(page, "气泡锚点", "固定屏幕位置");
          await page.getByRole("spinbutton", { name: "气泡水平位置（%）", exact: true }).fill("65");
          await page.getByRole("spinbutton", { name: "气泡垂直位置（%）", exact: true }).fill("25");
          await pick(page, "角色默认呈现方式", "气泡对白");
          await pick(page, "对白呈现方式", "普通对白框");
          assert.match(await page.getByTestId("dialog-presentation-source").innerText(), /当前节点.*普通对白框/);
          await pick(page, "对白呈现方式", "继承角色 / 工程默认");
          assert.match(await page.getByTestId("dialog-presentation-source").innerText(), /角色默认.*气泡对白/);
          const stem = path.join(paths.output, `authored-${width}-dpr${dpr}`);
          const downloadPromise = page.waitForEvent("download");
          await page.getByRole("button", { name: "保存工程", exact: true }).click();
          const download = await downloadPromise;
          await download.saveAs(`${stem}.vnproj`);
          await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
          const projectBytes = Array.from(fs.readFileSync(`${stem}.vnproj`));
          const exported = await page.evaluate(async savedBytes => {
            const { useEditorStore } = await import("/src/store/editorStore.ts");
            const { useProjectStore } = await import("/src/store/projectStore.ts");
            const { applyProjectRuntimeSettingsToScript } = await import("/src/utils/exportScript.ts");
            const { readProjectJsonFromBundle } = await import("/src/utils/projectBundle.ts");
            const { exportEditorCartridge } = await import("/src/cartridge/exportCartridge.ts");
            const JSZip = (await import("/node_modules/.vite/deps/jszip.js")).default;
            const project = useProjectStore.getState(), editor = useEditorStore.getState();
            const reopened = await readProjectJsonFromBundle(new File([new Uint8Array(savedBytes)], "roundtrip.vnproj"));
            const script = { ...applyProjectRuntimeSettingsToScript(editor.exportScript(), project.settings),
              game_id: project.projectId, title: project.title };
            const cartridge = await exportEditorCartridge({ script, gameId: project.projectId,
              title: project.title, author: project.author, version: "1.0.0", language: "zh-CN",
              description: "", includeGallery: false, includeMetadata: false,
              projectAssets: [], projectAssetRefs: [], uiSkin: project.settings.runtimeUILayout });
            if (cartridge.errors.length) throw Error(cartridge.errors.join("\n"));
            const zip = await JSZip.loadAsync(await cartridge.blob.arrayBuffer());
            return { project: reopened, script: JSON.parse(await zip.file("script.json").async("string")),
              manifest: JSON.parse(await zip.file("manifest.json").async("string")),
              cartridgeBytes: Array.from(new Uint8Array(await cartridge.blob.arrayBuffer())) };
          }, projectBytes);
          assert.equal(exported.project.editor_settings.defaultDialogPresentation, "nvl");
          assert.equal(exported.project.editor_settings.characterDialogPresentations.alice, "bubble");
          assert.deepEqual(exported.project.nodes.find(n => n.id === "scene").data.scene.commands[0].bubble_position,
            { mode: "fixed", x: 65, y: 25 });
          assert.equal(exported.script.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
          assert.equal(exported.manifest.runtime_version, "0.18.0");
          fs.writeFileSync(`${stem}.vncart`, Buffer.from(exported.cartridgeBytes));
          report.cases.push({ name: "real-controls-project-cartridge-roundtrip", viewport: { width, height },
            dpr, status: "PASS", project: `${stem}.vnproj`, cartridge: `${stem}.vncart` });
          const reopenedPage = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
            reducedMotion: report.reduced ? "reduce" : "no-preference" });
          try {
            await reopenedPage.goto(env.url);
            await reopenedPage.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")]
              .some(node => node instanceof HTMLInputElement && !node.disabled), undefined, { timeout: 60000 });
            await reopenedPage.locator(".project-import-button input").first().setInputFiles(`${stem}.vnproj`);
            await reopenedPage.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 60000 });
            await reopenedPage.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
            await reopenedPage.locator('.react-flow__node[data-id="scene"]').click();
            const restoredCard = reopenedPage.locator(".command-card").filter({ hasText: "对白呈现创作验收" }).first();
            await restoredCard.locator(".command-card-summary").click();
            assert.match(await reopenedPage.getByTestId("dialog-presentation-source").innerText(), /角色默认.*气泡对白/);
            assert.equal(await reopenedPage.getByRole("spinbutton", { name: "气泡水平位置（%）", exact: true }).inputValue(), "65");
            assert.equal(await reopenedPage.getByRole("spinbutton", { name: "气泡垂直位置（%）", exact: true }).inputValue(), "25");
            await reopenedPage.getByRole("spinbutton", { name: "气泡水平位置（%）", exact: true }).scrollIntoViewIfNeeded();
            await reopenedPage.screenshot({ path: `${stem}-reopened.png` });
            report.cases.push({ name: "saved-project-real-reopen", viewport: { width, height }, dpr, status: "PASS" });
          } catch (error) {
            await reopenedPage.screenshot({ path: `${stem}-reopen-failure.png` }).catch(() => {});
            throw error;
          } finally { await reopenedPage.close(); }
          const runtime = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr,
            reducedMotion: report.reduced ? "reduce" : "no-preference" });
          try {
            await runtime.goto(`${env.url}/gamecli-preview/?preview=1&embedded=1`);
            await runtime.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
            await runtime.evaluate(data => window.postMessage({
              type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "authoring-flow",
              revision: 1, requestId: "authoring-flow", runId: "authoring-flow",
              screen: "title_menu", manifest: data.manifest, script: data.script, assetUrls: {},
            }, location.origin), { manifest: exported.manifest, script: exported.script });
            await runtime.getByTestId("start-new-game").click();
            await runtime.getByTestId("game-state-playing").waitFor();
            await runtime.locator('.dialog-box.is-bubble-presentation[data-dialog-bubble-anchor="fixed"]').waitFor({ timeout: 15000 });
            const actual = await runtime.locator(".dialog-box").evaluate(node => {
              const rect = node.getBoundingClientRect();
              const stage = node.closest(".story-player").getBoundingClientRect();
              return { anchor: node.dataset.dialogBubbleAnchor, rect: rect.toJSON(), stage: stage.toJSON(),
                overflow: document.documentElement.scrollWidth - innerWidth };
            });
            assert.equal(actual.anchor, "fixed", "Authored fixed anchor must reach actual Runtime");
            assert(actual.rect.width > 0 && actual.rect.left >= actual.stage.left - 1
              && actual.rect.right <= actual.stage.right + 1 && actual.rect.top >= actual.stage.top - 1
              && actual.rect.bottom <= actual.stage.bottom + 1 && actual.overflow <= 1,
            "Authored Runtime bubble must remain inside game frame");
            report.cases.push({ name: "authored-cartridge-real-runtime", viewport: { width, height }, dpr,
              status: "PASS", actual });
            await runtime.screenshot({ path: `${stem}-runtime.png` });
          } finally { await runtime.close(); }
        } catch (error) {
          await page.screenshot({ path: path.join(paths.output, `failure-${width}-dpr${dpr}.png`) }).catch(() => {});
          throw error;
        } finally { await page.close(); }
      }
    });
    assert.equal(report.cases.length, viewports.length * 6, "Empty/incomplete authoring matrix");
    assert(report.cases.every(row => row.status === "PASS"), "Dialogue authoring entries are incomplete");
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
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
