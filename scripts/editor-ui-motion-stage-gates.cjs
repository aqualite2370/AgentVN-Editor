#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const root = path.resolve(__dirname, "..");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const homeSlice = process.argv.includes("--home-viewport");
const layoutSlice = process.argv.includes("--layout-switch");
const floatingSlice = !homeSlice && !process.argv.includes("--navigation-only");
const configuredOutput = process.env.AGENTVN_STAGE_GATES_OUTPUT;
const output = configuredOutput
  ? path.resolve(configuredOutput)
  : path.join(root, homeSlice ? "output/ui-motion-home-viewport"
    : layoutSlice ? "output/ui-motion-stage3"
    : floatingSlice ? "output/ui-motion-stage2" : "output/ui-motion-stage1", runId);
if (configuredOutput && (!output.toLowerCase().startsWith("f:\\agentvn\\qa\\")
  || fs.existsSync(output))) {
  throw new Error("AGENTVN_STAGE_GATES_OUTPUT must be a new, unique directory under F:/AgentVN/QA.");
}
fs.mkdirSync(output, { recursive: true });
const isolationRoot = fs.mkdtempSync(path.join(output, "AgentVN-Editor-Acceptance-"));
const fixtureTemplate = path.join(root, "scripts/fixtures/editor-isolated-small.vnproj");
const report = { runId, scope: homeSlice ? "project-home-viewport-and-entry-regression-not-final-release"
  : layoutSlice ? "layout-type-controls-and-independent-view-state-not-full-renpy-or-final-release"
  : floatingSlice ? "novel-task-floating-safety-and-presentation-not-final-release"
  : "navigation-state-and-presentation-slice-not-final-release",
  status: "RUNNING", checks: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const defaultAcceptanceEnv = {
  MOTION_VIEWPORTS: "1080p,1440p,4k", MOTION_DPR: "1", MOTION_REDUCED: "",
  ADVANCED_TOOLS_VIEWPORT: "1080p,1440p,4k", ADVANCED_TOOLS_DPR: "1", ADVANCED_TOOLS_REDUCED_MOTION: "",
  // The strict crossfade gate samples compositor frames. Run it headless by
  // default so a visible native window cannot introduce an OS/display stall
  // into the frame-continuity verdict; set ADVANCED_TOOLS_HEADFUL=1 when
  // native-window visibility itself is the subject of the run.
  ADVANCED_TOOLS_HEADFUL: process.env.ADVANCED_TOOLS_HEADFUL || "0",
  // Keep the motion gate on the same hardware-composited path used by the
  // standalone visual regression. The parent environment may override this
  // when a different ANGLE backend is the subject of the test.
  ADVANCED_TOOLS_ANGLE: process.env.ADVANCED_TOOLS_ANGLE || "d3d11",
  AGENTVN_ADVANCED_LAYOUT_HEADFUL: "1",
  AGENTVN_AUDIT_VIEWPORT: "1080p", AGENTVN_WORKSPACE_VIEWPORTS: "design,qhd,uhd",
  PROFILE_VIEWPORTS: JSON.stringify(desktopViewports), PROFILE_DPR: "1", PROFILE_FAST: "", PROFILE_REDUCED: "",
  PROFILE_HEADFUL: "1",
  PROFILE_MENU_VIEWPORTS: "", PROFILE_GRID_VIEWPORTS: "",
  FLOATING_VIEWPORTS: "1080p,1440p,4k", FLOATING_DPR: "1", FLOATING_REDUCED: "", FLOATING_HEADFUL: "1",
  RENPY_MENU_FAST: "", RENPY_TITLE_FAST: "", RENPY_TITLE_ACCEPTANCE: "",
  EXIT_FAST: "", EXIT_VIEWPORTS: "1920x1080,2560x1440,3840x2160",
};
async function execute(label, command, args, overrides = {}) {
  const logfile = path.join(output, `${String(report.checks.length + 1).padStart(2, "0")}-${label}.log`);
  const isolationId = `${String(report.checks.length + 1).padStart(2, "0")}-${label.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const isolationDir = path.join(isolationRoot, isolationId);
  fs.mkdirSync(isolationDir, { recursive: true });
  const fixturePath = path.join(isolationDir, "isolated-small.vnproj");
  const workspaceOutput = path.join(isolationDir, "workspace-output");
  fs.copyFileSync(fixtureTemplate, fixturePath);
  const startedAt = new Date().toISOString();
  console.log(`START ${label}`);
  const code = await new Promise(resolve => {
    const stream = fs.createWriteStream(logfile, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...defaultAcceptanceEnv, ...overrides,
        AGENTVN_TEST_PROJECT: fixturePath,
        AGENTVN_WORKSPACE_OUTPUT: workspaceOutput } });
    child.stdout.on("data", data => stream.write(data));
    child.stderr.on("data", data => stream.write(data));
    child.on("error", error => stream.write(String(error)));
    child.on("close", code => { stream.end(); resolve(code); });
  });
  report.checks.push({ label, command: [command, ...args], env: {
    ...defaultAcceptanceEnv, ...overrides,
    AGENTVN_TEST_PROJECT: fixturePath,
    AGENTVN_WORKSPACE_OUTPUT: workspaceOutput,
  }, startedAt,
    finishedAt: new Date().toISOString(), exitCode: code, status: code === 0 ? "PASS" : "FAILED", logfile });
  persist();
  console.log(`${code === 0 ? "PASS" : "FAILED"} ${label}`);
  if (code !== 0) throw Error(`Required gate failed: ${label}. Dev build prohibited.`);
  if (args.includes("scripts/novel-task-floating-playwright.cjs")) {
    const behavior = JSON.parse(fs.readFileSync(path.join(workspaceOutput, "report.json"), "utf8"));
    if (behavior.status !== "PASS" || !behavior.cases.length
      || behavior.cases.some(item => item.status !== "PASS"))
      throw Error(`Empty or incomplete floating behavior evidence: ${label}. Dev build prohibited.`);
  }
}
const test = (name, overrides) => execute(name, process.execPath, [`scripts/${name}.cjs`], overrides);
const npm = (prefix, task) => execute(`${prefix}-${task}`, "cmd.exe",
  ["/d", "/s", "/c", `npm --prefix D:\\AgentVN\\${prefix} run ${task}`]);
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
async function main() {
  report.isolation = {
    root: isolationRoot,
    fixtureTemplate,
    fixtureProjectId: "editor_isolated_small",
    policy: "one copied temporary .vnproj and one fresh workspace output directory per child process",
  };
  report.viewportPolicy = { current: desktopViewports, dpr: [1, 2], reducedMotion: [false, true] };
  persist();
  await test("editor-ui-acceptance-isolation-contract-test");
  await test("current-acceptance-viewports-test");
  if (homeSlice) {
    for (const [label, env] of [["dpr1", {}], ["dpr2", { PROFILE_DPR: "2" }],
      ["reduced", { PROFILE_REDUCED: "1" }]]) {
      await execute(`project-home-${label}`, process.execPath,
        ["scripts/runtime-layout-profiles-playwright.cjs", "--case=home-short"], env);
    }
    await npm("editor", "typecheck");
    await npm("editor", "build");
    await npm("GameCli_framework", "build");
    for (const name of ["owned-vite-server-test", "editor-workspace-contract",
      "editor-workspace-playwright", "editor-options-motion-playwright",
      "advanced-tools-transition-regression-playwright", "advanced-layout-transition-audit"]) {
      await test(name);
    }
    await execute("layout-reload", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--case=reload"]);
  } else {
  if (layoutSlice) {
    await execute("layout-profiles-reload-dpr1", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--case=reload"]);
    await execute("layout-profiles-reload-dpr2", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--case=reload"], { PROFILE_DPR: "2" });
    await execute("layout-profiles-dpr1", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs"]);
    await execute("layout-profiles-dpr2", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs"],
      { PROFILE_DPR: "2" });
    await execute("layout-profiles-structured-editor", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs"],
      { RENPY_TITLE_ACCEPTANCE: "1" });
  }
  if (floatingSlice) {
    await test("assistant-creation-process-queue-test");
    await test("assistant-project-lock-playwright");
    for (const name of ["ownership", "initial-refresh", "controller", "local-actions"])
      await execute(`floating-${name}`, process.execPath, ["scripts/novel-task-floating-playwright.cjs", `--case=${name}`]);
    await test("novel-task-poll-error-playwright");
    await test("novel-task-job-switch-playwright");
    await test("novel-task-result-notice-playwright");
    await test("novel-task-local-ownership-playwright");
    await test("novel-task-card-visual-playwright");
    for (const [label, overrides] of [["dpr1", {}], ["dpr2", { FLOATING_DPR: "2" }],
      ["reduced", { FLOATING_REDUCED: "1" }],
      ["reduced-dpr2", { FLOATING_REDUCED: "1", FLOATING_DPR: "2" }]]) {
      await execute(`floating-ui-${label}`, process.execPath, ["scripts/novel-task-floating-playwright.cjs"], overrides);
      await execute(`floating-motion-${label}`, process.execPath,
        ["scripts/novel-task-floating-playwright.cjs", "--case=motion"], overrides);
      await execute(`floating-handoff-${label}`, process.execPath,
        ["scripts/novel-task-floating-playwright.cjs", "--case=handoff"], overrides);
      await execute(`floating-workspace-${label}`, process.execPath,
        ["scripts/novel-task-floating-playwright.cjs", "--case=workspace"], overrides);
    }
  }
  await npm("editor", "typecheck");
  await npm("editor", "build");
  await npm("GameCli_framework", "build");
  // Run the strict frame-continuity suite before the other high-load browser
  // suites. It already owns a fresh backend/Vite/browser set; keeping it first
  // avoids carrying compositor pressure from unrelated 4K acceptance runs
  // into the crossfade verdict.
  await test("advanced-tools-transition-regression-playwright");
  await test("owned-vite-server-test");
  await test("preview-cancellation-evidence-test");
  await test("editor-options-motion-playwright");
  await execute("editor-options-motion-dpr2", process.execPath, ["scripts/editor-options-motion-playwright.cjs"], { MOTION_DPR: "2" });
  await execute("editor-options-motion-reduced", process.execPath, ["scripts/editor-options-motion-playwright.cjs"],
    { MOTION_REDUCED: "1" });
  for (const name of ["selection", "supersede", "rapid", "loaderror", "timeout",
    "workspace-load", "workspace-error", "workspace-motion", "initial-request"]) {
    await execute(`navigation-${name}`, process.execPath, ["scripts/editor-options-motion-playwright.cjs", `--case=${name}`],
      { MOTION_VIEWPORTS: "1080p,1440p,4k" });
  }
  for (const name of ["editor-workspace-contract", "editor-workspace-playwright",
    "runtime-layout-profiles-playwright", "renpy-menu-playwright", "renpy-help-playwright",
    "game-entry-transition-playwright",
    "novel-processing-core-test", "novel-import-append-graph-contract-test",
    "novel-import-chapter-idempotence-playwright",
    "runtime-save-queue-test", "runtime-exit-flow-test", "runtime-system-back-test",
    "runtime-window-close-test", "runtime-exit-behavior-playwright"]) {
    if (layoutSlice && name === "runtime-layout-profiles-playwright") continue;
    await test(name);
  }
  for (const viewport of ["1080p", "1440p", "4k"]) {
    await execute(`advanced-layout-audit-${viewport}`, process.execPath,
      ["scripts/advanced-layout-transition-audit.cjs"], { AGENTVN_AUDIT_VIEWPORT: viewport });
  }
  await execute("advanced-transitions-dpr2", process.execPath, ["scripts/advanced-tools-transition-regression-playwright.cjs"],
    { ADVANCED_TOOLS_DPR: "2" });
  await execute("advanced-transitions-reduced", process.execPath, ["scripts/advanced-tools-transition-regression-playwright.cjs"],
    { ADVANCED_TOOLS_REDUCED_MOTION: "1" });
  await execute("advanced-transitions-4k-repeat", process.execPath,
    ["scripts/advanced-tools-transition-regression-playwright.cjs", "--repeat-transitions=12"],
    { ADVANCED_TOOLS_VIEWPORT: "4k" });
  }
  const dev = path.join(root, "AgentVN Dev.exe");
  const before = fs.statSync(dev).mtime.toISOString();
  await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  report.dev = { path: dev, before, modifiedAt: fs.statSync(dev).mtime.toISOString(), sha256: sha(dev),
    compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")) };
  if (report.dev.sha256 !== report.dev.compiledSha256 || report.dev.before === report.dev.modifiedAt)
    throw Error("Dev executable was not actually overwritten.");
  report.resources = collectStageResourceEvidence(root, [
    "editor/src/components/advanced/AdvancedToolsPanel.tsx", "editor/src/components/editor/EditorToolbar.tsx",
    "editor/src/components/common/GlassSelectionGroup.tsx",
    "editor/src/utils/recoverableModuleLoader.ts", "editor/src/styles/editor-topbar.css",
    "editor/src/components/workspace/workspaceContracts.ts",
    "editor/src/styles/editor-shell.css", "editor/src/styles/layout.css", "editor/src/styles/variables.css",
    ...(homeSlice ? ["editor/src/app/App.css"] : []),
    "GameCli_framework/src/components/shell/HelpScreen.tsx", "shared/cartridge/uiLayoutProfiles.ts",
    ...(layoutSlice || floatingSlice ? [
      "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
      "editor/src/components/advanced/RuntimeLayoutTypeControls.tsx",
      "editor/src/components/advanced/renpy-title-editor.css",
    ] : []),
    ...(layoutSlice ? ["editor/src/components/advanced/RenpyTitleEditor.tsx"] : []),
    ...(floatingSlice ? [
      "editor/src/components/novel-import/NovelProcessTaskWorkbench.tsx",
      "editor/src/components/novel-import/NovelTaskCard.tsx",
      "editor/src/components/novel-import/useNovelTaskModalPriority.ts",
      "editor/src/components/novel-import/novel-task-floating.css",
      "editor/src/components/novel-import/novelTaskMotion.ts",
      "editor/src/store/novelImportStore.ts", "editor/src/novel-import/novelProcessJobAdapter.ts",
      "editor/src/api/backendClient.ts",
      "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
    ] : []),
  ]);
  report.status = homeSlice ? "PROJECT_HOME_VIEWPORT_GATES_PASS" : layoutSlice ? "LAYOUT_SWITCH_SLICE_GATES_PASS"
    : floatingSlice ? "NOVEL_FLOATING_SLICE_GATES_PASS" : "NAVIGATION_SLICE_GATES_PASS";
  report.remaining = homeSlice ? ["runtime menu motion", "full Ren'Py capabilities",
    "legacy installed feature acceptance", "installed Windows/Android final acceptance"]
    : [...(floatingSlice ? [] : ["draggable novel task workbench"]),
    ...(layoutSlice ? [] : ["layout type switch design"]),
    "runtime menu motion", "full Ren'Py capabilities", "installed Windows/Android final acceptance"];
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
