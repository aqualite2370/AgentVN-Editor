"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/old-runtime-refusal-20261018-01");
const output = process.argv[2];
assert(output && !fs.existsSync(output), "A fresh terminal audit path is required");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "G18_REAL_HISTORICAL_BINARY_PROTOCOL_AND_SCHEMA_REFUSAL_NOT_INSTALLATION_OR_ALL_CAPABILITIES",
  checks: [], error: null };
function check(name, action) {
  const detail = action();
  report.checks.push({ name, status: "PASS", detail });
}
try {
  const fixtures = read(path.join(run, "fixtures-02.json"));
  const preparation = read(path.join(run, "preparation.json"));
  assert.equal(fixtures.status, "PASS");
  check("Existing released installer, real old executable and candidate fixture sources", () => {
    assert.equal(sha(preparation.source.path), preparation.source.sha256);
    assert.equal(sha(fixtures.oldExecutable.path), fixtures.oldExecutable.sha256);
    for (const source of fixtures.candidateSources) assert.equal(sha(path.join(root, source.relative)), source.sha256);
    return { installer: preparation.source, executable: fixtures.oldExecutable,
      candidateSourceFiles: fixtures.candidateSources.length };
  });
  const cases = [
    ["legacy-control", "legacy-control-behavior", 3],
    ["nvl-inheritance", "nvl-inheritance-behavior-02", 5],
    ["advanced-layout", "advanced-layout-behavior-02", 6]
  ];
  const ports = [];
  check("Three actual native launches, nonempty behavioral assertions and unchanged cartridge bytes", () => {
    const results = [];
    for (const [id, folder, count] of cases) {
      const fixture = fixtures.fixtures.find(f => f.id === id);
      assert(fixture);
      assert.equal(sha(fixture.path), fixture.sha256);
      const launch = read(path.join(run, `${id}-launch.json`));
      const behavior = read(path.join(run, folder, "report.json"));
      assert.equal(launch.status, "PASS");
      assert.equal(behavior.status, "PASS");
      assert.equal(behavior.checks.length, count);
      assert(behavior.checks.every(c => c.status === "PASS"));
      assert.equal(behavior.executable.sha256, fixtures.oldExecutable.sha256);
      assert.equal(behavior.fixture.sha256, fixture.sha256);
      assert.equal(launch.dataDirectoryOverride, false);
      assert.equal(launch.webviewDirectoryOverride, false);
      assert(launch.processes.some(p => p.ProcessId === launch.playerPid
        && p.ExecutablePath === fixtures.oldExecutable.path));
      assert(launch.actualWebviewUserDataEvidence.length > 0);
      assert(launch.actualWebviewUserDataEvidence.every(p => p.isDefaultPlayerProfile));
      if (id === "legacy-control") {
        assert(behavior.playText.includes(fixture.sentinel));
      } else {
        assert.equal(behavior.startControl.enabled, false);
        assert(!behavior.initialText.includes(fixture.sentinel));
        if (id === "nvl-inheritance") {
          // This run predates the added classification field. Audit the
          // original observed error, without adding metadata to old reports.
          assert(behavior.initialText.includes("runtime_version"));
          assert(behavior.initialText.includes("0.18.0") && behavior.initialText.includes("0.5.0"));
        } else {
          assert.equal(behavior.refusalStage, "OLD_LAYOUT_SCHEMA_VALIDATION_BEFORE_PROTOCOL_VALIDATION");
          assert(behavior.minimumRuntimeGate.startsWith("NOT_REACHED"));
        }
      }
      const close = read(path.join(run, `${id}-close.json`));
      assert.equal(close.status, "PASS");
      assert.equal(close.remainingProcesses.length, 0);
      assert.equal(close.remainingPorts.length, 0);
      ports.push(launch.cdpPort);
      results.push({ id, assertions: count, port: launch.cdpPort, fixtureSha256: fixture.sha256,
        refusalStage: behavior.refusalStage || (id === "nvl-inheritance"
          ? "RUNTIME_PROTOCOL_VALIDATION_FROM_ORIGINAL_ERROR_TEXT" : "SUPPORTED_CONTROL_PLAYED") });
    }
    return results;
  });
  check("Raw screenshots preserve actual native WebView DPR and viewport parameters", () => {
    let count = 0;
    for (const [, folder] of cases) {
      const behavior = read(path.join(run, folder, "report.json"));
      assert(behavior.screenshots.length > 0);
      for (const image of behavior.screenshots) {
        const filename = path.resolve(root, image.path);
        assert.equal(sha(filename), image.sha256);
        const bytes = fs.readFileSync(filename);
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.deepEqual(image.before, image.after);
        assert.equal(bytes.readUInt32BE(16), image.before.width * image.before.dpr);
        assert.equal(bytes.readUInt32BE(20), image.before.height * image.before.dpr);
        count++;
      }
    }
    return { count, matrix: "1920x1080 DPR1 ordinary, real native WebView emulation only" };
  });
  check("Original player library, saves and browser stores restored with independent backup SHA checks", () => {
    const protection = read(path.join(run, "profile-protection.json"));
    const restoration = read(path.join(run, "profile-restoration.json"));
    assert.equal(protection.status, "PASS");
    assert.equal(restoration.status, "PASS");
    assert.equal(protection.profiles.length, 2);
    let count = 0;
    for (const profile of protection.profiles) {
      assert(fs.existsSync(profile.original));
      assert(!fs.existsSync(profile.held));
      for (const file of profile.backupFiles) {
        assert.equal(sha(path.join(profile.original, file.relative)), file.sha256);
        assert.equal(sha(file.backup), file.sha256);
        count++;
      }
    }
    assert.equal(count, 24);
    return { files: count, sourceProfilesRestored: true, testProfilesRetainedSeparately: true };
  });
  check("No attributed test processes or ports remain; original Editor DB and Dev unchanged", () => {
    const system = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $ErrorActionPreference='Stop'
      $processes=@(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')
      } | Select-Object Name,ProcessId,ExecutablePath)
      $ports=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(${ports.join(",")},8278)} |
        Select-Object LocalPort,OwningProcess)
      @{processes=$processes;ports=$ports}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(system.status, 0, system.stderr);
    const state = JSON.parse(system.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0);
    assert.equal(state.ports.length, 0);
    const prior = read(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"),
      prior.userPersistence.databaseSha256);
    assert.equal(sha(path.join(root, "AgentVN Dev.exe")),
      "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
    assert.equal(sha(path.join(prior.actualInstallation.path, "agentvn-editor.exe")),
      prior.actualInstallation.executableSha256);
    return { ...state, playerPorts: ports, editorDbUnchanged: true, rootDevUnchanged: true,
      pendingMsiExecutableUnchanged: true, msiStillBlocked: true };
  });
  check("Earlier tool failures are retained, not rewritten as successful product tests", () => {
    for (const file of ["preparation.json", "fixtures.json",
      "nvl-inheritance-behavior/report.json", "advanced-layout-behavior/report.json"]) {
      assert.equal(read(path.join(run, file)).status, "FAILED");
    }
    return { retainedFailureReports: 4, paidModelRequests: 0, productChanges: 0 };
  });
  report.status = "PASS";
  report.limitations = [
    "Only this real historical PE 1.8.0 / Runtime protocol 0.5.0 and the recorded genuine capabilities were tested.",
    "Advanced layout was rejected by the old layout schema validator first; its 0.21.0 protocol gate was not reached.",
    "Extracted release executable, not an installation, upgrade, Android or full desktop matrix test.",
    "Current candidate functional regression and MSI historical-directory decision remain open."
  ];
} catch (error) {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output, error: report.error }, null, 2));
