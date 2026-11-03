"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const out = "F:/AgentVN/Checkpoints/Installed-Runtime-Story-1922-20261023-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const files = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/installed-runtime-abilities-playwright.cjs", "scripts/installed-runtime-abilities-export.cjs",
  "scripts/lib/installed-release-session.cjs", "scripts/native-dev-preview-profile.ps1",
  "scripts/installed-layout-cache-session.ps1"];
const snapshots = files.map(file => {
  const source = path.resolve(__dirname, "..", file), copy = path.join(out, file);
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(source));
  return { source, copy, sha256: sha(copy) };
});
const products = JSON.parse(fs.readFileSync(
  "F:/AgentVN/Checkpoints/Installed-Runtime-Motion-1922-20261023-01/report.json", "utf8")).products;
for (const f of products) assert.equal(sha(f.path), f.sha256);
const fixtureFile = "D:/AgentVN/output/installed-runtime-abilities-20261018-01/fixtures-02.json";
const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
assert.equal(sha(fixture.input), fixture.inputSha256);
fs.copyFileSync(fixtureFile, path.join(out, "historical-fixture.json"), fs.constants.COPYFILE_EXCL);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({
  status: "PASS", at: new Date().toISOString(), snapshots, products,
  fixture: { path: fixtureFile, sha256: sha(fixtureFile), input: fixture.input, inputSha256: fixture.inputSha256 },
  scope: "QA_ONLY_CURRENT_UI_EXPORT_AND_STORY_STATE_PREPARATION",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, snapshots: snapshots.length }));
