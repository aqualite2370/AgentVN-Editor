const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scripts = fs.readdirSync(path.join(root, "scripts"));
const acceptance = scripts
  .filter((name) => /android.*acceptance|android.*qa/i.test(name))
  .map((name) => fs.readFileSync(path.join(root, "scripts", name), "utf8"))
  .join("\n");
const adminAcceptanceWrapper = fs.readFileSync(
  path.join(root, "scripts", "admin-android-acceptance-wrapper.ps1"),
  "utf8",
);
const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
assert.match(agents, /adb uninstall <package>/);
assert.match(agents, /staging APK/);
assert.match(acceptance, /finally/);
assert.match(acceptance, /uninstallStatus|apkCleanupStatus|cleanupError/);
assert.match(acceptance, /IsInRole\(\[Security\.Principal\.WindowsBuiltInRole\]::Administrator\)/);
assert.match(acceptance, /ANDROID_ADMIN_REQUIRED/);
assert.match(acceptance, /fltmc\.exe/);
assert.match(adminAcceptanceWrapper, /Get-Command node\.exe/);
assert.doesNotMatch(adminAcceptanceWrapper, /Start-Process -FilePath "cmd\.exe"/);
console.log("android-test-artifact-cleanup-test: PASS");
