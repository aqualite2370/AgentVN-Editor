#!/usr/bin/env node
"use strict";

// Capability-removal diagnosis in a current desktop browser, NOT Android-device
// or old-WebView acceptance. No user project, APK or backend is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const { chromium } = require("../editor/node_modules/playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "playwright", "android-webview-startup",
  new Date().toISOString().replace(/[:.]/g, "-"));
const report = {
  status: "RUNNING",
  scope: process.argv.includes("--production")
    ? "PRODUCTION_STATIC_BROWSER_CAPABILITY_REMOVAL_NOT_ANDROID_OR_APK_ACCEPTANCE"
    : "SOURCE_BROWSER_CAPABILITY_REMOVAL_NOT_ANDROID_OR_APK_ACCEPTANCE",
  output,
  startedAt: new Date().toISOString(),
  cases: [],
  cleanup: {},
};
const full = process.argv.includes("--full");
const firstLine = "仅用于启动诊断，不调用模型或读取用户工程。";
const secondLine = "启动后的真实剧情推进成功。";

function classifyStartupConsoleErrors(errors, responses, baseUrl) {
  const optionalUrl = `${baseUrl}/fixed-only.json`;
  const optional = [], unexpected = [];
  for (const error of errors) {
    // This legacy launch marker is explicitly optional in getLaunchConfig.
    // Preserve the raw event and require the exact failed HTTP request too.
    const expected = error.location?.url === optionalUrl
      && error.text === "Failed to load resource: the server responded with a status of 404 (Not Found)"
      && responses.some(response => response.url === optionalUrl && response.status === 404);
    (expected ? optional : unexpected).push(error);
  }
  return { optional, unexpected };
}

