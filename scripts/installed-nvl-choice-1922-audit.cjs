"use strict";
// Evidence audit, not another product execution or a functional PASS.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const { analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { validateInterruptedNarrativeFacts } = require("./lib/interrupted-narrative-evidence.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validateTerminal(s, raw) {
  assert.equal(s.status, "OBSERVATION_COMPLETE"); assert.equal(raw.status, "OBSERVATION_COMPLETE");
  assert(s.finishedAt && raw.finishedAt && !s.cleanupError && !raw.cleanupError && !raw.observerError);
  assert.equal(s.scope, "NVL_CHOICE_DIAGNOSTIC_SESSION_NOT_FULL_ACCEPTANCE");
  assert.equal(raw.scope, "NVL_CHOICE_FRAME_DIAGNOSTIC_NOT_FULL_REGRESSION");
  assert.equal(s.builds, 0); assert.equal(raw.normalCloseClaimed, false);
  for (const r of [s, raw]) { assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); }
  assert.deepEqual(s.commands.map(c => c.label), ["profile-prepare", "diagnostic", "profile-restore"]);
  assert(s.commands.every(c => c.exitCode === 0 && c.finishedAt));
  assert.equal(raw.cells.length, 5); assert.equal(raw.launches.length, 5);
  assert.equal(raw.cells.filter(c => c.kind === "nvl-choice").length, 4);
  assert.equal(raw.cells.filter(c => c.kind === "dialog").length, 1);
  assert.deepEqual(raw.pageErrors, []);
  const keys = new Set();
  for (const c of raw.cells) {
    assert.equal(c.status, "OBSERVED"); assert(c.finishedAt);
    assert(["agentvn", "renpy"].includes(c.layout)); assert.equal(typeof c.reduced, "boolean");
    assert(["nvl-choice", "dialog"].includes(c.kind));
    const ordinary = c.kind === "dialog";
    assert.equal(c.width, ordinary ? 3840 : 1920); assert.equal(c.height, ordinary ? 2160 : 1080);
    if (ordinary) { assert.equal(c.layout, "renpy"); assert.equal(c.reduced, false); }
    const key = `${c.width}x${c.height}-dpr1-${c.reduced ? "reduced" : "normal"}-${c.layout}${ordinary ? "-dialog" : ""}`;
    assert.equal(c.name, key); assert(!keys.has(key)); keys.add(key);
    assert(c.trace && c.traceSha256 && c.observation && c.immediate);
    const launch = raw.launches.filter(l => l.cell === key); assert.equal(launch.length, 1);
    assert.equal(launch[0].cleanup?.status, "PASS"); assert.equal(launch[0].restart, false);
    assert.equal(launch[0].voice.calls.length, ordinary ? 1 : 0);
  }
  assert.deepEqual(s.absentPorts, raw.launches.map(l => l.port));
}
async function main() {
  const [attempt, audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-narrative-1922-${attempt}`;
  const out = `${source}-audit-${audit}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    scope: "CHOICE_DIAGNOSTIC_EVIDENCE_NOT_FUNCTIONAL_ACCEPTANCE", productChanges: 0, modelRequests: 0 };
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    report.session = desc(path.join(source, "diagnostic-session.json"));
    const s = read(report.session.path), raw = read(s.raw.path); report.raw = desc(s.raw.path);
    validateTerminal(s, raw);
    await group("Installed candidate, original failed matrix and frozen diagnostic provenance", () => {
      const prep = read(s.preparation.path); validateNarrativePreparation(prep);
      for (const f of [s.source, s.sourceAudit, s.preparation, s.raw, s.restoration, ...s.tools, ...s.protectedProducts])
        assert.equal(sha(f.path), f.sha256);
      for (const f of s.tools) assert.equal(sha(f.copy), f.sha256);
      const prior = read(s.source.path), audit = read(s.sourceAudit.path);
      if (s.interruptedSource) {
        assert.equal(prior.status, "RUNNING"); assert.equal(audit.status, "INTERRUPTED_EVIDENCE_AUDITED");
        assert.equal(audit.sourceConclusion, "INTERRUPTED_NOT_ACCEPTED");
        validateInterruptedNarrativeFacts(audit.facts);
        assert.equal(audit.originals[0].sha256, s.source.sha256);
        for (const f of audit.originals) assert.equal(sha(f.path), f.sha256);
      } else {
        assert.equal(prior.status, "FAILED"); assert.equal(audit.status, "PASS");
        assert.equal(audit.sourceConclusion, "FAILED");
        assert.equal(audit.session.sha256, s.source.sha256);
      }
      for (const l of raw.launches) {
        assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(prep.executable.path));
        assert.equal(l.executable.sha256, prep.executable.sha256);
      }
      return { originalBusinessConclusion: prior.status, candidatePlayer: prep.executable,
        boundedScope: "Four 1080p NVL cases plus one 4K Ren'Py ordinary-dialog trigger; not the complete matrix", newModelRequests: 0 };
    });
    await group("Recompute original per-frame classifications and PNG viewport/media", () => {
      const observations = [];
      for (const c of raw.cells) {
        assert.equal(sha(c.trace), c.traceSha256);
        const frames = read(c.trace), analysis = c.kind === "dialog" ? analyzeDialogFrames(frames) : analyzeChoiceFrames(frames);
        assert.deepEqual(c.observation, analysis); assert(analysis.animationFrameSamples >= 90);
        for (const f of frames) validateNativeViewport(f.viewport,
          { width: c.width, height: c.height, dpr: 1, reduced: c.reduced });
        assert(frames.every(f => f.visibility === "visible"));
        assert(frames.every(f => Number.isFinite(f.timeOrigin) && f.timeOrigin === frames[0].timeOrigin));
        let paintedFrames = 0;
        for (const image of c.paintFrames || []) {
          assert.equal(sha(image.path), image.sha256);
          const b = fs.readFileSync(image.path);
          assert.equal(b.readUInt32BE(16), image.width); assert.equal(b.readUInt32BE(20), image.height);
          assert(Number.isFinite(image.metadata.timestamp));
          if (image.width === c.width && image.height === c.height) paintedFrames++;
        }
        if (c.paintTraceStatus === "CAPTURED") {
          assert(!c.paintError && !c.paintStopError && c.paintFrames.length >= 2);
          assert.deepEqual(c.paintViewportBefore, c.paintViewportAfter);
        } else assert.equal(c.paintTraceStatus, "UNPROVEN");
        observations.push({ cell: c.name, ...analysis, paintTraceStatus: c.paintTraceStatus,
          exactViewportPaintedFrames: paintedFrames,
          paintTimeRange: c.paintFrames?.length ? [c.paintFrames[0].metadata.timestamp, c.paintFrames.at(-1).metadata.timestamp] : null });
      }
      assert.equal(raw.screenshots.length, 5);
      for (const image of raw.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const c = raw.cells.find(c => path.basename(image.path).startsWith(c.name + "-")); assert(c);
        const b = fs.readFileSync(image.path);
        validateNativeViewport(image.before, { width: c.width, height: c.height, dpr: 1, reduced: c.reduced });
        assert.equal(b.readUInt32BE(16), c.width); assert.equal(b.readUInt32BE(20), c.height);
      }
      report.observations = observations;
      return { screenshots: 5, traces: 5, observations,
        note: "rAF geometry is a prepaint observation, not proof of compositor pixels or overall functional acceptance" };
    });
    await group("Reject incomplete, misattributed and falsely upgraded diagnostic evidence", () => {
      const mutations = [
        ([s]) => { s.status = "PASS"; }, ([s]) => { s.finishedAt = null; },
        ([s]) => { s.builds = 1; }, ([s]) => { s.modelRequests = 1; },
        ([s]) => { s.commands.pop(); }, ([s]) => { s.absentPorts = []; },
        ([, r]) => { r.cells = []; }, ([, r]) => { r.cells[0].name = r.cells[1].name; },
        ([, r]) => { r.cells[0].status = "RUNNING"; }, ([, r]) => { r.launches[0].cleanup.status = "RUNNING"; },
        ([, r]) => { r.normalCloseClaimed = true; }, ([, r]) => { r.pageErrors.push("error"); },
      ];
      for (const mutate of mutations) {
        const copy = structuredClone([s, raw]); mutate(copy); assert.throws(() => validateTerminal(...copy));
      }
      return { rejectedVariants: mutations.length, originalFailureNotOverridden: true };
    });
    await group("Original directories/bytes restored and exact process/port cleanup", () => {
      const before = read(path.join(source, "profile-protection.json")), after = read(s.restoration.path);
      assert.equal(after.status, "PASS"); assert.equal(after.deletedUserFiles, 0); let files = 0;
      for (const old of before.records) {
        assert(!fs.existsSync(old.held));
        const current = after.restored.find(r => r.original === old.original); assert(current);
        assert.equal(current.directoryId, old.directoryId); assert.deepEqual(current.files, old.files);
        if (old.existed) {
          const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
            { windowsHide: true, encoding: "utf8", timeout: 10000 });
          assert.equal(id.status, 0); assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        }
        for (const f of old.files) { assert.equal(sha(path.join(old.original, f.relative)), f.sha256); files++; }
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      }
      const all = rows();
      assert(!all.some(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert(!all.some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(path.resolve(source))));
      assert.deepEqual(listeners(s.absentPorts), []);
      return { originalDirectories: before.records.length, originalFiles: files,
        ownedIdentities: raw.knownProcesses.length, portsAbsent: s.absentPorts, normalCloseClaimed: false };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, out, error: report.error,
      classifications: report.observations?.map(o => ({ cell: o.cell, result: o.classification })) }));
  }
}
module.exports = { validateTerminal };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
