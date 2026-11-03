"use strict";
// Preserve WIP and products before ANDROID-RUNID-01. Never install or build here.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const checkpoint = "F:/AgentVN/Checkpoints/Android-RunId-Repair-20261021-01";
const qa = "F:/AgentVN/QA/Android-RunId-Repair-20261021-01";
assert(!fs.existsSync(checkpoint) && !fs.existsSync(qa), "Fresh checkpoint required");
fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(qa, { recursive: true });
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), snapshots: [],
  products: [], protected: [], modelRequests: 0, builds: 0 };
try {
  fs.writeFileSync(path.join(checkpoint, "worktree.patch"), git(["diff", "--binary", "HEAD"]), { flag: "wx" });
  const names = git(["ls-files", "--modified", "--others", "--exclude-standard", "-z"])
    .toString("utf8").split("\0").filter(Boolean);
  for (const relative of new Set(names)) {
    const source = path.resolve(root, relative);
    assert(source.startsWith(root + path.sep));
    if (!fs.existsSync(source)) { report.snapshots.push({ relative, deleted: true }); continue; }
    assert(fs.statSync(source).isFile());
    const target = path.join(checkpoint, "worktree", relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(target)); report.snapshots.push({ relative, ...desc(target) });
  }
  for (const relative of ["AgentVN Dev.exe", "editor/src-tauri/target/release/agentvn-editor.exe"]) {
    const source = path.join(root, relative), target = path.join(checkpoint, "products", relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(source), sha(target)); report.products.push(desc(source));
  }
  for (const source of [".git/index", "editor/src/app/App.tsx", "editor/src/app/App.css",
    "editor/src/styles/editor-tokens.css", "GameCli_framework/src/styles/shell.css",
    "backend/data/editor_state.json"].map(f => path.join(root, f)).concat(
      "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db",
      "F:/AgentVN/QA/Android-Package-20261021-01/editor-09/report.json",
      "F:/AgentVN/QA/Android-Package-20261021-01/editor-09/Android 输出/AVN Android QA 20261021-0.1.0.apk",
      "F:/AgentVN/QA/Android-Package-20261021-01/editor-09/Android 输出/AVN Android QA 20261021-0.1.0.apk.acceptance.json"
    )) report.protected.push(desc(source));
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
report.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(qa, "checkpoint.json"), JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, files: report.snapshots.length, checkpoint, qa, error: report.error }));
