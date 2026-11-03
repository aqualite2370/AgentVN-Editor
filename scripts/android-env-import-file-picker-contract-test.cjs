const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "editor/src-tauri/src/main.rs"), "utf8");
const start = source.indexOf("async fn import_android_environment_package(");
const end = source.indexOf("\n#[tauri::command]", start + 10);
assert.ok(start >= 0 && end > start, "Android environment import command is missing");
const command = source.slice(start, end);
const pickerIndex = command.indexOf(".blocking_pick_file()");
assert.ok(pickerIndex >= 0, "Android environment import must use the native file picker");
assert.equal(
  command.slice(0, pickerIndex).includes("find_android_environment_archive()"),
  false,
  "clicking import must not auto-select an archive from the app/workspace directory before showing the picker",
);
assert.match(command, /\.add_filter\("AgentVN Android 环境包", &\["avnenv", "zip"\]\)/);
console.log("android-env-import-file-picker-contract-test: PASS");
