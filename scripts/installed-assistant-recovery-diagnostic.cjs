"use strict";
// Read-only product diagnosis on a COPY of the failed isolated profiles.
// No models, proposals or product writes. Do not mutate the failed originals.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { rows, listeners } = require("./lib/current-native-editor-session.cjs");
const qa = "F:/AgentVN/QA/Installed-Assistant-Recovery-20261021-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
async function main() {
  const originalRoot = path.join(qa, "session-02"), parentPath = path.join(originalRoot, "report.json"), parent = read(parentPath);
  const attempt = process.argv[2] || "02"; assert.match(attempt, /^\d{2}$/);
  const prep = read(path.join(qa, "preparation.json")), out = path.join(qa, "diagnostic-" + attempt); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", at: new Date().toISOString(), scope: "FAILED_QA_PROFILE_COPY_INSTALLED_READ_ONLY_NO_MODELS",
    parent: { path: parentPath, sha256: sha(parentPath) }, cases: [], launches: [], cleanups: [], screenshots: [], errors: [],
    modelRequests: 0, productChanges: 0, clones: [] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  let host;
  try {
    assert.equal(parent.status, "FAILED"); assert.equal(parent.finalCleanup.survivors.length, 0); assert.equal(parent.finalCleanup.listeners.length, 0);
    const keys = new Set([...parent.knownProcesses, ...parent.peerKnown].map(p => `${p.ProcessId}:${p.Created}`));
    assert(!rows().some(p => keys.has(`${p.ProcessId}:${p.Created}`)));
    for (const n of ["data", "webview"]) {
      const from = path.join(originalRoot, n), to = path.join(out, n); fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false });
      report.clones.push({ from, to });
    }
    report.originalDatabase = { path: path.join(originalRoot, "data/backend/vn_engine.db"), sha256: sha(path.join(originalRoot, "data/backend/vn_engine.db")) };
    assert.equal(sha(path.join(out, "data/backend/vn_engine.db")), report.originalDatabase.sha256);
    host = installedReleaseSession({ installationFile: prep.installation.path, out, input: prep.inputs[0].path, report, save });
    const page = await host.start();
    for (const [index, taskIndex] of [[1, 3], [0, 2]]) {
      const project = prep.projects[index], task = parent.submissions[taskIndex];
      await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
      const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
      await panel.getByRole("button", { name: "创造模式", exact: true }).click();
      const api = await host.rawApi(`/api/assistant/creation/processes/${task.id}`);
      assert.equal(api.status, "failed"); assert.equal(api.errorCode, "worker_lost");
      const row = panel.getByTestId("assistant-process-monitor").locator(`li[data-process-id="${task.id}"][data-status="failed"]`);
      await row.waitFor(); const details = row.locator("details");
      await details.locator("summary").click();
      const message = details.locator("p"); await message.waitFor();
      assert.equal((await message.locator("code").innerText()).trim(), api.errorCode);
      const actualMessage = await message.evaluate(n => {
        const clone = n.cloneNode(true); clone.querySelector("code")?.remove(); return clone.textContent.trim();
      });
      assert.equal(actualMessage, api.errorMessage);
      assert.match(await message.innerText(), /停止.*(重复模型调用|重复调用模型)/);
      assert.equal(await page.getByTestId("assistant-project-lock-dialog").count(), 0);
      assert(await panel.getByLabel("向大模型助手提问", { exact: true }).isEnabled());
      const conversations = await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open("agentvn-assistant-workbench");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, get = db.transaction("conversations", "readonly").objectStore("conversations").getAll();
          get.onerror = () => { db.close(); reject(get.error); };
          get.onsuccess = () => { const result = get.result.map(c => ({ id: c.id, projectId: c.projectId, mode: c.mode,
            pending: c.creationPendingProcess?.id ?? null, lastAssistant: c.messages.filter(m => m.role === "assistant").at(-1)?.content }));
            db.close(); resolve(result); };
        };
      }));
      const conversation = conversations.find(c => c.id === task.conversationId); assert(conversation);
      assert.equal(conversation.projectId, project.project_id);
      report.cases.push({ status: "PASS", projectId: project.project_id, taskId: task.id,
        apiErrorCode: api.errorCode, actualFailureDetails: await message.innerText(), savedConversation: conversation });
      await host.shot("failure-details-" + index); save();
      await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
      await page.getByRole("button", { name: "返回首页", exact: true }).click(); await page.locator(".project-home").waitFor();
    }
    assert.equal(report.cases.length, 2); assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1; }
  finally {
    try { await host?.stop("diagnostic copied-profile exact cleanup; no normal-close claim"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    assert.equal(sha(parentPath), report.parent.sha256);
    if (report.originalDatabase) assert.equal(sha(report.originalDatabase.path), report.originalDatabase.sha256);
    const keys = new Set((report.knownProcesses || []).map(p => `${p.ProcessId}:${p.Created}`));
    report.residue = { processes: rows().filter(p => keys.has(`${p.ProcessId}:${p.Created}`)),
      listeners: report.launches.length ? listeners(report.launches.flatMap(l => l.ports)) : [] };
    if (report.residue.processes.length || report.residue.listeners.length) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ status: report.status, out, error: report.error }));
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
