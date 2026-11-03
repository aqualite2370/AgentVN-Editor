const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const previewWindow = read("editor/src/preview/previewWindow.ts");
const previewControls = read("editor/src/components/advanced/PreviewWindowControls.tsx");
const exportCartridge = read("editor/src/cartridge/exportCartridge.ts");
const rustHost = read("editor/src-tauri/src/main.rs");
const rootPackage = JSON.parse(read("package.json"));

for (const command of [
  "begin_gamecli_preview_directory",
  "write_gamecli_preview_text_file",
  "link_or_copy_gamecli_preview_asset",
  "begin_gamecli_preview_asset_upload",
  "append_gamecli_preview_asset_chunk",
  "finalize_gamecli_preview_directory",
]) {
  assert(rustHost.includes(command), `Rust host missing directory preview command: ${command}`);
  assert(previewWindow.includes(command), `Preview frontend missing directory preview command: ${command}`);
}

assert(exportCartridge.includes("exportEditorPreviewDirectory"), "exportEditorPreviewDirectory must exist.");
assert(previewWindow.includes("openGameCliPreviewDirectory"), "openGameCliPreviewDirectory must exist.");
assert(previewControls.includes("exportEditorPreviewDirectory"), "Preview controls must use unpacked directory export.");

const syncBody = previewControls.slice(previewControls.indexOf("async function syncPreview"), previewControls.indexOf("async function closePreview"));
assert(syncBody.includes("isTauriRuntime"), "syncPreview should branch desktop vs browser.");
assert(syncBody.indexOf("exportEditorPreviewDirectory") !== -1, "desktop sync path should call exportEditorPreviewDirectory.");
assert(syncBody.indexOf("exportEditorCartridge") !== -1, "browser/fallback path should retain exportEditorCartridge.");
assert(syncBody.indexOf("exportEditorPreviewDirectory") < syncBody.indexOf("exportEditorCartridge"), "desktop directory preview should be attempted before .vncart export.");

assert(previewWindow.includes("LEGACY_GAMECLI_PREVIEW_MAX_BYTES"), "old host large preview guard should remain.");
assert(previewWindow.includes("Current desktop host does not support fast directory preview"), "missing directory command must show update-host guidance.");
assert(!/openGameCliPreviewDirectory[\s\S]{0,3000}packCartridgeToBlob|packCartridgeToBlob[\s\S]{0,3000}openGameCliPreviewDirectory/.test(previewWindow), "directory preview path must not call packCartridgeToBlob.");

for (const bad of ["..", "contains('\\\\')", "is_dangerous_preview_extension", "starts_with('/')", "starts_with('\\\\')"]) {
  assert(rustHost.includes(bad), `Rust safe path validation missing marker: ${bad}`);
}
assert(rustHost.includes("fs::hard_link"), "Directory preview should try hard links for local assets.");
assert(rustHost.includes("create_gamecli_preview_checksum"), "Rust must generate checksum.json from files on disk.");
assert(rustHost.includes("remove_path_if_exists(&preview_dir.join(\"incoming.vncart\"))"), "Directory preview cleanup must remove incoming.vncart.");

assert(rootPackage.scripts["test:gamecli-preview-directory"], "package.json missing test:gamecli-preview-directory script.");
assert(rootPackage.scripts["acceptance:gamecli-preview-directory-real"], "package.json missing real directory preview acceptance script.");

console.log("PASS gamecli directory preview contract");
