"use strict";
// Publish only this reviewed source delta using a separate index.
// Frozen releases, user data and previously refused cleanup scopes stay intact.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { scan } = require("./git-content-inventory.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, "..");
const base = "F:/testavn/Editor-Timeline-Revision-20261116-01";
const history = "F:/testavn/Editor-History-Feedback-20261116-01";
const parent = "49c85b472bc13c085453eaf301cd3737b97eb8a9";
const branch = "codex/editor-autosave-recovery-20261116";
const mode = process.argv[2]; assert.equal(process.argv.length, 3);
assert(["--publish", "--audit"].includes(mode));
const files = ["editor/src/components/editor/GraphHistoryShortcuts.tsx", "editor/src/utils/graphHistoryDescription.ts",
  "editor/src/components/timeline/ProjectTimelinePanel.tsx", "editor/src/utils/editorProjectPersistence.ts",
  "scripts/editor-history-feedback-playwright.cjs", "scripts/editor-history-description-test.cjs",
  "scripts/editor-project-persistence-test.cjs", "scripts/editor-timeline-revision-playwright.cjs",
  "scripts/editor-event-operation-boundaries-playwright.cjs", "scripts/editor-history-timeline-delivery.cjs"];
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const describe = file => ({ path: file, sha256: sha(file) });
const normalized = text => text.replaceAll("\r\n", "\n");
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const output = path.join(base, mode === "--publish" ? "source-delivery-01.json" : "terminal-audit-01.json");
assert(!fs.existsSync(output), "Keep prior results immutable");
const report = { status: "RUNNING", mode, at: new Date().toISOString(), parent, branch, checks: [], files: [],
  before: state(), scope: "SOURCE_HISTORY_FEEDBACK_AND_TIMELINE_CONFIRMED_REVISION_NOT_INSTALLED",
  nativeBuilds: 0, installations: 0, models: 0, computerUse: false };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function check(name, action) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); }
}
function cases(directory, count, browser = false) {
  const file = path.join(directory, "report.json"), value = read(file);
  assert.equal(value.status, "PASS", file); assert.equal(value.cases.length, count);
  assert(value.cases.every(row => row.status === "PASS"));
  if (browser) { assert.deepEqual(value.errors, []); assert.equal(value.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED"); }
  return describe(file);
}
(async () => {
  check("final source behavior, recovery persistence and autosave compatibility", () => {
    const results = [
      cases(path.join(history, "after-es2020-03"), 5, true),
      cases(path.join(history, "description-es2020-02"), 16),
      cases(path.join(base, "persistence-final-03"), 22),
      cases(path.join(base, "autosave-final-02"), 13),
      cases(path.join(base, "browser-final-02"), 5, true),
      cases(path.join(base, "events-followup-04"), 2, true),
    ];
    for (const directory of [path.join(history, "after-es2020-03"), path.join(base, "browser-final-02"),
      path.join(base, "events-followup-04")]) {
      for (const source of read(path.join(directory, "report.json")).sources)
        assert.equal(sha(source.source), source.sha256);
    }
    const events = read(path.join(base, "events-compat-01/report.json"));
    assert.equal(events.status, "FAILED"); assert.equal(events.cases.length, 14);
    assert(events.cases.slice(0, 12).every(row => row.status === "PASS"));
    return { results, earlier12EventCases: describe(path.join(base, "events-compat-01/report.json")),
      sourceScopeOnly: true };
  });
  check("actual DPR matrix and original functional/QA failures retained", () => {
    const first = read(path.join(history, "after-01/report.json"));
    const second = read(path.join(history, "after-dpr2-02/report.json"));
    const geometry = [...first.cases.filter(row => row.status === "PASS" && row.actual), ...second.cases];
    assert.equal(geometry.length, 12);
    assert.equal(new Set(geometry.map(row => `${row.actual.width}:${row.actual.height}:${row.actual.dpr}:${row.actual.reduced}`)).size, 12);
    for (const row of geometry) assert.equal(row.status, "PASS");
    assert.equal(read(path.join(history, "before-01/report.json")).status, "FAILED");
    const original = read(path.join(base, "browser-before-02/report.json"));
    assert.equal(original.status, "FAILED");
    assert(original.cases.slice(0, 4).every(row => row.status === "FAILED" && row.error.includes("cannot replace")));
    const persistence = read(path.join(base, "persistence-before-01/report.json"));
    assert.equal(persistence.status, "FAILED"); assert.equal(persistence.cases.filter(c => c.status === "FAILED").length, 5);
    assert.equal(read(path.join(base, "persistence-after-01/report.json")).status, "FAILED");
    assert.equal(read(path.join(base, "events-followup-02/report.json")).status, "FAILED");
    assert.equal(read(path.join(base, "events-followup-03/report.json")).status, "FAILED");
    return { combinations: geometry.map(c => c.actual), ordinaryReducedTimingClaims: false,
      beforeBrowser: describe(path.join(base, "browser-before-02/report.json")) };
  });
  check("original checkpoints, daily Dev, frozen NSIS and real checkout unchanged", () => {
    for (const [directory, relatives] of [
      [path.join(history, "before-01"), ["editor/src/components/editor/GraphHistoryShortcuts.tsx"]],
      [path.join(base, "browser-before-02"), ["editor/src/utils/editorProjectPersistence.ts",
        "editor/src/components/timeline/ProjectTimelinePanel.tsx"]],
    ]) for (const relative of relatives)
      assert.equal(normalized(fs.readFileSync(path.join(directory, "sources", relative), "utf8")),
        normalized(git(["show", `${parent}:${relative}`])));
    assert.equal(read(path.join(root, "editor/package.json")).version, "1.9.79");
    const release = read("F:/testavn/Editor-Event-Release-1979-20261116-01/release/build.json");
    for (const artifact of [release.dev, release.installer, release.player]) assert.equal(sha(artifact.path), artifact.sha256);
    const checkpoint = read("F:/testavn/Editor-Event-Release-1979-20261116-01/checkpoint.json");
    assert.equal(sha(checkpoint.daily.path), checkpoint.daily.sha256);
    assert.equal(report.before.head, checkpoint.head); assert.equal(report.before.indexSha256, checkpoint.index.sha256);
    return { version: "1.9.79", delta: "SOURCE_ONLY", daily: checkpoint.daily, installer: release.installer };
  });
  check("final source gates have logs and successful tool exit observations", () => {
    const gates = read(path.join(base, "gates-observed.json"));
    assert.equal(gates.status, "PASS_TOOL_OBSERVED_NOT_NATIVE_RELEASE");
    assert.equal(gates.commands.length, 2); assert(gates.commands.every(c => c.exitCode === 0));
    for (const command of gates.commands) assert.equal(sha(command.log.path), command.log.sha256);
    return { receipt: describe(path.join(base, "gates-observed.json")), commands: gates.commands };
  });
  if (mode === "--publish") {
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"));
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const bytes = fs.readFileSync(path.join(root, relative));
      assert.equal(scan(bytes.toString("utf8")).length, 0, "Review possible credential: " + relative);
      if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      report.files.push({ relative, sha256: hash(bytes) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), [...files].sort());
    report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], { input:
      "Preserve edits made after timeline confirmation and describe undo actions\n\nFence backup reads and the initial restore save to the confirmed project revision. If an earlier save was submitted, persist the newer content without applying the restore. Accept unchanged JSON settings normalization and our own materialized assets. Describe undo with scene names and event indices; report empty history while preserving native text undo. Add failing and passing browser/store regressions. Source-only: no frozen package or daily Dev replacement; preserve actual checkout and index.\n",
    }).trim();
    save(); report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    for (let i = 0; i < report.files.length; i += 4) {
      await Promise.all(report.files.slice(i, i + 4).map(async file => {
        const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
          { signal: AbortSignal.timeout(30000) });
        assert(response.ok, "Remote HTTP " + response.status);
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
      })); save();
    }
  } else {
    check("pushed source bytes agree with current files", () => {
      const delivery = read(path.join(base, "source-delivery-01.json"));
      assert.equal(delivery.status, "PASS"); assert.equal(delivery.files.length, files.length);
      assert(delivery.files.every(f => f.remotelyVerified)); assert.deepEqual(delivery.before, delivery.after);
      for (const file of delivery.files) assert.equal(sha(path.join(root, file.relative)), file.sha256);
      report.commit = delivery.commit; return { commit: delivery.commit, files: delivery.files.length };
    });
    check("owned source browser services and ports stopped; refused scopes untouched", () => {
      const directories = [
        ...["before-01", "after-01", "after-dpr2-02", "after-es2020-03"].map(n => path.join(history, n)),
        ...["browser-before-01", "browser-before-02", "browser-after-01", "browser-final-02",
          "events-compat-01", "events-followup-02", "events-followup-03", "events-followup-04"].map(n => path.join(base, n)),
      ];
      const services = directories.map(directory => {
        const value = read(path.join(directory, "report.json"));
        assert.equal(value.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED"); return value.service;
      });
      const pids = [...new Set(services.flatMap(s => [s.backendPid, s.vitePid]))];
      const ports = [...new Set(services.flatMap(s => [new URL(s.url).port, new URL(s.backendUrl).port]).map(Number))];
      const observed = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
        `@{processes=@(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue|Select-Object Id,ProcessName);` +
        `ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @(${ports.join(",")})` +
        "|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 }).replace(/^\uFEFF/, ""));
      assert.deepEqual(observed.processes, []); assert.deepEqual(observed.ports, []);
      const emptyTempDirectories = directories.filter(directory => {
        const temporary = path.join(directory, "temp");
        assert(fs.lstatSync(temporary).isDirectory() && !fs.lstatSync(temporary).isSymbolicLink());
        assert.deepEqual(fs.readdirSync(temporary), []); return true;
      }).length;
      return { observed, pids, ports, emptyTempDirectories, deletedFiles: 0, oldRefusedProfilesTouched: false };
    });
  }
  report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, checks: report.checks.length, output, error: report.error })); });
