#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const outputDir = path.join(root, "output", "hidden-growth", "editor-background-resume");
const editorUrl = "http://127.0.0.1:6767/";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function ready(url, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server not ready: ${url}`);
}

function startEditor() {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawn(npm, ["run", "dev", "--", "--host", "127.0.0.1", "--port", "6767"], {
    cwd: editorRoot,
    windowsHide: true,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {}
}

async function importFixture(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  const input = page.locator(".project-import-button input").first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => {
    const node = document.querySelector(".project-import-button input");
    return Boolean(node && !node.disabled);
  }, undefined, { timeout: 30_000 });
  await input.setInputFiles(fixture);
  const openDraft = page.locator('[data-help-key="home.openDraft"]:visible, [data-help-key="home.recentProject"]:visible').first();
  await openDraft.waitFor({ state: "visible", timeout: 45_000 });
  await openDraft.click({ force: true });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
}

async function measure(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
    const shell = rect(".editor-shell");
    const workspace = rect(".editor-workspace");
    const preview = rect(".preview-panel");
    const flow = rect(".flow-surface");
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      revision: document.querySelector(".editor-shell")?.getAttribute("data-viewport-revision") ?? null,
      shell,
      workspace,
      preview,
      flow,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
    };
  });
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  let server;
  try {
    await ready(editorUrl).catch(() => { server = startEditor(); });
    await ready(editorUrl);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await importFixture(page);

    const before = await measure(page);
    assert(before.shell?.width > 1000 && before.workspace?.width > 1000, "baseline editor layout is unexpectedly compressed", before);

    await page.setViewportSize({ width: 757, height: 299 });
    await page.waitForTimeout(180);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new PageTransitionEvent("pageshow"));
    });
    await page.waitForTimeout(320);

    const after = await measure(page);
    assert(after.revision !== null && Number(after.revision) > Number(before.revision ?? 0), "resume did not trigger an observable viewport recovery pass", { before, after });
    assert(after.shell?.width > 1000 && after.workspace?.width > 1000, "editor shell/workspace remained compressed after resume", { before, after });
    assert(after.preview && after.preview.right <= after.viewport.width + 1, "preview panel escaped viewport after resume", { before, after });
    assert(after.documentScrollWidth <= after.documentClientWidth + 1, "editor gained horizontal overflow after resume", { before, after });

    await page.screenshot({ path: path.join(outputDir, "after-resume.png"), fullPage: false });
    const report = { ok: true, before, after };
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await browser.close();
    console.log(`editor-background-resume-playwright: PASS (${outputDir})`);
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    stop(server);
  }
})();

