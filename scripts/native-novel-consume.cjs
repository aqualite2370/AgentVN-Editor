"use strict";
// QA only: unchanged saved novels -> real graph connection -> native save/UI export -> current Player.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { nativeSession, until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const A = require("./lib/installed-acceptance.cjs");
const root = path.resolve(__dirname, "..");
// Use the existing narrowly guarded Player profile protector, without broadening its boundary.
const qa = "F:/AgentVN/QA/Native-Dev-Preview-Repair-20261020-01";
const checkpoint = "F:/AgentVN/Checkpoints/Native-Novel-Consume-20261020-01";
const summary = path.join(root, "output/native-novel-consume-20261020-01");
const load = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(root, f), sha256: sha(path.resolve(root, f)) });
const products = ["AgentVN Dev.exe", "editor/src-tauri/target/debug/agentvn-editor.exe",
  "editor/src-tauri/binaries/agentvn-player.exe"];
const sources = ["editor/src/components/nodes/SceneNode.tsx", "editor/src/store/editorStore.ts",
  "editor/src/utils/exportScript.ts", "editor/src/cartridge/exportCartridge.ts",
  "editor/src/novel-import/normalizeNovelSceneForRuntime.ts",
  "GameCli_framework/src/components/player/StoryPlayer.tsx", "GameCli_framework/src/components/player/DialogBox.tsx",
  "scripts/native-dev-preview-profile.ps1", "scripts/lib/current-native-editor-session.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/installed-acceptance.cjs", "scripts/lib/owned-process-tree.cjs"];
