"use strict";
// Credential handoff only: real installed UI, blank default profiles and a
// traceable isolated project. No secret reads, model requests or API mocks.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const root = path.resolve(__dirname, "..");
const run = path.join(root, "output/installed-real-model-20261019-01");
const work = "F:/AgentVN-QA-InstalledRealModel-20261019-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const reportFile = path.join(run, "credential-handoff.json");
const report = { status: "RUNNING", scope: "CREDENTIAL_HANDOFF_NOT_MODEL_ACCEPTANCE",
  startedAt: new Date().toISOString(), checks: [], realModelRequests: 0,
  productChanges: 0, computerUseStatus: "BLOCKED_NATIVE_PIPE_UNAVAILABLE",
  requestedTasks: ["existing-control-edit", "new-component-agent", "novel-parse"],
  error: null };
let browser;
function save() {
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
}
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  row.detail = await fn(); row.status = "PASS"; save();
  console.log(`PASS ${name}`);
}
(async () => {
  assert(!fs.existsSync(reportFile), "Never overwrite previous handoff evidence");
  assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT || ""), run);
  const input = path.resolve(work, "真实模型 隔离小工程.vnproj");
  assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT || ""), input);
  const prep = read(path.join(run, "preparation.json"));
  const launch = read(path.join(run, "launch.json"));
  await stage("Blank default profiles protected; installed host and source identity", async () => {
    assert.equal(prep.status, "PASS"); assert.equal(prep.blankDefaultProfiles, true);
    assert.equal(prep.projectSource, null); assert.equal(prep.qaSeed.length, 0);
    assert.equal(prep.profiles.length, 4); assert.equal(prep.verifiedOriginalFiles, 55);
    for (const row of prep.profiles) for (const file of row.files) {
      assert.equal(sha256(fs.readFileSync(path.join(row.held, file.relative))), file.sha256);
      assert.equal(sha256(fs.readFileSync(file.backup)), file.sha256);
    }
    assert.equal(launch.status, "PASS");
    assert(!launch.dataDirectoryOverride && !launch.webviewDirectoryOverride && !launch.manualBackendSpawn);
    assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))),
      launch.executableSha256);
    const actual = read(path.join(root, "output/full-regression-20261017-01/candidate-02/manifest.json"));
    assert.equal(actual.source.length, 560);
    for (const file of actual.source) assert.equal(sha256(fs.readFileSync(file.path)), file.sha256);
    assert.equal(sha256(fs.readFileSync(path.join(root, "AgentVN Dev.exe"))), prep.originalDevSha256);
    const current = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId=${Number(launch.editorPid)}"|ForEach-Object {@{ProcessId=$_.ProcessId;ExecutablePath=$_.ExecutablePath;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json`],
    { encoding: "utf8", windowsHide: true, timeout: 15000 }));
    const owned = launch.processes.find(p => p.ProcessId === launch.editorPid);
    assert.equal(current.ProcessId, launch.editorPid);
    assert.equal(current.ExecutablePath, owned.ExecutablePath);
    assert.equal(current.createdUtc, owned.createdUtc);
    report.installed = { root: launch.installRoot, executableSha256: launch.executableSha256,
      editorPid: launch.editorPid, cdpPort: launch.cdpPort, backendPort: launch.backendPort,
      defaultPathsIsolatedByWholeProfiles: true };
    return { originalFiles: 55, frozenProductSources: 560, devUnchanged: true };
  });
  await stage("Known isolated fixture imported into the real packaged backend", async () => {
    const source = read(path.join(root, "output/installed-assistant-session-20261018-01/fixtures.json")).projects[0];
    const bytes = fs.readFileSync(source.input); assert.equal(sha256(bytes), source.sha256);
    const project = JSON.parse(bytes);
    assert.equal(project.asset_manifest?.length ?? 0, 0);
    assert(project.nodes.length > 0 && project.nodes.length <= 10);
    project.project_id = "installed-real-model-20261019-01";
    project.title = "真实模型验收隔离小工程";
    assert(!/api_key|provider_secrets|sk-[a-z0-9]/i.test(JSON.stringify(project)),
      "Only a credential-free project fixture may be imported");
    const inputBytes = Buffer.from(JSON.stringify(project, null, 2));
    fs.writeFileSync(input, inputBytes, { flag: "wx" });
    report.project = { path: input, id: project.project_id, title: project.title, sha256: sha256(inputBytes) };
    const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: inputBytes, signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    assert(response.ok && result.ok && result.data.project_id === project.project_id);
    return { projectId: project.project_id, nodes: project.nodes.length,
      inputSha256: report.project.sha256, method: "public project import; not product UI flow acceptance" };
  });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  const pages = browser.contexts().flatMap(c => c.pages()).filter(p => /tauri\.localhost/.test(p.url()));
  assert.equal(pages.length, 1);
  const page = pages[0]; page.setDefaultTimeout(20000);
  // Never read request bodies or headers: they can contain provider secrets.
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && (
      /\/api\/assistant\/(query|creation\/processes)$/.test(pathname)
      || /\/api\/novel.*(process|jobs|generate)/.test(pathname))) report.realModelRequests++;
  });
  await stage("Real Home -> project -> top Options -> Models/Connections; no model submission", async () => {
    await page.reload();
    await page.locator(".recent-project-open:not(:disabled):visible")
      .filter({ hasText: report.project.title }).click();
    await page.locator(".editor-toolbar").waitFor();
    await page.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay")
      && !document.querySelector(".app-transition-stage.is-switching"));
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .advanced-tools-panel");
    await panel.getByRole("button", { name: "模型/连接", exact: true }).click();
    await settleEditor(page);
    const providers = page.locator(".workspace-task-panel.is-open .provider-settings-panel");
    await providers.waitFor();
    assert.equal(await providers.locator(".provider-connection-list button").count(), 0,
      "Blank isolated profile must not contain any original connections");
    await providers.getByRole("button", { name: "新增连接", exact: true }).click();
    await providers.locator('[data-help-key="provider.connectionName"]').fill("DeepSeek 隔离验收");
    const token = providers.locator('[data-help-key="provider.apiToken"]');
    await token.waitFor(); assert.equal(await token.getAttribute("type"), "password");
    const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
      dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
    assert(actual.width >= 1920);
    // Capture before user credential entry only. No traces, HAR or secret state dumps.
    const cdp = await page.context().newCDPSession(page);
    report.screenshot = await captureInstalledWebview(page, cdp,
      path.join(run, "before-credential-entry.png"), actual);
    assert.equal(report.realModelRequests, 0);
    return { inputType: "password", actualViewport: actual,
      interaction: "Playwright CDP real installed WebView, NOT physical Computer Use input",
      noCredentialReadOrCapture: true, modelSubmissions: 0 };
  });
  report.status = "WAITING_USER_CREDENTIALS";
  report.originalProfiles = "HELD_AND_HASH_VERIFIED_NOT_YET_RESTORED";
})().catch(error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
    realModelRequests: report.realModelRequests, error: report.error, report: reportFile }, null, 2));
});
