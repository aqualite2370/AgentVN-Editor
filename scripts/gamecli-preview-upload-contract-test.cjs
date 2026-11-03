const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const previewWindow = fs.readFileSync(path.join(root, "editor/src/preview/previewWindow.ts"), "utf8");
const tauriMain = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !/Array\.from\(\s*new Uint8Array\(\s*await\s+blob\.arrayBuffer\(\)/s.test(previewWindow),
  "GameCLI preview must not convert the entire cartridge Blob into one JS number[] before Tauri upload.",
);

assert(
  /GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES/.test(previewWindow) &&
    /slice\(offset,\s*Math\.min\(request\.cartridge\.size,\s*offset \+ GAMECLI_PREVIEW_UPLOAD_CHUNK_BYTES\)\)/.test(previewWindow),
  "GameCLI preview should upload cartridges through bounded Blob slices.",
);

assert(
  !previewWindow.includes("DESKTOP_GAMECLI_PREVIEW_MAX_SAFE_BYTES") &&
    previewWindow.includes("begin_gamecli_preview_disk_upload") &&
    previewWindow.includes("open_gamecli_preview_disk_upload"),
  "Desktop GameCLI preview should use disk preview upload first and must not keep the old 300MB blocker.",
);


assert(
  previewWindow.includes("expectedSize: request.cartridge.size") &&
    previewWindow.includes("offsetBytes: acknowledgedBytes") &&
    previewWindow.includes("acknowledgedBytes !== request.cartridge.size") &&
    /interface\s+GameCliPreviewUploadAppendResult[\s\S]*writtenBytes:\s*number/.test(previewWindow),
  "Disk preview upload must send expected size, verify chunk offsets, and check acknowledged bytes before unpacking.",
);

assert(
  tauriMain.includes("expected_size: Option<u64>") &&
    tauriMain.includes("offset_bytes: Option<u64>") &&
    tauriMain.includes("GameCLI disk preview upload offset mismatch") &&
    tauriMain.includes("received {} / {} bytes") &&
    tauriMain.includes("GameCliPreviewUploadAppendResult"),
  "Tauri disk preview upload must track expected size, enforce offsets, and reject incomplete incoming.vncart before zip unpacking.",
);

for (const commandName of [
  "begin_gamecli_preview_disk_upload",
  "append_gamecli_preview_disk_chunk",
  "open_gamecli_preview_disk_upload",
  "begin_gamecli_preview_upload",
  "append_gamecli_preview_chunk",
  "open_gamecli_preview_upload",
]) {
  assert(tauriMain.includes(commandName), `Missing Tauri command: ${commandName}`);
}


assert(
  /cleanup_gamecli_preview_disk_workspace\(&app,\s*false\)\?;/.test(tauriMain) &&
    /remove_path_if_exists\(&preview_dir\.join\("incoming\.vncart"\)\)\?;/.test(tauriMain) &&
    /remove_path_if_exists\(&preview_dir\.join\("current"\)\)\?;/.test(tauriMain),
  "Disk preview must clean incoming uploads and replace the single current preview directory.",
);

assert(
  /validate_preview_zip_path/.test(tauriMain) &&
    /path\.trim_end_matches\('\/'\)/.test(tauriMain) &&
    /normalized\.contains\('\\\\'\)/.test(tauriMain) &&
    /part == "\.\."/.test(tauriMain) &&
    /is_dangerous_preview_extension/.test(tauriMain),
  "Disk preview unpacking must allow normal directory entries while rejecting traversal, backslashes, and dangerous file extensions.",
);

assert(
  /safe_package_file_name\(&file_name\)/.test(tauriMain),
  "GameCLI preview temporary cartridge names must be sanitized before writing under the cache directory.",
);

assert(
  /fn cleanup_gamecli_preview_cartridges\(/.test(tauriMain),
  "GameCLI preview must define cleanup for temporary preview cartridges.",
);

assert(
  /cleanup_gamecli_preview_cartridges\(&app,\s*None\)\?;/.test(tauriMain) &&
    /cleanup_gamecli_preview_cartridges\(app,\s*Some\(&cartridge_path\)\)\?;/.test(tauriMain),
  "GameCLI preview must delete older temporary cartridges and keep only the currently launched cartridge.",
);

assert(
  /begin_gamecli_preview_upload\(\s*app:\s*tauri::AppHandle,\s*state:\s*tauri::State<'_, DevProcesses>,/s.test(tauriMain) &&
    /close_gamecli_preview_process\(state\.inner\(\)\)\?;/.test(tauriMain),
  "Starting a new preview upload must close the previous preview before replacing its temporary cartridge.",
);

console.log("GameCLI preview upload contract passed.");
