"use strict";

// QA-only continuation of the authorized 1.9.35 real-novel run.
// No model request is made here. The frozen installed Editor and its bundled
// Player are exercised through their actual WebView/HTTP surfaces.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const JSZip = require("../editor/node_modules/jszip");
const { DatabaseSync } = require("node:sqlite");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { until, rows, listeners, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/current-native-capture.cjs");
const { graphContent } = require("./native-novel-consume.cjs");

const root = path.resolve(__dirname, "..");
const sourceReport = "F:/AgentVN/QA/Novel-Real-1935-20261031-04/run/session-01/report.json";
const installationFile = "F:/AgentVN/QA/Editor-1.9.35-20261030-01/installation.json";
const attempt = process.argv.find(value => value.startsWith("--attempt="))?.split("=")[1] ?? "03";
assert.match(attempt, /^\d{2}$/);
const cacheView = process.argv.find(value => value.startsWith("--cache-view="))?.split("=")[1] ?? "codex";
assert(["codex", "normal"].includes(cacheView), `Unsupported cache view: ${cacheView}`);
const physicalCache = process.argv.includes("--physical-cache");
const out = `F:/AgentVN/QA/Novel-Real-1935-20261031-04/run/session-${attempt}`;
const playerOut = `F:/AgentVN/QA/Native-Runtime-State-20261020-${attempt}/installed-novel-consume-1935-01`;
const expectedEditorSha = "881377138f2bd2832a58b2ebc3da16fd9d250f8d4253f38cf53e936bd8c3dfb1";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = value => crypto.createHash("sha256").update(value).digest("hex");
const shaFile = file => sha(fs.readFileSync(file));
const desc = file => ({ path: path.resolve(file), sha256: shaFile(file), bytes: fs.statSync(file).size });
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const identity = p => `${p.ProcessId}:${p.Created}`;

async function inspectCartridge(file, project) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const scriptBytes = await zip.file(manifest.entry_script).async("nodebuffer");
  const script = JSON.parse(scriptBytes.toString("utf8"));
  assert.equal(manifest.game_id, project.project_id);
  assert.equal(script.entry_scene_id, "ui_acceptance");
  const exportedNodes = project.nodes.filter(node =>
    node.data.scene || node.data.choice || node.data.nodeKind === "end");
  const sceneId = node => node.data.scene?.scene_id ?? `${node.data.nodeKind}_${node.id}`;
  assert.deepEqual(script.scenes.map(scene => scene.scene_id).sort(), exportedNodes.map(sceneId).sort());
  const novel = project.nodes.find(node => node.data.editorMeta?.importSessionId);
  assert(novel);
  const playback = [];
  const branches = [];
  for (const node of exportedNodes) {
    const scene = script.scenes.find(item => item.scene_id === sceneId(node));
    const next = project.edges.find(edge => edge.source === node.id &&
      (!edge.sourceHandle || edge.sourceHandle === "default"));
    assert.equal(scene.next_scene_id, next ? sceneId(project.nodes.find(item => item.id === next.target)) : undefined);
    if (node.data.scene) {
      assert.deepEqual(scene.commands, node.data.scene.commands);
      if (node.id === "scene" || node.id === novel.id) {
        for (const command of scene.commands) {
          if (["narration", "dialog"].includes(command.type))
            playback.push({ sceneId: scene.scene_id, type: command.type, text: command.text });
        }
      }
    } else if (node.data.nodeKind === "end") {
      assert.equal(scene.is_ending, true);
      assert.equal(scene.ending_id, node.data.ending.ending_id);
      assert.equal(scene.ending_title, node.data.ending.ending_title);
      assert.deepEqual(scene.commands, [{ type: "narration", text: node.data.ending.ending_title }]);
    } else {
      assert.equal(scene.commands.length, 1);
      assert.equal(scene.commands[0].type, "choice");
      const linked = node.data.choice.choices.filter(choice => project.edges
        .some(edge => edge.source === node.id && edge.sourceHandle === choice.choice_id));
      assert(linked.length > 0);
      assert.equal(scene.commands[0].choices.length, linked.length);
      for (const choice of linked) {
        const exported = scene.commands[0].choices.find(item => item.choice_id === choice.choice_id);
        const edge = project.edges.find(item => item.source === node.id && item.sourceHandle === choice.choice_id);
        const target = project.nodes.find(item => item.id === edge.target);
        assert.equal(exported.text, choice.text);
        assert.equal(exported.target_scene_id, sceneId(target));
        branches.push({
          choiceId: exported.choice_id,
          text: exported.text,
          sceneId: sceneId(target),
          commands: script.scenes.find(item => item.scene_id === sceneId(target)).commands,
          isEnding: target.data.nodeKind === "end",
        });
      }
    }
  }
  assert.equal(playback.length, 10);
  const mainline = branches.find(branch => branch.choiceId === "mainline");
  assert(mainline?.isEnding, "Reviewed mainline must reach an explicit ending, never loop to the imported scene");
  const assets = [];
  for (const asset of manifest.assets) {
    const bytes = await zip.file(asset.path).async("nodebuffer");
    assets.push({ id: asset.asset_id, path: asset.path, bytes: bytes.length, sha256: sha(bytes) });
  }
  assert(assets.some(asset => asset.id === "agentvn_placeholder_background"));
  return { manifest, script, scriptSha256: sha(scriptBytes), assets, playback, branches, mainline };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function protectPlayerProfile(action) {
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/native-dev-preview-profile.ps1"),
    "-Action", action, "-RunDirectory", playerOut,
  ], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  const log = path.join(playerOut, `profiles-${action}.log`);
  fs.writeFileSync(log, `${result.stdout || ""}${result.stderr || ""}`, { flag: "wx" });
  assert.equal(result.status, 0, `${action} player profile failed\n${result.stdout}\n${result.stderr}`);
}

