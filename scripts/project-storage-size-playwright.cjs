#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");

const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "data", "backup-timeline", "project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj");
const backendRoot = path.join(root, "backend");
const editorRoot = path.join(root, "editor");
const backendUrl = "http://127.0.0.1:8278";
const editorUrl = "http://127.0.0.1:6767/";
const outputDir = path.join(root, "output", "playwright", "project-storage-size");
const transientKeys = new Set(["bytes", "data_url", "blob_url", "filePath", "url", "backend_asset_path"]);

function assert(condition, message, details) {
  if (!condition) throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ""}`);
}

async function ready(url) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server not ready: ${url}`);
}

function stop(child) {
  if (!child?.pid) return;
  try {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {}
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !transientKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  }
  return value;
}

async function calculateStorage(project) {
  const projectBytes = Buffer.byteLength(JSON.stringify(normalize(project)), "utf8");
  let assetBytes = 0;
  for (const asset of project.asset_manifest ?? []) {
    const backendPath = asset?.metadata?.backend_asset_path;
    if (!backendPath) continue;
    const response = await fetch(`${backendUrl}/api/project/assets/${backendPath}`);
    assert(response.ok, `asset fetch failed: ${backendPath}`);
    assetBytes += Number(response.headers.get("content-length") || (await response.arrayBuffer()).byteLength);
  }
  return { projectBytes, assetBytes, total: projectBytes + assetBytes };
}

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const backend = spawn("python", ["backend_launcher.py"], { cwd: backendRoot, windowsHide: true, stdio: "ignore" });
  const editor = spawn("cmd.exe", ["/d", "/s", "/c", "npm run dev -- --host 127.0.0.1 --port 6767"], { cwd: editorRoot, windowsHide: true, stdio: "ignore" });
  const errors = [];
  try {
    await ready(`${backendUrl}/api/health`);
    await ready(editorUrl);
    const importResponse = await fetch(`${backendUrl}/api/project/projects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent("隐忍的成长.vnproj") },
      body: fs.readFileSync(fixture),
    });
    assert(importResponse.ok, "fixture import failed", await importResponse.text());
    const detailPayload = await fetch(`${backendUrl}/api/project/projects/project_msiz08p7_0_89ebc8a8cb`).then((response) => response.json());
    assert(detailPayload.ok, "project detail missing", detailPayload);
    const expected = await calculateStorage(detailPayload.data);
    const catalogPayload = await fetch(`${backendUrl}/api/project/catalog`).then((response) => response.json());
    const record = catalogPayload.data.find((item) => item.project_id === "project_msiz08p7_0_89ebc8a8cb");
    assert(record?.size_source === "storage", "catalog source is not storage", record);
    assert(record.size_bytes === expected.total, "catalog storage bytes mismatch", { record, expected });

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.stack || error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    const project = page.locator('.recent-project-open:visible:not(:disabled)').filter({ hasText: "隐忍的成长" }).first();
    await project.waitFor({ state: "visible", timeout: 60_000 });
    const readHomeSize = () => project.locator(".recent-project-meta em").textContent();
    const firstText = await readHomeSize();
    assert(firstText && !firstText.includes("0 B") && !firstText.includes("未保存"), "home showed unknown/zero storage", firstText);
    await page.reload({ waitUntil: "domcontentloaded" });
    const refreshedProject = page.locator('.recent-project-open:visible:not(:disabled)').filter({ hasText: "隐忍的成长" }).first();
    await refreshedProject.waitFor({ state: "visible", timeout: 60_000 });
    const refreshedText = await refreshedProject.locator(".recent-project-meta em").textContent();
    assert(refreshedText === firstText, "home storage regressed after refresh", { firstText, refreshedText });
    assert(errors.length === 0, "browser errors", errors);
    await browser.close();
    fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify({ ok: true, expected, record, firstText, refreshedText, errors }, null, 2));
    console.log(`project-storage-size-playwright: PASS (${outputDir})`);
  } finally {
    stop(editor);
    stop(backend);
  }
})().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "error.txt"), String(error.stack || error));
  console.error(error.stack || error);
  process.exitCode = 1;
});
