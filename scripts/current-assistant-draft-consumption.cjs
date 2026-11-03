"use strict";
// Reuse a completed, controlled-provider draft in the sealed installation.
// No generation, product/store writes, source rebuilds, or motion assertions.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { receipt } = require("./current-novel-task-closure.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { settleEditor, projectSnapshot } = require("./lib/installed-acceptance.cjs");
const { until, rows } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const qa = "F:/AgentVN/QA/Assistant-Queue-1.9.35-20261102-01";
const prior = path.join(qa, "session-01"), resume = path.join(qa, "session-03"), out = path.join(qa, "session-04");
const root = path.resolve(__dirname, "..");
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const authored = nodes => nodes.map(({ measured, ...n }) => n);
const fixture = read(path.join(qa, "preparation.json"));
const previous = read(path.join(prior, "report.json"));
const installation = descriptor();
let report, host, page, cachePrepared = false, savedProject, merged, before;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", path.resolve(out), "-AllowedRunRoot", path.resolve(qa), "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
  save(); assert.equal(result.status, 0, result.stdout + result.stderr);
}
function inventory(directory) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), "Only stopped QA-owned physical profiles may be cloned");
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push({ relative: path.relative(directory, file), sha256: sha(file), bytes: fs.statSync(file).size });
    }
  }
  walk(directory); return files.sort((a, b) => a.relative.localeCompare(b.relative));
}
async function stage(name, fn) {
  const item = { name, status: "RUNNING", at: new Date().toISOString() };
  report.cases.push(item); save(); console.log("START " + name);
  try { item.detail = await fn(); item.status = "PASS"; console.log("PASS " + name); }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function hit(n) {
  await n.scrollIntoViewIfNeeded(); await n.click({ trial: true });
  const g = await n.evaluate(node => {
    const r = node.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: r.toJSON(), hit: top === node || node.contains(top), width: innerWidth, height: innerHeight,
      overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert(g.hit && g.rect.width > 0 && g.rect.height > 0 && g.rect.left >= 0 && g.rect.top >= 0
    && g.rect.right <= g.width + 1 && g.rect.bottom <= g.height + 1 && g.overflow <= 1);
  return g;
}
async function click(n) { await hit(n); await n.click(); }
async function openProject() {
  await click(page.locator('[data-help-key="home.recentProject"]:not(:disabled):visible')
    .filter({ hasText: fixture.projects[1].title }));
  await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
  assert.equal((await projectSnapshot(host.current.ports[0])).projectId, fixture.projects[1].project_id);
}
async function stored(p) { return host.api("/api/project/projects/" + p.project_id); }
function contentUnchanged(actual, expected) {
  for (const key of ["editor_settings", "edges", "asset_manifest"]) assert.deepEqual(actual[key], expected[key]);
  assert.deepEqual(authored(actual.nodes), authored(expected.nodes));
}
async function runEditor() {
  assert.equal(previous.status, "PASS"); assert.equal(previous.cases.length, 6);
  assert.equal(previous.lockMatrix.length, 12);
  assert(previous.cleanups.length === 2 && previous.cleanups.every(c => c.status === "PASS"));
  assert.equal(previous.realModelRequests, 0);
  const priorAttempt = read(path.join(resume, "report.json"));
  assert.equal(priorAttempt.status, "FAILED");
  assert(priorAttempt.error.includes("assistant-creation-merge-readiness"));
  assert(priorAttempt.failureText.includes("此草稿已应用到所属工程。"));
  assert.equal(read(priorAttempt.cacheRestoration.path).status, "PASS");
  assert(!rows().some(p => /^(agentvn-editor|creator-backend|agentvn-player)\.exe$/i.test(p.Name)));
  assert(!fs.existsSync(out)); fs.mkdirSync(out);
  report = { status: "RUNNING", at: new Date().toISOString(), version: "1.9.35",
    scope: "ACTUAL_INSTALLED_REUSE_CONTROLLED_DRAFT_UI_MERGE_SAVE_RESTART_EXPORT_NO_MODEL",
    source: desc(path.join(prior, "report.json")), continuedFrom: desc(path.join(resume, "report.json")), products: fixture.products,
    tools: [__filename, "scripts/lib/installed-release-session.cjs", "scripts/lib/current-native-capture.cjs"].map(desc),
    cases: [], matrix: [], screenshots: [], launches: [], cleanups: [], errors: [],
    modelRequests: 0, blockedModelRequests: 0, productChanges: 0, builds: 0,
    notProven: ["Real model creation quality", "Normal native window close", "Standalone/setup", "Android",
      "Physical mouse/touch/4K", "Native open/save picker", "Player consumption (separate report)"] };
  fs.copyFileSync(__filename, path.join(out, "executed.cjs"), fs.constants.COPYFILE_EXCL); save();
  try {
    await stage("clone-stopped-qa-state-preserves-original-draft-and-evidence", async () => {
      const copied = [];
      for (const leaf of ["data", "webview"]) {
        const source = path.join(resume, leaf), target = path.join(out, leaf);
        const original = inventory(source);
        assert(original.length > 0);
        fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
        assert.deepEqual(inventory(target), original);
        copied.push({ leaf, files: original.length, bytes: original.reduce((n, f) => n + f.bytes, 0) });
      }
      return { copied, userDataCopied: false, previousReport: report.source };
    });
    cache("SelfTest"); cachePrepared = true; cache("Prepare");
    host = installedReleaseSession({ installationFile: receipt, out, input: fixture.inputs[1].path, report, save });
    page = await host.start(); await openProject();
    before = fixture.projects.map(p => previous.baselineProjects[p.project_id]); report.beforeProjects = before; save();
    await stage("continued-actual-ui-merge-preserves-only-project-b-completed-draft", async () => {
      await click(page.locator('[data-workspace-surface="assistant"]:visible')); await settleEditor(page);
      const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel"); await panel.waitFor();
      await click(panel.getByRole("button", { name: "创造模式", exact: true }));
      const draft = panel.getByTestId("assistant-creation-draft");
      await draft.getByRole("heading", { name: "QUEUE_C组件", exact: true }).waitFor();
      assert.equal(await draft.getByLabel("选择目标页面", { exact: true }).inputValue(), "title");
      const defaultRect = {};
      for (const [key, label] of [["x", "X"], ["y", "Y"], ["width", "宽"], ["height", "高"]])
        defaultRect[key] = Number(await draft.getByLabel("组件" + label + "百分比", { exact: true }).inputValue());
      // Preserve default placement: do not move a component to hide title-menu interference.
      assert.equal(await draft.getByTestId("assistant-creation-merge-button").count(), 0,
        "Reuse already-reviewed merge; never submit duplicate merge");
      await draft.getByTestId("assistant-creation-merge-readiness")
        .filter({ hasText: "此草稿已应用到所属工程。" }).waitFor();
      const actual = await until(async () => {
        const p = await stored(fixture.projects[1]);
        return p.editor_settings.runtimeUILayout?.screens.find(s => s.screen_id === "title")
          ?.components.some(c => c.component_type === "custom_component" && c.label === "QUEUE_C组件") && p;
      }, "real backend persistence of reviewed component");
      merged = actual; report.mergedProject = actual; report.defaultRect = defaultRect;
      contentUnchanged(await stored(fixture.projects[0]), before[0]);
      assert.deepEqual(authored(actual.nodes), authored(before[1].nodes));
      assert.deepEqual(actual.edges, before[1].edges);
      assert.deepEqual(actual.asset_manifest, before[1].asset_manifest);
      const oldProfiles = before[1].editor_settings.runtimeUILayoutProfiles;
      const newProfiles = actual.editor_settings.runtimeUILayoutProfiles;
      assert.deepEqual(newProfiles.profiles.agentvn, oldProfiles.profiles.agentvn);
      const components = actual.editor_settings.runtimeUILayout.screens.find(s => s.screen_id === "title")
        .components.filter(c => c.component_type === "custom_component");
      assert.equal(components.length, 1); assert.equal(components[0].label, "QUEUE_C组件");
      assert(!JSON.stringify(actual.editor_settings).includes("QUEUE_A"));
      for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        const m = { width, height: width * 9 / 16, dpr, reduced };
        const viewport = await host.metrics(m);
        const button = panel.getByRole("button", { name: "创造模式", exact: true });
        const geometry = await hit(button); await button.focus();
        assert(await button.evaluate(n => document.activeElement === n));
        report.matrix.push({ ...m, viewport, geometry, focus: true, status: "PASS" });
        await host.shot(`merged-draft-${width}-${dpr}-${reduced}`); save();
      }
      await host.metrics({ width: 1920, height: 1080, dpr: 1, reduced: false });
      return { projectId: actual.project_id, component: components[0], defaultRect,
        graphAndOtherLayoutUnchanged: true, matrix: report.matrix.length };
    });
    await stage("native-portable-save-contains-merged-component-and-both-layouts", async () => {
      await click(page.locator('[data-workspace-surface="edit"]:visible')); await settleEditor(page);
      const downloads = "C:/Users/1/Downloads";
      const existing = new Set(fs.readdirSync(downloads));
      await click(page.locator('[data-help-key="toolbar.saveProject"]:visible'));
      const dialog = page.getByTestId("project-save-confirmation"); await dialog.waitFor();
      report.saveConfirmation = await dialog.innerText(); save();
      const file = await until(() => {
        const names = fs.readdirSync(downloads).filter(n => n.endsWith(".vnproj") && !existing.has(n));
        assert(names.length <= 1, "Ambiguous new download; do not touch unrelated files");
        return names.length === 1 && path.join(downloads, names[0]);
      }, "QA-owned native saved project bytes");
      const archive = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
      savedProject = JSON.parse(await archive.file("project.json").async("string"));
      assert.equal(savedProject.project_id, fixture.projects[1].project_id);
      assert.deepEqual(savedProject.editor_settings.runtimeUILayoutProfiles, merged.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual(savedProject.editor_settings.runtimeUILayout, merged.editor_settings.runtimeUILayout);
      assert.deepEqual(authored(savedProject.nodes), authored(merged.nodes));
      assert.deepEqual(savedProject.edges, merged.edges);
      assert(!JSON.stringify(savedProject).includes("test-only-secret"));
      assert(!JSON.stringify(savedProject).includes("authorizedProjectAssetIds"));
      const target = path.join(out, path.basename(file));
      fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
      assert.equal(sha(file), sha(target)); report.projectArtifact = desc(target);
      // Delete only this newly-created, identity-validated and retained QA download.
      const exact = path.resolve(file);
      assert.equal(path.dirname(exact), path.resolve(downloads));
      fs.unlinkSync(exact);
      report.downloadCleanup = { original: exact, retained: report.projectArtifact, removed: true, userFilesDeleted: 0 };
      await click(dialog.getByRole("button", { name: "OK", exact: true }));
      return report.projectArtifact;
    });
    await stage("real-host-backend-restart-retains-reviewed-merge-without-regeneration", async () => {
      const previousPid = host.current.pid;
      await host.stop("Owned QA restart, not normal window-close evidence");
      page = await host.start(); await openProject();
      assert.notEqual(host.current.pid, previousPid);
      const reopened = await stored(fixture.projects[1]);
      assert.deepEqual(reopened.editor_settings.runtimeUILayoutProfiles, savedProject.editor_settings.runtimeUILayoutProfiles);
      assert.deepEqual(reopened.editor_settings.runtimeUILayout, savedProject.editor_settings.runtimeUILayout);
      contentUnchanged(await stored(fixture.projects[0]), before[0]);
      report.reopenedProject = reopened;
      await host.shot("reviewed-merge-after-real-restart");
      return { previousPid, currentPid: host.current.pid, sameProfiles: true, modelRequests: 0 };
    });
    await stage("real-publishing-ui-downloads-current-layout-with-completed-draft", async () => {
      await click(page.locator('[data-workspace-surface="publish"]:visible')); await settleEditor(page);
      const operation = page.getByTestId("package-environment-operation-dialog");
      await until(async () => {
        if (await operation.isVisible()) return ["completed", "failed"].includes(await operation.getAttribute("data-environment-phase"));
        const settings = page.locator('[data-package-stage="settings"]');
        if (await settings.isVisible() && await settings.getAttribute("aria-current") !== "page") {
          await click(settings); return false;
        }
        const mode = page.locator('[data-help-key="package.mode"]');
        if (await mode.count() && (await mode.innerText()).includes(".vncart")) return true;
        const button = page.locator('[data-help-key="package.export"]');
        return await button.count() && ["passed", "failed"].includes(await button.getAttribute("data-environment-status"));
      }, "publishing environment terminal state", 60000);
      if (await operation.isVisible()) {
        const phase = await operation.getAttribute("data-environment-phase");
        report.incidentalEnvironment = { phase, text: await operation.innerText(),
          scope: "Incidental QA cache environment result, not Windows export readiness evidence" };
        await click(operation.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }));
        await operation.waitFor({ state: "detached" });
      }
      await click(page.locator('[data-package-stage="settings"]'));
      await click(page.locator('[data-help-key="package.mode"]'));
      await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
      for (const [key, value] of [["gameId", savedProject.project_id], ["title", savedProject.title],
        ["author", savedProject.author], ["description", "实际安装版复用队列草稿，审核合并及重启后导出。"]])
        await page.locator(`[data-help-key="package.${key}"]`).fill(value);
      const warnings = page.getByRole("button", { name: "查看并确认警告", exact: true });
      if (await warnings.isVisible()) await click(warnings);
      const consent = page.locator('[data-help-key="package.confirmWarnings"]');
      if (await consent.isVisible()) await consent.check();
      const dir = path.join(out, "cartridge"); fs.mkdirSync(dir);
      await host.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir, eventsEnabled: true });
      const button = page.locator('[data-help-key="package.export"]'); await hit(button);
      const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
      const name = download.suggestedFilename(); assert.equal(path.basename(name), name);
      const file = path.join(dir, name);
      await until(() => fs.existsSync(file) && !fs.existsSync(file + ".crdownload"), "real cartridge output", 60000);
      assert.equal(await download.failure(), null);
      const zip = await JSZip.loadAsync(fs.readFileSync(file), { checkCRC32: true });
      const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
      const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
      const script = JSON.parse(await zip.file("script.json").async("string"));
      assert.deepEqual(layout, savedProject.editor_settings.runtimeUILayout);
      assert.equal(layout.layout_type, "renpy"); assert.equal(manifest.game_id, savedProject.project_id);
      const components = layout.screens.find(s => s.screen_id === "title").components.filter(c => c.component_type === "custom_component");
      assert.equal(components.length, 1); assert.equal(components[0].label, "QUEUE_C组件");
      assert.equal(manifest.assets.length, 0); assert(!JSON.stringify(layout).includes("QUEUE_A"));
      assert(!zip.file("project.json")); assert(!JSON.stringify(manifest).includes("test-only-secret"));
      assert.equal(script.game_id, savedProject.project_id);
      report.cartridge = { ...desc(file), manifest, layout, script };
      await host.shot("reviewed-draft-real-cartridge-export");
      return { cartridge: desc(file), components: components.map(c => c.label), activeAssets: 0 };
    });
    assert.equal(report.cases.length, 5); assert.equal(report.matrix.length, 12);
    assert.equal(report.blockedModelRequests, 0); assert.deepEqual(report.errors, []);
    report.status = "PASS";
  } catch (e) {
    report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) {
      report.failureText = await page.locator("body").innerText().catch(String);
      await host.shot("failure").catch(e => { report.captureError = String(e); });
    }
  } finally {
    try {
      await host?.stop("End owned draft-consumption Editor; not normal native-close evidence");
      if (cachePrepared && fs.existsSync(path.join(out, "native-cache-protection.json"))) {
        cache("Restore"); report.cacheRestoration = desc(path.join(out, "native-cache-restoration.json"));
        assert.equal(read(report.cacheRestoration.path).status, "PASS");
      }
      for (const f of [...fixture.products, report.source]) assert.equal(sha(f.path), f.sha256);
    } catch (e) { report.cleanupError = String(e.stack || e); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, cases: report.cases.length,
      error: report.error, cleanupError: report.cleanupError }));
  }
}
if (require.main === module) runEditor().catch(e => { console.error(e); process.exitCode = 1; });
