"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const root = path.resolve(__dirname, ".."), out = `F:/AgentVN/Checkpoints/Android-Exit-20261024-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sha = f => createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const files = ["AGENTS.md", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "GameCli_framework/src/utils/runtimeWindowClose.ts", "GameCli_framework/src/utils/runtimeExitFlow.ts",
  "GameCli_framework/src/utils/runtimeSaveQueue.ts", "GameCli_framework/src/store/runtimeStore.ts",
  "GameCli_framework/src/components/shell/ExitGameDialog.tsx", "GameCli_framework/src-tauri/src/lib.rs",
  "GameCli_framework/src-tauri/Cargo.lock", "GameCli_framework/src-tauri/capabilities/default.json",
  "scripts/android-current-navigation.cjs", "scripts/android-current-navigation-launch.cjs",
  "scripts/android-current-navigation-test.cjs", "scripts/android-current-navigation-audit.cjs",
  "scripts/start-android-acceptance.ps1", "scripts/runtime-window-close-test.cjs",
  "scripts/runtime-exit-flow-test.cjs", "scripts/runtime-exit-behavior-playwright.cjs",
  "scripts/android-exit-stage-gates.cjs", "scripts/android-exit-device.cjs",
  "scripts/android-exit-device-audit.cjs", "scripts/android-exit-source-package.cjs",
  "scripts/android-exit-desktop-native.cjs", "scripts/android-exit-checkpoint.cjs",
  "scripts/build-runtime-standalone-android.ps1", "scripts/android-runtime-policy-manifest-test.cjs",
  ...(Number(attempt) >= 9 ? [
    "GameCli_framework/src-tauri/src/android_activity.rs",
    "GameCli_framework/src-tauri/src/android_activity_state.rs",
  ] : []),
  ...(Number(attempt) >= 10 ? ["scripts/android-runtime-activity.gradle"] : []),
  ...(Number(attempt) >= 15 ? [
    "scripts/android-runtime-agp-integration-test.cjs",
    "scripts/android-runtime-gradle-integration-test.cjs",
    "scripts/android-plugin-manager-release-test.cjs",
    "scripts/android-runtime-lifecycle-dex-audit.cjs",
  ] : []),
  ...(Number(attempt) >= 18 ? [
    "scripts/lib/android-exit-failure-evidence.cjs",
    "scripts/android-exit-failure-evidence-test.cjs",
  ] : []),
  ...(Number(attempt) >= 7 ? ["GameCli_framework/src-tauri/Cargo.toml"] : []),
  ...(Number(attempt) >= 6 ? ["scripts/android-managed-exit-test.cjs", "scripts/android-managed-exit-r8-test.cjs"] : [])];
const entries = files.map(f => {
  const original = path.join(root, f), copy = path.join(out, "files", f);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(copy), sha(original)); return { file: f, copy, sha256: sha(original) };
});
const artifacts = ["D:/AgentVN/AgentVN Dev.exe", "D:/AgentVN/editor/src-tauri/binaries/agentvn-player.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-editor.exe",
  "F:/AgentVN/QA/Editor-1.9.22-20261022-01/install-01/installed-nsis/agentvn-player.exe",
  "F:/AgentVN/QA/Android-Package-20261021-01/editor-12/Android 输出/AVN Android QA 20261021-0.1.1.apk",
  "F:/AgentVN/QA/Android-Package-20261021-01/device-navigation-12-04/runtime/navigation-report.json",
  ...(attempt === "01" ? [] : [
    "F:/AgentVN/QA/Android-Exit-20261024-01/device-04/runtime/report.json",
    "F:/AgentVN/QA/Android-Exit-20261024-01/device-04/runtime/agentvn-logcat.txt",
    "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-02/build-report.json",
    ...(Number(attempt) >= 5 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-03/build-report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-12/runtime/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-12/runtime/native-symbolization-returns.json",
    ] : []),
    ...(Number(attempt) >= 6 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/r8-entrypoint-red-01/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/r8-regression-red-01/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/matrix-03/report.json",
    ] : []),
    ...(Number(attempt) >= 7 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-04/build-report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-13/runtime/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-13/runtime/agentvn-failure-logcat.txt",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device13-failure-audit-02/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/final-dex-04-positive-01/report.json",
    ] : []),
    ...(Number(attempt) >= 8 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/managed-reopen-red-01/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/activity-reopen-dependency-audit-02/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-audit-13/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/managed-device-audit-13.json",
    ] : []),
    ...(Number(attempt) >= 10 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-05/build-report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-05/administrator.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/gradle-settings-integration-red-01/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/cancel-invalid-gradle-build-05-01.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/cancel-invalid-cargo-build-05-02.json",
    ] : []),
    ...(Number(attempt) >= 15 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-08/build-report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-08/administrator.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-08/agentvn-diagnostics/standalone-android-build.log",
      "F:/AgentVN/QA/Android-Exit-20261024-01/native-audit-08/report.json",
      "F:/AgentVN/QA/Native-Runtime-State-20261020-01/android-exit-20261024-08/report.json",
    ] : []),
    ...(Number(attempt) >= 18 ? [
      "F:/AgentVN/QA/Android-Exit-20261024-01/build-09/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/apk-build-09/build-report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-16/runtime/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-17/runtime/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device17-failure-audit-01/report.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-17/runtime/agentvn-title_auto_off-failure-evidence.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-17/runtime/agentvn-title_auto_off-failure-dom.json",
      "F:/AgentVN/QA/Android-Exit-20261024-01/device-17/runtime/agentvn-title_auto_off-failure-native-0.log",
    ] : []),
  ])]
  .map(f => ({ path: f, sha256: sha(f), bytes: fs.statSync(f).size }));
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), scope: "ANDROID_EXIT_CHECKPOINT_BEFORE_NEXT_PRODUCT_CHANGE", entries, artifacts,
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, sources: entries.length, artifacts: artifacts.length }));
