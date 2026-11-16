"use strict";
// Publish only release metadata and scoped QA. Preserve the actual HEAD/index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const crypto = require("node:crypto"), assert = require("node:assert/strict");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-History-Release-1980-20261116-01";
const installed = "F:/testavn/Windows-Isolated-1980-20261116-01";
const parent = "1e3941c437c0c963f4fac3f97eb8b42aa6d15b9a", branch = "codex/editor-autosave-recovery-20261116";
const mode = process.argv[2]; assert(["--publish", "--audit"].includes(mode)); assert.equal(process.argv.length, 3);
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"];
const files = [...versions, "scripts/editor-autosave-release-1976.cjs", "scripts/editor-autosave-install-stage-1976.cjs",
  "scripts/editor-history-installed-1980.cjs", "scripts/editor-history-install-audit-1980.cjs",
  "scripts/editor-history-cleanup-1980.ps1", "scripts/editor-history-release-delivery-1980.cjs",
  "scripts/editor-history-timeline-audit.cjs"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const output = path.join(base, mode === "--publish" ? "source-delivery-01.json" : "terminal-review-01.json");
assert(!fs.existsSync(output), "Preserve original evidence");
const report = { status: "RUNNING", mode, at: new Date().toISOString(), parent, branch, files: [], checks: [], before: state(),
  scope: "EDITOR_1980_INSTALLED_UNDO_FEEDBACK_TIMELINE_RESTART_NOT_WHOLE_GOAL",
  productBuilds: 0, productRestarts: 0, models: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
const verify = artifact => assert.equal(sha(artifact.path), artifact.sha256, artifact.path);
function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); }
}
(async () => {
  const build = read(path.join(base, "release/build.json")), checkpoint = read(path.join(base, "checkpoint.json"));
  const audit = read(path.join(installed, "terminal-audit-01.json"));
  const cleanup = read(path.join(installed, "artifact-cleanup-01.json"));
  check("unique 1980 candidate and four unchanged reviewed product sources", () => {
    assert.equal(build.version, "1.9.80");
    for (const artifact of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
      build.payloadReport, build.packageLog, ...build.logs, ...build.historySources]) verify(artifact);
    assert.equal(build.historySources.length, 4);
    for (const artifact of build.historySources) {
      const relative = path.relative(root, artifact.path).replaceAll("\\", "/");
      assert.equal(fs.readFileSync(artifact.path, "utf8").replaceAll("\r\n", "\n"),
        git(["show", `${parent}:${relative}`]).replaceAll("\r\n", "\n"));
    }
    assert.equal(build.standalonePlayerBuilds, 0); assert.equal(build.androidBuilds, 0); assert.equal(build.modelRequests, 0);
    return { installer: build.installer, newProductChangesAfterSourceCommit: 0 };
  });
  check("actual installed UI backup restore and same-default-profile restart", () => {
    assert.equal(audit.status, "PASS_INSTALLED_HISTORY_FEEDBACK_NATIVE_TIMELINE_DEFAULT_PROFILE_RESTART");
    assert.equal(audit.checks.length, 5); assert(audit.checks.every(c => c.status === "PASS"));
    const run = read(path.join(installed, "resource-01/report.json"));
    assert.equal(run.status, "PASS"); assert.equal(run.cleanupStatus, "PASS");
    assert.equal(run.stages.length, 8); assert(run.stages.every(s => s.status === "PASS"));
    assert.equal(run.installations, 1); assert.equal(run.cleanups.length, 2);
    assert(run.cleanups.every(c => c.method === "WM_CLOSE" && c.receipt.normalClose && c.killed.length === 0));
    assert.equal(run.controlledNativeIPC, false); assert.equal(run.storeInjection, false);
    assert.equal(run.controlledRequestDelivery, false); assert.equal(run.computerUse, false);
    return { installations: 1, stages: 8, normalCloses: 2, sourceRaceEvidenceSeparate: true,
      originalNaturalLoss: "NOT_REPRODUCED", physicalPhoneClaim: false };
  });
  check("precise test cleanup with retained native evidence and QA sources", () => {
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.targets.length, 4);
    assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    assert(cleanup.files > 0 && cleanup.logicalBytes > 0); assert.equal(cleanup.oldRejectedProfilesTouched, false);
    for (const artifact of cleanup.retained) verify(artifact);
    const retired = read(path.join(installed, "account-retirement-01.json"));
    assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
    assert(!fs.existsSync(retired.account.profile)); verify(retired.databaseEvidence);
    const archive = read(path.join(installed, "qa-sources.json"));
    assert.equal(archive.status, "PASS"); assert(archive.files.length > 0);
    for (const artifact of archive.files) verify(artifact);
    return { accounts: 1, files: cleanup.files, logicalBytes: cleanup.logicalBytes, physicalBytesClaim: false };
  });
  check("daily Dev prior frozen installer and real checkout preserved", () => {
    verify(checkpoint.daily); verify(checkpoint.frozenPrevious); verify(checkpoint.index);
    assert.equal(report.before.head, checkpoint.head);
    assert.equal(report.before.indexSha256, checkpoint.index.sha256); return report.before;
  });
  if (mode === "--publish") {
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Concurrent update; do not overwrite");
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "release-delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const bytes = fs.readFileSync(path.join(root, relative));
      assert.equal(scan(bytes.toString("utf8")).length, 0, "Review possible credential: " + relative);
      if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
      if (versions.includes(relative))
        assert.equal(bytes.toString("utf8").replaceAll("\r\n", "\n").trim(),
          git(["show", `${parent}:${relative}`]).replaceAll("1.9.79", "1.9.80").replaceAll("\r\n", "\n").trim());
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      report.files.push({ relative, sha256: hash(bytes) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), [...files].sort());
    report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
      input: "Deliver confirmed timeline restoration and undo feedback in Editor 1.9.80\n\nRelease the reviewed source delta without changing runtime presentation. Verify one genuine NSIS installation, empty-history notices, native text undo, specific event undo confirmation/cancel/redo, native before-restore backup and exact same-default-profile restart. Retire the disposable Windows account and only its validated temporary trees; keep source/browser race evidence distinct from actual installed behavior. Preserve real checkout/index, daily Dev, frozen prior packages and original failures.\n",
    }).trim();
    save(); report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    for (let i = 0; i < report.files.length; i += 4) {
      await Promise.all(report.files.slice(i, i + 4).map(async file => {
        const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
          { signal: AbortSignal.timeout(30000) });
        assert(response.ok, "Remote source HTTP " + response.status);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
      })); save();
    }
    report.status = "PASS";
  } else {
    check("published version and QA files verified against immutable remote bytes", () => {
      const delivery = read(path.join(base, "source-delivery-01.json"));
      assert.equal(delivery.status, "PASS"); assert.equal(delivery.files.length, files.length);
      assert(delivery.files.every(f => f.remotelyVerified)); assert.deepEqual(delivery.before, delivery.after);
      for (const file of delivery.files) assert.equal(sha(path.join(root, file.relative)), file.sha256);
      report.commit = delivery.commit; return { commit: delivery.commit, files: delivery.files.length };
    });
    report.status = "PASS_TARGETED_HISTORY_RELEASE_INSTALL_RESTART_CLEANUP_NOT_WHOLE_GOAL";
  }
  report.after = state(); assert.deepEqual(report.after, report.before);
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, checks: report.checks.length,
    files: report.files.length, output, error: report.error }));
});
