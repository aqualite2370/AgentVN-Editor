"use strict";
// Real closed-host recent upgrade and metadata recovery in a disposable default profile.
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const assert = require("node:assert/strict"), net = require("node:net");
const { defaultEditorSession } = require("./lib/qa-default-editor-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const { recoveryPoints } = require("./lib/native-editor-recovery-files.cjs");
const base = path.resolve(process.argv[2] || "");
const priorBase = path.resolve("F:/testavn/Windows-Isolated-1976-20261116-01");
const metadataBase = path.resolve("F:/testavn/Windows-Isolated-1976-20261116-04");
const remaining = base === path.resolve("F:/testavn/Windows-Isolated-1976-20261116-05");
const followup = remaining || base === metadataBase;
assert(followup || base === priorBase);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), bytes: fs.statSync(f).size, sha256: sha(f) });
const owner = read(path.join(base, "account-controller.json"));
assert.equal(require("node:os").userInfo().username, owner.account.name);
const fixture = read(path.join(base, "fixture.vnproj")), out = path.join(base, "resource-01");
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "REAL_NSIS_1975_TO_1976_DEFAULT_QA_PROFILE_METADATA_RECOVERY_NOT_ANDROID",
  stages: [], launches: [], cleanups: [], screenshots: [], errors: [], backupEvidence: [],
  modelRequests: 0, computerUse: false, controlledNativeIPC: false, storeInjection: false,
  startedAt: new Date().toISOString(), faultInjection: [] };
