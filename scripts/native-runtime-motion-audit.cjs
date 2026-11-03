"use strict";
// Re-evaluates raw native frames; never drives a UI or changes product files.
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const { common, transition, validateReport } = require("./lib/native-runtime-motion-oracle.cjs");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validateRecoveredSession(session, recovery, ids) {
  assert.equal(session.status, "FAILED");
  assert.equal(session.error, undefined);
  assert.equal(session.commands.length, 3);
  for (const c of session.commands.slice(0, 2)) {
    assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0);
  }
  const guard = session.commands[2];
  assert.equal(guard.status, "FAILED"); assert.equal(guard.exitCode, 1);
  assert.equal(path.basename(guard.log), "profile-process-guard.log");
  assert(guard.command.join(" ").includes("Player or owned WebView still active; refuse restoring user profile"));
  assert(session.cleanupError.includes("profile-process-guard"));
  assert.equal(recovery.status, "USER_PROFILES_RESTORED_ORIGINAL_SESSION_FAILED_PRESERVED");
  assert.equal(recovery.originalSessionSha256, ids.sessionSha);
  assert.equal(recovery.originalGuardSha256, ids.guardSha);
  assert.equal(recovery.restoration.sha256, ids.restorationSha);
  assert.equal(recovery.restoreScriptSha256, ids.restoreScriptSha);
  assert.equal(recovery.restoreExitCode, 0);
  assert.equal(recovery.originalFailureRewritten, false); assert.equal(recovery.processesTerminated, 0);
  assert.equal(recovery.originalGuardCause, "UNKNOWN_NO_MATCHING_PID_RECORDED");
  assert(recovery.observations.length >= 2);
  assert(recovery.observations.slice(-2).every(o => o.matches.length === 0));
  assert(Date.parse(recovery.at) > Date.parse(session.finishedAt));
  const times = recovery.observations.slice(-2).map(o => Date.parse(o.at));
  assert(times[0] >= Date.parse(recovery.at) && times[1] > times[0]
    && times[1] <= Date.parse(recovery.finishedAt));
  assert.deepEqual(recovery.command.slice(-4), ["-Action", "Restore", "-RunDirectory", recovery.run]);
  assert.equal(path.resolve(recovery.run), path.resolve(path.dirname(guard.log)));
  assert.equal(path.resolve(recovery.restoration.path), path.resolve(recovery.run, "profile-restoration.json"));
  return { functionalResult: "PASS", originalSession: "FAILED", originalCleanup: "FAILED",
    laterRecovery: "PASS", originalGuardCause: recovery.originalGuardCause };
}
function criticalFrames(m, episode, t) {
  const last = t.frames.at(-1);
  if (episode.name.startsWith("exit-modal-")) {
    assert(t.frames.filter(f => f.modal && f.backdrop.opacity > .01 && f.backdrop.opacity < .99).length >= 2);
    assert(t.frames.filter(f => f.modalExits.some(s => s.opacity > .01 && s.opacity < .99)).length >= 2);
    assert(t.frames.filter(f => f.modal).every(f => f.modalFocus && f.modalSiblingsInert));
    assert.equal(last.modalCount, 0); assert.equal(last.modalExits.length, 0); assert.equal(last.screen, "settings");
    assert(!last.unavailableFocus && last.focusTag !== "BODY");
    if (episode.name.includes("interrupted")) {
      assert.equal(t.inputs.filter(i => i.key === "Escape" && i.trusted).length, 2);
      assert.equal(t.inputs.filter(i => i.target === "open-exit-confirmation" && i.trusted).length, 2);
      assert(t.frames.every(f => f.modalCount <= 1));
    }
  }
  if (episode.name === "Escape-during-menu-cover") {
    assert.equal(t.inputs.filter(i => i.key === "Escape" && i.trusted).length, 2);
    assert(t.frames.some(f => f.phase === "covering" && f.black > 0 && f.black < 1));
    assert.equal(last.screen, "playing"); assert.equal(last.phase, "idle"); assert.equal(last.playerCount, 1);
  }
  if (episode.name === "quick-menu-expand-collapse") {
    assert.equal(m.layout, "agentvn");
    if (m.reduced) assert(t.frames.filter(f => f.quickButtons.some(b => b.opacity > .01 && b.opacity < .99)).length >= 2);
    else {
      const clips = t.frames.filter(f => f.quickSurface?.animations.some(a => a.name === "clip-path" && a.state === "running"));
      assert(clips.length >= 2 && new Set(clips.map(f => f.quickSurface.clipPath)).size >= 3);
    }
    assert(t.frames.every(f => f.screen === "playing" && f.black < .01));
  }
  if (episode.name.startsWith("settings-category-")) {
    const fade = t.frames.filter(f => f.categoryPhase === "crossfading");
    assert(fade.length >= 3 && fade.every(f => f.categoryDuration === (m.reduced ? 816 : 1632) && f.black < .01));
    assert(fade.some(f => f.category.opacity > .01 && f.category.opacity < .99));
    assert.equal(last.categoryId, episode.name.slice("settings-category-".length)); assert(!last.unavailableFocus);
  }
  if (episode.name === "title-to-playing" || episode.name === "main-menu-continue-playing") {
    const cover = t.frames.filter(f => f.launchClass?.includes("is-covering"));
    const reveal = t.frames.filter(f => f.launchClass?.includes("is-revealing"));
    assert(cover.some(f => f.launch.opacity > .01 && f.launch.opacity < .99));
    assert(reveal.some(f => f.launch.opacity > .01 && f.launch.opacity < .99));
    assert(t.frames.filter(f => f.launch).every(f => f.black < .01));
    assert.equal(last.screen, "playing"); assert(!last.launch); assert.equal(last.playerCount, 1);
  }
  if (episode.name === "rapid-menu-redirect") {
    assert.equal(last.screen, "about"); assert.equal(last.committed, "about"); assert.equal(last.phase, "idle");
    assert.equal(last.snapshots.length, 0); assert(!last.unavailableFocus);
    assert(t.frames.every(f => f.black < .01 && f.sameNavigation));
    assert(t.frames.some(f => f.surface.opacity > .01 && f.surface.opacity < .99));
  }
}
function validateCriticalTrace(m, e, t) {
  const row = { checks: [] }; common(row, t, m);
  if (e.timings) {
    const { from, to } = e.timings, menus = ["settings", "save_load", "history", "gallery", "about", "help"];
    transition(row, t, m, { from, to,
      style: m.layout === "renpy" && from !== "playing" && to !== "playing" ? "crossfade" : "blackout",
      stableNav: m.layout === "renpy" && menus.includes(from) && menus.includes(to) });
  }
  assert(row.checks.every(c => c.status === "PASS")); criticalFrames(m, e, t);
}
async function main() {
  const name = process.argv[2] || "motion-audit-01"; assert(/^motion-audit-\d{2}$/.test(name));
  const out = path.join(base, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_RUNTIME_MOTION_EVIDENCE_NOT_RELEASE_INSTALL_ANDROID", productChanges: 0, builds: 0, modelRequests: 0 };
  async function check(name, fn) {
    const r = { name, status: "RUNNING" }; report.checks.push(r);
    try { r.detail = await fn(); r.status = "PASS"; }
    catch (e) { r.status = "FAILED"; r.error = String(e.stack || e); throw e; }
  }
  try {
    const runs = ["motion-01", "motion-02"].map(name => {
      const dir = path.join(base, name);
      return { dir, session: read(path.join(dir, "session.json")), raw: read(path.join(dir, "motion.json")),
        journal: read(path.join(dir, "profile-protection.json")) };
    });
    const recoveryFile = path.join(base, "motion-recovery-01", "receipt.json");
    const recovery = read(recoveryFile);
    await check("Exact smoke/full matrices, nonempty business episodes and recorded native ownership", () => {
      for (const [i, r] of runs.entries()) validateReport(r.raw, i === 0);
      return { smokeCombinations: 4, smokeEpisodes: 76, mainCombinations: 24, mainEpisodes: 456,
        nativeLaunches: 4, editorOrDeviceClaim: false };
    });
    await check("Product/input/tool identities, each captured PNG's actual viewport/DPR/media and pixel dimensions", () => {
      for (const [i, r] of runs.entries()) {
        if (i === 0) {
          assert.equal(r.session.status, "CURRENT_NATIVE_RUNTIME_MOTION_SMOKE_PASS");
          assert.equal(r.session.commands.length, 4);
          assert(r.session.commands.every(c => c.exitCode === 0 && c.status === "PASS"));
          assert.equal(sha(r.session.profileRestoration.path), r.session.profileRestoration.sha256);
        } else {
          report.outcomes = validateRecoveredSession(r.session, recovery, {
            sessionSha: sha(path.join(r.dir, "session.json")),
            guardSha: sha(path.join(r.dir, "profile-process-guard.log")),
            restorationSha: sha(path.join(r.dir, "profile-restoration.json")),
            restoreScriptSha: sha(path.join(r.dir, "native-dev-preview-profile.ps1")),
          });
          report.recovery = describe(recoveryFile);
        }
        for (const f of [...r.session.products, ...r.session.tools, r.session.originalExport, r.session.originalFixture,
          ...r.raw.sources]) assert.equal(sha(f.path), f.sha256, f.path);
        for (const l of r.raw.launches) assert.equal(l.executableSha256, r.session.products[2].sha256);
        assert.equal(r.raw.screenshots.length, r.raw.matrix.length);
        for (const m of r.raw.matrix) {
          const s = r.raw.screenshots.find(s => path.basename(s.path) === `${m.layout}-${m.key}-final.png`); assert(s);
          assert.deepEqual(s.before, s.after); assert.equal(sha(s.path), s.sha256);
          assert.equal(s.before.width, m.width); assert.equal(s.before.height, m.height);
          assert(Math.abs(s.before.dpr - m.dpr) <= 1e-6); assert.equal(s.before.reduced, m.reduced);
          const b = fs.readFileSync(s.path);
          assert.equal(b.readUInt32BE(16), m.width * m.dpr); assert.equal(b.readUInt32BE(20), m.height * m.dpr);
        }
      }
      return { mainPngs: 24, smokePngs: 4, floatingDprTailPreserved: true, productChanges: 0 };
    });
    await check("Every raw trace, original three defects and close/reopen/focus/ghost safety re-evaluated", () => {
      let frames = 0, traces = 0;
      for (const r of runs) for (const m of r.raw.matrix) {
        if (m.layout === "renpy") {
          const buttons = m.quickGeometry.buttons; assert.equal(buttons.length, 8);
          for (const b of buttons) {
            assert(b.hit && Math.abs(b.rect.top - buttons[0].rect.top) <= 1);
            assert(b.rect.left >= -1 && b.rect.right <= m.width + 1);
          }
          for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++)
            assert(Math.min(buttons[i].rect.right, buttons[j].rect.right)
              - Math.max(buttons[i].rect.left, buttons[j].rect.left) <= 1);
        }
        for (const e of m.episodes) {
        assert.equal(sha(e.trace.path), e.trace.sha256);
        const t = JSON.parse(zlib.gunzipSync(fs.readFileSync(e.trace.path)));
        assert.equal(t.name, e.name); assert.equal(t.frames.length, e.trace.frames);
        validateCriticalTrace(m, e, t); frames += t.frames.length; traces++;
        if (e.timings) {
          assert.equal(e.timings.expectedMs, m.reduced ? 816 : 1632);
          assert(t.frames.filter(f => !["idle", "loading"].includes(f.phase)).every(f =>
            f.duration === e.timings.expectedMs && f.coverMs + f.revealMs === e.timings.expectedMs));
        }
        }
      }
      return { rawTraces: traces, frames, sourceStyleOrTimeOverrides: false };
    });
    await check("Original user directory identities/bytes restored; recorded Players, CDP ports and owned WebViews absent", () => {
      for (const r of runs) {
        const restored = read(path.join(r.dir, "profile-restoration.json"));
        assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
        for (const j of r.journal.records) {
          assert(!fs.existsSync(j.held)); if (j.storage === "NativeRoaming") assert(!fs.existsSync(j.retained));
          const actual = restored.restored.find(p => p.original === j.original); assert(actual);
          assert.equal(actual.directoryId, j.directoryId); assert.deepEqual(actual.files, j.files);
          for (const f of j.files) assert.equal(sha(path.join(j.original, f.relative)), f.sha256);
        }
      }
      const launches = runs.flatMap(r => r.raw.launches), ports = launches.map(l => l.port);
      const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        "$all=@(Get-CimInstance Win32_Process);" +
        "$p=@($all|Select-Object ProcessId,@{n='CreatedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}});" +
        "$w=@($all|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*motion-*'}|Select-Object ProcessId);" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "@{processes=$p;webviews=$w;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(ps.status, 0, ps.stderr); const current = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
      for (const l of launches) assert(!current.processes.some(p => p.ProcessId === l.identity.ProcessId
        && p.CreatedMs === Number(l.identity.CreationDate.match(/\d+/)[0])));
      assert.deepEqual(current.webviews, []); assert.deepEqual(current.listeners, []);
      return { recordedRoots: launches.length, ports, restoredProfileSessions: 2, normalCloseClaim: false };
    });
    await check("Frozen installation evidence and original failures remain unchanged", () => {
      const frozenFile = "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json", frozen = read(frozenFile);
      for (const f of frozen.artifactChecks) assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(frozen.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
      return { frozen: describe(frozenFile), counts: frozen.historical.counts,
        oldInstallationResultsNotReplaced: true };
    });
    await check("Evidence oracle rejects empty, incomplete and false native-motion passes", () => {
      const file = path.resolve("scripts/native-runtime-motion-audit-test.cjs"), log = path.join(out, "validator.log");
      const result = spawnSync(process.execPath, [file], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
      assert.ifError(result.error); assert.equal(result.status, 0, log); assert(result.stdout.includes("PASS"));
      return { command: [process.execPath, file], source: describe(file), log: describe(log), exitCode: result.status };
    });
    report.status = "EVIDENCE_VERIFIED_FUNCTIONAL_PASS_ORIGINAL_CLEANUP_FAILED_RECOVERED";
    report.remaining = ["Actual new installation/export", "Android back/motion", "Physical window close",
      "Gallery/asset-specific transitions and screen-loader fault matrix not covered by this fixture", "Complete regression"];
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.source = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, out }, null, 2));
  }
}
module.exports = { validateCriticalTrace, validateRecoveredSession };
if (require.main === module) main();
