"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const out = "F:/AgentVN/Checkpoints/Installed-Assets-1922-20261022-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const copies = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", "scripts/installed-assets-current.cjs",
  "scripts/installed-assets-current-audit.cjs", "scripts/installed-assets-current-player.cjs",
  "scripts/installed-assets-current-player-audit.cjs", "scripts/lib/installed-assets-evidence.cjs",
  "scripts/lib/installed-assets-player-evidence.cjs", "scripts/installed-assets-evidence-test.cjs",
  "scripts/installed-assets-player-evidence-test.cjs"].map(file => {
  const source = path.resolve(__dirname, "..", file), copy = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(copy), sha(source)); return { source, copy, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), copies,
  scope: "QA adaptation only; no product or historical report changes" }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, copies: copies.length }));