if (followup) {
  report.scope = "REUSE_ACTUAL_1976_INSTALL_FRESH_DEFAULT_QA_PROFILE_METADATA_RECOVERY_NOT_CONTINUOUS_UPGRADE";
  report.installations = 0;
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const port = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
let session, page, backendPort, backupRoot, hold, blocker;
let originalNodes, titlePoint, desiredEnabled;
const firstTitle = "安装版纯标题恢复点1976", secondTitle = "安装版失败重试后恢复点1976", author = "默认QA真实作者";
async function step(name, action) {
  const row = { name, status: "RUNNING" }; report.stages.push(row); save(); console.log("START", name);
  try { row.detail = await action(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); console.log(JSON.stringify(row)); }
}
function install(action) {
  const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "editor-autosave-upgrade-install.ps1"), "-SessionRoot", base, "-Action", action],
  { encoding: "utf8", windowsHide: true, timeout: 240000 });
  fs.writeFileSync(path.join(out, "install-" + action.toLowerCase() + ".log"),
    (result.stdout || "") + (result.stderr || ""), { flag: "wx" });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  return action === "Old" || action === "New" ? read(path.join(base, "install-" + action.toLowerCase() + ".json")) : null;
}
async function start(installation, label) {
  assert.equal(installation.status, "PASS");
  session = defaultEditorSession({ installation, out, report, save, label,
    expectedQaUser: owner.account.name, isolatedBackendPort: backendPort });
  page = await session.start();
  backupRoot = path.join(path.dirname(path.dirname(session.current.database)), "backup-timeline");
  const qaProfile = path.resolve(process.env.USERPROFILE);
  assert.equal(path.basename(qaProfile), owner.account.name);
  assert(backupRoot.startsWith(qaProfile + path.sep), "Fault injection must stay inside the owned default profile");
}
const current = () => session.api("/api/project/projects/" + encodeURIComponent(fixture.project_id));
function backups() {
  return recoveryPoints(backupRoot, fixture.project_id);
}
function retain(point, label) {
  const target = path.join(out, "recovery-files", label + ".json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(point.path, target, fs.constants.COPYFILE_EXCL);
  assert.equal(sha(target), point.sha256);
  fs.copyFileSync(point.metaPath, target + ".meta.json", fs.constants.COPYFILE_EXCL);
  assert.equal(sha(point.metaPath), sha(target + ".meta.json"));
  const record = { source: point.path, retained: desc(target), metadata: desc(target + ".meta.json") };
  report.backupEvidence.push(record); save(); return record;
}
async function backupWhere(predicate) {
  return until(() => backups().find(b => predicate(b.value)), "real installed native recovery point", 30000);
}
async function open() {
  await page.locator(".recent-project-open:not(:disabled)").filter({ hasText: fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function settings() {
  if (await page.locator("[data-workspace-surface='options']").getAttribute("aria-current") !== "page")
    await page.locator("[data-workspace-surface='options']").click();
  await page.locator("nav [data-help-key='advanced.tab.settings']").click();
  const panel = page.locator(".advanced-tab-content:not([inert])");
  await panel.locator("[data-help-key='settings.projectTitle']").waitFor(); await settleEditor(page);
  return panel;
}
function restoreFault() {
  if (!hold) return;
  assert.equal(path.dirname(hold), path.dirname(backupRoot));
  assert.equal(hold, backupRoot + ".qa-held-1976");
  if (fs.existsSync(backupRoot)) {
    assert(fs.lstatSync(backupRoot).isFile()); assert.equal(fs.readFileSync(backupRoot, "utf8"), blocker);
    const retired = path.join(out, "backup-directory-fault-retired.txt");
    const localRetired = hold + ".fault";
    assert(!fs.existsSync(retired)); assert(!fs.existsSync(localRetired));
    // Same-volume rename restores the native path; retain evidence on F via copy.
    fs.renameSync(backupRoot, localRetired);
    fs.copyFileSync(localRetired, retired, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(localRetired), sha(retired));
    report.faultInjection.push({ restoredBlocker: desc(retired) });
  }
  fs.renameSync(hold, backupRoot); hold = undefined; save();
}
(async () => {
  save(); backendPort = await port();
  if (!followup) install("Snapshot");
  if (!followup) {
  await step("actual-1975-install-authoring-and-natural-close", async () => {
    const old = install("Old"); await start(old, "old1975");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open(); const panel = await settings();
    await panel.locator("[data-help-key='settings.author']").fill("升级前实际作者");
    await until(async () => (await current()).author === "升级前实际作者", "old author saved");
    originalNodes = (await current()).nodes; report.oldMetadataBackupCount = backups().length;
    await session.shot("old1975-authoring"); const closed = await session.naturalClose();
    return { installation: old.executable, oldMetadataBackupCount: report.oldMetadataBackupCount, closed };
  });
  }
  let installed;
  await step(followup ? "reuse-already-installed-1976-exact-payload-no-reinstall" :
    "actual-same-directory-1976-upgrade-default-data-and-payload", async () => {
    if (followup) {
      const prior = read(path.join(priorBase, "resource-01/report.json"));
      assert.equal(prior.status, "FAILED"); assert(prior.error.includes("Every installed byte"));
      assert.equal(prior.stages[0].status, "PASS");
      assert.equal(read(path.join(priorBase, "account-retirement-01.json")).status, "PASS");
      installed = read(path.join(priorBase, "install-new.json"));
      assert.equal(sha(installed.executable.path), installed.executable.sha256);
      report.inheritedInstall = { receipt: desc(path.join(priorBase, "install-new.json")),
        failedRun: desc(path.join(priorBase, "resource-01/report.json")),
        oldAuthoringAndClose: prior.stages[0], boundary: "New QA profile; not same-profile upgrade readback" };
      fs.writeFileSync(path.join(base, "installation.json"), JSON.stringify(installed, null, 2), { flag: "wx" });
    } else installed = install("New");
    assert.equal(installed.executable.version, "1.9.76");
    const build = read(path.join(base, "candidate.json"));
    const payload = read(build.payloadReport.path).deployments.find(d => d.kind === "NSIS actual payload");
    assert(payload);
    if (sha(installed.executable.path) === payload.executable.sha256) {
      report.bundleMarker = { status: "PASS", byteIdenticalToActualPayload: true, differentBytes: 0 };
    } else {
      const marker = cp.spawnSync(process.execPath, [path.join(__dirname, "audit-installed-editor-marker.cjs"),
        installed.executable.path, payload.executable.sha256], { encoding: "utf8", windowsHide: true });
      assert.equal(marker.status, 0, marker.stderr); report.bundleMarker = JSON.parse(marker.stdout);
    }
    for (const resource of [{ name: "build-versions.json", ...payload.versionResource }, ...payload.runtimeProvenance]) {
      assert.equal(sha(path.join(installed.installRoot, resource.name)), resource.sha256, resource.name);
    }
    if (followup) return { actualInstallReused: true, installation: installed.executable, bundleMarker: report.bundleMarker };
    await start(installed, "new1976"); await open();
    const value = await current();
    assert.equal(value.author, "升级前实际作者"); assert.deepEqual(value.nodes, originalNodes);
    assert.equal(await page.locator(".node-palette").count(), 1);
    return { installation: installed.executable, sameDefaultDatabase: session.current.database, retainedNodes: value.nodes.length,
      bundleMarker: report.bundleMarker };
  });
  if (followup) await step("fresh-default-profile-real-import-and-author-baseline", async () => {
    if (remaining) {
      const previous = read(path.join(metadataBase, "resource-01/report.json"));
      assert.equal(previous.status, "FAILED");
      assert(previous.error.includes("strict mode violation") && previous.error.includes("workspace-status-detail"));
      assert.equal(previous.stages[2].status, "PASS"); assert.equal(previous.backupEvidence.length, 3);
      const retired = read(path.join(metadataBase, "account-retirement-01.json")); assert.equal(retired.status, "PASS");
      report.metadataPointOrigin = { report: desc(path.join(metadataBase, "resource-01/report.json")),
        stage: previous.stages[2], setup: "Copy three real native recovery files from retired QA; not new checkpoint assertions" };
      const directory = path.join(process.env.APPDATA, "com.agentvn.editor/backup-timeline");
      assert(!fs.existsSync(directory)); fs.mkdirSync(directory, { recursive: true });
      for (const point of previous.backupEvidence) {
        assert.equal(sha(point.retained.path), point.retained.sha256); assert.equal(sha(point.metadata.path), point.metadata.sha256);
        const to = path.join(directory, path.basename(point.source));
        fs.copyFileSync(point.retained.path, to, fs.constants.COPYFILE_EXCL);
        fs.copyFileSync(point.metadata.path, to + ".meta.json", fs.constants.COPYFILE_EXCL);
      }
    }
    await start(installed, "new1976");
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream" },
      body: fs.readFileSync(path.join(base, "fixture.vnproj")) });
    assert(response.ok && (await response.json()).ok);
    await page.reload(); await open();
    const panel = await settings();
    if (!remaining) {
      await panel.locator("[data-help-key='settings.author']").fill("升级前实际作者");
      await until(async () => (await current()).author === "升级前实际作者", "baseline author saved");
    } else {
      assert.equal((await current()).title, firstTitle);
      titlePoint = backups().find(b => b.value.author === "升级前实际作者"); assert(titlePoint);
      for (const [index, point] of backups().entries()) retain(point, "inherited-native-" + index);
    }
    originalNodes = (await current()).nodes; await session.shot("new1976-baseline-authoring");
    return { database: session.current.database, freshDefaultProfile: true, installations: 0, graphNodes: originalNodes.length };
  });
  if (!remaining) await step("title-author-and-setting-have-real-native-recovery-points-with-unchanged-nodes", async () => {
    const panel = await settings();
    await panel.locator("[data-help-key='settings.projectTitle']").fill(firstTitle);
    titlePoint = await backupWhere(v => v.title === firstTitle);
    retain(titlePoint, "title");
    await panel.locator("[data-help-key='settings.author']").fill(author);
    retain(await backupWhere(v => v.title === firstTitle && v.author === author), "author");
    const checkbox = panel.locator("[data-help-key='settings.speakerFocus.enabled']");
    desiredEnabled = !await checkbox.isChecked(); await checkbox.setChecked(desiredEnabled);
    retain(await backupWhere(v => v.author === author && v.editor_settings?.speakerFocus?.enabled === desiredEnabled), "setting");
    assert.deepEqual((await current()).nodes, originalNodes);
    await session.shot("new1976-metadata-settings");
    return { points: report.backupEvidence.length, title: firstTitle, author, speakerFocus: desiredEnabled,
      graphUnchanged: true, controlledNativeIPC: false };
  });
  await step("real-backup-directory-failure-preserves-save-and-workspace-trigger-retries", async () => {
    hold = backupRoot + ".qa-held-1976"; assert(!fs.existsSync(hold));
    fs.renameSync(backupRoot, hold);
    blocker = "AgentVN owned QA recovery fault 1976";
    fs.writeFileSync(backupRoot, blocker, { flag: "wx" });
    report.faultInjection.push({ type: "OWNED_DEFAULT_PROFILE_DIRECTORY_REPLACED_WITH_FILE",
      path: backupRoot, heldDirectory: hold, controlledResponse: false }); save();
    const panel = await settings(); await panel.locator("[data-help-key='settings.projectTitle']").fill(secondTitle);
    await until(async () => (await current()).title === secondTitle, "metadata persists despite recovery file failure");
    await page.getByTestId("workspace-status-bar").getByText("工程已保存，但本次恢复点写入失败。", { exact: true }).waitFor();
    assert(!read(path.join(hold, titlePoint.name)).title.includes("失败重试"));
    await session.shot("new1976-visible-backup-error");
    restoreFault();
    await page.locator("[data-workspace-surface='edit']").click();
    const point = await backupWhere(v => v.title === secondTitle && v.author === author);
    retain(point, "retried-after-native-failure");
    assert.deepEqual((await current()).nodes, originalNodes);
    return { databaseSaveSucceeded: true, visibleError: true, realFilesystemFailure: true,
      retriedOnWorkspace: true, point: report.backupEvidence.at(-1) };
  });
  await step("timeline-shows-and-restores-title-checkpoint-before-restore-backup-retained", async () => {
    await page.locator("[data-workspace-surface='options']").click();
    await page.locator("nav [data-help-key='advanced.tab.history']").click(); await settleEditor(page);
    const panel = page.locator(".advanced-tab-content:not([inert]) .project-timeline-panel");
    await panel.locator("[data-help-key='timeline.refresh']").click();
    const target = panel.locator("[data-help-key='timeline.entry']").filter({ hasText: firstTitle }).last();
    await target.click();
    const confirmation = page.getByTestId("timeline-restore-confirmation"); await confirmation.waitFor();
    await confirmation.getByRole("button", { name: "恢复备份", exact: true }).click();
    await confirmation.waitFor({ state: "hidden" });
    const restored = await until(async () => { const p = await current(); return p.title === firstTitle ? p : null; }, "restored metadata saved");
    assert.deepEqual(restored.nodes, originalNodes);
    const before = backups().find(b => b.value.title === secondTitle && b.meta.trigger === "before_restore");
    assert(before); retain(before, "recoverable-content-before-restore");
    const restoredAuthor = restored.author, restoredSetting = restored.editor_settings.speakerFocus.enabled;
    report.restoredExpected = { title: firstTitle, author: restoredAuthor, speakerFocus: restoredSetting };
    await session.shot("new1976-timeline-restored");
    return { title: restored.title, author: restoredAuthor, speakerFocus: restoredSetting, graphUnchanged: true };
  });
  await step("new1976-natural-close", () => session.naturalClose());
  await start(installed, "restart1976");
  await step("same-default-profile-restart-keeps-restored-data-and-native-recovery-files", async () => {
    // The restored title differs from the fixture; the default profile contains only this project.
    await page.locator(".recent-project-open:not(:disabled)").first().click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const value = await current(), expected = report.restoredExpected;
    assert.equal(value.title, expected.title); assert.equal(value.author, expected.author);
    assert.equal(value.editor_settings.speakerFocus.enabled, expected.speakerFocus);
    assert.deepEqual(value.nodes, originalNodes);
    for (const point of report.backupEvidence) assert.equal(sha(point.source), point.retained.sha256);
    await session.shot("new1976-restarted-settings");
    return { database: session.current.database, expected, nativeFiles: report.backupEvidence.length };
  });
  await step("final-natural-close-and-qa-registration-restore", async () => {
    const receipt = await session.naturalClose();
    if (!followup) install("Restore");
    else fs.writeFileSync(path.join(base, "metadata-restoration.json"), JSON.stringify({
      status: "PASS", method: "NO_INSTALL_OR_REGISTRY_MUTATION_IN_FOLLOWUP", at: new Date().toISOString(),
    }), { flag: "wx" });
    return receipt;
  });
  assert.equal(report.stages.length, remaining ? 7 : 8); assert(report.stages.every(s => s.status === "PASS"));
  assert.equal(report.errors.length, 0); assert.equal(report.blockedModelRequests || 0, 0);
  assert.equal(report.launches.length, followup ? 2 : 3);
  assert(report.cleanups.every(c => c.method === "WM_CLOSE" && c.killed.length === 0));
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; })
  .finally(async () => {
    try {
      restoreFault(); await session?.stop();
      if (!fs.existsSync(path.join(base, "metadata-restoration.json")) &&
          fs.existsSync(path.join(base, "metadata-before.json"))) install("Restore");
      report.cleanupStatus = "PASS";
    } catch (error) { report.cleanupStatus = "FAILED"; report.cleanupError = error.stack; report.status = "FAILED"; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, checks: report.stages.length, error: report.error, out }));
    if (report.status !== "PASS") process.exitCode = 1;
  });
