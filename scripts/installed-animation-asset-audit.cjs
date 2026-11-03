"use strict";
// Evidence and recovery verification only; never counts as another product flow.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs"), { sha256 } = require("./lib/installed-acceptance.cjs");
const base = "D:/AgentVN/output/installed-animation-asset-20261019-03", dest = `${base}/audit-01.json`;
assert(!fs.existsSync(dest));
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [], sources: [],
  scope: "EVIDENCE_RECOVERY_AUDIT_NOT_ADDITIONAL_PRODUCT_TESTS", consumerConclusion: "BLOCKED" };
function read(p) { report.sources.push({ path: p, sha256: sha(p) }); return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); }
async function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = read(`${base}/preparation.json`), probe = read(`${base}/probe.json`), execution = read(`${base}/execution.json`);
  await group("Two original startup-tool failures retained; third genuine five-step observation completed without consumption PASS", () => {
    for (const n of ["01", "02"]) {
      const older = read(`D:/AgentVN/output/installed-animation-asset-20261019-${n}/execution.json`);
      assert.equal(older.status, "FAILED"); assert(older.finishedAt);
      if (n === "01") {
        const oldProbe = read(`D:/AgentVN/output/installed-animation-asset-20261019-${n}/probe.json`);
        assert.equal(oldProbe.checks.length, 0); assert(oldProbe.error.includes("assert(page)"));
      } else assert(older.commands.some(c => c.label === "observe" && c.exitCode === 1));
      const checkpoint = `F:/AgentVN/Checkpoints/Animation-Asset-20261019-01/attempt-${n}`;
      assert(fs.existsSync(`${checkpoint}/installed-animation-asset-session.cjs`));
      assert(fs.existsSync(`${checkpoint}/installed-animation-asset-probe.cjs`));
    }
    assert.equal(execution.status, "PASS"); assert(execution.finishedAt);
    assert.equal(probe.status, "PASS"); assert(probe.finishedAt); assert.equal(probe.checks.length, 5);
    assert(probe.checks.every(c => c.status === "PASS")); assert.equal(probe.consumerConclusion, "BLOCKED");
    assert.equal(execution.consumerConclusion, "BLOCKED");
    assert.deepEqual(probe.pageErrors, []); assert(!probe.error && !probe.cleanupError && !execution.cleanupErrors);
    return { observationSteps: 5, dedicatedJsonConsumptionAccepted: false, oldProductAssertions: 0 };
  });
  await group("Real two-layout UI exports preserve exact upgraded JSON and selected ID without copying JSON into inline params", async () => {
    assert.equal(probe.cartridges.length, 2); assert.equal(sha(probe.animation.path), probe.animation.sha256);
    assert.equal(sha(probe.fixture.input), probe.fixture.sha256);
    assert.deepEqual(probe.animation.json, { version: 2, frames: [], marker: "qa-new" });
    for (const c of probe.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path)), script = JSON.parse(await zip.file("script.json").async("string"));
      const command = script.scenes.find(s => s.scene_id === "ui_acceptance").commands[1];
      assert.equal(command.animation_id, "qa_animation"); assert.equal(command.target, "dialog");
      assert.deepEqual(command.params, { duration: 1600 });
      assert.equal(sha256(await zip.file(c.asset.path).async("nodebuffer")), probe.animation.sha256);
    }
    return { layouts: probe.cartridges.map(c => c.layout), jsonSha256: probe.animation.sha256, formatDefinitionClaim: false };
  });
  await group("Both real installed Players record ID dispatch, default two-frame opacity animation and actual engine completion", () => {
    assert.equal(probe.launches.length, 2);
    for (const c of probe.checks.slice(3)) {
      const created = c.detail.log.find(e => e.event === "effect-created");
      const start = c.detail.log.find(e => e.event === "animate-start");
      assert.equal(created.animation_id, "qa_animation"); assert.deepEqual(created.details.params, { duration: 1600 });
      assert.equal(start.details.keyframes, 2); assert.equal(start.details.options.duration, 1600);
      const actual = c.detail.active.find(a => a.timing?.duration === 1600 && a.keyframes?.length === 2);
      assert(actual); assert.deepEqual(actual.keyframes.map(k => k.opacity), ["0", "1"]);
      assert(c.detail.finished.some(e => e.event === "effect-finished"));
    }
    return { actualPlayerFlows: 2, conclusion: "DEFAULT_FALLBACK_OBSERVED_NOT_PROOF_OF_JSON_DECODING",
      reducedMotionOrFullMatrixClaim: false, visualDefectClaim: false };
  });
  await group("All five native PNGs have actual matching viewport parameters, pixel dimensions and SHA; runners frozen", () => {
    assert.equal(probe.screenshots.length, 5);
    for (const s of probe.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(s.before.width, 1920); assert.equal(s.before.height, 1080); assert.equal(s.before.dpr, 1);
      const png = fs.readFileSync(s.path);
      assert.equal(png.readUInt32BE(16), 1920); assert.equal(png.readUInt32BE(20), 1080);
    }
    for (const name of ["installed-animation-asset-session.cjs", "installed-animation-asset-probe.cjs",
      "installed-preview-session.ps1", "installed-assistant-recovery-session.ps1"])
      assert.equal(sha(`D:/AgentVN/scripts/${name}`), sha(`F:/AgentVN/Checkpoints/Animation-Asset-20261019-01/attempt-03/${name}`));
    return { nativePngs: 5, unchangedRunners: 4 };
  });
  await group("All three sessions restored four original default profiles and55 independent original hashes", () => {
    for (const n of ["01", "02", "03"]) {
      const p = read(`D:/AgentVN/output/installed-animation-asset-20261019-${n}/preparation.json`);
      const restored = read(`D:/AgentVN/output/installed-animation-asset-20261019-${n}/profile-restoration.json`);
      assert.equal(restored.status, "PASS"); let count = 0;
      for (const row of p.profiles) {
        assert(fs.existsSync(row.original) && !fs.existsSync(row.held));
        for (const f of row.files) { assert.equal(sha(path.join(row.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
      }
      assert.equal(count, 55);
    }
    return { originalProfiles: 4, originalHashes: 55, restoredSessions: 3,
      initialFailureCleanupWasRecoveredSeparatelyNotRewritten: true };
  });
  await group("Frozen installed Editor/Player, Dev and560 source files preserve existing authorized baseline", () => {
    assert.equal(sha(`${prep.installRoot}/agentvn-editor.exe`), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${prep.installRoot}/agentvn-player.exe`), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed = new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json").sources
      .map(s => [path.resolve("D:/AgentVN", s.file), s.sha256]));
    assert.equal(frozen.source.length, 560); assert.equal(allowed.size, 7);
    for (const s of frozen.source) assert.equal(sha(s.path), allowed.get(path.resolve(s.path)) || s.sha256);
    return { productSourceFiles: 560, priorAuthorizedEditorFiles: 7, newBuilds: 0, modelRequests: 0 };
  });
  await group("Owned Editor/backends/Players and their CDP/backend listeners are absent", () => {
    const ports = [8278, ...probe.launches.map(l => l.port)];
    for (const n of ["01", "02", "03"]) ports.push(read(`D:/AgentVN/output/installed-animation-asset-20261019-${n}/launch.json`).cdpPort);
    assert(probe.launches.every(l => l.cleanup?.status === "PASS"));
    const command = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ` +
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});` +
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})});` +
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const live = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { windowsHide: true, encoding: "utf8", timeout: 20000 }));
    assert.equal(live.processes.length, 0); assert.equal(live.ports.length, 0); return live;
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, consumerConclusion: report.consumerConclusion, error: report.error }));
});
