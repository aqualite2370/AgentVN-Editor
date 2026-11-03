"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const crypto = require("node:crypto"), JSZip = require("../editor/node_modules/jszip");
const { execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, assetBytes, dismissEnvironmentCompletion, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-assets-20261018-01";
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const [phase, destination] = process.argv.slice(2);
assert(["seed", "open", "replace", "negative", "matrix", "save", "reopen", "import-saved", "cartridge", "preview", "close"].includes(phase) && destination && !fs.existsSync(destination));
const attempt = Number(process.argv[4] || 2); assert([2, 3].includes(attempt));
const launch = read(path.join(run, `launch-${String(attempt).padStart(2, "0")}.json`)), fixture = read(path.join(run, "fixtures.json"));
const report = { status: "RUNNING", phase, at: new Date().toISOString(), checks: [], screenshots: [], error: null,
  scope: "ACTUAL_INSTALLED_1.9.9_UI_WITH_EXPLICIT_API_FIXTURE_SETUP_NOT_NATIVE_IMPORT_ACCEPTANCE",
  fixtureSetup: "Local packaged backend raw import endpoint; native picker blocked by Computer Use geometry, not claimed tested",
  realModelRequests: 0, nativeImportStatus: "BLOCKED_TOOL_GEOMETRY", cases: [] };
fs.mkdirSync(destination);
let browser, playerBrowser, page, cdp, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
function check(name, condition, detail) {
  report.checks.push({ name, status: condition ? "PASS" : "FAILED", detail });
  assert(condition, name);
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected));
}
async function snapshot() {
  // Read-only observability; all authoring mutations below go through actual UI.
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), graph = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary, nodes: graph.nodes, edges: graph.edges };
  });
}
async function library() {
  const publishClose = page.locator('[data-help-key="package.close"]');
  if (await publishClose.isVisible()) { await publishClose.click(); await publishClose.waitFor({ state: "hidden" }); }
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click();
  await settleEditor(page);
  await page.getByRole("button", { name: /原文件夹/ }).first().click();
  await page.locator('.asset-library-card[data-asset-id="qa_background"]').waitFor();
}
async function choose(row, file) {
  const card = page.locator(`.asset-library-card[data-asset-id="${row.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
  await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(file);
}
async function dimensions(locator) {
  return locator.evaluate(node => {
    const r = node.getBoundingClientRect();
    const controls = [...node.querySelectorAll("button")].filter(b => b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && !b.disabled && b.getBoundingClientRect().width > 0).map(b => {
      const q = b.getBoundingClientRect(), hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
      const withinPanel = q.top >= r.top && q.bottom <= r.bottom;
      return { text: b.textContent, rect: q.toJSON(), withinPanel,
        hit: !!hit && (hit === b || b.contains(hit)),
        insideViewport: q.left >= 0 && q.top >= 0 && q.right <= innerWidth + 1 && q.bottom <= innerHeight + 1 };
    });
    return { rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth, controls };
  });
}
async function verifyAssets(state, version) {
  assert.equal(state.id, fixture.projectId);
  assert.equal(state.assets.length, 11);
  const results = [];
  for (const row of fixture.types) {
    const a = state.assets.find(a => a.asset_id === row.id);
    assert(a); assert.equal(a.asset_type, row.type); assert.equal(a.metadata.display_name, `${row.type}保留名称`);
    const bytes = await assetBytes(launch.backendPort, a);
    assert.equal(sha(bytes), row.files[version].sha256);
    results.push({ type: row.type, id: row.id, sha256: sha(bytes), metadata: {
      filename: a.metadata.filename, width: a.metadata.width, height: a.metadata.height, duration_ms: a.metadata.duration_ms } });
  }
  return results;
}
(async () => {
  assert.equal(sha(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  if (phase === "seed") {
    // Isolated fixture preparation only, kept separate from real UI assertions.
    const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    report.seedStatus = response.status; const body = await response.json();
    assert(response.ok && body.ok && body.data?.project_id === fixture.projectId);
    report.seed = { projectId: body.data.project_id, assets: body.data.asset_manifest.length, inputSha256: fixture.inputSha256 };
    check("Explicit controlled fixture persisted in isolated packaged backend", body.data.asset_manifest.length === 11, report.seed);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(20000); cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (phase === "import-saved") {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
    const saved = read(path.join(run, "save-01/report.json")).package;
    assert.equal(sha(fs.readFileSync(saved.retained)), saved.sha256);
    const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(saved.retained)) },
      body: fs.readFileSync(saved.retained), signal: AbortSignal.timeout(30000) });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === fixture.projectId);
    report.portableImport = { method: "CONTROLLED_REAL_PACKAGED_BACKEND_ENDPOINT_NOT_NATIVE_PICKER", input: saved.retained, sha256: saved.sha256 };
  }
  if (["seed", "open", "reopen", "import-saved"].includes(phase)) {
    if (phase === "seed" || phase === "import-saved") await page.reload();
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: "安装版全类型素材替换验收_20261018" }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    await library();
    const state = await snapshot();
    report.assets = await verifyAssets(state, ["reopen", "import-saved"].includes(phase) ? "new" : "old");
    check("Actual recent-project click loads all eleven exact media bytes", report.assets.length === 11, report.assets);
    await shot(phase);
    return;
  }
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  if (phase === "cartridge") {
    await dismissEnvironmentCompletion(page);
    if (!(await page.locator('[data-help-key="package.mode"]').isVisible()))
      await page.locator('[data-workspace-surface="publish"]:visible').click();
    await settleEditor(page);
    await dismissEnvironmentCompletion(page);
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await warnings.click();
    const confirmation = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await confirmation.isVisible()) await confirmation.check();
    const output = path.join(path.dirname(fixture.input), "cartridge-export");
    assert(!fs.existsSync(output)); fs.mkdirSync(output);
    report.cartridge = await realDownload(page, cdp, output, page.locator('[data-help-key="package.export"]'));
    const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path)), manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.game_id, fixture.projectId);
    report.cartridge.assets = [];
    for (const row of fixture.types) {
      const entry = manifest.assets.find(a => a.asset_id === row.id); assert(entry);
      const bytes = await zip.file(entry.path).async("nodebuffer"); assert.equal(sha(bytes), row.files.new.sha256);
      assert.notEqual(sha(bytes), row.files.old.sha256);
      report.cartridge.assets.push({ id: row.id, path: entry.path, sha256: sha(bytes) });
    }
    check("Actual installed publish UI downloads cartridge with all eleven upgraded payloads", report.cartridge.assets.length === 11, report.cartridge);
    await shot("cartridge-exported");
    return;
  }
  await library(); const before = await snapshot(); assert.equal(before.id, fixture.projectId);
  if (phase === "close") {
    report.assets = await verifyAssets(before, "new");
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
    report.closeMethod = "REAL_NATIVE_TAURI_WINDOW_CLOSE_COMMAND_NOT_COMPUTER_USE_PHYSICAL_INPUT";
    report.closeRequestedAt = new Date().toISOString();
    try { await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|close", { label: "main" })); }
    catch (error) {
      if (!/closed|destroyed/i.test(String(error))) throw error;
      report.closeConnectionResult = String(error);
    }
    check("Requested actual native window close after persisting QA project through real homepage", true,
      { method: report.closeMethod, physicalCloseAcceptance: "NOT_RUN_TOOL_UNAVAILABLE" });
    return;
  }
  if (phase === "negative") {
    for (const [type, extension, mime, bytes] of [
      ["bgm", "wav", "audio/wav", Buffer.from("invalid audio")],
      ["video", "webm", "video/webm", Buffer.from("invalid video")],
      ["animation", "json", "application/json", Buffer.from("{invalid-json")],
      ["font", "ttf", "font/ttf", Buffer.alloc(0)],
    ]) {
      const row = fixture.types.find(r => r.type === type), item = { type, status: "RUNNING" }; report.cases.push(item);
      await choose(row, { name: `损坏或空文件.${extension}`, mimeType: mime, buffer: bytes });
      const error = page.locator(".asset-library-panel [role=alert]").filter({ hasText: "原素材未改变" });
      await error.waitFor({ timeout: 15000 }); item.errorText = await error.innerText();
      assert.deepEqual(await snapshot(), before);
      assert.equal(await page.getByRole("dialog", { name: "确认替换素材" }).count(), 0);
      item.status = "PASS";
    }
    check("Corrupt audio/video/JSON and empty font leave all upgraded bytes intact", report.cases.length === 4 && report.cases.every(c => c.status === "PASS"));
    await shot("corrupt-media-rejected");
    return;
  }
  if (phase === "replace") {
    report.initial = await verifyAssets(before, "old");
    const row = fixture.types[0], original = JSON.stringify(before);
    await choose(row, row.files.new.path);
    const dialog = page.getByRole("dialog", { name: "确认替换素材" });
    await dialog.getByText(/授权和生成来源说明不会沿用/).waitFor();
    const geo = await dimensions(dialog);
    check("Confirmation actions visible, bounded and hit-testable", geo.overflow <= 1 && geo.controls.length >= 2
      && geo.controls.every(c => c.hit && c.insideViewport), geo);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    check("Cancel leaves all asset identities, references, folders and bytes unchanged", JSON.stringify(await snapshot()) === original);
    await choose(row, { name: "错误音频.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid") });
    await page.locator(".asset-library-panel [role=alert]").filter({ hasText: "不兼容" }).waitFor();
    check("Incompatible media is rejected without any mutation", JSON.stringify(await snapshot()) === original);
    await choose(row, { name: "损坏图片.svg", mimeType: "image/svg+xml", buffer: Buffer.from("invalid") });
    await page.locator(".asset-library-panel [role=alert]").filter({ hasText: "原素材未改变" }).waitFor();
    check("Corrupt image is rejected without any mutation", JSON.stringify(await snapshot()) === original);
    for (const row of fixture.types) {
      const item = { type: row.type, status: "RUNNING" }; report.cases.push(item);
      try {
        await choose(row, row.files.new.path);
        await dialog.getByText(new RegExp(path.basename(row.files.new.path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).waitFor();
        await dialog.getByRole("button", { name: "确认替换", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        const after = await snapshot(), a = after.assets.find(a => a.asset_id === row.id);
        assert.equal(a.asset_type, row.type); assert.equal(a.metadata.display_name, `${row.type}保留名称`);
        assert.equal(a.metadata.filename, path.basename(row.files.new.path));
        assert.equal(sha(await assetBytes(launch.backendPort, a)), row.files.new.sha256);
        assert.deepEqual(after.folders, before.folders); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.edges, before.edges);
        for (const field of ["hash_sha256", "provider_id", "model", "prompt", "generation", "license_note", "backend_asset_path", "filePath", "url", "bytes", "path", "placeholder"])
          assert.equal(a.metadata[field], undefined, `${row.type}: stale ${field}`);
        assert.equal(a.metadata.source, "imported"); assert.deepEqual(a.metadata.tags, ["qa-identity"]);
        assert.equal(a.metadata.created_at, "2026-10-01T00:00:00Z");
        if (["background", "sprite", "portrait", "ui", "other"].includes(row.type))
          assert.deepEqual([a.metadata.width, a.metadata.height], [900, 600]);
        if (["bgm", "sfx", "voice"].includes(row.type)) assert(Math.abs(a.metadata.duration_ms - 800) < 40);
        if (row.type === "video") assert.deepEqual([a.metadata.width, a.metadata.height], [480, 270]);
        item.status = "PASS"; item.metadata = a.metadata;
        // Avoid retaining duplicate megabytes of inline media in the small evidence report.
        for (const field of ["data_url", "blob_url"]) delete item.metadata[field];
        item.sha256 = row.files.new.sha256;
      } catch (error) { item.status = "FAILED"; item.error = String(error.stack || error); throw error; }
    }
    report.final = await verifyAssets(await snapshot(), "new");
    check("All supported eleven asset types replaced through actual installed UI", report.cases.length === 11 && report.cases.every(c => c.status === "PASS"));
    await shot("all-types-replaced");
    return;
  }
  if (phase === "matrix") {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      expected = { width, height, dpr, reduced }; const item = { ...expected, status: "RUNNING" }; report.cases.push(item);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await readInstalledViewport(page, expected);
      await choose(fixture.types[0], fixture.types[0].files.new.path);
      const dialog = page.getByRole("dialog", { name: "确认替换素材" }); await dialog.waitFor();
      item.geometry = await dimensions(dialog);
      assert(item.geometry.overflow <= 1 && item.geometry.controls.length >= 2
        && item.geometry.controls.every(c => c.hit && c.insideViewport));
      await shot(`${width}-${dpr}-${reduced}-confirmation`);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      assert.deepEqual(await snapshot(), before, "Repeated cancellation must not mutate already upgraded resources");
      const card = page.locator('.asset-library-card[data-asset-id="qa_background"]'); await card.scrollIntoViewIfNeeded();
      const geometry = await dimensions(page.locator(".asset-library-panel"));
      assert(geometry.overflow <= 1 && geometry.rect.left >= 0 && geometry.rect.right <= width + 1);
      item.libraryGeometry = geometry; item.status = "PASS";
    }
    check("Nonempty full twelve-combination actual WebView cancellation/confirmation matrix", report.cases.length === 12 && report.cases.every(c => c.status === "PASS"));
    return;
  }
  if (phase === "save") {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const downloads = "C:/Users/1/Downloads", previous = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const success = page.getByTestId("project-save-confirmation"); await success.waitFor({ timeout: 60000 });
    report.saveText = await success.innerText();
    const files = fs.readdirSync(downloads).filter(f => !previous.has(f) && f.includes("安装版全类型素材替换验收_20261018") && f.endsWith(".vnproj"));
    assert.equal(files.length, 1, "Exactly one new native project package expected");
    const saved = path.join(downloads, files[0]), copy = path.join(fixture.input, "..", "替换后保存包.vnproj");
    fs.copyFileSync(saved, copy, fs.constants.COPYFILE_EXCL);
    const zip = await JSZip.loadAsync(fs.readFileSync(copy)), project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.project_id, fixture.projectId);
    report.package = { native: saved, retained: copy, sha256: sha(fs.readFileSync(copy)), bytes: fs.statSync(copy).size, assets: [] };
    for (const row of fixture.types) {
      const a = project.asset_manifest.find(a => a.asset_id === row.id); assert(a);
      const bytes = await zip.file(a.metadata.project_path).async("nodebuffer");
      assert.equal(sha(bytes), row.files.new.sha256); assert.notEqual(sha(bytes), row.files.old.sha256);
      report.package.assets.push({ id: row.id, path: a.metadata.project_path, sha256: sha(bytes) });
    }
    check("Native saved portable package contains new actual bytes for all eleven types", report.package.assets.length === 11, report.package);
    await success.getByRole("button", { name: "OK", exact: true }).click();
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page);
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: "安装版全类型素材替换验收_20261018" }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await library();
    report.reopened = await verifyAssets(await snapshot(), "new");
    check("Real homepage return and reopen retains all upgraded bytes", report.reopened.length === 11);
    await shot("saved-reopened");
    return;
  }
  if (phase === "preview") {
    await page.locator('[data-workspace-surface="preview"]:visible').click();
    await page.getByTestId("preview-launch-panel").waitFor(); await settleEditor(page);
    if (!(await page.getByTestId("preview-window-status").innerText()).includes("运行中"))
      await page.locator('[data-help-key="preview.open"]').click();
    await page.getByTestId("preview-window-status").filter({ hasText: "运行中" }).waitFor({ timeout: 60000 });
    const processRows = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command",
      "@(Get-CimInstance Win32_Process -Filter \"Name='agentvn-player.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)|ConvertTo-Json -Depth 4"],
    { encoding: "utf8", windowsHide: true }).replace(/^\uFEFF/, ""));
    const processes = Array.isArray(processRows) ? processRows : [processRows];
    assert.equal(processes.length, 1); const process = processes[0];
    assert.equal(process.ParentProcessId, launch.editorPid);
    assert.equal(process.ExecutablePath.toLowerCase(), path.join(launch.installRoot, "agentvn-player.exe").toLowerCase());
    report.player = { ...process, sha256: sha(fs.readFileSync(process.ExecutablePath)) };
    const rootMatch = process.CommandLine.match(/--preview-root\s+(?:"([^"]+)"|(\S+))/); assert(rootMatch);
    const previewRoot = rootMatch[1] || rootMatch[2], manifest = read(path.join(previewRoot, "manifest.json"));
    assert.equal(manifest.game_id, fixture.projectId);
    report.previewExport = { root: previewRoot, manifestSha256: sha(fs.readFileSync(path.join(previewRoot, "manifest.json"))), assets: [] };
    for (const row of fixture.types) {
      const entry = manifest.assets.find(a => a.asset_id === row.id); assert(entry);
      const bytes = fs.readFileSync(path.join(previewRoot, entry.path)); assert.equal(sha(bytes), row.files.new.sha256);
      report.previewExport.assets.push({ id: row.id, path: entry.path, sha256: sha(bytes) });
    }
    check("Actual installed native preview export contains all eleven new media bytes", report.previewExport.assets.length === 11);
    const deadline = Date.now() + 30000; let debuggerReady = false;
    while (Date.now() < deadline) {
      try { debuggerReady = (await fetch(`http://127.0.0.1:${launch.playerCdpPort}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (debuggerReady) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(debuggerReady, "Actual owned player's debugger did not become ready");
    playerBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.playerCdpPort}`);
    const game = playerBrowser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(game);
    const gameCdp = await game.context().newCDPSession(game);
    await gameCdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    if (!(await game.getByTestId("game-state-playing").isVisible())) {
      await game.getByTestId("start-new-game").waitFor(); await game.locator(".boot-overlay").waitFor({ state: "detached" });
      await game.getByTestId("start-new-game").click();
    }
    await game.locator(".dialog-box").filter({ hasText: "全类型素材替换独立工程" }).waitFor({ timeout: 30000 });
    const rendered = await game.evaluate(async () => {
      const element = document.querySelector(".background-transition-frame.is-current");
      if (!element) return null;
      const style = getComputedStyle(element), match = style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/);
      if (!match || Number(style.opacity) < .99) return null;
      const image = new Image(); image.src = match[1]; await image.decode();
      return { src: match[1], width: image.naturalWidth, height: image.naturalHeight,
        rect: element.getBoundingClientRect().toJSON(),
        bytes: Array.from(new Uint8Array(await (await fetch(match[1])).arrayBuffer())) };
    });
    check("Actual installed external player consumes upgraded background bytes and dimensions", !!rendered
      && rendered.width === 900 && rendered.height === 600 && rendered.rect.width > 0
      && sha(Buffer.from(rendered.bytes)) === fixture.types[0].files.new.sha256,
      rendered && { src: rendered.src, width: rendered.width, height: rendered.height, sha256: sha(Buffer.from(rendered.bytes)) });
    report.screenshots.push(await captureInstalledWebview(game, gameCdp, path.join(destination, "actual-player-upgraded.png"), expected));
    await page.locator('[data-help-key="preview.close"]').click();
    await page.getByTestId("preview-window-status").filter({ hasText: "已关闭" }).waitFor();
  }
})().then(() => { report.status = "PASS"; }).catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error);
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => "Unavailable"); await shot("failure").catch(() => {}); }
  process.exitCode = 1;
}).finally(async () => {
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  await playerBrowser?.close(); await browser?.close();
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length, cases: report.cases.length, error: report.error, destination }, null, 2));
});
