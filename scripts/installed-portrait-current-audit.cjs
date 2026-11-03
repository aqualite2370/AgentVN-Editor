"use strict";
// Independent inspection of package/SQLite/geometry/ownership evidence.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { portraitObservation, verifyPortrait, verifyCustom, close } = require("./lib/portrait-installed-observation.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const editorAttempt = process.argv[2] || "03", playerAttempt = process.argv[3] || "01", attempt = process.argv[4] || "01";
for (const a of [editorAttempt, playerAttempt, attempt]) assert.match(a, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], modelRequests: 0,
  productStatus: "FAILED", productFailures: ["INSTALLED-LAYOUT-REACT185-01"],
  scope: "CURRENT_NSIS_INSTALLED_PORTRAIT_AUTHOR_AND_PLAYER_PREVIEW_NOT_FULL_REGRESSION",
  normalClose: "NOT_RUN", nativePicker: "NOT_RUN", WindowsSetup: "NOT_RUN", Android: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(label, fn) {
  const g = { label, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = await fn(); g.status = "PASS"; console.log(`PASS audit ${label}`); }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; } finally { save(); }
}
function matrix(cells, type, count) {
  assert.equal(cells.length, 12);
  assert.equal(new Set(cells.map(m => `${m.width}/${m.dpr}/${m.reduced}`)).size, 12);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert(cells.some(m => m.width === width && m.height === width * 9 / 16 && m.dpr === dpr && m.reduced === reduced
      && m.status === "PASS" && m.checks.length === count && (!type || m.type === type)));
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const prep = read(path.join(qa, "preparation.json")), efile = path.join(qa, `editor-${editorAttempt}/report.json`),
    pfile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-portrait-current-${playerAttempt}/report.json`;
  const editor = read(efile), player = read(pfile);
  const displayFile = path.join(qa, "display-01/report.json"), display = read(displayFile);
  const allEditors = fs.readdirSync(qa).filter(n => /^editor-\d{2}$/.test(n))
    .map(n => ({ name: n, report: read(path.join(qa, n, "report.json")) }));
  report.evidence = [desc(path.join(qa, "preparation.json")), desc(efile), desc(pfile), desc(displayFile)];
  await check("Actual installed author controls/defaults/history/twelve displays and immutable story", () => {
    assert.equal(prep.status, "PASS"); assert.equal(sha(prep.input.path), prep.input.sha256);
    assert.equal(sha(prep.fixtureSource.path), prep.fixtureSource.sha256);
    assert.equal(editor.status, "FAILED"); assert.equal(editor.steps.length, 6);
    assert(editor.errors.length > 0 && editor.errors.every(e => e.includes("Minified React error #185")));
    assert.match(editor.error, /deep-equal/);
    assert(editor.steps.every(s => s.status === "PASS")); assert.equal(editor.launches.length, 1); matrix(editor.matrix, null, 2);
    assert.equal(sha(editor.inheritedEvidence.path), editor.inheritedEvidence.sha256);
    const previous = read(editor.inheritedEvidence.path); assert.equal(previous.status, "FAILED");
    assert.match(previous.error, /undefined[\s\S]*agentvn/); assert.equal(previous.launches.length, 2);
    for (let i = 0; i < 5; i++) {
      const { evidenceSource, ...inherited } = editor.steps[i]; assert.deepEqual(inherited, previous.steps[i]);
      assert.deepEqual(evidenceSource, editor.inheritedEvidence);
    }
    assert.deepEqual(editor.matrix, previous.matrix); assert.deepEqual(editor.author, previous.author);
    assert.equal(display.status, "PASS"); assert.equal(sha(display.source.path), display.source.sha256);
    assert.equal(display.source.sha256, sha(efile)); assert.equal(display.cases.length, 12);
    const displayKeys = new Set();
    for (const c of display.cases) {
      assert.equal(c.status, "PASS"); displayKeys.add(`${c.width}/${c.dpr}/${c.reduced}`); assert.equal(c.types.length, 2);
      validateNativeViewport(c.before, c); validateNativeViewport(c.after, c); assert.deepEqual(c.before, c.after);
      for (const t of c.types) {
        validateNativeViewport(t.actual, c); assert.equal(t.inputs.length, 3); assert(t.inputs.every(i => i.hit && i.focused && i.overflow <= 1));
      }
    }
    assert.equal(displayKeys.size, 12);
    for (const m of editor.matrix) for (const type of ["agentvn", "renpy"]) {
      const c = m.checks.find(c => c.type === type); assert(c && c.status === "PASS"); assert.equal(c.controls.length, 3);
      assert(c.controls.every(g => g.hit && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0
        && g.rect.right <= m.width + 1 && g.rect.bottom <= m.height + 1));
      verifyPortrait(c.preview, prep.portraitSha256); verifyCustom(c.preview, prep.values[type]);
      const a = editor.author[type]; verifyPortrait(a.baseline, prep.portraitSha256); verifyPortrait(a.custom, prep.portraitSha256);
      verifyCustom(a.custom, prep.values[type]); close(a.baseline.image.right, a.baseline.speaker.left - 12 * a.baseline.scale * a.baseline.panelScale);
      assert.deepEqual(a.baseline.body, a.custom.body); assert.deepEqual(a.baseline.speaker, a.custom.speaker);
      close(a.reset.image.x, a.baseline.image.x); close(a.reset.image.y, a.baseline.image.y);
      assert.deepEqual(editor.finalProject.editor_settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, prep.values[type]);
    }
    for (const { report: r } of allEditors) {
      assert(["FAILED", "EDITOR_PASS_PLAYER_NOT_RUN"].includes(r.status)); assert.equal(r.cleanupError, undefined);
      assert.equal(r.modelRequests, 0);
      if (r.errors.length) assert(r.errors.every(e => e.includes("Minified React error #185")));
      for (const l of r.launches) {
        assert.equal(sha(l.executable.path), l.executable.sha256); assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
        assert(path.resolve(l.executable.path).startsWith(path.resolve("F:/AgentVN/QA/Installed-Candidate-20261021-01/editor") + path.sep));
        assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
        assert.equal(l.listeners.length, 2); assert.equal(path.resolve(l.isolation.AGENTVN_TEST_PROJECT), path.resolve(prep.input.path));
      }
    }
    return { displays: 12, typeChecks: 24, authorSteps: 6, inheritedAuthorEvidence: editor.inheritedEvidence,
      actualParametersSupplement: desc(displayFile), defaultResetUndoRedoAndRestart: true, sourceSeedNotNativePicker: true,
      editorFeatureStatus: "FAILED", renderErrors: editor.errors, firstExceptionTimestampAndFrame: "NOT_CAPTURED_IN_ORIGINAL_RUN" };
  });
  await check("Portable file retains both configurations and exact dedicated portrait bytes", async () => {
    assert.equal(sha(editor.portable.path), editor.portable.sha256); assert.equal(editor.nativeSaveSource.sha256, editor.portable.sha256);
    assert(!fs.existsSync(editor.nativeSaveSource.path)); assert.equal(editor.downloadCleanup.status, "PASS");
    assert.equal(editor.downloadCleanup.deletedUserFiles, 0);
    const zip = await JSZip.loadAsync(fs.readFileSync(editor.portable.path), { checkCRC32: true });
    const project = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, editor.finalProject.editor_settings.runtimeUILayoutProfiles);
    assert.equal(project.asset_manifest.length, 1); const asset = project.asset_manifest[0]; assert.equal(asset.asset_id, "qa_portrait");
    assert.equal(hash(await zip.file(asset.metadata.project_path).async("nodebuffer")), prep.portraitSha256);
    return { portable: editor.portable, bothProfiles: true, portraitSha256: prep.portraitSha256 };
  });
  await check("Two actual UI cartridges use independent active configurations and identical narrative", async () => {
    assert.equal(editor.cartridges.length, 2);
    for (const type of ["agentvn", "renpy"]) {
      const c = editor.cartridges.find(c => c.type === type); assert(c); assert.equal(sha(c.path), c.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(c.path), { checkCRC32: true });
      const bytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(bytes);
      assert.equal(hash(bytes), c.layoutSha256); assert.deepEqual(layout, c.layout);
      assert.equal(layout.layout_type === undefined ? "agentvn" : layout.layout_type, type);
      assert.deepEqual(layout.dialogPortrait, prep.values[type]);
      assert(!zip.file("project.json") && !layout.profiles);
      assert.equal(c.manifest.runtime_version, "0.22.0"); assert.equal(c.manifest.assets.length, 1);
      assert.equal(hash(await zip.file(c.assetPath).async("nodebuffer")), prep.portraitSha256);
      assert.equal(hash(await zip.file("script.json").async("nodebuffer")), c.scriptSha256);
    }
    assert.equal(editor.cartridges[0].scriptSha256, editor.cartridges[1].scriptSha256);
    return { cartridges: editor.cartridges.map(({ type, path, sha256, layoutSha256 }) => ({ type, path, sha256, layoutSha256 })),
      portraitSha256: prep.portraitSha256, requiredRuntime: "0.22.0" };
  });
  await check("Same installed Player twenty-four displays/forty-eight checks and actual unbound advance", () => {
    assert.equal(player.status, "PASS"); assert.equal(sha(player.source.path), player.source.sha256);
    assert.equal(player.source.sha256, sha(efile)); assert.equal(sha(player.executable.path), player.executable.sha256);
    assert.equal(player.launches.length, 2); assert.equal(player.cases.length, 24);
    for (const type of ["agentvn", "renpy"]) {
      const cells = player.cases.filter(c => c.type === type); matrix(cells, type, 2);
      for (const c of cells) {
        verifyPortrait(c.bound, prep.portraitSha256); verifyCustom(c.bound, prep.values[type]);
        validateNativeViewport(c.bound.viewport, c); assert.deepEqual(c.unboundBody, c.bound.body);
        assert(c.bound.text.includes("PORTRAIT_LAYOUT"));
      }
    }
    assert.equal(player.modelRequests, 0); assert.deepEqual(player.errors, []); assert.equal(player.cleanupError, undefined);
    return { displays: 24, businessChecks: 48, nativePlayer: player.executable, standaloneOrAndroidClaimed: false };
  });
  await check("Read-only exact test SQLite confirms separate configurations and original story", () => {
    const original = path.join(editor.launches[0].data, "backend/vn_engine.db"), copyDir = path.join(out, "sqlite-copy"); fs.mkdirSync(copyDir);
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(original + suffix)) {
      const target = path.join(copyDir, "vn_engine.db" + suffix); fs.copyFileSync(original + suffix, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(target), sha(original + suffix));
    }
    const db = new DatabaseSync(path.join(copyDir, "vn_engine.db"), { readOnly: true });
    try {
      const all = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
      assert.equal(all.length, 1); assert.equal(all[0].project_id, prep.projectId); const project = JSON.parse(all[0].project_json);
      assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles.profiles, editor.finalProject.editor_settings.runtimeUILayoutProfiles.profiles);
      assert.equal(project.asset_manifest.length, 1); assert.equal(project.asset_manifest[0].asset_id, "qa_portrait");
      const commands = p => p.nodes.filter(n => n.data.scene).flatMap(n => n.data.scene.commands);
      assert.deepEqual(commands(project), commands(editor.initialProject));
      return { original: desc(original), copy: desc(path.join(copyDir, "vn_engine.db")), projectId: prep.projectId, readOnly: true };
    } finally { db.close(); }
  });
  await check("PNG/profile restoration, disclosed later native cache mutation and zero owned residue", () => {
    const shots = [...allEditors.flatMap(r => r.report.screenshots), ...player.screenshots, ...display.screenshots]; assert(shots.length >= 6);
    for (const s of shots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); const b = fs.readFileSync(s.path);
      assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
      assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
    }
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path);
    const directoryId = dir => ps(`$v=(& fsutil.exe file queryfileid '${dir.replace(/'/g, "''")}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'Directory ID unavailable'};$Matches[0].ToLowerInvariant()`);
    const restoration = read(player.profileRestoration.path); assert.equal(sha(player.profileRestoration.path), player.profileRestoration.sha256);
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    for (const r of restoration.restored) {
      assert.equal(directoryId(r.original), r.directoryId); for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    const laterCacheMutations = [];
    for (const { name, report: r } of allEditors) {
      const j = read(r.nativeCacheRestoration.path); assert.equal(sha(r.nativeCacheRestoration.path), r.nativeCacheRestoration.sha256);
      assert.equal(j.status, "PASS"); assert.equal(j.deletedUserFiles, 0);
      assert.equal(directoryId(j.originalDirectory), j.originalDirectoryId);
      for (const f of j.originalFiles) {
        const current = sha(path.join(j.originalDirectory, f.relative));
        if (current !== f.sha256) {
          assert(["windows-env-check.json", "windows-env-check.log"].includes(f.relative),
            "Any undisclosed cache difference must fail this audit");
          laterCacheMutations.push({ previousRun: name, relative: f.relative, beforeSha256: f.sha256, currentSha256: current });
        }
      }
      assert(r.cleanups.length > 0 && r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    }
    assert.equal(new Set(laterCacheMutations.map(f => f.relative)).size, 2);
    const diagnosticReports = ["01", "02", "03"].map(a => {
      const file = path.join(qa, `diagnostic-${a}/report.json`), r = read(file);
      assert.equal(r.cleanupError, undefined); assert.equal(r.modelRequests, 0);
      assert(["DIAGNOSTIC_FAILED", "REPRODUCED", "NOT_REPRODUCED_ORIGINAL_FAILURE_REMAINS_OPEN"].includes(r.status));
      assert(r.cleanups.length > 0 && r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
      if (a === "01") {
        assert.equal(r.status, "DIAGNOSTIC_FAILED"); assert(r.failureDOM.includes("已复用此前通过的环境检测"));
        assert(!r.nativeCacheRestoration);
      } else {
        const cached = read(r.nativeCacheRestoration); assert.equal(cached.status, "PASS"); assert.equal(cached.deletedUserFiles, 0);
        assert.equal(directoryId(cached.originalDirectory), cached.originalDirectoryId);
        for (const f of cached.originalFiles) assert.equal(sha(path.join(cached.originalDirectory, f.relative)), f.sha256);
      }
      return { ...r, evidence: desc(file) };
    });
    const retainedCache = path.join(out, "disclosed-current-cache"); fs.mkdirSync(retainedCache);
    for (const relative of new Set(laterCacheMutations.map(f => f.relative))) {
      const original = path.join(read(allEditors[0].report.nativeCacheRestoration.path).originalDirectory, relative),
        copy = path.join(retainedCache, relative);
      fs.copyFileSync(original, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(original));
    }
    assert.equal(display.cleanupError, undefined); assert.equal(display.modelRequests, 0); assert.deepEqual(display.errors, []);
    assert(display.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    const ids = new Set([...allEditors.flatMap(r => r.report.knownProcesses), ...player.knownProcesses, ...display.knownProcesses,
      ...diagnosticReports.flatMap(r => r.knownProcesses)].map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...new Set([...allEditors.flatMap(r => r.report.launches.flatMap(l => l.ports)),
      ...player.launches.map(l => l.port), ...display.launches.flatMap(l => l.ports),
      ...diagnosticReports.flatMap(r => r.launches.flatMap(l => l.ports))])];
    assert.equal(listeners(ports).length, 0); assert(player.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    report.incidentalEnvironmentCheck = editor.incidentalEnvironmentCheck;
    report.diagnostics = diagnosticReports.map(r => ({ evidence: r.evidence, status: r.status, pendingPreview: r.pendingPreview,
      steps: r.steps.length, errors: r.errors, errorEvents: r.errorEvents }));
    report.nativeCacheProtectionGap = { status: "QA_GAP_REAL_USER_CACHE_UPDATED_BY_NORMAL_DETECTION",
      mutationDuring: diagnosticReports[0].evidence, changed: laterCacheMutations, currentCopies: retainedCache,
      originalBytesNotRestored: true, claim: "Later protection does not prove pre-diagnostic-01 bytes unchanged" };
    return { screenshots: shots.map(s => desc(s.path)), processIdentities: ids.size, ports, immutableFiles: prep.immutable.length,
      deletedUserFiles: 0, forcedTerminationNotNormalClose: true, nativeCacheProtectionGap: report.nativeCacheProtectionGap };
  });
  await check("QA oracle rejection tests/thirteen path boundaries/Git safety and ignored generated evidence", () => {
    const run = (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stdout}\n${r.stderr}`);
      return { command: cmd, args, exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"]).stdout.trim()), indexSha = sha(index);
    const files = ["scripts/installed-portrait-current.cjs", "scripts/installed-portrait-current-player.cjs",
      "scripts/installed-portrait-current-audit.cjs", "scripts/lib/portrait-installed-observation.cjs", "scripts/portrait-installed-observation-test.cjs",
      "scripts/lib/installed-candidate-feature-session.cjs", "scripts/installed-portrait-current-display.cjs",
      "scripts/installed-portrait-switch-diagnostic.cjs"];
    const commands = files.map(f => run(process.execPath, ["--check", f]));
    commands.push(run(process.execPath, ["scripts/portrait-installed-observation-test.cjs"]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "SelfTest", "-RunDirectory", path.join(qa, "editor-99")]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"]));
    run("git", ["check-ignore", "--", "output/installed-portrait-current-20261021-01/REPORT.md"]);
    for (const f of files) assert.equal(spawnSync("git", ["check-ignore", "--", f], { cwd: root, windowsHide: true }).status, 1);
    assert.equal(run("git", ["rev-parse", "HEAD"]).stdout.trim(), head); assert.equal(sha(index), indexSha);
    return { commands, head, indexSha256: indexSha, pushPerformed: false, gitignoreChangeNeeded: false };
  });
  assert.equal(report.groups.length, 7); report.status = "EVIDENCE_AUDIT_PASS_PRODUCT_FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => [g.label, g.status]), error: report.error })); });
