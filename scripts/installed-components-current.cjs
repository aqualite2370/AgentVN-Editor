"use strict";
// Real current installed Editor; only fixture import uses the real packaged API.
// No store mutations, model calls, native-picker emulation or product changes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, assetBytes } = require("./lib/installed-acceptance.cjs");
const { contentSnapshot } = require("./lib/asset-snapshot-content.cjs");
const { normalizePortableSnapshot } = require("./lib/component-portable-snapshot.cjs");
const { validate } = require("./lib/installed-components-current-evidence.cjs");
const candidate = require("./lib/installed-components-candidate.cjs");
const { validateSolidComponentPreview } = require("./lib/component-preview-style-evidence.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Components-20261021-01";
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const resumeAttempt = process.argv[3];
if (resumeAttempt) { assert.match(resumeAttempt, /^\d{2}$/); assert.notEqual(resumeAttempt, attempt); }
const out = path.resolve(qa, `editor-${attempt}`); fs.mkdirSync(out, { recursive: true });
assert(!fs.existsSync(path.join(out, "report.json")), "Never overwrite an earlier attempt");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const resumeFile = resumeAttempt ? path.join(qa, `editor-${resumeAttempt}/report.json`) : undefined;
const resume = resumeFile ? read(resumeFile) : undefined;
if (resume) {
  assert.equal(resume.status, "FAILED"); assert.equal(resume.steps.length, 8);
  assert(resume.steps.slice(0, 7).every(s => s.status === "PASS"));
  assert.equal(resume.steps[7].name, "Fresh database/library imports portable and shared ZIP; actually use imported copy without changing source");
  assert(resume.error.includes("hash_sha256") && resume.error.includes("deep-equal"));
  assert(resume.cacheRestored && resume.protectedUnchanged && resume.restart.actualNativeRestart);
  for (const f of [resume.input, resume.archive, resume.portable]) assert.equal(sha(f.path), f.sha256);
}
const installationFile = candidate.installationFile;
const installation = read(installationFile), mediaSource = path.join(root, "output/installed-components-20261018-01/fixtures.json");
assert.equal(installation.executable.sha256, candidate.expected.sha256);
assert.equal(sha(installation.executable.path), candidate.expected.sha256);
const media = read(mediaSource); assert.equal(media.status, "PASS");
const images = media.images.map(i => ({ ...i, path: fs.realpathSync(i.path) }));
for (const i of images) assert.equal(sha(i.path), i.sha256);
const project = resume ? read(resume.input.path) : fixture(`installed-components-current-20261021-${attempt}`);
if (!resume) {
  project.schema_version = "1.1.0"; project.title = `安装版组件ZIP当前回测_${attempt}`;
  project.nodes[1].data.scene.commands = [{ type: "narration", text: "QA_COMPONENT_ZIP_CURRENT_STORY" }];
}
const input = path.join(out, "组件ZIP 隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const protectedSourceFile = candidate.protectedSourceFile;
const protectedFiles = read(protectedSourceFile).protectedFiles;
const report = { status: "RUNNING", version: candidate.expected.version, startedAt: new Date().toISOString(),
  scope: "CURRENT_INSTALLED_COMPONENT_ZIP_AUTHOR_RESTART_REIMPORT_EXPORT",
  installation: desc(installationFile), executable: installation.executable, input: desc(input),
  fixtureSource: desc(mediaSource), protectedSource: desc(protectedSourceFile), protectedFiles, images,
  steps: [], cases: [], matrix: [], screenshots: [], snapshots: [], launches: [], cleanups: [], errors: [],
  productChanges: 0, modelRequests: 0, builds: 0,
  notProven: ["Native picker/cancel", "Normal native close", "Physical 4K", "Player consumption",
    "Windows standalone/setup", "MSI/upgrade", "Android", "Real model", "Full Editor motion"] };
if (resume) {
  report.continuation = { source: desc(resumeFile), reason: "PORTABLE_IMPORT_METADATA_ORACLE", inheritedPassedSteps: 7 };
  report.steps = resume.steps.slice(0, 7).map(s => ({ ...s, inheritedFrom: report.continuation.source.sha256 }));
  for (const k of ["archive", "portable", "restart", "authoredProject", "authoredLibrary", "cases", "matrix", "downloadCleanup"])
    report[k] = resume[k];
}
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const names = ["分享关于双图卡", "分享帮助双图卡"];
let host, page, library, protectedCache = false, nativeDownload;
function unchanged() {
  for (const f of protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
  for (const i of images) assert.equal(sha(i.path), i.sha256);
  assert.equal(sha(input), report.input.sha256);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    ...(candidate.current ? ["-CodexCacheView"] : [])],
  { windowsHide: true, encoding: "utf8", timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(name, fn) {
  const s = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save();
  console.log(`START ${name}`);
  try { s.detail = await fn(); s.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function realDownload(page, cdp, directory, trigger) {
  directory = path.resolve(directory);
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory, eventsEnabled: true });
  const record = { directory, events: [] }; (report.downloads ??= []).push(record);
  const begin = event => { record.events.push({ type: "begin", ...event }); save(); };
  const progress = event => { record.events.push({ type: "progress", ...event }); save(); };
  cdp.on("Browser.downloadWillBegin", begin); cdp.on("Browser.downloadProgress", progress);
  try {
    await trigger.click();
    await until(() => record.events.some(e => e.type === "progress" && ["completed", "canceled"].includes(e.state)),
      "actual installed download terminal", 60000);
    const starts = record.events.filter(e => e.type === "begin");
    assert.equal(starts.length, 1);
    const done = record.events.find(e => e.type === "progress" && e.state === "completed" && e.guid === starts[0].guid);
    assert(done && done.filePath); const file = path.resolve(done.filePath);
    assert.equal(path.dirname(file), directory); assert.equal(path.basename(file), starts[0].suggestedFilename);
    assert.equal(fs.statSync(file).size, done.receivedBytes); assert.equal(done.receivedBytes, done.totalBytes);
    record.file = desc(file); save(); return { ...record.file, source: "Actual installed UI and CDP completed event" };
  } finally { cdp.off("Browser.downloadWillBegin", begin); cdp.off("Browser.downloadProgress", progress); }
}
async function previewStyle(selector, label) {
  if (!candidate.current) return;
  const button = library.locator(`${selector} .custom-component-preview button`).first();
  await button.scrollIntoViewIfNeeded(); await page.mouse.move(5, 5);
  const samples = await button.evaluate(async node => {
    const values = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      const s = getComputedStyle(node);
      values.push({ label: node.getAttribute("aria-label"), hovered: node.matches(":hover"),
        inline: { backgroundColor: node.style.backgroundColor, color: node.style.color },
        actual: { backgroundColor: s.backgroundColor, color: s.color, backgroundImage: s.backgroundImage,
          transform: s.transform, boxShadow: s.boxShadow } });
    }
    return values;
  });
  (report.previewStyles ??= []).push({ label, samples }); save();
  validateSolidComponentPreview(samples);
}
function git() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(r.status, 0); return { head: r.stdout.trim(), index: sha(path.join(root, ".git/index")) };
}
async function snapshot() {
  const s = await page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, settings: p.settings, assets: p.assetManifest,
      nodes: g.nodes.map(({ selected, measured, dragging, ...n }) => n),
      edges: g.edges.map(({ selected, ...e }) => e) };
  });
  const bytes = [];
  for (const a of s.assets) bytes.push({ id: a.asset_id, sha256: hash(await assetBytes(host.current.ports[0], a)) });
  return contentSnapshot(s, bytes);
}
async function records() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("agentvn-personal-component-library");
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const values = await new Promise((resolve, reject) => {
      const r = db.transaction("components", "readonly").objectStore("components").getAll();
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    }); db.close();
    return Promise.all(values.sort((a, b) => a.id.localeCompare(b.id)).map(async r => ({
      id: r.id, name: r.name, html: r.html, css: r.css, definition: r.definition,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
      assets: await Promise.all((r.assets || []).map(async a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(a.bytes))))
          .map(x => x.toString(16).padStart(2, "0")).join("") }))),
    })));
  });
}
async function open() {
  await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await settleEditor(page);
  const b = page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible');
  if (await b.getAttribute("aria-pressed") !== "true") {
    await b.click(); await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  }
  const d = page.locator("details.renpy-personal-component-library");
  if (!await d.evaluate(n => n.open)) await d.locator("summary").click();
  library = page.getByTestId("custom-component-library"); await library.waitFor(); await settleEditor(page);
}
async function scan(file, rejection) {
  await library.getByTestId("component-import-file").setInputFiles(file);
  await page.waitForFunction(message => {
    const n = document.querySelector('[data-testid="custom-component-library"]');
    const text = n?.querySelector('[role="status"]')?.textContent || "";
    return !n?.querySelector('[data-testid="component-import-file"]')?.disabled
      && (message ? text.includes("组件包未通过检查") && text.includes(message)
        : text.includes("扫描通过") && n.querySelector('[data-testid="component-confirm-import"]'));
  }, rejection || null);
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.waitForFunction(() => document.querySelector('[data-help-key="layout.save"]')?.getAttribute("data-save-state") === "saved");
}
async function place(name, index, last = false) {
  const d = page.locator("details.renpy-project-components");
  if (!await d.evaluate(n => n.open)) await d.locator("summary").click();
  const g = last ? d.getByRole("group", { name, exact: true }).last() : d.getByRole("group", { name, exact: true });
  for (const [key, value] of Object.entries({ width: 24, height: 34, x: index === 1 ? 73 : 46, y: index === 2 ? 52 : 10 }))
    await g.getByLabel(key, { exact: true }).fill(String(value));
}
async function importProject(file) {
  const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
    body: fs.readFileSync(file), signal: AbortSignal.timeout(30000) });
  const b = await r.json(); assert(r.ok && b.ok && b.data.project_id === project.project_id);
  // The homepage loaded before the API fixture import and owns its recent-list
  // snapshot. Reload the real page; do not inject a recent item into its store.
  await page.reload();
}
function components(s) { return s.settings.runtimeUILayout.screens.find(s => s.screen_id === "title").components
  .filter(c => c.component_type === "custom_component"); }
