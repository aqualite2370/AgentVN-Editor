"use strict";
// Independent source/recovery audit. It does not rerun or add product cases.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const base = "D:/AgentVN/output/installed-choice-role-states-20261019-01", dest = `${base}/audit-01.json`;
assert(!fs.existsSync(dest));
const report = { status: "RUNNING", at: new Date().toISOString(), groups: [], sources: [],
  scope: "SOURCE_AND_RECOVERY_AUDIT_NOT_PRODUCT_CASE_COUNT", productConclusion: "PASS", originalWrapperConclusion: "FAILED" };
function read(p) { report.sources.push({ path: p, sha256: sha(p) }); return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); }
function group(name, fn) {
  const row = { name, status: "RUNNING" }; report.groups.push(row);
  try { row.detail = fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  const player = read(`${base}/player.json`), execution = read(`${base}/execution.json`), prep = read(`${base}/preparation.json`);
  const restored = read(`${base}/profile-restoration.json`);
  group("Twelve actual distinct native Player combinations reached natural rollback-selected state and original geometry", () => {
    assert.equal(player.status, "PASS"); assert(player.finishedAt); assert.equal(player.cells.length, 12);
    const names = new Set(); let frames = 0, disabledSamples = 0;
    for (const c of player.cells) {
      assert.equal(c.status, "PASS"); assert(c.executed && c.finishedAt);
      const v = c.viewport, name = `${v.width}x${v.height}-${v.dpr}-${v.reduced}`; assert(!names.has(name)); names.add(name);
      assert.equal(c.selected.selected, "true"); assert.equal(c.selected.label, "继续"); assert.equal(c.selected.state, "selected");
      assert(c.selected.visible && c.selected.hit && !c.selected.clipped && !c.selected.horizontalOverflow);
      for (const k of ["x", "y", "width", "height"]) assert(Math.abs(c.normal.rect[k] - c.selected.rect[k]) <= .2);
      for (const r of c.selected.textRects) assert(r.left >= c.selected.rect.left - 1 && r.top >= c.selected.rect.top - 1
        && r.right <= c.selected.rect.right + 1 && r.bottom <= c.selected.rect.bottom + 1);
      frames += c.transient.frames.length; disabledSamples += c.disabledSamples;
      const rgb = h => `rgb(${[1,3,5].map(i => parseInt(h.slice(i,i+2),16)).join(", ")})`;
      assert.equal(c.normal.color, rgb(player.authoredStates.normal.textColor));
      assert.equal(c.hover.color, rgb(player.authoredStates.hover.textColor));
      assert.equal(c.selected.color, rgb(player.authoredStates.selected.textColor));
      if (!v.reduced) {
        assert(c.disabledSamples > 0);
        assert(c.transient.frames.some(f => f.choices.some(x => x.disabled && x.visible && x.opacity > 0
          && x.color === rgb(player.authoredStates.disabled.textColor))));
      } else assert.equal(c.disabledSamples, 0);
    }
    for (const [w,h] of [[1920,1080],[2560,1440],[3840,2160]]) for (const d of [1,2]) for (const m of [false,true])
      assert(names.has(`${w}x${h}-${d}-${m}`));
    assert.equal(frames,574); assert.equal(disabledSamples,258);
    return { combinations:12, realFrames:frames, disabledButtonFrameSamples:disabledSamples,
      fullSixRolesClaim:false, fixedChoiceDisabledClaim:false };
  });
  group("One genuine installed-library Player, exact reused authored cartridge and stable run-script bytes", () => {
    assert.equal(player.launches.length,1);
    assert.equal(sha(player.source.path),player.source.sha256);
    assert.equal(player.launches[0].library.record.installId,"qa-choice-role-states-20261019");
    assert.equal(player.launches[0].library.storage.portable,false);
    assert.equal(execution.runner.sha256,sha(execution.runner.path));
    assert.equal(sha(execution.runner.path),sha("F:/AgentVN/Checkpoints/Choice-Role-States-20261019-01/installed-choice-role-states.cjs"));
    assert.deepEqual(player.pageErrors,[]); assert(!player.error&&!player.cleanupError);
    return { binary:player.launches[0].identity, unchangedCartridge:player.source.sha256, publicNativeFixturePreparation:true };
  });
  group("Twelve real PNGs match actual viewport/DPR/motion and exact encoded dimensions", () => {
    assert.equal(player.screenshots.length,12);
    for (const shot of player.screenshots) {
      assert.equal(sha(shot.path),shot.sha256); assert.deepEqual(shot.before,shot.after);
      const png=fs.readFileSync(shot.path);
      assert.equal(png.readUInt32BE(16),shot.before.width*shot.before.dpr);
      assert.equal(png.readUInt32BE(20),shot.before.height*shot.before.dpr);
    }
    return { pngs:12, physicalMonitorClaim:false };
  });
  group("Original wrapper cleanup failure retained; separate Restore really restored four default profiles and55 baseline hashes", () => {
    assert.equal(execution.status,"FAILED"); assert(execution.finishedAt&&execution.cleanupError);
    assert.equal(execution.completedCells,12);
    assert(execution.commands.some(c=>c.label==="player"&&c.exitCode===0));
    assert(execution.commands.some(c=>c.label==="restore"&&c.exitCode===1));
    assert.equal(restored.status,"PASS"); let count=0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)&&!fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original,f.relative)),f.sha256); assert.equal(sha(f.backup),f.sha256); count++; }
    }
    assert.equal(count,55);
    for (const c of execution.commands) assert.equal(sha(c.log),c.sha256);
    return { originalExecution:"FAILED", laterRecovery:"PASS", profiles:4, independentOriginalHashes:55, originalRecordRewritten:false };
  });
  group("Frozen Editor/Player/Dev and560 product files preserved except the earlier seven authorized Editor differences", () => {
    assert.equal(sha(`${prep.installRoot}/agentvn-editor.exe`),"f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${prep.installRoot}/agentvn-player.exe`),"71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"),prep.originalDevSha256);
    const frozen=read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed=new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json").sources
      .map(s=>[path.resolve("D:/AgentVN",s.file),s.sha256]));
    assert.equal(frozen.source.length,560); assert.equal(allowed.size,7);
    for (const s of frozen.source) assert.equal(sha(s.path),allowed.get(path.resolve(s.path))||s.sha256);
    return { productFiles:560,newBuilds:0,modelRequests:0 };
  });
  group("The exact Player PID and CDP port plus other AgentVN default-profile processes are gone", () => {
    const launch=player.launches[0]; assert.equal(launch.cleanup.status,"PASS");
    const script=`$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -eq ${launch.pid} -or `+
      `$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and `+
      `$_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});`+
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${launch.port},8278)});`+
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining=JSON.parse(execFileSync("powershell.exe",["-NoProfile","-Command",script],
      {encoding:"utf8",windowsHide:true,timeout:20000}));
    assert.equal(remaining.processes.length,0); assert.equal(remaining.ports.length,0); return remaining;
  });
  report.status="PASS";
} catch(e) { report.status="FAILED"; report.error=String(e.stack||e); process.exitCode=1; }
finally {
  report.finishedAt=new Date().toISOString(); fs.writeFileSync(dest,JSON.stringify(report,null,2),{flag:"wx"});
  console.log(JSON.stringify({status:report.status,groups:report.groups.length,productConclusion:report.productConclusion,
    originalWrapperConclusion:report.originalWrapperConclusion,error:report.error}));
}