function projectStateFromReport(report) {
  assert.equal(report.status, "PASS");
  assert.equal(report.version, "1.9.35");
  assert.equal(report.modelRequests, 13);
  assert.equal(report.realModelRequests, 13);
  assert.equal(shaFile(sourceReport), "fbfc6178d503cc54530ebbca9b411c44f9762e9b4749a97cefa955ffafacc737");
  assert.equal(shaFile(report.bundles[0].path), report.bundles[0].sha256);
  const project = report.restored.project;
  assert(project && Array.isArray(project.nodes) && Array.isArray(project.edges));
  const novelNodes = project.nodes.filter(node => node.data?.editorMeta?.importSessionId);
  assert.equal(novelNodes.length, 1);
  const choiceNodes = project.nodes.filter(node => node.data?.choice);
  assert.equal(choiceNodes.length, 1);
  assert(!project.edges.some(edge => edge.source === "scene" && edge.target === novelNodes[0].id));
  return { project, novelNodes, choiceNode: choiceNodes[0] };
}

async function run() {
  const source = read(sourceReport);
  const { project, novelNodes, choiceNode } = projectStateFromReport(source);
  const installation = read(installationFile);
  assert.equal(installation.status, "PASS");
  assert.equal(installation.executable.version, "1.9.35");
  assert.equal(installation.executable.sha256, expectedEditorSha);
  assert.equal(shaFile(installation.executable.path), expectedEditorSha);
  for (const resource of installation.resources) assert.equal(shaFile(resource.path), resource.sha256);
  const playerResource = installation.resources.find(item => path.basename(item.path) === "agentvn-player.exe");
  assert(playerResource);
  assert(!fs.existsSync(out), `Refusing to reuse existing Editor QA run: ${out}`);
  assert(!fs.existsSync(playerOut), `Refusing to reuse existing Player QA run: ${playerOut}`);
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(playerOut, { recursive: true });

  const report = {
    status: "RUNNING",
    version: "1.9.35",
    scope: "REAL_INSTALLED_EDITOR_NOVEL_EXPORT_AND_SAME_INSTALL_PLAYER_CONSUMPTION",
    startedAt: new Date().toISOString(),
    source: desc(sourceReport),
    installation: desc(installationFile),
    editorExecutable: desc(installation.executable.path),
    playerExecutable: desc(playerResource.path),
    inputProject: desc(source.bundles[0].path),
    sourcePaidRequests: source.realModelRequests,
    sourcePaidTokens: source.modelBoundary.reduce((total, item) => total + item.usage.total_tokens, 0),
    tools: [__filename, "scripts/lib/installed-release-session.cjs",
      "scripts/native-dev-preview-profile.ps1", "scripts/installed-layout-cache-session.ps1",
      "scripts/lib/current-native-capture.cjs"].map(file => desc(path.resolve(root, file))),
    protectedFiles: [
      desc("C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"),
      desc("C:/Users/1/AppData/Local/AgentVN/environment-cache/windows-pass.json"),
    ],
    modelRequests: 0,
    realModelRequests: 0,
    productChanges: 0,
    cases: [],
    steps: [],
    screenshots: [],
    launches: [],
    cleanups: [],
    errors: [],
    knownDefects: [],
    boundaries: [
      "Reuses the already completed paid novel result; no model request or retry",
      "Actual installed 1.9.35 Editor and bundled Player; not Dev/source",
      "CDP/WebView input, not physical mouse or physical 4K display",
      `Windows environment cache protection uses the ${cacheView} app-cache view`,
      `Physical test cache: ${physicalCache}; original identity and bytes must be restored`,
      "Placeholder background is intentionally retained and checked as package/player bytes",
      "Forced exact-owned cleanup is not claimed as normal native close",
      "This is a temporary isolated project, not the final user project",
    ],
  };
  const save = () => writeJson(path.join(out, "report.json"), report);
  for (const file of report.tools)
    fs.copyFileSync(file.path, path.join(out, path.basename(file.path)), fs.constants.COPYFILE_EXCL);
  save();

  const editor = installedReleaseSession({
    installationFile,
    out,
    report,
    save,
    input: source.bundles[0].path,
  });
  let page;
  let player;
  let playerBrowser;
  let playerPage;
  let playerCdp;
  let playerRoot;
  let playerProtected = false;
  let cacheProtected = false;
  let currentMetrics = { width: 1920, height: 1080, dpr: 1, reduced: false };
  const knownPlayer = new Map();
  const playerPorts = [];

  async function editorState() {
    return editor.api(`/api/project/projects/${project.project_id}`);
  }

  function protectEditorCache(action) {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"),
      "-Action", action, "-RunDirectory", out,
      "-AllowedRunRoot", path.dirname(out),
      ...(cacheView === "codex" ? ["-CodexCacheView"] : []),
      ...(physicalCache ? ["-PhysicalCache"] : []),
    ], { encoding: "utf8", windowsHide: true, timeout: 45000 });
    fs.writeFileSync(path.join(out, `cache-${action}.log`),
      `${result.stdout || ""}${result.stderr || ""}`, { flag: "wx" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }

  async function hit(locator, allowObstruction = false) {
    await locator.waitFor({ state: "visible" });
    const geometry = await locator.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        rect: rect.toJSON(),
        hit: top === node || node.contains(top),
        width: innerWidth,
        height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert((geometry.hit || allowObstruction) && geometry.rect.width > 0 && geometry.rect.height > 0);
    assert(geometry.rect.left >= 0 && geometry.rect.top >= 0);
    assert(geometry.rect.right <= geometry.width + 1 && geometry.rect.bottom <= geometry.height + 1);
    assert(geometry.overflow <= 1);
    return geometry;
  }

  async function openImportedProject() {
    const response = await fetch(`http://127.0.0.1:${editor.current.ports[0]}/api/project/projects/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(source.bundles[0].path)),
      },
      body: fs.readFileSync(source.bundles[0].path),
      signal: AbortSignal.timeout(30000),
    });
    const imported = await response.json();
    assert(response.ok && imported.ok);
    assert.equal(imported.data.project_id, project.project_id);
    await page.evaluate(({ id, directory }) => {
      localStorage.setItem("agentvn.projectExportDirectories.v1", JSON.stringify({ [id]: directory }));
    }, { id: project.project_id, directory: out });
    await page.reload();
    await page.locator(".recent-project-open:not(:disabled):visible")
      .filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor();
    await settleEditor(page);
  }

  async function step(name, action) {
    const item = { name, status: "RUNNING", startedAt: new Date().toISOString() };
    report.steps.push(item);
    save();
    try {
      item.detail = await action();
      item.status = "PASS";
    } catch (error) {
      item.status = "FAILED";
      item.error = String(error.stack || error);
      throw error;
    } finally {
      item.finishedAt = new Date().toISOString();
      save();
    }
  }

  async function rememberPlayer() {
    const current = rows();
    if (player) {
      const tree = ownedProcessTree(current, player.pid, playerRoot?.Created);
      if (tree.length) playerRoot = tree[0];
      for (const item of tree) knownPlayer.set(identity(item), item);
    }
    report.playerKnownProcesses = [...knownPlayer.values()];
    save();
  }

  async function stopPlayer(reason) {
    if (!player) return;
    await playerBrowser?.close().catch(() => {});
    playerBrowser = undefined;
    await rememberPlayer();
    const killed = [];
    for (const item of [...knownPlayer.values()].reverse()) {
      if (!rows().some(current => identity(current) === identity(item))) continue;
      stopOwnedProcess(item, ps);
      killed.push(identity(item));
    }
    const cleanup = {
      reason,
      killed,
      survivors: [...knownPlayer.values()].filter(item =>
        rows().some(current => identity(current) === identity(item))),
      listeners: listeners(playerPorts),
      normalCloseClaimed: false,
    };
    report.cleanups.push({ type: "player", ...cleanup });
    save();
    assert.equal(cleanup.survivors.length, 0);
    assert.equal(cleanup.listeners.length, 0);
    player = undefined;
    playerRoot = undefined;
  }

  async function playerReady(screen) {
    await playerPage.waitForFunction(expected => {
      const node = document.querySelector("[data-runtime-screen-transition]");
      return node?.getAttribute("data-runtime-presented-screen") === expected &&
        node?.getAttribute("data-runtime-screen-transition") === "idle" &&
        !document.querySelector('[data-testid="game-launch-blackout"]');
    }, screen);
    await settleRuntime(playerPage);
  }

  async function consumePlayback(expectedPlayback, metrics) {
    await playerPage.getByTestId("game-state-title").waitFor();
    await playerReady("title_menu");
    await playerPage.getByTestId("start-new-game").click();
    await playerReady("playing");
    const observed = [];
    for (let index = 0; index < expectedPlayback.length; index += 1) {
      const expected = expectedPlayback[index];
      await playerPage.waitForFunction(({ sceneId, text }) => {
        const stage = document.querySelector('[data-testid="game-state-playing"]');
        const dialog = document.querySelector(".dialog-box");
        return stage?.getAttribute("data-current-scene-id") === sceneId &&
          dialog?.getAttribute("aria-label")?.includes(text);
      }, expected);
      const dialog = playerPage.locator("button.dialog-box");
      if (await playerPage.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true")
        await dialog.click();
      await playerPage.waitForFunction(() =>
        document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
      const current = await dialog.evaluate(node => {
        const rect = node.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const stage = document.querySelector('[data-testid="game-state-playing"]');
        return {
          text: node.querySelector(".dialog-text")?.textContent,
          sceneId: stage?.getAttribute("data-current-scene-id"),
          type: stage?.getAttribute("data-current-command-type"),
          pages: node.getAttribute("data-dialog-pages"),
          done: node.getAttribute("data-dialog-page-done"),
          hit: top === node || node.contains(top),
          rect: rect.toJSON(),
          overflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      assert.equal(current.text, expected.text);
      assert.equal(current.sceneId, expected.sceneId);
      assert.equal(current.type, expected.type);
      assert.equal(current.pages, "1");
      assert.equal(current.done, "true");
      assert(current.hit && current.overflow <= 1);
      assert(current.rect.left >= 0 && current.rect.top >= 0);
      assert(current.rect.right <= metrics.width + 1 && current.rect.bottom <= metrics.height + 1);
      observed.push({ expected, current });
      if (index < expectedPlayback.length - 1) await dialog.click();
    }
    return observed;
  }

  async function consumeMainline(mainline) {
    await playerPage.locator("button.dialog-box").click();
    const choice = playerPage.getByRole("button", { name: `选择：${mainline.text}`, exact: true });
    await choice.waitFor({ state: "visible" });
    await until(() => choice.isEnabled(), "mainline choice accepts actual input", 30000);
    const geometry = await hit(choice);
    const options = await playerPage.locator(".choice-option:visible").allTextContents();
    assert.equal(options.length, report.exported.branches.length);
    await choice.click();
    await playerPage.waitForFunction(({ sceneId, text }) => {
      const stage = document.querySelector('[data-testid="game-state-playing"]');
      return stage?.getAttribute("data-current-scene-id") === sceneId &&
        document.querySelector(".dialog-box")?.getAttribute("aria-label")?.includes(text);
    }, { sceneId: mainline.sceneId, text: mainline.commands[0].text });
    const dialog = playerPage.locator("button.dialog-box");
    if (await playerPage.getByTestId("game-state-playing").getAttribute("data-is-typing") === "true")
      await dialog.click();
    await playerPage.waitForFunction(() =>
      document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
    assert.equal(await dialog.locator(".dialog-text").textContent(), mainline.commands[0].text);
    await dialog.click();
    await playerPage.waitForFunction(sceneId => {
      const stage = document.querySelector('[data-testid="game-state-playing"]');
      return stage?.getAttribute("data-current-scene-id") === sceneId &&
        stage?.getAttribute("data-ended") === "true";
    }, mainline.sceneId);
    return { choiceId: mainline.choiceId, options, geometry, sceneId: mainline.sceneId, ended: true };
  }

  try {
    protectEditorCache("SelfTest");
    cacheProtected = true;
    protectEditorCache("Prepare");
    await step("installed-editor-reopen-connect-save-and-export-byte-exact-cartridge", async () => {
      page = await editor.start();
      await openImportedProject();
      const initial = await editorState();
      assert.deepEqual(graphContent(initial), graphContent(project));
      await page.locator(".react-flow__controls-fitview").click();
      await page.waitForFunction(() => {
        const value = document.querySelector(".react-flow__viewport")?.getAttribute("style");
        const previous = window.__realNovelFit;
        window.__realNovelFit = { value, count: previous?.value === value ? previous.count + 1 : 0 };
        return window.__realNovelFit.count >= 3;
      }, null, { polling: "raf" });
      const sourceHandle = page.locator('.react-flow__node[data-id="scene"] .react-flow__handle.source[data-handleid="default"]');
      const targetHandle = page.locator(
        `.react-flow__node[data-id="${novelNodes[0].id}"] .react-flow__handle.target[data-handleid="default"]`);
      const sourceGeometry = await hit(sourceHandle);
      const targetGeometry = await hit(targetHandle);
      await page.mouse.move(sourceGeometry.rect.x + sourceGeometry.rect.width / 2,
        sourceGeometry.rect.y + sourceGeometry.rect.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetGeometry.rect.x + targetGeometry.rect.width / 2,
        targetGeometry.rect.y + targetGeometry.rect.height / 2, { steps: 16 });
      await page.mouse.up();
      await until(async () => (await editorState()).edges.length === project.edges.length + 1,
        "persisted scene-to-novel connection", 30000);
      const connected = await editorState();
      assert.deepEqual(graphContent(connected).nodes, graphContent(project).nodes);
      assert.deepEqual(
        connected.edges.filter(edge => project.edges.some(old => old.id === edge.id)),
        project.edges,
      );
      const added = connected.edges.filter(edge => !project.edges.some(old => old.id === edge.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].source, "scene");
      assert.equal(added[0].target, novelNodes[0].id);

      // The paid import result leaves the "继续原文主线" choice without a
      // target. Complete that author-review action through the real canvas so
      // the following export test exercises a playable graph. This one-chapter
      // fixture has no next authored scene, so add an explicit terminal rather
      // than creating a loop back to the same imported scene.
      const endCountBefore = connected.nodes.filter(node => node.data.nodeKind === "end").length;
      await page.locator('[data-help-key="palette.end"]').click();
      await until(async () => {
        const current = await editorState();
        return current.nodes.filter(node => node.data.nodeKind === "end").length === endCountBefore + 1;
      }, "created an explicit isolated-fixture terminal", 30000);
      const withTerminal = await editorState();
      const endNode = withTerminal.nodes.find(node =>
        node.data.nodeKind === "end" && !connected.nodes.some(old => old.id === node.id));
      assert(endNode);
      const endSceneId = `end_${endNode.id}`;
      const endNodeElement = page.locator(`.react-flow__node[data-id="${endNode.id}"]`);
      await endNodeElement.waitFor({ state: "visible" });
      await endNodeElement.click();
      const endTitleInput = page.locator('[data-help-key="field.endingTitle"]');
      await endTitleInput.fill("隔离验收终点");
      await until(async () => {
        const current = await editorState();
        return current.nodes.find(node => node.id === endNode.id)?.data.ending?.ending_title === "隔离验收终点";
      }, "saved isolated-fixture terminal title", 30000);

      // This author-review correction is confined to this temporary project.
      const mainlineSourceHandle = page.locator(
        `.react-flow__node[data-id="${choiceNode.id}"] .react-flow__handle.source[data-handleid="mainline"]`,
      );
      const mainlineTargetHandle = page.locator(
        `.react-flow__node[data-id="${endNode.id}"] .react-flow__handle.target[data-handleid="default"]`,
      );
      const mainlineSourceGeometry = await hit(mainlineSourceHandle);
      const mainlineTargetGeometry = await hit(mainlineTargetHandle);
      await page.mouse.move(
        mainlineSourceGeometry.rect.x + mainlineSourceGeometry.rect.width / 2,
        mainlineSourceGeometry.rect.y + mainlineSourceGeometry.rect.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        mainlineTargetGeometry.rect.x + mainlineTargetGeometry.rect.width / 2,
        mainlineTargetGeometry.rect.y + mainlineTargetGeometry.rect.height / 2,
        { steps: 16 },
      );
      await page.mouse.up();
      await until(async () => (await editorState()).edges.length === project.edges.length + 2,
        "persisted mainline choice connection", 30000);
      const fullyConnected = await editorState();
      const mainlineEdge = fullyConnected.edges.find(edge =>
        edge.source === choiceNode.id &&
        edge.sourceHandle === "mainline" &&
        edge.target === endNode.id,
      );
      assert(mainlineEdge);
      report.manualAuthoringCorrections = [
        {
          kind: "create-isolated-fixture-terminal",
          nodeId: endNode.id,
          endingId: endNode.data.ending?.ending_id,
          endingTitle: "隔离验收终点",
          reason: "付费样例只有一段导入主线；为避免把“继续原文主线”连回同一场景造成循环，按真实作者操作增加显式测试终点。",
        },
        {
          kind: "connect-imported-mainline-choice",
          choiceNodeId: choiceNode.id,
          choiceId: "mainline",
          targetNodeId: endNode.id,
          targetSceneId: endSceneId,
          edge: mainlineEdge,
          reason: "真实发布预检发现“继续原文主线”缺少 target_scene_id；在隔离工程中按作者审核流程补齐。",
        },
      ];
      const connectedAfterReview = fullyConnected;
      const expectedNodesAfterReview = structuredClone(graphContent(connected).nodes);
      expectedNodesAfterReview.push(structuredClone(
        graphContent(connectedAfterReview).nodes.find(node => node.id === endNode.id),
      ));
      const expectedChoice = expectedNodesAfterReview.find(node => node.id === choiceNode.id);
      const expectedMainline = expectedChoice?.data.choice?.choices?.find(choice => choice.choice_id === "mainline");
      assert(expectedMainline);
      expectedMainline.target_scene_id = endSceneId;
      assert.deepEqual(graphContent(connectedAfterReview).nodes, expectedNodesAfterReview);

      await page.locator('[data-help-key="toolbar.saveProject"]').click();
      const saveDialog = page.getByTestId("project-save-confirmation");
      await saveDialog.waitFor();
      const saveMessage = await saveDialog.innerText();
      assert(saveMessage.includes(out) || saveMessage.includes(out.replaceAll("/", "\\")));
      await saveDialog.getByRole("button", { name: "OK", exact: true }).click();
      await saveDialog.waitFor({ state: "detached" });
      const savedFiles = fs.readdirSync(out).filter(name => name.endsWith(".vnproj"));
      assert.equal(savedFiles.length, 1);
      const savedProject = path.join(out, savedFiles[0]);
      const saved = desc(savedProject);
      const savedZip = await JSZip.loadAsync(fs.readFileSync(savedProject), { checkCRC32: true });
      const savedData = JSON.parse(await savedZip.file("project.json").async("string"));
      assert.deepEqual(graphContent(savedData), graphContent(connectedAfterReview));
      report.connected = connectedAfterReview;
      report.savedProject = saved;

      await page.locator('[data-workspace-surface="publish"]:visible').click();
      await settleEditor(page);
      const operation = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await operation.isVisible())
          return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
        const settings = page.locator('[data-package-stage="settings"]');
        if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") {
          await settings.click();
          return false;
        }
        return await page.locator('[data-help-key="package.mode"]').isVisible();
      }, "publishing environment operation terminal", 60000);
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        report.incidentalEnvironment = { phase, text: await operation.innerText(),
          boundary: "Cache-isolated environment check, not Windows standalone readiness" };
        save();
        await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await operation.waitFor({ state: "detached" });
      }
      await page.locator('[data-package-stage="settings"]').click();
      // Selecting cartridge does not bypass toolchain validation: this is the
      // product's independent export format, which does not compile a game.
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      for (const [key, value] of [
        ["gameId", project.project_id],
        ["title", project.title],
        ["author", "AgentVN QA"],
        ["description", "1.9.35 安装版真实小说消费闭环"],
      ]) {
        await page.locator(`[data-help-key="package.${key}"]`).fill(value);
      }

      // Inspect the real preflight stage before confirming warnings. Keeping
      // the check rows and blocker details in the report distinguishes an
      // actual blocker from an unconfirmed-warning disabled export button.
      await page.locator('[data-package-stage="checks"]').click();
      await page.locator('[data-package-stage="checks"][aria-current="page"]').waitFor();
      const checkButtons = page.locator("[data-preflight-check-id]");
      await checkButtons.first().waitFor({ state: "visible" });
      report.preflightChecks = await checkButtons.evaluateAll(buttons => buttons.map(button => {
        const row = button.closest(".preflight-check");
        return {
          id: button.getAttribute("data-preflight-check-id"),
          status: row?.classList.contains("is-blocked") ? "blocked"
            : row?.classList.contains("is-warning") ? "warning" : "pass",
          summary: button.innerText,
        };
      }));
      const blockedChecks = report.preflightChecks.filter(item => item.status === "blocked");
      report.blockerDetails = [];
      for (const item of blockedChecks) {
        await page.locator(`[data-preflight-check-id="${item.id}"]`).click();
        const detail = page.getByTestId("package-preflight-detail-dialog");
        await detail.waitFor();
        report.blockerDetails.push({ id: item.id, text: await detail.innerText() });
        await detail.getByRole("button", { name: "返回检查", exact: true }).click();
        await detail.waitFor({ state: "detached" });
      }
      save();
      assert.equal(blockedChecks.length, 0,
        `Actual installed publish preflight has blockers: ${JSON.stringify(report.blockerDetails)}`);

      const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
      if (await confirm.isVisible()) {
        await confirm.check();
        assert(await confirm.isChecked(), "Warning acknowledgement did not persist in the actual UI");
      }
      report.warningAcknowledgement = {
        visible: await confirm.isVisible(),
        checked: await confirm.isChecked().catch(() => false),
      };
      const exportButton = page.locator('[data-help-key="package.export"]');
      report.exportReadiness = {
        stage: await page.locator('[data-package-stage="checks"]').innerText(),
        overview: await page.locator(".package-stage-overview").innerText(),
        exportButtonEnabled: await exportButton.isEnabled(),
        warningAcknowledgement: report.warningAcknowledgement,
      };
      save();
      assert(await exportButton.isEnabled(),
        `Actual cartridge export remains blocked after warning acknowledgement:\n${JSON.stringify(report.exportReadiness)}`);
      let exportGeometry = await hit(exportButton, true);
      if (!exportGeometry.hit) {
        const grip = page.getByRole("button", { name: "拖动小说任务卡片", exact: true });
        if (!(await grip.count())) throw new Error("Export button is obstructed and no task-card grip exists");
        const gripBox = await grip.boundingBox();
        assert(gripBox);
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2 - 320, { steps: 16 });
        await page.mouse.up();
        exportGeometry = await hit(exportButton);
        report.knownDefects.push({
          id: "NOVEL-TASK-CARD-EXPORT-OBSTRUCTION",
          status: "OBSERVED_WORKAROUND_USED",
          description: "The export control required a real task-card drag before it became hittable.",
          afterDrag: exportGeometry,
        });
      }
      const cartridgeDir = path.join(out, "cartridge");
      fs.mkdirSync(cartridgeDir);
      await editor.cdp.send("Page.enable");
      await editor.cdp.send("Browser.setDownloadBehavior", {
        behavior: "allow", downloadPath: cartridgeDir, eventsEnabled: true,
      });
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 60000 }),
        exportButton.click(),
      ]);
      assert.equal(await download.failure(), null);
      const cartridgePath = path.join(cartridgeDir, download.suggestedFilename());
      await until(() => fs.existsSync(cartridgePath) && !fs.existsSync(`${cartridgePath}.crdownload`),
        "completed installed UI cartridge export", 60000);
      const cartridge = desc(cartridgePath);
      report.cartridge = cartridge;
      const exported = await inspectCartridge(cartridgePath, report.connected);
      assert.equal(exported.playback.length, 10);
      report.exported = exported;
      for (const asset of exported.assets) {
        const original = savedData.asset_manifest.find(item => item.asset_id === asset.id);
        assert(original);
        assert.equal(sha(await savedZip.file(original.metadata.project_path).async("nodebuffer")), asset.sha256);
      }
      await editor.shot("editor-export-complete");
      return {
        sourceGraphEdges: project.edges.length,
        connectedGraphEdges: connectedAfterReview.edges.length,
        importedNode: novelNodes[0].id,
        savedProject: saved,
        cartridge,
        playbackCount: exported.playback.length,
      };
    });
    report.modelRequests = 0;
    report.realModelRequests = 0;
    await editor.stop("editor export complete; exact owned cleanup, not native normal close");

    await step("same-install-player-consumes-exported-novel-at-high-resolution-matrix", async () => {
      playerProtected = true;
      protectPlayerProfile("Prepare");
      const port = await freePort();
      playerPorts.push(port);
      const temporary = path.join(playerOut, "temporary");
      fs.mkdirSync(temporary);
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(key)) delete env[key];
      }
      Object.assign(env, {
        WEBVIEW2_USER_DATA_FOLDER: path.join(playerOut, "webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        TEMP: temporary,
        TMP: temporary,
        AGENTVN_TEST_PROJECT: source.bundles[0].path,
        AGENTVN_WORKSPACE_OUTPUT: playerOut,
      });
      const log = fs.openSync(path.join(playerOut, "player.log"), "wx");
      player = spawn(playerResource.path, ["--mode", "preview", "--cartridge", report.cartridge.path], {
        cwd: installation.installRoot,
        env,
        windowsHide: true,
        stdio: ["ignore", log, log],
      });
      fs.closeSync(log);
      report.playerLaunch = {
        pid: player.pid,
        port,
        executable: report.playerExecutable,
        args: ["--mode", "preview", "--cartridge", report.cartridge.path],
        environment: {
          AGENTVN_TEST_PROJECT: source.bundles[0].path,
          AGENTVN_WORKSPACE_OUTPUT: playerOut,
          WEBVIEW2_USER_DATA_FOLDER: env.WEBVIEW2_USER_DATA_FOLDER,
        },
      };
      report.launches.push(report.playerLaunch);
      await rememberPlayer();
      await until(async () => {
        assert.equal(player.exitCode, null);
        await rememberPlayer();
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`,
            { signal: AbortSignal.timeout(1000) })).ok;
        } catch {
          return false;
        }
      }, "same-install Player WebView", 60000);
      const tree = ownedProcessTree(rows(), player.pid, playerRoot?.Created);
      assert(listeners([port]).every(listener =>
        tree.some(item => item.ProcessId === listener.OwningProcess)));
      playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      playerPage = await until(() => playerBrowser.contexts().flatMap(context => context.pages())
        .find(candidate => /tauri\.localhost|^tauri:/.test(candidate.url())), "Player document", 30000);
      playerPage.setDefaultTimeout(30000);
      playerCdp = await playerPage.context().newCDPSession(playerPage);
      playerPage.on("pageerror", error => {
        report.errors.push(String(error));
        save();
      });
      const playback = report.exported.playback;
      for (const width of [1920, 2560, 3840]) {
        for (const dpr of [1, 2]) {
          for (const reduced of [false, true]) {
            const metrics = { width, height: width * 9 / 16, dpr, reduced };
            currentMetrics = metrics;
            const item = { ...metrics, status: "RUNNING", playback: [] };
            report.cases.push(item);
            save();
            await playerCdp.send("Emulation.setDeviceMetricsOverride", {
              width, height: metrics.height, deviceScaleFactor: dpr, mobile: false,
            });
            await playerPage.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
            item.viewport = await readInstalledViewport(playerPage, metrics);
            item.playback = await consumePlayback(playback, metrics);
            const background = await playerPage.locator(
              '.background-layer[data-background-id="agentvn_placeholder_background"]').evaluate(async node => {
                const images = [node, ...node.querySelectorAll("*")]
                  .map(item => getComputedStyle(item).backgroundImage)
                  .filter(value => value.startsWith('url("'))
                  .map(value => value.slice(5, -2));
                const loaded = [];
                for (const url of [...new Set(images)]) {
                  const bytes = await (await fetch(url)).arrayBuffer();
                  const image = new Image();
                  image.src = url;
                  await image.decode();
                  loaded.push({ bytes: bytes.byteLength, width: image.naturalWidth, height: image.naturalHeight,
                    sha256: await crypto.subtle.digest("SHA-256", bytes)
                      .then(value => [...new Uint8Array(value)]
                        .map(byte => byte.toString(16).padStart(2, "0")).join("")) });
                }
                return loaded;
              });
            assert.equal(background.length, 1);
            assert.equal(background[0].sha256,
              report.exported.assets.find(asset => asset.id === "agentvn_placeholder_background").sha256);
            item.background = background;
            item.mainline = await consumeMainline(report.exported.mainline);
            item.status = "PASS";
            if ((width === 1920 && dpr === 1 && !reduced) ||
                (width === 3840 && dpr === 2 && reduced)) {
              report.screenshots.push(await captureInstalledWebview(
                playerPage, playerCdp,
                path.join(playerOut, `novel-${width}-${dpr}-${reduced}.png`), metrics));
            }
            save();
            await playerPage.keyboard.press("Escape");
            await playerReady("title_menu");
            await playerPage.reload();
          }
        }
      }
      assert.equal(report.cases.length, 12);
      assert(report.cases.every(item => item.status === "PASS" &&
        item.playback.length === playback.length && item.background.length === 1 &&
        item.mainline?.ended === true));
      return { matrix: report.cases.length, playback: playback.length, actualAssetConsumption: true,
        reviewedMainlineEndingConsumed: true };
    });
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED";
    report.error = String(error.stack || error);
    process.exitCode = 1;
    if (playerPage && !playerPage.isClosed()) {
      report.failurePlayerText = await playerPage.locator("body").innerText().catch(String);
      if (playerCdp) {
        await captureInstalledWebview(playerPage, playerCdp, path.join(playerOut, "failure.png"),
          currentMetrics)
          .then(item => report.screenshots.push(item)).catch(captureError => {
            report.failureCaptureError = String(captureError);
          });
      }
    } else if (page && !page.isClosed()) {
      report.failureEditorText = await page.locator("body").innerText().catch(String);
    }
  } finally {
    for (const [name, action] of [
      ["playerStop", () => stopPlayer("final exact Player cleanup; not native normal close")],
      ["playerRestore", () => {
        if (playerProtected && fs.existsSync(path.join(playerOut, "profile-protection.json"))) {
          protectPlayerProfile("Restore");
          report.playerProfileRestoration = desc(path.join(playerOut, "profile-restoration.json"));
          assert.equal(read(report.playerProfileRestoration.path).status, "PASS");
        }
      }],
      ["editorStop", () => editor.stop("final exact Editor cleanup; not native normal close")],
      ["cacheRestore", () => {
        if (cacheProtected && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
          protectEditorCache("Restore");
          report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
          assert.equal(read(report.cacheRestoration.path).status, "PASS");
        }
      }],
      ["immutable", () => {
        for (const file of [report.source, report.inputProject, report.installation, report.editorExecutable,
          report.playerExecutable, ...report.tools, ...report.protectedFiles])
          assert.equal(shaFile(file.path), file.sha256, file.path);
      }],
    ]) {
      try { await action(); }
      catch (error) {
        (report.cleanupErrors ??= []).push({ name, error: String(error.stack || error) });
        report.status = "FAILED";
        process.exitCode = 1;
      }
    }
    report.finishedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({
      status: report.status,
      out,
      playerOut,
      steps: report.steps.map(item => [item.name, item.status]),
      cases: report.cases.length,
      modelRequests: report.modelRequests,
      error: report.error,
      cleanupErrors: report.cleanupErrors,
    }));
  }
}

