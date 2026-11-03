"use strict";
// Actual current packaged EXE/HTTP/SQLite. Only external model replies and one
// explicitly synthetic local-validation receipt are controlled, never project APIs.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const net = require("node:net"), assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { qa, summary, exe, sha, desc, load } = require("./packaged-backend-continuation.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const stages = [
  "invalid-authorizations-rejected-before-model-or-durable-task",
  "inquiry-has-no-tools-and-cannot-accept-creation-permissions",
  "native-context-discloses-only-explicit-aliases-and-allows-authorized-proposal",
  "next-request-does-not-inherit-asset-target-or-page-permission",
  "unknown-tool-is-rejected-without-executing-or-retrying",
  "local-receipts-enforce-task-project-session-and-bounded-result",
  "invalid-provider-validation-does-not-reflect-credential",
  "new-exe-restart-retains-terminal-results-without-author-project-writes",
];
const asset = { id: "selected-image", filename: "授权 中文图标.png", mime_type: "image/png" };
const target = { target_id: "target-1", screen_id: "title", component_type: "main_menu_start_button",
  label: "开始游戏", rect: { x: 72, y: 40, width: 18, height: 8 } };
const component = (id = "selected-image") => ({ components: [{ name: "受限授权组件", screen_id: "title",
  html: `<div class="root"><img data-asset="${id}" /></div>`, css: "" }], edits: [] });
