#!/usr/bin/env node
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { readZipEntrySync } = require("./project-container.cjs");

const root = path.resolve(__dirname, "..");
assert(process.argv[2], "Pass the report.json from the real project import/export run.");
const inputReport = path.resolve(process.argv[2]);
const prior = JSON.parse(fs.readFileSync(inputReport, "utf8"));
assert(prior.sourcePreserved && prior.reopened && prior.cartridge, "Input run has not passed export.");
const cartridge = prior.cartridge.path;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/large-project-native-preview", runId);
const preview = path.join(output, "preview");
const exe = path.join(root, "editor/src-tauri/binaries/agentvn-player.exe");
const port = 9493;
const report = { runId, inputReport, cartridge: prior.cartridge, exe, port, ok: false, errors: [], stages: [] };
fs.mkdirSync(preview, { recursive: true });
const stage = (name) => { report.stages.push({ name, at: new Date().toISOString() }); console.log(name); };
async function hash(file) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function previewSaves() {
  const directory = path.join(process.env.APPDATA, "com.agentvn.player/saves/preview_gamecli");
  const files = {};
  async function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else files[path.relative(directory, full)] = await hash(full);
    }
  }
  await walk(directory);
  return { directory, files };
}
async function main() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  assert.equal(await hash(cartridge), prior.cartridge.sha256, "Cartridge hash differs from export.");
  report.previewSavesBefore = await previewSaves();
  report.exeSha256 = await hash(exe);
  // Extract only the manifest-declared files plus metadata into a new run
  // directory; never overwrite or clear the user's current preview cache.
  const manifest = JSON.parse(readZipEntrySync(cartridge, "manifest.json").toString("utf8"));
  const files = new Set(["manifest.json", "script.json", "checksum.json", "gallery.json", "startup-index.json",
    manifest.ui_skin?.path || "ui/layout.json", ...manifest.assets.map((asset) => asset.path)]);
  const optional = new Set(["gallery.json", "startup-index.json"]);
  for (const relative of files) {
    const destination = path.resolve(preview, relative);
    assert(destination.startsWith(`${preview}${path.sep}`), `Unsafe cartridge entry: ${relative}`);
    let bytes;
    try { bytes = readZipEntrySync(cartridge, relative); }
    catch (error) { if (optional.has(relative) && /missing /.test(String(error))) continue; throw error; }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: "wx" });
  }
  stage("preview-extracted");
  const webview = path.join(output, "webview");
  const child = spawn(exe, ["--mode", "preview", "--preview-root", preview], {
    cwd: path.dirname(exe), windowsHide: false, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=*` },
  });
  report.pid = child.pid;
  report.webview = webview;
  const log = fs.createWriteStream(path.join(output, "native.log"));
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on("exit", (code, signal) => { report.exit = { code, signal, at: new Date().toISOString() }; });
  let browser, page;
  try {
    let ready = false;
    for (let i = 0; i < 150; i += 1) {
      if (child.exitCode !== null) throw new Error(`Player exited: ${child.exitCode}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) { ready = true; break; } } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert(ready, "Native WebView CDP unavailable.");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    for (let i = 0; i < 100 && !page; i += 1) {
      page = context.pages().find((candidate) => !candidate.url().startsWith("devtools:"));
      if (!page) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(page, "Native runtime page missing.");
    page.setDefaultTimeout(45000);
    page.on("pageerror", (error) => report.errors.push(String(error)));
    await page.getByTestId("start-new-game").waitFor({ state: "visible", timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector(".boot-overlay"));
    stage("native-title-ready");
    report.title = await page.getByTestId("start-new-game").evaluate((button) => {
      const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { rect: rect.toJSON(), background: style.backgroundColor, border: style.borderTopWidth,
        shadow: style.boxShadow, iconCount: button.querySelectorAll("svg").length, left: button.style.left,
        text: button.textContent, width: innerWidth, height: innerHeight,
        clickable: hit === button || button.contains(hit) };
    });
    assert.equal(report.title.background, "rgba(0, 0, 0, 0)", "Native default title button is not text only.");
    assert.equal(report.title.iconCount, 0, "Native default title button has an icon.");
    assert.equal(parseFloat(report.title.left), prior.layoutSave.nextX, "Native title lost the saved X coordinate.");
    assert(report.title.clickable && report.title.rect.x >= 0 && report.title.rect.y >= 0
      && report.title.rect.right <= report.title.width && report.title.rect.bottom <= report.title.height,
    "Native title button is clipped or cannot be hit.");
    await page.screenshot({ path: path.join(output, "native-title.png") });
    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-screen").waitFor();
    const autoSave = page.getByRole("checkbox", { name: "自动存档", exact: true });
    if (!await autoSave.isVisible()) {
      report.settingsUi = await page.getByTestId("settings-screen").innerText();
      await page.locator(".settings-tabs").getByRole("button", { name: "系统", exact: true }).click();
    }
    await autoSave.uncheck();
    assert(!await autoSave.isChecked(), "Test must not write shared preview autosaves.");
    report.autoSaveDisabledInIsolatedWebview = true;
    await page.getByTestId("settings-finish").click();
    await page.getByTestId("open-about").click();
    await page.getByTestId("about-screen").waitFor();
    await page.getByTestId("back-to-main-menu").click();
    stage("native-settings-about-return");
    await page.getByTestId("start-new-game").click();
    await page.getByTestId("game-state-playing").waitFor({ timeout: 60000 });
    await page.locator(".dialog-text").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForFunction(() => (document.querySelector(".dialog-text")?.textContent || "").trim().length > 3);
    const background = await page.locator('.background-transition-frame.is-current').evaluate(async (node) => {
      const style = getComputedStyle(node);
      const url = /^url\(["']?(.*?)["']?\)$/.exec(style.backgroundImage)?.[1];
      if (!url) return { assetId: node.getAttribute("data-background-id"), loaded: false };
      const image = new Image();
      image.src = url;
      await image.decode();
      return { assetId: node.getAttribute("data-background-id"), url,
        loaded: image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight };
    });
    assert(background.loaded && manifest.assets.some((asset) => asset.asset_id === background.assetId),
      `Native background is not the real exported asset: ${JSON.stringify(background)}`);
    report.playing = await page.evaluate(() => ({
      text: document.querySelector(".dialog-text")?.textContent,
      imageState: [...document.querySelectorAll(".background-layer img, .sprite-visual")].map((image) => ({
        src: image.src, loaded: image.complete && image.naturalWidth > 0,
      })),
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    report.playing.background = background;
    assert(report.playing.text && report.playing.overflow <= 1, "Native first scene blank or overflowing.");
    assert(report.playing.imageState.every((image) => image.loaded), "Native scene contains an undecoded image.");
    await page.screenshot({ path: path.join(output, "native-playing.png") });
    stage("native-first-scene");
    if (process.env.AGENTVN_NATIVE_OBSERVE === "1") await page.waitForTimeout(30000);
    assert.deepEqual(report.errors, [], "Native runtime page errors.");
    report.previewSavesAfter = await previewSaves();
    assert.deepEqual(report.previewSavesAfter, report.previewSavesBefore, "Native smoke changed user preview saves.");
    report.ok = true;
  } catch (error) {
    report.error = String(error.stack || error);
    if (page && !page.isClosed()) {
      report.lastUi = await page.locator("body").innerText().catch(() => "");
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
    }
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, encoding: "utf8" });
    report.ownedProcessCleanup = { exitStatus: stopped.status, alreadyExited: child.exitCode !== null };
    report.previewSavesAfter = await previewSaves();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`Evidence: ${output}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
