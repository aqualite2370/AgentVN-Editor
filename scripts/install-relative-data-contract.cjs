const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const rustMain = fs.readFileSync(
  path.join(root, "editor", "src-tauri", "src", "main.rs"),
  "utf8",
);
const startBackend = fs.readFileSync(
  path.join(root, "scripts", "start-backend.ps1"),
  "utf8",
);
const novelProcessService = fs.readFileSync(
  path.join(root, "backend", "app", "services", "novel_process_service.py"),
  "utf8",
);

assert.match(
  rustMain,
  /fn editor_app_data_dir\(app: &tauri::AppHandle\) -> PathBuf\s*\{[\s\S]*?app_data_override_dir\(\)\.unwrap_or_else\(\|\| legacy_editor_app_data_dir\(app\)\)/,
  "backend data must use the shared Tauri user data directory",
);
assert.match(
  rustMain,
  /fn error_report_dir\(\) -> PathBuf\s*\{[\s\S]*?exe_parent_dir\(\)\.join\("error_log"\)/,
  "error reports must live in error_log beside the installed executable",
);
assert.match(
  startBackend,
  /\$SharedDataRoot[\s\S]*?\$env:APPDATA[\s\S]*?com\.agentvn\.editor/,
  "PowerShell backend launcher must use the shared user data directory",
);
assert.match(
  startBackend,
  /\$SystemDataDir\s*=\s*Join-Path \$SharedDataRoot "backend"/,
  "PowerShell backend launcher must persist below the shared user data directory",
);
assert.match(
  novelProcessService,
  /AGENTVN_BACKEND_DATA_DIR/,
  "novel-processing files must follow the backend install-relative data directory",
);
assert.match(
  novelProcessService,
  /os\.environ\.get\("DATABASE_PATH"\)/,
  "novel-processing database access must follow the configured shared database",
);

console.log("shared user database contract: PASS");
