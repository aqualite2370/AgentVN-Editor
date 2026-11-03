"use strict";
// Preserve the user's dirty checkout and current delivery before any version edit.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2], "Pass a fresh output/full-regression-* directory");
assert(runRoot.startsWith(path.join(root, "output", "full-regression-")));
assert(!fs.existsSync(runRoot), "Never overwrite an existing regression run");
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
function sha(file) {
  const descriptor = fs.openSync(file, "r"), buffer = Buffer.alloc(1024 * 1024);
  const hash = crypto.createHash("sha256");
  try {
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
}
const split = bytes => bytes.toString("utf8").split("\0").filter(Boolean);
const tracked = split(git(["diff", "--name-only", "-z", "HEAD"]));
const untracked = split(git(["ls-files", "--others", "--exclude-standard", "-z"]));
const implementationRoots = [
  "GameCli_framework/src/", "GameCli_framework/src-tauri/src/",
  "GameCli_framework/docs/", "GameCli_framework/vendor/",
  "backend/app/", "backend/tests/", "backend/docs/", "docs/", "editor/src/",
  "editor/src-tauri/src/", "editor/src-tauri/tests/", "shared/", "scripts/",
  "plans/", "release-notes/",
];
const rootFiles = new Set(["AGENTS.md", "Androiddev.md", "start_androiddev.bat",
  "editor/src-tauri/installer-hooks.nsh"]);
const selected = [...new Set([...tracked, ...untracked.filter(file =>
  implementationRoots.some(prefix => file.startsWith(prefix)) || rootFiles.has(file)
  || /^editor\/[^/]+\.(html|json)$/.test(file))])].sort();
const checkpoint = path.join(runRoot, "checkpoint");
fs.mkdirSync(checkpoint, { recursive: true });
fs.writeFileSync(path.join(checkpoint, "tracked.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
fs.writeFileSync(path.join(checkpoint, "status.txt"), git(["status", "--short"]), { flag: "wx" });
const manifest = {
  status: "RUNNING", startedAt: new Date().toISOString(), root, runRoot,
  head: git(["rev-parse", "HEAD"]).toString("utf8").trim(),
  scope: "All dirty tracked paths and untracked implementation roots; current artifacts copied; no reset/commit/cleanup",
  files: [], artifacts: [], skippedUntracked: untracked.filter(file => !selected.includes(file)),
};
function preserve(relative, category) {
  const source = path.resolve(root, relative);
  assert(source.startsWith(root + path.sep), "Checkpoint source escapes workspace");
  if (!fs.existsSync(source)) {
    manifest[category].push({ relative, deleted: true });
    return;
  }
  const stat = fs.lstatSync(source);
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected ordinary file: ${relative}`);
  const destination = path.join(checkpoint, category, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const digest = sha(source);
  assert.equal(sha(destination), digest, `Checkpoint copy differs: ${relative}`);
  manifest[category].push({ relative, copy: destination, sha256: digest,
    bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
}
try {
  for (const file of selected) preserve(file, "files");
  for (const file of [
    "AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
    "editor/src-tauri/target/release/agentvn-editor.exe",
    "editor/src-tauri/target/release/bundle/nsis/AgentVN Editor_1.9.1_x64-setup.exe",
    "editor/src-tauri/target/release/bundle/msi/AgentVN Editor_1.9.1_x64_en-US.msi",
    "editor/src-tauri/target/release/bundle/msi/AgentVN Editor_1.9.1_x64_zh-CN.msi",
    "editor/src-tauri/binaries/agentvn-player.exe",
    "editor/src-tauri/binaries/creator-backend.exe",
    "editor/src-tauri/bundle-workspace/build-versions.json",
  ]) preserve(file, "artifacts");
  manifest.status = "PASS";
} catch (error) {
  manifest.status = "FAILED"; manifest.error = String(error.stack || error); process.exitCode = 1;
} finally {
  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: manifest.status, runRoot, files: manifest.files.length,
    artifacts: manifest.artifacts.length, error: manifest.error }));
}
