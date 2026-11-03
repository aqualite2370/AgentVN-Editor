#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const harnessHtml = path.join(editorRoot, "command-list-append-scroll-harness.html");
const harnessEntry = path.join(editorRoot, "src", "__command_list_append_scroll_harness__.tsx");
const viteEntry = path.join(editorRoot, "node_modules", "vite", "bin", "vite.js");
const url = "http://127.0.0.1:6776/command-list-append-scroll-harness.html";

const htmlSource = `
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body><div id="root"></div><script type="module" src="/src/__command_list_append_scroll_harness__.tsx"></script></body>
</html>
`;

const entrySource = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CommandListEditor } from "./components/command-editors/CommandListEditor";
import type { GameCommand } from "./types/commands";
import "./styles/variables.css";
import "./styles/layout.css";

const seedCommands: GameCommand[] = Array.from({ length: 24 }, (_, index) => ({
  type: "narration",
  text: "事件 " + (index + 1),
}));

function Harness() {
  const [commands, setCommands] = useState(seedCommands);
  return (
    <main style={{ padding: 20 }}>
      <button
        type="button"
        data-testid="append-command"
        onClick={() => setCommands((current) => [...current, { type: "narration", text: "新增事件" }])}
      >
        追加事件
      </button>
      <section
        className="inspector-panel"
        data-testid="inspector-scroll"
        style={{ height: 360, overflow: "auto", display: "block", padding: 12 }}
      >
        <CommandListEditor commands={commands} sceneId="scene_scroll" onChange={setCommands} />
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Command list scroll harness did not start: ${url}`);
}

async function inspect(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-testid='inspector-scroll']");
    const cards = Array.from(document.querySelectorAll(".command-card"));
    const last = cards.at(-1);
    const lastHeader = last?.querySelector(".command-card-header");
    const panelRect = panel?.getBoundingClientRect();
    const lastRect = lastHeader?.getBoundingClientRect();
    return {
      scrollTop: panel?.scrollTop ?? 0,
      scrollHeight: panel?.scrollHeight ?? 0,
      clientHeight: panel?.clientHeight ?? 0,
      panelTop: panelRect?.top ?? 0,
      panelBottom: panelRect?.bottom ?? 0,
      lastTop: lastRect?.top ?? 0,
      lastBottom: lastRect?.bottom ?? 0,
      count: cards.length,
    };
  });
}

async function run() {
  if (fs.existsSync(harnessHtml) || fs.existsSync(harnessEntry)) {
    throw new Error("Refusing to overwrite an existing command list scroll harness file.");
  }
  fs.writeFileSync(harnessHtml, htmlSource);
  fs.writeFileSync(harnessEntry, entrySource);

  const server = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "6776"], {
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
    for (const viewport of [
      { width: 757, height: 299 },
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const panel = page.locator("[data-testid='inspector-scroll']");
      await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const before = await inspect(page);
      await page.getByTestId("append-command").click();
      await page.waitForFunction(() => document.querySelectorAll(".command-card").length === 25);
      await page.waitForTimeout(150);
      const after = await inspect(page);
      assert(after.count === 25, `${viewport.width}x${viewport.height}: appended card must exist`, after);
      assert(after.scrollTop >= before.scrollTop - 24, `${viewport.width}x${viewport.height}: append must not jump the inspector to the top`, { before, after });
      assert(after.lastTop >= after.panelTop - 2 && after.lastBottom <= after.panelBottom + 2, `${viewport.width}x${viewport.height}: appended card header must be visible in the inspector`, { before, after });
      await context.close();
    }
    console.log("command list append scroll test OK");
  } catch (error) {
    if (serverLog.trim()) console.error(serverLog.trim());
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    throw error;
  } finally {
    await browser?.close();
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    if (fs.existsSync(harnessEntry)) fs.unlinkSync(harnessEntry);
    if (fs.existsSync(harnessHtml)) fs.unlinkSync(harnessHtml);
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
