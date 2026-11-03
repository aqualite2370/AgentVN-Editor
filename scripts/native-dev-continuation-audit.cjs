"use strict";
// Re-read raw evidence, not an aggregation of unchecked PASS labels.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Native-Dev-Continuation-20261020-01";
const summary = path.join(root, "output/native-dev-continuation-20261020-01");
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const iteration = process.argv[2]; assert(/^\d{2}$/.test(iteration || ""));
const out = path.join(qa, `audit-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const receipt = { status: "RUNNING", at: new Date().toISOString(), checks: [], productChanges: 0,
  newBuilds: 0, modelRequests: 0, scope: "CURRENT_NATIVE_DEV_DOM_AND_RESTART_ONLY_NOT_INSTALLED_OR_PHYSICAL",
  notProven: ["Release install/upgrade/default user database", "Native chooser or physical Windows input",
    "External Player or standalone Windows/Android export", "Full motion intermediate-frame regression",
    "Live model behavior", "Native file/ticket/fallback import transaction"] };
function check(name, fn) {
  const c = { name, status: "RUNNING" }; receipt.checks.push(c);
  try { c.detail = fn(); c.status = "PASS"; } catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
}
try {
  const prep = read(path.join(summary, "preparation.json"));
  const smokeFile = path.join(qa, "smoke-01/report.json"), fullFile = path.join(qa, "full-01/report.json");
  const smoke = read(smokeFile), full = read(fullFile);
  const visualFile = path.join(qa, "visual-01/report.json"), visual = read(visualFile);
  const closeFile = path.join(qa, "close-01/report.json"), close = read(closeFile);
  check("Recoverable snapshots and exact current Dev identity remain intact", () => {
    for (const f of [...prep.saved, prep.input, ...prep.products, ...prep.sources]) assert.equal(sha(f.path), f.sha256);
    assert.equal(prep.products[0].sha256, prep.products[1].sha256);
    for (const f of [smoke, full, visual, close]) { assert.equal(f.executable.sha256, prep.products[0].sha256);
      for (const s of f.sources) assert.equal(sha(s.path), s.sha256); }
    const originalRunner = prep.saved.find(s => s.path.endsWith("scripts\\native-dev-continuation.cjs")); assert(originalRunner);
    for (const d of ["smoke-01", "full-01"])
      assert.equal(sha(path.join(qa, d, "executed-test.cjs")), originalRunner.sha256);
    const visualSource = describe(path.join(qa, "visual-01/executed-test.cjs"));
    const closeSource = describe(path.join(root, "scripts/native-dev-continuation.cjs"));
    assert.equal(sha(path.join(qa, "close-01/executed-test.cjs")), closeSource.sha256);
    return { products: prep.products, sources: prep.sources, snapshotCount: prep.saved.length,
      originalRunner, visualCollector: visualSource, boundedCloseObserver: closeSource,
      qualification: "Explicit QA revisions add screenshot-only branch and bounded natural-exit observer; original executions retain exact source snapshots" };
  });
  check("All twelve actual WebView combinations and ninety-six real tool clicks", () => {
    assert.equal(smoke.status, "PASS"); assert.equal(smoke.cases.length, 1);
    assert.equal(full.status, "PASS"); assert.equal(full.cases.length, 12);
    const expected = [1920, 2560, 3840].flatMap(w => [1, 2].flatMap(d => [false, true].map(r => JSON.stringify([w, w * 9 / 16, d, r]))));
    assert.deepEqual(full.cases.map(c => JSON.stringify([c.width, c.height, c.dpr, c.reduced])).sort(), expected.sort());
    for (const c of full.cases) {
      assert.equal(c.status, "PASS");
      assert.deepEqual(c.tabs.map(t => t.tab), ["settings", "layout", "theme", "assets", "library", "animation", "providers", "history"]);
      for (const t of c.tabs) { assert(t.geometry.inside && t.geometry.hit);
        assert(t.workspace.paletteVisible && t.workspace.inspectorVisible);
        assert(!t.workspace.paletteClipped && !t.workspace.paletteCoveredByPanel && !t.workspace.inspectorCoveredByPanel);
        assert(!t.workspace.horizontalOverflow); }
      assert(c.assistant.inquiryVisible && c.assistant.creationVisible);
      assert.equal(c.backendProject.project_id, "native-dev-continuation-20261020-01");
      assert.equal(c.backendProject.nodes.find(n => n.id === "scene").data.scene.title, `原生持久化 ${c.key}`);
    }
    return { evidence: describe(fullFile), displayCombinations: 12, actualToolClicks: 96,
      note: "Final geometry/hit assertions; does not certify continuous animation frames or Agent execution" };
  });
  check("PNG pixels and actual raw DPR/media match all requested combinations", () => {
    const images = [];
    assert.equal(visual.status, "FAILED"); assert.equal(visual.cases.length, 12);
    assert.match(visual.error, /Owned processes survive actual close/);
    assert.equal(visual.scope, "CURRENT_NATIVE_DEV_OPTIONS_STABLE_SCREENSHOTS_ONLY_NOT_FULL_FUNCTION_MATRIX");
    assert.deepEqual(visual.cases.map(c => [c.width, c.height, c.dpr, c.reduced]),
      full.cases.map(c => [c.width, c.height, c.dpr, c.reduced]));
    for (const run of [smoke, full, visual]) for (const c of run.cases) {
      const s = c.screenshot, b = fs.readFileSync(s.path);
      assert.equal(sha(s.path), s.sha256); assert.deepEqual(s.before, s.after);
      assert.equal(s.before.width, c.width); assert.equal(s.before.height, c.height);
      assert(Math.abs(s.before.dpr - c.dpr) <= 1e-6); assert.equal(s.before.reduced, c.reduced);
      assert.equal(b.readUInt32BE(16), c.width * c.dpr); assert.equal(b.readUInt32BE(20), c.height * c.dpr);
      if (run === visual) {
        assert.equal(c.target, "Stable options > game client layout");
        assert(c.workspace.paletteVisible && c.workspace.inspectorVisible && !c.workspace.horizontalOverflow);
      }
      images.push({ ...describe(s.path), purpose: run === visual ? "stable options workspace" : "home-entry sample, may contain entrance motion" });
    }
    return { images, count: images.length, stableOptionsCount: 12, rawFloatingPointRetained: true,
      note: "CDP viewports inside actual WebView, not physical monitor resolutions" };
  });
  check("Six normal closes release native-owned backend/frontend/WebView trees and same-profile restart restores actual edits", () => {
    const databases = [];
    assert.equal(close.status, "PASS");
    assert.equal(close.scope, "CURRENT_NATIVE_DEV_BOUNDED_NORMAL_CLOSE_RESTART_ONLY_NO_DISPLAY_MATRIX");
    assert.equal(close.normalCloseAssertions.length, 2);
    assert(close.normalCloseAssertions.every(c => c.status === "PASS"));
    for (const run of [smoke, full, close]) {
      const finalTitle = run === close ? "场景" : `原生持久化 ${run.cases.at(-1).key}`;
      assert.equal(run.launches.length, 2);
      const [a, b] = run.launches; assert.notEqual(a.pid, b.pid);
      assert.equal(a.data, b.data); assert.equal(a.webview, b.webview);
      assert(a.data.startsWith(path.resolve(qa)) && a.webview.startsWith(path.resolve(qa)));
      for (const l of run.launches) {
        assert.equal(l.normalExit.exitCode, 0); assert.deepEqual(l.normalExit.survivors, []);
        assert(l.tree.length > 2); assert.equal(l.listeners.length, 3);
        assert(l.listeners.every(p => l.tree.some(t => p.OwningProcess === t.ProcessId)));
        assert(l.tree.some(p => /msedgewebview2\.exe$/i.test(p.Name) && p.CommandLine.includes(l.webview)));
        assert(l.capabilities.includes(`backend-base-url=http://127.0.0.1:${l.backend}`));
      }
      assert.equal(run.afterProcessRestart.id, "native-dev-continuation-20261020-01");
      assert.equal(run.afterProcessRestart.nodes.find(n => n.id === "scene").data.scene.title,
        finalTitle);
      // Reopening and returning home legitimately writes a later snapshot.
      // Preserve the first-close SHA as history; verify final bytes via read-only SQL,
      // rather than demanding equality with a file the tested UI later modified.
      const db = new DatabaseSync(run.databaseAfterClose.path, { readOnly: true });
      try {
        const rows = db.prepare("SELECT project_id,project_json FROM editor_project_details").all();
        assert.equal(rows.length, 1);
        const p = JSON.parse(rows[0].project_json);
        assert.equal(p.project_id, "native-dev-continuation-20261020-01");
        assert.equal(p.nodes.find(n => n.id === "scene").data.scene.title,
          finalTitle);
        assert.deepEqual(p.edges, run.afterProcessRestart.edges);
        databases.push({ firstCloseHistorical: run.databaseAfterClose,
          finalDatabase: describe(run.databaseAfterClose.path), rowCount: rows.length,
          projectId: p.project_id, sceneTitle: p.nodes.find(n => n.id === "scene").data.scene.title,
          sqlMethod: "node:sqlite readOnly SELECT, no migrations or writes" });
      } finally { db.close(); }
      assert.equal(run.closeMethod, "Process.CloseMainWindow WM_CLOSE, not physical input");
    }
    const oldExit = visual.launches[0].normalExit; assert.equal(oldExit.survivors.length, 2);
    assert(oldExit.survivors.every(p => p.Name === "msedgewebview2.exe"));
    assert.equal(visual.cleanup.status, "PASS"); assert.deepEqual(visual.cleanup.killed, []);
    return { smoke: describe(smokeFile), full: describe(fullFile), close: describe(closeFile), normalCloses: 6, databases,
      originalVisualRun: { ...describe(visualFile), status: "FAILED_PRESERVED",
        reason: "Two WebView processes observed at strict point-in-time assertion; both exited without cleanup killing",
        noRetrospectivePass: true, noVisualRunRestartClaim: true },
      note: "Native CloseMainWindow, not physical Alt+F4; actual new startup uses same isolated database and profile" };
  });
  check("Current processes/ports are absent and all current/frozen products still match source provenance", () => {
    const all = [...smoke.known, ...full.known, ...visual.known, ...close.known];
    const ports = [...new Set([...smoke.cleanup.ports, ...full.cleanup.ports, ...visual.cleanup.ports, ...close.cleanup.ports])];
    const pidList = [...new Set(all.map(p => p.ProcessId))];
    const state = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `$p=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -in @(${pidList.join(",")})} | ` +
      "Select-Object ProcessId,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}});" +
      `$l=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {$_.LocalPort -in @(${ports.join(",")})});` +
      "@{processes=$p;listeners=$l}|ConvertTo-Json -Depth 4 -Compress"],
      { encoding: "utf8", windowsHide: true }));
    assert(!state.processes.some(p => all.some(k => k.ProcessId === p.ProcessId && k.Created === p.Created)));
    assert.equal(state.listeners.length, 0);
    for (const r of [smoke, full, visual, close]) { assert.equal(r.cleanup.status, "PASS"); assert.equal(r.modelRequests, 0);
      assert.deepEqual(r.cleanup.killed, []); assert.deepEqual(r.cleanup.survivors, []); }
    const provenanceFile = "F:/AgentVN/QA/Repair-Candidate-Preflight-20261020-09/audit.json", a = read(provenanceFile);
    assert.equal(a.provenanceStatus, "PASS"); assert.equal(a.fullAcceptance, false);
    assert.deepEqual(a.historical.counts, { FAILED: 9, BLOCKED: 6, PASS: 3 });
    for (const p of a.artifactChecks) assert.equal(sha(p.path), p.sha256);
    return { ownedProcessIdentities: all.length, ports, state, provenance: describe(provenanceFile),
      qualification: "No claim of Release/default-profile/independent-machine or paid-model acceptance" };
  });
  receipt.status = "NATIVE_DEV_LIMITED_PASS";
} catch (e) { receipt.status = "FAILED"; receipt.error = String(e.stack || e); process.exitCode = 1; }
finally {
  receipt.finishedAt = new Date().toISOString();
  receipt.auditSource = describe(__filename);
  fs.copyFileSync(__filename, path.join(out, "executed-audit.cjs"), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify(receipt, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: receipt.status, checks: receipt.checks.map(c => ({ name: c.name, status: c.status })), error: receipt.error }));
}
