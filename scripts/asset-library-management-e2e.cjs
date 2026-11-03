#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6868/";
const BACKEND_URL = process.env.AGENTVN_BACKEND_URL || "http://127.0.0.1:8378/";
const OUT_DIR = process.env.AGENTVN_ASSET_LIBRARY_OUTPUT || path.join(ROOT, "output", "playwright", "asset-library-management-e2e");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const viewports = [
  { label: "reported-1000", width: 1000, height: 760 },
  { label: "desktop-1440", width: 1440, height: 900 },
  { label: "narrow-760", width: 760, height: 760 },
];

function assert(condition, message, details) {
  if (condition) return;
  const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isListening(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function ensureEditor(report) {
  if (await isListening(EDITOR_URL) || await isListening(BACKEND_URL)) {
    throw new Error("Dedicated test ports are occupied; refusing to reuse or terminate another process.");
  }
  const isolatedData = path.join(OUT_DIR, "isolated-data");
  const backend = spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
    cwd: path.join(ROOT, "backend"),
    env: { ...process.env, AGENTVN_EDITOR_DATA_DIR: isolatedData, AGENTVN_BACKEND_DATA_DIR: isolatedData,
      DATABASE_PATH: path.join(isolatedData, "vn_engine.db"), AGENTVN_BACKEND_PORT: new URL(BACKEND_URL).port,
      AGENTVN_LEGACY_DATABASE_PATHS: "" },
    windowsHide: true,
    stdio: "ignore",
  });
  const backendDeadline = Date.now() + 60000;
  while (Date.now() < backendDeadline && !await isListening(new URL("/api/health", BACKEND_URL))) await sleep(400);
  if (!await isListening(new URL("/api/health", BACKEND_URL))) {
    stopServices([backend]);
    throw new Error("Isolated backend did not start.");
  }
  const logPath = path.join(OUT_DIR, "editor.log");
  const child = spawn(NPM, ["run", "dev", "--", "--host", "127.0.0.1", "--port", new URL(EDITOR_URL).port, "--strictPort"], {
    cwd: path.join(ROOT, "editor"),
    env: { ...process.env, VITE_BACKEND_URL: BACKEND_URL.replace(/\/$/, "") },
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  child.stderr.on("data", (chunk) => fs.appendFileSync(logPath, chunk));
  report.logs.push(logPath);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isListening(EDITOR_URL)) return [child, backend];
    await sleep(400);
  }
  stopServices([child, backend]);
  throw new Error(`Editor did not become ready: ${EDITOR_URL}`);
}

function stopServices(children) {
  for (const child of children) {
    if (!child?.pid) continue;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // The process has already exited.
    }
  }
}

async function mockBackend(page) {
  const state = {
    provider_connections: [],
    provider_models: [],
    provider_selections: {},
    provider_secrets: {},
    project_graph: null,
    project_metadata: {},
    recent_projects: [],
  };
  await page.route("**/api/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", service: "agentvn-backend", mocked: true }),
    });
  });
  await page.route("**/api/project/state", async (route) => {
    if (route.request().method() === "POST") {
      Object.assign(state, route.request().postDataJSON?.() || {});
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: route.request().method() === "GET" ? null : state }),
    });
  });
  await page.route("**/api/memory/mode", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ memory_mode: "off" }),
    });
  });
}

async function openProject(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  const create = page.locator('[data-help-key="home.createProject"]:visible').first();
  await create.waitFor({ state: "visible", timeout: 30000 });
  await create.click({ force: true });
  await page.locator(".editor-toolbar").waitFor({ state: "visible", timeout: 30000 });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("agentvn:open-advanced-tools", {
      detail: {
        id: `asset-library-layout-${Date.now()}`,
        tab: "library",
        title: "素材库布局自动化测试",
      },
    }));
  });
  await page.locator(".asset-library-panel").waitFor({ state: "visible", timeout: 30000 });
  const svg = (fill) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="${fill}"/></svg>`)}`;
  await page.evaluate(({ first, second }) => {
    const store = window.__AGENTVN_PROJECT_STORE__;
    if (!store) throw new Error("Project store test interface is unavailable.");
    store.getState().setAssetManifest([
      {
        asset_id: "layout_test_light",
        asset_type: "background",
        metadata: {
          display_name: "浅色服装",
          filename: "layout-test-light.svg",
          mime_type: "image/svg+xml",
          source: "imported",
          data_url: first,
          created_at: "2026-08-15T00:00:00.000Z",
        },
      },
      {
        asset_id: "layout_test_dark",
        asset_type: "background",
        metadata: {
          display_name: "深色服装",
          filename: "layout-test-dark.svg",
          mime_type: "image/svg+xml",
          source: "imported",
          data_url: second,
          created_at: "2026-08-15T00:00:01.000Z",
        },
      },
    ]);
  }, { first: svg("#d9cfbf"), second: svg("#253541") });
  await page.locator(".asset-library-card").nth(1).waitFor({ state: "visible", timeout: 10000 });
  const selectAll = page.locator('[data-help-key="asset.selectAllVisible"]');
  await selectAll.waitFor({ state: "visible", timeout: 10000 });
  await selectAll.click();
  await page.locator(".asset-library-batchbar").waitFor({ state: "visible", timeout: 10000 });
}

