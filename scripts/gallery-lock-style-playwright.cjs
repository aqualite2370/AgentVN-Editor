#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const root = path.resolve(__dirname, "..");
const runtimeRoot = path.join(root, "GameCli_framework");
const baseUrl = "http://127.0.0.1:6868/?mode=preview";
const outputDir = path.join(root, "output", "playwright", "gallery-lock-style");
const gameId = "gallery-lock-style";
function assert(ok, message, details) { if (!ok) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`); }
async function ready() { for (let i = 0; i < 120; i += 1) { try { if ((await fetch(baseUrl)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 250)); } throw new Error("runtime server not ready"); }
function stop(child) { if (!child?.pid) return; try { spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} }
const payload = {
  manifest: { manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.6.0", game_id: gameId, title: "画廊锁样式验收", author: "QA", version: "1.0.0", description: "", language: "zh-CN", entry_script: "script.json", entry_scene_id: "scene", assets: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  script: { schema_version: "1.5.0", game_id: gameId, title: "画廊锁样式验收", entry_scene_id: "scene", characters: [], scenes: [{ scene_id: "scene", title: "Scene", chapter: 1, tags: [], commands: [{ type: "gallery_anchor", anchor_id: "locked", asset_id: "missing", title: "锁定" }, { type: "narration", text: "画廊" }] }] },
  uiSkin: { ui_layout_version: "1.3.0", name: "gallery lock", target_runtime: "0.6.0", assets: [], tokens: { colorBackground: "#070d14", colorSurface: "#121b27", colorSurfaceStrong: "#1c2a39", colorInk: "#f4f7fb", colorMuted: "#a8b4c2", colorAccent: "#8cb0c9", colorAccent2: "#c7a27a", colorLine: "#8fa1b4", colorControl: "#1c2a39", colorControlHover: "#1c2a39", colorControlActive: "#8cb0c9", colorControlText: "#f4f7fb", colorQuickMenu: "#121b27", colorFocus: "#a8c7dc", radius: 12 }, screens: [] },
};
(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const vite = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6868"], { cwd: runtimeRoot, windowsHide: true, stdio: "ignore" });
  const browser = await chromium.launch({ headless: true });
  try {
    await ready();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate((p) => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2, sessionId: "gallery-lock", revision: 1, requestId: "init", runId: "run", manifest: p.manifest, script: p.script, uiSkin: p.uiSkin, gallery: { gallery_version: "1.0.0", items: [{ item_id: "locked", title: "锁定", asset_id: "missing", unlocked: false }] }, assetUrls: {}, start: { requestId: "start", target: { sceneId: "scene", commandIndex: 1 }, entryPath: [], mode: "stable_frame", playbackRate: 1, reducedMotion: true }, screen: "title_menu" }, "*"), payload);
    await page.getByTestId("game-state-title").waitFor({ state: "visible", timeout: 20000 });
    await page.getByTestId("open-gallery").click();
    await page.getByTestId("gallery-screen").waitFor({ state: "visible", timeout: 20000 });
    const result = await page.locator(".gallery-item.locked").first().evaluate((item) => { const button = item.querySelector("button"); const lock = item.querySelector(".gallery-item-lock"); const itemStyle = getComputedStyle(item); const buttonStyle = button ? getComputedStyle(button) : null; const lockStyle = lock ? getComputedStyle(lock) : null; const rect = item.getBoundingClientRect(); const topBorder = itemStyle.borderTopColor; return { rect: { width: rect.width, height: rect.height }, topBorder, buttonFilter: buttonStyle?.filter ?? "none", lockVisible: Boolean(lock && lock.getBoundingClientRect().width > 0 && lockStyle?.visibility !== "hidden"), lockText: lock?.textContent ?? "", itemOverflow: itemStyle.overflow }; });
    assert(result.rect.width > 0 && result.rect.height > 0, "locked gallery item is not laid out", result);
    assert(result.buttonFilter.includes("blur"), "locked gallery artwork is not blurred", result);
    assert(result.lockVisible && !/[\u{1F300}-\u{1FAFF}]/u.test(result.lockText), "locked gallery item has no non-emoji lock icon", result);
    assert(result.topBorder === "rgba(0, 0, 0, 0)" || result.topBorder === "transparent", "gallery item retained the gray top edge", result);
    assert(errors.length === 0, "gallery page browser errors", errors);
    await page.screenshot({ path: path.join(outputDir, "gallery-lock.png") });
    await browser.close();
    console.log(`gallery-lock-style-playwright: PASS (${outputDir})`);
  } finally { stop(vite); }
})().catch((error) => { fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error)); console.error(error.stack || error); process.exitCode = 1; });
