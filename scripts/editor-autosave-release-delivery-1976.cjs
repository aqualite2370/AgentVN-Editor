"use strict";
// Publish only the reviewed version and targeted installed-QA delta.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Editor-Autosave-Release-1976-20261116-01";
const installed = "F:/testavn/Windows-Isolated-1976-20261116-05";
const parent = "db57e41c57f588b12b2c2e41814502454d24396d";
const branch = "codex/editor-autosave-recovery-20261116";
const output = path.join(base, "source-delivery-01.json"); assert(!fs.existsSync(output));
const files = [
  "editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json",
  "scripts/editor-autosave-release-1976.cjs", "scripts/editor-autosave-installed-1976.cjs",
  "scripts/editor-autosave-install-stage-1976.cjs", "scripts/editor-autosave-install-audit-1976.cjs",
  "scripts/editor-autosave-cleanup-1976.ps1", "scripts/lib/native-editor-recovery-files.cjs",
  "scripts/editor-autosave-release-delivery-1976.cjs",
];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const report = { status: "RUNNING", at: new Date().toISOString(), parent, branch, files: [], before: state(),
  scope: "EDITOR_1976_VERSION_AND_TARGETED_INSTALLED_QA_NO_USER_DATA_NO_CONTINUOUS_UPGRADE_CLAIM",
  productBuilds: 0, productRestarts: 0, models: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
(async () => {
  const build = read(path.join(base, "release/build.json"));
  assert.equal(build.version, "1.9.76");
  assert.equal(sha(build.installer.path), build.installer.sha256);
  assert.equal(read(path.join(installed, "terminal-audit-01.json")).status,
    "PASS_TARGETED_REUSED_INSTALL_DEFAULT_PROFILE_METADATA_RECOVERY");
  assert.equal(read(path.join(installed, "artifact-cleanup-01.json")).status, "PASS");
  const before = read(path.join(base, "checkpoint.json"));
  assert.equal(report.before.head, before.head); assert.equal(report.before.indexSha256, before.index.sha256);
  assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"),
    "Never overwrite another contributor's commit");
  const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "release-delivery.index") };
  assert(!fs.existsSync(alternate.GIT_INDEX_FILE));
  git(["read-tree", parent], { env: alternate });
  for (const relative of files) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.equal(scan(bytes.toString("utf8")).length, 0, "Review credential finding: " + relative);
    if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
    if (relative.startsWith("editor/")) {
      const prior = git(["show", `${parent}:${relative}`]);
      assert.equal(bytes.toString("utf8").trim(), prior.replaceAll("1.9.75", "1.9.76").trim(),
        "Version files may contain only the reviewed increment");
    }
    const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
    report.files.push({ relative, sha256: hash(bytes) });
  }
  const tree = git(["write-tree"], { env: alternate }).trim();
  assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(),
    [...files].sort());
  report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
    input: "Release Editor 1.9.76 with installed metadata recovery verification\n\nVerify real native metadata checkpoints, recovery failure and workspace retry, safe timeline restore and same new default-profile restart. Retain the original upgrade QA failure and distinguish inherited checkpoints from current assertions. Preserve user checkout/index and publish no reports, databases or binaries.\n",
  }).trim();
  save();
  report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
  assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
  for (let i = 0; i < report.files.length; i += 4) {
    await Promise.all(report.files.slice(i, i + 4).map(async file => {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
        { signal: AbortSignal.timeout(20000) });
      assert(response.ok, "Source verification HTTP " + response.status);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
    }));
    save();
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, files: report.files.length, output, error: report.error }));
});
