"use strict";
// Read-only provenance, persistence, native-picker and actual Player audit.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const current = require("./current-control-closure.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f) });
const checked = f => { assert.equal(sha(f.path), f.sha256, f.path); return f; };
const displayKey = d => `${d.width}/${d.height}/${d.dpr}/${d.reduced}`;
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
function pngs(shots) {
  assert(shots.length); assert.equal(new Set(shots.map(s => s.path)).size, shots.length);
  for (const s of shots) {
    checked(s); assert.deepEqual(s.before, s.after);
    const d = matrix.find(d => d.width === s.before.width && d.height === s.before.height &&
      d.reduced === s.before.reduced && Math.abs(d.dpr - s.before.dpr) < 1e-6); assert(d);
    const png = fs.readFileSync(s.path);
    assert.equal(png.readUInt32BE(16), d.width * d.dpr);
    assert.equal(png.readUInt32BE(20), d.height * d.dpr);
  }
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = current.qa + "/closure-audit-" + attempt + ".json"; assert(!fs.existsSync(out));
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), groups: [],
    productStarts: 0, productChanges: 0, modelRequests: 0, builds: 0 };
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    const author = read(current.authorRoot + "/report.json");
    const authorAudit = read(current.auditRoot + "/report.json");
    const roundtrip = read(current.roundtripRoot + "/report.json");
    const player = read(current.playerRoot + "/report.json");
    await group("Same genuine candidate and reproducible adapters, historical sources unchanged", () => {
      const installed = descriptor(), receipt = read(current.receipt);
      assert.deepEqual(receipt.executable, installed.executable);
      assert.deepEqual(receipt.actualInstallation, installed.actualInstallation);
      assert.deepEqual(receipt.resources, installed.resources);
      for (const r of [author, roundtrip]) assert.equal(path.resolve(r.installation), path.resolve(current.receipt));
      assert.equal(path.resolve(player.installation.path), path.resolve(current.receipt));
      assert.equal(player.installation.sha256, sha(current.receipt));
      assert.equal(player.executable.sha256, installed.resources.find(f => path.basename(f.path) === "agentvn-player.exe").sha256);
      for (const mode of Object.keys(current.files)) {
        const root = current.qa + "/" + mode + "-preparation", b = read(root + "/binding.json");
        for (const f of [b.original, b.executed, b.adapter]) checked(f);
        assert.equal(sha(root + "/frozen-adapter.cjs"), b.adapter.sha256);
        const source = fs.readFileSync(b.original.path, "utf8"), result = current.build(mode, source);
        assert.equal(fs.readFileSync(b.executed.path, "utf8"), result.source);
        assert.deepEqual(result.edits, b.edits);
      }
      return { candidate: installed.executable, adapters: 4, sourceResultsInherited: false };
    });
    await group("Complete ordinary/code authoring, actual restart and independent author audit", () => {
      assert.equal(author.status, "PASS"); assert.equal(authorAudit.status, "PASS");
      assert.equal(authorAudit.groups.length, 3); assert(authorAudit.groups.every(g => g.status === "PASS"));
      assert.equal(authorAudit.input.sha256, sha(current.authorRoot + "/report.json"));
      assert.deepEqual(author.cases.map(c => displayKey(c.display)), matrix.map(displayKey));
      assert(author.cases.every(c => c.status === "PASS" && c.checks.length === 6 &&
        c.checks.every(k => k.status === "PASS")));
      assert.equal(author.restart.status, "PASS"); assert.equal(author.launches.length, 2);
      pngs(author.screenshots); assert.equal(author.screenshots.length, 12);
      return { displays: 12, businessChecks: 72, editorStarts: 2, pngs: 12 };
    });
    await group("Native package, fresh database native reimport, real UI export and resource bytes", async () => {
      assert.equal(roundtrip.status, "PASS"); assert.equal(roundtrip.cases.length, 4);
      assert(roundtrip.cases.every(c => c.status === "PASS" && c.finishedAt));
      checked(roundtrip.priorAuthor); checked(roundtrip.priorAudit); checked(roundtrip.input);
      checked(roundtrip.portable); checked(roundtrip.cartridge);
      assert.equal(roundtrip.portable.nativeCleanupStatus, "REMOVED_AFTER_HASH_IDENTICAL_ARCHIVE_AND_UI_REIMPORT");
      assert(!fs.existsSync(roundtrip.portable.originalNativePath));
      checked(roundtrip.nativePickerCompletion);
      const picker = read(roundtrip.nativePickerCompletion.path); assert.equal(picker.status, "PASS");
      assert.equal(picker.method, "Windows UI Automation");
      assert.equal(path.resolve(picker.directory), path.resolve(roundtrip.portable.path));
      assert.equal(picker.ownerPid, roundtrip.launches[1].pid);
      assert.notEqual(roundtrip.launches[0].data, roundtrip.launches[1].data);
      assert.equal(path.basename(path.dirname(roundtrip.launches[1].data)), "fresh-profile");
      const JSZip = require("../editor/node_modules/jszip");
      const zip = await JSZip.loadAsync(fs.readFileSync(roundtrip.cartridge.path), { checkCRC32: true });
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      assert.equal(layout.layout_type, "renpy"); assert.equal(layout.advancedPresentationEnabled, true);
      for (const id of ["title_start_button", "title_about_button"]) {
        const find = l => l.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === id);
        assert.deepEqual(find(layout).presentation, find(roundtrip.profiles.profiles.renpy).presentation);
      }
      const bytes = await zip.file(roundtrip.cartridge.image.path).async("nodebuffer");
      assert.equal(require("node:crypto").createHash("sha256").update(bytes).digest("hex"), roundtrip.cartridge.image.sha256);
      pngs(roundtrip.screenshots);
      return { stages: 4, freshNativeOpen: true, picker: roundtrip.nativePickerCompletion.method,
        portable: describe(roundtrip.portable.path), cartridge: describe(roundtrip.cartridge.path) };
    });
    await group("Actual exported Player controls, retained actions and complete display matrix", () => {
      assert.equal(player.status, "PASS"); assert(player.finishedAt && !player.error && !player.cleanupError);
      assert.deepEqual(player.cells.map(displayKey), matrix.map(displayKey));
      assert.equal(player.cells.length, 12);
      for (const c of player.cells) {
        assert.equal(c.status, "PASS"); assert(c.aboutAction.actualAbout && c.aboutAction.returned);
        for (const button of [c.start, c.about]) {
          assert.equal(button.tag, "BUTTON"); assert.equal(button.slotCount, "1");
          assert(button.hit && !button.disabled && !button.inert && button.overflow <= 1);
          assert.equal(button.radius, `${6 * Math.min(c.width / 1280, c.height / 720)}px`);
        }
        assert.equal(c.start.color, "rgb(127, 54, 100)"); assert.equal(c.about.color, "rgb(49, 91, 114)");
        assert.equal(c.start.images[0].sha256, roundtrip.cartridge.image.sha256);
      }
      assert.equal(player.story.actualStartAction, true);
      assert(player.story.text.includes("本轮独立 UI 验收"));
      assert.deepEqual(player.pageErrors, []); pngs(player.screenshots);
      return { playerDisplays: 12, buttonChecks: 24, aboutRoundtrips: 12, realStoryStart: true,
        pngs: player.screenshots.length };
    });
    await group("Original caches/profiles restored, downloads removed, processes and ports absent", () => {
      const active = rows(); let identities = 0, ports = [];
      for (const r of [author, roundtrip]) {
        assert.equal(r.nativeCacheRestoration, "PASS"); assert.deepEqual(r.errors, []);
        assert(r.finishedAt && !r.cleanupError && !r.error);
        assert(r.cleanups.length && r.cleanups.every(c => c.status === "PASS"));
        ports.push(...r.cleanups.flatMap(c => c.ports)); identities += r.knownProcesses.length;
        assert(!active.some(p => r.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
        const original = read(path.dirname(r.fixture?.path || r.input.path) + "/native-cache-protection.json");
        assert(!fs.existsSync(original.held));
        for (const f of original.files) assert.equal(sha(path.join(original.original, f.relative)), f.sha256);
      }
      assert.equal(player.profileRestored, true);
      const restored = read(current.playerRoot + "/profile-restoration.json");
      assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
      for (const row of restored.restored) for (const f of row.files)
        assert.equal(sha(path.join(row.original, f.relative)), f.sha256);
      assert(player.cleanups.every(c => c.status === "PASS")); ports.push(...player.cleanups.map(c => c.port));
      assert(!active.some(p => player.knownProcesses.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
      identities += player.knownProcesses.length; assert.deepEqual(listeners(ports), []);
      assert(!active.some(p => /^(agentvn-editor|agentvn-player|creator-backend)\.exe$/i.test(p.Name)));
      return { identities, absentPorts: ports.length, newModelCalls: 0, normalCloseClaimed: false };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = describe(__filename);
    fs.copyFileSync(__filename, current.qa + "/executed-closure-audit-" + attempt + ".cjs", fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(out, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, groups: report.groups.map(g =>
      ({ name: g.name, status: g.status })), error: report.error, out }));
  }
}
if (require.main === module) main();