async function startProductionServer() {
  const directory = path.join(root, "GameCli_framework/dist");
  assert(fs.existsSync(path.join(directory, "index.html")), "缺少实际生产构建");
  const runId = crypto.randomUUID();
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".png": "image/png", ".woff": "font/woff", ".woff2": "font/woff2" };
  const served = new Map();
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === `/__agentvn_acceptance_owner/${runId}`) {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ runId, pid: process.pid }));
        return;
      }
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const file = path.resolve(directory, relative);
      assert(file.startsWith(directory + path.sep), "拒绝越界请求");
      const bytes = fs.readFileSync(file);
      served.set(relative, { relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
      response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.end(bytes);
    } catch (error) {
      response.statusCode = error.code === "ENOENT" ? 404 : 400;
      response.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const assertAlive = async () => {
    assert(server.listening, "本轮静态服务已停止");
    const response = await fetch(`${url}/__agentvn_acceptance_owner/${runId}`, {
      signal: AbortSignal.timeout(3000),
    });
    assert(response.ok);
    const identity = await response.json();
    assert.equal(identity.runId, runId);
    assert.equal(identity.pid, process.pid);
  };
  return {
    url, pid: process.pid, runId, kind: "in-process-static", served,
    async run(operation) { await assertAlive(); const result = await operation(); await assertAlive(); return result; },
    async stop() {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      assert(!server.listening);
    },
  };
}

function fixture(advanced) {
  let uiSkin;
  if (advanced) {
    const loaded = { exports: {} };
    const built = require("../editor/node_modules/esbuild").buildSync({
      stdin: {
        contents: 'export { createRenpyUILayout } from "./shared/cartridge/uiLayoutProfiles";',
        resolveDir: root, loader: "ts",
      },
      bundle: true, platform: "node", format: "cjs", write: false,
    });
    new Function("module", "exports", built.outputFiles[0].text)(loaded, loaded.exports);
    uiSkin = loaded.exports.createRenpyUILayout();
  }
  return {
    manifest: {
      manifest_version: "1.0.0", cartridge_version: "1.0.0",
      runtime_version: "0.8.0", game_id: "isolated-webview-startup",
      title: "隔离启动诊断", author: "QA", version: "1.0.0", language: "zh-CN",
      entry_script: "script.json", entry_scene_id: "main", assets: [],
      created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z",
    },
    script: {
      schema_version: "1.1.0", game_id: "isolated-webview-startup",
      title: "隔离启动诊断", entry_scene_id: "main", characters: [],
      scenes: [{
        scene_id: "main", title: "隔离场景", chapter: 1, tags: [],
        commands: [
          { type: "narration", text: firstLine },
          { type: "narration", text: secondLine },
        ],
      }],
    },
    uiSkin, assetUrls: {},
  };
}

async function runCase(browser, owner, spec) {
  const result = {
    viewport: { width: 1920, height: 1080 }, dpr: 1, ...spec,
    status: "RUNNING", pageErrors: [], consoleErrors: [], failedRequests: [], failedResponses: [],
  };
  const context = await browser.newContext({
    viewport: result.viewport, deviceScaleFactor: result.dpr,
    reducedMotion: result.reduced ? "reduce" : "no-preference",
  });
  try {
    const page = await context.newPage();
    page.on("pageerror", error => result.pageErrors.push({
      name: error.name, message: error.message, stack: error.stack,
    }));
    page.on("console", message => {
      if (message.type() === "error")
        result.consoleErrors.push({ text: message.text(), location: message.location() });
    });
    page.on("response", response => {
      if (response.status() >= 400)
        result.failedResponses.push({ url: response.url(), status: response.status() });
    });
    page.on("requestfailed", request => result.failedRequests.push({
      url: request.url(), error: request.failure()?.errorText,
    }));
    await page.addInitScript(({ absent }) => {
      window.__startupDiagnosis = {
        errors: [],
        originalClone: window.structuredClone,
        originalObserver: window.ResizeObserver,
      };
      window.addEventListener("error", event => {
        window.__startupDiagnosis.errors.push(String(event.error || event.message));
      });
      window.addEventListener("unhandledrejection", event => {
        window.__startupDiagnosis.errors.push(String(event.reason));
      });
      for (const name of Array.isArray(absent) ? absent : absent ? [absent] : []) {
        Object.defineProperty(window, name, {
          configurable: true, writable: true, value: undefined,
        });
      }
    }, spec);
    await owner.run(async () => {
      await page.goto(`${owner.url}/?mode=preview`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() =>
        document.querySelector("#root")?.childElementCount > 0
        || window.__startupDiagnosis.errors.length > 0, null, { timeout: 15000 });
      if (await page.locator("#root").evaluate(node => node.childElementCount > 0)) {
        await page.evaluate(payload => window.postMessage({
          type: "agentvn.live-preview.init", protocolVersion: 2,
          sessionId: "isolated-webview-startup", revision: 1,
          requestId: "startup", runId: "startup", screen: "title_menu",
          ...payload,
        }, "*"), fixture(spec.advanced));
        await page.waitForFunction(() =>
          document.querySelector('[data-testid="game-state-title"]')
          || window.__startupDiagnosis.errors.length > 0, null, { timeout: 15000 });
        await page.waitForFunction(() => {
          if (window.__startupDiagnosis.errors.length) return true;
          const navigation = document.querySelector("[data-runtime-screen-transition]");
          const button = document.querySelector('[data-testid="start-new-game"]');
          if (!button || navigation?.getAttribute("data-runtime-screen-transition") !== "idle"
            || document.querySelector(".boot-overlay, .game-launch-blackout")) return false;
          for (let node = button; node instanceof Element; node = node.parentElement) {
            const css = getComputedStyle(node);
            if (Number(css.opacity) < .99 || css.visibility === "hidden"
              || css.display === "none" || node.hasAttribute("inert")) return false;
          }
          const rect = button.getBoundingClientRect();
          return !button.disabled && rect.width > 0 && rect.height > 0
            && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }, null, { timeout: 20000 });
      }
      result.dom = await page.evaluate(() => ({
        rootChildren: document.querySelector("#root")?.childElementCount,
        rootText: document.querySelector("#root")?.textContent?.slice(0, 1200),
        titleVisible: (() => {
          const node = document.querySelector('[data-testid="game-state-title"]');
          return Boolean(node && node.getBoundingClientRect().width > 0
            && node.getBoundingClientRect().height > 0);
        })(),
        capabilities: {
          structuredClone: typeof structuredClone, ResizeObserver: typeof ResizeObserver,
          animate: typeof Element.prototype.animate, userAgent: navigator.userAgent,
        },
        errors: window.__startupDiagnosis.errors,
      }));
      result.screenshot = path.join(output, `${spec.id}.png`);
      await page.screenshot({ path: result.screenshot });
      assert(result.dom.rootChildren > 0, "Runtime 根节点为空，启动未完成");
      assert(result.dom.titleVisible, "真实 Runtime 标题页未成功挂载");
      assert.equal(result.pageErrors.length, 0, "启动出现未处理异常");
      assert.equal(result.dom.errors.length, 0, "启动出现全局异常");
      await page.getByTestId("start-new-game").click({ trial: true, timeout: 3000 });
      result.startButtonActionable = true;
      result.compatibility = await page.evaluate(async () => {
        const shared = { value: 3 };
        const buffer = new Uint8Array([4, 5, 6]);
        const source = {
          a: shared, b: shared, ownUndefined: undefined, nan: NaN,
          date: new Date("2026-10-17T00:00:00Z"),
          map: new Map([[shared, new Set(["one", "two"])]]),
          bytes: buffer, view: new DataView(buffer.buffer), regexp: /test/gi,
        };
        source.self = source;
        const copy = structuredClone(source);
        let uncloneableError;
        try { structuredClone({ bad: () => {} }); }
        catch (error) { uncloneableError = error.name; }
        copy.a.value = 9;
        copy.bytes[0] = 7;
        const sizes = [];
        const probe = document.createElement("div");
        Object.assign(probe.style, {
          position: "fixed", left: "0", top: "0", width: "111px", height: "12px",
          opacity: "0", pointerEvents: "none",
        });
        document.body.append(probe);
        let observer;
        try {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error("ResizeObserver did not track size changes")), 5000);
            observer = new ResizeObserver(entries => {
              const width = entries[0].contentRect.width;
              sizes.push(width);
              if (width === 111) requestAnimationFrame(() => { probe.style.width = "171px"; });
              if (width === 171) { clearTimeout(timer); resolve(); }
            });
            observer.observe(probe);
          });
        } finally { observer?.disconnect(); probe.remove(); }
        return {
          clone: {
            deepCopy: source.a.value === 3 && copy.a.value === 9,
            repeatedReference: copy.a === copy.b && copy.a !== shared,
            cycle: copy.self === copy,
            undefinedRetained: Object.hasOwnProperty.call(copy, "ownUndefined") && copy.ownUndefined === undefined,
            nanRetained: Number.isNaN(copy.nan),
            date: copy.date instanceof Date && copy.date.getTime() === source.date.getTime(),
            mapSet: copy.map.get(copy.a)?.has("two") === true,
            typedArray: source.bytes[0] === 4 && copy.bytes[0] === 7,
            sharedClonedBuffer: copy.view.buffer === copy.bytes.buffer && copy.view.buffer !== source.view.buffer,
            regexp: copy.regexp.source === "test" && copy.regexp.flags === "gi",
            rejectsFunction: uncloneableError === "DataCloneError",
          },
          resized: sizes.includes(111) && sizes.includes(171), sizes,
          nativeClonePreserved: structuredClone === window.__startupDiagnosis.originalClone,
          nativeObserverPreserved: ResizeObserver === window.__startupDiagnosis.originalObserver,
        };
      });
      assert(Object.values(result.compatibility.clone).every(Boolean), "克隆状态语义被破坏");
      assert(result.compatibility.resized, "兼容 ResizeObserver 未收到实际尺寸变化");
      const absent = Array.isArray(spec.absent) ? spec.absent : spec.absent ? [spec.absent] : [];
      if (!absent.includes("structuredClone"))
        assert(result.compatibility.nativeClonePreserved, "不得覆盖原生 structuredClone");
      if (!absent.includes("ResizeObserver"))
        assert(result.compatibility.nativeObserverPreserved, "不得覆盖原生 ResizeObserver");
      if (spec.exercise) {
        await page.getByTestId("open-settings").click();
        await page.getByTestId("settings-finish").click();
        await page.getByTestId("start-new-game").click();
        await page.waitForFunction(() => {
          const dialog = document.querySelector(".dialog-box");
          return dialog && !document.querySelector(".game-launch-blackout")
            && dialog.getAttribute("data-dialog-page-done") === "true";
        }, null, { timeout: 20000 });
        assert((await page.locator(".dialog-box").getAttribute("aria-label")).includes(firstLine));
        await page.locator(".dialog-box").click();
        await page.waitForFunction(text => {
          const dialog = document.querySelector(".dialog-box");
          return dialog?.getAttribute("aria-label")?.includes(text)
            && dialog.getAttribute("data-dialog-page-done") === "true";
        }, secondLine, { timeout: 15000 });
        result.flow = "TITLE_SETTINGS_RETURN_START_AND_ADVANCE_PASS";
        const geometry = await page.locator(".dialog-box").evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { rect: rect.toJSON(), width: innerWidth, height: innerHeight,
            hit: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth,
            engines: document.querySelectorAll('[data-testid="game-state-playing"]').length };
        });
        assert(geometry.hit && geometry.overflow <= 1 && geometry.engines === 1);
        assert(geometry.rect.left >= -1 && geometry.rect.top >= -1
          && geometry.rect.right <= geometry.width + 1 && geometry.rect.bottom <= geometry.height + 1);
        result.geometry = geometry;
        await page.screenshot({ path: path.join(output, `${spec.id}-playing.png`) });
      }
      assert.equal(result.pageErrors.length, 0, "兼容能力/实际流程出现未处理异常");
      result.networkReview = classifyStartupConsoleErrors(result.consoleErrors, result.failedResponses, owner.url);
      assert.equal(result.networkReview.unexpected.length, 0, "兼容能力/实际流程出现非预期控制台错误");
      assert(result.failedResponses.every(response =>
        response.url === `${owner.url}/fixed-only.json` && response.status === 404),
      "存在非可选资源的HTTP错误");
      result.status = "PASS";
    });
  } catch (error) {
    result.status = "FAILED";
    result.error = error.stack || String(error);
  } finally {
    await context.close();
    report.cases.push(result);
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const sourcePaths = [
    "scripts/android-webview-startup-playwright.cjs",
    "GameCli_framework/src/main.tsx",
    "GameCli_framework/src/utils/runtimeCompatibility.ts",
    "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
    "GameCli_framework/src/styles/player.css",
    "GameCli_framework/package.json",
    "GameCli_framework/package-lock.json",
    "GameCli_framework/src/engine/StoryEngine.ts",
    "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
    "GameCli_framework/vite.config.cjs",
    "GameCli_framework/src-tauri/gen/android/app/build.gradle.kts",
  ];
  report.sources = sourcePaths.map(relative => ({
    path: path.join(root, relative),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex"),
  }));
  let owner;
  let browser;
  try {
    owner = process.argv.includes("--production") ? await startProductionServer() : await startOwnedViteServer({
      root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"),
      logFile: path.join(output, "vite.log"),
    });
    report.service = { pid: owner.pid, runId: owner.runId, url: owner.url, kind: owner.kind || "owned-child-vite" };
    browser = await chromium.launch({ headless: true });
    report.browserVersion = browser.version();
    for (const advanced of [false, true]) {
      const layout = advanced ? "advanced" : "agentvn";
      await runCase(browser, owner, { id: `${layout}-native`, advanced });
      await runCase(browser, owner, {
        id: `${layout}-without-structuredClone`, advanced, absent: "structuredClone",
      });
      await runCase(browser, owner, {
        id: `${layout}-without-ResizeObserver`, advanced, absent: "ResizeObserver",
      });
    }
    // A separate context repeats the primary failure, rejecting a one-off load.
    await runCase(browser, owner, {
      id: "agentvn-without-structuredClone-repeat",
      advanced: false, absent: "structuredClone",
    });
    for (const advanced of [false, true])
      await runCase(browser, owner, {
        id: `${advanced ? "advanced" : "agentvn"}-without-clone-observer-mark`,
        advanced, absent: ["structuredClone", "ResizeObserver", "PerformanceMark"],
      });
    if (full) {
      for (const [width, height] of require("./lib/current-acceptance-viewports.cjs").desktopViewports)
        for (const dpr of [1, 2]) for (const reduced of [false, true])
          for (const advanced of [false, true]) for (const fallback of [false, true])
            await runCase(browser, owner, {
              id: `${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${advanced ? "advanced" : "agentvn"}-${fallback ? "fallback" : "native"}`,
              advanced, viewport: { width, height }, dpr, reduced, exercise: true,
              absent: fallback ? ["structuredClone", "ResizeObserver", "PerformanceMark"] : undefined,
            });
    }
    report.expectedCaseCount = full ? 57 : 9;
    report.status = report.cases.length === report.expectedCaseCount && report.cases.every(value => value.status === "PASS")
      ? "PASS" : "FAILED";
  } catch (error) {
    report.status = "FAILED";
    report.error = error.stack || String(error);
  } finally {
    if (browser) {
      await browser.close();
      report.cleanup.browserClosed = true;
    }
    if (owner) {
      await owner.stop();
      report.cleanup.ownedServerStopped = true;
      if (owner.served) report.productionFilesServed = [...owner.served.values()];
      if (owner.kind !== "in-process-static") {
        try {
          process.kill(owner.pid, 0);
          report.cleanup.ownedServerPidAbsent = false;
          report.status = "FAILED";
        } catch (error) {
          report.cleanup.ownedServerPidAbsent = error.code === "ESRCH";
          if (error.code !== "ESRCH") report.status = "FAILED";
        }
      }
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, output,
      cases: report.cases.map(value => ({ id: value.id, status: value.status })) }, null, 2));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
}

if (require.main === module)
  main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { classifyStartupConsoleErrors, startProductionServer, fixture };
