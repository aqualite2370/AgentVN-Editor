"use strict";
// Real installed saved-project reload, including a latency-only fault. Saved
// project responses come from the real backend; no store or graph injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-control-closure.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Preview-1.9.35-20261102-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, "session-" + attempt);
const read = p => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const desc = p => ({ path: path.resolve(p), sha256: sha(p), bytes: fs.statSync(p).size });
async function main() {
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const installed = descriptor(), projects = ["A", "B"].map(letter => {
    const p = fixture("qa-current-preview-reload-1935-" + letter);
    p.title = "1.9.35预览工程重载_" + letter;
    p.nodes[1].id = "scene-" + letter;
    p.nodes[1].data.scene.scene_id = "reload_scene_" + letter;
    p.nodes[1].data.scene.commands[0].text = "RELOAD_OWNER_" + letter;
    p.edges[0].target = "scene-" + letter;
    return p;
  });
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), cases: [],
    launches: [], cleanups: [], errors: [], screenshots: [], productChanges: 0, builds: 0, modelRequests: 0,
    scope: "EXACT_INSTALLED_NATIVE_WEBVIEW_REAL_SAVED_PROJECT_RELOAD_AND_LATE_RESPONSE",
    viewportScope: "1920x1080 DPR1 ordinary; preview layout matrix covered separately, no replay",
    installation: desc(receipt), products: [installed.executable, ...installed.resources],
    tools: [__filename, path.join(__dirname, "lib/installed-release-session.cjs"),
      path.join(__dirname, "installed-layout-cache-session.ps1")].map(desc), cache: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const input = path.join(out, "工程重载隔离.vnproj");
  fs.writeFileSync(input, JSON.stringify(projects[0]), { flag: "wx" }); report.input = desc(input);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let page, release, responseGate, cachePrepared = false;
  const host = installedReleaseSession({ installationFile: receipt, out, report, save, input });
  function cache(action) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", action,
      "-RunDirectory", out, "-AllowedRunRoot", qa, "-PhysicalCache"];
    const result = spawnSync("powershell.exe", args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
    report.cache.push({ action, command: ["powershell.exe", ...args], exitCode: result.status,
      stdout: result.stdout, stderr: result.stderr }); save();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const content = p => {
    const nodes = structuredClone(p.nodes);
    for (const node of nodes) {
      // React Flow's measured dimensions are view metadata. Missing start-node
      // defaults are normalized on first open by the existing editor contract.
      if (node.measured !== undefined) {
        assert(Object.keys(node.measured).every(k => ["width", "height"].includes(k)));
        assert(Object.values(node.measured).every(n => Number.isFinite(n) && n > 0));
        delete node.measured;
      }
      if (node.data.nodeKind === "start") {
        node.data.loadingAnimation ??= { kind: "default" };
        node.data.openingAudio ??= [];
      }
    }
    return { project_id: p.project_id, title: p.title, nodes, edges: p.edges };
  };
  const baseline = content(projects[0]);
  for (const mutation of [
    p => { p.nodes[1].data.scene.commands[0].text = "WRONG_PROJECT_TEXT"; },
    p => { p.edges[0].target = "scene-B"; },
    p => { p.nodes[0].data.loadingAnimation = { kind: "none" }; },
  ]) {
    const changed = structuredClone(projects[0]); mutation(changed);
    assert.notDeepEqual(content(changed), baseline);
  }
  report.comparison = { viewFieldsExcluded: ["node.measured"],
    absentStartDefaults: { loadingAnimation: { kind: "default" }, openingAudio: [] },
    actualDataMutationsStillRejected: 3 };
  const savedProject = id => host.api("/api/project/projects/" + encodeURIComponent(id));
  const activeIds = () => page.locator(".react-flow__node").evaluateAll(nodes => nodes
    .filter(n => !n.closest("[data-editor-transition-snapshot],[data-transition-ghost]"))
    .map(n => n.getAttribute("data-id")).sort());
  async function open(project) {
    if (!await page.locator(".project-home").isVisible()) {
      await page.locator('[data-help-key="toolbar.home"]:visible').click();
      await page.locator(".project-home").waitFor();
    }
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await page.waitForFunction(ids => {
      const actual = [...document.querySelectorAll(".react-flow__node")]
        .filter(n => !n.closest("[data-editor-transition-snapshot],[data-transition-ghost]"))
        .map(n => n.getAttribute("data-id")).sort();
      return JSON.stringify(actual) === JSON.stringify(ids);
    }, project.nodes.map(n => n.id).sort());
  }
  async function preview() {
    await page.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(page);
    const panel = page.getByTestId("preview-launch-panel"); await panel.waitFor();
    const details = panel.locator(".preview-launch-maintenance");
    if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
    return panel;
  }
  async function step(name, fn) {
    const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log("START " + name);
    try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + name); }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  try {
    cache("SelfTest"); cachePrepared = true; cache("Prepare");
    page = await host.start();
    await step("Real backend stores two distinct projects; no model or Player starts", async () => {
      for (const p of projects) {
        const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
          method: "POST", headers: { "content-type": "application/octet-stream",
            "X-AgentVN-Filename": encodeURIComponent(p.title + ".vnproj") }, body: JSON.stringify(p),
        });
        assert(response.ok); const result = await response.json(); assert(result.ok);
        assert.equal(result.data.project_id, p.project_id);
      }
      await page.reload(); await page.locator(".project-home").waitFor();
      report.baselines = await Promise.all(projects.map(p => savedProject(p.project_id)));
      assert(!rows().some(p => p.Name === "agentvn-player.exe"));
      return { imported: projects.map(p => p.project_id), controlledFixtureImport: true };
    });
    await step("A to B to A reload uses current saved details without contaminating either graph", async () => {
      const results = [];
      for (const index of [0, 1, 0]) {
        const p = projects[index]; await open(p); const panel = await preview();
        await panel.locator('[data-help-key="preview.reload-project"]').click();
        await panel.locator(".gamecli-preview-progress.is-success").filter({ hasText: "重载完成" }).waitFor();
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        const ids = await activeIds(); assert.deepEqual(ids, p.nodes.map(n => n.id).sort());
        assert.deepEqual(content(await savedProject(p.project_id)), content(report.baselines[index]));
        assert.equal((await host.api("/api/project/state")).project_metadata.projectId, p.project_id);
        results.push({ projectId: p.project_id, nodeIds: ids, savedBytesEquivalent: true });
        await host.shot("reload-" + results.length);
      }
      return results;
    });
    await step("Late A reload cannot overwrite B graph or report old success in B", async () => {
      await open(projects[0]); const panel = await preview();
      let intercepted = false, heldRequest;
      responseGate = new Promise(resolve => { release = resolve; });
      const route = "**/api/project/projects/" + projects[0].project_id;
      let held = 0;
      await page.route(route, async request => {
        if (request.request().method() !== "GET" || held++) return request.continue();
        heldRequest = request.request();
        const response = await request.fetch(); assert(response.ok());
        const body = await response.json();
        assert.deepEqual(content(body.data), content(report.baselines[0]));
        intercepted = true;
        await responseGate;
        await request.fulfill({ response });
      });
      await panel.locator('[data-help-key="preview.reload-project"]').click();
      await until(() => intercepted, "actual A saved-project response held", 30000);
      await open(projects[1]);
      const before = await activeIds();
      const completed = page.waitForEvent("requestfinished", {
        predicate: request => request === heldRequest, timeout: 30000,
      });
      release(); await completed;
      // Await this exact held request, then allow its renderer promise to settle.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const after = await activeIds(); assert.deepEqual(after, before);
      assert.deepEqual(after, projects[1].nodes.map(n => n.id).sort());
      assert.equal((await host.api("/api/project/state")).project_metadata.projectId, projects[1].project_id);
      for (let i = 0; i < projects.length; i++)
        assert.deepEqual(content(await savedProject(projects[i].project_id)), content(report.baselines[i]));
      const notices = await page.locator('[role="alert"],[role="status"],.editor-notice,.notice-toast').allTextContents();
      assert(!notices.some(t => t.includes("已从后端重载工程：" + projects[0].title)));
      await page.unroute(route); await host.shot("late-a-reload-b-protected");
      return { fault: "Latency only on actual backend GET, no synthetic graph or model response",
        heldResponses: held, activeProject: projects[1].project_id, before, after, notices };
    });
    assert.equal(report.cases.length, 3); assert(report.cases.every(c => c.status === "PASS"));
    assert.equal(report.modelRequests, 0); assert(!rows().some(p => p.Name === "agentvn-player.exe"));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    release?.();
    try {
      await host.stop("End preview reload regression; attributed cleanup, not normal native close");
      if (cachePrepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) cache("Restore");
      const known = new Set((report.knownProcesses || []).map(p => `${p.ProcessId}:${p.Created}`));
      assert(!rows().some(p => known.has(`${p.ProcessId}:${p.Created}`)));
      assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []);
      for (const p of report.products) assert.equal(sha(p.path), p.sha256);
      report.cleanupVerified = true;
    } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) main();
