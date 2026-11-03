"use strict";
// Current frozen, actually installed Release; no model calls or application writes via stores.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), JSZip = require("../editor/node_modules/jszip");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, assetBytes, dismissEnvironmentCompletion, realDownload } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const importedSession = process.env.AGENTVN_COMPONENTS_SESSION === "import-use";
const run = importedSession ? "D:/AgentVN/output/installed-components-use-20261018-01" : "D:/AgentVN/output/installed-components-20261018-01";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const [phase, destination] = process.argv.slice(2), attempt = Number(process.argv[4] || 1);
assert(["author", "import-use", "finish", "reopen", "export"].includes(phase) && destination && !fs.existsSync(destination));
const launch = read(path.join(run, `launch${attempt === 1 ? "" : `-${String(attempt).padStart(2, "0")}`}.json`));
const fixture = read(path.join(run, "fixtures.json"));
const names = ["分享关于双图卡", "分享帮助双图卡"];
const report = { status: "RUNNING", phase, at: new Date().toISOString(), checks: [], screenshots: [], cases: [], matrix: [],
  realModelRequests: 0, errors: [], error: null,
  scope: "ACTUAL_INSTALLED_RELEASE_COMPONENT_LIBRARY_UI; explicit backend fixture seed, no native project picker claim",
  environment: { AGENTVN_TEST_PROJECT: process.env.AGENTVN_TEST_PROJECT, AGENTVN_WORKSPACE_OUTPUT: process.env.AGENTVN_WORKSPACE_OUTPUT } };
