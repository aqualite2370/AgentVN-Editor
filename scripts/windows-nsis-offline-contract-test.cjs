const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const offlineRoot = path.join(root, "windows-offline-tools", "NSIS");
const requiredOfflineFiles = [
  "makensis.exe",
  path.join("Bin", "makensis.exe"),
  path.join("Include", "MUI2.nsh"),
  path.join("Plugins", "x86-unicode", "additional", "nsis_tauri_utils.dll"),
];

for (const relative of requiredOfflineFiles) {
  assert(
    fs.existsSync(path.join(offlineRoot, relative)),
    `Bundled Windows NSIS toolset is missing ${relative}`,
  );
}

const prepare = read("scripts/prepare-editor-runtime-resources.ps1");
assert(
  /windows-offline-tools/.test(prepare) && /Prepare-BundledWindowsTools/.test(prepare),
  "Editor resource preparation must copy the bundled Windows NSIS toolset",
);

const releaseBuilder = read("scripts/build-editor-windows.ps1");
assert(
  /prepare-editor-runtime-resources\.ps1/.test(releaseBuilder) &&
    /SkipGameCliPlayer/.test(releaseBuilder),
  "The formal Windows Editor release builder must use the common runtime-resource preparation entry before suppressing duplicate preparation",
);

const tauriConfig = read("editor/src-tauri/tauri.conf.json");
assert(
  /bundle-workspace\/windows-offline-tools/.test(tauriConfig),
  "Editor bundle resources must include the Windows offline toolset",
);

const windowsBuild = read("scripts/build-runtime-standalone-windows.cjs");
assert(
  /ensureOfflineNsisToolset/.test(windowsBuild),
  "Windows standalone builds must deploy the bundled NSIS toolset before invoking Tauri",
);
assert(
  /TAURI_NSIS_OFFLINE_TOOLSET_MISSING/.test(windowsBuild),
  "Windows standalone builds must report a stable missing-offline-NSIS failure code",
);

const tauriMain = read("editor/src-tauri/src/main.rs");
assert(
  /tauri_nsis_toolset/.test(tauriMain),
  "Windows environment checks must include the Tauri NSIS toolset",
);
assert(
  /install_bundled_windows_nsis_toolset/.test(tauriMain),
  "Windows one-click repair must deploy the bundled Tauri NSIS toolset",
);

console.log("PASS Windows NSIS toolset is bundled, checked, repaired, and used offline");
