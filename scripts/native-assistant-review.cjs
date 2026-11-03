"use strict";
// Current Dev real WebView and automatic source backend; no product/store writes
// from QA. Controlled external model, not real DeepSeek or installed Release.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { nativeSession, until } = require("./lib/current-native-editor-session.cjs");
const { controlledAssistantReviewProvider } = require("./lib/controlled-assistant-review-provider.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, ".."), label = "Native-Assistant-Review-20261020-01";
const qa = `F:/AgentVN/QA/${label}`, checkpoint = `F:/AgentVN/Checkpoints/${label}`;
const summary = path.join(root, "output/native-assistant-review-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const describe = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const writeNew = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/creator-backend.exe", "editor/src-tauri/binaries/agentvn-player.exe"];
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchStudio.tsx",
  "editor/src/assistant/assistantCreationProjectMerge.ts", "editor/src/components/editor/EditorToolbar.tsx",
  "editor/src/store/editorStore.ts", "editor/src/store/projectStore.ts", "shared/cartridge/uiLayoutProfiles.ts",
  "backend/app/services/assistant_creation_agent.py", "backend/app/api/routes_assistant.py", "editor/src-tauri/src/main.rs"];
function prepare() {
  for (const d of [qa, checkpoint, summary]) { assert(!fs.existsSync(d)); fs.mkdirSync(d, { recursive: true }); }
  const files = [__filename, "scripts/lib/current-native-editor-session.cjs",
    "scripts/lib/controlled-assistant-review-provider.cjs", "scripts/lib/current-native-capture.cjs",
    "scripts/lib/owned-process-tree.cjs", "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md", ...sources];
  const snapshots = [];
  for (const f of files) {
    const source = path.resolve(root, f), destination = path.join(checkpoint, path.relative(root, source));
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    snapshots.push(describe(destination));
  }
  const code = buildSync({ stdin: { resolveDir: root, loader: "ts",
    contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", code)(module, module.exports);
  // Explicit synthetic PNG. Never read a user's images, credentials or project.
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64");
  const image = { sha256: A.sha256(bytes), bytes: bytes.length };
  const projects = ["a", "b"].map(letter => {
    const p = fixture(`native-review-${letter}-20261020-01`); p.title = `Dev审核隔离 ${letter.toUpperCase()} 20261020`;
    const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    p.asset_manifest = [
      { asset_id: "project-asset-1", asset_type: "ui",
        metadata: { filename: "中文 徽章.png", mime_type: "image/png", display_name: "工程徽章",
          data_url: `data:image/png;base64,${bytes.toString("base64")}`, width: 1, height: 1 } },
      { asset_id: "private-project", asset_type: "ui",
        metadata: { filename: "PRIVATE_UNSELECTED.png", mime_type: "image/png", display_name: "未授权工程图片",
          data_url: `data:image/png;base64,${bytes.toString("base64")}`, width: 1, height: 1 } },
    ]; return p;
  });
  for (const p of projects) writeNew(path.join(qa, `${p.project_id}.vnproj`), p);
  writeNew(path.join(summary, "preparation.json"), { at: new Date().toISOString(), products: products.map(describe),
    sources: sources.map(describe), snapshots, projects, image, inputs: projects.map(p => describe(path.join(qa, `${p.project_id}.vnproj`))) });
  console.log(`PREPARED ${qa}`);
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration)); const out = path.join(qa, `session-${iteration}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const priorArg = process.argv.find(a => /^--continue=\d{2}$/.test(a));
  const priorPath = priorArg ? path.join(qa, `session-${priorArg.split("=")[1]}/report.json`) : undefined;
  const prior = priorPath ? load(priorPath) : undefined;
  if (prior) {
    assert.equal(prior.status, "FAILED"); assert.equal(prior.cases.filter(c => c.status === "PASS").length, 4);
    assert.equal(prior.matrix.length, 12); assert.equal(prior.modelRequests.length, 6);
    for (const f of [...prior.products, ...prior.sources, ...prior.runInputs]) assert.equal(sha(f.path), f.sha256);
  }
  const projects = structuredClone(prep.projects);
  for (const p of projects) {
    // Preserve the original red input. Fix only this new run's fixture to use
    // actual AssetRef fields; retain the filename assertion rather than relaxing it.
    for (const a of p.asset_manifest) {
      a.asset_type = "ui";
      a.metadata.filename ??= a.filename;
      a.metadata.mime_type = "image/png";
      delete a.type; delete a.filename;
    }
    writeNew(path.join(out, `${p.project_id}.vnproj`), p);
  }
  const project = projects[0], input = path.join(out, `${project.project_id}.vnproj`);
  const runInputs = projects.map(p => describe(path.join(out, `${p.project_id}.vnproj`)));
  for (const f of [__filename, path.join(root, "scripts/lib/current-native-editor-session.cjs"),
    path.join(root, "scripts/lib/controlled-assistant-review-provider.cjs")])
    fs.copyFileSync(f, path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_AUTOSTART_SOURCE_BACKEND_CONTROLLED_REVIEW_NOT_RELEASE_OR_REAL_DEEPSEEK",
    boundary: "Public import API setup; DOM input in actual WebView; no native picker or physical-input claim.",
    products: prep.products, sources: prep.sources, inputs: prep.inputs, image: prep.image,
    runInputs, fixtureRevision: "AssetRef.asset_type and metadata.filename/mime_type; original session-01 fixture retained.",
    cases: [], launches: [], cleanups: [], matrix: [], screenshots: [], errors: [], submissions: [], localReceipts: [],
    realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    buildAccounting: "Dev startup invokes GameCLI preview build; not a zero-build claim." };
  if (prior) {
    for (const k of ["launches", "cleanups", "matrix", "screenshots", "submissions", "localReceipts",
      "known", "baseline", "merged", "persistedMerged", "atomicObservation", "gestureMeasurements"])
      report[k] = structuredClone(prior[k]);
    report.cases = prior.cases.filter(c => c.status === "PASS").map(c => ({ ...structuredClone(c),
      evidenceSource: { path: priorPath, sha256: sha(priorPath) }, notRerun: true }));
    report.screenshots = report.screenshots.filter(s => path.basename(s.path) !== "failure.png");
    report.priorEvidence = { path: priorPath, sha256: sha(priorPath), notRerun: report.cases.map(c => c.name),
      reason: "Continue the exact DB/WebView and existing native-saved file; completed stages are referenced, not replayed or relabeled." };
  }
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const session = nativeSession({ out, input, report, save,
    profileRoot: prior ? path.dirname(prior.launches[0].data) : out });
  let page, window, provider, baseline, merged;
  async function stage(name, action) {
    if (report.cases.some(c => c.name === name && c.status === "PASS")) return;
    const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log(`START ${name}`);
    try { row.detail = await action(); row.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
  }
  const persisted = async p => (await session.api(`/api/project/projects/${(p || project).project_id}`)).data;
  async function snapshot() {
    // Read-only product observation, not a harness state mutation.
    return page.evaluate(() => {
      const p = window.__AGENTVN_PROJECT_STORE__.getState(), e = window.__AGENTVN_EDITOR_STORE__.getState();
      return JSON.parse(JSON.stringify({ id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: e.nodes, edges: e.edges }));
    });
  }
  const custom = s => s.settings.runtimeUILayout.screens.find(p => p.screen_id === "title").components.filter(c => c.component_type === "custom_component");
  async function openProject() {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
    assert.equal((await snapshot()).id, project.project_id);
  }
  async function openWorkbench() {
    await page.locator('[data-workspace-surface="assistant"]:visible').click(); await A.settleEditor(page);
    const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
    await panel.getByRole("button", { name: "创造模式", exact: true }).click();
    await panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true }).click();
    window = page.getByTestId("assistant-creation-workbench-window"); await window.waitFor();
    await window.getByLabel("向大模型助手提问", { exact: true }).waitFor(); return window;
  }
  async function closeWorkbench() {
    await window.getByRole("button", { name: "关闭工作台", exact: true }).click();
    await window.waitFor({ state: "detached" });
  }
  async function unchanged(before) {
    const now = await snapshot(); for (const k of ["settings", "assets", "nodes", "edges"]) assert.deepEqual(now[k], before[k]);
  }
  async function submit(marker) {
    await window.getByLabel("向大模型助手提问", { exact: true }).fill(`${marker} 使用授权工程徽章构建候选，经验证预览后提交，不自动合并。`);
    const n = report.submissions.length; await window.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await until(() => report.submissions.length === n + 1, "one UI submission");
    const task = report.submissions.at(-1);
    const result = await until(async () => {
      const p = await session.api(`/api/assistant/creation/processes/${task.id}`);
      return ["completed", "failed", "cancelled"].includes(p.status) && p;
    }, "creation terminal", 90000);
    assert.equal(result.status, "completed", JSON.stringify(result));
    // This controlled fixture intentionally uses six tools; not a requirement
    // that a real model must choose the same sequence.
    assert.deepEqual(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool), provider.names);
    report.tasks ??= []; report.tasks.push(result); save();
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    await window.getByTestId("assistant-creation-draft").waitFor();
    return task;
  }
  async function geometry() {
    return window.evaluate(n => {
      const rect = n.getBoundingClientRect();
      return { rect: rect.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
        minimized: n.dataset.minimized, activeInside: n.contains(document.activeElement),
        controls: [...n.querySelectorAll("header nav button")].map(b => {
          const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { name: b.getAttribute("aria-label"), rect: r.toJSON(), hit: h === b || b.contains(h) };
        }) };
    });
  }
  async function bounded() {
    const g = await geometry(), v = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert(g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= v.width + 1 && g.rect.bottom <= v.height + 1);
    assert(g.overflow <= 1 && g.controls.every(c => c.hit)); return g;
  }
  async function gesture(locator, dx, dy) {
    const r = await locator.boundingBox(); assert(r);
    const x = r.x + Math.min(30, r.width / 2), y = r.y + r.height / 2;
    const probe = { dx, dy, targetRect: r, x, y, before: await window.evaluate(n => ({
      rect: n.getBoundingClientRect().toJSON(), style: n.getAttribute("style"),
      transform: getComputedStyle(n).transform,
      animations: n.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })),
    })), hit: await locator.evaluate((n, p) => {
      const h = document.elementFromPoint(p.x, p.y);
      return { correct: h === n || n.contains(h), tag: h?.tagName, class: h?.className };
    }, { x, y }) };
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
    probe.after = await window.evaluate(n => ({ rect: n.getBoundingClientRect().toJSON(),
      style: n.getAttribute("style"), transform: getComputedStyle(n).transform,
      animations: n.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })) }));
    (report.gestureMeasurements ??= []).push(probe); save();
  }
  let downloaded;
  const observedPages = new WeakSet();
  function observeRequests(observedPage) {
    if (observedPages.has(observedPage)) return;
    observedPages.add(observedPage);
    observedPage.on("request", r => {
      if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
        const v = r.postDataJSON();
        report.submissions.push({ id: v.id, projectId: v.project_id,
          request: { ...v.request, provider_selection: "[test-provider]" } }); save();
      } else if (r.method() === "POST" && /\/local-result$/.test(r.url())) {
        report.localReceipts.push({ url: r.url(), payload: r.postDataJSON() }); save();
      }
    });
  }
  try {
    for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256);
    provider = await controlledAssistantReviewProvider();
    report.modelEndpoint = provider.url;
    page = await session.start();
    observeRequests(page);
    for (const f of prior ? [] : runInputs) {
      const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(f.path)) },
        body: fs.readFileSync(f.path), signal: AbortSignal.timeout(20000) }); assert(r.ok); assert((await r.json()).ok);
    }
    const otherBefore = await persisted(prep.projects[1]);
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "本机审核受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model", model_name: "controlled-model",
        enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
    });
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await openProject();
    if (prior) { baseline = report.baseline; merged = report.merged; }
    else { baseline = await snapshot(); report.baseline = baseline; }
    await stage("floating-window-drag-resize-dock-minimize-and-keyboard", async () => {
      await openWorkbench();
      const before = await bounded(); assert(before.activeInside);
      const bar = window.locator(".assistant-creation-workbench-titlebar");
      await gesture(bar, 90, 55); const dragged = await bounded();
      assert(Math.abs(dragged.rect.left - before.rect.left - 90) < 2);
      assert(Math.abs(dragged.rect.top - before.rect.top - 55) < 2);
      const handle = window.getByRole("separator", { name: "调整创造工作台大小", exact: true });
      await gesture(handle, -100, -80); const resized = await bounded();
      assert(Math.abs(resized.rect.width - dragged.rect.width + 100) < 2);
      assert(Math.abs(resized.rect.height - dragged.rect.height + 80) < 2);
      await handle.focus(); await page.keyboard.press("ArrowRight");
      assert.equal((await bounded()).rect.width, resized.rect.width + 24);
      await window.getByRole("button", { name: "停靠左侧", exact: true }).click();
      assert.equal((await bounded()).rect.left, 12);
      await window.getByRole("button", { name: "停靠右侧", exact: true }).click();
      assert.equal((await bounded()).rect.right, 1908);
      await window.getByRole("button", { name: "最小化工作台", exact: true }).click();
      const mini = await bounded(); assert.equal(mini.minimized, "true"); assert.equal(mini.rect.height, 54);
      assert(!await window.getByLabel("向大模型助手提问", { exact: true }).isVisible());
      await window.getByRole("button", { name: "恢复工作台", exact: true }).click();
      await window.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
      const reset = await bounded(); assert.equal(reset.rect.width, before.rect.width);
      assert.equal(reset.rect.left, before.rect.left); await unchanged(baseline);
      return { before, dragged, resized, mini, reset };
    });
    if (process.argv.includes("--window-only")) {
      report.status = "WINDOW_GESTURE_PROBE_PASS"; return;
    }
    await stage("authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts", async () => {
      await window.getByTestId("assistant-new-conversation").click();
      const consent = window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
      assert(!await consent.isChecked()); assert(!await window.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true }).isChecked());
      await consent.check(); const task = await submit("REVIEW_A");
      assert.equal(provider.requests.length, 6); assert.equal(report.localReceipts.length, 2);
      assert(report.localReceipts.every(r => r.payload.project_id === project.project_id && r.payload.result.ok));
      assert.equal(provider.requests[3].receipts.at(-1).result.status, "validated");
      assert.equal(provider.requests[4].receipts.at(-1).result.status, "rendered");
      assert.equal(await window.getByTestId("assistant-creation-review-batch").locator("ol > li").count(), 3);
      assert.deepEqual(task.request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
      await unchanged(baseline); await session.shot("six-tools-three-candidates");
      return { task: task.id, localReceipts: 2, controlledRequests: 6, noAutoMerge: true };
    });
    await stage("exclude-candidate-real-runtime-combination-preview-and-twelve-display-combinations", async () => {
      await window.getByRole("checkbox", { name: "应用候选 排除候选", exact: true }).uncheck();
      for (const [i, name] of ["审核关于卡", "审核帮助卡"].entries()) {
        await window.getByLabel(`${name} 目标页面`, { exact: true }).selectOption("title");
        for (const [k, v] of Object.entries({ x: 62, y: 10 + i * 24, width: 30, height: 21 }))
          await window.getByLabel(`${name} ${k}`, { exact: true }).fill(String(v));
      }
      await window.getByRole("button", { name: "预览所选候选组合", exact: true }).click();
      const preview = window.getByTestId("assistant-creation-batch-runtime");
      await preview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
      const frame = await (await preview.locator("iframe").elementHandle()).contentFrame(); assert(frame); await A.settleRuntime(frame);
      assert.equal(await frame.getByTestId("runtime-custom-component").count(), 2);
      assert.equal(await frame.getByRole("button", { name: "排除候选操作", exact: true }).count(), 0);
      await frame.getByRole("img", { name: "审核关于卡徽章", exact: true }).evaluate(img => img.decode());
      await unchanged(baseline);
      const merge = window.getByTestId("assistant-creation-merge-batch");
      for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }; await session.metrics(v);
        await merge.scrollIntoViewIfNeeded(); await merge.focus();
        const g = await merge.evaluate(n => {
          const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), hit: h === n || n.contains(h), focus: document.activeElement === n };
        });
        assert(g.hit && g.focus && g.rect.top >= 0 && g.rect.bottom <= height && await merge.isEnabled());
        report.matrix.push({ ...v, viewport: await session.metrics(v), geometry: g, window: await bounded(), status: "PASS" }); save();
        if (dpr === 2 && !reduced) await session.shot(`review-${width}-dpr2`);
      }
      await session.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      return { selected: 2, excluded: 1, actualRuntime: true, combinations: report.matrix.length };
    });
    await stage("actual-batch-merge-is-atomic-and-preserves-other-layout-graph-and-authorized-bytes", async () => {
      await page.evaluate(() => {
        window.__QA_NATIVE_REVIEW_COUNTS__ = [];
        window.__QA_NATIVE_REVIEW_UNSUB__ = window.__AGENTVN_PROJECT_STORE__.subscribe(s =>
          window.__QA_NATIVE_REVIEW_COUNTS__.push(s.settings.runtimeUILayout.screens.find(p => p.screen_id === "title")
            .components.filter(c => c.component_type === "custom_component").length));
      });
      await window.getByTestId("assistant-creation-merge-batch").click();
      await window.getByRole("status").filter({ hasText: "已将 2 个候选一次性应用到工程" }).waitFor();
      merged = await snapshot(); report.merged = merged;
      report.atomicObservation = await page.evaluate(() => { window.__QA_NATIVE_REVIEW_UNSUB__(); return window.__QA_NATIVE_REVIEW_COUNTS__; });
      assert(report.atomicObservation.includes(2) && !report.atomicObservation.includes(1));
      assert.equal(custom(merged).length, 2); assert(custom(merged).every(c => !JSON.stringify(c).includes("排除候选")));
      assert.deepEqual(merged.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
      assert.deepEqual(merged.nodes, baseline.nodes); assert.deepEqual(merged.edges, baseline.edges);
      const detail = await until(async () => { const p = await persisted();
        return p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
          .filter(c => c.component_type === "custom_component").length === 2 && p; }, "merge persisted");
      assert.deepEqual(detail.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
      const assets = merged.assets.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id));
      assert.equal(assets.length, 2);
      for (const a of assets) assert.equal(A.sha256(await A.assetBytes(session.current.ports[0], a)), prep.image.sha256);
      report.persistedMerged = detail;
      return { atomicObservation: report.atomicObservation, newAssets: assets.length, excludedNotWritten: true };
    });
    await stage("native-vnproj-save-byte-inspection-and-real-host-backend-restart-reopen", async () => {
      let dialog, artifactSource;
      if (prior) {
        if (prior.projectArtifact) {
          assert.equal(sha(prior.projectArtifact.path), prior.projectArtifact.sha256);
          artifactSource = prior.projectArtifact.path;
        } else {
          const match = prior.failureText.match(/工程已保存到：(C:\\Users\\1\\Downloads\\[^\r\n]+\.vnproj)/);
          assert(match, "Actual prior native success dialog must identify the exact artifact");
          downloaded = match[1]; artifactSource = downloaded;
        }
      } else {
        await closeWorkbench(); await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
        const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
        await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
        dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
        const names = fs.readdirSync(downloads).filter(n => !before.has(n) && n.startsWith(project.title.replace(/\s+/g, "_")) && n.endsWith(".vnproj"));
        assert.equal(names.length, 1); downloaded = path.join(downloads, names[0]);
        artifactSource = downloaded;
      }
      const copy = path.join(out, path.basename(artifactSource)); fs.copyFileSync(artifactSource, copy, fs.constants.COPYFILE_EXCL);
      report.projectArtifact = { path: copy, source: downloaded || prior.projectArtifact.source, sha256: sha(copy),
        generatedAt: prior?.projectArtifact?.generatedAt || fs.statSync(artifactSource).mtime.toISOString() };
      if (!downloaded && prior?.downloadCleanup) report.downloadCleanup = { ...prior.downloadCleanup,
        retainedCopy: copy, priorCleanupEvidence: { path: priorPath, sha256: sha(priorPath) } };
      save();
      const zip = await JSZip.loadAsync(fs.readFileSync(copy)), p = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(p.project_id, project.project_id);
      assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
      for (const a of p.asset_manifest.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id)))
        assert.equal(A.sha256(await zip.file(a.metadata.project_path).async("nodebuffer")), prep.image.sha256);
      assert(!JSON.stringify(p).includes("authorizedProjectAssetIds"));
      const requestCount = provider.requests.length;
      if (!prior) {
        await dialog.getByRole("button", { name: "OK", exact: true }).click();
        await session.stop("planned real host/backend restart; not a normal-close test");
        page = await session.start(); observeRequests(page);
        await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor(); await openProject();
      }
      const reopened = await snapshot();
      assert.deepEqual(reopened.settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
      // Runtime transport addresses must change with an owned new backend port.
      // Compare all author metadata separately and prove every actual byte; do
      // not mask arbitrary URL changes or accept stale/unowned endpoints.
      const authoredAsset = ({ metadata, ...a }) => {
        const { url, filePath, backend_asset_path, data_url, ...authored } = metadata;
        return { ...a, metadata: authored };
      };
      assert.deepEqual(reopened.assets.map(authoredAsset), merged.assets.map(authoredAsset));
      report.reopenedAssetBytes = [];
      for (const asset of reopened.assets) {
        const source = p.asset_manifest.find(a => a.asset_id === asset.asset_id); assert(source);
        const bytes = await A.assetBytes(session.current.ports[0], asset);
        const packedBytes = await zip.file(source.metadata.project_path).async("nodebuffer");
        assert.equal(A.sha256(bytes), A.sha256(packedBytes)); assert.equal(A.sha256(bytes), prep.image.sha256);
        if (asset.metadata.url) {
          const u = new URL(asset.metadata.url);
          assert.equal(u.origin, `http://127.0.0.1:${session.current.ports[0]}`);
          assert.equal(decodeURIComponent(u.pathname), `/api/project/assets/${asset.metadata.backend_asset_path}`);
        }
        if (asset.metadata.filePath) {
          const relative = path.relative(path.join(session.current.data, "backend/project_assets"), asset.metadata.filePath);
          assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
          assert.equal(sha(asset.metadata.filePath), A.sha256(bytes));
        }
        report.reopenedAssetBytes.push({ id: asset.asset_id, sha256: A.sha256(bytes), bytes: bytes.length,
          backendOwned: true, matchesPortableFile: true });
      }
      assert.deepEqual(reopened.nodes, merged.nodes); assert.deepEqual(reopened.edges, merged.edges);
      assert.equal(provider.requests.length, requestCount); report.reopened = reopened;
      return report.projectArtifact;
    });
    await stage("new-session-consent-reset-and-real-layout-edit-conflict-without-overwrite", async () => {
      // Reattach request observers after a genuine new WebView process.
      observeRequests(page);
      await openWorkbench(); await window.getByTestId("assistant-new-conversation").click();
      const consent = window.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
      assert(!await consent.isChecked()); assert(!await window.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true }).isChecked());
      await consent.check(); const task = await submit("CONFLICT_A");
      await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu"); await closeWorkbench();
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
      await page.getByTestId("renpy-player-layout-entry").click();
      await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "游戏菜单", exact: true }).click();
      const before = await snapshot(), count = before.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length;
      await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      const authored = await until(async () => { const p = await persisted();
        return p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length > count && p; }, "real author change");
      await openWorkbench(); await window.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
      await window.getByTestId("assistant-creation-merge-readiness").filter({ hasText: /共享游戏菜单.*发生了变化/ }).waitFor();
      assert(!await window.getByTestId("assistant-creation-merge-button").isEnabled());
      assert.deepEqual((await persisted()).editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual((await persisted(prep.projects[1])).editor_settings, otherBefore.editor_settings);
      report.authorConflict = { task: task.id, authorAction: "actual Add mask + Save layout", rejected: true, authored };
      await session.shot("real-author-baseline-conflict"); return { task: task.id, refused: true, otherProjectUnchanged: true };
    });
    assert.equal(report.cases.length, 6); assert.equal(provider.requests.length, prior ? 6 : 12);
    assert.equal(report.submissions.length, 2); assert.equal(report.localReceipts.length, 4);
    assert.deepEqual(report.errors, []); assert.deepEqual(provider.errors, []);
    report.status = "CURRENT_NATIVE_CONTROLLED_WINDOW_REVIEW_MERGE_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-7500);
      await session.shot("failure").catch(e => { report.failureCaptureError = String(e); });
    }
  } finally {
    try {
      if (session.current) {
        const active = (await session.api("/api/assistant/creation/processes?include_terminal=false")).processes || [];
        for (const p of active.filter(p => prep.projects.some(f => f.project_id === p.projectId)))
          await session.api(`/api/assistant/creation/processes/${p.id}/cancel`, {});
        await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET";
      }
    } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try { await session.stop("final exact ownership cleanup; not normal close"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if (provider) {
      report.modelRequests = [...(prior?.modelRequests || []), ...provider.requests]; report.modelErrors = provider.errors;
      report.providerCleanup = await provider.stop();
      if (prior) {
        report.providerCleanup = { stopped: report.providerCleanup.stopped && prior.providerCleanup.stopped,
          requests: report.providerCleanup.requests + prior.providerCleanup.requests, current: report.providerCleanup,
          prior: prior.providerCleanup };
      }
    }
    if (downloaded) {
      try {
        assert.equal(path.dirname(downloaded).toLowerCase(), "c:\\users\\1\\downloads");
        assert.equal(sha(downloaded), report.projectArtifact.sha256); fs.unlinkSync(downloaded);
        report.downloadCleanup = { path: downloaded, removed: true, retainedCopy: report.projectArtifact.path };
      } catch (e) { report.downloadCleanup = { error: String(e) }; report.status = "FAILED"; process.exitCode = 1; }
    }
    try { for (const f of [...prep.products, ...prep.sources, ...prep.inputs, ...runInputs]) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length, out, error: report.error }));
  }
}
(async () => { if (process.argv[2] === "prepare") prepare(); else await run(process.argv[2]); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
