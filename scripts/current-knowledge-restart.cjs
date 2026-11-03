"use strict";
// Finish only the ambiguous-selector assertion from session-01. Reuse its
// real persisted profile/database, never replay the completed inquiry matrix.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { qa } = require("./current-knowledge-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const root = path.resolve(__dirname, "..");
const original = path.join(qa, "session-01"), out = path.join(qa, "session-02");
const sourceFile = path.join(original, "report.json"), source = read(sourceFile);
assert.equal(source.status, "FAILED");
assert(source.error.includes("strict mode violation") && source.error.includes("resolved to 2 elements"));
assert.equal(source.cases[0].status, "PASS"); assert.equal(source.requests.length, 36);
assert.equal(source.providerRequests.length, 36); assert.equal(source.cacheRestoration, "PASS");
assert.equal(source.cleanups.length, 2); assert(source.cleanups.every(c => c.status === "PASS"));
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const sourceSha = sha(sourceFile);
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "REUSE_REAL_PERSISTED_KNOWLEDGE_PROFILE_RESTART_ONLY_NO_MATRIX_REPLAY",
  sourceReport: { path: sourceFile, sha256: sourceSha }, cases: [], errors: [], screenshots: [],
  // The session helper numbers log files from launch count. Preserve existing
  // provenance and log names while placing the continuation report separately.
  launches: structuredClone(source.launches), cleanups: [], blockedModelRequests: 0,
  modelRequests: 0, paidRequests: 0, productChanges: 0, builds: 0,
  additionalLaunches: 0, priorLaunches: source.launches.length, normalClose: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, prepared = false;
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-AllowedRunRoot", qa, "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  save(); assert.equal(result.status, 0, result.stdout + result.stderr);
}
(async () => {
  save(); cache("SelfTest"); prepared = true; cache("Prepare");
  const input = path.join(original, "隔离知识工程.vnproj"), project = read(input);
  host = installedReleaseSession({ installationFile: receipt, out: original, report, save, input });
  report.installation = host.installation; page = await host.start(); report.additionalLaunches++;
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: "问询模式", exact: true }).click();
  const last = source.requests.at(-1);
  // Scope to the actual conversation, not the identically named history entry.
  await panel.locator(".assistant-message.is-user").getByText(last.question, { exact: true }).waitFor();
  await panel.locator(".assistant-message.is-assistant")
    .getByText("HISTORY_C 这是安装版历史验收回答。", { exact: true }).waitFor();
  const citations = panel.locator(".assistant-message-citations").last();
  const navigation = citations.getByRole("button", { name: "打开：游戏客户端", exact: true });
  assert(await navigation.count() > 0);
  const actualCitations = await citations.locator("span[title]").evaluateAll(nodes => nodes.map(node => ({
    source: node.getAttribute("title"), text: node.textContent,
  })));
  assert.equal(actualCitations.length, last.context_chunks.length);
  for (const chunk of last.context_chunks) assert(actualCitations.some(c => c.source === chunk.source && c.text.includes(chunk.title)));
  const observed = await page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), e = window.__AGENTVN_EDITOR_STORE__.getState();
    const nodes = e.nodes.map(({ measured, selected, dragging, ...node }) => node);
    const edges = e.edges.map(({ selected, ...edge }) => edge);
    return JSON.parse(JSON.stringify({ settings: p.settings, assets: p.assetManifest, nodes, edges }));
  });
  assert.deepEqual(observed, source.baseline);
  assert.equal(report.blockedModelRequests, 0); assert.equal(report.modelRequests, 0);
  report.cases.push({ name: "actual-persisted-answer-citations-and-readonly-content-after-restart",
    status: "PASS", detail: { question: last.question, actualCitations,
      additionalRequests: 0, answerAndCitationsRestored: true, projectUnchanged: true } });
  await host.shot("knowledge-restart-completed-without-requery");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) await host.shot("knowledge-restart-followup-failure").catch(() => {});
}).finally(async () => {
  try { await host?.stop("Restart-only followup exact owned cleanup"); }
  catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
  if (prepared) try {
    cache("Restore"); report.cacheRestoration = read(path.join(out, "native-cache-restoration.json")).status;
    assert.equal(report.cacheRestoration, "PASS");
  } catch (e) { report.cacheError = String(e); report.status = "FAILED"; process.exitCode = 1; }
  assert.equal(sha(sourceFile), sourceSha, "Never rewrite original failed report");
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, additionalLaunches: report.additionalLaunches,
    modelRequests: report.modelRequests, out, error: report.error }));
});
