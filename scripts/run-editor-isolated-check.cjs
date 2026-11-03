#!/usr/bin/env node
"use strict";

// Run URL-configurable editor checks without touching a running user backend.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const checks = process.argv.slice(2);
if (!checks.length || checks.some((name) => path.basename(name) !== name || !name.endsWith(".cjs")
  || !fs.existsSync(path.join(__dirname, name)))) throw new Error("Pass repository script basenames");
const output = path.join(root, "output/playwright/isolated-checks", new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const editorPort = 6891, backendPort = 8391;
const editorUrl = `http://127.0.0.1:${editorPort}`;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const data = path.join(output, "isolated-data");
const env = { ...process.env, VITE_BACKEND_URL: backendUrl, AGENTVN_EDITOR_URL: editorUrl,
  AGENTVN_BACKEND_HEALTH_URL: `${backendUrl}/api/health`, AGENTVN_EDITOR_DATA_DIR: data,
  AGENTVN_BACKEND_DATA_DIR: data, DATABASE_PATH: path.join(data, "vn_engine.db"),
  AGENTVN_BACKEND_PORT: String(backendPort), AGENTVN_LEGACY_DATABASE_PATHS: "" };
function start(command, args, cwd, name) {
  const fd = fs.openSync(path.join(output, `${name}.log`), "a");
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  return child;
}
async function ready(url) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Server startup timed out: ${url}`);
}
async function main() {
  for (const port of [editorPort, backendPort]) await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
  const backend = start("python", ["backend_launcher.py"], path.join(root, "backend"), "backend");
  const editor = start(process.execPath, [path.join(root, "editor/node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(editorPort), "--strictPort"], path.join(root, "editor"), "editor");
  const results = [];
  try {
    await ready(`${backendUrl}/api/health`); await ready(editorUrl);
    for (const check of checks) {
      console.log(`Running isolated check: node scripts/${check}`);
      const code = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, check)], { cwd: root, env, windowsHide: true, stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", resolve);
      });
      results.push({ command: `node scripts/${check}`, exitCode: code });
      if (code !== 0) throw new Error(`${check} failed (${code})`);
    }
  } finally {
    for (const child of [editor, backend]) if (child.pid && child.exitCode === null) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    }
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify({ results, editorPort, backendPort, data }, null, 2));
    console.log(`Isolated check evidence: ${output}`);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
