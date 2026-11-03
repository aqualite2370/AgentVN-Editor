"use strict";
// Evidence audit only: no browser/process launch, profile change, model or product write.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { matrix, validate: validateEditor } = require("./lib/installed-assets-evidence.cjs");
const { validate } = require("./lib/installed-assets-player-evidence.cjs");
const candidate = require("./lib/installed-assets-candidate.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const editorAttempt = process.argv[2] || "04", playerAttempt = process.argv[3] || "01", audit = process.argv[4] || "01";
for (const a of [editorAttempt, playerAttempt, audit]) assert.match(a, /^\d{2}$/);
const source = path.join(candidate.qaRoot, `editor-${editorAttempt}`);
const playerRoot = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const playerSource = path.join(playerRoot, `installed-assets-current-${playerAttempt}`);
const out = path.join(candidate.qaRoot, `player-${editorAttempt}-${playerAttempt}-audit-${audit}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const input = path.join(playerSource, "report.json"), r = read(input), e = read(r.source.path);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), source: desc(input),
  groups: [], productChanges: 0, modelRequests: 0, launches: 0 };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function group(name, fn) {
  const g = { name, status: "RUNNING" }; report.groups.push(g); save();
  try { g.result = await fn(); g.status = "PASS"; console.log(`PASS ${name}`); }
  catch (error) { g.status = "FAILED"; g.error = String(error.stack || error); throw error; }
  finally { save(); }
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  await group("New installed Editor export, exact installed Player and original media bytes", async () => {
    validateEditor(e, candidate.editor); assert.equal(sha(r.source.path), r.source.sha256);
    assert.equal(path.resolve(e.installation.path), path.resolve(candidate.installationFile));
    assert.equal(sha(r.executable.path), r.executable.sha256);
    assert.equal(r.executable.sha256, candidate.player.sha256);
    assert.equal(sha(r.installation.path), r.installation.sha256);
    const installation = read(r.installation.path); assert.equal(installation.status, "PASS");
    assert.equal(path.resolve(r.executable.path), path.resolve(installation.installRoot, "agentvn-player.exe"));
    assert.deepEqual(r.cartridge, e.cartridge); assert.equal(sha(r.cartridge.path), r.cartridge.sha256);
    const zip = await JSZip.loadAsync(fs.readFileSync(r.cartridge.path), { checkCRC32: true });
    for (const a of r.cartridge.assets) {
      assert.equal(hash(await zip.file(a.path).async("nodebuffer")), a.sha256);
      assert.equal(a.sha256, e.replacements.find(x => x.id === a.id).newSha256);
      assert.notEqual(a.sha256, e.replacements.find(x => x.id === a.id).oldSha256);
    }
    for (const s of r.snapshots) { assert.equal(sha(s.copy.path), s.copy.sha256); assert.equal(s.copy.sha256, s.source.sha256); }
    if (r.inherited) {
      assert.equal(sha(r.inherited.source.path), r.inherited.source.sha256);
      const prior = read(r.inherited.source.path); assert.equal(prior.status, "FAILED");
      assert.equal(prior.executable.sha256, r.executable.sha256); assert.equal(prior.cartridge.sha256, r.cartridge.sha256);
      assert.deepEqual(r.cases.slice(0, r.inherited.cases), prior.cases.slice(0, r.inherited.cases));
      assert.equal(prior.profileRestored, true); assert.equal(prior.launches[0].cleanup.status, "PASS");
    }
    return { exportedTypes: 10, editorPortableTypes: 11, originalCartridgeUnchanged: true, snapshotCount: r.snapshots.length };
  });
  await group("Twelve real WebView cases, input geometry, actual images/font and three distinct audio command sources", () => {
    assert.deepEqual(r.cases.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), matrix());
    for (const c of r.cases) {
      validateNativeViewport(c.viewport, c); assert(c.input.trusted && c.input.hit && c.input.overflow <= 1);
      const b = c.input.rect; assert(b.x >= -1 && b.y >= -1 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
      assert.equal(c.consumed.length, 10);
      assert.deepEqual(c.consumed.map(a => a.type).sort(), r.cartridge.assets.map(a => a.type).sort());
      for (const a of c.consumed) {
        assert.equal(a.sha256, r.cartridge.assets.find(f => f.type === a.type).sha256);
        assert.equal(a.sha256, a.expectedSha256); assert(a.decoded);
        if (["background", "sprite", "portrait", "ui", "other"].includes(a.type)) {
          assert.equal(a.width, 900); assert.equal(a.height, 600);
          assert(a.rect.width > 0 && a.rect.height > 0 && a.rect.x >= -1 && a.rect.y >= -1
            && a.rect.right <= c.width + 1 && a.rect.bottom <= c.height + 1);
        }
      }
      const font = c.consumed.find(a => a.type === "font"); assert(font.actualFamily.includes("AgentVNFont_qa_font"));
      const first = c.audioObjects.find(g => g.stage === "dialog-after-transition-idle").values;
      const later = c.audioObjects.find(g => g.stage === "sfx").values;
      const bgm = c.diagnostics.audio.find(x => x.payload.kind === "bgm" && x.payload.phase === "play-request").payload.source;
      const voice = [...new Set(first.filter(a => a.src !== bgm).map(a => a.src))];
      const sfx = [...new Set(later.filter(a => !first.some(f => f.src === a.src)).map(a => a.src))];
      assert.equal(voice.length, 1); assert.equal(sfx.length, 1);
      assert.equal(new Set([bgm, voice[0], sfx[0]]).size, 3);
      const players = new Map();
      for (const group of c.mediaEvents) {
        const list = players.get(group.playerId) || [];
        list.push(...group.events.map(e => { try { return JSON.parse(e.value); } catch { return {}; } }));
        players.set(group.playerId, list);
      }
      for (const [type, src] of [["bgm", bgm], ["voice", voice[0]], ["sfx", sfx[0]]]) {
        const a = c.consumed.find(a => a.type === type); assert.equal(a.src, src);
        const matching = [...players.values()].filter(es => es.some(e => e.event === "kLoad" && e.url === src));
        assert(matching.some(es => es.some(e => e.event === "kPlay") && es.some(e => e.pipeline_state === "kPlaying")));
        assert(a.readyState >= 2 && a.duration === .8 && !a.error && a.played && a.pipelinePlaying);
      }
      assert.deepEqual(c.diagnostics.consoleErrors, []); assert.deepEqual(c.diagnostics.nativeErrors, []);
    }
    return { cases: 12, consumedMedia: 120, realDistinctAudioSources: 36, runtimeStateWrites: 0 };
  });
  await group("Raw video events independently classify timeline gaps without promoting decode-only evidence", () => {
    const cases = r.cases.map(c => {
      const a = c.consumed.find(a => a.type === "video"), v = c.video;
      if (candidate.current) {
        assert(a.duration > 1 && a.duration < 2); assert.equal(a.sha256, e.videoFixture.video.sha256);
        assert(c.videoFrames.length >= 15 && c.videoFrames.some(f => f.time > 1));
        assert(new Set(c.videoFrames.map(f => f.pixelSignature)).size >= 10);
        assert(c.videoFrames.every(f => f.width === 480 && f.height === 270));
      } else assert.equal(a.duration, .001);
      assert.equal(v.find(x => x.event === "loadedmetadata").sha256, a.sha256);
      assert(v.some(x => x.event === "loadedmetadata" && x.width === 480 && x.height === 270));
      assert.equal(a.playing, v.some(x => x.event === "playing"));
      assert.equal(a.ended, v.some(x => x.event === "ended"));
      assert.equal(a.timeAdvanced, v.some(x => x.event === "timeupdate" && x.time > (candidate.current ? 1 : 0)));
      assert.equal(a.error, v.some(x => x.event === "error" || x.probeError));
      const passed = a.playing && a.ended && a.timeAdvanced && !a.error;
      assert.equal(c.status, passed ? "PASS" : "FAILED");
      return { width: c.width, dpr: c.dpr, reduced: c.reduced, timeAdvanced: a.timeAdvanced,
        decoded: a.decoded, playing: a.playing, ended: a.ended, times: v.map(x => x.time) };
    });
    const failed = cases.filter(c => !c.timeAdvanced).length;
    assert.equal(r.status, failed ? "FAILED" : "PASS");
    if (failed) { assert(r.validationError); assert.throws(() => validate(r, candidate.player)); }
    else validate(r, candidate.player);
    assert(!r.error && !r.cleanupError);
    return { allTwelveVideoDecode: true, missingPositiveTimeline: failed, cases,
      fullVideoTimelineClaim: candidate.current ? "PASS_ONLY_ONE_MULTIFRAME_1.77_SECOND_FIXTURE"
        : failed ? "NOT_PROVEN_SINGLE_FRAME_FIXTURE" : "PASS_ONLY_0.001_SECOND_FIXTURE" };
  });
  await group("No-side-effect PNG capture and original failed attempts retained", () => {
    assert.equal(r.screenshots.length, 2);
    for (const s of r.screenshots) {
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after); validateNativeViewport(s.before, s.after);
      const bytes = fs.readFileSync(s.path), dpr = Math.round(s.before.dpr);
      assert.equal(bytes.readUInt32BE(16), s.before.width * dpr); assert.equal(bytes.readUInt32BE(20), s.before.height * dpr);
    }
    const original = [];
    for (const old of ["01", "02", "03"]) {
      const file = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-assets-current-${old}/report.json`, failed = read(file);
      assert.equal(failed.status, "FAILED"); assert(failed.error);
      assert.equal(failed.profileRestored, true); assert.equal(failed.protectedUnchanged, true);
      assert.equal(failed.launches[0].cleanup.status, "PASS");
      original.push(desc(file));
    }
    return { screenshots: r.screenshots.length, physical4K: false, originalFailures: original };
  });
  await group("Player profile identity/bytes restored, protected files unchanged, all owned processes/ports absent", () => {
    assert.equal(r.profileRestored, true); assert.equal(r.protectedUnchanged, true);
    const journal = read(path.join(playerSource, "profile-protection.json")), restored = read(r.profileRestoration.path);
    assert.equal(sha(r.profileRestoration.path), r.profileRestoration.sha256); assert.equal(restored.status, "PASS");
    for (const p of journal.records) {
      assert(!fs.existsSync(p.held));
      if (p.existed) {
        assert(ps(`fsutil.exe file queryfileid '${p.original.replace(/'/g, "''")}'`).toLowerCase().includes(p.directoryId.toLowerCase()));
        if (p.byteInventory) for (const f of p.files) assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
      }
    }
    for (const f of r.protectedFiles) assert.equal(sha(f.path), f.sha256);
    const id = p => `${p.ProcessId}:${p.Created}`, active = rows();
    assert(!active.some(p => r.knownProcesses.some(k => id(k) === id(p))));
    assert(!active.some(p => p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(playerSource)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    if (r.inherited) {
      const prior = read(r.inherited.source.path);
      assert(!active.some(p => prior.knownProcesses.some(k => id(k) === id(p))));
      assert.deepEqual(listeners(prior.launches.map(l => l.port)), []);
    }
    assert.deepEqual(r.gitBefore, r.gitAfter); assert.equal(r.launches[0].cleanup.normalCloseClaimed, false);
    return { protectedPaths: new Set(r.protectedFiles.map(f => path.resolve(f.path))).size,
      processIdentities: r.knownProcesses.length, absentPorts: r.launches.map(l => l.port), userFilesDeleted: 0 };
  });
  report.status = "PASS"; report.featureStatus = r.status;
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
.finally(() => { report.finishedAt = new Date().toISOString(); report.tool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, featureStatus: report.featureStatus, out, error: report.error })); });
