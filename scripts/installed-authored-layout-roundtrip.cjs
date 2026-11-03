"use strict";
// Continue a finished installed author run through native project save, a fresh
// isolated database and actual UI exports. Never rewrite its original evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { deriveActual } = require("./installed-profile-data-replay.cjs");
const { validateCandidateConfig } = require("./candidate-layout-consumption.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const describe = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const config = validateCandidateConfig(read(process.argv[2]));
const priorFile = path.resolve(process.argv[3]), attempt = process.argv[4];
const guiAuthor = process.argv[5] === "--gui-author";
const roleAuthor = process.argv[5] === "--role-author";
assert.equal(process.argv.length, guiAuthor || roleAuthor ? 6 : 5);
assert.match(attempt || "", /^\d{2}$/);
assert.equal(path.dirname(path.dirname(priorFile)), path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01"));
assert.match(path.basename(path.dirname(priorFile)), /^editor-\d{2}$/);
assert.equal(path.basename(priorFile), "report.json");
const prior = read(priorFile), installed = deriveActual(config.actual, config.version);
assert.equal(prior.status, guiAuthor ? "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN" : "PASS");
assert.equal(guiAuthor || roleAuthor ? prior.version : prior.candidateVersion, config.version);
assert(prior.finishedAt && prior.nativeCacheRestoration === "PASS" && !prior.cleanupError);
assert.equal(prior.modelRequests, 0); assert.deepEqual(prior.errors, []);
assert.equal(prior.matrix.length, 12);
if(roleAuthor) {
  assert.equal(sha(prior.installation.path), prior.installation.sha256);
  const authorInstall = read(prior.installation.path);
  assert.equal(authorInstall.version, config.version);
  assert.deepEqual(authorInstall.actualInstallation, config.actual);
  assert.deepEqual(authorInstall.executable, installed.executable);
  assert.deepEqual(authorInstall.resources, installed.resources);
  assert.equal(prior.cases.length, 4);
  assert(prior.cases.every(c => c.status === "PASS" && c.finishedAt));
  const roles = ["title_action", "page_navigation", "category_pagination", "story_choice", "quick_bar", "modal_action"];
  assert.deepEqual(Object.keys(prior.expected), roles);
  assert.deepEqual(prior.authored.settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonRoles, prior.expected);
  assert.equal(prior.authored.assetManifest.length, 0);
  assert(prior.launches.every(l => l.executable.sha256 === installed.executable.sha256));
  for (const row of prior.matrix) {
    assert.equal(row.status, "PASS");
    assert.equal(row.controls.length, 24);
    for (const role of roles) for (const state of ["normal", "hover", "selected", "disabled"]) {
      const matches = row.controls.filter(c => c.role === role && c.state === state);
      assert.equal(matches.length, 1);
      assert.deepEqual(matches[0].values,
        Object.fromEntries(Object.entries(prior.expected[role].states[state]).map(([k, v]) => [k, String(v)])));
    }
  }
} else if(guiAuthor) {
  assert.equal(prior.steps.length,8);assert(prior.steps.every(s=>s.status==="PASS"&&s.finishedAt));
  assert.equal(prior.savedProject.assetManifest.length,26);assert.equal(prior.assetProofs.length,26);
  assert(prior.launches.every(l=>l.executable.sha256===installed.executable.sha256));
} else {
  assert.equal(prior.pages.length,264);
  assert(prior.pages.every(p=>p.status==="PASS"&&p.preview.savedStyleConsumed));
  assert.deepEqual(read(prior.installation),installed);
}
const authoredProfiles=roleAuthor?prior.authored.settings.runtimeUILayoutProfiles:
  guiAuthor?prior.savedProject.settings.runtimeUILayoutProfiles:prior.profiles;
const sourceRoot = path.dirname(priorFile), sourceInput = prior.launches[0].isolation.AGENTVN_TEST_PROJECT;
assert.equal(path.dirname(path.resolve(sourceInput)), sourceRoot);
const project = read(sourceInput);
assert.equal(project.asset_manifest.length, 0, "The original seed is empty; real author resources come from its retained database");
const out = path.resolve("F:/AgentVN/QA/Installed-Layout-20261021-01", `editor-${attempt}`);
assert.notEqual(out, sourceRoot, "Never reuse or overwrite the author evidence directory");
fs.mkdirSync(out, { recursive: false });
const inventory = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  assert(!fs.lstatSync(file).isSymbolicLink(), "Do not follow source archive links");
  return entry.isDirectory() ? inventory(file) : [describe(file)];
}).sort((a, b) => a.path.localeCompare(b.path));
const sourceFiles = inventory(path.join(sourceRoot, "data"));
fs.cpSync(path.join(sourceRoot, "data"), path.join(out, "data"), { recursive: true, errorOnExist: true, force: false });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const receipt = path.join(out, "derived-actual-installation.json");
fs.writeFileSync(receipt, JSON.stringify(installed, null, 2), { flag: "wx" });
const report = { status: "RUNNING", version: config.version, startedAt: new Date().toISOString(),
  source: describe(priorFile), installation: describe(config.actual.path), sourceFiles,
  authorKind: roleAuthor ? "six-button-roles" : guiAuthor ? "gui" : "page-layout",
  cases: [], launches: [], cleanups: [], knownProcesses: [], screenshots: [], errors: [], cartridges: [],
  modelRequests: 0, productChanges: 0, builds: 0,
  scope: "ACTUAL_INSTALLED_NATIVE_VNPROJ_SAVE_FRESH_PUBLIC_REIMPORT_AND_TWO_UI_CARTRIDGE_EXPORTS",
  boundaries: ["No native file-picker claim: fresh reimport uses the packaged public backend",
    "No standalone Player/setup/Android or full display-matrix claim",
    "Explicit isolated database and WebView; owned termination is not normal window close",
    guiAuthor ? "26 actual GUI dependencies verified in saved/reopened project; exported active dependencies checked"
      : "Fixture contains no asset dependencies; resource byte coverage is separate"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, page, prepared = false, pendingDownload;
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve(__dirname, "installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function stage(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + name); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function start(directory) {
  owner = installedReleaseSession({ installationFile: receipt, out: directory, input: sourceInput, report, save });
  page = await owner.start();
}
async function openProject() {
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
  await A.settleEditor(page);
  const value = await A.projectSnapshot(owner.current.ports[0]);
  assert.equal(value.projectId, project.project_id);
  assert.deepEqual(value.settings.runtimeUILayoutProfiles, authoredProfiles);
  if(guiAuthor) {
    assert.equal(value.assetManifest.length,26);
    const resources=[];
    for(const asset of value.assetManifest) {
      const expected=prior.assetProofs.find(f=>f.id===asset.asset_id);assert(expected);
      const bytes=await A.assetBytes(owner.current.ports[0],asset);
      assert.equal(A.sha256(bytes),expected.sha256);
      const root=path.resolve(owner.current.data,"backend/project_assets");
      const backendPath=asset.metadata.backend_asset_path;
      assert(typeof backendPath==="string"&&backendPath.split(/[\\/]/).every(p=>p&&p!=="."&&p!==".."));
      // A copied database can retain its author's absolute metadata.filePath.
      // Check this session's actual served copy via the public backend path;
      // do not read that archived absolute path as the destination's evidence.
      const file=path.resolve(root,backendPath),relative=path.relative(root,file);
      assert(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative));
      assert(!fs.lstatSync(file).isSymbolicLink());
      assert.equal(sha(file),expected.sha256);
      resources.push({id:asset.asset_id,sha256:expected.sha256,file:describe(file),
        metadataFilePath:asset.metadata.filePath,servedByOwnedBackend:true});
    }
    (report.projectResources??=[]).push({launch:owner.current.pid,resources});save();
  }
  return value;
}
function retainDownload() {
  if (!pendingDownload) return;
  const { original, retained, sha256 } = pendingDownload;
  assert.equal(sha(original), sha256);
  if (!fs.existsSync(retained)) fs.copyFileSync(original, retained, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(retained), sha256);
  fs.unlinkSync(original);
  report.downloadCleanup = { status: "PASS", original, retained, sha256, deletedUserFiles: 0 };
  pendingDownload = undefined; save();
}
async function switchLayout(type) {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
  if (await button.getAttribute("aria-pressed") !== "true") await button.click();
  await page.waitForFunction(type => document.querySelector(".runtime-layout-designer")?.dataset.layoutType === type
    && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false", type);
  await A.settleEditor(page);
  const value = await A.projectSnapshot(owner.current.ports[0]);
  assert.deepEqual(value.settings.runtimeUILayoutProfiles.profiles, authoredProfiles.profiles);
  assert.equal(value.settings.runtimeUILayoutProfiles.activeType, type);
}
async function publish(type) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
  const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
  await until(async () => {
    const dialog = page.getByTestId("package-environment-operation-dialog");
    if (await dialog.isVisible()) {
      const phase = await dialog.getAttribute("data-environment-phase");
      if (!["completed", "failed"].includes(phase)) return false;
      await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    }
    try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
    return panel.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual installed publish settings", 180000);
  await panel.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warnings.isVisible()) await warnings.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  const directory = path.join(out, `cartridge-${type}`); fs.mkdirSync(directory);
  const download = await A.realDownload(page, owner.cdp, directory, panel.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(download.path), { checkCRC32: true });
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  // The established format omits the default AgentVN discriminator.
  assert.equal(layout.layout_type ?? "agentvn", type);
  const expectedCount=guiAuthor&&type==="renpy"?prior.cartridge.assets.length:0;
  assert.equal(manifest.assets.length,expectedCount);
  const resources=[];
  for(const asset of manifest.assets) {
    const expected=prior.assetProofs.find(f=>f.id===asset.asset_id);assert(expected);
    const bytes=await zip.file(asset.path).async("nodebuffer");
    assert.equal(A.sha256(bytes),expected.sha256);resources.push({...asset,sha256:expected.sha256,bytes:bytes.length});
  }
  const expected = oracle.normalizeUISkinLayoutForRuntime(authoredProfiles.profiles[type]).layout;
  assert.deepEqual(layout, JSON.parse(JSON.stringify(expected)));
  const checksum = JSON.parse(await zip.file("checksum.json").async("string"));
  assert.equal(checksum.algorithm, "sha256"); assert(checksum.files.length > 0);
  for (const f of checksum.files)
    assert.equal(A.sha256(await zip.file(f.path).async("nodebuffer")), f.hash_sha256, f.path);
  assert(!JSON.stringify(layout).includes("runtimeUILayoutProfiles"));
  const value = { type, ...download, layoutSha256: A.sha256(await zip.file("ui/layout.json").async("nodebuffer")),
    runtimeVersion: manifest.runtime_version, checksumEntries: checksum.files.length, actualUiExport: true,resources };
  report.cartridges.push(value); await owner.shot(`export-${type}`); return value;
}
const compiled = buildSync({ stdin: { resolveDir: installed.installRoot, loader: "ts",
  contents: 'export { normalizeUISkinLayoutForRuntime } from "./shared/cartridge/uiSkin";' },
bundle: true, platform: "node", format: "cjs", write: false, metafile: true });
const oracleModule = { exports: {} };
new Function("module", "exports", compiled.outputFiles[0].text)(oracleModule, oracleModule.exports);
const oracle = oracleModule.exports;
report.installedOracleSources = Object.keys(compiled.metafile.inputs).filter(f => !f.startsWith("<"))
  .map(f => describe(path.resolve(f)));
(async () => {
  save(); cache("SelfTest"); prepared = true; cache("Prepare"); await start(out);
  await stage("Original actual author data opens unchanged in this candidate", openProject);
  await stage("Native project save retains both full profiles and clears its owned default download", async () => {
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    assert(path.isAbsolute(downloads) && fs.statSync(downloads).isDirectory());
    const before = new Set(fs.readdirSync(downloads));
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const confirmation = await dialog.innerText();
    report.nativeSaveConfirmation = confirmation; save();
    const match = confirmation.match(/[A-Za-z]:\\[^\r\n]+?\.vnproj/);
    assert(match, "Actual save confirmation must identify the written package");
    const original = path.resolve(match[0]), filename = path.basename(original), retained = path.join(out, filename);
    assert.equal(path.dirname(original), path.resolve(downloads));
    assert(!before.has(filename), "Never retain or remove a preexisting download");
    assert(fs.statSync(original).isFile());
    pendingDownload = { original, retained, sha256: sha(original) }; save();
    retainDownload();
    report.portable = describe(retained);
    const zip = await JSZip.loadAsync(fs.readFileSync(retained), { checkCRC32: true });
    const document = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(document.editor_settings.runtimeUILayoutProfiles, authoredProfiles);
    assert.equal(document.project_id, project.project_id); assert.equal(document.asset_manifest.length, guiAuthor?26:0);
    for(const asset of document.asset_manifest) {
      const expected=prior.assetProofs.find(f=>f.id===asset.asset_id);assert(expected);
      assert.equal(A.sha256(await zip.file(asset.metadata.project_path).async("nodebuffer")),expected.sha256);
    }
    assert(!Object.keys(zip.files).some(f=>/gui-pack-library|record\.json/.test(f)));
    assert(!JSON.stringify(document).includes("projectExportDirectories"));
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    return { portable: report.portable, bothLayoutsPreserved: true };
  });
  await stage("Fresh database public reimport restores the native portable author result", async () => {
    await owner.stop("Owned fresh-profile boundary, not normal close"); owner = undefined; page = undefined;
    const fresh = path.join(out, "fresh-profile"); fs.mkdirSync(fresh);
    assert(!fs.existsSync(path.join(fresh, "data")));
    report.freshDatabaseBeforeStartAbsent = true; save();
    await start(fresh);
    const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(report.portable.path)) },
      body: fs.readFileSync(report.portable.path), signal: AbortSignal.timeout(30000) });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === project.project_id);
    await page.reload();
    const result=await openProject();
    if(guiAuthor) {
      assert(!fs.existsSync(path.join(owner.current.data,"gui-pack-library")));
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem("agentvn.projectExportDirectories.v1")||"{}")),{});
      report.localLibraryNotBundled=true;
    }
    return result;
  });
  for (const type of ["agentvn", "renpy"]) await stage(`Real ${type} layout switch and UI export retain all authored regions`, async () => {
    if (await page.getByRole("button", { name: "关闭发布与打包", exact: true }).isVisible())
      await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click();
    await switchLayout(type); return publish(type);
  });
  assert.equal(report.cases.length, 5); assert.equal(report.cartridges.length, 2);
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  report.status = "PASS_LIMITED_NATIVE_PROJECT_ROUNDTRIP_AND_UI_CARTRIDGE_EXPORT";
  report.guiResourceCoverage=guiAuthor?{projectDependencies:26,renpyExportDependencies:prior.cartridge.assets.length,
    projectResourceStages:report.projectResources.length,personalLibraryBundled:false}:null;
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000);
    await owner.shot("failure").catch(e => report.captureError = String(e));
  }
}).finally(async () => {
  const errors = [];
  for (const cleanup of [() => retainDownload(), () => owner?.stop("finally"),
    () => { if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; } },
    () => { assert.equal(sha(priorFile), report.source.sha256); for (const f of sourceFiles) assert.equal(sha(f.path), f.sha256); }]) {
    try { await cleanup(); } catch (e) { errors.push(String(e.stack || e)); }
  }
  if (errors.length) { report.status = "FAILED"; report.cleanupError = errors; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); report.tool = describe(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
