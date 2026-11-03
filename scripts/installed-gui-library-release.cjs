"use strict";
// Current sealed installation, complete official template and native local
// library. Public API seeds only a disposable project; every GUI edit is UI.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { contentSnapshot } = require("./lib/asset-snapshot-content.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const resumeMatrixAttempt = process.argv.find(value => value.startsWith("--resume-matrix="))?.slice("--resume-matrix=".length);
if (resumeMatrixAttempt) assert.match(resumeMatrixAttempt, /^\d{2}$/);
const resumeAuthorAttempt = process.argv.find(value => value.startsWith("--resume-author="))?.slice("--resume-author=".length);
if (resumeAuthorAttempt) assert.match(resumeAuthorAttempt, /^\d{2}$/);
const qa = "F:/AgentVN/QA/Installed-GUI-Library-1922-20261022-01";
const out = path.resolve(qa, `editor-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => A.sha256(fs.readFileSync(file));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size,
  generatedAt: fs.statSync(file).mtime.toISOString() });
const old = read("F:/AgentVN/QA/Installed-GUI-20261021-01/preparation.json");
const previousAuthorFile = resumeAuthorAttempt ? path.join(qa, `editor-${resumeAuthorAttempt}/report.json`) : undefined;
const previousAuthor = previousAuthorFile ? read(previousAuthorFile) : undefined;
if (previousAuthor) {
  assert.equal(previousAuthor.status, "FAILED"); assert.equal(previousAuthor.nativeCacheRestoration, "PASS");
  assert(previousAuthor.finishedAt); assert.equal(previousAuthor.cleanupError, undefined);
  assert.equal(previousAuthor.steps.length, 7); assert(previousAuthor.steps.slice(0, 6).every(row => row.status === "PASS"));
  assert.match(previousAuthor.error, /url: 'http:\/\/127\.0\.0\.1/);
  assert.equal(previousAuthor.savedProject.assetManifest.length, 26);
}
const archive = old.officialArchive.path, prefix = "官方模板 中文/game/";
assert.equal(sha(archive), old.officialArchive.sha256);
const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const baseline = read("F:/AgentVN/QA/Editor-1.9.22-20261022-01/baseline-01.json");
assert.equal(baseline.status, "PASS");
const project = read(previousAuthor?.environment.AGENTVN_TEST_PROJECT ?? old.input.path);
if (!previousAuthor) {
  project.project_id = `installed-gui-library-1922-${attempt}`;
  project.title = `完整官方GUI新流程${attempt}`;
}
project.nodes[0].data.openingAudio = [];
const input = path.join(out, "完整官方GUI隔离工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], matrix: [],
  screenshots: [], launches: [], cleanups: [], errors: [], modelRequests: 0,
  scope: "ACTUAL_INSTALLED_1922_COMPLETE_OFFICIAL_GUI_LIBRARY_SCOPE_REVISION_RESTART_EXPORT",
  boundaries: { nativeDirectoryPicker: false, normalWindowClose: false, standaloneGame: false,
    android: false, realModel: false, physical4K: false, fullMotionAudit: false },
  environment: { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out },
  officialArchive: desc(archive), provenance: desc("F:/AgentVN/QA/Installed-GUI-20261021-01/preparation.json"),
  protectedFiles: baseline.protectedFiles };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input, report, save });
let page, prepared = false, currentProject, initial, libraryId, libraryPath;
const snapshot = () => A.projectSnapshot(host.current.ports[0]);
const authored = value => ({ settings: value.settings, assets: value.assetManifest });
const bindings = {
  "gui/main_menu.png": "标题页主视觉",
  "gui/textbox.png": "对白面板背景",
  "gui/button/choice_idle_background.png": "分支选项按钮背景",
  "gui/button/quick_idle_background.png": "共享按钮 · 普通状态",
  "gui/button/quick_hover_background.png": "共享按钮 · 悬停/聚焦状态",
  "DejaVuSans.ttf": "全局界面字体",
};
function unchanged() { for (const item of report.protectedFiles) assert.equal(sha(item.path), item.sha256, item.path); }
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    "-CodexCacheView"], { encoding: "utf8", windowsHide: true, timeout: 30000 });
  (report.cache ??= []).push({ action, code: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function step(label, action) {
  if (previousAuthor && report.steps.length < 6) {
    const inherited = previousAuthor.steps[report.steps.length];
    assert.equal(inherited.label, label); assert.equal(inherited.status, "PASS");
    report.steps.push({ ...inherited, inheritedFrom: { path: previousAuthorFile, sha256: sha(previousAuthorFile) } });
    save(); console.log(`INHERIT PASS ${label}`); return;
  }
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() };
  report.steps.push(row); save(); console.log(`START ${label}`);
  try { row.detail = await action(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function geometry(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const result = await locator.evaluate(node => {
    const r = node.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), p = parent.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { clip.left = Math.max(clip.left, p.left); clip.right = Math.min(clip.right, p.right); }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { clip.top = Math.max(clip.top, p.top); clip.bottom = Math.min(clip.bottom, p.bottom); }
    }
    return { rect: r.toJSON(), clip, hit: node === hit || node.contains(hit),
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  const { rect: r, clip: c } = result;
  assert(result.hit && result.overflow <= 1 && r.width > 0 && r.height > 0
    && r.left >= c.left - 1 && r.top >= c.top - 1 && r.right <= c.right + 1 && r.bottom <= c.bottom + 1,
  JSON.stringify(result));
  return result;
}
async function click(locator) { const result = await geometry(locator); await locator.click(); return result; }
const dialog = () => page.getByTestId("renpy-gui-import-dialog");
async function layout() {
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await A.settleEditor(page);
  const type = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await type.getAttribute("aria-pressed") !== "true") await click(type);
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await A.settleEditor(page);
}
async function saveLayout() {
  await click(page.locator('[data-help-key="layout.save"]:visible'));
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
async function scan(file = archive) {
  if (!(await dialog().count())) await click(page.getByTestId("renpy-gui-import-open"));
  await dialog().getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
  await dialog().locator(".renpy-gui-import-summary").waitFor();
}
async function cancel() {
  await click(dialog().getByRole("button", { name: "取消，不修改工程", exact: true }));
  await dialog().waitFor({ state: "detached" });
}
async function libraryArticle(id) { return dialog().locator(`article[data-pack-id="${id}"]`); }
async function choosePack(id) {
  if (!(await dialog().count())) await click(page.getByTestId("renpy-gui-import-open"));
  const article = await libraryArticle(id); await article.waitFor();
  await click(article.getByRole("button", { name: "预览并选择应用", exact: true }));
  await page.getByTestId("renpy-gui-impact").waitFor();
}
async function consent() { await dialog().getByRole("checkbox", { name: /我已重新核对/ }).check(); }
async function libraryRecords() {
  const folder = path.join(host.current.data, "gui-pack-library");
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(name => name.startsWith("gui-pack-")).map(name => {
    const file = path.join(folder, name, "record.json");
    return { ...read(file), path: file, sha256: sha(file) };
  });
}
async function proofAssets() {
  const state = await snapshot(), result = [];
  for (const asset of state.assetManifest) {
    const source = asset.metadata.tags.find(tag => tag.startsWith("renpy_gui_path:"))?.slice("renpy_gui_path:".length);
    assert(source?.startsWith(prefix));
    const bytes = await A.assetBytes(host.current.ports[0], asset);
    const sourceBytes = await report.templateZip.file(source).async("nodebuffer");
    assert.equal(A.sha256(bytes), A.sha256(sourceBytes), source);
    result.push({ id: asset.asset_id, source, sha256: A.sha256(bytes), bytes: bytes.length });
  }
  return result;
}
// The in-memory archive is deliberately not serialized in the report.
let templateZip;
(async () => {
  unchanged(); save();
  templateZip = await JSZip.loadAsync(fs.readFileSync(archive), { checkCRC32: true });
  for (const file of old.officialFiles)
    assert.equal(A.sha256(await templateZip.file(prefix + file.relative).async("nodebuffer")), file.sha256);
  report.officialFileCount = old.officialFiles.length;
  Object.defineProperty(report, "templateZip", { value: templateZip, enumerable: false });
  if (previousAuthor) {
    assert.equal(previousAuthor.launches[0].executable.sha256, host.installation.executable.sha256);
    const dataSource = path.resolve(previousAuthor.launches[0].data), expectedSource = path.resolve(qa, `editor-${resumeAuthorAttempt}`, "data");
    assert.equal(dataSource, expectedSource);
    for (const entry of fs.readdirSync(dataSource, { recursive: true }))
      assert(!fs.lstatSync(path.join(dataSource, entry)).isSymbolicLink(), "Resume copy must not follow links");
    fs.cpSync(dataSource, path.join(out, "data"), { recursive: true, errorOnExist: true, force: false });
    report.inheritedAuthor = { path: previousAuthorFile, sha256: sha(previousAuthorFile), originalStatus: previousAuthor.status,
      reason: "Completed first six groups retained; isolated data copied only after previous host cleanup." };
    report.matrix = previousAuthor.matrix; report.inheritedMatrix = previousAuthor.inheritedMatrix;
    report.agentBaseline = previousAuthor.agentBaseline; report.assetProofs = previousAuthor.assetProofs;
    libraryId = previousAuthor.libraryId; report.libraryId = libraryId;
    libraryPath = path.join(out, "data/gui-pack-library", libraryId, "record.json");
    report.libraryOriginal = desc(libraryPath);
    const revisionPath = path.join(out, "data/gui-pack-library", path.basename(path.dirname(previousAuthor.libraryRevision.path)), "record.json");
    report.libraryRevision = desc(revisionPath);
    assert.equal(report.libraryOriginal.sha256, previousAuthor.libraryOriginal.sha256);
    assert.equal(report.libraryRevision.sha256, previousAuthor.libraryRevision.sha256);
  }
  cache("SelfTest"); cache("Prepare"); prepared = true; page = await host.start();
  if (previousAuthor) {
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
    await A.settleEditor(page); await layout();
    const actual = await snapshot(), observed = await proofAssets();
    assert.deepEqual(contentSnapshot(authored(actual), observed), contentSnapshot(authored(previousAuthor.savedProject), report.assetProofs));
  }
  await step("Real installed backend fixture and actual Renpy author entry", async () => {
    const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) }, body: fs.readFileSync(input) });
    const body = await response.json(); assert(response.ok && body.ok && body.data.project_id === project.project_id);
    await page.reload(); await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
    await A.settleEditor(page); await layout(); await saveLayout(); initial = await snapshot();
    assert.equal(initial.assetManifest.length, 0); assert.equal((await libraryRecords()).length, 0);
    report.agentBaseline = initial.settings.runtimeUILayoutProfiles.profiles.agentvn;
    return { installation: host.installation.executable, projectId: initial.projectId };
  });
  await step("Complete official scan and cancel in twelve actual WebView displays", async () => {
    if (resumeMatrixAttempt) {
      const sourceFile = path.join(qa, `editor-${resumeMatrixAttempt}/report.json`), previous = read(sourceFile);
      assert.equal(previous.status, "FAILED"); assert.equal(previous.nativeCacheRestoration, "PASS");
      assert.equal(previous.cleanupError, undefined); assert(previous.finishedAt);
      assert.equal(previous.officialArchive.sha256, report.officialArchive.sha256);
      assert.equal(previous.launches[0].executable.sha256, host.installation.executable.sha256);
      assert.equal(previous.matrix.length, 12); assert(previous.matrix.every(row => row.status === "PASS"));
      assert(previous.steps.some(row => row.label === "Complete official scan and cancel in twelve actual WebView displays" && row.status === "PASS"));
      for (const screenshot of previous.screenshots) {
        assert.equal(sha(screenshot.path), screenshot.sha256);
        assert.deepEqual(screenshot.before, screenshot.after);
        const bytes = fs.readFileSync(screenshot.path);
        assert.equal(bytes.readUInt32BE(16), Math.round(screenshot.before.width * screenshot.before.dpr));
        assert.equal(bytes.readUInt32BE(20), Math.round(screenshot.before.height * screenshot.before.dpr));
      }
      report.matrix = previous.matrix;
      report.inheritedMatrix = { ...desc(sourceFile), originalStatus: previous.status,
        reason: "Same sealed candidate, complete archive and completed twelve scan/cancel displays; not rerun or relabeled." };
      return { inherited: report.inheritedMatrix, displays: 12 };
    }
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const expected = { width, height: width * 9 / 16, dpr, reduced };
      await host.metrics(expected); await A.settleEditor(page); await scan();
      assert.equal(await dialog().locator(".renpy-gui-import-asset-row").count(), 25);
      const issues = await dialog().locator(".renpy-gui-import-issues").innerText();
      assert(issues.includes("unsupported_context") && issues.includes("unsupported_script"));
      await A.select(page, prefix + "gui/main_menu.png 游戏界面用途", "标题页主视觉");
      await consent();
      const button = dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true });
      assert(await button.isEnabled());
      const g = await geometry(button);
      const focus = await dialog().evaluate(node => node.contains(document.activeElement));
      assert(focus);
      const shot = await host.shot(`official-scan-${width}-${dpr}-${reduced}`);
      await cancel();
      assert.deepEqual(authored(await snapshot()), authored(initial));
      assert.equal((await libraryRecords()).length, 0);
      report.matrix.push({ ...expected, status: "PASS", geometry: g, focus, screenshot: shot.path }); save();
    }
    assert.equal(report.matrix.length, 12);
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    return { displays: report.matrix.length, resources: 25, projectAndLibraryUnchanged: true };
  });
  await step("Unsafe ZIP visibly rejected without changing local library or project", async () => {
    const bad = new JSZip(); bad.file("../outside.txt", "must never be extracted"); bad.file("gui.rpy", "define gui.text_size = 22");
    const file = path.join(out, "越界资源包.zip"); fs.writeFileSync(file, await bad.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
    await scan(file);
    assert.match(await dialog().locator(".renpy-gui-import-issues").innerText(), /unsafe_path/);
    assert(await dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }).isDisabled());
    await cancel(); assert.deepEqual(authored(await snapshot()), authored(initial));
    assert.equal((await libraryRecords()).length, 0);
    return { archive: desc(file), projectAndLibraryUnchanged: true };
  });
  await step("Complete official package committed to native library without project mutation", async () => {
    await scan();
    await page.getByRole("textbox", { name: "资源包名称", exact: true }).fill("官方完整模板 · 原件");
    for (const [relative, binding] of Object.entries(bindings))
      await A.select(page, prefix + relative + " 游戏界面用途", binding);
    await consent();
    await click(dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }));
    await until(async () => (await libraryRecords()).length === 1, "native immutable library record");
    const [record] = await libraryRecords(); libraryId = record.id; libraryPath = record.path;
    assert.equal(record.assetCount, 25); assert.equal(record.revision, 1);
    assert.deepEqual(authored(await snapshot()), authored(initial));
    report.libraryOriginal = desc(libraryPath); report.libraryId = libraryId;
    await cancel(); return { record: report.libraryOriginal, projectUnchanged: true, assets: 25 };
  });
  await step("Explicit project application copies every official byte and selected parameters", async () => {
    await choosePack(libraryId);
    const selection = {};
    for (const [key, value] of Object.entries({ "shared.x": 40, "shared.fontSize": 22,
      "shared.spacing": 4, "save_load.saveColumns": 3 })) {
      const row = dialog().locator(".renpy-gui-import-row").filter({ has: page.locator("small", { hasText: `· ${key}` }) });
      assert.equal(await row.count(), 1, key); await row.locator('input[type="checkbox"]').check();
      assert((await row.innerText()).includes(String(value))); selection[key] = value;
    }
    await consent(); await click(dialog().getByRole("button", { name: "确认应用到当前工程", exact: true }));
    await dialog().waitFor({ state: "detached" }); await saveLayout();
    currentProject = await snapshot(); assert.equal(currentProject.assetManifest.length, 25);
    assert.deepEqual(currentProject.settings.runtimeUILayoutProfiles.profiles.agentvn, report.agentBaseline);
    const gui = currentProject.settings.runtimeUILayout.renpy;
    assert.equal(gui.shared.x, 40); assert.equal(gui.shared.fontSize, 22);
    assert.equal(gui.shared.spacing, 4); assert.equal(gui.save_load.saveColumns, 3);
    report.assetProofs = await proofAssets(); assert.equal(report.assetProofs.length, 25);
    assert.equal(sha(libraryPath), report.libraryOriginal.sha256);
    report.afterProjectApplication = currentProject;
    return { selectedParameters: selection, actualAssetBytes: 25, inactiveLayoutUnchanged: true };
  });
  await step("Reimport creates independent revision and one-state application preserves other controls", async () => {
    const before = await snapshot();
    const targetButton = page.locator('.renpy-title-action[data-ui-component-id="title_save_load_button"]');
    await page.mouse.move(1900, 10);
    const baseStyle = await targetButton.evaluate(node => {
      const style = getComputedStyle(node);
      return Object.fromEntries(["backgroundColor", "backgroundImage", "color", "fontSize", "fontWeight", "borderRadius", "padding"]
        .map(key => [key, style[key]]));
    });
    await scan();
    await page.getByRole("textbox", { name: "资源包名称", exact: true }).fill("官方完整模板 · 新修订");
    await A.select(page, "资源包修订来源", "官方完整模板 · 原件 · 从修订 1 新建修订（保留原件）");
    await consent(); await click(dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }));
    await until(async () => (await libraryRecords()).length === 2, "two immutable library revisions");
    assert.deepEqual(authored(await snapshot()), authored(before)); assert.equal(sha(libraryPath), report.libraryOriginal.sha256);
    const revision = (await libraryRecords()).find(record => record.parentId === libraryId);
    assert(revision && revision.revision === 2); report.libraryRevision = desc(revision.path);
    await choosePack(revision.id);
    await A.select(page, "资源包应用范围", "单个控件");
    await A.select(page, "目标页面", "标题"); await A.select(page, "目标控件", "存档");
    await A.select(page, "目标控件状态", "悬停 / 焦点");
    for (const relative of (await libraryRecords()).find(r => r.id === revision.id).scan.assets.map(a => a.path))
      if (relative !== prefix + "gui/main_menu.png") await A.select(page, relative + " 导入操作", "跳过");
    await A.select(page, prefix + "gui/main_menu.png 游戏界面用途", "当前控件背景");
    await consent(); await click(dialog().getByRole("button", { name: "确认应用到当前工程", exact: true }));
    await dialog().waitFor({ state: "detached" }); await saveLayout();
    currentProject = await snapshot();
    assert.equal(currentProject.assetManifest.length, 26);
    assert.deepEqual(currentProject.settings.runtimeUILayoutProfiles.profiles.agentvn, report.agentBaseline);
    const previous = structuredClone(before.settings.runtimeUILayout), next = structuredClone(currentProject.settings.runtimeUILayout);
    const getTarget = skin => skin.screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_save_load_button");
    const a = getTarget(previous), b = getTarget(next); assert(a && b);
    const added = currentProject.assetManifest.find(asset => !before.assetManifest.some(old => old.asset_id === asset.asset_id));
    assert(added); assert.equal(b.stateStyles.hover.backgroundImage, `asset:${added.asset_id}`);
    // A first title edit canonicalizes an ignored legacy style. Verify the
    // narrow, known transformation and its real displayed baseline separately.
    if (a.titleButtonStyleSource !== "layout") {
      assert.equal(b.titleButtonStyleSource, "layout"); assert.equal(b.style, undefined);
      assert.deepEqual(a.style, { backgroundColor: "transparent", borderColor: "transparent", borderWidth: 0,
        borderRadius: 0, color: "#f6f8ff", fontSize: 18, fontWeight: 600, shadow: "none", backdropBlur: 0, padding: 0 });
      b.style = a.style; delete b.titleButtonStyleSource;
    }
    if (a.stateStyles === undefined) delete b.stateStyles; else b.stateStyles = a.stateStyles;
    assert.deepEqual(next, previous);
    await page.mouse.move(1900, 10);
    const actualBase = await targetButton.evaluate(node => {
      const style = getComputedStyle(node);
      return Object.fromEntries(["backgroundColor", "backgroundImage", "color", "fontSize", "fontWeight", "borderRadius", "padding"]
        .map(key => [key, style[key]]));
    });
    assert.deepEqual(actualBase, baseStyle, "A hover-only application must preserve the actual ordinary-state appearance");
    report.assetProofs = await proofAssets();
    return { revision: report.libraryRevision, target: "title_save_load_button", state: "hover",
      copiedAsset: added.asset_id, legacySourceCanonicalizationChecked: true, baseStyle, actualBase,
      otherControlsAndSharedUnchanged: true };
  });
  await step("Real host restart restores local revisions and exact project author state", async () => {
    report.savedProject = await snapshot(); await cancelIfOpen();
    await host.stop("restart boundary"); page = await host.start();
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
    await A.settleEditor(page); await layout();
    const restored = await snapshot(), restoredBytes = await proofAssets();
    assert.deepEqual(contentSnapshot(authored(restored), restoredBytes),
      contentSnapshot(authored(report.savedProject), report.assetProofs));
    await click(page.getByTestId("renpy-gui-import-open"));
    await until(async () => await dialog().locator("article[data-pack-id]").count() === 2, "restored native library");
    assert.equal(sha(libraryPath), report.libraryOriginal.sha256);
    assert.equal(sha(report.libraryRevision.path), report.libraryRevision.sha256);
    await cancel(); report.assetProofs = await proofAssets();
    return { actualHostLaunches: report.launches.length, nativeRevisions: 2, projectAssets: 26 };
  });
  await step("Actual installed publishing exports selected dependencies with identical bytes", async () => {
    await click(page.locator('[data-workspace-surface="publish"]:visible'));
    const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
    await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
    await A.dismissEnvironmentCompletion(page);
    await panel.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
    await panel.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
    const warning = panel.getByRole("checkbox", { name: /我已检查全部警告/ }); if (await warning.count()) await warning.check();
    const events = report.downloadEvents = [];
    host.cdp.on("Browser.downloadWillBegin", event => { events.push({ type: "begin", ...event }); save(); });
    host.cdp.on("Browser.downloadProgress", event => { events.push({ type: "progress", ...event }); save(); });
    const pending = page.waitForEvent("download"); await click(panel.locator(".package-primary-action"));
    const download = await pending, name = download.suggestedFilename();
    assert.equal(path.basename(name), name);
    const target = path.resolve(out, name);
    const completed = await until(() => events.find(e => e.type === "progress" && e.state === "completed"
      && e.filePath && path.resolve(e.filePath) === target), "same actual completed download", 60000);
    assert.equal(await download.failure(), null); assert.equal(fs.statSync(target).size, completed.totalBytes);
    const game = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
    const manifest = JSON.parse(await game.file("manifest.json").async("string"));
    const skin = JSON.parse(await game.file("ui/layout.json").async("string"));
    const expectedSkin = structuredClone((await snapshot()).settings.runtimeUILayout);
    const builtinTitleTypes = new Set(["main_menu_continue_button", "main_menu_start_button", "main_menu_save_load_button",
      "main_menu_gallery_button", "main_menu_settings_button", "main_menu_about_button"]);
    // The exporter omits ignored legacy title styles, preserving every explicit
    // style. This narrow canonicalization was independently checked against
    // the original completed download by the continuation tool.
    for (const screen of expectedSkin.screens) for (const component of screen.components)
      if (screen.screen_id === "title" && builtinTitleTypes.has(component.component_type)
        && component.titleButtonStyleSource !== "layout") delete component.style;
    assert.deepEqual(skin, expectedSkin);
    assert.equal(skin.layout_type, "renpy"); assert(!skin.profiles);
    const assets = [];
    for (const asset of manifest.assets) {
      const expected = report.assetProofs.find(a => a.id === asset.asset_id); assert(expected);
      const bytes = await game.file(asset.path).async("nodebuffer");
      assert.equal(A.sha256(bytes), expected.sha256); assets.push({ ...expected, path: asset.path });
    }
    assert(assets.length >= 6 && assets.length < 26, "Only actually referenced resources should be exported");
    report.cartridge = { ...desc(target), assets, layoutSha256: A.sha256(await game.file("ui/layout.json").async("nodebuffer")) };
    await host.shot("actual-installed-official-export");
    return report.cartridge;
  });
  assert.equal(report.steps.length, 8); assert(report.steps.every(row => row.status === "PASS"));
  assert.equal(report.matrix.length, 12); assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0);
  report.status = "EDITOR_PASS_NATIVE_PLAYER_NOT_RUN";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    await host.stop("finally"); if (prepared) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
    unchanged(); report.protectedFilesUnchanged = true;
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
async function cancelIfOpen() { if (await dialog().count()) await cancel(); }
