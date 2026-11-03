"use strict";
// Evidence-only closeout. Does not launch, kill, install or rebuild products.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Native-Runtime-State-20261020-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const describe = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
function validateReports(session, flow, cross) {
  assert.equal(session.status, "CURRENT_NATIVE_RUNTIME_FLOW_PASS");
  assert.equal(session.nativeRoaming, true);
  for (const name of ["productChanges", "builds", "modelRequests", "installs", "deviceOperations"])
    assert.equal(session[name], 0, name);
  assert.equal(session.commands.length, 4);
  assert(session.commands.every(c => c.status === "PASS" && c.exitCode === 0));
  for (const r of [flow, cross]) {
    assert.equal(r.status, "PASS"); assert.equal(r.error, null); assert(!r.cleanupError);
    assert.deepEqual(r.pageErrors, []);
    assert.equal(r.exe.sha256, session.products[2].sha256);
    assert.equal(r.source.sha256, session.originalExport.sha256);
    assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0);
    assert(r.checks.length > 0 && r.checks.every(c => c.status === "PASS"));
    assert(r.launches.length > 0 && r.launches.every(l => l.cleanup?.status === "PASS"));
  }
  assert.equal(flow.checks.length, 15); assert.equal(cross.checks.length, 1);
  assert.equal(flow.launches.length, 2); assert.equal(cross.launches.length, 1);
  const expected = ["agentvn", "renpy"].flatMap(layout =>
    [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ layout, width, height: width * 9 / 16, dpr, reduced })))));
  assert.deepEqual(flow.matrix.map(({ layout, width, height, dpr, reduced }) =>
    ({ layout, width, height, dpr, reduced })), expected);
  assert(flow.matrix.every(c => c.status === "PASS"));
  assert.deepEqual(cross.matrix, flow.matrix);
  assert.equal(cross.reusedMatrix.sha256,
    sha(path.join(qa, "session-03/flow/report.json")));
  assert.equal(cross.reusedMatrix.matrixOnly, true);
  const detail = cross.checks[0].detail;
  assert.equal(detail.realPlayerRestart, true);
  assert.equal(detail.nativePickerClaim, false);
  assert.equal(detail.standaloneExeSaveLocationClaim, false);
  assert.equal(detail.storage.portable, false);
  assert.equal(detail.files.length, 10); assert.equal(detail.before.length, 10);
  assert.equal(flow.screenshots.length, 33); assert.equal(cross.screenshots.length, 2);
  return detail;
}
function main() {
  const out = path.join(qa, process.argv[2] || "audit-01");
  assert(/^audit-\d{2}$/.test(path.basename(out)));
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), checks: [],
    scope: "CURRENT_NATIVE_PLAYER_LIBRARY_EVIDENCE_ONLY",
    fullAcceptance: false, newModelRequests: 0, builds: 0, productChanges: 0,
    limitations: [
      "24 display cases cover ordinary dialogue and quick controls; business workflows run at 1080p DPR1.",
      "Cross-layout run explicitly reuses the display matrix; not 48 new display cases.",
      "Three actual Player processes ended by attributed termination, not normal-close/exit-save acceptance.",
      "Historical UI-exported cartridges inserted by public native command; not a new Editor export or OS picker.",
      "Library saves in real default Roaming path; not standalone EXE-adjacent saves or installed setup.",
      "No audio fixture: no claim of new voice replay or listening verification.",
      "Junction save finalization failure remains unresolved; physical default-path pass does not erase it.",
      "Not Release Editor installation, Windows setup, Android, real model or final user-project acceptance.",
    ] };
  function check(name, fn) {
    const c = { name, status: "RUNNING" }; receipt.checks.push(c);
    try { c.detail = fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
  }
  try {
    const sessionPath = path.join(qa, "session-03/session.json");
    const session = read(sessionPath), flow = read(path.join(qa, "session-03/flow/report.json"));
    const cross = read(path.join(qa, "session-03/cross-layout/report.json"));
    const detail = validateReports(session, flow, cross);
    check("Original evidence, product identity and frozen installation evidence unchanged", () => {
      for (const item of [...session.products, ...session.tools, session.originalExport, session.originalFixture,
        session.profileRestoration]) assert.equal(sha(item.path), item.sha256, item.path);
      for (const dir of ["flow", "cross-layout"]) {
        const r = dir === "flow" ? flow : cross;
        assert.equal(sha(r.runnerAtInvocation.path), r.runnerAtInvocation.sha256);
      }
      const frozen = read("F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-12/audit.json");
      assert.deepEqual(frozen.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
      for (const item of frozen.artifactChecks) assert.equal(sha(item.path), item.sha256);
      return { session: describe(sessionPath), products: session.products, frozenCounts: frozen.historical.counts };
    });
    check("Exact display coverage, real actions and non-overlapping controls", () => {
      for (const c of flow.matrix) {
        assert(c.dialog.overflow <= 1);
        assert.equal(c.controls.length, c.layout === "renpy" ? 8 : 1);
        for (const b of c.controls)
          assert(b.hit && b.x >= -1 && b.y >= -1 && b.right <= c.width + 1 && b.bottom <= c.height + 1);
        if (c.layout === "renpy") {
          assert(Math.max(...c.controls.map(b => b.y)) - Math.min(...c.controls.map(b => b.y)) < 1);
          for (let i = 1; i < c.controls.length; i++)
            assert(c.controls[i - 1].right <= c.controls[i].x + 1, "Quick actions overlap");
        }
      }
      for (const layout of ["agentvn", "renpy"]) {
        const checks = flow.checks.filter(c => c.layout === layout);
        for (const name of ["Explicit ordinary", "Long ordinary", "Extreme ordinary", "NVL inheritance",
          "NVL explicit", "Bubble follows"])
          assert.equal(checks.filter(c => c.name.startsWith(name)).length, 1);
      }
      const quick = flow.checks.find(c => c.name.startsWith("Real quick-save")).detail;
      assert.equal(quick.writes.length, 7); assert.equal(quick.retained.length, 6);
      assert.equal(quick.manualUnchanged, true); assert.equal(quick.sixSlotsPerPage, true);
      // These three fault paths were not executed by this run.
      assert.equal(quick.invalidLatestFallback, "NOT_RUN");
      assert.equal(quick.quickWriteFailure, "NOT_RUN");
      assert.equal(quick.concurrentSubmission, "NOT_RUN");
      return { displayCases: flow.matrix.length, businessChecks: flow.checks.length,
        crossProcessChecks: cross.checks.length, quickFaultPaths: "NOT_RUN" };
    });
    check("35 PNGs retain exact bytes, viewport/media and physical pixel dimensions", () => {
      const images = [...flow.screenshots, ...cross.screenshots];
      for (const s of images) {
        assert.equal(sha(s.path), s.sha256);
        assert.deepEqual(s.before, s.after);
        const dpr = Math.round(s.before.dpr), b = fs.readFileSync(s.path);
        assert([1, 2].includes(dpr) && Math.abs(s.before.dpr - dpr) <= 1e-6);
        assert.equal(b.readUInt32BE(16), s.before.width * dpr);
        assert.equal(b.readUInt32BE(20), s.before.height * dpr);
        assert.equal(s.png.width, b.readUInt32BE(16)); assert.equal(s.png.height, b.readUInt32BE(20));
      }
      return { count: images.length, physicalDisplayClaim: false };
    });
    check("Ten native save files retain identities, exact bytes and cross-layout restoration", () => {
      const archive = path.join(qa, "session-03/player-roaming/saves", flow.installId);
      for (const item of detail.files) {
        assert.equal(sha(item.retained), item.sha256); assert.equal(fs.statSync(item.retained).size, item.bytes);
        assert.deepEqual(read(item.retained), item.data);
        assert.equal(sha(path.join(archive, path.basename(item.path))), item.sha256);
        assert.equal(item.data.install_id, flow.installId); assert.equal(item.data.game_id, flow.installId);
      }
      for (const s of detail.before)
        assert.equal(detail.files.filter(f => f.data.save_id === s.save_id).length, 1);
      const kinds = {};
      for (const item of detail.files) kinds[item.data.save_kind] = (kinds[item.data.save_kind] || 0) + 1;
      assert.deepEqual(kinds, { auto: 2, quick: 6, manual: 2 });
      const latest = detail.before.filter(s => s.save_kind === "quick")
        .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0];
      assert.equal(detail.loadedLatestQuick, latest.save_id);
      assert.equal(detail.restored.scene, "saves"); assert.equal(detail.restored.command, 6);
      return { kinds, files: detail.files.map(({ retained, sha256, bytes }) => ({ retained, sha256, bytes })),
        actualPlayerProcesses: [...flow.launches, ...cross.launches].map(l => l.identity),
        normalExitClaim: false };
    });
    check("All three profile restorations preserve original data; no known process or CDP listener remains", () => {
      const journals = ["01", "02", "03"].map(n => {
        const dir = path.join(qa, `session-${n}`);
        const j = read(path.join(dir, "profile-protection.json"));
        const r = read(path.join(dir, "profile-restoration.json"));
        assert.equal(r.status, "PASS"); assert.equal(r.deletedUserFiles, 0);
        for (const old of j.records) {
          const restored = r.restored.find(p => p.original === old.original);
          assert(restored); assert.equal(restored.directoryId, old.directoryId);
          assert.deepEqual(restored.files, old.files); assert(!fs.existsSync(old.held));
          if (old.storage === "NativeRoaming") assert(!fs.existsSync(old.retained));
          for (const file of old.files) assert.equal(sha(path.join(old.original, file.relative)), file.sha256);
        }
        return { dir, j };
      });
      const reports = ["session-01/flow", "session-02/flow", "session-03/flow", "session-03/cross-layout"]
        .map(d => read(path.join(qa, d, "report.json")));
      const launches = reports.flatMap(r => r.launches), ports = [...new Set(launches.map(l => l.cdpPort))];
      const result = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        "$p=@(Get-CimInstance Win32_Process|Select-Object ProcessId,ExecutablePath," +
        "@{n='CreatedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}},CommandLine);" +
        `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess);` +
        "$d=@(" + journals[2].j.records.map(j => "'" + j.original.replace(/'/g, "''") + "'").join(",") + ")|" +
        "ForEach-Object {@{path=$_;id=((& fsutil.exe file queryfileid $_|Out-String).Trim())}};" +
        "@{processes=$p;listeners=$l;directories=@($d)}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true, timeout: 20000 });
      assert.equal(result.status, 0, result.stderr);
      const state = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
      for (const l of launches) {
        assert.equal(l.cleanup.status, "PASS");
        const created = Number(l.identity.CreationDate.match(/\d+/)[0]);
        assert(!state.processes.some(p => p.ProcessId === l.pid && p.CreatedMs === created));
      }
      assert.deepEqual(state.listeners, []);
      const qaWebviews = state.processes.filter(p => /msedgewebview2\.exe$/i.test(p.ExecutablePath || "")
        && (p.CommandLine || "").includes("Native-Runtime-State-20261020-01"));
      assert.deepEqual(qaWebviews, []);
      for (const j of journals[2].j.records) {
        const actual = state.directories.find(d => d.path === j.original);
        assert(actual.id.toLowerCase().includes(j.directoryId.toLowerCase()));
      }
      return { restorations: 3, recordedPlayerRoots: launches.length, ports,
        knownPlayerRootResiduals: 0, qaWebviewResiduals: 0, listenerResiduals: 0,
        qualification: "Historical runner did not record all descendant identities; not claiming full historical process-tree audit." };
    });
    check("Earlier failures remain FAILED; same-binary storage differential is not a root-cause claim", () => {
      for (const n of ["01", "02"]) assert.equal(read(path.join(qa, `session-${n}/session.json`)).status, "FAILED");
      const first = read(path.join(qa, "session-01/flow/report.json"));
      assert.equal(first.matrix.length, 0);
      assert(first.checks.some(c => (c.error || "").includes("1.0000000149011612")));
      const second = read(path.join(qa, "session-02/flow/report.json"));
      assert.equal(second.exe.sha256, flow.exe.sha256); assert.equal(second.status, "FAILED");
      assert(second.checks.filter(c => c.status === "FAILED").every(c => /saveUI/.test(c.error)));
      // The older schema predates nativeRoaming. Verify its explicitly recorded
      // launch mode instead of treating a missing historical field as false.
      assert(second.launches.length > 0);
      assert(second.launches.every(l => l.isolatedLibraryViaProtectedJunction === true));
      return { dprGuardFailure: describe(path.join(qa, "session-01/flow/report.json")),
        junctionSaveFailure: describe(path.join(qa, "session-02/flow/report.json")),
        failureScreenshot: describe(path.join(qa, "session-02/flow/agentvn-failure.png")),
        diagnosis: "Same binary passes physical default Roaming; Junction failure reason remains UNKNOWN." };
    });
    receipt.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_LIBRARY_PASS_WITH_OPEN_LIMITATIONS";
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    receipt.finishedAt = new Date().toISOString(); receipt.auditSource = describe(__filename);
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: receipt.status, checks: receipt.checks.map(({ name, status }) =>
      ({ name, status })), error: receipt.error, out }, null, 2));
  }
}
module.exports = { validateReports };
if (require.main === module) main();
