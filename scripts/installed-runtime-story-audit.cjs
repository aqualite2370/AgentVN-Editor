"use strict";
// Independent evidence audit. Never launches or alters a product.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateCartridge } = require("./installed-runtime-story-export-1922.cjs");
const { validateResume } = require("./lib/runtime-story-observer.cjs");
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p) });
function validate(r, flows, cross) {
  assert(["PASS", "FAILED"].includes(r.status) && r.finishedAt);
  assert(!r.cleanupError);
  if (r.observerError) {
    assert.equal(r.status, "FAILED");
    assert.match(r.observerError, /paths\[0\].*string.*null/s);
    assert.match(r.observerError, /at observe /);
  }
  for (const k of ["productChanges", "builds", "modelRequests"]) assert.equal(r[k], 0);
  assert.equal(r.normalCloseClaimed, false);
  assert.equal(r.scope, "ACTUAL_1922_INSTALLED_SHIPPED_LIBRARY_CURRENT_UI_EXPORT_COMPLETE_STORY_MATRIX");
  assert.equal(r.executable.sha256, "a6930452f451e1ef194b46ac4c4718479d66a33667277cb0ee52db0c2203db59");
  assert.equal(r.cells.length, flows.length);
  assert(flows.length > 0);
  assert.equal(new Set(r.cells.map(c => c.name)).size, r.cells.length);
  assert.equal(r.commands[0].label, "profile-prepare");
  assert.equal(r.commands.at(-1).label, "profile-restore");
  assert(r.commands.every(c => c.finishedAt && ["PASS", "FAILED"].includes(c.status)));
  assert.equal(r.commands.at(-1).exitCode, 0);
  const recordedPorts = [...flows, ...(cross ? [cross] : [])]
    .flatMap(f => f.launches.map(l => l.cdpPort));
  assert.deepEqual(r.absentPorts, recordedPorts);
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i], cell = r.cells[i];
    assert(f.finishedAt && !f.cleanupError);
    assert.equal(cell.status, f.status);
    assert.equal(f.exe.sha256, r.executable.sha256);
    assert.equal(f.source.sha256, r.originalExport.sha256);
    assert.equal(f.productChanges, 0); assert.equal(f.realModelRequests, 0);
    assert.deepEqual(f.pageErrors, []);
    assert.equal(f.scope,
      "ACTUAL_1922_SHIPPED_PLAYER_LIBRARY_FRESH_CURRENT_UI_EXPORT_CONTROLLED_LIBRARY_IMPORT_NOT_STANDALONE");
    assert(f.launches.length > 0 && f.launches.every(l => l.cleanup?.status === "PASS"));
    const storage = r.physicalRoaming ? "CODEX_EXPLICIT_PHYSICAL_ROAMING_LIBRARY_LOCAL_JUNCTION"
      : "CODEX_EXPLICIT_PROFILE_JUNCTION_LIBRARY";
    assert(f.launches.every(l => l.libraryStorage === storage));
    assert.equal(f.matrix.length, 2);
    assert.deepEqual(f.matrix.map(m => m.layout), ["agentvn", "renpy"]);
    for (const m of f.matrix) {
      assert.equal(m.status, "PASS");
      for (const k of ["width", "height", "dpr", "reduced"]) assert.equal(m[k], cell[k]);
      assert.equal(m.controls.length, m.layout === "renpy" ? 9 : 1);
      assert(m.controls.every(b => b.hit && b.x >= -1 && b.y >= -1 &&
        b.right <= m.width + 1 && b.bottom <= m.height + 1));
    }
    if (r.status === "PASS") {
      assert.equal(f.status, "PASS"); assert.equal(f.checks.length, 15);
      assert(f.checks.every(c => c.status === "PASS"));
    }
  }
  if (r.status === "PASS") {
    assert.equal(r.commands.length, flows.length + 3);
    assert(r.commands.every(c => c.status === "PASS" && c.exitCode === 0));
    const expected = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
    assert.deepEqual(r.cells.map(({ width, height, dpr, reduced }) =>
      ({ width, height, dpr, reduced })), expected);
    assert(cross && cross.finishedAt && cross.status === "PASS" && !cross.cleanupError);
    assert.equal(cross.exe.sha256, r.executable.sha256);
    assert.equal(cross.source.sha256, r.originalExport.sha256);
    assert.deepEqual(cross.matrix, flows.flatMap(f => f.matrix));
    assert.equal(cross.checks.length, 1); assert.equal(cross.checks[0].status, "PASS");
    assert.deepEqual(cross.pageErrors, []);
    assert(cross.launches.every(l => l.cleanup?.status === "PASS"));
    const d = cross.checks[0].detail;
    assert(d.realPlayerRestart && !d.nativePickerClaim &&
      !d.standaloneExeSaveLocationClaim && !d.storage.portable);
    assert.equal(d.before.filter(s => s.save_kind === "quick").length, 6);
    assert.equal(d.before.filter(s => (s.save_kind || "manual") === "manual").length, 2);
    assert(d.files.length >= 8);
  } else assert(r.error && (flows.some(f => f.status === "FAILED") || r.observerError));
}
async function main() {
  const [attempt, audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const source = `F:/AgentVN/QA/Native-Runtime-State-20261020-01/installed-story-1922-${attempt}`;
  const out = `${source}-audit-${audit}`;
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", groups: [], startedAt: new Date().toISOString(),
    productChanges: 0, modelRequests: 0, launches: 0, scope: "EVIDENCE_AUDIT_NOT_NEW_BUSINESS_EXECUTION" };
  async function group(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g);
    try { g.detail = await fn(); g.status = "PASS"; }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; }
  }
  try {
    report.source = desc(path.join(source, "session.json"));
    const r = read(report.source.path), flows = r.cells.map(c => read(c.report.path));
    const cross = r.crossLayout ? read(r.crossLayout.path) : null;
    report.businessStatus = r.status;
    await group("Terminal completeness, exact scope and hostile evidence rejection", () => {
      validate(r, flows, cross);
      const invalid = [
        a => { a[0].status = "RUNNING"; }, a => { a[0].finishedAt = null; },
        a => { a[0].cleanupError = "missing"; }, a => { a[0].normalCloseClaimed = true; },
        a => { a[0].productChanges = 1; }, a => { a[0].modelRequests = 1; },
        a => { a[0].cells = []; }, a => { a[0].executable.sha256 = "wrong"; },
        a => { a[1][0].matrix = []; }, a => { a[1][0].matrix[0].dpr = 4; },
        a => { a[1][0].matrix[1] = a[1][0].matrix[0]; },
        a => { a[1][0].launches[0].cleanup.status = "RUNNING"; },
        a => { a[1][0].pageErrors.push("error"); },
        a => { a[1][0].launches[0].libraryStorage = "PHYSICAL_DEFAULT_PATH"; },
      ];
      if (r.status === "PASS") invalid.push(
        a => { a[1][0].checks.pop(); },
        a => { a[1][0].checks[0].status = "FAILED"; },
        a => { a[2].checks[0].detail.files = []; },
        a => { a[2].checks[0].detail.nativePickerClaim = true; },
        a => { a[0].cells.pop(); a[1].pop(); });
      else invalid.push(a => { a[0].status = "PASS"; });
      for (const mutate of invalid) {
        const args = structuredClone([r, flows, cross]); mutate(args);
        assert.throws(() => validate(...args));
      }
      return { businessStatus: r.status, cells: flows.length,
        checks: flows.reduce((n, f) => n + f.checks.length, 0) + (cross?.checks.length || 0),
        rejectedVariants: invalid.length };
    });
    await group("Current UI exports, complete script and actual sprite dependencies", async () => {
      for (const f of [r.checkpoint, r.installation, r.originalExport, r.executable,
        ...r.protectedProducts, ...r.cartridges, ...r.cells.map(c => c.report),
        ...(r.crossLayout ? [r.crossLayout] : [])]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of r.tools) assert.equal(sha(f.copy), f.sha256, f.copy);
      const runner = r.tools.find(f => f.path.endsWith("installed-runtime-abilities-playwright.cjs"));
      assert(runner);
      for (const f of [...flows, ...(cross ? [cross] : [])])
        assert.equal(f.runnerAtInvocation.sha256, runner.sha256);
      if (r.reusedCells) {
        assert.equal(sha(r.reusedCells.source.path), r.reusedCells.source.sha256);
        const prior = read(r.reusedCells.source.path);
        assert.equal(validateResume(prior, r), r.reusedCells.count);
        assert.equal(r.reusedCells.businessOnly, true);
        assert.equal(r.reusedCells.rerunCompletedCells, false);
        for (let i = 0; i < prior.cells.length; i++)
          assert.deepEqual(r.cells[i], { ...prior.cells[i], reusedFrom: r.reusedCells.source });
        assert.equal(sha(prior.restoration.path), prior.restoration.sha256);
        assert.equal(read(prior.restoration.path).status, "PASS");
      }
      const exported = read(r.originalExport.path);
      assert.equal(exported.status, "PASS"); assert.equal(exported.steps.length, 3);
      assert(exported.steps.every(s => s.status === "PASS"));
      assert.equal(exported.cartridges.length, 2);
      assert.equal(exported.cleanups.length, 1); assert.equal(exported.cleanups[0].status, "PASS");
      assert.equal(read(exported.restoration.path).status, "PASS");
      assert.equal(sha(exported.restoration.path), exported.restoration.sha256);
      if (exported.reusedAgentvn) {
        const inherited = exported.reusedAgentvn.source;
        assert.equal(sha(inherited.path), inherited.sha256);
        const prior = read(inherited.path);
        assert.equal(prior.status, "FAILED");
        assert.equal(exported.reusedAgentvn.newAgentvnExports, 0);
        assert.equal(prior.cartridges.length, 1);
        assert.deepEqual(prior.cartridges[0], exported.cartridges[0]);
        assert(prior.cleanups.every(c => c.status === "PASS") && !prior.cleanupError);
        assert.equal(sha(prior.restoration.path), prior.restoration.sha256);
        assert.equal(read(prior.restoration.path).status, "PASS");
      }
      assert.equal(exported.fixture.inputSha256, sha(exported.fixture.input));
      for (const c of exported.cartridges)
        assert.deepEqual(await validateCartridge(c.path, exported.fixture, c.layout), c);
      assert.equal(exported.cartridges[0].scriptSha256, exported.cartridges[1].scriptSha256);
      const events = [...exported.downloadEvents, ...(exported.inheritedDownloadEvents || [])];
      assert.equal(events.filter(e => e.type === "begin").length, 2);
      for (const c of exported.cartridges) {
        assert(events.some(e => e.state === "completed" && e.totalBytes === c.bytes &&
          e.receivedBytes === c.bytes && path.resolve(e.filePath) === path.resolve(c.path)));
      }
      return { actualExports: 2, sameScript: true, spriteBytes: true };
    });
    await group("Exact text pagination, readable floor, inheritance and save/rollback business states", () => {
      let testedLayouts = 0;
      for (const f of flows) for (const layout of ["agentvn", "renpy"]) {
        const items = f.checks.filter(c => c.layout === layout);
        const find = prefix => items.find(c => c.name.startsWith(prefix));
        const ordinary = find("Explicit ordinary");
        assert.equal(ordinary.status, "PASS"); assert.equal(ordinary.detail.mode, "dialog");
        assert.equal(ordinary.detail.fontMode, "configured");
        for (const [prefix, text] of [["Long ordinary", r.fixture.text.mid],
          ["Extreme ordinary", r.fixture.text.extreme]]) {
          const result = find(prefix); assert.equal(result.status, "PASS");
          const d = result.detail;
          assert.equal(d.geometry.length, d.pages);
          assert.equal(d.geometry.map(p => p.text).join(""), text);
          if (d.pages > 1) {
            assert.equal(d.fontMode, "adaptive");
            assert(Math.abs(d.font - Math.min(ordinary.detail.font, 12)) < 0.1);
          }
          for (let i = 0; i < d.geometry.length; i++) {
            const p = d.geometry[i]; assert.equal(p.page, i + 1);
            assert(p.scroll.actual <= p.scroll.client + 2);
            assert(p.scroll.actualWidth <= p.scroll.width + 1);
            assert(p.rect.x >= -1 && p.rect.y >= -1 &&
              p.rect.right <= f.businessViewport.width + 1 &&
              p.rect.bottom <= f.businessViewport.height + 1);
          }
        }
        if (find("NVL inheritance")?.status !== "PASS") continue;
        const nvl = find("NVL inheritance").detail;
        assert.equal(nvl.before.nvl.length, 3);
        assert.deepEqual(nvl.restored.nvl, nvl.before.nvl);
        assert.equal(nvl.stored.nvl_page.length, 3);
        assert.deepEqual(nvl.stored.nvl_page.map(v => v.command_index), [3, 4, 5]);
        for (let i = 0; i < 3; i++)
          assert(nvl.before.nvl[i].includes(nvl.stored.nvl_page[i].text));
        assert.equal(nvl.stored.nvl_presentation_mode, "nvl");
        assert(nvl.noAudioFixture && !nvl.voiceReplayClaim);
        const bubble = find("Bubble follows").detail;
        assert.equal(bubble.left.anchor, "character");
        assert(bubble.moved.rect.x > bubble.left.rect.x);
        assert.equal(bubble.absent.anchor, "fallback");
        assert.equal(bubble.fixed.anchor, "fixed");
        assert.equal(bubble.stored.nvl_presentation_mode, "bubble");
        assert.equal(bubble.long.geometry.map(p => p.text).join(""), r.fixture.text.bubbleLong);
        if (layout === "renpy") {
          const q = find("Real quick-save").detail;
          assert.equal(q.writes.length, 7); assert.equal(q.retained.length, 6);
          assert.deepEqual(q.retained.map(s => s.command_index).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
          assert(q.manualUnchanged && q.sixSlotsPerPage);
          assert.equal(q.cancelPreservesCommand, 7); assert.equal(q.loadedCommand, 6);
          for (const k of ["invalidLatestFallback", "quickWriteFailure", "concurrentSubmission"])
            assert.equal(q[k], "NOT_RUN");
        }
        testedLayouts++;
      }
      return { completedLayoutFlows: testedLayouts,
        missing: ["voice fixture/playback replay", "NVL full-capacity choice layout",
          "quick invalid-latest/failure/concurrent submission", "standalone/setup/Android"] };
    });
    await group("Actual PNG pixels, native save snapshots and cross-layout bytes", () => {
      const all = [...flows, ...(cross ? [cross] : [])]; let images = 0, saves = 0;
      for (const f of all) {
        for (const s of f.screenshots) {
          assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
          const png = fs.readFileSync(s.path), dpr = Math.round(s.before.dpr);
          assert([1, 2].includes(dpr) && Math.abs(s.before.dpr - dpr) <= 1e-6);
          assert.equal(png.readUInt32BE(16), s.before.width * dpr);
          assert.equal(png.readUInt32BE(20), s.before.height * dpr); images++;
        }
        for (const s of f.nativeSaves) {
          assert.equal(sha(s.retained), s.sha256);
          assert.equal(fs.statSync(s.retained).size, s.bytes);
          const data = read(s.retained);
          assert.equal(data.save_id, s.saveId); assert.equal(data.install_id, f.installId);
          saves++;
        }
      }
      if (cross) for (const s of cross.checks[0].detail.files) {
        assert.equal(sha(s.retained), s.sha256);
        assert.deepEqual(read(s.retained), s.data);
      }
      assert(images > 0);
      return { images, nativeSnapshots: saves, physical4kClaimed: false };
    });
    await group("Original directory identities and bytes restored; owned processes/ports absent", () => {
      assert.equal(sha(r.restoration.path), r.restoration.sha256);
      const journal = read(path.join(source, "profile-protection.json"));
      const restored = read(r.restoration.path); assert.equal(restored.status, "PASS");
      assert.equal(restored.deletedUserFiles, 0);
      for (const old of journal.records) {
        const now = restored.restored.find(v => v.original === old.original); assert(now);
        assert.equal(now.directoryId, old.directoryId); assert.deepEqual(now.files, old.files);
        assert(!fs.existsSync(old.held));
        if (old.existed) {
          const id = spawnSync("fsutil.exe", ["file", "queryfileid", old.original],
            { encoding: "utf8", windowsHide: true, timeout: 10000 });
          assert.equal(id.status, 0, id.stderr);
          assert(id.stdout.toLowerCase().includes(old.directoryId.toLowerCase()));
          assert(!fs.lstatSync(old.original).isSymbolicLink());
        }
        if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
        for (const f of old.files) assert.equal(sha(path.join(old.original, f.relative)), f.sha256);
      }
      const active = rows();
      for (const p of r.knownProcesses)
        assert(!active.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
      assert(!active.some(p => /^(agentvn-player|agentvn-editor)\.exe$/.test(p.Name) ||
        p.Name === "msedgewebview2.exe" && (p.CommandLine || "").includes(source)));
      assert.deepEqual(listeners(r.absentPorts), []);
      return { originalDirectories: journal.records.length, processes: r.knownProcesses.length,
        absentPorts: r.absentPorts, normalCloseClaimed: false, userFilesDeleted: 0 };
    });
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.tool = desc(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, businessStatus: report.businessStatus,
      out, groups: report.groups.map(g => ({ name: g.name, status: g.status })), error: report.error }));
  }
}
module.exports = { validate };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
