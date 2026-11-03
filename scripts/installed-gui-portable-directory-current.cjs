"use strict";
// QA only: fresh DB native portable import, native GUI directory scan/library,
// selective parameter application, save/restart and UI cartridge export.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawn, spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = path.resolve(process.env.AGENTVN_INSTALLED_GUI_QA_ROOT || "");
assert(process.env.AGENTVN_INSTALLED_GUI_QA_ROOT, "Explicit owned QA root required");
const sourceAttempt = process.argv[2], attempt = process.argv[3];
assert.match(sourceAttempt, /^\d{2}$/); assert.match(attempt, /^\d{2}$/);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const desc = file => ({ path: path.resolve(file), sha256: hash(fs.readFileSync(file)),
  bytes: fs.statSync(file).size, generatedAt: fs.statSync(file).mtime.toISOString() });
const sourceFile = path.join(qa, `editor-${sourceAttempt}/report.json`), source = read(sourceFile);
assert.equal(source.status, "EDITOR_PASS_PLAYER_NOT_RUN");
const prep = read(path.join(qa, "preparation.json"));
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_FRESH_DB_NATIVE_PORTABLE_IMPORT_AND_OFFICIAL_DIRECTORY_LIBRARY_APPLY_SAVE_EXPORT",
  source: desc(sourceFile), steps: [], matrix: [], launches: [], cleanups: [], nativeInputs: [],
  errors: [], screenshots: [], modelRequests: 0, normalClose: "NOT_RUN", WindowsSetup: "NOT_RUN", Android: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const input = path.join(out, "独立导入 完整官方GUI.vnproj");
assert.equal(desc(source.portable.path).sha256, source.portable.sha256);
fs.copyFileSync(source.portable.path, input, fs.constants.COPYFILE_EXCL);
const host = installedFeatureSession({ out, report, save, testProject: input });
report.installation = host.installation;
assert.equal(host.installation.executable.sha256, source.installation.executable.sha256);
const matrices = [];
for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
  matrices.push({ width, height: width * 9 / 16, dpr, reduced });
let page, packed, cacheProtected = false;
const stored = () => host.api(`/api/project/projects/${prep.projectId}`);
const content = ({ updated_at, ...p }) => p;
const graph = p => ({ nodes: p.nodes.map(({ measured, selected, dragging, ...n }) => n),
  edges: p.edges.map(({ selected, ...e }) => e) });
const libraryDir = path.join(out, "data/gui-pack-library");
const libraryFiles = () => fs.existsSync(libraryDir)
  ? fs.readdirSync(libraryDir).sort().map(name => {
    const folder = path.join(libraryDir, name);
    assert(fs.lstatSync(folder).isDirectory() && !fs.lstatSync(folder).isSymbolicLink());
    const record = desc(path.join(folder, "record.json"));
    assert.equal(read(record.path).id, read(path.join(folder, "summary.json")).id);
    return record;
  }) : [];
