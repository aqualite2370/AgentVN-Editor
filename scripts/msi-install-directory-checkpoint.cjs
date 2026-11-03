"use strict";
// Scoped repair checkpoint; no installer, registry or profile writes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/MSI-Location-Repair-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/MSI-Location-Repair-20261021-01";
assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint), "Fresh checkpoint required");
fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const report = { status: "RUNNING", at: new Date().toISOString(), scope: "FULL_WIP_SOURCE_AND_CURRENT_PRODUCTS",
  snapshots: [], protected: [], modelRequests: 0 };
try {
  fs.writeFileSync(path.join(checkpoint, "worktree.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
  const names = git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"])
    .toString("utf8").split("\0").filter(Boolean);
  for (const name of new Set(names)) {
    const file = path.resolve(root, name); assert(file.startsWith(root + path.sep));
    if (!fs.existsSync(file)) { report.snapshots.push({ file: name, deleted: true }); continue; }
    const target = path.join(checkpoint, "worktree", name); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(file), sha(target)); report.snapshots.push({ file: name, ...desc(target) });
  }
  for (const name of ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]) {
    const file = path.join(root, name), target = path.join(checkpoint, "products", name);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(file), sha(target)); report.protected.push(desc(file));
  }
  report.protected.push(...[".git/index", "backend/data/editor_state.json", "editor/src/app/App.tsx",
    "editor/src/app/App.css", "editor/src/styles/editor-tokens.css", "GameCli_framework/src/styles/shell.css"]
    .map(f => desc(path.join(root, f))));
  report.protected.push(desc("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"));
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
fs.writeFileSync(path.join(qa, "checkpoint.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, snapshots: report.snapshots.length, qa, checkpoint, error: report.error }));
