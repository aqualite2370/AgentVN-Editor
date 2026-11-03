#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const harnessHtml = path.join(editorRoot, "command-workbench-insert-harness.html");
const harnessEntry = path.join(editorRoot, "src", "__command_workbench_insert_harness__.tsx");
const viteEntry = path.join(editorRoot, "node_modules", "vite", "bin", "vite.js");
const url = "http://127.0.0.1:6775/command-workbench-insert-harness.html";

const htmlSource = `
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body><div id="root"></div><script type="module" src="/src/__command_workbench_insert_harness__.tsx"></script></body>
</html>
`;

const entrySource = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FloatingCommandWorkbench } from "./components/command-editors/FloatingCommandWorkbench";
import { CommandListEditor } from "./components/command-editors/CommandListEditor";
import type { GameCommand } from "./types/commands";
import "./styles/variables.css";
import "./styles/layout.css";

const seedCommands: GameCommand[] = [
  { type: "narration", text: "第一事件" },
  { type: "narration", text: "第二事件" },
  { type: "narration", text: "第三事件" },
];

function Harness() {
  const [commands, setCommands] = useState(seedCommands);
  return (
    <main style={{ minHeight: 1500, padding: 24 }}>
      <div className="editor-workspace" style={{ minHeight: 1200 }}>
        <div className="flow-surface" style={{ minHeight: 1100 }} />
      </div>
      <FloatingCommandWorkbench
        sceneId="scene_test"
        commands={commands}
        onAdd={(command) => setCommands((current) => [...current, command])}
        onInsert={(command, afterIndex) => setCommands((current) => [
          ...current.slice(0, afterIndex),
          command,
          ...current.slice(afterIndex),
        ])}
      />
      <section aria-label="场景事件列表">
        <CommandListEditor commands={commands} sceneId="scene_test" onChange={setCommands} />
      </section>
    </main>
  );
}

document.documentElement.dataset.theme = "blue_gray";
createRoot(document.getElementById("root")!).render(<Harness />);
`;

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Command workbench harness did not start: ${url}`);
}

