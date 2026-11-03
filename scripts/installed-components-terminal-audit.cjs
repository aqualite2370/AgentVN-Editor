"use strict";
// Evidence and safety audit. Component scope is separate from the full product regression.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const roots = ["D:/AgentVN/output/installed-components-20261018-01",
  "D:/AgentVN/output/installed-components-use-20261018-01"];
const destination = process.argv[2]; assert(destination && !fs.existsSync(destination));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fileSha = f => sha(fs.readFileSync(f));
const report = { status: "RUNNING", evidenceStatus: "RUNNING", g15Status: "NOT_RUN",
  at: new Date().toISOString(), checks: [], error: null, realModelRequests: 0, productChanges: 0,
  scope: "INSTALLED_NSIS_1.9.9_COMPONENT_ZIP_SHARING_WINDOWS_PLAYER_NOT_FULL_PRODUCT_OR_ANDROID",
  boundaries: [
    "Project fixture seeded through the real packaged backend, not the tool-blocked native project picker",
    "Component ZIP/asset file controls used real DOM file inputs; OS-native picker cancellation not claimed",
    "Restart/homepage reopen is real; portable project bytes verified, not native-picker reimport",
    "WebView viewport emulation, not a physical 4K screen; not a full transition/interruption audit",
    "Attributed process teardown is not normal native window close acceptance",
    "Other function groups, Android and paid AI workflows remain independently open",
  ], inputs: [] };