async function auditSurface(page, selector) {
  return page.locator(selector).evaluate((surface, surfaceSelector) => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number.parseFloat(style.opacity || "1") > 0.01
        && rect.width > 0
        && rect.height > 0;
    };
    const surfaceRect = rectOf(surface);
    const childRects = Array.from(surface.children).filter(visible).map((element) => ({
      node: element.getAttribute("data-help-key") || element.className || element.tagName.toLowerCase(),
      rect: rectOf(element),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    const outside = childRects.filter(({ rect }) => (
      rect.left < surfaceRect.left - 1
      || rect.right > surfaceRect.right + 1
      || rect.top < surfaceRect.top - 1
      || rect.bottom > surfaceRect.bottom + 1
    ));
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < childRects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < childRects.length; rightIndex += 1) {
        const left = childRects[leftIndex];
        const right = childRects[rightIndex];
        const overlapWidth = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const overlapHeight = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (overlapWidth > 1 && overlapHeight > 1) {
          overlaps.push({ left: left.node, right: right.node, overlapWidth, overlapHeight });
        }
      }
    }
    return {
      selector: surfaceSelector,
      rect: surfaceRect,
      scrollWidth: surface.scrollWidth,
      clientWidth: surface.clientWidth,
      horizontalOverflow: surface.scrollWidth > surface.clientWidth + 1,
      outside,
      overlaps,
      childRects,
    };
  }, selector);
}

async function auditSelectPopover(page, helpKey) {
  const trigger = page.locator(`[data-help-key="${helpKey}"]`).first();
  await trigger.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const triggerHit = await trigger.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      centerHit: Boolean(hit && (hit === element || element.contains(hit))),
      hitNode: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || "").replace(/\s+/g, ".")}` : "",
    };
  });
  await trigger.click({ force: true });
  const popover = page.locator(".rich-select-popover[role='listbox']").last();
  await popover.waitFor({ state: "visible", timeout: 5000 });
  const metrics = await popover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
    const centerY = Math.min(window.innerHeight - 1, Math.max(1, rect.top + Math.min(rect.height / 2, 32)));
    const hit = document.elementFromPoint(centerX, centerY);
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
      centerHit: Boolean(hit && (hit === element || element.contains(hit))),
    };
  });
  await trigger.click({ force: true });
  await popover.waitFor({ state: "hidden", timeout: 5000 });
  return { ...metrics, triggerHit };
}

async function runViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.waitForTimeout(700);
  await page.locator(".asset-library-batchbar").scrollIntoViewIfNeeded();
  const management = await auditSurface(page, ".asset-library-managementbar");
  const batch = await auditSurface(page, ".asset-library-batchbar");
  const typeGroup = await auditSurface(page, ".asset-library-batchbar > .asset-library-batch-group:nth-child(2)");
  const folderGroup = await auditSurface(page, ".asset-library-batchbar > .asset-library-batch-group:nth-child(4)");
  const popovers = {};
  for (const helpKey of ["asset.sort", "asset.batch.changeType", "asset.batch.target"]) {
    popovers[helpKey] = await auditSelectPopover(page, helpKey);
  }
  const screenshot = path.join(OUT_DIR, `${viewport.label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });

  for (const [name, metrics] of Object.entries({ management, batch, typeGroup, folderGroup })) {
    assert(!metrics.horizontalOverflow, `${viewport.label}: ${name} must not scroll horizontally.`, metrics);
    assert(metrics.outside.length === 0, `${viewport.label}: ${name} children must stay inside their surface.`, metrics);
    assert(metrics.overlaps.length === 0, `${viewport.label}: ${name} children must not overlap.`, metrics);
  }
  for (const [helpKey, metrics] of Object.entries(popovers)) {
    assert(metrics.triggerHit.centerHit, `${viewport.label}: ${helpKey} trigger is obscured and cannot receive pointer input.`, metrics);
    assert(metrics.rect.left >= 8 && metrics.rect.right <= viewport.width - 8, `${viewport.label}: ${helpKey} popover is clipped horizontally.`, metrics);
    assert(metrics.rect.top >= 8 && metrics.rect.bottom <= viewport.height - 8, `${viewport.label}: ${helpKey} popover is clipped vertically.`, metrics);
    assert(!metrics.horizontalOverflow, `${viewport.label}: ${helpKey} popover content overflows horizontally.`, metrics);
    assert(metrics.centerHit, `${viewport.label}: ${helpKey} popover is obscured and cannot receive pointer input.`, metrics);
  }
  return { viewport, management, batch, typeGroup, folderGroup, popovers, screenshot };
}

