"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const qa = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01", out = path.join(qa, "session-05");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const source = path.join(qa, "session-04/report.json"), prior = read(source);
assert.equal(prior.status, "PASS"); assert.equal(sha(prior.projectArtifact.path), prior.projectArtifact.sha256);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", at: new Date().toISOString(), source: desc(source), input: prior.projectArtifact,
  scope: "ACTUAL_INSTALLED_FRESH_DATABASE_PORTABLE_IMPORT_PUBLIC_API_AND_REAL_UI_NOT_NATIVE_PICKER",
  screenshots: [], launches: [], cleanups: [], errors: [], modelRequests: 0, blockedModelRequests: 0,
  productChanges: 0, builds: 0, tools: [desc(__filename)] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, prepared = false;
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.resolve("scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", path.resolve(out), "-AllowedRunRoot", path.resolve(qa), "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  save(); assert.equal(result.status, 0, result.stdout + result.stderr);
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
  cache("SelfTest"); prepared = true; cache("Prepare");
  const zip = await JSZip.loadAsync(fs.readFileSync(prior.projectArtifact.path), { checkCRC32: true });
  const portable = JSON.parse(await zip.file("project.json").async("string"));
  host = installedReleaseSession({ installationFile: receipt, out, input: prior.projectArtifact.path, report, save });
  page = await host.start();
  assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 0, "Database must start empty");
  const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(prior.projectArtifact.path)) },
    body: fs.readFileSync(prior.projectArtifact.path), signal: AbortSignal.timeout(20000) });
  const imported = await response.json(); assert(response.ok && imported.ok);
  assert.equal(imported.data.project_id, portable.project_id);
  await page.reload();
  await page.locator('[data-help-key="home.recentProject"]:visible').filter({ hasText: portable.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  const stored = await host.api("/api/project/projects/" + portable.project_id);
  assert.deepEqual(stored.editor_settings.runtimeUILayoutProfiles, portable.editor_settings.runtimeUILayoutProfiles);
  assert.deepEqual(stored.editor_settings.runtimeUILayout, portable.editor_settings.runtimeUILayout);
  assert.deepEqual(stored.edges, portable.edges);
  const authored = nodes => nodes.map(({ measured, ...n }) => n);
  assert.deepEqual(authored(stored.nodes), authored(portable.nodes));
  const titleComponents = stored.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
    .components.filter(c => c.component_type === "custom_component");
  assert.equal(titleComponents.length, 1); assert.equal(titleComponents[0].label, "QUEUE_C组件");
  report.result = { projectId: stored.project_id, bothProfiles: true, graphAndEdges: true,
    mergedComponentRetained: true, freshBackendDatabase: host.current.data };
  await host.shot("portable-reopened-in-fresh-native-database");
  assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) await host.shot("failure").catch(() => {});
}).finally(async () => {
  try {
    await host?.stop("End fresh native portable reimport; not normal native-close evidence");
    if (prepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
      cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS");
    }
    assert.equal(sha(prior.projectArtifact.path), prior.projectArtifact.sha256);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out,
    error: report.error, cleanupError: report.cleanupError }));
});
