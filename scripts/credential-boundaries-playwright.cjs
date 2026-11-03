"use strict";
// Source Editor + actual backend, normal Chromium disk cache enabled.
// Only the external model is controlled. No page.route/network cache bypass.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { listeners, rows, until } = require("./lib/current-native-editor-session.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const root = path.resolve(__dirname, "..");
const attempt = process.argv[2] || "01";
const installationFile = process.argv[3];
const resumeFile = process.argv[4];
const resume = resumeFile ? JSON.parse(fs.readFileSync(resumeFile, "utf8")) : null;
if (resume) {
  assert(installationFile && resume.scope === "ACTUAL_INSTALLED_EDITOR_WEBVIEW_AND_BACKEND_CONTROLLED_MODEL");
  assert.equal(resume.cases.length, 17); assert(resume.cases.slice(0, 16).every(c => c.status === "PASS"));
  assert.equal(resume.cleanup, "PASS"); assert.equal(resume.screenshots.length, 12);
}
assert.match(attempt, /^\d{2}$/);
const out = `F:/AgentVN/QA/Credential-Boundaries-20261102-01/${installationFile ? "installed" : "browser"}-${attempt}`;
assert(!fs.existsSync(out), "Never overwrite prior evidence");
fs.mkdirSync(out, { recursive: true });
const TOKEN = "qa-credential-browser-only-20261102-NEVER-USER";
const ROTATED = "qa-credential-browser-rotated-20261102-NEVER-USER";
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: installationFile ? "ACTUAL_INSTALLED_EDITOR_WEBVIEW_AND_BACKEND_CONTROLLED_MODEL"
    : "SOURCE_EDITOR_REAL_BROWSER_AND_BACKEND_NOT_INSTALLED_OR_REAL_MODEL",
  cases: [], api: [], model: [], screenshots: [], errors: [], cleanup: "PENDING",
  realModelRequests: 0, testCredentialsOnly: true, launches: [], cleanups: [] };
