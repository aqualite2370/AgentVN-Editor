#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { collectStageResourceEvidence } = require("./lib/stage-resource-evidence.cjs");
const root = path.resolve(__dirname, "..");
const helpSlice = process.argv.includes("--help-slice");
const exitSlice = process.argv.includes("--exit-slice");
const saveGridSlice = process.argv.includes("--save-grid");
const quickSaveSlice = process.argv.includes("--quick-save");
const guiZipImportSlice = process.argv.includes("--gui-zip-import");
const structuredMenu = process.argv.includes("--structured-menu");
const menuSlice = saveGridSlice || quickSaveSlice || exitSlice || structuredMenu || process.argv.includes("--menu-slice");
const output = path.join(root, guiZipImportSlice ? "output/renpy-gui-zip-import" : quickSaveSlice ? "output/renpy-quick-save" : saveGridSlice ? "output/renpy-stage2-save-grid" : helpSlice ? "output/renpy-stage2-help" : exitSlice ? "output/renpy-stage2-exit" : structuredMenu ? "output/renpy-stage2-structured-menu" : menuSlice ? "output/renpy-stage2-menu" : "output/renpy-stage2-title",
  new Date().toISOString().replace(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const report = { scope: guiZipImportSlice ? "renpy-gui-static-zip-and-native-directory-import-slice-not-full-renpy-or-release-acceptance" : quickSaveSlice ? "renpy-quick-save-load-category-pagination-and-eight-action-runtime-bar-not-full-renpy-or-release-acceptance" : saveGridSlice ? "renpy-save-grid-structure-inheritance-real-preview-only-not-pagination-quick-save-or-final-release" : helpSlice ? "independent-renpy-help-layout-and-preview-slice" : exitSlice ? "exit-save-safety-and-system-return-runtime-slice-not-final-release" : structuredMenu ? "stage-2-structured-menu-inheritance-and-runtime-editor-only" :
  menuSlice ? "stage-2-shared-menu-slice-only" : "stage-2-title-slice-only", status: "RUNNING", checks: [] };
const persist = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
async function execute(label, command, args, env = {}) {
  const logfile = path.join(output, `${String(report.checks.length + 1).padStart(2, "0")}-${label}.log`);
  const startedAt = new Date().toISOString();
  console.log(`START ${label}`);
  const code = await new Promise((resolve) => {
    const stream = fs.createWriteStream(logfile, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PROFILE_FAST: "", RENPY_TITLE_FAST: "", RENPY_MENU_FAST: "",
        RENPY_TITLE_ACCEPTANCE: "", PROFILE_VIEWPORTS: "", PROFILE_MENU_VIEWPORTS: "", PROFILE_GRID_VIEWPORTS: "",
        PROFILE_REDUCED: "", PROFILE_DPR: "1", ...env } });
    child.stdout.on("data", (data) => { stream.write(data); process.stdout.write(data); });
    child.stderr.on("data", (data) => { stream.write(data); process.stderr.write(data); });
    child.on("error", (error) => stream.write(String(error)));
    child.on("close", (code) => { stream.end(); resolve(code); });
  });
  report.checks.push({ label, command: [command, ...args], env, startedAt,
    finishedAt: new Date().toISOString(), exitCode: code, logfile, status: code === 0 ? "PASS" : "FAILED" });
  persist();
  if (code !== 0) throw Error(`Required gate failed: ${label}; Dev compilation blocked`);
}
async function main() {
  persist();
  await execute("stage-resource-evidence-test", process.execPath, ["scripts/stage-resource-evidence-test.cjs", "--fixtures-only"]);
  await execute("editor-typecheck", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run typecheck"]);
  await execute("editor-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\editor run build"]);
  await execute("runtime-build", "cmd.exe", ["/d", "/s", "/c", "npm --prefix D:\\AgentVN\\GameCli_framework run build"]);
  if (quickSaveSlice) {
    for (const name of [
      "quick-save-policy-test", "quick-save-storage-test", "quick-save-runtime-test",
      "runtime-save-queue-test", "gamecli-save-system-acceptance", "runtime-exit-flow-test",
      "runtime-system-back-test",
    ]) await execute(name, process.execPath, [`scripts/${name}.cjs`]);
    await execute("quick-save-native-storage-tests", "cargo", [
      "test", "--manifest-path", "GameCli_framework/src-tauri/Cargo.toml", "save_storage", "--", "--nocapture",
    ]);
    await execute("renpy-quick-save-browser-dpr1", process.execPath,
      ["scripts/renpy-quick-save-playwright.cjs"]);
    await execute("renpy-quick-save-browser-dpr2", process.execPath,
      ["scripts/renpy-quick-save-playwright.cjs"], { PROFILE_DPR: "2" });
    await execute("renpy-menu-browser", process.execPath, ["scripts/renpy-menu-playwright.cjs"]);
    await execute("renpy-menu-browser-dpr2", process.execPath, ["scripts/renpy-menu-playwright.cjs"],
      { PROFILE_DPR: "2" });
  }
  if (guiZipImportSlice) {
    for (const name of [
      "renpy-layout-runtime-test",
      "renpy-gui-import-contract-test",
      "renpy-gui-archive-scan-test",
      "renpy-gui-import-apply-test",
      "renpy-gui-import-roundtrip-test",
    ]) await execute(name, process.execPath, [`scripts/${name}.cjs`]);
    await execute("renpy-gui-native-directory-tests", "cargo", [
      "test", "--manifest-path", "editor/src-tauri/Cargo.toml",
      "renpy_gui_import::tests", "--", "--nocapture",
    ]);
    await execute("renpy-gui-import-browser-dpr1", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--gui-import"], { PROFILE_DPR: "1" });
    await execute("renpy-gui-import-browser-dpr2", process.execPath,
      ["scripts/runtime-layout-profiles-playwright.cjs", "--gui-import"], { PROFILE_DPR: "2" });
    await execute("renpy-button-frame-browser-dpr1", process.execPath,
      ["scripts/renpy-button-frame-playwright.cjs"]);
    await execute("renpy-button-frame-browser-dpr2", process.execPath,
      ["scripts/renpy-button-frame-playwright.cjs"], { PROFILE_DPR: "2" });
  }
  if (saveGridSlice) {
    await execute("renpy-save-grid-baseline", process.execPath, ["scripts/renpy-save-grid-baseline-playwright.cjs"]);
    await execute("renpy-save-grid-baseline-dpr2", process.execPath, ["scripts/renpy-save-grid-baseline-playwright.cjs"], { PROFILE_DPR: "2" });
    for (const name of [
      "owned-vite-server-test", "renpy-help-layout-test", "runtime-save-queue-test",
      "runtime-exit-flow-test", "runtime-system-back-test", "runtime-window-close-test",
      "editor-workspace-playwright", "advanced-tools-transition-regression-playwright",
      "advanced-layout-transition-audit", "game-entry-transition-playwright",
      "runtime-exit-behavior-playwright",
    ]) await execute(name, process.execPath, [`scripts/${name}.cjs`]);
    await execute("renpy-editor-reduced", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs"],
      { PROFILE_REDUCED: "1", RENPY_TITLE_ACCEPTANCE: "1",
        PROFILE_VIEWPORTS: "[[1920,1080],[3840,2160],[390,844]]",
        PROFILE_MENU_VIEWPORTS: "[[1920,1080],[3840,2160],[390,844]]" });
  }
  if (helpSlice) {
    await execute("renpy-help-layout-test", process.execPath, ["scripts/renpy-help-layout-test.cjs"]);
    await execute("renpy-help-playwright", process.execPath, ["scripts/renpy-help-playwright.cjs"]);
    await execute("renpy-help-dpr2", process.execPath, ["scripts/renpy-help-playwright.cjs"], { PROFILE_DPR: "2" });
    await execute("owned-vite-server-test", process.execPath, ["scripts/owned-vite-server-test.cjs"]);
    await execute("renpy-menu", process.execPath, ["scripts/renpy-menu-playwright.cjs"]);
    await execute("renpy-menu-dpr2", process.execPath, ["scripts/renpy-menu-playwright.cjs"], { PROFILE_DPR: "2" });
  }
  if (exitSlice) {
    for (const name of [
      "owned-vite-server-test", "runtime-save-queue-test", "runtime-exit-flow-test",
      "runtime-window-close-test", "runtime-system-back-test", "android-system-back-source-test",
      "android-runtime-policy-manifest-test", "main-menu-exit-contract", "settings-exit-placement-contract",
      "runtime-modal-visual-playwright", "runtime-exit-behavior-playwright", "settings-exit-placement-playwright",
    ]) await execute(name, process.execPath, [`scripts/${name}.cjs`], { EXIT_FAST: "", EXIT_VIEWPORTS: "" });
    await execute("runtime-exit-dpr2", process.execPath, ["scripts/runtime-exit-behavior-playwright.cjs"],
      { PROFILE_DPR: "2", EXIT_FAST: "", EXIT_VIEWPORTS: "" });
    await execute("settings-exit-dpr2", process.execPath, ["scripts/settings-exit-placement-playwright.cjs"], { PROFILE_DPR: "2" });
    await execute("runtime-modal-visual-dpr2", process.execPath, ["scripts/runtime-modal-visual-playwright.cjs"], { PROFILE_DPR: "2" });
  }
  for (const name of guiZipImportSlice ? [] : [
    "renpy-layout-runtime-test", "runtime-layout-profiles-test", "project-state-save-order-test",
    "runtime-layout-session-contract", "ui-skin-legacy-compat-contract",
    "ui-skin-style-component-health-contract", "editor-workspace-contract",
    "renpy-title-playwright", "runtime-layout-profiles-playwright",
    "client-layout-editing-regression-playwright", "runtime-shell-mobile-regressions-playwright",
  ]) await execute(name, process.execPath, [`scripts/${name}.cjs`],
    name === "runtime-layout-profiles-playwright" ? { RENPY_TITLE_ACCEPTANCE: "1" } : {});
  if (menuSlice) {
    await execute("renpy-menu", process.execPath, ["scripts/renpy-menu-playwright.cjs"]);
    await execute("renpy-menu-dpr2", process.execPath, ["scripts/renpy-menu-playwright.cjs"], { PROFILE_DPR: "2" });
  }
  await execute("renpy-title-dpr2", process.execPath, ["scripts/renpy-title-playwright.cjs"], { PROFILE_DPR: "2" });
  await execute("renpy-editor-dpr2", process.execPath, ["scripts/runtime-layout-profiles-playwright.cjs"],
    { PROFILE_DPR: "2", RENPY_TITLE_ACCEPTANCE: "1" });
  const actual = path.join(root, "AgentVN Dev.exe");
  const before = fs.statSync(actual).mtime.toISOString();
  await execute("dev-build", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    "D:\\AgentVN\\scripts\\build-dev-launcher.ps1"]);
  const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  report.dev = { path: actual, before, modifiedAt: fs.statSync(actual).mtime.toISOString(),
    sha256: sha(actual), compiledSha256: sha(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe")) };
  if (report.dev.sha256 !== report.dev.compiledSha256 || before === report.dev.modifiedAt)
    throw Error("Dev executable was not actually overwritten");
  const resources = collectStageResourceEvidence(root, [
    "shared/cartridge/uiSkin.ts", "shared/cartridge/uiLayoutProfiles.ts", "shared/cartridge/renpyGui.ts",
    "shared/cartridge/runtimeCapabilities.ts", "shared/cartridge/constants.ts",
    "GameCli_framework/src/components/shell/MainMenu.tsx",
    "GameCli_framework/src/components/shell/RenpyTitleView.tsx",
    "GameCli_framework/src/components/shell/renpy-title.css",
    "GameCli_framework/src/uiSkin/uiSkinRuntime.tsx",
    ...(menuSlice ? [
      "GameCli_framework/src/components/player/DialogBox.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
      "GameCli_framework/src/components/shell/renpy-menu.css",
      "GameCli_framework/src/components/shell/SettingsScreen.tsx",
      "GameCli_framework/src/components/shell/SaveLoadScreen.tsx",
      "GameCli_framework/src/components/shell/HistoryScreen.tsx",
      "GameCli_framework/src/components/shell/AboutScreen.tsx",
      "GameCli_framework/src/components/shell/GalleryScreen.tsx",
    ] : []),
    ...(saveGridSlice ? [
      "editor/src/components/advanced/RenpyTitleEditor.tsx",
      "editor/src/components/advanced/RenpyRuntimePreview.tsx",
      "GameCli_framework/src/app/RuntimeScreenNavigator.tsx",
      "GameCli_framework/src/styles/shell.css",
    ] : []),
    ...(exitSlice ? [
      "GameCli_framework/src/app/App.tsx",
      "GameCli_framework/src/store/runtimeStore.ts",
      "GameCli_framework/src/components/common/Modal.tsx",
      "GameCli_framework/src/components/shell/ExitGameDialog.tsx",
      "GameCli_framework/src/components/shell/HelpScreen.tsx",
      "GameCli_framework/src/utils/runtimeExitFlow.ts",
      "GameCli_framework/src/utils/runtimeSaveQueue.ts",
      "GameCli_framework/src/utils/runtimeSystemBack.ts",
      "GameCli_framework/src/utils/runtimeWindowClose.ts",
      "GameCli_framework/src/styles/shell.css",
      "GameCli_framework/src/styles/variables.css",
      "GameCli_framework/src-tauri/capabilities/default.json",
      "scripts/build-runtime-standalone-android.ps1",
    ] : []),
    ...(helpSlice ? [
      "shared/preview/livePreviewProtocol.ts",
      "GameCli_framework/src/app/App.tsx",
      "GameCli_framework/src/components/shell/HelpScreen.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
      "GameCli_framework/src/components/shell/renpy-menu.css",
      "editor/src/components/advanced/RenpyRuntimePreview.tsx",
      "editor/src/components/advanced/RenpyTitleEditor.tsx",
      "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
    ] : []),
    ...(guiZipImportSlice ? [
      "GameCli_framework/src/components/shell/RenpyMenuNavigation.tsx",
      "GameCli_framework/src/components/shell/RenpyMenuFrame.tsx",
      "GameCli_framework/src/components/shell/renpy-menu.css",
      "GameCli_framework/src/components/player/ChoicePanel.tsx",
      "GameCli_framework/src/styles/player.css",
      "editor/src/components/advanced/RuntimeLayoutDesigner.tsx",
      "editor/src/components/advanced/RenpyTitleEditor.tsx",
      "editor/src/components/advanced/RenpyGuiImportWorkbench.tsx",
      "editor/src/renpy/renpyGuiImport.ts",
      "editor/src/renpy/renpyGuiImportPlan.ts",
    ] : []),
  ]);
  report.bundled = resources.bundled;
  report.frontendSources = resources.frontendSources;
report.status = guiZipImportSlice ? "RENPY_GUI_ZIP_IMPORT_SLICE_GATES_PASS"
  : saveGridSlice ? "SAVE_GRID_STRUCTURE_SLICE_GATES_PASS"
  : helpSlice ? "HELP_LAYOUT_SLICE_GATES_PASS"
  : exitSlice ? "EXIT_RUNTIME_SLICE_GATES_PASS"
    : structuredMenu ? "STRUCTURED_MENU_SLICE_GATES_PASS"
      : menuSlice ? "MENU_SLICE_GATES_PASS" : "TITLE_SLICE_GATES_PASS";
  persist();
  console.log(JSON.stringify(report.dev, null, 2));
  console.log(`Evidence: ${output}`);
}
main().catch((error) => {
  report.status = "FAILED"; report.error = String(error.stack || error);
  if (!report.dev) report.dev = "NOT_VERIFIED";
  persist(); console.error(error); console.log(`Evidence: ${output}`); process.exitCode = 1;
});