const safe = { components: [{ name: "无素材草稿", screen_id: "title", html: '<div class="root">安全</div>', css: "" }], edits: [] };
const identity = p => `${p.ProcessId}:${p.Created}`;
const option = flag => {
  const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1];
};
async function run(name) {
  assert(/^authorization-\d{2}$/.test(name));
  const activeQa = option("--qa-root") || qa;
  assert(path.resolve(activeQa).toLowerCase().startsWith(path.resolve("F:/AgentVN/QA/").toLowerCase() + path.sep));
  const out = path.join(activeQa, name); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const checkpointRoot = option("--checkpoint-root") || "F:/AgentVN/Checkpoints/Packaged-Creation-Authorization-20261020-01";
  assert(path.resolve(checkpointRoot).toLowerCase().startsWith(path.resolve("F:/AgentVN/Checkpoints/").toLowerCase() + path.sep));
  const checkpoint = path.join(checkpointRoot, name);
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
  for (const f of [__filename, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const dest = path.join(checkpoint, path.basename(f)); fs.copyFileSync(f, dest, fs.constants.COPYFILE_EXCL);
  }
  const prepFile = option("--preparation") || path.join(summary, "preparation.json");
  const buildFile = option("--build-report") || path.join(qa, "build-02/report.json");
  const prep = load(prepFile), build = load(buildFile);
  assert.equal(build.status, "CURRENT_PACKAGED_BACKEND_BUILD_SOURCE_MATCH_PASS");
  assert.equal(sha(exe), build.built.sha256);
  const staged = path.join(out, "copied backend", "creator-backend.exe");
  fs.mkdirSync(path.dirname(staged)); fs.copyFileSync(exe, staged, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const data = path.join(out, "data"), database = path.join(data, "vn_engine.db"); fs.mkdirSync(data);
  const r = { status: "RUNNING", at: new Date().toISOString(), executable: desc(staged), database,
    preparation: desc(prepFile), build: desc(buildFile),
    scope: "CURRENT_PACKAGED_BACKEND_AUTHORIZATION_NOT_EDITOR_MODEL_OR_INSTALLER_ACCEPTANCE",
    cases: [], launches: [], cleanups: [], http: [], requests: [], snapshots: [],
    realModelRequests: 0, paidModelRequests: 0, productChanges: 0,
    boundaries: ["Loopback controlled native-tool replies, not real model reasoning",
      "Explicit isolated database; not default installed Editor or development-directory-free proof",
      "One synthetic successful validation receipt tests ownership, not actual Editor parser or Runtime preview",
      "No frontend reviewer merge, ZIP import, game export, Android or installer operations",
      "Exact-owned forced restart/cleanup is not normal Editor-close evidence"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(r, null, 2));
  const known = new Map(), sockets = new Set();
  let child, launch, base, server, endpoint, originalProject;
  const canaries = ["UNDISCLOSED_PROJECT_19731", "test-only-secret", "C:\\private\\undisclosed.png"];
  function immutable() {
    for (const f of [...prep.frozen, ...prep.products, prep.input, prep.original,
      ...prep.sources.filter(f => f.path.includes(`${path.sep}backend${path.sep}`) && f.path.endsWith(".py"))])
      assert.equal(sha(f.path), f.sha256, f.path);
    assert.equal(sha(staged), build.built.sha256); assert.equal(sha(exe), build.built.sha256);
  }
  function remember() {
    const all = rows(), owned = ownedProcessTree(all, child.pid, launch.created);
    if (owned.length) launch.created = owned[0].Created;
    for (const p of owned) { assert.equal(path.resolve(p.ExecutablePath), staged); known.set(identity(p), p); }
    r.known = [...known.values()]; save(); return all;
  }
  async function startProvider() {
    server = http.createServer(async (req, res) => {
      try {
        assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/chat/completions");
        const chunks = []; for await (const c of req) chunks.push(c);
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const text = JSON.stringify({ messages: payload.messages, tools: payload.tools });
        for (const c of canaries) assert(!text.includes(c), `Undisclosed context leaked: ${c}`);
        const marker = text.match(/AUTH_[A-Z]+/)?.[0]; assert(marker);
        const previous = r.requests.filter(p => p.marker === marker).length;
        const call = (tool, value) => ({ role: "assistant", content: null, tool_calls: [{
          id: `${marker}-${previous}`, type: "function", function: { name: tool, arguments: JSON.stringify(value) },
        }] });
        let message;
        const toolResult = payload.messages.filter(m => m.role === "tool").at(-1);
        if (marker === "AUTH_CHAT") {
          assert.equal(payload.tools, undefined); message = { role: "assistant", content: "问询回答：不会修改工程。" };
        } else {
          assert(payload.tools.length > 0); assert.equal(payload.tool_choice, "required");
          assert.equal(payload.parallel_tool_calls, false);
          const exposed = payload.tools.map(t => t.function.name);
          assert.deepEqual(exposed.slice().sort(), ["read_assistant_context", "read_assistant_draft",
            "build_assistant_draft", "submit_assistant_component_draft",
            "validate_assistant_draft", "preview_assistant_draft"].sort());
          if (marker === "AUTH_ALLOWED") message = previous === 0 ? call("read_assistant_context", {})
            : call("submit_assistant_component_draft", { ...component(), edits: [{
              target_id: "target-1", screen_id: "title", label: "进入故事", rect: { x: 70 },
            }] });
          else if (marker === "AUTH_REVOKED") message = call("submit_assistant_component_draft", component());
          else if (marker === "AUTH_TARGET") message = call("submit_assistant_component_draft",
            { edits: [{ target_id: "target-2", screen_id: "title", label: "不允许" }] });
          else if (marker === "AUTH_PAGE") message = call("submit_assistant_component_draft",
            { edits: [{ target_id: "target-1", screen_id: "help", label: "不允许" }] });
          else if (marker === "AUTH_GEOMETRY") message = call("submit_assistant_component_draft",
            { edits: [{ target_id: "target-1", screen_id: "title", rect: { x: 90 } }] });
          else if (marker === "AUTH_UNKNOWN") message = call("read_file", { path: "C:\\private\\undisclosed.png" });
          else if (marker === "AUTH_RECEIPT") message = previous === 0 ? call("build_assistant_draft", safe)
            : previous === 1 ? call("validate_assistant_draft", {}) : call("submit_assistant_component_draft", safe);
          else throw Error(`Unplanned marker: ${marker}`);
          assert(previous < (marker === "AUTH_ALLOWED" ? 2 : marker === "AUTH_RECEIPT" ? 3 : 1),
            "No unplanned loop/retry permitted by controlled fixture");
        }
        r.requests.push({ marker, step: previous, at: Date.now(), tools: (payload.tools || []).map(t => t.function.name),
          messages: payload.messages, toolResult: toolResult ? JSON.parse(toolResult.content) : null });
        save();
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({
          id: `${marker}-${previous}`, object: "chat.completion", created: 1, model: "controlled-authorization",
          choices: [{ index: 0, finish_reason: message.tool_calls ? "tool_calls" : "stop", message }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
      } catch (e) {
        (r.providerErrors ??= []).push(String(e.stack || e)); save();
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Controlled fixture rejected unexpected request", type: "qa_error" } }));
      }
    });
    server.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${server.address().port}/v1`; r.controlledEndpoint = endpoint;
  }
  async function start() {
    const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
      const p = s.address().port; s.close(() => resolve(p)); }); });
    assert.equal(listeners([port]).length, 0);
    const temp = path.join(out, `temp-${r.launches.length + 1}`); fs.mkdirSync(temp);
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^(AGENTVN_|LLM_|EMBEDDING_|WEBVIEW2_|DATABASE_PATH$)/.test(k)) delete env[k];
    Object.assign(env, { DATABASE_PATH: database, AGENTVN_BACKEND_PORT: String(port), AGENTVN_BACKEND_DATA_DIR: data,
      AGENTVN_EDITOR_DATA_DIR: data, AGENTVN_LEGACY_DATABASE_PATHS: "", AGENTVN_BACKEND_LOG: path.join(out, `backend-${r.launches.length}.log`),
      LLM_API_KEY: "test-only-secret", LLM_BASE_URL: endpoint, LLM_MODEL: "controlled-authorization",
      EMBEDDING_API_KEY: "test-only-secret", EMBEDDING_BASE_URL: endpoint, TEMP: temp, TMP: temp });
    const fd = fs.openSync(path.join(out, `process-${r.launches.length}.log`), "wx");
    try { child = spawn(staged, [], { cwd: path.dirname(staged), env, windowsHide: true, stdio: ["ignore", fd, fd] }); }
    finally { fs.closeSync(fd); }
    let spawnError; child.once("error", e => { spawnError = e; });
    launch = { pid: child.pid, port, at: new Date().toISOString(), executable: desc(staged), temp, database };
    r.launches.push(launch); base = `http://127.0.0.1:${port}`; remember();
    await until(async () => {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null);
      try { const v = await fetch(`${base}/api/health`, { headers: { connection: "close" },
        signal: AbortSignal.timeout(1000) }); return v.ok && (await v.json()).service === "agentvn-backend"; } catch { return false; }
    }, "actual EXE health", 90000);
    remember(); launch.listeners = listeners([port]); assert.equal(launch.listeners.length, 1);
    assert(launch.listeners.every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess))); save();
  }
  async function stop() {
    if (!child) return;
    remember(); const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(n => identity(n) === identity(p))) continue;
      ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}')` +
        `{Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`); killed.push(identity(p));
    }
    const now = rows(), c = { killed, normalCloseClaimed: false,
      survivors: [...known.values()].filter(p => now.some(n => identity(n) === identity(p))), listeners: listeners([launch.port]) };
    r.cleanups.push(c); save(); assert.equal(c.survivors.length, 0); assert.equal(c.listeners.length, 0); child = null;
  }
  async function api(route, body, expected = 200) {
    assert(child && child.exitCode === null && child.signalCode === null);
    const response = await fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST",
      headers: { connection: "close", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
    const value = await response.json(); r.http.push({ route, method: body === undefined ? "GET" : "POST",
      status: response.status, at: Date.now() }); save();
    assert.equal(response.status, expected, JSON.stringify(value).replaceAll("test-only-secret", "[SIMULATED_KEY]"));
    if (JSON.stringify(value).includes("test-only-secret")) {
      (r.credentialExposures ??= []).push({ route, status: response.status,
        response: JSON.parse(JSON.stringify(value).replaceAll("test-only-secret", "[SIMULATED_KEY]")) });
      save();
    }
    return value;
  }
  const selection = () => ({ connection_id: "qa-local", base_url: endpoint, api_key: "test-only-secret", model_id: "controlled-authorization",
    parameters: { structured_mode: "tools", request_timeout_seconds: 60 } });
  const envelope = (id, marker, extra = {}) => ({ id, project_id: "auth-project", project_title: "隔离授权",
    conversation_id: `session-${id}`, request: { user_request: `${marker} 本次受控授权验证`, agent_tools: true,
      provider_selection: selection(), ...extra } });
  const task = id => api(`/api/assistant/creation/processes/${id}`);
  async function submit(id, marker, extra = {}, expected = "completed") {
    await api("/api/assistant/creation/processes", envelope(id, marker, extra), 202);
    const value = await until(async () => { const v = await task(id);
      return ["completed", "failed", "cancelled"].includes(v.status) && v; }, `terminal ${id}`);
    assert.equal(value.status, expected, JSON.stringify(value));
    if (expected === "failed") { assert(!value.result); assert(value.errorCode); }
    r.snapshots.push(value); save(); return value;
  }
  async function stage(label, fn, continueOnFailure = false) {
    const c = { name: label, status: "RUNNING", startedAt: Date.now() }; r.cases.push(c); save(); console.log(`START ${label}`);
    try { c.detail = await fn(); c.status = "PASS"; }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); if (!continueOnFailure) throw e; }
    finally { c.finishedAt = Date.now(); save(); console.log(`${c.status} ${label}`); }
  }
  async function unchanged() {
    const actual = (await api("/api/project/projects/auth-project")).data;
    const stable = p => ({ ...p, asset_manifest: p.asset_manifest.map(a => ({
      ...a, metadata: { ...a.metadata, url: undefined },
    })) });
    // Absolute delivery URLs legitimately change with the new owned HTTP port.
    assert.deepEqual(stable(actual), stable(originalProject), "Agent must not write author data");
    for (const f of r.authorAssets) assert.equal(sha(f.path), f.sha256, "Author asset bytes changed");
  }
  try {
    immutable(); await startProvider(); await start();
    const fixture = load(prep.input.path); fixture.project_id = "auth-project"; fixture.title = canaries[0];
    const importResponse = await fetch(`${base}/api/project/projects/import`, { method: "POST",
      headers: { connection: "close", "content-type": "application/octet-stream" }, body: JSON.stringify(fixture),
      signal: AbortSignal.timeout(20000) });
    assert.equal(importResponse.status, 200); originalProject = (await importResponse.json()).data;
    r.originalProject = originalProject;
    r.authorAssets = originalProject.asset_manifest.map(a => desc(a.metadata.filePath)); save();
    await stage(stages[0], async () => {
      const invalid = [
        { authorized_assets: [{ ...asset, filename: "C:\\private\\undisclosed.png" }] },
        { authorized_assets: [{ ...asset, bytes: [1, 2, 3] }] },
        { authorized_assets: [asset, asset] },
        { authorized_assets: [asset], authorized_components: [{ id: "selected", name: "冲突", html: "<div></div>", assets: [asset] }] },
        { authorized_targets: [target, target] }, { project_id: "not-allowed" },
      ];
      const responses = [];
      for (let i = 0; i < invalid.length; i++) responses.push(await api("/api/assistant/creation/processes",
        envelope(`auth-invalid-${i}`, "AUTH_INVALID", invalid[i]), 422));
      assert.equal(r.requests.length, 0);
      assert.deepEqual((await api("/api/assistant/creation/processes")).processes, []);
      return { rejected: invalid.length, responses, modelRequests: 0, durableTasks: 0 };
    });
    await stage(stages[1], async () => {
      const request = { question: "AUTH_CHAT 如何编辑标题", provider_selection: selection() };
      await api("/api/assistant/chat", { ...request, authorized_targets: [target] }, 422);
      assert.equal(r.requests.length, 0);
      const answer = await api("/api/assistant/chat", request); assert.match(answer.answer, /不会修改工程/);
      assert.deepEqual(r.requests[0].tools, []); await unchanged();
      return { answer, tools: r.requests[0].tools, creationPermissionsRejected: true };
    });
    await stage(stages[2], async () => {
      const result = await submit("auth-allowed", "AUTH_ALLOWED", { authorized_assets: [asset], authorized_targets: [target] });
      const requests = r.requests.filter(p => p.marker === "AUTH_ALLOWED"); assert.equal(requests.length, 2);
      assert.deepEqual(requests[1].toolResult, { components: [], assets: [asset], targets: [target] });
      assert.equal(result.result.components[0].html, component().components[0].html);
      assert.deepEqual(result.result.edits[0].rect, { x: 70 });
      await unchanged(); return { result, context: requests[1].toolResult, modelRequests: 2, authorUnchanged: true };
    });
    await stage(stages[3], async () => {
      const outcomes = [];
      for (const [suffix, marker, extra] of [["revoked", "AUTH_REVOKED", {}], ["target", "AUTH_TARGET", { authorized_targets: [target] }],
        ["page", "AUTH_PAGE", { authorized_targets: [target] }], ["geometry", "AUTH_GEOMETRY", { authorized_targets: [target] }]]) {
        const result = await submit(`auth-${suffix}`, marker, extra, "failed");
        assert.equal(result.errorCode, "proposal_not_authorized");
        assert.equal(r.requests.filter(p => p.marker === marker).length, 1); outcomes.push(result);
      }
      await unchanged(); return { outcomes, authorUnchanged: true, noRequestReplay: true };
    });
    await stage(stages[4], async () => {
      const result = await submit("auth-unknown", "AUTH_UNKNOWN", {}, "failed");
      assert.equal(result.errorCode, "provider_error"); assert.match(result.errorMessage, /未开放/);
      assert.equal(r.requests.filter(p => p.marker === "AUTH_UNKNOWN").length, 1);
      assert(!result.toolEvents.some(e => e.tool === "read_file")); await unchanged(); return result;
    });
    await stage(stages[5], async () => {
      await api("/api/assistant/creation/processes", envelope("auth-receipt", "AUTH_RECEIPT"), 202);
      const pending = await until(async () => { const v = await task("auth-receipt"); return v.localToolRequest && v; }, "pending local validation");
      assert.equal(pending.localToolRequest.action, "validate_assistant_draft");
      const receipt = { request_id: pending.localToolRequest.id, project_id: "auth-project",
        conversation_id: "session-auth-receipt", result: { ok: true, status: "validated", component_count: 1 } };
      const route = "/api/assistant/creation/processes/auth-receipt/local-result", denials = [];
      for (const bad of [{ ...receipt, project_id: "other-project" }, { ...receipt, conversation_id: "other-session" },
        { ...receipt, request_id: "unknown" }]) { await api(route, bad, 409); denials.push(409); }
      await api("/api/assistant/creation/processes/auth-allowed/local-result", receipt, 409); denials.push(409);
      await api(route, { ...receipt, result: { ...receipt.result, status: "rendered" } }, 422); denials.push(422);
      await api(route, { ...receipt, result: { ...receipt.result, private_path: "no" } }, 422); denials.push(422);
      assert.equal((await task("auth-receipt")).localToolRequest.id, receipt.request_id);
      await api(route, receipt);
      const result = await until(async () => { const v = await task("auth-receipt"); return v.status === "completed" && v; }, "validated terminal");
      await api(route, receipt, 409); denials.push(409);
      assert(!result.localToolRequest); r.snapshots.push(result);
      const transmitted = r.requests.filter(p => p.marker === "AUTH_RECEIPT"); assert.equal(transmitted.length, 3);
      assert.equal(transmitted[2].toolResult.status, "validated"); await unchanged();
      return { denials, result, modelRequests: 3, syntheticLocalReceipt: true };
    });
    await stage(stages[6], async () => {
      const invalidSelection = selection(); delete invalidSelection.connection_id;
      r.validationCredentialProbes = [];
      for (const [route, body] of [
        ["/api/assistant/chat", { question: "AUTH_INVALID 连接字段缺失不应回显密钥" }],
        ["/api/assistant/creation/component", { user_request: "AUTH_INVALID 连接字段缺失不应回显密钥" }],
      ]) {
        const response = await api(route, { ...body, provider_selection: invalidSelection }, 422);
        r.validationCredentialProbes.push({ route, expected: 422, status: 422,
          exposesCredential: JSON.stringify(response).includes("test-only-secret"),
          response: JSON.parse(JSON.stringify(response).replaceAll("test-only-secret", "[SIMULATED_KEY]")),
          modelRequests: r.requests.length });
      }
      r.validationCredentialProbe = r.validationCredentialProbes[0];
      save();
      for (const probe of r.validationCredentialProbes) {
        assert.equal(probe.exposesCredential, false, "422 response reflects provider_selection.api_key (synthetic sentinel)");
        assert(probe.response.detail.every(d => !("input" in d) && !("ctx" in d)));
        assert(probe.response.detail.some(d => JSON.stringify(d.loc) === JSON.stringify(["body", "provider_selection", "connection_id"])));
      }
      return r.validationCredentialProbes;
    }, true);
    await stage(stages[7], async () => {
      const before = (await api("/api/assistant/creation/processes")).processes;
      assert.equal(before.length, 7); const count = r.requests.length; assert.equal(count, 11);
      await stop(); await start();
      const after = (await api("/api/assistant/creation/processes")).processes; assert.deepEqual(after, before);
      await unchanged(); assert.equal(r.requests.length, count);
      r.finalTasks = after; return { taskCount: 7, finalTasks: after, requests: count, projectsUnchanged: true };
    });
    assert.equal(r.cases.length, stages.length);
    assert.equal(r.providerErrors?.length ?? 0, 0);
    r.status = r.cases.every(c => c.status === "PASS") ? "CURRENT_PACKAGED_CREATION_AUTHORIZATION_PASS" : "FAILED";
    if (r.status === "FAILED") process.exitCode = 1;
  } catch (e) {
    r.status = "FAILED"; r.error = String(e.stack || e); if (e.cause) r.errorCause = String(e.cause); process.exitCode = 1;
  } finally {
    try { await stop(); } catch (e) { r.cleanupError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    const logs = fs.readdirSync(out).filter(f => f.endsWith(".log")).map(f => path.join(out, f));
    r.logPrivacy = { checked: logs.map(desc),
      leakedFiles: logs.filter(f => fs.readFileSync(f, "utf8").includes("test-only-secret")) };
    if (!logs.length || r.logPrivacy.leakedFiles.length) {
      r.status = "FAILED"; r.logPrivacyError = "Missing logs or simulated provider key retained in logs"; process.exitCode = 1;
    }
    if (server) {
      for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve));
      r.providerListenersAfterCleanup = listeners([Number(new URL(endpoint).port)]);
      if (r.providerListenersAfterCleanup.length) { r.status = "FAILED"; process.exitCode = 1; }
    }
    try { immutable(); r.protectedInputsUnchanged = true; }
    catch (e) { r.immutabilityError = String(e); r.status = "FAILED"; process.exitCode = 1; }
    if (fs.existsSync(database)) r.finalDatabase = desc(database);
    r.testSource = desc(__filename); r.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: r.status, cases: r.cases.length, requests: r.requests.length, out, error: r.error }));
  }
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { stages };
