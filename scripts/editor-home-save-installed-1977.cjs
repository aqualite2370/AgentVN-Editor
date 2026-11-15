"use strict";
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process"), net = require("node:net");
const assert = require("node:assert/strict");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const base = path.resolve(process.argv[2] || "");
const prior = path.resolve("F:/testavn/Windows-Isolated-1977-20261116-01");
const followup = base === path.resolve("F:/testavn/Windows-Isolated-1977-20261116-02");
assert(followup || base === prior);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const out = path.join(base, "resource-01"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const fixture = read(path.join(base, "fixture.vnproj")), candidate = read(path.join(base, "candidate.json"));
const report = { status: "RUNNING", scope: "ACTUAL_NSIS_1977_DEFAULT_QA_PROFILE_UI_HOME_SAVE_RACE_AND_RESTART_NOT_UPGRADE",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], writes: [], modelRequests: 0,
  computerUse: false, controlledNativeIPC: false, storeInjection: false, controlledRequestDelivery: true,
  startedAt: new Date().toISOString() };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let session, page, installation, backendPort, gate, blocked, active = 0, expected;
const current = () => session.api("/api/project/projects/" + fixture.project_id);
async function step(name, operation) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save();
  try { row.detail = await operation(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, `install-${action.toLowerCase()}.log`), (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "New" ? read(path.join(base, "install-new.json")) : undefined;
}
async function start(label) {
  session = defaultEditorSession({ installation, out, report, save, label, expectedQaUser: owner.account.name,
    isolatedBackendPort: backendPort });
  page = await session.start();
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
(async () => {
  save(); backendPort = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(e => e ? reject(e) : resolve(port)); });
  });
  await step("actual-nsis-install-and-exact-payload", async () => {
    if (followup) {
      const receipt = path.join(prior, "install-new.json"), failedRun = path.join(prior, "resource-01/report.json");
      assert.equal(read(failedRun).status, "FAILED");
      installation = read(receipt); assert.equal(installation.status, "PASS");
      report.inheritedInstall = { receipt: { path: receipt, sha256: sha(receipt) },
        failedRun: { path: failedRun, sha256: sha(failedRun) } };
      report.installations = 0;
    } else {
      install("Snapshot"); installation = install("New"); report.installations = 1;
    }
    assert.equal(installation.executable.version, "1.9.77");
    const payload = read(candidate.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload); assert.equal(sha(installation.executable.path), payload.executable.sha256);
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance])
      assert.equal(sha(path.join(installation.installRoot, resource.name)), resource.sha256);
    return { executable: installation.executable, exactPayload: true, upgradeClaim: false };
  });
  await step("default-profile-public-import-and-real-node-authoring", async () => {
    await start("first1977");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open();
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    await until(async () => (await current()).nodes.length === fixture.nodes.length + 1, "first authored scene actually saved");
    return { database: session.current.database, originalNodes: fixture.nodes.length, savedNodes: (await current()).nodes.length };
  });
  await step("late-home-snapshot-serialized-before-new-reopened-author-edits", async () => {
    await page.route(`http://127.0.0.1:${backendPort}/api/project/**`, async route => {
      const request = route.request(); if (!["PUT", "POST"].includes(request.method())) return route.continue();
      const row = { method: request.method(), url: request.url(), startedAt: Date.now(), activeAtStart: ++active,
        payload: request.postDataJSON() }; report.writes.push(row); save();
      const hold = gate && request.method() === "PUT" ? gate : undefined;
      if (hold) { gate = undefined; blocked = hold; hold.row = row; row.held = true; }
      try { if (hold) await hold.promise; const response = await route.fetch();
        row.httpStatus = response.status(); await route.fulfill({ response }); }
      finally { row.finishedAt = Date.now(); active--; save(); }
    });
    gate = deferred(); const held = gate;
    await page.locator("[data-help-key='toolbar.home']").click();
    await until(() => held.row, "actual home detail PUT held before backend delivery");
    await page.locator(".editor-toolbar").waitFor({ state: "detached" }); await open();
    await page.locator(".node-palette [data-help-key='palette.scene']").click();
    const title = "安装版迟到首页写入后保留的新场景";
    await page.locator(".inspector-panel input[data-help-key='field.title']").fill(title);
    await page.locator("[data-workspace-surface='options']").click(); await settleEditor(page);
    await until(() => page.locator("[data-workspace-surface='options']").getAttribute("aria-current").then(v => v === "page"),
      "real workspace ownership handoff flushes pending edits");
    assert(!report.writes.some(w => w !== held.row), "New project write waits behind the held home write");
    held.resolve();
    await until(async () => (await current()).nodes.some(n => n.data.scene?.title === title), "latest authored node saved after late home snapshot");
    await until(() => active === 0, "all actual project writes acknowledged");
    expected = await current();
    assert.equal(expected.nodes.length, fixture.nodes.length + 2);
    assert(report.writes.length >= 2 && report.writes.every(w => w.activeAtStart === 1));
    assert(!held.row.payload.nodes.some(n => n.data.scene?.title === title), "Held request must predate the new scene");
    await page.locator("[data-workspace-surface='edit']").click(); await settleEditor(page);
    await session.shot("home-save-ordering-preserved");
    await page.unrouteAll({ behavior: "wait" });
    return { title, retainedNodeIds: expected.nodes.map(n => n.id), writes: report.writes.length, maximumConcurrentWrites: 1 };
  });
  await step("first-normal-window-close", () => session.naturalClose());
  await step("same-default-profile-normal-restart-and-node-readback", async () => {
    await start("restart1977"); await open(); const value = await current();
    assert.deepEqual(value.nodes, expected.nodes); assert.deepEqual(value.edges, expected.edges);
    await session.shot("home-save-ordering-restarted");
    return { database: session.current.database, nodes: value.nodes.length };
  });
  await step("second-normal-window-close-and-registration-restored", async () => {
    const close = await session.naturalClose(); if (!followup) install("Restore"); return close;
  });
  assert.equal(report.stages.length, 6); assert(report.stages.every(s => s.status === "PASS"));
  assert.equal(report.errors.length, 0); assert.equal(report.blockedModelRequests || 0, 0);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; process.exitCode = 1; })
.finally(async () => {
  gate?.resolve(); blocked?.resolve();
  try {
    if (page && !page.isClosed()) await page.unrouteAll({ behavior: "wait" });
    await session?.stop();
    if (fs.existsSync(path.join(base, "metadata-before.json")) && !fs.existsSync(path.join(base, "metadata-restoration.json"))) install("Restore");
    report.cleanupStatus = "PASS";
  } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stages: report.stages.length, error: report.error, out }));
});
