"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-navigation-role-states-20261019-01";
const target = `${base}/audit-01.json`; assert(!fs.existsSync(target));
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [], sources: [],
  scope: "NAVIGATION_ROLE_COLOR_SOURCE_AND_RECOVERY_AUDIT_NOT_FULL_ROLE_GEOMETRY_PASS" };
function read(p) {
  report.sources.push({ path: p, sha256: sha(p) });
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}
function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g);
  try { g.detail = fn(); g.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
}
try {
  const p = read(`${base}/player.json`), e = read(`${base}/execution.json`);
  const prep = read(`${base}/preparation.json`), restore = read(`${base}/profile-restoration.json`);
  group("All12 genuine settings-return combinations rendered author disabled color before opaque cover", () => {
    assert.equal(p.status, "PASS"); assert.equal(e.status, "PASS"); assert(p.finishedAt && e.finishedAt);
    assert.equal(e.completedCells, 12); assert.equal(p.cells.length, 12); assert.equal(p.launches.length, 1);
    assert.equal(p.authoredRole.states.disabled.textColor, "#95b7c3");
    const keys = new Set(); let frames = 0, colorSamples = 0;
    for (const c of p.cells) {
      assert(c.executed && c.finishedAt && c.status === "PASS"); assert.deepEqual(c.violations, []);
      const v = c.viewport, key = `${v.width}/${v.height}/${v.dpr}/${v.reduced}`;
      assert(!keys.has(key)); keys.add(key);
      const input = c.observation.inputs.find(i => i.type === "click" && i.trusted && i.testId === "renpy-menu-return");
      assert(input); assert(c.before.hit && c.before.overflow <= 1);
      const samples = c.observation.frames.flatMap(f => f.controls.filter(b => b.id === "renpy-menu-return"
        && b.disabled && b.state === "disabled" && b.visible && b.color === "rgb(149, 183, 195)"
        && f.blackoutOpacity < .95 && f.at >= input.at
        && b.chain.every(a => a.opacity > 0 && a.visibility === "visible" && a.display !== "none"))
        .map(b => ({ at: f.at, ...b })));
      assert(samples.length > 0); assert(c.exactColorSamples.length > 0);
      for (const b of samples) {
        for (const k of ["x","y","width","height"]) assert(Math.abs(b.rect[k]-c.before.rect[k]) <= .2);
        assert(b.rect.width > 0 && b.rect.height > 0 && b.rect.left >= -1 && b.rect.top >= -1
          && b.rect.right <= v.width+1 && b.rect.bottom <= v.height+1);
      }
      frames += c.observation.frames.length; colorSamples += samples.length;
    }
    for (const [w,h] of [[1920,1080],[2560,1440],[3840,2160]]) for (const d of [1,2])
      for (const m of [false,true]) assert(keys.has(`${w}/${h}/${d}/${m}`));
    return { combinations: 12, frames, exactReturnButtonColorSamples: colorSamples,
      strictGlyphGeometryClaim: false, sourceRouteExplanationNotSubstituteForRuntimeEvidence: true };
  });
  group("Twelve exact PNGs, same UI-exported cartridge and unchanged execution tool checkpoint", () => {
    assert.equal(p.screenshots.length, 12); assert.equal(sha(p.source.path), p.source.sha256);
    assert.equal(p.source.sha256, "732d005961601f5d6eae9bdee242202751c6ed004b5b3c6163425f4910005199");
    for (const shot of p.screenshots) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const data = fs.readFileSync(shot.path);
      assert.equal(data.readUInt32BE(16), shot.before.width*shot.before.dpr);
      assert.equal(data.readUInt32BE(20), shot.before.height*shot.before.dpr);
    }
    assert.equal(sha(e.runner.path), e.runner.sha256);
    assert.equal(sha(e.runner.path), sha("F:/AgentVN/Checkpoints/Navigation-Role-States-20261019-01/installed-navigation-role-states.cjs"));
    assert.equal(sha("D:/AgentVN/scripts/installed-preview-session.ps1"),
      sha("F:/AgentVN/Checkpoints/Navigation-Role-States-20261019-01/installed-preview-session.ps1"));
    for (const cmd of e.commands) { assert.equal(cmd.exitCode, 0); assert.equal(sha(cmd.log), cmd.sha256); }
    assert.deepEqual(p.pageErrors, []); assert(!p.error && !p.cleanupError);
    return { pngs: 12, unchangedCartridge: p.source.sha256, nativeLibraryPreparationOnly: true };
  });
  group("Four original profiles and55 original bytes restored with no owned process or port residual", () => {
    assert.equal(restore.status, "PASS"); assert.equal(e.profileRestoration, "PASS");
    assert.deepEqual(e.beforeRestore.processes, []);
    let files = 0;
    for (const profile of prep.profiles) {
      assert(fs.existsSync(profile.original) && !fs.existsSync(profile.held));
      for (const f of profile.files) {
        assert.equal(sha(path.join(profile.original,f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); files++;
      }
    }
    assert.equal(files, 55);
    const l = p.launches[0]; assert.equal(l.cleanup.status, "PASS");
    const cmd = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -eq ${l.pid} `+
      `-or $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ($_.Name -eq 'msedgewebview2.exe' `+
      `-and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});`+
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${l.port},8278)});`+
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining = JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",cmd],
      { encoding: "utf8", windowsHide: true }).replace(/^\uFEFF/,""));
    assert.deepEqual(remaining.processes, []); assert.deepEqual(remaining.ports, []);
    return { profiles: 4, independentOriginalHashes: files, remaining,
      cleanupWasAttributedTerminationNotNormalClose: true };
  });
  group("Frozen Editor Player Dev and560 product files preserved, old geometry failures not superseded", () => {
    assert.equal(sha(`${prep.installRoot}/agentvn-editor.exe`), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${prep.installRoot}/agentvn-player.exe`), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed = new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json")
      .sources.map(x => [path.resolve("D:/AgentVN", x.file), x.sha256]));
    assert.equal(frozen.source.length, 560); assert.equal(allowed.size, 7);
    for (const f of frozen.source) assert.equal(sha(f.path), allowed.get(path.resolve(f.path)) || f.sha256);
    assert.equal(read("D:/AgentVN/output/installed-layout-author-review-20261019-01/role-states-04/report.json").status, "FAILED");
    assert.equal(p.fullRoleGeometryClaim, false); assert.equal(p.standaloneOrAndroidClaim, false);
    return { productFiles: 560, productChanges: 0, newBuilds: 0, modelRequests: 0, originalStrictGeometry: "FAILED" };
  });
  report.status = "PASS";
} catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, groups: report.groups.length, error: report.error }));
}
