#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const prepareScript = path.join(root, "scripts", "prepare-editor-runtime-resources.ps1");
const bundleWorkspace = path.join(root, "editor", "src-tauri", "bundle-workspace");
const installerCandidates = [
  ...fs.globSync(path.join(root, "editor", "src-tauri", "target", "release", "bundle", "nsis", "*.exe")),
  ...(process.env.AGENTVN_RELEASE_INSTALLER ? [path.resolve(process.env.AGENTVN_RELEASE_INSTALLER)] : []),
];

function assertNoForbiddenFiles(directory, label) {
  if (!fs.existsSync(directory)) return;
  const forbidden = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (/^\.codex.*\.log$/iu.test(entry.name) || /codexlog/iu.test(entry.name)) {
        forbidden.push(full);
      }
    }
  }
  assert.deepEqual(forbidden, [], `${label} contains forbidden Codex/development logs:\n${forbidden.join("\n")}`);
}

function findSevenZip() {
  const candidates = [
    "C:\\Program Files\\7-Zip\\7z.exe",
    "C:\\Program Files (x86)\\7-Zip\\7z.exe",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const prepareSource = fs.readFileSync(prepareScript, "utf8");
const buildSource = fs.readFileSync(path.join(root, "scripts", "build-editor-windows.ps1"), "utf8");
const packageBat = fs.readFileSync(path.join(root, "package-installers.bat"), "utf8");
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(root, "editor", "src-tauri", "tauri.conf.json"), "utf8"),
);
assert.match(prepareSource, /Never ship development-session traces/u);
assert.match(prepareSource, /\.codex\.\*\\\.log/u);
assert.match(prepareSource, /codexlog/u);
assert.match(prepareSource, /packageinstaller\(s\)/u);
assert.match(prepareSource, /Assert-PreparedRuntimeResources/u);
assert.match(buildSource, /prepare-editor-runtime-resources\.ps1/u);
assert.match(buildSource, /AGENTVN_EDITOR_RUNTIME_RESOURCES_PREPARED/u);
assert.equal(
  tauriConfig.bundle?.resources?.["bundle-workspace/build-versions.json"],
  "build-versions.json",
  "the release installer must map bundled build-versions.json into its runtime resource root",
);
assert.doesNotMatch(packageBat, /codexlog|\.codex.*\.log/iu);

assertNoForbiddenFiles(bundleWorkspace, "bundled workspace");

const installers = installerCandidates.filter((candidate, index, all) => fs.existsSync(candidate) && all.indexOf(candidate) === index);
if (installers.length > 0) {
  const sevenZip = findSevenZip();
  assert.ok(sevenZip, "7-Zip is required to inspect the generated NSIS installer.");
  for (const installer of installers) {
    const listing = childProcess.spawnSync(
      sevenZip,
      ["l", "-slt", installer],
      { encoding: "utf8", windowsHide: true, maxBuffer: 200 * 1024 * 1024 },
    );
    assert.equal(listing.status, 0, `failed to list installer ${installer}:\n${listing.stdout}\n${listing.stderr}`);
    assert.doesNotMatch(listing.stdout, /codexlog|\.codex.*\.log|packageinstaller(s)?\.bat/iu, installer);
  }
}

console.log("PASS release package excludes Codex/development logs and packageinstaller.bat");
