"use strict";
// Actual Dev editor -> public directory export -> owned Windows GameCLI window.
// CDP emulates CSS viewport/DPR inside WebView2; this is not installed Release
// acceptance or a claim that the physical display is 4K.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const root = path.resolve(__dirname, "..");
const req = createRequire(path.join(root, "editor/package.json"));
const { chromium } = req("playwright");
const { startOwnedViteServer } = require("./lib/owned-vite-server.cjs");
const { waitForAsyncFunction } = require("./lib/async-readiness.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const output = path.join(root, "output/playwright/dialog-native-preview", runId);
const exe = path.join(root, "AgentVN Dev.exe");
const gatePath = process.argv.find(arg => arg.startsWith("--gate="))?.slice(7);
const widths = [[1920, 1080], [2560, 1440], [3840, 2160]];
const longBubble = Array.from({ length: 60 }, (_, i) =>
  `${String(i + 1).padStart(2, "0")}  原生分页保留缩进、空行和全部文字，键盘与指针不能跳过任何片段。\n\n`).join("");
const report = { runId, status: "RUNNING",
  scope: "E4 dialogue real Dev export and native external preview; not installed Release/Android",
  viewportMethod: "WebView2 CDP CSS viewport simulation, not physical 4K",
  startedAt: new Date().toISOString(), cases: [], artifacts: [] };
const save = () => fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const artifact = file => ({ path: file, sha256: sha(file),
  modifiedAt: fs.statSync(file).mtime.toISOString() });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ownedPlayers = new Set();
const native = (page, command, args = {}) => page.evaluate(({ command, args }) =>
  window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
function processes() {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='agentvn-player.exe' OR Name='AgentVN Dev.exe' OR Name='agentvn-editor.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"],
  { windowsHide: true, encoding: "utf8" }).trim();
  const result = text ? JSON.parse(text) : [];
  return Array.isArray(result) ? result : [result];
}
async function freePort(requested = 0) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(requested, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function stop(pid) {
  if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"],
    { windowsHide: true, stdio: "ignore" });
}
function checkPortOwnership(port, rootPid) {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `@{ processes=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId); listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) } | ConvertTo-Json -Compress -Depth 4`],
  { windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const state = JSON.parse(text), family = new Set([rootPid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const item of state.processes)
      if (family.has(item.ParentProcessId) && !family.has(item.ProcessId)) {
        family.add(item.ProcessId); changed = true;
      }
  }
  assert(state.listeners.length > 0 && state.listeners.every(pid => family.has(pid)),
    `Port ${port} is not owned by this test process tree`);
  report.portOwnership ??= [];
  report.portOwnership.push({ port, rootPid, listeners: state.listeners });
}
async function connect(port, ownerAlive) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    assert(ownerAlive(), `Owned host for CDP ${port} exited before connecting`);
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch {}
    await pause(300);
  }
  throw Error(`Owned CDP ${port} did not become ready`);
}
async function settled(page) {
  await page.locator(".game-launch-blackout").waitFor({ state: "detached", timeout: 30000 });
  await page.locator('[data-runtime-screen-transition="idle"]').waitFor({ timeout: 30000 });
}
async function line(page, text, mode) {
  await page.waitForFunction(({ text, mode }) => {
    const dialog = document.querySelector(".dialog-box");
    const actual = dialog?.classList.contains("is-bubble-presentation") ? "bubble"
      : dialog?.classList.contains("is-nvl-presentation") ? "nvl" : "dialog";
    return actual === mode && dialog?.getAttribute("aria-label")?.includes(text);
  }, { text, mode });
  await settled(page);
  // Wait for this line's actual text/reveal commit. The previous line's
  // pageDone attribute can survive a render before the reset effect runs.
  await page.waitForFunction(text => {
    const box = document.querySelector(".dialog-box");
    const visible = box?.querySelector(".dialog-text, .nvl-page [data-nvl-current='true'] .nvl-page-text");
    return box?.dataset.dialogPageDone === "true" && visible?.textContent?.includes(text);
  }, text, { timeout: 60000 });
}
async function advance(page, method = "Enter") {
  const dialog = page.locator(".dialog-box");
  if (method === "pointer") await dialog.click();
  else await dialog.press(method);
}
async function geometry(page) {
  const actual = await page.locator(".dialog-box").evaluate(node => {
    const rect = node.getBoundingClientRect();
    const stage = node.closest(".story-player").getBoundingClientRect();
    const text = node.querySelector(".dialog-text");
    const quick = document.querySelector(".renpy-quick-bar")?.getBoundingClientRect();
    return { rect: rect.toJSON(), stage: stage.toJSON(), quick: quick?.toJSON(),
      bubble: node.classList.contains("is-bubble-presentation"),
      anchor: node.dataset.dialogBubbleAnchor, pages: Number(node.dataset.dialogPages),
      textOverflow: text ? text.scrollWidth - text.clientWidth : 0,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        physicalWidth: screen.width, physicalHeight: screen.height } };
  });
  assert(actual.rect.width > 0 && actual.rect.height > 0
    && actual.rect.left >= actual.stage.left - 1 && actual.rect.right <= actual.stage.right + 1
    && actual.rect.top >= actual.stage.top - 1 && actual.rect.bottom <= actual.stage.bottom + 1,
  `Dialogue is clipped by actual native game frame: ${JSON.stringify(actual)}`);
  assert(actual.textOverflow <= 1 && actual.horizontalOverflow <= 1,
    `Native dialogue text overflows: ${JSON.stringify(actual)}`);
  if (actual.bubble && actual.quick) {
    const a = actual.rect, b = actual.quick;
    assert(!(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
      "Bubble must avoid the real quick bar");
  }
  return actual;
}
async function openSave(page, skin) {
  if (skin === "renpy") await page.getByTestId("renpy-quick-save-load").click();
  else {
    await page.getByTestId("quick-menu-toggle").click();
    await page.getByRole("button", { name: "打开存档读档", exact: true }).click();
  }
  await page.getByTestId("save-slot-grid").waitFor();
  await settled(page);
}
async function closeSave(page, skin) {
  await page.getByTestId(skin === "renpy" ? "renpy-menu-return" : "back-to-player").click();
  await page.getByTestId("game-state-playing").waitFor();
  await settled(page);
}
function makeProject(skin, layout) {
  const fixture = JSON.parse(fs.readFileSync(
    path.join(root, "scripts/fixtures/dialog-presentation-isolated.vnproj"), "utf8"));
  fixture.project_id = `native-dialog-${skin}-${crypto.randomUUID()}`;
  fixture.title = `原生对白验收 ${skin} ${runId}`;
  fixture.editor_settings = {
    defaultDialogPresentation: "bubble", characterDialogPresentations: { alice: "nvl" },
    runtimeUILayout: layout,
    ...(skin === "renpy" ? { runtimeUILayoutProfiles: {
      version: 1, activeType: "renpy", profiles: {
        agentvn: layouts.getDefaultUISkinLayout(), renpy: layout,
      },
    } } : {}),
  };
  fixture.nodes.find(node => node.id === "scene").data.scene.commands = [
    { type: "narration", text: "工程默认气泡：旁白不继承角色。" },
    { type: "dialog", character_id: "alice", text: "角色默认 NVL 第一行。" },
    { type: "dialog", character_id: "alice", text: "角色默认 NVL 第二行。" },
    { type: "dialog", character_id: "alice", text: "显式清页后的第三行。", clear_nvl_page_before: true },
    { type: "dialog", character_id: "alice", text: "节点显式普通对白优先。", presentation_mode: "dialog" },
    { type: "dialog", character_id: "alice", text: "节点显式固定气泡优先。", presentation_mode: "bubble",
      bubble_position: { mode: "fixed", x: 65, y: 25 } },
    { type: "narration", text: longBubble, presentation_mode: "bubble" },
    { type: "narration", text: "原生验收末句。", presentation_mode: "dialog" },
  ];
  return fixture;
}
const compiled = req("esbuild").buildSync({
  stdin: { resolveDir: root, loader: "ts", contents: `
    export { createRenpyUILayout } from './shared/cartridge/uiLayoutProfiles';
    export { getDefaultUISkinLayout } from './shared/cartridge/uiSkin';
  ` }, bundle: true, packages: "external", platform: "node", format: "cjs", write: false,
}).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", "require", compiled)(mod, mod.exports, req);
const layouts = mod.exports;
async function packageExport(previewRoot, destination) {
  const zip = new (req("jszip"))();
  const entries = [];
  function add(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      assert(!entry.isSymbolicLink(), "Owned export must not contain links");
      if (entry.isDirectory()) add(file, name);
      else {
        zip.file(name, fs.readFileSync(file));
        entries.push({ name, sha256: sha(file) });
      }
    }
  }
  add(previewRoot);
  fs.writeFileSync(destination, await zip.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
  const reopened = await req("jszip").loadAsync(fs.readFileSync(destination));
  for (const entry of entries)
    assert.equal(crypto.createHash("sha256").update(await reopened.file(entry.name).async("nodebuffer"))
      .digest("hex"), entry.sha256, `Packaged export changed bytes of ${entry.name}`);
  return { ...artifact(destination), origin: previewRoot, entries };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let host, backend, vite, browser, playerBrowser, editor, player, playerRecord, standalone;
  let baselineLibrary;
  const testInstalls = new Set();
  const nativeErrors = [];
  try {
    assert(gatePath, "Supply --gate=<completed dialogue report> before native candidate acceptance");
    const gate = JSON.parse(fs.readFileSync(path.resolve(gatePath), "utf8"));
    assert.equal(gate.status, "E4_DIALOGUE_BROWSER_DEV_PASS", "Browser/Dev stage not complete");
    assert.equal(sha(exe), gate.dev.sha256, "Root Dev differs from accepted candidate");
    report.sourceBefore = gate.sourceBefore.map(row => {
      assert.equal(sha(path.join(root, row.file)), row.sha256, `Accepted source changed: ${row.file}`);
      return row;
    });
    report.testSource = artifact(__filename);
    assert.equal(processes().length, 0, "Existing editor/player belongs to user; refuse to take it over");
    await freePort(6767);
    const backendPort = await freePort(), editorPort = await freePort(), playerPort = await freePort();
    assert.equal(new Set([backendPort, editorPort, playerPort, 6767]).size, 4, "Independent ports required");
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    report.gate = path.resolve(gatePath);
    report.executable = artifact(exe);
    report.isolation = { project: "per-run generated small fixture", backendUrl, editorPort, playerPort,
      database: path.join(output, "data/backend/vn_engine.db"),
      webview: path.join(output, "webview"), userProject: "not accessed" };
    fs.mkdirSync(path.dirname(report.isolation.database), { recursive: true });
    backend = spawn("python", ["backend_launcher.py"], { cwd: path.join(root, "backend"),
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
        AGENTVN_EDITOR_DATA_DIR: path.join(output, "data"),
        AGENTVN_BACKEND_DATA_DIR: path.dirname(report.isolation.database),
        DATABASE_PATH: report.isolation.database, AGENTVN_BACKEND_PORT: String(backendPort),
        AGENTVN_LEGACY_DATABASE_PATHS: "" } });
    const backendLog = fs.createWriteStream(path.join(output, "backend.log"));
    for (const stream of [backend.stdout, backend.stderr]) stream.pipe(backendLog, { end: false });
    backend.once("exit", () => backendLog.end());
    const deadline = Date.now() + 60000;
    while (true) {
      assert.equal(backend.exitCode, null, "Owned isolated backend exited");
      try { if ((await fetch(`${backendUrl}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break; } catch {}
      assert(Date.now() < deadline, "Isolated backend did not become healthy");
      await pause(300);
    }
    checkPortOwnership(backendPort, backend.pid);
    const previousUrl = process.env.VITE_BACKEND_URL;
    process.env.VITE_BACKEND_URL = backendUrl;
    try {
      vite = await startOwnedViteServer({ root: path.join(root, "editor"), port: 6767,
        logFile: path.join(output, "vite.log") });
    } finally {
      if (previousUrl === undefined) delete process.env.VITE_BACKEND_URL;
      else process.env.VITE_BACKEND_URL = previousUrl;
    }
    checkPortOwnership(6767, vite.pid);
    report.frontend = { mode: "owned Vite source service in actual Dev WebView2, not installed Release",
      pid: vite.pid, runId: vite.runId, url: vite.url };
    host = spawn(exe, [], { cwd: root, windowsHide: true, stdio: "ignore", env: {
      ...process.env, AGENTVN_EDITOR_DATA_DIR: path.join(output, "data"),
      AGENTVN_BACKEND_PORT: String(backendPort), AGENTVN_LEGACY_DATABASE_PATHS: "",
      WEBVIEW2_USER_DATA_FOLDER: report.isolation.webview,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${editorPort}`,
      AGENTVN_GAMECLI_PREVIEW_CDP_PORT: String(playerPort),
    } });
    report.owner = { hostPid: host.pid, backendPid: backend.pid }; save();
    browser = await connect(editorPort, () => host.exitCode === null);
    checkPortOwnership(editorPort, host.pid);
    editor = browser.contexts()[0].pages()[0];
    editor.setDefaultTimeout(30000);
    await editor.locator(".project-home").waitFor({ timeout: 60000 });
    assert.equal(new URL(editor.url()).origin, vite.url, "Editor connected to unrelated frontend");
    const capabilities = await native(editor, "get_native_capabilities");
    assert(capabilities.includes(`backend-base-url=${backendUrl}`), "Native editor backend not isolated");
    const editorCdp = await editor.context().newCDPSession(editor);
    await editorCdp.send("Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    for (const skin of ["agentvn", "renpy"]) {
      const layout = skin === "renpy" ? layouts.createRenpyUILayout() : layouts.getDefaultUISkinLayout();
      const fixture = makeProject(skin, layout);
      const input = path.join(output, `${skin}.vnproj`);
      fs.writeFileSync(input, JSON.stringify(fixture), { flag: "wx" });
      report.artifacts.push(artifact(input));
      if (await editor.locator(".editor-toolbar").count()) {
        await editor.locator('[data-help-key="toolbar.home"]').click();
      }
      const imported = await fetch(`${backendUrl}/api/project/projects/import`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
        body: fs.readFileSync(input),
      });
      assert(imported.ok, `Public isolated fixture import failed: ${await imported.text()}`);
      report.fixtureSetup = "Public backend import API; real recent-project UI click; native picker not tested";
      await editor.reload();
      await editor.locator(".project-home").waitFor({ timeout: 60000 });
      await editor.locator(".recent-project-open").filter({ hasText: fixture.title }).click();
      await editor.locator(".editor-toolbar").waitFor();
      await editor.waitForFunction(() => !document.querySelector(".project-entry-loading-overlay"));
      await editor.locator('[data-workspace-surface="preview"]:visible').click();
      await editor.getByTestId("preview-launch-panel").waitFor();
      assert.equal(await editor.locator("iframe").count(), 0, "Top preview must not mount node iframe");
      await editor.locator('[data-help-key="preview.open"]').click();
      await editor.waitForFunction(() => document.querySelector("[data-testid='preview-window-status']")
        ?.textContent.includes("运行中"), undefined, { timeout: 90000 });
      const children = processes().filter(p => p.ParentProcessId === host.pid
        && /agentvn-player\.exe$/i.test(p.ExecutablePath || ""));
      assert.equal(children.length, 1, "Exactly one actual external player");
      playerRecord = children[0];
      ownedPlayers.add(playerRecord.ProcessId);
      const previewRoot = (playerRecord.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/) || []).slice(1)
        .find(Boolean);
      assert(previewRoot && fs.existsSync(previewRoot), "Record real exported preview root");
      const scriptFile = path.join(previewRoot, "script.json");
      const layoutFile = path.join(previewRoot, "ui/layout.json");
      const manifestFile = path.join(previewRoot, "manifest.json");
      const script = JSON.parse(fs.readFileSync(scriptFile, "utf8"));
      const exportedLayout = JSON.parse(fs.readFileSync(layoutFile, "utf8"));
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      assert.equal(script.default_dialog_presentation, "bubble");
      assert.equal(script.characters.find(c => c.character_id === "alice").dialog_presentation, "nvl");
      assert.equal(exportedLayout.layout_type ?? "agentvn", skin);
      assert.equal(manifest.runtime_version, "0.18.0");
      for (const source of [scriptFile, layoutFile, manifestFile]) {
        const preserved = path.join(output, `${skin}-${path.basename(source)}`);
        fs.copyFileSync(source, preserved, fs.constants.COPYFILE_EXCL);
        report.artifacts.push({ ...artifact(preserved), origin: source });
      }
      const packed = await packageExport(previewRoot, path.join(output, `${skin}-actual-export.vncart`));
      report.artifacts.push(packed);
      report.players ??= [];
      report.players.push({ ...playerRecord, skin, previewRoot, executable: artifact(playerRecord.ExecutablePath) });
      save();
      playerBrowser = await connect(playerPort,
        () => processes().some(p => p.ProcessId === playerRecord.ProcessId));
      checkPortOwnership(playerPort, playerRecord.ProcessId);
      player = playerBrowser.contexts()[0].pages()[0];
      player.setDefaultTimeout(15000);
      player.on("pageerror", error => nativeErrors.push(String(error)));
      await player.getByTestId("game-state-title").waitFor({ timeout: 60000 });
      await player.locator(".boot-overlay").waitFor({ state: "detached", timeout: 60000 });
      const launchConfig = await native(player, "get_launch_config");
      assert.equal(launchConfig.mode, "preview");
      assert.equal(path.resolve(launchConfig.previewRoot), path.resolve(previewRoot));
      // Never write preview_gamecli saves: that ID belongs to real previews.
      const externalCdp = await player.context().newCDPSession(player);
      await externalCdp.send("Emulation.setDeviceMetricsOverride",
        { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
      await player.getByTestId("start-new-game").click();
      await line(player, "工程默认气泡", "bubble");
      const external = { skin, status: "PASS", projectDefault: await geometry(player) };
      await advance(player);
      await line(player, "角色默认 NVL 第一行", "nvl");
      external.roleDefault = await geometry(player);
      report.externalPreviews ??= [];
      report.externalPreviews.push(external); save();
      await externalCdp.detach();
      await editor.locator('[data-help-key="preview.close"]').click();
      await editor.waitForFunction(() => document.querySelector("[data-testid='preview-window-status']")
        ?.textContent.includes("已关闭"));
      assert(!processes().some(p => p.ProcessId === playerRecord.ProcessId), "External preview not closed");
      await playerBrowser.close().catch(() => {}); playerBrowser = undefined; player = undefined;
      standalone = spawn(playerRecord.ExecutablePath, ["--mode", "library"], {
        cwd: output, windowsHide: true, stdio: "ignore", env: { ...process.env,
          WEBVIEW2_USER_DATA_FOLDER: path.join(output, `player-webview-${skin}`),
          WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${playerPort}` },
      });
      ownedPlayers.add(standalone.pid);
      playerBrowser = await connect(playerPort, () => standalone.exitCode === null);
      checkPortOwnership(playerPort, standalone.pid);
      player = playerBrowser.contexts()[0].pages()[0];
      player.setDefaultTimeout(15000);
      player.on("pageerror", error => nativeErrors.push(String(error)));
      await player.getByTestId("game-state-library").waitFor({ timeout: 60000 });
      if (!baselineLibrary) baselineLibrary = await native(player, "list_installed_cartridges");
      const installId = `owned-dialog-${skin}-${crypto.randomUUID()}`;
      assert(!baselineLibrary.some(record => record.installId === installId));
      testInstalls.add(installId);
      const now = new Date().toISOString();
      const installed = await native(player, "import_cartridge_from_path", { sourcePath: packed.path,
        record: { installId, gameId: fixture.project_id, title: fixture.title, author: "QA",
          version: "1.0.0", language: "zh-CN", description: "Owned native dialogue acceptance",
          coverAssetId: null, sourceFileName: path.basename(packed.path), installedAt: now,
          updatedAt: now, cartridgePath: "" } });
      report.installs ??= [];
      report.installs.push(installed); save();
      await player.getByRole("button", { name: "刷新", exact: true }).click();
      await player.locator(".cartridge-spine").filter({ hasText: fixture.title }).click();
      await player.locator(".launch-panel").getByRole("button", { name: "启动卡带", exact: true }).click();
      await player.getByTestId("game-state-title").waitFor({ timeout: 60000 });
      await settled(player);
      const cdp = await player.context().newCDPSession(player);
      for (const dpr of [1, 2]) for (const reduced of [false, true]) for (const [width, height] of widths) {
        const row = { skin, width, height, dpr, reduced, status: "RUNNING" };
        report.cases.push(row); save();
        await cdp.send("Emulation.setDeviceMetricsOverride",
          { width, height, deviceScaleFactor: dpr, mobile: false });
        await cdp.send("Emulation.setEmulatedMedia",
          { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
        if (await player.getByTestId("game-state-playing").count()) {
          await player.keyboard.press("Escape");
          await player.getByTestId("main-menu").waitFor();
          await settled(player);
        }
        await player.getByTestId("start-new-game").click();
        if (await player.getByRole("dialog").count()) {
          await player.getByRole("dialog").getByRole("button", { name: /确认|开始/ }).last().click();
        }
        await line(player, "工程默认气泡", "bubble");
        row.projectDefault = await geometry(player);
        assert.equal(row.projectDefault.viewport.width, width);
        assert.equal(row.projectDefault.viewport.height, height);
        assert.equal(row.projectDefault.viewport.dpr, dpr);
        await advance(player);
        await line(player, "角色默认 NVL 第一行", "nvl");
        await advance(player, "pointer");
        await line(player, "角色默认 NVL 第二行", "nvl");
        row.nvl = await player.locator(".nvl-page .nvl-page-line").allTextContents();
        assert.equal(row.nvl.length, 2, "NVL must accumulate exactly two authored lines");
        assert(row.nvl[0].includes("第一行") && row.nvl[1].includes("第二行"));
        await openSave(player, skin);
        const beforeSave = await native(player, "read_save", { installId, kind: "manual", slot: 1 });
        await player.getByTestId("save-slot-manual-1").locator(".save-card-main").click();
        await waitForAsyncFunction(player, async ({ installId, previousId }) => {
          const current = await window.__TAURI_INTERNALS__.invoke("read_save",
            { installId, kind: "manual", slot: 1 });
          return current?.save_id && current.save_id !== previousId;
        }, { installId, previousId: beforeSave?.save_id });
        await player.getByTestId("save-slot-manual-1").locator(".save-card-copy small").waitFor();
        const actualSave = await native(player, "read_save", { installId, kind: "manual", slot: 1 });
        assert(actualSave?.save_id && actualSave.save_id !== beforeSave?.save_id,
          "Native disk save must be this operation's new snapshot, not the previous matching slot");
        assert.equal(actualSave.nvl_presentation_mode, "nvl");
        assert.equal(actualSave.nvl_page.length, 2, "Native disk save must contain both NVL lines");
        const saveFile = path.resolve(path.dirname(installed.cartridgePath),
          "../../saves", installId, "slot-01.json");
        assert(fs.existsSync(saveFile), `Actual native save file missing: ${saveFile}`);
        row.saveArtifact = artifact(saveFile);
        await closeSave(player, skin);
        await line(player, "角色默认 NVL 第二行", "nvl");
        assert.deepEqual(await player.locator(".nvl-page .nvl-page-line").allTextContents(), row.nvl,
          "Opening and closing player menus must not clear or duplicate NVL");
        await advance(player);
        await line(player, "显式清页后的第三行", "nvl");
        assert.equal(await player.locator(".nvl-page .nvl-page-line").count(), 1, "Explicit NVL clear must reset page");
        await openSave(player, skin);
        await player.getByRole("button", { name: "读取", exact: true }).click();
        await player.getByRole("button", { name: "读取手动存档 1", exact: true }).click();
        await line(player, "角色默认 NVL 第二行", "nvl");
        assert.deepEqual(await player.locator(".nvl-page .nvl-page-line").allTextContents(), row.nvl,
          "Real native save/load must restore NVL without duplicate lines");
        await advance(player);
        await line(player, "显式清页后的第三行", "nvl");
        await advance(player);
        await line(player, "节点显式普通对白", "dialog");
        assert.equal(await player.locator(".nvl-page").count(), 0);
        row.explicitDialog = await geometry(player);
        await advance(player);
        await line(player, "节点显式固定气泡", "bubble");
        row.fixedBubble = await geometry(player);
        assert.equal(row.fixedBubble.anchor, "fixed");
        await player.locator(".dialog-box").press("PageUp");
        await line(player, "节点显式普通对白", "dialog");
        await player.locator(".dialog-box").press("PageDown");
        await line(player, "节点显式固定气泡", "bubble");
        assert.equal((await geometry(player)).anchor, "fixed", "Roll-forward must restore fixed bubble");
        if (width === 1920 && dpr === 1 && !reduced) {
          await advance(player);
          await line(player, "01  原生分页", "bubble");
          const dialog = player.locator(".dialog-box"), fragments = [];
          row.longBubble = { pages: 0, fragments };
          const pages = Number(await dialog.getAttribute("data-dialog-pages"));
          row.longBubble.pages = pages;
          assert(pages > 1, "Long native bubble fixture must exercise fragment pagination");
          for (let index = 1; index <= pages; index++) {
            await player.waitForFunction(index => {
              const box = document.querySelector(".dialog-box");
              return Number(box?.dataset.dialogPage) === index && box?.dataset.dialogPageDone === "true";
            }, index, { timeout: 60000 });
            fragments.push(await player.locator(".dialog-text").textContent());
            save();
            await geometry(player);
            const font = await player.locator(".dialog-text").evaluate(node =>
              Number.parseFloat(getComputedStyle(node).fontSize));
            assert(font >= 12, "Native long bubble must respect the readable font floor");
            if (index < pages) {
              await advance(player, index % 2 ? "pointer" : "Enter");
            }
          }
          assert.equal(fragments.join(""), longBubble, "Native pagination must preserve every authored character");
          row.longBubble = { pages, fragments };
        }
        assert.deepEqual(nativeErrors, [], "Actual native player must not emit frontend exceptions");
        row.status = "PASS"; save();
        console.log(`PASS ${skin} ${width}x${height} DPR${dpr} ${reduced ? "reduced" : "normal"}`);
        if (width === 1920 && dpr === 1 && !reduced)
          await player.screenshot({ path: path.join(output, `${skin}-native-paginated-bubble.png`) });
      }
      await cdp.detach();
      await native(player, "remove_installed_cartridge", { installId, deleteSaves: true });
      testInstalls.delete(installId);
      assert(!fs.existsSync(path.dirname(installed.cartridgePath)), "Owned installed test cartridge remains");
      assert.deepEqual(await native(player, "list_installed_cartridges"), baselineLibrary,
        "Native test must preserve pre-existing user library records");
      report.userLibraryUnchanged = true;
      stop(standalone.pid);
      await playerBrowser.close().catch(() => {}); playerBrowser = undefined; player = undefined;
      await editor.locator('[data-workspace-surface="edit"]:visible').click();
    }
    assert.equal(report.cases.length, 24, "Nonempty complete two-skin native viewport matrix required");
    assert(report.cases.every(row => row.status === "PASS"));
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    console.error(report.error);
    if (player && !player.isClosed()) {
      report.failureState = await player.locator("body").innerText().catch(() => "");
      report.failureDialog = await player.locator(".dialog-box").evaluate(node => ({
        label: node.getAttribute("aria-label"), page: node.dataset.dialogPage,
        pages: node.dataset.dialogPages, done: node.dataset.dialogPageDone,
      })).catch(() => null);
      await player.screenshot({ path: path.join(output, "player-failure.png") }).catch(() => {});
    }
    if (editor && !editor.isClosed())
      await editor.screenshot({ path: path.join(output, "editor-failure.png") }).catch(() => {});
  } finally {
    report.installCleanup = { pending: [...testInstalls], error: null };
    if (testInstalls.size && player && !player.isClosed()) {
      try {
        for (const installId of [...testInstalls]) {
          await native(player, "remove_installed_cartridge", { installId, deleteSaves: true });
          testInstalls.delete(installId);
        }
      } catch (error) { report.installCleanup.error = String(error); }
    }
    if (baselineLibrary && player && !player.isClosed()) {
      try {
        assert.deepEqual(await native(player, "list_installed_cartridges"), baselineLibrary,
          "Native test must preserve all pre-existing library records");
        report.installCleanup.userLibraryUnchanged = true;
      } catch (error) { report.installCleanup.error = String(error); }
    }
    report.installCleanup.pending = [...testInstalls];
    if (testInstalls.size || report.installCleanup.error) { report.status = "FAILED"; process.exitCode = 1; }
    if (editor && !editor.isClosed()) await native(editor, "close_gamecli_preview").catch(() => {});
    const beforeCleanup = processes();
    for (const process of beforeCleanup)
      if (host && process.ParentProcessId === host.pid) ownedPlayers.add(process.ProcessId);
    for (const pid of ownedPlayers) stop(pid);
    stop(host?.pid); stop(backend?.pid);
    await vite?.stop();
    await playerBrowser?.close().catch(() => {});
    await browser?.close().catch(() => {});
    report.cleanup = { remaining: processes().filter(p =>
      p.ProcessId === host?.pid || ownedPlayers.has(p.ProcessId)) };
    if (report.cleanup.remaining.length) { report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(`Evidence: ${output}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
