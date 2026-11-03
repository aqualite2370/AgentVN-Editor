#!/usr/bin/env node
"use strict";

// Actual isolated old desktop engine; never evidence of an Android device pass.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const tools = path.join(root, "output/compatibility-tools/legacy-chromium-playwright-1.8.1");
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(tools, "browsers");
const { chromium } = require(path.join(tools, "node_modules/playwright-chromium"));
const { classifyStartupConsoleErrors } = require("./android-webview-startup-playwright.cjs");
const output = path.join(root, "output/playwright/runtime-legacy-webview",
  new Date().toISOString().replace(/[:.]/g, "-"));
const dist = path.join(root, "GameCli_framework/dist");
const full = process.argv.includes("--full");
const frameProbe = process.argv.includes("--frame-probe");
const report = {
  scope: "ACTUAL_OLD_DESKTOP_ENGINE_PRODUCTION_NOT_ANDROID_DEVICE_OR_APK",
  status: "RUNNING", startedAt: new Date().toISOString(), cases: [], cleanup: {},
  diagnosticOnlyFrameOverride: frameProbe,
};
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const first = "旧引擎隔离测试，未读取用户工程。";
const second = "实际生产文件已完成剧情推进。";
const title = '[data-testid="start-new-game"]';
const settings = '[data-testid="open-settings"]';
const finish = '[data-testid="settings-finish"]';

function fixture(advanced) {
  let uiSkin;
  if (advanced) {
    const loaded = { exports: {} };
    const built = require("../editor/node_modules/esbuild").buildSync({
      stdin: {
        contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";',
        resolveDir: root, loader: "ts",
      }, bundle: true, platform: "node", format: "cjs", write: false,
    });
    new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
    uiSkin = loaded.exports.createRenpyUILayout();
  }
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0", runtime_version: "0.8.0",
      game_id: "isolated-legacy-engine", title: "旧引擎隔离验收", author: "QA",
      version: "1.0.0", language: "zh-CN", entry_script: "script.json",
      entry_scene_id: "main", assets: [], created_at: "2026-10-17T00:00:00Z",
      updated_at: "2026-10-17T00:00:00Z",
    },
    script: {
      schema_version: "1.1.0", game_id: "isolated-legacy-engine",
      title: "旧引擎隔离验收", entry_scene_id: "main", characters: [],
      scenes: [{ scene_id: "main", title: "隔离场景", chapter: 1, tags: [],
        commands: [{ type: "narration", text: first }, { type: "narration", text: second }] }],
    }, uiSkin, assetUrls: {},
  };
}

async function actionable(page, selector) {
  await page.waitForFunction(selector => {
    const node = document.querySelector(selector);
    if (!node || node.disabled || document.querySelector(".boot-overlay, .game-launch-blackout"))
      return false;
    const seam = document.querySelector("[data-runtime-screen-transition]");
    if (seam && seam.getAttribute("data-runtime-screen-transition") !== "idle") return false;
    for (let current = node; current instanceof Element; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (Number(style.opacity) < .99 || style.visibility === "hidden"
        || style.display === "none" || current.hasAttribute("inert")) return false;
    }
    const r = node.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0
      && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
      && node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }, selector, { timeout: 20000 });
}

