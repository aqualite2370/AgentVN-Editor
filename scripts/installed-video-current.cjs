"use strict";
// Single-media supplement. Real installed Editor; no product/model changes.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, assetBytes, realDownload } = require("./lib/installed-acceptance.cjs");
const { contentSnapshot } = require("./lib/asset-snapshot-content.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const { validate: validateSource } = require("./lib/installed-assets-evidence.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Assets-20261021-01";
const attempt = process.argv[2] || "03"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const sourceFile = path.join(qa, "editor-02/report.json"), source = read(sourceFile); validateSource(source);
const historicalFile = path.join(root, "output/installed-video-20261018-01/fixtures.json"), historical = read(historicalFile);
assert.equal(historical.status, "PASS");
const video = historical.videos.find(v => v.version === "new");
video.path = fs.realpathSync(video.path); assert.equal(sha(video.path), video.sha256);
assert(video.decoded.frames >= 15 && video.decoded.lastTime > 1 && video.decoded.duration > 1);
const input = source.portable.path; assert.equal(sha(input), source.portable.sha256);
const projectId = source.projectId, title = source.cartridge.manifest.title;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.14",
  scope: "CURRENT_INSTALLED_SINGLE_VIDEO_REPLACEMENT_SAVE_RESTART_EXPORT",
  source: desc(sourceFile), fixture: desc(historicalFile), video, installation: source.installation,
  executable: source.executable, projectId, title, protectedFiles: source.protectedFiles,
  steps: [], launches: [], cleanups: [], screenshots: [], errors: [], snapshots: [],
  productChanges: 0, modelRequests: 0, builds: 0,
  notProven: ["Native picker", "Normal native close", "Player consumption", "Windows setup", "Android", "Animation JSON consumption"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, cacheProtected = false, nativeSource;
function git() {
  const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true });
  assert.equal(p.status, 0); return { head: p.stdout.trim(), index: sha(path.join(root, ".git/index")) };
}
function unchanged() {
  for (const f of report.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(sha(input), source.portable.sha256); assert.equal(sha(video.path), video.sha256);
  assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" }); assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const s = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save();
  try { s.result = await fn(); s.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function snapshot() {
  const state = await page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary,
      nodes: g.nodes.map(({ selected, measured, dragging, ...n }) => n), edges: g.edges.map(({ selected, ...e }) => e) };
  });
  const content = [];
  for (const a of state.assets) {
    if (a.metadata.filePath) {
      const rel = path.relative(path.join(host.current.data, "backend/project_assets"), a.metadata.filePath);
      assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel));
    }
    content.push({ id: a.asset_id, sha256: hash(await assetBytes(host.current.ports[0], a)) });
  }
  assert.equal(state.id, projectId); return contentSnapshot(state, content);
}
async function open() {
  await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
}
async function payload(file, kind) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const doc = JSON.parse(await zip.file(kind === "portable" ? "project.json" : "manifest.json").async("string"));
  const list = kind === "portable" ? doc.asset_manifest : doc.assets;
  assert.equal(list.length, kind === "portable" ? 11 : 10);
  const assets = [];
  for (const a of list) {
    const entry = kind === "portable" ? a.metadata.project_path : a.path;
    const expected = a.asset_id === "qa_video" ? video.sha256
      : source.portable.assets.find(f => f.id === a.asset_id).sha256;
    assert.equal(hash(await zip.file(entry).async("nodebuffer")), expected);
    assets.push({ id: a.asset_id, type: a.asset_type, path: entry, sha256: expected });
  }
  const rejected = new Set(source.fixtureMedia.flatMap(f => [f.files.old.sha256, ...(f.type === "video" ? [f.files.new.sha256] : [])]));
  for (const f of Object.values(zip.files).filter(f => !f.dir)) assert(!rejected.has(hash(await f.async("nodebuffer"))));
  return { ...desc(file), assets, ...(kind === "portable" ? { project: doc } : { manifest: doc,
    script: JSON.parse(await zip.file("script.json").async("string")) }) };
}
(async () => {
  report.gitBefore = git(); unchanged();
  const checkpoint = `F:/AgentVN/Checkpoints/Installed-Assets-20261021-01/video-editor-${attempt}`;
  assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint);
  for (const rel of ["scripts/installed-video-current.cjs", "scripts/installed-assets-current-player.cjs",
    "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md"]) {
    const f = path.join(root, rel), copy = path.join(checkpoint, path.basename(rel));
    fs.copyFileSync(f, copy, fs.constants.COPYFILE_EXCL); report.snapshots.push({ source: desc(f), copy: desc(copy) });
  }
  cache("SelfTest"); cache("Prepare"); cacheProtected = true;
  host = installedReleaseSession({ installationFile: source.installation.path, out, report, save, input });
  await step("import-original-current-portable-and-one-real-video-replacement", async () => {
    page = await host.start();
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input), signal: AbortSignal.timeout(30000) });
    const value = await response.json(); assert(response.ok && value.ok && value.data.project_id === projectId);
    await page.reload(); await open(); report.before = await snapshot();
    await page.locator('[data-workspace-surface="options"]:visible').click();
    await page.locator('[data-help-key="advanced.tab.library"]:visible').click(); await settleEditor(page);
    await page.getByRole("button", { name: /原文件夹/ }).first().click();
    const card = page.locator('.asset-library-card[data-asset-id="qa_video"]'); await card.scrollIntoViewIfNeeded();
    await card.locator('[data-help-key="asset.card.menu"]').click(); await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
    await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(video.path);
    const dialog = page.getByRole("dialog", { name: "确认替换素材" }); await dialog.waitFor();
    await host.shot("video-confirmation"); await dialog.getByRole("button", { name: "确认替换", exact: true }).click();
    await dialog.waitFor({ state: "detached" }); report.after = await snapshot();
    for (const k of ["id", "nodes", "edges", "folders"]) assert.deepEqual(report.after[k], report.before[k]);
    assert.deepEqual(report.after.assets.filter(a => a.asset_id !== "qa_video"), report.before.assets.filter(a => a.asset_id !== "qa_video"));
    const current = report.after.assets.find(a => a.asset_id === "qa_video"), old = report.before.assets.find(a => a.asset_id === "qa_video");
    assert.equal(current.observedContentSha256, video.sha256); assert.equal(current.asset_id, old.asset_id);
    assert.equal(current.asset_type, old.asset_type); assert.equal(current.metadata.display_name, old.metadata.display_name);
    assert.equal(current.metadata.width, 480); assert.equal(current.metadata.height, 270); assert(current.metadata.duration_ms > 1000);
    report.replacement = current; return { controlledImportNotPicker: true, actualFileInputNotOSPicker: true, otherTenUnchanged: true };
  });
  await step("native-portable-save-eleven-payloads-and-no-obsolete-video", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads)); await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const added = fs.readdirSync(downloads).filter(n => !before.has(n) && n.startsWith(title) && n.endsWith(".vnproj")); assert.equal(added.length, 1);
    nativeSource = desc(path.join(downloads, added[0])); report.nativeSource = nativeSource; save();
    assert((await dialog.innerText()).includes(nativeSource.path));
    const retained = path.join(out, "多帧视频替换后.vnproj"); fs.copyFileSync(nativeSource.path, retained, fs.constants.COPYFILE_EXCL);
    report.portable = await payload(retained, "portable"); assert.equal(report.portable.sha256, nativeSource.sha256);
    await host.shot("native-video-saved"); await dialog.getByRole("button", { name: "OK", exact: true }).click();
    return { assets: 11, retained: report.portable.sha256 };
  });
  await step("actual-installed-host-and-packaged-backend-restart-keeps-new-video", async () => {
    await host.stop("Video restart, not normal native close"); page = await host.start(); await open();
    report.restarted = await snapshot(); assert.deepEqual(report.restarted, report.after);
    return { launches: report.launches.length, realHostAndBackendRestart: true };
  });
  await step("actual-publishing-ui-exports-new-video-not-a-controlled-zip-derivative", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
    const dialog = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await dialog.isVisible()) return ["completed", "failed"].includes(await dialog.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
      return await page.locator('[data-help-key="package.mode"]').isVisible();
    }, "publishing environment terminal", 90000);
    if (await dialog.isVisible()) {
      const phase = await dialog.getAttribute("data-environment-phase");
      report.incidentalEnvironment = { phase, text: await dialog.innerText(), scope: "QA cache Junction, not Windows environment proof" }; save();
      await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    }
    await page.locator('[data-package-stage="settings"]').click(); await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", projectId], ["title", title], ["author", "QA"],
      ["description", "安装版单项多帧视频替换补证，不代表Windows或Android包。"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warnings.isVisible()) await warnings.click();
    const confirm = page.locator('[data-help-key="package.confirmWarnings"]'); if (await confirm.isVisible()) await confirm.check();
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    const downloaded = await realDownload(page, host.cdp, dir, page.locator('[data-help-key="package.export"]'));
    report.cartridge = await payload(downloaded.path, "cartridge"); await host.shot("video-published");
    return { assets: 10, videoSha256: video.sha256, playerConsumption: "NOT_RUN" };
  });
  assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) { report.failureDOM = await page.locator("body").innerText().catch(String); await host.shot("failure").catch(() => {}); }
}).finally(async () => {
  try {
    await host?.stop("End video author supplement, not native normal close");
    if (cacheProtected) { cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      report.cacheRestored = read(report.cacheRestoration.path).status === "PASS"; assert(report.cacheRestored); }
    if (nativeSource) {
      assert(path.dirname(nativeSource.path) === ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path"));
      assert(path.basename(nativeSource.path).startsWith(title)); assert.equal(sha(nativeSource.path), nativeSource.sha256);
      assert.equal(sha(report.portable.path), nativeSource.sha256); fs.unlinkSync(nativeSource.path);
      report.downloadCleanup = { status: "PASS", removed: nativeSource, retained: desc(report.portable.path), deletedUserFiles: 0 };
    }
    unchanged(); report.protectedUnchanged = true; report.gitAfter = git(); assert.deepEqual(report.gitAfter, report.gitBefore);
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
