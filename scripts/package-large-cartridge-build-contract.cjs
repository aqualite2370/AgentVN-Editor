const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cargo = fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/Cargo.toml"), "utf8");
const windowsBuild = fs.readFileSync(path.join(root, "scripts/build-runtime-standalone-windows.cjs"), "utf8");
const androidBuild = fs.readFileSync(path.join(root, "scripts/build-runtime-standalone-android.ps1"), "utf8");
const tauriConfig = fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/tauri.conf.json"), "utf8");
const player = fs.readFileSync(path.join(root, "GameCli_framework/src/cartridge/desktopLibrary.ts"), "utf8");
const playerHost = fs.readFileSync(path.join(root, "GameCli_framework/src-tauri/src/lib.rs"), "utf8");

if (!/\[profile\.release\.package\.agentvn-player\][\s\S]*opt-level\s*=\s*0[\s\S]*codegen-units\s*=\s*256/.test(cargo)) {
  throw new Error("the player crate must use the bounded-memory release profile for large embedded cartridges");
}
if (!/CARGO_BUILD_JOBS:\s*"1"/.test(windowsBuild)) {
  throw new Error("Windows standalone builds must serialize Rust compilation for large cartridges");
}
if (!/packagedEmbeddedDir\s*=\s*path\.join\(runtimeRoot,\s*"src-tauri",\s*"resources",\s*"embedded-cartridge"\)/.test(windowsBuild)) {
  throw new Error("Windows standalone builds must unpack fixed games outside frontendDist");
}
if (!androidBuild.includes('$env:CARGO_BUILD_JOBS = "1"') || !androidBuild.includes("PreviousCargoBuildJobsEnv")) {
  throw new Error("Android standalone builds must serialize Rust compilation and restore CARGO_BUILD_JOBS");
}
if (!androidBuild.includes("PackagedEmbeddedDir") || !androidBuild.includes("src-tauri\\resources\\embedded-cartridge")) {
  throw new Error("Android standalone builds must unpack fixed games outside frontendDist");
}
if (/unpack-vncart\.cjs"\)\s+\$ResolvedCartridge\s+\$EmbeddedDir/.test(androidBuild)) {
  throw new Error("Android standalone builds must not put large fixed assets in public/frontendDist");
}
if (!windowsBuild.includes('"--bundles", "nsis"')) {
  throw new Error("Large Windows standalone builds must select the reliable NSIS bundle explicitly");
}
if (/MSI installer \(\*\.msi\) was not found/.test(windowsBuild)) {
  throw new Error("Large Windows standalone builds must not fail because the optional WiX/MSI bundle is unavailable");
}
if (!windowsBuild.includes("resourceSource") || !windowsBuild.includes('path.join(portableRoot, "embedded-cartridge")')) {
  throw new Error("The Windows portable artifact must include its packaged embedded-cartridge resource tree");
}
if (!/"resources"\s*:\s*\{[\s\S]*"resources\/embedded-cartridge"\s*:\s*"embedded-cartridge"/.test(tauriConfig)) {
  throw new Error("Tauri must package the unpacked fixed game as a single bundle resource tree");
}
if (!player.includes('invoke<UnpackedPreviewPayload>("load_embedded_game")')) {
  throw new Error("the fixed client must load metadata through the native resource command");
}
if (!playerHost.includes("fn load_embedded_game") || !playerHost.includes("embedded_cartridge_resource_root")) {
  throw new Error("the player host must resolve and expose the packaged fixed-game resource directory");
}
if (!playerHost.includes('register_asynchronous_uri_scheme_protocol(\n            "agentvn-resource"')) {
  throw new Error("Android must expose packaged assets through the on-demand agentvn-resource protocol");
}
if (!playerHost.includes("EmbeddedResourceSource::Packaged")) {
  throw new Error("Android must keep packaged resources in the APK-backed resource source");
}
if (!playerHost.includes("const RESOURCE_RANGE_MAX_BYTES: u64 = 1024 * 1024")) {
  throw new Error("Packaged resource reads must remain capped at 1 MiB per range");
}
if (/for\s+relative_path\s+in\s+relative_paths[\s\S]*std::io::copy/.test(playerHost)) {
  throw new Error("Android startup must not copy the complete cartridge into private cache");
}

console.log("package large cartridge build contract: PASS");
