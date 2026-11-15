"use strict";
// Publish only the reviewed event/timeline delta, preserving the real index.
// Audit never removes browser profiles or nonempty directories.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { scan } = require("./git-content-inventory.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-Event-Boundaries-20261116-01";
const mode = process.argv[2]; assert(["--publish", "--audit"].includes(mode)); assert.equal(process.argv.length, 3);
const parent = "03ee3b1efedcd75cc069fb7d38e4fe4edff5b2ca";
const branch = "codex/editor-autosave-recovery-20261116";
const product = ["editor/src/components/command-editors/CommandListEditor.tsx",
  "editor/src/components/editor/InspectorPanel.tsx", "editor/src/components/timeline/ProjectTimelinePanel.tsx"];
const files = [...product, "scripts/editor-event-operation-boundaries-playwright.cjs",
  "scripts/editor-event-boundaries-delivery.cjs"];
const reports = ["before-01", "before-02", "after-01", "after-02", "after-complete-01", "after-complete-02", "recovery-01"];
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" };
const git = (args, options = {}) => cp.execFileSync("git", ["-c", "core.autocrlf=false", ...args],
  { cwd: root, env, encoding: "utf8", windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...options });
const state = () => ({ head: git(["rev-parse", "HEAD"]).trim(),
  indexSha256: sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]).trim())) });
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const normalized = text => text.replaceAll("\r\n", "\n");
const output = path.join(base, mode === "--publish" ? "source-delivery-01.json" : "terminal-audit-01.json");
assert(!fs.existsSync(output), "Preserve every original result");
const report = { status: "RUNNING", at: new Date().toISOString(), mode, parent, branch, before: state(),
  scope: "SOURCE_EVENT_ORDER_AND_TIMELINE_OWNERSHIP_NOT_NATIVE_DEV_INSTALLER_OR_ORIGINAL_NATURAL_LOSS",
  checks: [], files: [], cleanup: [], nativeBuilds: 0, installations: 0, models: 0 };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); }
}
function verifyResults() {
  const entries = [];
  for (const [directory, count] of [["after-complete-02", 14], ["recovery-01", 5], ["persistence-01", 15]]) {
    const file = path.join(base, directory, "report.json"), result = read(file);
    assert.equal(result.status, "PASS"); assert.equal(result.cases.length, count);
    assert(result.cases.every(c => c.status === "PASS"));
    if (directory !== "persistence-01") {
      assert.deepEqual(result.errors, []); assert.equal(result.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED");
      for (const source of result.sources || []) assert.equal(sha(source.source), source.sha256);
    }
    entries.push({ path: file, sha256: sha(file), cases: count });
  }
  return entries;
}
(async () => {
  check("14 event/timeline browser, five normal recovery and 15 persistence checks", verifyResults);
  check("source gates observed with explicit native release boundary", () => {
    const receipt = read(path.join(base, "gates-observed.json"));
    assert.equal(receipt.status, "PASS_TOOL_OBSERVED_SOURCE_BUILD_NOT_NATIVE_RELEASE");
    assert.equal(receipt.commands.length, 2); assert(receipt.commands.every(c => c.exitCode === 0));
    assert.equal(receipt.nativeDevBuilds, 0); assert.equal(receipt.installerBuilds, 0);
    return { path: path.join(base, "gates-observed.json"), sha256: sha(path.join(base, "gates-observed.json")),
      stdoutBoundary: receipt.provenance, warnings: receipt.commands[1].warnings };
  });
  check("checkpoint source matches delivered parent, frozen packages and daily Dev preserved", () => {
    for (const relative of product) {
      assert.equal(normalized(fs.readFileSync(path.join(base, "before-02/sources", relative), "utf8")),
        normalized(git(["show", `${parent}:${relative}`])));
    }
    const previous = read("F:/testavn/Editor-Graph-Release-1978-20261116-01/release/build.json");
    assert.equal(previous.version, "1.9.78");
    for (const file of [previous.installer, previous.dev]) assert.equal(sha(file.path), file.sha256);
    const checkpoint = read("F:/testavn/Editor-Graph-Release-1978-20261116-01/checkpoint.json");
    assert.equal(sha(checkpoint.daily.path), checkpoint.daily.sha256);
    assert.equal(read(path.join(root, "editor/package.json")).version, "1.9.78");
    return { installer: previous.installer.sha256, worktreeDev: previous.dev.sha256, dailyDev: checkpoint.daily.sha256,
      highestCurrentFrozenVersion: previous.version, newDelta: "SOURCE_ONLY" };
  });
  if (mode === "--publish") {
    assert.equal(git(["remote", "get-url", "origin"]).trim(), "https://github.com/aqualite2370/AgentVN-Editor.git");
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(parent + "\t"), "Preserve concurrent remote updates");
    const alternate = { ...env, GIT_INDEX_FILE: path.join(base, "event-delivery.index") };
    assert(!fs.existsSync(alternate.GIT_INDEX_FILE)); git(["read-tree", parent], { env: alternate });
    for (const relative of files) {
      const bytes = fs.readFileSync(path.join(root, relative));
      assert.equal(scan(bytes.toString("utf8")).length, 0, "Review potential credential: " + relative);
      if (relative.endsWith(".cjs")) cp.execFileSync(process.execPath, ["--check", path.join(root, relative)], { windowsHide: true });
      const blob = git(["hash-object", "-w", "--stdin"], { input: bytes }).trim();
      git(["update-index", "--add", "--cacheinfo", `100644,${blob},${relative}`], { env: alternate });
      report.files.push({ relative, sha256: hash(bytes) });
    }
    const tree = git(["write-tree"], { env: alternate }).trim();
    assert.deepEqual(git(["diff-tree", "--no-commit-id", "--name-only", "-r", parent, tree]).trim().split("\n").sort(), [...files].sort());
    report.commit = git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", parent], {
      input: "Commit event reorder on release and isolate timeline restore ownership\n\nSeparate the event edit from decorative landing callbacks so saves, undo and subsequent changes never lose data. Cancel invalid held drags and isolate command editing by scene and project generation. Give each timeline restoration its own operation token so an old project neither blocks nor unlocks another project. Add full editor/real isolated backend regression coverage for input, save/reopen and controlled timing boundaries. This source-only delta is not a new installed release or proof of the user's original natural-loss incident. Preserve checkout HEAD and index.\n",
    }).trim();
    save();
    report.push = git(["push", "origin", `${report.commit}:refs/heads/${branch}`]); save();
    assert(git(["ls-remote", "--heads", "origin", branch]).startsWith(report.commit + "\t"));
    await Promise.all(report.files.map(async file => {
      const response = await fetch(`https://raw.githubusercontent.com/aqualite2370/AgentVN-Editor/${report.commit}/${file.relative}`,
        { signal: AbortSignal.timeout(30000) });
      assert(response.ok, "Remote source HTTP " + response.status);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256); file.remotelyVerified = true;
    }));
    report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS";
  } else {
    check("original failures remain; QA corrections never rewrite product outcomes", () => {
      const early = read(path.join(base, "before-01/report.json")), original = read(path.join(base, "before-02/report.json"));
      assert.equal(early.status, "FAILED"); assert.equal(original.status, "FAILED");
      assert.equal(original.cases.length, 11);
      assert(original.cases[1].error.includes("400")); assert(original.cases[2].status === "FAILED");
      assert(original.cases.at(-1).status === "FAILED");
      const firstFixed = read(path.join(base, "after-01/report.json"));
      assert.equal(firstFixed.status, "FAILED");
      assert.equal(read(path.join(base, "after-02/report.json")).cases.at(-1).status, "FAILED");
      return { original: sha(path.join(base, "before-02/report.json")),
        qaCorrections: ["Unambiguous input selector", "Read source coordinates after target scroll",
          "Wait for confirmation closure", "Await actual state/read/generation instead of assuming readiness"],
        originalNaturalLoss: "NOT_REPRODUCED" };
    });
    check("new source pushed with real checkout and index unchanged", () => {
      const delivery = read(path.join(base, "source-delivery-01.json"));
      assert.equal(delivery.status, "PASS"); assert.equal(delivery.files.length, files.length);
      assert(delivery.files.every(f => f.remotelyVerified)); assert.deepEqual(delivery.before, delivery.after);
      assert.deepEqual(state(), delivery.before);
      for (const item of delivery.files) assert.equal(sha(path.join(root, item.relative)), item.sha256);
      return { commit: delivery.commit, files: delivery.files.length, originalHead: delivery.before.head };
    });
    check("all owned browser/backend/server processes and ports exited", () => {
      const services = reports.map(name => read(path.join(base, name, "report.json")).service).filter(Boolean);
      assert.equal(services.length, reports.length);
      const pids = [...new Set(services.flatMap(s => [s.backendPid, s.vitePid]))];
      const ports = [...new Set(services.flatMap(s => [new URL(s.url).port, new URL(s.backendUrl).port]).map(Number))];
      const command = `@{processes=@(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue|Select-Object Id,ProcessName);` +
        `ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @(${ports.join(",")})` +
        `|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4 -Compress`;
      const observed = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
        { encoding: "utf8", windowsHide: true, timeout: 20000 }).replace(/^\uFEFF/, ""));
      assert.deepEqual(observed.processes, []); assert.deepEqual(observed.ports, []);
      for (const name of reports) {
        const result = read(path.join(base, name, "report.json"));
        assert.equal(result.cleanup, "OWNED_BROWSER_AND_SERVICES_STOPPED");
      }
      return { processIds: pids, ports, observed };
    });
    check("screenshot dimensions and empty temporary directories only", () => {
      const result = read(path.join(base, "after-complete-02/report.json"));
      const capture = result.cases.at(-1).capture, png = fs.readFileSync(capture.path);
      assert.equal(sha(capture.path), capture.sha256);
      assert.equal(png.readUInt32BE(16), capture.viewport.width * capture.viewport.dpr);
      assert.equal(png.readUInt32BE(20), capture.viewport.height * capture.viewport.dpr);
      for (const name of reports.filter(n => n !== "recovery-01")) {
        const target = path.resolve(base, name, "temp");
        for (const directory of [path.resolve(base), path.resolve(base, name), target]) {
          const item = fs.lstatSync(directory); assert(item.isDirectory() && !item.isSymbolicLink());
          assert.equal(fs.realpathSync(directory), directory);
        }
        assert.deepEqual(fs.readdirSync(target), [], "Do not broaden cleanup into nonempty directories");
        fs.rmdirSync(target);
        report.cleanup.push({ target, removed: !fs.existsSync(target), files: 0, logicalBytes: 0 });
      }
      return { capture, noBrowserProfilesDeleted: true, physicalDiskReclaimClaim: false };
    });
    report.after = state(); assert.deepEqual(report.after, report.before); report.status = "PASS_SOURCE_EVENT_AND_TIMELINE_BOUNDARIES";
  }
})().catch(error => {
  report.status = "FAILED"; report.error = error.stack; report.after = state(); process.exitCode = 1;
}).finally(() => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, commit: report.commit, output, checks: report.checks.length, error: report.error }));
});
