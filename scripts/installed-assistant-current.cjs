"use strict";
// Actual NSIS installation and packaged backend. Only the external model is controlled.
// UI writes use normal controls; frontend store access is read-only observation.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { buildSync } = require("../editor/node_modules/esbuild");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { controlledAssistantReviewProvider } = require("./lib/controlled-assistant-review-provider.cjs");
const A = require("./lib/installed-acceptance.cjs");
const candidateArg = process.argv.find(value => value.startsWith("--candidate="));
const currentCandidate = Boolean(candidateArg);
const expectedVersion = candidateArg ? candidateArg.slice("--candidate=".length) : "1.9.14";
const argumentValue = name => {
  const prefix = `--${name}=`;
  const value = process.argv.find(candidate => candidate.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
};
const root = path.resolve(__dirname, "..");
const defaultLabel = currentCandidate
  ? `Installed-Assistant-Review-${expectedVersion.replace(/\./g, "")}-current`
  : "Installed-Assistant-Review-20261021-01";
const qa = path.resolve(argumentValue("qa-root") || `F:/AgentVN/QA/${defaultLabel}`);
const checkpoint = path.resolve(argumentValue("checkpoint-root") || `F:/AgentVN/Checkpoints/${defaultLabel}`);
const release = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const installationFile = path.resolve(argumentValue("installation-file") || (currentCandidate
  ? `F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json`
  : path.join(release, "installation.json")));
const frozenFile = argumentValue("frozen-file")
  ? path.resolve(argumentValue("frozen-file"))
  : undefined;
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const tools = [__filename, "scripts/lib/installed-release-session.cjs",
  "scripts/lib/installed-controlled-provider-guard.cjs", "scripts/installed-controlled-provider-guard-test.cjs",
  "scripts/lib/controlled-assistant-review-provider.cjs", "scripts/lib/current-native-capture.cjs",
  "scripts/lib/owned-process-tree.cjs"];
if(currentCandidate)tools.push("scripts/installed-layout-cache-session.ps1");
const sources = ["editor/src/components/assistant/AssistantChatPanel.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchWindow.tsx",
  "editor/src/components/assistant/AssistantCreationWorkbenchStudio.tsx",
  "editor/src/assistant/assistantCreationProjectMerge.ts", "editor/src/store/projectStore.ts",
  "backend/app/services/assistant_creation_agent.py", "backend/app/api/routes_assistant.py"];
function prepare() {
  assert(fs.existsSync(checkpoint)); fs.mkdirSync(qa, { recursive: true });
  const installation = read(installationFile);
  assert.equal(installation.status, "PASS"); assert.equal(currentCandidate?installation.version:installation.executable.version, expectedVersion);
  const frozen = frozenFile
    ? (read(frozenFile).protectedFiles || read(frozenFile).frozen || [])
    : [];
  const products = [...frozen, installation.executable, ...installation.resources,
    desc(path.join(root, "AgentVN Dev.exe")), desc(path.join(root, "editor/src-tauri/target/debug/agentvn-editor.exe"))];
  for (const p of products) assert.equal(sha(p.path), p.sha256);
  const snapshots = [];
  for (const f of [...tools, ...sources]) {
    const source = path.resolve(root, f), copy = path.join(checkpoint, "before-run", path.relative(root, source));
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL); snapshots.push(desc(copy));
  }
  // Offline fixture construction only. Runtime UI uses the installed binary, never a Vite server.
  const code = buildSync({ stdin: { resolveDir: root, loader: "ts",
    contents: 'export {switchRuntimeUILayoutType} from "./shared/cartridge/uiLayoutProfiles"; export {useProjectStore} from "./editor/src/store/projectStore";' },
    bundle: true, platform: "node", format: "cjs", write: false }).outputFiles[0].text;
  const module = { exports: {} }; new Function("module", "exports", code)(module, module.exports);
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64");
  const projects = ["a", "b"].map(letter => {
    const p = fixture(`qa-installed-review-${letter}-${expectedVersion.replace(/\./g, "")}-01`);
    p.title = `安装审核隔离 ${letter.toUpperCase()} ${expectedVersion}`;
    const defaults = structuredClone(module.exports.useProjectStore.getState().settings);
    p.editor_settings = { ...defaults, ...module.exports.switchRuntimeUILayoutType(defaults, "renpy") };
    p.nodes[0].data.loadingAnimation = { kind: "default" }; p.nodes[0].data.openingAudio = [];
    p.asset_manifest = [["project-asset-1", "中文 徽章.png", "工程徽章"],
      ["private-project", "PRIVATE_UNSELECTED.png", "未授权工程图片"]].map(([id, filename, display_name]) => ({
        asset_id: id, asset_type: "ui", metadata: { filename, display_name, mime_type: "image/png",
          data_url: `data:image/png;base64,${bytes.toString("base64")}`, width: 1, height: 1 },
      }));
    write(path.join(qa, `${p.project_id}.vnproj`), p); return p;
  });
  const git = args => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0); return r.stdout.trim();
  };
  write(path.join(qa, "preparation.json"), { at: new Date().toISOString(), products, snapshots,
    sources: sources.map(f => desc(path.resolve(root, f))), projects, image: { sha256: A.sha256(bytes), bytes: bytes.length },
    inputs: projects.map(p => desc(path.join(qa, `${p.project_id}.vnproj`))),
    installation: desc(installationFile),
    git: { head: git(["rev-parse", "HEAD"]), index: desc(path.join(root, ".git/index")) } });
  console.log(`PREPARED ${qa}`);
}
async function run(attempt) {
  assert.match(attempt, /^\d{2}$/); const out = path.join(qa, `session-${attempt}`);
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = read(path.join(qa, "preparation.json")), [project, other] = prep.projects;
  const input = prep.inputs[0].path;
  const report = { status: "RUNNING", at: new Date().toISOString(), version: expectedVersion,
    scope: "ACTUAL_NSIS_INSTALLED_CONTROLLED_CREATION_REVIEW_MERGE_NOT_REAL_DEEPSEEK",
    boundary: "Public import/provider setup in isolated backend; DOM input in actual installed WebView. No native picker/physical-input claim.",
    products: prep.products, sources: prep.sources, inputs: prep.inputs, image: prep.image,
    installation: prep.installation, tools: tools.map(f => desc(path.resolve(root, f))),
    cases: [], matrix: [], screenshots: [], launches: [], cleanups: [], errors: [],
    submissions: [], localReceipts: [], blockedModelRequests: 0, realModelRequests: 0, productChanges: 0, devPublicationBuilds: 0,
    notProven: ["Real DeepSeek", "Full queues/history/recovery", "Standalone/setup export consumption",
      "Android", "Upgrade", "Normal native close", "Developer-workspace-independent machine"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  for (const f of tools) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
  let host, session, page, win, provider, baseline, merged, downloaded,cachePrepared=false;
  function cache(action){
    const result=spawnSync("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",
      path.join(root,"scripts/installed-layout-cache-session.ps1"),"-Action",action,"-RunDirectory",out,
      "-AllowedRunRoot",qa,"-CodexCacheView"],
    {encoding:"utf8",windowsHide:true,timeout:45000});
    (report.cache??=[]).push({action,exitCode:result.status,stdout:result.stdout,stderr:result.stderr});save();
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
  async function stage(name, fn) {
    const c = { name, status: "RUNNING" }; report.cases.push(c); save(); console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; } finally { save(); }
  }
  const persisted = async (p = project) => (await session.api(`/api/project/projects/${p.project_id}`)).data;
  async function snapshot() {
    return page.evaluate(() => {
      const p = window.__AGENTVN_PROJECT_STORE__.getState(), e = window.__AGENTVN_EDITOR_STORE__.getState();
      return JSON.parse(JSON.stringify({ id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: e.nodes, edges: e.edges }));
    });
  }
  const custom = s => s.settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
    .filter(c => c.component_type === "custom_component");
  const observed = new WeakSet();
  function observe() {
    if (observed.has(page)) return; observed.add(page);
    page.on("request", r => {
      if (r.method() === "POST" && r.url().endsWith("/api/assistant/creation/processes")) {
        const v = r.postDataJSON();
        report.submissions.push({ id: v.id, projectId: v.project_id,
          request: { ...v.request, provider_selection: "[controlled-loopback-only]" } }); save();
      } else if (r.method() === "POST" && /\/local-result$/.test(r.url())) {
        report.localReceipts.push({ url: r.url(), payload: r.postDataJSON() }); save();
      }
    });
  }
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
    win = page.getByTestId("assistant-creation-workbench-window"); await win.waitFor();
    await win.getByLabel("向大模型助手提问", { exact: true }).waitFor();
  }
  async function closeWorkbench() {
    await win.getByRole("button", { name: "关闭工作台", exact: true }).click(); await win.waitFor({ state: "detached" });
  }
  async function unchanged(s) {
    const now = await snapshot(); for (const k of ["settings", "assets", "nodes", "edges"]) assert.deepEqual(now[k], s[k]);
  }
  async function bounded() {
    const g = await win.evaluate(n => ({ rect: n.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth,
      minimized: n.dataset.minimized, activeInside: n.contains(document.activeElement),
      controls: [...n.querySelectorAll("header nav button")].map(b => {
        const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { name: b.getAttribute("aria-label"), rect: r.toJSON(), hit: h === b || b.contains(h) };
      }) }));
    assert(g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= g.viewport.width + 1 && g.rect.bottom <= g.viewport.height + 1);
    assert(g.overflow <= 1 && g.controls.length === 5 && g.controls.every(c => c.hit));
    for (let i = 0; i < g.controls.length; i++) for (let j = i + 1; j < g.controls.length; j++) {
      const a = g.controls[i].rect, b = g.controls[j].rect;
      assert(!(Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1), "Workbench controls overlap");
    }
    return g;
  }
  async function gesture(locator, dx, dy) {
    const r = await locator.boundingBox(); assert(r);
    const x = r.x + Math.min(30, r.width / 2), y = r.y + r.height / 2;
    const hit = await locator.evaluate((n, p) => { const h = document.elementFromPoint(p.x, p.y);
      return h === n || n.contains(h); }, { x, y }); assert(hit);
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  }
  async function submit(marker) {
    await win.getByLabel("向大模型助手提问", { exact: true }).fill(`${marker} 使用授权工程徽章构建候选，经验证预览后提交，不自动合并。`);
    const n = report.submissions.length; await win.getByRole("button", { name: "生成创作提案", exact: true }).click();
    await until(() => report.submissions.length === n + 1, "one real UI submission");
    const task = report.submissions.at(-1);
    const result = await until(async () => {
      const p = await session.api(`/api/assistant/creation/processes/${task.id}`);
      return ["completed", "failed", "cancelled"].includes(p.status) && p;
    }, "controlled creation terminal", 90000);
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.deepEqual(result.toolEvents.filter(e => e.status === "completed").map(e => e.tool), provider.names);
    (report.tasks ??= []).push(result); save();
    await page.getByTestId("assistant-project-lock-dialog").waitFor({ state: "detached" });
    await win.getByTestId("assistant-creation-draft").waitFor(); return task;
  }
  try {
    save(); for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256);
    if(currentCandidate){cache("SelfTest");cachePrepared=true;cache("Prepare");}
    provider = await controlledAssistantReviewProvider(); report.modelEndpoint = provider.url;
    host = installedReleaseSession({ installationFile: prep.installation.path, out, input, report, save,
      controlledCreation: { endpoint: provider.url, projectIds: prep.projects.map(p => p.project_id) } });
    session = { start: () => host.start(), stop: reason => host.stop(reason), api: (...args) => host.rawApi(...args),
      metrics: m => host.metrics(m), shot: name => host.shot(name), get current() { return host.current; } };
    page = await session.start(); observe();
    for (const f of prep.inputs) {
      const r = await fetch(`http://127.0.0.1:${session.current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(f.path)) },
        body: fs.readFileSync(f.path), signal: AbortSignal.timeout(20000) });
      assert(r.ok); assert((await r.json()).ok);
    }
    const otherBefore = await persisted(other);
    await session.api("/api/project/state", {
      provider_connections: [{ connection_id: "qa-review", provider_type: "openai_compatible", display_name: "本机审核受控",
        base_url: provider.url, api_key_storage: "local", enabled: true }],
      provider_models: [{ provider_id: "qa-model", connection_id: "qa-review", model_id: "controlled-model", model_name: "controlled-model",
        enabled: true, capabilities: ["text_generation"], default_parameters: { structured_mode: "tools", request_timeout_seconds: 120 } }],
      provider_selections: { text_generation: "qa-model" }, provider_secrets: { "qa-review": "test-only-secret" },
    });
    await page.reload(); await page.locator(".recent-project-open:not(:disabled):visible").first().waitFor();
    await openProject(); baseline = await snapshot(); report.baseline = baseline;
    await stage("floating-window-drag-resize-dock-minimize-and-keyboard", async () => {
      await openWorkbench(); const before = await bounded(); assert(before.activeInside);
      await gesture(win.locator(".assistant-creation-workbench-titlebar"), 90, 55); const dragged = await bounded();
      assert(Math.abs(dragged.rect.left - before.rect.left - 90) < 2 && Math.abs(dragged.rect.top - before.rect.top - 55) < 2);
      const handle = win.getByRole("separator", { name: "调整创造工作台大小", exact: true });
      await gesture(handle, -100, -80); const resized = await bounded();
      assert(Math.abs(resized.rect.width - dragged.rect.width + 100) < 2 && Math.abs(resized.rect.height - dragged.rect.height + 80) < 2);
      await handle.focus(); await page.keyboard.press("ArrowRight"); assert.equal((await bounded()).rect.width, resized.rect.width + 24);
      await win.getByRole("button", { name: "停靠左侧", exact: true }).click(); assert.equal((await bounded()).rect.left, 12);
      await win.getByRole("button", { name: "停靠右侧", exact: true }).click(); assert.equal((await bounded()).rect.right, 1908);
      await win.getByRole("button", { name: "最小化工作台", exact: true }).click();
      const mini = await bounded(); assert.equal(mini.minimized, "true"); assert.equal(mini.rect.height, 54);
      assert(!await win.getByLabel("向大模型助手提问", { exact: true }).isVisible());
      await win.getByRole("button", { name: "恢复工作台", exact: true }).click();
      await win.getByRole("button", { name: "恢复默认位置和尺寸", exact: true }).click();
      const reset = await bounded(); assert.equal(reset.rect.width, before.rect.width); assert.equal(reset.rect.left, before.rect.left);
      await unchanged(baseline); return { before, dragged, resized, mini, reset };
    });
    await stage("authorized-six-tool-chain-three-isolated-candidates-and-local-runtime-receipts", async () => {
      await win.getByTestId("assistant-new-conversation").click();
      const consent = win.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
      assert(!await consent.isChecked()); assert(!await win.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true }).isChecked());
      await consent.check(); const task = await submit("REVIEW_A");
      assert.equal(provider.requests.length, 6); assert.equal(report.localReceipts.length, 2);
      assert(report.localReceipts.every(r => r.payload.project_id === project.project_id && r.payload.result.ok));
      assert.equal(provider.requests[3].receipts.at(-1).result.status, "validated");
      assert.equal(provider.requests[4].receipts.at(-1).result.status, "rendered");
      assert.equal(await win.getByTestId("assistant-creation-review-batch").locator("ol > li").count(), 3);
      assert.deepEqual(task.request.authorized_assets, [{ id: "project-asset-1", filename: "中文 徽章.png", mime_type: "image/png" }]);
      await unchanged(baseline); await session.shot("six-tools-three-candidates");
      return { task: task.id, localReceipts: 2, controlledRequests: 6, noAutoMerge: true };
    });
    await stage("exclude-candidate-real-runtime-combination-preview-and-twelve-display-combinations", async () => {
      await win.getByRole("checkbox", { name: "应用候选 排除候选", exact: true }).uncheck();
      for (const [i, name] of ["审核关于卡", "审核帮助卡"].entries()) {
        await win.getByLabel(`${name} 目标页面`, { exact: true }).selectOption("title");
        for (const [k, v] of Object.entries({ x: 62, y: 10 + i * 24, width: 30, height: 21 }))
          await win.getByLabel(`${name} ${k}`, { exact: true }).fill(String(v));
      }
      await win.getByRole("button", { name: "预览所选候选组合", exact: true }).click();
      const preview = win.getByTestId("assistant-creation-batch-runtime");
      await preview.locator('[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
      const frame = await (await preview.locator("iframe").elementHandle()).contentFrame(); assert(frame); await A.settleRuntime(frame);
      assert.equal(await frame.getByTestId("runtime-custom-component").count(), 2);
      assert.equal(await frame.getByRole("button", { name: "排除候选操作", exact: true }).count(), 0);
      await frame.getByRole("img", { name: "审核关于卡徽章", exact: true }).evaluate(img => img.decode());
      await unchanged(baseline); const merge = win.getByTestId("assistant-creation-merge-batch");
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }; const viewport = await session.metrics(m);
        await merge.scrollIntoViewIfNeeded(); await merge.focus();
        const geometry = await merge.evaluate(n => { const r = n.getBoundingClientRect(),
          h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { rect: r.toJSON(), hit: h === n || n.contains(h), focus: document.activeElement === n }; });
        assert(geometry.hit && geometry.focus && geometry.rect.top >= 0 && geometry.rect.bottom <= m.height && await merge.isEnabled());
        report.matrix.push({ ...m, viewport, geometry, window: await bounded(), status: "PASS" }); save();
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
      await win.getByTestId("assistant-creation-merge-batch").click();
      await win.getByRole("status").filter({ hasText: "已将 2 个候选一次性应用到工程" }).waitFor();
      merged = await snapshot(); report.merged = merged;
      report.atomicObservation = await page.evaluate(() => { window.__QA_NATIVE_REVIEW_UNSUB__(); return window.__QA_NATIVE_REVIEW_COUNTS__; });
      assert(report.atomicObservation.includes(2) && !report.atomicObservation.includes(1));
      assert.equal(custom(merged).length, 2); assert(!JSON.stringify(custom(merged)).includes("排除候选"));
      assert.deepEqual(merged.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
      assert.deepEqual(merged.nodes, baseline.nodes); assert.deepEqual(merged.edges, baseline.edges);
      report.persistedMerged = await until(async () => { const p = await persisted();
        return p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
          .filter(c => c.component_type === "custom_component").length === 2 && p; }, "merge really persisted");
      assert.deepEqual(report.persistedMerged.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
      const assets = merged.assets.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id)); assert.equal(assets.length, 2);
      for (const a of assets) assert.equal(A.sha256(await A.assetBytes(session.current.ports[0], a)), prep.image.sha256);
      return { newAssets: assets.length, excludedNotWritten: true, atomic: true };
    });
    await stage("native-vnproj-save-byte-inspection-and-real-host-backend-restart-reopen", async () => {
      await closeWorkbench(); await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
      const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
      await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      const names = fs.readdirSync(downloads).filter(n => !before.has(n) && n.startsWith(project.title.replace(/\s+/g, "_")) && n.endsWith(".vnproj"));
      assert.equal(names.length, 1); downloaded = path.join(downloads, names[0]);
      const copy = path.join(out, path.basename(downloaded)); fs.copyFileSync(downloaded, copy, fs.constants.COPYFILE_EXCL);
      report.projectArtifact = { ...desc(copy), source: downloaded, generatedAt: fs.statSync(downloaded).mtime.toISOString() }; save();
      const zip = await JSZip.loadAsync(fs.readFileSync(copy)), p = JSON.parse(await zip.file("project.json").async("string"));
      assert.equal(p.project_id, project.project_id); assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, merged.settings.runtimeUILayoutProfiles);
      for (const a of p.asset_manifest.filter(a => !baseline.assets.some(b => b.asset_id === a.asset_id)))
        assert.equal(A.sha256(await zip.file(a.metadata.project_path).async("nodebuffer")), prep.image.sha256);
      assert(!JSON.stringify(p).includes("authorizedProjectAssetIds"));
      const requests = provider.requests.length; await dialog.getByRole("button", { name: "OK", exact: true }).click();
      await session.stop("planned real installed host/backend restart; not normal close");
      page = await session.start(); observe(); await openProject();
      const reopened = await snapshot(); report.reopened = reopened;
      assert.deepEqual(reopened.settings, merged.settings); assert.deepEqual(reopened.nodes, merged.nodes); assert.deepEqual(reopened.edges, merged.edges);
      const authorAsset = ({ metadata, ...asset }) => {
        const { url, filePath, backend_asset_path, data_url, ...author } = metadata; return { ...asset, metadata: author };
      };
      assert.deepEqual(reopened.assets.map(authorAsset), merged.assets.map(authorAsset));
      report.reopenedAssetBytes = [];
      for (const a of reopened.assets) {
        const packed = p.asset_manifest.find(b => b.asset_id === a.asset_id); assert(packed);
        const bytes = await A.assetBytes(session.current.ports[0], a), packedBytes = await zip.file(packed.metadata.project_path).async("nodebuffer");
        assert.equal(A.sha256(bytes), A.sha256(packedBytes)); assert.equal(A.sha256(bytes), prep.image.sha256);
        if (a.metadata.url) {
          const u = new URL(a.metadata.url); assert.equal(u.origin, `http://127.0.0.1:${session.current.ports[0]}`);
          assert.equal(decodeURIComponent(u.pathname), `/api/project/assets/${a.metadata.backend_asset_path}`);
        }
        assert(a.metadata.filePath);
        const relative = path.relative(path.join(session.current.data, "backend/project_assets"), a.metadata.filePath);
        assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); assert.equal(sha(a.metadata.filePath), A.sha256(bytes));
        report.reopenedAssetBytes.push({ id: a.asset_id, sha256: A.sha256(bytes), bytes: bytes.length, backendOwned: true, matchesPortableFile: true });
      }
      assert.equal(provider.requests.length, requests); return report.projectArtifact;
    });
    await stage("new-session-consent-reset-and-real-layout-edit-conflict-without-overwrite", async () => {
      await openWorkbench(); await win.getByTestId("assistant-new-conversation").click();
      const consent = win.getByRole("checkbox", { name: "授权工程素材 工程徽章", exact: true });
      assert(!await consent.isChecked()); assert(!await win.getByRole("checkbox", { name: "授权工程素材 未授权工程图片", exact: true }).isChecked());
      await consent.check(); const task = await submit("CONFLICT_A");
      await win.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu"); await closeWorkbench();
      await page.locator('[data-workspace-surface="options"]:visible').click();
      await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
      await page.getByTestId("renpy-player-layout-entry").click();
      await page.locator(".runtime-layout-screen-list").getByRole("button", { name: "游戏菜单", exact: true }).click();
      const before = await snapshot(), count = before.settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length;
      await page.getByRole("button", { name: "添加遮罩", exact: true }).click();
      await page.getByRole("button", { name: "保存布局", exact: true }).click();
      const authored = await until(async () => { const p = await persisted();
        return p.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "game_menu").components.length > count && p; }, "real author edit");
      await openWorkbench(); await win.getByLabel("选择目标页面", { exact: true }).selectOption("game_menu");
      await win.getByTestId("assistant-creation-merge-readiness").filter({ hasText: /共享游戏菜单.*发生了变化/ }).waitFor();
      assert(!await win.getByTestId("assistant-creation-merge-button").isEnabled());
      assert.deepEqual((await persisted()).editor_settings.runtimeUILayoutProfiles, authored.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual((await persisted(other)).editor_settings, otherBefore.editor_settings);
      report.authorConflict = { task: task.id, authorAction: "actual Add mask + Save layout", rejected: true, authored };
      await session.shot("real-author-baseline-conflict"); return { refused: true, otherProjectUnchanged: true };
    });
    assert.equal(report.cases.length, 6); assert.equal(report.matrix.length, 12); assert.equal(provider.requests.length, 12);
    assert.equal(report.submissions.length, 2); assert.equal(report.localReceipts.length, 4);
    assert.deepEqual(report.errors, []); assert.deepEqual(provider.errors, []); assert.equal(report.blockedModelRequests, 0);
    report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-9000);
      await session.shot("failure").catch(e => { report.failureCaptureError = String(e); });
    }
  } finally {
    try {
      if (session?.current) {
        const active = (await session.api("/api/assistant/creation/processes?include_terminal=false")).processes || [];
        for (const p of active.filter(p => prep.projects.some(f => f.project_id === p.projectId)))
          await session.api(`/api/assistant/creation/processes/${p.id}/cancel`, {});
        await session.api("/api/project/state", { provider_secrets: {} }); report.credentialCleanup = "CLEARED_TEST_ONLY_SECRET";
      }
    } catch (e) { report.credentialCleanup = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try { await session?.stop("final exact ownership cleanup; not normal close"); }
    catch (e) { report.cleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    if(currentCandidate&&cachePrepared)try{
      cache("Restore");report.cacheRestoration=read(path.join(out,"native-cache-restoration.json")).status;
      assert.equal(report.cacheRestoration,"PASS");
    }catch(e){report.cacheError=String(e.stack||e);report.status="FAILED";process.exitCode=1;}
    if (provider) {
      report.modelRequests = provider.requests; report.modelErrors = provider.errors; report.providerCleanup = await provider.stop();
    }
    if (downloaded) {
      try {
        assert.equal(path.dirname(downloaded).toLowerCase(), "c:\\users\\1\\downloads");
        assert.equal(sha(downloaded), report.projectArtifact.sha256); fs.unlinkSync(downloaded);
        report.downloadCleanup = { path: downloaded, removed: true, retainedCopy: report.projectArtifact.path };
      } catch (e) { report.downloadCleanup = { error: String(e) }; report.status = "FAILED"; process.exitCode = 1; }
    }
    try { for (const f of [...prep.products, ...prep.sources, ...prep.inputs]) assert.equal(sha(f.path), f.sha256); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, matrix: report.matrix.length, out, error: report.error }));
  }
}
(async () => { if (process.argv[2] === "prepare") prepare(); else await run(process.argv[2]); })()
  .catch(e => { console.error(e); process.exitCode = 1; });
