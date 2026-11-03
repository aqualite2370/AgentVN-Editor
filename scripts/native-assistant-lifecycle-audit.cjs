"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const qa = "F:/AgentVN/QA/Native-Assistant-Lifecycle-20261020-01";
const root = path.resolve(__dirname, ".."), load = f => JSON.parse(fs.readFileSync(f, "utf8"));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const stages = [
  "inquiry-has-no-write-tools-and-does-not-mutate-project",
  "running-owner-lock-and-other-project-global-monitor",
  "queued-cancel-does-not-call-model-or-edit-either-project",
  "fifo-single-worker-completion-retains-project-ownership-without-automerge",
  "history-geometry-focus-archive-restore-and-delete-cancel",
  "actual-native-process-restart-restores-project-mode-history-and-draft-without-request",
  "confirmed-history-deletion-survives-second-real-process-restart",
];
function validate(report) {
  assert.equal(report.status, "CURRENT_NATIVE_CONTROLLED_QUEUE_AND_HISTORY_PASS");
  assert(report.finishedAt, "Cleanup must be terminal");
  assert.equal(report.scope, "CURRENT_NATIVE_DEV_AUTOSTART_SOURCE_BACKEND_CONTROLLED_LOOPBACK_MODEL_NOT_RELEASE_OR_REAL_DEEPSEEK");
  assert.deepEqual(report.cases.map(r => r.name), stages);
  assert(report.cases.every(r => r.status === "PASS"));
  assert.deepEqual(report.errors, []); assert.equal(report.realModelRequests, 0);
  assert.equal(report.productChanges, 0); assert.equal(report.devPublicationBuilds, 0);
  const keys = new Set();
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    keys.add(`${width}x${width === 1920 ? 1080 : width === 2560 ? 1440 : 2160}/${dpr}/${reduced}`);
  for (const kind of ["lockMatrix", "historyMatrix"]) {
    const rows = report[kind]; assert.equal(rows.length, 12);
    const actual = new Set();
    for (const row of rows) {
      const key = `${row.width}x${row.height}/${row.dpr}/${row.reduced}`;
      assert(keys.has(key)); assert(!actual.has(key)); actual.add(key);
      const g = row.geometry, rect = kind === "historyMatrix" ? g.menu : g.rect;
      assert(g.hit && g.overflow <= 1 && rect.left >= 0 && rect.top >= 0 &&
        rect.right <= row.width + 1 && rect.bottom <= row.height + 1);
      if (kind === "lockMatrix") assert(g.focus && g.rootInert);
    }
    assert.equal(actual.size, 12);
  }
  assert.equal(report.launches.length, 3); assert.equal(report.cleanups.length, 3);
  assert.equal(new Set(report.launches.map(l => `${l.pid}:${l.created}`)).size, 3);
  assert.equal(new Set(report.launches.map(l => l.webview)).size, 1);
  assert.equal(new Set(report.launches.map(l => l.data)).size, 1);
  for (const cleanup of report.cleanups) {
    assert.equal(cleanup.normalExitClaimed, false);
    assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0);
    assert(cleanup.killed.length > 0);
  }
  assert.equal(report.submissions.length, 3);
  assert.deepEqual(report.submissions.map(s => s.userRequest.split(" ")[0]), ["QUEUE_A", "QUEUE_B", "QUEUE_C"]);
  assert.equal(report.submissions[0].projectId, report.submissions[1].projectId.replace("-b-", "-a-"));
  assert.equal(report.submissions[1].projectId, report.submissions[2].projectId);
  assert.equal(report.modelBoundary.length, 3);
  const inquiry = report.modelBoundary.find(r => r.marker === "HISTORY_A");
  assert(inquiry && !inquiry.creation && inquiry.tools.length === 0);
  const creation = report.modelBoundary.filter(r => r.creation);
  assert.deepEqual(creation.map(r => r.marker), ["QUEUE_A", "QUEUE_C"]);
  assert(creation.every(r => r.tools.includes("submit_assistant_component_draft")));
  assert(creation[0].finishedAt <= creation[1].startedAt, "No overlapping model execution");
  assert.equal(report.providerCleanup.maxConcurrentCreation, 1);
  assert.equal(report.providerCleanup.stopped, true); assert.equal(report.providerCleanup.requests, 3);
  assert.equal(report.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert.equal(report.screenshots.length, 3);
  for (const s of report.screenshots) {
    assert.deepEqual(s.before, s.after);
    assert(Math.abs(s.before.dpr - Math.round(s.before.dpr)) <= 1e-6);
    assert.equal(s.png.width, s.before.width * Math.round(s.before.dpr));
    assert.equal(s.png.height, s.before.height * Math.round(s.before.dpr));
  }
  return { cases: 7, lockCombinations: 12, historyCombinations: 12, nativeStarts: 3,
    controlledRequests: 3, realModelRequests: 0, normalExitClaimed: false };
}
function command(exe, args) {
  const r = spawnSync(exe, args, { encoding: "utf8", timeout: 25000,
    windowsHide: true, maxBuffer: 12 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  assert.equal(r.status, 0, r.stderr); return r.stdout.replace(/^\uFEFF/, "").trim();
}
function selfTest(report) {
  validate(report);
  const cases = [
    r => { r.status = "PASS"; }, r => { r.cases = []; }, r => { delete r.finishedAt; },
    r => { r.lockMatrix.pop(); }, r => { r.historyMatrix[0] = r.historyMatrix[1]; },
    r => { r.lockMatrix[0].geometry.hit = false; }, r => { r.lockMatrix[0].geometry.focus = false; },
    r => { r.historyMatrix[0].geometry.menu.left = -3; },
    r => { r.launches[1] = r.launches[0]; }, r => { r.launches[2].webview += "-different"; },
    r => { r.cleanups[0].normalExitClaimed = true; }, r => { r.cleanups[0].survivors.push({}); },
    r => { r.realModelRequests = 1; }, r => { r.modelBoundary[0].tools = ["write"]; },
    r => { r.modelBoundary[2].marker = "QUEUE_B"; }, r => { r.providerCleanup.maxConcurrentCreation = 2; },
    r => { r.screenshots[0].png.width /= 2; }, r => { r.credentialCleanup = "NOT_CLEARED"; },
  ];
  for (const mutate of cases) { const bad = structuredClone(report); mutate(bad); assert.throws(() => validate(bad)); }
  console.log(`PASS ${cases.length} invalid result variants rejected`);
}
function audit(name) {
  assert(/^audit-\d{2}$/.test(name));
  const out = path.join(qa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const reportPath = path.join(qa, "session-02/report.json"), report = load(reportPath);
  const receipt = { status: "RUNNING", at: new Date().toISOString(), report: { path: reportPath, sha256: sha(reportPath) } };
  try {
    receipt.coverage = validate(report);
    for (const f of [...report.products, ...report.sources, ...report.normalizedInputs, report.normalizationSource])
      assert.equal(sha(f.path), f.sha256, `Current bytes differ: ${f.path}`);
    assert.equal(sha(path.join(root, "scripts/native-assistant-lifecycle.cjs")), sha(path.join(qa, "session-02/executed-test.cjs")));
    for (const s of report.screenshots) {
      const bytes = fs.readFileSync(s.path); assert.equal(sha(s.path), s.sha256);
      assert.equal(bytes.readUInt32BE(16), s.png.width); assert.equal(bytes.readUInt32BE(20), s.png.height);
    }
    const redPath = path.join(qa, "session-01/report.json"), red = load(redPath);
    assert.equal(red.status, "FAILED"); assert.match(red.error, /loadingAnimation/); assert.match(red.error, /openingAudio/);
    receipt.originalFailed = { path: redPath, sha256: sha(redPath), unchanged: true };
    // Read only this isolated SQLite database; never query credential tables.
    const db = path.join(report.launches[0].data, "backend/vn_engine.db");
    const ids = report.normalizedInputs.map(f => load(f.path).project_id);
    const python = [
      "import json,sqlite3,sys,pathlib",
      "db=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True)",
      "ids=json.loads(sys.argv[2])",
      "print(json.dumps([json.loads(db.execute('SELECT project_json FROM editor_project_details WHERE project_id=?',(i,)).fetchone()[0]) for i in ids],ensure_ascii=False))",
      "db.close()",
    ].join("\n");
    const final = JSON.parse(command("python", ["-c", python, db, JSON.stringify(ids)]));
    assert.equal(final.length, 2);
    for (const [i, actual] of final.entries()) {
      const input = load(report.normalizedInputs[i].path);
      const authored = rows => rows.map(({ measured, ...node }) => node);
      assert.deepEqual(actual.editor_settings, input.editor_settings);
      assert.deepEqual(authored(actual.nodes), authored(input.nodes)); assert.deepEqual(actual.edges, input.edges);
      assert.deepEqual(actual.asset_manifest, input.asset_manifest);
    }
    const snapshot = path.join(out, "final-projects-readonly-sqlite.json");
    fs.writeFileSync(snapshot, JSON.stringify(final, null, 2), { flag: "wx" });
    receipt.persistedProjects = { path: snapshot, sha256: sha(snapshot), sourceDb: db, projectCount: 2 };
    const rows = JSON.parse(command("powershell.exe", ["-NoProfile", "-Command",
      "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process|Select-Object ProcessId," +
      "@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}})"]));
    assert(!report.known.some(p => rows.some(a => a.ProcessId === p.ProcessId && a.Created === p.Created)));
    const ports = [...new Set(report.launches.flatMap(l => l.ports))];
    const live = JSON.parse(command("powershell.exe", ["-NoProfile", "-Command",
      "ConvertTo-Json -Compress -InputObject @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|" +
      `Where-Object {$_.LocalPort -in @(${ports.join(",")})}|Select-Object LocalPort,OwningProcess)`]));
    assert.equal(live.length, 0);
    receipt.processesAbsent = report.known.length; receipt.portsAbsent = ports;
    receipt.status = "EVIDENCE_VERIFIED_CURRENT_NATIVE_CONTROLLED_QUEUE_AND_HISTORY_PASS";
    console.log(`PASS audit ${out}`);
  } catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; console.error(receipt.error); }
  finally {
    receipt.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  }
}
if (process.argv[2] === "--test") selfTest(load(path.join(qa, "session-02/report.json")));
else audit(process.argv[2]);
