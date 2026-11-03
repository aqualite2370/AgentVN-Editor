#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "scripts", "package-installers.ps1"), "utf8");
assert.match(
  source,
  /\$Original\s*=\s*\[IO\.File\]::ReadAllText\(\$Path,\s*\[Text\.Encoding\]::UTF8\)/,
  "package version flow must read UTF-8 explicitly",
);

const start = source.indexOf("function Set-PackageVersion {");
const end = source.indexOf("\nfunction Restore-PackageVersion", start);
assert(start >= 0 && end > start, "could not isolate Set-PackageVersion");
const setPackageVersion = source.slice(start, end);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agentvn-package-version-"));
try {
  for (const relative of [
    "editor/src-tauri/tauri.conf.json",
    "editor/src-tauri/Cargo.toml",
    "GameCli_framework/src-tauri/tauri.conf.json",
    "GameCli_framework/src-tauri/Cargo.toml",
  ]) {
    const target = path.join(fixture, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (relative.endsWith("tauri.conf.json")) {
      fs.writeFileSync(target, JSON.stringify({
        "$schema": "https://schema.tauri.app/config/2",
        productName: "隐忍的成长",
        version: "0.1.0",
        identifier: "com.agentvn.hidden.growth",
      }, null, 2) + "\n", "utf8");
    } else {
      fs.writeFileSync(target, '[package]\nname = "fixture"\nversion = "0.1.0"\n', "utf8");
    }
  }

  const script = [
    `$Root = ${JSON.stringify(fixture)}`,
    "$script:VersionFileBackups = @{}",
    'function Resolve-WorkspacePath { param([string]$RelativePath) return Join-Path $Root $RelativePath }',
    'function Write-Utf8NoBom { param([string]$Path, [string]$Content) [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false)) }',
    setPackageVersion,
    "Set-PackageVersion '2.3.4'",
  ].join("\n");
  const encoded = crypto.createHash("sha256").update(script, "utf8").digest("hex");
  const command = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", command,
  ], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, `Set-PackageVersion failed (${encoded}): ${result.stdout}\n${result.stderr}`);

  const editorConfig = JSON.parse(fs.readFileSync(path.join(fixture, "editor/src-tauri/tauri.conf.json"), "utf8"));
  const playerConfig = JSON.parse(fs.readFileSync(path.join(fixture, "GameCli_framework/src-tauri/tauri.conf.json"), "utf8"));
  assert.equal(editorConfig.productName, "隐忍的成长");
  assert.equal(playerConfig.productName, "隐忍的成长");
  assert.equal(editorConfig.version, "2.3.4");
  assert.equal(playerConfig.version, "2.3.4");
  assert.match(fs.readFileSync(path.join(fixture, "editor/src-tauri/Cargo.toml"), "utf8"), /^version = "2\.3\.4"$/m);
  assert.match(fs.readFileSync(path.join(fixture, "GameCli_framework/src-tauri/Cargo.toml"), "utf8"), /^version = "2\.3\.4"$/m);
  console.log("PASS package version mutation preserves UTF-8 titles and updates editor/player versions");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
