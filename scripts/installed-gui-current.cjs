"use strict";
// Actual NSIS-installed Editor GUI authoring. Only the small project is seeded
// through the packaged backend API; no store writes, dialog mocks or model calls.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, select } = require("./lib/installed-acceptance.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, "..");
const qa = path.resolve(process.env.AGENTVN_INSTALLED_GUI_QA_ROOT
  || "F:/AgentVN/QA/Installed-GUI-20261021-01");
const checkpoint = path.resolve(process.env.AGENTVN_INSTALLED_GUI_CHECKPOINT_ROOT
  || "F:/AgentVN/Checkpoints/Installed-GUI-20261021-01");
const mode = process.argv[2] || "prepare", attempt = process.argv[3] || "01";
assert(["prepare", "editor", "resume"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
const prefix = "官方模板 中文/game/";
const bindings = {
  "gui/main_menu.png": "标题页主视觉", "gui/textbox.png": "对白面板背景",
  "gui/button/choice_idle_background.png": "分支选项按钮背景",
  "gui/button/quick_idle_background.png": "共享按钮 · 普通状态",
  "gui/button/quick_hover_background.png": "共享按钮 · 悬停/聚焦状态",
  "DejaVuSans.ttf": "全局界面字体",
};
const matrices = [];
for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
  matrices.push({ width, height: width * 9 / 16, dpr, reduced });
// Idempotent background persistence bumps this DB bookkeeping timestamp.
// Every authored field, graph entry, resource and layout remains compared.
function content({ updated_at, ...project }) { return project; }
function graph(p) {
  return { nodes: p.nodes.map(({ measured, selected, dragging, ...n }) => {
    if (n.data?.nodeKind === "start" && (!n.data.openingAudio || n.data.openingAudio.length === 0))
      return { ...n, data: { ...n.data, openingAudio: [] } };
    return n;
  }), edges: p.edges.map(({ selected, ...e }) => e) };
}
async function prepare() {
  assert(!fs.existsSync(qa)); assert(fs.existsSync(checkpoint));
  fs.mkdirSync(qa);
  const old = read("F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json");
  const officialArchive = desc("F:/AgentVN/QA/AgentVN-QA-InstalledGui-20261018-01/官方完整界面模板.zip");
  assert.equal(officialArchive.sha256, old.officialArchive.sha256);
  const zip = await JSZip.loadAsync(fs.readFileSync(officialArchive.path), { checkCRC32: true });
  for (const f of old.officialFiles) {
    assert(zip.file(prefix + f.relative), f.relative);
    assert.equal(hash(await zip.file(prefix + f.relative).async("nodebuffer")), f.sha256);
  }
  const project = fixture("installed-official-gui-20261021-01");
  project.schema_version = "1.1.0"; project.title = "安装版完整官方GUI临时工程";
  project.nodes[1].data.scene.commands = [
    { type: "dialog", character_id: "gui-speaker", text: "GUI_CONSUMPTION：完整官方资源，中文字体回退与实际对白面板。" },
    { type: "choice", choices: [
      { choice_id: "again", choice_display_name: "再次检查", text: "再次检查 GUI_REPEAT", target_scene_id: "ui_acceptance", conditions: [] },
      { choice_id: "also", choice_display_name: "继续检查", text: "继续检查 GUI_CONTINUE", target_scene_id: "ui_acceptance", conditions: [] },
    ] },
  ];
  project.editor_settings.characters = [{ character_id: "gui-speaker", name: "验收角色", aliases: [] }];
  const input = path.join(qa, "完整官方GUI隔离小工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
  const protectedFiles = read("F:/AgentVN/QA/Installed-Layout-20261021-01/preparation.json").immutable;
  const rebaseReference = process.env.AGENTVN_INSTALLED_GUI_REBASE_REFERENCE === "1";
  const immutable = protectedFiles.map(f => {
    if (rebaseReference) return desc(f.path);
    assert.equal(sha(f.path), f.sha256);
    return desc(f.path);
  });
  const sources = ["scripts/installed-gui-current.cjs", "scripts/lib/installed-candidate-feature-session.cjs",
    "scripts/installed-layout-cache-session.ps1"].map(f => {
    const target = path.join(checkpoint, "execution", f); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, f), target, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(target), sha(path.join(root, f))); return desc(target);
  });
  const prep = { status: "PASS", at: new Date().toISOString(), input: desc(input),
    projectId: project.project_id, officialArchive, officialFiles: old.officialFiles,
    officialProvenance: desc("F:/AgentVN/Checkpoints/GUI-Scope-20261019-01/manifest.json"),
    immutable, sources,
    referenceBaseline: rebaseReference ? "CURRENT_FILES_REHASHED_BEFORE_1_9_25_RUN" : "PINNED_REFERENCE",
    scope: "Small controlled legacy project fixture; no native project-picker claim" };
  fs.writeFileSync(path.join(qa, "preparation.json"), JSON.stringify(prep, null, 2), { flag: "wx" });
  console.log(`PASS prepare official ${old.officialFiles.length} entries, ${immutable.length} identities`);
}
async function editor() {
  const prep = read(path.join(qa, "preparation.json")); assert.equal(prep.status, "PASS");
  const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const file = path.join(out, "report.json");
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], launches: [],
    cleanups: [], screenshots: [], errors: [], modelRequests: 0, matrix: [],
    scope: "ACTUAL_INSTALLED_1_9_13_OFFICIAL_GUI_ZIP_AUTHOR_SAVE_RESTART_EXPORT",
    fixtureSeed: "CONTROLLED_PACKAGED_BACKEND_API_NOT_NATIVE_PROJECT_PICKER",
    cancelComparisonIgnores: ["top-level updated_at persistence bookkeeping only"],
    nativeDirectoryPicker: "NOT_RUN", normalClose: "NOT_RUN", WindowsSetup: "NOT_RUN", Android: "NOT_RUN" };
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
  const host = installedFeatureSession({ out, report, save, testProject: prep.input.path });
  report.scope = "ACTUAL_INSTALLED_OFFICIAL_GUI_ZIP_AUTHOR_SAVE_RESTART_EXPORT";
  report.installation = host.installation;
  let page, initial, currentProject, cacheProtected = false;
  const stored = () => host.api(`/api/project/projects/${prep.projectId}`);
  const unchanged = () => { for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path); };
  async function step(label, fn) {
    const s = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save();
    try { s.result = await fn(); s.status = "PASS"; console.log(`PASS ${label}`); }
    catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
    finally { s.finishedAt = new Date().toISOString(); save(); }
  }
  async function geometry(locator) {
    await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
    const g = await locator.evaluate(n => {
      const r = n.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: n === top || n.contains(top),
        viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(g.hit && g.overflow <= 1 && g.rect.width > 0 && g.rect.height > 0
      && g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= g.viewport.width + 1 && g.rect.bottom <= g.viewport.height + 1);
    return g;
  }
  async function click(n) { const g = await geometry(n); await n.click(); return g; }
  async function openLayout() {
    const close = page.locator('[data-help-key="package.close"]:visible');
    if (await close.count()) { await click(close); await close.waitFor({ state: "detached" }); }
    await click(page.locator('[data-workspace-surface="options"]:visible'));
    await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await settleEditor(page);
    const b = page.locator('[data-layout-type-option="renpy"]:visible');
    if (await b.getAttribute("aria-pressed") !== "true") await click(b);
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await settleEditor(page);
  }
  const dialog = () => page.getByTestId("renpy-gui-import-dialog");
  async function scan(file) {
    await click(page.getByTestId("renpy-gui-import-open")); await dialog().waitFor();
    await dialog().getByLabel("选择 Ren'Py（进阶）界面资源 ZIP", { exact: true }).setInputFiles(file);
    await dialog().locator(".renpy-gui-import-summary").waitFor();
    await until(async () => await dialog().locator(".renpy-gui-import-asset-row").count() === 25, "25 scanned real resources");
  }
  async function cancel() {
    await click(dialog().getByRole("button", { name: "取消，不修改工程", exact: true }));
    await dialog().waitFor({ state: "detached" });
  }
  async function saveLayout() {
    await click(page.locator('[data-help-key="layout.save"]:visible'));
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  }
  async function proofs(project) {
    const assets = [];
    for (const a of project.asset_manifest) {
      const tag = a.metadata.tags.find(t => t.startsWith("renpy_gui_path:")); assert(tag);
      const relative = tag.slice("renpy_gui_path:".length + prefix.length);
      const data = a.metadata.data_url;
      let bytes;
      if (data?.startsWith("data:")) bytes = Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
      else {
        const p = a.metadata.backend_asset_path; assert(p && !p.split(/[\\/]/).includes(".."));
        const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/assets/${p.split("/").map(encodeURIComponent).join("/")}`);
        assert(r.ok); bytes = Buffer.from(await r.arrayBuffer());
      }
      assets.push({ id: a.asset_id, relative, sha256: hash(bytes), bytes: bytes.length });
    }
    return assets;
  }
  async function portable() {
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads));
    await click(page.locator('[data-help-key="toolbar.saveProject"]'));
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const created = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj")); assert.equal(created.length, 1);
    const source = path.join(downloads, created[0]), target = path.join(out, "完整官方GUI保存包.vnproj");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(source), sha(target));
    report.nativeSaveSource = desc(source); report.portable = desc(target); save();
    assert((await modal.innerText()).includes(source));
    const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
    const packed = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles, currentProject.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(graph(packed), graph(initial)); assert.equal(packed.asset_manifest.length, report.assetProofs.length);
    for (const a of packed.asset_manifest)
      assert.equal(hash(await zip.file(a.metadata.project_path).async("nodebuffer")), report.assetProofs.find(p => p.id === a.asset_id).sha256);
    await click(modal.getByRole("button", { name: "OK", exact: true })); await modal.waitFor({ state: "detached" });
    return { portable: report.portable, originalSource: report.nativeSaveSource,
      verifiedAssets: report.assetProofs.length, bothProfiles: true };
  }
  try {
    unchanged(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
    const cache = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Prepare", "-RunDirectory", out],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(cache.status, 0, cache.stdout + cache.stderr); cacheProtected = true;
    report.nativeCacheProtection = desc(path.join(out, "native-cache-protection.json")); save();
    await step("controlled-project-seed-actual-installed-home-open", async () => {
      page = await host.start();
      const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(prep.input.path)) },
        body: fs.readFileSync(prep.input.path), signal: AbortSignal.timeout(30000) });
      const body = await response.json(); assert(response.ok && body.ok); assert.equal(body.data.project_id, prep.projectId);
      await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: "安装版完整官方GUI临时工程" }));
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await openLayout(); await saveLayout();
      // Legacy fixture hydration materializes the normal default opening
      // animation. Establish the persisted baseline before GUI authoring;
      // never ignore that field when comparing later import/reimport changes.
      await until(async () => (await stored()).nodes.find(n => n.data.nodeKind === "start")
        ?.data.loadingAnimation?.kind === "default", "hydrated default opening animation persisted");
      initial = await stored();
      return { projectId: prep.projectId, graph: graph(initial), baselineAfterLegacyHydration: true };
    });
    if (mode === "resume") {
      const previousFile = path.join(qa, "editor-02/report.json"), previous = read(previousFile);
      assert.equal(previous.status, "FAILED"); assert.equal(previous.cleanupError, undefined);
      assert.match(previous.error, /loadingAnimation/);
      const original = previous.steps.find(s => s.label === "complete-official-scan-cancel-12-displays");
      assert.equal(original.status, "PASS"); assert.equal(previous.matrix.length, 12);
      assert(previous.matrix.every(m => m.status === "PASS"));
      report.inheritedMatrix = desc(previousFile); report.matrix = previous.matrix;
      report.steps.push({ ...original, evidenceSource: report.inheritedMatrix });
      report.inheritedMatrixNote = "Same installed candidate, complete official ZIP and twelve completed scan/cancel displays; not rerun or relabeled as this execution.";
      save();
    } else {
    await step("complete-official-scan-cancel-12-displays", async () => {
      const baseline = await stored();
      for (const m of matrices) {
        await host.metrics(m); await settleEditor(page); await scan(prep.officialArchive.path);
        const issues = await dialog().getByRole("list").innerText();
        assert(issues.includes("unsupported_context") && issues.includes("unsupported_script"));
        await select(page, prefix + "gui/main_menu.png 游戏界面用途", bindings["gui/main_menu.png"]);
        await dialog().locator(".renpy-gui-import-license input").check();
        const g = await dialog().evaluate(n => {
          const r = n.getBoundingClientRect(), body = n.querySelector(".renpy-gui-import-body").getBoundingClientRect(),
            footer = n.querySelector("footer").getBoundingClientRect();
          return { rect: r.toJSON(), body: body.toJSON(), footer: footer.toJSON(),
            overflow: document.documentElement.scrollWidth - innerWidth, nativeSelects: n.querySelectorAll("select").length,
            buttons: [...n.querySelectorAll("footer button")].map(b => {
              const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return { text: b.textContent, rect: r.toJSON(), hit: b === hit || b.contains(hit) };
            }) };
        });
        assert(g.rect.left >= 0 && g.rect.top >= 0 && g.rect.right <= m.width + 1 && g.rect.bottom <= m.height + 1);
        assert(g.body.bottom <= g.footer.top + 1 && g.buttons.every(b => b.hit) && g.overflow <= 1 && g.nativeSelects === 0);
        const row = { ...m, status: "PASS", geometry: g, issues }; report.matrix.push(row); save();
        if (m.width === 1920 && m.dpr === 1 && !m.reduced || m.width === 3840 && m.dpr === 2 && m.reduced)
          await host.shot(`gui-scan-${m.width}-${m.dpr}-${m.reduced}`, m);
        await cancel(); assert.deepEqual(content(await stored()), content(baseline));
        console.log(`PASS installed GUI scan ${m.width}/${m.dpr}/${m.reduced}`);
      }
      assert.equal(report.matrix.length, 12);
      await host.metrics(matrices[0]); await settleEditor(page);
      return { matrix: 12, resourceRows: 25, cancelUnchanged: true };
    });
    }
    await step("real-apply-static-desktop-values-all-25-bytes-font-warning", async () => {
      const baseline = await stored(); await scan(prep.officialArchive.path);
      for (const box of await dialog().locator(".renpy-gui-import-row input[type=checkbox]").all()) await box.check();
      for (const [relative, label] of Object.entries(bindings)) await select(page, prefix + relative + " 游戏界面用途", label);
      await dialog().locator(".renpy-gui-import-license input").check();
      await click(dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }));
      await dialog().getByRole("status").filter({ hasText: /已保存/ }).waitFor();
      const importedPack = dialog().locator("article[data-pack-id]").first();
      await importedPack.waitFor();
      await click(importedPack.getByRole("button", { name: "预览并选择应用", exact: true }));
      await dialog().locator(".renpy-gui-import-summary").waitFor();
      await dialog().locator(".renpy-gui-import-license input").check();
      await click(dialog().getByRole("button", { name: "确认应用到当前工程", exact: true }));
      await dialog().waitFor({ state: "detached" });
      await saveLayout(); const current = await stored(), layout = current.editor_settings.runtimeUILayout;
      assert.equal(current.asset_manifest.length, 25);
      assert.equal(layout.renpy.shared.x, 40); assert.equal(layout.renpy.shared.fontSize, 22);
      assert.equal(layout.renpy.shared.spacing, 4); assert.equal(layout.renpy.save_load.saveColumns, 3);
      assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles.agentvn,
        baseline.editor_settings.runtimeUILayoutProfiles.profiles.agentvn);
      assert.deepEqual(graph(current), graph(initial));
      report.importedAssetProofs = await proofs(current);
      for (const a of report.importedAssetProofs) assert.equal(a.sha256, prep.officialFiles.find(f => f.relative === a.relative).sha256);
      await page.getByTestId("renpy-font-coverage-report").locator("strong", { hasText: "项目字符存在缺字" }).waitFor();
      const coverage = await page.getByTestId("renpy-font-coverage-report").innerText();
      assert(coverage.includes("回退到系统字体")); report.fontCoverage = coverage; report.importedProject = current; save();
      await host.shot("official-applied-font-warning");
      return { desktop: { fontSize: 22, spacing: 4, saveColumns: 3 }, assets: 25, fontCoverage: coverage };
    });
    await step("selective-reimport-cancel-id-preserved-other-layout-untouched", async () => {
      const before = await stored(), zip = await JSZip.loadAsync(fs.readFileSync(prep.officialArchive.path), { checkCRC32: true });
      const replacement = await zip.file(prefix + "gui/button/choice_hover_background.png").async("nodebuffer");
      zip.file(prefix + "gui/button/quick_idle_background.png", replacement);
      const gui = await zip.file(prefix + "gui.rpy").async("string"); assert(gui.includes("define gui.navigation_xpos = 40"));
      zip.file(prefix + "gui.rpy", gui.replace("define gui.navigation_xpos = 40", "define gui.navigation_xpos = 56"));
      const edited = path.join(out, "官方GUI人工修改.zip");
      fs.writeFileSync(edited, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), { flag: "wx" });
      report.reimportArchive = desc(edited); save();
      async function configure() {
        await scan(edited);
        for (const box of await dialog().locator(".renpy-gui-import-row input[type=checkbox]").all()) {
          if (await box.isChecked()) await box.uncheck();
        }
        for (const asset of await dialog().locator(".renpy-gui-import-asset-row").all()) {
          const source = await asset.locator("strong").innerText();
          await select(page, `${source} 导入操作`, "跳过");
        }
        assert((await dialog().getByRole("combobox", { name: prefix + "gui/main_menu.png 导入操作", exact: true }).innerText()).includes("跳过"));
        await select(page, prefix + "gui/button/quick_idle_background.png 导入操作", "收入资源包");
        await select(page, prefix + "gui/button/quick_idle_background.png 游戏界面用途", "共享按钮 · 普通状态");
        const row = dialog().locator(".renpy-gui-import-row").filter({ has: page.locator("span", { hasText: "shared.x" }) });
        await row.getByRole("checkbox").check(); await dialog().locator(".renpy-gui-import-license input").check();
      }
      await configure(); await cancel(); assert.deepEqual(content(await stored()), content(before));
      await configure();
      await click(dialog().getByRole("button", { name: "确认入库，不修改工程", exact: true }));
      await dialog().getByRole("status").filter({ hasText: /已保存/ }).waitFor();
      await click(dialog().locator("article[data-pack-id]").first()
        .getByRole("button", { name: "预览并选择应用", exact: true }));
      await dialog().locator(".renpy-gui-import-summary").waitFor();
      const xRow = dialog().locator(".renpy-gui-import-row").filter({ has: page.locator("span", { hasText: "shared.x" }) });
      if (!(await xRow.getByRole("checkbox").isChecked())) await xRow.getByRole("checkbox").check();
      await dialog().locator(".renpy-gui-import-license input").check();
      await click(dialog().getByRole("button", { name: "确认应用到当前工程", exact: true }));
      await dialog().waitFor({ state: "detached" }); await saveLayout();
      currentProject = await stored(); assert.equal(currentProject.asset_manifest.length, 26);
      assert.deepEqual(graph(currentProject), graph(initial));
      assert.equal(currentProject.editor_settings.runtimeUILayout.renpy.shared.x, 56);
      report.assetProofs = await proofs(currentProject);
      assert.equal(report.assetProofs.length, 26);
      const importedById = new Map(report.importedAssetProofs.map(asset => [asset.id, asset]));
      const added = report.assetProofs.filter(asset => !importedById.has(asset.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].relative, "gui/button/quick_idle_background.png");
      assert.equal(added[0].sha256, hash(replacement));
      const expectedNewButton = `asset:${added[0].id}`;
      assert.equal(currentProject.editor_settings.runtimeUILayout.renpy.shared.buttonImages.normal, expectedNewButton);
      assert.equal(currentProject.editor_settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonImages.normal,
        expectedNewButton);
      const a = structuredClone(before.editor_settings), b = structuredClone(currentProject.editor_settings);
      for (const settings of [a, b]) {
        settings.runtimeUILayout.renpy.shared.x = 0;
        settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.x = 0;
        settings.runtimeUILayout.renpy.shared.buttonImages.normal = "__selected-revision__";
        settings.runtimeUILayoutProfiles.profiles.renpy.renpy.shared.buttonImages.normal = "__selected-revision__";
      }
      assert.deepEqual(b, a);
      for (const asset of report.assetProofs) {
        const previous = importedById.get(asset.id);
        if (previous) assert.equal(asset.sha256, previous.sha256);
      }
      report.finalProject = currentProject; save();
      return { assetsBefore: 25, assetsAfter: 26, copiedRevisionAsset: added[0],
        selectedParameter: 56, otherValuesPreserved: true };
    });
    await step("native-portable-save-25-exact-bytes-two-profiles", portable);
    await step("process-restart-home-reopen-layout-assets-graph", async () => {
      await host.stop("Persistence restart; owned termination is not normal window close");
      page = await host.start(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: "安装版完整官方GUI临时工程" }));
      await settleEditor(page); const after = await stored();
      assert.deepEqual(after.editor_settings.runtimeUILayoutProfiles, currentProject.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual(graph(after), graph(initial)); assert.deepEqual(await proofs(after), report.assetProofs);
      return { bothProfiles: true, graphUnchanged: true, resourceBytes: report.assetProofs.length };
    });
    await step("actual-publish-cartridge-only-six-bound-resources", async () => {
      await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
      const operation = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
        const settings = page.locator('[data-package-stage="settings"]');
        if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await click(settings); return false; }
        const format = page.locator('[data-help-key="package.mode"]');
        if (await format.count() && (await format.innerText()).includes(".vncart")) return true;
        const button = page.locator('[data-help-key="package.export"]');
        return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
      }, "actual environment terminal state", 60000);
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        report.incidentalEnvironmentCheck = { phase, text: await operation.innerText(),
          scope: "QA cache Junction active; not normal-path environment or Windows package acceptance" }; save();
        await click(operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }));
        await operation.waitFor({ state: "detached" });
      }
      await click(page.locator('[data-package-stage="settings"]'));
      await click(page.locator('[data-help-key="package.mode"]'));
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      for (const [key, value] of [["gameId", prep.projectId], ["title", "完整官方GUI安装版消费验收"],
        ["author", "AgentVN QA"], ["description", "隔离小工程，完整资源与选择性重导入验证。"]])
        await page.locator(`[data-help-key="package.${key}"]`).fill(value);
      const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warning.isVisible()) await click(warning);
      const consent = page.locator('[data-help-key="package.confirmWarnings"]');
      if (await consent.isVisible()) await consent.check();
      const downloads = path.join(out, "cartridge"); fs.mkdirSync(downloads);
      await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, eventsEnabled: true });
      const trigger = page.locator('[data-help-key="package.export"]'); await geometry(trigger);
      const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
      const filename = download.suggestedFilename(); assert.equal(path.basename(filename), filename);
      const target = path.join(downloads, filename);
      await until(() => fs.existsSync(target) && !fs.existsSync(target + ".crdownload"), "actual cartridge download", 60000);
      assert.equal(await download.failure(), null);
      const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
      const current = await stored(); assert.deepEqual(layout, current.editor_settings.runtimeUILayout);
      assert.equal(manifest.game_id, prep.projectId); assert.equal(layout.layout_type, "renpy");
      assert(!zip.file("project.json") && !layout.profiles);
      const assets = [];
      for (const a of manifest.assets) {
        const p = report.assetProofs.find(p => p.id === a.asset_id); assert(p);
        assert.equal(hash(await zip.file(a.path).async("nodebuffer")), p.sha256);
        assets.push({ ...p, path: a.path });
      }
      assert.deepEqual(assets.map(a => a.relative).sort(), Object.keys(bindings).sort());
      report.cartridge = { ...desc(target), layoutSha256: hash(layoutBytes), assets, manifest, layout };
      await host.shot("actual-installed-export"); save();
      return { cartridge: report.cartridge, actualDependencies: 6 };
    });
    assert.equal(report.steps.length, 7); assert(report.steps.every(s => s.status === "PASS"));
    assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "EDITOR_PASS_PLAYER_NOT_RUN";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(e => { report.screenshotError = String(e); });
    }
  } finally {
    try {
      await host.stop("End GUI acceptance, exact-owned termination"); unchanged();
      if (cacheProtected) {
        const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Restore", "-RunDirectory", out],
        { encoding: "utf8", windowsHide: true, timeout: 30000 });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      }
      if (report.nativeSaveSource) {
        assert.equal(sha(report.nativeSaveSource.path), report.portable.sha256); assert.equal(sha(report.portable.path), report.portable.sha256);
        assert.equal(path.extname(report.nativeSaveSource.path), ".vnproj");
        ps(`Remove-Item -LiteralPath '${report.nativeSaveSource.path.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
        assert(!fs.existsSync(report.nativeSaveSource.path));
        report.downloadCleanup = { status: "PASS", deletedUserFiles: 0, removed: report.nativeSaveSource.path, retained: report.portable };
      }
      report.immutable = { status: "PASS", files: prep.immutable };
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(mode === "prepare" ? prepare() : editor()).catch(e => { console.error(e); process.exitCode = 1; });