async function testCase(browser, url, spec) {
  const item = { ...spec, status: "RUNNING", pageErrors: [], consoleErrors: [],
    failedResponses: [], blockedRequests: [] };
  const context = await browser.newContext({
    viewport: spec.viewport, deviceScaleFactor: spec.dpr,
    reducedMotion: spec.reduced ? "reduce" : "no-preference",
  });
  let page;
  try {
    page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: spec.reduced ? "reduce" : "no-preference" },
    ] });
    item.actualParameters = [];
    const verifyParameters = async phase => {
      const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
      item.actualParameters.push({ phase, actual });
      assert.deepEqual(actual, { ...spec.viewport, dpr: spec.dpr, reduced: spec.reduced },
        "Actual old engine viewport/DPR/media must match the requested matrix");
    };
    page.on("pageerror", error => item.pageErrors.push(String(error.stack || error)));
    page.on("console", message => {
      if (message.type() === "error")
        item.consoleErrors.push({ text: message.text(), location: message.location() });
    });
    page.on("response", response => {
      if (response.status() >= 400)
        item.failedResponses.push({ url: response.url(), status: response.status() });
    });
    await context.route("**/*", route => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(url + "/") || /^(data|blob):/.test(requestUrl))
        return route.continue();
      item.blockedRequests.push(requestUrl);
      return route.abort();
    });
    await page.addInitScript(() => {
      window.__legacyProbe = {
        clone: typeof structuredClone, observer: typeof ResizeObserver,
        originalClone: window.structuredClone, originalObserver: window.ResizeObserver,
        globalErrors: [],
      };
      window.addEventListener("error", e => window.__legacyProbe.globalErrors.push(String(e.error || e.message)));
      window.addEventListener("unhandledrejection", e => window.__legacyProbe.globalErrors.push(String(e.reason)));
    });
    await page.goto(url + "/?mode=preview", { waitUntil: "domcontentloaded" });
    if (frameProbe) await page.addStyleTag({ content:
      ".runtime-layout-frame { width:min(100vw,calc(100vh * 16 / 9)) !important;"
      + "height:min(100vh,calc(100vw * 9 / 16)) !important; }" });
    await page.waitForFunction(() => document.querySelector("#root").childElementCount > 0
      || window.__legacyProbe.globalErrors.length > 0, null, { timeout: 15000 });
    assert.equal(item.pageErrors.length, 0, "实际旧引擎启动异常");
    await page.evaluate(payload => window.postMessage({
      type: "agentvn.live-preview.init", protocolVersion: 2,
      sessionId: "isolated-legacy-engine", revision: 1, requestId: "init",
      runId: "init", screen: "title_menu", ...payload,
    }, "*"), fixture(spec.advanced));
    await actionable(page, title);
    item.frame = await page.$eval(".runtime-layout-frame", node => node.getBoundingClientRect().toJSON());
    assert(Math.abs(item.frame.width - spec.viewport.width) <= 1
      && Math.abs(item.frame.height - spec.viewport.height) <= 1, "完整画框未占据预期空间");
    if (!frameProbe) {
      const constrained = await page.addStyleTag({ content:
        ".runtime-screen-transition { inset:auto !important;left:0;top:0;width:75vw;height:75vh; }" });
      await page.waitForFunction(() => {
        const frame = document.querySelector(".runtime-layout-frame").getBoundingClientRect();
        return Math.abs(frame.width - innerWidth * .75) <= 1
          && Math.abs(frame.height - innerHeight * .75) <= 1;
      }, null, { timeout: 5000 });
      item.containedPreview = await page.$eval(".runtime-layout-frame", node => node.getBoundingClientRect().toJSON());
      await constrained.evaluate(node => node.remove());
      await page.waitForFunction(() => {
        const frame = document.querySelector(".runtime-layout-frame").getBoundingClientRect();
        return Math.abs(frame.width - innerWidth) <= 1 && Math.abs(frame.height - innerHeight) <= 1;
      }, null, { timeout: 5000 });
      await actionable(page, title);
    }
    item.capabilities = await page.evaluate(() => ({
      before: { clone: window.__legacyProbe.clone, observer: window.__legacyProbe.observer },
      after: { clone: typeof structuredClone, observer: typeof ResizeObserver },
      observerPreserved: window.ResizeObserver === window.__legacyProbe.originalObserver,
      userAgent: navigator.userAgent, secureContext: isSecureContext,
    }));
    assert.equal(item.capabilities.before.clone, "undefined", "此旧引擎没有覆盖缺失原生克隆场景");
    assert.equal(item.capabilities.after.clone, "function");
    assert(item.capabilities.observerPreserved, "原生观察器不应被覆盖");
    await verifyParameters("before-title-capture");
    await page.screenshot({ path: path.join(output, `${spec.id}-title.png`) });
    await verifyParameters("after-title-capture");
    await page.click(settings);
    await actionable(page, finish);
    item.settingsGeometry = await page.$eval('[data-testid="settings-screen"]', node => {
      const r = node.getBoundingClientRect();
      return { rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(item.settingsGeometry.overflow <= 1, "设置页横向溢出");
    await page.screenshot({ path: path.join(output, `${spec.id}-settings.png`) });
    await page.click(finish);
    await actionable(page, title);
    await page.click(title);
    for (const text of [first, second]) {
      await page.waitForFunction(text => {
        const node = document.querySelector(".dialog-box");
        return node && node.getAttribute("aria-label").includes(text)
          && node.getAttribute("data-dialog-page-done") === "true"
          && !document.querySelector(".game-launch-blackout");
      }, text, { timeout: 20000 });
      await actionable(page, ".dialog-box");
      if (text === first) await page.click(".dialog-box");
    }
    item.geometry = await page.$eval(".dialog-box", node => {
      const r = node.getBoundingClientRect();
      return { rect: r.toJSON(), width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth,
        playingOwners: document.querySelectorAll('[data-testid="game-state-playing"]').length };
    });
    assert(item.geometry.overflow <= 1 && item.geometry.playingOwners === 1);
    const r = item.geometry.rect;
    assert(r.left >= -1 && r.top >= -1 && r.right <= item.geometry.width + 1
      && r.bottom <= item.geometry.height + 1);
    await page.screenshot({ path: path.join(output, `${spec.id}-playing.png`) });
    await verifyParameters("after-playing-capture");
    assert.equal(item.pageErrors.length, 0);
    assert.equal(await page.evaluate(() => window.__legacyProbe.globalErrors.length), 0);
    item.network = classifyStartupConsoleErrors(item.consoleErrors, item.failedResponses, url);
    assert.equal(item.network.unexpected.length, 0);
    assert(item.failedResponses.every(row => row.url === url + "/fixed-only.json" && row.status === 404));
    assert.equal(item.blockedRequests.length, 0);
    item.flow = "TITLE_SETTINGS_RETURN_START_AND_ADVANCE_PASS";
    item.status = "PASS";
  } catch (error) {
    item.status = "FAILED"; item.error = String(error.stack || error);
    if (page) {
      item.failureDom = await page.content().catch(String);
      item.presentation = await page.evaluate(() => {
        const node = document.querySelector('[data-testid="start-new-game"]');
        const chain = [];
        for (let current = node; current; current = current.parentElement) {
          const css = getComputedStyle(current), r = current.getBoundingClientRect();
          chain.push({ tag: current.tagName, class: current.className, rect: r.toJSON(),
            opacity: css.opacity, display: css.display, visibility: css.visibility,
            height: css.height, minHeight: css.minHeight, position: css.position,
            transform: css.transform, overflow: css.overflow });
        }
        return { chain, viewport: { width: innerWidth, height: innerHeight },
          supports: { dvh: CSS.supports("height", "100dvh"), layers: typeof CSSLayerBlockRule },
          globalErrors: window.__legacyProbe.globalErrors };
      }).catch(String);
      await page.screenshot({ path: path.join(output, `${spec.id}-failed.png`) }).catch(() => {});
    }
  } finally {
    await context.close();
    report.cases.push(item); save();
    console.log(`${item.status} ${spec.id}`);
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true }); save();
  report.sources = ["scripts/runtime-legacy-webview-playwright.cjs",
    "scripts/android-webview-startup-playwright.cjs",
    "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
    "GameCli_framework/src/styles/player.css",
    "GameCli_framework/src/utils/runtimeCompatibility.ts",
    "GameCli_framework/package.json", "GameCli_framework/package-lock.json",
    "GameCli_framework/vite.config.cjs",
  ].map(file => ({ file, sha256: hash(fs.readFileSync(path.join(root, file))) }));
  const served = new Map(), nonce = crypto.randomUUID();
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = http.createServer((request, response) => {
    try {
      const requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (requestPath === `/__owner/${nonce}`) {
        response.end(JSON.stringify({ nonce, pid: process.pid })); return;
      }
      const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
      const file = path.resolve(dist, relative);
      assert(file.startsWith(dist + path.sep), "路径越界");
      const bytes = fs.readFileSync(file);
      served.set(relative, { relative, sha256: hash(bytes) });
      response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store"); response.end(bytes);
    } catch (error) { response.statusCode = error.code === "ENOENT" ? 404 : 400; response.end("Not found"); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    report.server = { url, pid: process.pid, nonce };
    const verify = async () => {
      assert(server.listening);
      assert.deepEqual(await (await fetch(`${url}/__owner/${nonce}`)).json(), { nonce, pid: process.pid });
    };
    report.executable = { path: chromium.executablePath(),
      sha256: hash(fs.readFileSync(chromium.executablePath())) };
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    assert(report.browserVersion.startsWith("90."));
    const viewports = full ? [[1920, 1080], [2560, 1440], [3840, 2160]] : [[1920, 1080]];
    matrix: for (const [width, height] of viewports) for (const dpr of full ? [1, 2] : [1])
      for (const reduced of full ? [false, true] : [false]) for (const advanced of [false, true]) {
        await verify();
        await testCase(browser, url, {
          id: `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${advanced ? "advanced" : "agentvn"}`,
          viewport: { width, height }, dpr, reduced, advanced,
        });
        await verify();
        // Stop at first actual old-engine failure: preserve evidence, avoid a duplicate matrix.
        if (report.cases[report.cases.length - 1].status !== "PASS") break matrix;
      }
    report.expectedCaseCount = full ? 24 : 2;
    report.status = report.cases.length === report.expectedCaseCount
      && report.cases.every(row => row.status === "PASS") ? "PASS" : "FAILED";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); }
  finally {
    if (browser) { await browser.close(); report.cleanup.browserClosed = true; }
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    report.cleanup.ownedServerStopped = !server.listening;
    report.productionFilesServed = [...served.values()];
    if (report.sources.some(row => hash(fs.readFileSync(path.join(root, row.file))) !== row.sha256)
      || report.productionFilesServed.some(row => hash(fs.readFileSync(path.join(dist, row.relative))) !== row.sha256)) {
      report.status = "FAILED";
      report.sourceDrift = true;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${output}`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
