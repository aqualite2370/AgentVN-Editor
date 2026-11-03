"use strict";
// Independent byte/evidence audit. An evidence PASS does not convert product RED to PASS.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", run = path.join(root, "output/installed-layout-resources-20261018-01");
const checkpoint = "F:/AgentVN-QA-LayoutResources-Checkpoint-20261018-01";
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const sha = p => sha256(fs.readFileSync(p));
const dest = process.argv[2]; assert(dest && path.dirname(path.resolve(dest)) === path.resolve(run) && !fs.existsSync(dest));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", productDependencyStatus: "NOT_EVALUATED",
  at: new Date().toISOString(), checks: [], inputs: [], commands: [], screenshotCount: 0, productFailures: [],
  productChanges: 0, realModelRequests: 0, error: null };
function load(p) { report.inputs.push({ path: p, sha256: sha(p) }); return read(p); }
async function check(name, body) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await body(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function archivedTool(tool) {
  const archive = {
    "installed-layout-resources-playwright.cjs": "installed-layout-resources-playwright.first-oracle.cjs",
    "installed-layout-resources-player.cjs": "installed-layout-resources-player.first-oracle.cjs",
  };
  const current = sha(tool.path);
  if (current === tool.sha256) return { path: tool.path, sha256: current, current: true };
  const p = path.join(checkpoint, archive[path.basename(tool.path)] || "INVALID");
  assert.equal(sha(p), tool.sha256, "Raw evidence must match the actual original tool, never silently compare a new tool");
  return { path: p, sha256: tool.sha256, current: false };
}
(async () => {
  const prep = load(path.join(run, "preparation.json")), fixture = load(path.join(run, "fixtures.json"));
  const first = load(path.join(run, "export-01/report.json")), second = load(path.join(run, "export-02/report.json"));
  const oldPlayer = load(path.join(run, "player-01/report.json")), player = load(path.join(run, "player-02/report.json"));
  await check("Frozen actual installation,560 sources and original/corrected test identities remain traceable", () => {
    assert.equal(prep.status, "PASS"); assert.equal(fixture.status, "PASS");
    const frozen = load(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(frozen.source.length, 560);
    for (const f of frozen.source) assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")), "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(path.join(prep.installRoot, "agentvn-player.exe")), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
    assert.equal(sha(fixture.input), fixture.inputSha256);
    const tools = [first, second, oldPlayer, player].flatMap(r => r.tools.map(archivedTool));
    assert.equal(first.productChanges + second.productChanges + player.productChanges, 0);
    assert.equal(first.realModelRequests + second.realModelRequests + player.realModelRequests, 0);
    return { sourceFiles: 560, productChanges: 0, realModelRequests: 0, tools };
  });
  await check("Both complete UI-export sessions retain their failures; second is a new real Editor/backend and saved ZIP reimport", () => {
    for (const r of [first, second]) {
      assert.equal(r.status, "FAILED"); assert.equal(r.error, null); assert.equal(r.productFailures.length, 2);
      assert.equal(r.cartridges.length, 2); assert.equal(r.projectArtifacts.length, 2); assert.equal(r.pageErrors.length, 0);
      assert(r.checks.filter(c => !c.productOracle).every(c => c.status === "PASS"));
      assert.equal(r.checks.filter(c => c.productOracle && c.status === "FAILED").length, 2);
    }
    assert.notEqual(first.launch.editorPid, second.launch.editorPid);
    assert.equal(second.reimport.sha256, first.projectArtifacts[0].sha256);
    assert.equal(sha(second.reimport.input), second.reimport.sha256);
    assert.deepEqual(second.baselineProfiles, first.projectArtifacts[0].profiles);
    assert.equal(second.matrix.length, 0, "Second session is explicit continuation, not a claimed second full matrix");
    return { nativeEditorSessions: 2, firstChecks: first.checks.length, secondChecks: second.checks.length,
      exactFullProfilePayloadAfterRealZIPReimport: true, nativePickerClaim: false, retainedProductFailures: 4 };
  });
  await check("Four real native portable saves keep both profile payloads and all seven asset bytes, including inactive ones", async () => {
    for (const r of [first, second]) for (const p of r.projectArtifacts) {
      assert.equal(sha(p.path), p.sha256); assert.equal(sha(p.retained), p.sha256);
      assert.equal(path.dirname(p.path).toLowerCase(), "c:\\users\\1\\downloads");
      const zip = await JSZip.loadAsync(fs.readFileSync(p.retained));
      const project = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, p.profiles);
      assert.deepEqual(project.editor_settings.runtimeUILayout, p.profiles.profiles[p.activeType]);
      assert.equal(project.asset_manifest.length, 7);
      assert(!JSON.stringify(project).includes(path.dirname(p.path)), "Local export path must not enter portable project");
      for (const resource of fixture.resources) {
        const a = project.asset_manifest.find(a => a.asset_id === resource.id); assert(a);
        assert.equal(sha256(await zip.file(a.metadata.project_path).async("nodebuffer")), resource.sha256);
      }
    }
    return { nativeProjectBundles: 4, profileSetsPerBundle: 2, byteVerifiedResourcesPerBundle: 7 };
  });
  await check("Independent ZIP oracle confirms inactive-only pruning/protection and reproduces unused-library leak with corrected IDs", async () => {
    const scripts = new Set(), storyPayloads = [], sessionScriptHashes = [];
    for (const r of [first, second]) for (const c of r.cartridges) {
      assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const actual = manifest.assets.map(a => a.asset_id).sort();
      const expected = [`qa-res-${c.type === "agentvn" ? "agent" : "renpy"}-only`, "qa-res-shared",
        "qa-res-story-protected", "qa-res-shell-protected", "qa-res-gallery-protected"].sort();
      assert.equal(layout.layout_type || "agentvn", c.type);
      assert(!layout.profiles && !layout.runtimeUILayoutProfiles);
      assert.equal(layout.name, r.baselineProfiles.profiles[c.type].name);
      assert.equal(sha256(await zip.file("ui/layout.json").async("nodebuffer")), c.layoutSha256);
      assert.equal(manifest.shell.background, "qa-res-shell-protected");
      assert.equal(sha256(await zip.file("script.json").async("nodebuffer")), c.scriptSha256); scripts.add(c.scriptSha256);
      storyPayloads.push(JSON.parse(await zip.file("script.json").async("string")));
      sessionScriptHashes.push({ attempt: r.attempt, type: c.type, sha256: c.scriptSha256 });
      assert(expected.every(id => actual.includes(id)));
      const opposite = `qa-res-${c.type === "agentvn" ? "renpy" : "agent"}-only`;
      assert(!actual.includes(opposite));
      const inactivePath = fixture.resources.find(a => a.id === opposite).projectPath;
      assert(!zip.file(inactivePath));
      for (const a of manifest.assets) {
        const resource = fixture.resources.find(r => r.id === a.asset_id); assert(resource);
        assert.equal(sha256(await zip.file(a.path).async("nodebuffer")), resource.sha256);
      }
      // This is the product assertion, intentionally captured as FAILED. The
      // outer check verifies its reproducible evidence, not a successful product.
      const extra = actual.filter(id => !expected.includes(id));
      assert.deepEqual(extra, ["qa-res-unused-library"]); assert.equal(actual.length, 6);
      const failure = { code: "LAYOUT-RES-01", status: "FAILED", cartridge: c.path, sha256: c.sha256,
        type: c.type, actualIds: actual, correctedExpectedIds: expected, unexpectedIds: extra };
      report.productFailures.push(failure);
    }
    // Portable backend import sorts JSON object fields. Preserve actual raw
    // hashes but compare the full parsed story across reimport; no field/value,
    // command ordering or ID is permitted to differ.
    for (const story of storyPayloads) assert.deepEqual(story, storyPayloads[0], "Reimport changed story data");
    for (const r of [first, second]) assert.equal(r.cartridges[0].scriptSha256, r.cartridges[1].scriptSha256,
      "Layout-only switch inside one session changed raw story bytes");
    assert.equal(report.productFailures.length, 4); report.productDependencyStatus = "FAILED";
    return { actualCartridges: 4, activeProfileAndAllProtectedBytes: "PASS", inactiveOnlyBytesRemoved: "PASS",
      minimalRuntimeDependencySet: "FAILED", correctedIndependentOracle: true, storyHashes: [...scripts],
      sessionScriptHashes, crossReimportFullStoryEquality: true, crossReimportByteEqualityClaim: false };
  });
  await check("Real installed Player displays active layout and protected story bytes,24 complete title combinations", () => {
    assert.equal(player.status, "PASS"); assert.equal(player.error, null); assert(!player.cleanupError);
    assert.equal(player.checks.length, 6); assert(player.checks.every(c => c.status === "PASS"));
    assert.equal(player.matrix.length, 24); assert.equal(player.pageErrors.length, 0); assert.equal(player.launches.length, 2);
    const keys = new Set(player.matrix.map(m => `${m.layout}:${m.width}:${m.height}:${m.dpr}:${m.reduced}`)); assert.equal(keys.size, 24);
    for (const type of ["agentvn", "renpy"]) {
      const resource = fixture.resources.find(r => r.role === `${type === "agentvn" ? "agent" : "renpy"}-only`);
      for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const d of [1, 2]) for (const reduced of [false, true])
        assert(keys.has(`${type}:${w}:${h}:${d}:${reduced}`));
      for (const row of player.matrix.filter(m => m.layout === type)) {
        assert.equal(row.status, "PASS"); assert.equal(row.actualArtwork.sha256, resource.sha256);
        const g = row.geometry; assert(g.hit && g.focused && !g.clipped && g.overflow <= 1);
        assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= row.width + 1 && g.rect.bottom <= row.height + 1);
      }
      const story = player.checks.find(c => c.layout === type && c.name.startsWith("Protected story"));
      assert.equal(story.detail.sha256, fixture.resources.find(r => r.role === "story-protected").sha256);
      assert.equal(story.detail.nextCommand, 1);
    }
    for (const l of player.launches) {
      assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(prep.installRoot, "agentvn-player.exe"));
      assert.equal(l.cleanup.status, "PASS"); assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
      assert(l.library.controlledPublicNativePreparation);
    }
    return { nativePlayers: 2, titleMatrices: 24, realStoryImageFlows: 2,
      normalCloseClaim: false, standaloneWindowsOrAndroidClaim: false };
  });
  await check("Twelve author switch combinations preserve button envelopes and all valid PNG actual DPR/parameters/SHA", () => {
    assert.equal(first.matrix.length, 12);
    const keys = new Set(first.matrix.map(m => `${m.width}:${m.height}:${m.dpr}:${m.reduced}`)); assert.equal(keys.size, 12);
    for (const m of first.matrix) {
      assert.equal(m.status, "PASS"); assert.equal(m.types.length, 2);
      assert.deepEqual(m.types.map(t => t.target), ["renpy", "agentvn"]);
      for (const t of m.types) {
        assert.equal(t.geometry.buttons.length, 2); assert(t.geometry.overflow <= 1);
        for (const b of t.geometry.buttons) assert(b.hit && !b.clipped && !b.disabled && !b.inert && b.opacity > 0);
      }
      for (let i = 0; i < 2; i++) for (const k of ["x", "y", "width", "height"])
        assert(Math.abs(m.types[0].geometry.buttons[i].rect[k] - m.types[1].geometry.buttons[i].rect[k]) <= 1);
    }
    for (const r of [first, second, player]) for (const s of r.screenshots) {
      assert.deepEqual(s.before, s.after); assert.equal(sha(s.path), s.sha256);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); report.screenshotCount++;
    }
    assert.equal(report.screenshotCount, 46);
    return { authorMatrices: 12, actualTypeClicks: 24, screenshotCount: report.screenshotCount, fullMotionClaim: false };
  });
  await check("Tool failures stay failed,55 original profile hashes/DB/Dev/MSI restored and only owned processes stopped", () => {
    assert.equal(oldPlayer.status, "FAILED"); assert.equal(oldPlayer.matrix.length, 0);
    assert.equal(oldPlayer.checks.filter(c => c.status === "PASS").length, 0);
    assert(oldPlayer.launches.every(l => l.cleanup.status === "PASS"));
    for (const f of ["tool-preflight-failure-01.md", "tool-oracle-correction-01.md"]) assert(fs.existsSync(path.join(run, f)));
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
    for (const name of ["stop-first-01.json", "stop-second-01.json"]) {
      const stop = load(path.join(run, name)); assert.equal(stop.status, "PASS"); assert.equal(stop.after.length, 0);
      assert.equal(stop.normalWindowClose, "NOT_RUN"); assert.equal(stop.before.length, 3);
    }
    const ports = [8278, first.launch.cdpPort, first.launch.playerCdpPort, second.launch.cdpPort,
      second.launch.playerCdpPort, ...player.launches.map(l => l.port), ...oldPlayer.launches.map(l => l.port)];
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $qaProcesses=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $qaPorts=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$qaProcesses;ports=$qaPorts}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); const live = JSON.parse(p.stdout.replace(/^\uFEFF/, ""));
    assert.equal(live.processes.length, 0); assert.equal(live.ports.length, 0);
    return { originalFileHashes: count, portsChecked: ports, ...live, originalToolFailuresPreserved: true,
      attributedEditorBackendStops: 6, attributedPlayerStops: 3, productRepair: false };
  });
  await check("Direct profile/export/evidence support tests and changed tool parsers pass without product rebuild", () => {
    const tests = ["runtime-layout-profiles-test.cjs", "custom-component-project-export-test.cjs", "full-regression-evidence-test.cjs"];
    for (const [i, f] of tests.entries()) {
      const p = spawnSync(process.execPath, [`scripts/${f}`], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 120000 });
      const log = path.join(run, `${path.basename(dest, ".json")}-support-${i + 1}.log`);
      fs.writeFileSync(log, `${p.stdout || ""}\n${p.stderr || ""}`, { flag: "wx" });
      report.commands.push({ executable: process.execPath, args: [`scripts/${f}`], exitCode: p.status, log, sha256: sha(log) });
      assert.ifError(p.error); assert.equal(p.status, 0, log); assert(p.stdout.includes("PASS"));
    }
    for (const f of ["installed-layout-resources-fixtures.cjs", "installed-layout-resources-playwright.cjs",
      "installed-layout-resources-player.cjs", "installed-layout-resources-terminal-audit.cjs"]) {
      const p = spawnSync(process.execPath, ["--check", `scripts/${f}`], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 20000 });
      assert.equal(p.status, 0, p.stderr);
    }
    const p = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      foreach($qaFile in @('D:\\AgentVN\\scripts\\installed-preview-session.ps1','D:\\AgentVN\\scripts\\installed-assistant-recovery-session.ps1')){
        $qaTokens=$null;$qaErrors=$null;
        [System.Management.Automation.Language.Parser]::ParseFile($qaFile,[ref]$qaTokens,[ref]$qaErrors)|Out-Null;
        if($qaErrors.Count){throw ($qaErrors|Out-String)};Write-Output "PASS Parser $qaFile"
      }
    `], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(p.status, 0, p.stderr); assert(p.stdout.includes("PASS"));
    return { supportTests: tests.length, jsParsers: 4, psParsers: 2,
      existingSourceTestKeepsUnrelatedAssets: true, sourcePassDoesNotOverrideApprovedMinimalDependencyRequirement: true };
  });
  assert.equal(report.checks.length, 8); report.status = report.evidenceStatus = "PASS";
})().catch(e => { report.status = report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, evidenceStatus: report.evidenceStatus, productDependencyStatus: report.productDependencyStatus,
    checks: report.checks.length, screenshots: report.screenshotCount, failures: report.productFailures.length, error: report.error, dest }));
});
