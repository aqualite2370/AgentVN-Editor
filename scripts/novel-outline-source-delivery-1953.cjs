"use strict";
// Reviewed public delta only; preserve the dirty worktree, HEAD and real index.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const cp = require("node:child_process"), assert = require("node:assert/strict");
const root = path.resolve(__dirname, ".."), base = "F:/AgentVN/QA/Source-Delivery-1953-20261107-01";
const parent = "5f77ea2d844c8341e0fca8605dc7e132b8257843";
const branch = "codex/novel-outline-recovery-1953-20261107";
const action = process.argv[2]; assert(["prepare", "publish", "verify"].includes(action));
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, opts = {}) => {
  const b = cp.execFileSync("git", ["-c", "core.autocrlf=false", "-c", "http.version=HTTP/1.1", ...args],
    { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 120000,
      maxBuffer: 32 * 1024 * 1024, ...opts });
  return Buffer.isBuffer(b) ? b : b.trim();
};
const state = () => ({ head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]),
  index: desc(path.resolve(root, git(["rev-parse", "--git-path", "index"]))) });
if (action === "prepare") { assert(!fs.existsSync(base)); fs.mkdirSync(base); }
const output = path.join(base, action + ".json"); assert(!fs.existsSync(output));
const report = { status: "RUNNING", action, branch, parent, before: state(), at: new Date().toISOString() };
try {
  if (action === "prepare") {
    const build = read("F:/AgentVN/QA/Novel-Outline-Release-1953-20261107-01/report.json");
    assert.equal(build.status, "BUILD_AND_PAYLOAD_PASS_INSTALLATION_PENDING_LIVE_DEV_PRESERVED");
    const files = [
      "editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
      "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json",
      "backend/app/models/novel_import.py", "backend/app/services/novel_import_service.py",
      "backend/app/services/novel_outline_pipeline.py", "backend/tests/test_novel_import_api.py",
      "backend/tests/test_novel_outline_recovery.py", "backend/tools/novel_outline_live_preflight.py",
      "editor/src/store/novelImportStore.ts", "editor/src/novel-import/types.ts",
      "editor/src/novel-import/adaptationClient.ts", "editor/src/novel-import/novelProcessJobAdapter.ts",
      "editor/src/components/novel-import/NovelImportWizard.tsx",
      "scripts/novel-outline-recovery-playwright.cjs", "scripts/novel-outline-transport-test.cjs",
      "scripts/novel-phase-facts-test.cjs", "scripts/novel-outline-release-1953.cjs",
      "scripts/novel-outline-installed-1953.cjs", "scripts/novel-outline-installed-stage-1953.cjs",
      "scripts/lib/qa-default-editor-session.cjs", "scripts/animation-install-1945.ps1",
      "scripts/novel-outline-source-delivery-1953.cjs",
    ].sort();
    for (const f of build.sources) assert.equal(sha(f.path), f.sha256);
    const indexEnv = { ...env, GIT_INDEX_FILE: path.join(base, "alternate-index") };
    git(["read-tree", parent], { env: indexEnv }); report.files = [];
    for (const relative of files) {
      const source = path.join(root, relative), target = path.join(base, "delta", relative);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      const blob = git(["hash-object", "-w", "--stdin"], { input: fs.readFileSync(target), env: indexEnv });
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: indexEnv });
      report.files.push({ relative, source: desc(source), frozen: desc(target), blob });
    }
    assert.deepEqual(git(["diff", "--cached", "--name-only", parent], { env: indexEnv }).split("\n").sort(), files);
    report.tree = git(["write-tree"], { env: indexEnv });
    report.commit = git(["commit-tree", report.tree, "-p", parent],
      { input: "Resume bounded novel outline batches from durable checkpoints\n\nRelease Editor 1.9.53; stop failed streams and prevent implicit task replay.\n" });
  } else {
    const prepared = read(path.join(base, "prepare.json")); assert.equal(prepared.status, "PASS");
    for (const f of prepared.files) assert.equal(sha(f.source.path), f.source.sha256);
    report.commit = prepared.commit;
    if (action === "publish") {
      const installed = read("F:/AgentVN/QA/Windows-Isolated-1944-20261107-42/recovery-01/report.json");
      assert.equal(installed.status, "PASS_LIMITED_INSTALLED_RECOVERY"); assert.equal(installed.cleanup, "PASS");
      assert.equal(git(["ls-remote", "--heads", "origin", branch]), "");
      report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]);
      assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    } else {
      assert.equal(read(path.join(base, "publish.json")).status, "PASS");
      const repo = path.join(base, "remote-check"); git(["init", "--bare", repo]);
      // Reuse local objects to avoid downloading the entire historical repository.
      const objects = path.resolve(root, git(["rev-parse", "--git-path", "objects"]));
      fs.mkdirSync(path.join(repo, "objects/info"), { recursive: true });
      fs.writeFileSync(path.join(repo, "objects/info/alternates"), objects.replaceAll("\\", "/") + "\n", { flag: "wx" });
      git(["--git-dir", repo, "fetch", "https://github.com/aqualite2370/AgentVN-Editor.git",
        `refs/heads/${branch}`]);
      assert.equal(git(["--git-dir", repo, "rev-parse", "FETCH_HEAD"]), report.commit);
      for (const f of prepared.files) {
        const actual = git(["--git-dir", repo, "cat-file", "blob", `${report.commit}:${f.relative}`], { encoding: "buffer" });
        assert.equal(crypto.createHash("sha256").update(actual).digest("hex"), f.source.sha256);
      }
      report.verifiedPublicFiles = prepared.files.length;
    }
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, action, commit: report.commit, error: report.error }));
}
