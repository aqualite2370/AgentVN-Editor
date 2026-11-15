"use strict";
// Publish only this reviewed data-safety fix, version increment and targeted QA.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Editor-Home-Save-Release-1977-20261116-01";
const installed = "F:/testavn/Windows-Isolated-1977-20261116-02";
const parent = "0dd1847279b89d72c500eef7ac57f3fca3675aa7";
const branch = "codex/editor-autosave-recovery-20261116";
const output = path.join(base, "source-delivery-01.json"); assert(!fs.existsSync(output));
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"];
const product = "editor/src/api/backendClient.ts";
const files = [...versions, product, "scripts/editor-project-write-ordering-test.cjs",
  "scripts/editor-home-save-ordering-playwright.cjs", "scripts/editor-home-save-installed-1977.cjs",
  "scripts/editor-home-save-install-audit-1977.cjs", "scripts/editor-autosave-release-1976.cjs",
  "scripts/editor-autosave-install-stage-1976.cjs", "scripts/editor-autosave-cleanup-1976.ps1",
  "scripts/editor-home-save-failed-retire-1977.ps1",
  "scripts/editor-home-save-release-delivery-1977.cjs"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const report = { status: "RUNNING", at: new Date().toISOString(), parent, branch, files: [], before: state(),
  scope: "EDITOR_1977_SHARED_HOME_AUTOSAVE_QUEUE_AND_TARGETED_INSTALL_NOT_ORIGINAL_INCIDENT_OR_UPGRADE",
  productBuilds: 0, productRestarts: 0, models: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
(async () => {
  const build = read(path.join(base, "release/build.json"));
  assert.equal(build.version, "1.9.77"); assert.equal(sha(build.installer.path), build.installer.sha256);
  assert.equal(read(path.join(installed, "terminal-audit-01.json")).status,
    "PASS_INSTALLED_HOME_SAVE_ORDERING_AND_DEFAULT_PROFILE_RESTART");
  assert.equal(read(path.join(installed, "artifact-cleanup-01.json")).status, "PASS");
  const before = read(path.join(base, "checkpoint.json"));
  assert.equal(report.before.head, before.head); assert.equal(report.before.indexSha256, before.index.sha256);
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Preserve concurrent remote changes");
  assert.equal(git(["diff", "--ignore-space-at-eol", "--numstat", parent, "--", product]).trim(),
    "18\t9\t" + product, "Review any additional semantic product changes");
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "release-delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(scan(bytes.toString("utf8")).length, 0, "Review credential finding: " + relative);
    if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
    if (versions.includes(relative)) {
      const previous = git(["show", `${parent}:${relative}`]);
      assert.equal(bytes.toString("utf8").replaceAll("\r\n", "\n").trim(),
        previous.replaceAll("1.9.76", "1.9.77").replaceAll("\r\n", "\n").trim(),
        "Version files must contain only the reviewed increment");
    }
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    report.files.push({ relative, sha256: hash(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(),
    [...files].sort());
  report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
    input: "Prevent late home saves from overwriting newer nodes in Editor 1.9.77\n\nSerialize whole-project PUT and graph POST through the same persistence queue. Preserve queue-head snapshots, callbacks and release on failure. Verify controlled late home delivery against the actual backend and installed default-profile Editor, followed by exact node readback after normal restart. Original natural loss remains unproven. Publish no databases, binaries or reports; preserve real checkout and index.\n",
  }).trim();
  save(); report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
  for (let i = 0; i < report.files.length; i += 4) {
    await Promise.all(report.files.slice(i, i + 4).map(async file => {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
        { signal: AbortSignal.timeout(20000) });
      assert(response.ok, "Remote source HTTP " + response.status);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
    })); save();
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, files: report.files.length, output, error: report.error }));
});
