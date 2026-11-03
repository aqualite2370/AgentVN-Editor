#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EDITOR_URL = process.env.AGENTVN_EDITOR_URL || "http://127.0.0.1:6767/";
const OUT_DIR = path.join(ROOT, "output", "playwright", "pending-fixes-real-qa");
const REPORT_PATH = path.join(OUT_DIR, "report.json");
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const checks = [
  {
    id: "runtime-dedupe-contract",
    target: "14-运行时动效和音效重复触发",
    name: "运行时去重契约样本",
    command: NPM,
    args: ["run", "test:runtime-dedupe"],
  },
  {
    id: "runtime-browser-acceptance",
    target: "14-运行时动效和音效重复触发",
    name: "运行时真实浏览器录屏验收",
    command: NPM,
    args: ["run", "acceptance:runtime-fixes"],
    report: "output/playwright/runtime-fix-engineering-acceptance/report.json",
    requiresVideo: true,
  },
  {
    id: "preflight-choice-contract",
    target: "脚本分析器和选项占位文本",
    name: "发布预检和选项文本契约样本",
    command: NPM,
    args: ["run", "test:novel-import-preflight-choice"],
  },
  {
    id: "editor-client-acceptance",
    target: "脚本分析器和选项占位文本",
    name: "编辑器真实客户端录屏验收",
    command: NPM,
    args: ["run", "acceptance:editor-client-preflight-choice"],
    needsEditor: true,
    report: "output/playwright/editor-client-preflight-choice/report.json",
    requiresVideo: true,
  },
  {
    id: "editor-build",
    target: "构建门禁",
    name: "编辑器前端构建",
    command: NPM,
    args: ["run", "build"],
    cwd: path.join(ROOT, "editor"),
  },
  {
    id: "gamecli-build",
    target: "构建门禁",
    name: "GameCLI 前端构建",
    command: NPM,
    args: ["run", "build"],
    cwd: path.join(ROOT, "GameCli_framework"),
  },
];

const report = {
  generatedAt: new Date().toISOString(),
  editorUrl: EDITOR_URL,
  status: "running",
  statusText: "运行中",
  requestedItems: [
    "14：修复角色立绘控制偶发动效滞后，并检查动效/音效二次调用和重叠问题",
    "脚本分析器：缺失资源必须显示具体场景、节点/卡片、命令和字段",
    "选项分支文本：不写入真实占位值，空值显示灰色提示，只在运行边界使用默认值",
  ],
  checks: [],
  evidence: [],
  logs: [],
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
    // Port may already be free.
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

function readJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`缺少子验收报告：${relativePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertArtifactExists(relativePath, label) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`${label}证据文件不存在：${relativePath}`);
  const stat = fs.statSync(filePath);
  if (stat.size <= 0) throw new Error(`${label}证据文件为空：${relativePath}`);
  return { path: relativePath, bytes: stat.size };
}

function collectEvidence(check) {
  if (!check.report) return;
  const childReport = readJson(check.report);
  if ((childReport.status ?? "passed") !== "passed") {
    throw new Error(`子验收报告未通过：${check.report}`);
  }
  const artifacts = childReport.artifacts ?? {};
  const videos = [...(childReport.videos ?? []), ...(artifacts.videos ?? [])];
  const screenshots = [...(childReport.screenshots ?? []), ...(artifacts.screenshots ?? [])];
  if (check.requiresVideo && videos.length === 0) {
    throw new Error(`缺少必要录屏证据：${check.id}`);
  }
  if (Array.isArray(childReport.assertions) && childReport.assertions.length === 0) {
    throw new Error(`断言证据为空：${check.id}`);
  }
  if (!Array.isArray(childReport.sampleCoverage) || childReport.sampleCoverage.length === 0) {
    throw new Error(`样本覆盖说明缺失：${check.id}`);
  }
  const verifiedVideos = videos.map((item) => assertArtifactExists(item, `${check.id} 录屏`));
  const verifiedScreenshots = screenshots.map((item) => assertArtifactExists(item, `${check.id} 截图`));
  report.evidence.push({
    checkId: check.id,
    target: check.target,
    report: check.report,
    status: childReport.status ?? "passed",
    statusText: statusText(childReport.status ?? "passed"),
    assertionCount: Array.isArray(childReport.assertions) ? childReport.assertions.length : undefined,
    sampleCoverage: childReport.sampleCoverage ?? [],
    videos: verifiedVideos,
    screenshots: verifiedScreenshots,
  });
}

function runCheck(check) {
  const startedAt = Date.now();
  const result = spawnSync(check.command, check.args, {
    cwd: check.cwd || ROOT,
    shell: process.platform === "win32" && /\.cmd$/i.test(check.command),
    windowsHide: true,
    encoding: "utf8",
    env: { ...process.env, AGENTVN_EDITOR_URL: EDITOR_URL },
    maxBuffer: 25 * 1024 * 1024,
  });
  const entry = {
    id: check.id,
    target: check.target,
    name: check.name,
    command: [check.command, ...check.args].join(" "),
    cwd: path.relative(ROOT, check.cwd || ROOT) || ".",
    exitCode: result.status,
    statusText: result.status === 0 ? "通过" : "失败",
    durationMs: Date.now() - startedAt,
    stdoutTail: (result.stdout || "").slice(-5000),
    stderrTail: (result.stderr || "").slice(-5000),
  };
  report.checks.push(entry);
  collectEvidence(check);
  writeReport();
  console.log(`[${result.status === 0 ? "通过" : "失败"}] ${check.name}`);
  if (result.status !== 0) throw new Error(`${check.name} 执行失败，退出码：${result.status}`);
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  writeReport();
  try {
    if (checks.some((check) => check.needsEditor)) {
      report.editorServer = await ensureEditor();
      writeReport();
    }
    for (const check of checks) runCheck(check);
    const videoEvidence = report.evidence.flatMap((entry) => entry.videos ?? []);
    if (videoEvidence.length < 2) throw new Error(`至少需要 2 个录屏证据，当前只有 ${videoEvidence.length} 个`);
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
    checks: report.checks.map((check) => ({ id: check.id, exitCode: check.exitCode })),
    videos: report.evidence.flatMap((entry) => entry.videos ?? []),
  }, null, 2));
}

main();
