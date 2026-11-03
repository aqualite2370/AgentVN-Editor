"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const out = "F:/AgentVN/Checkpoints/Installed-Components-1922-20261022-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const files = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/installed-components-current.cjs", "scripts/installed-components-current-player.cjs",
  "scripts/installed-components-current-audit.cjs", "scripts/installed-components-current-evidence-test.cjs",
  "scripts/lib/installed-components-current-evidence.cjs", "scripts/lib/installed-acceptance.cjs",
  "scripts/installed-layout-cache-session.ps1", "scripts/lib/component-preview-style-evidence.cjs"];
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const copies = files.map(file => {
  const source = path.resolve(__dirname, "..", file), copy = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy)); return { source, copy, sha256: sha(source) };
});
const baseline = JSON.parse(fs.readFileSync("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json", "utf8"));
for (const file of baseline.protectedFiles) assert.equal(sha(file.path), file.sha256);
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({
  at: new Date().toISOString(), copies, protectedFiles: baseline.protectedFiles,
  scope: "QA and continuation documents only; no product or historical evidence changes",
}, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, copies: copies.length }));
