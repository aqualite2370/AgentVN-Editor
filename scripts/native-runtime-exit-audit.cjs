"use strict";
// Evidence-only audit. Does not start/close a game, modify ACLs or user data.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const base = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function geometry(g, v, title, count) {
  assert.equal(g.title, title); assert.equal(g.count, count);
  assert(g.focusInside && g.lowerInert && !g.clipped && g.overflow <= 1);
  assert(g.rect.x >= -1 && g.rect.y >= -1 && g.rect.right <= v.width + 1 && g.rect.bottom <= v.height + 1);
  assert(g.controls.length >= 2);
  for (const c of g.controls) {
    assert(c.hit && !c.disabled && !c.inert);
    assert(c.rect.x >= g.rect.x - 1 && c.rect.y >= g.rect.y - 1
      && c.rect.right <= g.rect.right + 1 && c.rect.bottom <= g.rect.bottom + 1);
  }
  for (let i = 0; i < g.controls.length; i++) for (let j = i + 1; j < g.controls.length; j++) {
    const a = g.controls[i].rect, b = g.controls[j].rect;
    assert(!(Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1));
  }
}
function validateExitReport(r, smoke) {
  assert.equal(r.status, "PASS"); assert.equal(r.error, null); assert.equal(r.cleanupError, null);
  assert.equal(r.scope, "CURRENT_NATIVE_LIBRARY_UI_EXIT_NOT_INSTALL_ALT_F4_ANDROID");
  for (const key of ["productChanges", "modelRequests", "builds"]) assert.equal(r[key], 0);
  assert.deepEqual(r.pageErrors, []);
  const kinds = smoke ? ["retry", "auto_off"] : ["retry", "discard", "auto_on", "auto_off"];
  assert.deepEqual(r.cases.map(c => [c.layout, c.kind]),
    ["agentvn", "renpy"].flatMap(l => kinds.map(k => [l, k])));
  assert.equal(r.expectedCases, kinds.length * 2);
  assert.equal(r.checks.length, smoke ? 16 : 30);
  assert(r.checks.every(c => c.status === "PASS"));
  assert.equal(r.launches.length, r.cases.length * 2);
  assert.equal(r.launches.filter(l => l.cleanup.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY").length, r.cases.length);
  assert(r.launches.every(l => l.cleanup.status === "PASS" && l.scope === "CURRENT_NATIVE_NOT_RELEASE_INSTALL"));
  assert.equal(r.acls.length, smoke ? 4 : 8);
  assert.equal(r.retained.length, smoke ? 6 : 12);
  assert.equal(r.screenshots.length, smoke ? 8 : 36);
  for (const c of r.cases) {
    assert.equal(c.status, "PASS"); assert(c.finishedAt);
    const checks = r.checks.filter(t => t.layout === c.layout && t.case === c.kind);
    assert.equal(checks.length, c.kind === "retry" ? 5 : c.kind === "discard" ? 4 : 3);
    const b = c.before;
    assert.deepEqual(checks[0].detail, b);
    assert.deepEqual(b.settingsEscapePath, c.layout === "agentvn" ? ["main_menu", "playing"] : ["playing"]);
    assert(b.titleExitContract && b.escapeMenuAndSettingsRestore);
    assert.equal(b.files.length, 1); assert.equal(b.manual.save_kind, "manual"); assert.equal(b.manual.command_index, 0);
    assert.equal(b.story.scene, "ordinary_nvl"); assert.equal(b.story.command, 1);
    assert.equal(b.autoSaveEnabled, c.kind !== "auto_off");
    const exit = checks.at(-2).detail, restart = checks.at(-1).detail;
    assert.equal(exit.exitCode, 0); assert.equal(exit.signalCode, null);
    const saves = ["retry", "auto_on"].includes(c.kind);
    assert.equal(exit.shouldSave, saves); assert.equal(exit.changed.length, saves ? 1 : 0);
    assert.equal(exit.temporary.length, saves ? 1 : 0);
    // The full run freezes each watcher array before the next case clears it.
    // Earlier smoke reports retain only their independently derived filenames.
    if (!smoke) assert.deepEqual([...new Set(exit.events.filter(e =>
      /^auto-\d+\.json\.\d+\.\d+\.tmp$/.test(e.file)).map(e => e.file))], exit.temporary);
    if (!saves) assert.deepEqual(exit.after, b.files);
    else for (const old of b.files) assert(exit.after.some(f => f.name === old.name && f.sha256 === old.sha256));
    assert(restart.actualNewProcess && restart.publicLibraryReseed);
    assert.equal(restart.expectedCommand, saves ? 1 : 0);
    assert.equal(restart.restored.scene, "ordinary_nvl"); assert.equal(restart.restored.command, saves ? 1 : 0);
    assert.equal(restart.prefs.autoSaveEnabled, c.kind !== "auto_off");
    if (["retry", "discard"].includes(c.kind)) {
      const denied = checks[1].detail;
      assert.equal(denied.denied.isElevated, false); assert.equal(denied.denied.probe.allowed, false);
      assert(denied.denied.probe.accessDenied); assert.equal(denied.denied.probe.hresult, -2147024891);
      assert(denied.message.includes("保存失败") && denied.message.includes("不会回退"));
      assert.deepEqual(denied.after, b.files);
    }
    if (c.kind === "auto_off") assert(exit.text.includes("自动保存已关闭") && exit.text.includes("未保存的进度可能丢失"));
    if (c.kind === "auto_on") assert(exit.text.includes("退出前会等待自动保存完成"));
  }
  const matrix = ["agentvn", "renpy"].flatMap(layout =>
    (smoke ? [[1920, 1080]] : [[1920, 1080], [2560, 1440], [3840, 2160]]).flatMap(([width, height]) =>
      (smoke ? [1] : [1, 2]).flatMap(dpr => (smoke ? [false] : [false, true])
        .map(reduced => ({ layout, width, height, dpr, reduced })))));
  assert.equal(r.expectedMatrix, matrix.length); assert.equal(r.matrix.length, matrix.length);
  assert.deepEqual(r.matrix.map(({ layout, width, height, dpr, reduced }) =>
    ({ layout, width, height, dpr, reduced })), matrix);
  for (const m of r.matrix) {
    assert.equal(m.status, "PASS");
    geometry(m.failure, m, "退出游戏？", 1); geometry(m.second, m, "确认放弃保存？", 2);
    geometry(m.afterEscape, m, "退出游戏？", 1);
  }
  for (const a of r.acls) {
    if (a.action === "Block") {
      assert.equal(a.data.status, "WRITE_DENIED"); assert.equal(a.data.isElevated, false);
      assert.equal(a.data.probe.allowed, false); assert(a.data.probe.accessDenied);
    } else {
      assert.equal(a.action, "Restore"); assert.equal(a.data.status, "RESTORED");
      assert(a.data.comparison.permissionsMatch && a.data.comparison.daclBytesMatch
        && a.data.comparison.ownerGroupMatch && a.data.comparison.allOtherFlagsMatch);
      assert(a.data.probe.allowed);
    }
  }
  for (const missing of ["Physical Alt+F4/window-close", "Android system back", "New installation/export"])
    assert(r.notRun.includes(missing));
}
function main() {
  const name = process.argv[2] || "exit-audit-01"; assert(/^exit-audit-\d{2}$/.test(name));
  const out = path.join(base, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_UI_EXIT_EVIDENCE_ONLY_NOT_RELEASE_INSTALL_OR_FULL_ACCEPTANCE",
    productChanges: 0, builds: 0, modelRequests: 0 };
  const check = (name, fn) => {
    const c = { name, status: "RUNNING" }; report.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  };
  try {
    const runs = ["exit-03", "exit-04"].map((name, i) => {
      const dir = path.join(base, name), raw = read(path.join(dir, "exit.json"));
      validateExitReport(raw, i === 0);
      return { name, dir, raw, session: read(path.join(dir, "session.json")),
        journal: read(path.join(dir, "profile-protection.json")) };
    });
    check("Both layout baselines, eight exit/restart cases and exact 24 modal display combinations", () =>
      ({ mainChecks: runs[1].raw.checks.length, mainMatrix: runs[1].raw.matrix.length,
        smokeChecks: runs[0].raw.checks.length, smokeMatrix: runs[0].raw.matrix.length,
        realNativeUIExits: runs.flatMap(r => r.raw.launches).filter(l =>
          l.cleanup.method === "REAL_UI_CONFIRMED_NATIVE_DESTROY").length }));
    check("Candidate, QA snapshots, inputs, actual ACL deny/restore and screenshot bytes", () => {
      for (const [i, r] of runs.entries()) {
        assert.equal(r.session.status, i === 0 ? "CURRENT_NATIVE_EXIT_SMOKE_PASS" : "CURRENT_NATIVE_EXIT_SAFETY_PASS");
        assert.equal(r.session.commands.length, 3); assert(r.session.commands.every(c => c.status === "PASS" && c.exitCode === 0));
        for (const f of [...r.session.products, ...r.session.tools, r.session.originalExport,
          r.session.originalFixture, r.session.profileRestoration, ...r.raw.sources, ...r.raw.acls])
          assert.equal(sha(f.path), f.sha256, f.path);
        assert(r.raw.launches.every(l => l.executableSha256 === r.session.products[2].sha256));
        for (const a of r.raw.acls) assert.deepEqual(read(a.path), a.data);
        for (const m of r.raw.matrix) assert.equal(r.raw.screenshots.filter(s => path.basename(s.path) ===
          `${m.layout}-retry-discard-${m.width}-${m.dpr}-${m.reduced}.png`).length, 1);
        for (const s of r.raw.screenshots) {
          assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
          const b = fs.readFileSync(s.path);
          assert.equal(b.readUInt32BE(16), Math.round(s.before.width * s.before.dpr));
          assert.equal(b.readUInt32BE(20), Math.round(s.before.height * s.before.dpr));
          assert([1920, 2560, 3840].includes(s.before.width));
          assert(Math.min(Math.abs(s.before.dpr - 1), Math.abs(s.before.dpr - 2)) <= 1e-6);
          const m = r.raw.matrix.find(m => path.basename(s.path) ===
            `${m.layout}-retry-discard-${m.width}-${m.dpr}-${m.reduced}.png`);
          if (m) {
            assert.equal(s.before.width, m.width); assert.equal(s.before.height, m.height);
            assert(Math.abs(s.before.dpr - m.dpr) <= 1e-6); assert.equal(s.before.reduced, m.reduced);
          }
        }
      }
      return { product: runs[1].session.products[2], mainImages: 36, smokeImages: 8,
        mainRealDeniedLeaves: 4, smokeRealDeniedLeaves: 2, physical4KClaim: false };
    });
    check("Every final save and atomic snapshot matches archived native bytes and the correct identity", () => {
      for (const r of runs) {
        const archive = r.journal.records.find(j => j.storage === "NativeRoaming").target;
        for (const f of r.raw.retained) {
          assert.equal(sha(f.retained), f.sha256); assert.equal(fs.statSync(f.retained).size, f.bytes);
          assert.equal(sha(path.join(archive, "saves", f.installId, f.name)), f.sha256);
          const data = read(f.retained); assert.equal(data.install_id, f.installId);
        }
        for (const c of r.raw.cases) {
          const exit = r.raw.checks.filter(t => t.layout === c.layout && t.case === c.kind).at(-2).detail;
          for (const f of exit.after) assert.equal(sha(path.join(archive, "saves", c.installId, f.name)), f.sha256);
          for (const f of exit.changed) {
            const data = read(path.join(archive, "saves", c.installId, f.name));
            assert.equal(data.save_kind, "auto"); assert.equal(data.scene_id, "ordinary_nvl");
            assert.equal(data.command_index, 1);
          }
          assert(!fs.readdirSync(path.join(archive, "saves", c.installId)).some(n => n.endsWith(".tmp")));
        }
      }
      return { mainFinalSaves: 12, smokeFinalSaves: 6, temporaryFiles: 0, standaloneSavesClaim: false };
    });
    check("Original user profiles restored; recorded process identities, ports and this suite's WebViews absent", () => {
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
        "$w=@($all|Where-Object {$_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*Native-Runtime-State-20261020-01*'}|Select-Object ProcessId);" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "@{processes=$p;webviews=$w;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(ps.status, 0, ps.stderr); const current = JSON.parse(ps.stdout.replace(/^\uFEFF/, ""));
      for (const l of launches) assert(!current.processes.some(p => p.ProcessId === l.identity.ProcessId
        && p.CreatedMs === Number(l.identity.CreationDate.match(/\d+/)[0])));
      assert.deepEqual(current.webviews, []); assert.deepEqual(current.listeners, []);
      return { recordedPlayerIdentities: launches.length, cdpPorts: ports, restoredProfileSessions: runs.length };
    });
    check("Original failed run preserved; frozen installation history is not promoted", () => {
      const old = read(path.join(base, "exit-02/exit.json"));
      assert.equal(old.status, "FAILED"); assert.equal(old.cases.length, 8);
      assert(old.cases.filter(c => c.layout === "agentvn").every(c => c.status === "FAILED"
        && c.error.includes("baseline") && c.error.includes("Timeout")));
      assert(old.cases.filter(c => c.layout === "renpy").every(c => c.status === "PASS"));
      assert.equal(read(path.join(base, "exit-02/profile-restoration.json")).status, "PASS");
      const frozen = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json");
      for (const f of frozen.artifactChecks) assert.equal(sha(f.path), f.sha256);
      assert.deepEqual(frozen.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
      return { originalRun: describe(path.join(base, "exit-02/exit.json")), frozenCounts: frozen.historical.counts };
    });
    check("Exit flow, window-close routing, serial save queue and evidence guard regressions", () => {
      const temporary = path.join(out, "support-temporary"); fs.mkdirSync(temporary);
      const commands = [];
      for (const name of ["runtime-exit-flow-test.cjs", "runtime-window-close-test.cjs",
        "runtime-save-queue-test.cjs", "native-runtime-exit-audit-test.cjs"]) {
        const file = path.resolve("scripts", name), log = path.join(out, name + ".log");
        const result = spawnSync(process.execPath, [file], { cwd: path.resolve(__dirname, ".."),
          env: { ...process.env, TEMP: temporary, TMP: temporary }, encoding: "utf8",
          windowsHide: true, timeout: 60000 });
        fs.writeFileSync(log, (result.stdout || "") + "\n" + (result.stderr || ""), { flag: "wx" });
        commands.push({ command: [process.execPath, file], source: describe(file),
          exitCode: result.status, log: describe(log) });
        assert.ifError(result.error); assert.equal(result.status, 0, log); assert(result.stdout.includes("PASS"));
      }
      assert.deepEqual(fs.readdirSync(temporary), []);
      return { commands, temporaryFiles: 0, controlledSourceTestsNotNativeInputEvidence: true };
    });
    const availabilityFile = path.join(base, "exit-04/computer-use-availability.json");
    const availability = read(availabilityFile);
    assert.equal(availability.status, "BLOCKED"); assert.equal(availability.inputSent, false);
    assert(availability.error.includes("native pipe") && availability.error.includes("os error 2"));
    report.computerUse = { ...describe(availabilityFile), observation: availability };
    report.remaining = {
      physicalNativeClose: "BLOCKED_COMPUTER_USE_NATIVE_PIPE",
      existingInflightWriteWithAutosaveOff: "NOT_RUN_REAL_INFLIGHT_NOT_OBSERVED",
      standaloneExeSavesAndInstallation: "NOT_RUN_IN_THIS_LIBRARY_SUITE",
      android: "NOT_RUN", completeRegression: "NOT_COMPLETE",
    };
    report.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_UI_EXIT_PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    report.finishedAt = new Date().toISOString(); report.source = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error, out }, null, 2));
  }
}
module.exports = { validateExitReport };
if (require.main === module) main();
