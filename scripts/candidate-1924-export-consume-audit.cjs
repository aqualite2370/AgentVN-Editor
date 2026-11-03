"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/fresh-export-installed-1924-${attempt}`;
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01", out = path.join(base, `fresh-export-audit-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), checks: [], modelRequests: 0,
  scope: "FRESH_INSTALLED_1924_UI_EXPORT_AND_LIBRARY_CONSUMPTION_AUDIT_NOT_STANDALONE_OR_ANDROID" };
function summary(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt && !r.cleanupError && !r.observerError);
  assert.equal(r.scope, "INSTALLED_1_9_24_FRESH_UI_EXPORT_LIBRARY_CONSUMPTION_NOT_STANDALONE_OR_ANDROID");
  assert.equal(r.modelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.builds, 0);
  assert.equal(r.normalCloseClaimed, false); assert.deepEqual(r.pageErrors, []);
  assert.equal(r.cells.length, 24); assert.equal(r.screenshots.length, 24);
  assert.equal(r.stories.length, 2); assert.equal(r.launches.length, 2); assert.equal(r.cartridges.length, 2);
  assert(r.cells.every(c => c.status === "PASS")); assert(r.stories.every(c => c.status === "PASS"));
  for (const layout of ["agentvn", "renpy"]) {
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
      assert.equal(r.cells.filter(c => c.layout === layout && c.width === width &&
        c.height === width * 9 / 16 && c.dpr === dpr && c.reduced === reduced).length, 1);
    assert.equal(r.stories.filter(s => s.layout === layout).length, 1);
    assert.equal(r.launches.filter(s => s.layout === layout).length, 1);
  }
}
function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
}
try {
  const file = path.join(source, "report.json"), r = read(file); summary(r);
  report.input = { path: file, sha256: sha(file) };
  for (const bad of [{ ...r, cells: [] }, { ...r, screenshots: [] }, { ...r, stories: [] },
    { ...r, cells: [...r.cells.slice(0, -1), r.cells[0]] }, { ...r, normalCloseClaimed: true }])
    assert.throws(() => summary(bad));
  const author = read(r.author.path), installed = read(r.installation.path), followup = read(r.followup.path);
  check("Fresh real UI author/export and exact installed executable lineage", () => {
    assert.equal(author.status, "PASS"); assert(author.finishedAt && !author.cleanupError);
    assert.equal(author.scope, "ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID");
    assert.equal(author.steps.length, 5); assert(author.steps.every(s => s.status === "PASS"));
    assert.equal(author.cartridges.length, 2);
    assert.equal(author.downloadEvents.filter(e => e.type === "begin").length, 2);
    for (const event of author.downloadEvents.filter(e => e.type === "begin"))
      assert(author.downloadEvents.some(e => e.guid === event.guid && e.type === "progress" && e.state === "completed"));
    assert.equal(author.modelRequests, 0); assert.equal(author.productChanges, 0); assert.equal(author.builds, 0);
    assert.deepEqual(author.errors, []);
    assert.equal(followup.status, "PASS"); assert.equal(followup.sourceConclusion, "PASS");
    assert.equal(installed.status, "PASS"); assert.equal(installed.executable.version, "1.9.24");
    assert.equal(installed.metadataRestoration, "PASS");
    for (const f of [r.author, r.installation, r.followup, installed.executable, ...installed.resources,
      ...installed.protectedFiles, ...author.cartridges, ...author.tools, ...r.tools])
      assert.equal(sha(f.path), f.sha256, f.path);
    for (const c of r.cartridges) {
      const exported = author.cartridges.find(f => f.layout === c.layout); assert(exported);
      assert.equal(c.sha256, exported.sha256); assert.equal(c.layoutSha256, exported.layoutSha256);
      assert.equal(c.scriptSha256, exported.scriptSha256); assert.equal(c.voiceBytesVerified, true);
    }
    for (const launch of r.launches) {
      assert.equal(path.resolve(launch.executable.path), path.resolve(installed.installRoot, "agentvn-player.exe"));
      assert.equal(launch.executable.sha256, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
      assert(launch.controlledPublicImport && launch.persistedLibraryRecord);
      assert.equal(launch.storage.portable, false); assert.equal(launch.cleanup.status, "PASS");
    }
    return { authorSteps: author.steps.length, exports: author.cartridges.length, incorrectReceiptsRejected: 5 };
  });
  check("Actual title visibility, navigation, new story text and decoded voice", () => {
    for (const c of r.cells) {
      if (c.layout === "renpy") assert.equal(c.titleHidden, true);
      else assert.equal(c.agentvnTitle, author.fixture.title);
      for (const g of [c.openSettingsHit, c.backHit]) {
        const b = g.rect; assert(g.enabled && g.hit && g.overflow <= 1);
        assert(b.width > 0 && b.height > 0 && b.x >= -1 && b.y >= -1 &&
          b.right <= g.width + 1 && b.bottom <= g.height + 1);
      }
    }
    for (const story of r.stories) {
      assert.equal(story.first.page, 1); assert(story.first.pages > 1); assert.equal(story.second.page, 2);
      assert(story.first.text && story.second.text);
      assert(author.fixture.longTexts.voice_dialog.startsWith(story.first.text + story.second.text));
      assert.equal(story.voice.calls.length, 1);
      assert.equal(story.voice.calls[0].settlement, "resolved");
      assert(story.voice.events.some(e => e.event === "playing"));
      assert(story.voice.events.some(e => e.event === "timeupdate" && e.time > 0));
      assert(!story.voice.events.some(e => e.event === "error"));
    }
    return { displayCells: r.cells.length, realStoryConsumptions: r.stories.length, listeningClaimed: false };
  });
  check("Actual screenshot pixels, parameters and restored user bytes/owned processes", () => {
    assert.equal(new Set(r.screenshots.map(s => path.resolve(s.path))).size, 24);
    for (const shot of r.screenshots) {
      assert.equal(sha(shot.path), shot.sha256); assert.deepEqual(shot.before, shot.after);
      const png = fs.readFileSync(shot.path);
      assert.equal(png.readUInt32BE(16), shot.before.width * shot.before.dpr);
      assert.equal(png.readUInt32BE(20), shot.before.height * shot.before.dpr);
      const layout = path.basename(shot.path).split("-")[0];
      assert.equal(r.cells.filter(c => c.layout === layout && c.width === shot.before.width &&
        c.height === shot.before.height && Math.abs(c.dpr - shot.before.dpr) <= 1e-6 &&
        c.reduced === shot.before.reduced).length, 1);
    }
    assert.equal(sha(r.restoration.path), r.restoration.sha256);
    const restoration = read(r.restoration.path), protection = read(path.join(source, "profile-protection.json"));
    assert.equal(restoration.status, "PASS"); assert.equal(restoration.deletedUserFiles, 0);
    for (const original of protection.records) {
      assert(!fs.existsSync(original.held));
      const restored = restoration.restored.find(p => p.original === original.original); assert(restored);
      assert.equal(restored.directoryId, original.directoryId); assert.deepEqual(restored.files, original.files);
      for (const f of original.files) assert.equal(sha(path.join(original.original, f.relative)), f.sha256);
    }
    assert(!rows().some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
    assert.deepEqual(listeners(r.launches.map(l => l.port)), []);
    return { screenshots: r.screenshots.length, ownedIdentities: r.knownProcesses.length, normalCloseClaimed: false };
  });
  report.status = "PASS";
} catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
