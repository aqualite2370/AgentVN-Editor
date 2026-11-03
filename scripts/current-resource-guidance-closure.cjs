"use strict";
// Real installed Editor: modern resource diagnostics, actionable field navigation,
// correction and persistence. Missing-resource fixture is intentionally unpublishable.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Resource-Guidance-1.9.35-20261102-01";
const checkpoint = "F:/AgentVN/Checkpoints/Current-Resource-Guidance-20261102-01";
const out = path.join(qa, "session-01");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { flag: "wx" });
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=", "base64");
const project = fixture("qa-resource-guidance-1935-20261102");
project.title = "安装版资源检测与定位隔离";
project.nodes[1].data.scene.commands = [
  ...Array.from({ length: 11 }, (_, i) => ({ type: "background", background_id: `missing_${i}` })),
  { type: "dialog", character_id: "alice", text: "没有立绘和头像仍是合法对白。" },
  { type: "video", video_id: "movie_missing" },
  { type: "dialog", character_id: "bob", text: "显式引用需要检查", portrait: "portrait_missing", voice: "voice_missing", font_asset_id: "font_missing" },
  { type: "bgm", action: "play", bgm_id: "music_missing" }, { type: "sfx", sfx_id: "sfx_missing" },
  { type: "show_image", image_id: "image_missing" },
  { type: "gallery_anchor", asset_id: "gallery_missing", anchor_id: "test", title: "图" },
  { type: "sprite", character_id: "carol", sprite_id: "sprite_missing", visible: true },
  { type: "narration", text: "对白框资源", dialog_style: { background_asset_id: "box_missing" } },
];
project.asset_manifest = [{ asset_id: "valid_background", asset_type: "background", metadata: {
  filename: "有效背景.png", display_name: "有效背景", mime_type: "image/png",
  data_url: "data:image/png;base64," + image.toString("base64"),
} }];
project.nodes.push({ ...project.nodes[1], id: "other", position: { x: 620, y: 180 },
  data: { ...project.nodes[1].data, label: "无需资源场景", scene: { ...project.nodes[1].data.scene, scene_id: "other_scene",
    commands: [{ type: "narration", text: "此场景没有显式素材引用。" }] } } });
const jumps = [[0, "background_id"], [10, "background_id"], [12, "video_id"], [13, "portrait"],
  [13, "voice"], [13, "font_asset_id"], [14, "bgm_id"], [15, "sfx_id"], [16, "image_id"],
  [17, "asset_id"], [18, "sprite_id"], [19, "dialog_style.background_asset_id"]];
const matrix = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr => [false, true]
  .map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
let host, page, cachePrepared = false, expected, portable;
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
assert(!fs.existsSync(checkpoint)); fs.mkdirSync(checkpoint, { recursive: true });
const input = path.join(out, "资源检测隔离.vnproj"); write(input, project);
const installation = descriptor(); assert.deepEqual(read(receipt).executable, installation.executable);
const report = { status: "RUNNING", at: new Date().toISOString(), cases: [], matrix: [], screenshots: [], launches: [],
  cleanups: [], errors: [], modelRequests: 0, blockedModelRequests: 0, productChanges: 0, builds: 0,
  scope: "EXACT_INSTALLED_RESOURCE_DIAGNOSTICS_NAVIGATION_CORRECTION_NATIVE_SAVE_RESTART_NO_MODEL",
  products: [installation.executable, ...installation.resources], input: desc(input), source: desc(__filename),
  notProven: ["Real model", "Physical4K", "Natural close", "Windows setup", "Android", "Motion polish",
    "All missing dependencies resolved or playable export; fixture deliberately retains twenty missing dependencies"] };
for (const file of [__filename, "plans/ACTIVE_TASKS.md", "editor/src/utils/assetAudit.ts",
  "editor/src/components/editor/InspectorPanel.tsx", "shared/cartridge/assetScanner.ts",
  "scripts/asset-audit-navigation-playwright.cjs", "scripts/asset-audit-protocol-test.cjs"]) {
  const source = path.resolve(root, file), target = path.join(checkpoint, path.relative(root, source));
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
}
write(path.join(checkpoint, "receipt.json"), { status: "PASS", at: new Date().toISOString(),
  products: report.products, input: report.input, source: report.source });
fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL);
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-AllowedRunRoot", qa, "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: r.status, stdout: r.stdout, stderr: r.stderr }); save();
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function stage(name, fn) {
  const row = { name, status: "RUNNING" }; report.cases.push(row); save(); console.log("START " + name);
  try { row.detail = await fn(); row.status = "PASS"; console.log("PASS " + name); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
const audit = () => page.locator(".inspector-asset-audit");
const field = (index, name) => page.locator(`.command-card[data-command-index="${index}"] [data-asset-field="${name}"] .asset-picker-trigger`);
async function graph() {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__AGENTVN_EDITOR_STORE__.getState().nodes
    .map(({ id, type, position, data }) => ({ id, type, position, data })))));
}
async function open() {
  await page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible').filter({ hasText: project.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  await page.locator('.react-flow__node[data-id="scene"]').click();
  await audit().waitFor();
}
async function target(index, name) {
  const control = field(index, name);
  await until(async () => {
    if (!await control.count()) return false;
    return control.evaluate(e => {
      const r = e.getBoundingClientRect();
      if (document.activeElement !== e || r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) return false;
      for (let n = e.parentElement; n; n = n.parentElement) {
        const s = getComputedStyle(n), b = n.getBoundingClientRect();
        if (n.inert || s.visibility === "hidden") return false;
        if (/auto|scroll|hidden|clip/.test(s.overflowX) && (r.left < b.left - 1 || r.right > b.right + 1)) return false;
        if (/auto|scroll|hidden|clip/.test(s.overflowY) && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) return false;
      }
      return e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
  }, "focused unclipped exact asset field " + index + "/" + name, 15000);
  return control.evaluate(e => ({ rect: e.getBoundingClientRect().toJSON(), focus: e === document.activeElement,
    overflow: document.documentElement.scrollWidth - innerWidth }));
}
async function importProject(file) {
  const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, { method: "POST",
    headers: { "content-type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(file)) },
    body: fs.readFileSync(file), signal: AbortSignal.timeout(20000) });
  const p = await r.json(); assert(r.ok && p.ok, JSON.stringify(p)); assert.equal(p.data.project_id, project.project_id);
}
(async () => {
  save(); cache("SelfTest"); cachePrepared = true; cache("Prepare");
  host = installedReleaseSession({ installationFile: receipt, out, report, save, input });
  await stage("installed-import-current-resource-protocol-twenty-one-required-no-fabricated-portrait", async () => {
    page = await host.start(); await importProject(input); await page.reload(); await open();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 21);
    assert.equal(await audit().locator("article.is-optional:visible").count(), 0);
    const descriptions = await audit().locator("article:not(.is-optional)").allTextContents();
    assert(descriptions.every(t => /第 \d+ 条/.test(t) && /素材库|文件|占位|类型/.test(t)));
    assert.equal(await audit().locator('article:not(.is-optional)[data-command-index="11"]').count(), 0);
    expected = await graph();
    return { required: 21, offstagePortraitNotRequired: true, modernFields: jumps, optionalInitiallyCollapsed: true };
  });
  await stage("twelve-displays-all-modern-field-jumps-focus-clipping-and-optional-disclosure", async () => {
    for (const m of matrix) {
      await host.metrics(m); const cell = { ...m, status: "RUNNING", jumps: [] }; report.matrix.push(cell); save();
      assert.equal(await audit().locator("article:not(.is-optional)").count(), 21);
      await audit().getByRole("button", { name: /展开可选建议/ }).click();
      await until(() => audit().locator("article.is-optional:visible").count().then(n => n >= 3), "optional disclosure");
      cell.optional = await audit().locator("article.is-optional").allTextContents();
      await audit().getByRole("button", { name: /收起可选建议/ }).click();
      await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article.is-optional").length === 0);
      for (const [index, name] of jumps) {
        await audit().locator(`article[data-command-index="${index}"][data-field="${name}"]`).getByRole("button", { name: /定位/ }).click();
        const geometry = await target(index, name); assert(geometry.focus && geometry.overflow <= 1);
        cell.jumps.push({ index, field: name, geometry });
      }
      assert.equal(await audit().count(), 1); assert.deepEqual(await graph(), expected);
      cell.status = "PASS"; await host.shot(`resource-fields-${m.width}-${m.dpr}-${m.reduced}`); save();
      console.log("PASS resource navigation " + m.width + "/" + m.dpr + "/" + m.reduced);
    }
    return { combinations: 12, exactFieldJumps: 144, graphUnchanged: true };
  });
  await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
  await stage("actual-cancel-rebind-clear-optional-target-and-node-isolation", async () => {
    await audit().locator('article[data-command-index="0"][data-field="background_id"]').getByRole("button", { name: /定位/ }).click();
    await target(0, "background_id"); await field(0, "background_id").click(); await page.keyboard.press("Escape");
    assert.deepEqual(await graph(), expected);
    await field(0, "background_id").click();
    await page.getByRole("dialog", { name: "背景素材选择", exact: true }).locator('[data-asset-id="valid_background"]').click();
    await page.waitForFunction(() => !document.querySelector('.inspector-asset-audit article[data-command-index="0"][data-field="background_id"]'));
    assert.equal(await audit().locator("article:not(.is-optional)").count(), 20);
    await page.locator('.command-card[data-command-index="0"] [data-asset-field="background_id"]').getByRole("button", { name: /清空/ }).click();
    await audit().locator('article[data-command-index="0"]').waitFor();
    assert.match(await audit().locator('article[data-command-index="0"]').innerText(), /尚未配置/);
    await field(0, "background_id").click();
    await page.getByRole("dialog", { name: "背景素材选择", exact: true }).locator('[data-asset-id="valid_background"]').click();
    expected.find(n => n.id === "scene").data.scene.commands[0].background_id = "valid_background";
    await audit().getByRole("button", { name: /展开可选建议/ }).click();
    await audit().locator('article.is-optional[data-field="sprite_id"]').first().getByRole("button", { name: /定位/ }).click();
    const workbench = page.getByRole("complementary", { name: "事件工作台" });
    await workbench.locator('.workbench-type-button[data-command-type="sprite"].is-active').waitFor();
    assert.equal(await workbench.locator('[data-help-key="command.sprite.characterId"]').inputValue(), "alice");
    await audit().locator('article.is-optional[data-field="sprite_id"]').filter({ hasText: "bob" }).getByRole("button", { name: /定位/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-help-key="command.sprite.characterId"]')?.value === "bob");
    assert.deepEqual(await graph(), expected, "Suggestions must not insert new commands");
    await workbench.getByRole("button", { name: "最小化事件工作台", exact: true }).click();
    await page.locator('.react-flow__node[data-id="other"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 0);
    await page.locator('.react-flow__node[data-id="scene"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 20);
    assert.equal(await audit().locator("article.is-optional:visible").count(), 0);
    assert.deepEqual(await graph(), expected); await host.shot("resource-rebound-and-scene-isolated");
    return { cancelledUnchanged: true, correctionRemovesExactlyOne: true, clearRequiresResourceAgain: true,
      suggestionsPreserveCharacterWithoutInsertion: true, otherSceneRequired: 0, correctedSceneRequired: 20 };
  });
  await stage("native-save-real-restart-and-fresh-host-portable-reimport-retain-correction", async () => {
    const downloads = "C:/Users/1/Downloads", before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
    const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
    const file = await until(() => {
      const names = fs.readdirSync(downloads).filter(n => n.endsWith(".vnproj") && !before.has(n));
      assert(names.length <= 1); return names.length === 1 && path.join(downloads, names[0]);
    }, "native QA-only portable file");
    const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
    const stored = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(stored.project_id, project.project_id);
    assert.deepEqual(stored.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })), expected);
    const a = stored.asset_manifest.find(a => a.asset_id === "valid_background");
    assert.deepEqual(await zip.file(a.metadata.project_path).async("nodebuffer"), image);
    const retained = path.join(out, path.basename(file)); fs.copyFileSync(file, retained, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(file), sha(retained)); portable = desc(retained); report.portable = portable;
    assert.equal(path.dirname(path.resolve(file)), path.resolve(downloads)); fs.unlinkSync(file);
    report.downloadCleanup = { path: file, retained: portable, removed: true, userFilesDeleted: 0 };
    await dialog.getByRole("button", { name: "OK", exact: true }).click();
    const previousPid = host.current.pid;
    await host.stop("Actual restart after native save; not normal-close evidence"); page = await host.start(); await open();
    assert.notEqual(host.current.pid, previousPid); assert.deepEqual(await graph(), expected);
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 20);
    await host.shot("resource-correction-after-real-restart");
    // A new isolated data directory exercises portable restoration independently.
    await host.stop("Close persisted QA project before independent portable reimport");
    const fresh = path.join(qa, "fresh-reimport"); fs.mkdirSync(fresh);
    host = installedReleaseSession({ installationFile: receipt, out: fresh, report, save, input: retained });
    page = await host.start(); await importProject(retained); await page.reload(); await open();
    assert.deepEqual(await graph(), expected);
    await page.waitForFunction(() => document.querySelectorAll(".inspector-asset-audit article:not(.is-optional)").length === 20);
    await host.shot("resource-correction-after-fresh-portable-reimport");
    return { portable, nativeSave: true, differentHostPid: true, freshDatabase: true,
      missingCount: 20, imageBytesPreserved: true, userFilesDeleted: 0 };
  });
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  assert.equal(report.blockedModelRequests, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(() => {});
  }
}).finally(async () => {
  try { await host?.stop("Final exact QA ownership cleanup; not natural window close"); }
  catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  if (cachePrepared) {
    try { cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS"); }
    catch (e) { report.status = "FAILED"; report.cacheError = String(e.stack || e); process.exitCode = 1; }
  }
  for (const f of report.products) assert.equal(sha(f.path), f.sha256);
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length, matrix: report.matrix.length, error: report.error }));
});