async function checkPackage(file, portable, expectedAssets, expectedComponents) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const doc = JSON.parse(await zip.file(portable ? "project.json" : "manifest.json").async("string"));
  const assets = portable ? doc.asset_manifest : doc.assets; assert.equal(assets.length, expectedAssets);
  const list = [];
  for (const a of assets) {
    const p = portable ? a.metadata.project_path : a.path, h = hash(await zip.file(p).async("nodebuffer"));
    assert(images.some(i => i.sha256 === h)); list.push({ id: a.asset_id, path: p, sha256: h });
  }
  const layout = portable ? doc.editor_settings.runtimeUILayout : JSON.parse(await zip.file("ui/layout.json").async("string"));
  const cs = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
  assert.equal(cs.length, expectedComponents);
  return { ...desc(file), assets: expectedAssets, assetEntries: list, components: expectedComponents,
    layout, ...(portable ? { project: doc } : { manifest: doc }) };
}
(async () => {
  unchanged(); report.gitBefore = git();
  const tools = [__filename, "scripts/lib/installed-components-candidate.cjs", "scripts/lib/installed-components-current-evidence.cjs",
    "scripts/lib/component-portable-snapshot.cjs",
    "scripts/installed-layout-cache-session.ps1", "scripts/lib/installed-release-session.cjs"];
  for (const f of tools) {
    const source = path.resolve(root, f), target = path.join(out, path.basename(f));
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    report.snapshots.push({ source: desc(source), copy: desc(target) });
  }
  save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  let baseline, originals, imported, savedProject = resume?.authoredProject, savedLibrary = resume?.authoredLibrary;
  if (!resume) {
  await step("Installed current host and fresh personal library; explicit controlled API fixture import", async () => {
    page = await host.start(); await importProject(input); await open();
    baseline = await snapshot(); assert.equal(baseline.id, project.project_id);
    assert.deepEqual(await records(), []); return { fixtureSeed: "PACKAGED_API_NOT_NATIVE_PICKER", baseline };
  });
  await step("Author two components and multi-select actual ZIP download with exact dependencies", async () => {
    await library.getByLabel("添加组件图片依赖", { exact: true }).setInputFiles(images.map(i => i.path));
    await library.getByRole("status").filter({ hasText: /已添加 2 个图片依赖/ }).waitFor();
    const ids = await library.locator(".custom-component-dependencies code").allTextContents(); assert.equal(ids.length, 2);
    for (const [index, name] of names.entries()) {
      await library.getByLabel("组件名称", { exact: true }).fill(name);
      await library.getByLabel("组件 HTML", { exact: true }).fill(
        `<div class="root"><span data-bind="project.title">标题</span><img class="icon" data-asset="${ids[0]}" aria-label="${name}红图"/><img class="icon" data-asset="${ids[1]}" aria-label="${name}蓝图"/><button class="button" type="button" aria-label="分享组件${index ? "帮助" : "关于"}" data-action="${index ? "open_help" : "open_about"}">${index ? "帮助" : "关于"}</button></div>`);
      await library.getByLabel("组件 CSS", { exact: true }).fill(".root { display: flex; flex-direction: column; gap: 6px; padding: 8px; color: #ffffff; font-size: 18px; }.icon { width: 48px; height: 32px; object-fit: contain; }.button { color: #ffffff; background-color: #223344; padding: 8px 12px; border-radius: 4px; }");
      await library.getByTestId("component-save").click();
      await library.getByRole("status").filter({ hasText: `“${name}”已保存` }).waitFor();
      await previewStyle(".custom-component-live-preview", `authored-${index}`);
      await library.getByRole("checkbox", { name: `选择 ${name}`, exact: true }).check();
    }
    originals = await records(); assert.equal(originals.length, 2);
    for (const r of originals) { assert.equal(r.assets.length, 2); for (const a of r.assets) assert(images.some(i => i.sha256 === a.sha256)); }
    assert.deepEqual(await snapshot(), baseline);
    const folder = path.join(out, "中文 分享 导出"); fs.mkdirSync(folder);
    const file = await realDownload(page, host.cdp, folder, library.getByTestId("component-export"));
    const z = await JSZip.loadAsync(fs.readFileSync(file.path)), m = JSON.parse(await z.file("manifest.json").async("string"));
    assert.deepEqual(Object.keys(m).sort(), ["components", "format", "schemaVersion"]); assert.equal(m.components.length, 2);
    const entries = ["manifest.json"];
    for (const c of m.components) { assert.equal(c.assets.length, 2);
      for (const a of c.assets) { entries.push(a.path); assert.equal(hash(await z.file(a.path).async("nodebuffer")), a.sha256); } }
    assert.deepEqual(Object.values(z.files).filter(f => !f.dir).map(f => f.name).sort(), entries.sort());
    report.archive = { ...file, components: 2, dependencies: 4, manifest: m }; return report.archive;
  });
  await step("Scan/cancel preserves state; conflicting import always creates independent copies", async () => {
    await scan(report.archive.path); assert.deepEqual(await records(), originals);
    await library.getByTestId("component-import-file").setInputFiles([]);
    await library.getByTestId("component-confirm-import").waitFor({ state: "hidden" });
    assert.deepEqual(await records(), originals); assert.deepEqual(await snapshot(), baseline);
    await scan(report.archive.path); await library.getByTestId("component-confirm-import").click();
    await library.getByRole("status").filter({ hasText: /已将 2 个组件另存为本机副本/ }).waitFor();
    imported = await records(); assert.equal(imported.length, 4);
    for (const r of originals) assert.deepEqual(imported.find(x => x.id === r.id), r);
    for (const name of names) assert(imported.some(r => r.name === `${name}（副本）`));
    return { library: imported, cancelScope: "DOM file clear, not OS-native dialog cancel" };
  });
  await step("Eleven hostile ZIPs are rejected without changing library, project or executing scripts", async () => {
    const attacks = [
      ["traversal", "不安全路径", z => z.file("../escape.txt", "x", { createFolders: false })],
      ["duplicate-case", "重复文件名", z => z.file("assets/0-0.BIN", "x", { createFolders: false })],
      ["symlink", "符号链接", z => z.file("assets/0-0.bin", "outside", { createFolders: false, unixPermissions: 0o120777 }), "UNIX"],
      ["compression-ratio", "压缩比", z => z.file("assets/0-0.bin", Buffer.alloc(1024 * 1024), { createFolders: false })],
      ["entry-limit", "超过单文件", z => z.file("assets/0-0.bin", Buffer.alloc(8 * 1024 * 1024 + 1), { createFolders: false })],
      ["future-version", "不支持组件包版本", (_, m) => { m.schemaVersion = 999; }],
      ["missing-asset", "缺失", z => z.remove("assets/0-0.bin")],
      ["bad-hash", "SHA-256 校验失败", z => z.file("assets/0-0.bin", Buffer.from("wrong"), { createFolders: false })],
      ["script", "安全解析", (_, m) => { m.components[0].html = "<div><script>window.QA_COMPONENT_ZIP_PWNED=1</script></div>"; }],
      ["handler", "安全解析", (_, m) => { m.components[0].html = '<div><button onclick="window.QA_COMPONENT_ZIP_PWNED=1">X</button></div>'; }],
      ["css-url", "安全解析", (_, m) => { m.components[0].css = '.root { background-image: url("https://invalid.example/qa"); }'; }],
    ];
    for (const [name, message, mutate, platform] of attacks) {
      const z = await JSZip.loadAsync(fs.readFileSync(report.archive.path)), m = structuredClone(report.archive.manifest);
      mutate(z, m); z.file("manifest.json", JSON.stringify(m));
      const file = path.join(out, `${name}.zip`);
      fs.writeFileSync(file, await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE", platform: platform || "DOS" }), { flag: "wx" });
      const c = { name, status: "RUNNING", file: desc(file) }; report.cases.push(c); save();
      await scan(file, message); c.message = await library.getByRole("status").innerText();
      assert.equal(await library.getByTestId("component-confirm-import").count(), 0);
      assert.deepEqual(await records(), imported); assert.deepEqual(await snapshot(), baseline);
      assert.equal(await page.evaluate(() => window.QA_COMPONENT_ZIP_PWNED), undefined);
      c.noPollution = true; c.status = "PASS"; save();
    }
    return { rejected: report.cases.length };
  });
  await step("Twelve actual WebView combinations: real component selector, hit testing, stable bounds and no overflow", async () => {
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]])
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const v = { width, height, dpr, reduced }; await host.metrics(v); await scan(report.archive.path);
        await library.getByRole("combobox", { name: "待导入组件", exact: true }).click();
        await page.getByRole("option").filter({ hasText: names[0] }).click();
        await previewStyle(".custom-component-import-review", `${width}/${dpr}/${reduced}`);
        const n = library.getByTestId("component-confirm-import"); await n.scrollIntoViewIfNeeded(); await n.click({ trial: true });
        const g = await n.evaluate(async n => {
          const samples = [];
          for (let i = 0; i < 5; i++) { await new Promise(requestAnimationFrame); samples.push(n.getBoundingClientRect().toJSON()); }
          const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { frames: samples, rect: r.toJSON(), sidebar: n.closest(".runtime-layout-sidebar").getBoundingClientRect().toJSON(),
            hit: n === h || n.contains(h), overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(g.hit && g.rect.left >= g.sidebar.left - 1 && g.rect.right <= g.sidebar.right + 1
          && g.rect.top >= 0 && g.rect.bottom <= height + 1 && g.overflow <= 1);
        const stable = g.frames.every(r => Math.abs(r.x - g.frames[0].x) < 1 && Math.abs(r.width - g.frames[0].width) < 1);
        assert(stable);
        if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
          await host.shot(`import-${width}-dpr${dpr}-${reduced}`);
        await library.getByTestId("component-import-file").setInputFiles([]); assert.deepEqual(await records(), imported);
        report.matrix.push({ ...v, ...g, stable, status: "PASS" }); save();
      }
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false }); return { combinations: report.matrix.length };
  });
  await step("Copy two personal components to project; independent geometry and delete source do not mutate project", async () => {
    for (const [i, name] of names.entries()) {
      await library.getByRole("button", { name: `添加 ${name} 到当前页面`, exact: true }).click();
      await library.getByRole("status").filter({ hasText: `“${name}”已复制到当前工程页面` }).waitFor(); await place(name, i);
    }
    await saveLayout(); savedProject = await snapshot();
    assert.equal(components(savedProject).length, 2); assert.equal(savedProject.assets.length, 4);
    assert.deepEqual(savedProject.nodes, baseline.nodes); assert.deepEqual(savedProject.edges, baseline.edges);
    assert.deepEqual(savedProject.settings.runtimeUILayoutProfiles.profiles.agentvn, baseline.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.deepEqual(await records(), imported);
    const c = page.getByTestId("editor-delete-confirmation");
    await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).click(); await c.waitFor();
    await c.getByRole("button", { name: "取消", exact: true }).click(); await c.waitFor({ state: "hidden" });
    assert.deepEqual(await records(), imported);
    await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).click(); await c.waitFor();
    await c.getByRole("button", { name: "确认删除", exact: true }).click(); await c.waitFor({ state: "hidden" });
    await library.getByRole("button", { name: `删除 ${names[0]}`, exact: true }).waitFor({ state: "detached" });
    assert.deepEqual(await snapshot(), savedProject); savedLibrary = await records(); assert.equal(savedLibrary.length, 3);
    report.authoredProject = savedProject; report.authoredLibrary = savedLibrary; return { assets: 4, components: 2, library: 3 };
  });
  await step("Real native portable save and actual host/backend restart preserve library, both layouts and bytes", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const dir = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(dir));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const d = page.getByTestId("project-save-confirmation"); await d.waitFor({ timeout: 60000 });
    const added = fs.readdirSync(dir).filter(f => !before.has(f) && f.startsWith(project.title) && f.endsWith(".vnproj"));
    assert.equal(added.length, 1); nativeDownload = desc(path.join(dir, added[0]));
    const retained = path.join(out, "含组件 保存包.vnproj"); fs.copyFileSync(nativeDownload.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(retained), nativeDownload.sha256);
    report.portable = await checkPackage(retained, true, 4, 2);
    assert.deepEqual(report.portable.project.editor_settings.runtimeUILayoutProfiles, savedProject.settings.runtimeUILayoutProfiles);
    await d.getByRole("button", { name: "OK", exact: true }).click();
    await host.stop("actual native save completed; real restart");
    page = await host.start(); await open();
    assert.deepEqual(await snapshot(), savedProject); assert.deepEqual(await records(), savedLibrary);
    report.restart = { projectEqual: true, libraryEqual: true, actualNativeRestart: true };
    await host.stop("restart state verified before fresh database and library"); return report.restart;
  });
  }
  await step("Fresh database/library imports portable and shared ZIP; actually use imported copy without changing source", async () => {
    const freshOut = path.join(out, "fresh-profile");
    fs.mkdirSync(freshOut); host = installedReleaseSession({ installationFile, out: freshOut, report, save, input: report.portable.path });
    page = await host.start(); await importProject(report.portable.path); await open();
    const s = await snapshot();
    assert.deepEqual(normalizePortableSnapshot(s), normalizePortableSnapshot(savedProject));
    assert.deepEqual(await records(), []);
    await scan(report.archive.path); assert.deepEqual(await records(), []); await library.getByTestId("component-confirm-import").click();
    await library.getByRole("status").filter({ hasText: /已将 2 个组件另存为本机副本/ }).waitFor();
    const copy = await records(); assert.equal(copy.length, 2);
    for (const r of copy) {
      const old = report.archive.manifest.components.find(c => c.name === r.name); assert(old);
      assert.notEqual(r.id, old.id); assert.equal(r.html, old.html); assert.equal(r.css, old.css);
      assert.deepEqual(r.assets.map(a => a.sha256), old.assets.map(a => a.sha256));
    }
    await library.getByRole("button", { name: `添加 ${names[0]} 到当前页面`, exact: true }).click();
    await library.getByRole("status").filter({ hasText: `“${names[0]}”已复制到当前工程页面` }).waitFor();
    await place(names[0], 2, true); await saveLayout();
    const modified = await snapshot(); assert.equal(components(modified).length, 3); assert.equal(modified.assets.length, 6);
    for (const original of components(savedProject))
      assert.deepEqual(components(modified).find(c => c.component_id === original.component_id), original);
    assert.deepEqual(await records(), copy);
    assert.deepEqual(modified.nodes, savedProject.nodes); assert.deepEqual(modified.edges, savedProject.edges);
    assert.deepEqual(modified.settings.runtimeUILayoutProfiles.profiles.agentvn, savedProject.settings.runtimeUILayoutProfiles.profiles.agentvn);
    assert.equal(sha(report.portable.path), report.portable.sha256);
    report.finalProject = modified; report.finalLibrary = copy;
    report.freshImport = { freshLibrary: true, importedRecords: 2, copiedToProject: true,
      noLibraryOriginalMutation: true, sourcePortableEqual: true }; return report.freshImport;
  });
  await step("Real installed publish UI exports exact three components and six copied image dependencies", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const mode = page.locator('[data-help-key="package.mode"]');
      if (await mode.count() && (await mode.innerText()).includes(".vncart")) return true;
      const button = page.locator('[data-help-key="package.export"]');
      return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
    }, "real publishing environment terminal", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.incidentalEnvironment = { phase, text: await operation.innerText(),
        scope: "Real Windows check under QA cache Junction, not normal Windows environment acceptance" }; save();
      await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await operation.waitFor({ state: "detached" });
    }
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await warning.click();
    const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    const file = await realDownload(page, host.cdp, dir, page.locator('[data-help-key="package.export"]'));
    report.cartridge = await checkPackage(file.path, false, 6, 3);
    assert.equal(report.cartridge.manifest.game_id, project.project_id);
    assert.deepEqual(report.cartridge.layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component"),
      components(report.finalProject)); await host.shot("actual-export"); return { ...file, assets: 6, components: 3 };
  });
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await host?.shot("failure").catch(() => {}); }
}).finally(async () => {
  try {
    await host?.stop("component ZIP attempt finally");
    if (protectedCache) { cache("Restore"); report.cacheRestored = read(path.join(out, "native-cache-restoration.json")).status === "PASS"; }
    if (nativeDownload) {
      assert.equal(path.resolve(path.dirname(nativeDownload.path)), path.resolve("C:/Users/1/Downloads"));
      assert(path.basename(nativeDownload.path).startsWith(project.title) && nativeDownload.path.endsWith(".vnproj"));
      assert.equal(sha(nativeDownload.path), nativeDownload.sha256);
      assert.equal(sha(report.portable.path), nativeDownload.sha256);
      fs.unlinkSync(nativeDownload.path);
      report.downloadCleanup = { status: "PASS", sourceRetained: true, deletedUserFiles: 0, removed: nativeDownload };
    }
    unchanged(); report.protectedUnchanged = true; report.gitAfter = git(); assert.deepEqual(report.gitAfter, report.gitBefore);
    if (report.status === "PASS") validate(report, candidate.expected);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, steps: report.steps.length, attacks: report.cases.length,
    matrix: report.matrix.length, error: report.error, cleanupError: report.cleanupError, out }, null, 2));
});
