#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const OUT_DIR = path.join(ROOT, "output", "playwright", "complete-fix-regression");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  { name: "小说导入/预检/选项契约", command: "node", args: ["scripts/novel-import-preflight-choice-contract.cjs"] },
  { name: "小说处理核心逻辑", command: "node", args: ["scripts/novel-processing-core-test.cjs"] },
  { name: "立绘缩放按显示名同步", command: NPM, args: ["run", "test:sprite-scale-display-name"] },
  { name: "运行时音频/动效去重契约", command: NPM, args: ["run", "test:runtime-dedupe"] },
  { name: "GameCLI 预览协议", command: NPM, args: ["run", "test:gamecli-preview-protocol"] },
  { name: "项目设置/开场/GameShell 契约", command: NPM, args: ["run", "test:project-settings-opening"] },
  { name: "编辑器客户端预检/选项录屏验收", command: "node", args: ["scripts/editor-client-preflight-choice-acceptance.cjs"], needsEditor: true },
  { name: "小说处理任务创建客户端验收", command: "node", args: ["scripts/novel-process-job-creation-acceptance.cjs"], needsEditor: true },
  { name: "运行时修复浏览器录屏验收", command: NPM, args: ["run", "acceptance:runtime-fixes"] },
  { name: "编辑器前端构建", command: NPM, args: ["run", "build"], cwd: path.join(ROOT, "editor") },
  { name: "GameCLI 前端构建", command: NPM, args: ["run", "build"], cwd: path.join(ROOT, "GameCli_framework") },
];

const report = {
  generatedAt: new Date().toISOString(),
  editorUrl: EDITOR_URL,
  checks: [],
  logs: [],
  status: "running",
  statusText: "运行中",
};

let editorProcess;
let editorLogStream;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReport() {
  ensureDir(OUT_DIR);
  report.statusText = statusText(report.status);
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function statusText(status) {
  if (status === "passed") return "通过";
  if (status === "failed") return "失败";
  if (status === "running") return "运行中";
  return String(status);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthyEditor(url) {
  try {
    const response = await fetch(new URL("/src/main.tsx", url));
    if (response.status >= 500) return false;
    const text = await response.text();
    return text.includes("ReactDOM.createRoot") || text.includes("from \"/src/");
  } catch {
    return false;
  }
}

function killPortOwner(port) {
  if (process.platform !== "win32") return;
  try {
    const script = `(Get-NetTCPConnection -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) -join ','`;
    const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
    for (const pid of output.split(",").map((item) => item.trim()).filter(Boolean)) {
      execFileSync("taskkill.exe", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    }
  } catch {
    // The port may already be free.
  }
}

function startEditor() {
  const logPath = path.join(OUT_DIR, "editor-dev-server.log");
  ensureDir(path.dirname(logPath));
  editorLogStream = fs.createWriteStream(logPath, { flags: "a" });
  report.logs.push(path.relative(ROOT, logPath).replaceAll("\\", "/"));
  editorProcess = spawn(NPM, ["run", "dev"], {
    cwd: path.join(ROOT, "editor"),
    shell: process.platform === "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  editorProcess.stdout.pipe(editorLogStream);
  editorProcess.stderr.pipe(editorLogStream);
}

async function ensureEditor() {
  if (await isHealthyEditor(EDITOR_URL)) return { reused: true };
  const port = Number(new URL(EDITOR_URL).port || 80);
  killPortOwner(port);
  await sleep(800);
  startEditor();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await isHealthyEditor(EDITOR_URL)) return { reused: false };
    await sleep(700);
  }
  throw new Error(`编辑器开发服务未在超时时间内就绪：${EDITOR_URL}`);
}

function stopEditorIfStarted() {
  if (editorProcess?.pid) {
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(editorProcess.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        editorProcess.kill("SIGTERM");
      }
    } catch {
      // Already stopped.
    }
  }
  editorLogStream?.end();
}

function runCheck(check) {
  const startedAt = Date.now();
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd || ROOT,
    shell: process.platform === "win32" && /\.cmd$/i.test(check.command),
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, AGENTVN_EDITOR_URL: EDITOR_URL },
    maxBuffer: 20 * 1024 * 1024,
  });
  const entry = {
    name: check.name,
    command: [check.command, ...check.args].join(" "),
    cwd: path.relative(ROOT, check.cwd || ROOT) || ".",
    exitCode: result.status,
    statusText: result.status === 0 ? "通过" : "失败",
    durationMs: Date.now() - startedAt,
    stdoutTail: (result.stdout || "").slice(-4000),
    stderrTail: (result.stderr || "").slice(-4000),
  };
  report.checks.push(entry);
  writeReport();
  const mark = result.status === 0 ? "通过" : "失败";
  console.log(`[${mark}] ${check.name} (${entry.durationMs}ms)`);
  if (result.status !== 0) {
    throw new Error(`${check.name} 执行失败，退出码：${result.status}`);
  }
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  writeReport();
  try {
    const needsEditor = checks.some((check) => check.needsEditor);
    if (needsEditor) {
      const editor = await ensureEditor();
      report.editorServer = editor;
      writeReport();
    }
    for (const check of checks) runCheck(check);
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport();
    stopEditorIfStarted();
  }
  console.log(JSON.stringify({
    status: report.status,
    statusText: statusText(report.status),
    report: path.relative(ROOT, REPORT_PATH),
    checks: report.checks.map((check) => ({ name: check.name, exitCode: check.exitCode })),
  }, null, 2));
}

main();
