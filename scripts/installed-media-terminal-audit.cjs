"use strict";
// Independent evidence/cleanup audit. PASS here is not overall product PASS.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { spawnSync } = require("node:child_process"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const previous = "D:/AgentVN/output/installed-asset-consumers-20261018-01";
const run = "D:/AgentVN/output/installed-video-20261018-01", destination = process.argv[2];
assert(destination && !fs.existsSync(destination), "Fresh independent evidence required");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = f => sha(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g16Status: "BLOCKED",
  at: new Date().toISOString(), checks: [], error: null, productChanges: 0, realModelRequests: 0,
  devRebuild: "NOT_RUN_NO_PRODUCT_CHANGES", newHumanAudioListening: "NOT_CLAIMED_USER_PREVIOUS_CONFIRMATION_RETAINED",
  remaining: [
    "Native project import/portable reopen picker remains tool-BLOCKED; actual backend roundtrip is explicitly controlled",
    "Portrait observed via generic show_image, not proof of dedicated dialog portrait renderer",
    "Animation JSON is preserved/exported; no claim it was read as a runtime animation file",
    "This media pipeline run is 1080p DPR1 ordinary, not the twelve-combination full behavior/motion matrix",
    "Controlled attributed teardown is not normal native-window close acceptance",
    "Other product failures HOST-01/02/03, MSI directory decision and remaining function/platform groups stay open",
  ] };
