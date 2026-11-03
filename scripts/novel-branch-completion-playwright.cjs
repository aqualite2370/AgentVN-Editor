"use strict";
// Actual source UI + backend + Player. Only the model HTTP response is controlled.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { text, chapters, answer } = require("./lib/controlled-novel-multichapter-provider.cjs");
const { jsonAfter } = require("./lib/controlled-novel-default-provider.cjs");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { settleEditor, settleRuntime, dismissEnvironmentCompletion, realDownload } = require("./lib/installed-acceptance.cjs");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { listeners, until } = require("./lib/current-native-editor-session.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt || "", /^\d{2}$/);
const resumeFile = process.argv[3] === "-" ? undefined : process.argv[3];
const installationFile = process.argv[4];
assert(!(resumeFile && installationFile));
const resume = resumeFile ? JSON.parse(fs.readFileSync(resumeFile, "utf8")) : null;
if (resume) {
  assert.equal(resume.scope, "SOURCE_UI_REAL_BACKEND_CONTROLLED_MODEL_AND_BROWSER_PLAYER");
  assert.equal(resume.cleanup, "PASS");
  assert(resume.cases.slice(0, 3).every(c => c.status === "PASS") && resume.cases.length >= 3);
  assert.equal(resume.model.length, 20);
}
const out = `F:/AgentVN/QA/Novel-Branch-Completion-20261103-01/${installationFile ? "installed" : "browser"}-${attempt}`;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const report = { status: "RUNNING", scope: "SOURCE_UI_REAL_BACKEND_CONTROLLED_MODEL_AND_BROWSER_PLAYER",
  startedAt: new Date().toISOString(), cases: [], model: [], screenshots: [], errors: [], paidRequests: 0,
  launches: [], cleanups: [] };
if (installationFile) report.scope = "ACTUAL_INSTALLED_EDITOR_AND_BUNDLED_BACKEND_CONTROLLED_MODEL";
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const desc = file => ({ path: path.resolve(file), bytes: fs.statSync(file).size,
  sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") });
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
report.source = ["editor/src/store/novelImportStore.ts", "editor/src/utils/exportScript.ts",
  "scripts/lib/controlled-novel-multichapter-provider.cjs"].map(f => desc(path.join(root, f)));
const project = fixture("qa-branch-completion-" + attempt);
project.title = "两章双分支功能验收";
const input = path.join(out, "隔离工程.vnproj"), novel = path.join(out, "两章原文.txt");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.writeFileSync(novel, text, { flag: "wx" });
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "services");
let env, browser, page, runtime, runtimePage, nativeHost;
const sockets = new Set();
const provider = http.createServer(async (req, res) => {
  const item = { at: new Date().toISOString() }; report.model.push(item);
  try {
    assert.equal(req.method, "POST"); assert.equal(req.url, "/v1/chat/completions");
    assert(report.model.length <= 20, "No hidden retry or extra model stage allowed");
    const parts = []; for await (const part of req) parts.push(part);
    const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
    assert.equal(req.headers.authorization, "Bearer test-only-secret");
    assert(!JSON.stringify(payload).includes("test-only-secret"));
    const response = answer(payload), user = payload.messages.findLast(m => m.role === "user").content;
    if (["planning-branches", "adaptation-branches"].includes(response.stage)) {
      const candidate = response.stage === "planning-branches"
        ? jsonAfter(user, "Scene plan:").scenes[0] : jsonAfter(user, "Scene candidate:");
      response.result.branch_suggestions = [{
        suggestion_id: "qa_branch_" + candidate.chapter_id, source_scene_id: candidate.scene_candidate_id,
        choice_display_name: "可选探看", choice_text: "可选探看" + candidate.chapter_id,
        branch_summary: "待作者审阅的假设分支", confidence: .95, enabled_by_default: false,
      }];
    }
    if (response.stage === "scene-beat" && response.chapterId === chapters[1].chapter_id)
      response.result.is_ending = true;
    Object.assign(item, response);
    const value = typeof response.result === "string" ? response.result : JSON.stringify(response.result);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.end("data: " + JSON.stringify({ id: "qa-local", object: "chat.completion.chunk", created: 1,
      model: "qa-default", choices: [{ index: 0, delta: { content: value }, finish_reason: null }] }) +
      "\n\ndata: " + JSON.stringify({ id: "qa-local", object: "chat.completion.chunk", created: 1,
        model: "qa-default", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
  } catch (e) {
    item.error = String(e.stack || e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(e) } }));
  } finally { save(); }
});
provider.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
async function step(name, action) {
  const item = { name, status: "RUNNING" }; report.cases.push(item); save();
  console.log("START " + name);
  try { item.detail = await action(); item.status = "PASS"; console.log("PASS " + name); }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function api(route, data) {
  const response = await fetch(env.backendUrl + route, data === undefined ? {} :
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json(); assert(response.ok && result.ok, JSON.stringify(result));
  return result.data;
}
const snapshot = async () => {
  const data = await api("/api/project/projects/" + project.project_id);
  return data;
};
const graph = p => ({ nodes: p.nodes, edges: p.edges });
const stableGraph = p => JSON.parse(JSON.stringify({
  nodes: p.nodes.map(node => {
    const copy = structuredClone(node);
    delete copy.measured;
    delete copy.data.loadingAnimation;
    delete copy.data.openingAudio;
    return copy;
  }),
  edges: p.edges,
}));
const assertStableBaselinePreserved = (actual, baseline) => {
  const actualStable = stableGraph(actual), baselineStable = stableGraph(baseline);
  for (const node of baselineStable.nodes)
    assert.deepEqual(actualStable.nodes.find(item => item.id === node.id), node);
  for (const edge of baselineStable.edges)
    assert.deepEqual(actualStable.edges.find(item => item.id === edge.id), edge);
};
async function geometry(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: el === hit || el.contains(hit) };
  });
}
async function exportCartridge() {
  await page.locator('[data-workspace-surface="publish"]:visible').click();
  const panel = page.locator(".cartridge-export-panel:visible"); await panel.waitFor(); await settleEditor(page);
  await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
  await dismissEnvironmentCompletion(page);
  await panel.locator('[data-package-stage="settings"]').click();
  await panel.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await panel.locator('[data-package-stage="checks"]').click();
  const consent = panel.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await consent.count()) await consent.check();
  const download = nativeHost ? await realDownload(page, nativeHost.cdp, out, panel.locator(".package-primary-action"))
    : await (async () => {
      const pending = page.waitForEvent("download", { timeout: 60000 });
      await panel.locator(".package-primary-action").click();
      const event = await pending, file = path.join(out, "双分支.vncart");
      await event.saveAs(file); assert.equal(await event.failure(), null);
      return desc(file);
    })();
  const file = nativeHost ? download.path : download.path;
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const script = JSON.parse(await zip.file(manifest.entry_script).async("string"));
  return { file: nativeHost ? download : desc(file), script };
}
(async () => {
  try {
    if (!resume) {
    await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
    report.providerPort = provider.address().port;
    if (installationFile) {
      nativeHost = installedReleaseSession({ installationFile, out, report, save, input });
      page = await nativeHost.start();
      // Permit the real bundled novel backend; this fixture points its model
      // selection exclusively to our owned loopback provider.
      await page.context().unroute(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/);
      env = { backendUrl: `http://127.0.0.1:${nativeHost.current.ports[0]}`, url: page.url(),
        open: async () => {
          const response = await fetch(env.backendUrl + "/api/project/projects/import", { method: "POST",
            headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
            body: fs.readFileSync(input) });
          assert(response.ok && (await response.json()).ok);
          await page.evaluate(({ id, directory }) => localStorage.setItem("agentvn.projectExportDirectories.v1",
            JSON.stringify({ [id]: directory })), { id: project.project_id, directory: out });
          await page.reload(); await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
          await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
        },
        stop: () => nativeHost.stop("final exact installed-session cleanup") };
      report.owner = { backendUrl: env.backendUrl, installation: nativeHost.installation, native: true };
    } else {
      env = await startEditorAcceptance(process.env.AGENTVN_WORKSPACE_OUTPUT, { isolateBackendWorkingDirectory: true });
      report.owner = { backendPid: env.backendPid, backendUrl: env.backendUrl, vitePid: env.server.pid, url: env.url };
    }
    await api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-default", provider_type: "openai_compatible", display_name: "本机受控",
        base_url: `http://127.0.0.1:${report.providerPort}/v1`, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-default", model_id: "qa-default",
        model_name: "qa-default", enabled: true, capabilities: ["text_generation"],
        default_parameters: { structured_mode: "json_object", request_timeout_seconds: 60 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-default": "test-only-secret" },
    });
    if (!nativeHost) {
      browser = await chromium.launch();
      page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    }
    page.setDefaultTimeout(30000);
    page.on("pageerror", e => report.errors.push(String(e)));
    await env.open(page); await settleEditor(page);
    // Imported defaults and ReactFlow measurements are applied before the first
    // debounced backend write; capture the actual loaded graph as the baseline.
    report.initial = nativeHost ? undefined : await page.evaluate(async () => {
      const store = (await import("/src/store/editorStore.ts")).useEditorStore.getState();
      return JSON.parse(JSON.stringify({ nodes: store.nodes, edges: store.edges }));
    });
    await step("real-ui-two-chapter-analysis-and-author-confirmation", async () => {
      await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
      const w = page.getByTestId("novel-import-workbench"); await w.waitFor();
      await w.locator('[data-help-key="novel.importFile"] input').setInputFiles(novel);
      await w.getByRole("region", { name: "小说文件导入检测" }).waitFor();
      await w.locator('[data-help-key="novel.continueDirect"]').click();
      if (nativeHost) {
        await page.waitForTimeout(500);
        report.initial = await snapshot();
      }
      await w.locator('[data-help-key="novel.branchSuggestions"]').check();
      await w.locator('[data-help-key="novel.aiStart"]').click();
      await w.locator('[data-help-key="novel.confirmOutline"]:not(:disabled)').waitFor({ timeout: 90000 });
      assert.equal(report.model.length, 6);
      await w.locator('[data-help-key="novel.confirmOutline"]').click();
      await w.locator(".novel-import-report-panel").waitFor({ timeout: 90000 });
      await until(async () => {
        const p = await snapshot();
        return p.nodes.filter(n => n.data.nodeKind === "choice").length === 2;
      }, "actual branch graph persisted", 30000);
      const p = await snapshot(), added = p.nodes.filter(n => n.data.editorMeta?.importSessionId);
      assert.equal(added.length, 2);
      const choices = p.nodes.filter(n => n.data.nodeKind === "choice");
      assert.equal(choices.length, 2); assert.equal(p.nodes.filter(n => n.data.nodeKind === "end").length, 1);
      for (const choice of choices) for (const option of choice.data.choice.choices)
        assert.equal(p.edges.filter(e => e.source === choice.id && e.sourceHandle === option.choice_id).length, 1);
      assert.equal(report.model.length, 20); assert(report.model.every(m => !m.error));
      assertStableBaselinePreserved(p, report.initial);
      report.generated = p; return { chapters: added.length, choices: choices.length, localHttpRequests: 20 };
    });
    await step("real-handle-connect-save-package-and-reopen", async () => {
      await page.locator('[data-help-key="toolbar.novelImport.closeWorkbench"]').click();
      await page.getByTestId("novel-import-workbench").waitFor({ state: "detached" }); await settleEditor(page);
      await page.locator(".react-flow__controls-fitview").click();
      await page.waitForFunction(() => {
        const v = document.querySelector(".react-flow__viewport")?.getAttribute("style"), previous = window.__qaFit;
        window.__qaFit = { value: v, frames: previous?.value === v ? previous.frames + 1 : 0 };
        return window.__qaFit.frames >= 3;
      }, null, { polling: "raf" });
      const first = report.generated.nodes.find(n => n.data.scene?.scene_id === "qa_multi_scene_1");
      const a = await geometry(page.locator('.react-flow__node[data-id="scene"] .react-flow__handle.source[data-handleid="default"]'));
      const b = await geometry(page.locator(`.react-flow__node[data-id="${first.id}"] .react-flow__handle.target[data-handleid="default"]`));
      assert(a.hit && b.hit);
      await page.mouse.move(a.rect.x + a.rect.width / 2, a.rect.y + a.rect.height / 2); await page.mouse.down();
      await page.mouse.move(b.rect.x + b.rect.width / 2, b.rect.y + b.rect.height / 2, { steps: 16 }); await page.mouse.up();
      await until(async () => (await snapshot()).edges.some(e => e.source === "scene" && e.target === first.id),
        "real authored graph connection", 15000);
      const pending = nativeHost ? null : page.waitForEvent("download");
      await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
      let file;
      if (nativeHost) {
        await page.getByTestId("project-save-confirmation").waitFor();
        const files = fs.readdirSync(out).filter(name => name.endsWith(".vnproj") && name !== path.basename(input));
        assert.equal(files.length, 1); file = path.join(out, files[0]);
      } else {
        const download = await pending; file = path.join(out, "保存双分支.vnproj"); await download.saveAs(file);
      }
      await page.getByTestId("project-save-confirmation").getByRole("button", { name: "OK", exact: true }).click();
      const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
      const saved = JSON.parse(await zip.file("project.json").async("string"));
      report.saved = desc(file); report.connected = saved;
      await page.reload(); await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      assert.deepEqual(graph(await snapshot()), graph(saved));
      assert.equal(report.model.length, 20);
      return { portable: report.saved, reloadPreservedGraph: true, modelCallsAfterReload: 0 };
    });
    await step("public-cartridge-export-preserves-both-mainlines", async () => {
      report.exported = await exportCartridge();
      const scenes = report.exported.script.scenes;
      const choices = scenes.filter(s => s.commands.some(c => c.type === "choice"));
      assert.equal(choices.length, 2);
      for (const scene of choices) assert.equal(scene.commands[0].choices.length, 2);
      const last = scenes.find(s => s.scene_id === "qa_multi_scene_2");
      assert(!last.is_ending && last.next_scene_id);
      const mainline = scenes.find(s => s.scene_id === last.next_scene_id).commands[0].choices.find(c => c.choice_id === "mainline");
      assert(scenes.find(s => s.scene_id === mainline.target_scene_id)?.is_ending);
      return { cartridge: report.exported.file, runtimeChoices: choices.length, terminalTarget: mainline.target_scene_id };
    });
    if (nativeHost) {
      assert.equal(report.model.length, 20); assert(report.cases.every(c => c.status === "PASS"));
      await nativeHost.stop("attributed installed host/backend restart; not normal native close");
      page = await nativeHost.start();
      await page.context().unroute(/\/api\/(?:assistant\/(?:chat|creation\/processes)|novel\/.*process)/);
      env.backendUrl = `http://127.0.0.1:${nativeHost.current.ports[0]}`;
      await step("actual-installed-host-backend-restart-preserves-graph-and-task", async () => {
        await page.locator('[data-help-key="home.recentProject"]:visible').first().click();
        await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
        assertStableBaselinePreserved(await snapshot(), report.connected);
        await page.locator('[data-help-key="toolbar.novelImport"]:visible').click();
        await page.getByTestId("novel-import-workbench").locator(".novel-import-report-panel").waitFor();
        assert.equal(report.model.length, 20);
        await nativeHost.shot("installed-novel-restored");
        return { actualProcessRestart: true, unchangedGraph: true, newModelCalls: 0 };
      });
      report.status = "PASS"; return;
    }
    } else {
      assert.deepEqual(desc(resume.exported.file.path), resume.exported.file);
      for (const source of resume.source) assert.deepEqual(desc(source.path), source);
      report.continuation = desc(resumeFile);
      report.cases = resume.cases.slice(0, 3).map(c => ({ ...c, referencedFrom: report.continuation }));
      report.exported = resume.exported;
      report.inheritedLocalModelRequests = 20;
      browser = await chromium.launch();
    }
    runtime = await startOwnedViteServer({ root: path.join(root, "GameCli_framework"),
      configFile: path.join(root, "GameCli_framework/vite.config.cjs"), logFile: path.join(out, "player.log") });
    report.playerOwner = { pid: runtime.pid, url: runtime.url };
    runtimePage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const cdp = await runtimePage.context().newCDPSession(runtimePage);
    await runtimePage.goto(runtime.url + "/?mode=library");
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await step(`player-mainline-${width}-${dpr}-${reduced}`, async () => {
        const metrics = { width, height: width * 9 / 16, dpr, reduced };
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: metrics.height, deviceScaleFactor: dpr, mobile: false });
        await runtimePage.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await runtimePage.reload();
        await runtimePage.getByTestId("web-cartridge-file").setInputFiles(report.exported.file.path);
        await runtimePage.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
        await runtimePage.getByTestId("start-new-game").waitFor(); await settleRuntime(runtimePage);
        await runtimePage.getByTestId("start-new-game").click(); await settleRuntime(runtimePage);
        let mainlineClicks = 0, currentId = report.exported.script.entry_scene_id;
        const reached = [], scenes = report.exported.script.scenes;
        while (currentId) {
          assert(reached.length < 10 && !reached.includes(currentId), "The mainline must not loop");
          const scene = scenes.find(s => s.scene_id === currentId); assert(scene);
          reached.push(currentId);
          const choiceCommand = scene.commands.find(c => c.type === "choice");
          if (choiceCommand) {
            await runtimePage.waitForFunction(id => {
              const stage = document.querySelector('[data-testid="game-state-playing"]');
              return stage?.getAttribute("data-current-scene-id") === id &&
                stage.getAttribute("data-waiting-choice") === "true";
            }, currentId);
            const choice = runtimePage.getByRole("button", { name: "选择：继续原文主线", exact: true });
            const g = await geometry(choice); assert(g.hit);
            assert.equal(await runtimePage.locator(".choice-option:visible").count(), 2);
            await choice.focus(); assert(await choice.evaluate(n => document.activeElement === n));
            await choice.click(); mainlineClicks++;
            currentId = choiceCommand.choices.find(c => c.choice_id === "mainline").target_scene_id;
          } else {
            for (const command of scene.commands.filter(c => ["dialog", "narration"].includes(c.type))) {
              await runtimePage.waitForFunction(({ id, text }) => {
                const stage = document.querySelector('[data-testid="game-state-playing"]');
                return stage?.getAttribute("data-current-scene-id") === id &&
                  document.querySelector(".dialog-box")?.getAttribute("aria-label")?.includes(text);
              }, { id: currentId, text: command.text });
              const dialog = runtimePage.locator("button.dialog-box");
              if (await runtimePage.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true")
                await dialog.click();
              await runtimePage.waitForFunction(() =>
                document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
              assert.equal(await dialog.locator(".dialog-text").textContent(), command.text);
              await dialog.click();
            }
            currentId = scene.is_ending ? undefined : scene.next_scene_id;
          }
        }
        await runtimePage.waitForFunction(() =>
          document.querySelector('[data-testid="game-state-playing"]')?.getAttribute("data-ended") === "true");
        assert.equal(mainlineClicks, 2);
        assert(reached.includes("qa_multi_scene_1") && reached.includes("qa_multi_scene_2"));
        assert.equal(await runtimePage.getByTestId("game-state-playing").getAttribute("data-ended"), "true");
        assert.equal(await runtimePage.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
        const capture = await captureInstalledWebview(runtimePage, cdp,
          path.join(out, `mainline-${width}-${dpr}-${reduced}.png`), metrics);
        report.screenshots.push(capture);
        return { metrics, reached, mainlineClicks, actualEndReached: true };
      });
    }
    assert.equal(report.cases.length, 15); assert.equal(report.model.length, resume ? 0 : 20);
    assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(String)).slice(-14000);
      report.failureProject = await snapshot().catch(String);
    }
    if (runtimePage && !runtimePage.isClosed())
      report.failurePlayerText = (await runtimePage.locator("body").innerText().catch(String)).slice(-14000);
  } finally {
    if (env) {
      try {
        await api("/api/project/state", { provider_secrets: {} });
        assert.deepEqual(await api("/api/providers/secrets"), {});
        report.testCredentialCleanup = "PASS_EMPTY_SYNTHETIC_SECRET_CHANNEL";
      } catch (e) { report.cleanupError = String(e); }
    }
    await browser?.close(); await runtime?.stop(); await env?.stop();
    for (const socket of sockets) socket.destroy();
    if (provider.listening) await new Promise(resolve => provider.close(resolve));
    const ports = [report.providerPort, env && Number(new URL(env.backendUrl).port),
      env && Number(new URL(env.url).port), runtime && Number(new URL(runtime.url).port),
      ...(report.launches || []).flatMap(launch => launch.ports)].filter(Boolean);
    report.remainingPorts = listeners(ports);
    report.cleanup = report.remainingPorts.length === 0 && !report.cleanupError ? "PASS" : "FAILED";
    if (report.cleanup !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, error: report.error, cleanup: report.cleanup }));
  }
})();
