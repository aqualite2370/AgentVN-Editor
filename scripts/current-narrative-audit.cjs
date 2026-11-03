"use strict";
// Independent, read-only evidence audit. No product launches or mutation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { assertRestoredNarrativeState } = require("./lib/narrative-restoration-state.cjs");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const current = require("./current-narrative-closure.cjs");
const candidate = require("./current-runtime-story-closure.cjs");
const qa = "F:/AgentVN/QA/Narrative-1.9.35-20261102-01";
const root = "F:/AgentVN/QA/Native-Runtime-State-20261101-01/narrative-installed-1935-01";
const exportedFile = "F:/AgentVN/QA/Installed-Layout-20261101-01/editor-06/report.json";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const describe = file => ({ path: path.resolve(file), sha256: sha(file) });
const checked = file => { assert.equal(sha(file.path), file.sha256, file.path); return file; };
function summary(s, r) {
  assert.equal(s.status, "PASS"); assert.equal(r.status, "PASS");
  assert(s.finishedAt && r.finishedAt && !s.cleanupError && !r.cleanupError && !r.observerError);
  assert.equal(s.scope, "ACTUAL_1935_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION");
  assert.equal(r.scope, s.scope); assert.equal(s.smoke, false); assert.equal(r.smoke, false);
  assert.equal(r.cells.length, 24); assert.deepEqual(r.pageErrors, []);
  assert.deepEqual(s.commands.map(c => c.label), ["profile-prepare", "narrative", "profile-restore"]);
  assert(s.commands.every(c => c.finishedAt && c.status === "PASS" && c.exitCode === 0));
  assert.equal(s.environment.AGENTVN_TEST_PROJECT, s.fixture.input);
  assert.equal(path.resolve(s.environment.AGENTVN_WORKSPACE_OUTPUT), path.resolve(root));
  assert.equal(s.productChanges, 0); assert.equal(r.productChanges, 0);
  assert.equal(s.modelRequests, 0); assert.equal(r.modelRequests, 0);
  assert.equal(s.builds, 0); assert.equal(r.newBuilds, 0);
  assert.equal(s.normalCloseClaimed, false); assert.equal(r.normalCloseClaimed, false);
  const expected = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
    [false, true].flatMap(reduced => ["agentvn", "renpy"].map(layout =>
      ({ width, height: width * 9 / 16, dpr, reduced, layout })))));
  assert.deepEqual(r.cells.map(c => ({ ...c.viewport, layout: c.layout })), expected);
  const keys = new Set();
  for (const c of r.cells) {
    const v = c.viewport, key = `${v.width}x${v.height}-dpr${v.dpr}-${v.reduced ? "reduced" : "normal"}-${c.layout}`;
    assert.equal(c.name, key); assert(!keys.has(key)); keys.add(key);
    assert.equal(c.status, "PASS"); assert.equal(c.checks.length, 5);
    assert(c.checks.every(k => k.status === "PASS" && k.finishedAt));
    assert.equal(c.saved.length, 3);
  }
  assert.equal(r.launches.length, 48);
  assert.deepEqual(s.absentPorts, r.launches.map(l => l.port));
  assert(r.launches.every(l => l.cleanup?.status === "PASS" &&
    path.resolve(l.identity.ExecutablePath) === path.resolve(s.executable.path)));
}
async function main() {
  const out = qa + "/independent-audit-01.json"; assert(!fs.existsSync(out));
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    productChanges: 0, productStarts: 0, modelRequests: 0, builds: 0 };
  async function group(name, fn) {
    const row = { name, status: "RUNNING" }; report.groups.push(row);
    try { row.detail = await fn(); row.status = "PASS"; }
    catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  }
  try {
    const s = read(root + "/session.json"), r = read(root + "/player.json");
    report.sourceConclusion = r.status; Object.assign(report, narrativeCoverage(r));
    await group("Complete nonempty business matrix, same installed bytes and hostile receipts", () => {
      summary(s, r); assert(report.coverageComplete);
      current.validateNarrativePreparation(read(s.preparation.path));
      const actual = candidate.descriptor();
      assert.deepEqual(s.executable, actual.resources.find(f => path.basename(f.path) === "agentvn-player.exe"));
      for (const f of [s.installation, s.executable, s.exported, s.preparation, s.raw, s.restoration, ...s.tools])
        checked(f);
      for (const f of s.tools) assert.equal(sha(f.copy), f.sha256);
      const variants = [
        (ss, rr) => { ss.status = "RUNNING"; },
        (ss, rr) => { rr.cells = []; },
        (ss, rr) => { rr.cells[0].checks.pop(); },
        (ss, rr) => { rr.cells[0].viewport.dpr = 4; },
        (ss, rr) => { rr.cells[1] = rr.cells[0]; },
        (ss, rr) => { rr.smoke = true; },
        (ss, rr) => { rr.pageErrors.push("error"); },
        (ss, rr) => { ss.commands.at(-1).status = "RUNNING"; },
        (ss, rr) => { rr.launches[0].cleanup.status = "FAILED"; },
        (ss, rr) => { ss.normalCloseClaimed = true; },
      ];
      for (const mutate of variants) {
        const args = structuredClone([s, r]); mutate(...args); assert.throws(() => summary(...args));
      }
      return { session: describe(root + "/session.json"), raw: describe(root + "/player.json"),
        layouts: 24, functionalChecks: 120, rejectedVariants: variants.length };
    });
    await group("Actual Editor exports and deterministic adapters without animation probes", async () => {
      const exported = read(exportedFile);
      assert.equal(exported.status, "PASS"); assert.equal(exported.steps.length, 3);
      assert(exported.steps.every(c => c.status === "PASS" && c.finishedAt));
      assert.equal(exported.cartridges.length, 2);
      for (const c of exported.cartridges)
        assert.deepEqual(await validateCartridge(c.path, exported.fixture, c.layout), c);
      assert.equal(exported.cartridges[0].scriptSha256, exported.cartridges[1].scriptSha256);
      assert.equal(sha(exported.restoration.path), exported.restoration.sha256);
      assert.equal(read(exported.restoration.path).status, "PASS");
      assert(exported.cleanups.length && exported.cleanups.every(c => c.status === "PASS"));
      for (const mode of ["export", "flow", "player"]) {
        const folder = qa + "/" + mode + "-preparation", b = read(folder + "/binding.json");
        for (const f of [b.original, b.executed, b.adapter]) checked(f);
        assert.equal(sha(folder + "/frozen-adapter.cjs"), b.adapter.sha256);
        const source = fs.readFileSync(b.original.path, "utf8"), result = current.build(mode, source);
        assert.equal(fs.readFileSync(b.executed.path, "utf8"), result.source);
        assert.deepEqual(b.edits, result.edits);
        let reversed = result.source;
        for (const e of [...result.edits].reverse()) reversed = reversed.replaceAll(e.after, () => e.before);
        assert.equal(reversed, source);
      }
      return { exported: describe(exportedFile), genuineCartridges: exported.cartridges,
        deterministicAdapters: 3, productModifications: 0, animationProbes: 0 };
    });
    await group("NVL capacity, reserved choice, entire paginated text and actual voice deduplication", () => {
      let historyComparisons = 0, negativeWindows = 0, plays = 0;
      for (const c of r.cells) {
        const d = c.checks[0].detail;
        assert(d.historyFonts > 0 && d.historyFontSamples.length > 0);
        assert(d.historyFontSamples.every(f => f.before === f.after && f.before >= 12));
        historyComparisons += d.historyFontSamples.length;
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
          plays++;
        }
        const windows = r.negativeWindows.filter(w => w.cell === c.name);
        assert.equal(windows.length, 18);
        assert(windows.every(w => w.windowMs >= 2200 && w.actual === w.expected));
        negativeWindows += windows.length;
      }
      return { acceptedLayouts: r.cells.length, historyComparisons, actualMediaPlays: plays,
        noReplayObservationWindows: negativeWindows, newListeningClaim: false };
    });
    await group("Actual PNG pixels and durable native file bytes", () => {
      const protection = read(root + "/profile-protection.json");
      const archive = protection.records.find(p => p.storage === "NativeRoaming").target;
      assert.equal(new Set(r.screenshots.map(s => path.resolve(s.path))).size, r.screenshots.length);
      for (const c of r.cells) {
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
        checked(shot); assert.deepEqual(shot.before, shot.after);
        const c = r.cells.find(c => path.basename(shot.path).startsWith(c.name + "-")); assert(c);
        const v = c.viewport, png = fs.readFileSync(shot.path);
        assert.equal(shot.before.width, v.width); assert.equal(shot.before.height, v.height);
        assert(Math.abs(shot.before.dpr - v.dpr) <= 1e-6); assert.equal(shot.before.reduced, v.reduced);
        assert.equal(png.readUInt32BE(16), v.width * v.dpr); assert.equal(png.readUInt32BE(20), v.height * v.dpr);
      }
      for (const f of r.nativeSaves) {
        assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
        assert.equal(sha(path.join(archive, "saves", f.data.install_id, path.basename(f.source))), f.sha256);
      }
      return { screenshots: r.screenshots.length, nativeSnapshots: r.nativeSaves.length };
    });
    await group("Original directories and bytes restored, owned processes and ports absent", () => {
      const before = read(root + "/profile-protection.json"), restored = read(s.restoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const old of before.records) {
        assert(!fs.existsSync(old.held));
        const now = restored.restored.find(p => p.original === old.original); assert(now);
        assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
        if (old.existed) {
          assert(!fs.lstatSync(old.original).isSymbolicLink());
          const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
            { windowsHide: true, encoding: "utf8", timeout: 10000 });
          assert.equal(id.status, 0); assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        }
        for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      }
      const active = rows();
      assert(!active.some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert(!active.some(p => p.Name === "agentvn-player.exe" ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(root)));
      assert.deepEqual(listeners(s.absentPorts), []);
      return { originalProfiles: before.records.length, ownedIdentities: r.knownProcesses.length,
        absentPorts: s.absentPorts.length, normalCloseClaimed: false, userFilesDeleted: 0 };
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
    fs.copyFileSync(__filename, qa + "/executed-audit-01.cjs", fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion,
      coverageComplete: report.coverageComplete, groups: report.groups.map(g => ({
        name: g.name, status: g.status })), error: report.error, out }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
