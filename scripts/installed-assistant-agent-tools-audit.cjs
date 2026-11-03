"use strict";
// Read-only product/evidence audit. Writes only its new, exclusive QA report.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { DatabaseSync } = require("node:sqlite");
const JSZip = require("../editor/node_modules/jszip");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(process.argv[2]);
assert(root.startsWith(path.resolve("F:/AgentVN/QA") + path.sep));
const output = path.join(root, "installed-agent-combined-audit-01.json");
assert(!fs.existsSync(output), "Preserve prior audits");
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const file = f => ({ path: f, sha256: sha(fs.readFileSync(f)) });
const sourcePath = path.join(root, "installed-agent-01/report.json");
const queuePath = path.join(root, "installed-agent-queue-03/report.json");
const source = read(sourcePath), queue = read(queuePath);
const report = { status: "RUNNING", source: file(sourcePath), continuation: file(queuePath),
  scope: "Six referenced passed stages plus one new queue continuation on identical installed bytes; original FAILED retained",
  checks: [], realModelRequests: 0, productChanges: 0, builds: 0 };
function check(name, fn) { fn(); report.checks.push({ name, status: "PASS" }); }
function matrix(cases) {
  assert.equal(cases.length, 12);
  const keys = cases.map(c => `${c.width}/${c.height}/${c.dpr}/${c.reduced}`);
  assert.equal(new Set(keys).size, 12);
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
    assert(keys.includes(`${width}/${width * 9 / 16}/${dpr}/${reduced}`));
  for (const c of cases) {
    assert.equal(c.status, "PASS");
    const capture = c.capture;
    assert(capture); validateNativeViewport(capture.before, c); validateNativeViewport(capture.after, c);
    assert.deepEqual(capture.before, capture.after);
    const bytes = fs.readFileSync(capture.path);
    assert.equal(sha(bytes), capture.sha256);
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    assert.equal(bytes.readUInt32BE(16), c.width * c.dpr);
    assert.equal(bytes.readUInt32BE(20), c.height * c.dpr);
  }
}
(async () => {
  check("Explicit original failure and exact same-byte six-stage continuation", () => {
    assert.equal(source.status, "FAILED"); assert.equal(source.cases.length, 6);
    assert(source.cases.every(c => c.status === "PASS"));
    assert.match(source.error, /Process did not settle: .* completed/);
    assert.equal(queue.status, "PASS");
    assert.equal(queue.cases.length, 1);
    assert.deepEqual(queue.cases[0], { name: "installed-all-active-queue-FIFO-cancel-and-refresh", status: "PASS" });
    assert.equal(queue.previousEvidence.sha256, report.source.sha256);
    assert.deepEqual(queue.previousEvidence.cases, source.cases);
    assert.equal(queue.installed.version, "1.9.30");
    assert.equal(source.installed.exeSha256, queue.installed.exeSha256);
    for (const name of ["agentvn-editor.exe", "creator-backend.exe", "agentvn-player.exe"]) {
      const expected = name === "agentvn-editor.exe" ? source.installed.exeSha256
        : source.installed.runtimeProvenance.find(p => p.name === name).sha256;
      assert.equal(sha(fs.readFileSync(path.join(source.installed.installRoot, name))), expected);
    }
  });
  check("Author, independent Player and queue each retain complete 12-cell native PNG matrices", () => {
    matrix(source.matrix); matrix(source.player.cases); matrix(queue.queueMatrix);
    assert.equal(source.player.status, "PASS"); assert.deepEqual(source.player.errors, []);
    assert.equal(source.player.cleanup.exitCode, 0);
    report.validatedPngs = 36;
  });
  const portable = await JSZip.loadAsync(fs.readFileSync(source.projectArtifact.path), { checkCRC32: true });
  const cartridge = await JSZip.loadAsync(fs.readFileSync(source.cartridge.path), { checkCRC32: true });
  const project = JSON.parse(await portable.file("project.json").async("string"));
  const manifest = JSON.parse(await cartridge.file("manifest.json").async("string"));
  const layoutBytes = await cartridge.file("ui/layout.json").async("nodebuffer");
  const layout = JSON.parse(layoutBytes.toString("utf8"));
  const component = layout.screens.find(s => s.screen_id === "game_menu").components.find(c => c.component_type === "custom_component");
  const id = component.customComponent.root.children[0].assetId;
  const exported = manifest.assets.find(a => a.asset_id === id);
  const saved = project.asset_manifest.find(a => a.asset_id === id);
  assert(exported && saved);
  const portableBytes = await portable.file(saved.metadata.project_path).async("nodebuffer");
  const cartridgeBytes = await cartridge.file(exported.path).async("nodebuffer");
  check("Actual saved project and exported cartridge consume identical authorized resource bytes", () => {
    assert.equal(file(source.projectArtifact.path).sha256, source.projectArtifact.sha256);
    assert.equal(file(source.cartridge.path).sha256, source.cartridge.sha256);
    assert.equal(sha(layoutBytes), source.cartridge.layoutSha256);
    assert.deepEqual(portableBytes, cartridgeBytes);
    assert.equal(sha(cartridgeBytes), source.cartridge.assetSha256);
    assert.equal(manifest.runtime_version, "0.25.0");
    assert.equal(source.authorConflict.rejected, true);
    assert(!JSON.stringify(project).includes("authorizedProjectAssetIds"));
  });
  check("Actual SQLite nine cancellations, acknowledged barrier and no queued model requests", () => {
    assert.equal(queue.cancelReceipts.length, 9);
    assert(queue.cancelReceipts.every(c => c.httpStatus === 200));
    const db = new DatabaseSync(queue.installed.databasePath, { readOnly: true });
    try {
      report.cancelledRows = queue.cancelReceipts.map(c => {
        const row = db.prepare("SELECT id, project_id, status, finished_at FROM assistant_creation_processes WHERE id=?").get(c.processId);
        assert(row); assert.equal(row.status, "cancelled"); assert(row.finished_at);
        return row;
      });
      assert.equal(db.prepare("SELECT count(*) AS n FROM assistant_creation_processes WHERE status IN ('queued','running','cancelling')").get().n, 0);
    } finally { db.close(); }
    assert.equal(new Set(report.cancelledRows.map(r => r.id)).size, 9);
    assert(["cancelling", "cancelled"].includes(queue.runningCancellationBarrier.status));
    assert(queue.cancelReceipts.some(c => c.processId === queue.runningCancellationBarrier.processId));
    assert.equal(queue.queue.cancelled, 9); assert.equal(queue.queueCleanup.requests, 1);
    assert.equal(queue.queueCleanup.maxConcurrentCreation, 1); assert.equal(queue.queueCleanup.stopped, true);
  });
  check("Controlled tool receipts remain ordered and all owned processes/ports are gone", () => {
    assert.equal(source.modelCleanup.modelRequestCount, 42);
    assert.deepEqual(source.modelCleanup.requestToolCounts, Array.from({ length: 14 }, () => [0, 2, 4]).flat());
    assert.equal(queue.modelCleanup.modelRequestCount, 0);
    assert.equal(source.modelCleanup.apiStopped, true); assert.equal(queue.modelCleanup.apiStopped, true);
    assert.equal(source.modelCleanup.code, 0); assert.equal(queue.modelCleanup.code, 0);
    const current = rows();
    for (const r of [source, queue]) {
      assert.equal(r.credentials, "CLEARED"); assert.equal(r.realModelRequests, 0);
      assert.deepEqual(r.errors, []);
      for (const cleanup of r.cleanup) for (const p of [cleanup.editor, cleanup.backend]) {
        assert.equal(p.exitCode, 0);
        assert(!current.some(c => c.ProcessId === p.pid), "Owned PID remains; examine identity rather than accepting cleanup");
      }
    }
    assert(!current.some(c => c.ProcessId === source.player.pid));
    for (const run of ["installed-agent-01", "installed-agent-queue-03"]) {
      const dir = path.join(root, run);
      for (const name of fs.readdirSync(dir).filter(n => /^owned-launch-\d+$/.test(n))) {
        const info = read(path.join(dir, name, "installed-processes.json"));
        const ports = [info.backendPort, info.cdpPort].filter(Number.isInteger);
        if (ports.length) assert.equal(listeners(ports).length, 0);
      }
    }
  });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(() => {
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, output, error: report.error }));
  });
