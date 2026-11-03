"use strict";
// NSIS-installed 1.9.13: real layout controls, native save, restart and UI export.
// Initial isolated fixture uses the real packaged import API, not a picker.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedFeatureSession } = require("./lib/installed-candidate-feature-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { portraitObservation, verifyPortrait, verifyCustom, close } = require("./lib/portrait-installed-observation.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const checkpoint = "F:/AgentVN/Checkpoints/Installed-Portrait-20261021-01";
const mode = process.argv[2] || "prepare", attempt = process.argv[3] || "01";
assert(["prepare", "editor", "resume"].includes(mode)); assert.match(attempt, /^\d{2}$/);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const values = { agentvn: { offsetX: -16, offsetY: -12, size: 48 }, renpy: { offsetX: -28, offsetY: -18, size: 44 } };
const labels = { offsetX: "头像水平偏移", offsetY: "头像垂直偏移", size: "头像尺寸" };
const matrix = [];
for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true])
  matrix.push({ width, height: width * 9 / 16, dpr, reduced });
function graph(project) {
  return { nodes: project.nodes.map(({ selected, measured, dragging, ...n }) => n),
    edges: project.edges.map(({ selected, ...e }) => e) };
}
async function prepare() {
  assert(!fs.existsSync(qa)); assert(fs.existsSync(checkpoint)); fs.mkdirSync(qa);
  const old = read(path.join(root, "output/dialog-portrait-authoring-20261020-01/preparation.json"));
  assert.equal(sha(old.input), old.inputSha256);
  const project = read(old.input); project.project_id = "installed-portrait-20261021-01";
  project.title = "安装版头像布局隔离小工程"; project.schema_version = "1.1.0";
  const input = path.join(qa, "头像布局隔离小工程.vnproj");
  fs.writeFileSync(input, JSON.stringify(project, null, 2), { flag: "wx" });
  const data = project.asset_manifest[0].metadata.data_url;
  const portraitSha256 = hash(Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
  assert.equal(portraitSha256, old.portraitSha256);
  const previous = read("F:/AgentVN/QA/Installed-GUI-20261021-01/preparation.json");
  const immutable = previous.immutable.map(f => { assert.equal(sha(f.path), f.sha256); return desc(f.path); });
  const prep = { status: "PASS", at: new Date().toISOString(), input: desc(input),
    fixtureSource: desc(old.input), projectId: project.project_id, title: project.title,
    portraitSha256, values, immutable, modelRequests: 0, sourceSeedNotNativePicker: true };
  for (const file of ["scripts/installed-portrait-current.cjs", "scripts/lib/portrait-installed-observation.cjs",
    "scripts/lib/installed-candidate-feature-session.cjs", "scripts/installed-layout-cache-session.ps1"]) {
    const target = path.join(checkpoint, "execution", file); fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), sha(path.join(root, file)));
  }
  fs.writeFileSync(path.join(qa, "preparation.json"), JSON.stringify(prep, null, 2), { flag: "wx" });
  console.log(`PASS portrait prepare ${prep.projectId}, immutable=${immutable.length}`);
}
async function editor() {
  const prep = read(path.join(qa, "preparation.json")); assert.equal(prep.status, "PASS");
  const predecessorFile = path.join(qa, "editor-02/report.json");
  const predecessor = mode === "resume" ? read(predecessorFile) : undefined;
  if (predecessor) {
    assert.equal(predecessor.status, "FAILED"); assert.match(predecessor.error, /undefined[\s\S]*agentvn/);
    assert.equal(predecessor.cleanupError, undefined); assert.equal(predecessor.steps.length, 6);
    assert(predecessor.steps.slice(0, 5).every(s => s.status === "PASS"));
    assert.equal(predecessor.matrix.length, 12); assert(predecessor.matrix.every(m => m.status === "PASS" && m.checks.length === 2));
  }
  const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], launches: [],
    cleanups: [], screenshots: [], errors: [], modelRequests: 0, matrix: [], cartridges: [],
    scope: "NSIS_INSTALLED_PORTRAIT_AUTHOR_SAVE_RESTART_EXPORT_NOT_FULL_REGRESSION",
    normalClose: "NOT_RUN", nativePicker: "NOT_RUN", WindowsSetup: "NOT_RUN", Android: "NOT_RUN" };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const host = installedFeatureSession({ out, report, save, testProject: prep.input.path,
    profileRoot: predecessor ? path.dirname(predecessor.launches[0].data) : out });
  async function startHost() {
    const currentPage = await host.start();
    if (!process.argv.includes("--trace-react")) return currentPage;
    const { runtimeRenderDiagnosticInit } = require("./lib/runtime-render-diagnostic.cjs");
    report.probeScope = "READ_ONLY_RUNTIME_FRAME_TRACE_NOT_PRODUCT_CHANGE";
    fs.copyFileSync(path.resolve(__dirname, "lib/runtime-render-diagnostic.cjs"),
      path.join(out, `runtime-render-diagnostic-${report.launches.length}.cjs`), fs.constants.COPYFILE_EXCL);
    await currentPage.context().addInitScript(runtimeRenderDiagnosticInit);
    await currentPage.exposeFunction("__portraitAuthorFrameError", value => {
      (report.frameErrors ??= []).push({ at: new Date().toISOString(), ...value }); save();
    });
    await currentPage.context().addInitScript(() => {
      addEventListener("error", event => {
        const owner = frameElement;
        void window.__portraitAuthorFrameError?.({ message: event.message, stack: event.error?.stack,
          url: location.href, trace: window.__agentvnRenderTrace,
          frameOwner: owner ? { title: owner.title, parentClass: owner.parentElement?.className,
            ghost: !!owner.closest(".toolbar-popover-morph-ghost"), rect: owner.getBoundingClientRect().toJSON() } : null });
      });
    });
    for (const name of ["frameattached", "framenavigated", "framedetached"]) currentPage.on(name, frame => {
      (report.frameLifecycle ??= []).push({ event: name, at: new Date().toISOString(), url: frame.url() }); save();
    });
    return currentPage;
  }
  const stored = () => host.api(`/api/project/projects/${prep.projectId}`);
  let page, initial, persisted, cacheProtected = false;
  const unchanged = () => { for (const f of prep.immutable) assert.equal(sha(f.path), f.sha256, f.path); };
  async function step(label, fn) {
    const item = { label, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(item); save();
    try { item.result = await fn(); item.status = "PASS"; console.log(`PASS ${label}`); }
    catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
    finally { item.finishedAt = new Date().toISOString(); save(); }
  }
  async function geometry(n) {
    await n.scrollIntoViewIfNeeded(); await n.click({ trial: true });
    const g = await n.evaluate(n => {
      const r = n.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: hit === n || n.contains(hit), width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(g.hit && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0
      && g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1);
    return g;
  }
  async function click(n) { const g = await geometry(n); await n.click(); return g; }
  async function open(type) {
    const closeButton = page.locator('[data-help-key="package.close"]:visible');
    if (await closeButton.count()) { await click(closeButton); await closeButton.waitFor({ state: "detached" }); }
    await click(page.locator('[data-workspace-surface="options"]:visible'));
    await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await settleEditor(page);
    const typeButton = page.locator(`[data-layout-type-option="${type}"]:visible`);
    if (await typeButton.getAttribute("aria-pressed") !== "true") await click(typeButton);
    await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await settleEditor(page);
    const structured = page.getByTestId("renpy-player-layout-entry"); if (await structured.isVisible()) await click(structured);
    await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true }));
    await settleEditor(page);
    const controls = page.getByTestId("dialog-portrait-layout-editor"); await controls.waitFor();
    if (!await controls.evaluate(n => n.open)) await click(controls.locator("summary"));
    await controls.getByRole("spinbutton", { name: labels.offsetX, exact: true }).waitFor();
    return controls;
  }
  async function saveLayout() {
    await click(page.locator('[data-help-key="layout.save"]:visible'));
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  }
  async function preview(config) {
    const toggle = page.getByRole("button", { name: "实际 Runtime 预览", exact: true });
    if (await toggle.isVisible()) await click(toggle);
    await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
    const frame = page.frames().find(f => f.url().includes("gamecli-preview")); assert(frame);
    await settleRuntime(frame);
    await until(async () => {
      if (!await frame.locator('img[data-portrait-ready="true"]').count()) return false;
      const o = await portraitObservation(frame); verifyPortrait(o, prep.portraitSha256);
      if (config) verifyCustom(o, config);
      else close(o.image.right, o.speaker.left - 12 * o.scale * o.panelScale);
      return o;
    }, "current portrait draft presentation");
    return { frame, observation: await portraitObservation(frame) };
  }
  async function nativeSave() {
    await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads));
    await click(page.locator('[data-help-key="toolbar.saveProject"]'));
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const files = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const source = path.join(downloads, files[0]), target = path.join(out, "头像双布局保存包.vnproj");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), sha(source));
    report.nativeSaveSource = desc(source); report.portable = desc(target); save();
    assert((await modal.innerText()).includes(source));
    const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
    const packed = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles, persisted.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(graph(packed), graph(initial)); assert.equal(packed.asset_manifest.length, 1);
    const asset = packed.asset_manifest[0]; assert.equal(asset.asset_id, "qa_portrait");
    assert.equal(hash(await zip.file(asset.metadata.project_path).async("nodebuffer")), prep.portraitSha256);
    await click(modal.getByRole("button", { name: "OK", exact: true })); await modal.waitFor({ state: "detached" });
    return { portable: report.portable, portraitSha256: prep.portraitSha256, bothProfiles: true };
  }
  async function publish(type) {
    await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await click(settings); return false; }
      const mode = page.locator('[data-help-key="package.mode"]');
      if (await mode.count() && (await mode.innerText()).includes(".vncart")) return true;
      const button = page.locator('[data-help-key="package.export"]');
      return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
    }, "actual publishing environment terminal", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.incidentalEnvironmentCheck = { phase, text: await operation.innerText(),
        scope: "QA protected cache Junction; not normal-path Windows environment acceptance" }; save();
      await click(operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }));
      await operation.waitFor({ state: "detached" });
    }
    await click(page.locator('[data-package-stage="settings"]'));
    await click(page.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", prep.projectId], ["title", "头像布局安装版验收"],
      ["author", "AgentVN QA"], ["description", "隔离小工程，专用对白头像布局。"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await click(warning);
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    const dir = path.join(out, `cartridge-${type}`); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const trigger = page.locator('[data-help-key="package.export"]'); await geometry(trigger);
    const [download] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
    const filename = download.suggestedFilename(); assert.equal(path.basename(filename), filename);
    const target = path.join(dir, filename);
    await until(() => fs.existsSync(target) && !fs.existsSync(target + ".crdownload"), "actual UI cartridge download", 60000);
    assert.equal(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
    assert.equal(layout.layout_type === undefined ? "agentvn" : layout.layout_type, type);
    assert.deepEqual(layout.dialogPortrait, values[type]);
    assert.deepEqual(layout, (await stored()).editor_settings.runtimeUILayout);
    assert.equal(manifest.runtime_version, "0.22.0"); assert.equal(manifest.assets.length, 1);
    const asset = manifest.assets[0]; assert.equal(asset.asset_id, "qa_portrait");
    assert.equal(hash(await zip.file(asset.path).async("nodebuffer")), prep.portraitSha256);
    const result = { type, ...desc(target), layoutSha256: hash(layoutBytes), layout, manifest,
      portraitSha256: prep.portraitSha256, assetPath: asset.path,
      scriptSha256: hash(await zip.file("script.json").async("nodebuffer")) };
    report.cartridges.push(result); save(); return result;
  }
  try {
    unchanged(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Prepare", "-RunDirectory", out],
    { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(r.status, 0, r.stdout + r.stderr); cacheProtected = true;
    if (predecessor) {
      report.inheritedEvidence = desc(predecessorFile);
      report.steps.push(...predecessor.steps.slice(0, 5).map(s => ({ ...s, evidenceSource: report.inheritedEvidence })));
      report.matrix = predecessor.matrix; report.author = predecessor.author;
      report.portable = predecessor.portable; report.nativeSaveSource = predecessor.nativeSaveSource;
      report.downloadCleanup = predecessor.downloadCleanup;
      initial = predecessor.initialProject; persisted = predecessor.finalProject;
      report.initialProject = initial; report.finalProject = persisted;
      assert.equal(sha(report.portable.path), report.portable.sha256); assert(!fs.existsSync(report.nativeSaveSource.path));
      save(); page = await startHost(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title })); await settleEditor(page);
      assert.deepEqual((await stored()).editor_settings.runtimeUILayoutProfiles.profiles,
        persisted.editor_settings.runtimeUILayoutProfiles.profiles);
    } else {
    await step("packaged-fixture-import-home-open-and-hydrated-baseline", async () => {
      page = await startHost();
      const response = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(prep.input.path)) },
        body: fs.readFileSync(prep.input.path), signal: AbortSignal.timeout(30000) });
      const body = await response.json(); assert(response.ok && body.ok); assert.equal(body.data.project_id, prep.projectId);
      await page.reload(); await page.locator(".project-home").waitFor(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title }));
      await settleEditor(page); await open("agentvn"); await saveLayout();
      await until(async () => (await stored()).nodes.find(n => n.data.nodeKind === "start")
        ?.data.loadingAnimation?.kind === "default", "default hydration persisted before authoring");
      initial = await stored(); report.initialProject = initial; save();
      return { id: prep.projectId, actualPackagedImport: true, baselineAfterHydration: true };
    });
    await step("both-layout-controls-default-custom-reset-undo-redo-real-preview", async () => {
      const result = {};
      for (const type of ["agentvn", "renpy"]) {
        const controls = await open(type), baseline = (await preview()).observation;
        const g = [];
        for (const [key, label] of Object.entries(labels)) {
          const input = controls.getByRole("spinbutton", { name: label, exact: true }); g.push(await geometry(input));
          await input.fill(String(values[type][key])); await input.press("Tab");
        }
        const custom = (await preview(values[type])).observation;
        assert.deepEqual(custom.body, baseline.body); assert.deepEqual(custom.speaker, baseline.speaker);
        await click(controls.getByRole("button", { name: "恢复头像默认位置", exact: true })); const reset = (await preview()).observation;
        close(reset.image.x, baseline.image.x); close(reset.image.y, baseline.image.y);
        await click(page.locator('[data-help-key="layout.undo"]:visible')); await preview(values[type]);
        await click(page.locator('[data-help-key="layout.redo"]:visible')); await preview();
        await click(page.locator('[data-help-key="layout.undo"]:visible')); await preview(values[type]); await saveLayout();
        const current = await stored(); assert.deepEqual(current.editor_settings.runtimeUILayout.dialogPortrait, values[type]);
        assert.deepEqual(graph(current), graph(initial)); assert.equal(current.asset_manifest[0].asset_id, "qa_portrait");
        if (type === "renpy") assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles.profiles.agentvn.dialogPortrait, values.agentvn);
        result[type] = { controls: g, baseline, custom, reset }; console.log(`PASS ${type} actual author/preview`);
      }
      report.author = result; return result;
    });
    await step("twelve-author-displays-real-input-undo-and-stable-preview", async () => {
      for (const m of matrix) {
        await host.metrics(m); await settleEditor(page);
        const item = { ...m, status: "RUNNING", checks: [] }; report.matrix.push(item); save();
        for (const type of ["agentvn", "renpy"]) {
          const controls = await open(type), g = [];
          for (const [key, label] of Object.entries(labels)) {
            const input = controls.getByRole("spinbutton", { name: label, exact: true });
            assert.equal(await input.inputValue(), String(values[type][key])); g.push(await geometry(input));
          }
          const input = controls.getByRole("spinbutton", { name: labels.offsetX, exact: true });
          await input.fill(String(values[type].offsetX - 2)); await input.press("Tab");
          await preview({ ...values[type], offsetX: values[type].offsetX - 2 });
          await click(page.locator('[data-help-key="layout.undo"]:visible'));
          const o = (await preview(values[type])).observation;
          item.checks.push({ type, status: "PASS", controls: g, preview: o });
        }
        item.status = "PASS"; save(); console.log(`PASS installed portrait author ${m.width}/${m.dpr}/${m.reduced}`);
        if (m.width === 1920 && m.dpr === 1 && !m.reduced || m.width === 3840 && m.dpr === 2 && m.reduced)
          await host.shot(`author-${m.width}-${m.dpr}-${m.reduced}`, m);
      }
      await host.metrics(matrix[0]); await settleEditor(page);
      persisted = await stored(); report.finalProject = persisted;
      for (const type of ["agentvn", "renpy"])
        assert.deepEqual(persisted.editor_settings.runtimeUILayoutProfiles.profiles[type].dialogPortrait, values[type]);
      assert.deepEqual(graph(persisted), graph(initial)); return { displays: 12, typeChecks: 24 };
    });
    await step("native-portable-both-profiles-and-exact-portrait-bytes", nativeSave);
    await step("actual-process-restart-home-reopen-and-independent-profiles", async () => {
      await host.stop("Persistence restart; owned termination not normal close"); page = await startHost(); await settleEditor(page);
      await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title })); await settleEditor(page);
      const current = await stored(); assert.deepEqual(current.editor_settings.runtimeUILayoutProfiles, persisted.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual(graph(current), graph(initial));
      for (const type of ["agentvn", "renpy"]) { await open(type); await preview(values[type]); }
      return { bothProfiles: true, realRestart: true };
    });
    }
    await step("two-actual-publishing-ui-cartridges-active-layout-and-portrait", async () => {
      for (const type of ["agentvn", "renpy"]) { await open(type); await saveLayout(); await publish(type); }
      assert.equal(report.cartridges[0].scriptSha256, report.cartridges[1].scriptSha256);
      return { cartridges: report.cartridges, identicalStoryScript: true };
    });
    assert.equal(report.steps.length, 6); assert(report.steps.every(s => s.status === "PASS"));
    assert.equal(report.matrix.length, 12); assert(report.matrix.every(m => m.status === "PASS" && m.checks.length === 2));
    if (process.argv.includes("--trace-react")) {
      report.finalFrameTraces = [];
      for (const frame of page.frames().filter(f => f.url().includes("/gamecli-preview/"))) {
        try { report.finalFrameTraces.push(await frame.evaluate(() => ({
          url: location.href, title: frameElement?.title, trace: window.__agentvnRenderTrace,
          ghost: !!frameElement?.closest(".toolbar-popover-morph-ghost"),
        }))); }
        catch (e) { report.finalFrameTraces.push({ transientDetachedFrame: String(e) }); }
      }
    }
    assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []); report.status = "EDITOR_PASS_PLAYER_NOT_RUN";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureDOM = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(e => { report.screenshotError = String(e); });
    }
  } finally {
    try {
      await host.stop("End installed portrait author acceptance"); unchanged();
      if (cacheProtected) {
        const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
          path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Restore", "-RunDirectory", out],
        { encoding: "utf8", windowsHide: true, timeout: 30000 });
        assert.equal(r.status, 0, r.stdout + r.stderr); report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      }
      if (report.nativeSaveSource && !predecessor) {
        assert.equal(sha(report.nativeSaveSource.path), report.portable.sha256); assert.equal(sha(report.portable.path), report.portable.sha256);
        assert.equal(path.extname(report.nativeSaveSource.path), ".vnproj");
        ps(`Remove-Item -LiteralPath '${report.nativeSaveSource.path.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
        assert(!fs.existsSync(report.nativeSaveSource.path));
        report.downloadCleanup = { status: "PASS", removed: report.nativeSaveSource.path, retained: report.portable, deletedUserFiles: 0 };
      }
      report.immutable = { status: "PASS", files: prep.immutable };
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  }
}
(mode === "prepare" ? prepare() : editor()).catch(e => { console.error(e); process.exitCode = 1; });
