"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const attempt = process.argv[2] || "01";
assert(["01", "02", "03"].includes(attempt));
const out = "F:/testavn/Android-Sprite-Preview-1975-20261116-" + attempt;
assert(!fs.existsSync(out), "Do not replace a previous device investigation");
const inputs = [
  "sprite-count-android-preview.cjs", "sprite-count-android-preview-launch.ps1",
  "lib/sprite-preview-fixture.cjs", "lib/file-sha256-bounded.cjs",
  "lib/android-startup-observer.cjs", "lib/android-startup-host-identity.cjs",
  "lib/installed-acceptance.cjs", "android-runtime-log-analysis.cjs",
].map(relative => ({ relative, path: path.join(root, "scripts", relative) }));
for (const item of inputs) { assert(fs.statSync(item.path).isFile()); item.sha256 = sha(item.path); }
const scripts = path.join(out, "harness/scripts");
fs.mkdirSync(path.join(scripts, "lib"), { recursive: true });
const copies = [];
for (const item of inputs) {
  const target = path.join(scripts, item.relative);
  let source = fs.readFileSync(item.path, "utf8");
  if (target.endsWith(".ps1")) source = source.replace(
    "$run='F:\\testavn\\Android-Sprite-Preview-1975-20261116-01'",
    "$run='F:\\testavn\\Android-Sprite-Preview-1975-20261116-" + attempt + "'");
  source = source.replace(/require\(["'](?:\.\.\/){1,2}editor\/node_modules\/([^"']+)["']\)/g,
    (_, module) => "require(" + JSON.stringify(path.join(root, "editor/node_modules", module)) + ")");
  fs.writeFileSync(target, source, { flag: "wx" });
  if (target.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", target], { windowsHide: true });
  copies.push({ path: target, sha256: sha(target) });
}
const git = args => cp.execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const index = path.resolve(git(["rev-parse", "--git-path", "index"]));
const result = { status: "SEALED_TARGETED_SPRITE_PREVIEW_DEVICE_NOT_STARTED", attempt, at: new Date().toISOString(),
  inputs, copies, git: { head: git(["rev-parse", "HEAD"]), index, sha256: sha(index) },
  productBuilds: 0, modelRequests: 0 };
fs.writeFileSync(path.join(out, "preparation.json"), JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, scripts, files: copies.length }));