const immutable = () => { for (const f of prep.immutable) assert.equal(desc(f.path).sha256, f.sha256); };
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function step(label, body) {
  const row = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  console.log(`START ${label}`);
  try { row.result = await body(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); }
}
async function native(trigger, name, selectedPath, file = false, cancel = false) {
  assert.equal(await trigger.count(), 1, "Resolve one actual native-picker trigger before launching its helper");
  const request = { requestId: crypto.randomUUID(), name, ownerPid: host.current.pid, selectedPath, file, cancel };
  const evidence = path.join(out, `native-${name}.json`);
  // Wait for the actual owned OS dialog in parallel with its UI trigger.
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts/gui-directory-picker-uia.ps1"),
    "-OwnerPid", String(request.ownerPid), "-ReportPath", evidence, "-TitlePattern",
    file ? "^选择 AgentVN 工程文件$" : "^选择 Ren’Py GUI 资源目录$"];
  if (selectedPath) args.push("-Directory", selectedPath);
  if (file) args.push("-File");
  if (cancel) args.push("-Cancel");
  const nativeResult = new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", d => { output += d; }); child.stderr.on("data", d => { output += d; });
    child.on("error", reject); child.on("exit", code => resolve({ code, output }));
  });
  const clickResult = trigger.click();
  const [result] = await Promise.all([nativeResult, clickResult]);
  const receipt = fs.existsSync(evidence) ? read(evidence) : null;
  report.nativeInputs.push({ request, result, receipt, evidence }); save();
  assert.equal(result.code, 0, result.output); assert.equal(receipt.status, "PASS");
  assert.equal(receipt.ownerPid, request.ownerPid); assert.equal(receipt.cancel, cancel);
  if (!cancel) assert.equal(path.resolve(receipt.directory), path.resolve(selectedPath));
  return receipt;
}
async function openLayout() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
  await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
}
async function saveLayout() {
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
}
async function proofs(project) {
  const proofs = [];
  for (const asset of project.asset_manifest) {
    const expected = source.assetProofs.find(a => a.id === asset.asset_id); assert(expected);
    const bytes = await A.assetBytes(host.current.ports[0], asset); assert.equal(hash(bytes), expected.sha256);
    proofs.push({ ...expected, bytes: bytes.length });
  }
  assert.equal(proofs.length, source.assetProofs.length); return proofs;
}
const dialog = () => page.getByTestId("renpy-gui-import-dialog");
async function openLibrary() {
  await page.getByTestId("renpy-gui-import-open").click(); await dialog().waitFor();
}
async function cancelDialog() {
  await dialog().getByRole("button", { name: "取消，不修改工程", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
}
(async () => {
  immutable(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  const portable = await JSZip.loadAsync(fs.readFileSync(input), { checkCRC32: true });
  packed = JSON.parse(await portable.file("project.json").async("string"));
  assert.equal(packed.asset_manifest.length, 26);
  cache("Prepare"); cacheProtected = true;
  await step("fresh-database-native-portable-import-both-layouts-26-real-assets", async () => {
    assert(!fs.existsSync(path.join(out, "data"))); page = await host.start(); await A.settleEditor(page);
    assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 0);
    await native(page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true }),
      "portable-open", input, true);
    await page.locator(".editor-toolbar").waitFor({ timeout: 60000 }); await A.settleEditor(page);
    const current = await stored();
    assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles, packed.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(graph(current), graph(packed)); report.assetProofs = await proofs(current);
    assert.deepEqual(libraryFiles(), [], "Portable project must not auto-import machine-local GUI library");
    report.importedProject = current; report.portableImport = desc(input);
    await openLayout(); await host.shot("fresh-native-portable-import");
    return { independentDatabase: true, nativePicker: "Windows UI Automation", assets: report.assetProofs.length,
      bothLayouts: true, personalLibraryEmpty: true };
  });
  await step("reimported-layout-real-interactions-twelve-displays", async () => {
    for (const m of matrices) {
      await host.metrics(m); await A.settleEditor(page); await openLibrary();
      const geometry = await dialog().evaluate(n => {
        const r = n.getBoundingClientRect(), b = n.querySelector("footer button"), br = b.getBoundingClientRect();
        return { rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
          footerHit: b.contains(document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2)),
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
      });
      assert.equal(geometry.width, m.width); assert.equal(geometry.height, m.height);
      assert(Math.abs(geometry.dpr - m.dpr) < 1e-6); assert.equal(geometry.reduced, m.reduced);
      assert(geometry.rect.left >= 0 && geometry.rect.top >= 0 && geometry.rect.right <= m.width + 1
        && geometry.rect.bottom <= m.height + 1 && geometry.footerHit && geometry.overflow <= 1);
      await host.shot(`portable-layout-${m.width}-${m.dpr}-${m.reduced}`, m);
      await cancelDialog();
      assert.deepEqual((await stored()).editor_settings.runtimeUILayoutProfiles,
        packed.editor_settings.runtimeUILayoutProfiles);
      report.matrix.push({ ...m, geometry, status: "PASS" }); save();
    }
    await host.metrics(matrices[0]); return { matrix: report.matrix.length, actualClicks: true };
  });
  let directory;
  await step("complete-official-native-directory-cancel-and-scan-cancel", async () => {
    const sourceZip = await JSZip.loadAsync(fs.readFileSync(prep.officialArchive.path), { checkCRC32: true });
    assert.equal(hash(fs.readFileSync(prep.officialArchive.path)), prep.officialArchive.sha256);
    directory = path.join(out, "官方 GUI 中文目录"); fs.mkdirSync(directory);
    const prefix = "官方模板 中文/game/";
    for (const [name, entry] of Object.entries(sourceZip.files)) {
      if (entry.dir || !name.startsWith(prefix)) continue;
      const relative = name.slice(prefix.length); assert(relative && !relative.split("/").includes(".."));
      const target = path.join(directory, relative); assert(A.inside(directory, target));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await entry.async("nodebuffer"), { flag: "wx" });
    }
    const baseline = await stored(); await openLibrary();
    await native(dialog().getByRole("button", { name: "选择资源目录", exact: true }), "directory-cancel", undefined, false, true);
    assert.equal(await dialog().locator(".renpy-gui-import-summary").count(), 0);
    assert.deepEqual(content(await stored()), content(baseline)); await cancelDialog(); await openLibrary();
    await native(dialog().getByRole("button", { name: "选择资源目录", exact: true }), "directory-scan", directory);
    await dialog().locator(".renpy-gui-import-summary").waitFor();
    assert.equal(await dialog().locator(".renpy-gui-import-asset-row").count(), 25);
    await dialog().locator(".renpy-gui-import-license input").check();
    assert(await dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }).isEnabled());
    await host.shot("native-official-directory-scan"); await cancelDialog();
    assert.deepEqual(content(await stored()), content(baseline)); assert.deepEqual(libraryFiles(), []);
    return { originalArchive: prep.officialArchive, nativeDirectory: directory, assets: 25, cancelUnchanged: true };
  });
  await step("native-directory-library-commit-exact-25-official-bytes-no-project-write", async () => {
    const baseline = await stored(); await openLibrary();
    await native(dialog().getByRole("button", { name: "选择资源目录", exact: true }), "directory-library", directory);
    await dialog().locator(".renpy-gui-import-summary").waitFor();
    await dialog().getByLabel("资源包名称", { exact: true }).fill("完整官方目录 独立资源包");
    await dialog().locator(".renpy-gui-import-license input").check();
    await dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }).click();
    await dialog().getByRole("status").filter({ hasText: /已保存/ }).waitFor();
    const files = libraryFiles(); assert.equal(files.length, 1);
    const pack = read(files[0].path); assert.equal(pack.assetCount, 25);
    for (const asset of pack.scan.assets) {
      const expected = prep.officialFiles.find(f => f.relative === asset.path); assert(expected, asset.path);
      assert.equal(hash(Buffer.from(asset.bytesBase64, "base64")), expected.sha256);
    }
    report.directoryPack = { ...files[0], assets: pack.scan.assets.map(a => ({ path: a.path,
      sha256: hash(Buffer.from(a.bytesBase64, "base64")) })) };
    assert.deepEqual(content(await stored()), content(baseline));
    return { pack: files[0], assets: 25, projectUnchanged: true };
  });
  await step("directory-pack-selective-parameter-apply-keeps-26-assets-other-layout-graph", async () => {
    const baseline = await stored();
    await dialog().locator("article[data-pack-id]").getByRole("button", { name: "预览并选择应用", exact: true }).click();
    await dialog().locator(".renpy-gui-import-summary").waitFor();
    for (const row of await dialog().locator(".renpy-gui-import-asset-row").all()) {
      const sourcePath = await row.locator("strong").innerText();
      await A.select(page, `${sourcePath} 导入操作`, "跳过");
    }
    for (const box of await dialog().locator(".renpy-gui-import-row input[type=checkbox]").all()) await box.uncheck();
    await dialog().locator(".renpy-gui-import-row").filter({ hasText: "shared.x" }).getByRole("checkbox").check();
    await dialog().getByRole("button", { name: "确认应用到当前工程", exact: true }).click();
    await dialog().waitFor({ state: "detached" }); await saveLayout();
    const current = await stored();
    assert.equal(baseline.editor_settings.runtimeUILayout.renpy.shared.x, 56);
    assert.equal(current.editor_settings.runtimeUILayout.renpy.shared.x, 40);
    const expected = structuredClone(baseline.editor_settings);
    expected.runtimeUILayout.renpy.shared.x = 40;
    expected.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.x = 40;
    assert.deepEqual(current.editor_settings, expected);
    assert.deepEqual(graph(current), graph(baseline));
    assert.deepEqual(await proofs(current), report.assetProofs);
    report.finalProject = current;
    return { selectedX: 40, unchangedAssets: 26, otherLayoutAndSettingsUnchanged: true };
  });
  await step("native-save-real-package-restart-reopen-library-and-project-persist", async () => {
    await page.locator('[data-workspace-surface="edit"]:visible').click(); await A.settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads));
    await page.locator('[data-help-key="toolbar.saveProject"]').click();
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const created = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj")); assert.equal(created.length, 1);
    const downloaded = path.join(downloads, created[0]), retained = path.join(out, "目录应用后保存包.vnproj");
    fs.copyFileSync(downloaded, retained, fs.constants.COPYFILE_EXCL);
    report.nativeSaveSource = desc(downloaded); report.portable = desc(retained);
    const z = await JSZip.loadAsync(fs.readFileSync(retained), { checkCRC32: true });
    const project = JSON.parse(await z.file("project.json").async("string"));
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, report.finalProject.editor_settings.runtimeUILayoutProfiles);
    for (const a of project.asset_manifest)
      assert.equal(hash(await z.file(a.metadata.project_path).async("nodebuffer")),
        report.assetProofs.find(p => p.id === a.asset_id).sha256);
    await modal.getByRole("button", { name: "OK", exact: true }).click(); await modal.waitFor({ state: "detached" });
    await host.stop("Persistence restart; exact-owned termination, not normal-close claim");
    page = await host.start(); await A.settleEditor(page);
    await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: packed.title }).click();
    await A.settleEditor(page);
    const after = await stored();
    assert.deepEqual(after.editor_settings.runtimeUILayoutProfiles, report.finalProject.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(await proofs(after), report.assetProofs);
    assert.equal(libraryFiles()[0].sha256, report.directoryPack.sha256);
    return { nativePortable: report.portable, bothLayouts: true, assets: 26, libraryPersisted: true };
  });
  await step("actual-ui-cartridge-export-only-six-byte-exact-dependencies", async () => {
    await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
      const mode = page.locator('[data-help-key="package.mode"]');
      return await mode.count() && (await mode.innerText()).includes(".vncart");
    }, "real publish environment terminal", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.incidentalEnvironmentCheck = { phase, text: await operation.innerText(),
        scope: "QA cache active; not default-path release environment acceptance" };
      await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await operation.waitFor({ state: "detached" });
    }
    await page.locator('[data-package-stage="settings"]').click();
    await page.locator('[data-help-key="package.mode"]').click();
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", prep.projectId], ["title", "官方GUI目录与独立工程包验收"],
      ["author", "AgentVN QA"], ["description", "独立导入、目录扫描、选择性应用后的实际卡带。"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warning.isVisible()) await warning.click();
    const consent = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await consent.isVisible()) await consent.check();
    const downloads = path.join(out, "cartridge"); fs.mkdirSync(downloads);
    const cart = await A.realDownload(page, host.cdp, downloads, page.locator('[data-help-key="package.export"]'));
    const zip = await JSZip.loadAsync(fs.readFileSync(cart.path), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
    assert.deepEqual(layout, (await stored()).editor_settings.runtimeUILayout); assert.equal(layout.renpy.shared.x, 40);
    const assets = [];
    for (const a of manifest.assets) {
      const expected = report.assetProofs.find(p => p.id === a.asset_id); assert(expected);
      assert.equal(hash(await zip.file(a.path).async("nodebuffer")), expected.sha256); assets.push({ ...expected, path: a.path });
    }
    assert.equal(assets.length, 6);
    assert.deepEqual(assets.map(a => a.relative).sort(), source.cartridge.assets.map(a => a.relative).sort());
    report.cartridge = { ...cart, layoutSha256: hash(layoutBytes), assets, manifest, layout };
    await host.shot("native-directory-applied-export"); return { cartridge: report.cartridge, dependencies: 6 };
  });
  assert.equal(report.steps.length, 7); assert(report.steps.every(s => s.status === "PASS"));
  assert.equal(report.matrix.length, 12); assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "EDITOR_PASS_PLAYER_NOT_RUN";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(error => { report.screenshotError = String(error); });
  }
}).finally(async () => {
  try {
    await host.stop("End directory/portable checks; exact-owned cleanup"); immutable();
    if (cacheProtected) { cache("Restore"); report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json")); }
    if (report.nativeSaveSource) {
      assert.equal(desc(report.nativeSaveSource.path).sha256, report.portable.sha256);
      assert.equal(desc(report.portable.path).sha256, report.portable.sha256);
      ps(`Remove-Item -LiteralPath '${report.nativeSaveSource.path.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
      report.downloadCleanup = { status: "PASS", removed: report.nativeSaveSource.path, retained: report.portable, deletedUserFiles: 0 };
    }
    report.immutableStatus = "PASS";
  } catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
