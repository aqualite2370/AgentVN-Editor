"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, "..");
const out = "F:/AgentVN/Checkpoints/Installed-Runtime-Settings-1922-20261023-01";
assert(!fs.existsSync(out), "Never overwrite a checkpoint");
fs.mkdirSync(out, { recursive: true });
const snapshots = [
  "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/lib/installed-runtime-preview-1922-session.cjs",
  "scripts/lib/installed-runtime-session.cjs", "scripts/native-dev-preview-profile.ps1",
  "scripts/installed-runtime-settings-playwright.cjs", "scripts/lib/runtime-settings-proportions.cjs",
].map(name => {
  const source = path.join(root, name), copy = path.join(out, name);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy));
  return { path: source, copy, sha256: sha(source) };
});
const baseline = JSON.parse(fs.readFileSync(
  "F:/AgentVN/Checkpoints/Installed-Runtime-Motion-1922-20261023-01/report.json", "utf8"));
for (const f of baseline.products) assert.equal(sha(f.path), f.sha256);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), scope: "QA_ONLY_CURRENT_INSTALLED_SETTINGS",
  snapshots, products: baseline.products,
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, snapshots: snapshots.length }));
