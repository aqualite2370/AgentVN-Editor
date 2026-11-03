"use strict";
// Reuse the installed UI/native full-story seams, never the legacy-save
// migration workflow or a source/Dev substitute for the actual installation.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const { validateWindowsPrerequisite } = require("./lib/installed-windows-prerequisite.cjs");
const root = path.resolve(__dirname, "..");
assert.equal(process.argv.length, 5, "node script <fresh-output> <actual-installer-resource-report> <fixture-report>");
assert.notEqual(process.env.E5_LIFECYCLE_SOURCE, "1", "Actual installed product only");
const [out, auditFile, fixtureFile] = process.argv.slice(2).map(p => path.resolve(p));
assert(A.inside(path.join(root, "output"), out));
assert(!fs.existsSync(out), "Do not overwrite historical acceptance");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const evidence = file => ({ path: file, sha256: A.sha256(fs.readFileSync(file)) });
const fixture = read(fixtureFile), audit = read(auditFile);
assert.equal(fixture.status, "FIXTURE_VALIDATED");
assert(fixture.projectId.startsWith("installed_resource_flow_story_"), "Isolated full-story fixture required");
assert.equal(evidence(fixture.input).sha256, fixture.sha256);
assert.equal(audit.status, "PASS");
const deployments = audit.deployments.filter(d => d.kind === "NSIS actual isolated installation");
assert.equal(deployments.length, 1);
const deployed = deployments[0], installRoot = deployed.installedRoot;
assert.equal(evidence(path.join(installRoot, "agentvn-editor.exe")).sha256, deployed.executable.sha256);
fs.mkdirSync(out);
const session = path.join(out, "nsis-session-01"); fs.mkdirSync(session);
fs.copyFileSync(auditFile, path.join(session, "installer-resource-report.json"), fs.constants.COPYFILE_EXCL);
fs.copyFileSync(fixtureFile, path.join(out, "fixture-report.json"), fs.constants.COPYFILE_EXCL);
const input = path.join(session, path.basename(fixture.input));
fs.copyFileSync(fixture.input, input, fs.constants.COPYFILE_EXCL);
const reportFile = path.join(out, "report.json"), exportFile = path.join(out, "windows-installed-report.json");
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "Actual NSIS installed UI export and native full-story matrix; no legacy AppData migration",
  sourceFixture: evidence(fixtureFile), fixture, input: evidence(input),
  installationAudit: evidence(auditFile), installRoot, executable: evidence(path.join(installRoot, "agentvn-editor.exe")),
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out,
    INSTALLED_ACCEPTANCE_PROJECT_TITLE: fixture.title },
  commands: [], cases: [], errors: [] };
const exported = { status: "RUNNING", startedAt: report.startedAt, fixture, installRoot,
  installationAudit: report.installationAudit };
