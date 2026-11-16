"use strict";
// Read-only terminal audit after installation trees have been removed.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"),
  assert = require("node:assert/strict");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const root = path.resolve(__dirname, ".."), base = "F:/testavn/Windows-Isolated-1983-20261116-02";
const prior = "F:/testavn/Windows-Isolated-1983-20261116-01";
const release = "F:/testavn/Editor-Save-Guard-Release-1983-20261116-01";
const output = path.join(base, process.argv.includes("--followup") ? "terminal-audit-02.json" : "terminal-audit.json");
assert(!fs.existsSync(output), "Preserve previous terminal evidence");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], inputs: [],
  productLaunches: 0, builds: 0, modelRequests: 0, deletedFiles: 0 };
function input(file) { report.inputs.push({ path: file, sha256: sha(file) }); return read(file); }
function verify(file) { assert.equal(sha(file.path), file.sha256, file.path); }
function group(name, action) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
}
try {
  const audit = input(path.join(base, "functional-audit.json"));
  const cleanup = input(path.join(base, "artifact-cleanup.json"));
  const checkpoint = input(path.join(release, "checkpoint.json"));
  const build = input(path.join(release, "release/build.json"));
  group("functional-results-and-original-evidence-retained", () => {
    assert.equal(audit.status, "PASS"); assert.equal(audit.groups.length, 5);
    assert(audit.groups.every(row => row.status === "PASS"));
    for (const file of audit.inputs) verify(file);
    const run = input(path.join(base, "resource-01/report.json"));
    assert.equal(run.status, "PASS"); assert.equal(run.stages.length, 9);
    assert(run.stages.every(row => row.status === "PASS"));
    assert.equal(input(path.join(prior, "resource-01/report.json")).status, "RUNNING");
    assert.equal(input(path.join(prior, "account-retirement-01.json")).status, "FAILED");
    assert.equal(input(path.join(release, "seal-01-failure.json")).status, "FAILED");
    return { installedStages: 9, priorQaAbortAndOriginalFailuresPreserved: true };
  });
  group("exact-generated-trees-removed-and-source-archives-valid", () => {
    assert.equal(cleanup.status, "PASS"); assert.equal(cleanup.targets.length, 7);
    assert.equal(cleanup.historicalRejectedScopesTouched, false);
    assert.equal(cleanup.physicalFreedBytes, "NOT_MEASURED");
    for (const target of cleanup.targets) {
      assert(target.removed); assert(!fs.existsSync(target.path), target.path);
    }
    for (const file of cleanup.retained) verify(file);
    assert.equal(cleanup.archives.length, 2);
    for (const archive of cleanup.archives) {
      verify(archive); const manifest = input(archive.path);
      assert.equal(manifest.status, "PASS"); assert.equal(manifest.files.length, 271);
      for (const file of manifest.files) verify(file);
    }
    return { trees: 7, archivedSourceFilesPerRun: 271, files: cleanup.files,
      logicalBytes: cleanup.logicalBytes, physicalFreedBytes: "NOT_MEASURED" };
  });
  group("retired-qa-identities-owned-processes-and-ports-absent", () => {
    const script = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      "$dirs=@('F:\\testavn\\Windows-Isolated-1983-20261116-01','F:\\testavn\\Windows-Isolated-1983-20261116-02')",
      "$users=@(Get-CimInstance Win32_UserAccount -Filter \"LocalAccount=True\")",
      "$profiles=@(Get-CimInstance Win32_UserProfile)",
      "$live=@(Get-CimInstance Win32_Process)",
      "$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)",
      "$rows=@()",
      "foreach($dir in $dirs){",
      "$controller=Get-Content -LiteralPath ($dir+'\\account-controller.json') -Raw|ConvertFrom-Json",
      "$retirementFile=if($dir.EndsWith('-01')){'aborted-qa-retirement-02.json'}else{'account-retirement-01.json'}",
      "$retired=Get-Content -LiteralPath ($dir+'\\'+$retirementFile) -Raw|ConvertFrom-Json",
      "if(!$retired.account.profile -or $retired.account.sid -cne $controller.account.sid){throw 'Missing or conflicting identity'}",
      "$run=Get-Content -LiteralPath ($dir+'\\resource-01\\report.json') -Raw|ConvertFrom-Json",
      "$owned=@();foreach($record in $run.editorKnown){$owned+=@($live|Where-Object{$_.ProcessId -eq $record.ProcessId -and $_.CreationDate.ToUniversalTime().ToString('o') -ceq $record.Created})}",
      "$ports=@($run.launches|ForEach-Object{$_.ports})",
      "$rows+=@{sid=$retired.account.sid;accountPresent=@($users|Where-Object SID -CEQ $retired.account.sid).Count;profilePresent=@($profiles|Where-Object SID -CEQ $retired.account.sid).Count;directoryPresent=(Test-Path -LiteralPath $retired.account.profile);ownedProcesses=$owned.Count;listeners=@($listeners|Where-Object LocalPort -In $ports).Count}",
      "}",
      "ConvertTo-Json -InputObject @($rows) -Depth 5"
    ].join("\n");
    const rows = JSON.parse(cp.execFileSync("powershell.exe", ["-NoProfile", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8", windowsHide: true, timeout: 45000 }));
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.accountPresent, 0); assert.equal(row.profilePresent, 0);
      assert.equal(row.directoryPresent, false); assert.equal(row.ownedProcesses, 0);
      assert.equal(row.listeners, 0);
    }
    return rows;
  });
  group("delivered-installer-workspace-dev-and-protected-user-scope", () => {
    for (const file of [build.installer, build.dev, build.player, build.backend,
      checkpoint.daily, checkpoint.frozen.installer, checkpoint.frozen.player,
      checkpoint.git.index, ...checkpoint.sources]) verify(file);
    const head = cp.execFileSync("git", ["rev-parse", "HEAD"],
      { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    assert.equal(head, checkpoint.git.head);
    assert.equal(build.version, "1.9.83"); assert.equal(build.nativePlayerBuilds, 0);
    return { version: build.version, runtime: "0.32", userDailyAndRealHeadIndexUnchanged: true };
  });
  group("agreed-scope-and-honest-acceptance-boundaries", () => {
    const scope = input("F:/testavn/Goal-Scope-Audit-20261116-01/report.json");
    assert.deepEqual(scope.rows.map(row => row.id), ["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08"]);
    for (const file of scope.inputs) verify(file);
    return { currentScope: "T01_T08_FUNCTIONAL_DELIVERY_PLUS_SAVE_GUARD",
      sourceChecks: { direct: 21, browser: 8, persistence: 22, actualProjectLayout: 18 },
      installedScope: "1920x1080_DPR1_NORMAL_DEFAULT_QA_PROFILE_02",
      fault: "Explicit_HTTP503_not_natural_disk_failure",
      android: "Inherited_API35_embedded_game_evidence_no_new_device_run",
      originalLossRootCause: "NOT_REPRODUCED",
      physicalPhoneAndHistoricalForensics: "IGNORED_THIS_BATCH_BY_USER_NOT_FIXED",
      pureMotion: "DEFERRED_BY_USER", notAllHistoricalFailuresResolved: true };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.map(({ name, status }) =>
    ({ name, status })), error: report.error }));
}
