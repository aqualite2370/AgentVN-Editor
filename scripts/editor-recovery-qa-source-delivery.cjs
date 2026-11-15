"use strict";
// Publish reviewed QA sources only, preserving the user's real HEAD and index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Client-Presentation-Android-1975-20261116-04";
const output = path.join(base, "qa-source-delivery-01.json"); assert(!fs.existsSync(output));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const parent = read("F:/testavn/Editor-Recovery-20261115-01/source-delivery.json").commit;
const branch = "codex/editor-recovery-1975-qa-20261116";
const files = [
  "scripts/android-runtime-log-analysis.cjs", "scripts/android-runtime-log-completeness-test.cjs",
  "scripts/android-log-relay-test.cjs",
  "scripts/lib/android-log-relay.cjs", "scripts/lib/file-sha256-bounded.cjs",
  "scripts/android-log-volatile-identity-test.cjs", "scripts/lib/android-log-volatile-identity.cjs",
  "scripts/editor-recovery-android-log-review.cjs", "scripts/editor-recovery-android-log-identity-review.cjs",
  "scripts/editor-recovery-android-startup-timeline.cjs",
  "scripts/android-startup-observer-test.cjs", "scripts/lib/android-startup-observer.cjs",
  "scripts/android-display-observer-test.cjs", "scripts/lib/android-display-observer.cjs",
  "scripts/game-viewport-ratios-test.cjs", "scripts/editor-recovery-qa-source-delivery.cjs",
];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, extra = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
  cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...extra,
});
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  index: hash(fs.readFileSync(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim()))) });
const r = { status: "RUNNING", at: new Date().toISOString(), parent, branch, before: state(), files: [],
  productChanges: 0, productBuilds: 0, productLaunches: 0, modelRequests: 0,
  scope: "REPRODUCIBLE_OFFLINE_LOG_REVIEW_AND_BOUNDED_OBSERVERS_ONLY_NOT_PRODUCT_OR_REPORT_PUBLICATION" };
function save() { fs.writeFileSync(output, JSON.stringify(r, null, 2)); }
(async () => {
  const current = read(path.join(base, "current-log-review-02.json"));
  assert.equal(current.records, 271); assert.equal(current.unresolved, 92);
  assert.equal(current.changes.length, 79);
  assert.equal(read(path.join(base, "final-cleanup-01.json")).status, "PASS");
  assert.equal(git(["ls-remote", "--heads", "origin", branch]).trim(), "");
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "qa-delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(scan(bytes.toString("utf8")).length, 0, "Review credential finding before publication: " + relative);
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    r.files.push({ relative, sha256: hash(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n");
  assert.deepEqual(changed.sort(), [...files].sort());
  r.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
    input: "Verify Android log ownership and preserve failed-session evidence\n\nBind volatile ART logger names, provider metadata and framework package fields to actual host/renderer identities before reviewing current captured messages. Add strict negative checks, a retained startup relaunch timeline, and bounded startup/display observers. Keep all original failures and unresolved events. QA-only; no product, project, database or local report is published.\n",
  }).trim();
  save();
  r.push = git(["push", "origin", `${r.commit}:refs/heads/${branch}`]); save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(r.commit + "\t"));
  for (const file of r.files) {
    const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${r.commit}/${file.relative}`,
      { signal: AbortSignal.timeout(20000) });
    assert(response.ok, String(response.status));
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256);
    file.remotelyVerified = true; save();
  }
  r.after = state(); assert.deepEqual(r.after, r.before); r.status = "PASS";
})().catch(error => {
  r.status = "FAILED"; r.error = String(error.stack || error); r.after = state(); process.exitCode = 1;
}).finally(() => {
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, commit: r.commit, files: r.files.length, output, error: r.error }));
});
