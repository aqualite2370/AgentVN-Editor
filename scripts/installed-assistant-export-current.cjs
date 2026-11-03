"use strict";
// Real installed import/API fixture, actual homepage/publish UI and native asset reads.
// No new model task, no store writes; portable bytes are the previous real UI output.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, assetBytes } = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const currentCandidate = process.argv.includes("--candidate=1.9.22"), expectedVersion = currentCandidate ? "1.9.22" : "1.9.14";
const root = path.resolve(__dirname, ".."), qa = currentCandidate ?
  "F:/AgentVN/QA/Installed-Assistant-Export-1922-20261022-01" : "F:/AgentVN/QA/Installed-Assistant-Export-20261021-01";
const previous = currentCandidate ? "F:/AgentVN/QA/Installed-Assistant-Review-1922-20261022-01" :
  "F:/AgentVN/QA/Installed-Assistant-Review-20261021-01";
const release = "F:/AgentVN/QA/Runtime-Dialog-Release-20261021-01";
const installationFile = currentCandidate ?
  "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json" : path.join(release, "installation.json");
const attempt = process.argv[2] || "01"; assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `editor-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out, { recursive: true });
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size, generatedAt: fs.statSync(f).mtime.toISOString() });
const sourceFile = path.join(previous, "session-01/report.json"), source = read(sourceFile);
const audit = read(path.join(previous, currentCandidate ? "audit-01/report.json" : "audit-02/report.json"));
assert.equal(source.status, "PASS"); assert.equal(audit.status, "PASS"); assert.equal(audit.input.sha256, sha(sourceFile));
assert.equal(source.version, expectedVersion);
const input = source.projectArtifact; assert.equal(sha(input.path), input.sha256);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: expectedVersion, source: desc(sourceFile),
  input, steps: [], cases: [], screenshots: [], launches: [], cleanups: [], errors: [], modelRequests: 0,
  products: source.products, image: source.image,
  scope: "ACTUAL_NSIS_INSTALLED_PORTABLE_REIMPORT_REAL_UI_CARTRIDGE_EXPORT_NO_MODEL",
  notProven: ["Native picker", "Standalone/setup", "Android", "Upgrade", "Normal native close", "Real model"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, page, protectedCache = false, project;
function unchanged() {
  for (const f of [...report.products, report.source, input]) assert.equal(sha(f.path), f.sha256);
}
function cache(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out,
    ...(currentCandidate ? ["-CodexCacheView"] : [])],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
async function step(label, fn) {
  const s = { label, status: "RUNNING" }; report.steps.push(s); save(); console.log(`START ${label}`);
  try { s.result = await fn(); s.status = "PASS"; console.log(`PASS ${label}`); }
  catch (e) { s.status = "FAILED"; s.error = String(e.stack || e); throw e; } finally { save(); }
}
async function hit(locator) {
  await locator.scrollIntoViewIfNeeded(); await locator.click({ trial: true });
  const g = await locator.evaluate(n => {
    const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: h === n || n.contains(h), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(g.hit && g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= 0 && g.rect.top >= 0
    && g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1); return g;
}
async function click(n) { await hit(n); await n.click(); }
(async () => {
  unchanged(); save();
  const files = [__filename, "scripts/lib/installed-release-session.cjs", "scripts/installed-layout-cache-session.ps1",
    "scripts/lib/installed-controlled-provider-guard.cjs", "scripts/lib/current-native-capture.cjs"];
  report.tools = files.map(f => desc(path.resolve(root, f)));
  for (const f of files) fs.copyFileSync(path.resolve(root, f), path.join(out, path.basename(f)), fs.constants.COPYFILE_EXCL);
  cache("SelfTest"); protectedCache = true; cache("Prepare");
  if (currentCandidate) assert.equal(read(installationFile).version, expectedVersion);
  host = installedReleaseSession({ installationFile, out, report, save, input: input.path });
  await step("Actual installed import of native saved portable preserves both layouts, graph and all four library bytes", async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(input.path), { checkCRC32: true });
    project = JSON.parse(await zip.file("project.json").async("string"));
    assert.equal(project.project_id, source.baseline.id);
    assert.deepEqual(project.editor_settings.runtimeUILayoutProfiles, source.merged.settings.runtimeUILayoutProfiles);
    page = await host.start();
    const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input.path)) },
      body: fs.readFileSync(input.path), signal: AbortSignal.timeout(20000) });
    const imported = await r.json(); assert(r.ok && imported.ok); assert.equal(imported.data.project_id, project.project_id);
    await page.reload(); await click(page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }));
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
    const stored = await host.api(`/api/project/projects/${project.project_id}`);
    assert.deepEqual(stored.editor_settings.runtimeUILayoutProfiles, project.editor_settings.runtimeUILayoutProfiles);
    assert.deepEqual(stored.nodes.map(({ measured, ...n }) => n), project.nodes.map(({ measured, ...n }) => n));
    assert.deepEqual(stored.edges, project.edges); assert.equal(stored.asset_manifest.length, 4);
    const assets = [];
    for (const a of stored.asset_manifest) {
      const packed = project.asset_manifest.find(b => b.asset_id === a.asset_id); assert(packed);
      const bytes = await assetBytes(host.current.ports[0], a);
      assert.equal(hash(bytes), hash(await zip.file(packed.metadata.project_path).async("nodebuffer")));
      assert.equal(hash(bytes), report.image.sha256); assets.push({ id: a.asset_id, sha256: hash(bytes), bytes: bytes.length });
    }
    report.persisted = stored; report.reimportedAssets = assets;
    await host.shot("native-portable-reimported"); return { projectId: stored.project_id, assets: 4, bothProfiles: true };
  });
  await step("Real publishing selects vncart, confirms warnings and remains accessible in twelve display cases", async () => {
    await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
    const operation = page.getByTestId("package-environment-operation-dialog");
    await until(async () => {
      if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
      const settings = page.locator('[data-package-stage="settings"]');
      if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await click(settings); return false; }
      const mode = page.locator('[data-help-key="package.mode"]');
      if (await mode.count() && (await mode.innerText()).includes(".vncart")) return true;
      const exportButton = page.locator('[data-help-key="package.export"]');
      return await exportButton.count() && ["passed", "failed"].includes(await exportButton.getAttribute("data-environment-status"));
    }, "real publishing environment terminal", 60000);
    if (await operation.isVisible()) {
      const phase = await operation.getAttribute("data-environment-phase");
      report.incidentalEnvironment = { phase, text: await operation.innerText(),
        scope: "Real environment check under QA cache Junction; does NOT prove normal Windows package environment" }; save();
      await click(operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }));
      await operation.waitFor({ state: "detached" });
    }
    await click(page.locator('[data-package-stage="settings"]'));
    await click(page.locator('[data-help-key="package.mode"]'));
    await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
    for (const [key, value] of [["gameId", project.project_id], ["title", project.title],
      ["author", project.author], ["description", "本轮实际安装版审核合并的两个组件，原生工程包重导入后导出。"]])
      await page.locator(`[data-help-key="package.${key}"]`).fill(value);
    const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
    if (await warnings.isVisible()) await click(warnings);
    const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
    const button = page.locator('[data-help-key="package.export"]');
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await host.metrics(m);
      const geometry = await hit(button); await button.focus();
      assert(await button.evaluate(n => document.activeElement === n));
      report.cases.push({ ...m, viewport, geometry, focus: true, status: "PASS" }); save();
      if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
        await host.shot(`publish-${width}-${dpr}-${reduced}`);
    }
    await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
    return { cases: report.cases.length, actualModeSelection: ".vncart" };
  });
  await step("Actual UI download contains precisely two applied components and only their two active dependencies", async () => {
    const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
    await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
    const button = page.locator('[data-help-key="package.export"]'); await hit(button);
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
    const file = path.join(dir, name);
    await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "actual cartridge bytes", 60000);
    assert.equal(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
    const layoutBytes = await zip.file("ui/layout.json").async("nodebuffer"), layout = JSON.parse(layoutBytes);
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const scriptBytes = await zip.file("script.json").async("nodebuffer"), script = JSON.parse(scriptBytes);
    assert.deepEqual(layout, project.editor_settings.runtimeUILayout);
    assert.equal(layout.layout_type, "renpy"); assert.equal(manifest.game_id, project.project_id); assert.equal(manifest.title, project.title);
    const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
    assert.equal(components.length, 2); assert(!JSON.stringify(layout).includes("排除候选"));
    const expectedIds = components.map(c => c.customComponent.root.children.find(n => n.tag === "img").assetId).sort();
    assert.deepEqual(manifest.assets.map(a => a.asset_id).sort(), expectedIds);
    assert(!manifest.assets.some(a => ["private-project", "project-asset-1"].includes(a.asset_id)));
    const assets = [];
    for (const a of manifest.assets) {
      const bytes = await zip.file(a.path).async("nodebuffer"); assert.equal(hash(bytes), report.image.sha256);
      assets.push({ id: a.asset_id, path: a.path, sha256: hash(bytes), bytes: bytes.length });
    }
    assert(!zip.file("project.json")); assert(!JSON.stringify(manifest).includes("test-only-secret"));
    assert.equal(script.game_id, project.project_id);
    report.cartridge = { ...desc(file), layoutSha256: hash(layoutBytes), scriptSha256: hash(scriptBytes), layout, manifest, assets };
    await host.shot("real-ui-export-complete"); save(); return report.cartridge;
  });
  assert(report.steps.length === 3 && report.steps.every(s => s.status === "PASS"));
  assert.equal(report.cases.length, 12); assert.equal(report.modelRequests, 0); assert.deepEqual(report.errors, []);
  report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page && !page.isClosed()) {
    report.failureText = await page.locator("body").innerText().catch(String);
    await host.shot("failure").catch(e => { report.captureError = String(e); });
  }
}).finally(async () => {
  try {
    await host?.stop("End exact installed export host; not normal native close");
    if (protectedCache && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
      cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
      assert.equal(read(report.cacheRestoration.path).status, "PASS");
    }
    unchanged();
  } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
