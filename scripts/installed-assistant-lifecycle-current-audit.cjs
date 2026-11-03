"use strict";
// Independent post-cleanup audit: no application/provider calls or product writes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const { validateNativeViewport } = require("./lib/current-native-capture.cjs");
const options=process.env.AGENTVN_EXIT_CANDIDATE_CONFIG
  ?require("./lib/candidate-1924-quick-adapter.cjs").quickCandidate():null;
if(options)assert(process.argv.includes(`--candidate=${options.version}`),"Explicit bound lifecycle audit candidate required");
const candidate1930=process.argv.includes("--candidate=1.9.30");
const currentCandidate=!!options||candidate1930 || process.argv.includes("--candidate=1.9.22");
const expectedVersion=options?.version||(candidate1930?"1.9.30":currentCandidate?"1.9.22":"1.9.14");
const root = path.resolve(__dirname, ".."), qa = options?path.join(options.base,"assistant-lifecycle-01"):candidate1930?
  "F:/AgentVN/QA/Installed-Assistant-Lifecycle-1930-20261026-01":currentCandidate?
  "F:/AgentVN/QA/Installed-Assistant-Lifecycle-1922-20261022-01":"F:/AgentVN/QA/Installed-Assistant-Lifecycle-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const stages = [
  "inquiry-has-no-write-tools-and-does-not-mutate-project",
  "running-owner-lock-and-other-project-global-monitor",
  "queued-cancel-does-not-call-model-or-edit-either-project",
  "fifo-single-worker-completion-retains-project-ownership-without-automerge",
  "history-geometry-focus-archive-restore-and-delete-cancel",
  "actual-native-process-restart-restores-project-mode-history-and-draft-without-request",
  "confirmed-history-deletion-survives-second-real-process-restart",
];
const authored = nodes => nodes.map(({ measured, ...node }) => node);
function validate(r) {
  assert.equal(r.status, "PASS"); assert(r.finishedAt); assert.equal(r.version, expectedVersion);
  assert.equal(r.scope, "ACTUAL_NSIS_INSTALLED_CONTROLLED_INQUIRY_QUEUE_HISTORY_NOT_REAL_DEEPSEEK");
  assert.deepEqual(r.cases.map(c => c.name), stages); assert(r.cases.every(c => c.status === "PASS"));
  assert.deepEqual(r.errors, []); assert(!r.cleanupError && !r.immutabilityError && !r.failureCaptureError);
  if(currentCandidate)assert(r.cacheRestoration==="PASS"&&!r.cacheError);
  assert.equal(r.realModelRequests, 0); assert.equal(r.productChanges, 0); assert.equal(r.devPublicationBuilds, 0);
  assert.equal(r.blockedModelRequests, 0);
  for (const name of ["lockMatrix", "historyMatrix"]) {
    assert.equal(r[name].length, 12); const keys = new Set();
    for (const m of r[name]) {
      assert([1920, 2560, 3840].includes(m.width)); assert.equal(m.height, m.width * 9 / 16);
      assert([1, 2].includes(m.dpr)); assert.equal(typeof m.reduced, "boolean"); validateNativeViewport(m.viewport, m);
      const k = `${m.width}/${m.dpr}/${m.reduced}`; assert(!keys.has(k)); keys.add(k);
      const g = m.geometry, rect = name === "lockMatrix" ? g.rect : g.menu;
      assert(g.hit && g.focus && g.overflow <= 1 && rect.width > 0 && rect.height > 0 &&
        rect.left >= 0 && rect.top >= 0 && rect.right <= m.width + 1 && rect.bottom <= m.height + 1);
      if (name === "lockMatrix") assert(g.rootInert);
    }
    for (const w of [1920, 2560, 3840]) for (const d of [1, 2]) for (const reduced of [false, true])
      assert(keys.has(`${w}/${d}/${reduced}`));
  }
  assert.equal(r.launches.length, 3); assert.equal(r.cleanups.length, 3);
  assert.equal(new Set(r.launches.map(l => `${l.pid}:${l.created}`)).size, 3);
  assert.equal(new Set(r.launches.map(l => l.data)).size, 1); assert.equal(new Set(r.launches.map(l => l.webview)).size, 1);
  for (const l of r.launches) {
    assert(l.created && l.backend.sha256); assert.equal(l.ports.length, 2); assert.equal(l.listeners.length, 2);
    assert(!l.sourceServer && !l.manualBackendSpawn && l.dataDirectoryOverride && l.webviewDirectoryOverride);
    assert(l.isolation.AGENTVN_TEST_PROJECT.startsWith(path.resolve(qa)));
    assert(l.isolation.AGENTVN_WORKSPACE_OUTPUT.startsWith(path.resolve(qa)));
  }
  for (const c of r.cleanups) assert(c.status === "PASS" && c.killed.length > 0 && !c.normalCloseClaimed);
  assert.equal(r.submissions.length, 3);
  assert.deepEqual(r.submissions.map(s => s.userRequest.split(" ")[0]), ["QUEUE_A", "QUEUE_B", "QUEUE_C"]);
  const ids = Object.keys(r.baselineProjects); assert.equal(ids.length, 2);
  assert.equal(r.submissions[0].projectId, ids[0]);
  assert.equal(r.submissions[1].projectId, ids[1]); assert.equal(r.submissions[2].projectId, ids[1]);
  assert.equal(new Set(r.submissions.map(s => s.id)).size, 3);
  assert.equal(r.modelBoundary.length, 3);
  const inquiry = r.modelBoundary.find(m => m.marker === "HISTORY_A");
  assert(inquiry && !inquiry.creation && inquiry.tools.length === 0 && inquiry.finishedAt);
  const creation = r.modelBoundary.filter(m => m.creation);
  assert.deepEqual(creation.map(m => m.marker), ["QUEUE_A", "QUEUE_C"]);
  assert(creation.every(m => m.tools.includes("submit_assistant_component_draft") && m.finishedAt));
  assert(creation[0].finishedAt <= creation[1].startedAt);
  assert(r.providerCleanup.stopped && r.providerCleanup.requests === 3 && r.providerCleanup.maxConcurrentCreation === 1);
  assert.equal(r.credentialCleanup, "CLEARED_TEST_ONLY_SECRET");
  assert.equal(r.controlledWrites.filter(w => w.path === "/api/assistant/chat_stream").length, 1);
  assert.equal(r.controlledWrites.filter(w => w.path === "/api/assistant/creation/processes").length, 3);
  const cancels = r.controlledWrites.filter(w => w.path.endsWith("/cancel"));
  // session-01's finally mistakenly assumed an unsupported include_terminal query.
  // Keep audit-01 FAILED; classify every exact request rather than ignoring extras.
  assert.equal(cancels.length, 4);
  const cancelId = w => w.path.split("/").at(-2);
  assert.equal(cancelId(cancels[0]), r.submissions[1].id);
  assert(Date.parse(cancels[0].at) < Date.parse(r.launches[1].at));
  assert.deepEqual(cancels.slice(1).map(cancelId), r.submissions.map(s => s.id));
  assert(cancels.slice(1).every(w => Date.parse(w.at) > Date.parse(r.launches[2].at)));
  assert.equal(r.controlledWrites.length, 8); assert(r.controlledWrites.every(w => w.endpoint === r.modelEndpoint));
  assert.equal(r.screenshots.length, 3);
  for (const s of r.screenshots) {
    assert.deepEqual(s.before, s.after);
    // Preserve raw WebView DPR, including its documented floating-point tail.
    // Pixel dimensions must match a declared, validated matrix combination,
    // not a fractional multiplication of raw devicePixelRatio.
    const declared=[...r.lockMatrix,...r.historyMatrix].find(m=>
      m.width===s.before.width&&m.height===s.before.height&&m.reduced===s.before.reduced&&
      Math.abs(m.dpr-s.before.dpr)<=1e-6);
    assert(declared,"Screenshot lacks a matching validated display combination");
    validateNativeViewport(s.before,declared);
    assert.equal(s.png.width,declared.width*declared.dpr);assert.equal(s.png.height,declared.height*declared.dpr);
  }
  return { businessStages: 7, lockCases: 12, historyCases: 12, actualInstalledStarts: 3,
    controlledHttpRequests: 3, realDeepSeekRequests: 0, nativeNormalCloseClaimed: false };
}
async function main() {
  const [attempt = "01", audit = "01"] = process.argv.slice(2);
  assert.match(attempt, /^\d{2}$/); assert.match(audit, /^\d{2}$/);
  const runRoot = path.join(qa, `session-${attempt}`), out = path.join(qa, `audit-${audit}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const input = path.join(runRoot, "report.json"), r = read(input), prep = read(path.join(qa, "preparation.json"));
  const report = { status: "RUNNING", at: new Date().toISOString(), input: desc(input), groups: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  async function check(name, fn) {
    const g = { name, status: "RUNNING" }; report.groups.push(g); save();
    try { g.result = await fn(); g.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { g.status = "FAILED"; g.error = String(e.stack || e); throw e; } finally { save(); }
  }
  try {
    fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
    await check("Complete installed lifecycle evidence and rejection of invalid results", () => {
      const coverage = validate(r), mutations = [
        x => { x.cases = []; }, x => { delete x.finishedAt; }, x => { x.lockMatrix = []; },
        x => { x.historyMatrix.pop(); }, x => { x.historyMatrix[0] = x.historyMatrix[1]; },
        x => { x.lockMatrix[0].viewport.dpr = 1.5; }, x => { x.lockMatrix[0].geometry.focus = false; },
        x => { x.lockMatrix[0].geometry.rootInert = false; }, x => { x.historyMatrix[0].geometry.hit = false; },
        x => { x.historyMatrix[0].geometry.menu.left = -5; }, x => { x.launches[1] = x.launches[0]; },
        x => { x.launches[2].webview += "-other"; }, x => { x.launches[0].sourceServer = true; },
        x => { x.cleanups[0].normalCloseClaimed = true; }, x => { x.cleanups[0].status = "FAILED"; },
        x => { x.submissions[1].projectId = x.submissions[0].projectId; },
        x => { x.modelBoundary.find(m => !m.creation).tools = ["write"]; },
        x => { x.modelBoundary.find(m => m.marker === "QUEUE_C").marker = "QUEUE_B"; },
        x => { x.providerCleanup.maxConcurrentCreation = 2; }, x => { x.realModelRequests = 1; },
        x => { x.controlledWrites[0].endpoint = "https://api.deepseek.com/v1"; },
        x => { x.screenshots[0].png.width /= 2; }, x => { x.credentialCleanup = "NOT_CLEARED"; },
        x => { x.screenshots[0].before.dpr=1.5;x.screenshots[0].after.dpr=1.5; },
        x => { x.controlledWrites.filter(w => w.path.endsWith("/cancel"))[1].path =
          "/api/assistant/creation/processes/not-this-run/cancel"; },
      ];
      for (const mutate of mutations) { const bad = structuredClone(r); mutate(bad); assert.throws(() => validate(bad)); }
      return { ...coverage, invalidEvidenceRejected: mutations.length };
    });
    await check("Installed receipt, protected binaries, exact tools and sources", () => {
      if(options){
        require("./candidate-1930-exit.cjs").validateInstallation(options.installation);
        assert.equal(path.resolve(r.installation.path),path.resolve(options.installation));
        assert.deepEqual(prep.candidateBindings,[options.bindingFile,...["candidateConfig","installation","predecessor","exported","fixture"]
          .map(k=>options.binding[k].path)].map(desc));
      }
      assert.equal(sha(r.installation.path), r.installation.sha256);
      const install = read(r.installation.path); assert.equal(install.status, "PASS"); assert.equal(install.metadataRestoration, "PASS");
      for (const l of r.launches) {
        assert.equal(l.executable.sha256, install.executable.sha256);
        assert.equal(path.resolve(l.backend.ExecutablePath), path.resolve(install.installRoot, "creator-backend.exe"));
        assert.equal(sha(l.backend.ExecutablePath), l.backend.sha256);
      }
      for (const f of [...r.products, ...r.sources, ...r.inputs, ...r.tools]) assert.equal(sha(f.path), f.sha256, f.path);
      for (const f of r.tools) assert.equal(sha(path.join(runRoot, path.basename(f.path))), f.sha256);
      return { protectedDistinctPaths: new Set(r.products.map(f => path.resolve(f.path))).size, tools: r.tools.length };
    });
    await check("PNG physical pixels match actual WebView viewport and media sampling", () => {
      for (const s of r.screenshots) {
        assert.equal(sha(s.path), s.sha256); const b = fs.readFileSync(s.path);
        assert.equal(b.readUInt32BE(16), s.png.width); assert.equal(b.readUInt32BE(20), s.png.height);
      }
      return { screenshots: r.screenshots.length, physical4kScreenClaimed: false };
    });
    await check("Read-only SQLite copy: both authored projects and cleared synthetic secret", () => {
      const original = path.join(r.launches[0].data, "backend"), sqlite = path.join(out, "sqlite"); fs.mkdirSync(sqlite);
      for (const n of ["vn_engine.db", "vn_engine.db-wal", "vn_engine.db-shm"]) {
        const f = path.join(original, n); if (!fs.existsSync(f)) continue;
        const copy = path.join(sqlite, n); fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); assert.equal(sha(copy), sha(f));
      }
      const db = new DatabaseSync(path.join(sqlite, "vn_engine.db"), { readOnly: true });
      try {
        const secret = db.prepare("SELECT value FROM editor_shared_state WHERE key=?").get("provider_secrets");
        assert(secret); assert.deepEqual(JSON.parse(secret.value), {});
        const final = prep.projects.map(p => {
          const row = db.prepare("SELECT project_json FROM editor_project_details WHERE project_id=?").get(p.project_id); assert(row);
          const actual = JSON.parse(row.project_json), baseline = r.baselineProjects[p.project_id];
          for (const k of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(actual[k], baseline[k]);
          assert.deepEqual(authored(actual.nodes), authored(baseline.nodes)); return actual;
        });
        const tasks = db.prepare("SELECT id, project_id, status, started_at, finished_at FROM assistant_creation_processes ORDER BY sequence").all();
        assert.equal(tasks.length, 3);
        assert.deepEqual(tasks.map(t => t.id), r.submissions.map(s => s.id));
        assert.deepEqual(tasks.map(t => t.project_id), r.submissions.map(s => s.projectId));
        assert.deepEqual(tasks.map(t => t.status), ["completed", "cancelled", "completed"]);
        assert.equal(tasks[1].started_at, null, "Cancelled queued task must never have started");
        assert(tasks.every(t => t.finished_at < Date.parse(r.launches[1].at)),
          "All original terminal timestamps must precede both restarts and final cleanup requests");
        assert(tasks[0].finished_at <= tasks[2].started_at);
        const f = path.join(out, "persisted-projects.json"); fs.writeFileSync(f, JSON.stringify(final, null, 2), { flag: "wx" });
        return { projectCount: final.length, database: desc(path.join(sqlite, "vn_engine.db")),
          projects: desc(f), syntheticSecretEmpty: true, noAutomaticProposalMerge: true, persistedTerminalTasks: tasks,
          cleanupQualification: "Three redundant isolated-task terminal cancels were no-ops; timestamps unchanged since before first restart." };
      } finally { db.close(); }
    });
    await check("Exact process identities and every owned host/provider port are gone", () => {
      assert(r.knownProcesses.length > 0); const now = rows(), keys = new Set(r.knownProcesses.map(p => `${p.ProcessId}:${p.Created}`));
      assert(!now.some(p => keys.has(`${p.ProcessId}:${p.Created}`)));
      const ports = [...new Set([...r.launches.flatMap(l => l.ports), +new URL(r.modelEndpoint).port])];
      assert.equal(listeners(ports).length, 0);
      assert(!now.some(p => p.Name === "msedgewebview2.exe" && p.CommandLine?.includes(runRoot)));
      return { identitiesAbsent: keys.size, portsAbsent: ports, userFilesDeleted: 0 };
    });
    await check("Git HEAD/index are unchanged and recoverable checkpoints exist", () => {
      const g = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
      assert.equal(g.status, 0); assert.equal(g.stdout.trim(), prep.git.head);
      assert.equal(sha(prep.git.index.path), prep.git.index.sha256);
      for (const f of prep.snapshots) assert.equal(sha(f.path), f.sha256);
      if(currentCandidate){
        assert.equal(prep.guards.length,2);assert(prep.guards.every(g=>g.exitCode===0&&g.stdout.includes("PASS")));
        const cache=read(path.join(runRoot,"native-cache-restoration.json"));
        assert.equal(cache.status,"PASS");assert.equal(cache.deletedUserFiles,0);
        for(const file of cache.originalFiles)assert.equal(sha(path.join(cache.originalDirectory,file.relative)),file.sha256);
      }else{
        assert(fs.existsSync(path.join(qa, "inquiry-guard-red.log")));
        assert(fs.existsSync(path.join(qa, "inquiry-guard-green.log")));
      }
      return { head: prep.git.head, indexUnchanged: true, snapshots: prep.snapshots.length, pushed: false };
    });
    assert.equal(report.groups.length, 6); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error })); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
