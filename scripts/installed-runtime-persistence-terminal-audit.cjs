"use strict";
// Evidence/safety audit, not a product-fix or a green replacement of raw failures.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-runtime-persistence-20261018-01");
const checkpoint = "F:/AgentVN-QA-Runtime-Persistence-Checkpoint-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const destination = process.argv[2]; assert(destination && !fs.existsSync(destination));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", autosaveLimitedStatus: "RUNNING",
  nvlCapacityLimitedStatus: "RUNNING", nvlBranchStatus: "FAILED", completeRuntimeStatus: "FAILED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshotCount: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(p) { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function matrix(rows, layouts) {
  assert.equal(rows.length, layouts.length * 12);
  const keys = new Set(rows.map(r => `${r.layout}:${r.width}:${r.height}:${r.dpr}:${r.reduced}`));
  assert.equal(keys.size, rows.length);
  for (const l of layouts) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const d of [1, 2]) for (const m of [false, true]) assert(keys.has(`${l}:${w}:${h}:${d}:${m}`));
}
const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
  && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
(async () => {
  const prep = load(path.join(run, "preparation.json")), fixture = load(path.join(run, "fixtures.json"));
  const exportFirst = load(path.join(run, "export-01/report.json")), exported = load(path.join(run, "export-02/report.json"));
  const first = load(path.join(run, "runtime-01/report.json")), second = load(path.join(run, "runtime-02/report.json"));
  const third = load(path.join(run, "runtime-03/report.json")), all = [first, second, third];
  await check("Frozen installed Editor/Player and560 product source files unchanged; real UI exports retain exact script, layout and asset bytes", async () => {
    assert.equal(prep.status, "PASS"); assert.equal(fixture.status, "PASS"); assert.equal(sha(fixture.input), fixture.inputSha256);
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560); for (const f of frozen.source) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(exported.status, "PASS"); assert.equal(exported.checks.length, 3);
    assert(exported.checks.every(c => c.status === "PASS")); assert.equal(exported.cartridges.length, 2);
    const scripts = [];
    for (const c of exported.cartridges) {
      assert.equal(sha(c.path), c.sha256); const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      const bytes = await zip.file("script.json").async("nodebuffer"), script = JSON.parse(bytes);
      const skin = await zip.file("ui/layout.json").async("nodebuffer");
      const manifestBytes = await zip.file("manifest.json").async("nodebuffer"), manifest = JSON.parse(manifestBytes);
      assert.equal(sha256(bytes), c.scriptSha256); assert.equal(sha256(skin), c.layoutSha256);
      assert.equal(sha256(manifestBytes), c.manifestSha256); assert.equal(manifest.game_id, fixture.projectId);
      assert.equal(JSON.parse(skin).layout_type || "agentvn", c.layout);
      assert.equal(script.entry_scene_id, "qa_entry"); assert.equal(script.default_dialog_presentation, "nvl");
      const scene = script.scenes.find(s => s.scene_id === "nvl_capacity");
      assert.deepEqual(scene.commands.filter(c => c.type === "narration").map(c => c.text), fixture.capacity.text);
      assert.equal(scene.commands.find(c => c.type === "choice").choices.length, 3);
      const sprite = manifest.assets.find(a => a.asset_id === "qa_actor"); assert(sprite);
      assert.equal(sha256(await zip.file(sprite.path).async("nodebuffer")), fixture.spriteSha256);
      scripts.push(c.scriptSha256);
    }
    assert.equal(scripts[0], scripts[1]);
    for (const r of [exportFirst, exported, ...all]) {
      assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0); assert.equal(r.pageErrors.length, 0);
    }
    for (const r of all) {
      assert.equal(sha(r.source.path), r.source.sha256); assert.equal(sha(r.fixture.path), r.fixture.sha256);
      for (const l of r.launches) {
        assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(prep.installRoot, "agentvn-player.exe"));
        assert.equal(l.library.storage.portable, false); assert(l.library.controlledPublicNativePreparation);
      }
    }
    return { productFiles: 560, nativeExports: 2, controlledProjectAndLibrarySeed: true,
      standaloneWindowsSetupAndroidClaim: false, noRealModelCalls: true };
  });
  await check("Original export and runtime failures preserved; test-oracle corrections traceable to archived tools", () => {
    assert.equal(exportFirst.status, "FAILED"); assert.equal(exportFirst.checks[1].status, "FAILED");
    assert(exportFirst.error.includes("dialog_presentation"));
    assert.equal(first.status, "FAILED"); assert.equal(first.checks.length, 9);
    assert.equal(first.checks[5].status, "FAILED");
    assert.equal(first.checks[5].observed.loaded.total, 24);
    assert(first.layoutErrors.some(e => e.layout === "renpy" && e.error.includes("strict mode violation")));
    for (const t of first.tools) {
      const archived = path.join(checkpoint, path.basename(t.path, ".cjs") + "-first-run.cjs");
      assert.equal(sha(archived), t.sha256);
    }
    for (const r of [second, third]) {
      assert.equal(r.status, "FAILED"); assert(!r.error && !r.layoutErrors && !r.cleanupError);
      assert.equal(sha(r.continuation.path), r.continuation.sha256); assert.equal(r.continuation.originalStatus, "FAILED");
      for (const t of r.tools) assert.equal(sha(t.path), t.sha256);
    }
    assert.equal(second.checks.length, 10); assert.equal(third.checks.length, 4);
    assert.equal(third.subset.nvlFollowup, true); assert.equal(second.subset.renpyOnly, true);
    return { retainedFailedReports: 4, rawFailuresNotRewritten: true,
      toolCorrections: ["reachable export legitimately prunes unreachable characters",
        "same-title library buttons are selected by verified native installId/order",
        "post-load rollback must follow a new real checkpoint, not assume serialized pre-restart rollback history"] };
  });
  await check("Both layouts actually persist autosave off/on across native process restarts, threshold writes and confirmed exits", () => {
    for (const r of [first, second]) {
      assert(r.checks.slice(0, 4).every(c => c.status === "PASS"));
      const off = r.checks[0].detail, disabled = r.checks[1].detail, enabled = r.checks[2].detail, continued = r.checks[3].detail;
      assert.equal(off.change.after.autoSaveEnabled, false); assert.equal(off.change.after.textSpeedCps, 0);
      assert.deepEqual(off.after, off.before); assert.equal(off.nativeExit, true);
      assert.equal(disabled.prefs.autoSaveEnabled, false); assert.equal(disabled.prefs.textSpeedCps, 0);
      assert.equal(disabled.checkpoints.length, 15); assert(disabled.checkpoints.every(c => c.autos === 0));
      assert.deepEqual(disabled.after, disabled.before);
      assert.equal(enabled.change.after.autoSaveEnabled, true);
      assert(enabled.thresholdAutos.some(a => a.scene_id === "saves" && a.command_index >= 9 && a.command_index <= 14));
      assert.equal(enabled.exitSavedCommand, 14);
      assert.equal(continued.prefs.autoSaveEnabled, true); assert.equal(continued.restoredCommand, 14);
      assert(continued.autos.some(a => a.scene_id === "saves" && a.command_index === 14));
      assert.equal(r.launches.filter(l => l.cleanup.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY").length, 2);
      assert.notEqual(r.launches[0].pid, r.launches[1].pid); assert.notEqual(r.launches[1].pid, r.launches[2].pid);
      const retained = r.retained.filter(f => f.layout === r.checks[0].layout && /^auto-/.test(f.name));
      assert(retained.some(f => f.data.scene_id === "saves" && f.data.command_index === 14));
    }
    return { layouts: 2, assertedBusinessCases: 8, actualConfirmedExits: 4,
      viewport: "1920x1080/DPR1/no-preference", fullExitFailureACLAndPhysicalWindowClose: "NOT_RUN" };
  });
  await check("24 NVL lines page without shrinking, native save/restart/load and newly created rollback checkpoints restore exact content", () => {
    for (const r of [first, second]) {
      const c = r.checks[4]; assert.equal(c.status, "PASS"); assert.equal(c.detail.pages.length, 24);
      assert.equal(c.detail.mismatches.length, 0); assert.equal(c.detail.pageFailures.length, 0);
      for (const [i, p] of c.detail.pages.entries()) {
        assert.equal(p.total, i + 1); assert.equal(p.lines.at(-1).text, fixture.capacity.text[i]);
        assert(p.lines.every(l => l.font >= 12)); assert(p.scroll.height <= p.scroll.clientHeight + 2);
      }
      assert(c.detail.pages.at(-1).pageCount > 1);
    }
    for (const c of [second.checks[5], third.checks[0]]) {
      assert.equal(c.status, "PASS"); const d = c.detail;
      assert.equal(d.before.total, 24); assert.equal(d.loaded.total, 24);
      assert.equal(d.before.pageCount, d.loaded.pageCount);
      assert.deepEqual(d.loaded.lines.map(l => l.text), d.before.lines.map(l => l.text));
      assert.deepEqual(d.stored.nvl_page.map(l => l.text), fixture.capacity.text);
      assert.equal(d.restartIsActualNativeProcess, true);
    }
    const rows = [first, second].flatMap(r => r.matrix); matrix(rows, ["agentvn", "renpy"]);
    assert(rows.every(r => r.status === "PASS" && r.nvl.total === 24));
    return { sequentialAdvances: 48, fullPageGeometryCombinations: rows.length, nativeRestoreCases: 2,
      pageCountsAt1080p: [first, second].map(r => ({ layout: r.checks[4].layout, pages: r.checks[4].detail.pages.at(-1).pageCount })),
      noVoiceFixture: true, voiceReplayAcceptance: "NOT_RUN" };
  });
  await check("NVL-01 product failure independently reconfirmed in24 settled-frame combinations, distinct from real branch/clear success", () => {
    const rows = [second.checks[9], third.checks[3]].flatMap(c => c.observed); matrix(rows, ["agentvn", "renpy"]);
    const summary = [];
    for (const r of rows) {
      assert.equal(r.status, "FAILED"); assert.equal(r.actualChoiceAndClear, "PASS");
      assert.equal(r.after.total, 1); assert(r.after.lines[0].text.includes("NVL_AFTER："));
      const b = r.geometry.nvl.panel, choices = r.geometry.choices; assert.equal(choices.length, 3);
      assert(choices.every(c => c.hit && !c.disabled));
      const outside = choices.filter(c => c.rect.x < b.x - 1 || c.rect.y < b.y - 1
        || c.rect.right > b.right + 1 || c.rect.bottom > b.bottom + 1);
      const textOverlaps = choices.flatMap(c => r.geometry.nvl.lines.filter(l => overlaps(c.rect, l.rect)));
      assert.equal(outside.length, r.outside.length); assert.equal(textOverlaps.length, r.overlaps.length);
      assert(outside.length > 0); if (r.width < 3840) assert(textOverlaps.length > 0);
      summary.push({ layout: r.layout, width: r.width, height: r.height, dpr: r.dpr, reduced: r.reduced,
        outside: outside.length, textOverlaps: textOverlaps.length, geometryStatus: "FAILED", actualChoiceAndClear: "PASS" });
    }
    for (const c of [first.checks[8], second.checks[8], third.checks[2]]) {
      assert.equal(c.status, "PASS"); assert.equal(c.detail.all24LinesExactlyOnce, true);
      for (const text of fixture.capacity.text) assert.equal(c.detail.historyEntries.filter(t => t === text).length, 1);
    }
    report.branchMatrix = summary;
    return { defect: "NVL-01", failedGeometryCombinations: rows.length,
      realChoiceAndNewSceneClearPassed: rows.length, noProductRepair: true,
      independentEvidencePassDoesNotMeanProductPass: true };
  });
  await check("Every native screenshot has matching before/after WebView parameters, physical PNG pixel dimensions and hash; raw saves retained", () => {
    for (const r of [exportFirst, exported, ...all]) for (const s of r.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
      assert([1, 2].includes(s.before.dpr)); report.screenshotCount++;
    }
    assert(report.screenshotCount >= 70);
    for (const r of all) for (const f of r.retained) {
      assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
    }
    return { rawPNGs: report.screenshotCount, actualWebViewViewportSimulation: true, physical4KMonitorClaim: false,
      retainedNativeFiles: all.flatMap(r => r.retained).length };
  });
  await check("All native processes ended;4 original profiles/55 bytes restored, DB/Dev/pendingMSI preserved and ports empty", () => {
    const restored = load(path.join(run, "profile-restoration.json")); assert.equal(restored.status, "PASS");
    const stopped = load(path.join(run, "editor-export-stop.json")); assert.equal(stopped.status, "PASS");
    assert.equal(stopped.after.length, 0);
    const launches = all.flatMap(r => r.launches); assert.equal(launches.length, 11);
    for (const l of launches) assert.equal(l.cleanup.status, "PASS");
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = load(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const editor = load(path.join(run, "launch.json"));
    const ports = [8278, editor.cdpPort, editor.playerCdpPort, ...launches.map(l => l.port)];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { nativePlayerLaunches: launches.length, originalFiles: count, originalDBAndDevUnchanged: true,
      pendingMSIUnchanged: true, portsChecked: ports, ...state };
  });
  await check("Supporting NVL/exit/evidence tests and changed test-tool parsers pass; source contracts do not replace native failures", () => {
    const tests = ["nvl-runtime-acceptance.cjs", "runtime-exit-flow-test.cjs", "runtime-window-close-test.cjs", "full-regression-evidence-test.cjs"];
    const parsers = ["installed-runtime-persistence-fixtures.cjs", "installed-runtime-persistence-playwright.cjs",
      "lib/installed-runtime-session.cjs", "installed-runtime-abilities-export.cjs", "installed-runtime-persistence-terminal-audit.cjs"];
    const commands = [...tests.map(f => [`scripts/${f}`]), ...parsers.map(f => ["--check", `scripts/${f}`])];
    for (const [i, args] of commands.entries()) {
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `${path.basename(destination, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log);
      if (i < tests.length) assert((p.stdout || "").includes("PASS"), "No empty source-test PASS");
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const log = path.join(run, `${path.basename(destination, ".json")}-ps-parser.log`);
    fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
    report.commands.push({ executable: "powershell.exe", exitCode: p.status, log, sha256: sha(log) });
    assert.equal(p.status, 0, p.stderr);
    return { sourceTests: tests.length, jsParsers: parsers.length, psParsers: 2, noEmptyMatrix: true };
  });
  assert.equal(report.checks.length, 8); assert(report.checks.every(c => c.status === "PASS"));
  report.status = report.evidenceStatus = report.autosaveLimitedStatus = report.nvlCapacityLimitedStatus = "PASS";
  report.remaining = { independentWindowsExport: "BLOCKED_BY_NATIVE_OUTPUT_PICKER", standaloneSavesACLSetup: "NOT_RUN",
    android: "NOT_RUN", modelTasks: "NOT_RUN", finalProject: "NOT_RUN", oldProductFailures: "FAILED_UNCHANGED" };
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    autosaveLimitedStatus: report.autosaveLimitedStatus, nvlCapacityLimitedStatus: report.nvlCapacityLimitedStatus,
    nvlBranchStatus: report.nvlBranchStatus, checks: report.checks.length,
    screenshotCount: report.screenshotCount, error: report.error, destination }, null, 2));
});
