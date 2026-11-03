"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const out = "F:/AgentVN/Checkpoints/Installed-Runtime-Quick-1922-20261023-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const files = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/lib/installed-runtime-session.cjs", "scripts/installed-runtime-quick-gaps-playwright.cjs",
  "scripts/installed-runtime-quick-gaps-lock.ps1", "scripts/native-runtime-quick-audit.cjs",
  "scripts/native-dev-preview-profile.ps1"];
const snapshots = files.map(file => {
  const source = path.resolve(file), copy = path.join(out, file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy)); return { source, copy, sha256: sha(copy) };
});
const products = JSON.parse(fs.readFileSync(
  "F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01/report.json", "utf8")).products;
for (const f of products) assert.equal(sha(f.path), f.sha256);
const source = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-47/report.json";
assert.equal(JSON.parse(fs.readFileSync(source, "utf8")).status, "PASS");
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), snapshots, products,
  export: { path: source, sha256: sha(source) }, scope: "QA_ONLY_CURRENT_INSTALLED_QUICK_EXCEPTIONS",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, snapshots: snapshots.length }));
