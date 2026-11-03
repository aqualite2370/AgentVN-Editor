"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/ui-motion-runtime-menu", runId);
fs.mkdirSync(output, { recursive: true });
const report = { runId, scope: "runtime-menu-motion-regression-and-dev-not-installed-final",
  status: "RUNNING", checks: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function execute(label, command, args, env = {}) {
  const logfile = path.join(output, `${String(report.checks.length + 1).padStart(2, "0")}-${label}.log`);
  const startedAt = new Date().toISOString();
  console.log(`START ${label}`);
  const exitCode = await new Promise(resolve => {
    const stream = fs.createWriteStream(logfile, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RUNTIME_MOTION_VIEWPORTS: "", RUNTIME_MOTION_DPR: "1", RUNTIME_MOTION_REDUCED: "",
        RENPY_MENU_FAST: "", PROFILE_DPR: "1", PROFILE_VIEWPORTS: "", PROFILE_FAST: "",
        EXIT_FAST: "", EXIT_VIEWPORTS: "", AGENTVN_WORKSPACE_VIEWPORTS: "",
        ADVANCED_TOOLS_VIEWPORT: "", ADVANCED_TOOLS_DPR: "1", ADVANCED_TOOLS_REDUCED_MOTION: "",
        AGENTVN_AUDIT_VIEWPORT: "", ...env } });
    child.stdout.on("data", data => stream.write(data));
    child.stderr.on("data", data => stream.write(data));
    child.on("error", error => stream.write(String(error)));
    child.on("close", code => { stream.end(); resolve(code); });
  });
  report.checks.push({ label, command: [command, ...args], env, startedAt,
    finishedAt: new Date().toISOString(), exitCode, status: exitCode === 0 ? "PASS" : "FAILED", logfile });
  persist();
  console.log(`${exitCode === 0 ? "PASS" : "FAILED"} ${label}`);
  assert.equal(exitCode, 0, `Required gate failed: ${label}; Dev build prohibited.`);
}
const test = name => execute(name, process.execPath, [`scripts/${name}.cjs`]);
const npm = (prefix, task) => execute(`${prefix}-${task}`, "cmd.exe",
  ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);

async function main() {
  persist();
  for (const [label, env] of [
    ["dpr1", {}],
    ["dpr2", { RUNTIME_MOTION_DPR: "2", RUNTIME_MOTION_VIEWPORTS: "1080p,1440p,4k" }],
    ["reduced", { RUNTIME_MOTION_REDUCED: "1", RUNTIME_MOTION_VIEWPORTS: "1080p,short,narrow" }],
  ]) await execute(`runtime-menu-${label}`, process.execPath, ["scripts/runtime-menu-motion-playwright.cjs"], env);
  await npm("editor", "typecheck");
  await npm("editor", "build");
  await npm("GameCli_framework", "build");
  for (const name of [
    "owned-vite-server-test", "runtime-screen-transition-contract",
    "runtime-agentvn-blackout-playwright",
    "editor-workspace-contract", "editor-workspace-playwright",
    "advanced-tools-transition-regression-playwright", "advanced-layout-transition-audit",
    "runtime-layout-profiles-playwright", "renpy-menu-playwright", "renpy-help-playwright",
    "runtime-shell-mobile-regressions-playwright", "game-entry-transition-playwright",
    "novel-processing-core-test", "novel-import-append-graph-contract-test",
    "novel-import-chapter-idempotence-playwright",
    "runtime-save-queue-test", "runtime-exit-flow-test", "runtime-system-back-test",
    "runtime-window-close-test", "runtime-exit-behavior-playwright",
  ]) await test(name);
  assert(report.checks.length > 0 && report.checks.every(check => check.status === "PASS"));
  const dev = path.join(root, "AgentVN Dev.exe");
  const before = fs.statSync(dev).mtime.toISOString();
  await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev = { path: dev, before, modifiedAt: fs.statSync(dev).mtime.toISOString(),
    sha256: sha(dev), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")) };
  assert.equal(report.dev.sha256, report.dev.compiledSha256, "Root Dev must match the compiled executable.");
  assert.notEqual(report.dev.before, report.dev.modifiedAt, "Root Dev must actually be overwritten.");
  report.resources = collectStageResourceEvidence(root, [
    "GameCli_framework/src/app/App.tsx", "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
    "GameCli_framework/src/store/runtimeStore.ts", "GameCli_framework/src/styles/shell.css",
    "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
    "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
    "GameCli_framework/src/components/shell/renpy-menu.css",
  ]);
  report.status = "RUNTIME_MENU_MOTION_SLICE_GATES_PASS";
  report.remaining = ["full Ren'Py capabilities", "legacy installed feature acceptance",
    "installed Windows/Android final acceptance"];
  persist();
  console.log(JSON.stringify(report.dev, null, 2));
}
main().catch(error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  if (!report.dev) report.dev = "NOT_BUILT";
  persist();
  console.error(report.error);
  process.exitCode = 1;
}).finally(() => console.log(`Evidence: ${path.join(output, "report.json")}`));
