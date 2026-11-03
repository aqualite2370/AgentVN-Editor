"use strict";
// Read-only artifact audit. Does not launch the product or call any model.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite"), JSZip = require("../editor/node_modules/jszip");
const { qa } = require("./current-novel-task-closure.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { graphContent, cartridgeEvidence } = require("./native-novel-consume.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const editorFile = qa + "/session-05/report.json";
const playerFile = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/installed-novel-consume-1935-01/report.json";
const lifecycleFile = qa + "/session-01/report.json";
const editor = read(editorFile), player = read(playerFile), lifecycle = read(lifecycleFile);
const out = qa + "/consume-audit-01";
function validate(e, p) {
  for (const r of [e, p]) {
    assert.equal(r.status, "PASS"); assert.equal(r.version, "1.9.35"); assert(r.finishedAt);
    for (const key of ["error", "cleanupError", "captureError"]) assert(!r[key], key);
    assert.equal(r.productChanges, 0); assert.equal(r.modelRequests, 0); assert.equal(r.realModelRequests, 0);
    assert.deepEqual(r.errors, []); assert.equal(r.cases.length, 12);
    const keys = new Set();
    for (const cell of r.cases) {
      assert.equal(cell.status, "PASS");
      assert([1920, 2560, 3840].includes(cell.width)); assert.equal(cell.height, cell.width * 9 / 16);
      assert([1, 2].includes(cell.dpr)); assert.equal(typeof cell.reduced, "boolean");
      validateNativeViewport(cell.viewport, cell); keys.add(`${cell.width}/${cell.dpr}/${cell.reduced}`);
      if (r === e) {
        assert(cell.focus && cell.geometry.hit && cell.geometry.overflow <= 1);
      } else {
        assert.equal(cell.playback.length, 3); assert.equal(cell.background.length, 1);
        for (const [i, observed] of cell.playback.entries()) {
          const expected = e.exported.playback[i];
          assert.deepEqual(observed.expected, expected);
          assert.equal(observed.observed.text, expected.text); assert.equal(observed.observed.scene, expected.sceneId);
          assert.equal(observed.observed.type, expected.type);
          assert.equal(observed.observed.done, "true"); assert.equal(observed.observed.pages, "1");
          const g = observed.observed, r = g.rect;
          assert(g.hit && g.overflow <= 1 && r.left >= 0 && r.top >= 0 &&
            r.right <= cell.width + 1 && r.bottom <= cell.height + 1);
        }
        assert.equal(cell.background[0].sha256,
          e.exported.assets.find(a => a.id === "agentvn_placeholder_background").sha256);
        assert(cell.background[0].width > 0 && cell.background[0].height > 0);
      }
    }
    assert.equal(keys.size, 12); assert(r.cleanups.length);
    assert(r.cleanups.every(c => c.status === "PASS" && c.normalCloseClaimed === false));
  }
  assert.equal(e.steps.length, 4); assert(e.steps.every(s => s.status === "PASS"));
  const begin = e.downloadEvents.find(x => x.event === "Browser.downloadWillBegin");
  const end = e.downloadEvents.find(x => x.event === "Browser.downloadProgress" && x.detail.state === "completed");
  assert(begin && end); assert.equal(begin.detail.guid, end.detail.guid);
  assert.equal(end.detail.receivedBytes, e.cartridge.bytes); assert.equal(end.detail.totalBytes, e.cartridge.bytes);
  assert.equal(path.resolve(end.detail.filePath), path.resolve(e.cartridge.path));
  assert.equal(p.cartridge.sha256, e.cartridge.sha256); assert.equal(p.source.sha256, sha(editorFile));
  assert.equal(p.executable.sha256, "66945ed6a9d026ab2f17370c9fe1fa207cdc741b7005f61f1ccd539c56e46b0e");
}
async function main() {
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
    inputs: [lifecycleFile, editorFile, playerFile].map(desc), productStarts: 0, productChanges: 0,
    builds: 0, paidRequests: 0,
    notProven: ["Real packaged novel-task execution or DeepSeek quality", "Full automatic generation pipeline",
      "Normal native close", "Standalone Windows/setup/Android", "Final user project", "Motion refinement"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  async function check(name, fn) {
    const c = { name, status: "RUNNING" }; report.checks.push(c); save();
    try { c.detail = await fn(); c.status = "PASS"; console.log("PASS " + name); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  try {
    await check("four-author-flows-twelve-publish-and-player-cells-36-natural-text-reads", () => {
      validate(editor, player);
      return { authorFlows: 4, publishCells: 12, playerCells: 12, naturalTextReads: 36, backgroundReads: 12 };
    });
    await check("reject-empty-duplicate-wrong-owner-text-dpr-and-missing-cleanup-evidence", () => {
      const mutations = [
        e => e.cases = [], (e, p) => p.cases = [], (e, p) => p.cases[1] = p.cases[0],
        (e, p) => p.cases[0].viewport.dpr = 1.5, (e, p) => p.cases[0].playback.pop(),
        (e, p) => p.cases[0].playback[1].observed.scene = "wrong-scene",
        (e, p) => p.cases[0].playback[1].observed.text = "wrong-text",
        e => e.downloadEvents = [], e => e.cases[0].geometry.hit = false,
        (e, p) => p.executable.sha256 = "wrong", (e, p) => p.cleanups = [],
      ];
      for (const mutate of mutations) {
        const e = structuredClone(editor), p = structuredClone(player); mutate(e, p);
        assert.throws(() => validate(e, p));
      }
      return { rejectedMalformedReports: mutations.length };
    });
    await check("native-picker-original-graph-portable-sqlite-restart-and-export-agree", async () => {
      for (const f of [editor.input, editor.connectedBundle, editor.cartridge, editor.finalDatabase]) assert.equal(sha(f.path), f.sha256);
      const picker = read(editor.nativePicker.path); assert.equal(picker.status, "PASS");
      assert.equal(picker.ownerPid, editor.launches[0].pid);
      assert.equal(path.resolve(picker.directory), path.resolve(editor.input.path));
      const zip = await JSZip.loadAsync(fs.readFileSync(editor.connectedBundle.path), { checkCRC32: true });
      const project = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(graphContent(project), graphContent(editor.connected));
      assert.deepEqual(graphContent(editor.restored), graphContent(editor.connected));
      assert.deepEqual(graphContent(editor.initial).nodes, graphContent(editor.connected).nodes);
      assert.equal(editor.connected.edges.length, editor.initial.edges.length + 1);
      for (const edge of editor.initial.edges) assert.deepEqual(editor.connected.edges.find(e => e.id === edge.id), edge);
      assert.deepEqual(editor.restored.editor_settings.runtimeUILayoutProfiles, project.editor_settings.runtimeUILayoutProfiles);
      const dbPath = path.join(out, "vn_engine.readonly.db");
      fs.copyFileSync(editor.finalDatabase.path, dbPath, fs.constants.COPYFILE_EXCL);
      const db = new DatabaseSync(dbPath, { readOnly: true }); let stored;
      try {
        assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(r => r.integrity_check), ["ok"]);
        const all = db.prepare("SELECT project_json FROM editor_project_details").all(); assert.equal(all.length, 1);
        stored = JSON.parse(all[0].project_json);
      } finally { db.close(); }
      assert.equal(sha(dbPath), editor.finalDatabase.sha256);
      assert.deepEqual(graphContent(stored), graphContent(project));
      const imported = project.nodes.filter(n => n.data.editorMeta?.sourceProcessJobId === "installed-floating-a");
      assert.equal(imported.length, 2); assert.deepEqual(imported, lifecycle.importedNodes);
      const c = await cartridgeEvidence(editor.cartridge.path, { id: project.project_id,
        expected: project, novelNodeIds: imported.map(n => n.id) });
      assert.deepEqual(c, editor.exported); assert.deepEqual(c, player.exported);
      assert.deepEqual(c.playback.map(p => p.sceneId), ["ui_acceptance", "installed_novel_chapter_0", "installed_novel_chapter_1"]);
      return { nativePicker: editor.nativePicker, nativePackage: editor.connectedBundle, sqlite: desc(dbPath),
        cartridge: editor.cartridge, unchangedNodeCount: project.nodes.length, preservedEdgeCount: editor.initial.edges.length,
        importedChapters: 2, explicitGeneratedPlaceholder: editor.generatedPlaceholders };
    });
    await check("actual-candidate-bindings-and-native-png-viewport-provenance", () => {
      const actual = descriptor();
      assert.equal(read(editor.installation.path).executable.sha256, actual.executable.sha256);
      assert.equal(sha(player.executable.path), player.executable.sha256);
      let images = 0;
      for (const r of [lifecycle, editor, player]) {
        for (const shot of r.screenshots) {
          assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
          const expected = [1920, 2560, 3840].flatMap(width => [1, 2].map(dpr => ({ width,
            height: width * 9 / 16, dpr, reduced: shot.before.reduced })))
            .find(d => d.width === shot.before.width && Math.abs(d.dpr - shot.before.dpr) < 1e-6);
          assert(expected); validateNativeViewport(shot.before, expected); validateNativeViewport(shot.after, expected);
          const bytes = fs.readFileSync(shot.path);
          assert.equal(bytes.readUInt32BE(16), expected.width * expected.dpr);
          assert.equal(bytes.readUInt32BE(20), expected.height * expected.dpr); images++;
        }
        for (const f of r.tools) assert.equal(sha(f.path), f.sha256);
        if (r.qaBinding) assert.equal(sha(r.qaBinding.path), r.qaBinding.sha256);
      }
      return { pngs: images, physical4KClaimed: false, editor: actual.executable, player: player.executable,
        actualPlayerPE: player.playerVersion, productRebuilds: 0 };
    });
    await check("all-owned-processes-ports-cache-player-profiles-and-download-cleanup", () => {
      const earlier = read(qa + "/session-04/report.json");
      const all = [lifecycle.nativeSession, earlier, editor, player];
      const known = new Set(all.flatMap(r => r.knownProcesses).map(p => p.ProcessId + ":" + p.Created));
      const ports = [...new Set(all.flatMap(r => r.launches.flatMap(l => l.ports || [l.port])))];
      assert.equal(rows().filter(p => known.has(p.ProcessId + ":" + p.Created)).length, 0);
      assert.equal(listeners(ports).length, 0);
      const cache = read(editor.cacheRestoration.path); assert.equal(cache.status, "PASS"); assert.equal(cache.deletedUserFiles, 0);
      for (const f of cache.originalFiles) assert.equal(sha(path.join(cache.originalDirectory, f.relative)), f.sha256);
      const profiles = read(player.profileRestoration.path); assert.equal(profiles.status, "PASS"); assert.equal(profiles.deletedUserFiles, 0);
      for (const p of profiles.restored) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      assert.equal(read(qa + "/audit-02/report.json").status, "PASS");
      return { processIdentities: known.size, ports, survivors: 0, userFilesDeleted: 0,
        restoredCacheFiles: cache.originalFiles.length, restoredPlayerProfiles: profiles.restored.length };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, checks: report.checks.length, error: report.error }));
  }
}
if (require.main === module) main();
module.exports = { validate };
