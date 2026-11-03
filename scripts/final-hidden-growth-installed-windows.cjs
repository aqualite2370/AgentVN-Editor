"use strict";
// Final user-project acceptance, deliberately separate from isolated fixture guards.
// Import is through the real native file picker; no store/engine injection.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { loadProjectContainerSync } = require("./project-container.cjs");
assert.equal(process.argv.length, 5, "node script <fresh-output> <actual-installation-audit> <input-provenance.json>");
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1");
const root = path.resolve(__dirname, "..");
const [out, auditFile, provenanceFile] = process.argv.slice(2).map(p => path.resolve(p));
assert(A.inside(path.join(root, "output"), out) && !fs.existsSync(out));
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const evidence = file => ({ path: file, sha256: A.sha256(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, modifiedAt: fs.statSync(file).mtime.toISOString() });
const provenance = read(provenanceFile);
assert.equal(provenance.sourceSha256, "e1c43983ae8b7488c080c55889727d38915602596d873180e6062fff5a3df250");
assert.equal(evidence(provenance.source).sha256, provenance.sourceSha256);
assert.equal(evidence(provenance.output).sha256, provenance.outputSha256);
assert.equal(provenance.graphPreserved, true);
assert.equal(provenance.sourcePreserved, true);
const sourceProject = loadProjectContainerSync(provenance.output).project;
assert.equal(sourceProject.project_id, "project_msiz08p7_0_89ebc8a8cb");
assert.equal(sourceProject.title, "隐忍的成长");
assert.equal(sourceProject.nodes.length, 19);
assert.equal(sourceProject.edges.length, 21);
assert.equal(sourceProject.asset_manifest.length, 143);
assert.equal(provenance.assets.length, 143);
const audit = read(auditFile);
assert.equal(audit.status, "PASS");
const deployments = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
assert.equal(deployments.length, 1);
const installRoot = deployments[0].installedRoot;
assert.equal(evidence(path.join(installRoot, "agentvn-editor.exe")).sha256, deployments[0].executable.sha256);
fs.mkdirSync(out);
const session = path.join(out, "installed-session"); fs.mkdirSync(session);
fs.copyFileSync(auditFile, path.join(session, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
const input = path.join(session, path.basename(provenance.output));
fs.copyFileSync(provenance.output, input, fs.constants.COPYFILE_EXCL);
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE = sourceProject.title;
process.env.INSTALLED_ACCEPTANCE_HIGH_RES_ONLY = "1";
const reportFile = path.join(out, "report.json");
const report = { status: "PREPARING", startedAt: new Date().toISOString(),
  scope: "Final canonical hidden-growth copy, actual installed Release native UI and Windows export; player matrix pending",
  inputProvenance: evidence(provenanceFile), source: evidence(provenance.source), input: evidence(input),
  installationAudit: evidence(auditFile), installRoot, executable: evidence(path.join(installRoot, "agentvn-editor.exe")),
  project: { id: sourceProject.project_id, title: sourceProject.title, nodes: 19, edges: 21, assets: 143 },
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out, INSTALLED_ACCEPTANCE_HIGH_RES_ONLY: "1" },
  commands: [], cases: [], errors: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
let owner, browser, page;
async function command(name, executable, args) {
  const row = { name, command: [executable, ...args], status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(row); save();
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  try {
    const child = spawn(executable, args, { cwd: root, env: process.env, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    row.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(row.exitCode, 0, `See ${name}.log; keep original failure`);
    row.status = "PASS";
    console.log(`PASS: ${name}`);
  } catch (error) { row.status = "FAILED"; throw error; }
  finally { log.end(); row.finishedAt = new Date().toISOString(); save(); }
}
async function attach() {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${owner.state.cdpPort}`);
  const deadline = Date.now() + 60000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|tauri:/.test(p.url()));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page, "Actual installed WebView required"); page.setDefaultTimeout(90000);
  page.on("pageerror", error => { report.errors.push(String(error)); save(); });
  await page.setViewportSize({ width: 1920, height: 1080 });
}
async function detach() { await browser?.close(); browser = undefined; page = undefined; }
(async () => {
  save();
  const files = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const rel = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(rel); else files.push(rel);
    }
  }
  walk("GameCli_framework/src"); walk("shared");
  files.push("GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src-tauri/src/save_location.rs",
    "GameCli_framework/src-tauri/src/portable_save_migration.rs", "GameCli_framework/package.json");
  report.resources = files.map(relative => {
    const actual = evidence(path.join(installRoot, relative)), source = evidence(path.join(root, relative));
    assert.equal(actual.sha256, source.sha256, `Installed resource differs: ${relative}`);
    return { relative, sha256: actual.sha256 };
  });
  owner = await startInstalledEditor(session); report.owner = owner.state; save();
  await attach();
  await page.getByLabel("创建或打开项目").waitFor();
  const native = path.join(out, "native-import"); fs.mkdirSync(native);
  const pickerFile = path.join(native, "picker.json");
  const selected = command("native-project-picker", "powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/gui-directory-picker-uia.ps1"), "-OwnerPid", String(owner.state.editorPid),
    "-ReportPath", pickerFile, "-Directory", input, "-TitlePattern", "^选择 AgentVN 工程文件$", "-File"]);
  selected.catch(() => {});
  await page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }).click();
  await selected;
  const picker = read(pickerFile);
  assert.equal(picker.status, "PASS"); assert.equal(picker.ownerPid, owner.state.editorPid);
  assert.equal(path.resolve(picker.directory), input);
  await page.locator(".editor-toolbar").waitFor({ timeout: 180000 });
  await page.locator(".project-entry-loading-overlay").waitFor({ state: "hidden", timeout: 180000 });
  await A.settleEditor(page);
  const imported = await A.projectSnapshot(owner.state.backendPort);
  assert.equal(imported.projectId, sourceProject.project_id); assert.equal(imported.title, sourceProject.title);
  // Shared navigation state is not the persisted project-detail graph.
  const graphResponse = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/projects/${encodeURIComponent(sourceProject.project_id)}`,
    { signal: AbortSignal.timeout(10000) });
  assert(graphResponse.ok);
  const graph = (await graphResponse.json()).data;
  assert.equal(graph.nodes.length, 19); assert.equal(graph.edges.length, 21);
  assert.deepEqual(graph.nodes.map(n => n.id).sort(), sourceProject.nodes.map(n => n.id).sort());
  assert.deepEqual(graph.edges.map(e => e.id).sort(), sourceProject.edges.map(e => e.id).sort());
  report.importedGraph = { source: "Installed backend persisted project detail (read-only GET)",
    projectId: graph.project_id, nodes: graph.nodes.length, edges: graph.edges.length };
  assert.equal(imported.assetManifest.length, 143);
  const actualAssets = new Map(imported.assetManifest.map(a => [a.asset_id, a]));
  for (const asset of provenance.assets) {
    const current = actualAssets.get(asset.assetId);
    assert(current, `Imported asset identity lost: ${asset.assetId}`);
    assert.equal(A.sha256(await A.assetBytes(owner.state.backendPort, current)), asset.sha256);
  }
  report.cases.push({ name: "Native import, 19 nodes/21 edges/143 asset identities and actual bytes", status: "PASS",
    picker: evidence(pickerFile) }); save();
  await page.screenshot({ path: path.join(out, "installed-imported.png") });
  await detach();
  report.status = "INSTALLED_OPTIONS_MATRIX"; save();
  await command("installed-options-matrix", process.execPath, [path.join(root, "scripts/installed-editor-options-playwright.cjs"), session, input]);
  const options = fs.readdirSync(session).filter(n => n.startsWith("options-ui-"));
  assert.equal(options.length, 1);
  const optionsFile = path.join(session, options[0], "report.json"), optionsReport = read(optionsFile);
  assert.equal(optionsReport.ok, true); assert.equal(optionsReport.cases.length, 48);
  report.cases.push({ name: "Actual installed options eight pages at three resolutions and DPR1/2", status: "PASS",
    report: evidence(optionsFile), count: optionsReport.cases.length }); save();
  await attach();
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.locator(".cartridge-export-panel").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="package-environment-operation-dialog"]')
    || ["passed", "failed"].includes(document.querySelector(".package-primary-action")?.getAttribute("data-environment-status")),
  null, { timeout: 180000 });
  const env = page.getByTestId("package-environment-operation-dialog");
  if (await env.isVisible().catch(() => false)) {
    await page.waitForFunction(() => ["completed", "failed"].includes(
      document.querySelector('[data-testid="package-environment-operation-dialog"]')?.getAttribute("data-environment-phase")),
    null, { timeout: 180000 });
    report.environmentResult = await env.innerText(); save();
    assert.equal(await env.getAttribute("data-environment-phase"), "completed", report.environmentResult);
    await env.getByRole("button", { name: "完成", exact: true }).click(); await env.waitFor({ state: "detached" });
  }
  await detach(); report.status = "WINDOWS_EXPORT"; save();
  await command("windows-ui-export", process.execPath, [path.join(root, "scripts/installed-editor-windows-export-playwright.cjs"),
    session, path.join(session, "windows-export")]);
  const uiNames = fs.readdirSync(session).filter(n => n.startsWith("windows-export-ui-")); assert.equal(uiNames.length, 1);
  const uiFile = path.join(session, uiNames[0], "report.json"), ui = read(uiFile);
  assert.equal(ui.status, "RESULT_READY"); assert.match(ui.result, /Windows[\s\S]*构建成功/);
  assert(fs.existsSync(path.join(out, "source-cartridge-original-bytes.json")),
    "Capture and verify the original source cartridge during this build, before disposable source cleanup");
  const resourceAuditFile = path.join(out, "export-resource-review.json");
  await command("windows-artifact-audit", process.execPath,
    [path.join(root, "scripts/final-hidden-growth-windows-artifact-audit.cjs"), out, provenanceFile, resourceAuditFile]);
  const resourceAudit = read(resourceAuditFile);
  assert.equal(resourceAudit.status, "INSTALLED_FINAL_WINDOWS_EXPORT_AUDIT_PASS_RUNTIME_PENDING");
  report.export = { uiReport: evidence(uiFile), resourceAudit: evidence(resourceAuditFile),
    executable: resourceAudit.executable, cartridgeManifest: resourceAudit.manifest,
    script: resourceAudit.script, layout: resourceAudit.layout, sourceAssetsVerified: 143 };
  report.cases.push({ name: "Actual installed Windows export, original source bytes and optimized final resources", status: "PASS" });
  assert.deepEqual(report.errors, []);
  report.status = "INSTALLED_FINAL_WINDOWS_EXPORT_PASS_PLAYER_PENDING";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(() => "");
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  }
}).finally(async () => {
  await detach().catch(() => {});
  if (owner) report.cleanup = await owner.stop();
  report.sourcePreserved = evidence(provenance.source).sha256 === provenance.sourceSha256;
  report.inputPreserved = evidence(input).sha256 === provenance.outputSha256;
  if (!report.sourcePreserved || !report.inputPreserved) { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, reportFile, error: report.error }));
});
