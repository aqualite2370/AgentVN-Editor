"use strict";
// Test tooling checkpoint only; never modifies the frozen product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const scope = process.argv[2] || "windows";
assert(["windows", "runtime-abilities"].includes(scope));
const destination = scope === "runtime-abilities"
  ? "F:/AgentVN-QA-Runtime-Abilities-Checkpoint-20261018-01"
  : "F:/AgentVN-QA-Windows-Checkpoint-20261018-01";
assert(!fs.existsSync(destination), "Do not overwrite a checkpoint");
fs.mkdirSync(destination);
const rows = [];
for (const relative of ["scripts/installed-preview-session.ps1", "scripts/installed-assistant-recovery-session.ps1",
  "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
  const source = path.join("D:/AgentVN", relative), target = path.join(destination, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  const hash = sha256(fs.readFileSync(source));
  assert.equal(sha256(fs.readFileSync(target)), hash);
  rows.push({ source, retained: target, sha256: hash });
}
fs.writeFileSync(path.join(destination, "checkpoint.json"),
  JSON.stringify({ status: "PASS", at: new Date().toISOString(), rows, productChanges: 0 }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: "PASS", destination, files: rows.length }));
