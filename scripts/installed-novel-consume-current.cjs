"use strict";
// Installed, sealed Editor authoring -> native save/restart -> UI export. No model or frontend-store access.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const assert = require("node:assert/strict"), { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { DatabaseSync } = require("node:sqlite");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const { graphContent, cartridgeEvidence } = require("./native-novel-consume.cjs");
const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Installed-Novel-Default-1922-20261022-01";
const installationFile = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-38/derived-installation-receipt.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex"), sha = f => hash(fs.readFileSync(f));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size,
  generatedAt: fs.statSync(f).mtime.toISOString() });
function persistenceContent(actual, expected) {
  const a = structuredClone(actual), b = structuredClone(expected), changes = [];
  function timestamp(x, y, at) {
    assert.match(x.updatedAt, /^\d{4}-\d\d-\d\dT/); assert.match(y.updatedAt, /^\d{4}-\d\d-\d\dT/);
    assert(Date.parse(x.updatedAt) >= Date.parse(y.updatedAt));
    if (x.updatedAt !== y.updatedAt) changes.push({ path: at + ".updatedAt", before: y.updatedAt, after: x.updatedAt });
    delete x.updatedAt; delete y.updatedAt;
  }
  timestamp(a, b, "novelPersistence");
  for (const name of ["books", "chapters", "chunks", "jobs", "tasks"]) {
    assert.deepEqual(Object.keys(a[name]).sort(), Object.keys(b[name]).sort());
    for (const id of Object.keys(a[name])) timestamp(a[name][id], b[name][id], `novelPersistence.${name}.${id}`);
  }
  assert.deepEqual(a, b); return changes;
}
async function run(attempt) {
  assert.match(attempt, /^\d{2}$/);
  const out = path.join(qa, `session-${attempt}`); assert(!fs.existsSync(out)); fs.mkdirSync(out);
  const sourceFile = path.join(qa, "session-04/report.json"), source = read(sourceFile);
  const auditFile = path.join(qa, "audit-01/report.json"), audit = read(auditFile);
  assert.equal(source.status, "PASS"); assert.equal(source.version, "1.9.22"); assert.equal(audit.status, "PASS");
  assert.equal(source.cases.length, 4); assert(source.cases.every(c => c.status === "PASS"));
  assert.equal(source.bundles.length, 1);
  const input = source.bundles[0]; assert.equal(sha(input.path), input.sha256);
  const inputZip = await JSZip.loadAsync(fs.readFileSync(input.path), { checkCRC32: true });
  const project = JSON.parse(await inputZip.file("project.json").async("string"));
  assert.equal(project.project_id, "qa-installed-novel-default-1922-20261022-03");
  const novelNodes = project.nodes.filter(n => n.data.editorMeta?.importSessionId === source.completed.session.session_id);
  assert.equal(novelNodes.length, 1); assert.equal(novelNodes[0].data.editorMeta.graphImportMode, "append_isolated");
  assert(!project.edges.some(e => e.source === "scene"));
  const installation = read(installationFile); assert.equal(installation.version, "1.9.22");
  assert.equal(installation.executable.sha256, "189222471fe1bb83a57b40f9559b2321a8080d66a9ea3548b2692f94d3dee4dc");
  const report = { status: "RUNNING", version: "1.9.22", startedAt: new Date().toISOString(),
    scope: "ACTUAL_INSTALLED_EDITOR_NOVEL_REAL_GRAPH_AUTHORING_NATIVE_SAVE_RESTART_UI_EXPORT",
    source: desc(sourceFile), priorAudit: desc(auditFile), input, installation: desc(installationFile),
    protectedFiles: source.protectedFiles, steps: [], cases: [], screenshots: [], launches: [], cleanups: [],
    errors: [], modelRequests: 0, realModelRequests: 0, productChanges: 0, downloadEvents: [],
    boundaries: ["Public API reimport, not native picker", "Explicit local save-directory seed, not directory selector",
      "CDP input in actual installed WebView, not physical4K", "Attributed forced restart, not normal close",
      "Existing loopback-generated 44-character sample; no real DeepSeek quality",
      "Placeholder background, not final asset quality", "Same-package Player preview, not standalone/setup/Android/upgrade"],
    knownProductFailures: ["NOVEL-BACKEND-PORT-01 remains FAILED; no analysis request is made here"] };
  const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  const resumeArg = process.argv.find(a => a.startsWith("--resume-consume=")), resumeId = resumeArg?.split("=")[1];
  let parent;
  if (resumeArg) {
    assert.match(resumeId, /^\d{2}$/);
    const parentFile = path.join(qa, `session-${resumeId}`, "report.json"); parent = read(parentFile);
    assert.equal(parent.status, "FAILED"); assert.equal(parent.steps.length, 2);
    assert.equal(parent.steps[0].status, "PASS"); assert.equal(parent.steps[1].status, "FAILED");
    assert.equal(parent.input.sha256, input.sha256); assert.equal(parent.modelRequests, 0);
    assert.match(parent.error, /updatedAt/); assert(!parent.cleanupError);
    assert.equal(sha(parent.finalDatabase.path), parent.finalDatabase.sha256);
    assert.equal(sha(parent.connectedBundle.path), parent.connectedBundle.sha256);
    report.continuation = { ...desc(parentFile), originalFailurePreserved: true,
      originalFailure: "QA compared refresh-only persistence updatedAt metadata",
      timestampChanges: persistenceContent(parent.restored.editor_settings.novelPersistence,
        parent.connected.editor_settings.novelPersistence) };
    assert.deepEqual(graphContent(parent.restored), graphContent(parent.connected));
    report.steps.push({ ...structuredClone(parent.steps[0]), inheritedFrom: report.continuation });
    for (const key of ["initial", "connected", "connectedBundle", "addedEdge", "gesture"])
      report[key] = structuredClone(parent[key]);
    for (const name of ["data", "webview"]) fs.cpSync(path.join(path.dirname(parentFile), name), path.join(out, name),
      { recursive: true, force: false, errorOnExist: true });
    assert.equal(sha(path.join(out, "data/backend/vn_engine.db")), parent.finalDatabase.sha256);
  }
  report.tools = [__filename, "scripts/native-novel-consume.cjs", "scripts/lib/installed-release-session.cjs",
    "scripts/lib/current-native-capture.cjs", "scripts/installed-layout-cache-session.ps1"]
    .map(f => desc(path.resolve(root, f)));
  for (const f of report.tools) fs.copyFileSync(f.path, path.join(out, path.basename(f.path)), fs.constants.COPYFILE_EXCL);
  process.env.AGENTVN_TEST_PROJECT = input.path; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
  report.environment = { AGENTVN_TEST_PROJECT: input.path, AGENTVN_WORKSPACE_OUTPUT: out };
  const host = installedReleaseSession({ installationFile, out, report, save, input: input.path, preferredBackendPort: 8278 });
  let page, protectedCache = false;
  const immutable = () => {
    for (const f of [...report.protectedFiles, ...report.tools, input, report.source, report.priorAudit])
      assert.equal(sha(f.path), f.sha256, f.path);
  };
  function cache(action) {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
    { encoding: "utf8", windowsHide: true, timeout: 45000 });
    fs.writeFileSync(path.join(out, `cache-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  async function step(name, fn) {
    if (report.steps.some(s => s.name === name && s.inheritedFrom)) { console.log(`REUSE ${name}`); return; }
    const c = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(c); save();
    console.log(`START ${name}`);
    try { c.detail = await fn(); c.status = "PASS"; console.log(`PASS ${name}`); }
    catch (e) { c.status = "FAILED"; c.error = String(e.stack || e); throw e; }
    finally { c.finishedAt = new Date().toISOString(); save(); }
  }
  const state = () => host.api(`/api/project/projects/${project.project_id}`);
  async function hit(n) {
    await n.scrollIntoViewIfNeeded(); await n.click({ trial: true });
    const g = await n.evaluate(n => {
      const r = n.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), hit: h === n || n.contains(h), width: innerWidth, height: innerHeight,
        overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert(g.hit && g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= 0 && g.rect.top >= 0 &&
      g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1); return g;
  }
  async function open() {
    await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: project.title }).click();
    await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  }
  try {
    immutable(); save(); cache("SelfTest"); protectedCache = true; cache("Prepare");
    await step("public-reimport-and-real-handle-gesture-connects-existing-novel-without-changing-content", async () => {
      page = await host.start();
      const r = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, { method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-AgentVN-Filename": encodeURIComponent(path.basename(input.path)) },
        body: fs.readFileSync(input.path), signal: AbortSignal.timeout(20000) });
      const imported = await r.json(); assert(r.ok && imported.ok); assert.equal(imported.data.project_id, project.project_id);
      await page.evaluate(({ id, out }) => localStorage.setItem("agentvn.projectExportDirectories.v1", JSON.stringify({ [id]: out })),
        { id: project.project_id, out });
      await page.reload(); await open();
      report.initial = await state(); assert.deepEqual(graphContent(report.initial), graphContent(project));
      await page.locator(".react-flow__controls-fitview").click();
      await page.waitForFunction(() => {
        const value = document.querySelector(".react-flow__viewport")?.getAttribute("style"), old = window.__novelConsumeFit;
        window.__novelConsumeFit = { value, count: old?.value === value ? old.count + 1 : 0 };
        return window.__novelConsumeFit.count >= 3;
      }, null, { polling: "raf" });
      const a = await hit(page.locator('.react-flow__node[data-id="scene"] .react-flow__handle.source[data-handleid="default"]'));
      const b = await hit(page.locator(`.react-flow__node[data-id="${novelNodes[0].id}"] .react-flow__handle.target[data-handleid="default"]`));
      report.gesture = { source: a, target: b };
      await page.mouse.move(a.rect.x + a.rect.width / 2, a.rect.y + a.rect.height / 2); await page.mouse.down();
      await page.mouse.move(b.rect.x + b.rect.width / 2, b.rect.y + b.rect.height / 2, { steps: 16 }); await page.mouse.up();
      await until(async () => (await state()).edges.length === project.edges.length + 1, "persist actual authored connection");
      report.connected = await state();
      assert.deepEqual(graphContent(report.connected).nodes, graphContent(project).nodes);
      assert.deepEqual(report.connected.edges.filter(e => project.edges.some(b => b.id === e.id)), project.edges);
      const added = report.connected.edges.filter(e => !project.edges.some(b => b.id === e.id)); assert.equal(added.length, 1);
      assert.equal(added[0].source, "scene"); assert.equal(added[0].sourceHandle, "default"); assert.equal(added[0].target, novelNodes[0].id);
      report.addedEdge = added[0];
      assert.deepEqual(report.connected.editor_settings.runtimeUILayoutProfiles, project.editor_settings.runtimeUILayoutProfiles);
      await host.shot("actual-author-connection");
      return { unchangedNodes: project.nodes.length, retainedEdges: project.edges.length, added: added[0], gesture: report.gesture };
    });
    await step("native-save-and-actual-host-backend-restart-retain-authored-link-and-original-novel", async () => {
      if (parent) {
        const z = await JSZip.loadAsync(fs.readFileSync(report.connectedBundle.path), { checkCRC32: true });
        const p = JSON.parse(await z.file("project.json").async("string"));
        assert.deepEqual(graphContent(p), graphContent(report.connected));
        page = await host.start(); await open(); report.restored = await state();
        assert.deepEqual(graphContent(report.restored), graphContent(report.connected));
        report.persistenceRefreshes = persistenceContent(report.restored.editor_settings.novelPersistence,
          report.connected.editor_settings.novelPersistence);
        return { nativePackage: report.connectedBundle, alreadySavedAndRestartedIn: report.continuation,
          freshHostReopen: true, onlyMetadataRefreshes: report.persistenceRefreshes };
      }
      await page.locator('[data-help-key="toolbar.saveProject"]:visible').click();
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      const message = await dialog.innerText(); assert(message.includes(out) || message.includes(out.replaceAll("/", "\\")));
      await dialog.getByRole("button", { name: "OK", exact: true }).click(); await dialog.waitFor({ state: "detached" });
      const files = fs.readdirSync(out).filter(f => f.endsWith(".vnproj")); assert.equal(files.length, 1);
      report.connectedBundle = desc(path.join(out, files[0]));
      const z = await JSZip.loadAsync(fs.readFileSync(report.connectedBundle.path), { checkCRC32: true });
      const p = JSON.parse(await z.file("project.json").async("string"));
      assert.deepEqual(graphContent(p), graphContent(report.connected));
      assert.deepEqual(p.editor_settings.runtimeUILayoutProfiles, report.connected.editor_settings.runtimeUILayoutProfiles);
      for (const a of p.asset_manifest) {
        const old = project.asset_manifest.find(b => a.asset_id === b.asset_id); assert(old);
        assert.equal(hash(await z.file(a.metadata.project_path).async("nodebuffer")),
          hash(await inputZip.file(old.metadata.project_path).async("nodebuffer")));
      }
      await host.stop("attributed host/backend restart; not native normal close");
      page = await host.start(); await open(); report.restored = await state();
      assert.deepEqual(graphContent(report.restored), graphContent(report.connected));
      report.persistenceRefreshes = persistenceContent(report.restored.editor_settings.novelPersistence,
        report.connected.editor_settings.novelPersistence);
      return { package: report.connectedBundle, message, actualRestarts: report.launches.length - 1 };
    });
    await step("real-publish-ui-and-twelve-display-hit-focus-checks", async () => {
      await page.locator('[data-workspace-surface="publish"]:visible').click(); await settleEditor(page);
      const operation = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
        const settings = page.locator('[data-package-stage="settings"]');
        if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") { await settings.click(); return false; }
        const button = page.locator('[data-help-key="package.export"]');
        return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
      }, "real publishing environment terminal", 60000);
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        report.incidentalEnvironment = { phase, text: await operation.innerText(),
          boundary: "QA protected-cache environment, not general Windows package readiness" }; save();
        await operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
        await operation.waitFor({ state: "detached" });
      }
      await page.locator('[data-package-stage="settings"]').click();
      await page.locator('[data-help-key="package.mode"]').click();
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      for (const [key, value] of [["gameId", project.project_id], ["title", project.title],
        ["author", project.author], ["description", "真实安装版默认小说链，作者实际接线后的原文导出消费验收。"]])
        await page.locator(`[data-help-key="package.${key}"]`).fill(value);
      const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warnings.isVisible()) await warnings.click();
      const consent = page.locator('[data-help-key="package.confirmWarnings"]'); if (await consent.isVisible()) await consent.check();
      const button = page.locator('[data-help-key="package.export"]');
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced }, viewport = await host.metrics(m);
        const geometry = await hit(button); await button.focus(); assert(await button.evaluate(n => n === document.activeElement));
        report.cases.push({ ...m, viewport, geometry, focus: true, status: "PASS" }); save();
      }
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      return { matrix: report.cases.length, format: "vncart" };
    });
    await step("real-download-events-and-byte-exact-connected-script-and-source-asset", async () => {
      const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
      for (const event of ["Browser.downloadWillBegin", "Browser.downloadProgress", "Page.downloadWillBegin", "Page.downloadProgress"])
        host.cdp.on(event, detail => { report.downloadEvents.push({ event, at: new Date().toISOString(), detail }); save(); });
      await host.cdp.send("Page.enable");
      await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
      const button = page.locator('[data-help-key="package.export"]'); await hit(button);
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), button.click()]);
      const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
      const file = path.join(dir, name);
      await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "completed UI cartridge download", 60000);
      assert.equal(await download.failure(), null);
      assert.equal(fs.readdirSync(dir).length, 1);
      await until(() => report.downloadEvents.some(e => e.detail.state === "completed"), "raw completed download event", 15000);
      report.cartridge = desc(file);
      report.exported = await cartridgeEvidence(file, { id: project.project_id,
        expected: report.connected, novelNodeIds: novelNodes.map(n => n.id) });
      assert.equal(report.exported.playback.length, 2);
      for (const a of report.exported.assets) {
        const old = project.asset_manifest.find(b => b.asset_id === a.id); assert(old);
        assert.equal(a.sha256, hash(await inputZip.file(old.metadata.project_path).async("nodebuffer")));
      }
      await host.shot("actual-ui-export-complete");
      return { cartridge: report.cartridge, scenes: report.exported.script.scenes.length,
        textCount: report.exported.playback.length, rawDownloadEvents: report.downloadEvents.length };
    });
    assert.equal(report.steps.length, 4); assert(report.steps.every(c => c.status === "PASS"));
    assert.equal(report.cases.length, 12); assert.equal(report.blockedModelRequests || 0, 0);
    assert.deepEqual(report.errors, []); report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      report.failureState = await state().catch(e => ({ error: String(e) }));
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    try {
      await host.stop("final exact installed cleanup; not normal close");
      if (protectedCache && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
        cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
        assert.equal(read(report.cacheRestoration.path).status, "PASS");
      }
      immutable();
      const dbFile = path.join(out, "data/backend/vn_engine.db");
      if (fs.existsSync(dbFile)) {
        const db = new DatabaseSync(dbFile, { readOnly: true });
        try { assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map(r => r.integrity_check), ["ok"]); }
        finally { db.close(); }
        report.finalDatabase = desc(dbFile);
      }
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, steps: report.steps.map(s => [s.name, s.status]),
      error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) run(process.argv[2]).catch(e => { console.error(e.stack || e); process.exitCode = 1; });
module.exports = { qa, desc, read, sha, persistenceContent };