module.exports = { inspectCartridge, projectStateFromReport };
if (require.main === module) {
  const mode = process.argv[2] || "run";
  const task = mode === "preflight" ? async () => {
    const source = read(sourceReport);
    const { project } = projectStateFromReport(source);
    const zip = await JSZip.loadAsync(fs.readFileSync(source.bundles[0].path), { checkCRC32: true });
    assert.deepEqual(graphContent(JSON.parse(await zip.file("project.json").async("string"))), graphContent(project));
    const installation = read(installationFile);
    assert.equal(installation.executable.version, "1.9.35");
    assert.equal(shaFile(installation.executable.path), expectedEditorSha);
    for (const item of installation.resources) assert.equal(shaFile(item.path), item.sha256);
    assert(source.modelBoundary.every(item => item.model === "deepseek-v4-flash" &&
      item.status === "SUCCEEDED" && item.httpStatus === 200));
    assert.equal(source.modelBoundary.reduce((total, item) => total + item.usage.total_tokens, 0), 45932);
    const db = new DatabaseSync(source.finalDatabase.path, { readOnly: true });
    try {
      assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(item => item.integrity_check), ["ok"]);
    } finally { db.close(); }
    assert.equal(shaFile(source.finalDatabase.path), source.finalDatabase.sha256);
    console.log(JSON.stringify({ status: "PASS", scope: "NO_CHARGE_SOURCE_AND_INSTALLED_ARTIFACT_PREFLIGHT",
      paidRequestsInSource: source.realModelRequests, newModelRequests: 0, scenes: project.nodes.length }));
  } : mode === "run" ? run : async () => assert.fail("Use preflight or run");
  task().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
