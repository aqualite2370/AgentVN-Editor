"use strict";
// Independent followup: preserve the original auditor's PID-reuse failure.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Editor-Timeline-Revision-20261116-01";
const history = "F:/testavn/Editor-History-Feedback-20261116-01";
const output = path.join(base, "terminal-audit-02.json");
assert.equal(process.argv.length, 2); assert(!fs.existsSync(output));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const result = { status: "RUNNING", scope: "INDEPENDENT_SOURCE_DELIVERY_AND_SERVICE_RETIREMENT_FOLLOWUP",
  at: new Date().toISOString(), checks: [], productRestarts: 0, builds: 0, models: 0 };
function check(name, action) {
  const row = { name, status: "RUNNING" }; result.checks.push(row);
  try { row.detail = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
}
try {
  const original = read(path.join(base, "terminal-audit-01.json"));
  const delivery = read(path.join(base, "source-delivery-01.json"));
  check("five original evidence checks passed; original process-observer failure retained", () => {
    assert.equal(original.status, "FAILED"); assert.equal(original.checks.length, 6);
    assert(original.checks.slice(0, 5).every(row => row.status === "PASS"));
    assert.equal(original.checks[5].status, "FAILED"); assert(original.error.includes("51736"));
    assert.equal(delivery.status, "PASS"); assert.equal(delivery.files.length, 10);
    for (const file of delivery.files) { assert(file.remotelyVerified); assert.equal(sha(path.join(root, file.relative)), file.sha256); }
    return { original: { path: path.join(base, "terminal-audit-01.json"), sha256: sha(path.join(base, "terminal-audit-01.json")) },
      sourceCommit: delivery.commit, allOriginalFailuresPreserved: true };
  });
  check("source services and ports retired; every live PID attributed before interpretation", () => {
    const directories = [
      ...["before-01", "after-01", "after-dpr2-02", "after-es2020-03"].map(n => path.join(history, n)),
      ...["browser-before-01", "browser-before-02", "browser-after-01", "browser-final-02",
        "events-compat-01", "events-followup-02", "events-followup-03", "events-followup-04"].map(n => path.join(base, n)),
    ];
    const reports = directories.map(d => read(path.join(d, "report.json")));
    assert(reports.every(r => r.cleanup === "OWNED_BROWSER_AND_SERVICES_STOPPED"));
    const pids = [...new Set(reports.flatMap(r => [r.service.backendPid, r.service.vitePid]))];
    const ports = [...new Set(reports.flatMap(r => [new URL(r.service.url).port, new URL(r.service.backendUrl).port]).map(Number))];
    const observation = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `@{observerPid=$PID;at=[DateTime]::UtcNow.ToString('o');processes=@(Get-CimInstance Win32_Process|` +
      `Where-Object ProcessId -In @(${pids.join(",")})|Select-Object ProcessId,Name,ExecutablePath,CommandLine,` +
      "@{n='created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});" +
      `ports=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object LocalPort -In @(${ports.join(",")})` +
      "|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Compress -Depth 5"],
    { encoding: "utf8", windowsHide: true, timeout: 20000 }).replace(/^\uFEFF/, ""));
    assert.deepEqual(observation.ports, []);
    for (const current of observation.processes) {
      const originalRuns = reports.filter(r => [r.service.backendPid, r.service.vitePid].includes(current.ProcessId));
      assert(originalRuns.every(r => Date.parse(current.created) > Date.parse(r.finishedAt)),
        "Any live earlier process needs investigation; never stop it by PID alone");
      assert(!current.CommandLine.includes("owned-vite-server.cjs"));
      assert(!current.CommandLine.includes("creator_backend"));
    }
    for (const directory of directories) {
      const target = path.join(directory, "temp");
      assert(fs.lstatSync(target).isDirectory() && !fs.lstatSync(target).isSymbolicLink());
      assert.equal(fs.readdirSync(target).length, 0);
    }
    return { observation, processesStopped: 0, emptyTemps: directories.length, filesDeleted: 0,
      reusedPidHandling: "Only a demonstrably later creation is unrelated; no process killed", oldRefusedProfilesTouched: false };
  });
  check("real HEAD/index, daily Dev and frozen 1979 package still match", () => {
    const git = args => cp.execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    assert.equal(git(["rev-parse", "HEAD"]), delivery.before.head);
    assert.equal(sha(path.resolve(root, git(["rev-parse", "--git-path", "index"]))), delivery.before.indexSha256);
    const checkpoint = read("F:/testavn/Editor-Event-Release-1979-20261116-01/checkpoint.json");
    const release = read("F:/testavn/Editor-Event-Release-1979-20261116-01/release/build.json");
    for (const artifact of [checkpoint.daily, release.dev, release.installer]) assert.equal(sha(artifact.path), artifact.sha256);
    return { sourceOnly: true, checkout: delivery.before, nativeProductsChanged: 0 };
  });
  result.status = "PASS_SOURCE_HISTORY_AND_CONFIRMED_TIMELINE_REVISION_NOT_INSTALLED";
} catch (error) { result.status = "FAILED"; result.error = error.stack; process.exitCode = 1; }
result.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(result, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: result.status, checks: result.checks.length, output, error: result.error }));
