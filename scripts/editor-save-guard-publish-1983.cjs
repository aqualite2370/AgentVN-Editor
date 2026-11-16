"use strict";
// Publish only this verified release through an alternate index; no real checkout changes.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"),
  crypto = require("node:crypto"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Editor-Save-Guard-Release-1983-20261116-01";
const parent = "6fed7a66caaeac5e141119f47178bba371b71b84";
const branch = "codex/editor-autosave-recovery-20261116";
const output = path.join(base, "source-delivery.json");
assert(!fs.existsSync(output), "Do not repeat publication");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 35000, maxBuffer: 8 * 1024 * 1024, ...options });
const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim());
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(), indexSha256: digest(fs.readFileSync(index)) });
const files = [
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json",
  "scripts/editor-save-guard-release-1983.cjs", "scripts/editor-save-guard-seal-followup-1983.cjs",
  "scripts/editor-save-guard-install-stage-1983.cjs", "scripts/editor-save-guard-installed-1983.cjs",
  "scripts/editor-save-guard-retire-aborted-1983.ps1", "scripts/editor-save-guard-audit-1983.cjs",
  "scripts/editor-save-guard-cleanup-1983.ps1", "scripts/editor-save-guard-terminal-1983.cjs",
  "scripts/editor-save-guard-publish-1983.cjs", "AGENTS.md", "plans/ACTIVE_TASKS.md",
  "plans/FINAL_ACCEPTANCE_STATUS.md", "plans/Editor-Save-Guard-20261116-RESULTS.md",
  "plans/Editor-Save-Guard-Release-1983-20261116-RESULTS.md"
];
const report = { status: "RUNNING", parent, branch, before: state(), files: [], builds: 0, productLaunches: 0,
  scope: "EDITOR1983_VERIFIED_VERSION_QA_AND_CURRENT_ACCEPTANCE_DOCS", realIndexChanged: false };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
try {
  const audit = JSON.parse(fs.readFileSync("F:/testavn/Windows-Isolated-1983-20261116-02/terminal-audit-02.json"));
  assert.equal(audit.status, "PASS"); assert.equal(audit.groups.length, 5);
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert.equal(git(["rev-parse", `refs/remotes/origin/${branch}`]).trim(), parent);
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    report.files.push({ path: relative, sha256: digest(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree])
    .trim().split("\n").sort(), [...files].sort());
  report.patch = git(["diff", "--stat", parent, tree]);
  report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], { input:
    "Deliver editor 1.9.83 save guards with native acceptance evidence\n\nVerify sustained editing, failed-save navigation protection, native recovery points, timeline restore, undo/redo and same-default-profile restart. Preserve Runtime 0.32 and old failed QA records. Retire both disposable profiles and clean exact generated trees.\n" }).trim();
  save();
  // Ordinary non-force push rejects remote divergence; never repeat an uncertain push automatically.
  report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]);
  report.pushSucceeded = true; save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
  report.remoteRefVerified = true;
  report.status = "PASS_PUSH_AND_REMOTE_REF_NOT_REMOTE_BYTES";
} catch (error) {
  report.status = report.pushSucceeded ? "PUSH_SUCCEEDED_REMOTE_CHECK_BLOCKED" : "SOURCE_DELIVERY_BLOCKED";
  report.error = error.stack; process.exitCode = 1;
} finally {
  report.after = state(); assert.deepEqual(report.after, report.before);
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, pushSucceeded: report.pushSucceeded,
    files: report.files.length, realIndexChanged: false, error: report.error }));
}
