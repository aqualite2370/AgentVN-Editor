"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { validateNarrativePreparation } = require("./lib/installed-narrative-1922-policy.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { narrativeCoverage } = require("./lib/narrative-coverage.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function validateTerminal(s, raw) {
  assert(["PASS", "FAILED"].includes(s.status) && ["PASS", "FAILED"].includes(raw.status));
  assert(s.finishedAt && raw.finishedAt && !s.cleanupError && !raw.cleanupError && !raw.observerError);
  assert.equal(s.normalCloseClaimed, false); assert.equal(raw.normalCloseClaimed, false);
  assert.equal(s.scope, "ACTUAL_1922_INSTALLED_NARRATIVE_BOUNDARIES_SESSION");
  assert.equal(raw.scope, "ACTUAL_1922_INSTALLED_LIBRARY_NVL_CAPACITY_AND_VOICE_RESTORATION");
  for (const k of ["productChanges", "modelRequests"]) { assert.equal(s[k], 0); assert.equal(raw[k], 0); }
  assert.equal(s.builds, 0); assert.equal(raw.newBuilds, 0);
  assert.equal(s.smoke, raw.smoke); assert.equal(raw.cells.length, s.smoke ? 2 : 24);
  assert.equal(s.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.deepEqual(s.commands.map(c => c.label), ["profile-prepare", "narrative", "profile-restore"]);
  assert(s.commands.every(c => c.finishedAt));
  assert(s.commands.filter(c => c.label !== "narrative").every(c => c.exitCode === 0 && c.status === "PASS"));
  assert.equal(s.commands[1].exitCode, raw.status === "PASS" ? 0 : 1);
  assert.deepEqual(s.absentPorts, raw.launches.map(l => l.port));
  assert.equal(raw.pageErrors.length, 0);
  assert.equal(s.environment.AGENTVN_WORKSPACE_OUTPUT, s.out);
  assert.equal(s.environment.AGENTVN_TEST_PROJECT, s.fixture.input);
  const names = new Set();
  for (const c of raw.cells) {
    const v = c.viewport, key = `${v.width}x${v.height}-dpr${v.dpr}-${v.reduced ? "reduced" : "normal"}-${c.layout}`;
    assert.equal(c.name, key); assert(!names.has(key)); names.add(key);
    assert([[1920, 1080], [2560, 1440], [3840, 2160]].some(([w, h]) => v.width === w && v.height === h));
    assert([1, 2].includes(v.dpr) && typeof v.reduced === "boolean" && ["agentvn", "renpy"].includes(c.layout));
    assert(["PASS", "FAILED"].includes(c.status));
    assert(c.checks.every(k => ["PASS", "FAILED"].includes(k.status) && k.finishedAt));
    if (c.status === "FAILED") { assert(c.error || c.checks.some(k => k.status === "FAILED")); continue; }
    assert.equal(c.checks.length, 5); assert(c.checks.every(k => k.status === "PASS"));
    assert.equal(c.saved.length, 3);
    const capacity = c.checks[0].detail;
    if (s.fixture.capacityVariant === "mixed-history-v2") {
      assert(capacity.historyFonts > 0 && capacity.historyFontSamples.length > 0);
      assert(capacity.historyFontSamples.every(v => v.before === v.after && v.before >= 12));
      for (const state of [capacity.choice, capacity.restored]) {
        assert(state.nvl.every(n => n.rect.x >= state.region.x - 2 && n.rect.right <= state.region.right + 2 &&
          n.rect.y >= state.region.y - 2 && n.rect.bottom <= state.region.bottom + 2 &&
          n.rect.bottom <= state.choice.y + 1));
      }
    }
    assert.equal(capacity.choice.nvlTotal, 24); assert.equal(capacity.restored.command, 24);
    assert(capacity.pages.some(p => p.nvlPage > 1)); assert.equal(capacity.cleared, 0);
    assert.deepEqual(capacity.restored.nvl, capacity.choice.nvl);
    for (let i = 1; i <= 3; i++) {
      const v = c.checks[i].detail, f = c.saved[i - 1];
      assert(v.firstPages > 1 && v.firstPages < 1000);
      assert.equal(v.interior.page, 2); assert.equal(v.restored.page, 2);
      assert.equal(v.restored.text, v.interior.text);
      assert.equal(v.characters, s.fixture.longTexts[f.name].length);
      assert.equal(v.pageStates.length, v.firstPages - 1);
      v.pageStates.forEach((p, index) => assert.equal(p.page, index + 2));
      if (s.fixture.capacityVariant === "mixed-history-v2") {
        assert.equal(f.interior.scene, f.name);
        assert.equal(v.firstText + v.pageStates.map(p => p.text).join(""), s.fixture.longTexts[f.name]);
      }
      assert.equal(v.count, i * 2); assert.equal(v.back.command, 0); assert.equal(v.forward.command, 1);
    }
    const rest = c.checks[4].detail; assert.notEqual(rest.newPid, rest.oldPid); assert.equal(rest.reseeded, false);
    assert.equal(rest.restored.length, 3);
    const launches = raw.launches.filter(l => l.cell === c.name); assert.equal(launches.length, 2);
    assert.equal(launches[0].restart, false); assert(launches[0].controlledPublicImport);
    assert.equal(launches[1].restart, true); assert(!launches[1].controlledPublicImport);
    assert.equal(launches[0].voice.calls.length, 6); assert.equal(launches[1].voice.calls.length, 0);
    for (const call of launches[0].voice.calls) {
      assert.equal(call.settlement, "resolved");
      assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "playing"));
      assert(launches[0].voice.events.some(e => e.id === call.id && e.event === "timeupdate" && e.time > 0));
    }
    const windows = raw.negativeWindows.filter(w => w.cell === c.name);
    assert.equal(windows.length, 18); assert(windows.every(w => w.windowMs >= 2200 && w.actual === w.expected));
  }
  if (!s.smoke) for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
    for (const dpr of [1, 2]) for (const reduced of [false, true]) for (const layout of ["agentvn", "renpy"])
      assert(names.has(`${width}x${height}-dpr${dpr}-${reduced ? "reduced" : "normal"}-${layout}`));
  assert(raw.launches.every(l => l.cleanup?.status === "PASS" &&
    path.resolve(l.identity.ExecutablePath) === path.resolve(s.executable.path)));
  assert.equal(raw.status, raw.cells.every(c => c.status === "PASS") ? "PASS" : "FAILED");
  assert.equal(s.status, raw.status);
}
async function main() {
  const [attempt, audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-narrative-1922-${attempt}`;
  const out = `${source}-audit-${audit}`; assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), sourceConclusion: "UNPROVEN", groups: [],
    scope: "NARRATIVE_EVIDENCE_AUDIT_NOT_NEW_BUSINESS_EXECUTION", productChanges: 0, modelRequests: 0 };
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    report.session = desc(path.join(source, "session.json"));
    const s = read(report.session.path), raw = read(s.raw.path); report.raw = desc(s.raw.path);
    report.sourceConclusion = raw.status; validateTerminal(s, raw);
    Object.assign(report, narrativeCoverage(raw));
    await group("Exact installed candidate, UI cartridge/script/voice provenance and scope", async () => {
      validateNarrativePreparation(read(s.preparation.path));
      for (const f of [s.checkpoint, s.executable, s.installation, s.exported, s.preparation, s.raw,
        s.restoration, ...s.protectedProducts, ...s.tools]) assert.equal(sha(f.path), f.sha256);
      const installed = read(s.installation.path);
      for (const f of [installed.executable, ...installed.resources, installed.originalAudit, installed.originalInstallation])
        assert.equal(sha(f.path), f.sha256);
      for (const f of s.tools) assert.equal(sha(f.copy), f.sha256);
      const exported = read(s.exported.path);
      for (const f of exported.tools) { assert.equal(sha(f.path), f.sha256); assert.equal(sha(f.copy), f.sha256); }
      const cacheBefore = read(path.join(exported.out, "native-cache-protection.json"));
      const cacheAfter = read(exported.restoration.path);
      assert(!fs.existsSync(cacheBefore.held));
      assert.equal(cacheBefore.directoryId, cacheAfter.originalDirectoryId);
      assert.deepEqual(cacheBefore.files, cacheAfter.originalFiles);
      const cacheId = spawnSync("fsutil.exe", ["file", "queryfileid", cacheBefore.original],
        { windowsHide: true, encoding: "utf8", timeout: 10000 });
      assert.equal(cacheId.status, 0); assert(cacheId.stdout.toLowerCase().includes(cacheBefore.directoryId.toLowerCase()));
      for (const f of cacheBefore.files) assert.equal(sha(path.join(cacheBefore.original, f.relative)), f.sha256);
      const processes = rows();
      assert(!processes.some(p => exported.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert.deepEqual(listeners(exported.launches.flatMap(l => l.ports)), []);
      for (const c of s.cartridges) {
        const value = await validateCartridge(c.path, s.fixture, c.layout);
        assert.equal(value.scriptSha256, c.scriptSha256); assert.equal(value.layoutSha256, c.layoutSha256);
      }
      return { sourceConclusion: raw.status, smoke: s.smoke, cells: raw.cells.length,
        checks: raw.cells.reduce((n, c) => n + c.checks.length, 0), listeningAcceptanceClaim: false,
        editorOriginalCacheFiles: cacheBefore.files.length, editorOriginalCacheDirectoryId: cacheBefore.directoryId,
        editorOwnedIdentities: exported.knownProcesses.length };
    });
    await group("Reject incomplete, misattributed and falsely upgraded evidence", () => {
      const mutations = [
        ([s]) => { s.status = "RUNNING"; }, ([s]) => { s.finishedAt = null; },
        ([s]) => { s.normalCloseClaimed = true; }, ([s]) => { s.modelRequests = 1; },
        ([s]) => { s.executable.sha256 = "wrong"; }, ([s]) => { s.commands.pop(); },
        ([s]) => { s.absentPorts = []; }, ([, r]) => { r.cells = []; },
        ([, r]) => { r.cells[0].viewport.dpr = 4; }, ([, r]) => { r.launches[0].identity.ExecutablePath = "D:/other.exe"; },
        ([, r]) => { r.launches[0].cleanup.status = "RUNNING"; }, ([, r]) => { r.pageErrors.push("error"); },
      ];
      const passing = raw.cells.find(c => c.status === "PASS");
      if (passing) mutations.push(
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks.pop(); },
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks[1].detail.characters--; },
        ([, r]) => { r.negativeWindows = []; },
        ([, r]) => { r.launches.find(l => l.restart).voice.calls.push({ id: 1 }); });
      if (passing && s.fixture.capacityVariant === "mixed-history-v2") mutations.push(
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks[0].detail.historyFontSamples = []; },
        ([, r]) => { r.cells.find(c => c.status === "PASS").checks[1].detail.pageStates[0].text += "wrong"; });
      for (const mutate of mutations) {
        const args = structuredClone([s, raw]); mutate(args); assert.throws(() => validateTerminal(...args));
      }
      return { rejectedVariants: mutations.length, businessFailurePreserved: raw.status !== "PASS" };
    });
    await group("Original PNG viewport/DPR/media, durable save bytes and NVL/voice snapshots", () => {
      for (const image of raw.screenshots) {
        assert.equal(sha(image.path), image.sha256); assert.deepEqual(image.before, image.after);
        const c = raw.cells.find(c => path.basename(image.path).startsWith(c.name + "-")); assert(c);
        const v = c.viewport, b = fs.readFileSync(image.path);
        assert.equal(image.before.width, v.width); assert.equal(image.before.height, v.height);
        assert(Math.abs(image.before.dpr - v.dpr) <= 1e-6); assert.equal(image.before.reduced, v.reduced);
        assert.equal(b.readUInt32BE(16), v.width * v.dpr); assert.equal(b.readUInt32BE(20), v.height * v.dpr);
      }
      const protection = read(path.join(source, "profile-protection.json"));
      const archive = protection.records.find(r => r.storage === "NativeRoaming").target;
      for (const f of raw.nativeSaves) {
        assert.equal(sha(f.retained), f.sha256); assert.deepEqual(read(f.retained), f.data);
        assert.equal(sha(path.join(archive, "saves", f.data.install_id, path.basename(f.source))), f.sha256);
      }
      for (const c of raw.cells.filter(c => c.status === "PASS")) {
        const files = raw.nativeSaves.filter(f => f.cell === c.name); assert.equal(files.length, 4);
        const capacity = files.find(f => f.data.slot === 4); assert(capacity);
        assert.deepEqual(capacity.data.nvl_page.map(n => n.text), s.fixture.capacityTexts);
        for (const saved of c.saved) {
          const f = files.find(f => f.data.save_id === saved.saveId); assert(f);
          assert.equal(f.data.dialog_page_index, 1); assert.equal(f.data.dialog_page_count, saved.interior.pages);
        }
      }
      return { screenshots: raw.screenshots.length, nativeSaves: raw.nativeSaves.length,
        actualViewportEmulation: true, physical4kClaimed: false };
    });
    await group("Original directory identities/bytes restored and exact process/port cleanup", () => {
      const before = read(path.join(source, "profile-protection.json")), restored = read(s.restoration.path);
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      let originalFiles = 0;
      for (const old of before.records) {
        assert(!fs.existsSync(old.held)); const current = restored.restored.find(r => r.original === old.original); assert(current);
        assert.equal(current.directoryId, old.directoryId); assert.deepEqual(current.files, old.files);
        if (old.existed) {
          const result = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
            { windowsHide: true, encoding: "utf8", timeout: 10000 });
          assert.equal(result.status, 0); assert(result.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
        }
        for (const f of old.files) { assert.equal(sha(path.join(old.original, f.relative)), f.sha256); originalFiles++; }
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
      }
      const all = rows();
      assert(!all.some(p => raw.knownProcesses.some(k => p.ProcessId === k.ProcessId && p.Created === k.Created)));
      assert(!all.some(p => p.Name === "agentvn-player.exe" || p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
      assert.deepEqual(listeners(s.absentPorts), []);
      return { directories: before.records.length, originalFiles, ownedIdentities: raw.knownProcesses.length,
        portsAbsent: s.absentPorts, normalCloseClaimed: false, deletedUserFiles: 0 };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    report.coverageTool = desc(path.join(__dirname, "lib/narrative-coverage.cjs"));
    fs.copyFileSync(report.coverageTool.path, path.join(out, "executed-coverage.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, sourceConclusion: report.sourceConclusion,
      coverageComplete: report.coverageComplete, out,
      groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }));
  }
}
module.exports = { validateTerminal };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
