const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const harnessHtml = path.join(editorRoot, "selection-scroll-harness.html");
const harnessEntry = path.join(editorRoot, "src", "__selection_scroll_harness__.tsx");
const viteEntry = path.join(editorRoot, "node_modules", "vite", "bin", "vite.js");
const url = "http://127.0.0.1:6774/selection-scroll-harness.html";

const htmlSource = `
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
  <body><div id="root"></div><script type="module" src="/src/__selection_scroll_harness__.tsx"></script></body>
</html>
`;

const entrySource = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RichSelect } from "./components/common/RichSelect";
import "./styles/variables.css";
import "./styles/layout.css";

const longOptions = Array.from({ length: 40 }, (_, index) => ({
  value: \`option-\${index + 1}\`,
  label: \`选项 \${index + 1}\`,
  description: \`用于验证滚动的第 \${index + 1} 项\`,
}));
const shortOptions = [
  { value: "short-1", label: "短选项 1" },
  { value: "short-2", label: "短选项 2" },
];

function Harness() {
  const [longValue, setLongValue] = useState("option-1");
  const [shortValue, setShortValue] = useState("short-1");
  return (
    <main style={{ minHeight: 1500, padding: 24 }}>
      <section id="long-select">
        <RichSelect value={longValue} options={longOptions} ariaLabel="长列表" onChange={setLongValue} />
      </section>
      <div style={{ height: 1050 }} />
      <section id="short-select" style={{ marginTop: 420 }}>
        <RichSelect value={shortValue} options={shortOptions} ariaLabel="短列表" onChange={setShortValue} />
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
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Editor selection scroll harness did not start: ${url}`);
}

async function measureOpenSelect(page, label) {
  const result = await page.evaluate((ariaLabel) => {
    const trigger = document.querySelector(`[aria-label="${ariaLabel}"]`);
    const popover = document.querySelector(".rich-select-popover");
    const viewport = popover?.querySelector(".rich-select-viewport");
    if (!(trigger instanceof HTMLElement) || !(popover instanceof HTMLElement) || !(viewport instanceof HTMLElement)) {
      return null;
    }
    const popoverRect = popover.getBoundingClientRect();
    return {
      placement: popover.classList.contains("is-top") ? "top" : "bottom",
      optionCount: popover.querySelectorAll(".rich-select-option").length,
      clientHeight: viewport.clientHeight,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      popoverTop: popoverRect.top,
      popoverBottom: popoverRect.bottom,
      viewportHeight: window.innerHeight,
      overflow: getComputedStyle(popover).overflow,
      overflowY: getComputedStyle(viewport).overflowY,
      scrollbarWidth: getComputedStyle(viewport).scrollbarWidth,
    };
  }, label);
  assert(result, `${label} did not open a measurable RichSelect popover.`);
  return result;
}

async function verifyTheme(page, theme) {
  await page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    window.scrollTo(0, 0);
  }, theme);

  const longTrigger = page.getByRole("combobox", { name: "长列表" });
  await longTrigger.click();
  const longBefore = await measureOpenSelect(page, "长列表");
  assert(longBefore.scrollHeight > longBefore.clientHeight, `${theme}: long list must be scrollable.`, longBefore);
  assert(longBefore.overflow === "hidden", `${theme}: popover must not be a second scroll node.`, longBefore);
  assert(longBefore.overflowY === "auto", `${theme}: internal viewport must own vertical scrolling.`, longBefore);
  assert(longBefore.scrollbarWidth === "thin", `${theme}: scrollbar must be thin.`, longBefore);
  assert(longBefore.popoverTop >= 0 && longBefore.popoverBottom <= longBefore.viewportHeight, `${theme}: long popover must stay inside the viewport.`, longBefore);

  await longTrigger.press("End");
  await page.waitForTimeout(50);
  const longAfter = await page.evaluate(() => {
    const trigger = document.querySelector('[aria-label="长列表"]');
    const viewport = document.querySelector(".rich-select-viewport");
    const activeId = trigger?.getAttribute("aria-activedescendant");
    const active = activeId ? document.getElementById(activeId) : null;
    if (!(viewport instanceof HTMLElement) || !(active instanceof HTMLElement)) return null;
    const viewportRect = viewport.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    return {
      viewportRect: viewportRect.toJSON(),
      activeRect: activeRect.toJSON(),
      scrollTop: viewport.scrollTop,
      maxScrollTop: viewport.scrollHeight - viewport.clientHeight,
      activeText: active.textContent?.trim(),
      activeVisible: activeRect.top >= viewportRect.top - 1 && activeRect.bottom <= viewportRect.bottom + 1,
    };
  });
  assert(longAfter?.scrollTop > 0, `${theme}: End must scroll the long list.`, longAfter);
  assert(longAfter?.activeVisible, `${theme}: End-active option must remain visible.`, longAfter);
  assert(longAfter?.activeText?.includes("选项 40"), `${theme}: End must activate the final option.`, longAfter);
  await longTrigger.press("Escape");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const shortTrigger = page.getByRole("combobox", { name: "短列表" });
  await shortTrigger.click();
  const shortResult = await measureOpenSelect(page, "短列表");
  assert(shortResult.placement === "top", `${theme}: bottom trigger must use top placement.`, shortResult);
  assert(shortResult.scrollHeight === shortResult.clientHeight, `${theme}: short list must not have scroll overflow or extra height.`, shortResult);
  assert(shortResult.popoverTop >= 0 && shortResult.popoverBottom <= shortResult.viewportHeight, `${theme}: short popover must stay inside the viewport.`, shortResult);
  await shortTrigger.press("Escape");

  return { theme, longBefore, longAfter, shortResult };
}

async function run() {
  if (fs.existsSync(harnessHtml) || fs.existsSync(harnessEntry)) {
    throw new Error("Refusing to overwrite an existing selection scroll harness file.");
  }
  fs.writeFileSync(harnessHtml, htmlSource);
  fs.writeFileSync(harnessEntry, entrySource);

  const server = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "6774"], {
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
    const page = await browser.newPage({ viewport: { width: 420, height: 620 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.getByRole("combobox", { name: "长列表" }).waitFor();

    const results = [
      await verifyTheme(page, "blue_gray"),
      await verifyTheme(page, "white_gray"),
    ];
    assert(pageErrors.length === 0, "Selection scroll harness produced page errors.", pageErrors);
    console.log(JSON.stringify({ ok: true, viewport: { width: 420, height: 620 }, results }, null, 2));
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
