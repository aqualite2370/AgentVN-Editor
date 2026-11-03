"use strict";
// Independent evidence/recovery audit. No product cases or UI manipulation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-transient-role-states-20261019-01";
const target = `${base}/audit-01.json`; assert(!fs.existsSync(target));
const result = { status: "RUNNING", at: new Date().toISOString(), groups: [], sources: [],
  scope: "SOURCE_RECOVERY_AND_NATURAL_DEFAULT_THEME_OBSERVATION_NOT_AUTHORED_ROLE_COLOR_COVERAGE" };
const read = p => {
  result.sources.push({ path: p, sha256: sha(p) });
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
};
function group(name, fn) {
  const row = { name, status: "RUNNING" }; result.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  const p = read(`${base}/player.json`), e = read(`${base}/execution.json`);
  const prep = read(`${base}/preparation.json`), restore = read(`${base}/profile-restoration.json`);
  group("Twelve distinct real native launches and natural title/exit pending observations", () => {
    assert.equal(p.status, "PASS"); assert.equal(e.status, "PASS");
    assert(p.finishedAt && e.finishedAt); assert.equal(e.completedCells, 12);
    assert.equal(p.cells.length, 12); assert.equal(p.launches.length, 12);
    const keys = new Set(); let launchFrames = 0, modalSamples = 0, uncoveredTitleSamples = 0;
    for (const c of p.cells) {
      assert(c.executed && c.finishedAt); assert.equal(c.status, "PASS");
      const v = c.viewport, key = `${v.width}/${v.height}/${v.dpr}/${v.reduced}`;
      assert(!keys.has(key)); keys.add(key);
      assert(c.launch.inputs.some(i => i.trusted && i.type === "click" && i.testId === "start-new-game"));
      assert.equal(c.exit.status, "CAPTURED");
      assert(c.exit.data.inputs.some(i => i.trusted && i.type === "click" && i.testId === "confirm-exit-game"));
      const pointer = c.exit.data.inputs.find(i => i.type === "click").at;
      const busy = c.modalDisabled.filter(b => b.testId === "confirm-exit-game" && b.busy === "true"
        && b.at >= pointer && b.disabled && b.visible && !b.blackout);
      assert(busy.length > 0);
      assert(c.modalDisabled.some(b => b.label === "取消" && b.disabled));
      const title = c.titleDisabled.filter(b => b.testId === "start-new-game"
        && (!b.blackout || b.blackout.opacity < .95));
      assert(title.length > 0, "Do not count only fully black-covered controls as visible title evidence");
      for (const b of [...busy, ...title]) {
        assert(b.chain.every(x => x.opacity > 0 && x.visibility === "visible" && x.display !== "none"));
        assert(b.rect.width > 0 && b.rect.height > 0 && b.rect.left >= -1 && b.rect.top >= -1
          && b.rect.right <= v.width + 1 && b.rect.bottom <= v.height + 1);
      }
      launchFrames += c.launch.frames.length; modalSamples += busy.length; uncoveredTitleSamples += title.length;
    }
    for (const [w,h] of [[1920,1080],[2560,1440],[3840,2160]]) for (const d of [1,2])
      for (const m of [false,true]) assert(keys.has(`${w}/${h}/${d}/${m}`));
    return { combinations: 12, launchFrames, modalBusyButtonSamples: modalSamples,
      notFullyBlackCoveredStartButtonSamples: uncoveredTitleSamples, artificialLatency: false };
  });
  group("Real save bytes exist after each genuine UI confirmed native exit", () => {
    const profile = prep.profiles.find(x => x.app === "player" && x.kind === "Roaming");
    const retained = restore.profiles.find(x => x.app === "player" && x.kind === "Roaming").testHeld;
    let writes = 0;
    for (let i = 0; i < p.cells.length; i++) {
      const c = p.cells[i], launch = p.launches[i];
      assert.equal(launch.cleanup.status, "PASS"); assert.equal(launch.cleanup.method, "REAL_UI_CONFIRMED_NATIVE_DESTROY");
      assert.equal(launch.library.storage.portable, false);
      assert(c.newWrites.length > 0); assert.equal(c.savedState.length, c.newWrites.length);
      for (const f of c.savedState) {
        const kept = path.join(retained, path.relative(profile.original, f.path));
        assert.equal(sha(kept), f.sha256); assert.deepEqual(read(kept), f.data);
        assert.equal(f.data.scene_id, "ui_acceptance"); assert.equal(f.data.command_index, 0);
        assert.equal(f.data.save_kind, "auto"); assert.equal(f.data.install_id, launch.installId);
        assert.equal(f.data.history.length, 1); writes++;
      }
    }
    return { genuineSavedFiles: writes, standaloneSavePathClaim: false };
  });
  group("Twelve PNGs preserve actual viewport DPR and motion sampling", () => {
    assert.equal(p.screenshots.length, 12);
    for (const shot of p.screenshots) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const bytes = fs.readFileSync(shot.path);
      assert.equal(bytes.readUInt32BE(16), shot.before.width * shot.before.dpr);
      assert.equal(bytes.readUInt32BE(20), shot.before.height * shot.before.dpr);
    }
    return { nativePNGs: 12, screenshotsProvePendingAppearance: false, physicalMonitorClaim: false };
  });
  group("Scope cannot be promoted to authored disabled-role final colors or all six roles", () => {
    // The reused ordinary-dialogue fixture only overrides player-side roles.
    // Missing title/modal author overrides must remain visible in the report.
    assert.deepEqual(p.authoredRoles, {});
    assert.equal(p.allRoleStatesClaim, false); assert.equal(p.standaloneOrAndroidClaim, false);
    assert.equal(p.coverage.completeSixRoleCoverage, false);
    return { baselineThemePendingObserved: true, customTitleModalFinalColors: "NOT_PROVEN",
      persistentTitleModalSelectedState: "NO_CURRENT_NATURAL_USER_STATE",
      navigationDisabledState: "NOT_SAMPLED", strictGeometryFailuresInEarlierRoleMatrix: "UNCHANGED" };
  });
  group("Four default profiles and55 independent originals restored; no owned processes or ports", () => {
    assert.equal(restore.status, "PASS"); assert.equal(e.profileRestoration, "PASS");
    assert.deepEqual(e.beforeRestore.processes, []);
    let files = 0;
    for (const profile of prep.profiles) {
      assert(fs.existsSync(profile.original) && !fs.existsSync(profile.held));
      for (const f of profile.files) {
        assert.equal(sha(path.join(profile.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); files++;
      }
    }
    assert.equal(files, 55);
    const pids = p.launches.map(l => l.pid), ports = p.launches.map(l => l.port);
    const command = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(${pids}) `+
      `-or $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or `+
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});`+
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports},8278)});`+
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true }).replace(/^\uFEFF/, ""));
    assert.deepEqual(remaining.processes, []); assert.deepEqual(remaining.ports, []);
    return { profiles: 4, originalFiles: files, remaining };
  });
  group("Frozen product and captured execution tools are unchanged", () => {
    assert.equal(sha(e.runner.path), e.runner.sha256);
    assert.equal(sha(e.runner.path), sha("F:/AgentVN/Checkpoints/Transient-Role-States-20261019-01/installed-transient-role-states.cjs"));
    assert.equal(sha("D:/AgentVN/scripts/installed-preview-session.ps1"),
      sha("F:/AgentVN/Checkpoints/Transient-Role-States-20261019-01/installed-preview-session.ps1"));
    for (const cmd of e.commands) { assert.equal(cmd.exitCode, 0); assert.equal(sha(cmd.log), cmd.sha256); }
    assert.equal(sha(`${prep.installRoot}/agentvn-editor.exe`), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${prep.installRoot}/agentvn-player.exe`), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const baseline = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed = new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json")
      .sources.map(x => [path.resolve("D:/AgentVN", x.file), x.sha256]));
    assert.equal(baseline.source.length, 560); assert.equal(allowed.size, 7);
    for (const f of baseline.source) assert.equal(sha(f.path), allowed.get(path.resolve(f.path)) || f.sha256);
    assert.equal(sha(p.source.path), p.source.sha256);
    assert.deepEqual(p.pageErrors, []);
    return { productFiles: 560, newBuilds: 0, modelRequests: 0, unchangedCartridge: p.source.sha256 };
  });
  result.status = "PASS";
} catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString(); fs.writeFileSync(target, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, groups: result.groups.length, error: result.error, target }));
}