let owner, browser, page;
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
const saveExport = () => fs.writeFileSync(exportFile, JSON.stringify(exported, null, 2));
async function command(name, args, extraEnv = {}) {
  const row = { name, command: [process.execPath, ...args], status: "RUNNING", startedAt: new Date().toISOString() };
  report.commands.push(row); save();
  const log = fs.createWriteStream(path.join(out, `${name}.log`), { flags: "wx" });
  try {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true,
      env: { ...process.env, ...report.environment, FULL_STORY_ATTEMPT: "",
        E5_LIFECYCLE_SOURCE: "", FULL_STORY_FIXTURE_REPORT: fixtureFile, FULL_STORY_SESSION: "nsis-session-01", ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"] });
    row.pid = child.pid; save();
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    row.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("close", resolve);
    });
    assert.equal(row.exitCode, 0, `See ${name}.log; preserve original failure`);
    row.status = "PASS"; console.log(`PASS: ${name}`);
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
  assert(page, "Actual installed WebView unavailable"); page.setDefaultTimeout(60000);
  page.on("pageerror", error => { report.errors.push(String(error)); save(); });
  await page.setViewportSize({ width: 1920, height: 1080 });
}
async function detach() { await browser?.close(); browser = undefined; page = undefined; }
(async () => {
  save(); saveExport();
  // Assert every runtime/shared resource against this installation before UI work.
  const relativeFiles = [];
  function walk(relative) {
    for (const item of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const rel = path.join(relative, item.name);
      if (item.isDirectory()) walk(rel); else relativeFiles.push(rel);
    }
  }
  walk("GameCli_framework/src"); walk("shared");
  relativeFiles.push("GameCli_framework/package.json", "GameCli_framework/package-lock.json",
    "GameCli_framework/src-tauri/src/lib.rs", "GameCli_framework/src-tauri/src/save_location.rs",
    "GameCli_framework/src-tauri/src/portable_save_migration.rs", "scripts/prepare-runtime-compat-licenses.cjs");
  report.resources = relativeFiles.map(relative => {
    const source = evidence(path.join(root, relative)), installed = evidence(path.join(installRoot, relative));
    assert.equal(installed.sha256, source.sha256, `Installed source drift: ${relative}`);
    return { relative, sha256: source.sha256 };
  });
  owner = await startInstalledEditor(session); report.owner = owner.state; save();
  await attach();
  await page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }).click({ trial: true });
  await A.settleEditor(page);
  await page.screenshot({ path: path.join(out, "installed-home.png") });
  await detach();
  await command("native-project-import", [path.join(__dirname, "installed-p1-native-input.cjs"),
    session, "open", input, path.join(session, "native-import")]);
  const snapshot = await A.projectSnapshot(owner.state.backendPort);
  assert.equal(snapshot.projectId, fixture.projectId); assert.equal(snapshot.title, fixture.title);
  assert.equal(snapshot.assetManifest.length, fixture.assets.length);
  report.imported = { projectId: snapshot.projectId, title: snapshot.title }; save();
  await attach();
  await page.getByRole("button", { name: "发布", exact: true }).click();
  await page.locator(".cartridge-export-panel").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="package-environment-operation-dialog"]')
    || ["passed", "failed"].includes(document.querySelector(".package-primary-action")?.getAttribute("data-environment-status")),
  null, { timeout: 180000 });
  const environment = page.getByTestId("package-environment-operation-dialog");
  if (await environment.isVisible().catch(() => false)) {
    await page.waitForFunction(() => ["completed", "failed"].includes(
      document.querySelector('[data-testid="package-environment-operation-dialog"]')?.getAttribute("data-environment-phase")),
    null, { timeout: 180000 });
    report.environmentResult = await environment.innerText(); save();
    assert.equal(await environment.getAttribute("data-environment-phase"), "completed", report.environmentResult);
    await environment.getByRole("button", { name: "完成", exact: true }).click();
    await environment.waitFor({ state: "detached" });
  }
  await page.screenshot({ path: path.join(out, "installed-before-windows-export.png") });
  await detach();
  await command("windows-ui-export", [path.join(__dirname, "installed-editor-windows-export-playwright.cjs"),
    session, path.join(session, "windows-export")]);
  const reports = fs.readdirSync(session).filter(n => n.startsWith("windows-export-ui-"));
  assert.equal(reports.length, 1);
  const uiFile = path.join(session, reports[0], "report.json"), ui = read(uiFile);
  assert.equal(ui.status, "RESULT_READY"); assert.match(ui.result, /Windows[\s\S]*构建成功/);
  report.exportReport = evidence(uiFile);
  const cart = path.join(session, "windows-export/portable/embedded-cartridge");
  const manifest = read(path.join(cart, "manifest.json")), script = read(path.join(cart, "script.json"));
  assert.equal(manifest.game_id, fixture.projectId); assert.equal(script.scenes.length, fixture.scenes.length);
  for (const asset of manifest.assets) {
    assert(A.inside(cart, path.join(cart, asset.path)), "Unsafe exported asset path");
    assert.equal(evidence(path.join(cart, asset.path)).sha256, asset.hash_sha256);
  }
  exported.cartridge = { manifest, scriptSha256: evidence(path.join(cart, "script.json")).sha256,
    layoutSha256: evidence(path.join(cart, "ui/layout.json")).sha256 };
  exported.exportReport = uiFile; exported.status = "INSTALLED_WINDOWS_EXPORT_PASS_RUNTIME_PENDING";
  exported.finishedAt = new Date().toISOString(); saveExport();
  report.editorCleanup = await owner.stop(); owner = undefined;
  assert.equal(report.editorCleanup.editor.exitCode, 0); assert.equal(report.editorCleanup.backend.exitCode, 0);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const row = { width, height, dpr, reduced, status: "RUNNING" };
      report.cases.push(row); save();
      const previous = new Set(fs.readdirSync(out));
      await command(`native-story-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`,
        [path.join(__dirname, "installed-full-story-runtime-playwright.cjs"), out],
        { INSTALLED_ACCEPTANCE_VIEWPORT_WIDTH: String(width), INSTALLED_ACCEPTANCE_VIEWPORT_HEIGHT: String(height),
          INSTALLED_ACCEPTANCE_DPR: String(dpr), INSTALLED_ACCEPTANCE_REDUCED_MOTION: reduced ? "1" : "" });
      const fresh = fs.readdirSync(out).filter(n => n.startsWith("full-story-runtime-") && !previous.has(n));
      assert.equal(fresh.length, 1);
      const file = path.join(out, fresh[0], "report.json"), runtime = read(file);
      assert.equal(runtime.status, "INSTALLED_FULL_STORY_RUNTIME_PASS");
      assert(runtime.cases.length > 0 && runtime.cases.every(c => c.status === "PASS"));
      assert.equal(runtime.cleanupExitCode, 0);
      assert.deepEqual(runtime.viewport, { width, height, dpr, reduced });
      row.report = evidence(file); row.status = "PASS"; save();
    }
  }
  assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []);
  report.status = "INSTALLED_CURRENT_WINDOWS_PASS"; save();
  report.prerequisiteValidation = validateWindowsPrerequisite(reportFile, { auditFile, fixture });
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.pageText = await page.locator("body").innerText().catch(() => "");
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  }
}).finally(async () => {
  await detach().catch(() => {});
  if (owner) report.editorCleanup = await owner.stop();
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, reportFile, error: report.error }));
});