if (resume) report.continuation = { path: path.resolve(resumeFile),
  sha256: crypto.createHash("sha256").update(fs.readFileSync(resumeFile)).digest("hex"),
  preservedStatus: resume.status, referencedPassedCases: 16, repeatedDisplayMatrix: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const input = path.join(out, "隔离凭据工程.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture("qa-credential-boundaries-" + attempt)), { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
let env, context, page, cdp, nativeHost, expectedToken = TOKEN;
const responseTasks = new Set();
const credentialRequests = new Set();
const sockets = new Set();
const model = http.createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end(); return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString());
    const text = JSON.stringify(payload);
    const prompt = payload.messages.at(-1).content;
    let outline;
    if (prompt.includes("summary 是全书短摘要")) outline = {
      document_id: "installed-boundary", title: "隔离两章", summary: "两章摘要", main_plot: "连续主线",
    };
    else if (prompt.includes("章节结构和冲突提示")) outline = { chapters: [
      { chapter_id: "ch1", title: "第一章", index: 0, start_offset: 0, end_offset: 50, summary: "前半" },
      { chapter_id: "ch2", title: "第二章", index: 1, start_offset: 50, end_offset: 100, summary: "后半" },
    ] };
    else if (prompt.includes("主线总览:") && prompt.includes("分块分析数据:"))
      outline = { characters: [], locations: ["车站"] };
    const item = { authenticated: request.headers.authorization === `Bearer ${expectedToken}`,
      credentialInBody: [TOKEN, ROTATED].some(value => text.includes(value)),
      purpose: outline ? "outline" : "inquiry",
      providerConfigInMessages: JSON.stringify(payload.messages).includes('"provider_selection"'),
      stream: payload.stream === true, at: new Date().toISOString() };
    report.model.push(item); save();
    const answer = outline ? JSON.stringify(outline)
      : `仅本机受控边界验证，认证与问询功能正常。验收序号${report.model.length}`;
    if (!item.authenticated || item.credentialInBody) {
      response.writeHead(403, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Synthetic credential boundary failed" } })); return;
    }
    if (!payload.stream) {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ id: "synthetic", object: "chat.completion", created: 1, model: "controlled",
        choices: [{ index: 0, finish_reason: "stop", message: {
          role: "assistant", content: answer,
        } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    const part = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: "controlled",
      choices: [{ index: 0, delta: { content: answer }, finish_reason: null }] };
    response.write("data: " + JSON.stringify(part) + "\n\n");
    part.choices = [{ index: 0, delta: {}, finish_reason: "stop" }];
    response.end("data: " + JSON.stringify(part) + "\n\ndata: [DONE]\n\n");
  } catch {
    response.writeHead(500).end(); report.errors.push("Controlled provider failure"); save();
  }
});
model.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
async function stage(name, fn) {
  const item = { name, status: "RUNNING", startedAt: new Date().toISOString() };
  report.cases.push(item); save();
  try { item.detail = await fn(); item.status = "PASS"; }
  catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
  finally { item.finishedAt = new Date().toISOString(); save(); console.log(item.status + " " + name); }
}
async function api(method, endpoint, data) {
  const response = await fetch(env.backendUrl + endpoint, { method, headers: { "content-type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(20000) });
  assert(response.ok, "Owned API " + endpoint + " " + response.status);
  return response.json();
}
async function launch() {
  if (nativeHost) {
    page = await nativeHost.start(); context = page.context(); cdp = nativeHost.cdp;
    // The generic session initially guards model writes through Playwright routing,
    // which disables HTTP caching. Remove it BEFORE seeding/restoring test keys.
    // This dedicated profile has only our synthetic localhost provider; no real keys.
    await context.unrouteAll({ behavior: "wait" });
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    report.normalCacheDuringCredentialTests = true;
    if (env) {
      env.backendUrl = `http://127.0.0.1:${nativeHost.current.ports[0]}`;
      env.url = page.url();
    }
  } else {
    context = await chromium.launchPersistentContext(path.join(out, "browser-profile"), {
      headless: true, viewport: { width: 1920, height: 1080 },
      args: ["--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
    });
    page = context.pages()[0] || await context.newPage();
    cdp = await context.newCDPSession(page);
  }
  page.setDefaultTimeout(30000);
  page.on("request", request => {
    if (["/api/project/state", "/api/providers/secrets"].includes(new URL(request.url()).pathname))
      credentialRequests.add(request);
  });
  page.on("requestfinished", request => credentialRequests.delete(request));
  page.on("requestfailed", request => credentialRequests.delete(request));
  page.on("pageerror", error => { report.errors.push(String(error)); save(); });
  page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    if (!["/api/project/state", "/api/providers/secrets"].includes(pathname)) return;
    const task = (async () => { try {
      const text = await response.text();
      const containsCredential = [TOKEN, ROTATED].some(value => text.includes(value));
      report.api.push({ pathname, method: response.request().method(), status: response.status(),
        cacheControl: response.headers()["cache-control"], containsCredential });
    } catch (error) { report.errors.push(`Failed to sample credential response: ${pathname}: ${String(error)}`); }
    })();
    responseTasks.add(task); void task.finally(() => responseTasks.delete(task));
  });
}
async function closeBrowser(reason) {
  if (context) await until(() => credentialRequests.size === 0, "credential HTTP responses completed before process close");
  await Promise.all([...responseTasks]);
  if (nativeHost) await nativeHost.stop(reason);
  else await context?.close();
  context = null;
}
async function providers() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.providers"]:visible').click();
  await page.locator(".provider-settings-panel").waitFor(); await settleEditor(page);
  await page.locator('[data-help-key="provider.selectConnection"]')
    .filter({ hasText: "本机安全验收" }).click();
}
async function inquiry() {
  const before = report.model.length;
  await page.locator('[data-workspace-surface="assistant"]:visible').click();
  await page.getByLabel("向大模型助手提问", { exact: true }).fill("玩家如何在游戏内调整画面比例？");
  await page.locator('[data-help-key="assistant.send"]:visible').click();
  await page.getByText(`仅本机受控边界验证，认证与问询功能正常。验收序号${before + 1}`, { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".assistant-message.is-streaming"));
  assert.equal(report.model.length, before + 1, "Exactly one controlled request, no extra/retry");
  assert(report.model.at(-1).authenticated && !report.model.at(-1).credentialInBody);
}
function scanProfile(profile = path.join(out, nativeHost ? "webview" : "browser-profile")) {
  let files = 0, bytes = 0; const hits = [];
  for (const name of fs.readdirSync(profile, { recursive: true })) {
    const file = path.join(profile, name);
    if (!fs.statSync(file).isFile()) continue;
    const data = fs.readFileSync(file); files++; bytes += data.length;
    if ([TOKEN, ROTATED].some(value => data.includes(Buffer.from(value)) || data.includes(Buffer.from(value, "utf16le"))))
      hits.push(name);
  }
  assert.equal(hits.length, 0, "Test credentials must not appear in Chromium profile file bytes");
  return { files, bytes, credentialMatches: hits.length,
    scope: "Raw UTF8/UTF16 file-byte scan; not memory/forensic compressed-content analysis" };
}
(async () => {
  save();
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  report.modelPort = model.address().port;
  if (installationFile) {
    nativeHost = installedReleaseSession({ installationFile, out, report, save, input });
    await launch();
    env = { backendUrl: `http://127.0.0.1:${nativeHost.current.ports[0]}`, url: page.url(),
      server: { run: fn => fn() }, stop: () => nativeHost.stop("final"),
      open: async () => {
        await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
        await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      } };
    const imported = await fetch(env.backendUrl + "/api/project/projects/import", {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input),
    });
    assert(imported.ok && (await imported.json()).ok);
    report.installation = nativeHost.installation;
  } else {
    env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
  }
  report.services = { frontend: env.url, backend: env.backendUrl, frontendPid: env.server.pid, backendPid: env.backendPid };
  const now = new Date().toISOString();
  await api("POST", "/api/project/state", {
    provider_connections: [{ connection_id: "qa-credentials", display_name: "本机安全验收",
      provider_type: "openai_compatible", base_url: `http://127.0.0.1:${report.modelPort}/v1`,
      enabled: true, api_key_storage: "local", supports_model_discovery: false, created_at: now, updated_at: now }],
    provider_models: [{ provider_id: "qa-credential-model", connection_id: "qa-credentials",
      model_id: "controlled", model_name: "controlled", display_name: "受控模型", enabled: true,
      capabilities: ["text_generation"], default_parameters: { context_budget_tokens: 16000 },
      created_at: now, updated_at: now }],
    provider_selections: { text_generation: "qa-credential-model" },
    provider_secrets: { "qa-credentials": TOKEN },
  });
  if (!nativeHost) await launch();
  await env.server.run(async () => {
    await stage("startup-hydrates-existing-key-without-public-state-disclosure", async () => {
      await env.open(page); await settleEditor(page); await providers();
      assert.equal(await page.locator('[data-help-key="provider.apiToken"]').inputValue(), TOKEN);
      await inquiry();
      return { keyRestored: true, authenticatedModelRequests: 1 };
    });
    for (const width of resume ? [] : [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await stage(`provider-ui-${width}-${dpr}-${reduced}`, async () => {
        const height = width * 9 / 16;
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await providers();
        const token = page.locator('[data-help-key="provider.apiToken"]');
        await token.scrollIntoViewIfNeeded(); await token.click();
        const actual = await token.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, focused: document.activeElement === el,
            hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)),
            overflow: document.documentElement.scrollWidth - innerWidth, masked: el.type === "password",
            within: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
        });
        assert.deepEqual([actual.width, actual.height, actual.reduced], [width, height, reduced]);
        assert(Number.isFinite(actual.dpr) && Math.abs(actual.dpr - dpr) <= 1e-6);
        assert(actual.focused && actual.hit && actual.masked && actual.within && actual.overflow <= 1);
        const screenshot = path.join(out, `provider-${width}-${dpr}-${reduced}.png`);
        const capture = await captureInstalledWebview(page, cdp, screenshot,
          { width, height, dpr, reduced });
        report.screenshots.push({ ...capture, actual });
        return actual;
      });
    }
    await stage("rotate-save-and-real-browser-process-restart-restores-auth", async () => {
      await providers();
      await page.locator('[data-help-key="provider.apiToken"]').fill(ROTATED);
      const persisted = page.waitForResponse(response => new URL(response.url()).pathname === "/api/project/state"
        && response.request().method() === "POST");
      await page.locator('[data-help-key="provider.save"]:visible').click();
      assert((await persisted).ok());
      expectedToken = ROTATED;
      await closeBrowser("credential-save-and-restart");
      report.firstProfileScan = scanProfile();
      await launch(); await page.goto(env.url);
      await page.locator(".project-home").waitFor();
      await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await providers();
      assert.equal(await page.locator('[data-help-key="provider.apiToken"]').inputValue(), ROTATED);
      await inquiry();
      const privateStorageClean = await page.evaluate(() => {
        const text = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } });
        return !text.includes("qa-credential-browser-only-") && !text.includes("qa-credential-browser-rotated-");
      });
      assert(privateStorageClean, "No key copied to local/session storage");
      return { savedAndRestored: true, modelRequests: report.model.length, privateStorageClean };
    });
    if (nativeHost && !resume) for (const streaming of [false, true]) {
      await stage(`installed-backend-outline-auth-without-prompt-credentials-${streaming}`, async () => {
        const before = report.model.length;
        const response = await fetch(env.backendUrl + "/api/novel/import/ai_build_outline" + (streaming ? "_stream" : ""), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            document_id: "installed-boundary", title: "隔离两章", total_chars: 100, analyses: [],
            provider_selection: { connection_id: "qa-credentials", model_id: "controlled",
              base_url: `http://127.0.0.1:${report.modelPort}/v1`, api_key: ROTATED,
              parameters: { structured_mode: "json_object" } },
          }), signal: AbortSignal.timeout(30000),
        });
        const text = await response.text();
        assert(response.ok); assert.equal(response.headers.get("cache-control"), "no-store");
        assert(!text.includes(ROTATED) && !text.includes(TOKEN));
        const events = streaming ? text.split(/\r?\n/).filter(line => line.startsWith("data: "))
          .map(line => JSON.parse(line.slice(6))) : [JSON.parse(text)];
        assert(events.some(value => value && typeof value === "object"
          && (value.chapters || value.data?.chapters)?.length === 2), "Both chapters composed by packaged backend");
        const requests = report.model.slice(before);
        assert.equal(requests.length, 3, "Exactly three actual localhost model HTTP requests");
        assert(requests.every(item => item.purpose === "outline" && item.authenticated
          && !item.credentialInBody && !item.providerConfigInMessages));
        return { streaming, controlledHttpRequests: requests.length, chapters: 2, credentialInPrompt: false };
      });
    }
  });
  await api("POST", "/api/project/state", { provider_secrets: {} });
  report.syntheticDatabaseKeysCleared = true;
  await closeBrowser("final-profile-byte-scan");
  await stage("normal-browser-disk-cache-and-state-responses-have-no-test-credentials", async () => {
    assert(report.api.length >= 6);
    assert(report.api.every(item => item.cacheControl === "no-store"));
    assert(report.api.filter(item => item.pathname === "/api/project/state").every(item => !item.containsCredential));
    assert(report.api.some(item => item.pathname === "/api/providers/secrets" && item.containsCredential));
    assert.equal(report.errors.length, 0);
    const current = scanProfile();
    if (resume) report.previousProfileScan = scanProfile(path.join(path.dirname(resumeFile), "webview"));
    return current;
  });
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  try {
    if (context && env) await api("POST", "/api/project/state", { provider_secrets: {} });
    await closeBrowser("finally");
    if (!nativeHost && env) await api("POST", "/api/project/state", { provider_secrets: {} });
    await env?.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => model.close(resolve));
    const ports = [report.modelPort, ...[report.services?.backend, report.services?.frontend]
      .filter(Boolean).map(url => Number(new URL(url).port))].filter(Boolean);
    assert.equal(listeners(ports).length, 0);
    assert(!rows().some(p => (p.CommandLine || "").includes(path.join(out, "browser-profile").replaceAll("/", "\\"))));
    report.cleanup = "PASS";
  } catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, cleanup: report.cleanup, out }));
});
