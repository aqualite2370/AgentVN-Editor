const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "editor", "src-tauri", "src", "main.rs"), "utf8");
const launcher = fs.readFileSync(path.join(root, "scripts", "build-dev-launcher.ps1"), "utf8");
const buildGameShell = fs.readFileSync(path.join(root, "scripts", "build-game-shell-windows.ps1"), "utf8");
const uiSkin = fs.readFileSync(path.join(root, "shared", "cartridge", "uiSkin.ts"), "utf8");
const runtime = fs.readFileSync(path.join(root, "GameCli_framework", "src", "uiSkin", "uiSkinRuntime.tsx"), "utf8");
const playerLib = fs.readFileSync(path.join(root, "GameCli_framework", "src-tauri", "src", "lib.rs"), "utf8");
const desktopLibrary = fs.readFileSync(path.join(root, "GameCli_framework", "src", "cartridge", "desktopLibrary.ts"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function indexSequence(source, labels) {
  let cursor = -1;
  const positions = {};
  for (const label of labels) {
    const index = source.indexOf(label, cursor + 1);
    assert(index >= 0, `Missing resolver marker: ${label}`);
    assert(index > cursor, `Resolver marker out of order: ${label}`);
    positions[label] = index;
    cursor = index;
  }
  return positions;
}

const resolverStart = main.indexOf("fn resolve_gamecli_exe");
const resolverEnd = main.indexOf("fn gamecli_preview_dir", resolverStart);
assert(resolverStart >= 0 && resolverEnd > resolverStart, "Could not find GameCLI resolver function.");
const resolver = main.slice(resolverStart, resolverEnd);
const resolverPositions = indexSequence(resolver, [
  'resource_dir.join("agentvn-player.exe")',
  '.join("binaries").join("agentvn-player.exe")',
  'exe_parent.join("agentvn-player.exe")',
  'root.join("GameCli_framework")',
  'root.join("editor")',
  'root.join("releases")',
  'parent_root',
  'root.join("output")',
]);
assert(resolver.includes('.join("player-shell")'), "GameCLI resolver should include releases/player-shell output.");
assert(resolver.includes('.join("game-shell")'), "GameCLI resolver should retain legacy output/game-shell fallback.");

assert(launcher.includes("Rebuilding GameCLI player resource for preview protocol compatibility"), "Dev launcher must refresh the GameCLI player resource by default.");
assert(buildGameShell.includes("tauri build -- --no-bundle"), "Game shell resource build should skip installer bundling.");
if (main.includes("Start-Process -FilePath $exePath") || main.includes("Failed to start GameCLI through PowerShell")) {
  throw new Error("Windows GameCLI preview must launch the player directly instead of through a PowerShell ArgumentList string.");
}
if (!main.includes('.args(["--mode", "preview", "--cartridge"])') || !main.includes(".env_remove(\"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS\")")) {
  throw new Error("GameCLI preview must pass launch arguments as separate process args and clear inherited WebView2 debug env.");
}
if (!main.includes('.args(["--mode", "preview", "--preview-root"])')) {
  throw new Error("Disk GameCLI preview must launch player with --preview-root.");
}
if (!playerLib.includes('register_uri_scheme_protocol("agentvn-preview"') || !playerLib.includes("fn load_unpacked_preview")) {
  throw new Error("Player must register the agentvn-preview protocol and expose load_unpacked_preview.");
}
if (!playerLib.includes("preview_file_path") || !playerLib.includes("starts_with(root)")) {
  throw new Error("Player preview protocol must constrain reads to previewRoot.");
}
if (!desktopLibrary.includes("loadGameFromUnpackedPreview") || !desktopLibrary.includes("load_unpacked_preview")) {
  throw new Error("Player frontend must load disk previews without read_cartridge_from_path.");
}
const unpackedLoader = desktopLibrary.slice(desktopLibrary.indexOf("export async function loadGameFromUnpackedPreview"), desktopLibrary.indexOf("export async function loadGameFromPath"));
if (unpackedLoader.includes("loadCartridgeFromArrayBuffer")) {
  throw new Error("Disk preview loader must not call full in-memory loadCartridgeFromArrayBuffer.");
}

const titleButtonTypes = [
  "main_menu_continue_button",
  "main_menu_start_button",
  "main_menu_save_load_button",
  "main_menu_gallery_button",
  "main_menu_settings_button",
  "main_menu_about_button",
];
for (const type of titleButtonTypes) {
  if (!uiSkin.includes(`"${type}"`)) throw new Error(`Shared UI contract is missing ${type}.`);
  if (!runtime.includes(`"${type}"`)) throw new Error(`GameCLI runtime is missing ${type}.`);
}
if (!uiSkin.includes('"main_menu_library_button"')) {
  throw new Error("Shared UI contract must keep the legacy library-button type for migration.");
}
const runtimeTitleButtonSets = runtime.slice(
  runtime.indexOf("const titleButtonComponentTypes"),
  runtime.indexOf("function tokenStyle"),
);
if (runtimeTitleButtonSets.includes('"main_menu_library_button"')) {
  throw new Error("GameCLI runtime must not expose the legacy library button as a title action.");
}

console.log(JSON.stringify({ ok: true, resolverPositions, titleButtonTypes }, null, 2));
