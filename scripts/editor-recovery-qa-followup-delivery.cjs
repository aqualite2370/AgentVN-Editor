"use strict";
// Fast-forward only the QA branch. The user's real checkout/index and all
// product, report, database, cartridge and APK bytes remain outside this commit.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Android-Sprite-Preview-1975-20261116-03";
const output = path.join(base, "source-delivery.json");
assert(!fs.existsSync(output), "Keep the earlier delivery receipt");
const parent = "c7691849acc6ec901f13e968f59d4cf8a1bce66e";
const branch = "codex/editor-recovery-1975-qa-20261116";
const files = [
  "scripts/android-dead-handler-event-test.cjs", "scripts/lib/android-dead-handler-event.cjs",
  "scripts/editor-recovery-android-lifecycle-review.cjs",
  "scripts/lib/sprite-preview-fixture.cjs", "scripts/sprite-preview-fixture-test.cjs",
  "scripts/sprite-count-android-preview.cjs", "scripts/sprite-count-android-preview-stage.cjs",
  "scripts/sprite-count-android-preview-launch.ps1", "scripts/sprite-count-android-preview-audit.cjs",
  "scripts/lib/android-startup-host-identity.cjs", "scripts/android-startup-host-identity-test.cjs",
  "scripts/editor-recovery-qa-followup-delivery.cjs",
];
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, extra = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 * 1024, ...extra });
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const r = { status: "RUNNING", at: new Date().toISOString(), parent, branch, files: [], before: state(),
  productBuilds: 0, deviceStarts: 0, models: 0,
  scope: "QA_ONLY_SPRITE_PREVIEW_AND_OFFLINE_WARNING_IDENTITY_NO_PRODUCT_OR_USER_DATA" };
const save = () => fs.writeFileSync(output, JSON.stringify(r, null, 2));
(async () => {
  const audit = read(path.join(base, "audit.json"));
  assert.equal(audit.status, "PASS_TARGETED_ANDROID_PREVIEW_GEOMETRY_AND_CLEANUP_WITH_RETAINED_LOG_AND_PHYSICAL_PHONE_LIMITS");
  const lifecycle = read("F:/testavn/Client-Presentation-Android-1975-20261116-04/lifecycle-source-review-02/report.json");
  assert.equal(lifecycle.status, "WARNING_BRANCH_AND_WINDOW_ORDER_BOUND_CDP_TRIGGER_UNRESOLVED");
  assert.equal(lifecycle.originalCounts.unresolved, 92);
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Never replace concurrent remote work");
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "qa-followup.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(scan(bytes.toString("utf8")).length, 0, "Review credential finding: " + relative);
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    r.files.push({ relative, sha256: hash(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(),
    [...files].sort());
  r.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
    input: "Verify unchanged Android APK sprite geometry through controlled preview\n\nKeep original failed sessions and source-capture evidence. Distinguish explicit sprite fade-out from the generic exit class, retain exact geometry inheritance, and permit one bounded empty pidof re-observation only for the same boot and host. Preserve source and installed evidence boundaries; publish no user data or binaries.\n",
  }).trim();
  save();
  r.push = git(["push", "origin", `${r.commit}:refs/heads/${branch}`]); save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(r.commit + "\t"));
  for (let start = 0; start < r.files.length; start += 4) {
    await Promise.all(r.files.slice(start, start + 4).map(async file => {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${r.commit}/${file.relative}`,
        { signal: AbortSignal.timeout(20000) });
      assert(response.ok, "Remote QA source HTTP " + response.status);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256);
      file.remotelyVerified = true;
    }));
    save();
  }
  r.after = state(); assert.deepEqual(r.after, r.before); r.status = "PASS";
})().catch(error => {
  r.status = "FAILED"; r.error = error.stack; r.after = state(); process.exitCode = 1;
}).finally(() => {
  r.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: r.status, files: r.files.length, commit: r.commit, error: r.error }));
});
