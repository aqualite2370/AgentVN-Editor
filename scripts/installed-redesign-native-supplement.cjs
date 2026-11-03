"use strict";
// Complete only the outstanding native workflow on the existing installation.
// Native dialogs and window close are driven by Computer Use, never mocked.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const run = path.resolve(process.argv[2] || ""), out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && run.startsWith("F:\\AgentVN\\QA\\"));
assert(A.inside(run, out) && !fs.existsSync(out) && !process.env.E5_LIFECYCLE_SOURCE);
const priorFile = path.join(run, "report.json"), prior = JSON.parse(fs.readFileSync(priorFile));
assert.equal(prior.status, "BLOCKED");
assert.equal(prior.cases.filter(c => c.status === "BLOCKED").length, 1);
const resumeFile = process.argv[4] && path.resolve(process.argv[4]);
let resume;
if (resumeFile) {
  assert(A.inside(run, resumeFile) && resumeFile !== priorFile);
  resume = JSON.parse(fs.readFileSync(resumeFile));
  assert.equal(resume.status, "FAILED");
  assert(resume.error.includes("Native result must match the requested cancel/select operation"));
  for (const name of ["native-directory-cancel-preserves-project-and-preference",
    "native-chinese-directory-and-real-portable-save"])
    assert(resume.cases.some(c => c.name === name && c.status === "PASS"));
  assert.equal(A.sha256(fs.readFileSync(resume.portable.path)), resume.portable.sha256);
  assert(resume.cleanup.length === 2 && resume.cleanup.every(c =>
    c.editor.exitCode === 0 && c.backend.exitCode === 0));
  assert.equal(resume.cleanup[0].editor.alreadyExited, true);
}
fs.mkdirSync(out);
process.env.AGENTVN_TEST_PROJECT = prior.environment.AGENTVN_TEST_PROJECT;
process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const directory = resume ? path.dirname(resume.portable.path) : path.join(out, "中文 工程保存");
if (!resume) fs.mkdirSync(directory);
const report = {
  status: "RUNNING", startedAt: new Date().toISOString(), cases: [], launches: [], cleanup: [],
  modelRequests: 0, scope: "SAME_INSTALLED_1_9_21_NATIVE_SAVE_NORMAL_CLOSE_REOPEN_SUPPLEMENT",
  originalReport: { path: priorFile, sha256: A.sha256(fs.readFileSync(priorFile)) },
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: out },
  boundaries: { nativeInput: "Computer Use @oai/sky", nativeDialogMock: false,
    sourceVite: false, physical4K: false, Android: false, wholeProjectAcceptance: false },
  ...(resumeFile ? { resumeEvidence: { path: resumeFile, sha256: A.sha256(fs.readFileSync(resumeFile)),
    inheritedCases: resume.cases.map(c => c.name), originalStatus: resume.status } } : {}),
};
let owner, browser, page, cdp, state;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function stage(name, action) {
  report.stage = name; save(); console.log(`START ${name}`);
  const detail = await action(); report.cases.push({ name, status: "PASS", detail }); save();
}
async function connect() {
  state = { ...owner.state };
  const proof = A.readInstalledSession(run);
  report.launches.push({ ...state, executable: proof.executable, sha256: proof.exeSha256 });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const deadline = Date.now() + 30000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    if (!page) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(page); page.setDefaultTimeout(30000);
  cdp = await browser.contexts()[0].newCDPSession(page);
  report.installedExecutable = proof.executable;
}
async function options(tab = "settings") {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator(`[data-help-key="advanced.tab.${tab}"]:visible`).click();
  await A.settleEditor(page);
}
async function screenshot(name) {
  const actual = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches }));
  const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
  return captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), actual);
}
async function native(trigger, name, selectedPath, cancel = false) {
  return A.nativeInput({ page, trigger, out, name, ownerPid: state.editorPid,
    selectedPath, cancel, timeoutMs: 1200000 });
}
async function requestClose(name) {
  const request = { requestId: require("node:crypto").randomUUID(), name, ownerPid: state.editorPid,
    requestedAt: new Date().toISOString(), completion: path.join(out, `${name}-completed.json`) };
  assert(!fs.existsSync(request.completion));
  fs.writeFileSync(path.join(out, "native-input-request.json"), JSON.stringify(request, null, 2));
  console.log(JSON.stringify({ stage: "NATIVE_NORMAL_CLOSE_REQUIRED", ...request }));
  const deadline = Date.now() + 1200000;
  while (!fs.existsSync(request.completion) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 250));
  assert(fs.existsSync(request.completion));
  const result = JSON.parse(fs.readFileSync(request.completion));
  assert.equal(result.status, "INPUT_COMPLETED"); assert.equal(result.requestId, request.requestId);
  assert.equal(result.ownerPid, request.ownerPid); assert(result.interaction.includes("Computer Use"));
  const exitDeadline = Date.now() + 20000;
  let alive;
  do {
    alive = execFileSync("powershell.exe", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(request.ownerPid)}" | Select-Object -ExpandProperty ProcessId`],
    { windowsHide: true, encoding: "utf8" }).trim();
    if (alive) await new Promise(resolve => setTimeout(resolve, 200));
  } while (alive && Date.now() < exitDeadline);
  assert.equal(alive, "", "Native close must actually end the owned Editor, without taskkill");
  await browser.close(); browser = undefined; page = undefined; cdp = undefined;
  const cleanup = await owner.stop(); owner = undefined;
  assert.equal(cleanup.editor.exitCode, 0); assert.equal(cleanup.editor.alreadyExited, true);
  assert.equal(cleanup.backend.exitCode, 0); report.cleanup.push(cleanup);
  return { request, result, editorExitedNaturally: true, cleanup };
}
async function assetHashes(project) {
  return Promise.all(project.assetManifest.map(async asset => ({
    id: asset.asset_id, type: asset.asset_type, sha256: A.sha256(await A.assetBytes(state.backendPort, asset)),
  })));
}
async function verifyPortable(file, expected, hashes) {
  const bytes = fs.readFileSync(file), zip = await JSZip.loadAsync(bytes);
  const project = JSON.parse(await zip.file("project.json").async("string"));
  assert.equal(project.project_id, expected.projectId);
  assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, expected.settings.runtimeUILayoutProfiles);
  assert(!JSON.stringify(project).includes(directory), "Machine-local output path must not enter portable data");
  assert.equal(project.asset_manifest.length, hashes.length);
  for (const asset of project.asset_manifest) {
    const expectedAsset = hashes.find(a => a.id === asset.asset_id); assert(expectedAsset);
    assert.equal(asset.asset_type, expectedAsset.type);
    assert.equal(A.sha256(await zip.file(asset.metadata.project_path).async("nodebuffer")), expectedAsset.sha256);
  }
  return { path: file, sha256: A.sha256(bytes), bytes: bytes.length,
    generatedAt: fs.statSync(file).mtime.toISOString(), assets: hashes };
}
(async () => {
  owner = await startInstalledEditor(run, { restart: true, visible: true }); await connect();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: "新 UI 独立验收" }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  const before = await A.projectSnapshot(state.backendPort), hashes = await assetHashes(before);
  assert.equal(before.projectId, `installed_redesign_${path.basename(run)}`);
  assert.equal(before.settings.runtimeUILayoutProfiles.activeType, "renpy");
  if (!resume) await options();
  let portable = resume?.portable.path;
  if (resume) {
    assert.equal(resume.originalReport.sha256, report.originalReport.sha256);
    report.portable = await verifyPortable(portable, before, hashes);
    assert.equal(report.portable.sha256, resume.portable.sha256);
  } else {
  await stage("native-directory-cancel-preserves-project-and-preference", async () => {
    const oldPath = (await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim();
    const input = await native(page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
      "directory-cancel", directory, true);
    await page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible').waitFor();
    assert.equal((await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim(), oldPath);
    A.assertProjectContentUnchanged(await A.projectSnapshot(state.backendPort), before);
    return { input, oldPath, screenshot: await screenshot("directory-cancelled") };
  });
  await stage("native-chinese-directory-and-real-portable-save", async () => {
    const input = await native(page.locator('[data-help-key="settings.projectExportDirectory.choose"]:visible'),
      "directory-select", directory);
    await page.waitForFunction(value => document.querySelector('[data-help-key="settings.projectExportDirectory.current"]')?.textContent.trim() === value, directory);
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    await page.getByRole("button", { name: "保存工程", exact: true }).click();
    const confirm = page.getByTestId("project-save-confirmation"); await confirm.waitFor();
    const files = fs.readdirSync(directory).filter(name => name.endsWith(".vnproj")); assert.equal(files.length, 1);
    portable = path.join(directory, files[0]); assert((await confirm.innerText()).includes(portable));
    const saved = await A.projectSnapshot(state.backendPort);
    assert.deepEqual(saved.settings.runtimeUILayoutProfiles, before.settings.runtimeUILayoutProfiles);
    report.portable = await verifyPortable(portable, saved, hashes);
    const shot = await screenshot("native-saved");
    await confirm.getByRole("button", { name: "OK", exact: true }).click();
    return { input, artifact: report.portable, screenshot: shot };
  });
  }
  await stage("actual-window-close-and-native-portable-reopen", async () => {
    const first = { ...state }, closed = await requestClose("first-normal-close");
    owner = await startInstalledEditor(run, { restart: true, visible: true }); await connect();
    assert.notEqual(state.editorPid, first.editorPid); assert.notEqual(state.backendPid, first.backendPid);
    assert.equal(state.databasePath, first.databasePath); assert.equal(state.webviewRoot, first.webviewRoot);
    const trigger = page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true });
    await trigger.waitFor();
    const cancelled = await native(trigger, "project-open-cancel", portable, true);
    await trigger.waitFor(); assert.equal(await page.locator(".editor-toolbar").count(), 0);
    const opened = await native(trigger, "project-open-select", portable);
    await page.locator(".editor-toolbar").waitFor({ timeout: 120000 }); await A.settleEditor(page);
    const reopened = await A.projectSnapshot(state.backendPort);
    assert.equal(reopened.projectId, before.projectId);
    assert.deepEqual(reopened.settings.runtimeUILayoutProfiles, before.settings.runtimeUILayoutProfiles);
    assert.deepEqual(await assetHashes(reopened), hashes);
    await options();
    assert.equal((await page.locator('[data-help-key="settings.projectExportDirectory.current"]').innerText()).trim(), directory);
    await options("layout");
    await page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]').waitFor();
    assert.equal(await page.locator('.renpy-title-action[data-ui-component-id="title_start_button"]')
      .evaluate(e => getComputedStyle(e).backgroundColor), "rgb(116, 43, 89)");
    await page.getByTestId("renpy-gui-import-open").click();
    const library = page.getByTestId("renpy-gui-library");
    await library.locator("article").waitFor(); assert.equal(await library.locator("article").count(), 1);
    await page.getByRole("button", { name: "关闭导入预览", exact: true }).click();
    return { closed, cancelled, opened, sameDatabase: state.databasePath, sameWebview: state.webviewRoot,
      libraryEntries: 1, screenshot: await screenshot("native-reopened") };
  });
  await stage("final-normal-window-close", () => requestClose("final-normal-close"));
  assert.equal(report.cases.length, resume ? 2 : 4); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) try { report.failureScreenshot = await screenshot("failure"); } catch {}
}).finally(async () => {
  try {
    await browser?.close();
    if (owner) report.cleanup.push(await owner.stop());
    assert(report.cleanup.length > 0);
    assert(report.cleanup.every(c => c.editor.exitCode === 0 && c.backend.exitCode === 0));
    assert.equal(A.sha256(fs.readFileSync(priorFile)), report.originalReport.sha256, "Original BLOCKED report must remain unchanged");
    if (resumeFile) assert.equal(A.sha256(fs.readFileSync(resumeFile)), report.resumeEvidence.sha256,
      "Original failed supplement must remain unchanged");
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, stage: report.stage, error: report.error, out }));
});