async function runReplacement(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const card = page.locator('.asset-library-card[data-asset-id="layout_test_light"]');
  await card.locator('[data-help-key="asset.card.menu"]').click();
  const replace = card.getByRole("menuitem", { name: "替换文件" });
  await replace.waitFor({ state: "visible", timeout: 5000 });
  await replace.click();
  const input = page.locator('[data-help-key="asset.replace.file"]');
  await input.setInputFiles({
    name: "升级背景.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#91aabb"/></svg>'),
  });
  await page.getByRole("button", { name: "确认替换" }).click();
  const replacement = await page.evaluate(() => {
    const asset = window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.find((item) => item.asset_id === "layout_test_light");
    return { id: asset.asset_id, type: asset.asset_type, name: asset.metadata.display_name, filename: asset.metadata.filename, source: asset.metadata.data_url };
  });
  assert(replacement.id === "layout_test_light" && replacement.type === "background" && replacement.name === "浅色服装", "Replacement must preserve the reference identity and display name.", replacement);
  assert(replacement.filename === "升级背景.svg" && replacement.source?.includes("OTAw"), "Replacement must update the embedded file bytes.", replacement);
  const expectedBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#91aabb"/></svg>');
  const bundleBytes = await page.evaluate(async () => {
    const { buildProjectBundle } = await import("/src/utils/projectBundle.ts");
    const asset = window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.find((item) => item.asset_id === "layout_test_light");
    const bundle = await buildProjectBundle({ asset_manifest: [asset] });
    return Array.from(new Uint8Array(await bundle.arrayBuffer()));
  });
  const zip = await JSZip.loadAsync(Buffer.from(bundleBytes));
  const project = JSON.parse(await zip.file("project.json").async("string"));
  const bundledAsset = project.asset_manifest.find((item) => item.asset_id === "layout_test_light");
  assert(bundledAsset?.asset_type === "background" && bundledAsset.metadata.display_name === "浅色服装", "Portable bundle must keep the referenced identity.", bundledAsset);
  assert((await zip.file(bundledAsset.metadata.project_path).async("nodebuffer")).equals(expectedBytes), "Portable bundle must contain the new bytes, not the old file.");
  await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件" }).click();
  await input.setInputFiles({ name: "wrong.wav", mimeType: "audio/wav", buffer: Buffer.from("not an image") });
  await page.locator(".asset-library-panel [role='alert']").filter({ hasText: "不兼容" }).waitFor({ state: "visible" });
  const preserved = await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.find((item) => item.asset_id === "layout_test_light").metadata.data_url);
  assert(preserved === replacement.source, "Rejected incompatible replacement must not change the original content.");
  return { id: replacement.id, filename: replacement.filename, projectPath: bundledAsset.metadata.project_path };
}

