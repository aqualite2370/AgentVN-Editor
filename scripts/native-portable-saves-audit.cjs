"use strict";
// Read-only evidence verification, not an Editor export or installation test.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const scope = "ASSEMBLED_CURRENT_NATIVE_FIXED_GAME_FIXTURE_NOT_EDITOR_EXPORT_SETUP_UPGRADE_OR_ANDROID";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function sameFiles(a, b) {
  assert.deepEqual(a.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
    b.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })));
}
function validatePortableReport(r, smoke) {
  assert.equal(r.status, "PASS"); assert.equal(r.error, null); assert.equal(r.cleanupError, null);
  assert.equal(r.scope, scope); assert.equal(r.smoke, smoke);
  assert(["agentvn", "renpy"].includes(r.layout));
  for (const k of ["productChanges", "builds", "modelRequests"]) assert.equal(r[k], 0);
  assert.deepEqual(r.pageErrors, []);
  assert.equal(r.checks.length, smoke ? 1 : 5); assert(r.checks.every(c => c.status === "PASS"));
  assert.equal(r.launches.length, smoke ? 1 : 2); assert.equal(r.screenshots.length, smoke ? 1 : 17);
  for (const l of r.launches) {
    assert.equal(l.mode, "fixed"); assert.equal(l.launchConfig.mode, "fixed"); assert.equal(l.storage.portable, true);
    assert.equal(l.scope, scope); assert(l.identity && l.fixtureTitle);
    assert.equal(l.cleanup.status, "PASS");
    assert.equal(l.cleanup.method, "ATTRIBUTED_TERMINATION_NOT_NORMAL_CLOSE");
    assert.equal(path.resolve(l.identity.ExecutablePath), path.resolve(l.exe));
  }
  assert.equal(r.finalTarget.length, smoke ? 1 : 6);
  assert.deepEqual(r.finalTarget.map(f => f.name), smoke ? ["slot-01.json"] :
    ["auto-01.json", "quick-06.json", "slot-01.json", "slot-02.json", "slot-05.json", "slot-06.json"]);
  const first = r.checks[0].detail;
  assert(first.storage.portable && first.sourceCreated === false);
  assert.equal(first.manual.command_index, 0); assert.equal(first.manual.save_kind, "manual");
  assert.equal(first.manual.install_id, "preview_gamecli"); assert.equal(first.files.length, 1);
  assert.equal(r.matrix.length, smoke ? 0 : 12); assert.equal(r.acls.length, smoke ? 0 : 2);
  assert.equal(r.finalLegacy.length, smoke ? 0 : 6);
  if (!smoke) {
    const expected = [[1920, 1080], [2560, 1440], [3840, 2160]].flatMap(([width, height]) =>
      [1, 2].flatMap(dpr => [false, true].map(reduced => ({ width, height, dpr, reduced }))));
    assert.deepEqual(r.matrix.map(({ width, height, dpr, reduced }) => ({ width, height, dpr, reduced })), expected);
    for (const m of r.matrix) {
      assert.equal(m.status, "PASS"); const g = m.geometry;
      assert(g.focusInside && !g.clipped && g.overflow <= 1);
      assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= m.width + 1 && g.rect.bottom <= m.height + 1);
      assert(g.controls.length >= 3 && g.controls.every(c => c.hit && !c.disabled));
      for (const c of g.controls) assert(c.rect.x >= g.rect.x - 1 && c.rect.y >= g.rect.y - 1
        && c.rect.right <= g.rect.right + 1 && c.rect.bottom <= g.rect.bottom + 1);
      for (let i = 0; i < g.controls.length; i++) for (let j = i + 1; j < g.controls.length; j++) {
        const a = g.controls[i].rect, b = g.controls[j].rect;
        assert(!(Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
          && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1));
      }
    }
    const scan = r.checks[1].detail, denied = r.checks[3].detail, restart = r.checks[4].detail;
    sameFiles(scan.before, scan.after); sameFiles(scan.before, r.targetBeforeMigration);
    assert.deepEqual(scan.info.availableFiles, ["auto-01.json", "quick-06.json", "slot-02.json"]);
    assert.deepEqual(scan.info.conflictFiles, ["slot-01.json"]);
    assert.deepEqual(scan.info.skippedFiles, ["slot-03.json", "slot-04.json"]);
    sameFiles(r.legacySeed, r.finalLegacy); sameFiles(scan.legacy, r.legacySeed);
    const block = r.acls[0], restore = r.acls[1];
    assert.equal(block.action, "Block"); assert.equal(block.data.status, "WRITE_DENIED");
    assert.equal(block.data.isElevated, false); assert.equal(block.data.probe.allowed, false);
    assert(block.data.probe.accessDenied); assert.equal(block.data.probe.hresult, -2147024891);
    assert.equal(restore.action, "Restore"); assert.equal(restore.data.status, "RESTORED");
    const comparison = restore.data.comparison;
    assert(comparison.permissionsMatch && comparison.daclBytesMatch && comparison.ownerGroupMatch
      && comparison.allOtherFlagsMatch && restore.data.probe.allowed);
    assert.deepEqual(denied.blocked, block.data); assert.deepEqual(denied.restored, restore.data);
    assert(denied.manualFailure.includes("不会回退") && denied.manualFailure.includes(block.data.target));
    assert(denied.message.includes("不会回退") && denied.message.includes(block.data.target));
    assert.equal(denied.afterMigration.length, 5); assert.equal(denied.after.length, 6);
    assert.equal(denied.manualRetry.command_index, 1); assert.equal(denied.manualRetry.slot, 6);
    assert(denied.notice.includes("已复制 3 个旧存档") && denied.notice.includes("1 个冲突")
      && denied.notice.includes("源存档保留"));
    sameFiles(denied.after, r.finalTarget); sameFiles(restart.files, r.finalTarget);
    for (const old of scan.before)
      assert(r.finalTarget.some(f => f.name === old.name && f.sha256 === old.sha256));
    for (const name of ["auto-01.json", "quick-06.json", "slot-02.json"])
      assert.equal(r.finalTarget.find(f => f.name === name).sha256, r.legacySeed.find(f => f.name === name).sha256);
    assert(restart.actualNewProcess); assert.deepEqual(restart.restored, { scene: "ordinary_nvl", command: 1 });
    assert.notEqual(r.launches[0].identity.CreationDate, r.launches[1].identity.CreationDate);
  }
  for (const name of ["Editor export/UI output selector", "Setup installation or upgrade", "Old binary upgrade",
    "Android", "Physical Alt+F4"]) assert(r.notRun.includes(name));
}
async function main() {
  const name = process.argv[2] || "portable-audit-01"; assert(/^portable-audit-\d{2}$/.test(name));
  const out = path.join(base, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_ASSEMBLED_PORTABLE_FIXTURE_EVIDENCE_NOT_EXPORT_INSTALL_UPGRADE_ANDROID",
    productChanges: 0, builds: 0, installs: 0, modelRequests: 0 };
  async function check(name, fn) {
    const row = { name, status: "RUNNING" }; report.checks.push(row);
    try { row.detail = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  }
  try {
    const runs = ["portable-03", "portable-04", "portable-05"].map(name => {
      const dir = path.join(base, name);
      return { name, dir, raw: read(path.join(dir, "portable.json")), session: read(path.join(dir, "session.json")),
        prep: read(path.join(dir, "preparation.json")), journal: read(path.join(dir, "profile-protection.json")) };
    });
    await check("One smoke plus both complete layout flows, exact modal matrix and native ownership", () => {
      for (const [i, r] of runs.entries()) validatePortableReport(r.raw, i === 0);
      assert.deepEqual(runs.map(r => r.raw.layout), ["agentvn", "agentvn", "renpy"]);
      return { smokeChecks: 1, fullChecks: 10, modalCombinations: 24, launches: 5,
        businessViewport: "1920x1080 DPR1 ordinary; modal geometry separately has 12 combinations per layout" };
    });
    await check("Unchanged EXE, full embedded/cartridge bytes, QA snapshots, captured DPR and PNG pixels", async () => {
      for (const [i, r] of runs.entries()) {
        assert.equal(r.session.status, i === 0 ? "CURRENT_NATIVE_PORTABLE_SMOKE_PASS" :
          "CURRENT_NATIVE_PORTABLE_SAVE_MIGRATION_PASS");
        assert.equal(r.session.commands.length, i === 0 ? 3 : 4);
        assert(r.session.commands.every(c => c.status === "PASS" && c.exitCode === 0 && c.finishedAt));
        if (i) assert(r.session.commands[2].log.endsWith("profile-process-guard.log"));
        for (const f of [...r.session.products, ...r.session.tools, r.session.profileRestoration,
          r.prep.executable, r.prep.fixture && { path: r.prep.fixture.input, sha256: r.prep.fixture.inputSha256 },
          ...r.prep.cartridges, ...r.prep.resources, r.prep.source, r.raw.source, ...r.raw.acls])
          assert.equal(sha(f.path), f.sha256, f.path);
        assert.equal(r.prep.sourceExecutable.sha256, r.session.products[2].sha256);
        for (const l of r.raw.launches) {
          assert.equal(l.executableSha256, r.prep.sourceExecutable.sha256);
          assert.equal(path.resolve(l.exe), path.resolve(r.prep.executable.path));
          assert.equal(path.resolve(l.storage.targetDirectory), path.resolve(r.prep.expectedTarget));
          assert.equal(path.resolve(l.storage.sourceDirectory), path.resolve(r.prep.expectedLegacy));
        }
        const zip = await JSZip.loadAsync(fs.readFileSync(r.prep.cartridges[0].path));
        const entries = Object.entries(zip.files).filter(([, entry]) => !entry.dir);
        assert.equal(entries.length, r.prep.resources.length);
        for (const [name, entry] of entries)
          assert((await entry.async("nodebuffer")).equals(fs.readFileSync(
            path.join(path.dirname(r.prep.executable.path), "embedded-cartridge", name))));
        for (const a of r.raw.acls) assert.deepEqual(read(a.path), a.data);
        for (const m of r.raw.matrix)
          assert.equal(r.raw.screenshots.filter(s => path.basename(s.path) ===
            `${r.raw.layout}-migration-${m.width}-${m.dpr}-${m.reduced}.png`).length, 1);
        for (const s of r.raw.screenshots) {
          assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
          const b = fs.readFileSync(s.path);
          assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
          assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
          assert.deepEqual(s.png, { width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
          assert([1920, 2560, 3840].includes(s.before.width));
          assert(Math.min(Math.abs(s.before.dpr - 1), Math.abs(s.before.dpr - 2)) <= 1e-6);
          const m = r.raw.matrix.find(m => path.basename(s.path) ===
            `${r.raw.layout}-migration-${m.width}-${m.dpr}-${m.reduced}.png`);
          if (m) {
            assert.equal(s.before.width, m.width); assert.equal(s.before.height, m.height);
            assert(Math.abs(s.before.dpr - m.dpr) <= 1e-6); assert.equal(s.before.reduced, m.reduced);
          }
        }
      }
      assert.equal(new Set(runs.map(r => r.prep.executable.sha256)).size, 1);
      return { pngs: 35, completeEmbeddedFilesPerRun: runs.map(r => r.prep.resources.length),
        nativeViewportEmulationNotPhysical4K: true };
    });
    await check("EXE-side save bytes, preserved conflicts, archived legacy sources and restored ACL", () => {
      for (const r of runs) {
        const archive = r.journal.records.find(j => j.storage === "NativeRoaming").target;
        const oldDir = path.join(archive, "saves", "preview_gamecli");
        assert.equal(fs.existsSync(oldDir), !r.raw.smoke);
        for (const f of r.raw.finalLegacy) assert.equal(sha(path.join(oldDir, f.name)), f.sha256);
        assert(!fs.readdirSync(r.prep.expectedTarget).some(n => n.endsWith(".tmp")));
        for (const f of r.raw.finalTarget) {
          assert.equal(sha(f.path), f.sha256); assert.equal(fs.statSync(f.path).size, f.bytes);
          const data = read(f.path);
          assert.equal(data.game_id, r.prep.gameId); assert.equal(data.install_id, "preview_gamecli");
          assert.equal(data.scene_id, "ordinary_nvl");
          assert.equal(data.command_index, f.name === "slot-01.json" ? 0 : 1);
        }
        if (r.raw.smoke) continue;
        const conflict = path.join(oldDir, "slot-01.json");
        assert.notEqual(sha(conflict), sha(path.join(r.prep.expectedTarget, "slot-01.json")));
        assert.equal(read(path.join(oldDir, "slot-03.json")).game_id, "qa_unrelated_game");
        assert.throws(() => read(path.join(oldDir, "slot-04.json")));
        const restored = read(path.join(r.dir, "portable-acl.json.restore.json"));
        assert(restored.comparison.permissionsMatch && restored.probe.allowed);
      }
      return { fullFinalSaves: 12, smokeFinalSaves: 1, archivedLegacyFiles: 12,
        copiedByteIdenticalSaves: 6, sourceFilesDeleted: 0, temporaryFiles: 0 };
    });
    await check("User profile bytes and directory identity restored; recorded roots, CDP ports and WebViews absent", () => {
      for (const r of runs) {
        const restored = read(path.join(r.dir, "profile-restoration.json"));
        assert.equal(restored.status, "PASS"); assert.equal(restored.deletedUserFiles, 0);
        for (const j of r.journal.records) {
          assert(!fs.existsSync(j.held)); if (j.storage === "NativeRoaming") assert(!fs.existsSync(j.retained));
          const actual = restored.restored.find(p => p.original === j.original); assert(actual);
          assert.equal(actual.directoryId, j.directoryId); assert.deepEqual(actual.files, j.files);
          for (const f of j.files) assert.equal(sha(path.join(j.original, f.relative)), f.sha256);
        }
      }
      const launches = runs.flatMap(r => r.raw.launches), ports = launches.map(l => l.port);
      const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        "$all=@(Get-CimInstance Win32_Process);" +
        "$p=@($all|Select-Object ProcessId,@{n='CreatedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}});" +
        "$w=@($all|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*portable-*'}|Select-Object ProcessId);" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "@{processes=$p;webviews=$w;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(ps.status, 0, ps.stderr);
      const current = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
      for (const l of launches) assert(!current.processes.some(p => p.ProcessId === l.identity.ProcessId
        && p.CreatedMs === Number(l.identity.CreationDate.match(/\d+/)[0])));
      assert.deepEqual(current.webviews, []); assert.deepEqual(current.listeners, []);
      return { recordedRoots: launches.length, ports, restoredProfileSessions: runs.length, killedByAudit: 0 };
    });
    await check("Original failures retained and frozen installation ledger unchanged", () => {
      const failures = ["portable-01", "portable-02"].map(name => {
        const file = path.join(base, name, "session.json"), old = read(file);
        assert.equal(old.status, "FAILED");
        assert.equal(read(path.join(base, name, "profile-restoration.json")).status, "PASS");
        return describe(file);
      });
      const frozen = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json");
      for (const f of frozen.artifactChecks) assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(frozen.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
      return { failures, frozenCounts: frozen.historical.counts };
    });
    await check("Evidence validator rejects empty/altered/overclaimed reports", () => {
      const file = path.resolve("scripts/native-portable-saves-audit-test.cjs"), log = path.join(out, "validator.log");
      const result = spawnSync(process.execPath, [file], { encoding: "utf8", windowsHide: true, timeout: 30000 });
      fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
      assert.ifError(result.error); assert.equal(result.status, 0, log); assert(result.stdout.includes("PASS"));
      return { command: [process.execPath, file], source: describe(file), log: describe(log), exitCode: result.status };
    });
    report.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_PORTABLE_SAVE_MIGRATION_PASS";
    report.remaining = { editorExportAndSelector: "NOT_RUN_IN_THIS_FIXTURE",
      setupAndOldBinaryUpgrade: "NOT_RUN", android: "NOT_RUN", physicalAltF4: "BLOCKED_NATIVE_PIPE",
      completeRegression: "NOT_COMPLETE" };
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.source = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, out }, null, 2));
  }
}
module.exports = { validatePortableReport };
if (require.main === module) main();
