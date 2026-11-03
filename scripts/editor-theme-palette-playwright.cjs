#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const editorRoot = path.join(root, "editor");
const html = path.join(editorRoot, "theme-palette-harness.html");
const entry = path.join(editorRoot, "src", "__theme_palette_harness__.tsx");
const url = "http://127.0.0.1:6775/theme-palette-harness.html";

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

fs.writeFileSync(html, "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/__theme_palette_harness__.tsx\"></script></body></html>");
fs.writeFileSync(entry, `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { defaultRuntimeThemePresetId, runtimeThemePresets } from "../../shared/cartridge/uiThemePresets";
import "./styles/variables.css";
const themes = runtimeThemePresets.slice(0, 3);
const storageKey = "agentvn.runtimeThemePreset";
function App() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    const valid = themes.some((item) => item.preset_id === stored);
    const next = valid ? stored : defaultRuntimeThemePresetId;
    localStorage.setItem(storageKey, next);
    return next;
  });
  const preset = themes.find((item) => item.preset_id === theme) ?? themes[0];
  return <main data-testid="runtime-theme" style={{
    background: preset.tokens.colorBackground,
    color: preset.tokens.colorInk,
    borderColor: preset.tokens.colorLine,
    minHeight: "100vh",
    padding: 24,
  }}>
    <h1>客户端主题</h1>
    <select aria-label="客户端主题" value={theme} onChange={(event) => {
      localStorage.setItem(storageKey, event.target.value);
      setTheme(event.target.value);
    }}>{themes.map((item) => <option key={item.preset_id} value={item.preset_id}>{item.name}</option>)}</select>
    <p data-testid="current">{preset.preset_id}</p>
  </main>;
}
createRoot(document.getElementById("root")).render(<App />);
`);

async function waitForServer() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("theme harness timeout");
}

(async () => {
  const vite = spawn(process.execPath, [path.join(editorRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "6775"], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: "ignore",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    await waitForServer();
    for (const viewport of [
      { name: "reported-757x299", width: 757, height: 299 },
      { name: "wide-desktop", width: 1440, height: 900 },
      { name: "narrow-mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        isMobile: viewport.width < 900,
        hasTouch: viewport.width < 900,
      });
      await page.goto(url);
      const initial = await page.evaluate(() => ({
        value: document.querySelector("select").value,
        options: [...document.querySelectorAll("option")].map((node) => node.value),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert(initial.options.join(",") === "kanagawa,nord,rose_pine", "client theme order mismatch", { viewport, initial });
      assert(initial.value === "kanagawa", "client theme default must be Kanagawa", { viewport, initial });
      await page.selectOption("select", "nord");
      await page.reload();
      const persisted = await page.locator("select").inputValue();
      assert(persisted === "nord", "client theme must persist across refresh", { viewport, persisted });
      const readable = await page.evaluate(() => {
        const element = document.querySelector("[data-testid='runtime-theme']");
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          color: style.color,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });
      assert(readable.scrollWidth <= readable.clientWidth, "client theme layout overflows", { viewport, readable });
      assert(readable.color !== "rgba(0, 0, 0, 0)", "client theme text must remain visible", { viewport, readable });
      await page.close();
    }
    console.log("editor-theme-palette-playwright: PASS (client runtime themes)");
  } finally {
    await browser.close();
    try {
      execFileSync("taskkill.exe", ["/PID", String(vite.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      vite.kill();
    }
    try {
      fs.rmSync(html, { force: true });
      fs.rmSync(entry, { force: true });
    } catch {}
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
