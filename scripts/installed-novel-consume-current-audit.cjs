"use strict";
// Independent artifact/SQLite/cleanup audit. A passing default-port slice does not clear the port defect.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite"), JSZip = require("../editor/node_modules/jszip");
const { qa, desc, read, sha, persistenceContent } = require("./installed-novel-consume-current.cjs");
const { graphContent, cartridgeEvidence } = require("./native-novel-consume.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
function validate(editor, player) {
  for (const r of [editor, player]) {
    assert.equal(r.status, "PASS"); assert.equal(r.version, "1.9.22"); assert(r.finishedAt);
    for (const name of ["error", "cleanupError", "captureError"]) assert(!r[name], name);
    assert.equal(r.modelRequests, 0); assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0);
    assert.equal(r.cases.length, 12); assert.deepEqual(r.errors, []);
    const seen = new Set();
    for (const c of r.cases) {
      assert.equal(c.status, "PASS");
      assert([1920, 2560, 3840].includes(c.width)); assert.equal(c.height, c.width * 9 / 16);
      assert([1, 2].includes(c.dpr)); assert.equal(typeof c.reduced, "boolean");
      validateNativeViewport(c.viewport, c);
      seen.add(`${c.width}/${c.dpr}/${c.reduced}`);
      if (r === editor) {
        assert(c.focus && c.geometry.hit && c.geometry.overflow <= 1);
        const g = c.geometry, b = g.rect; assert(b.left >= 0 && b.top >= 0 && b.width > 0 && b.height > 0 &&
          b.right <= g.width + 1 && b.bottom <= g.height + 1);
      } else {
        assert.equal(c.playback.length, 2); assert.equal(c.background.length, 1);
        for (const [i, p] of c.playback.entries()) {
          assert.deepEqual(p.expected, editor.exported.playback[i]);
          assert.equal(p.observed.text, p.expected.text); assert.equal(p.observed.scene, p.expected.sceneId);
          assert.equal(p.observed.type, p.expected.type); assert.equal(p.observed.pages, "1"); assert.equal(p.observed.done, "true");
          const o = p.observed; assert(o.hit && o.overflow <= 1 && o.rect.left >= 0 && o.rect.top >= 0 &&
            o.rect.right <= c.width + 1 && o.rect.bottom <= c.height + 1);
        }
        assert.equal(c.background[0].sha256, editor.exported.assets[0].sha256);
        assert(c.background[0].width > 0 && c.background[0].height > 0);
      }
    }
    assert.equal(seen.size, 12); assert(r.cleanups.length > 0);
    assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
  }
  assert.equal(editor.steps.length, 4); assert(editor.steps.every(c => c.status === "PASS"));
  assert(editor.steps[0].inheritedFrom && editor.continuation.originalFailurePreserved);
  assert(editor.downloadEvents.some(e => e.event === "Browser.downloadWillBegin"));
  const start = editor.downloadEvents.find(e => e.event === "Browser.downloadWillBegin");
  const end = editor.downloadEvents.find(e => e.event === "Browser.downloadProgress" && e.detail.state === "completed");
  assert(end && start.detail.guid === end.detail.guid); assert.equal(end.detail.receivedBytes, editor.cartridge.bytes);
  assert.equal(end.detail.totalBytes, editor.cartridge.bytes);
  assert.equal(path.resolve(end.detail.filePath), path.resolve(editor.cartridge.path));
  assert.equal(player.source.sha256, sha(player.source.path));
  assert.equal(player.cartridge.sha256, editor.cartridge.sha256);
  assert.equal(player.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.match(player.playerVersion.ProductVersion, /^1\.9\.1(?:\D|$)/);
}
async function run(editorId, playerId, auditId) {
  for (const id of [editorId, playerId, auditId]) assert.match(id, /^\d{2}$/);
  const editorFile = path.join(qa, `session-${editorId}`, "report.json");
  const playerFile = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-novel-consume-1922-${playerId}/report.json`;
  const editor = read(editorFile), player = read(playerFile);
  const out = path.join(qa, `consume-audit-${auditId}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    inputs: [desc(editorFile), desc(playerFile)], checks: [],
    featureResults: { defaultNovelAuthorExportInstalledPlayer: "NOT_EVALUATED", dynamicPortNovelAnalysis: "FAILED",
      realDeepSeekQuality: "NOT_RUN", nativePickerNormalClose: "NOT_RUN", standaloneWindowsAndroidUpgrade: "NOT_RUN" } };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  async function check(name, fn) {
    const c = { name, status: "RUNNING" }; report.checks.push(c); save();
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  try {
    await check("four-author-flows-12-publish-and-12-player-displays-with-exact-text-and-real-download", () => {
      validate(editor, player);
      return { editorFlows: 4, publishCases: 12, playerCases: 12, textConsumptions: 24, assetConsumptions: 12,
        realModelRequests: 0, playerPE: player.playerVersion, sameEditorPackage: true };
    });
    await check("audit-rejects-empty-matrix-wrong-text-dpr-owner-download-and-persistence-corruption", () => {
      const changes = [
        (e, p) => { e.cases = []; }, (e, p) => { p.cases = []; },
        (e, p) => { p.cases[0].viewport.dpr = 1.5; },
        (e, p) => { p.cases[0].playback[1].observed.text = "伪造"; },
        (e, p) => { e.downloadEvents = []; }, (e, p) => { e.cases[0].geometry.hit = false; },
        (e, p) => { p.executable.sha256 = "wrong"; }, (e, p) => { p.cleanups = []; },
        (e, p) => { p.cases[1] = structuredClone(p.cases[0]); },
        (e, p) => { p.cases[0].background[0].sha256 = "old-bytes"; },
      ];
      for (const change of changes) {
        const e = structuredClone(editor), p = structuredClone(player); change(e, p); assert.throws(() => validate(e, p));
      }
      const changed = structuredClone(editor.restored.editor_settings.novelPersistence);
      changed.sessionSnapshot.document.normalized_text += "未授权";
      assert.throws(() => persistenceContent(changed, editor.connected.editor_settings.novelPersistence));
      return { rejectedMalformedEvidence: changes.length + 1, originalFailedTimestampReportRetained: editor.continuation };
    });
    await check("saved-zip-readonly-sqlite-and-cartridge-have-identical-authored-content-and-resource-bytes", async () => {
      for (const f of [editor.input, editor.connectedBundle, editor.cartridge, editor.finalDatabase])
        assert.equal(sha(f.path), f.sha256);
      const zip = await JSZip.loadAsync(fs.readFileSync(editor.connectedBundle.path), { checkCRC32: true });
      const p = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(graphContent(p), graphContent(editor.connected));
      assert.deepEqual(graphContent(editor.restored), graphContent(editor.connected));
      const copy = path.join(out, "vn_engine.readonly.db"); fs.copyFileSync(editor.finalDatabase.path, copy, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(copy, { readOnly: true }); let stored;
      try {
        assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(r => r.integrity_check), ["ok"]);
        const all = db.prepare("SELECT project_json FROM editor_project_details").all(); assert.equal(all.length, 1);
        stored = JSON.parse(all[0].project_json);
      } finally { db.close(); }
      assert.equal(sha(copy), editor.finalDatabase.sha256); assert.deepEqual(graphContent(stored), graphContent(p));
      assert.equal(stored.editor_settings.novelPersistence.sessionSnapshot.ai_stage, "report");
      const novel = p.nodes.filter(n => n.data.editorMeta?.importSessionId); assert.equal(novel.length, 1);
      const c = await cartridgeEvidence(editor.cartridge.path, { id: p.project_id, expected: p, novelNodeIds: novel.map(n => n.id) });
      assert.deepEqual(c, editor.exported); assert.deepEqual(c, player.exported);
      const inputZip = await JSZip.loadAsync(fs.readFileSync(editor.input.path), { checkCRC32: true });
      for (const a of p.asset_manifest) {
        const bytes = await zip.file(a.metadata.project_path).async("nodebuffer");
        assert.deepEqual(bytes, await inputZip.file(a.metadata.project_path).async("nodebuffer"));
      }
      assert.equal(stored.edges.length, 2); assert.equal(c.script.scenes[0].next_scene_id, "qa_default_scene");
      return { originalProject: editor.input, connectedProject: editor.connectedBundle, sqlite: desc(copy),
        cartridge: editor.cartridge, placeholderIsExplicit: true, novelScene: novel[0].id };
    });
    await check("png-real-metrics-package-provenance-and-frozen-products-preserved", () => {
      const parent = read(editor.continuation.path);
      for (const r of [parent, editor, player]) {
        for (const s of r.screenshots) {
          assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
          const dpr = s.png.width / s.before.width, expected = { ...s.before, dpr };
          assert([1, 2].includes(dpr)); validateNativeViewport(s.before, expected);
          const b = fs.readFileSync(s.path); assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
          assert.equal(s.png.height, s.before.height * dpr);
        }
        for (const f of r.tools) assert.equal(sha(path.join(path.dirname(r === parent ? editor.continuation.path :
          r === editor ? editorFile : playerFile), path.basename(f.path))), f.sha256);
      }
      assert.equal(sha(editor.installation.path), editor.installation.sha256);
      const install = read(editor.installation.path);
      for (const f of [install.executable, ...install.resources, ...editor.protectedFiles])
        assert.equal(sha(f.path), f.sha256);
      return { pngCount: parent.screenshots.length + editor.screenshots.length + player.screenshots.length,
        editorPE: "1.9.22", playerPE: player.playerVersion, productBuilds: 0, protectedFiles: editor.protectedFiles.length };
    });
    await check("all-attempt-owned-processes-ports-and-original-native-profiles-restored", () => {
      const parent = read(editor.continuation.path), all = [parent, editor, player];
      const known = new Set(all.flatMap(r => r.knownProcesses).map(p => `${p.ProcessId}:${p.Created}`));
      const ports = [...new Set(all.flatMap(r => r.launches.flatMap(l => l.ports || [l.port])))];
      assert.equal(rows().filter(p => known.has(`${p.ProcessId}:${p.Created}`)).length, 0); assert.equal(listeners(ports).length, 0);
      for (const r of [parent, editor]) {
        assert(!r.cleanupError); const cache = read(r.cacheRestoration.path);
        assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
        for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
      }
      const profiles = read(player.profileRestoration.path); assert.equal(profiles.status, "PASS");
      assert.equal(profiles.deletedUserFiles, 0);
      for (const p of profiles.restored) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      for (const id of ["01", "02"]) assert.equal(read(path.join(qa, `session-${id}`, "report.json")).status, "FAILED");
      return { ownedIdentities: known.size, ports, survivors: [], listeners: [], userFilesDeleted: 0,
        originalFailedReportsRemain: true, dynamicPortFailureStillFailed: true };
    });
    report.featureResults.defaultNovelAuthorExportInstalledPlayer = "PASS_CONTROLLED_SOURCE_SAMPLE";
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, checks: report.checks.length, error: report.error }));
  }
}
if (require.main === module) run(process.argv[2], process.argv[3], process.argv[4]);