async function inspectLayout(page) {
  return page.evaluate(() => {
    const workbench = document.querySelector(".floating-command-workbench");
    const actions = document.querySelector(".workbench-submit-actions");
    const buttons = Array.from(document.querySelectorAll(".workbench-submit-actions > button"));
    const body = document.body.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rects = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    const actionRect = actions?.getBoundingClientRect();
    const workbenchRect = workbench?.getBoundingClientRect();
    return {
      rects,
      actionRect: actionRect ? { left: actionRect.left, right: actionRect.right, width: actionRect.width } : null,
      workbenchRect: workbenchRect ? { left: workbenchRect.left, right: workbenchRect.right, top: workbenchRect.top, bottom: workbenchRect.bottom } : null,
      documentWidth: document.documentElement.scrollWidth,
      viewport,
      bodyWidth: body.width,
    };
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const layout = await inspectLayout(page);
  assert(layout.documentWidth <= layout.viewport.width + 1, `${label}: page must not overflow horizontally.`, layout);
  assert(layout.workbenchRect && layout.workbenchRect.left >= -1 && layout.workbenchRect.right <= layout.viewport.width + 1, `${label}: workbench must stay inside viewport.`, layout);
  assert(layout.rects.length === 2, `${label}: both submit buttons must be rendered.`, layout);
  const [append, insert] = layout.rects;
  assert(Math.abs(append.width - insert.width) <= Math.max(2, append.width * 0.08), `${label}: submit buttons must be approximately equal width.`, layout);
  assert(append.right <= insert.left + 2, `${label}: submit buttons must not overlap.`, layout);
}

async function verifyViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "插入到场景" }).waitFor();
  await assertNoHorizontalOverflow(page, `${viewport.width}x${viewport.height}`);

  const insertButton = page.getByRole("button", { name: "插入到场景" });
  await insertButton.click();
  const input = page.getByRole("spinbutton", { name: "插入到第几个事件之后" });
  await input.waitFor();
  assert(await input.evaluate((element) => document.activeElement === element), `${viewport.width}x${viewport.height}: insert input must receive focus.`);
  const popupLayout = await page.evaluate(() => {
    const popup = document.querySelector(".workbench-insert-popover");
    const rect = popup?.getBoundingClientRect();
    return rect ? {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      transform: getComputedStyle(popup).transform,
      opacity: getComputedStyle(popup).opacity,
    } : null;
  });
  assert(popupLayout && popupLayout.left >= 0 && popupLayout.right <= viewport.width + 1 && popupLayout.top >= 0 && popupLayout.bottom <= viewport.height + 1, `${viewport.width}x${viewport.height}: insert popover must stay inside viewport.`, popupLayout);
  assert(popupLayout.opacity !== "0", `${viewport.width}x${viewport.height}: insert popover must be visible.`, popupLayout);

  await input.fill("0");
  await page.getByRole("button", { name: "确认插入" }).click();
  await page.getByText("请输入 1 到 3 之间的整数序号").waitFor();
  assert(await page.locator(".command-card").count() === 3, `${viewport.width}x${viewport.height}: invalid input must not change command count.`);

  await input.fill("1.5");
  await page.getByRole("button", { name: "确认插入" }).click();
  await page.getByText("请输入 1 到 3 之间的整数序号").waitFor();

  await input.fill("2");
  await page.getByRole("button", { name: "确认插入" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".command-card").length === 4);
  await page.waitForTimeout(900);
  const summaries = await page.locator(".command-card-summary strong").allTextContents();
  assert(summaries[0]?.includes("1. 旁白"), `${viewport.width}x${viewport.height}: first command should remain first.`, summaries);
  assert(summaries[1]?.includes("2. 旁白"), `${viewport.width}x${viewport.height}: second command should remain second.`, summaries);
  assert(summaries[2]?.includes("3. 背景音乐"), `${viewport.width}x${viewport.height}: inserted command should appear after the second command.`, summaries);
  assert(summaries[3]?.includes("4. 旁白"), `${viewport.width}x${viewport.height}: original third command should shift after insertion.`, summaries);
  const visibleInserted = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".command-card"));
    const card = cards[2];
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      visible: rect.bottom > 0 && rect.top < window.innerHeight,
      expanded: card.classList.contains("is-expanded"),
      text: card.textContent?.trim(),
      rect: rect.toJSON(),
    };
  });
  assert(visibleInserted?.visible, `${viewport.width}x${viewport.height}: inserted command must be visible after insertion.`, visibleInserted ?? { missing: true });
  assert(visibleInserted?.expanded, `${viewport.width}x${viewport.height}: inserted command must be expanded.`, visibleInserted);

  await insertButton.click();
  await page.getByRole("spinbutton", { name: "插入到第几个事件之后" }).press("Escape");
  assert(await page.getByRole("spinbutton", { name: "插入到第几个事件之后" }).count() === 0, `${viewport.width}x${viewport.height}: Escape must close insert popover.`);

  const finalLayout = await inspectLayout(page);
  await context.close();
  assert(pageErrors.length === 0, `${viewport.width}x${viewport.height}: page errors detected.`, pageErrors);
  return { viewport, layout: finalLayout, popupLayout, summaries, visibleInserted };
}

async function verifyCameraDisabled(browser) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "运镜", exact: true }).click();
  const insertButton = page.getByRole("button", { name: "插入到场景" });
  assert(await insertButton.isDisabled(), "camera mode: insert button must be disabled.");
  await context.close();
}

async function verifyReducedMotion(browser) {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "插入到场景" }).click();
  const motion = await page.evaluate(() => {
    const popover = document.querySelector(".workbench-insert-popover");
    return popover ? {
      transform: getComputedStyle(popover).transform,
      animationName: getComputedStyle(popover).animationName,
      transitionDuration: getComputedStyle(popover).transitionDuration,
    } : null;
  });
  assert(motion && (motion.transform === "none" || motion.transform === "matrix(1, 0, 0, 1, 0, 0)"), "reduced motion: popover must not translate or scale.", motion);
  await context.close();
}

async function run() {
  if (fs.existsSync(harnessHtml) || fs.existsSync(harnessEntry)) {
    throw new Error("Refusing to overwrite an existing command workbench harness file.");
  }
  fs.writeFileSync(harnessHtml, htmlSource);
  fs.writeFileSync(harnessEntry, entrySource);

  const server = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "6775"], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const results = [];
    for (const viewport of [
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      results.push(await verifyViewport(browser, viewport));
    }
    await verifyCameraDisabled(browser);
    await verifyReducedMotion(browser);
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } catch (error) {
    if (serverLog.trim()) console.error(serverLog.trim());
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    throw error;
  } finally {
    await browser?.close();
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
    if (fs.existsSync(harnessEntry)) fs.unlinkSync(harnessEntry);
    if (fs.existsSync(harnessHtml)) fs.unlinkSync(harnessHtml);
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