function load(root, name) {
  const f = path.join(root, name);
  report.inputs.push({ path: f, sha256: fileSha(f) }); return read(f);
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
function passed(r, count) {
  assert.equal(r.status, "PASS"); assert(r.error === null || r.error === undefined, "Unexpected recorded error");
  if (count !== undefined) {
    assert.equal(r.checks.length, count); assert(r.checks.every(c => c.status === "PASS"));
  }
}
function matrix(rows) {
  assert.equal(rows.length, 12);
  const ids = rows.map(r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`);
  assert.equal(new Set(ids).size, 12);
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const d of [1, 2]) for (const reduced of [false, true])
      assert(ids.includes(`${w}/${h}/${d}/${reduced}`));
  assert(rows.every(r => r.status === "PASS"));
}
(async () => {
  const [first, second] = roots;
  const authorFailed = load(first, "author-01/report.json");
  const restartFailed = load(first, "reopen-01/report.json");
  const authored = load(first, "author-02/report.json"), imported = load(second, "author-02/report.json");
  const originalArchive = authorFailed.archive;
  await check("Actual authored multi-component ZIP has exact dependencies and an allowlisted manifest", async () => {
    assert.equal(fileSha(originalArchive.path), originalArchive.sha256);
    assert.equal(originalArchive.source, "actual installed WebView download");
    const zip = await JSZip.loadAsync(fs.readFileSync(originalArchive.path));
    const m = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.deepEqual(Object.keys(m).sort(), ["components", "format", "schemaVersion"]);
    assert.equal(m.components.length, 2);
    const expectedFiles = ["manifest.json"];
    for (const c of m.components) {
      assert.equal(c.assets.length, 2); assert(!("project_id" in c) && !("conversation_id" in c));
      for (const a of c.assets) {
        expectedFiles.push(a.path); assert.equal(sha(await zip.file(a.path).async("nodebuffer")), a.sha256);
      }
    }
    assert.deepEqual(Object.values(zip.files).filter(f => !f.dir).map(f => f.name).sort(), expectedFiles.sort());
    passed(authored, 2); passed(imported, 4);
    assert.equal(imported.sourceArchive.sha256, originalArchive.sha256);
    assert.equal(imported.fixtureSeed, "CONTROLLED_REAL_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER");
    assert.equal(imported.finalLibrary.length, 1);
    const remaining = imported.finalLibrary[0], source = m.components.find(c => c.name === remaining.name);
    assert(source); assert.notEqual(remaining.id, source.id);
    assert.equal(remaining.html, source.html); assert.equal(remaining.css, source.css);
    assert.deepEqual(remaining.assets.map(a => a.sha256), source.assets.map(a => a.sha256));
    return { archive: originalArchive, components: 2, dependencies: 4,
      exactArchiveEntrySet: true, freshLibraryImportedCopyActuallyUsed: true };
  });
  await check("Conflict copies, cancellation, eleven hostile archives and all twelve installed UI combinations are retained", () => {
    assert.equal(authorFailed.status, "FAILED");
    assert.equal(authorFailed.checks.length, 7); assert(authorFailed.checks.every(c => c.status === "PASS"));
    assert.equal(authorFailed.cases.length, 11);
    const expected = ["traversal", "duplicate-case", "symlink", "compression-ratio", "entry-limit",
      "future-version", "missing-asset", "bad-hash", "script", "handler", "css-url"];
    assert.deepEqual(authorFailed.cases.map(c => c.name), expected);
    for (const c of authorFailed.cases) { assert.equal(c.status, "PASS"); assert.equal(fileSha(c.path), c.sha256); }
    matrix(authorFailed.matrix);
    assert.equal(authored.finalLibrary.length, 3);
    assert(authored.finalLibrary.some(c => c.name.endsWith("（副本）")));
    assert.equal(authorFailed.errors.length, 0);
    return { positiveChecksBeforePreservedFailure: 7, maliciousCases: 11, matrix: 12,
      originalFailureScope: "Async data_url to backend URL transport representation; exact bytes still checked",
      cancellationScope: authorFailed.checks[2].detail.cancellationScope };
  });
  const sessions = [];
  for (const [index, root] of roots.entries()) {
    const author = index ? imported : authored;
    const fixture = load(root, "fixtures.json"), prep = load(root, "preparation.json");
    const restart = load(root, index ? "reopen-01/report.json" : "reopen-02/report.json");
    const exported = load(root, "export-01/report.json"), player = load(root, "player-01/report.json");
    sessions.push({ root, author, fixture, prep, restart, exported, player });
  }
  await check("Both actual native saves and actual UI cartridge exports preserve exact ASTs and all four image bytes", async () => {
    for (const s of sessions) {
      passed(s.fixture); passed(s.restart, 1); passed(s.exported, 1);
      const p = s.author.package;
      assert.equal(fileSha(p.native), p.sha256); assert.equal(fileSha(p.retained), p.sha256);
      assert.equal(fileSha(s.exported.cartridge.path), s.exported.cartridge.sha256);
      for (const [kind, file] of [["project", p.retained], ["cartridge", s.exported.cartridge.path]]) {
        const zip = await JSZip.loadAsync(fs.readFileSync(file));
        const doc = JSON.parse(await zip.file(kind === "project" ? "project.json" : "manifest.json").async("string"));
        assert.equal(kind === "project" ? doc.project_id : doc.game_id, s.fixture.projectId);
        const layout = kind === "project" ? doc.editor_settings.runtimeUILayout
          : JSON.parse(await zip.file("ui/layout.json").async("string"));
        const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
        assert.deepEqual(components, s.author.projectComponents);
        if (kind === "project")
          assert.deepEqual(doc.editor_settings.runtimeUILayoutProfiles, s.author.finalProject.settings.runtimeUILayoutProfiles);
        const assets = doc.asset_manifest || doc.assets; assert.equal(assets.length, 4);
        for (const a of assets) {
          const expected = s.author.finalProject.assets.find(old => old.asset_id === a.asset_id); assert(expected);
          const hash = sha(await zip.file(a.path || a.metadata.project_path).async("nodebuffer"));
          assert(s.fixture.images.some(i => i.sha256 === hash));
          const label = expected.metadata.filename;
          assert.equal(hash, s.fixture.images.find(i => path.basename(i.path) === label).sha256);
        }
      }
    }
    const ids = sessions.map(s => s.author.projectComponents.map(c => c.component_id));
    assert(ids[0].every(id => !ids[1].includes(id)));
    return sessions.map(s => ({ projectId: s.fixture.projectId, nativePackage: s.author.package,
      unmodifiedUiCartridge: s.exported.cartridge, realRestart: s.restart.status }));
  });
  await check("Both installed players execute exact twelve combinations, 48 total whitelist actions and real story entry", () => {
    for (const s of sessions) {
      passed(s.player, 2); matrix(s.player.cases); assert.equal(s.player.consoleErrors.length, 0);
      assert.equal(s.player.cartridge.sha256, s.exported.cartridge.sha256);
      assert.equal(fileSha(s.player.exe.path), "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
      for (const c of s.player.cases) {
        assert.equal(c.components.length, 2); assert.equal(c.actions.length, 2);
        assert(c.actions.every(a => a.status === "PASS"));
        for (const p of c.components) {
          assert.equal(p.title, s.fixture.title); assert(p.hit && p.overflow <= 1); assert.equal(p.images.length, 2);
          assert(p.images.every(i => i.width === 48 && i.height === 32 && s.fixture.images.some(a => a.sha256 === i.sha256)));
        }
      }
      assert.equal(s.player.cleanup.status, "PASS");
    }
    return { nativePlayerMatrices: 2, combinations: 24, actions: 48, stories: 2, motionScope: sessions[1].player.motionScope };
  });
  await check("All raw screenshots preserve actual WebView parameters, PNG pixel dimensions and SHA", () => {
    const reports = [authorFailed, restartFailed, ...sessions.flatMap(s => [s.author, s.restart, s.exported, s.player])];
    const shots = reports.flatMap(r => r.screenshots); assert(shots.length >= 40);
    for (const shot of shots) {
      const bytes = fs.readFileSync(shot.path); assert.equal(sha(bytes), shot.sha256);
      assert.deepEqual(shot.before, shot.after);
      assert.equal(bytes.readUInt32BE(16), shot.before.width * shot.before.dpr);
      assert.equal(bytes.readUInt32BE(20), shot.before.height * shot.before.dpr);
    }
    return { screenshots: shots.length, physical4kClaim: false };
  });
  await check("Source support tests match frozen candidate and contain four nonempty passing executions", () => {
    const support = load(first, "support-tests-01.json"); passed(support);
    assert.equal(support.source.length, 5); assert.equal(support.commands.length, 4);
    for (const f of support.source) assert.equal(fileSha(path.join("D:/AgentVN", f.relative)), f.sha256);
    for (const c of support.commands) {
      assert.equal(c.status, "PASS"); assert.equal(c.exitCode, 0); assert(c.stdout.includes("PASS"));
    }
    return { sourceFiles: 5, commands: support.commands };
  });
  await check("Both sessions restore all original profiles; original DB, Dev and pending MSI installation remain unchanged", () => {
    for (const s of sessions) {
      passed(load(s.root, "profile-restoration.json")); let checked = 0;
      for (const p of s.prep.profiles) {
        assert(fs.existsSync(p.original)); assert(!fs.existsSync(p.held));
        for (const f of p.files) {
          assert.equal(fileSha(path.join(p.original, f.relative)), f.sha256);
          assert.equal(fileSha(f.backup), f.sha256); checked++;
        }
      }
      assert.equal(checked, 55);
      assert.equal(fileSha("D:/AgentVN/AgentVN Dev.exe"), s.prep.originalDevSha256);
    }
    const incident = load("D:/AgentVN/output/host-msi-session-20261018-01", "incident-audit-01.json");
    const db = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db";
    assert.equal(fileSha(db), incident.userPersistence.databaseSha256);
    assert.equal(fileSha(path.join(incident.actualInstallation.path, "agentvn-editor.exe")), incident.actualInstallation.executableSha256);
    const alias = "C:/Users/1/AppData/Local/Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/com.agentvn.editor/backend/vn_engine.db";
    const [a, b] = [db, alias].map(p => fs.statSync(p, { bigint: true }));
    assert.equal(a.dev, b.dev); assert.equal(a.ino, b.ino);
    return { checksPerSession: 55, originalDefaultDbSha256: fileSha(db),
      packagedHostPathAliasSameFileIdentity: true, devUnchanged: true, msiUntouched: true };
  });
  await check("Frozen installed Editor/backend attribution, owned teardown and no residual processes/ports are verified", () => {
    const ports = new Set([8278]);
    for (const s of sessions) for (const suffix of ["", "-02"]) {
      const launch = load(s.root, `launch${suffix}.json`), backend = load(s.root, `backend-ready${suffix}.json`);
      const cleanup = load(s.root, `computer-use-import-blocked${suffix}.json`);
      passed(launch); passed(backend);
      assert.equal(launch.executableSha256, "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
      assert.equal(fileSha(path.join(launch.installRoot, "agentvn-editor.exe")), launch.executableSha256);
      assert.equal(fileSha(path.join(launch.installRoot, "creator-backend.exe")), backend.backendSha256);
      assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
      assert.equal(cleanup.cleanupStatus, "PASS");
      assert.equal(cleanup.normalClose, "NOT_RUN_CONTROLLED_TEST_TEARDOWN");
      ports.add(launch.cdpPort); ports.add(launch.playerCdpPort);
    }
    for (const s of sessions) ports.add(s.player.cdpPort);
    const current = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
      $p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -match '(?i)agentvn.*\\.exe|creator-backend' -or
        ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'com\\.agentvn\\.(editor|player)')}|Select-Object Name,ProcessId)
      $s=@(Get-NetTCPConnection -State Listen|Where-Object {$_.LocalPort -in @(${[...ports].join(",")})}|Select-Object LocalPort,OwningProcess)
      @{processes=$p;ports=$s}|ConvertTo-Json -Depth 6
    `], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    assert.equal(current.status, 0, current.stderr);
    const state = JSON.parse(current.stdout.replace(/^\uFEFF/, ""));
    assert.equal(state.processes.length, 0); assert.equal(state.ports.length, 0);
    return { ...state, checkedPorts: [...ports], normalCloseAcceptance: "NOT_RUN" };
  });
  await check("Original failing oracles and untested boundaries remain explicit", () => {
    assert.equal(authorFailed.status, "FAILED"); assert(authorFailed.error.includes("backend_asset_path"));
    assert.equal(restartFailed.status, "FAILED"); assert(restartFailed.error.includes("undefined"));
    const all = [authorFailed, restartFailed, ...sessions.flatMap(s => [s.author, s.restart, s.exported, s.player])];
    assert(all.every(r => r.realModelRequests === 0));
    return { preservedOriginalFailures: 2, noProductRepairOrPaidRetry: true, boundaries: report.boundaries };
  });
  report.status = "PASS"; report.evidenceStatus = "PASS"; report.g15Status = "PASS";
})().catch(e => { report.status = "FAILED"; report.evidenceStatus = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, g15Status: report.g15Status, checks: report.checks.length,
    error: report.error, destination }, null, 2));
});
