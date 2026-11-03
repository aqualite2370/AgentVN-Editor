const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const standaloneApi = read("editor/src/packaging/standalonePackage.ts");
const tauri = read("editor/src-tauri/src/main.rs");
const panel = read("editor/src/cartridge/ExportCartridgePanel.tsx");
const hover = read("editor/src/components/common/hoverHelpCatalog.ts");
const tauriConfig = read("editor/src-tauri/tauri.conf.json");
const buildEditorWindows = read("scripts/build-editor-windows.ps1");

for (const removed of [
  "scripts/setup-windows-build-env.ps1",
  "editor/src-tauri/bundle-workspace/scripts/setup-windows-build-env.ps1",
]) {
  assert(!fs.existsSync(path.join(root, removed)), `${removed} must be removed`);
}

assert(/check_windows_build_environment/.test(tauri), "Tauri exposes check_windows_build_environment");
assert(/install_windows_build_environment/.test(tauri), "Tauri exposes install_windows_build_environment");
assert(/build_native_windows_environment_checks/.test(tauri), "Tauri performs Windows environment checks natively in Rust");
assert(/find_native_windows_tool/.test(tauri) && /node.*npm.*cargo.*rustup/s.test(tauri), "native checker detects node/npm/cargo/rustup");
assert(/OpenJS\.NodeJS\.LTS/.test(tauri) && /Rustlang\.Rustup/.test(tauri), "native repair can install Node.js LTS and rustup through winget");
assert(/Microsoft\.VisualStudio\.2022\.BuildTools/.test(tauri) && /native_windows_msvc_check/.test(tauri), "native repair checks and installs Visual Studio Build Tools");
assert(/native_windows_nsis_check/.test(tauri) && /tauri_nsis_toolset/.test(tauri), "native repair checks the Tauri NSIS offline toolset");
assert(/install_bundled_windows_nsis_toolset/.test(tauri), "native repair deploys the bundled Tauri NSIS offline toolset");
assert(/rustup toolchain install stable-msvc --profile minimal/.test(tauri), "native repair installs the stable MSVC Rust toolchain");
assert(/rustup default stable-msvc/.test(tauri), "native repair activates the stable MSVC Rust toolchain");
assert(/tool\.to_ascii_uppercase/.test(tauri), "native checker honors explicit CARGO and RUSTUP executable overrides");
assert(/manualFix/.test(tauri) && /Node\.js|Rust|Visual Studio|MSVC/s.test(tauri), "native checker reports manual fixes");
assert(/windows-env/.test(tauri), "Tauri streams Windows environment logs with windows-env source");
assert(/PackageEnvironmentOperationProgressEvent/.test(tauri), "Tauri exposes structured package environment progress events");
assert(/agentvn:\/\/package-environment-operation-progress/.test(tauri), "Tauri emits the package environment operation progress event");
assert(/\"preparing\"[\s\S]*\"checking\"[\s\S]*\"installing\"[\s\S]*\"verifying\"[\s\S]*\"completed\"/.test(tauri), "Windows repair reports preparation, check, install, verify, and completion stages");
assert(/environment_pass_cache_path/.test(tauri) && /cached_environment_result/.test(tauri), "Windows environment PASS results are cached and reusable");
assert(/force_recheck/.test(tauri), "manual Windows environment checks can force a fresh native probe");
const nativeWindowsEnvBody = tauri.match(/fn run_windows_env_tool_blocking\([\s\S]*?\n}\n\nfn native_windows_tool_candidates/)?.[0] ?? "";
assert(nativeWindowsEnvBody && !/powershell/i.test(nativeWindowsEnvBody), "native Windows environment flow must not invoke PowerShell");
assert(!/setup-windows-build-env\.ps1/.test(tauri), "Tauri must not invoke the removed Windows PowerShell environment helper");
assert(!/setup-windows-build-env\.ps1/.test(tauriConfig), "Tauri resources must not bundle the removed Windows PowerShell environment helper");
assert(!/setup-windows-build-env\.ps1/.test(buildEditorWindows), "Windows editor packaging must not copy the removed Windows PowerShell environment helper");
assert(/bundle-workspace\/windows-offline-tools/.test(tauriConfig), "Editor packaging includes the Windows offline toolset");

assert(/checkWindowsBuildEnvironment/.test(standaloneApi), "frontend API exposes checkWindowsBuildEnvironment");
assert(/forceRecheck/.test(standaloneApi), "frontend API exposes forced environment rechecks");
assert(/installWindowsBuildEnvironment/.test(standaloneApi), "frontend API exposes installWindowsBuildEnvironment");
assert(/listenPackageEnvironmentOperationProgress/.test(standaloneApi), "frontend API listens for structured environment operation progress");

assert(/runWindowsEnvironmentCheck/.test(panel), "package panel can run Windows environment checks");
assert(/package\.windowsEnvCheck/.test(panel) && /package\.windowsEnvInstall/.test(panel), "package panel has Windows env check/install actions");
assert(/Windows.*环境|Windows.*鐜/.test(panel), "package panel renders a Windows environment panel");
assert(/检测详情/.test(panel), "package panel shows detailed Windows environment check messages");
assert(/package-environment-operation-dialog/.test(panel), "package panel renders a shared environment operation dialog");
assert(/data-environment-operation/.test(panel) && /data-environment-phase/.test(panel), "environment dialog exposes operation and phase state for acceptance checks");
assert(/package\.windowsEnvCheck/.test(hover) && /package\.windowsEnvInstall/.test(hover), "hover help includes Windows env buttons");

console.log("PASS windows package environment contract");