function prepare() {
  assert(!fs.existsSync(checkpoint) && !fs.existsSync(summary));
  fs.mkdirSync(checkpoint, { recursive: true }); fs.mkdirSync(summary, { recursive: true });
  const specs = [
    ["default", "F:/AgentVN/QA/Native-Novel-Default-20261020-01/session-04/report.json",
      "CURRENT_NATIVE_NOVEL_DEFAULT_PASS", "restored", "native-novel-default-20261020-01", "默认全文链隔离_20261020"],
    ["partial", "F:/AgentVN/QA/Native-Novel-Partial-20261020-01/session-06/report.json",
      "CURRENT_NATIVE_NOVEL_PARTIAL_PASS", "restartedA", "native-novel-partial-a-20261020-01", "小说异常隔离A_20261020"],
  ];
  const inputs = specs.map(([kind, reportPath, status, key, id, title]) => {
    const r = load(reportPath); assert.equal(r.status, status);
    const bundle = r.bundles.find(b => path.basename(b.path).startsWith(title)); assert(bundle);
    assert.equal(sha(bundle.path), bundle.sha256);
    const copy = path.join(checkpoint, `${kind}.vnproj`);
    fs.copyFileSync(bundle.path, copy, fs.constants.COPYFILE_EXCL);
    const state = r[key], novel = state.nodes.filter(n => n.data.editorMeta?.source === "imported")
      .sort((a, b) => (a.data.editorMeta.sourceProcessChapterIndex ?? a.data.editorMeta.importIndex)
        - (b.data.editorMeta.sourceProcessChapterIndex ?? b.data.editorMeta.importIndex));
    assert.equal(novel.length, kind === "default" ? 1 : 2);
    assert(!state.edges.some(e => e.source === "scene"), "Do not mistake disconnected import for playable novel");
    return { kind, id, title, prior: desc(reportPath), original: bundle, input: desc(copy),
      expected: { nodes: state.nodes, edges: state.edges }, novelNodeIds: novel.map(n => n.id) };
  });
  const snapshots = [];
  for (const f of [...sources, __filename, "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const source = path.resolve(root, f), target = path.join(checkpoint, path.relative(root, source));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); snapshots.push(desc(target));
  }
  fs.writeFileSync(path.join(summary, "preparation.json"), JSON.stringify({
    at: new Date().toISOString(), inputs, products: products.map(desc), sources: sources.map(desc), snapshots,
  }, null, 2), { flag: "wx" });
  console.log(`PREPARED ${checkpoint}`);
}
function graphContent(s) {
  // Compare durable data: Playwright can transport own undefined keys that JSON cannot store.
  // Do not erase null, explicit values, commands, positions, or any persisted graph field.
  return JSON.parse(JSON.stringify({
    nodes: s.nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: s.edges.map(({ selected, ...e }) => e),
  }));
}
async function cartridgeEvidence(file, item) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  assert.equal(manifest.game_id, item.id);
  const scriptBytes = await zip.file(manifest.entry_script).async("nodebuffer");
  const script = JSON.parse(scriptBytes.toString("utf8"));
  const expectedNodes = [item.expected.nodes.find(n => n.id === "scene"),
    ...item.novelNodeIds.map(id => item.expected.nodes.find(n => n.id === id))];
  assert.equal(script.entry_scene_id, "ui_acceptance");
  assert.deepEqual(script.scenes.map(s => s.scene_id).sort(), expectedNodes.map(n => n.data.scene.scene_id).sort());
  const playback = [];
  for (let i = 0; i < expectedNodes.length; i++) {
    const scene = expectedNodes[i].data.scene, exported = script.scenes.find(s => s.scene_id === scene.scene_id);
    assert.deepEqual(exported.commands, scene.commands, `Novel commands/bytes changed in ${scene.scene_id}`);
    assert.equal(exported.next_scene_id, expectedNodes[i + 1]?.data.scene.scene_id);
    for (const command of scene.commands) if (["narration", "dialog"].includes(command.type))
      playback.push({ sceneId: scene.scene_id, type: command.type, text: command.text });
  }
  const layout = await zip.file("ui/layout.json").async("nodebuffer"), assets = [];
  for (const a of manifest.assets) {
    const bytes = await zip.file(a.path).async("nodebuffer");
    assets.push({ id: a.asset_id, path: a.path, bytes: bytes.length, sha256: A.sha256(bytes) });
  }
  assert(assets.some(a => a.id === "agentvn_placeholder_background"), "Visible placeholder is an explicit known limitation");
  return { manifest, script, scriptSha256: A.sha256(scriptBytes), layoutSha256: A.sha256(layout), assets, playback };
}
async function run(iteration) {
  assert(/^\d{2}$/.test(iteration));
  const out = path.join(qa, `novel-consume-${iteration}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const prep = load(path.join(summary, "preparation.json"));
  const report = { status: "RUNNING", at: new Date().toISOString(),
    scope: "CURRENT_NATIVE_DEV_GRAPH_UI_EXPORT_AND_EXTERNAL_PREVIEW_PLAYER_NOT_RELEASE_OR_SETUP",
    viewport: { width: 1920, height: 1080, dpr: 1, reduced: false },
    products: prep.products, sources: prep.sources, inputs: prep.inputs,
    cases: [], projects: [], launches: [], cleanups: [], screenshots: [], errors: [], requests: [], knownDefects: [],
    modelRequests: 0, realModelRequests: 0, charges: 0, productChanges: 0, devPublicationBuilds: 0,
    boundaries: ["Import setup uses public octet-stream API, not native file picker",
      "Actual Dev uses source Python/Vite; not packaged backend or installed Release",
      "Graph/UI actions use CDP input in real WebView, not physical mouse",
      "1080p DPR1 lifecycle scope, not full motion/display matrix",
      "Explicit isolated save preference, not directory selector acceptance",
      "Exact-owned forced process termination, not normal close",
      "Controlled novels/placeholder images are not real model or final asset quality evidence"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
  const editor = nativeSession({ out, input: prep.inputs[0].input.path, report, save });
  let page, journal = false, player, playerRoot, browser, playerPage, playerCdp;
  const known = new Map(), playerPorts = [];
  const identity = p => `${p.ProcessId}:${p.Created}`;
  const immutableFiles = [...prep.products, ...prep.sources,
    ...prep.inputs.flatMap(i => [i.prior, i.original, i.input])];
  function immutable() { for (const f of immutableFiles) assert.equal(sha(f.path), f.sha256, f.path); }
  function profile(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/native-dev-preview-profile.ps1"), "-Action", action, "-RunDirectory", out,
      "-Storage", "Junction"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
    fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stderr);
  }
  async function step(name, fn) {
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  async function state() {
    return page.evaluate(async () => {
      const [{ useEditorStore }, { useProjectStore }] = await Promise.all([
        import("/src/store/editorStore.ts"), import("/src/store/projectStore.ts")]);
      const e = useEditorStore.getState(), p = useProjectStore.getState();
      return { id: p.projectId, nodes: e.nodes, edges: e.edges, settings: p.settings };
    });
  }
  function rememberPlayer() {
    const now = rows();
    if (player) {
      const tree = ownedProcessTree(now, player.pid, playerRoot?.Created);
      if (tree.length) playerRoot = tree[0];
      for (const p of tree) known.set(identity(p), p);
    }
    report.playerKnown = [...known.values()]; save(); return now;
  }
  async function stopPlayer(reason) {
    await browser?.close().catch(() => {}); browser = undefined;
    rememberPlayer(); const killed = [];
    for (const p of [...known.values()].reverse()) {
      if (!rows().some(n => identity(n) === identity(p))) continue;
      ps(`$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
        `if($owned -and $owned.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force -ErrorAction Stop}`);
      killed.push(identity(p));
    }
    const now = rows(), cleanup = { reason, killed, normalCloseClaimed: false,
      survivors: [...known.values()].filter(p => now.some(n => identity(n) === identity(p))),
      listeners: playerPorts.length ? listeners(playerPorts) : [] };
    (report.playerCleanups ??= []).push(cleanup); save();
    assert.equal(cleanup.survivors.length, 0); assert.equal(cleanup.listeners.length, 0);
    player = undefined; playerRoot = undefined;
  }
  async function hit(locator) {
    await locator.waitFor({ state: "visible" });
    return locator.evaluate(n => {
      const r = n.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: top === n || n.contains(top),
        inViewport: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
  }
  async function download(destination, trigger) {
    // Attach rejection handlers to BOTH operations immediately. A blocked click
    // must not leave a naked waitForEvent rejection that bypasses finally.
    await editor.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: destination, eventsEnabled: true });
    const [file] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), trigger.click()]);
    const filename = file.suggestedFilename(); assert.equal(path.basename(filename), filename);
    const target = path.join(destination, filename);
    await until(() => fs.existsSync(target) && !fs.existsSync(`${target}.crdownload`), "download bytes", 60000);
    assert.equal(await file.failure(), null);
    return { ...desc(target), bytes: fs.statSync(target).size, generatedAt: fs.statSync(target).mtime.toISOString(),
      source: "Actual current Dev WebView publish; not installed Release" };
  }
  try {
    immutable(); assert.equal(prep.products[0].sha256, prep.products[1].sha256);
    page = await editor.start();
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/(novel|assistant)/.test(req.url())) {
        const row = { path: new URL(req.url()).pathname, at: new Date().toISOString() }; report.requests.push(row);
        if (/generate|process.*(?:start|retry|resume)|\/chat|\/creation\/processes$/.test(row.path)) report.modelRequests++;
      }
    });
    for (const item of prep.inputs) {
      const result = { kind: item.kind, id: item.id }; report.projects.push(result);
      const destination = path.join(out, item.kind); fs.mkdirSync(destination);
      await step(`${item.kind}-public-import-and-real-graph-handle-connection`, async () => {
        const r = await fetch(`http://127.0.0.1:${editor.current.ports[0]}/api/project/projects/import`, {
          method: "POST", headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": `${item.kind}.vnproj` },
          body: fs.readFileSync(item.input.path), signal: AbortSignal.timeout(30000) });
        assert(r.ok && (await r.json()).ok);
        await page.evaluate(({ id, destination }) => {
          const key = "agentvn.projectExportDirectories.v1", current = JSON.parse(localStorage.getItem(key) || "{}");
          localStorage.setItem(key, JSON.stringify({ ...current, [id]: destination }));
        }, { id: item.id, destination });
        await page.reload();
        await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: item.title }).click();
        await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
        result.before = await state(); assert.equal(result.before.id, item.id);
        assert.deepEqual(graphContent(result.before), graphContent(item.expected));
        await page.locator(".react-flow__controls-fitview").click();
        const source = page.locator('.react-flow__node[data-id="scene"] .react-flow__handle.source[data-handleid="default"]');
        const target = page.locator(`.react-flow__node[data-id="${item.novelNodeIds[0]}"] .react-flow__handle.target[data-handleid="default"]`);
        // FitView is animated; sample actual stable geometry rather than guessing a delay.
        await page.waitForFunction(() => {
          const v = document.querySelector(".react-flow__viewport");
          const value = v?.getAttribute("style"), old = window.__novelConsumeFit;
          window.__novelConsumeFit = { value, count: old?.value === value ? old.count + 1 : 0 };
          return window.__novelConsumeFit.count >= 3;
        }, null, { polling: "raf" });
        result.gesture = { source: await hit(source), target: await hit(target) };
        for (const point of Object.values(result.gesture)) assert(point.hit && point.inViewport && point.overflow <= 1);
        const a = result.gesture.source.rect, b = result.gesture.target.rect;
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 }); await page.mouse.up();
        await until(async () => (await state()).edges.length === result.before.edges.length + 1, "one actual connection");
        result.connected = await state();
        assert.deepEqual(graphContent(result.connected).nodes, graphContent(result.before).nodes);
        assert.deepEqual(result.connected.edges.filter(e => result.before.edges.some(old => old.id === e.id))
          .map(({ selected, ...e }) => e), graphContent(result.before).edges);
        const added = result.connected.edges.filter(e => !result.before.edges.some(old => old.id === e.id));
        assert.equal(added.length, 1); assert.equal(added[0].source, "scene"); assert.equal(added[0].sourceHandle, "default");
        assert.equal(added[0].target, item.novelNodeIds[0]); result.addedEdge = added[0];
        await editor.shot(`${item.kind}-real-connected-graph`);
        return { added: result.addedEdge, unchangedNodes: result.connected.nodes.length, gesture: result.gesture };
      });
      await step(`${item.kind}-native-save-and-real-publish-byte-exact-cartridge`, async () => {
        await page.locator('[data-help-key="toolbar.saveProject"]').click();
        const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
        result.saveMessage = await dialog.innerText();
        assert(result.saveMessage.includes(destination) || result.saveMessage.includes(destination.replaceAll("/", "\\")));
        await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
        const bundles = fs.readdirSync(destination).filter(f => f.endsWith(".vnproj"));
        assert.equal(bundles.length, 1); result.connectedBundle = desc(path.join(destination, bundles[0]));
        result.persisted = (await editor.api(`/api/project/projects/${item.id}`)).data;
        await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
        await page.getByRole("dialog").filter({ hasText: "环境检测已完成" }).waitFor({ timeout: 60000 });
        await A.dismissEnvironmentCompletion(page);
        await page.locator('[data-help-key="package.mode"]').click();
        await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
        const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
        if (await warnings.isVisible()) await warnings.click();
        const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
        if (await confirm.isVisible()) await confirm.check();
        const trigger = page.locator('[data-help-key="package.export"]');
        result.exportHitBefore = await hit(trigger);
        if (!result.exportHitBefore.hit) {
          result.blocker = await trigger.evaluate(n => {
            const r = n.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const card = top?.closest('[data-testid="novel-task-mini-entry"]');
            return { hitTag: top?.tagName, hitClass: top?.className, cardRect: card?.getBoundingClientRect().toJSON(),
              taskCard: !!card, exportRect: r.toJSON(), enabled: !n.disabled };
          });
          assert(result.blocker.taskCard && result.blocker.enabled, "Unexpected obstruction: do not bypass");
          const defect = { kind: result.kind, status: "FAILED_NOT_FIXED",
            description: "Default completed novel card intercepts publish export button",
            evidence: result.blocker, workaround: "Actual user drag of task-card grip; no force clicks or style changes" };
          report.knownDefects.push(defect); save(); await editor.shot(`${item.kind}-export-card-obstruction`);
          const grip = page.getByRole("button", { name: "拖动小说任务卡片", exact: true });
          const r = await grip.boundingBox(); assert(r);
          await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
          await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2 - 320, { steps: 16 }); await page.mouse.up();
          result.exportHitAfter = await hit(trigger);
          assert(result.exportHitAfter.hit && result.exportHitAfter.inViewport);
          defect.afterRealDrag = result.exportHitAfter; save();
        }
        result.cartridge = await download(destination, trigger);
        result.exported = await cartridgeEvidence(result.cartridge.path, item);
        const savedZip = await JSZip.loadAsync(fs.readFileSync(result.connectedBundle.path), { checkCRC32: true });
        const saved = JSON.parse(await savedZip.file("project.json").async("string"));
        result.bundleKeys = Object.keys(saved);
        // Real native save must include the actual connected graph, not just the published output.
        const savedGraph = saved.graph ?? saved;
        assert(Array.isArray(savedGraph.nodes) && Array.isArray(savedGraph.edges), "Saved project graph missing");
        assert.deepEqual(graphContent(savedGraph), graphContent(result.connected));
        const layout = JSON.parse(await (await JSZip.loadAsync(fs.readFileSync(result.cartridge.path)))
          .file("ui/layout.json").async("string"));
        assert.equal(layout.layout_type ?? "agentvn", result.connected.settings.runtimeUILayout.layout_type ?? "agentvn");
        await editor.shot(`${item.kind}-actual-export`);
        return { connectedBundle: result.connectedBundle, cartridge: result.cartridge,
          sceneCount: result.exported.script.scenes.length, textCount: result.exported.playback.length };
      });
    }
    await editor.stop("Both real exports complete; exact owned termination, not normal close");
    journal = true; profile("Prepare");
    for (const result of report.projects) {
      await step(`${result.kind}-current-external-player-real-advance-through-novel`, async () => {
        const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => {
          const p = s.address().port; s.close(() => resolve(p)); }); });
        playerPorts.push(port); assert.equal(listeners([port]).length, 0);
        const exe = prep.products.find(p => p.path.endsWith("agentvn-player.exe"));
        const env = { ...process.env };
        for (const k of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/.test(k)) delete env[k];
        Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, `${result.kind}-player-webview`),
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
          TEMP: path.join(out, "temporary"), TMP: path.join(out, "temporary") });
        player = spawn(exe.path, ["--mode", "preview", "--cartridge", result.cartridge.path],
          { cwd: out, env, windowsHide: true, stdio: "ignore" });
        result.player = { pid: player.pid, port, exe, mode: "preview", notStandaloneSetup: true }; save(); rememberPlayer();
        await until(async () => { rememberPlayer(); assert.equal(player.exitCode, null);
          return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok;
        }, "current Player CDP", 60000);
        assert(listeners([port]).every(l => [...known.values()].some(p => p.ProcessId === l.OwningProcess)));
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        playerPage = await until(() => browser.contexts().flatMap(c => c.pages())
          .find(p => p.url().includes("tauri.localhost")), "actual Player document");
        playerPage.setDefaultTimeout(30000); playerPage.on("pageerror", e => report.errors.push(String(e)));
        playerCdp = await playerPage.context().newCDPSession(playerPage);
        await playerCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await playerPage.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(playerPage, report.viewport);
        await playerPage.getByTestId("game-state-title").waitFor(); await A.settleRuntime(playerPage);
        await playerPage.getByTestId("start-new-game").click();
        await playerPage.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(playerPage);
        result.playback = [];
        for (let i = 0; i < result.exported.playback.length; i++) {
          const expected = result.exported.playback[i];
          await playerPage.waitForFunction(({ sceneId, text }) => {
            const stage = document.querySelector('[data-testid="game-state-playing"]'), box = document.querySelector(".dialog-box");
            return stage?.getAttribute("data-current-scene-id") === sceneId && box?.getAttribute("aria-label")?.includes(text);
          }, expected);
          const dialog = playerPage.locator("button.dialog-box");
          const typing = await playerPage.getByTestId("game-state-playing").getAttribute("data-is-typing");
          if (typing === "true") await dialog.click();
          await playerPage.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
          const observed = await dialog.evaluate(n => {
            const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const stage = document.querySelector('[data-testid="game-state-playing"]');
            return { label: n.getAttribute("aria-label"), text: n.querySelector(".dialog-text")?.textContent,
              scene: stage?.getAttribute("data-current-scene-id"), index: stage?.getAttribute("data-current-command-index"),
              commandType: stage?.getAttribute("data-current-command-type"), typing: stage?.getAttribute("data-is-typing"),
              page: n.getAttribute("data-dialog-page"), pages: n.getAttribute("data-dialog-pages"),
              done: n.getAttribute("data-dialog-page-done"), rect: r.toJSON(), hit: hit === n || n.contains(hit),
              overflow: document.documentElement.scrollWidth - innerWidth };
          });
          assert.equal(observed.scene, expected.sceneId); assert.equal(observed.commandType, expected.type);
          assert.equal(observed.text, expected.text); assert.equal(observed.done, "true"); assert.equal(observed.pages, "1");
          assert(observed.hit && observed.overflow <= 1 && observed.rect.x >= 0 && observed.rect.y >= 0
            && observed.rect.right <= 1920 && observed.rect.bottom <= 1080);
          result.playback.push({ expected, observed, at: new Date().toISOString() }); save();
          report.screenshots.push(await captureInstalledWebview(playerPage, playerCdp,
            path.join(out, `${result.kind}-player-text-${i}.png`), report.viewport)); save();
          if (i < result.exported.playback.length - 1) await dialog.click();
        }
        rememberPlayer(); await stopPlayer(`${result.kind} playback complete; owned termination not normal close`);
        return { played: result.playback.length, novelScenes: result.playback.length - 1, actualText: true };
      });
    }
    assert.equal(report.cases.length, 6); assert(report.cases.every(c => c.status === "PASS"));
    assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
    report.status = report.knownDefects.length ? "CURRENT_NATIVE_NOVEL_EXPORT_PLAYER_PASS_WITH_TASK_CARD_OVERLAP"
      : "CURRENT_NATIVE_NOVEL_EXPORT_PLAYER_PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (playerPage && !playerPage.isClosed()) {
      report.failurePlayerDOM = await playerPage.locator("body").innerText().catch(String);
      await captureInstalledWebview(playerPage, playerCdp, path.join(out, "failure-player.png"), report.viewport)
        .then(s => report.screenshots.push(s)).catch(e => { report.failureShotError = String(e); });
    } else if (page && !page.isClosed()) {
      report.failureState = await state().catch(e => ({ error: String(e) }));
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await editor.shot("failure-editor").catch(e => { report.failureShotError = String(e); });
    }
  } finally {
    try { await editor.stop("final owned Editor cleanup"); }
    catch (e) { report.editorCleanupError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    try {
      if (player) await stopPlayer("finally owned Player cleanup after failure");
      if (journal && fs.existsSync(path.join(out, "profile-protection.json"))) {
        profile("Restore"); report.profileRestoration = desc(path.join(out, "profile-restoration.json"));
      }
    } catch (e) { report.playerCleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    try { immutable(); }
    catch (e) { report.immutabilityError = String(e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.playerCleanupError }));
  }
}
module.exports = { graphContent, cartridgeEvidence };
if (require.main === module) (async () => {
  if (process.argv[2] === "prepare") prepare();
  else if (process.argv[2] === "postmortem") {
    const iteration = process.argv[3]; assert(/^\d{2}$/.test(iteration));
    const dir = path.join(qa, `novel-consume-${iteration}`), r = load(path.join(dir, "report.json"));
    const now = rows(), alive = r.known.filter(p => now.some(n => n.ProcessId === p.ProcessId && n.Created === p.Created));
    const ports = listeners(r.launches.flatMap(l => l.ports));
    assert.equal(alive.length, 0); assert.equal(ports.length, 0);
    fs.writeFileSync(path.join(dir, "after-crash-observation.json"), JSON.stringify({
      status: "QA_UNHANDLED_DOWNLOAD_REJECTION_ORIGINAL_REPORT_RETAINED",
      at: new Date().toISOString(), original: desc(path.join(dir, "report.json")),
      actualCase: r.cases.at(-1), processIdentitiesAbsent: r.known.length, survivors: alive, listeners: ports,
      normalCloseClaimed: false, userProfilesTouched: false,
    }, null, 2), { flag: "wx" });
    console.log("PASS post-crash read-only identity/port check; original report not rewritten");
  } else await run(process.argv[2]);
})().catch(e => { console.error(e); process.exitCode = 1; });
