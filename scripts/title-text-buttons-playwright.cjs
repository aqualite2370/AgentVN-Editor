#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const esbuild = require("../editor/node_modules/esbuild");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/title-text-buttons", runId);
const port = 6995, origin = `http://127.0.0.1:${port}`;
const compiled = { exports: {} };
new Function("module", "exports", esbuild.buildSync({
  stdin: { contents: 'export { getDefaultUISkinLayout } from "./shared/cartridge/uiSkin";',
    resolveDir: root, loader: "ts" },
  platform: "node", format: "cjs", bundle: true, write: false,
}).outputFiles[0].text)(compiled, compiled.exports);
const report = { runId, ok: false, cases: [] };
const viewports = [{ width: 1920, height: 1080 }, { width: 757, height: 299 }, { width: 390, height: 844 }];
fs.mkdirSync(output, { recursive: true });
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
async function cartridge(variant) {
  const skin = compiled.exports.getDefaultUISkinLayout();
  if (variant !== "default") for (const component of skin.screens.find((s) => s.screen_id === "title").components) {
    if (!component.component_type.endsWith("_button")) continue;
    component.style = { backgroundColor: "#123456", color: "#ffffff", borderColor: "#ff0000",
      borderWidth: 3, borderRadius: 12, fontSize: 18, shadow: "strong", backdropBlur: 12 };
    if (variant === "authored") component.titleButtonStyleSource = "layout";
  }
  const now = new Date().toISOString();
  const manifest = { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.6.0",
    game_id: `title_text_${variant}`, title: "纯文字标题验收", author: "QA", version: "1.0.0",
    description: "", language: "zh-CN", entry_script: "script.json", entry_scene_id: "scene",
    assets: [], created_at: now, updated_at: now,
    ui_skin: { path: "ui/layout.json", version: skin.ui_layout_version, name: skin.name } };
  const script = { schema_version: "1.5.0", game_id: manifest.game_id, title: manifest.title,
    entry_scene_id: "scene", scenes: [{ scene_id: "scene", title: "Scene", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "标题按钮验收。" }, { type: "narration", text: "第二页。" }] }] };
  const entries = new Map(Object.entries({ "manifest.json": manifest, "script.json": script,
    "gallery.json": { gallery_version: "1.0.0", items: [] }, "ui/layout.json": skin })
    .map(([name, value]) => [name, Buffer.from(JSON.stringify(value))]));
  const checksum = { checksum_version: "1.0.0", algorithm: "sha256", generated_at: now,
    files: [...entries].map(([name, bytes]) => ({ path: name, size_bytes: bytes.length, hash_sha256: sha(bytes) })) };
  const zip = new JSZip();
  for (const [name, bytes] of entries) zip.file(name, bytes);
  zip.file("checksum.json", JSON.stringify(checksum));
  const target = path.join(output, `${variant}.vncart`);
  fs.writeFileSync(target, await zip.generateAsync({ type: "nodebuffer" }));
  return target;
}
async function ready() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Runtime server not ready");
}
async function metrics(page) {
  return page.locator(".menu-action-button:not(.custom-title-button)").evaluateAll((nodes) => nodes.map((node) => {
    const style = getComputedStyle(node), rect = node.getBoundingClientRect();
    const text = node.querySelector(".menu-action-label").getBoundingClientRect();
    return { id: node.dataset.uiComponentId, background: style.backgroundColor, image: style.backgroundImage,
      border: style.borderTopWidth, shadow: style.boxShadow, blur: style.backdropFilter,
      icons: node.querySelectorAll("svg, img").length, rect: rect.toJSON(), text: text.toJSON(),
      clickable: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth };
  }));
}
async function main() {
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  const server = spawn(process.execPath, [path.join(root, "GameCli_framework/node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--config", "vite.config.cjs", "--configLoader", "native"],
  { cwd: path.join(root, "GameCli_framework"), windowsHide: true, stdio: "ignore" });
  let browser, page;
  try {
    await ready();
    browser = await chromium.launch();
    for (const variant of (process.env.TITLE_VARIANTS || "default,legacy,authored").split(",")) {
      const file = await cartridge(variant);
      for (const viewport of viewports) {
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
        page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(origin);
        await page.getByTestId("web-cartridge-file").setInputFiles(file);
        await page.locator(".cartridge-spine").first().waitFor();
        await page.locator(".launch-actions button").first().click();
        await page.getByTestId("game-state-title").waitFor();
        const result = await metrics(page);
        report.cases.push({ variant, viewport, result });
        assert.equal(result.length, 5, "fresh game must show five available title actions");
        for (const item of result) {
          assert(item.clickable, `${item.id}: not reachable`);
          assert(item.rect.left >= 0 && item.rect.right <= viewport.width + 1
            && item.rect.top >= 0 && item.rect.bottom <= viewport.height + 1, `${item.id}: outside viewport`);
          assert(item.text.left >= item.rect.left && item.text.right <= item.rect.right + 1
            && item.text.top >= item.rect.top && item.text.bottom <= item.rect.bottom + 1, `${item.id}: text clipped`);
          assert(item.scrollWidth <= item.clientWidth + 1, `${item.id}: overflow`);
          assert.equal(item.icons, 0, `${item.id}: default title actions must be text only`);
          if (variant === "authored") {
            assert.equal(item.background, "rgb(18, 52, 86)", `${item.id}: explicit layout styling ignored`);
            assert.notEqual(item.border, "0px");
          } else {
            assert.equal(item.background, "rgba(0, 0, 0, 0)", `${item.id}: default has a filled surface`);
            assert.equal(item.image, "none", `${item.id}: default gradient remains`);
            assert.equal(item.border, "0px", `${item.id}: default border remains`);
            assert.equal(item.shadow, "none", `${item.id}: default surface shadow remains`);
            assert(["none", "blur(0px)"].includes(item.blur), `${item.id}: default blur remains`);
          }
        }
        for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
          const a = result[i].rect, b = result[j].rect;
          assert(Math.min(a.right, b.right) - Math.max(a.left, b.left) <= 1
            || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) <= 1, "title actions overlap");
        }
        await page.getByTestId("open-settings").click();
        await page.getByTestId("settings-screen").waitFor();
        await page.getByTestId("open-exit-confirmation").click();
        const exitDialog = page.getByRole("dialog", { name: "退出游戏？", exact: true });
        await exitDialog.waitFor();
        await exitDialog.getByRole("button", { name: "取消", exact: true }).click();
        await exitDialog.waitFor({ state: "hidden" });
        await page.getByTestId("settings-finish").click();
        await page.getByTestId("open-about").click();
        await page.getByTestId("about-screen").waitFor();
        await page.getByTestId("back-to-main-menu").click();
        await page.getByTestId("open-save-load").click();
        await page.getByTestId("save-slot-grid").waitFor();
        await page.getByTestId("back-to-player").click();
        await page.getByTestId("open-gallery").click();
        await page.getByTestId("gallery-screen").waitFor();
        await page.getByTestId("back-to-main-menu").click();
        const start = page.getByTestId("start-new-game");
        for (let i = 0; i < 20 && !await start.evaluate((node) => node === document.activeElement); i++) {
          await page.keyboard.press("Tab");
        }
        assert(await start.evaluate((node) => node === document.activeElement), "title start unreachable by keyboard");
        assert.equal(await start.evaluate((node) => getComputedStyle(node).textDecorationLine), "underline",
          "keyboard focus must remain visible without a surface");
        await page.screenshot({ path: path.join(output, `${variant}-${viewport.width}.png`) });
        await start.press("Enter");
        await page.getByTestId("game-state-playing").waitFor();
        await page.locator(".dialog-text").waitFor();
        await page.getByTestId("quick-menu-toggle").click();
        await page.getByTestId("open-main-menu").click();
        await page.getByTestId("continue-game").waitFor();
        await page.getByTestId("continue-game").click({ trial: true });
        const continued = (await metrics(page)).find((item) => item.id === "title_continue_button");
        assert(continued?.clickable, "continue button not reachable");
        assert.equal(continued.icons, 0);
        assert.equal(continued.background, variant === "authored" ? "rgb(18, 52, 86)" : "rgba(0, 0, 0, 0)");
        await page.getByTestId("continue-game").click();
        await page.getByTestId("game-state-playing").waitFor();
        report.cases.at(-1).continueButton = continued;
        assert.deepEqual(errors, []);
        await context.close();
      }
    }
    report.ok = true;
  } catch (error) {
    report.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    if (server.pid && server.exitCode === null) spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
main().then(() => console.log("title-text-buttons-playwright: PASS")).catch((error) => { console.error(error); process.exitCode = 1; });
