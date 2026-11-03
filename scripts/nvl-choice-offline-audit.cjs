"use strict";
// Reclassifies existing raw geometry after a QA-only DPR fix. No native
// application is launched and neither original FAILED report is rewritten.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
async function main() {
  const [attempt, audit] = process.argv.slice(2);
  for (const value of [attempt, audit]) assert.match(value, /^\d{2}$/);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-narrative-1922-${attempt}`);
  const out = `${source}-offline-audit-${audit}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), observations: [], groups: [],
    scope: "OFFLINE_REANALYSIS_OF_FAILED_DIAGNOSTIC_NOT_FUNCTIONAL_PASS", modelRequests: 0, productChanges: 0, builds: 0 };
  const originals = [path.join(source, "diagnostic-session.json"), path.join(source, "diagnostic.json")].map(desc);
  report.originals = originals;
  const s = read(originals[0].path), raw = read(originals[1].path);
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  try {
    await group("Completed failed diagnostic, exact frozen product and source attribution", () => {
      assert.equal(s.status, "FAILED"); assert.equal(raw.status, "FAILED");
      assert(s.finishedAt && raw.finishedAt && !s.cleanupError && !raw.cleanupError && !raw.observerError);
      assert.equal(s.commands.length, 3);
      assert.deepEqual(s.commands.map(c => c.label), ["profile-prepare", "diagnostic", "profile-restore"]);
      assert.deepEqual(s.commands.map(c => c.exitCode), [0, 1, 0]);
      assert.equal(raw.cells.length, 5); assert.equal(raw.launches.length, 5);
      assert(raw.cells.every(c => c.status === "FAILED" && c.trace &&
        c.error.includes("[1, 2].includes(viewport.dpr)")));
      assert.equal(s.builds, 0); assert.equal(raw.normalCloseClaimed, false);
      assert.equal(raw.modelRequests, 0); assert.equal(s.modelRequests, 0);
      assert.equal(raw.productChanges, 0); assert.equal(s.productChanges, 0);
      for (const f of [s.preparation, s.raw, s.restoration, s.source, s.sourceAudit, ...s.protectedProducts])
        assert.equal(sha(f.path), f.sha256);
      validateNarrativePreparation(read(s.preparation.path));
      const currentClassifier = desc("scripts/lib/nvl-choice-frame-probe.cjs");
      const oldClassifier = s.tools.find(t => t.path.endsWith("nvl-choice-frame-probe.cjs")); assert(oldClassifier);
      for (const t of s.tools) {
        assert.equal(sha(t.copy), t.sha256);
        if (t !== oldClassifier) assert.equal(sha(t.path), t.sha256);
      }
      report.classifier = { captured: oldClassifier, offline: currentClassifier,
        change: "Accept only <=1e-6 DPR numeric tail; no glyph thresholds or trace data changed" };
      for (const l of raw.launches) {
        assert.equal(l.cleanup.status, "PASS");
        assert.equal(l.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
        assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(l.executable.path));
      }
      return { originalStatus: "FAILED", diagnosticCases: 5, launches: 5, noNewProductRun: true };
    });
    await group("Recompute all five retained traces and correlate real output frames", () => {
      for (const c of raw.cells) {
        assert.equal(sha(c.trace), c.traceSha256);
        const frames = read(c.trace), analysis = c.kind === "dialog" ? analyzeDialogFrames(frames) : analyzeChoiceFrames(frames);
        assert(analysis.animationFrameSamples >= 90);
        const expected = { width: c.width, height: c.height, dpr: 1, reduced: c.reduced };
        for (const f of frames) {
          validateNativeViewport(f.viewport, expected); assert.equal(f.visibility, "visible");
          assert.equal(f.timeOrigin, frames[0].timeOrigin);
        }
        assert.equal(c.paintTraceStatus, "CAPTURED"); assert(!c.paintError && !c.paintStopError);
        assert(c.paintFrames.length >= 2); assert.deepEqual(c.paintViewportBefore, c.paintViewportAfter);
        validateNativeViewport(c.paintViewportBefore, expected);
        for (const image of c.paintFrames) {
          assert.equal(sha(image.path), image.sha256);
          const bytes = fs.readFileSync(image.path);
          assert.equal(bytes.readUInt32BE(16), c.width); assert.equal(bytes.readUInt32BE(20), c.height);
          assert(Number.isFinite(image.metadata.timestamp));
        }
        const badRafs = frames.filter(f => f.phase === "raf" && analysis.badSamples.some(b => b.at === f.at && b.phase === "raf"));
        const badStart = badRafs[0], badEnd = badRafs.at(-1);
        const paintsWithinBadSampleTimes = badStart ? c.paintFrames.filter(p => {
          const at = p.metadata.timestamp * 1000 - frames[0].timeOrigin;
          return at >= badStart.at && at <= badEnd.at;
        }) : [];
        report.observations.push({ cell: c.name, kind: c.kind, ...analysis,
          rawDpr: frames[0].viewport.dpr, trace: desc(c.trace),
          badRafSpanMs: badStart ? badEnd.at - badStart.at : 0,
          outputFrames: c.paintFrames.length, paintsWithinBadSampleTimes,
          note: "Output timestamp correlation locates images for inspection; geometry alone is not a compositor-pixel claim" });
      }
      for (const image of raw.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const c = raw.cells.find(c => path.basename(image.path).startsWith(c.name + "-")); assert(c);
        validateNativeViewport(image.before, { width: c.width, height: c.height, dpr: 1, reduced: c.reduced });
        const b = fs.readFileSync(image.path); assert.equal(b.readUInt32BE(16), c.width); assert.equal(b.readUInt32BE(20), c.height);
      }
      return { traces: 5, screenshots: raw.screenshots.length,
        paintedFrames: raw.cells.reduce((n, c) => n + c.paintFrames.length, 0),
        functionalPassClaimed: false };
    });
    await group("Actual profile recovery and exact native process/port absence", () => {
      const before = read(path.join(source, "profile-protection.json")), after = read(s.restoration.path);
      assert.equal(after.status, "PASS"); assert.equal(after.deletedUserFiles, 0);
      let files = 0;
      for (const old of before.records) {
        const restored = after.restored.find(r => r.original === old.original); assert(restored);
        assert(!fs.existsSync(old.held) && !fs.existsSync(old.retained));
        assert.equal(restored.directoryId, old.directoryId); assert.deepEqual(restored.files, old.files);
        const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { windowsHide: true, encoding: "utf8", timeout: 10000 });
        assert.equal(id.status, 0); assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        for (const f of old.files) { assert.equal(sha(path.join(old.original, f.relative)), f.sha256); files++; }
      }
      const all = rows();
      assert(!all.some(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert(!all.some(p => p.Name === "agentvn-player.exe"));
      assert.deepEqual(listeners(raw.launches.map(l => l.port)), []);
      return { originalDirectories: before.records.length, originalFiles: files,
        ownedIdentities: raw.knownProcesses.length, ports: raw.launches.length, normalCloseClaimed: false };
    });
    report.status = "OBSERVATION_AUDITED_NOT_ACCEPTANCE";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    for (const f of originals) assert.equal(sha(f.path), f.sha256);
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
    save(); console.log(JSON.stringify({ status: report.status, out, error: report.error,
      observations: report.observations.map(c => ({ cell: c.cell, classification: c.classification,
        badRafs: c.badAnimationFrameCount, badRafSpanMs: c.badRafSpanMs, outputFrames: c.outputFrames,
        correlatedBadImages: c.paintsWithinBadSampleTimes.map(p => p.path) })) }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
