"use strict";
// Extract an existing released binary; never rebuild a fake old Runtime.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const repo = path.resolve(__dirname, "..");
const run = path.join(repo, "output/old-runtime-refusal-20261018-01");
const workspace = "F:\\AgentVN-QA-OldRuntime-20261018-01";
assert(!fs.existsSync(run) && !fs.existsSync(workspace), "Fresh evidence/workspace required");
fs.mkdirSync(run); fs.mkdirSync(workspace);
const packageFile = path.join(repo, "releases/player/AgentVN_Player_v1.8.0_20260811_211832.exe");
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", scope: "REAL_OLD_BINARY_EXTRACTION_NOT_BEHAVIOR_PASS",
  startedAt: new Date().toISOString(), workspace, source: {
    path: packageFile, bytes: fs.statSync(packageFile).size, sha256: sha(packageFile),
    provenance: "Existing repository releases/player, not rebuilt and not inferred from neighboring output"
  } };
try {
  const target = path.join(workspace, "old-player");
  const result = spawnSync("C:\\Program Files\\7-Zip\\7z.exe",
    ["x", packageFile, `-o${target}`, "agentvn-player.exe", "embedded-cartridge\\*", "-y"],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
  fs.writeFileSync(path.join(run, "extraction.log"), `${result.stdout}\n${result.stderr}`, { flag: "wx" });
  assert.equal(result.status, 0, "Old package extraction failed");
  const exe = path.join(target, "agentvn-player.exe");
  assert(fs.statSync(exe).size > 1000000);
  const identity = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    `$file=Get-Item -LiteralPath '${exe}'; @{productVersion=$file.VersionInfo.ProductVersion;fileVersion=$file.VersionInfo.FileVersion;originalFilename=$file.VersionInfo.OriginalFilename}|ConvertTo-Json`],
    { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(identity.status, 0, identity.stderr);
  const pe = JSON.parse(identity.stdout);
  assert.equal(pe.productVersion, "1.8.0", "Actual PE version, not installer filename, must identify old Runtime");
  const text = fs.readFileSync(exe).toString("utf8");
  const identifiers = [...new Set(text.match(/"identifier"\s*:\s*"com\.agentvn\.[^"]+"/g) || [])];
  assert(identifiers.some(s => s.includes('"com.agentvn.player"')),
    "Old executable must reveal its actual Tauri app identifier before profile isolation");
  report.executable = { path: exe, bytes: fs.statSync(exe).size, sha256: sha(exe), pe };
  report.embeddedAppIdentifiers = identifiers;
  report.status = "PASS";
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(run, "preparation.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
