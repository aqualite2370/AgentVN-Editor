"use strict";
// Independent evidence/restoration audit, NOT a substitute for product tests.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { sha256 } = require("./lib/installed-acceptance.cjs");
const root = "D:/AgentVN", base = `${root}/output/installed-runtime-business-matrix-20261019-01`;
const attempt = process.argv[2], auditAttempt = process.argv[3] || "01";
assert(/^\d{2}$/.test(attempt) && /^\d{2}$/.test(auditAttempt));
const destination = path.join(base, `audit-${attempt}-${auditAttempt}.json`);
assert(!fs.existsSync(destination), "Preserve every earlier audit");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], sources: [],
  scope: "INDEPENDENT_EVIDENCE_AND_RESTORATION_REVIEW_NOT_NEW_RUNTIME_TESTS",
  sourceRunConclusion: "UNPROVEN", productConclusion: "NOT_INFERRED_FROM_QA_STATUS",
  productChanges: 0, modelRequests: 0, newBuilds: 0, error: null };
const sha = f => sha256(fs.readFileSync(f));
function read(f) {
  report.sources.push({ path: f, sha256: sha(f) });
  return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
}
async function check(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row);
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
}
(async () => {
  const wrapper = read(path.join(base, `attempt-${attempt}/report.json`));
  const children = wrapper.cells.map(c => ({ cell: c, report: read(path.join(c.path, "report.json")) }));
  report.sourceRunConclusion = wrapper.status;
  await check("Terminal nonempty matrix has all declared combinations and correctly preserves failures", () => {
    assert(["PASS", "FAILED"].includes(wrapper.status));
    const expected = wrapper.expectedCells ?? 12;
    assert.equal(wrapper.cells.length, expected);
    assert(expected === 12 || (expected === 1 && wrapper.onlyCell));
    const keys = new Set();
    for (const { cell, report: r } of children) {
      const v = cell.viewport, key = [v.width, v.height, v.dpr, v.reduced].join("/");
      assert(!keys.has(key)); keys.add(key); assert.deepEqual(r.businessViewport, v);
      assert.equal(sha(path.join(cell.path, "report.json")), cell.reportSha256);
      assert.equal(r.status, cell.status); assert(["PASS", "FAILED"].includes(r.status));
      assert(r.checks.length >= 1 && r.finishedAt && r.launches.length === 2);
      assert.equal(r.productChanges, 0); assert.equal(r.realModelRequests, 0);
      assert.deepEqual(r.pageErrors, []);
      if (r.status === "PASS") {
        assert.equal(r.checks.length, 15); assert(r.checks.every(c => c.status === "PASS"));
        assert.equal(r.matrix.length, 2); assert(r.matrix.every(c => c.status === "PASS"));
        assert.equal(cell.exitCode, 0);
        assert.equal(r.nativeSaves.length, 10);
      } else assert(r.checks.some(c => c.status === "FAILED") || r.error);
      for (const action of r.revealActions || []) {
        assert.equal(action.after.page, action.before.page);
        assert.equal(action.after.command, action.before.command);
        assert.equal(action.after.scene, action.before.scene);
      }
    }
    if (expected === 12) for (const [w,h] of [[1920,1080],[2560,1440],[3840,2160]])
      for (const d of [1,2]) for (const reduced of [false,true]) assert(keys.has([w,h,d,reduced].join("/")));
    const allPass = children.every(c => c.report.status === "PASS" && c.cell.exitCode === 0);
    assert.equal(wrapper.status, allPass ? "PASS" : "FAILED");
    return { combinations: keys.size, completeTwelveMatrix: expected === 12, sourceRunConclusion: wrapper.status };
  });
  await check("Same UI-exported cartridge and actual installed Player bytes back every cell", () => {
    for (const f of wrapper.inputs.cartridges) assert.equal(sha(f.path), f.sha256);
    assert.equal(sha(wrapper.inputs.fixture.path), wrapper.inputs.fixture.sha256);
    for (const { report: r } of children) {
      assert.equal(sha(r.exe.path), r.exe.sha256);
      assert.equal(r.exe.sha256, "71448ddabab3bc2a7e653c1dfca9067e5ece4d1e4db10539b4bacc25d17d723a");
      assert.equal(r.source.sha256, wrapper.inputs.exports.sha256);
      assert.equal(r.runnerAtInvocation.sha256, wrapper.inputs.runner.sha256);
      assert(r.launches.every(l => l.libraryPreparation.controlledPublicNativeCommand
        && !l.libraryPreparation.normalFilePickerClaim));
    }
    return { cartridges: 2, actualInstalledLibraryPlayer: true, standaloneSetupOrAndroid: false };
  });
  await check("Successful business steps prove exact-page text, NVL restore, actor anchors and six independent quick saves", () => {
    const fixture = read(wrapper.inputs.fixture.path);
    // Text strings belong to fixtures-02 metadata, not the portable project.
    const texts = read(`${root}/output/installed-runtime-abilities-20261018-01/fixtures-02.json`).text;
    let fullLayoutFlows = 0, textFlows = 0, quickFlows = 0;
    for (const { report: r } of children) for (const layout of ["agentvn", "renpy"]) {
      const cases = r.checks.filter(c => c.layout === layout);
      const textCases = [[2, texts.mid], [3, texts.extreme]];
      for (const [index, text] of textCases) {
        const c = cases[index]; if (c?.status !== "PASS") continue;
        const d = c.detail; assert.equal(d.geometry.length, d.pages);
        assert.equal(d.geometry.map(p => p.text).join(""), text);
        for (const p of d.geometry) {
          assert(p.scroll.actual <= p.scroll.client + 2 && p.scroll.actualWidth <= p.scroll.width + 1);
          assert(p.rect.x >= -1 && p.rect.y >= -1
            && p.rect.right <= r.businessViewport.width + 1 && p.rect.bottom <= r.businessViewport.height + 1);
        }
        textFlows++;
      }
      if (cases[4]?.status === "PASS") {
        assert.deepEqual(cases[4].detail.before.nvl, cases[4].detail.restored.nvl);
        assert.equal(cases[4].detail.stored.nvl_page.length, 3);
      }
      if (cases[6]?.status === "PASS") {
        const d = cases[6].detail;
        assert.equal(d.left.anchor, "character"); assert(d.moved.rect.x > d.left.rect.x);
        assert.equal(d.absent.anchor, "fallback"); assert.equal(d.fixed.anchor, "fixed");
        assert.equal(d.long.geometry.map(p => p.text).join(""), texts.bubbleLong);
      }
      if (cases.slice(0,7).length === 7 && cases.slice(0,7).every(c => c.status === "PASS")) fullLayoutFlows++;
      if (layout === "renpy" && cases[7]?.status === "PASS") {
        const q = cases[7].detail; assert.equal(q.writes.length, 7); assert.equal(q.retained.length, 6);
        assert.equal(q.noSaveFeedback, "PASS"); assert.equal(q.priorQuick.length, 0);
        assert.deepEqual(q.retained.map(s => s.command_index).sort((a,b) => a-b), [1,2,3,4,5,6]);
        assert(q.manualUnchanged && q.sixSlotsPerPage); assert.equal(q.loadedCommand, 6); quickFlows++;
      }
    }
    return { fullLayoutFlows, textFlows, quickFlows, fixtureIdentity: fixture.project?.id || fixture.project_id,
      onlySuccessfulStepsCounted: true, voiceReplayClaim: false };
  });
  await check("Every screenshot and retained native save matches its recorded physical pixels/hash", () => {
    let pngs = 0, nativeSaves = 0;
    for (const { report: r } of children) {
      for (const s of r.screenshots) {
        const bytes = fs.readFileSync(s.path);
        assert.equal(sha256(bytes), s.sha256); assert.deepEqual(s.before, s.after);
        assert.deepEqual(s.before, r.businessViewport);
        assert.equal(bytes.readUInt32BE(16), s.before.width * s.before.dpr);
        assert.equal(bytes.readUInt32BE(20), s.before.height * s.before.dpr); pngs++;
      }
      for (const s of r.nativeSaves) {
        assert.equal(sha(s.retained), s.sha256);
        assert.equal(fs.statSync(s.retained).size, s.bytes);
        assert.equal(read(s.retained).save_id, s.saveId); nativeSaves++;
      }
    }
    assert(pngs > 0);
    return { pngs, nativeSaves, webviewEmulationNotPhysicalDisplay: true };
  });
  await check("Original four profiles and55 baseline files restored with independent backups", () => {
    assert(!wrapper.cleanupError); assert.equal(wrapper.profileRestoration.status, "PASS");
    assert.equal(sha(wrapper.profileRestoration.path), wrapper.profileRestoration.sha256);
    assert.equal(read(wrapper.profileRestoration.path).status, "PASS");
    const prep = read(wrapper.inputs.profilePreparation.path); let count = 0;
    for (const p of prep.profiles) {
      assert(fs.existsSync(p.original) && !fs.existsSync(p.held));
      for (const f of p.files) {
        assert.equal(sha(path.join(p.original, f.relative)), f.sha256);
        assert.equal(sha(f.backup), f.sha256); count++;
      }
    }
    assert.equal(count, 55); return { profiles: 4, independentlyVerifiedFiles: count };
  });
  await check("Frozen installed EXE/Dev and560 sources retain the seven previously authorized Editor changes only", () => {
    const prep = read(wrapper.inputs.profilePreparation.path);
    assert.equal(sha(path.join(prep.installRoot, "agentvn-editor.exe")),
      "f5310a2987209ccac37941936d329abfdbaa4c5afdc9e2228c44901eb09f235c");
    assert.equal(sha(`${root}/AgentVN Dev.exe`), prep.originalDevSha256);
    const baseline = read(`${root}/output/full-regression-20261017-01/candidate-02/manifest.json`);
    const authorized = read(`${root}/output/editor-selection-mask-20261019-01/terminal-audit-02.json`);
    const allowed = new Map(authorized.sources.map(f => [path.resolve(root, f.file), f.sha256]));
    assert.equal(baseline.source.length, 560); assert.equal(allowed.size, 7);
    for (const f of baseline.source) assert.equal(sha(f.path), allowed.get(path.resolve(f.path)) || f.sha256, f.path);
    return { sources: 560, earlierAuthorizedChanges: 7, newProductChanges: 0, devRebuilt: false };
  });
  await check("Every owned Player/debug port is gone after attributed termination", () => {
    const launches = children.flatMap(c => c.report.launches);
    assert(launches.every(l => l.cleanup?.status === "PASS"));
    const pids = launches.map(l => l.pid), ports = launches.map(l => l.cdpPort);
    const command = `$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in @(${pids.join(",")})}); ` +
      `$t=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(${ports.join(",")})}); ` +
      `@{processes=@($p|Select-Object ProcessId,Name);ports=@($t|Select-Object LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5`;
    const residual = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", command],
      { encoding: "utf8", windowsHide: true, timeout: 20000 }).replace(/^\uFEFF/, ""));
    assert.equal(residual.processes.length, 0); assert.equal(residual.ports.length, 0);
    return { launches: launches.length, uniquePorts: new Set(ports).size, residual,
      normalWindowCloseClaim: false };
  });
  report.status = "PASS";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, sourceRunConclusion: report.sourceRunConclusion,
      checks: report.checks.length, destination, error: report.error }));
  });
