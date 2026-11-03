"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const out = path.resolve(process.argv[2] || "");
assert(process.argv[2] && !fs.existsSync(out), "Pass a fresh evidence JSON path");
const historical = path.join(root, "releases/editor");
const query = "$ErrorActionPreference='Stop'; @(Get-ChildItem -LiteralPath $env:AGENTVN_HISTORY_DIR -File -Filter '*.exe' | ForEach-Object { [pscustomobject]@{path=$_.FullName;version=$_.VersionInfo.ProductVersion;bytes=$_.Length} }) | ConvertTo-Json -Compress";
const rows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", query],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, AGENTVN_HISTORY_DIR: historical } }).replace(/^\uFEFF/, ""));
const parts = v => { assert.match(v, /^\d+\.\d+\.\d+$/); return v.split(".").map(Number); };
const compare = (a, b) => { const aa = parts(a), bb = parts(b); for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]; return 0; };
const versions = rows.filter(row => /^\d+\.\d+\.\d+$/.test(row.version || "")).sort((a, b) => compare(b.version, a.version));
assert(versions.length > 0);
const config = JSON.parse(fs.readFileSync(path.join(root, "editor/src-tauri/tauri.conf.json")));
const cargo = fs.readFileSync(path.join(root, "editor/src-tauri/Cargo.toml"), "utf8");
const lock = fs.readFileSync(path.join(root, "editor/src-tauri/Cargo.lock"), "utf8");
const npm = JSON.parse(fs.readFileSync(path.join(root, "editor/package.json")));
const npmLock = JSON.parse(fs.readFileSync(path.join(root, "editor/package-lock.json")));
const report = { status: "RUNNING", scope: "EDITOR_RELEASE_VERSION_NOT_FUNCTIONAL_UPGRADE",
  current: config.version, highestHistorical: versions[0], history: rows, checks: [] };
try {
  assert(compare(config.version, versions[0].version) > 0,
    `Candidate ${config.version} must be newer than actual historical PE ${versions[0].version}`);
  assert.equal(cargo.match(/^\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1], config.version);
  assert.equal(lock.match(/name = "agentvn-editor"\s+version = "([^"]+)"/)?.[1], config.version);
  assert.equal(npm.version, config.version);
  assert.equal(npmLock.version, config.version);
  assert.equal(npmLock.packages[""].version, config.version);
  report.status = "PASS"; report.checks.push("Actual historical PE ordering and Tauri/Cargo/npm source versions agree");
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" }); console.log(JSON.stringify(report));
}
