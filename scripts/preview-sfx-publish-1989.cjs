"use strict";
// Publish only this verified batch, preserving the user's actual checkout/index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Preview-Sfx-Release-1989-20261117-01";
const parent = "3dc249351652a717cfebf5edb1215e5010ba58b0", branch = "codex/editor-autosave-recovery-20261116";
const review = path.join(base, "source-delivery-review-02.json"), output = path.join(base, "source-delivery.json");
const hash = v => crypto.createHash("sha256").update(v).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
function git(args, options = {}) {
  return cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args], {
    cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 45000, maxBuffer: 16 * 1024 * 1024, ...options,
  });
}
const index = path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim());
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(), indexSha256: hash(fs.readFileSync(index)) });
const build = read(path.join(base, "release/build.json"));
const files = [...new Set([
  ...build.sources.map(s => path.relative(root, s.path).replaceAll("\\", "/")),
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json",
  "scripts/preview-sfx-release-1989.cjs", "scripts/preview-sfx-install-stage-1989.cjs",
  "scripts/preview-sfx-installed-1989.cjs", "scripts/preview-sfx-audit-1989.cjs",
  "scripts/preview-sfx-cleanup-1989.ps1", "scripts/preview-sfx-cleanup-followup-1989.ps1",
  "scripts/preview-sfx-publish-1989.cjs",
])];
function describe() {
  return files.map(relative => {
    assert(!relative.startsWith("../") && !path.isAbsolute(relative));
    const bytes = fs.readFileSync(path.join(root, relative));
    assert(!bytes.includes(0)); assert.deepEqual(scan(bytes.toString("utf8")), [], "Review required: " + relative);
    return { path: relative, bytes: bytes.length, sha256: hash(bytes) };
  });
}
if (process.argv[2] !== "--push") {
  assert(!fs.existsSync(review));
  fs.writeFileSync(review, JSON.stringify({
    status: "PREPARED_ONLY_NOT_PUSHED", before: state(), parent, branch, files: describe(),
    ignoredLocalOnly: ["AGENTS.md", "plans", "output", "binaries", "installers", "databases", "credentials"],
    heuristicSecretFindings: 0,
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "PREPARED_ONLY_NOT_PUSHED", files: files.length, review })); return;
}
assert(!fs.existsSync(output));
const prepared = read(review);
const report = { status: "RUNNING", before: state(), parent, branch, files: describe(), builds: 0, productLaunches: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
try {
  assert.deepEqual(report.before, prepared.before); assert.deepEqual(report.files, prepared.files);
  assert.equal(read(path.join(base, "functional-audit.json")).status, "PASS");
  assert.equal(read("F:/testavn/Windows-Isolated-1989-20261117-01/artifact-cleanup.json").status, "FAILED");
  assert.equal(read("F:/testavn/Windows-Isolated-1989-20261117-01/artifact-cleanup-02.json").status, "PASS");
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Remote changed; do not force");
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "source-delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const f of report.files) {
    const blob = git(["hash-object", "-w", "--stdin"], { input: fs.readFileSync(path.join(root, f.path)) }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], { env: alternate });
  }
  report.tree = git(["write-tree"], { env: alternate }).trim();
  report.changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, report.tree]).trim().split("\n").filter(Boolean);
  assert(report.changed.length > 0); assert(report.changed.every(f => files.includes(f)));
  report.stat = git(["diff", "--ignore-space-at-eol", "--stat", parent, report.tree]);
  report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", report.tree, "-p", parent], {
    input: "Add preview gallery unlock option and sound-effect stop/fade\n\nDeliver editor 1.9.89 with Runtime 0.33. Keep gallery bypass preview-only and non-persistent. Manage concurrent and pending sound instances, targeted/all stops, fades and lifecycle cleanup. Verify browser matrices, installed NSIS/native playback, real old-runtime rejection and QA retirement.\n",
  }).trim(); save();
  report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]);
  report.pushSucceeded = true; save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t")); report.remoteRefVerified = true;
  for (const f of report.files) assert.equal(hash(git(["show", `${report.commit}:${f.path}`], { encoding: null })), f.sha256);
  report.status = "PASS_PUSH_REMOTE_REF_AND_LOCAL_COMMIT_BYTES";
} catch (e) { report.status = "FAILED"; report.error = e.stack; process.exitCode = 1; }
finally {
  report.after = state(); report.headIndexPreserved = JSON.stringify(report.after) === JSON.stringify(report.before);
  assert(report.headIndexPreserved); report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, pushSucceeded: report.pushSucceeded,
    remoteRefVerified: report.remoteRefVerified, files: report.files.length, error: report.error }));
}
