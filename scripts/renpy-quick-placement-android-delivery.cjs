"use strict";
// Review retained terminal evidence, then deliver only this QA source delta.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Renpy-Quick-Placement-Android-1981-20261116-01";
const mode = process.argv[2]; assert(["--review", "--publish"].includes(mode)); assert.equal(process.argv.length, 3);
const parent = "867d3f52f619145757b86592a20e75110b514d90", branch = "codex/editor-autosave-recovery-20261116";
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...options });
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  index: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f) });
const verify = f => assert.equal(sha(f.path), f.sha256, f.path);
const output = path.join(base, mode === "--review" ? "completion-review-01.json" : "source-delivery-01.json");
assert(!fs.existsSync(output), "Preserve original receipts");
const r = { status: "RUNNING", startedAt: new Date().toISOString(), before: state(), checks: [], inputs: [], files: [],
  parent, branch, productStarts: 0, builds: 0, models: 0, oldRejectedProfilesTouched: false, wholeGoalComplete: false };
const save = () => fs.writeFileSync(output, JSON.stringify(r, null, 2));
const input = f => { r.inputs.push(desc(f)); return read(f); };
function check(name, fn) {
  const row = { name, status: "RUNNING" }; r.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; } catch (e) { row.status = "FAILED"; row.error = e.stack; throw e; }
  finally { save(); }
}
(async () => {
  const prep = input(path.join(base, "preparation.json"));
  check("native device audit and inherited six actual display cases", () => {
    const audit = input(path.join(base, "device-audit-01.json"));
    assert.equal(audit.status, "PASS1981_ANDROID_CUSTOM_BAR_NATIVE_INCREMENT_NOT_PHYSICAL_PHONE_OR_WHOLE_GOAL");
    assert.equal(audit.checks.length, 5); assert(audit.checks.every(c => c.status === "PASS"));
    for (const f of audit.inputs) verify(f);
    return { audit: desc(path.join(base, "device-audit-01.json")), boots: 3, repeatedDisplayCases: 0, physicalPhone: false };
  });
  check("all raw log records retained and no historical exemptions", () => {
    const logs = input(path.join(base, "current-log-review-01.json"));
    assert.equal(logs.status, "CUSTOM_BAR_FUNCTIONS_PASS_CURRENT_LOG_EVENTS_UNRESOLVED_ORIGINAL_FAILURES_RETAINED");
    assert.equal(logs.cases.length, 3); assert.equal(logs.records, 103); assert.equal(logs.unresolved, 86);
    assert.equal(logs.nonBlockingCurrentLocalScope, 17); assert.equal(logs.mirrors, 12);
    assert.equal(logs.rows.length, logs.records); assert.equal(logs.historicalAcceptanceApplied, false);
    for (const f of logs.inputs) verify(f);
    return { records: logs.records, unresolved: logs.unresolved, original271Unresolved92Unchanged: logs.original271Unresolved92Unchanged };
  });
  check("all three devices and exact build/tool temporary trees retired", () => {
    const cleanup = input(path.join(base, "artifact-cleanup-01.json"));
    assert.equal(cleanup.status, "PASS_EXACT_BUILD_AND_TOOL_TEMP_REMOVED_SOURCE_EXPORTS_APKS_REPORTS_RETAINED");
    assert.equal(cleanup.links.length, 4); assert.equal(cleanup.targets.length, 4);
    assert(cleanup.links.every(l => l.removed && !fs.existsSync(l.path)));
    assert(cleanup.targets.every(t => t.removed && !fs.existsSync(t.path)));
    for (const f of cleanup.retained) verify(f);
    let files = cleanup.files, logicalBytes = cleanup.logicalBytes;
    const live = rows(), boots = new Set();
    for (const name of ["device-01", "device-02", "device-03"]) {
      const run = input(path.join(base, name, "report.json")), launch = input(path.join(base, name, "launcher.json"));
      const retired = input(path.join(base, name, "cleanup.json"));
      assert(launch.finishedAt && run.finishedAt); assert.equal(run.cleanup, "PROCESS_PACKAGE_PORT_RETIREMENT_AWAITING_TEMP_CLEANUP");
      assert.deepEqual(run.cleanupErrors, []); assert(run.packageCleanup.every(p => p.absent));
      assert.equal(retired.status, "PASS_EXACT_AVD_TEMP_REMOVED_REPORTS_APKS_RETAINED");
      assert(retired.targets.every(t => t.removed && !fs.existsSync(t.path))); boots.add(run.bootId);
      assert.equal(listeners(run.ports).length, 0);
      assert(!live.some(p => p.ProcessId === launch.pid && new Date(p.Created) >= new Date(launch.startedAt).getTime() - 5000
        && new Date(p.Created) <= new Date(launch.finishedAt)));
      assert(!fs.existsSync(path.join(base, name, "staging.apk"))); files += retired.files; logicalBytes += retired.logicalBytes;
    }
    assert.equal(boots.size, 3); r.cleanupTotal = { files, logicalBytes, physicalBytesClaim: false };
    return r.cleanupTotal;
  });
  check("real HEAD index daily Dev and original author package preserved", () => {
    verify(prep.protected.dailyDev); verify(prep.protected.index); verify(prep.installer);
    for (const b of prep.builds) verify(b.cartridge);
    assert.equal(r.before.head, prep.protected.head); assert.equal(r.before.index, prep.protected.index.sha256);
    return { unchanged: true, userDatabaseWrites: 0, userAdb5037Touched: false };
  });
  if (mode === "--publish") {
    assert.equal(input(path.join(base, "completion-review-01.json")).status, "PASS_ANDROID_INCREMENT_FUNCTIONS_CLEANUP_LOGS_UNRESOLVED_GOAL_ACTIVE");
    const files = ["scripts/renpy-quick-placement-android-stage.cjs", "scripts/renpy-quick-placement-android-device-stage.cjs",
      "scripts/renpy-quick-placement-android-audit.cjs", "scripts/renpy-quick-placement-android-remaining-stage.cjs",
      "scripts/renpy-quick-placement-android-log-review.cjs", "scripts/renpy-quick-placement-android-delivery.cjs",
      "scripts/lib/android-custom-quick-bar-flow.cjs", "scripts/lib/android-custom-quick-bar-remaining.cjs"];
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "qa-delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const file = path.join(root, relative), bytes = fs.readFileSync(file);
      assert.equal(scan(bytes.toString("utf8")).length, 0, relative);
      cp.execFileSync(process.execPath, ["--check", file], { windowsHide: true });
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      r.files.push({ relative, sha256: sha(file) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), files.sort());
    r.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
      input: "Verify native Android custom quick-bar layout on installed Editor 1.9.81 resources\n\nRetain both failed QA boots and inherit six passed display cases; finish natural landscape rotation, NVL and restart without repeating matrices. Preserve full logs, exact cleanup receipts and the actual working checkout.\n",
    }).trim(); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Remote changed; do not overwrite");
    r.push = git(["push", "origin", `${r.commit}:refs/heads/${branch}`]);
    r.pushSucceeded = true; r.pushSucceededAt = new Date().toISOString(); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(r.commit + "\t"));
    r.remoteRefVerified = true;
    r.status = "PASS_QA_SOURCE_PUSH_REMOTE_REF_VERIFIED_RAW_FILE_DOWNLOAD_NOT_RUN";
  } else r.status = "PASS_ANDROID_INCREMENT_FUNCTIONS_CLEANUP_LOGS_UNRESOLVED_GOAL_ACTIVE";
})().catch(e => { r.status = r.commit && !r.pushSucceeded ? "BLOCKED_QA_LOCAL_COMMIT_REMOTE_DELIVERY_UNVERIFIED" : "FAILED";
  r.error = e.stack; process.exitCode = 1;
}).finally(() => {
  r.after = state(); assert.deepEqual(r.after, r.before);
  r.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: r.status, checks: r.checks.length,
    cleanupTotal: r.cleanupTotal, commit: r.commit, pushSucceeded: r.pushSucceeded, error: r.error, output }));
});
