"use strict";
// QA-only checkpoint. Preserve audited tools rather than rewriting their old defaults.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const out = "F:/AgentVN/Checkpoints/Installed-Narrative-1922-20261023-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const files = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/installed-runtime-story-export-1922.cjs", "scripts/installed-runtime-voice-paged-playwright.cjs",
  "scripts/installed-runtime-voice-paged-4k-playwright.cjs", "scripts/lib/voice-runtime-observer.cjs",
  "scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1"];
const snapshots = files.map(file => {
  const source = path.resolve(file), copy = path.join(out, file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy)); return { source, copy, sha256: sha(copy) };
});
const previous = "F:/AgentVN/Checkpoints/Installed-Runtime-Quick-1922-20261023-01/report.json";
const products = JSON.parse(fs.readFileSync(previous, "utf8")).products;
for (const f of products) assert.equal(sha(f.path), f.sha256);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), snapshots, products,
  previousCheckpoint: { path: previous, sha256: sha(previous) },
  scope: "QA_ONLY_CURRENT_INSTALLED_NVL_CAPACITY_AND_VOICE_NO_PRODUCT_EDITS",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, snapshots: snapshots.length }));
