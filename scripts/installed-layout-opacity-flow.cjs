"use strict";
// Real installed Editor authoring/persistence/cartridge workflow.
// No store imports, injected layout state, native dialog mocks or model requests.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { until, ps } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Layout-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Installed-Layout-20261021-01";
const mode = process.argv[2] || "prepare", attempt = process.argv[3] || "01";
assert(["prepare", "editor", "resume", "material", "finish"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
function durableGraph(project) {
  // ReactFlow records measured pixel bounds after its first real render. These
  // are not authored graph changes; preserve all other node/edge fields.
  return {
    nodes: project.nodes.map(({ measured, selected, dragging, ...node }) => {
      // Portable serialization omits an empty opening-audio list; the current
      // renderer can materialize it as []. Non-empty queues remain exact.
      if (node.data?.nodeKind === "start" && (!Object.hasOwn(node.data, "openingAudio")
        || Array.isArray(node.data.openingAudio) && node.data.openingAudio.length === 0))
        return { ...node, data: { ...node.data, openingAudio: [] } };
      return node;
    }),
    edges: project.edges.map(({ selected, ...edge }) => edge),
  };
}
const sourceFiles = [
  "scripts/installed-layout-opacity-flow.cjs", "scripts/lib/installed-candidate-feature-session.cjs",
  "scripts/lib/current-native-capture.cjs", "scripts/lib/installed-acceptance.cjs",
  "plans/ACTIVE_TASKS.md", "plans/FULL_REGRESSION_20261017.md",
];
async function prepare() {
  assert(!fs.existsSync(qa) && !fs.existsSync(checkpoint));
  fs.mkdirSync(qa, { recursive: true }); fs.mkdirSync(checkpoint, { recursive: true });
  const snapshots = [];
  for (const relative of sourceFiles) {
    const src = path.join(root, relative), dst = path.join(checkpoint, relative);
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    assert.equal(sha(src), sha(dst)); snapshots.push(desc(dst));
  }
  const installation = read("F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json");
  assert.equal(installation.status, "PASS");
  const immutable = [installation.executable.path, path.join(installation.installRoot, "agentvn-player.exe"),
    path.join(installation.installRoot, "creator-backend.exe"), path.join(installation.installRoot, "build-versions.json"),
    "D:/AgentVN/AgentVN Dev.exe", ...installation.frozen.map(f => f.path),
    "C:/Users/1/AppData/Roaming/com.agentvn.editor/backend/vn_engine.db"].map(desc);
  const preparation = { status: "PASS", at: new Date().toISOString(), checkpoint, snapshots, immutable,
    installationEvidence: desc("F:/AgentVN/QA/Installed-Candidate-20261021-01/installation.json"),
    scope: "QA checkpoint only; does not rebuild or mutate product/profile/registration" };
  fs.writeFileSync(path.join(qa, "preparation.json"), JSON.stringify(preparation, null, 2), { flag: "wx" });
  console.log(`PASS checkpoint ${snapshots.length} files, ${immutable.length} product/user identities`);
}
async function editor() {
  const prep = read(path.join(qa, "preparation.json")); assert.equal(prep.status, "PASS");
  const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], launches: [], cleanups: [],
    errors: [], screenshots: [], modelRequests: 0, variants: [], matrix: [],
    scope: "ACTUAL_INSTALLED_1_9_13_LAYOUT_AUTHOR_SAVE_RESTART_UI_EXPORT_NOT_NATIVE_PICKER_OR_WINDOWS_SETUP",
    dataDirectoryOverride: true, webviewDirectoryOverride: true, sourceServer: false,
    graphComparisonExcludes: ["nodes.measured", "nodes.selected", "nodes.dragging", "edges.selected"],
    graphCanonicalDefaults: ["start-node openingAudio omitted and [] are equivalent; nonempty queues compared exactly"],
    playerConsumption: "NOT_RUN", nativePicker: "NOT_RUN", normalClose: "NOT_RUN", physical4K: false };
  const file = path.join(out, "report.json");
  const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2));
  const priorFile = mode === "finish" ? path.join(qa, "editor-09/report.json")
    : ["resume", "material"].includes(mode) ? path.join(qa, "editor-02/report.json") : null;
  const prior = priorFile ? read(priorFile) : null;
  const priorExportFile = mode === "resume" && Number(attempt) >= 7 ? path.join(qa, "editor-06/report.json") : null;
  const priorExport = priorExportFile ? read(priorExportFile) : null;
  if (prior) {
    assert.equal(prior.status, "FAILED");
    assert.equal(prior.steps.filter(s => s.status === "PASS").length, mode === "finish" ? 10 : 6);
    assert.equal(prior.steps.at(-1).label, mode === "finish"
      ? "renpy-real-ui-cartridge-export" : "agentvn-real-ui-cartridge-export");
    if (mode !== "finish") assert.match(prior.error, /package\.export/);
    assert.equal(prior.cleanupError, undefined);
    report.priorEditorReport = desc(priorFile);
    report.steps = prior.steps.filter(s => s.status === "PASS").map(s => ({
      ...s, evidenceSource: s.evidenceSource ?? report.priorEditorReport,
    }));
    report.matrix = prior.matrix;
    report.portable = prior.portable; report.nativeSaveSource = prior.nativeSaveSource;
    report.nativeSaveMessage = prior.nativeSaveMessage; report.downloadCleanup = prior.downloadCleanup;
    report.inheritedEvidenceNote = "Six completed same-candidate steps retained from editor-02, not rerun or relabeled as a new execution. Original export failure remains.";
    if (mode === "finish") {
      assert.equal(prior.materialPreparedViaRealAuthorUI, true);
      assert.equal(prior.variants.length, 1); assert.equal(prior.variants[0].type, "agentvn");
      report.materialPreparedViaRealAuthorUI = true; report.materialAuthoringSource = desc(priorFile);
      report.variants = prior.variants;
      report.incidentalEnvironmentChecks = prior.incidentalEnvironmentChecks;
      report.inheritedEvidenceNote = "Ten completed steps inherited with exact original evidence sources; only remaining Ren'Py export is executed here. Earlier failed reports are unchanged.";
    }
  }
  if (priorExport) {
    assert.equal(priorExport.status, "FAILED"); assert.equal(priorExport.cleanupError, undefined);
    assert.equal(priorExport.variants.length, 1); assert.equal(priorExport.variants[0].type, "agentvn");
    assert.equal(sha(priorExport.variants[0].cartridge.path), priorExport.variants[0].cartridge.sha256);
    report.priorExportReport = desc(priorExportFile);
    report.variants = priorExport.variants;
    report.incidentalEnvironmentChecks = priorExport.incidentalEnvironmentChecks;
  }
  const host = installedFeatureSession({ out, report, save,
    profileRoot: prior ? path.dirname(prior.launches[0].data) : out });
  let page, projectId, initial, expectedProfiles;
  const immutable = () => { for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path); };
  async function step(label, fn) {
    const s = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(s); save();
    try { s.result = await fn(); s.status = "PASS"; console.log(`PASS ${label}`); }
    catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; }
    finally { s.finishedAt = new Date().toISOString(); save(); }
  }
  async function hit(locator) {
    await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
    const r = await locator.evaluate(n => {
      const b = n.getBoundingClientRect(), h = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { rect: b.toJSON(), hit: n === h || n.contains(h), viewport: { width: innerWidth, height: innerHeight },
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(r.hit && r.overflow <= 1 && r.rect.x >= 0 && r.rect.y >= 0
      && r.rect.right <= r.viewport.width + 1 && r.rect.bottom <= r.viewport.height + 1);
    return r;
  }
  async function click(locator) { const r = await hit(locator); await locator.click(); return r; }
  const stored = () => host.api(`/api/project/projects/${projectId}`);
  async function open(type) {
    // The publishing workbench is intentionally full-screen. Close it through
    // its visible control before attempting a top-level navigation behind it.
    const close = page.locator('[data-help-key="package.close"]:visible');
    if (await close.count()) { await click(close); await close.waitFor({ state: "detached" }); await settleEditor(page); }
    await click(page.locator('[data-workspace-surface="options"]:visible'));
    await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await settleEditor(page);
    const button = page.locator(`[data-layout-type-option="${type}"]:visible`);
    if (await button.getAttribute("aria-pressed") !== "true") await click(button);
    await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await settleEditor(page);
  }
  async function title(type) {
    const sidebar = type === "renpy" ? page.locator(".renpy-title-editor .runtime-layout-sidebar") : page.locator(".runtime-layout-sidebar");
    await click(sidebar.getByRole("button", { name: "标题主页", exact: true }));
    const component = type === "renpy" ? page.getByTestId("renpy-page-region-editor").locator('[data-component-id="title_hero"]')
      : sidebar.locator('button[data-component-id="title_hero"]');
    await click(component);
    if (type === "agentvn") {
      const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^外观$/ }) });
      if (await details.getAttribute("open") === null) await details.locator("summary").click();
    } else {
      const preview = page.getByTestId("renpy-title-runtime-preview-toggle");
      if (await preview.getAttribute("aria-pressed") !== "true") await click(preview);
    }
  }
  async function saveLayout() {
    await click(page.locator('[data-help-key="layout.save"]:visible'));
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  }
  function styleOf(profiles, type) {
    return profiles.profiles[type].screens.find(s => s.screen_id === "title").components.find(c => c.component_id === "title_hero").style;
  }
  async function observe(type) {
    if (type === "agentvn") return page.locator(".runtime-layout-page-part.part-main_menu_hero").evaluate(n => ({
      background: Number(getComputedStyle(n.parentElement.querySelector(".part-main_menu_hero-background")).opacity),
      content: Number(getComputedStyle(n).opacity), previewKind: "AGENTVN_DIAGRAM_NOT_RUNTIME",
    }));
    await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor({ timeout: 45000 });
    const frame = await (await page.locator(".renpy-editor-runtime-viewport iframe").elementHandle()).contentFrame();
    await settleRuntime(frame);
    return frame.locator(".main-menu-title-hero-background").evaluate(n => ({
      background: Number(getComputedStyle(n).opacity),
      content: Number(getComputedStyle(n.closest(".renpy-title-view").querySelector(".renpy-title-heading")).opacity),
      previewKind: "ACTUAL_RUNTIME_IFRAME",
    }));
  }
  async function exportCartridge(type) {
    await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      // Publishing remembers its last stage (e.g. warning checks) across opens.
      // Enter the real settings stage before accessing its conditional fields.
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") {
        await click(settings); return false;
      }
      const format = page.locator('[data-help-key="package.mode"]');
      if (await format.count() && (await format.innerText()).includes(".vncart")) return true;
      const exportButton = page.locator('[data-help-key="package.export"]');
      return await exportButton.count()
        && ["passed", "failed"].includes(await exportButton.getAttribute("data-environment-status"));
    }, "actual environment operation terminal state (success or failure, not a fixed success dialog)", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      (report.incidentalEnvironmentChecks ??= []).push({ type, phase, text: await operation.innerText(),
        scope: "Observed only; cartridge export needs no Windows build environment; QA cache junction is active" });
      save();
      await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await operation.waitFor({ state: "detached" });
    }
    await click(page.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    // Homepage starter metadata is intentionally not publishable until an
    // author supplies a unique game ID. Use the real publishing controls.
    for (const [key, value] of [
      ["gameId", `qa_installed_opacity_${type}`], ["title", `安装版透明度验收 ${type}`],
      ["author", "AgentVN QA"], ["description", "隔离临时工程，验证两种布局的独立透明度与实际卡带消费。"],
    ]) await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await click(warnings);
    const confirm = page.locator('[data-help-key="package.confirmWarnings"]');
    if (await confirm.isVisible()) await confirm.check();
    const dir = path.join(out, `export-${type}`); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const trigger = page.locator('[data-help-key="package.export"]'); const geometry = await hit(trigger);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), trigger.click()]);
    const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
    const target = path.join(dir, name);
    await until(() => fs.existsSync(target) && !fs.existsSync(`${target}.crdownload`), "actual cartridge download", 60000);
    assert.equal(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
    const before = await stored(), profiles = before.editor_settings.runtimeUILayoutProfiles;
    assert.equal(profiles.activeType, type); assert.deepEqual(layout, profiles.profiles[type]);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    assert.equal(manifest.runtime_version, "0.23.0");
    const entries = Object.keys(zip.files); assert(!entries.includes("project.json"));
    const settings = before.editor_settings;
    assert.deepEqual(settings.runtimeUILayout, layout);
    return { type, cartridge: desc(target), geometry, layoutSha256: crypto.createHash("sha256").update(layoutBytes).digest("hex"),
      layout, manifest, currentProfileOnly: true, entryCount: entries.length };
  }
  try {
    immutable(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
    const cache = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Prepare", "-RunDirectory", out],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    fs.writeFileSync(path.join(out, "native-cache-prepare.log"), cache.stdout + cache.stderr, { flag: "wx" });
    assert.equal(cache.status, 0, cache.stdout + cache.stderr); report.nativeCacheProtection = "PASS"; save();
    if (prior) {
      projectId = prior.projectId; report.projectId = projectId;
      const zip = await JSZip.loadAsync(fs.readFileSync(prior.portable.path), { checkCRC32: true });
      assert.equal(sha(prior.portable.path), prior.portable.sha256);
      initial = JSON.parse(await zip.file("project.json").async("string"));
      expectedProfiles = initial.editor_settings.runtimeUILayoutProfiles;
      page = await host.start(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]')); await settleEditor(page);
      const current = await stored();
      assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
      assert.deepEqual(durableGraph(current), durableGraph(initial));
      report.resumedStateVerified = true; save();
    } else {
    await step("installed-home-create-isolated-project", async () => {
      page = await host.start(); await settleEditor(page);
      assert.equal(await page.locator('[data-help-key="home.recentProject"]').count(), 0);
      await click(page.locator('[data-help-key="home.createProject"]:visible').first());
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      await page.locator(".project-entry-loading-overlay").waitFor({ state: "detached" });
      const s = await host.api("/api/project/state"); projectId = s.project_metadata.projectId;
      assert(projectId); initial = await stored(); report.projectId = projectId; return { projectId, nodeCount: initial.nodes.length };
    });
    for (const [type, background, content] of [["renpy", .5, .8], ["agentvn", .4, .7]]) {
      await step(`${type}-actual-author-controls-and-save`, async () => {
        const other = type === "agentvn" ? "renpy" : "agentvn";
        const before = (await stored()).editor_settings.runtimeUILayoutProfiles?.profiles[other];
        await open(type); await title(type);
        // The AgentVN diagram can show an empty background layer even when no
        // material is configured; Player intentionally omits that empty layer.
        // The material continuation configures it through the actual control.
        if (type === "renpy") await page.getByLabel("页面背景色", { exact: true }).fill("#24384c");
        await page.getByLabel("页面背景不透明度", { exact: true }).fill(String(background));
        await page.getByLabel("页面内容不透明度", { exact: true }).fill(String(content));
        const shown = await observe(type); assert.equal(shown.background, background); assert.equal(shown.content, content);
        await page.getByLabel("页面内容不透明度", { exact: true }).fill("0.3");
        const changed = await observe(type); assert.equal(changed.background, background); assert.equal(changed.content, .3);
        await page.getByLabel("页面内容不透明度", { exact: true }).fill(String(content)); await saveLayout();
        const after = await stored(), profiles = after.editor_settings.runtimeUILayoutProfiles;
        assert.equal(styleOf(profiles, type).backgroundOpacity, background);
        assert.equal(styleOf(profiles, type).contentOpacity, content);
        if (before) assert.deepEqual(profiles.profiles[other], before);
        assert.deepEqual(durableGraph(after), durableGraph(initial));
        await host.shot(`author-${type}`);
        return { shown, changed, otherProfileUnchanged: true, graphUnchanged: true };
      });
    }
    await step("two-profile-controls-12-display-combinations", async () => {
      expectedProfiles = (await stored()).editor_settings.runtimeUILayoutProfiles;
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced, status: "RUNNING", types: [] };
        report.matrix.push(m); save(); await host.metrics(m);
        for (const [type, background, content] of [["agentvn", .4, .7], ["renpy", .5, .8]]) {
          await open(type); await title(type);
          const shown = await observe(type); assert.equal(shown.background, background); assert.equal(shown.content, content);
          const controls = [];
          for (const label of ["页面背景不透明度", "页面内容不透明度"])
            controls.push({ label, ...await hit(page.getByLabel(label, { exact: true })) });
          m.types.push({ type, shown, controls });
        }
        if (width === 3840 && dpr === 2 && reduced) await host.shot("author-4k-dpr2-reduce", m);
        m.status = "PASS"; save(); console.log(`PASS installed author ${width}/${dpr}/${reduced}`);
      }
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      // Switching changes activeType by design; neither saved profile may change.
      assert.deepEqual((await stored()).editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
      return { combinations: report.matrix.length, typeVisits: report.matrix.reduce((n, m) => n + m.types.length, 0) };
    });
    await step("native-default-download-save-both-profiles-and-original-bytes", async () => {
      await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
      const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
      assert(path.isAbsolute(downloads));
      const before = new Set(fs.readdirSync(downloads));
      await click(page.locator('[data-help-key="toolbar.saveProject"]'));
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      report.nativeSaveMessage = await dialog.locator("p").innerText();
      const created = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj"));
      assert.equal(created.length, 1);
      const source = path.join(downloads, created[0]); assert(report.nativeSaveMessage.includes(source));
      const target = path.join(out, "installed-layout-test.vnproj");
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(source), sha(target));
      report.nativeSaveSource = desc(source); report.portable = desc(target); save();
      report.nativeSaveGeneratedInThisAttempt = true;
      const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
      const project = JSON.parse(await zip.file("project.json").async("string"));
      assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
      assert.deepEqual(durableGraph(project), durableGraph(initial));
      assert(!JSON.stringify(project).includes(out), "Portable project must not leak machine QA paths");
      await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      return { portable: report.portable, nativeSaveSource: report.nativeSaveSource, graphUnchanged: true, bothProfiles: true };
    });
    await step("real-process-restart-reopen-retains-profiles", async () => {
      await host.stop("Persistence restart; identity-checked termination, not normal close");
      page = await host.start(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]')); await settleEditor(page);
      const after = await stored();
      assert.deepEqual(after.editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
      assert.deepEqual(durableGraph(after), durableGraph(initial));
      return { projectId, profilesPreserved: true, graphPreserved: true };
    });
    }
    if (mode === "material") {
      await step("agentvn-real-background-material-author", async () => {
        const before = await stored();
        await open("agentvn"); await title("agentvn");
        const color = page.locator("label").filter({ hasText: /^backgroundColor$/ }).locator('input:not([type="color"])');
        // Appearance fields mount lazily after opening the real disclosure.
        // Wait for the actual field, not an arbitrary delay or initial count.
        await color.waitFor({ state: "visible" });
        assert.equal(await color.count(), 1);
        await color.fill("#24384c"); await saveLayout();
        const current = await stored(); expectedProfiles = current.editor_settings.runtimeUILayoutProfiles;
        assert.equal(styleOf(expectedProfiles, "agentvn").backgroundColor, "#24384c");
        assert.equal(styleOf(expectedProfiles, "agentvn").backgroundOpacity, .4);
        assert.equal(styleOf(expectedProfiles, "agentvn").contentOpacity, .7);
        assert.deepEqual(expectedProfiles.profiles.renpy, before.editor_settings.runtimeUILayoutProfiles.profiles.renpy);
        assert.deepEqual(durableGraph(current), durableGraph(initial));
        report.materialPreparedViaRealAuthorUI = true;
        await host.shot("agentvn-real-background-material");
        return { field: "backgroundColor", value: "#24384c", otherProfileUnchanged: true };
      });
      await step("material-real-native-portable-save", async () => {
        await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
        const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
        const before = new Set(fs.readdirSync(downloads));
        await click(page.locator('[data-help-key="toolbar.saveProject"]'));
        const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
        const message = await dialog.locator("p").innerText();
        const created = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj"));
        assert.equal(created.length, 1);
        const source = path.join(downloads, created[0]); assert(message.includes(source));
        const target = path.join(out, "installed-layout-test.vnproj");
        fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(source), sha(target));
        report.previousPortable = report.portable; report.nativeSaveSource = desc(source); report.portable = desc(target);
        report.nativeSaveMessage = message; report.nativeSaveGeneratedInThisAttempt = true;
        delete report.downloadCleanup; save();
        const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
        const packed = JSON.parse(await zip.file("project.json").async("string"));
        assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
        assert.deepEqual(durableGraph(packed), durableGraph(initial));
        await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
        return { portable: report.portable, bothProfilesPreserved: true };
      });
      await step("material-real-process-restart-restores-background", async () => {
        await host.stop("Persist new actual background material, forced ownership-checked restart");
        page = await host.start(); await settleEditor(page);
        await click(page.locator('[data-help-key="home.recentProject"]')); await settleEditor(page);
        const current = await stored();
        assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles, expectedProfiles.profiles);
        assert.deepEqual(durableGraph(current), durableGraph(initial));
        return { bothProfilesPreserved: true, graphPreserved: true };
      });
    }
    for (const type of ["agentvn", "renpy"]) {
      if (mode === "finish" && report.variants.some(v => v.type === type)) continue;
      if (priorExport?.variants.some(v => v.type === type)) {
        const originalStep = priorExport.steps.find(s => s.label === `${type}-real-ui-cartridge-export`);
        assert.equal(originalStep.status, "PASS");
        report.steps.push({ ...originalStep, evidenceSource: report.priorExportReport }); save();
        continue;
      }
      await step(`${type}-real-ui-cartridge-export`, async () => {
      await open(type); await title(type); await saveLayout();
      const result = await exportCartridge(type); report.variants.push(result); save(); return result;
      });
    }
    assert.equal(report.steps.length, ["material", "finish"].includes(mode) ? 11 : 8); assert.equal(report.variants.length, 2);
    assert.equal(report.matrix.length, 12); assert(report.matrix.every(m => m.status === "PASS" && m.types.length === 2));
    assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
    report.status = "EDITOR_PASS_PLAYER_NOT_RUN";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(error => { report.failureScreenshotError = String(error); });
    }
  } finally {
    try {
      await host.stop("End of installed layout authoring workflow"); immutable();
      report.immutable = { status: "PASS", files: prep.immutable };
      if (report.nativeCacheProtection === "PASS") {
        const cache = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Restore", "-RunDirectory", out],
        { encoding: "utf8", windowsHide: true, timeout: 30000 });
        fs.writeFileSync(path.join(out, "native-cache-restore.log"), cache.stdout + cache.stderr, { flag: "wx" });
        assert.equal(cache.status, 0, cache.stdout + cache.stderr);
        report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      }
      if (report.nativeSaveSource && (report.nativeSaveGeneratedInThisAttempt || !prior)) {
        const source = report.nativeSaveSource, copy = report.portable;
        assert.equal(sha(source.path), source.sha256); assert.equal(sha(copy.path), source.sha256);
        assert.equal(path.extname(source.path), ".vnproj");
        ps(`Remove-Item -LiteralPath '${source.path.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
        assert(!fs.existsSync(source.path));
        report.downloadCleanup = { status: "PASS", removedOwnedTestFile: source.path, retainedCopy: copy, deletedUserFiles: 0 };
      }
    }
    catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(mode === "prepare" ? prepare() : editor()).catch(e => { console.error(e); process.exitCode = 1; });