fs.mkdirSync(destination); let browser, page, cdp, library;
let expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
function check(name, ok, detail) { report.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); assert(ok, name); }
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected)); }
async function snapshot() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, settings: p.settings, assets: p.assetManifest, nodes: g.nodes, edges: g.edges };
  });
}
async function sameProjectContent(actual, before) {
  const normalized = value => {
    const copy = structuredClone(value);
    for (const asset of copy.assets) {
      // These fields are mutually exclusive transport representations. All
      // remaining metadata and decoded bytes below stay strict.
      for (const field of ["data_url", "blob_url", "backend_asset_path", "filePath", "url"]) delete asset.metadata[field];
    }
    return copy;
  };
  assert.deepEqual(normalized(actual), normalized(before));
  for (const asset of actual.assets) {
    const old = before.assets.find(a => a.asset_id === asset.asset_id); assert(old);
    assert.equal(sha(await assetBytes(8278, asset)), sha(await assetBytes(8278, old)));
  }
}
async function records() {
  return page.evaluate(async () => {
    // Read-only IndexedDB evidence; never writes test content behind the UI.
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("agentvn-personal-component-library");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const t = db.transaction("components", "readonly"), r = t.objectStore("components").getAll();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    }); db.close();
    return Promise.all(rows.sort((a, b) => a.id.localeCompare(b.id)).map(async r => ({
      id: r.id, name: r.name, html: r.html, css: r.css, definition: r.definition, createdAt: r.createdAt, updatedAt: r.updatedAt,
      assets: await Promise.all((r.assets || []).map(async a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType,
        sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.bytes)))]
          .map(b => b.toString(16).padStart(2, "0")).join("") }))),
    })));
  });
}
async function openLibrary() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const switchButton = page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible');
  if (await switchButton.getAttribute("aria-pressed") !== "true") {
    await switchButton.click(); await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  }
  const details = page.locator("details.renpy-personal-component-library");
  if (!await details.evaluate(d => d.open)) await details.locator("summary").click();
  library = page.getByTestId("custom-component-library"); await library.waitFor();
}
async function geometry(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate(n => {
    const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const sidebar = n.closest(".runtime-layout-sidebar").getBoundingClientRect();
    return { rect: r.toJSON(), sidebar: sidebar.toJSON(), hit: n === hit || n.contains(hit),
      overflow: document.documentElement.scrollWidth - innerWidth,
      actual: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  });
}
async function scanFile(file, rejection) {
  await library.getByTestId("component-import-file").setInputFiles(file);
  await page.waitForFunction(rejection => {
    const library = document.querySelector('[data-testid="custom-component-library"]');
    const input = library?.querySelector('[data-testid="component-import-file"]');
    const text = library?.querySelector('[role="status"]')?.textContent || "";
    return input && !input.disabled && (rejection
      ? text.includes("组件包未通过检查") && text.includes(rejection)
      : text.includes("扫描通过") && library.querySelector('[data-testid="component-confirm-import"]'));
  }, rejection || null);
}
async function verifyExport() {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
  const completion = page.getByRole("dialog").filter({ hasText: "环境检测已完成" });
  // Initial publish starts asynchronous environment detection. Follow its real
  // completion UI rather than a fixed wait or clicking through its backdrop.
  const anyEnvironment = page.locator(".android-env-import-backdrop");
  if (await anyEnvironment.isVisible()) await completion.waitFor({ timeout: 60000 });
  await dismissEnvironmentCompletion(page);
  await page.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await warning.click();
  const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
  const out = path.join(path.dirname(fixture.input), "cartridge-export"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  report.cartridge = await realDownload(page, cdp, out, page.locator('[data-help-key="package.export"]'));
  const zip = await JSZip.loadAsync(fs.readFileSync(report.cartridge.path));
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const source = read(path.join(run, "author-02/report.json"));
  const copies = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
  assert.deepEqual(copies, source.projectComponents); assert.equal(manifest.game_id, fixture.projectId);
  assert.equal(manifest.assets.length, 4); report.cartridge.assets = [];
  for (const asset of manifest.assets) {
    const bytes = await zip.file(asset.path).async("nodebuffer");
    assert(fixture.images.some(i => i.sha256 === sha(bytes)));
    report.cartridge.assets.push({ id: asset.asset_id, path: asset.path, sha256: sha(bytes) });
  }
  check("Real installed publish export preserves both component ASTs and all four mapped image dependencies", true, report.cartridge);
  await shot("actual-cartridge-export");
}
(async () => {
  assert.equal(report.environment.AGENTVN_TEST_PROJECT, fixture.input);
  assert.equal(report.environment.AGENTVN_WORKSPACE_OUTPUT, run);
  assert.equal(sha(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  if (phase === "author" || phase === "import-use") {
    const response = await fetch("http://127.0.0.1:8278/api/project/projects/import", { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
      body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === fixture.projectId);
    report.fixtureSeed = "CONTROLLED_REAL_PACKAGED_BACKEND_IMPORT_NOT_NATIVE_PICKER";
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); page.on("pageerror", e => report.errors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (phase !== "export") {
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await openLibrary();
  }
  if (phase === "export") { assert.equal((await snapshot()).id, fixture.projectId); await verifyExport(); report.status = "PASS"; return; }
  if (phase === "reopen") {
    const prior = read(path.join(run, "author-02/report.json")); assert.equal(prior.status, "PASS");
    const current = await snapshot();
    assert.equal(current.id, fixture.projectId); assert.deepEqual(await records(), prior.finalLibrary);
    assert.deepEqual(current.settings.runtimeUILayout, prior.finalProject.settings.runtimeUILayout);
    assert.deepEqual(current.settings.runtimeUILayoutProfiles, prior.finalProject.settings.runtimeUILayoutProfiles);
    // Previous evidence is JSON: absent optional properties and explicit
    // undefined are identical in the portable protocol, unlike deepEqual on
    // an in-memory object. Preserve every serializable node/edge field.
    assert.deepEqual(JSON.parse(JSON.stringify(current.nodes)), prior.finalProject.nodes);
    assert.deepEqual(JSON.parse(JSON.stringify(current.edges)), prior.finalProject.edges);
    assert.equal(current.assets.length, 4);
    for (const asset of current.assets) {
      const bytes = await assetBytes(8278, asset);
      assert(fixture.images.some(i => i.sha256 === sha(bytes)));
    }
    check("Actual process restart, homepage open and personal library retain project copies and exact image bytes", true,
      { library: prior.finalLibrary.length, assets: 4 });
    await shot("actual-restart-reopen"); report.status = "PASS"; return;
  }
  if (phase === "finish") {
    const priorFile = path.join(run, "author-01/report.json"), prior = read(priorFile);
    assert.equal(prior.status, "FAILED"); assert.equal(prior.checks.length, 7);
    assert(prior.checks.every(c => c.status === "PASS"));
    assert.equal(prior.cases.length, 11); assert(prior.cases.every(c => c.status === "PASS"));
    assert.equal(prior.matrix.length, 12);
    const current = await snapshot(); assert.equal(current.id, fixture.projectId);
    const copies = current.settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
      .filter(c => c.component_type === "custom_component");
    assert.deepEqual(copies, prior.projectComponents); assert.equal(current.assets.length, 4);
    for (const asset of current.assets) {
      const bytes = await assetBytes(8278, asset); assert(fixture.images.some(i => i.sha256 === sha(bytes)));
    }
    const libraryRecords = await records(); assert.equal(libraryRecords.length, 3);
    assert(!libraryRecords.some(r => r.name === names[0]));
    assert(libraryRecords.some(r => r.name === `${names[0]}（副本）`));
    check("After original deletion, exact project component ASTs, mapped bytes and remaining library copies are preserved", true,
      { projectComponents: copies.length, assets: current.assets.length, libraryRecords: libraryRecords.length });
    report.continuation = { from: priorFile, sha256: sha(fs.readFileSync(priorFile)),
      reason: "Retain original FAILED transport-representation oracle; only continue save, no repeated authoring/import",
      noProductChanges: true };
    report.projectComponents = copies; report.finalLibrary = libraryRecords;
    await saveProjectPackage(); report.status = "PASS"; return;
  }
  const baseline = await snapshot(); assert.equal(baseline.id, fixture.projectId);
  assert.equal((await records()).length, 0, "Fresh isolated Local profile must not contain user components");
  const agentvn = baseline.settings.runtimeUILayoutProfiles.profiles.agentvn;
  let imported;
  if (phase === "import-use") {
    assert(importedSession, "Imported-use flow requires its separate protected session");
    const original = read("D:/AgentVN/output/installed-components-20261018-01/author-01/report.json").archive;
    assert.equal(sha(fs.readFileSync(original.path)), original.sha256);
    await scanFile(original.path);
    assert.equal((await records()).length, 0, "Scan cannot write personal library");
    await library.getByTestId("component-confirm-import").click();
    await library.getByRole("status").filter({ hasText: /已将 2 个组件另存为本机副本/ }).waitFor();
    imported = await records(); assert.equal(imported.length, 2);
    const zip = await JSZip.loadAsync(fs.readFileSync(original.path));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    for (const r of imported) {
      const c = manifest.components.find(c => c.name === r.name); assert(c);
      assert.notEqual(r.id, c.id); assert.equal(r.html, c.html); assert.equal(r.css, c.css);
      assert.deepEqual(r.assets.map(a => a.sha256), c.assets.map(a => a.sha256));
    }
    assert.deepEqual(await snapshot(), baseline);
    report.sourceArchive = original;
    check("Real ZIP scan/confirm populates a fresh personal library with new IDs and exact shared definitions/dependencies", true, original);
  } else {
  await library.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles(fixture.images.map(i => i.path));
  await library.getByRole("status").filter({ hasText: /已添加 2 个图片依赖/ }).waitFor();
  const ids = await library.locator(".custom-component-dependencies code").allTextContents(); assert.equal(ids.length, 2);
  for (const [index, name] of names.entries()) {
    await library.getByLabel("组件名称", { exact: true }).fill(name);
    await library.getByLabel("组件 HTML", { exact: true }).fill(`<div class="root"><span class="title" data-bind="project.title">标题</span><img class="icon" data-asset="${ids[0]}" aria-label="${name}红图"/><img class="icon" data-asset="${ids[1]}" aria-label="${name}蓝图"/><button type="button" class="button" aria-label="分享组件${index === 0 ? "关于" : "帮助"}" data-action="${index === 0 ? "open_about" : "open_help"}">${index === 0 ? "关于" : "帮助"}</button></div>`);
    await library.getByLabel("组件 CSS", { exact: true }).fill(".root { display: flex; flex-direction: column; gap: 6px; padding: 8px; }.title { color: #ffffff; font-size: 18px; }.icon { width: 48px; height: 32px; object-fit: contain; }.button { color: #ffffff; background-color: #223344; padding: 8px 12px; border-radius: 4px; }");
    await library.getByTestId("component-save").click(); await library.getByRole("status").filter({ hasText: `“${name}”已保存` }).waitFor();
    await library.getByRole("checkbox", { name: `选择 ${name}`, exact: true }).check();
  }
  const originalRecords = await records(); assert.equal(originalRecords.length, 2);
  assert.deepEqual(await snapshot(), baseline);
  check("Two real authored personal components each retain two exact image dependencies without mutating project", originalRecords.every(r =>
    r.assets.length === 2 && r.assets.every(a => fixture.images.some(i => i.sha256 === a.sha256))));
  const downloadDir = path.join(path.dirname(fixture.input), "中文 分享 导出"); fs.mkdirSync(downloadDir);
  report.archive = await realDownload(page, cdp, downloadDir, library.getByTestId("component-export"));
  const archiveBytes = fs.readFileSync(report.archive.path), archiveZip = await JSZip.loadAsync(archiveBytes);
  const archiveManifest = JSON.parse(await archiveZip.file("manifest.json").async("string"));
  assert.deepEqual(Object.keys(archiveManifest).sort(), ["components", "format", "schemaVersion"]);
  assert.equal(archiveManifest.components.length, 2);
  for (const c of archiveManifest.components) {
    assert.equal(c.assets.length, 2); assert(!("project_id" in c) && !("conversation_id" in c));
    for (const a of c.assets) assert.equal(sha(await archiveZip.file(a.path).async("nodebuffer")), a.sha256);
  }
  check("Actual multi-selection ZIP export contains two components and four checked dependencies, no session/project credentials", true, report.archive);
  await scanFile(report.archive.path);
  await library.getByRole("region", { name: "导入预览" }).locator("img").first().waitFor();
  assert.deepEqual(await records(), originalRecords);
  await library.getByTestId("component-import-file").setInputFiles([]);
  await library.getByTestId("component-confirm-import").waitFor({ state: "hidden" });
  assert.deepEqual(await records(), originalRecords); assert.deepEqual(await snapshot(), baseline);
  check("Scan alone and cleared selection/cancel preserve personal library and project", true,
    { cancellationScope: "Real DOM file input cleared; not OS-native picker cancellation" });
  await scanFile(report.archive.path);
  await library.getByTestId("component-confirm-import").click();
  await library.getByRole("status").filter({ hasText: /已将 2 个组件另存为本机副本/ }).waitFor();
  imported = await records(); assert.equal(imported.length, 4);
  for (const r of originalRecords) assert.deepEqual(imported.find(i => i.id === r.id), r);
  for (const name of names) assert(imported.some(i => i.name === `${name}（副本）`));
  check("Conflicting reimport creates separate IDs/names and preserves all original records/bytes", true,
    imported.map(r => ({ id: r.id, name: r.name })));
  const attacks = [
    ["traversal", "不安全路径", z => z.file("../escape.txt", "x", { createFolders: false })],
    ["duplicate-case", "重复文件名", z => z.file("assets/0-0.BIN", "x", { createFolders: false })],
    ["symlink", "符号链接", z => z.file("assets/0-0.bin", "outside", { createFolders: false, unixPermissions: 0o120777 }), "UNIX"],
    ["compression-ratio", "压缩比", z => z.file("assets/0-0.bin", Buffer.alloc(1024 * 1024), { createFolders: false })],
    ["entry-limit", "超过单文件", z => z.file("assets/0-0.bin", Buffer.alloc(8 * 1024 * 1024 + 1), { createFolders: false })],
    ["future-version", "不支持组件包版本", (z, m) => { m.schemaVersion = 999; }],
    ["missing-asset", "缺失", z => z.remove("assets/0-0.bin")],
    ["bad-hash", "SHA-256 校验失败", z => z.file("assets/0-0.bin", Buffer.from("wrong"), { createFolders: false })],
    ["script", "安全解析", (_, m) => { m.components[0].html = '<div><script>window.QA_COMPONENT_ZIP_PWNED=1</script></div>'; }],
    ["handler", "安全解析", (_, m) => { m.components[0].html = '<div><button onclick="window.QA_COMPONENT_ZIP_PWNED=1">X</button></div>'; }],
    ["css-url", "安全解析", (_, m) => { m.components[0].css = '.root { background-image: url("https://invalid.example/qa"); }'; }],
  ];
  for (const [name, message, mutate, platform] of attacks) {
    const z = await JSZip.loadAsync(archiveBytes), m = structuredClone(archiveManifest); mutate(z, m);
    z.file("manifest.json", JSON.stringify(m));
    const bytes = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: platform || "DOS" });
    const file = path.join(fixture.inputs, `${name}.zip`); fs.writeFileSync(file, bytes, { flag: "wx" });
    const item = { name, status: "RUNNING", path: file, sha256: sha(bytes) }; report.cases.push(item);
    await scanFile(file, message);
    item.message = await library.getByRole("status").innerText();
    assert(item.message.includes("组件包未通过检查") && item.message.includes(message), item.message);
    assert.equal(await library.getByTestId("component-confirm-import").count(), 0);
    assert.deepEqual(await records(), imported); assert.deepEqual(await snapshot(), baseline);
    assert.equal(await page.evaluate(() => window.QA_COMPONENT_ZIP_PWNED), undefined);
    item.status = "PASS";
  }
  check("All eleven hostile archives rejected by actual installed scan UI with no library/project pollution or script execution",
    report.cases.length === 11 && report.cases.every(c => c.status === "PASS"));
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await readInstalledViewport(page, expected);
    await scanFile(report.archive.path);
    const selector = library.getByRole("combobox", { name: "待导入组件", exact: true });
    await selector.click(); await page.getByRole("option").filter({ hasText: names[0] }).click();
    const g = await geometry(library.getByTestId("component-confirm-import"));
    assert(g.hit && g.overflow <= 1 && g.rect.left >= g.sidebar.left - 1 && g.rect.right <= g.sidebar.right + 1
      && g.rect.top >= 0 && g.rect.bottom <= height + 1);
    const frames = await library.getByTestId("component-confirm-import").evaluate(async n => {
      const values = [];
      for (let i = 0; i < 5; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); values.push(n.getBoundingClientRect().toJSON()); }
      return values;
    });
    assert(frames.every(r => Math.abs(r.width - frames[0].width) < 1 && Math.abs(r.x - frames[0].x) < 1));
    await shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
    await library.getByTestId("component-import-file").setInputFiles([]);
    assert.deepEqual(await records(), imported);
    report.matrix.push({ ...expected, status: "PASS", geometry: g, frames });
  }
  check("Exact twelve native WebView combinations retain bounded, stable and hit-testable scan/preview/import controls", report.matrix.length === 12);
  }
  expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const name of names) {
    await library.getByRole("button", { name: `添加 ${name} 到当前页面`, exact: true }).click();
    await library.getByRole("status").filter({ hasText: `“${name}”已复制到当前工程页面` }).waitFor();
  }
  const positions = page.locator("details.renpy-project-components");
  if (!await positions.evaluate(d => d.open)) await positions.locator("summary").click();
  for (const [index, name] of names.entries()) {
    const fieldset = positions.getByRole("group", { name, exact: true });
    for (const [field, value] of Object.entries({ width: 24, height: 34, x: index === 0 ? 46 : 73, y: 10 }))
      await fieldset.getByLabel(field, { exact: true }).fill(String(value));
  }
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
  const project = await snapshot(); assert.equal(project.assets.length, 4);
  assert.deepEqual(project.nodes, baseline.nodes); assert.deepEqual(project.edges, baseline.edges);
  assert.deepEqual(project.settings.runtimeUILayoutProfiles.profiles.agentvn, agentvn);
  assert.deepEqual(await records(), imported);
  report.projectComponents = project.settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
    .components.filter(c => c.component_type === "custom_component");
  assert.equal(report.projectComponents.length, 2);
  check("Actual Add-to-page and independent geometry edits preserve personal originals, other layout and story graph", true, report.projectComponents);
  await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).click();
  const confirmation = page.getByTestId("editor-delete-confirmation"); await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "取消", exact: true }).click(); await confirmation.waitFor({ state: "hidden" });
  assert.deepEqual(await records(), imported);
  await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).click(); await confirmation.waitFor();
  await confirmation.getByRole("button", { name: "确认删除", exact: true }).click(); await confirmation.waitFor({ state: "hidden" });
  await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).waitFor({ state: "detached" });
  await sameProjectContent(await snapshot(), project); report.finalLibrary = await records();
  assert.equal(report.finalLibrary.length, phase === "import-use" ? 1 : 3);
  check("Cancel/delete of personal original leaves independently copied project ASTs/assets intact", true);
  await saveProjectPackage();
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("failure").catch(() => {}); }
}).finally(async () => {
  await browser?.close().catch(() => {}); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, cases: report.cases.length,
    matrix: report.matrix.length, error: report.error, destination }, null, 2));
});
async function saveProjectPackage() {
  await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
  const downloads = "C:/Users/1/Downloads", priorFiles = new Set(fs.readdirSync(downloads));
  await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
  const saved = page.getByTestId("project-save-confirmation"); await saved.waitFor({ timeout: 60000 });
  const newFiles = fs.readdirSync(downloads).filter(f => !priorFiles.has(f) && f.includes(fixture.title) && f.endsWith(".vnproj"));
  assert.equal(newFiles.length, 1);
  const native = path.join(downloads, newFiles[0]), retained = path.join(path.dirname(fixture.input), "含组件保存包.vnproj");
  fs.copyFileSync(native, retained, fs.constants.COPYFILE_EXCL);
  const zip = await JSZip.loadAsync(fs.readFileSync(retained));
  const portable = JSON.parse(await zip.file("project.json").async("string"));
  const current = await snapshot();
  assert.equal(portable.project_id, fixture.projectId);
  assert.deepEqual(portable.editor_settings.runtimeUILayoutProfiles, current.settings.runtimeUILayoutProfiles);
  assert.deepEqual(portable.editor_settings.runtimeUILayout, current.settings.runtimeUILayout);
  assert.equal(portable.asset_manifest.length, 4);
  for (const asset of portable.asset_manifest) {
    const bytes = await zip.file(asset.metadata.project_path).async("nodebuffer");
    assert(fixture.images.some(i => i.sha256 === sha(bytes)));
  }
  report.package = { native, retained, sha256: sha(fs.readFileSync(retained)) };
  report.finalProject = await snapshot();
  await saved.getByRole("button", { name: "OK", exact: true }).click(); await shot("native-project-saved");
  check("Actual native portable save retains both layout profiles, copied structures and four exact images", true, report.package);
}
