"use strict";
// Existing Dev host + current Vite source, real Tauri recovery files/SQLite.
// Explicit F isolation; not a new build, default-profile or NSIS acceptance.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { close } = require("./lib/editor-upgrade-wm-close.cjs");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { hashFileSha256: sha } = require("./lib/file-sha256-bounded.cjs");
const out = path.resolve(process.argv[2] || "");
const approvedRoot = path.resolve("F:/testavn/Editor-Recovery-20261115-01");
assert(process.argv[2] && !fs.existsSync(out));
assert.equal(path.dirname(out), approvedRoot);
assert(path.basename(out).startsWith("native-metadata-"));
fs.mkdirSync(out);
const input = path.join(out, "fixture.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("metadata_native_" + Date.now())));
const report = {
  status: "RUNNING", scope: "EXISTING_DEV_HOST_CURRENT_SOURCE_REAL_TAURI_FILES_SQLITE_EXPLICIT_F_PROFILE_NOT_NSIS",
  launches: [], known: [], cleanups: [], screenshots: [], errors: [], checks: [], closes: [],
  builds: 0, models: 0, computerUse: false, controlledNativeIPC: false, storeInjection: false,
  source: { path: path.resolve("editor/src/components/editor/useEditorProjectAutosave.ts"),
    sha256: sha("editor/src/components/editor/useEditorProjectAutosave.ts") },
  executable: { path: path.resolve("AgentVN Dev.exe"), sha256: sha("AgentVN Dev.exe") },
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const session = nativeSession({ out, input, report, save });
let page, projectId, settingsEnabled, titleBackup;
const title = "元数据原生恢复点验收";
const author = "隔离验收作者";
async function check(name, operation) {
  const row = { name, status: "RUNNING" }; report.checks.push(row); save();
  try { row.detail = await operation(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = error.stack; throw error; }
  finally { save(); console.log(JSON.stringify(row)); }
}
async function settings() {
  if (await page.locator("[data-workspace-surface='options']").getAttribute("aria-current") !== "page")
    await page.locator("[data-workspace-surface='options']").click();
  await page.locator("nav [data-help-key='advanced.tab.settings']").click();
  await page.waitForFunction(() => {
    const input = document.querySelector(".advanced-tab-content:not([inert]) [data-help-key='settings.projectTitle']");
    return input && input.getClientRects().length > 0 && !input.closest("[inert]");
  });
  return page.locator(".advanced-tab-content:not([inert])");
}
async function graphState() {
  return page.evaluate(async () => {
    const graph = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
    const project = (await import("/src/store/projectStore.ts")).useProjectStore.getState();
    return { projectId: project.projectId, title: project.title, author: project.author,
      enabled: project.settings.speakerFocus.enabled, dirty: graph.dirty, nodeIds: graph.nodes.map(n => n.id) };
  });
}
async function backupWhere(predicate) {
  return until(async () => {
    const entries = await page.evaluate(async id =>
      (await import("/src/utils/projectTimeline.ts")).listProjectBackups(id), projectId);
    for (const entry of entries) {
      const file = path.join(session.current.data, "backup-timeline", entry.file_name);
      assert.equal(path.dirname(file), path.join(session.current.data, "backup-timeline"));
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(value.project_id, projectId);
      if (predicate(value)) return { path: file, sha256: sha(file), entry, value };
    }
    return null;
  }, "real native metadata recovery point", 30000);
}
async function naturalClose(label) {
  const receipt = await close({ launch: { ...session.current, label, exe: session.current.executable },
    known: report.known, out });
  report.closes.push(receipt); save();
  await session.stop("Observed metadata WM_CLOSE natural exit: " + label);
  assert.deepEqual(report.cleanups.at(-1).killed, []);
  return receipt;
}
(async () => {
  save(); page = await session.start();
  const loaded = await (await page.request.get(new URL("/src/components/editor/useEditorProjectAutosave.ts", page.url()).href)).text();
  assert(loaded.includes("recoveryRetry") && loaded.includes("recoveryMetadataRevision"), "Current source must actually be loaded");
  await page.locator("[data-help-key='home.createProject']").first().click();
  await page.locator(".editor-toolbar").waitFor();
  await page.waitForFunction(async () => !(await import("/src/store/editorStore.ts")).useEditorStore.getState().dirty);
  projectId = (await graphState()).projectId;
  await check("纯标题编辑无图dirty，真实Tauri恢复点与隔离数据库均保留标题", async () => {
    const panel = await settings();
    assert.equal((await graphState()).dirty, false);
    await panel.locator("[data-help-key='settings.projectTitle']").fill(title);
    assert.equal((await graphState()).dirty, false);
    const result = await backupWhere(value => value.title === title);
    titleBackup = { path: result.path, sha256: result.sha256 };
    const persisted = (await session.api("/api/project/projects/" + encodeURIComponent(projectId))).data;
    assert.equal(persisted.title, title); assert.equal(result.entry.trigger, "auto_save");
    return titleBackup;
  });
  await check("纯作者及设置操作保留真实恢复点，节点内容不变", async () => {
    const panel = await settings(), before = (await graphState()).nodeIds;
    await panel.locator("[data-help-key='settings.author']").fill(author);
    const authorPoint = await backupWhere(value => value.author === author && value.title === title);
    const enabled = panel.locator("[data-help-key='settings.speakerFocus.enabled']");
    settingsEnabled = !await enabled.isChecked();
    await enabled.setChecked(settingsEnabled);
    const settingsPoint = await backupWhere(value => value.author === author &&
      value.editor_settings?.speakerFocus?.enabled === settingsEnabled);
    assert.deepEqual((await graphState()).nodeIds, before);
    assert.equal((await graphState()).dirty, false);
    return { authorBackup: { path: authorPoint.path, sha256: authorPoint.sha256 },
      settingsBackup: { path: settingsPoint.path, sha256: settingsPoint.sha256 }, settingsEnabled, nodeIds: before };
  });
  await check("真实WM_CLOSE正常退出，无强杀或残留所属服务", () => naturalClose("metadata-first"));
  page = await session.start();
  await check("同隔离数据库与WebView正常重启，元数据和原生恢复文件保持", async () => {
    await page.locator(".recent-project-open").first().click(); await page.locator(".editor-toolbar").waitFor();
    const current = await graphState();
    assert.equal(current.projectId, projectId); assert.equal(current.title, title);
    assert.equal(current.author, author); assert.equal(current.enabled, settingsEnabled);
    assert.equal(sha(titleBackup.path), titleBackup.sha256);
    const saved = await backupWhere(value => value.author === author &&
      value.editor_settings?.speakerFocus?.enabled === settingsEnabled);
    return { ...current, backup: { path: saved.path, sha256: saved.sha256 } };
  });
  await check("重启后再次正常关闭，现有Dev宿主字节保持", async () => {
    const receipt = await naturalClose("metadata-restart");
    assert.equal(sha(report.executable.path), report.executable.sha256);
    assert.equal(sha(report.source.path), report.source.sha256);
    return receipt;
  });
  assert.equal(report.checks.length, 5); assert.equal(report.errors.length, 0);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.stack; })
  .finally(async () => {
    try { await session.stop("Final metadata native scope retirement"); }
    catch (error) { report.cleanupError = error.stack; report.status = "FAILED"; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, out }));
    if (report.status !== "PASS") process.exitCode = 1;
  });
