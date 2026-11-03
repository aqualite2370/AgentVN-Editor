const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "editor/src/cartridge/ExportCartridgePanel.tsx"), "utf8");
const sessionSource = fs.readFileSync(path.join(root, "editor/src/packaging/packageTaskSession.ts"), "utf8");
for (const token of ["needsEnvironmentRepair", "window.confirm", "runAndroidEnvironmentCheck(true)", "runWindowsEnvironmentCheck(true)", "repaired?.status !== \"PASS\""]) {
  if (!source.includes(token)) throw new Error(`自动环境编排缺少 ${token}`);
}
if (!source.includes('missing: ["Android 环境检测调用失败"]')) throw new Error("Android 检测调用失败后必须进入可自动修复的 BLOCKED 状态");
for (const token of [
  "activeEnvBusy",
  "activeEnvBlocked",
  "activeEnvVerification",
  "activeEnvVerification.label",
  "activeEnvVerification.detail",
  "activeEnvVerification.freshPass",
  "androidEnvResult",
  "windowsEnvResult",
  "packageSession.beginTask",
  "environmentTasks",
  "deriveActivePackageEnvironment",
]) {
  if (!(source + sessionSource).includes(token)) {
    throw new Error(`platform-isolated environment state is missing ${token}`);
  }
}
for (const removedToken of ["environmentMessagesRef", "setMessages(", 'className="json-preview"']) {
  if (source.includes(removedToken)) {
    throw new Error(`unified package console still contains legacy message state: ${removedToken}`);
  }
}
if (!source.includes("visiblePackageEnvironmentManualFix(result)")) {
  throw new Error("PASS environment results must not render manualFix guidance");
}
if (!source.includes('data-environment-verification={windowsEnvVerification.state}')) {
  throw new Error("Windows environment card must expose the explicit verification state");
}
if (!source.includes('data-environment-verification={androidEnvVerification.state}')) {
  throw new Error("Android environment card must expose the explicit verification state");
}
const exportDisabledDeclaration = source.match(/const exportDisabled =[\s\S]*?;\r?\n/);
if (!exportDisabledDeclaration || !exportDisabledDeclaration[0].includes("activeEnvBusy")) {
  throw new Error("export disabled state must be derived from activeEnvBusy");
}
if (exportDisabledDeclaration[0].includes("androidEnvBusy") || exportDisabledDeclaration[0].includes("windowsEnvBusy")) {
  throw new Error("inactive platform checks must not disable the export action");
}
const tauriSource = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
const bomFixes = tauriSource.match(/trim_start_matches\('\\u\{feff\}'\)/g) ?? [];
if (bomFixes.length < 2) throw new Error("Android/Windows 环境报告必须兼容 Windows PowerShell UTF-8 BOM");
console.log("package environment orchestration contract: PASS");
