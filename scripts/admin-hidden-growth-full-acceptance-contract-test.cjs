const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const wrapper = fs.readFileSync(path.join(root, "scripts", "admin-hidden-growth-full-acceptance.ps1"), "utf8");

assert.match(wrapper, /ReadAllText\([\s\S]*?UTF8Encoding/, "admin wrapper must read JSON with explicit UTF-8");
assert.match(wrapper, /package-build-manifest\.json/, "admin wrapper must read the build manifest for runId");
assert.match(wrapper, /\$report\.runId[\s\S]*?\$manifest\.runId/, "status must use the build manifest runId when runtime report has none");
assert.match(wrapper, /reportReadError/, "report read errors must remain visible");
assert.match(wrapper, /manifestReadError/, "manifest read errors must remain visible");
assert.match(wrapper, /uninstallStatus\s*=\s*if\s*\(\$report\)\s*\{\s*\$report\.uninstallStatus/, "status must include uninstall result");
assert.match(wrapper, /apkCleanupStatus\s*=\s*if\s*\(\$report\)\s*\{\s*\$report\.apkCleanupStatus/, "status must include APK cleanup result");
console.log("admin-hidden-growth-full-acceptance-contract-test: PASS");
