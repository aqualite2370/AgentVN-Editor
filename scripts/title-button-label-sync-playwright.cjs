#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.AGENTVN_TITLE_LABEL_PORT || 6994);
const url = `http://127.0.0.1:${port}/`;
const vite = path.join(root, "GameCli_framework", "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
const outputDir = path.join(root, "output", "playwright", "title-button-label-sync");
const sharedSkinModule = `/@fs/${path.join(root, "shared", "cartridge", "uiSkin.ts").replace(/\\/g, "/")}`;
const viewports = [
  { name: "reported-757x299", width: 757, height: 299 },
  { name: "wide-desktop", width: 1536, height: 926 },
  { name: "narrow-390x844", width: 390, height: 844 },
];

function killPort() {
  if (process.platform !== "win32") return;
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | % { if ($_ -gt 0) { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }`,
    ], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

async function reachable() {
  try { return (await fetch(url)).ok; } catch { return false; }
}

async function main() {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  killPort();
  const server = spawn(process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : vite,
    process.platform === "win32" ? ["/d", "/s", "/c", vite, "--host", "127.0.0.1", "--port", String(port)] : ["--host", "127.0.0.1", "--port", String(port)],
    { cwd: path.join(root, "GameCli_framework"), windowsHide: true, stdio: "ignore" });
  try {
    const deadline = Date.now() + 30000;
    while (!(await reachable()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    assert.ok(await reachable(), `GameCli dev server did not start at ${url}`);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
        page.on("console", (message) => {
          if (message.type() === "error") pageErrors.push(message.text());
        });
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#root", { timeout: 30000 });
        await page.waitForSelector('[data-testid="open-library"]', { state: "visible", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(300);
        await page.evaluate(async ({ uiSkinModule }) => {
          const [{ useRuntimeStore }, { getDefaultUISkinLayout }] = await Promise.all([
            import("/src/store/runtimeStore.ts"),
            import(uiSkinModule),
          ]);
          const uiSkin = getDefaultUISkinLayout();
          const title = uiSkin.screens.find((screen) => screen.screen_id === "title");
          if (!title) throw new Error("Default UI skin is missing title screen.");
          const labels = {
            title_continue_button: "进度",
            title_start_button: "新作",
            title_save_load_button: "档案",
            title_gallery_button: "回忆",
            title_settings_button: "设置",
            title_about_button: "本作",
          };
          for (const component of title.components) {
            if (Object.hasOwn(labels, component.component_id)) component.label = labels[component.component_id];
          }
          useRuntimeStore.setState({
            currentGame: {
              install_id: "title-button-label-sync",
              game_id: "title-button-label-sync",
              title: "标题按钮文案同步",
              author: "AgentVN QA",
              version: "1.0.0",
              description: "标题按钮文案同步回归。",
              language: "zh-CN",
              manifest: { assets: [], shell: {} },
              script: {
                schema_version: "1.0.0",
                game_id: "title-button-label-sync",
                title: "标题按钮文案同步",
                entry_scene_id: "start",
                characters: [],
                scenes: [{ scene_id: "start", title: "Start", summary: "Start", chapter: 1, tags: [], commands: [] }],
              },
              gallery: [],
              uiSkin,
              assetUrls: {},
              uiAssetUrls: {},
              imported_at: "2026-08-28T00:00:00.000Z",
              updated_at: "2026-08-28T00:00:00.000Z",
              source_file_name: "title-button-label-sync.vncart",
              cartridge_path: "",
            },
            screen: "title_menu",
            runtimeMode: "fixed",
            saves: [{ slot: 1, savedAt: "2026-08-28T00:00:00.000Z", preview: null }],
          });
        }, { uiSkinModule: sharedSkinModule });
        await page.locator('[data-testid="game-state-title"]').waitFor({ state: "visible", timeout: 30000 }).catch(async (error) => {
          const body = await page.locator("body").innerText().catch(() => "");
          throw new Error(`${viewport.name}: title screen did not render. errors=${JSON.stringify(pageErrors)} body=${JSON.stringify(body)}\n${error.message}`);
        });
        const result = await page.evaluate(() => {
          const expected = {
            title_continue_button: "进度",
            title_start_button: "新作",
            title_save_load_button: "档案",
            title_gallery_button: "回忆",
            title_settings_button: "设置",
            title_about_button: "本作",
          };
          const buttons = Object.fromEntries([...document.querySelectorAll("[data-ui-component-id]")].map((node) => {
            const id = node.getAttribute("data-ui-component-id");
            const rect = node.getBoundingClientRect();
            return [id, {
              text: node.querySelector(".menu-action-label")?.textContent?.trim() ?? "",
              ariaLabel: node.getAttribute("aria-label") ?? "",
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
              textRect: (() => {
                const text = node.querySelector(".menu-action-label")?.getBoundingClientRect();
                return text ? { left: text.left, top: text.top, right: text.right, bottom: text.bottom } : null;
              })(),
              client: { width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight },
            }];
          }));
          return { expected, buttons, viewport: { width: innerWidth, height: innerHeight } };
        });
        for (const [id, label] of Object.entries(result.expected)) {
          const button = result.buttons[id];
          assert.ok(button, `${viewport.name}: missing ${id}`);
          assert.equal(button.text, label, `${viewport.name}: ${id} visible copy mismatch`);
          assert.equal(button.ariaLabel, label, `${viewport.name}: ${id} aria-label mismatch`);
          assert.ok(button.rect.width > 0 && button.rect.height > 0, `${viewport.name}: ${id} has no geometry`);
          assert.ok(button.rect.left >= -1 && button.rect.top >= -1 && button.rect.right <= viewport.width + 1 && button.rect.bottom <= viewport.height + 1,
            `${viewport.name}: ${id} escaped viewport: ${JSON.stringify(button.rect)}`);
          assert.ok(button.textRect
            && button.textRect.left >= button.rect.left - 1
            && button.textRect.right <= button.rect.right + 1,
          `${viewport.name}: ${id} text is clipped by its button: ${JSON.stringify(button)}`);
        }
        const visibleRects = Object.values(result.buttons).filter((item) => item.text).map((item) => item.rect);
        for (let i = 0; i < visibleRects.length; i += 1) {
          for (let j = i + 1; j < visibleRects.length; j += 1) {
            const overlap = Math.max(0, Math.min(visibleRects[i].right, visibleRects[j].right) - Math.max(visibleRects[i].left, visibleRects[j].left))
              * Math.max(0, Math.min(visibleRects[i].bottom, visibleRects[j].bottom) - Math.max(visibleRects[i].top, visibleRects[j].top));
            assert.ok(overlap < 2, `${viewport.name}: fixed title buttons overlap`);
          }
        }
        await page.screenshot({ path: path.join(outputDir, `${viewport.name}.png`), fullPage: true });
        await page.close();
      }
    } finally {
      await browser.close();
    }
    console.log(`title-button-label-sync-playwright: PASS (${viewports.map((item) => item.name).join(", ")})`);
  } finally {
    try { server.kill(); } catch {}
    killPort();
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
