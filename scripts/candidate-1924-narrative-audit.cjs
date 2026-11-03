"use strict";
// Independent terminal audit. A correct audit of a FAILED run is not a PASS
// for the product; sourceConclusion and coverageComplete remain explicit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateCandidateNarrativePreparation, resolveNarrativeCandidate } = require("./lib/candidate-1924-narrative-preparation.cjs");
const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");
const { analyzeChoiceFrames, analyzeDialogFrames } = require("./lib/nvl-choice-frame-probe.cjs");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const current=process.argv.includes("--candidate=1.9.30");
const configArg = process.argv.slice(3).find(a => a.startsWith("--candidate-config="));
const exportArg = process.argv.slice(3).find(a => a.startsWith("--export-report="));
assert.deepEqual(process.argv.slice(2), configArg
  ? [attempt, configArg, exportArg] : current ? [attempt, "--candidate=1.9.30"] : [attempt]);
assert(!configArg || exportArg && !current);
const binding = configArg && resolveNarrativeCandidate(configArg.slice(19), exportArg.slice(16));
const scope = binding?.scope || (current?"INSTALLED_1_9_30_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID":"INSTALLED_1_9_24_NARRATIVE_LIBRARY_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID");
const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/narrative-installed-${binding?.stamp || (current?"1930":"1924")}-${attempt}`);
const out = binding ? path.join(binding.config.qa, `narrative-audit-${attempt}`)
  : path.resolve(`F:/AgentVN/QA/Editor-${current?"1.9.30-20261026":"1.9.24-20261024"}-01/narrative-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), sourceConclusion: "UNPROVEN",
  scope: binding ? scope + "_EVIDENCE_AUDIT" : current?"INSTALLED_1_9_30_NARRATIVE_EVIDENCE_AUDIT_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID":"INSTALLED_1_9_24_NARRATIVE_EVIDENCE_AUDIT_NOT_NEW_AUTHOR_EXPORT_OR_ANDROID",
  checks: [], modelRequests: 0, productChanges: 0, normalCloseClaimed: false };
