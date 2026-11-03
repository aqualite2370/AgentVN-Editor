"use strict";
// Read-only terminal audit. Never relabel current Dev evidence as installed acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateDevNarrativePreparation } = require("./lib/dev-narrative-preparation.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function screenshotCoverage(r) {
  assert.equal(new Set(r.screenshots.map(s => path.resolve(s.path))).size, r.screenshots.length);
  for (const c of r.cells.filter(c => c.status === "PASS")) {
    const names = r.screenshots.filter(s => path.basename(s.path).startsWith(`${c.name}-`))
      .map(s => path.basename(s.path)).sort();
    assert.deepEqual(names, ["capacity-choice", "voice-1", "voice-2", "voice-3", "restarted"]
      .map(name => `${c.name}-${name}.png`).sort());
  }
}
function terminal(s, r) {
  assert(["PASS", "FAILED"].includes(s.status) && s.status === r.status);
  assert(s.finishedAt && r.finishedAt && !s.cleanupError && !r.cleanupError && !r.observerError);
  assert.equal(s.scope, "CURRENT_DEV_NATIVE_NARRATIVE_NOT_INSTALLED_ACCEPTANCE");
  assert.equal(r.scope, "CURRENT_DEV_NATIVE_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION_NOT_INSTALLED");
  for (const k of ["productChanges", "modelRequests", "normalCloseClaimed"]) {
    assert.equal(s[k], k === "normalCloseClaimed" ? false : 0); assert.equal(r[k], s[k]);
  }
  assert.equal(s.builds, 0); assert.equal(r.newBuilds, 0); assert.equal(s.smoke, r.smoke);
  assert.deepEqual(s.commands.map(c => c.label), ["preparation-guard", "profile-prepare", "narrative", "profile-restore"]);
  assert(s.commands.every(c => c.finishedAt && c.status !== "RUNNING"));
  assert(s.commands.filter(c => c.label !== "narrative").every(c => c.status === "PASS" && c.exitCode === 0));
  assert.equal(s.commands[2].exitCode, r.status === "PASS" ? 0 : 1);
  assert.equal(s.executable.sha256, "04cfa699f23450ff64d71478c90b31f21d48b71d0b4c80924120a9b9fe7b6943");
  assert.equal(s.environment.AGENTVN_WORKSPACE_OUTPUT, s.out);
  assert.equal(s.environment.AGENTVN_TEST_PROJECT, s.fixture.input);
  assert.equal(r.pageErrors.length, 0); assert.equal(r.cells.length, s.smoke ? 2 : 24);
  assert.deepEqual(s.absentPorts, r.launches.map(l => l.port));
  const names = new Set();
  for (const c of r.cells) {
    const v = c.viewport, key = `${v.width}x${v.height}-dpr${v.dpr}-${v.reduced ? "reduced" : "normal"}-${c.layout}`;
    assert.equal(c.name, key); assert(!names.has(key)); names.add(key);
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => v.width === w && v.height === h));
    assert([1, 2].includes(v.dpr) && typeof v.reduced === "boolean" && ["agentvn", "renpy"].includes(c.layout));
    assert(["PASS", "FAILED"].includes(c.status));
    assert(c.checks.every(k => ["PASS", "FAILED"].includes(k.status) && k.finishedAt));
    if (c.status === "FAILED") { assert(c.error || c.checks.some(k => k.status === "FAILED")); continue; }
    assert.equal(c.checks.length, 5); assert(c.checks.every(k => k.status === "PASS")); assert.equal(c.saved.length, 3);
    const d = c.checks[0].detail;
    assert(d.historyFonts > 0 && d.historyFontSamples.length > 0);
    assert(d.historyFontSamples.every(f => f.before === f.after && f.before >= 12));
    assert.equal(d.choice.nvlTotal, 24); assert.equal(d.restored.command, 24);
    assert(d.pages.some(p => p.nvlPage > 1)); assert.equal(d.cleared, 0);
    assert.deepEqual(d.restored.nvl, d.choice.nvl);
    for (const state of [d.choice, d.restored]) assert(state.nvl.every(n =>
      n.rect.x >= state.region.x - 2 && n.rect.right <= state.region.right + 2 &&
      n.rect.y >= state.region.y - 2 && n.rect.bottom <= state.region.bottom + 2 && n.rect.bottom <= state.choice.y + 1));
    for (let i = 1; i <= 3; i++) {
      const d = c.checks[i].detail, f = c.saved[i - 1];
      assert(d.firstPages > 1 && d.firstPages < 1000); assert.equal(d.interior.page, 2);
      assert.equal(d.restored.page, 2); assert.equal(d.restored.text, d.interior.text);
      assert.equal(f.interior.scene, f.name); assert.equal(d.characters, s.fixture.longTexts[f.name].length);
      assert.equal(d.pageStates.length, d.firstPages - 1);
      d.pageStates.forEach((p, i) => assert.equal(p.page, i + 2));
      assert.equal(d.firstText + d.pageStates.map(p => p.text).join(""), s.fixture.longTexts[f.name]);
      assert.equal(d.count, i * 2); assert.equal(d.back.command, 0); assert.equal(d.forward.command, 1);
    }
    const restart = c.checks[4].detail, launches = r.launches.filter(l => l.cell === c.name);
    assert.notEqual(restart.oldPid, restart.newPid); assert.equal(restart.reseeded, false);
    assert.equal(restart.restored.length, 3); assert.equal(launches.length, 2);
    assert.equal(launches[0].restart, false); assert(launches[0].controlledPublicImport);
    assert.equal(launches[1].restart, true); assert(!launches[1].controlledPublicImport);
    assert.equal(launches[0].voice.calls.length, 6); assert.equal(launches[1].voice.calls.length, 0);
    for (const call of launches[0].voice.calls) {
      assert.equal(call.settlement, "resolved");
      assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "playing"));
      assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "timeupdate" && e.time > 0));
    }
    const windows = r.negativeWindows.filter(w => w.cell === c.name);
    assert.equal(windows.length, 18); assert(windows.every(w => w.windowMs >= 2200 && w.actual === w.expected));
  }
  if (!s.smoke) for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) for (const layout of ["agentvn", "renpy"])
      assert(names.has(`${w}x${h}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${layout}`));
  assert(r.launches.every(l => l.cleanup?.status === "PASS" &&
    path.resolve(l.identity.ExecutablePath) === path.resolve(s.executable.path)));
  assert.equal(r.status, r.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED");
}
async function main() {
  const [attempt, audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const source = path.resolve(`F:/AgentVN/QA/Native-Runtime-State-20261020-01/dev-narrative-20261024-${attempt}`);
  const out = `${source}-audit-${audit}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), sourceConclusion: "UNPROVEN",
    scope: "CURRENT_DEV_EVIDENCE_AUDIT_NOT_INSTALLED_OR_NEW_BUSINESS", groups: [], productChanges: 0, modelRequests: 0 };
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    report.session = desc(path.join(source, "session.json")); const s = read(report.session.path);
    report.raw = desc(s.raw.path); const r = read(s.raw.path); terminal(s, r);
    report.sourceConclusion = r.status; Object.assign(report, narrativeCoverage(r));
    await group("Exact Dev build, frozen products, UI export and executed tools", async () => {
      validateDevNarrativePreparation(read(s.preparation.path));
      for (const f of [s.checkpoint, s.build, s.executable, s.exported, s.preparation, s.raw, s.restoration,
        ...s.protectedProducts, ...s.tools]) assert.equal(sha(f.path), f.sha256);
      for (const f of s.tools) assert.equal(sha(f.copy), f.sha256);
      for (const c of s.cartridges) {
        const v = await validateCartridge(c.path, s.fixture, c.layout);
        assert.equal(v.scriptSha256, c.scriptSha256); assert.equal(v.layoutSha256, c.layoutSha256);
      }
      return { cells: r.cells.length, checks: r.cells.reduce((n, c) => n + c.checks.length, 0), installedClaimed: false };
    });
    await group("Incomplete, misattributed, blank and duplicate evidence rejected", () => {
      const changes = [
        ([s]) => { s.status = "RUNNING"; }, ([s]) => { s.finishedAt = null; },
        ([s]) => { s.scope = "INSTALLED"; }, ([s]) => { s.normalCloseClaimed = true; },
        ([s]) => { s.executable.sha256 = "wrong"; }, ([s]) => { s.commands.pop(); },
        ([s]) => { s.absentPorts = []; }, ([, r]) => { r.cells = []; },
        ([, r]) => { r.cells[0].viewport.dpr = 4; }, ([, r]) => { r.cells.push(r.cells[0]); },
        ([, r]) => { r.launches[0].cleanup.status = "RUNNING"; }, ([, r]) => { r.pageErrors.push("error"); },
      ];
      if (r.cells.some(c => c.status === "PASS")) changes.push(
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks.pop(); },
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks[0].detail.historyFontSamples = []; },
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks[1].detail.pageStates[0].text += "wrong"; },
        ([, r]) => { r.negativeWindows = []; },
        ([, r]) => { r.launches.find(l => l.restart).voice.calls.push({ id: 1 }); });
      for (const mutate of changes) { const pair = structuredClone([s, r]); mutate(pair); assert.throws(() => terminal(...pair)); }
      return { rejectedVariants: changes.length };
    });
    await group("Real PNG parameters, archived native bytes and restored scene pages", () => {
      screenshotCoverage(r);
      for (const image of r.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const c = r.cells.find(c => path.basename(image.path).startsWith(c.name + "-")); assert(c);
        const v = c.viewport, b = fs.readFileSync(image.path);
        assert.equal(image.before.width, v.width); assert.equal(image.before.height, v.height);
        assert(Math.abs(image.before.dpr - v.dpr) <= 1e-6); assert.equal(image.before.reduced, v.reduced);
        assert.equal(b.readUInt32BE(16), v.width * v.dpr); assert.equal(b.readUInt32BE(20), v.height * v.dpr);
      }
      const protection = read(path.join(source, "profile-protection.json"));
      const archive = protection.records.find(r => r.storage === "NativeRoaming").target;
      for (const f of r.nativeSaves) {
        assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
        assert.equal(sha(path.join(archive, "saves", f.data.install_id, path.basename(f.source))), f.sha256);
      }
      for (const c of r.cells.filter(c => c.status === "PASS")) {
        const files = r.nativeSaves.filter(f => f.cell === c.name); assert.equal(files.length, 4);
        assert.deepEqual(files.find(f => f.data.slot === 4).data.nvl_page.map(n => n.text), s.fixture.capacityTexts);
        for (const saved of c.saved) {
          const f = files.find(f => f.data.save_id === saved.saveId); assert(f);
          assert.equal(f.data.dialog_page_index, 1); assert.equal(f.data.dialog_page_count, saved.interior.pages);
        }
      }
      return { screenshots: r.screenshots.length, nativeSaves: r.nativeSaves.length, physical4kClaimed: false };
    });
    await group("Original profile identities/bytes and owned processes/ports", () => {
      const before = read(path.join(source, "profile-protection.json")), restored = read(s.restoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      let originalFiles = 0;
      for (const old of before.records) {
        assert(!fs.existsSync(old.held)); const current = restored.restored.find(r => r.original === old.original); assert(current);
        assert.equal(current.directoryId, old.directoryId); assert.deepEqual(current.files, old.files);
        if (old.existed) {
          const result = spawnSync("fsutil.exe", ["file", "queryfileid", old.original], { windowsHide: true, encoding: "utf8", timeout: 10000 });
          assert.equal(result.status, 0); assert(result.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        }
        for (const f of old.files) { assert.equal(sha(path.join(old.original, f.relative)), f.sha256); originalFiles++; }
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      }
      const all = rows();
      assert(!all.some(p => r.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert(!all.some(p => p.Name === "agentvn-player.exe" || p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
      assert.deepEqual(listeners(s.absentPorts), []);
      return { directories: before.records.length, originalFiles, ownedIdentities: r.knownProcesses.length,
        portsAbsent: s.absentPorts, normalCloseClaimed: false, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion,
      coverageComplete: report.coverageComplete, out, groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }));
  }
}
module.exports = { terminal, screenshotCoverage };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
