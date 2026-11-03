#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "output", "hidden-growth", timestamp);
const logsDir = path.join(runDir, "logs");
const editorRoot = path.join(root, "editor");
const deterministicSteps = [];

fs.mkdirSync(logsDir, { recursive: true });

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return true;
}

function runStep(name, program, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(program, args, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? 20 * 60 * 1000,
    shell: options.shell ?? (process.platform === "win32" && program.toLowerCase().endsWith(".cmd")),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const stepDir = path.join(logsDir, name.replace(/[^a-z0-9._-]+/gi, "_"));
  fs.mkdirSync(stepDir, { recursive: true });
  fs.writeFileSync(path.join(stepDir, "stdout.log"), stdout, "utf8");
  fs.writeFileSync(path.join(stepDir, "stderr.log"), stderr, "utf8");
  const record = {
    name,
    command: [program, ...args].join(" "),
    cwd: options.cwd || root,
    elapsed_ms: Date.now() - startedAt,
    exit_code: result.status,
    signal: result.signal || null,
    timed_out: result.error?.code === "ETIMEDOUT",
    status: result.status === 0 ? "PASS" : "FAIL",
  };
  writeJson(path.join(stepDir, "result.json"), record);
  deterministicSteps.push(record);
  console.log(`[${record.status}] ${name} (${record.elapsed_ms}ms)`);
  if (record.status === "FAIL") {
    console.error(stderr || stdout || result.error?.stack || result.error || "command failed");
  }
  return record;
}

function node(script, args = [], options = {}) {
  return runStep(script.replace(/^scripts[\\/]/, "").replace(/\.cjs$/, ""), process.execPath, [path.join(root, script), ...args], options);
}

function npm(args, options = {}) {
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  return runStep(options.name || `npm-${args.join("-")}`, npmBin, args, {
    ...options,
    shell: process.platform === "win32",
  });
}

function allPassed() {
  return deterministicSteps.every((step) => step.status === "PASS");
}

const fixtureManifest = path.join(root, "output", "hidden-growth", "fixture-manifest.json");
const cartridge = path.join(root, "output", "hidden-growth", "hidden-growth.vncart");
const apk = path.join(root, "output", "hidden-growth", "android", "隐忍的成长-0.1.0.apk");
const androidRuntimeOutput = path.join(runDir, "android", "runtime-qa");

runStep(
  "fixture-preflight",
  process.execPath,
  [path.join(root, "scripts", "hidden-growth-fixture-preflight-test.cjs")],
);
copyIfPresent(fixtureManifest, path.join(runDir, "fixture-manifest.json"));

runStep(
  "backend-pytest",
  "python",
  ["-m", "pytest", "backend/tests", "-q", `--junitxml=${path.join(runDir, "backend-junit.xml")}`],
);

node("scripts/hidden-growth-cartridge-contract.cjs");
copyIfPresent(path.join(root, "output", "hidden-growth", "cartridge-contract.json"), path.join(runDir, "cartridge-contract.json"));
copyIfPresent(cartridge, path.join(runDir, "hidden-growth.vncart"));

npm(["--prefix", editorRoot, "run", "typecheck"], { name: "editor-typecheck-initial" });
npm(["--prefix", editorRoot, "run", "build"], { name: "editor-build-initial" });
node("scripts/editor-theme-palette-contract.cjs");
node("scripts/editor-theme-palette-playwright.cjs");
node("scripts/hidden-growth-editor-playwright.cjs");
node("scripts/editor-background-resume-playwright.cjs");
node("scripts/hidden-growth-runtime-playwright.cjs");
node("scripts/quick-menu-direction-playwright.cjs");
node("scripts/quick-menu-collapse-playwright.cjs");

node("scripts/hidden-growth-android-acceptance.cjs");
if (fs.existsSync(apk)) {
  node("scripts/android-apk-runtime-qa.cjs", [
    "--apk", apk,
    "--package", "com.agentvn.hidden.growth",
    "--serial", process.env.ANDROID_SERIAL || "emulator-5554",
    "--output", androidRuntimeOutput,
  ], { timeout: 30 * 60 * 1000 });
} else {
  deterministicSteps.push({
    name: "android-runtime-qa",
    status: "FAIL",
    exit_code: 1,
    reason: "APK was not produced by hidden-growth-android-acceptance",
  });
}
copyIfPresent(
  path.join(androidRuntimeOutput, "runtime-smoke-report.json"),
  path.join(runDir, "android", "runtime-smoke-report.json"),
);
copyIfPresent(
  path.join(root, "output", "hidden-growth", "android", "diagnostics", "package-build-manifest.json"),
  path.join(runDir, "package-build-manifest.json"),
);

runStep(
  "online-provider-spot-check",
  process.execPath,
  [path.join(root, "scripts", "hidden-growth-online-provider-spot-check.cjs"), path.join(runDir, "online-provider-spot-check.json")],
);

// The Windows Computer Use pass is recorded separately because it requires the
// real desktop window rather than a terminal-launched child process.
const windowsReport = path.join(runDir, "windows-dev-computer-use.json");
if (!fs.existsSync(windowsReport)) {
  writeJson(windowsReport, {
    status: "PENDING_COMPUTER_USE",
    app: "D:\\AgentVN\\AgentVN Dev.exe",
    project_id: "project_msiz08p7_0_89ebc8a8cb",
    title: "隐忍的成长",
    note: "Run after the final Dev launcher build; this file is intentionally not treated as a deterministic pass.",
  });
}

npm(["--prefix", editorRoot, "run", "typecheck"], { name: "editor-typecheck-final" });
npm(["--prefix", editorRoot, "run", "build"], { name: "editor-build-final" });
runStep(
  "dev-launcher",
  "powershell.exe",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "build-dev-launcher.ps1")],
  { timeout: 30 * 60 * 1000 },
);

const summary = {
  status: allPassed() ? "DETERMINISTIC_PASS" : "DETERMINISTIC_FAIL",
  generated_at: new Date().toISOString(),
  run_dir: runDir,
  fixture: {
    project_id: "project_msiz08p7_0_89ebc8a8cb",
    title: "隐忍的成长",
    baseline: "data/backup-timeline/project_msiz08p7_0_89ebc8a8cb__1786898326185__project.vnproj",
    nodes: 19,
    edges: 21,
    scenes: 16,
    branches: 2,
    assets: 143,
  },
  deterministic_steps: deterministicSteps,
  online_provider_report: path.join(runDir, "online-provider-spot-check.json"),
  windows_report: windowsReport,
  dev_exe: "D:\\AgentVN\\AgentVN Dev.exe",
  blocking_failures: deterministicSteps.filter((step) => step.status !== "PASS"),
};
writeJson(path.join(runDir, "final-summary.json"), summary);
console.log(`hidden-growth-full-e2e: ${summary.status} (${runDir})`);
if (summary.status !== "DETERMINISTIC_PASS") process.exitCode = 1;
