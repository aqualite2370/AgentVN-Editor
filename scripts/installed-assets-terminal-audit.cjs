"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const run = "D:/AgentVN/output/installed-assets-20261018-01", destination = process.argv[2];
assert(destination && !fs.existsSync(destination));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fileSha = file => sha(fs.readFileSync(file));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g16Status: "BLOCKED",
  scope: "INDEPENDENT_CURRENT_INSTALLED_ASSET_REPLACEMENT_EVIDENCE_AUDIT_NOT_OVERALL_ACCEPTANCE",
  at: new Date().toISOString(), checks: [], error: null,
  blockers: ["Native file picker input remains tool-blocked; API fixture setup/reimport not counted as native UI acceptance",
    "Real player consumption proved background only; audio/video/font/sprite/etc gameplay consumption not executed",
    "All-type replacement ran 1080p/DPR1 ordinary; twelve combinations cover confirmation/cancel of upgraded background, not all-type playback"],
  productChanges: 0, realModelRequests: 0, devRebuild: "NOT_RUN_NO_PRODUCT_CHANGES" };
async function check(name, callback) {
  const detail = await callback(); report.checks.push({ name, status: "PASS", detail });
}
(async () => {
  const fixture = read(path.join(run, "fixtures.json")), prep = read(path.join(run, "preparation.json"));
  const successes = ["open-01", "replace-01", "negative-01", "matrix-01", "save-01", "preview-03",
    "cartridge-02", "cartridge-player-01", "restart-reopen-01", "portable-roundtrip-01"].map(folder => ({ folder, ...read(path.join(run, folder, "report.json")) }));
  const find = folder => successes.find(r => r.folder === folder);
  await check("Frozen actual installed Editor and automatically started packaged backend retained provenance", () => {
    const payload = read("D:/AgentVN/output/full-regression-20261017-01/candidate-payload-audit/installer-resource-report.json")
      .deployments.find(d => d.kind === "NSIS actual payload");
    for (const attempt of ["", "-02", "-03"]) {
      const launch = read(path.join(run, `launch${attempt}.json`)), backend = read(path.join(run, `backend-ready${attempt}.json`));
      assert.equal(launch.status, "PASS"); assert.equal(backend.status, "PASS");
      assert.equal(launch.executableSha256, payload.executable.sha256);
      assert.equal(fileSha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
      assert.equal(fileSha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
      assert.equal(launch.manualBackendSpawn, false); assert.equal(launch.dataDirectoryOverride, false); assert.equal(launch.webviewDirectoryOverride, false);
    }
    return { executableSha256: payload.executable.sha256, realInstalledSessions: 3, noCleanMachineClaim: true };
  });
  await check("All eleven distinguishable local old/new fixtures and real UI replacement assertions are nonempty", () => {
    const types = ["background", "sprite", "portrait", "bgm", "sfx", "voice", "video", "animation", "ui", "font", "other"];
    assert.deepEqual(fixture.types.map(t => t.type), types);
    assert.equal(fileSha(fixture.input), fixture.inputSha256);
    for (const row of fixture.types) {
      for (const file of Object.values(row.files)) assert.equal(fileSha(file.path), file.sha256);
      assert.notEqual(row.files.old.sha256, row.files.new.sha256);
    }
    for (const row of successes) {
      assert.equal(row.status, "PASS", row.folder); assert(row.checks.length > 0);
      assert(row.checks.every(c => c.status === "PASS"));
    }
    const replaced = find("replace-01"); assert.equal(replaced.cases.length, 11);
    assert(replaced.cases.every(c => c.status === "PASS"));
    assert.equal(replaced.checks.length, 5);
    assert.equal(find("negative-01").cases.length, 4);
    assert(find("negative-01").cases.every(c => c.status === "PASS" && c.errorText.includes("原素材未改变")));
    return { supportedTypes: types, replacementCases: 11, negativeMediaCases: 4, successfulReports: successes.length,
      directChecks: successes.reduce((n, r) => n + r.checks.length, 0), noModelRequest: true };
  });
  await check("Exact twelve native WebView combinations, dialog hit geometry and actual captured DPR", () => {
    const matrix = find("matrix-01"); assert.equal(matrix.cases.length, 12);
    const combinations = new Set(matrix.cases.map(c => `${c.width}/${c.height}/${c.dpr}/${c.reduced}`)); assert.equal(combinations.size, 12);
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      assert(combinations.has(`${width}/${height}/${dpr}/${reduced}`));
    for (const row of matrix.cases) {
      assert.equal(row.status, "PASS");
      assert(row.geometry.controls.length >= 2 && row.geometry.controls.every(c => c.hit && c.insideViewport));
      assert(row.geometry.overflow <= 1 && row.libraryGeometry.overflow <= 1);
    }
    let count = 0;
    for (const result of successes) for (const s of result.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); count++;
    }
    assert.equal(matrix.screenshots.length, 12); assert(count >= 20);
    report.captureCount = count;
    return { matrixCombinations: 12, validRawCaptures: count, actualViewportEmulationNotPhysical4k: true,
      scope: "Confirmation/cancel/geometry, not all eleven types in every combination or complete animation audit" };
  });
  await check("Native vnproj and real UI-exported cartridge contain upgraded bytes and no old file payloads", async () => {
    const bundle = find("save-01").package, cartridge = find("cartridge-02").cartridge;
    assert.equal(fileSha(bundle.native), bundle.sha256); assert.equal(fileSha(bundle.retained), bundle.sha256);
    assert.equal(fileSha(cartridge.path), cartridge.sha256);
    for (const [kind, file] of [["vnproj", bundle.retained], ["vncart", cartridge.path]]) {
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      const doc = JSON.parse(await zip.file(kind === "vnproj" ? "project.json" : "manifest.json").async("string"));
      assert.equal(kind === "vnproj" ? doc.project_id : doc.game_id, fixture.projectId);
      const oldHashes = new Set(fixture.types.map(t => t.files.old.sha256));
      for (const row of fixture.types) {
        const a = (doc.asset_manifest || doc.assets).find(a => a.asset_id === row.id); assert(a);
        const bytes = await zip.file(a.metadata?.project_path || a.path).async("nodebuffer");
        assert.equal(sha(bytes), row.files.new.sha256);
      }
      for (const entry of Object.values(zip.files).filter(f => !f.dir))
        assert(!oldHashes.has(sha(await entry.async("nodebuffer"))), `${kind}: old bytes remained in ${entry.name}`);
    }
    return { nativeProject: bundle, cartridge, payloadCountPerArtifact: 11 };
  });
  await check("Actual restart, homepage reopen and portable backend reimport retain all eleven upgraded media", () => {
    const reopened = find("restart-reopen-01"), imported = find("portable-roundtrip-01");
    for (const result of [reopened, imported]) {
      assert.equal(result.assets.length, 11);
      for (const row of fixture.types) assert.equal(result.assets.find(a => a.id === row.id).sha256, row.files.new.sha256);
    }
    assert.equal(imported.portableImport.method, "CONTROLLED_REAL_PACKAGED_BACKEND_ENDPOINT_NOT_NATIVE_PICKER");
    assert.equal(imported.portableImport.sha256, find("save-01").package.sha256);
    return { restartedUiReopen: "PASS", portableDataRoundtrip: "PASS", nativePickerRoundtrip: "BLOCKED_TOOL",
      restartMethod: "Controlled owned-process stop; not native normal-close acceptance" };
  });
  await check("Real installed external directory preview and separately loaded cartridge consume new background bytes", () => {
    const preview = find("preview-03"), player = find("cartridge-player-01");
    const expected = fixture.types[0].files.new.sha256;
    assert.equal(preview.previewExport.assets.length, 11);
    assert.equal(preview.checks[1].detail.sha256, expected);
    assert.equal(player.rendered.sha256, expected);
    assert.equal(player.exe.sha256, fileSha(player.exe.path));
    assert.equal(player.cartridge.sha256, find("cartridge-02").cartridge.sha256);
    assert.equal(player.cleanup.status, "PASS");
    return { directoryPreviewBackground: "PASS", actualExportedCartridgeBackground: "PASS",
      otherMediaGameplayConsumption: "NOT_RUN", noWindowsSetupOrAndroidClaim: true };
  });
  await check("Four original profiles restored, independent 55 hashes plus root Dev/DB/pending MSI unchanged", () => {
    const restored = read(path.join(run, "profile-restoration.json"));
    assert.equal(restored.status, "PASS"); assert.equal(restored.profiles.length, 4);
    let files = 0;
    for (const profile of prep.profiles) {
      assert(fs.existsSync(profile.original)); assert(!fs.existsSync(profile.held));
      for (const f of profile.files) {
        assert.equal(fileSha(path.join(profile.original, f.relative)), f.sha256);
        assert.equal(fileSha(f.backup), f.sha256); files++;
      }
    }
    assert.equal(files, 55);
    assert.equal(fileSha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const original = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(fileSha(path.join(original.actualInstallation.path, "agentvn-editor.exe")), original.actualInstallation.executableSha256);
    assert.equal(fileSha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), original.userPersistence.databaseSha256);
    return { profiles: 4, independentFiles: files, devSha256: prep.originalDevSha256, pendingMsiNotTouched: true };
  });
  await check("All owned processes/debug ports closed, forced cleanup explicitly not normal-close PASS", () => {
    const ports = ["", "-02", "-03"].flatMap(s => {
      const l = read(path.join(run, `launch${s}.json`)); return [l.cdpPort, l.playerCdpPort];
    }); ports.push(find("cartridge-player-01").cdpPort, 8278);
    for (const suffix of ["", "-02", "-03"]) {
      const cleanup = read(path.join(run, `computer-use-import-blocked${suffix}.json`));
      assert.equal(cleanup.cleanupStatus, "PASS"); assert.equal(cleanup.normalClose, "NOT_RUN_TOOL_UNAVAILABLE");
    }
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(state.status, 0, state.stderr); const current = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(current.processes.length, 0); assert.equal(current.ports.length, 0);
    return { ...current, portsChecked: ports, normalCloseAcceptance: "NOT_RUN_TOOL" };
  });
  await check("Original failed attempts and tool boundaries preserved without product fixes or paid retry", () => {
    for (const folder of ["seed-01", "preview-01", "preview-02", "cartridge-01", "close-02"])
      assert.equal(read(path.join(run, folder, "report.json")).status, "FAILED");
    assert.equal(find("replace-01").realModelRequests, 0);
    assert.equal(find("portable-roundtrip-01").nativeImportStatus, "BLOCKED_TOOL_GEOMETRY");
    return { retainedFailedAttempts: 5, classifiedAs: "Tool/oracle failures, not new demonstrated product defects",
      actualRemainingBlockers: report.blockers, noAclBypass: true };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(error => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g16Status: report.g16Status,
    checks: report.checks.length, error: report.error, destination }, null, 2));
});
