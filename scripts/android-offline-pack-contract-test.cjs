const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function main() {
  const tauri = JSON.parse(read("editor/src-tauri/tauri.conf.json"));
  assert.equal(
    tauri.bundle.resources["android-offline-pack"],
    undefined,
    "the multi-gigabyte Android environment must not be embedded in the editor bundle",
  );

  const setup = read("scripts/setup-android-build-env.ps1");
  assert.match(setup, /\[string\]\$OfflinePackRoot/);
  assert.match(setup, /Get-FileHash/);
  assert.match(setup, /offline-pack-deployment\.json/);
  assert.match(setup, /OfflineOnly/);
  assert.match(setup, /ReplaceOfflinePack/);
  assert.match(setup, /ResetManagedEnvironment/);
  assert.match(setup, /Clear-AgentVNManagedAndroidEnvironment/);
  assert.match(setup, /Remove-AgentVNManagedUserPathEntries/);
  assert.match(setup, /Join-Path \$ToolRoot "node-portable"/);
  assert.match(setup, /AndroidToolchain|DefaultToolRoot/);
  assert.match(setup, /schemaVersion\s*=\s*2/);
  assert.match(setup, /ANDROID_ENV_CLEANUP_FAILED/);
  assert.match(setup, /ANDROID_ENV_INSTALL_INCOMPLETE/);
  assert.match(setup, /\[phase:cleaning\]/);
  assert.match(setup, /\[phase:installing\]/);
  assert.match(setup, /reclaimedBytes/);
  assert.match(setup, /installSource/);
  assert.match(setup, /AGENTVN_GRADLE_DISTRIBUTION/);
  assert.match(setup, /RUSTUP_TOOLCHAIN/);
  assert.match(setup, /stable-x86_64-pc-windows-msvc/);
  assert.match(setup, /mirrors\.aliyun\.com\/gradle\/distributions/);
  assert.match(setup, /services\.gradle\.org\/distributions/);
  assert.match(setup, /bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531/);

  const androidPs = read("scripts/build-runtime-standalone-android.ps1");
  assert.match(androidPs, /\[string\]\$OfflinePackRoot/);
  assert.match(androidPs, /distributionUrl=/);
  assert.match(androidPs, /GRADLE_DISTRIBUTION_DOWNLOAD_FAILED/);
  assert.match(androidPs, /GRADLE_DEPENDENCY_UNAVAILABLE/);
  assert.match(androidPs, /capture-android-build-diagnostics\.ps1/);
  assert.match(androidPs, /android-generated-project-diagnostics\.json/);
  assert.match(androidPs, /processUniversalReleaseMainManifest/);
  assert.match(androidPs, /--stacktrace/);
  assert.match(androidPs, /ANDROID_MANIFEST_INVALID/);

  const androidCjs = read("scripts/build-runtime-standalone-android.cjs");
  assert.match(androidCjs, /offlinePackRoot/);
  assert.match(androidCjs, /--OfflinePackRoot/);
  assert.match(androidCjs, /Buffer\.concat\(stdout\)\.toString\("utf8"\)/);

  const host = read("editor/src-tauri/src/main.rs");
  assert.match(host, /import_android_environment_package/);
  assert.match(host, /find_android_environment_archive/);
  assert.match(host, /AgentVN-Android-Environment\.avnenv/);
  const importCommand = host.slice(
    host.indexOf("async fn import_android_environment_package("),
    host.indexOf("\n#[tauri::command]", host.indexOf("async fn import_android_environment_package(") + 10),
  );
  assert.match(importCommand, /\.blocking_pick_file\(\)/);
  assert.match(importCommand, /\.add_filter\("AgentVN Android 环境包", &\["avnenv", "zip"\]\)/);
  assert.doesNotMatch(
    importCommand.slice(0, importCommand.indexOf(".blocking_pick_file()")),
    /find_android_environment_archive\(\)/,
    "active imports must never auto-select an archive before opening the user file picker",
  );
  assert.match(host, /stop_managed_android_tool_processes/);
  assert.match(host, /\[cfg\(debug_assertions\)\][\s\S]*find_workspace_root\(\)[\s\S]*find_android_environment_archive/);
  assert.match(host, /AGENTVN_ANDROID_ENVIRONMENT_PACKAGE/);
  assert.match(host, /agentvn-android-environment/);
  assert.match(host, /ANDROID_ENV_PACK_PATH_UNSAFE/);
  assert.match(host, /ANDROID_ENV_PACK_HASH_MISMATCH/);
  assert.match(host, /format\.json/);
  assert.match(host, /agentvn:\/\/android-env-import-progress/);
  assert.match(host, /processed_bytes/);
  assert.match(host, /reclaimed_bytes/);
  assert.match(host, /install_source/);
  assert.match(host, /ANDROID_ENV_BUSY/);
  assert.match(host, /ANDROID_ENV_CLEANUP_FAILED/);
  assert.match(host, /ANDROID_ENV_DISK_FULL/);
  assert.match(host, /ANDROID_ENV_INSTALL_INCOMPLETE/);
  assert.match(host, /ANDROID_ENV_DEPLOYMENT_INVALID/);
  assert.match(host, /\("payload\/toolchain", &paths\.tool_root\)/);
  assert.match(host, /\("payload\/gradle-home", &paths\.gradle_home\)/);
  assert.match(host, /Some\(&paths\)/);
  assert.match(host, /schemaVersion": 2/);

  const panel = read("editor/src/cartridge/ExportCartridgePanel.tsx");
  assert.match(panel, /导入构建依赖/);
  assert.match(panel, /优先调用国内镜像/);
  assert.match(panel, /listenAndroidEnvironmentImportProgress/);
  assert.match(panel, /applyAndroidEnvironmentInstallProgress/);
  assert.match(panel, /android-env-import-dialog/);
  assert.match(panel, /检查依赖/);
  assert.match(panel, /清理旧环境/);
  assert.match(panel, /安装新依赖/);
  assert.match(panel, /验证环境/);
  assert.match(panel, /已清理旧环境并释放/);
  assert.match(panel, /完成/);
  assert.match(panel, /正在补齐…/);

  const layout = read("editor/src/styles/layout.css");
  assert.match(layout, /\.android-env-actions\s*\{[\s\S]*flex-wrap:\s*wrap/);
  assert.match(layout, /\.android-env-actions button\s*\{[\s\S]*flex:\s*1 1 160px/);
  assert.match(layout, /\.android-env-import-backdrop\s*\{[\s\S]*backdrop-filter:\s*blur/);
  assert.match(layout, /\.android-env-import-dialog\s*\{[\s\S]*max-height:/);
  assert.match(layout, /\.android-env-import-body\s*\{[\s\S]*overflow:\s*auto/);

  const releaseBuilder = read("scripts/build-editor-windows.ps1");
  assert.doesNotMatch(releaseBuilder, /Prepare-AndroidOfflinePack/);

  const packGenerator = read("scripts/prepare-android-offline-pack.ps1");
  assert.match(packGenerator, /\[switch\]\$ReuseExpanded/);
  assert.match(packGenerator, /\[pscustomobject\]\[ordered\]@\{/);

  const diagnosticsHelper = read("scripts/capture-android-build-diagnostics.ps1");
  assert.match(diagnosticsHelper, /Read-StrictUtf8Text/);
  assert.match(diagnosticsHelper, /XmlReaderSettings/);
  assert.match(diagnosticsHelper, /android-generated-/);
  assert.match(diagnosticsHelper, /android-generated-project-diagnostics\.json/);
  assert.match(diagnosticsHelper, /ANDROID_GENERATED_PROJECT_INCOMPLETE/);

  console.log("PASS single-version Android environment replacement, direct deployment, China mirror fallback, installer UI, and deep Android failure diagnostics contract");
}

main();
