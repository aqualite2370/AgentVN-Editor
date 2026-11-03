const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const runtimePackage = read("editor/src/packaging/runtimePackage.ts");
const windows = read("scripts/build-runtime-standalone-windows.cjs");
const android = read("scripts/build-runtime-standalone-android.ps1");
const iconModule = read("editor/src/packaging/standaloneIcon.ts");

assert(
  /standalone_icon_asset_id:\s*input\.packageAppearance\?\.standaloneIconAssetId\s*\?\?\s*input\.packageAppearance\?\.iconAssetId\s*\?\?\s*input\.packageAppearance\?\.coverAssetId/.test(runtimePackage),
  "package profile preserves standaloneIcon -> icon -> cover fallback order",
);
assert(/standaloneIconAssetId/.test(iconModule) && /resolveStandaloneIconAsset/.test(iconModule), "editor preserves standalone icon selection and fallback order");
assert(/readStandaloneIconSourceBlob/.test(iconModule) && /filePath/.test(iconModule), "editor reads persisted project icon files when URL/blob sources are unavailable");
assert(/applyRuntimeIcon/.test(windows) && /pngToIco/.test(windows) && /icon\.ico/.test(windows) && /icon\.png/.test(windows), "Windows build converts source image to Tauri ico/png icons");
assert(/captureRuntimeState/.test(windows) && /restoreRuntimeState/.test(windows) && /runtimeIconIcoPath/.test(windows) && /runtimeIconPngPath/.test(windows), "Windows build restores template icons");
assert(/Sync-AndroidLauncherIcons/.test(android), "Android build syncs launcher icon resources");
assert(/mipmap-mdpi/.test(android) && /mipmap-hdpi/.test(android) && /mipmap-xhdpi/.test(android) && /mipmap-xxhdpi/.test(android) && /mipmap-xxxhdpi/.test(android), "Android build covers launcher density buckets");
assert(/ic_launcher\.png/.test(android) && /ic_launcher_round\.png/.test(android) && /ic_launcher_foreground\.png/.test(android), "Android build updates launcher, round, and foreground resources");
assert(/Backup-AndroidLauncherIcons/.test(android) && /Restore-AndroidLauncherIcons/.test(android), "Android build backs up and restores launcher resources");

console.log("PASS standalone icon acceptance");
