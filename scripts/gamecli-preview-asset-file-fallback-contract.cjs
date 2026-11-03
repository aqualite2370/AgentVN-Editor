const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const exportCartridge = fs.readFileSync(path.join(root, "editor/src/cartridge/exportCartridge.ts"), "utf8");
const tauriMain = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  exportCartridge.includes("readDesktopAssetFile"),
  "exportCartridge must include a desktop file fallback for project assets.",
);

assert(
  exportCartridge.includes('invoke<number[]>("read_project_asset_file_bytes"'),
  "exportCartridge must call the Tauri asset file byte reader.",
);

assert(
  exportCartridge.includes("当前 AgentVN 桌面宿主尚未更新"),
  "missing desktop host command errors should be translated into an actionable restart/rebuild message.",
);

assert(
  /catch \(error\) \{[\s\S]*readDesktopAssetFile\(filePath\)[\s\S]*continue;/.test(exportCartridge),
  "URL asset fetch failures must fall back to reading metadata.filePath before failing.",
);

assert(
  tauriMain.includes("fn read_project_asset_file_bytes"),
  "Tauri host must expose read_project_asset_file_bytes.",
);

assert(
  tauriMain.includes("read_project_asset_file_bytes,"),
  "Tauri invoke handler must register read_project_asset_file_bytes.",
);

console.log("GameCLI preview asset file fallback contract passed.");