function summary(s, r) {
  assert(["PASS", "FAILED"].includes(s.status)); assert.equal(r.status, s.status);
  assert(s.finishedAt && r.finishedAt && !s.cleanupError && !r.cleanupError && !r.observerError);
  assert.equal(s.scope, scope);
  assert.equal(r.scope, s.scope); assert.equal(s.smoke, false); assert.equal(r.smoke, false);
  assert.equal(r.cells.length, 24); assert.deepEqual(r.pageErrors, []);
  assert.deepEqual(s.commands.map(c => c.label),
    ["restoration-guard", "adapter-guard", "profile-prepare", "narrative", "profile-restore"]);
  assert(s.commands.every(c => c.finishedAt && c.status !== "RUNNING"));
  assert(s.commands.filter(c => c.label !== "narrative").every(c => c.exitCode === 0 && c.status === "PASS"));
  assert.equal(s.commands[3].exitCode, r.status === "PASS" ? 0 : 1);
  assert.equal(s.environment.AGENTVN_TEST_PROJECT, s.fixture.input);
  assert.equal(s.environment.AGENTVN_WORKSPACE_OUTPUT, s.out);
  assert.equal(r.out, s.out);
  assert.equal(s.productChanges, 0); assert.equal(r.productChanges, 0);
  assert.equal(s.modelRequests, 0); assert.equal(r.modelRequests, 0);
  assert.equal(s.builds, 0); assert.equal(r.newBuilds, 0);
  assert.equal(s.normalCloseClaimed, false); assert.equal(r.normalCloseClaimed, false);
  const keys = new Set();
  for (const c of r.cells) {
    const v = c.viewport;
    assert(["agentvn", "renpy"].includes(c.layout)); assert([1, 2].includes(v.dpr));
    assert(typeof v.reduced === "boolean");
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => v.width === w && v.height === h));
    const key = `${v.width}x${v.height}-dpr${v.dpr}-${v.reduced ? "reduced" : "normal"}-${c.layout}`;
    assert.equal(c.name, key); assert(!keys.has(key)); keys.add(key);
    assert(["PASS", "FAILED"].includes(c.status));
    assert(c.checks.every(k => ["PASS", "FAILED"].includes(k.status) && k.finishedAt));
    if (c.status === "PASS") {
      assert.equal(c.checks.length, 5); assert(c.checks.every(k => k.status === "PASS"));
      assert.equal(c.saved.length, 3); assert.equal(c.frameTraces.length, 2);
    } else assert(c.error || c.checks.some(k => k.status === "FAILED"));
  }
  assert.equal(r.status, r.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED");
  assert.deepEqual(s.absentPorts, r.launches.map(l => l.port));
  assert(r.launches.length > 0 && r.launches.every(l => l.cleanup?.status === "PASS" &&
    path.resolve(l.identity.ExecutablePath) === path.resolve(s.executable.path)));
}
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  report.session = desc(path.join(source, "session.json")); const s = read(report.session.path);
  report.raw = desc(s.raw.path); const r = read(report.raw.path); summary(s, r);
  report.sourceConclusion = r.status; Object.assign(report, narrativeCoverage(r));
  check("Exact installed binding, original tools and complete parameter matrix", () => {
    validateCandidateNarrativePreparation(read(s.preparation.path));
    for (const f of [s.installation, s.executable, s.exported, s.preparation, s.raw, s.restoration, ...s.tools])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const f of s.tools) assert.equal(sha(f.copy), f.sha256);
    for (const c of s.commands) assert(fs.statSync(c.log).isFile());
    const adaptations = read(path.join(source, "flow-adaptations.json"));
    assert.equal(adaptations.adaptations.length, 11);
    for (const f of [adaptations.original, adaptations.executed]) assert.equal(sha(f.path), f.sha256);
    assert.equal(adaptations.original.sha256, s.tools.find(f => path.basename(f.path) === "dev-narrative-playwright.cjs").sha256);
    assert.equal(s.rejectedPreparations, 5);
    return { cells: r.cells.length, passedChecks: report.passedChecks, failedChecks: report.failedChecks,
      notRunChecks: report.notRunChecks, retainedSourceAdaptations: adaptations.adaptations.length };
  });
  check("Incomplete, wrong-scope, duplicate and empty receipts are rejected", () => {
    for (const [ss, rr] of [
      [{ ...s, status: "RUNNING" }, r], [{ ...s, finishedAt: null }, r],
      [{ ...s, scope: "CURRENT_DEV" }, r], [{ ...s, normalCloseClaimed: true }, r],
      [s, { ...r, cells: [] }], [s, { ...r, cells: [...r.cells.slice(0, -1), r.cells[0]] }],
      [s, { ...r, pageErrors: ["error"] }], [s, { ...r, smoke: true }],
    ]) assert.throws(() => summary(ss, rr));
    return { rejectedVariants: 8 };
  });
  check("NVL history, complete paginated text, exact restored state and real voice events", () => {
    for (const c of r.cells.filter(c => c.status === "PASS")) {
      const d = c.checks[0].detail;
      assert(d.historyFonts > 0 && d.historyFontSamples.length > 0);
      assert(d.historyFontSamples.every(f => f.before === f.after && f.before >= 12));
      assert.equal(d.choice.nvlTotal, 24); assert.equal(d.restored.command, 24);
      assert(d.pages.some(p => p.nvlPage > 1)); assert.equal(d.cleared, 0);
      assertRestoredNarrativeState(d.restored, d.choice, c.viewport);
      for (const state of [d.choice, d.restored]) assert(state.nvl.every(n =>
        n.rect.x >= state.region.x - 2 && n.rect.right <= state.region.right + 2 &&
        n.rect.y >= state.region.y - 2 && n.rect.bottom <= state.region.bottom + 2 &&
        n.rect.bottom <= state.choice.y + 1));
      for (let i = 1; i <= 3; i++) {
        const detail = c.checks[i].detail, saved = c.saved[i - 1];
        assert(detail.firstPages > 1 && detail.firstPages < 1000);
        assert.equal(detail.interior.page, 2);
        assertRestoredNarrativeState(detail.restored, detail.interior, c.viewport);
        assert.equal(detail.pageStates.length, detail.firstPages - 1);
        detail.pageStates.forEach((p, j) => assert.equal(p.page, j + 2));
        assert.equal(detail.firstText + detail.pageStates.map(p => p.text).join(""), s.fixture.longTexts[saved.name]);
        assert.equal(detail.characters, s.fixture.longTexts[saved.name].length);
        assert.equal(detail.count, i * 2); assert.equal(detail.back.command, 0); assert.equal(detail.forward.command, 1);
      }
      const restart = c.checks[4].detail, launches = r.launches.filter(l => l.cell === c.name);
      assert.equal(launches.length, 2); assert.equal(launches[0].restart, false);
      assert(launches[0].controlledPublicImport); assert.equal(launches[1].restart, true);
      assert(!launches[1].controlledPublicImport); assert.notEqual(launches[0].identity.Created, launches[1].identity.Created);
      assert.equal(restart.reseeded, false); assert.equal(restart.restored.length, 3);
      for (let i = 0; i < 3; i++) assertRestoredNarrativeState(restart.restored[i], c.saved[i].interior, c.viewport);
      assert.equal(launches[0].voice.calls.length, 6); assert.equal(launches[1].voice.calls.length, 0);
      for (const call of launches[0].voice.calls) {
        assert.equal(call.settlement, "resolved");
        assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "playing"));
        assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "timeupdate" && e.time > 0));
      }
      const windows = r.negativeWindows.filter(w => w.cell === c.name);
      assert.equal(windows.length, 18); assert(windows.every(w => w.windowMs >= 2200 && w.actual === w.expected));
    }
    return { acceptedCells: r.cells.filter(c => c.status === "PASS").length, listeningClaimed: false };
  });
  check("First-render traces, screenshots and archived native file bytes", () => {
    let frames = 0;
    const protection = read(path.join(source, "profile-protection.json"));
    const archive = protection.records.find(p => p.storage === "NativeRoaming").target;
    assert.equal(new Set(r.screenshots.map(s => path.resolve(s.path))).size, r.screenshots.length);
    for (const c of r.cells.filter(c => c.status === "PASS")) {
      assert.deepEqual(c.frameTraces.map(t => t.kind).sort(), ["dialog", "nvl-choice"]);
      for (const trace of c.frameTraces) {
        assert.equal(sha(trace.path), trace.sha256); const rawFrames = read(trace.path); frames += rawFrames.length;
        const actual = trace.kind === "dialog" ? analyzeDialogFrames(rawFrames) : analyzeChoiceFrames(rawFrames);
        assert.deepEqual(actual, trace.observation); assert.equal(actual.classification, "NO_OVERFLOW_OBSERVED");
      }
      const names = r.screenshots.filter(s => path.basename(s.path).startsWith(c.name + "-"))
        .map(s => path.basename(s.path)).sort();
      assert.deepEqual(names, ["capacity-choice", "voice-1", "voice-2", "voice-3", "restarted"]
        .map(name => `${c.name}-${name}.png`).sort());
      const saves = r.nativeSaves.filter(f => f.cell === c.name); assert.equal(saves.length, 4);
      assert.deepEqual(saves.find(f => f.data.slot === 4).data.nvl_page.map(n => n.text), s.fixture.capacityTexts);
      for (const saved of c.saved) {
        const file = saves.find(f => f.data.save_id === saved.saveId); assert(file);
        assert.equal(file.data.dialog_page_index, 1); assert.equal(file.data.dialog_page_count, saved.interior.pages);
      }
    }
    for (const shot of r.screenshots) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const cell = r.cells.find(c => path.basename(shot.path).startsWith(c.name + "-")); assert(cell);
      const v = cell.viewport, png = fs.readFileSync(shot.path);
      assert.equal(shot.before.width, v.width); assert.equal(shot.before.height, v.height);
      assert(Math.abs(shot.before.dpr - v.dpr) <= 1e-6); assert.equal(shot.before.reduced, v.reduced);
      assert.equal(png.readUInt32BE(16), v.width * v.dpr); assert.equal(png.readUInt32BE(20), v.height * v.dpr);
    }
    for (const f of r.nativeSaves) {
      assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
      assert.equal(sha(path.join(archive, "saves", f.data.install_id, path.basename(f.source))), f.sha256);
    }
    return { frames, screenshots: r.screenshots.length, nativeSaves: r.nativeSaves.length };
  });
  check("Original directory identities/bytes restored, exact owned processes and ports ended", () => {
    const before = read(path.join(source, "profile-protection.json")), restored = read(s.restoration.path);
    assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
    for (const original of before.records) {
      assert(!fs.existsSync(original.held));
      const current = restored.restored.find(p => p.original === original.original); assert(current);
      assert.equal(current.directoryId, original.directoryId); assert.deepEqual(current.files, original.files);
      if (original.existed) {
        const result = spawnSync("fsutil.exe", ["file", "queryfileid", original.original],
          { windowsHide: true, encoding: "utf8", timeout: 10000 });
        assert.equal(result.status, 0); assert(result.stdout.toLowerCase().includes(original.directoryId.toLowerCase()));
      }
      for (const f of original.files) assert.equal(sha(path.join(original.original, f.relative)), f.sha256);
      if (original.storage === "NativeRoaming") assert(!fs.existsSync(original.retained));
    }
    assert(!rows().some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    assert.deepEqual(listeners(s.absentPorts), []);
    return { originalDirectories: before.records.length, ownedIdentities: r.knownProcesses.length,
      ports: s.absentPorts.length, normalCloseClaimed: false };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion,
    coverageComplete: report.coverageComplete, out, checks: report.checks.map(c => ({ name: c.name, status: c.status })),
    error: report.error }, null, 2));
}
