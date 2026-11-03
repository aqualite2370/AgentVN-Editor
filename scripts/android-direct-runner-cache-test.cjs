"use strict";
// Execute the actual Rust command builder and two harmless real child receivers.
// No extracted/stubbed Rust source, APK build, UAC or model request.
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const result = spawnSync("cargo", [
  "test", "--manifest-path", path.join(root, "editor/src-tauri/Cargo.toml"),
  "native_runner_", "--", "--nocapture",
], { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
const text = (result.stdout || "") + (result.stderr || "");
assert.equal(result.status, 0, `${result.error || ""}\n${text}`);
assert.match(text, /running 2 tests/);
assert.match(text, /2 passed; 0 failed/);
for (const name of [
  "native_runner_arguments_preserve_build_identity_and_existing_options",
  "native_runner_child_receives_original_run_id_in_both_launch_modes",
]) assert.match(text, new RegExp(`${name} \\.\\.\\. ok`), "Both production-path tests must actually execute");
console.log("PASS 16 native command routing cases and real Node/PowerShell run-ID receivers; no APK build or elevation");
