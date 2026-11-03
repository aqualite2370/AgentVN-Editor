"use strict";
// QA only: actual installed UI and packaged backend. No model/provider task.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, assetBytes } = require("./lib/installed-acceptance.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const { validate, types, matrix } = require("./lib/installed-assets-evidence.cjs");
const { contentSnapshot } = require("./lib/asset-snapshot-content.cjs");
const candidate = require("./lib/installed-assets-candidate.cjs");
const { downloadUIArtifact } = require("./lib/installed-ui-completed-download.cjs");
const root = path.resolve(__dirname, ".."), qa = candidate.qaRoot;
const checkpoint = candidate.checkpointRoot;
const installationFile = candidate.installationFile;
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.resolve(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const installation = read(installationFile), historicalFile = candidate.fixtureFile
  || path.join(root, "output/installed-assets-20261018-01/fixtures.json");
assert.equal(installation.executable.sha256, candidate.editor.sha256);
assert.equal(sha(installation.executable.path), candidate.editor.sha256);
const old = read(historicalFile); assert.equal(sha(old.input), old.inputSha256);
let videoFixture;
if (candidate.current) {
  const file = "F:/AgentVN/QA/Installed-Assets-20261021-01/editor-03/report.json", supplement = read(file);
  assert.equal(supplement.status, "PASS"); assert.equal(sha(supplement.video.path), supplement.video.sha256);
  assert(supplement.video.decoded.duration > 1 && supplement.video.decoded.frames >= 15);
  old.types.find(row => row.type === "video").files.new = { ...supplement.video, path: fs.realpathSync(supplement.video.path) };
  videoFixture = { source: desc(file), video: supplement.video,
    scope: "Reuse exact multiframe fixture bytes, not historical runtime PASS" };
}
const project = read(old.input); project.project_id = `installed-assets-current-20261021-${attempt}`;
project.title = `安装版素材替换隔离小工程_20261021_${attempt}`;
project.nodes[0].data.loadingAnimation = { kind: "default" };
project.nodes[0].data.openingAudio = [];
project.nodes[1].data.scene.commands = [
  { type: "background", background_id: "qa_background", background_fit: "contain" },
  { type: "sprite", character_id: "qa_actor", sprite_id: "qa_sprite", visible: true, position: "left", scale: .5 },
  { type: "bgm", bgm_id: "qa_bgm", action: "play", volume: .5, fade_ms: 0 },
  { type: "dialog", character_id: "qa_actor", portrait: "qa_portrait", voice: "qa_voice", font_asset_id: "qa_font",
    text: "QA_REPLACED_MEDIA_DIALOG" },
  { type: "sfx", sfx_id: "qa_sfx", volume: .5 },
  { type: "narration", text: "QA_REPLACED_MEDIA_SFX_HOLD" },
  { type: "show_image", image_id: "qa_ui", alt: "QA_REPLACED_UI" },
  { type: "show_image", image_id: "qa_other", alt: "QA_REPLACED_OTHER" },
  { type: "video", video_id: "qa_video", video_fit: "contain", fade_in_ms: 0, fade_out_ms: 0 },
  { type: "narration", text: "QA_REPLACED_MEDIA_FINISHED" },
];
const input = path.join(out, "素材替换隔离小工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
const fixture = { ...old, input, inputSha256: sha(input), projectId: project.project_id, title: project.title };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: candidate.editor.version,
  scope: `ACTUAL_NSIS_${candidate.editor.version}_ASSET_REPLACEMENT_SAVE_RESTART_EXPORT_NOT_FULL_G16`,
  installation: desc(installationFile), executable: installation.executable, fixture: desc(input),
  sourceFixture: desc(historicalFile), fixtureMedia: old.types, projectId: project.project_id, videoFixture,
  steps: [], replacements: [], negatives: [], matrix: [], launches: [], cleanups: [], screenshots: [], errors: [],
  protectedFiles: [], productChanges: 0, modelRequests: 0, builds: 0,
  notProven: ["Native picker", "Normal native close", "Player consumption", "Windows setup", "Android", "New audio listening"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, protectedCache = false, initial, nativeSource, mainKnown;
function git() {
  const p = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true, encoding: "utf8" });
  assert.equal(p.status, 0);
  const indexPath = spawnSync("git", ["rev-parse", "--git-path", "index"], { cwd: root, windowsHide: true, encoding: "utf8" });
  assert.equal(indexPath.status, 0);
  const resolvedIndex = path.resolve(root, indexPath.stdout.trim());
  return { head: p.stdout.trim(), indexPath: resolvedIndex, index: sha(resolvedIndex) };
}
function unchanged() {
  for (const f of report.protectedFiles) assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(sha(input), fixture.inputSha256);
  for (const r of old.types) for (const f of Object.values(r.files)) assert.equal(sha(f.path), f.sha256);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    ...(candidate.current ? ["-CodexCacheView"] : [])],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const s = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save();
  try { s.result = await fn(); s.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
  finally { s.finishedAt = new Date().toISOString(); save(); }
}
async function snapshot() {
  return page.evaluate(() => {
    const p = window.__AGENTVN_PROJECT_STORE__.getState(), g = window.__AGENTVN_EDITOR_STORE__.getState();
    return { id: p.projectId, assets: p.assetManifest, folders: p.settings.assetLibrary,
      nodes: g.nodes.map(({ selected, measured, dragging, ...n }) => n),
      edges: g.edges.map(({ selected, ...e }) => e) };
  });
}
async function comparable() {
  const state = await snapshot(), content = [];
  for (const a of state.assets) {
    // Newly materialized addresses are accepted only inside this real backend.
    if (a.metadata.filePath) {
      const relative = path.relative(path.join(host.current.data, "backend/project_assets"), a.metadata.filePath);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    }
    if (a.metadata.url) assert(a.metadata.url.startsWith(`http://127.0.0.1:${host.current.ports[0]}/api/project/assets/`));
    content.push({ id: a.asset_id, sha256: hash(await assetBytes(host.current.ports[0], a)) });
  }
  return contentSnapshot(state, content);
}
async function library() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.library"]:visible').click(); await settleEditor(page);
  const folder = page.getByRole("button", { name: /原文件夹/ }).first();
  await folder.click(); await page.locator('.asset-library-card[data-asset-id="qa_background"]').waitFor();
}
async function open() {
  await page.locator(".project-home").waitFor(); await settleEditor(page);
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page); await library();
}
async function choose(row, file) {
  const card = page.locator(`.asset-library-card[data-asset-id="${row.id}"]`); await card.scrollIntoViewIfNeeded();
  await card.locator('[data-help-key="asset.card.menu"]').click();
  await card.getByRole("menuitem", { name: "替换文件", exact: true }).click();
  await page.locator('[data-help-key="asset.replace.file"]').setInputFiles(file);
}
async function geometry(dialog) {
  await dialog.getByRole("button", { name: "取消", exact: true }).click({ trial: true });
  const g = await dialog.evaluate(node => {
    const rr = n => n.getBoundingClientRect().toJSON(), panel = rr(node);
    const controls = [...node.querySelectorAll("button")].filter(n => n.checkVisibility({ checkOpacity: true }) && !n.disabled)
      .map(n => {
        const rect = rr(n), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        let clipped = rect.x < panel.x || rect.right > panel.right || rect.y < panel.y || rect.bottom > panel.bottom;
        for (let p = n.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p), r = rr(p);
          if (/hidden|clip|auto|scroll/.test(s.overflowX) && (rect.x < r.x - 1 || rect.right > r.right + 1)) clipped = true;
          if (/hidden|clip|auto|scroll/.test(s.overflowY) && (rect.y < r.y - 1 || rect.bottom > r.bottom + 1)) clipped = true;
        }
        return { text: n.textContent, rect, hit: hit === n || n.contains(hit), clipped, overlap: false };
      });
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i].rect, b = controls[j].rect;
      if (Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1)
        controls[i].overlap = controls[j].overlap = true;
    }
    return { panel, controls, width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(g.overflow <= 1 && g.controls.length >= 2);
  for (const b of g.controls) assert(b.hit && !b.clipped && !b.overlap && b.rect.x >= 0 && b.rect.y >= 0
    && b.rect.right <= g.width + 1 && b.rect.bottom <= g.height + 1);
  return g;
}
async function verifyAssets(version) {
  const state = await snapshot(); assert.equal(state.id, fixture.projectId); assert.equal(state.assets.length, 11);
  const result = [];
  for (const row of fixture.types) {
    const a = state.assets.find(a => a.asset_id === row.id); assert(a); assert.equal(a.asset_type, row.type);
    assert.equal(a.metadata.display_name, `${row.type}保留名称`);
    const actual = hash(await assetBytes(host.current.ports[0], a)); assert.equal(actual, row.files[version].sha256);
    result.push({ id: row.id, type: row.type, sha256: actual });
  }
  return result;
}
async function importFixture(file) {
  const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
    body: fs.readFileSync(file), signal: AbortSignal.timeout(30000) });
  const value = await r.json(); assert(r.ok && value.ok); assert.equal(value.data.project_id, project.project_id);
  await page.reload({ waitUntil: "domcontentloaded" }); await open();
}
async function publish() {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
  const dialog = page.getByTestId("package-environment-operation-dialog");
  await until(async () => {
    if (await dialog.isVisible()) return ["completed", "failed"].includes(await dialog.getAttribute("data-environment-phase"));
    const settings = page.locator('[data-package-stage="settings"]');
    if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
    return await page.locator('[data-help-key="package.mode"]').isVisible();
  }, "real publishing environment terminal", 90000);
  if (await dialog.isVisible()) {
    const phase = await dialog.getAttribute("data-environment-phase");
    report.incidentalEnvironment = { phase, text: await dialog.innerText(), scope: "QA cache Junction, not normal Windows environment PASS" }; save();
    await dialog.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
  await page.locator('[data-package-stage="settings"]').click();
  await page.locator('[data-help-key="package.mode"]').click(); await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  for (const [key, value] of [["gameId", project.project_id], ["title", project.title], ["author", "QA"],
    ["description", "当前安装版真实替换的媒体依赖；animation JSON仅工程包存储，不声明专用消费。"]])
    await page.locator(`[data-help-key="package.${key}"]`).fill(value);
  const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warnings.isVisible()) await warnings.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
  const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
  let file;
  if (candidate.current) {
    file = (await downloadUIArtifact({ cdp: host.cdp, trigger: page.locator('[data-help-key="package.export"]'),
      directory: dir, report, save, until })).path;
  } else {
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[data-help-key="package.export"]').click()]);
    const name = download.suggestedFilename(); assert.equal(path.basename(name), name); file = path.join(dir, name);
    await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "real UI cartridge file", 60000);
    assert.equal(await download.failure(), null);
  }
  const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string")); assert.equal(manifest.game_id, project.project_id);
  const packedScript = JSON.parse(await zip.file("script.json").async("string"));
  const result = { ...desc(file), assets: [], manifest, script: packedScript, animationJsonConsumption: "BLOCKED_UNDEFINED_CONTRACT" };
  assert.equal(manifest.assets.length, 10);
  for (const row of fixture.types.filter(r => r.type !== "animation")) {
    const a = manifest.assets.find(a => a.asset_id === row.id); assert(a, row.type);
    const bytes = await zip.file(a.path).async("nodebuffer"); assert.equal(hash(bytes), row.files.new.sha256);
    assert.notEqual(hash(bytes), row.files.old.sha256); result.assets.push({ id: row.id, type: row.type, path: a.path, sha256: hash(bytes) });
  }
  assert(!manifest.assets.some(a => a.asset_id === "qa_animation"));
  for (const entry of Object.values(zip.files).filter(f => !f.dir)) {
    const bytes = await entry.async("nodebuffer");
    assert(!fixture.types.some(r => hash(bytes) === r.files.old.sha256), `Old payload ${entry.name}`);
  }
  await host.shot("actual-ui-cartridge"); return result;
}
(async () => {
  report.gitBefore = git();
  const protectionSource = read(candidate.protectedSourceFile);
  report.protectedFiles = [
    protectionSource.package,
    protectionSource.executable,
    ...(protectionSource.resources || []),
  ].filter(f => f?.path && f?.sha256).map(f => ({ path: f.path, sha256: f.sha256 }));
  const userDatabase = "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db";
  for (const file of [userDatabase, `${userDatabase}-wal`, `${userDatabase}-shm`])
    if (fs.existsSync(file)) report.protectedFiles.push(desc(file));
  assert(report.protectedFiles.length >= 4, "Candidate installation receipt must protect package, executable and resources");
  unchanged(); save();
  const tools = ["scripts/installed-assets-current.cjs", "scripts/lib/installed-assets-candidate.cjs",
    "scripts/lib/installed-ui-completed-download.cjs", "scripts/lib/installed-assets-evidence.cjs",
    "scripts/installed-assets-evidence-test.cjs", "scripts/lib/installed-release-session.cjs",
    "scripts/lib/asset-snapshot-content.cjs", "scripts/asset-snapshot-content-test.cjs",
    "scripts/installed-layout-cache-session.ps1", "scripts/lib/current-native-capture.cjs",
    "plans/ACTIVE_TASKS.md"];
  report.snapshots = [];
  for (const name of tools) {
    const source = path.join(root, name), copy = path.join(checkpoint, `session-${attempt}`, name);
    fs.mkdirSync(path.dirname(copy), { recursive: true }); fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    report.snapshots.push({ source: desc(source), copy: desc(copy) });
  }
  cache("SelfTest"); protectedCache = true; cache("Prepare");
  host = installedReleaseSession({ installationFile, out, report, save, input });
  await step("current-installed-home-baseline-and-all-eleven-original-payloads", async () => {
    page = await host.start(); await importFixture(input); await verifyAssets("old");
    initial = await snapshot(); report.initial = { id: initial.id, folders: initial.folders, nodes: initial.nodes, edges: initial.edges };
    await host.shot("before-replacement"); return { baselineTypes: 11, controlledRawImportNotPicker: true };
  });
  await step("cancel-incompatible-and-five-corrupt-media-types-do-not-mutate", async () => {
    const dialog = page.getByRole("dialog", { name: "确认替换素材" });
    await choose(fixture.types[0], fixture.types[0].files.new.path);
    await dialog.getByText(/授权和生成来源说明不会沿用/).waitFor(); await geometry(dialog);
    await dialog.getByRole("button", { name: "取消", exact: true }).click(); assert.deepEqual(await snapshot(), initial);
    const inputs = [
      ["background", "wav", "audio/wav", Buffer.from("invalid"), "不兼容"],
      ["background", "svg", "image/svg+xml", Buffer.from("invalid"), "原素材未改变"],
      ["bgm", "wav", "audio/wav", Buffer.from("invalid"), "原素材未改变"],
      ["video", "webm", "video/webm", Buffer.from("invalid"), "原素材未改变"],
      ["animation", "json", "application/json", Buffer.from("{invalid-json"), "原素材未改变"],
      ["font", "ttf", "font/ttf", Buffer.alloc(0), "原素材未改变"],
    ];
    for (const [type, ext, mimeType, buffer, message] of inputs) {
      await choose(fixture.types.find(r => r.type === type), { name: `无效.${ext}`, mimeType, buffer });
      const alert = page.locator(".asset-library-panel [role=alert]").filter({ hasText: message }); await alert.waitFor();
      assert.deepEqual(await snapshot(), initial); assert.equal(await dialog.count(), 0);
      report.negatives.push({ type, message: await alert.innerText(), unchanged: true, status: "PASS" }); save();
    }
    await host.shot("invalid-media-rejected"); return { cancelUnchanged: true, negatives: 6 };
  });
  await step("eleven-real-ui-replacements-preserve-identity-references-and-update-bytes", async () => {
    for (const row of fixture.types) {
      await choose(row, row.files.new.path);
      const dialog = page.getByRole("dialog", { name: "确认替换素材" }); await dialog.waitFor();
      assert((await dialog.innerText()).includes(path.basename(row.files.new.path))); await geometry(dialog);
      await dialog.getByRole("button", { name: "确认替换", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      const state = await snapshot(), a = state.assets.find(a => a.asset_id === row.id); assert(a);
      assert.equal(a.asset_type, row.type); assert.equal(a.metadata.display_name, `${row.type}保留名称`);
      assert.equal(a.metadata.filename, path.basename(row.files.new.path));
      assert.equal(hash(await assetBytes(host.current.ports[0], a)), row.files.new.sha256);
      assert.deepEqual(state.folders, initial.folders); assert.deepEqual(state.nodes, initial.nodes); assert.deepEqual(state.edges, initial.edges);
      for (const field of ["hash_sha256", "provider_id", "model", "prompt", "generation", "license_note",
        "backend_asset_path", "filePath", "url", "bytes", "path", "placeholder"]) assert.equal(a.metadata[field], undefined, `${row.type}:${field}`);
      assert.equal(a.metadata.source, "imported"); assert.deepEqual(a.metadata.tags, ["qa-identity"]);
      assert.equal(a.metadata.created_at, "2026-10-01T00:00:00Z");
      if (["background", "sprite", "portrait", "ui", "other"].includes(row.type)) assert.deepEqual([a.metadata.width, a.metadata.height], [900, 600]);
      if (["bgm", "sfx", "voice"].includes(row.type)) assert(Math.abs(a.metadata.duration_ms - 800) < 40);
      if (row.type === "video") assert.deepEqual([a.metadata.width, a.metadata.height], [480, 270]);
      const { data_url, blob_url, ...metadata } = a.metadata;
      report.replacements.push({ id: row.id, type: row.type, status: "PASS", oldSha256: row.files.old.sha256,
        newSha256: row.files.new.sha256, metadata, referencePreserved: true, folderPreserved: true, staleSourcesCleared: true }); save();
    }
    await host.shot("eleven-types-replaced"); return { replaced: 11, bytes: await verifyAssets("new") };
  });
  await step("twelve-display-confirmation-cancellation-and-real-hit-geometry", async () => {
    const before = await comparable();
    for (const m of matrix()) {
      await host.metrics(m); await choose(fixture.types[0], fixture.types[0].files.new.path);
      const dialog = page.getByRole("dialog", { name: "确认替换素材" }); await dialog.waitFor();
      const g = await geometry(dialog); await dialog.getByRole("button", { name: "取消", exact: true }).focus();
      assert(await dialog.getByRole("button", { name: "取消", exact: true }).evaluate(n => document.activeElement === n));
      await host.shot(`confirmation-${m.width}-${m.dpr}-${m.reduced}`);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      const after = await comparable(); assert.deepEqual(after, before);
      const bytes = state => state.assets.map(a => ({ id: a.asset_id, sha256: a.observedContentSha256 }));
      report.matrix.push({ ...m, status: "PASS", cancelUnchanged: true, geometry: g,
        contentBefore: bytes(before), contentAfter: bytes(after) }); save();
    }
    await host.metrics(matrix()[0]); return { displays: 12 };
  });
  await step("real-native-portable-save-all-eleven-new-bytes-home-reopen", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads)); await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const added = fs.readdirSync(downloads).filter(n => !before.has(n) && n.startsWith(project.title) && n.endsWith(".vnproj"));
    assert.equal(added.length, 1);
    nativeSource = desc(path.join(downloads, added[0])); report.nativeSource = nativeSource; save();
    assert((await dialog.innerText()).includes(nativeSource.path));
    const retained = path.join(out, "替换后保存包.vnproj"); fs.copyFileSync(nativeSource.path, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(retained), nativeSource.sha256); report.portable = { ...desc(retained), assets: [], oldBytesAbsent: true }; save();
    const zip = await JSZip.loadAsync(fs.readFileSync(retained), { checkCRC32: true });
    const packed = JSON.parse(await zip.file("project.json").async("string")); assert.equal(packed.project_id, project.project_id);
    for (const row of fixture.types) {
      const a = packed.asset_manifest.find(a => a.asset_id === row.id); assert(a);
      const bytes = await zip.file(a.metadata.project_path).async("nodebuffer"); assert.equal(hash(bytes), row.files.new.sha256);
      report.portable.assets.push({ id: row.id, type: row.type, path: a.metadata.project_path, sha256: hash(bytes) });
    }
    for (const entry of Object.values(zip.files).filter(f => !f.dir)) {
      const bytes = await entry.async("nodebuffer"); assert(!fixture.types.some(r => hash(bytes) === r.files.old.sha256));
    }
    await host.shot("native-project-saved"); await dialog.getByRole("button", { name: "OK", exact: true }).click();
    await page.getByRole("button", { name: "返回首页", exact: true }).click(); await settleEditor(page); await open();
    await verifyAssets("new"); return { portable: desc(retained), types: 11 };
  });
  await step("actual-host-backend-restart-and-independent-database-portable-reimport", async () => {
    const first = host.current;
    await host.stop("Persistence restart, not normal close"); page = await host.start(); await open(); await verifyAssets("new");
    assert.notEqual(first.pid, host.current.pid); assert.notEqual(first.backend.ProcessId, host.current.backend.ProcessId);
    await host.stop("End first isolated DB, not normal close"); mainKnown = report.knownProcesses;
    const reimportOut = path.join(out, "portable-reimport"); fs.mkdirSync(reimportOut);
    host = installedReleaseSession({ installationFile, out: reimportOut, report, save, input: report.portable.path });
    page = await host.start(); await importFixture(report.portable.path); await verifyAssets("new");
    const state = await snapshot(); assert.deepEqual(state.folders, initial.folders);
    assert.deepEqual(state.nodes, initial.nodes); assert.deepEqual(state.edges, initial.edges);
    report.portable.reimportVerified = true; await host.shot("independent-db-reimport"); return { realLaunches: 3, independentReimportDB: true };
  });
  await step("actual-publish-ui-exports-ten-active-media-types-with-no-old-payload", async () => {
    report.cartridge = await publish(); return { activeTypes: 10, animationJsonConsumption: report.cartridge.animationJsonConsumption };
  });
  assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    await host?.stop("End current installed asset workflow, not normal close");
    if (mainKnown) report.knownProcesses = [...mainKnown, ...report.knownProcesses];
    if (protectedCache) { cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json")); report.cacheRestored = read(report.cacheRestoration.path).status === "PASS"; }
    if (nativeSource) {
      assert(nativeSource.path.startsWith("C:\\Users\\1\\Downloads\\") && path.basename(nativeSource.path).startsWith(project.title));
      assert.equal(sha(nativeSource.path), nativeSource.sha256); assert.equal(sha(report.portable.path), nativeSource.sha256);
      fs.unlinkSync(nativeSource.path);
      report.downloadCleanup = { status: "PASS", removed: nativeSource, retained: desc(report.portable.path), deletedUserFiles: 0 };
    }
    unchanged(); report.protectedUnchanged = true; report.gitAfter = git(); report.finishedAt = new Date().toISOString();
    if (report.status === "PASS") validate(report, candidate.editor);
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error?.split("\n")[0], cleanupError: report.cleanupError }));
});
