"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { controlledAssistantProvider } = require("./controlled-assistant-provider.cjs");
const { until } = require("./current-native-editor-session.cjs");
const { settleEditor } = require("./installed-acceptance.cjs");
const crypto = require("node:crypto");
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const normalize = records => records.map(({ updatedAt, ...value }) => value);
function augment(input) {
  let code = input;
  const one = (before, after) => {
    assert.equal(code.split(before).length - 1, 1, before);
    code = code.replace(before, () => after);
  };
  one('"No old AI session/component data creation in this test"',
    '"Controlled local model, not real DeepSeek; profile upgrade limited to newly authored inquiry/draft/component"');
  one('if(r.request().method()==="POST"){report.modelRequests++;save();return r.abort();}',
    'if(r.request().method()==="POST"){if(profileFlow.allow(r.request()))return r.continue();report.modelRequests++;save();return r.abort();}');
  one('baseline=await saveProject("old-project");',
    'await profileFlow.author(page); baseline=await saveProject("old-project");');
  one('const fresh=await checkEnvironment("new-first");',
    'await profileFlow.verify(page,"new"); const fresh=await checkEnvironment("new-first");');
  one('const cached=await checkEnvironment("new-restart");',
    'await profileFlow.verify(page,"restart"); const cached=await checkEnvironment("new-restart");');
  one('if(process.argv[2]==="--self-test"){',
    'const profileFlow=require("./lib/editor-profile-upgrade-flow.cjs").create({out,report,save,shot,snapshot});\n' +
    'if(process.argv[2]==="--self-test"){');
  one("await forceCleanup();", "await profileFlow.dispose(); await forceCleanup();");
  return code;
}
async function records(page, name, store) {
  return page.evaluate(async ({ name, store }) => {
    if (!(await indexedDB.databases()).some(d => d.name === name)) throw Error("Missing existing " + name);
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open(name); r.onupgradeneeded = () => { r.transaction.abort(); reject(Error("Unexpected creation")); };
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const r = db.transaction(store, "readonly").objectStore(store).getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      return Promise.all(rows.sort((a, b) => a.id.localeCompare(b.id)).map(async row => store !== "components" ? row : ({
        ...row, assets: await Promise.all((row.assets || []).map(async asset => ({
          ...asset, bytes: undefined, byteLength: new Uint8Array(asset.bytes).length,
          sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(asset.bytes)))]
            .map(n => n.toString(16).padStart(2, "0")).join(""),
        }))),
      })));
    } finally { db.close(); }
  }, { name, store });
}
function selfTest() {
  const old = [{ id: "a", updatedAt: 10, mode: "inquiry", messages: ["original"], projectId: "p" }];
  assert.deepEqual(normalize(old), normalize([{ ...old[0], updatedAt: 11 }]));
  for (const change of [
    r => r[0].messages.push("changed"), r => r[0].projectId = "other",
    r => r[0].mode = "creation", r => r[0].id = "other",
  ]) {
    const copy = structuredClone(old); change(copy); assert.notDeepEqual(normalize(copy), normalize(old));
  }
  const endpoint = "http://127.0.0.1:53211/v1", guard = requestGuard(endpoint, "real-project-id", "HISTORY_A test");
  const query = { question: "HISTORY_A test", provider_selection: {
    base_url: endpoint, connection_id: "qa-profile-upgrade", model_id: "controlled-model", api_key: "test-only-secret" } };
  for (const poison of [
    q => q.question = "other", q => q.provider_selection.base_url = "https://example.com/v1",
    q => q.provider_selection.connection_id = "other", q => q.provider_selection.model_id = "paid",
    q => q.provider_selection.api_key = "other",
  ]) {
    const copy = structuredClone(query); poison(copy);
    assert.equal(guard("/api/assistant/chat_stream", copy), false);
  }
  assert.equal(guard("/api/assistant/chat_stream", query), true);
  assert.equal(guard("/api/assistant/chat_stream", query), false, "Duplicate query must be denied");
  console.log("PASS: profile semantic oracle rejects message/project/mode/id changes; no product launch");
}
function requestGuard(endpoint, projectId, question) {
  let inquiryUsed = false, creationUsed = false;
  const tasks = new Set();
  const selection = s => s?.base_url === endpoint && s.connection_id === "qa-profile-upgrade" &&
    s.model_id === "controlled-model" && s.api_key === "test-only-secret";
  return (route, body) => {
    if (route === "/api/assistant/chat_stream") {
      if (inquiryUsed || body?.question !== question || !selection(body.provider_selection)) return false;
      inquiryUsed = true; return true;
    }
    if (route === "/api/assistant/creation/processes") {
      if (creationUsed || body?.project_id !== projectId || !/^[\w-]{1,160}$/.test(body.id || "") ||
        body.request?.user_request !== "QUEUE_A 构建升级验证标题组件" || !selection(body.request?.provider_selection)) return false;
      creationUsed = true; tasks.add(body.id); return true;
    }
    const match = route.match(/^\/api\/assistant\/creation\/processes\/([\w-]+)\/local-result$/);
    return Boolean(match && tasks.has(match[1]) && body?.project_id === projectId);
  };
}
function create({ out, report, save, shot, snapshot }) {
  let provider, baseline, projectId, disposed = false, guard;
  const question = "HISTORY_A 说明本轮覆盖升级会话", componentName = "同目录升级中文图卡";
  const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2), { flag: "wx" });
  async function api(route, body) {
    const r = await fetch("http://127.0.0.1:8278" + route, {
      ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    assert(r.ok); const v = await r.json(); assert(v.ok); return v.data;
  }
  async function assistant(page, mode) {
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
    await panel.getByRole("button", { name: mode === "creation" ? "创造模式" : "问询模式", exact: true }).click();
    return panel;
  }
  async function edit(page) {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  }
  async function library(page) {
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
    const control = page.locator('[data-layout-type-option="renpy"]:visible');
    if (await control.getAttribute("aria-pressed") !== "true") {
      await control.click();
      await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
      await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    }
    const details = page.locator("details.renpy-personal-component-library");
    if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
    return page.getByTestId("custom-component-library");
  }
  async function state(page) {
    return { conversations: await records(page, "agentvn-assistant-workbench", "conversations"),
      components: await records(page, "agentvn-personal-component-library", "components") };
  }
  async function recordStage(label, fn) {
    const row = { label, status: "RUNNING", startedAt: new Date().toISOString() };
    (report.profileUpgradeCases ??= []).push(row); save();
    try { row.evidence = await fn(); row.status = "PASS"; }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
    finally { row.finishedAt = new Date().toISOString(); save(); }
  }
  return {
    allow(request) {
      if (!provider || disposed) return false;
      const u = new URL(request.url());
      if (u.origin !== "http://127.0.0.1:8278") return false;
      let body; try { body = request.postDataJSON(); } catch { return false; }
      const permitted = !u.search && !u.hash && guard?.(u.pathname, body);
      if (permitted) {
        (report.controlledProfileSubmissions ??= []).push({ path: u.pathname, projectId, at: new Date().toISOString() }); save();
      }
      return permitted;
    },
    async author(page) {
      await recordStage("old-real-UI-inquiry-creation-draft-and-image-component", async () => {
        projectId = (await snapshot()).metadata.projectId;
        provider = await controlledAssistantProvider();
        guard = requestGuard(provider.url, projectId, question);
        await api("/api/project/state", {
          provider_connections: [{ connection_id: "qa-profile-upgrade", provider_type: "openai_compatible",
            display_name: "本机受控覆盖升级", base_url: provider.url, api_key_storage: "local", enabled: true }],
          provider_models: [{ provider_id: "qa-profile-model", connection_id: "qa-profile-upgrade",
            model_id: "controlled-model", model_name: "controlled-model", enabled: true,
            capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
          provider_selections: { text_generation: "qa-profile-model" }, provider_secrets: { "qa-profile-upgrade": "test-only-secret" },
        });
        await page.reload(); await page.locator(".project-home").waitFor();
        await page.getByRole("button", { name: "继续上次编辑", exact: true }).click(); await settleEditor(page);
        let panel = await assistant(page, "inquiry");
        await panel.getByLabel("向大模型助手提问", { exact: true }).fill(question);
        await panel.getByRole("button", { name: "发送", exact: true }).click();
        await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
        panel = await assistant(page, "creation");
        await panel.getByLabel("向大模型助手提问", { exact: true }).fill("QUEUE_A 构建升级验证标题组件");
        await panel.getByRole("button", { name: "生成创作提案", exact: true }).click();
        await panel.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor({ timeout: 60000 });
        assert.equal(provider.requests.length, 2);
        assert.equal(provider.requests[0].creation, false); assert.equal(provider.requests[0].tools.length, 0);
        assert.equal(provider.requests[1].creation, true);
        await shot("old-created-conversations");
        const lib = await library(page);
        // Native WebView's canvas creates the fixture; no optional npm codec.
        const encoded = await page.evaluate(() => {
          const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 32;
          const context = canvas.getContext("2d"); if (!context) throw Error("Missing canvas");
          context.fillStyle = "#ffffff"; context.fillRect(0, 0, 48, 32);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        const bytes = Buffer.from(encoded, "base64"), imageFile = path.join(out, "升级依赖.png");
        assert.equal(bytes.readUInt32BE(16), 48); assert.equal(bytes.readUInt32BE(20), 32);
        fs.writeFileSync(imageFile, bytes, { flag: "wx" });
        await lib.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles(imageFile);
        await lib.getByRole("status").filter({ hasText: /已添加 1 个图片依赖/ }).waitFor();
        const ids = await lib.locator(".custom-component-dependencies code").allTextContents(); assert.equal(ids.length, 1);
        await lib.getByLabel("组件名称", { exact: true }).fill(componentName);
        await lib.getByLabel("组件 HTML", { exact: true }).fill(
          `<div class="root"><img class="icon" data-asset="${ids[0]}" aria-label="升级图片"/><button class="button" type="button" data-action="open_about">升级关于</button></div>`);
        await lib.getByLabel("组件 CSS", { exact: true }).fill(
          ".root { padding: 8px; }.icon { width: 48px; height: 32px; }.button { color: #ffffff; background-color: #223344; padding: 8px; }");
        await lib.getByTestId("component-save").click();
        await lib.getByRole("status").filter({ hasText: `“${componentName}”已保存` }).waitFor();
        baseline = await state(page);
        assert.equal(baseline.conversations.length, 2); assert.equal(baseline.components.length, 1);
        assert(baseline.conversations.every(c => c.projectId === projectId));
        const asset = baseline.components[0].assets[0];
        assert.equal(asset.sha256, digest(bytes)); assert.equal(asset.byteLength, bytes.length);
        write("profile-old-records.json", baseline);
        await shot("old-created-image-component"); await edit(page);
        return { projectId, conversations: 2, components: 1, dependencySHA256: asset.sha256,
          actualUI: true, modelBoundary: "CONTROLLED_LOCAL_ONLY", realModelRequests: 0 };
      });
    },
    async verify(page, phase) {
      await recordStage(phase + "-actual-inquiry-draft-component-and-dependency-preserved", async () => {
        assert(baseline);
        const panel = await assistant(page, "inquiry");
        await panel.getByText("HISTORY_A 这是安装版历史验收回答。", { exact: true }).waitFor();
        assert.equal(await panel.getByRole("heading", { name: "QUEUE_A组件", exact: true }).count(), 0);
        const creation = await assistant(page, "creation");
        await creation.getByTestId("assistant-creation-draft").getByRole("heading", { name: "QUEUE_A组件", exact: true }).waitFor();
        await shot(phase + "-preserved-conversations");
        const lib = await library(page);
        await lib.getByRole("checkbox", { name: `选择 ${componentName}`, exact: true }).waitFor();
        const now = await state(page);
        assert.deepEqual(normalize(now.conversations), normalize(baseline.conversations));
        assert.deepEqual(now.components, baseline.components);
        write("profile-" + phase + "-records.json", now);
        assert.equal(provider.requests.length, 2, "Opening old histories must not resubmit model tasks");
        await shot(phase + "-preserved-image-component"); await edit(page);
        return { exactConversations: 2, exactComponents: 1, actualUI: true, noModelResubmission: true };
      });
    },
    async dispose() {
      disposed = true;
      if (provider) {
        report.profileModelRequests = provider.requests;
        report.profileProviderCleanup = await provider.stop(); provider = undefined; save();
      }
    },
  };
}
module.exports = { augment, selfTest, create, normalize };
