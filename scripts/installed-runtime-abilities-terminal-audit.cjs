"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-runtime-abilities-20261018-01");
const out = process.argv[2]; assert(out && !fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => sha256(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", runtimeAbilitiesStatus: "BLOCKED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshots: 0,
  productChanges: 0, realModelRequests: 0, error: null };
function load(relative) {
  const file = path.join(run, relative); report.inputs.push({ path: file, sha256: sha(file) }); return read(file);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const prep = load("preparation.json"), launch = load("launch.json"), backend = load("backend-ready.json");
  const invalid = load("fixtures.json"), fixture = load("fixtures-02.json");
  const export1 = load("export-01/report.json"), export2 = load("export-02/report.json"), exported = load("export-03/report.json");
  const first = load("abilities-01/report.json"), second = load("abilities-02/report.json");
  const agent = load("abilities-03/report.json"), renpy = load("abilities-04/report.json");
  const quick = load("quick-01/report.json"), crossFailed = load("cross-layout-01/report.json"),
    crossIdentityFailed = load("cross-layout-02/report.json"), cross = load("cross-layout-03/report.json");
  const all = [export1, export2, exported, first, second, agent, renpy, quick, crossFailed, crossIdentityFailed, cross];
  await check("Actual frozen installed Editor/packaged backend/Player and560 product sources have not changed", () => {
    for (const r of [prep, launch, backend, fixture, exported]) assert.equal(r.status, "PASS");
    assert.equal(sha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
    assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
    assert(!launch.manualBackendSpawn && !launch.dataDirectoryOverride && !launch.webviewDirectoryOverride);
    const frozen = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const source of frozen.source) assert.equal(sha(source.path), source.sha256);
    for (const r of [first, second, agent, renpy, quick, crossFailed, crossIdentityFailed, cross]) {
      assert.equal(sha(r.exe.path), r.exe.sha256); assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0);
      assert.equal(r.pageErrors.length, 0);
    }
    return { productFiles: 560, actualInstalledCandidate: "1.9.9", realModelRequests: 0, sourceBuildAcceptanceClaim: false };
  });
  await check("Original invalid fixture and all test-oracle/input failures remain FAILED with explicit corrections, not rewritten product results", () => {
    const old = read(invalid.input), corrected = read(fixture.input);
    assert.equal(sha(invalid.input), invalid.inputSha256); assert.equal(sha(fixture.input), fixture.inputSha256);
    const oldHide = old.nodes.find(n => n.id === "bubble").data.scene.commands.find(c => c.type === "sprite" && !c.visible);
    const newHide = corrected.nodes.find(n => n.id === "bubble").data.scene.commands.find(c => c.type === "sprite" && !c.visible);
    assert.equal(oldHide.sprite_id, undefined); assert.equal(newHide.sprite_id, "qa_actor");
    assert.equal(export1.status, "FAILED"); assert(export1.failureText.includes("reading 'replace'"));
    assert.equal(export2.status, "FAILED"); assert.equal(export2.checks[1].status, "PASS"); assert(export2.error.includes("intercepts pointer events"));
    assert.equal(first.status, "FAILED"); assert(first.checks.some(c => c.error?.includes("saveUI")));
    assert.equal(second.status, "FAILED"); assert(second.checks.some(c => c.error?.includes("进入气泡验收")));
    assert.equal(agent.status, "FAILED"); assert(agent.layoutErrors.some(e => e.layout === "renpy" && e.error.includes("reveal")));
    assert.equal(renpy.status, "FAILED"); assert(renpy.checks.at(-1).error.includes("'true' !== null"));
    assert.equal(crossFailed.status, "FAILED"); assert(crossFailed.error.includes("screenReady"));
    assert.equal(crossIdentityFailed.status, "FAILED"); assert(crossIdentityFailed.error.includes("fixture.projectId"));
    return { retainedFailures: ["export-01 invalid hidden sprite", "export-02 publish panel must close before options",
      "abilities-01 saved status is is-saved", "abilities-02 choice accessible name includes 选择",
      "abilities-03 short-line reveal raced natural completion", "abilities-04 persistence completes before UI busy clears",
      "cross-layout-01 clicked manual save instead of switching to read",
      "cross-layout-02 incorrectly expected standalone manifest game_id in existing library save identity"],
      crossLayout01Effect: "Only QA manual slot1 was overwritten with saves/command6; the failed report is retained; successful cross-layout continuation reads unmodified QA bubble slot2",
      productFixClaim: false };
  });
  await check("Both actual UI-exported cartridges preserve identical story identity, presentation settings and exact sprite bytes", async () => {
    assert.equal(exported.cartridges.length, 2);
    assert.equal(exported.previousEvidence.sha256, sha(exported.previousEvidence.path));
    assert.equal(exported.previousEvidence.status, "FAILED");
    const scripts = [];
    for (const c of exported.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      const m = JSON.parse(await zip.file("manifest.json").async("string"));
      const scriptBytes = await zip.file("script.json").async("nodebuffer"), s = JSON.parse(scriptBytes);
      const layout = await zip.file("ui/layout.json").async("nodebuffer");
      assert.equal(m.game_id, fixture.projectId); assert.equal(JSON.parse(layout).layout_type || "agentvn", c.layout);
      assert.equal(sha256(layout), c.layoutSha256); assert.equal(sha256(scriptBytes), c.scriptSha256); scripts.push(c.scriptSha256);
      assert.equal(s.default_dialog_presentation, "nvl");
      assert.equal(s.characters.find(c => c.character_id === "alice").dialog_presentation, "bubble");
      assert.equal(sha256(await zip.file(m.assets.find(a => a.asset_id === "qa_actor").path).async("nodebuffer")), fixture.spriteSha256);
    }
    assert.equal(scripts[0], scripts[1]);
    return { actualUIExports: 2, sameScriptSHA: scripts[0], normalProjectPickerClaim: false, windowsStandaloneExportClaim: false };
  });
  await check("Actual24 short-dialog/menu-control combinations and every raw native screenshot retain viewport/DPR/media/PNG dimensions", () => {
    assert.equal(first.matrix.length, 24);
    const keys = new Set();
    for (const row of first.matrix) {
      assert.equal(row.status, "PASS"); keys.add(`${row.layout}/${row.width}/${row.height}/${row.dpr}/${row.reduced}`);
      assert.equal(row.controls.length, row.layout === "renpy" ? 8 : 1);
      assert(row.controls.every(c => c.hit && c.x >= -1 && c.y >= -1 && c.right <= row.width + 1 && c.bottom <= row.height + 1));
      assert(row.dialog.overflow <= 1);
      if (row.layout === "renpy") assert(Math.max(...row.controls.map(c => c.y)) - Math.min(...row.controls.map(c => c.y)) < 1);
    }
    assert.equal(keys.size, 24);
    for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const r of [false, true]) assert(keys.has(`${l}/${w}/${h}/${d}/${r}`));
    for (const r of all) for (const s of r.screenshots || []) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshots++;
    }
    assert(report.screenshots >= 24);
    return { combinations: 24, rawPNGs: report.screenshots, physical4KClaim: false,
      fullNVLBubbleQuickBusiness12MatrixClaim: false, onlyShortDialogAndQuickControlMatrix: true };
  });
  await check("Both layouts' ordinary, long/extreme, NVL, bubble and native manual save/load/rollback cases have passing real-input evidence", () => {
    for (const [r, layout] of [[agent, "agentvn"], [renpy, "renpy"]]) {
      const cases = r.checks.filter(c => c.layout === layout).slice(0, 7);
      assert.equal(cases.length, 7); assert(cases.every(c => c.status === "PASS"));
      const short = cases[1].detail, long = cases[2].detail, extreme = cases[3].detail, nvl = cases[4].detail, bubble = cases[6].detail;
      assert.equal(short.fontMode, "configured"); assert.equal(short.pages, 1);
      assert.equal(long.fontMode, "adaptive"); assert(long.scale < 1 && long.scale > 0);
      for (const [item, text] of [[long, fixture.text.mid], [extreme, fixture.text.extreme], [bubble.long, fixture.text.bubbleLong]]) {
        assert.equal(item.geometry.map(p => p.text).join(""), text);
        assert.equal(item.geometry.length, item.pages);
        for (const p of item.geometry) {
          assert(p.scroll.actual <= p.scroll.client + 2 && p.scroll.actualWidth <= p.scroll.width + 1);
          assert(p.rect.x >= -1 && p.rect.y >= -1 && p.rect.right <= 1921 && p.rect.bottom <= 1081);
        }
      }
      assert(extreme.pages > 1); assert(bubble.long.pages > 1);
      assert.equal(nvl.stored.nvl_page.length, 3); assert.equal(nvl.stored.nvl_presentation_mode, "nvl");
      assert.deepEqual(nvl.restored.nvl, nvl.before.nvl);
      assert.equal(bubble.stored.nvl_presentation_mode, "bubble"); assert.equal(bubble.absent.anchor, "fallback");
      assert.equal(bubble.fixed.anchor, "fixed"); assert(bubble.moved.rect.x > bubble.left.rect.x);
      for (const marker of ["NVL_ONE", "NVL_TWO", "NVL_THREE", "NVL_CLEAR"])
        assert.equal(bubble.stored.history.filter(h => h.text.includes(marker)).length, 1, "History through clear/load/rollback/branch must not duplicate");
    }
    return { passingLayoutCases: 14, actualNativeManualSaveLoad: true, historyPreservedExactlyOnce: true,
      noVoiceFixture: true, voiceReplayOrNewListeningClaim: false, historyMenuUI: "NOT_RUN",
      functionalViewport: "1920x1080/DPR1/no-preference" };
  });
  await check("Seven actual Renpy quick writes retain latest six, preserve manual saves, confirm/cancel reading and expose unrenumbered manual pages", () => {
    assert.equal(quick.status, "PASS"); assert.equal(quick.checks.length, 2);
    assert(quick.checks.every(c => c.status === "PASS"));
    const d = quick.checks.at(-1).detail;
    assert.equal(d.writes.length, 7); assert.equal(d.retained.length, 6);
    assert.deepEqual(d.retained.map(s => s.command_index).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
    assert.equal(d.manualUnchanged, true); assert.equal(d.cancelPreservesCommand, 7); assert.equal(d.loadedCommand, 6);
    assert.equal(d.sixSlotsPerPage, true);
    return { realUIWrites: 7, retained: 6, noQuickSaveFeedback: "NOT_COMPLETED_AS_INDEPENDENT_CASE",
      invalidLatestFallback: "NOT_RUN_NATIVE", writeFailure: "NOT_RUN_NATIVE", concurrentSubmission: "NOT_RUN_NATIVE",
      sourceTestsDoNotReplaceTheseNativeGaps: true };
  });
  await check("Actual separate AgentVN process reads Renpy quick and bubble manual saves; retained native files prove library identity only", () => {
    assert.equal(cross.status, "PASS"); assert.equal(cross.checks.length, 1); assert.equal(cross.checks[0].status, "PASS");
    const d = cross.checks[0].detail;
    assert.equal(d.storage.portable, false); assert(d.realPlayerRestart); assert.equal(d.standaloneExeSaveLocationClaim, false);
    assert(d.files.length >= 8);
    for (const f of d.files) { assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data); }
    assert(d.before.some(s => s.save_id === d.loadedLatestQuick && s.command_index === 6 && s.scene_id === "saves"));
    assert(d.before.some(s => s.slot === 2 && s.nvl_presentation_mode === "bubble"));
    assert(new Set(cross.launches.map(l => l.pid)).size === cross.launches.length);
    assert(cross.launches.every(l => !quick.launches.some(p => p.pid === l.pid)));
    return { actualCrossLayoutUIReads: ["latest quick", "manual bubble"], retainedNativeFiles: d.files.length,
      nativeAutomaticFilesObserved: d.files.filter(f => f.data.save_kind === "auto").length,
      autoSaveSettingsAndExitSemantics: "NOT_RUN", standaloneSaves: "BLOCKED_BY_EXPORT_PICKER", android: "NOT_RUN" };
  });
  await check("All Player launches terminate by exact identity; original four profiles/55 hashes, database, Dev and pending MSI executable are restored unchanged", () => {
    const stopped = load("final-stop.json"), restored = load("profile-restoration.json");
    assert.equal(stopped.status, "PASS"); assert.equal(stopped.after.length, 0); assert.equal(restored.status, "PASS");
    const runtimeReports = [first, second, agent, renpy, quick, crossFailed, crossIdentityFailed, cross];
    assert(runtimeReports.flatMap(r => r.launches).length >= 9);
    for (const r of runtimeReports) for (const l of r.launches) {
      assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
    }
    let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
      for (const f of p.files) { assert.equal(sha(path.join(p.original, f.relative)), f.sha256); assert.equal(sha(f.backup), f.sha256); count++; }
    }
    assert.equal(count, 55); assert.equal(sha(path.join(root, "AgentVN Dev.exe")), prep.originalDevSha256);
    const incident = read(path.join(root, "output/host-msi-session-20261018-01/incident-audit-01.json"));
    assert.equal(sha("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"), incident.userPersistence.databaseSha256);
    assert.equal(sha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    return { originalFiles: count, profiles: 4, originalDBUnchanged: true, rootDevUnchanged: true,
      pendingMSIExecutableUnchanged: true, normalPhysicalCloseClaim: false };
  });
  await check("No AgentVN/Player WebView, backend or reserved session port remains", () => {
    const ports = [...new Set([8278, launch.cdpPort, launch.playerCdpPort,
      ...[first, second, agent, renpy, quick, crossFailed, crossIdentityFailed, cross].flatMap(r => r.launches.map(l => l.cdpPort))])];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { portsChecked: ports, ...state };
  });
  await check("Supporting source contracts and all changed JS/PS tools pass with explicit isolated inheritance output", () => {
    const commands = ["quick-save-policy-test.cjs", "quick-save-runtime-test.cjs", "quick-save-storage-test.cjs",
      "dialog-presentation-inheritance-test.cjs", "bubble-placement-contract.cjs", "full-regression-evidence-test.cjs"].map(f => [`scripts/${f}`]);
    commands.push(...["installed-runtime-abilities-fixtures.cjs", "installed-runtime-abilities-export.cjs",
      "installed-runtime-abilities-playwright.cjs", "installed-runtime-abilities-terminal-audit.cjs"].map(f => ["--check", `scripts/${f}`]));
    for (const [i, args] of commands.entries()) {
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000,
        env: { ...process.env, AGENTVN_TEST_PROJECT: fixture.input,
          AGENTVN_WORKSPACE_OUTPUT: path.join(run, `${path.basename(out, ".json")}-inheritance`) } });
      const log = path.join(run, `${path.basename(out, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, `See ${log}`);
    }
    const parsers = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)}; Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    const parserLog = path.join(run, `${path.basename(out, ".json")}-powershell-parsers.log`);
    fs.writeFileSync(parserLog, `${parsers.stdout || ""}\n${parsers.stderr || ""}`, { flag: "wx" });
    report.commands.push({ executable: "powershell.exe", exitCode: parsers.status, log: parserLog, sha256: sha(parserLog) });
    assert.equal(parsers.status, 0, parsers.stderr);
    return { commands: commands.length, powerShellParsers: 2, initialMissingOutputInvocation: "FAILED_ENVIRONMENT_GUARD_RETAINED_IN_REVIEW",
      sourceMocksAreNotInstalledFaultInjectionAcceptance: true };
  });
  assert.equal(report.checks.length, 10); assert(report.checks.every(c => c.status === "PASS"));
  report.installedLibraryCasesStatus = "PASS";
  report.remaining = { runtimeAbilitiesFullScope: "NOT_RUN", independentWindowsExportAndSaves: "BLOCKED_BY_NATIVE_OUTPUT_PICKER",
    android: "NOT_RUN", full12MatrixForNVLBubbleAndQuickBusiness: "NOT_RUN",
    runtimeMotionPriorFailures: "FAILED_UNCHANGED", noQuickSaveFeedbackNativeIndependent: "NOT_RUN",
    invalidLatestQuickFallbackNative: "NOT_RUN", quickWriteFailureNative: "NOT_RUN", concurrentQuickWritesNative: "NOT_RUN",
    autoSaveSettingsExitNative: "NOT_RUN", voiceReplayEvidence: "NOT_RUN_NO_VOICE_FIXTURE" };
  report.status = report.evidenceStatus = "PASS";
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, runtimeAbilitiesStatus: report.runtimeAbilitiesStatus,
    checks: report.checks.length, screenshots: report.screenshots, error: report.error, out }, null, 2));
});
