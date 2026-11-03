"use strict";
// Installed UI only. Delay actual saved-project HTTP responses; never mutate a
// store, replace a graph response, or bypass the navigation ownership guard.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Preview-Ownership-1940-20261103-01";
const receipt = "F:/AgentVN/QA/Original-Component-Replay-20261103-01/installation-02/installation.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
function content(p) {
  const nodes = structuredClone(p.nodes);
  for (const n of nodes) {
    if (n.measured !== undefined) {
      assert(Object.keys(n.measured).every(k => ["width", "height"].includes(k)));
      assert(Object.values(n.measured).every(v => Number.isFinite(v) && v > 0));
      delete n.measured;
    }
    if (n.data.nodeKind === "start") {
      n.data.loadingAnimation ??= { kind: "default" };
      n.data.openingAudio ??= [];
    }
  }
  return { project_id: p.project_id, title: p.title, nodes, edges: p.edges };
}
async function main() {
  const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
  const out = path.join(qa, "session-" + attempt); assert(!fs.existsSync(out));
  const installation = verifiedInstalledCandidate(receipt);
  assert.equal(installation.executable.version, "1.9.40");
  fs.mkdirSync(out, { recursive: true });
  const checkpoint = path.resolve("F:/AgentVN/Checkpoints/Preview-Ownership-1940-20261103-01", attempt);
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  const protectedFiles = [__filename, path.join(root, "plans/ACTIVE_TASKS.md"),
    path.join(root, "editor/src/components/advanced/PreviewWindowControls.tsx"),
    path.join(root, "editor/src/components/editor/EditorToolbar.tsx"),
    path.join(root, "editor/src/api/backendClient.ts")];
  protectedFiles.forEach((f, i) => fs.copyFileSync(f, path.join(checkpoint, `${i}-${path.basename(f)}`),
    fs.constants.COPYFILE_EXCL));
  fs.writeFileSync(path.join(checkpoint, "manifest.json"), JSON.stringify({
    at: new Date().toISOString(), sources: protectedFiles.map(desc),
    installation: desc(receipt), products: [installation.executable, ...installation.resources],
    scope: "QA-only checkpoint, not a full workspace backup",
  }, null, 2), { flag: "wx" });
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(),
    scope: "ACTUAL_INSTALLED_RELOAD_NAVIGATION_GUARD_TIMEOUT_ABORT_RETRY",
    notClaimed: ["Cross-project un-aborted successful response: UI prevents that path",
      "Physical 4K display", "Natural host close", "Default database or installer upgrade",
      "External Player matrix", "Model quality", "Android"],
    installation: desc(receipt), products: [installation.executable, ...installation.resources],
    checkpoint, tools: protectedFiles.map(desc), cases: [], launches: [], cleanups: [],
    errors: [], screenshots: [], cache: [], productChanges: 0, builds: 0, modelRequests: 0 };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const projects = ["A", "B"].map(letter => {
    const p = fixture(`qa-preview-ownership-1940-${attempt}-${letter}`);
    p.title = "安装版重载归属_" + letter;
    p.nodes[1].id = "scene-" + letter;
    p.nodes[1].data.scene.scene_id = "reload_owner_" + letter;
    p.nodes[1].data.scene.commands[0].text = "RELOAD_OWNER_" + letter;
    p.edges[0].target = "scene-" + letter;
    return p;
  });
  const input = path.join(out, "重载归属隔离工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(projects[0]), { flag: "wx" }); report.input = desc(input);
  const host = installedReleaseSession({ installationFile: receipt, out, report, save, input });
  let page, cachePrepared = false, releaseHeld;
  async function cache(action) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
      "-RunDirectory", out, "-AllowedRunRoot", qa, "-PhysicalCache"];
    const log = path.join(out, `cache-${action}.log`), fd = fs.openSync(log, "wx");
    const child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", fd, fd] });
    fs.closeSync(fd);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", resolve);
    });
    report.cache.push({ action, args, exitCode: code, log: desc(log) }); save();
    assert.equal(code, 0, fs.readFileSync(log, "utf8"));
  }
  const saved = p => host.api("/api/project/projects/" + encodeURIComponent(p.project_id));
  const ids = () => page.locator(".react-flow__node").evaluateAll(nodes => nodes
    .filter(n => !n.closest("[data-editor-transition-snapshot],[data-transition-ghost]"))
    .map(n => n.getAttribute("data-id")).sort());
  async function open(p) {
    if (!await page.locator(".project-home").isVisible()) {
      await page.locator('[data-help-key="toolbar.home"]:visible').click();
      await page.locator(".project-home").waitFor();
    }
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: p.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await until(async () => JSON.stringify(await ids()) === JSON.stringify(p.nodes.map(n => n.id).sort()),
      "correct active project nodes", 10000);
  }
  async function preview() {
    await page.locator('[data-workspace-surface="preview"]:visible').click(); await settleEditor(page);
    const panel = page.getByTestId("preview-launch-panel"); await panel.waitFor();
    const details = panel.locator(".preview-launch-maintenance");
    if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
    return panel;
  }
  async function graphUnchanged() {
    for (let i = 0; i < projects.length; i++)
      assert.deepEqual(content(await saved(projects[i])), content(report.baselines[i]));
  }
  async function clickEvenWhenDisabled(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox(); assert(box && box.width && box.height);
    const target = await locator.evaluate(n => {
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { hit: n.contains(hit), disabled: n.matches(":disabled"),
        pointerEvents: getComputedStyle(n).pointerEvents, actualTarget: hit?.className,
        withinViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    assert(target.withinViewport, "Click point must be inside the real viewport");
    // Disabled controls may intentionally be pointer-events:none. Keep the real
    // click and state assertions, but do not demand browser hit ownership there.
    assert(target.hit || target.disabled && target.pointerEvents === "none", JSON.stringify(target));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return target;
  }
  async function step(name, fn) {
    const item = { name, status: "RUNNING" }; report.cases.push(item); save();
    console.log("START " + name);
    try { item.detail = await fn(); item.status = "PASS"; console.log("PASS " + name); }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
    finally { save(); }
  }
  async function holdActualResponse() {
    const route = "**/api/project/projects/" + projects[0].project_id;
    let release, done;
    const gate = new Promise(r => { release = r; }), finished = new Promise(r => { done = r; });
    const record = { calls: 0, held: false, finished: false };
    releaseHeld = release;
    await page.route(route, async intercepted => {
      if (intercepted.request().method() !== "GET") return intercepted.continue();
      record.calls++;
      if (record.calls !== 1) return intercepted.continue();
      record.startedAt = new Date().toISOString();
      try {
        const response = await intercepted.fetch(); assert(response.ok());
        const body = await response.json();
        assert.deepEqual(content(body.data), content(report.baselines[0]));
        record.responseSha256 = require("node:crypto").createHash("sha256")
          .update(await response.body()).digest("hex");
        record.held = true; await gate;
        await intercepted.fulfill({ response });
        record.fulfilled = true;
      } catch (e) { record.transportError = String(e); }
      finally { record.finished = true; record.finishedAt = new Date().toISOString(); done(); }
    });
    return { record, async release() { release(); await finished; releaseHeld = undefined; },
      async stop() { release(); if (record.calls) await finished; await page.unroute(route); } };
  }
  try {
    save(); await cache("SelfTest"); cachePrepared = true; await cache("Prepare");
    page = await host.start();
    await step("Real installed host and backend import two distinct isolated projects", async () => {
      for (const p of projects) {
        const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
          method: "POST", headers: { "content-type": "application/octet-stream",
            "X-AgentVN-Filename": encodeURIComponent(p.title + ".vnproj") }, body: JSON.stringify(p),
        });
        assert(response.ok); const r = await response.json(); assert(r.ok);
        assert.equal(r.data.project_id, p.project_id);
      }
      await page.reload(); await page.locator(".project-home").waitFor();
      report.baselines = await Promise.all(projects.map(saved));
      return { backend: host.current.backend, projectIds: projects.map(p => p.project_id) };
    });
    const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
      [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
    assert.equal(matrix.length, 12);
    for (const m of matrix) await step(`Pending reload retains owner ${m.width} DPR${m.dpr} reduce=${m.reduced}`, async () => {
      const actual = await host.metrics(m); await open(projects[0]); const panel = await preview();
      const held = await holdActualResponse();
      try {
        const button = panel.locator('[data-help-key="preview.reload-project"]');
        await button.click(); await until(() => held.record.held, "actual saved response held", 10000);
        await until(() => button.isDisabled(), "reload disabled while pending", 10000);
        held.record.repeatClick = await clickEvenWhenDisabled(button);
        held.record.homeClick = await clickEvenWhenDisabled(page.locator('[data-help-key="toolbar.home"]:visible'));
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        assert(!await page.locator(".project-home").isVisible(), "Pending reload must keep its project");
        assert.equal(held.record.calls, 1, "Repeated click cannot start another request");
        await held.release();
        assert(!held.record.transportError, held.record.transportError);
        await panel.locator(".gamecli-preview-progress.is-success").filter({ hasText: "重载完成" }).waitFor();
        assert(await button.isEnabled());
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        assert.deepEqual(await ids(), projects[0].nodes.map(n => n.id).sort());
        await graphUnchanged();
        await host.shot(`owner-${m.width}-${m.dpr}-${m.reduced}`);
        await open(projects[1]);
        assert.deepEqual(await ids(), projects[1].nodes.map(n => n.id).sort());
        return { actual, response: held.record, homeBlocked: true, duplicateBlocked: true,
          subsequentProject: projects[1].project_id };
      } finally { await held.stop(); }
    });
    for (const reduced of [false, true]) await step(`Timeout releases navigation, late transport cannot change B, retry reduce=${reduced}`, async () => {
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced });
      await open(projects[0]); const panel = await preview(), held = await holdActualResponse();
      try {
        await panel.locator('[data-help-key="preview.reload-project"]').click();
        await until(() => held.record.held, "actual timeout response held", 10000);
        await panel.locator(".gamecli-preview-progress.is-error").filter({ hasText: "重载失败" }).waitFor({ timeout: 30000 });
        const error = await panel.innerText(); assert.match(error, /20 秒|20秒/);
        assert(await panel.locator('[data-help-key="preview.reload-project"]').isEnabled());
        await open(projects[1]); const before = await ids();
        await held.release();
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        assert.deepEqual(await ids(), before); assert.deepEqual(before, projects[1].nodes.map(n => n.id).sort());
        assert.equal((await host.api("/api/project/state")).project_metadata.projectId, projects[1].project_id);
        await graphUnchanged();
        await host.shot("timeout-b-protected-" + reduced);
        await held.stop();
        await open(projects[0]); const retry = await preview();
        await retry.locator('[data-help-key="preview.reload-project"]').click();
        await retry.locator(".gamecli-preview-progress.is-success").filter({ hasText: "重载完成" }).waitFor();
        await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
        assert.deepEqual(await ids(), projects[0].nodes.map(n => n.id).sort()); await graphUnchanged();
        return { error, response: held.record, activeAfterTimeout: projects[1].project_id,
          retryProject: projects[0].project_id, scope: "Native fetch abort; no claim of un-aborted cross-project commit" };
      } finally { await held.stop(); }
    });
    assert.equal(report.cases.length, 15); assert(report.cases.every(c => c.status === "PASS"));
    assert.equal(report.modelRequests, 0); assert.equal(report.errors.length, 0);
    report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    releaseHeld?.();
    try {
      await host.stop("Installed reload QA completed; owned termination, not a natural-close test");
      if (cachePrepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) await cache("Restore");
      const identities = new Set((report.knownProcesses || []).map(p => `${p.ProcessId}:${p.Created}`));
      assert(!rows().some(p => identities.has(`${p.ProcessId}:${p.Created}`)));
      assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []);
      for (const f of report.products) assert.equal(sha(f.path), f.sha256);
      report.cleanupVerified = true;
    } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
      error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
