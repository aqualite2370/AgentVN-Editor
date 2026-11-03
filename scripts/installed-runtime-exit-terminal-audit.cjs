"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-runtime-exit-20261018-02");
const work = "F:/AgentVN-QA-InstalledRuntimeExit-20261018-02";
const firstRoot = path.join(root, "output/installed-runtime-exit-20261018-01");
const checkpoint = "F:/AgentVN-QA-Runtime-Exit-Checkpoint-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const dest = process.argv[2]; assert(dest && path.dirname(path.resolve(dest)) === path.resolve(run) && !fs.existsSync(dest));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", productExitLimitedStatus: "NOT_EVALUATED",
  completeG17Status: "BLOCKED_STANDALONE_PACKAGE_NOT_RUN", at: new Date().toISOString(), inputs: [], checks: [],
  commands: [], screenshotCount: 0, productChanges: 0, realModelRequests: 0, error: null };
function load(p) { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
async function check(name, fn) {
  const c = { name, status: "RUNNING" }; report.checks.push(c);
  try { c.detail = await fn(); c.status = "PASS"; }
  catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
function permissions(r) {
  assert.equal(r.status, "RESTORED"); assert(r.comparison.permissionsMatch);
  assert(r.comparison.daclBytesMatch && r.comparison.ownerGroupMatch && r.comparison.allOtherFlagsMatch);
  assert.equal(r.comparison.daclBeforeBase64, r.comparison.daclAfterBase64);
  assert.equal((r.comparison.flagsBefore ^ r.comparison.flagsAfter) & ~r.comparison.permittedMetadataBit, 0);
  assert.equal(r.probe.allowed, true);
}
(async () => {
  const prep = load(path.join(run, "preparation.json")), raw = load(path.join(run, "runtime-02/report.json"));
  report.productExitLimitedStatus = raw.status;
  await check("Original tool failures and interrupted run remain FAILED; original tool hashes and original-profile restoration retained", () => {
    const first = load(path.join(firstRoot, "runtime-01/report.json"));
    assert.equal(first.status, "FAILED"); assert(first.checks.some(c => c.error.includes("Get-Acl")));
    assert(first.toolAbort.reason.includes("before ACL mutation"));
    assert.equal(fs.readdirSync("F:/AgentVN-QA-InstalledRuntimeExit-20261018-01").filter(n => n.startsWith("acl-")).length, 0);
    assert.equal(load(path.join(firstRoot, "profile-restoration.json")).status, "PASS");
    for (const t of first.tools) {
      const archived = path.join(checkpoint, path.basename(t.path) + ".first-run");
      assert.equal(sha(fs.existsSync(archived) ? archived : t.path), t.sha256);
    }
    const selftest = load(path.join(work, "acl-tool-selftest-03.json")); assert.equal(selftest.status, "PASS");
    assert.equal(selftest.deniedHresult, -2147024891); assert(selftest.accessDenied);
    assert(selftest.comparison.permissionsMatch && selftest.comparison.daclBytesMatch);
    const recovered = load(path.join(work, "acl-tool-selftest-initial-failure-recovery.json.result.json"));
    assert.equal(recovered.status, "RESTORED");
    const selftest2 = load(path.join(work, "acl-tool-selftest-02-recovery.json"));
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      . 'D:\\AgentVN\\scripts\\lib\\runtime-qa-acl.ps1'
      $qaJournal=Get-Content -LiteralPath '${path.join(work, "acl-tool-selftest-02-recovery.json").replaceAll("/", "\\")}' -Raw|ConvertFrom-Json
      $qaActual=[IO.Directory]::GetAccessControl($qaJournal.target).Sddl
      $qaComparison=Compare-QAAccessDescriptor $qaJournal.originalSddl $qaActual
      if(!$qaComparison.permissionsMatch){throw 'Selftest02 rules not restored'}
      $qaProbe=Join-Path $qaJournal.target 'independent-audit-probe.tmp'
      if(Test-Path -LiteralPath $qaProbe){throw 'Probe collision'}
      [IO.File]::WriteAllText($qaProbe,'ok');[IO.File]::Delete($qaProbe)
      $qaComparison|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const comparison = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert(comparison.permissionsMatch);
    return { firstRunOriginalStatus: first.status, retainedPartialChecks: first.checks.length, noFirstRunACLMutations: true,
      selftestFirstSACLToolFailureRecovered: true, selftestSecondAdministrativeFlagMismatch: { target: selftest2.target, comparison },
      selftestThirdActualDenialAndRestore: "PASS", noProductRepair: true };
  });
  await check("Frozen installed Editor/Player, original cartridge source,560 product sources and all test tool identities are unchanged", () => {
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    const candidate = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(candidate.source.length, 560); for (const s of candidate.source) assert.equal(sha(s.path), s.sha256);
    assert.equal(sha(raw.source.path), raw.source.sha256); assert.equal(sha(raw.fixture.path), raw.fixture.sha256);
    const exported = load(raw.source.path); assert.equal(exported.status, "PASS");
    for (const c of exported.cartridges) assert.equal(sha(c.path), c.sha256);
    for (const t of raw.tools) assert.equal(sha(t.path), t.sha256);
    assert.equal(raw.productChanges, 0); assert.equal(raw.realModelRequests, 0);
    return { productFiles: 560, cartridges: exported.cartridges.length, testTools: raw.tools.length };
  });
  await check("Six true non-admin ACL failures preserve prior save bytes and actual restored ACL/probe receipts", () => {
    const failures = raw.checks.filter(c => c.name.startsWith("Real QA ACL"));
    assert.equal(failures.length, 6); assert(failures.every(c => c.status === "PASS"));
    assert.equal(raw.faultRestoration.length, 6);
    for (const c of failures) {
      const d = c.detail; assert.equal(d.denied.isElevated, false); assert.equal(d.denied.probe.allowed, false);
      assert.equal(d.denied.probe.hresult, -2147024891); assert(d.denied.probe.accessDenied);
      assert.equal(d.denied.target, c.detail.before.files[0].path.slice(0, c.detail.before.files[0].path.lastIndexOf("\\")));
      assert(d.error.includes("保存失败") && d.error.includes("游戏仍保持打开") && d.error.includes("不会回退"));
      assert.deepEqual(d.afterFailure, d.before.files);
      const stem = path.join(work, `acl-${c.case}-${c.layout}-01.json`);
      const original = load(stem), denied = load(stem + ".block.json"), restored = load(stem + ".restore.json");
      assert.equal(original.originalSddl, restored.originalSddl); assert.equal(denied.status, "WRITE_DENIED");
      permissions(restored);
    }
    for (const f of raw.faultRestoration) assert.equal(f.status, "PASS");
    return { realACLFailures: failures.length, permissionRestorations: 6, allOrdinaryNonAdministrator: true,
      onlyExactQAPlayerLibraryDirectoriesChanged: true, standaloneEXEACLClaim: false };
  });
  await check("Retry commits exactly one atomic snapshot before destroy; explicit discard and real restart preserve the intended previous checkpoint", () => {
    for (const layout of ["agentvn", "renpy"]) {
      const subset = raw.checks.filter(c => c.layout === layout);
      const retry = subset.find(c => c.name.startsWith("Restore exact ACL"));
      const resumed = subset.find(c => c.name.startsWith("Restart after retry"));
      const discard = subset.find(c => c.name.startsWith("First discard action"));
      const discardedResume = subset.find(c => c.name.startsWith("Restart after explicit discard"));
      for (const c of [retry, resumed, discard, discardedResume]) assert.equal(c.status, "PASS");
      assert.equal(retry.detail.atomicStagingFiles.length, 1);
      assert.equal(retry.detail.written.scene_id, "saves"); assert.equal(retry.detail.written.command_index, 4);
      assert.equal(resumed.detail.scene, "saves"); assert.equal(resumed.detail.command, 4);
      const before = raw.cases.find(c => c.case === "discard" && c.layout === layout).before;
      assert.deepEqual(discard.detail.after, before.files);
      assert.equal(discardedResume.detail.scene, before.expectedLatest.scene_id);
      assert.equal(discardedResume.detail.command, before.expectedLatest.command_index);
      assert.equal(discardedResume.detail.command, 0);
    }
    assert.equal(raw.status, "PASS"); assert.equal(raw.cases.length, 6); assert(raw.cases.every(c => c.status === "PASS"));
    assert(raw.checks.length >= 18 && raw.checks.every(c => c.status === "PASS"));
    return { layouts: 2, successfulRetrySnapshotsAtCommand4: 2, observedAtomicTransactions: 2,
      explicitTwoStepDiscardCases: 2, restartContinuesPriorManualCommand0: 2 };
  });
  await check("24 complete WebView matrices verify actual failed/second-confirm modal controls, no clipping/overflow and top-only Escape", () => {
    assert.equal(raw.matrix.length, 24);
    const keys = new Set(raw.matrix.map(r => `${r.layout}:${r.width}:${r.height}:${r.dpr}:${r.reduced}`)); assert.equal(keys.size, 24);
    for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const m of [false, true]) assert(keys.has(`${l}:${w}:${h}:${d}:${m}`));
    for (const r of raw.matrix) {
      assert.equal(r.status, "PASS");
      for (const [g, title, count] of [[r.failure, "退出游戏？", 1], [r.second, "确认放弃保存？", 2], [r.afterEscape, "退出游戏？", 1]]) {
        assert.equal(g.title, title); assert.equal(g.count, count); assert(g.focusInside && g.lowerInert);
        assert(g.overflow <= 1 && g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= r.width + 1 && g.rect.bottom <= r.height + 1);
        assert(g.scroll.width <= g.scroll.clientWidth + 1 && g.scroll.height <= g.scroll.clientHeight + 1);
        assert(g.controls.every(b => b.hit && !b.disabled && !b.inert));
      }
    }
    return { combinations: 24, topOnlySecondConfirmationEscapes: 24, fullMotionClaim: false };
  });
  await check("Computer Use real Alt+F4 opens the same gate in both layouts; no native IPC close substitution", () => {
    for (const c of raw.checks.filter(c => c.case === "native" && c.name.startsWith("Real QA ACL"))) {
      const request = load(c.detail.nativeRequest.path), receipt = load(request.receipt);
      assert.equal(request.ownerPid, receipt.ownerPid); assert.equal(receipt.method, "Computer Use Alt+F4");
      assert(receipt.window && receipt.inputCompletedAt && receipt.observedAfterInput);
      assert.equal(receipt.window.app, "process:F:\\AgentVN-QA-HostUpgrade-20261018-02\\installed-editor\\agentvn-player.exe");
      assert(receipt.observedAfterInput.includes("退出游戏？"));
      assert.equal(c.detail.nativeReceipt.ownerPid, receipt.ownerPid);
      assert(raw.launches.some(l => l.pid === receipt.ownerPid && l.cleanup.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY"));
    }
    assert.equal(raw.checks.filter(c => c.case === "native" && c.name.startsWith("Physical native close") && c.status === "PASS").length, 2);
    return { actualNativeCloseRequests: 2, sameSaveFailureAndRetryGate: true, standaloneSetupClaim: false };
  });
  await check("Native PNG dimensions/parameters/SHA and retained real save bytes verified", () => {
    assert(raw.screenshots.length >= 30);
    for (const s of raw.screenshots) {
      assert.deepEqual(s.before, s.after); const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    assert(raw.retained.length >= 8);
    for (const f of raw.retained) { assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data); }
    const restored = load(path.join(run, "profile-restoration.json"));
    const held = restored.profiles.find(p => p.app === "player" && p.kind === "Roaming").testHeld;
    for (const c of raw.cases) {
      const dir = path.join(held, "saves", c.installId);
      assert(!fs.readdirSync(dir).some(n => n.endsWith(".tmp")), "No atomic/probe staging file may remain");
    }
    return { screenshots: report.screenshotCount, retainedNativeSaveFiles: raw.retained.length,
      physical4KMonitorClaim: false };
  });
  await check("Both profile sessions restored55 original file hashes; original DB/Dev/pendingMSI and all process/port boundaries preserved", () => {
    const restored = load(path.join(run, "profile-restoration.json")); assert.equal(restored.status, "PASS");
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
    assert.equal(raw.pageErrors.length, 0); assert(!raw.error && !raw.cleanupError);
    assert(raw.launches.every(l => l.cleanup.status === "PASS"));
    const first = read(path.join(firstRoot, "runtime-01/report.json"));
    const ports = [8278, ...first.launches.map(l => l.port), ...raw.launches.map(l => l.port)];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { originalFiles: count, nativeSessions: raw.launches.length,
      actualConfirmedNativeExits: raw.launches.filter(l => l.cleanup.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY").length,
      controlledStopsNotNaturalClose: raw.launches.filter(l => l.cleanup.method !== "REAL_UI_CONFIRMED_NATIVE_DESTROY").length,
      ...state, portsChecked: ports };
  });
  await check("Exit/close/save queue/evidence regressions and changed test-tool parsers pass", () => {
    const tests = ["runtime-exit-flow-test.cjs", "runtime-window-close-test.cjs", "runtime-save-queue-test.cjs",
      "full-regression-evidence-test.cjs"];
    for (const [i, name] of tests.entries()) {
      const args = [`scripts/${name}`];
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `${path.basename(dest, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log); assert(p.stdout.includes("PASS"));
    }
    for (const f of ["scripts/installed-runtime-exit-playwright.cjs", "scripts/installed-runtime-exit-terminal-audit.cjs"]) {
      const p = spawnSync(process.execPath, ["--check", f], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(p.status, 0, p.stderr);
    }
    const files = ["installed-preview-session.ps1", "installed-runtime-exit-acl.ps1", "installed-runtime-exit-acl-tool-test.ps1",
      "installed-runtime-exit-acl-selftest-recovery.ps1", "lib/runtime-qa-acl.ps1"];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @(${files.map(f => `'D:\\AgentVN\\scripts\\${f.replaceAll("/", "\\")}'`).join(",")})){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); assert(p.stdout.includes("PASS"));
    return { supportTests: tests.length, jsParsers: 2, psParsers: files.length };
  });
  assert.equal(report.checks.length, 9); report.status = report.evidenceStatus = "PASS";
  report.remaining = { standaloneWindowsEXESavesAndACL: "BLOCKED_BY_NATIVE_OUTPUT_PICKER", oldMSI: "AWAITING_USER_DECISION",
    android: "NOT_RUN", models: "NOT_RUN", productDefects: "FAILED_UNCHANGED", finalProject: "NOT_RUN" };
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, productExitLimitedStatus: report.productExitLimitedStatus,
    evidenceStatus: report.evidenceStatus, checks: report.checks.length, screenshotCount: report.screenshotCount, error: report.error, dest }, null, 2));
});
