#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const outputDir = path.join(root, "output", "playwright", "advanced-tools-page-commit");
const editorUrl = "http://127.0.0.1:6767/";
const backendUrl = "http://127.0.0.1:8278/api/health";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function ready(url) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server not ready: ${url}`);
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {}
}

async function openImportedProject(page) {
  await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".project-import-button input").first().waitFor({ state: "attached", timeout: 30_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".project-import-button input")].some((input) => (
    input instanceof HTMLInputElement && !input.disabled
  )), undefined, { timeout: 30_000 });
  await page.locator(".project-import-button input").first().setInputFiles(fixture);
  await page.waitForFunction(() => [...document.querySelectorAll(".recent-project-open")].some((node) => {
    const rect = node.getBoundingClientRect();
    return node.textContent?.includes("隐忍的成长")
      && !(node instanceof HTMLButtonElement && node.disabled)
      && rect.width > 0
      && rect.height > 0;
  }), undefined, { timeout: 90_000 });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".recent-project-open")].find((node) => {
      const rect = node.getBoundingClientRect();
      return node.textContent?.includes("隐忍的成长")
        && !(node instanceof HTMLButtonElement && node.disabled)
        && rect.width > 0
        && rect.height > 0;
    });
    if (!(button instanceof HTMLElement)) throw new Error("stable imported project button not found");
    button.click();
  });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 90_000 });
  await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 20_000 });
}

async function runViewport(browser, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });

  try {
    await openImportedProject(page);
    await page.locator('[data-help-key="toolbar.advanced"]:visible').first().click({ force: true });
    await page.locator(".toolbar-popover.advanced.is-open").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => (
      document.querySelector(".advanced-tab-content.is-active")?.getAttribute("data-tab") === "settings"
      && document.querySelector(".project-settings-panel")
    ), undefined, { timeout: 30_000 });

    // A busy editor may legitimately have no idle window for more than a
    // second. Tab navigation must still commit promptly and must not depend on
    // requestIdleCallback before the real page becomes active.
    await page.evaluate(() => {
      window.requestIdleCallback = (callback, options) => window.setTimeout(
        () => callback({
          didTimeout: true,
          timeRemaining: () => 0,
        }),
        options?.timeout ?? 1_200,
      );
      window.cancelIdleCallback = (id) => window.clearTimeout(id);
    });

    const sequence = ["layout", "library", "animation", "theme"];
    for (const tab of sequence) {
      await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).first().evaluate((node) => {
        if (!(node instanceof HTMLButtonElement)) throw new Error("advanced tab target is not a button");
        node.click();
      });
      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(700);
    const state = await page.evaluate(() => {
      const selected = document.querySelector(
        ".advanced-tools-panel > nav [data-glass-selected='true']",
      );
      const activeLayer = document.querySelector(".advanced-tab-content.is-active");
      const activePage = [
        ["settings", ".project-settings-panel"],
        ["layout", ".runtime-layout-designer"],
        ["theme", ".runtime-theme-designer"],
        ["library", ".asset-library-panel"],
        ["animation", ".animation-editor-shell"],
      ].find(([, selector]) => activeLayer?.querySelector(selector))?.[0] ?? null;
      return {
        selectedTab: selected?.getAttribute("data-help-key")?.replace("advanced.tab.", "") ?? null,
        activeTab: activeLayer?.getAttribute("data-tab") ?? null,
        activePage,
        layers: [...document.querySelectorAll(".advanced-tab-content")].map((node) => ({
          tab: node.getAttribute("data-tab"),
          className: node.className,
          hidden: node.hidden,
          opacity: getComputedStyle(node).opacity,
        })),
        panelClass: document.querySelector(".advanced-tools-panel")?.className ?? "",
      };
    });

    await page.screenshot({
      path: path.join(outputDir, `${viewport.width}x${viewport.height}.png`),
      fullPage: false,
    });
    assert(
      state.selectedTab === "theme"
        && state.activeTab === "theme"
        && state.activePage === "theme",
      `${viewport.width}x${viewport.height}: rapid tab navigation left the selected tab and real page out of sync`,
      state,
    );
    assert(errors.length === 0, `${viewport.width}x${viewport.height}: browser errors`, errors);
    return { viewport, state };
  } finally {
    await page.close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const staleError = path.join(outputDir, "error.txt");
  if (fs.existsSync(staleError)) fs.unlinkSync(staleError);

  const backend = spawn("python", ["backend_launcher.py"], {
    cwd: path.join(root, "backend"),
    windowsHide: true,
    stdio: "ignore",
  });
  const editor = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6767"], {
    cwd: path.join(root, "editor"),
    windowsHide: true,
    stdio: "ignore",
  });
  let browser;
  try {
    await ready(backendUrl);
    await ready(editorUrl);
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const viewport of [
      { width: 1040, height: 559 },
      { width: 2560, height: 1392 },
      { width: 390, height: 844 },
    ]) {
      results.push(await runViewport(browser, viewport));
    }
    fs.writeFileSync(path.join(outputDir, "result.json"), JSON.stringify({ ok: true, results }, null, 2));
    console.log(`advanced-tools-page-commit-playwright: PASS (${outputDir})`);
  } finally {
    await browser?.close().catch(() => {});
    stop(editor);
    stop(backend);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error);
  process.exitCode = 1;
});
