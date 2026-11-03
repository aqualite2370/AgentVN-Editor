"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const out = "F:/AgentVN/Checkpoints/Project-Directory-Installed-1922-20261022-01";
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const files = ["plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
  "scripts/project-directory-installed-current.cjs", "scripts/project-directory-installed-acl.ps1",
  "scripts/installed-layout-cache-session.ps1", "scripts/lib/installed-release-session.cjs"];
const copies = files.map(file => {
  const source = path.resolve(__dirname, "..", file), copy = path.join(out, "files", file);
  fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(source), sha(copy)); return { source, copy, sha256: sha(source) };
});
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), copies,
  scope: "QA-only continuation; current 1.9.22 installation reused; historical evidence unchanged" }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", out, copies: copies.length }));
