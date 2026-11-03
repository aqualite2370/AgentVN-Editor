"use strict";
// Independent complete-template/UI-library/export/native-consumption audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const hash = b => require("node:crypto").createHash("sha256").update(b).digest("hex");
const {validateCandidateConfig}=require("./candidate-layout-consumption.cjs");
const {deriveActual}=require("./installed-profile-data-replay.cjs");
const {validateNativeViewport}=require("./lib/current-native-capture.cjs");
const configArgs=process.argv.filter(a=>a.startsWith("--candidate-config="));assert(configArgs.length<=1);
const config=configArgs.length?validateCandidateConfig(JSON.parse(fs.readFileSync(configArgs[0].slice(19),"utf8"))):null;
const authorArgs=process.argv.filter(a=>a.startsWith("--author="));assert(authorArgs.length<=1);
const playerArgs=process.argv.filter(a=>a.startsWith("--player="));assert(playerArgs.length<=1);
const authorAttempt=authorArgs[0]?.slice(9),playerAttempt=playerArgs[0]?.slice(9);
if(config){assert.match(authorAttempt??"",/^\d{2}$/);assert.match(playerAttempt??"",/^\d{2}$/);}
const roundtripArgs=process.argv.filter(a=>a.startsWith("--roundtrip="));assert(roundtripArgs.length<=1);
const roundtripAttempt=roundtripArgs[0]?.slice(12);
if(roundtripAttempt){assert(config);assert.match(roundtripAttempt,/^\d{2}$/);}
const current1930=process.argv.includes("--candidate=1.9.30");
assert(!config||!current1930);
const version=config?.version??(current1930?"1.9.30":"1.9.24");
const base = config?.qa??(current1930?"F:/AgentVN/QA/Editor-1.9.30-20261026-01":"F:/AgentVN/QA/Editor-1.9.24-20261024-01");
const editorRoot = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-"+(config?authorAttempt:current1930?"66":"57");
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01/gui-library-installed-"+version.replaceAll(".","")+"-"+(config?playerAttempt:"01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const editor = read(path.join(editorRoot, "report.json")), player = read(path.join(playerRoot, "report.json"));
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const key = r => `${r.width}/${r.height}/${r.dpr}/${r.reduced}`;
function nativeDisplayMatches(actual, expected) {
  try { validateNativeViewport(actual, expected); return true; }
  catch { return false; }
}
function business(e, p) {
  assert.equal(e.status, "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN"); assert.equal(p.status, "PASS");
  assert(e.finishedAt && p.finishedAt && !e.error && !p.error && !e.cleanupError && !p.cleanupError && !p.profileRestoreError);
  assert.deepEqual(e.errors, []); assert.deepEqual(p.errors, []); assert.equal(e.modelRequests + p.modelRequests, 0);
  assert.equal(e.steps.length, 8); assert(e.steps.every(s => s.status === "PASS" && s.finishedAt && !s.inheritedFrom));
  assert.equal(e.officialFileCount, 30); assert.equal(e.assetProofs.length, 26);
  if(config){assert.equal(e.version,version);assert.equal(p.version,version);}
  assert.equal(e.matrix.length, 12); assert.equal(p.cases.length, 12);
  assert.equal(e.inheritedMatrix, undefined); assert.equal(e.inheritedAuthor, undefined);
  assert.equal(e.cartridge.assets.length, 7);
  for (const d of matrix) {
    const scans = e.matrix.filter(s => key(s) === key(d)); assert.equal(scans.length, 1);
    assert.equal(scans[0].status, "PASS"); assert(scans[0].focus && scans[0].geometry.hit && scans[0].geometry.overflow <= 1);
    const cases = p.cases.filter(s => key(s) === key(d)); assert.equal(cases.length, 1);
    const c = cases[0]; assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 4);
    assert(c.start.hit && c.choiceHit.hit && c.start.overflow <= 1 && c.choiceHit.overflow <= 1);
    for (const [field, relative] of Object.entries({
      title: "gui/main_menu.png", normal: "gui/button/quick_idle_background.png",
      hover: "gui/button/quick_hover_background.png", scopedHover: "gui/main_menu.png",
      dialog: "gui/textbox.png", choice: "gui/button/choice_idle_background.png",
    })) {
      const expected = e.cartridge.assets.find(a => a.source === "官方模板 中文/game/" + relative); assert(expected);
      const actual = c[field]; assert.equal(actual.sha256, expected.sha256); assert.equal(actual.relative, relative);
      assert(actual.width > 0 && actual.height > 0 && actual.rect.width > 0 && actual.rect.height > 0);
      assert(actual.display !== "none" && actual.visibility === "visible" && actual.opacity !== "0");
    }
    assert(c.fonts.some(f => f.isCustomFont && /DejaVu/i.test(f.familyName) && f.glyphCount > 0));
    assert(c.fonts.some(f => !f.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(f.familyName) && f.glyphCount > 0));
  }
  return { editorGroups: 8, currentScanDisplays: 12, actualPlayerDisplays: 12,
    actualPlayerChecks: 48, exportedDependencies: 7, copiedResources: 26, inheritedOldCandidateResults: false };
}
if (process.argv.includes("--self-test")) {
  business(editor, player);
  const changes = [
    (e, p) => { p.status = "RUNNING"; }, (e, p) => { p.cases = []; },
    (e, p) => { p.cases[0] = p.cases[1]; }, e => { e.matrix = []; },
    e => { e.assetProofs.pop(); }, (e, p) => { p.cases[0].fonts = p.cases[0].fonts.filter(f => !f.isCustomFont); },
    (e, p) => { p.cases[0].fonts = p.cases[0].fonts.filter(f => f.isCustomFont); },
    (e, p) => { p.cases[0].scopedHover.sha256 = "wrong"; },
    (e, p) => { p.cases[0].choiceHit.hit = false; },
    e => { e.inheritedMatrix = { path: "old-candidate" }; },
  ];
  for (const change of changes) {
    const e = structuredClone(editor), p = structuredClone(player); change(e, p); assert.throws(() => business(e, p));
  }
  console.log(JSON.stringify({ status: "PASS", badReceiptsRejected: changes.length, scope: "AUDIT_ONLY" }));
} else {
  assert.match(process.argv[2]??"", /^\d{2}$/);
  const out = path.join(base, "gui-library-audit-"+process.argv[2]); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "CURRENT_INSTALLED_COMPLETE_GUI_ZIP_LIBRARY_REVISIONS_EXPORT_AND_PREVIEW_NOT_DIRECTORY_PICKER_OR_ALL_NEGATIVES_OR_ANDROID",
    inputs: [path.join(editorRoot, "report.json"), path.join(playerRoot, "report.json")].map(desc),
    productChanges: 0, modelRequests: 0, builds: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.detail = await fn(); g.status = "PASS"; } catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  (async () => {
    await group("Complete current-candidate authoring and actual media/font/action business", () => business(editor, player));
    await group("Locked complete official archive, project copies, revisions and exact exported bytes", async () => {
      assert.equal(editor.officialArchive.sha256, "d8d227d86b8e4509bddd85fe8cb22fa4e5c8b31b5370dda68faa8b7c4bc3c582");
      for (const f of [editor.officialArchive, editor.provenance, editor.libraryOriginal, editor.libraryRevision,
        editor.cartridge, editor.tool, player.tool]) assert.equal(sha(f.path), f.sha256);
      const prep = read(editor.provenance.path);
      assert.equal(prep.officialFiles.length, 30);
      const official = await JSZip.loadAsync(fs.readFileSync(editor.officialArchive.path), { checkCRC32: true });
      for (const f of prep.officialFiles)
        assert.equal(hash(await official.file("官方模板 中文/game/" + f.relative).async("nodebuffer")), f.sha256);
      const old = read(editor.libraryOriginal.path), revision = read(editor.libraryRevision.path);
      assert.equal(old.assetCount, 25); assert.equal(old.revision, 1);
      assert.equal(revision.assetCount, 25); assert.equal(revision.revision, 2); assert.equal(revision.parentId, old.id);
      assert.equal(player.source.sha256, sha(path.join(editorRoot, "report.json")));
      const cart = await JSZip.loadAsync(fs.readFileSync(editor.cartridge.path), { checkCRC32: true });
      for (const a of editor.cartridge.assets) {
        assert.equal(hash(await cart.file(a.path).async("nodebuffer")), a.sha256);
        assert.equal(hash(await official.file(a.source).async("nodebuffer")), a.sha256);
      }
      assert.equal(hash(await cart.file("ui/layout.json").async("nodebuffer")), editor.cartridge.layoutSha256);
      return { officialEntries: 30, scannedResources: 25, immutableRevisions: 2, copied: 26, exportedReferenced: 7 };
    });
    await group("Exact frozen installation, real viewport/DPR/media and twenty-five screenshots", () => {
      const installed = read(config?path.join(base,`gui-author-preparation-${authorAttempt}`,"derived-installed.json"):
        path.join(base, current1930?"derived-components-installation-01.json":"installation.json"));
      assert.equal(config||current1930?installed.version:installed.executable.version, version);
      if(config)assert.deepEqual(installed,deriveActual(config.actual,version));
      if(current1930||config) {
        assert.equal(sha(installed.actualInstallation.path),installed.actualInstallation.sha256);
        const actual=read(installed.actualInstallation.path);
        assert(actual.status==="PASS"&&actual.exitCode===0&&actual.registryRestored);
        assert.equal(actual.executable.sha256,installed.executable.sha256);
      }
      for (const f of [installed.executable, ...installed.resources, ...(installed.protectedFiles??[])]) assert.equal(sha(f.path), f.sha256);
      assert.equal(player.executable.sha256, config
        ?installed.resources.find(f=>path.basename(f.path)==="agentvn-player.exe").sha256:current1930
        ?"296b7716cadda05f7c32ba7e46ecafc87017418e456c2744644ecf12ea68a4aa"
        :"6e7f4ec17d8388a99937123f88ddf7cebbe161fac39a19cfe3a3bc849e642168");
      assert.equal(editor.launches.length, 2);
      for (const l of editor.launches) {
        assert.equal(l.executable.sha256, installed.executable.sha256);
        assert(l.dataDirectoryOverride && l.webviewDirectoryOverride && !l.sourceServer && !l.manualBackendSpawn);
      }
      assert.equal(editor.screenshots.length, 13); assert.equal(player.screenshots.length, 12);
      const rawDisplay = { ...matrix[0], dpr: 1.00000001490116 };
      const originalDisplay = structuredClone(rawDisplay);
      assert(nativeDisplayMatches(rawDisplay, matrix[0]));
      assert.deepEqual(rawDisplay, originalDisplay);
      const invalidDisplays = [{ width: 1919 }, { height: 1079 }, { reduced: true },
        { dpr: 2 }, { dpr: 1.00001 }, { dpr: undefined }, { dpr: NaN }, { dpr: Infinity }];
      for (const patch of invalidDisplays)
        assert(!nativeDisplayMatches({ ...rawDisplay, ...patch }, matrix[0]));
      for (const s of [...editor.screenshots, ...player.screenshots]) {
        assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
        const matches = matrix.filter(d => nativeDisplayMatches(s.before, d));
        assert.equal(matches.length, 1, "Exactly one requested native display must match");
        const expected = matches[0];
        validateNativeViewport(s.before,expected);validateNativeViewport(s.after,expected);
        const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), expected.width * expected.dpr);
        assert.equal(b.readUInt32BE(20), expected.height * expected.dpr);
      }
      if(config){
        const binding=read(path.join(base,`gui-author-preparation-${authorAttempt}`,"binding.json"));
        assert.deepEqual(binding.actualInstallation,config.actual);
        assert.equal(sha(binding.adapter.path),binding.adapter.sha256);
        assert.equal(sha(binding.sealed.path),binding.sealed.sha256);
        assert.equal(sha(path.join(editorRoot,"executed-business.cjs")),binding.executedSourceSha256);
        const playerBinding=read(path.join(playerRoot,"binding.json"));
        assert.deepEqual(playerBinding.actualInstallation,config.actual);
        assert.equal(playerBinding.oldResultsInherited,false);
        assert.equal(sha(playerBinding.source.path),playerBinding.source.sha256);
        const executed=fs.readFileSync(path.join(playerRoot,"executed-business.cjs"),"utf8");
        let rebuilt=fs.readFileSync(playerBinding.source.path,"utf8");
        for(const change of playerBinding.adaptations){
          assert.equal(rebuilt.split(change.before).length-1,1);rebuilt=rebuilt.replace(change.before,change.after);
        }
        assert.equal(executed,rebuilt);
      }
      return { actualInstalledEditorLaunches: 2, actualPlayerLaunches: 1, png: 25,
        rawDprPreserved: true, invalidNativeDisplaysRejected: invalidDisplays.length, physical4KClaimed: false };
    });
    await group("Original caches/profiles restored, exact processes and ports absent", () => {
      assert.equal(editor.nativeCacheRestoration, "PASS"); assert.equal(player.cleanupStatus, "PASS");
      assert.equal(player.profileRestored, true);
      const cache = read(path.join(editorRoot, "native-cache-protection.json"));
      const restored = read(path.join(editorRoot, "native-cache-restoration.json"));
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      assert(ps(`fsutil file queryfileid '${cache.original}'`).includes(cache.directoryId)); assert(!fs.existsSync(cache.held));
      for (const f of cache.files) assert.equal(sha(path.join(cache.original, f.relative)), f.sha256);
      const profiles = read(path.join(playerRoot, "profile-restoration.json"));
      assert.equal(profiles.status, "PASS"); assert.equal(profiles.deletedUserFiles, 0);
      for (const p of profiles.restored) {
        assert(ps(`fsutil file queryfileid '${p.original}'`).includes(p.directoryId));
        if (p.byteInventory) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
      const known = [...editor.knownProcesses, ...player.knownProcesses], current = rows();
      assert(known.length > 0);
      for (const p of known) assert(!current.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      const ports = [...editor.launches.flatMap(l => l.ports), player.launch.port]; assert.deepEqual(listeners(ports), []);
      return { editorCacheFiles: cache.files.length, playerProfiles: profiles.restored.length,
        processIdentities: known.length, ports, modelRequests: 0 };
    });
    if(roundtripAttempt) await group("Native resource project save and fresh public reopen; both UI exports and personal library isolation",async()=>{
      const root=`F:/AgentVN/QA/Installed-Layout-20261021-01/editor-${roundtripAttempt}`;
      const file=path.join(root,"report.json"),r=read(file);
      assert.equal(r.status,"PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT");
      assert.equal(r.version,version);assert(r.finishedAt&&!r.error&&!r.cleanupError&&!r.captureError);
      assert.equal(r.modelRequests+r.productChanges+r.builds,0);assert.deepEqual(r.errors,[]);
      assert.deepEqual(r.source,desc(path.join(editorRoot,"report.json")));
      assert.equal(r.cases.length,5);assert(r.cases.every(c=>c.status==="PASS"&&c.finishedAt));
      assert.deepEqual(r.guiResourceCoverage,{projectDependencies:26,renpyExportDependencies:7,
        projectResourceStages:2,personalLibraryBundled:false});
      assert.equal(r.localLibraryNotBundled,true);
      assert.equal(r.launches.length,2);assert.equal(r.cleanups.length,2);
      assert(r.cleanups.every(c=>c.status==="PASS"&&!c.normalCloseClaimed));
      for(const f of [r.source,r.installation,r.portable,r.tool,...r.sourceFiles,...r.installedOracleSources,...r.cartridges])
        assert.equal(sha(f.path),f.sha256,f.path);
      assert.equal(sha(path.join(root,"executed-test.cjs")),r.tool.sha256);
      const z=await JSZip.loadAsync(fs.readFileSync(r.portable.path),{checkCRC32:true});
      const portable=JSON.parse(await z.file("project.json").async("string"));
      assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles,editor.savedProject.settings.runtimeUILayoutProfiles);
      assert.equal(portable.asset_manifest.length,26);
      for(const a of portable.asset_manifest){
        const expected=editor.assetProofs.find(p=>p.id===a.asset_id);assert(expected);
        assert.equal(hash(await z.file(a.metadata.project_path).async("nodebuffer")),expected.sha256);
      }
      assert(!Object.keys(z.files).some(n=>/gui-pack-library|record\.json/.test(n)));
      assert(!fs.existsSync(path.join(root,"fresh-profile/data/gui-pack-library")));
      const dbOriginal=path.join(root,"fresh-profile/data/backend/vn_engine.db"),dbHash=sha(dbOriginal);
      const scratch=path.join(out,"gui-reimport.scratch.db");fs.copyFileSync(dbOriginal,scratch,fs.constants.COPYFILE_EXCL);
      const {DatabaseSync}=require("node:sqlite"),db=new DatabaseSync(scratch,{readOnly:true});
      try{
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
        const records=db.prepare("SELECT project_json FROM editor_project_details").all();assert.equal(records.length,1);
        const value=JSON.parse(records[0].project_json);
        assert.deepEqual(value.editor_settings.runtimeUILayoutProfiles,portable.editor_settings.runtimeUILayoutProfiles);
        assert.equal(value.asset_manifest.length,26);
        for(const a of value.asset_manifest){
          const expected=editor.assetProofs.find(p=>p.id===a.asset_id);assert(expected);
          const assetRoot=path.resolve(root,"fresh-profile/data/backend/project_assets");
          const assetFile=path.resolve(assetRoot,a.metadata.backend_asset_path);
          const relative=path.relative(assetRoot,assetFile);
          assert(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative));
          assert(!fs.lstatSync(assetFile).isSymbolicLink());assert.equal(sha(assetFile),expected.sha256);
        }
      }finally{db.close();}
      assert.equal(sha(dbOriginal),dbHash);
      assert.deepEqual(r.cartridges.map(c=>c.type),["agentvn","renpy"]);
      for(const c of r.cartridges){
        const cart=await JSZip.loadAsync(fs.readFileSync(c.path),{checkCRC32:true});
        const manifest=JSON.parse(await cart.file("manifest.json").async("string"));
        assert.equal(manifest.assets.length,c.type==="renpy"?7:0);
        const layout=JSON.parse(await cart.file("ui/layout.json").async("string"));
        assert.equal(layout.layout_type??"agentvn",c.type);
        assert.equal(hash(await cart.file("ui/layout.json").async("nodebuffer")),c.layoutSha256);
        if(c.type==="renpy")assert.deepEqual(layout,JSON.parse(await
          (await JSZip.loadAsync(fs.readFileSync(editor.cartridge.path),{checkCRC32:true})).file("ui/layout.json").async("string")));
        for(const a of manifest.assets){
          const expected=editor.assetProofs.find(p=>p.id===a.asset_id);assert(expected);
          assert.equal(hash(await cart.file(a.path).async("nodebuffer")),expected.sha256);
        }
        const checks=JSON.parse(await cart.file("checksum.json").async("string"));
        assert.equal(checks.algorithm,"sha256");assert.equal(checks.files.length,c.checksumEntries);
        assert(checks.files.length>0);
        for(const f of checks.files)assert.equal(hash(await cart.file(f.path).async("nodebuffer")),f.hash_sha256);
      }
      assert.equal(r.downloadCleanup.status,"PASS");assert(!fs.existsSync(r.downloadCleanup.original));
      assert.equal(r.downloadCleanup.sha256,r.portable.sha256);assert.equal(r.downloadCleanup.deletedUserFiles,0);
      assert.equal(r.nativeCacheRestoration,"PASS");
      const protection=read(path.join(root,"native-cache-protection.json"));
      const restored=read(path.join(root,"native-cache-restoration.json"));
      assert.equal(restored.status,"PASS");assert.equal(restored.originalDirectoryId,protection.directoryId);
      assert.equal(restored.deletedUserFiles,0);assert(!fs.existsSync(protection.held));
      for(const f of protection.files)assert.equal(sha(path.join(protection.original,f.relative)),f.sha256);
      const current=rows();for(const p of r.knownProcesses)assert(!current.some(n=>n.ProcessId===p.ProcessId&&n.Created===p.Created));
      assert.deepEqual(listeners(r.cleanups.flatMap(c=>c.ports)),[]);
      return {report:desc(file),resources:26,exportDependencies:[0,7],freshDatabaseIndependent:true,
        localLibraryNotBundled:true,nativeProjectSave:true,nativeProjectFilePicker:false};
    });
    report.status = "PASS";
  })().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
    .finally(() => {
      report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
      fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
      console.log(JSON.stringify({ status: report.status, out, error: report.error }));
    });
}
