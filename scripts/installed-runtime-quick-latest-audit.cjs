"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process"), { sha } = require("./lib/installed-runtime-session.cjs");
const { validateDistinctLatest } = require("./installed-runtime-quick-latest-evidence.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-latest-20261019-01";
const dest = `${base}/audit-01.json`; assert(!fs.existsSync(dest));
const result = { status: "RUNNING", at: new Date().toISOString(), checks: [], sources: [],
  scope: "EVIDENCE_RESTORATION_NOT_ADDITIONAL_PRODUCT_TESTS" };
const read = p => { result.sources.push({ path: p, sha256: sha(p) }); return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); };
function check(name, fn) {
  const r = { name, status: "RUNNING" }; result.checks.push(r);
  try { r.detail = fn(); r.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); throw e; }
}
try {
  const raw = read(`${base}/player-01.json`), execution = read(`${base}/execution-01.json`);
  const prep = read(`${base}/preparation.json`), restored = read(`${base}/profile-restoration.json`);
  result.sourceConclusion = raw.status;
  assert(raw.finishedAt && execution.finishedAt); assert(["PASS", "FAILED"].includes(raw.status));
  check("Exact12 terminal combinations and distinguishable latest-valid recovery, not merely any valid save", () => {
    assert.equal(raw.cells.length, 12); const keys = new Set(), evidence = [];
    for (const c of raw.cells) {
      const key = `${c.viewport.width}x${c.viewport.height}-dpr${c.viewport.dpr}-${c.viewport.reduced ? "reduced" : "normal"}`;
      assert.equal(c.name, key); assert(!keys.has(key)); keys.add(key); assert(c.finishedAt);
      if (c.status === "PASS") evidence.push({ cell: c.name, ...validateDistinctLatest(c) });
      else assert.equal(typeof c.error, "string");
    }
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const m of ["normal", "reduced"])
      assert(keys.has(`${w}x${h}-dpr${dpr}-${m}`));
    assert.equal(raw.status, raw.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED");
    assert.equal(execution.status, raw.status); assert.equal(execution.sourceConclusion, raw.status);
    assert.equal(sha(execution.runner.path), execution.runner.sha256); assert.deepEqual(raw.pageErrors, []);
    return evidence;
  });
  check("Every controlled newest-save mutation changes only scene_id and actual original bytes restored", () => {
    const original = prep.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    const tested = restored.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    for (const f of raw.faults) {
      assert.equal(f.restoration, "PASS"); assert.deepEqual(f.injected, { ...f.original, scene_id: "__qa_missing_scene_20261019__" });
      assert.equal(sha(f.retained), f.originalSha256);
      const relative = path.relative(original.original, f.file); assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      assert.equal(sha(path.join(tested.testHeld, relative)), f.originalSha256);
    }
    if (raw.status === "PASS") assert.equal(raw.faults.length, 12); return { restoredMutations: raw.faults.length };
  });
  check("Actual PNG parameters, final native saves and library cartridges match independent retained bytes", () => {
    for (const s of raw.sources) assert.equal(sha(s.path), s.sha256);
    for (const s of raw.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    for (const s of raw.nativeSaves) assert.equal(sha(s.retained), s.sha256);
    if (raw.status === "PASS") { assert.equal(raw.screenshots.length, 12); assert.equal(raw.nativeSaves.length, 36); }
    const original = prep.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    const tested = restored.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    const source = read("D:/AgentVN/output/installed-runtime-abilities-20261018-01/export-03/report.json");
    for (const l of raw.launches) {
      const relative = path.relative(original.original, l.library.record.cartridgePath); assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      assert.equal(sha(path.join(tested.testHeld, relative)), source.cartridges.find(c => c.layout === l.layout).sha256);
    }
    return { pngs: raw.screenshots.length, saveCopies: raw.nativeSaves.length, launches: raw.launches.length };
  });
  check("Four original default profiles and55 independent baseline files recovered", () => {
    assert.equal(restored.status, "PASS"); assert.equal(execution.profileRestoration, "PASS"); assert(!raw.cleanupError && !execution.cleanupError);
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); return { files: count, profiles: 4 };
  });
  check("Frozen binaries and560 product sources maintain earlier authorized identities; no builds or paid calls", () => {
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const frozen = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const allowed = new Map(read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json").sources
      .map(s => [path.resolve("D:/AgentVN", s.file), s.sha256]));
    assert.equal(frozen.source.length, 560); assert.equal(allowed.size, 7);
    for (const s of frozen.source) assert.equal(sha(s.path), allowed.get(path.resolve(s.path)) || s.sha256);
    return { files: 560, newProductChanges: 0, builds: 0, paidCalls: 0 };
  });
  check("Exact owned Player processes and ports absent, no remaining AgentVN product processes", () => {
    assert(raw.launches.length > 0 && raw.launches.every(l => l.cleanup?.status === "PASS"));
    const pids = raw.launches.map(l => l.pid).join(","), ports = raw.launches.map(l => l.port).join(",");
    const command = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(${pids}) -or $_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ` +
      `($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});` +
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports})});` +
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true, encoding: "utf8", timeout: 20000 }));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.ports.length, 0); return remaining;
  });
  result.status = "PASS";
} catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, sourceConclusion: result.sourceConclusion, groups: result.checks.length, dest, error: result.error }));
}