async function check(name, callback) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await callback(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const mediaFixture = read(path.join(previous, "fixtures.json"));
  const media = read(path.join(previous, "player-02/report.json"));
  const fixture = read(path.join(run, "fixtures.json")), prep = read(path.join(run, "preparation.json"));
  const ui = read(path.join(run, "ui-01/report.json")), exported = read(path.join(run, "ui-02/report.json"));
  const player = read(path.join(run, "player-01/report.json")), launch = read(path.join(run, "launch.json"));
  const sourceAssets = read("D:/AgentVN/output/installed-assets-20261018-01/fixtures.json");
  await check("Prior controlled derivative retains all eleven UI-exported asset bytes and original non-script payloads", async () => {
    assert.equal(mediaFixture.status, "PASS"); assert.equal(mediaFixture.assetProofs.length, 11);
    const originalZip = await JSZip.loadAsync(fs.readFileSync(mediaFixture.sourceCartridge.path));
    const derivativeZip = await JSZip.loadAsync(fs.readFileSync(mediaFixture.output.path));
    assert.equal(fileSha(mediaFixture.sourceCartridge.path), mediaFixture.sourceCartridge.sha256);
    assert.equal(fileSha(mediaFixture.output.path), mediaFixture.output.sha256);
    const manifest = JSON.parse(await derivativeZip.file("manifest.json").async("string"));
    for (const row of sourceAssets.types) {
      const asset = manifest.assets.find(a => a.asset_id === row.id); assert(asset);
      assert.equal(sha(await derivativeZip.file(asset.path).async("nodebuffer")), row.files.new.sha256);
    }
    let unchanged = 0;
    for (const entry of Object.values(originalZip.files).filter(f => !f.dir && !["script.json", "manifest.json", "checksum.json"].includes(f.name))) {
      assert((await entry.async("nodebuffer")).equals(await derivativeZip.file(entry.name).async("nodebuffer"))); unchanged++;
    }
    assert.equal(unchanged, mediaFixture.unchangedEntries.length);
    return { assetTypes: 11, unchangedPayloads: unchanged, scope: mediaFixture.scope,
      canonicalImportWarnings: mediaFixture.output.validationWarnings };
  });
  await check("Prior observed sprite, loaded font, generic image overlays and three actual audio pipelines remain narrowly evidenced", () => {
    assert.equal(media.status, "FAILED"); assert.equal(media.checks.length, 15);
    const failed = media.checks.filter(c => c.status === "FAILED");
    assert.equal(failed.length, 1); assert(failed[0].name.includes("video"));
    assert.equal(media.sprite.sha256, sourceAssets.types.find(t => t.id === "qa_sprite").files.new.sha256);
    assert(media.font.check && media.font.faces.some(f => f.status === "loaded") && media.font.renderedTextNodes > 0);
    for (const kind of ["bgm", "sfx", "voice"]) {
      const bytes = media.checks.find(c => c.name === `Actual ${kind} audio element loads upgraded WAV bytes`);
      const pipeline = media.checks.find(c => c.name === `Real detached ${kind} audio player has successful play and decoder pipeline evidence`);
      assert.equal(bytes.status, "PASS"); assert.equal(pipeline.status, "PASS");
      assert.equal(bytes.detail.sha256, sourceAssets.types.find(t => t.id === `qa_${kind}`).files.new.sha256);
      assert(pipeline.detail.some(p => p.events.some(e => e.event === "kPlay") && p.events.some(e => e.pipeline_state === "kPlaying")));
    }
    assert.equal(media.cleanup.status, "PASS");
    return { passingChecks: 14, originalVideoFailureRetained: true,
      audioScope: media.audioScope, portraitScope: media.dialogPortraitObservation.scope, animationScope: media.animationJsonScope };
  });
  await check("New fixture self-test requires real multiframe playback, not the prior single-frame positive control", () => {
    assert.equal(fixture.status, "PASS"); assert.equal(fixture.videos.length, 2);
    for (const row of fixture.videos) {
      assert.equal(fileSha(row.path), row.sha256); assert(row.decoded.frames >= 15 && row.decoded.lastTime > 1
        && row.decoded.duration > 1 && row.decoded.ended);
    }
    assert.notEqual(fixture.videos[0].sha256, fixture.videos[1].sha256);
    assert.equal(fileSha(fixture.input), fixture.inputSha256);
    assert(media.video.some(e => e.duration <= .001));
    return { oldFailureDuration: .001, validVideos: fixture.videos.map(v => ({ version: v.version,
      duration: v.decoded.duration, frames: v.decoded.frames, sha256: v.sha256 })) };
  });
  await check("Actual installed UI replacement, metadata, native save and reopen survive preserved export-harness failure", async () => {
    assert.equal(ui.status, "FAILED"); assert.equal(ui.checks.length, 4); assert(ui.checks.every(c => c.status === "PASS"));
    assert(ui.error.includes("android-env-import-backdrop") && ui.error.includes("intercepts pointer events"));
    assert.equal(exported.status, "PASS"); assert.equal(exported.checks.length, 1);
    assert(exported.continuation.noRepeatedSeedOrReplacement);
    const fresh = fixture.videos.find(v => v.version === "new"), old = fixture.videos.find(v => v.version === "old");
    assert.equal(fileSha(ui.package.native), ui.package.sha256); assert.equal(fileSha(ui.package.retained), ui.package.sha256);
    assert.equal(fileSha(exported.cartridge.path), exported.cartridge.sha256);
    for (const [kind, file] of [["project", ui.package.retained], ["cartridge", exported.cartridge.path]]) {
      const zip = await JSZip.loadAsync(fs.readFileSync(file));
      const doc = JSON.parse(await zip.file(kind === "project" ? "project.json" : "manifest.json").async("string"));
      assert.equal(kind === "project" ? doc.project_id : doc.game_id, fixture.projectId);
      const asset = (doc.asset_manifest || doc.assets).find(a => a.asset_id === "qa_video"); assert(asset);
      const bytes = await zip.file(asset.path || asset.metadata.project_path).async("nodebuffer");
      assert.equal(sha(bytes), fresh.sha256);
      for (const entry of Object.values(zip.files).filter(f => !f.dir))
        assert.notEqual(sha(await entry.async("nodebuffer")), old.sha256);
    }
    return { realUiAssertions: 5, initialReportStillFailed: true, explicitContinuation: exported.continuation,
      nativeSave: ui.package, actualUiCartridge: exported.cartridge };
  });
  await check("Native installed player consumes untouched real UI export and verifies pixels, timeline and story continuation", () => {
    assert.equal(player.status, "PASS"); assert.equal(player.checks.length, 4); assert(player.checks.every(c => c.status === "PASS"));
    assert.equal(player.scope, "REAL_INSTALLED_PLAYER_WITH_UNMODIFIED_UI_EXPORTED_CARTRIDGE_NOT_DERIVATIVE");
    assert.equal(player.cartridge.sha256, exported.cartridge.sha256);
    assert.equal(fileSha(player.cartridge.path), player.cartridge.sha256); assert.equal(fileSha(player.exe.path), player.exe.sha256);
    assert.equal(player.video.source.sha256, fixture.videos.find(v => v.version === "new").sha256);
    assert(player.video.frames.length >= 15 && player.video.frames.some(f => f.time > 1));
    const signatures = new Set(player.video.frames.map(f => f.pixelSignature)); assert(signatures.size >= 10);
    assert(player.video.events.some(e => e.event === "ended" && e.duration > 1));
    assert.equal(player.cleanup.status, "PASS");
    return { playerExe: player.exe, frames: player.video.frames.length,
      uniqueFrameSignatures: signatures.size, lastFrame: player.video.frames.at(-1), viewportScope: player.viewportScope };
  });
  await check("Eleven raw native screenshots retain matching viewport, actual DPR, PNG dimensions and immutable SHA", () => {
    const captures = [media, ui, exported, player].flatMap(r => r.screenshots);
    assert.equal(captures.length, 11);
    for (const shot of captures) {
      const bytes = fs.readFileSync(shot.path); assert.equal(sha(bytes), shot.sha256);
      assert.deepEqual(shot.before, shot.after);
      assert.equal(bytes.readUInt32BE(16), shot.before.width * shot.before.dpr);
      assert.equal(bytes.readUInt32BE(20), shot.before.height * shot.before.dpr);
    }
    return { captures: captures.length, noPhysical4kOrFullMatrixClaim: true };
  });
  await check("Both media sessions restored all original profiles with independent byte verification", () => {
    const oldPrep = read(path.join(previous, "preparation.json")), oldRestore = read(path.join(previous, "profile-restoration.json"));
    const restore = read(path.join(run, "profile-restoration.json"));
    assert.equal(oldRestore.status, "PASS"); assert.equal(restore.status, "PASS");
    for (const [session, expected] of [[oldPrep, 24], [prep, 55]]) {
      let checked = 0;
      for (const p of session.profiles) {
        assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
        for (const f of p.files) { assert.equal(fileSha(path.join(p.original, f.relative)), f.sha256);
          assert.equal(fileSha(f.backup), f.sha256); checked++; }
      }
      assert.equal(checked, expected);
    }
    assert.equal(fileSha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const incident = read("D:/AgentVN/output/host-msi-session-20261018-01/incident-audit-01.json");
    assert.equal(fileSha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(fileSha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    return { priorPlayerFiles: 24, currentEditorAndPlayerFiles: 55, rootDevSha256: prep.originalDevSha256,
      originalDbUnchanged: true, pendingMsiInstallationUntouched: true };
  });
  await check("Installed frozen candidate/automatic backend provenance and owned teardown are explicit", () => {
    const backend = read(path.join(run, "backend-ready.json")), cleanup = read(path.join(run, "computer-use-import-blocked.json"));
    assert.equal(launch.status, "PASS"); assert.equal(backend.status, "PASS");
    assert.equal(fileSha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(fileSha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
    assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    assert.equal(cleanup.cleanupStatus, "PASS"); assert.equal(cleanup.normalClose, "NOT_RUN_CONTROLLED_TEST_TEARDOWN");
    const ports = [8278, launch.cdpPort, launch.playerCdpPort, player.cdpPort,
      read(path.join(previous, "player-01/report.json")).cdpPort, media.cdpPort];
    const state = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(state.status, 0, state.stderr); const current = JSON.parse(state.stdout.replace(/^\uFEFF/, ""));
    assert.equal(current.processes.length, 0); assert.equal(current.ports.length, 0);
    return { ...current, portsChecked: ports, normalCloseAcceptance: "NOT_RUN", cleanMachineClaim: false };
  });
  await check("Failures and scope restrictions remain intact rather than promoted to whole-group PASS", () => {
    const first = read(path.join(previous, "player-01/report.json")); assert.equal(first.status, "FAILED");
    assert.equal(media.status, "FAILED"); assert.equal(ui.status, "FAILED");
    for (const r of [first, media, fixture, ui, exported, player]) assert.equal(r.realModelRequests, 0);
    report.inputs = [path.join(previous, "player-01/report.json"), path.join(previous, "player-02/report.json"),
      path.join(run, "ui-01/report.json"), path.join(run, "ui-02/report.json"), path.join(run, "player-01/report.json")]
      .map(file => ({ path: file, sha256: fileSha(file) }));
    return { originalFailedReports: 3, remaining: report.remaining };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, g16Status: report.g16Status,
    checks: report.checks.length, error: report.error, destination }, null, 2));
});
