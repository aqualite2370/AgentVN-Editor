"use strict";
// Independent terminal audit. Source FAILED remains FAILED even if its
// attribution/restoration checks pass. Never edit the running UI runner.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validatePendingObservation } = require("./installed-runtime-quick-observation.cjs");
const base = "D:/AgentVN/output/installed-runtime-quick-gaps-20261019-01";
const attempt = process.argv[2] || "01"; assert(/^\d{2}$/.test(attempt));
const dest = `${base}/audit-${attempt}.json`; assert(!fs.existsSync(dest));
const result = { status: "RUNNING", at: new Date().toISOString(), sourceConclusion: "UNPROVEN", checks: [], sources: [], error: null,
  scope: "EVIDENCE_AND_RESTORATION_NOT_EXTRA_UI_CASES" };
const read = p => { result.sources.push({ path: p, sha256: sha(p) }); return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); };
function check(name, fn) {
  const row = { name, status: "RUNNING" }; result.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
try {
  const raw = read(`${base}/player-01.json`), execution = read(`${base}/execution-01.json`);
  const prep = read(`${base}/preparation.json`), restored = read(`${base}/profile-restoration.json`);
  assert(raw.finishedAt && execution.finishedAt); assert(["PASS", "FAILED"].includes(raw.status)); result.sourceConclusion = raw.status;
  check("Nonempty exact 12-combination matrix and35 new UI checks, old failures not overwritten", () => {
    assert.equal(raw.cells.length, 12); assert.equal(raw.expectedCells, 12);
    const keys = new Set(); let checks = 0, passedChecks = 0;
    for (const [index, c] of raw.cells.entries()) {
      const name = `${c.viewport.width}x${c.viewport.height}-dpr${c.viewport.dpr}-${c.viewport.reduced ? "reduced" : "normal"}`;
      assert.equal(c.name, name); assert(!keys.has(name)); keys.add(name); assert(c.finishedAt);
      assert(["PASS", "FAILED"].includes(c.status));
      const required = index === 0 ? 2 : 3;
      if (c.status === "PASS") { assert.equal(c.checks.length, required); assert(c.checks.every(s => s.status === "PASS")); }
      else assert(c.error || c.checks.some(s => s.status === "FAILED"));
      for (const s of c.checks) { assert(s.finishedAt && ["PASS", "FAILED"].includes(s.status)); checks++; if (s.status === "PASS") passedChecks++; }
    }
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      assert(keys.has(`${w}x${h}-dpr${dpr}-${reduced ? "reduced" : "normal"}`));
    assert.equal(raw.status, raw.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED");
    assert.equal(execution.status, raw.status); assert.equal(execution.sourceConclusion, raw.status);
    assert.equal(sha(execution.runner.path), execution.runner.sha256); assert.equal(raw.runner.sha256, execution.runner.sha256);
    assert.deepEqual(raw.pageErrors, []); if (raw.status === "PASS") assert.equal(checks, 35);
    return { combinations: keys.size, newChecks: checks, passingChecks: passedChecks, expectedChecks: 35 };
  });
  check("Passing pending cases include actual trusted second pointer during real busy, one file replacement, next accepted save", () => {
    let passed = 0;
    for (const c of raw.cells) {
      const s = c.checks[0]; if (s?.status !== "PASS") continue;
      const d = s.detail; assert.deepEqual(validatePendingObservation(d.observed), d.timing);
      assert.equal(d.before.length, 6); assert.equal(d.after.length, 6); assert.equal(d.changed.length, 1);
      const added = d.after.filter(a => !d.before.some(b => b.save_id === a.save_id)); assert.equal(added.length, 1);
      assert.notEqual(d.nextAcceptedAfterCompletion.save_id, added[0].save_id); assert.equal(d.timing.mockDelay, false); passed++;
    }
    if (raw.status === "PASS") assert.equal(passed, 12); return { passed, noArtificialDelay: true };
  });
  check("Passing real sharing-denial cases preserve six files, release locks and retry; existing baseline source is explicitly referenced", () => {
    let passed = 0;
    const prior = read(raw.cells[0].existingWriteDenial.path);
    assert.equal(sha(raw.cells[0].existingWriteDenial.path), raw.cells[0].existingWriteDenial.sha256);
    assert.equal(prior.status, "FAILED", "Original overall failure is not rewritten");
    assert(prior.checks.some(c => c.name.startsWith("Real Windows sharing denial") && c.status === "PASS"));
    assert.equal(prior.exe.sha256, sha(path.join(prep.installRoot, "agentvn-player.exe")));
    for (const c of raw.cells.slice(1)) {
      const s = c.checks[1]; if (s?.status !== "PASS") continue;
      const d = s.detail, l = raw.locks.find(l => l.cell === c.name);
      assert.equal(d.method, "REAL_WINDOWS_SHARING_DENIAL_NOT_ACL"); assert.equal(d.before.length, 6); assert.equal(d.after.length, 6);
      assert.equal(l.cleanup, "PASS"); assert.equal(l.exitCode, 0);
      assert.equal(fs.readFileSync(l.readyFile, "utf8"), "READ_SHARED_WRITE_DELETE_DENIED");
      assert.equal(fs.readFileSync(l.releaseFile, "utf8"), "RELEASE");
      assert.equal(d.observed.clicks.length, 1); assert(d.observed.clicks[0].trusted);
      assert(d.failure.includes("快存失败") && d.failure.includes("不会回退"));
      const changed = d.after.filter(f => d.before.find(b => b.name === f.name)?.sha256 !== f.sha256);
      assert.equal(changed.length, 1); assert.equal(changed[0].path, d.target);
      assert.equal(d.retried.slot, Number(path.basename(d.target).match(/\d+/)[0])); passed++;
    }
    assert(raw.locks.every(l => l.cleanup === "PASS")); if (raw.status === "PASS") assert.equal(passed, 11);
    return { newPassingCombinations: passed, priorBaselineReferenced: true, aclOrStandaloneClaim: false };
  });
  check("Passing semantic-invalid newest cases retain six parsable saves, cancel correctly and recover valid command0 after restart", () => {
    let passed = 0;
    for (const c of raw.cells) {
      const s = c.checks.at(-1); if (s?.status !== "PASS") continue;
      const d = s.detail, f = raw.faults.find(f => f.cell === c.name);
      assert.equal(d.originalNewest.command_index, 1); assert.equal(d.latestValid.command_index, 0);
      assert.equal(d.before.command, 1); assert.equal(d.restored.command, 0);
      assert.equal(d.nativeList.length, 6); assert.equal(d.injected.scene_id, "__qa_missing_scene_20261019__");
      const original = read(f.retained), expected = { ...original, scene_id: d.injected.scene_id };
      assert.deepEqual(d.injected, expected, "Only semantic scene field is fault-injected");
      assert.equal(sha(f.retained), f.originalSha256); assert.equal(f.restoration, "PASS"); assert.equal(d.restart, true);
      assert.equal(d.libraryReseedOnRestart, true); // Not falsely called unseeded recovery.
      passed++;
    }
    assert(raw.faults.every(f => f.restoration === "PASS")); if (raw.status === "PASS") assert.equal(passed, 12);
    return { newPassingCombinations: passed, mutation: "scene_id only; no malformed JSON or model" };
  });
  check("Native PNG metrics/pixels, retained save bytes and restored QA fault paths are independently verified", () => {
    const original = prep.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    const held = restored.profiles.find(p => p.app === "player" && p.kind === "Roaming");
    for (const s of raw.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(b.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    for (const s of raw.nativeSaves) { assert.equal(sha(s.retained), s.sha256); assert.equal(read(s.retained).save_id, s.data.save_id); }
    const retainedPath = p => {
      const relative = path.relative(original.original, p);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); return path.join(held.testHeld, relative);
    };
    for (const c of raw.cells) for (const f of c.finalNativeSaves || []) assert.equal(sha(retainedPath(f.path)), f.sha256);
    for (const f of raw.faults) assert.equal(sha(retainedPath(f.file)), f.originalSha256);
    for (const l of raw.launches) {
      assert.equal(l.library.controlledPublicNativePreparation, true);
      const source = read("D:/AgentVN/output/installed-runtime-abilities-20261018-01/export-03/report.json");
      assert.equal(sha(retainedPath(l.library.record.cartridgePath)), source.cartridges.find(c => c.layout === l.layout).sha256);
    }
    assert(raw.screenshots.length > 0); return { pngs: raw.screenshots.length, retainedNativeSaves: raw.nativeSaves.length };
  });
  check("All four original default profiles and55 original hashes match independent backups after restore", () => {
    assert.equal(prep.blankDefaultProfiles, true); assert.equal(restored.status, "PASS");
    assert.equal(execution.profileRestoration, "PASS"); assert(!execution.cleanupError && !raw.cleanupError);
    let files = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); files++; }
    }
    assert.equal(files, 55); return { profiles: prep.profiles.length, independentOriginalFiles: files };
  });
  check("Frozen installed binaries, current Dev and560 sources unchanged except seven earlier authorized Editor files", () => {
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha("D:/AgentVN/AgentVN Dev.exe"), prep.originalDevSha256);
    const baseline = read("D:/AgentVN/output/full-regression-20261017-01/candidate-02/manifest.json");
    const prior = read("D:/AgentVN/output/editor-selection-mask-20261019-01/terminal-audit-02.json");
    const allowed = new Map(prior.sources.map(s => [path.resolve("D:/AgentVN", s.file), s.sha256]));
    assert.equal(baseline.source.length, 560); assert.equal(allowed.size, 7);
    for (const f of baseline.source) assert.equal(sha(f.path), allowed.get(path.resolve(f.path)) || f.sha256, f.path);
    return { files: 560, earlierAuthorizedChanges: 7, newProductChanges: 0, builds: 0, models: 0 };
  });
  check("Owned Player and lock processes, debugger ports and all AgentVN product processes are absent", () => {
    assert(raw.launches.length > 0 && raw.launches.every(l => l.cleanup?.status === "PASS"));
    const pids = [...raw.launches.map(l => l.pid), ...raw.locks.map(l => l.pid)];
    const ports = raw.launches.map(l => l.port);
    const command = `$p=@(Get-CimInstance Win32_Process|Where-Object {$_.ProcessId -in @(${pids.join(",")}) -or ` +
      `$_.Name -match '(?i)creator-backend|agentvn.*\\.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')});` +
      `$t=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})});` +
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 4`;
    const remaining = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 20000 }));
    assert.equal(remaining.processes.length, 0); assert.equal(remaining.ports.length, 0); return remaining;
  });
  result.status = "PASS";
} catch (e) { result.status = "FAILED"; result.error = String(e.stack || e); process.exitCode = 1; }
finally {
  result.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(result, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, sourceConclusion: result.sourceConclusion, checks: result.checks.length, dest, error: result.error }));
}
