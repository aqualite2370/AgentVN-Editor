"use strict";
// Independent evidence, binary identity and restoration audit; not a product repair.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-runtime-settings-20261018-01");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const destination = process.argv[2];
assert(destination && path.dirname(path.resolve(destination)) === path.resolve(run) && !fs.existsSync(destination));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", at: new Date().toISOString(),
  productSettingsStatus: "NOT_EVALUATED", completeRuntimeStatus: "FAILED_PREVIOUS_DEFECTS_OPEN",
  checks: [], inputs: [], commands: [], screenshots: 0, productChanges: 0, realModelRequests: 0, error: null };
function load(p) { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
const near = (actual, expected) => typeof expected === "number"
  ? Math.abs(Number(actual) - expected) < 0.00001 : actual === expected;
(async () => {
  const prep = load(path.join(run, "preparation.json")), raw = load(path.join(run, "runtime-01/report.json"));
  report.productSettingsStatus = raw.status;
  await check("Frozen installed identities,560 product sources and both real UI-exported cartridges remain byte-identical", async () => {
    assert.equal(prep.status, "PASS"); assert.equal(raw.productChanges, 0); assert.equal(raw.realModelRequests, 0);
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const f of frozen.source) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha(raw.source.path), raw.source.sha256); assert.equal(sha(raw.fixture.path), raw.fixture.sha256);
    const exported = load(raw.source.path); assert.equal(exported.status, "PASS"); assert.equal(exported.cartridges.length, 2);
    for (const c of exported.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      assert.equal(sha256(await zip.file("script.json").async("nodebuffer")), c.scriptSha256);
      assert.equal(sha256(await zip.file("ui/layout.json").async("nodebuffer")), c.layoutSha256);
    }
    for (const t of raw.tools) assert.equal(sha(t.path), t.sha256, t.path);
    return { sourceFiles: 560, nativeUIExportedCartridges: 2, productChanges: 0, modelRequests: 0 };
  });
  await check("Seventeen actual controls, all modified values, defaults and restart/cross-game/cross-layout assertions have real nonempty evidence", () => {
    assert.equal(raw.status, "PASS"); assert.equal(raw.checks.length, 12);
    assert(raw.checks.every(c => c.status === "PASS")); assert(!raw.error && !raw.cleanupError);
    const controls = raw.inventory.groups.flatMap(g => g.controls);
    assert.equal(controls.length, 17); assert.equal(new Set(controls.map(c => c[0])).size, 17);
    assert.equal(controls.filter(c => c[2] === null).length, 9);
    assert.equal(controls.filter(c => c[2] !== null).length, 8);
    function verify(state, column) {
      assert.equal(state.controls.length, 17); assert.equal(state.prefs.schemaVersion, 8);
      assert.equal(state.prefs.language, "zh-CN"); assert.equal(state.prefs.transitions, "all");
      for (const c of controls) {
        const found = state.controls.find(v => v.key === c[0]); assert(found);
        assert(near(found.value, c[column]), `${c[0]} UI value`);
        assert(near(state.prefs[c[0]], c[column]), `${c[0]} persisted value`);
      }
      assert(near(state.prefs.textSpeed, state.prefs.textSpeedCps));
      for (const retired of ["rollbackSideDesktop", "rollbackSideMobile", "titleBackgroundDimmingOverride", "settingsPanelBackgroundDimmingOverride"])
        assert(!Object.hasOwn(state.prefs, retired));
    }
    for (const [layout, column] of [["agentvn", 5], ["renpy", 6]]) {
      const subset = raw.checks.filter(c => c.layout === layout);
      const initial = subset.find(c => c.name.startsWith("New game identity"));
      const changed = subset.find(c => c.name.startsWith("Change all17"));
      const restarted = subset.find(c => c.name.startsWith("Actual new native process"));
      verify(initial.detail, 4); verify(changed.detail.changed, column); verify(changed.detail.reopened, column);
      verify(restarted.detail, column); assert.deepEqual(restarted.detail.prefs, changed.detail.reopened.prefs);
    }
    const cross = raw.checks.find(c => c.name.startsWith("Switching the same"));
    verify(cross.detail.before, 5); verify(cross.detail.reset, 4);
    assert.deepEqual(cross.detail.otherBefore, cross.detail.otherAfter);
    const other = raw.checks.find(c => c.name.startsWith("Other game still"));
    verify(other.detail.before, 6); verify(other.detail.reset, 4);
    for (const name of ["Reset defaults survive", "Second game's reset"]) verify(raw.checks.find(c => c.name.startsWith(name)).detail, 4);
    return { editableControls: 17, layouts: 2, actualBusinessChecks: 12,
      independentLibraryInstallIdentities: 2, sharedFixtureManifestGameId: true,
      sameIdentityLayoutSwitch: true, resetAndNativeRestart: true };
  });
  await check("Exactly24 real WebView combinations cover all five categories, every visible control and balanced icon geometry", () => {
    assert.equal(raw.matrix.length, 24);
    const keys = new Set(raw.matrix.map(r => `${r.layout}:${r.width}:${r.height}:${r.dpr}:${r.reduced}`));
    assert.equal(keys.size, 24);
    for (const l of ["agentvn", "renpy"]) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const d of [1, 2]) for (const m of [false, true]) assert(keys.has(`${l}:${w}:${h}:${d}:${m}`));
    for (const r of raw.matrix) {
      assert.equal(r.status, "PASS"); assert.equal(r.categories.length, 5);
      assert.deepEqual(r.categories.map(c => c.id), raw.inventory.groups.map(g => g.id));
      for (const [i, c] of r.categories.entries()) {
        const g = c.geometry; assert(g.overflow <= 1 && g.categoryScroll <= 1);
        assert.equal(g.controls.length, 8 + raw.inventory.groups[i].controls.length);
        assert(g.panel.x >= -1 && g.panel.y >= -1 && g.panel.right <= r.width + 1 && g.panel.bottom <= r.height + 1);
        assert(g.panel.width < r.width * 0.95);
        for (const n of g.controls) {
          assert(n.hit && !n.clipped && !n.disabled && !n.inert);
          assert(n.rect.width > 0 && n.rect.height > 0 && n.rect.x >= -1 && n.rect.y >= -1
            && n.rect.right <= r.width + 1 && n.rect.bottom <= r.height + 1);
        }
        for (let a = 0; a < g.controls.length; a++) for (let b = a + 1; b < g.controls.length; b++) {
          const x = g.controls[a].rect, y = g.controls[b].rect;
          assert(!(Math.min(x.right, y.right) - Math.max(x.x, y.x) > 1
            && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > 1));
        }
        assert.equal(c.icons.length, 7);
        for (const icon of c.icons) {
          assert(icon.hit && Math.abs(icon.iconCss / icon.font - 1.2) <= 0.03);
          assert(Math.abs(icon.gap / icon.font - 0.4) <= 0.03);
          const ink = Math.max(icon.ink.width, icon.ink.height) / icon.font;
          assert(ink >= 0.86 && ink <= 0.96);
        }
      }
    }
    return { combinations: 24, actualCategoryNavigations: 120, fullMotionIntermediateFramesClaim: false,
      physical4KMonitorClaim: false, emulatedMetricsInsideActualNativeWebView: true };
  });
  await check("Eight actual native sessions use owned installed Player, trusted input, real confirmed exit and no save-system substitution", () => {
    assert.equal(raw.launches.length, 8); assert.equal(raw.interactions.length, 8);
    const processes = new Set(raw.launches.map(l => `${l.pid}:${l.identity.CreationDate}`));
    assert.equal(processes.size, 8); assert.equal(raw.pageErrors.length, 0);
    for (const l of raw.launches) {
      assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(prep.installRoot, "agentvn-player.exe"));
      assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "REAL_UI_CONFIRMED_NATIVE_DESTROY");
      assert.equal(l.library.storage.portable, false); assert(l.library.controlledPublicNativePreparation);
      assert.equal(l.library.savesBefore.length, 0);
    }
    const inputs = raw.interactions.flatMap(i => i.inputs);
    assert(inputs.length >= 350); assert(inputs.every(i => i.trusted));
    const clicks = inputs.filter(i => i.type === "click").length, keys = inputs.filter(i => i.type === "keydown").length;
    assert(clicks >= 200 && keys >= 100);
    return { nativeSessions: 8, trustedClicks: clicks, trustedKeys: keys,
      identityAndDefaultProfileVerified: true, nativeLibraryNotStandalone: true };
  });
  await check("All screenshots preserve actual WebView parameters,DPR-scaled PNG dimensions and SHA", () => {
    assert(raw.screenshots.length >= 28);
    for (const s of raw.screenshots) {
      assert.deepEqual(s.before, s.after);
      const bytes = fs.readFileSync(s.path); assert.equal(sha256(bytes), s.sha256);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
      report.screenshots++;
    }
    return { screenshots: report.screenshots, noScreenshotOnlyPASS: true };
  });
  await check("Four original profiles and55 file hashes restored; original DB,Dev,pendingMSI untouched; all session processes and ports gone", () => {
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
    const ports = [8278, ...raw.launches.map(l => l.port)];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const state = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { originalFiles: count, ...state, portsChecked: ports, originalDBDevAndPendingMSIPreserved: true };
  });
  await check("Preference contracts, evidence validator and changed test-tool parsers pass", () => {
    const commands = [
      ["scripts/gamecli-preferences-contract.cjs"], ["scripts/settings-display-mode-contract.cjs"],
      ["scripts/settings-surface-contract.cjs"], ["scripts/full-regression-evidence-test.cjs"],
      ["--check", "scripts/installed-runtime-settings-playwright.cjs"],
      ["--check", "scripts/installed-runtime-settings-terminal-audit.cjs"],
    ];
    for (const [i, args] of commands.entries()) {
      const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120000 });
      const log = path.join(run, `${path.basename(destination, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args, exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log);
      if (i < 4) assert(p.stdout.includes("PASS"), "Empty source test cannot pass");
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaTokens=$null;$qaErrors=$null;
      [System.Management.Automation.Language.Parser]::ParseFile('D:\\AgentVN\\scripts\\installed-preview-session.ps1',[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
      if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output 'PASS PowerShell parser'
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); assert(p.stdout.includes("PASS"));
    return { sourceTests: 4, jsParsers: 2, psParser: 1 };
  });
  assert.equal(report.checks.length, 7); report.status = report.evidenceStatus = "PASS";
  report.remaining = { standaloneWindows: "BLOCKED_BY_NATIVE_OUTPUT_PICKER", android: "NOT_RUN", models: "NOT_RUN",
    pendingMSIScope: "AWAITING_USER_DECISION", previousProductDefects: "FAILED_UNCHANGED", finalProject: "NOT_RUN" };
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus,
    productSettingsStatus: report.productSettingsStatus, checks: report.checks.length,
    screenshots: report.screenshots, error: report.error, destination }, null, 2));
});
