"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const action = process.argv[2]; assert(["close-old", "restart"].includes(action));
const guidance = process.argv[3] === "preflight-guidance";
assert(process.argv[3] === undefined || guidance);
if (guidance) assert.equal(action, "restart", "No old live Dev is part of this delivery");
const version = guidance ? "1.9.55" : "1.9.54";
const base = guidance ? "F:/AgentVN/QA/Dev-Delivery-1955-20261108-01" : "F:/AgentVN/QA/Dev-Delivery-1954-20261108-01";
const privateBase = guidance ? "F:/AgentVN/Checkpoints/Dev-Delivery-1955-20261108-01"
  : "F:/AgentVN/Checkpoints/Dev-Delivery-1954-20261108-01";
const output = path.join(base, `${action}.json`); assert(!fs.existsSync(output));
const read = p => JSON.parse(fs.readFileSync(p, "utf8"));
const target = read("F:/AgentVN/Checkpoints/Novel-Range-Restore-Default-20261108-02/completed-outline.vnproj");
const report = { action, status: "RUNNING", models: 0, startedAt: new Date().toISOString(), known: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
let browser, host;
const identity = p => `${p.ProcessId}:${p.Created}`;
function verifyProject(project) {
  assert.equal(project.project_id, target.project_id);
  assert.deepEqual(project.nodes.map(n => n.id), target.nodes.map(n => n.id));
  assert.deepEqual(project.edges, target.edges);
  for (const n of target.nodes) {
    const current = project.nodes.find(v => v.id === n.id);
    assert.deepEqual(current.data, n.data); assert.deepEqual(current.position, n.position);
  }
  const actual = project.editor_settings.novelPersistence.sessionSnapshot;
  const expected = target.editor_settings.novelPersistence.sessionSnapshot;
  for (const k of ["document", "ai_chunk_analyses", "outline_partials", "ai_outline", "ai_stage"])
    assert.deepEqual(actual[k], expected[k], k);
}
async function disk() {
  const response = await fetch(`http://127.0.0.1:8278/api/project/projects/${target.project_id}`);
  assert(response.ok); const body = await response.json(); assert(body.ok); verifyProject(body.data); return body.data;
}
async function close(owner) {
  report.known = ownedProcessTree(rows(), owner.ProcessId, owner.Created); assert(report.known.length);
  save();
  assert.equal(ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${owner.ProcessId}';` +
    `if($p.CreationDate.ToUniversalTime().ToString('o') -ne '${owner.Created}'){throw 'PID identity changed'};` +
    `(Get-Process -Id ${owner.ProcessId}).CloseMainWindow()`), "True");
  await browser?.close(); browser = undefined;
  await until(() => {
    const now = rows();
    report.survivors = report.known.filter(p => now.some(a => identity(a) === identity(p)));
    report.listeners = listeners([6767, 8278, 61954]); save();
    return !report.survivors.length && !report.listeners.length;
  }, "natural close and owned services released", 45000);
  report.normalClose = true;
}
(async () => {
  try {
    if (action === "close-old") {
      assert.equal(read(path.join(base, "prepare.json")).status, "PASS");
      assert.equal(read("F:/AgentVN/QA/Novel-Range-Restore-Default-20261108-05/report.json").status, "PASS_SUPPORTED_HOME_RESTORE");
      const old = read("F:/AgentVN/QA/Novel-Range-Live-20261108-01/report.json");
      const owner = old.known.find(p => p.ProcessId === old.host.pid);
      assert(rows().some(p => identity(p) === identity(owner)));
      const project = await disk();
      fs.writeFileSync(path.join(privateBase, "before-natural-close.vnproj"), JSON.stringify(project), { flag: "wx" });
      await close(owner);
    } else {
      assert.equal(read(path.join(base, "verify.json")).status, "PASS");
      assert.equal(listeners([6767, 8278, 61954]).length, 0);
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
      env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=61954";
      const fd = fs.openSync(path.join(base, "restart-host.log"), "wx");
      host = spawn("D:/AgentVN/AgentVN Dev.exe", [], { cwd: "D:/AgentVN", env, windowsHide: true, stdio: ["ignore", fd, fd] });
      fs.closeSync(fd); report.host = { pid: host.pid }; save();
      let owner;
      await until(() => {
        assert.equal(host.exitCode, null);
        owner ||= rows().find(p => p.ProcessId === host.pid);
        if (!owner) return false;
        report.known = ownedProcessTree(rows(), owner.ProcessId, owner.Created);
        const live = listeners([6767, 8278, 61954]); save();
        return live.length === 3 && live.every(l => report.known.some(p => p.ProcessId === l.OwningProcess));
      }, "new Dev automatic owned services", 150000);
      assert(report.known.some(p => p.CommandLine?.includes(`--webview-exe-version=${version}`)));
      browser = await chromium.connectOverCDP("http://127.0.0.1:61954");
      const page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes(":6767")), "Dev document");
      page.setDefaultTimeout(60000);
      await page.locator(".project-home").waitFor();
      await page.locator('[data-help-key="home.openDraft"]:not(:disabled)').waitFor();
      assert.equal(await page.evaluate(async () => (await import("/src/store/projectStore.ts")).useProjectStore.getState().projectId), target.project_id);
      await page.locator('[data-help-key="home.openDraft"]').click();
      await page.locator(".editor-toolbar").waitFor();
      await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await page.locator('[data-help-key="toolbar.novelImport"]').click();
      await page.getByTestId("novel-import-workbench").waitFor();
      await page.waitForFunction(() => window.__AGENTVN_NOVEL_IMPORT_STORE__?.getState().session?.outline_partials?.batches?.length === 90);
      const session = await page.evaluate(() => {
        const state = window.__AGENTVN_NOVEL_IMPORT_STORE__.getState();
        if (state.isProcessing) throw Error("No generation should be running"); return state.session;
      });
      for (const k of ["document", "ai_chunk_analyses", "outline_partials", "ai_outline", "ai_stage"])
        assert.deepEqual(session[k], target.editor_settings.novelPersistence.sessionSnapshot[k], k);
      const project = await disk();
      fs.writeFileSync(path.join(privateBase, "after-native-restart.vnproj"), JSON.stringify(project), { flag: "wx" });
      report.result = { scans: 85, batches: 90, chapters: 113, needsReview: true, version }; save();
      await close(owner);
    }
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); report.liveHostRetainedOnFailure = true; process.exitCode = 1; }
  finally { await browser?.close(); report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify(report)); }
})();
