"use strict";
// New 1.9.14 actual installation. Fresh author/save/restart/export workflow,
// with the previously failing real node iframe explicitly observed.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, settleRuntime } = require("./lib/installed-acceptance.cjs");
const { portraitObservation, verifyPortrait, verifyCustom, close } = require("./lib/portrait-installed-observation.cjs");
const { ps, until } = require("./lib/current-native-editor-session.cjs");
const root = path.resolve(__dirname, ".."), qa = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const portraitQa = "F:/AgentVN/QA/Installed-Portrait-20261021-01";
const attempt = process.argv[2] || "06"; assert.match(attempt, /^\d{2}$/);
// Keep the existing, strictly bounded native-cache protection helper unchanged.
const out = path.join(portraitQa, `editor-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = b => crypto.createHash("sha256").update(b).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const prep = read(path.join(portraitQa, "preparation.json")), fixture = read(prep.input.path);
assert.equal(sha(prep.input.path), prep.input.sha256);
const scene = fixture.nodes.find(n => n.data.nodeKind === "scene"); assert(scene);
const checkpoint = read(path.join(qa, "checkpoint-01/report.json"));
const report = { status: "RUNNING", startedAt: new Date().toISOString(), steps: [], cases: [], cartridges: [],
  launches: [], cleanups: [], screenshots: [], errors: [], modelRequests: 0, version: "1.9.14",
  input: prep.input, scope: "NEW_NSIS_INSTALL_AUTHOR_NODE_PREVIEW_SAVE_RESTART_UI_CARTRIDGE_EXPORT",
  notProven: ["Full display matrix on this install", "Windows standalone/setup", "Android", "Upgrade",
    "Native picker", "Normal close", "Physical 4K", "Full motion audit", "Source-workspace-independent machine"] };
report.executionInputs = ["scripts/lib/installed-release-session.cjs", "scripts/lib/portrait-installed-observation.cjs",
  "scripts/installed-layout-cache-session.ps1"].map(f => desc(path.join(root, f)));
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile: path.join(qa, "installation.json"), out, report, save, input: prep.input.path });
assert.equal(host.installation.executable.version, "1.9.14");
let page, initial, persisted, cacheProtected = false;
const labels = { offsetX: "头像水平偏移", offsetY: "头像垂直偏移", size: "头像尺寸" };
const values = prep.values;
const current = () => host.api(`/api/project/projects/${prep.projectId}`);
const protectedUnchanged = () => { for (const f of checkpoint.frozen) assert.equal(sha(f.path), f.sha256, f.path); };
const graph = p => ({ nodes: p.nodes.map(({ selected, measured, dragging, ...n }) => n), edges: p.edges.map(({ selected, ...e }) => e) });
async function step(label, fn) {
  const row = { label, status: "RUNNING" }; report.steps.push(row); save();
  try { row.result = await fn(); row.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; } finally { save(); }
}
async function click(n) {
  await n.scrollIntoViewIfNeeded(); await n.click({ trial: true });
  const g = await n.evaluate(n => {
    const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: h === n || n.contains(h), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(g.hit && g.overflow <= 1 && g.rect.left >= 0 && g.rect.top >= 0
    && g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1);
  await n.click(); return g;
}
async function open(type) {
  const close = page.locator('[data-help-key="package.close"]:visible');
  if (await close.count()) { await click(close); await close.waitFor({ state: "detached" }); }
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible')); await settleEditor(page);
  const b = page.locator(`[data-layout-type-option="${type}"]:visible`);
  if (await b.getAttribute("aria-pressed") !== "true") await click(b);
  await page.locator(`.runtime-layout-designer[data-layout-type="${type}"]`).waitFor();
  await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
  await settleEditor(page);
  const structured = page.getByTestId("renpy-player-layout-entry"); if (await structured.isVisible()) await click(structured);
  await click(page.locator('[data-help-key="layout.screen"]:visible').getByText("播放页", { exact: true })); await settleEditor(page);
  const controls = page.getByTestId("dialog-portrait-layout-editor"); await controls.waitFor();
  if (!await controls.evaluate(n => n.open)) await click(controls.locator("summary"));
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
  const frame = await (await page.locator(".renpy-editor-runtime-viewport iframe").elementHandle()).contentFrame();
  assert(frame); await settleRuntime(frame);
  return until(async () => {
    if (!await frame.locator('img[data-portrait-ready="true"]').count()) return false;
    const o = await portraitObservation(frame); verifyPortrait(o, prep.portraitSha256);
    if (config) verifyCustom(o, config);
    else close(o.image.right, o.speaker.left - 12 * o.scale * o.panelScale);
    return o;
  }, "actual authored portrait preview");
}
async function nodePreview(type, reduced, record = true) {
  const closeButton = page.locator('[data-help-key="package.close"]:visible');
  if (await closeButton.count()) { await click(closeButton); await closeButton.waitFor({ state: "detached" }); }
  await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
  const iframe = page.locator(".embedded-runtime-preview-frame iframe"); await iframe.waitFor();
  const owner = await iframe.evaluate(n => ({ title: n.title, ghost: !!n.closest(".toolbar-popover-morph-ghost"), rect: n.getBoundingClientRect().toJSON() }));
  assert.equal(owner.title, "GameCLI 内嵌预览"); assert.equal(owner.ghost, false);
  const frame = await (await iframe.elementHandle()).contentFrame(); assert(frame);
  await settleRuntime(frame); await frame.getByTestId("game-state-playing").waitFor();
  await frame.locator('img[data-portrait-ready="true"]').waitFor();
  const samples = await frame.evaluate(async () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const box = document.querySelector(".dialog-box"), text = document.querySelector(".dialog-text");
      if (!box || !text) throw Error("Node preview lost dialogue");
      rows.push({ pages: box.getAttribute("data-dialog-pages"), font: getComputedStyle(text).fontSize,
        width: text.clientWidth, height: text.clientHeight, scroll: [text.scrollWidth, text.scrollHeight],
        layout: box.closest("[data-layout-type]")?.getAttribute("data-layout-type"), text: text.textContent });
    }
    return rows;
  });
  assert.equal(new Set(samples.slice(-10).map(s => JSON.stringify(s))).size, 1);
  assert(samples.every(s => s.layout === type && s.scroll[0] <= s.width + 1 && s.scroll[1] <= s.height + 1));
  assert(samples.every(s => s.text === scene.data.scene.commands[0].text)); assert.deepEqual(report.errors, []);
  const value = { status: "PASS", type, reduced, owner, samples };
  if (record) report.cases.push(value); save();
  if (record && !reduced) await host.shot(`${type}-real-node-preview`);
  return value;
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
    const b = page.locator('[data-help-key="package.export"]');
    return await b.count() && ["passed", "failed"].includes(await b.getAttribute("data-environment-status"));
  }, "publishing ready or environment operation terminal", 60000);
  if (await operation.isVisible()) {
    const phase = await operation.getAttribute("data-environment-phase");
    (report.incidentalEnvironmentChecks ??= []).push({ phase, text: await operation.innerText(),
      scope: "QA cache Junction, not Windows environment or standalone export acceptance" }); save();
    await click(operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }));
    await operation.waitFor({ state: "detached" });
  }
  await click(page.locator('[data-package-stage="settings"]'));
  await click(page.locator('[data-help-key="package.mode"]')); await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  for (const [key, value] of [["gameId", prep.projectId], ["title", "头像布局安装版验收"],
    ["author", "AgentVN QA"], ["description", "1.9.14修复后独立安装版隔离小工程"]])
    await page.locator(`[data-help-key="package.${key}"]`).fill(value);
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true }); if (await warning.isVisible()) await click(warning);
  const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
  const dir = path.join(out, `cartridge-${type}`); fs.mkdirSync(dir);
  await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
  const [download] = await Promise.all([page.waitForEvent("download"), click(page.locator('[data-help-key="package.export"]'))]);
  const name = download.suggestedFilename(); assert.equal(path.basename(name), name); const target = path.join(dir, name);
  await until(() => fs.existsSync(target) && !fs.existsSync(target + ".crdownload"), "UI cartridge download", 60000);
  assert.equal(await download.failure(), null);
  const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true });
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  const bytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(bytes);
  assert.equal(layout.layout_type ?? "agentvn", type); assert.deepEqual(layout.dialogPortrait, values[type]);
  assert.deepEqual(layout, (await current()).editor_settings.runtimeUILayout);
  assert.equal(manifest.assets.length, 1); assert.equal(manifest.assets[0].asset_id, "qa_portrait");
  assert.equal(hash(await zip.file(manifest.assets[0].path).async("nodebuffer")), prep.portraitSha256);
  const result = { type, ...desc(target), layoutSha256: hash(bytes), layout, manifest,
    portraitSha256: prep.portraitSha256, assetPath: manifest.assets[0].path,
    scriptSha256: hash(await zip.file("script.json").async("nodebuffer")) };
  report.cartridges.push(result); save(); return result;
}
(async () => {
  protectedUnchanged(); fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Prepare", "-RunDirectory", out],
  { encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.equal(r.status, 0, r.stdout + r.stderr); cacheProtected = true;
  await step("fresh-packaged-import-real-home-and-node-selection", async () => {
    page = await host.start();
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(prep.input.path)) },
      body: fs.readFileSync(prep.input.path), signal: AbortSignal.timeout(30000) });
    const p = await r.json(); assert(r.ok && p.ok); assert.equal(p.data.project_id, prep.projectId);
    await page.reload(); await page.locator(".project-home").waitFor();
    await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title })); await settleEditor(page);
    await click(page.locator(`.react-flow__node[data-id="${scene.id}"]`)); await settleEditor(page);
    await open("agentvn"); await saveLayout();
    await until(async () => (await current()).nodes.find(n => n.data.nodeKind === "start")
      ?.data.loadingAnimation?.kind === "default", "hydration persisted before authoring");
    initial = await current(); return { projectId: prep.projectId, nativePickerClaimed: false };
  });
  await step("both-layout-author-default-custom-reset-undo-redo-and-node-stability", async () => {
    for (const type of ["agentvn", "renpy"]) {
      const controls = await open(type), baseline = await preview();
      for (const [key, label] of Object.entries(labels)) {
        const input = controls.getByRole("spinbutton", { name: label, exact: true });
        await input.fill(String(values[type][key])); await input.press("Tab");
      }
      const custom = await preview(values[type]);
      assert.deepEqual(custom.body, baseline.body); assert.deepEqual(custom.speaker, baseline.speaker);
      await click(controls.getByRole("button", { name: "恢复头像默认位置", exact: true })); await preview();
      await click(page.locator('[data-help-key="layout.undo"]:visible')); await preview(values[type]);
      await click(page.locator('[data-help-key="layout.redo"]:visible')); await preview();
      await click(page.locator('[data-help-key="layout.undo"]:visible')); await preview(values[type]); await saveLayout();
      assert.deepEqual((await current()).editor_settings.runtimeUILayout.dialogPortrait, values[type]);
      await nodePreview(type, false);
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: true });
      await open(type); await saveLayout(); await nodePreview(type, true);
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    }
    persisted = await current(); assert.deepEqual(graph(persisted), graph(initial));
    return { nodeFlows: 4, samplesEach: 30 };
  });
  await step("native-engine-package-write-both-layouts-exact-bytes", async () => {
    const downloads = ps("$s=New-Object -ComObject Shell.Application;$s.NameSpace('shell:Downloads').Self.Path");
    const before = new Set(fs.readdirSync(downloads));
    await click(page.locator('[data-help-key="toolbar.saveProject"]'));
    const modal = page.getByTestId("project-save-confirmation"); await modal.waitFor();
    const files = fs.readdirSync(downloads).filter(f => !before.has(f) && f.endsWith(".vnproj")); assert.equal(files.length, 1);
    const source = path.join(downloads, files[0]), target = path.join(out, "头像1.9.14双布局.vnproj");
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); assert.equal(sha(target), sha(source));
    report.nativeSaveSource = desc(source); report.portable = desc(target); save();
    assert((await modal.innerText()).includes(source));
    const zip = await JSZip.loadAsync(fs.readFileSync(target), { checkCRC32: true }), packed = JSON.parse(await zip.file("project.json").async("string"));
    assert.deepEqual(packed.editor_settings.runtimeUILayoutProfiles, persisted.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(graph(packed), graph(initial));
    assert.equal(hash(await zip.file(packed.asset_manifest[0].metadata.project_path).async("nodebuffer")), prep.portraitSha256);
    await click(modal.getByRole("button", { name: "OK", exact: true })); await modal.waitFor({ state: "detached" });
    return report.portable;
  });
  await step("actual-restart-and-independent-layout-reopen", async () => {
    await host.stop("Persistence restart, owned termination not normal close"); page = await host.start();
    await click(page.locator('[data-help-key="home.recentProject"]').filter({ hasText: prep.title })); await settleEditor(page);
    await click(page.locator(`.react-flow__node[data-id="${scene.id}"]`)); await settleEditor(page);
    assert.deepEqual((await current()).editor_settings.runtimeUILayoutProfiles, persisted.editor_settings.runtimeUILayoutProfiles);
    for (const type of ["agentvn", "renpy"]) { await open(type); await preview(values[type]); }
    return { realRestart: true, bothLayouts: true };
  });
  await step("two-real-ui-exports-original-failing-navigation", async () => {
    report.postExportNodeChecks = [];
    for (const type of ["agentvn", "renpy"]) {
      await open(type); await saveLayout(); await publish(type);
      report.postExportNodeChecks.push(await nodePreview(type, false, false)); save();
    }
    assert.equal(report.cartridges[0].scriptSha256, report.cartridges[1].scriptSha256);
    return { count: 2, sameStory: true };
  });
  assert.equal(report.steps.length, 5); assert(report.steps.every(s => s.status === "PASS"));
  assert.equal(report.cases.length, 4); assert.equal(report.cartridges.length, 2);
  assert.deepEqual(report.errors, []); assert.equal(report.modelRequests, 0); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureDOM = await page.locator("body").innerText().catch(String);
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false }).catch(() => {});
    await host.shot("failure").catch(e => { report.screenshotError = String(e); });
  }
}).finally(async () => {
  try {
    await host.stop("End new installed dialog regression"); protectedUnchanged();
    if (cacheProtected) {
      const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", "Restore", "-RunDirectory", out],
      { encoding: "utf8", windowsHide: true, timeout: 30000 });
      assert.equal(r.status, 0, r.stdout + r.stderr); report.nativeCacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
    }
    if (report.nativeSaveSource) {
      assert.equal(sha(report.nativeSaveSource.path), report.portable.sha256); assert.equal(sha(report.portable.path), report.portable.sha256);
      assert.equal(path.extname(report.nativeSaveSource.path), ".vnproj");
      ps(`Remove-Item -LiteralPath '${report.nativeSaveSource.path.replace(/'/g, "''")}' -Force -ErrorAction Stop`);
      assert(!fs.existsSync(report.nativeSaveSource.path));
      report.downloadCleanup = { status: "PASS", removed: report.nativeSaveSource.path, retained: report.portable, deletedUserFiles: 0 };
    }
  } catch (e) { report.status = "FAILED"; report.cleanupError = String(e.stack || e); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  const pointer = path.join(qa, `installed-flow-${attempt}.json`); assert(!fs.existsSync(pointer));
  fs.writeFileSync(pointer, JSON.stringify({ status: report.status, report: desc(path.join(out, "report.json")) }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
