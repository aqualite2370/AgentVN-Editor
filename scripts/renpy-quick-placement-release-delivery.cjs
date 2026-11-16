"use strict";
// Publish the reviewed native release delta without moving the real HEAD/index.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-Quick-Placement-Release-1981-20261116-01";
const parent = "e60272c5e6eed3eebf0ac5085420fff0147d0d4e", branch = "codex/editor-autosave-recovery-20261116";
const mode = process.argv[2]; assert(["--publish", "--audit"].includes(mode)); assert.equal(process.argv.length, 3);
const versions = ["editor/package.json", "editor/package-lock.json", "editor/src-tauri/Cargo.toml",
  "editor/src-tauri/Cargo.lock", "editor/src-tauri/tauri.conf.json"];
const files = [...versions, "scripts/renpy-quick-placement-release.cjs", "scripts/renpy-quick-placement-installed.cjs",
  "scripts/renpy-quick-placement-install-stage.cjs", "scripts/renpy-quick-placement-install-audit.cjs",
  "scripts/renpy-quick-placement-cleanup.ps1", "scripts/renpy-quick-placement-release-delivery.cjs"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const verify = file => assert.equal(sha(file.path), file.sha256, file.path);
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const output = path.join(base, mode === "--publish" ? "source-delivery-01.json" : "terminal-review-01.json");
assert(!fs.existsSync(output), "Preserve original evidence");
const report = { status: "RUNNING", mode, at: new Date().toISOString(), parent, branch, before: state(),
  files: [], checks: [], productBuilds: 0, productRestarts: 0, modelRequests: 0,
  scope: "1981_NATIVE_CUSTOM_QUICK_BAR_DELIVERY_NOT_ANDROID_OR_WHOLE_GOAL" };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); }
}
(async () => {
  const build = read(path.join(base, "release/build.json")), checkpoint = read(path.join(base, "checkpoint.json"));
  const auditPath = path.join(base, "installed-audit-01.json"), cleanupPath = path.join(base, "artifact-cleanup-01.json");
  const audit = read(auditPath), cleanup = read(cleanupPath);
  check("one native032 release and unchanged reviewed product source", () => {
    assert.equal(build.version, "1.9.81"); assert.equal(build.runtimeVersion, "0.32.0");
    assert.equal(build.nativePlayerBuilds, 1); assert.equal(build.androidBuilds, 0);
    assert.equal(build.msiInstallers, 0); assert.equal(build.standalonePlayerInstallers, 0); assert.equal(build.modelRequests, 0);
    for (const file of [build.installer, build.sourceInstaller, build.dev, build.player, build.backend,
      build.oldPlayer, build.payloadReport, build.stages, build.checkpoint, ...build.sources]) verify(file);
    for (const pair of build.bundledSources) { verify(pair.source); verify(pair.bundled); assert.equal(pair.source.sha256, pair.bundled.sha256); }
    for (const file of build.sources) assert.equal(fs.readFileSync(file.path, "utf8").replaceAll("\r\n", "\n"),
      git(["show", `${parent}:${path.relative(root, file.path).replaceAll("\\", "/")}`]).replaceAll("\r\n", "\n"));
    const stages = read(build.stages.path); assert.equal(stages.stages.length, 4);
    assert(stages.stages.every(s => s.status === "PASS" && s.exitCode === 0));
    for (const stage of stages.stages) verify(stage.log);
    return { installer: build.installer, noFurtherProductChanges: true };
  });
  check("immutable installed audit and retained native UI export", () => {
    assert.equal(audit.status, "PASS1981_INSTALLED_AUTHOR_RESTART_UI_EXPORT_NATIVE032_REAL031_REFUSAL");
    assert.equal(audit.checks.length, 6); assert(audit.checks.every(c => c.status === "PASS"));
    for (const file of audit.inputs) verify(file);
    const run = read("F:/testavn/Windows-Isolated-1981-20261116-04/resource-01/report.json");
    assert.equal(run.status, "PASS"); assert.equal(run.stages.length, 6); assert.equal(run.installations, 0);
    assert(run.stages.every(s => s.status === "PASS")); verify(run.cartridge);
    return { auditedBeforeTemporaryInstallRemoval: true, auditSha256: sha(auditPath),
      cartridge: run.cartridge, physicalPhoneClaim: false, wholeGoalComplete: false };
  });
  check("precise cleanup retained evidence and retired identities", () => {
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.targets.length, 10);
    assert.equal(cleanup.oldRejectedProfilesTouched, false);
    assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    assert.equal(cleanup.files, 30608); assert.equal(cleanup.logicalBytes, 729850884);
    for (const file of cleanup.retained) verify(file);
    const live = rows(), ports = [];
    for (const number of ["01", "03", "04"]) {
      const scope = `F:/testavn/Windows-Isolated-1981-20261116-${number}`;
      const retired = read(path.join(scope, "account-retirement-01.json")), run = read(path.join(scope, "resource-01/report.json"));
      assert.equal(retired.status, "PASS"); assert(retired.cleanup.accountDeleted && retired.cleanup.profileDeleted);
      assert(!fs.existsSync(retired.account.profile)); verify(retired.databaseEvidence);
      const observed = JSON.parse(ps(`@{account=[bool](Get-LocalUser -SID '${retired.account.sid}' -ErrorAction SilentlyContinue);` +
        `profile=[bool](Get-CimInstance Win32_UserProfile|Where-Object SID -CEQ '${retired.account.sid}')}|ConvertTo-Json -Compress`));
      assert.equal(observed.account, false); assert.equal(observed.profile, false);
      for (const known of [...(run.editorKnown || []), ...(run.knownProcesses || [])])
        assert(!live.some(p => p.ProcessId === known.ProcessId && p.Created === known.Created));
      for (const launch of run.launches) ports.push(...(launch.ports || [launch.port]));
    }
    assert.equal(listeners([...new Set(ports)]).length, 0);
    return { cleanupSha256: sha(cleanupPath), files: cleanup.files, logicalBytes: cleanup.logicalBytes, accounts: 3 };
  });
  check("daily frozen bytes checkpoints and actual Git index preserved", () => {
    verify(checkpoint.daily); verify(checkpoint.frozen.installer); verify(checkpoint.frozen.player); verify(checkpoint.git.index);
    for (const file of checkpoint.files) verify(file.retained);
    assert.equal(report.before.head, checkpoint.git.head); assert.equal(report.before.indexSha256, checkpoint.git.index.sha256);
    return report.before;
  });
  if (mode === "--publish") {
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Remote changed; do not overwrite");
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "release-delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const bytes = fs.readFileSync(path.join(root, relative)); assert.equal(scan(bytes.toString("utf8")).length, 0, relative);
      if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
      if (versions.includes(relative)) assert.equal(bytes.toString("utf8").replaceAll("\r\n", "\n").trim(),
        git(["show", `${parent}:${relative}`]).replaceAll("1.9.80", "1.9.81").replaceAll("\r\n", "\n").trim());
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      report.files.push({ relative, sha256: hash(bytes) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), [...files].sort());
    report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
      input: "Deliver custom Renpy quick-bar placement in Editor 1.9.81 with native Runtime 0.32\n\nVerify actual NSIS authoring, same-default-profile restart, installed UI export, native consumption and real old-runtime refusal. Preserve original QA failures, retired identities and precise cleanup evidence. Keep actual checkout/index and daily Dev unchanged.\n",
    }).trim(); save();
    report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]);
    report.pushSucceeded = true; report.pushSucceededAt = new Date().toISOString(); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    for (let i = 0; i < report.files.length; i += 4) {
      await Promise.all(report.files.slice(i, i + 4).map(async file => {
        const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
          { signal: AbortSignal.timeout(30000) });
        assert(response.ok, "Remote HTTP " + response.status);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
      })); save();
    }
    report.status = "PASS";
  } else {
    check("published metadata and QA bytes verified remotely", () => {
      const delivery = read(path.join(base, "source-delivery-01.json"));
      assert.equal(delivery.status, "PASS"); assert.equal(delivery.pushSucceeded, true);
      assert.equal(delivery.files.length, files.length); assert(delivery.files.every(f => f.remotelyVerified));
      assert.deepEqual(delivery.before, delivery.after);
      for (const file of delivery.files) assert.equal(sha(path.join(root, file.relative)), file.sha256);
      report.commit = delivery.commit; return { commit: delivery.commit, files: files.length };
    });
    report.status = "PASS1981_NATIVE_DELIVERY_RETIRED_CLEANUP_NOT_WHOLE_GOAL";
  }
  report.after = state(); assert.deepEqual(report.after, report.before);
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, pushSucceeded: report.pushSucceeded,
    checks: report.checks.length, files: report.files.length, output, error: report.error }));
});
