"use strict";
// Independent byte/database/profile/ownership audit. Never launches product.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-GUI-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `audit-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [], modelRequests: 0,
  scope: "CURRENT_NSIS_INSTALLED_OFFICIAL_GUI_ZIP_AUTHORING_AND_PLAYER_PREVIEW_NOT_FULL_REGRESSION",
  normalClose: "NOT_RUN", nativeDirectoryPicker: "NOT_RUN", WindowsSetup: "NOT_RUN", Android: "NOT_RUN", physical4K: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function check(label, fn) {
  const g = { label, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = await fn(); g.status = "PASS"; console.log(`PASS audit ${label}`); }
  catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; } finally { save(); }
}
function matrix(cells, checks) {
  assert.equal(cells.length, 12); assert.equal(new Set(cells.map(m => `${m.width}/${m.height}/${m.dpr}/${m.reduced}`)).size, 12);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert(cells.some(m => m.width === width && m.height === width * 9 / 16 && m.dpr === dpr && m.reduced === reduced));
  assert(cells.every(c => c.status === "PASS" && (checks === undefined || c.checks.length === checks)));
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  const prep = read(path.join(qa, "preparation.json")), efile = path.join(qa, "editor-03/report.json"),
    nfile = path.join(qa, "editor-04/report.json"),
    pfile = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-gui-current-01/report.json";
  const editor = read(efile), negative = read(nfile), player = read(pfile);
  report.evidence = [desc(path.join(qa, "preparation.json")), desc(efile), desc(nfile), desc(pfile)];
  const ancestry = read(editor.inheritedMatrix.path);
  const allEditors = fs.readdirSync(qa).filter(n => /^editor-\d{2}$/.test(n))
    .map(n => ({ name: n, report: read(path.join(qa, n, "report.json")) }));
  await check("Pinned complete official archive and exact thirty source entries", async () => {
    assert.equal(prep.status, "PASS"); assert.equal(sha(prep.officialArchive.path), prep.officialArchive.sha256);
    assert.equal(prep.officialArchive.sha256, "d8d227d86b8e4509bddd85fe8cb22fa4e5c8b31b5370dda68faa8b7c4bc3c582");
    assert.equal(sha(prep.officialProvenance.path), prep.officialProvenance.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(prep.officialArchive.path), { checkCRC32: true });
    assert.equal(prep.officialFiles.length, 30);
    assert.equal(prep.officialFiles.filter(f => /\.png$/i.test(f.relative)).length, 24);
    assert.equal(prep.officialFiles.filter(f => /\.ttf$/i.test(f.relative)).length, 1);
    for (const f of prep.officialFiles)
      assert.equal(hash(await zip.file("官方模板 中文/game/" + f.relative).async("nodebuffer")), f.sha256);
    assert.equal(sha(prep.input.path), prep.input.sha256);
    return { officialArchive: prep.officialArchive, imageCount: 24, fontCount: 1, originalEntryCount: 30 };
  });
  await check("Actual installed Editor, seven author steps and complete inherited scan matrix", () => {
    assert.equal(editor.status, "EDITOR_PASS_PLAYER_NOT_RUN"); assert.equal(editor.steps.length, 7);
    assert(editor.steps.every(s => s.status === "PASS")); assert.equal(editor.launches.length, 2);
    assert.equal(sha(editor.inheritedMatrix.path), editor.inheritedMatrix.sha256);
    assert.equal(ancestry.status, "FAILED"); assert.match(ancestry.error, /loadingAnimation/);
    const original = ancestry.steps.find(s => s.label === "complete-official-scan-cancel-12-displays");
    assert.equal(original.status, "PASS"); const inherited = editor.steps.find(s => s.evidenceSource);
    const { evidenceSource, ...executed } = inherited; assert.deepEqual(executed, original);
    assert.equal(evidenceSource.sha256, editor.inheritedMatrix.sha256);
    assert.deepEqual(editor.matrix, ancestry.matrix); matrix(editor.matrix);
    for (const c of editor.matrix) {
      assert(c.geometry.buttons.length >= 2 && c.geometry.buttons.every(b => b.hit));
      assert(c.geometry.overflow <= 1 && c.geometry.nativeSelects === 0);
      assert(c.issues.includes("unsupported_context") && c.issues.includes("unsupported_script"));
    }
    for (const { report: r } of allEditors) {
      assert(["FAILED", "PASS", "EDITOR_PASS_PLAYER_NOT_RUN"].includes(r.status));
      assert.equal(r.cleanupError, undefined); assert.equal(r.modelRequests, 0); assert.deepEqual(r.errors, []);
      for (const l of r.launches) {
        assert.equal(sha(l.executable.path), l.executable.sha256); assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
        assert(path.resolve(l.executable.path).startsWith(path.resolve("F:/AgentVN/QA/Installed-Candidate-20261021-01/editor") + path.sep));
        assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
        assert.equal(l.listeners.length, 2); assert.equal(path.resolve(l.isolation.AGENTVN_TEST_PROJECT), path.resolve(prep.input.path));
      }
    }
    assert.equal(editor.steps[0].result.baselineAfterLegacyHydration, true);
    return { authorSteps: 7, scanDisplays: 12, inheritedMatrixNotRerun: editor.inheritedMatrix,
      legacyDefaultsBaselineBeforeGUI: true, defaultPathOrNativeProjectPickerClaimed: false };
  });
  await check("Desktop static values, selective overwrite and exact twenty-five managed resources", () => {
    const first = editor.importedProject, last = editor.finalProject, layout = last.editor_settings.runtimeUILayout;
    assert.equal(layout.renpy.shared.fontSize, 22); assert.equal(layout.renpy.shared.spacing, 4);
    assert.equal(layout.renpy.save_load.saveColumns, 3);
    assert.equal(first.editor_settings.runtimeUILayout.renpy.shared.x, 40); assert.equal(layout.renpy.shared.x, 56);
    assert.equal(first.asset_manifest.length, 25); assert.equal(last.asset_manifest.length, 25);
    assert.deepEqual(first.asset_manifest.map(a => a.asset_id), last.asset_manifest.map(a => a.asset_id));
    const before = structuredClone(first.editor_settings), after = structuredClone(last.editor_settings);
    for (const p of [before, after]) {
      p.runtimeUILayout.renpy.shared.x = 0; p.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.x = 0;
    }
    assert.deepEqual(after, before);
    assert.equal(editor.importedAssetProofs.length, 25); assert.equal(editor.assetProofs.length, 25);
    for (const a of editor.importedAssetProofs) assert.equal(a.sha256, prep.officialFiles.find(f => f.relative === a.relative).sha256);
    const edited = editor.assetProofs.find(a => a.relative === "gui/button/quick_idle_background.png");
    assert.notEqual(edited.sha256, editor.importedAssetProofs.find(a => a.id === edited.id).sha256);
    assert.equal(edited.sha256, prep.officialFiles.find(f => f.relative === "gui/button/choice_hover_background.png").sha256);
    for (const a of editor.assetProofs) if (a.id !== edited.id)
      assert.equal(a.sha256, editor.importedAssetProofs.find(p => p.id === a.id).sha256);
    assert(editor.fontCoverage.includes("项目字符存在缺字") && editor.fontCoverage.includes("回退到系统字体"));
    return { staticValues: { fontSize: 22, spacing: 4, columns: 3, selectedX: 56 },
      imagesAndFonts: 25, rewrittenUsedImage: edited, unselectedValuesAndAgentVNPreserved: true };
  });
  await check("Native portable file bytes, both layouts, resource bytes and Downloads cleanup", async () => {
    assert.equal(sha(editor.portable.path), editor.portable.sha256);
    assert.equal(editor.nativeSaveSource.sha256, editor.portable.sha256);
    assert(!fs.existsSync(editor.nativeSaveSource.path)); assert.equal(editor.downloadCleanup.status, "PASS");
    assert.equal(editor.downloadCleanup.deletedUserFiles, 0);
    const zip = await JSZip.loadAsync(fs.readFileSync(editor.portable.path), { checkCRC32: true });
    const project = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, editor.finalProject.editor_settings.runtimeUILayoutProfiles);
    assert.equal(project.asset_manifest.length, 25);
    for (const a of project.asset_manifest)
      assert.equal(hash(await zip.file(a.metadata.project_path).async("nodebuffer")), editor.assetProofs.find(p => p.id === a.asset_id).sha256);
    return { portable: editor.portable, verifiedAssets: 25, removedOwnedDownload: editor.nativeSaveSource.path, deletedUserFiles: 0 };
  });
  await check("Actual UI cartridge contains only six bound dependencies and current layout", async () => {
    const c = editor.cartridge; assert.equal(sha(c.path), c.sha256); assert.equal(c.assets.length, 6);
    const zip = await JSZip.loadAsync(fs.readFileSync(c.path), { checkCRC32: true });
    const bytes = await zip.file("ui/layout.json").async("nodebuffer");
    assert.equal(hash(bytes), c.layoutSha256); assert.deepEqual(JSON.parse(bytes), c.layout);
    assert.deepEqual(c.layout, editor.finalProject.editor_settings.runtimeUILayout);
    assert(!zip.file("project.json") && !c.layout.profiles); assert.equal(c.layout.layout_type, "renpy");
    const expected = ["DejaVuSans.ttf", "gui/main_menu.png", "gui/textbox.png", "gui/button/choice_idle_background.png",
      "gui/button/quick_idle_background.png", "gui/button/quick_hover_background.png"].sort();
    assert.deepEqual(c.assets.map(a => a.relative).sort(), expected);
    assert.equal(c.manifest.assets.length, 6);
    for (const a of c.assets) {
      assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256);
      assert.equal(a.sha256, editor.assetProofs.find(p => p.id === a.id).sha256);
    }
    return { cartridge: { path: c.path, sha256: c.sha256, bytes: c.bytes, generatedAt: c.generatedAt },
      layoutSha256: c.layoutSha256, dependencies: c.assets, unboundResourcesOmitted: 19 };
  });
  await check("Installed Player twelve displays, real images, fonts, menus, pages and choice selection", () => {
    assert.equal(player.status, "PASS"); assert.equal(sha(player.source.path), player.source.sha256);
    assert.equal(player.source.sha256, sha(efile)); assert.equal(player.launches.length, 1); matrix(player.cases, 4);
    assert.equal(sha(player.executable.path), player.executable.sha256); assert.equal(player.modelRequests, 0); assert.deepEqual(player.errors, []);
    const expected = relative => editor.cartridge.assets.find(a => a.relative === relative).sha256;
    for (const c of player.cases) {
      const s = c.samples;
      for (const [key, relative] of Object.entries({
        titleImage: "gui/main_menu.png", titleNormal: "gui/button/quick_idle_background.png",
        titleFocus: "gui/button/quick_hover_background.png", titleHover: "gui/button/quick_hover_background.png",
        menuNormal: "gui/button/quick_idle_background.png", menuFocus: "gui/button/quick_hover_background.png",
        dialogImage: "gui/textbox.png", choiceImage: "gui/button/choice_idle_background.png",
      })) assert.equal(s[key].sha256, expected(relative));
      assert(s.titleGeometry.hit && s.menuGeometry.hit && s.choiceGeometry.hit);
      assert(Math.abs(s.titleGeometry.fontSize - 22 * s.titleScale) <= .1);
      assert(Math.abs(s.titleGap - 4 * s.titleScale) <= .1);
      assert.equal(s.grid.declared, "3"); assert.equal(s.grid.slots.length, 6);
      assert(s.fonts.some(f => f.isCustomFont && /DejaVu/i.test(f.familyName) && f.glyphCount > 0));
      assert(s.fonts.some(f => !f.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(f.familyName) && f.glyphCount > 0));
      assert.equal(s.fontBytes.sha256, expected("DejaVuSans.ttf"));
      assert(c.checks.every(t => t.status === "PASS"));
    }
    return { displayCases: 12, actualBusinessChecks: 48, nativePlayer: player.executable,
      realLatinAndChineseGlyphFonts: true, injectedSelectedOrDisabledStates: false, standaloneSetupClaimed: false };
  });
  await check("Eight hostile/invalid archives and real failed-apply rollback", () => {
    assert.equal(negative.status, "PASS"); assert.equal(sha(negative.source.path), negative.source.sha256);
    assert.equal(negative.source.sha256, sha(efile)); assert.equal(negative.cases.length, 8);
    assert.deepEqual(negative.cases.map(c => c.name), ["traversal", "case-duplicate", "symlink", "compression-limit",
      "missing-gui", "ambiguous-gui", "unsupported-expression", "damaged-image"]);
    for (const c of negative.cases) {
      assert.equal(c.status, "PASS"); assert(c.issues.includes(c.expectedIssue));
      assert.equal(sha(c.artifact.path), c.artifact.sha256);
    }
    assert(negative.conflictError.includes("BINDING_CONFLICT:title_background"));
    assert.equal(negative.assetProofs.length, 25);
    for (const a of negative.assetProofs) assert.equal(a.sha256, editor.assetProofs.find(p => p.id === a.id).sha256);
    assert.equal(negative.modelRequests, 0); assert.deepEqual(negative.errors, []);
    return { cases: 8, checks: negative.checks, realFailedTransaction: negative.conflictError, originalAssetBytesAfterFailure: 25 };
  });
  await check("Read-only copied test SQLite contains saved layouts and all twenty-five assets", () => {
    const original = path.join(editor.launches[0].data, "backend/vn_engine.db"), copyRoot = path.join(out, "sqlite-copy");
    fs.mkdirSync(copyRoot);
    for (const suffix of ["", "-wal", "-shm"]) if (fs.existsSync(original + suffix)) {
      const copy = path.join(copyRoot, "vn_engine.db" + suffix); fs.copyFileSync(original + suffix, copy, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(original + suffix), sha(copy));
    }
    const db = new DatabaseSync(path.join(copyRoot, "vn_engine.db"), { readOnly: true });
    try {
      const all = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
      assert.equal(all.length, 1); assert.equal(all[0].project_id, prep.projectId);
      const project = JSON.parse(all[0].project_json);
      assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, editor.finalProject.editor_settings.runtimeUILayoutProfiles);
      assert.equal(project.asset_manifest.length, 25);
      return { original: desc(original), copied: desc(path.join(copyRoot, "vn_engine.db")), projectId: prep.projectId, readOnly: true };
    } finally { db.close(); }
  });
  await check("PNG parameters, unchanged binaries/user data, restored profiles/cache and no owned process/port residue", () => {
    const shots = [...ancestry.screenshots, ...editor.screenshots, ...negative.screenshots, ...player.screenshots]; assert(shots.length >= 7);
    for (const s of shots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      const bytes = fs.readFileSync(s.path);
      assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
      assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr);
    }
    for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path);
    const restored = read(player.profileRestoration.path); assert.equal(sha(player.profileRestoration.path), player.profileRestoration.sha256);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    const directoryId = dir => ps(`$v=(& fsutil.exe file queryfileid '${dir.replace(/'/g, "''")}'|Out-String);` +
      `if($LASTEXITCODE -ne 0 -or $v -notmatch '0x[0-9a-fA-F]+'){throw 'Directory ID unavailable'};$Matches[0].ToLowerInvariant()`);
    for (const r of restored.restored) {
      assert.equal(directoryId(r.original), r.directoryId);
      for (const f of r.files) assert.equal(sha(path.join(r.original, f.relative)), f.sha256);
    }
    for (const { report: r } of allEditors) {
      assert.equal(r.cleanupError, undefined); assert(r.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
      const cached = r.nativeCacheRestoration; assert.equal(sha(cached.path), cached.sha256);
      const journal = read(cached.path); assert.equal(journal.status, "PASS"); assert.equal(journal.deletedUserFiles, 0);
      assert.equal(directoryId(journal.originalDirectory), journal.originalDirectoryId);
      for (const f of journal.originalFiles) assert.equal(sha(path.join(journal.originalDirectory, f.relative)), f.sha256);
    }
    assert.equal(player.cleanupError, undefined); assert(player.cleanups.every(c => c.status === "PASS" && !c.normalCloseClaimed));
    const owned = [...allEditors.flatMap(a => a.report.knownProcesses), ...player.knownProcesses];
    const ids = new Set(owned.map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => ids.has(`${p.ProcessId}:${p.Created}`)));
    const ports = [...new Set([...allEditors.flatMap(a => a.report.launches.flatMap(l => l.ports)), ...player.launches.map(l => l.port)])];
    assert.equal(listeners(ports).length, 0);
    report.incidentalEnvironmentCheck = editor.incidentalEnvironmentCheck;
    assert(["failed", "completed"].includes(editor.incidentalEnvironmentCheck.phase));
    report.environmentClaim = "Observed under QA native-cache Junction, not a normal-path Windows build/export result";
    return { screenshots: shots.map(s => desc(s.path)), uniqueProcessIdentities: ids.size, ports,
      immutableFiles: prep.immutable.length, deletedUserFiles: 0, forcedTerminationNotNormalClose: true };
  });
  await check("QA syntax, checked Git publishing/ignores and unchanged repository HEAD/index", () => {
    const run = (cmd, args) => {
      const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 60000 });
      assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stdout}\n${r.stderr}`);
      return { command: cmd, args, exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    };
    const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    const index = path.resolve(root, run("git", ["rev-parse", "--git-path", "index"]).stdout.trim()), indexSha = sha(index);
    const files = ["scripts/installed-gui-current.cjs", "scripts/installed-gui-current-player.cjs",
      "scripts/installed-gui-current-negative.cjs", "scripts/installed-gui-current-audit.cjs", "scripts/lib/installed-candidate-feature-session.cjs"];
    const commands = files.map(f => run(process.execPath, ["--check", f]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "SelfTest",
      "-RunDirectory", path.join(qa, "editor-99")]));
    commands.push(run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/push-agentvn-editor.ps1"), "-CheckOnly"]));
    run("git", ["check-ignore", "--", "output/installed-gui-current-20261021-01/REPORT.md"]);
    for (const f of files) assert.equal(spawnSync("git", ["check-ignore", "--", f], { cwd: root, windowsHide: true }).status, 1);
    assert.equal(run("git", ["rev-parse", "HEAD"]).stdout.trim(), head); assert.equal(sha(index), indexSha);
    return { commands, head, indexSha256: indexSha, pushPerformed: false, gitignoreChangeNeeded: false };
  });
  assert.equal(report.groups.length, 10); report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => { report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, groups: report.groups.map(g => [g.label, g.status]), error: report.error })); });
