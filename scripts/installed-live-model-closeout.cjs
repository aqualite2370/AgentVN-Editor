"use strict";
// QA-only: verify failed work stayed isolated, restore endpoint, clear ONLY the
// blank-default-profile test connection, without reading or recording its key.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { readCurrentInstalledRealModelSession } = require("./lib/current-installed-real-model-session.cjs");
const run = path.resolve(__dirname, "../output/installed-real-model-20261019-01");
const out = path.join(run, "live-closeout.json");
assert(!fs.existsSync(out));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const report = { status: "RUNNING", scope: "ISOLATED_REAL_MODEL_SESSION_ONLY_NO_NEW_MODEL_CALL",
  startedAt: new Date().toISOString(), checks: [], credentialsRead: false,
  endpointRestored: false, isolatedCredentialCleared: false, error: null };
const save = () => fs.writeFileSync(out, JSON.stringify(report, null, 2));
let browser;
async function check(name, action) {
  try { const detail = await action(); report.checks.push({ name, status: "PASS", detail }); }
  catch (error) { report.checks.push({ name, status: "FAILED", error: String(error.message) }); }
  save();
}
async function get(route) {
  const r = await fetch("http://127.0.0.1:8278" + route, { signal: AbortSignal.timeout(10000) });
  assert(r.ok, `HTTP ${r.status} ${route}`); return r.json();
}
(async () => {
  const { state } = readCurrentInstalledRealModelSession(run);
  for (const fixturePath of [
    "F:/AgentVN-QA-InstalledRealModel-20261019-01/真实模型 隔离小工程.vnproj",
    "F:/AgentVN-QA-InstalledRealModel-20261019-01/真实Agent组件 隔离小工程.vnproj",
  ]) await check(`no-merge:${path.basename(fixturePath)}`, async () => {
    const expected = read(fixturePath), actual = (await get(`/api/project/projects/${expected.project_id}`)).data;
    for (const key of ["nodes", "edges", "asset_manifest"]) assert.deepEqual(actual[key], expected[key], key);
    for (const key of ["runtimeUILayoutProfiles", "runtimeUILayout"])
      assert.deepEqual(actual.editor_settings[key], expected.editor_settings[key], key);
    const title = actual.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title");
    assert(title.components.some(c => c.label === "开始游戏"));
    assert(!title.components.some(c => c.label === "开始创作" || /^创作(?:关于|帮助)卡$/.test(c.name || "")));
    return { projectId: actual.project_id, nodes: actual.nodes.length, edges: actual.edges.length,
      graphAndAssetsMatch: true, bothLayoutsMatch: true, startLabel: "开始游戏" };
  });
  await check("both-one-shot-processes-terminal", async () => {
    const { processes } = await get("/api/assistant/creation/processes");
    assert.equal(processes.length, 2);
    const items = processes.map(p => ({ id: p.id, projectId: p.projectId, status: p.status,
      errorCode: p.errorCode, toolEvents: p.toolEvents?.length ?? 0 }));
    assert(items.every(p => p.status === "failed" && p.errorCode === "provider_error"));
    return items;
  });
  await check("exactly-two-real-requests-no-retries-or-inflight", async () => {
    const transport = read("F:/AgentVN-QA-InstalledRealModel-20261019-01/model-transport/http-accounting.json");
    assert.equal(transport.attempts.length, 2); assert.equal(transport.automaticRetries, 0);
    assert(transport.attempts.every(a => a.status === "SUCCEEDED" && a.httpStatus === 200));
    return { requests: 2, totalTokens: transport.attempts.reduce((n, a) => n + a.usage.total_tokens, 0),
      automaticRetries: 0, novelRequests: 0 };
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const page = browser.contexts()[0].pages().find(p => /tauri\.localhost/.test(p.url()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator('[data-workspace-surface="options"]:visible').click(); await A.settleEditor(page);
  await page.locator(".workspace-task-panel.is-open .advanced-tools-panel > nav")
    .getByRole("button", { name: "模型/连接", exact: true }).click();
  await A.settleEditor(page);
  const connection = page.locator('[data-help-key="provider.selectConnection"]:visible')
    .filter({ hasText: "DeepSeek 隔离验收" });
  assert.equal(await connection.count(), 1);
  await connection.click();
  const endpoint = page.locator('input[data-help-key="provider.baseUrl"]:visible');
  const configuration = read(path.join(run, "relay-ui-configuration.json"));
  assert.equal(await endpoint.inputValue(), configuration.auditedBaseUrl);
  const restoreResponse = page.waitForResponse(r => r.request().method() === "POST"
    && r.url().endsWith("/api/project/state"));
  await endpoint.fill(configuration.originalBaseUrl);
  assert((await restoreResponse).ok());
  report.endpointRestored = true; save();
  // Never call inputValue() on the password field.
  await page.locator('input[data-help-key="provider.apiToken"]:visible').fill("");
  const clearResponse = page.waitForResponse(r => r.request().method() === "POST"
    && r.url().endsWith("/api/project/state"));
  await page.locator('[data-help-key="provider.save"]:visible').click();
  assert((await clearResponse).ok());
  await check("isolated-provider-cleared-and-endpoint-restored", async () => {
    const { data } = await get("/api/project/state?include_project=false&include_recent_projects=false");
    // Only count names. Do not inspect secret values or persist the payload.
    assert.equal(Object.keys(data.provider_secrets || {}).length, 0);
    const connections = data.provider_connections || [];
    assert.equal(connections.length, 1);
    assert.equal(connections[0].base_url, configuration.originalBaseUrl);
    report.isolatedCredentialCleared = true;
    return { persistedSecretCount: 0, baseUrl: connections[0].base_url,
      method: "real installed UI endpoint fill, empty password fill and Save" };
  });
  await check("frozen-product-and-dev-unchanged", async () => {
    const manifest = read(path.join(__dirname, "../output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(manifest.source.length, 560);
    for (const file of manifest.source) assert.equal(A.sha256(fs.readFileSync(file.path)), file.sha256, file.path);
    const dev = path.join(__dirname, "../AgentVN Dev.exe");
    const hash = A.sha256(fs.readFileSync(dev));
    assert.equal(hash, "ceb15d74880bbdee426c0a597734324878dec406583318992193c1cde432be96");
    return { sourceFiles: 560, dev, sha256: hash, installedExeSha256: state.executableSha256 };
  });
  report.status = report.checks.every(c => c.status === "PASS")
    && report.isolatedCredentialCleared && report.endpointRestored ? "PASS" : "FAILED";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify(report)); });