async function runProjectDirectory(page) {
  await page.locator('[data-help-key="advanced.tab.settings"]:visible').first().click();
  const setting = page.locator('.advanced-tab-content.is-active[data-tab="settings"] [role="region"][aria-label="工程保存目录"]');
  await setting.waitFor({ state: "visible", timeout: 15000 });
  assert(await setting.getByText("浏览器下载目录由浏览器控制").isVisible(), "Browser fallback must explain the directory limitation.");
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 757, height: 299 },
    { width: 390, height: 844 },
  ];
  const results = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(500);
    if (!await setting.isVisible().catch(() => false)) {
      await page.locator('[data-help-key="advanced.tab.settings"]:visible').first().click();
      await setting.waitFor({ state: "visible", timeout: 10000 });
    }
    await setting.scrollIntoViewIfNeeded();
    const layout = await setting.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth, pageWidth: document.documentElement.scrollWidth };
    });
    assert(layout.left >= -1 && layout.right <= layout.viewportWidth + 1 && layout.pageWidth <= layout.viewportWidth + 1,
      "Project directory setting must not overflow narrow or desktop viewports.", { viewport, layout });
    results.push({ viewport, layout });
  }
  return { browserFallback: true, results };
}

async function runMediaReplacement(page) {
  await page.evaluate(() => {
    const store = window.__AGENTVN_PROJECT_STORE__;
    store.getState().setAssetManifest([...store.getState().assetManifest, ...["video", "bgm"].map(type => ({
      asset_id: `replacement_${type}`, asset_type: type,
      metadata: { filename: `original-${type}`, display_name: `原始${type}`, duration_ms: 1234,
        data_url: "data:application/octet-stream;base64,T1JJR0lOQUw=", source: "imported" },
    }))]);
  });
  const input = page.locator('[data-help-key="asset.replace.file"]');
  const cases = [
    { type: "video", name: "broken.mp4", mimeType: "video/mp4" },
    { type: "bgm", name: "broken.wav", mimeType: "audio/wav" },
  ];
  for (const item of cases) {
    const card = page.locator(`.asset-library-card[data-asset-id="replacement_${item.type}"]`);
    await card.locator('[data-help-key="asset.card.menu"]').click();
    await card.getByRole("menuitem", { name: "替换文件" }).click();
    await input.setInputFiles({ name: item.name, mimeType: item.mimeType, buffer: Buffer.from("invalid media bytes") });
    await page.waitForFunction(() => Boolean(document.querySelector(".asset-library-panel [role=alert]"))
      || [...document.querySelectorAll("button")].some(button => button.textContent === "确认替换"));
    assert(await page.getByRole("button", { name: "确认替换", exact: true }).count() === 0,
      `${item.name}: unreadable media must not reach replacement confirmation`);
    await page.locator(".asset-library-panel [role=alert]").filter({ hasText: "原素材未改变" }).waitFor();
    const original = await page.evaluate(id => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.find(asset => asset.asset_id === id),
      `replacement_${item.type}`);
    assert(original.metadata.filename === `original-${item.type}` && original.metadata.duration_ms === 1234,
      "Rejected media replacement must preserve original metadata.", original);
  }
  // A valid PCM WAV must update the duration rather than inheriting the old file's.
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  const card = page.locator('.asset-library-card[data-asset-id="replacement_bgm"]');
  await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件" }).click();
  await input.setInputFiles({ name: "新音频.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "确认替换", exact: true }).click();
  const duration = await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().assetManifest.find(asset => asset.asset_id === "replacement_bgm").metadata.duration_ms);
  assert(Math.abs(duration - 1000) <= 2, "Valid replacement must use the new audio duration.", { duration });
  return { rejected: cases.map(item => item.name), duration };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { ok: true, at: new Date().toISOString(), editorUrl: EDITOR_URL, results: [], logs: [], error: undefined };
  let services = [];
  let browser;
  let context;
  let page;
  try {
    services = await ensureEditor(report);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1000, height: 760 } });
    page = await context.newPage();
    await openProject(page);
    for (const viewport of viewports) {
      report.results.push(await runViewport(page, viewport));
    }
    report.replacement = await runReplacement(page);
    report.mediaReplacement = await runMediaReplacement(page);
    report.projectDirectory = await runProjectDirectory(page);
  } catch (error) {
    report.ok = false;
    report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    if (page) {
      const failureScreenshot = path.join(OUT_DIR, "failure.png");
      await page.screenshot({ path: failureScreenshot, fullPage: true }).catch(() => {});
      report.failureScreenshot = failureScreenshot;
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    stopServices(services);
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: report.ok,
      reportPath: REPORT_PATH,
      results: report.results.map((item) => ({ viewport: item.viewport, screenshot: item.screenshot })),
      error: report.error,
    }, null, 2));
  }
  if (!report.ok) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
