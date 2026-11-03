#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const editorRoot = path.join(root, "editor");
const backendRoot = path.join(root, "backend");
const editorUrl = "http://127.0.0.1:6767/";
const backendUrl = "http://127.0.0.1:8278";
const outputDir = path.join(root, "output", "playwright", "project-home-size");
const TRANSIENT_METADATA_KEYS = new Set(["bytes", "data_url", "blob_url", "filePath", "url", "backend_asset_path"]);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function ready(url, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`server not ready: ${url}`);
}

function startEditor() {
  return spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6767"], {
    cwd: editorRoot,
    windowsHide: true,
    stdio: "ignore",
  });
}

function startBackend() {
  return spawn(process.env.PYTHON || "python", ["backend_launcher.py"], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: "ignore",
  });
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

function normalizeStorageValue(value) {
  if (Array.isArray(value)) return value.map(normalizeStorageValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !TRANSIENT_METADATA_KEYS.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeStorageValue(child)]),
    );
  }
  return value;
}

async function calculateStorageBytes(project) {
  const normalized = normalizeStorageValue(project);
  const projectBytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  let assetBytes = 0;
  for (const asset of project.asset_manifest ?? []) {
    const backendPath = asset?.metadata?.backend_asset_path;
    if (!backendPath) continue;
    const response = await fetch(`${backendUrl}/api/project/assets/${backendPath}`);
    assert(response.ok, `asset fetch failed while calculating storage: ${backendPath}`, response.status);
    assetBytes += Number(response.headers.get("content-length") || (await response.arrayBuffer()).byteLength);
  }
  return { projectBytes, assetBytes, total: projectBytes + assetBytes };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  assert(fs.existsSync(fixture), "hidden-growth fixture is missing");
  const expectedContainerBytes = fs.statSync(fixture).size;
  const backend = await ready(`${backendUrl}/api/health`).then(() => undefined).catch(() => startBackend());
  const editor = await ready(editorUrl).then(() => undefined).catch(() => startEditor());
  try {
    await ready(`${backendUrl}/api/health`);
    await ready(editorUrl);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    const fixtureBytes = fs.readFileSync(fixture);
    const importResponse = await fetch(`${backendUrl}/api/project/projects/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent("隐忍的成长.vnproj"),
      },
      body: fixtureBytes,
    });
    assert(importResponse.ok, "backend fixture import failed", await importResponse.text());
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    await page.locator(".project-home").waitFor({ state: "visible", timeout: 30_000 });
    const open = page.locator('.recent-project-open:visible:not(:disabled)').filter({ hasText: "隐忍的成长" }).first();
    await open.waitFor({ state: "visible", timeout: 45_000 });
    const catalogBeforeOpen = await fetch(`${backendUrl}/api/project/catalog`).then((response) => response.json());
    const record = catalogBeforeOpen.data.find((item) => item.project_id === "project_msiz08p7_0_89ebc8a8cb");
    assert(record, "hidden-growth catalog record missing", catalogBeforeOpen);
    const detail = await fetch(`${backendUrl}/api/project/projects/project_msiz08p7_0_89ebc8a8cb`).then((response) => response.json());
    const calculated = await calculateStorageBytes(detail.data);
    assert(record.size_bytes === calculated.total, "catalog size does not equal backend storage calculation", { calculated, record });
    assert(record.size_source === "storage", "catalog did not mark storage size source", record);
    assert(record.size_bytes !== expectedContainerBytes, "catalog still exposes raw container size", { expectedContainerBytes, record });
    await page.waitForFunction(() => {
      const candidates = [...document.querySelectorAll(".recent-project-open")];
      return candidates.some((element) => {
        if (!element.textContent?.includes("隐忍的成长")) return false;
        const text = element.querySelector(".recent-project-meta em")?.textContent ?? "";
        return Boolean(text && !text.includes("未保存") && !text.includes("0 B"));
      });
    }, undefined, { timeout: 60_000 }).catch(async (error) => {
      const snapshot = await page.evaluate(() => ({
        body: document.body.innerText.slice(0, 3000),
        url: location.href,
        projectHome: Boolean(document.querySelector(".project-home")),
        records: [...document.querySelectorAll(".recent-project-open")].map((element) => ({
          text: element.textContent,
          meta: element.querySelector(".recent-project-meta em")?.textContent ?? "",
        })),
      })).catch(() => ({}));
      throw new Error(`${error.message}\n${JSON.stringify(snapshot, null, 2)}`);
    });
    const renderedBefore = await open.locator(".recent-project-meta em").textContent().catch(() => "");
    assert(renderedBefore && !renderedBefore.includes("0 B") && !renderedBefore.includes("未保存"), "project home rendered an unknown/zero size before open", renderedBefore);
    await page.waitForTimeout(1200);
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await page.locator(".app-view-editor .editor-toolbar, .editor-shell .editor-toolbar").first().waitFor({ state: "visible", timeout: 90_000 });
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"), undefined, { timeout: 15_000 });
    const rendered = renderedBefore;
    assert(errors.length === 0, "editor emitted errors", errors);
    const report = { ok: true, containerBytes: expectedContainerBytes, calculated, catalog: record, rendered, errors };
    fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await browser.close();
    console.log(`project-home-size-playwright: PASS (${outputDir})`);
  } finally {
    stop(editor);
    stop(backend);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error), "utf8");
  console.error(error.stack || error);
  process.exitCode = 1;
});
