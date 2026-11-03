"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/abilities-installed-1924-${attempt}`);
const out = path.resolve(`F:/AgentVN/QA/Editor-1.9.24-20261024-01/abilities-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [],
  scope: "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY_AUDIT",
  productChanges: 0, modelRequests: 0, builds: 0, excluded: ["Fresh authoring", "Quick faults",
    "Standalone saves", "Normal close", "Android", "Audio listening"] };
function summary(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.cleanupError && !r.observerError);
  assert.equal(r.scope, "INSTALLED_1_9_24_INHERITANCE_ANCHORS_QUICK_LIBRARY");
  assert.equal(r.normalCloseClaimed, false);
  for (const name of ["productChanges", "modelRequests", "builds"]) assert.equal(r[name], 0);
  assert.equal(r.cells.length, 12); assert(r.cells.every(c => c.status === "PASS"));
  const keys = new Set(r.cells.map(c => JSON.stringify(c.viewport))); assert.equal(keys.size, 12);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert.equal(r.cells.filter(c => c.viewport.width === width && c.viewport.height === width * 9 / 16 &&
      c.viewport.dpr === dpr && c.viewport.reduced === reduced).length, 1);
}
function check(name, fn) {
  const item = { name, status: "RUNNING" }; report.checks.push(item);
  try { item.detail = fn(); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
}
try {
  const file = path.join(source, "session.json"), session = read(file);
  report.input = { path: file, sha256: sha(file) }; summary(session);
  for (const bad of [{ ...session, cells: [] }, { ...session, normalCloseClaimed: true },
    { ...session, cells: [...session.cells.slice(0, -1), session.cells[0]] }])
    assert.throws(() => summary(bad));
  const launches = [], originalSource = fs.readFileSync("scripts/installed-runtime-abilities-playwright.cjs", "utf8");
  check("Actual candidate provenance, unchanged historical business code, full matrix and executed adapters", () => {
    for (const item of [session.predecessor, session.installation, session.originalExport, session.executable,
      ...session.tools, ...session.cartridges]) assert.equal(sha(item.path), item.sha256, item.path);
    const installed = read(session.installation.path);
    assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.24");
    assert.equal(session.executable.sha256, installed.resources.find(f =>
      path.basename(f.path) === "agentvn-player.exe").sha256);
    assert.equal(session.fixtureByteValidation, "PASS");
    assert(session.commands.every(c => c.exitCode === 0 && c.status === "PASS" && c.finishedAt));
    assert.deepEqual(session.commands.map(c => c.label), ["adapter-guard", "profile-prepare",
      ...Array.from({ length: 12 }, (_, i) => `business-${String(i + 1).padStart(2, "0")}`), "profile-restore"]);
    for (const cell of session.cells) {
      const adapted = read(cell.out + "-adaptations.json");
      assert.equal(sha(adapted.original.path), adapted.original.sha256);
      assert.equal(sha(adapted.executed.path), adapted.executed.sha256);
      let actual = originalSource;
      assert.equal(adapted.adaptations.length, 6);
      for (const change of adapted.adaptations) {
        assert.equal(actual.split(change.before).length - 1, 1); actual = actual.replace(change.before, change.after);
      }
      assert.equal(fs.readFileSync(adapted.executed.path, "utf8"), actual);
    }
    return { cells: 12, rejectedSummaries: 3, historicalFixtureNotNewAuthoring: true };
  });
  check("Both layouts inherit and clear NVL, track/fallback/fix bubbles, retain six quick saves and read across layouts", () => {
    let checks = 0, nativeFiles = 0, screenshots = 0;
    for (const cell of session.cells) {
      assert.equal(sha(cell.raw.path), cell.raw.sha256); const raw = read(cell.raw.path);
      assert.equal(raw.status, "PASS"); assert(raw.finishedAt && !raw.cleanupError && !raw.error);
      assert.deepEqual(raw.pageErrors, []); assert.equal(raw.checks.length, 16);
      assert(raw.checks.every(c => c.status === "PASS")); checks += raw.checks.length;
      assert.equal(raw.matrix.length, 2);
      for (const layout of ["agentvn", "renpy"]) {
        const control = raw.matrix.find(c => c.layout === layout); assert(control && control.status === "PASS");
        for (const [key, value] of Object.entries(cell.viewport)) assert.equal(control[key], value);
        assert.equal(control.controls.length, layout === "renpy" ? 9 : 1);
        assert(control.controls.every(c => c.hit && c.x >= -1 && c.y >= -1 &&
          c.right <= cell.viewport.width + 1 && c.bottom <= cell.viewport.height + 1));
        if (layout === "renpy")
          assert(Math.max(...control.controls.map(c => c.y)) - Math.min(...control.controls.map(c => c.y)) < 1);
        const nvl = raw.checks.find(c => c.layout === layout && c.name.startsWith("NVL inheritance")).detail;
        assert.equal(nvl.before.nvl.length, 3); assert.deepEqual(nvl.restored.nvl, nvl.before.nvl);
        assert.equal(nvl.stored.nvl_page.length, 3); assert.equal(nvl.stored.nvl_presentation_mode, "nvl");
        const clear = raw.checks.find(c => c.layout === layout && c.name.startsWith("NVL explicit clear")).detail;
        assert.equal(clear.cleared.nvl.length, 1); assert.equal(clear.bubble.nvl.length, 0);
        const bubble = raw.checks.find(c => c.layout === layout && c.name.startsWith("Bubble follows")).detail;
        assert.equal(bubble.left.anchor, "character"); assert.equal(bubble.moved.anchor, "character");
        assert(bubble.moved.rect.x > bubble.left.rect.x); assert.equal(bubble.absent.anchor, "fallback");
        assert.equal(bubble.fixed.anchor, "fixed"); assert(bubble.long.pages > 1);
      }
      const quick = raw.checks.find(c => c.name.startsWith("Real quick-save actions")).detail;
      assert.equal(quick.writes.length, 7); assert.equal(quick.retained.length, 6);
      assert.deepEqual(quick.retained.map(s => s.command_index).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
      assert.equal(quick.noSaveFeedback, "PASS"); assert.equal(quick.cancelPreservesCommand, 7);
      assert.equal(quick.loadedCommand, 6); assert.equal(quick.manualUnchanged, true);
      const cross = raw.checks.find(c => c.name.startsWith("After actual Renpy process exit")).detail;
      assert.equal(cross.before.filter(s => s.save_kind === "quick").length, 6);
      assert.equal(cross.restored.mode, "dialog"); assert.equal(cross.realPlayerRestart, true);
      assert.equal(cross.storage.portable, false);
      for (const item of [...raw.nativeSaves, ...cross.files]) {
        assert.equal(sha(item.retained), item.sha256);
        const bytes = read(item.retained);
        if (item.saveId) assert.equal(bytes.save_id, item.saveId);
        nativeFiles++;
      }
      assert(raw.screenshots.length >= 12);
      for (const shot of raw.screenshots) {
        assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, cell.viewport);
        assert.deepEqual(shot.before, shot.after); const png = fs.readFileSync(shot.path);
        assert.equal(png.readUInt32BE(16), cell.viewport.width * cell.viewport.dpr);
        assert.equal(png.readUInt32BE(20), cell.viewport.height * cell.viewport.dpr); screenshots++;
      }
      assert.equal(raw.launches.length, 3);
      assert(raw.launches.every(l => l.cleanup?.status === "PASS")); launches.push(...raw.launches);
    }
    return { actualBusinessChecks: checks, nativeFiles, screenshots, quickFaultsNotClaimed: true };
  });
  check("Original user profile identities/bytes restored; exact owned processes and ports ended", () => {
    assert.equal(sha(session.restoration.path), session.restoration.sha256);
    const restoration = read(session.restoration.path), protection = read(path.join(source, "profile-protection.json"));
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    for (const original of protection.records) {
      assert(!fs.existsSync(original.held));
      const restored = restoration.restored.find(p => p.original === original.original); assert(restored);
      assert.equal(restored.directoryId, original.directoryId); assert.deepEqual(restored.files, original.files);
      for (const item of original.files) assert.equal(sha(path.join(original.original, item.relative)), item.sha256);
    }
    assert(session.knownProcesses.length > 0);
    assert(!rows().some(p => session.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
    assert.deepEqual(listeners(launches.map(l => l.cdpPort)), []);
    return { launches: launches.length, identities: session.knownProcesses.length, normalCloseClaimed: false };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
