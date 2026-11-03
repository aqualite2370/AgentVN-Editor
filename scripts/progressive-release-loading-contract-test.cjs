const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function requirePattern(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

function rejectPattern(source, pattern, message) {
  if (pattern.test(source)) throw new Error(message);
}

const rust = read("GameCli_framework/src-tauri/src/lib.rs");
const desktopLibrary = read("GameCli_framework/src/cartridge/desktopLibrary.ts");
const runtimeStore = read("GameCli_framework/src/store/runtimeStore.ts");
const androidBuild = read("scripts/build-runtime-standalone-android.ps1");
const windowsBuild = read("scripts/build-runtime-standalone-windows.cjs");
const editorBuild = read("scripts/build-editor-windows.ps1");
const bundledScriptManifest = JSON.parse(read("scripts/standalone-build-scripts.json"));
const androidActivityTemplate = androidBuild.match(/\$activity\s*=\s*@'([\s\S]*?)^'@/m)?.[1] ?? "";

rejectPattern(
  rust,
  /for\s+relative_path\s+in\s+relative_paths[\s\S]*std::io::copy/,
  "Android embedded startup still copies the complete cartridge before boot.",
);
requirePattern(
  rust,
  /register_asynchronous_uri_scheme_protocol\(\s*"agentvn-resource"/,
  "The immutable agentvn-resource protocol is not registered.",
);
requirePattern(
  rust,
  /content-range/i,
  "The resource protocol does not expose byte-range responses.",
);
requirePattern(
  desktopLibrary,
  /startupIndex/,
  "Embedded game payload does not expose startup-index metadata.",
);
requirePattern(
  runtimeStore,
  /progressiveAssetLoader/,
  "Runtime store does not schedule progressive asset preparation.",
);
requirePattern(
  androidBuild,
  /build-release-runtime-assets\.cjs/,
  "Android standalone build does not generate release startup metadata.",
);
requirePattern(
  windowsBuild,
  /build-release-runtime-assets\.cjs/,
  "Windows standalone build does not generate release startup metadata.",
);
requirePattern(
  androidBuild,
  /noCompress/,
  "Android standalone build does not enforce uncompressed packaged media.",
);
for (const helper of [
  "unpack-vncart.cjs",
  "build-release-runtime-assets.cjs",
  "optimize-release-images-batch.cjs",
  "subset-release-font.cjs",
]) {
  if (!bundledScriptManifest.scripts.includes(helper)) {
    throw new Error(`The shared installed-editor script manifest does not bundle ${helper}.`);
  }
}
requirePattern(
  editorBuild,
  /standalone-build-scripts\.json/,
  "The installed editor workspace does not consume the shared script manifest.",
);
requirePattern(
  androidBuild,
  /function\s+Reset-AndroidPackagedResourceOutputs\s*\{/,
  "Android standalone build does not define its stale-resource cleanup function.",
);
rejectPattern(
  androidActivityTemplate,
  /Reset-AndroidPackagedResourceOutputs/,
  "The PowerShell stale-resource cleanup function was accidentally embedded in MainActivity.kt.",
);

console.log(JSON.stringify({
  ok: true,
  checks: [
    "no-full-android-materialization",
    "immutable-resource-protocol",
    "byte-range-contract",
    "startup-index-payload",
    "progressive-runtime-scheduler",
    "android-release-index",
    "windows-release-index",
    "android-no-compress",
    "installed-editor-release-helpers",
    "android-stale-resource-cleanup-scope",
  ],
}));
