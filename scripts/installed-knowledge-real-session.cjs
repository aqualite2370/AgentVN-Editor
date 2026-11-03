"use strict";
// One authorized real conversation, <=3 questions. A transparent local meter
// forwards to the configured endpoint, records usage only, and never retries.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { startInstalledEditor } = require("./lib/owned-installed-editor.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { createRealKnowledgeMeter } = require("./lib/knowledge-real-meter.cjs");
const root = path.resolve(__dirname, ".."), audit = path.resolve(process.argv[2] || "");
const out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3] && !fs.existsSync(out) && out.startsWith("F:\\AgentVN\\QA\\"));
assert(!process.env.E5_LIFECYCLE_SOURCE);
fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(audit, path.join(out, "installer-resource-report.json"));
const prompts = [
  ["layout-background", "我想给Ren'Py样式按钮容器设置背景图片，应该在哪里操作？"],
  ["layout-code", "进阶HTML和CSS如何编辑，关闭勾选后代码是否保留？"],
  ["gui-pack", "GUI资源包如何入库，再仅应用到一个控件？"],
];
const report = { status: "RUNNING", scope: "ACTUAL_INSTALLED_REAL_CONFIGURED_MODEL_ONE_CONVERSATION",
  startedAt: new Date().toISOString(), maximumQuestions: 3, questionsSubmitted: 0, upstreamRequests: [],
  cases: [], answers: [], credentialCleanup: "NOT_RUN", meter: "transparent localhost forwarding; no synthetic response or retry" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let owner, browser, page, meter, configured, armedQuestion = -1;
const delays = ms => new Promise(resolve => setTimeout(resolve, ms));
function readSelectedModel() {
  // Secret-bearing JSON stays in memory; never echo it, include it in evidence,
  // place it in an argv string, or copy other models' credentials.
  const code = `import sqlite3,os,json
p=os.path.join(os.environ['APPDATA'],'com.agentvn.editor','backend','vn_engine.db')
c=sqlite3.connect('file:'+p.replace(chr(92),'/')+'?mode=ro',uri=True)
d={k:json.loads(v) for k,v in c.execute('SELECT key,value FROM editor_shared_state WHERE key IN (?,?,?,?)',('provider_connections','provider_models','provider_selections','provider_secrets'))}
m=next(m for m in d['provider_models'] if m['provider_id']==d['provider_selections']['text_generation'])
conn=next(x for x in d['provider_connections'] if x['connection_id']==m['connection_id'])
print(json.dumps({'model':m,'connection':conn,'secret':d['provider_secrets'].get(conn['connection_id'])}))
c.close()`;
  const value = JSON.parse(execFileSync("python", ["-c", code], { encoding: "utf8", windowsHide: true }));
  assert(value.secret && /^deepseek/i.test(value.model.model_id), "Configured DeepSeek selection and its key required");
  assert(new URL(value.connection.base_url).protocol === "https:", "Only the configured HTTPS provider is forwarded");
  return value;
}
(async () => {
  configured = readSelectedModel();
  report.model = configured.model.model_id;
  const upstreamBase = new URL(configured.connection.base_url);
  meter = createRealKnowledgeMeter({ upstreamBase: upstreamBase.href, model: report.model,
    prompts, report, armedQuestion: () => armedQuestion, changed: save });
  await new Promise(resolve => meter.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${meter.address().port}${upstreamBase.pathname.replace(/\/$/, "")}`;
  owner = await startInstalledEditor(out);
  const { state } = owner;
  const now = new Date().toISOString(), connectionId = "qa-knowledge-real", providerId = "qa-knowledge-real-model";
  const providerState = { provider_connections: [{ ...configured.connection, connection_id: connectionId,
    base_url: base, display_name: "已授权真实知识验收", enabled: true }],
  provider_models: [{ ...configured.model, provider_id: providerId, connection_id: connectionId, enabled: true,
    created_at: now, updated_at: now }], provider_selections: { text_generation: providerId },
  provider_secrets: { [connectionId]: configured.secret } };
  const configuredResponse = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/state`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(providerState) });
  assert(configuredResponse.ok, "Cannot configure isolated provider");
  const { fixture } = require("./lib/editor-ui-acceptance.cjs");
  const fixtureProject = fixture(`knowledge_real_${path.basename(out)}`);
  const fixtureFile = path.join(out, "真实知识隔离工程.vnproj");
  fs.writeFileSync(fixtureFile, JSON.stringify(fixtureProject), { flag: "wx" });
  process.env.AGENTVN_TEST_PROJECT = fixtureFile; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  report.environment = { AGENTVN_TEST_PROJECT: fixtureFile, AGENTVN_WORKSPACE_OUTPUT: out };
  const imported = await fetch(`http://127.0.0.1:${state.backendPort}/api/project/projects/import`, {
    method: "POST", headers: { "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(fixtureFile)) }, body: fs.readFileSync(fixtureFile) });
  assert(imported.ok);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  const deadline = Date.now() + 45000;
  while (!page && Date.now() < deadline) {
    page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
    if (!page) await delays(100);
  }
  assert(page); page.setDefaultTimeout(240000);
  await page.reload();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: fixtureProject.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
  assert.equal((await A.projectSnapshot(state.backendPort)).projectId, fixtureProject.project_id);
  await page.locator('[data-workspace-surface="assistant"]:visible').click();
  for (const [index, [topic, question]] of prompts.entries()) {
    armedQuestion = index;
    const before = content(await A.projectSnapshot(state.backendPort));
    await page.getByLabel("向大模型助手提问", { exact: true }).fill(question);
    const pending = page.waitForResponse(r => r.url().endsWith("/api/assistant/chat_stream") && r.request().method() === "POST");
    report.questionsSubmitted++; save();
    await page.locator('[data-help-key="assistant.send"]:visible').click();
    const response = await pending, request = response.request().postDataJSON();
    assert(!Object.keys(request).some(key => /tools|authorized|draft/.test(key)));
    assert(request.context_chunks.some(chunk => chunk.id.startsWith(`guide-${topic}-`)));
    const events = await response.text();
    assert(!/^event: error$/m.test(events), "A real query failed; no paid retry");
    await page.waitForFunction(count => document.querySelectorAll(".assistant-message.is-assistant").length === count
      && !document.querySelector(".assistant-message.is-streaming"), index + 1);
    const answer = await page.locator(".assistant-message.is-assistant").last().innerText();
    assert(answer.length > 40 && !/无资料|没有相关资料/.test(answer));
    assert((await page.locator(".assistant-message-citations").last().getByRole("button").count()) > 0);
    const row = report.upstreamRequests.find(r => r.questionIndex === index);
    assert(row && row.status === "PASS");
    assert.deepEqual(content(await A.projectSnapshot(state.backendPort)), before);
    report.answers.push({ topic, question, answer });
    report.cases.push({ topic, status: "PASS", requestIndex: index + 1,
      citations: request.context_chunks.map(c => ({ id: c.id, source: c.source, title: c.title })) }); save();
  }
  armedQuestion = -1;
  assert.equal(report.questionsSubmitted, 3); assert.equal(report.upstreamRequests.length, 3);
  assert.equal(report.cases.length, 3); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = error.name + ": " + error.message; process.exitCode = 1; })
  .finally(async () => {
    await browser?.close();
    if (owner) {
      try {
        const clear = await fetch(`http://127.0.0.1:${owner.state.backendPort}/api/project/state`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            provider_connections: [], provider_models: [], provider_selections: {}, provider_secrets: {} }) });
        assert(clear.ok); report.credentialCleanup = "CLEARED_ISOLATED_SETTINGS";
      } catch { report.credentialCleanup = "FAILED"; report.status = "FAILED"; process.exitCode = 1; }
      report.cleanup = await owner.stop();
      if (report.credentialCleanup !== "FAILED") {
        try {
          execFileSync("python", ["-c", "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA secure_delete=ON');c.execute(\"UPDATE editor_shared_state SET value='{}' WHERE key='provider_secrets'\");c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)');c.execute('VACUUM');c.close()", owner.state.databasePath],
          { windowsHide: true, stdio: "pipe" });
          report.credentialCleanup = "CLEARED_AND_VACUUMED_ISOLATED_DB";
        } catch { report.credentialCleanup = "FAILED_PURGE"; report.status = "FAILED"; process.exitCode = 1; }
      }
    }
    configured = undefined;
    if (meter) await new Promise(resolve => { meter.closeAllConnections(); meter.close(resolve); });
    if (report.cleanup && (report.cleanup.editor.exitCode || report.cleanup.backend.exitCode)) {
      report.status = "FAILED"; process.exitCode = 1;
    }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, questions: report.questionsSubmitted,
      upstreamRequests: report.upstreamRequests.length, credentialCleanup: report.credentialCleanup, out }));
  });
function content(value) { return { settings: value.settings, assets: value.assetManifest }; }
