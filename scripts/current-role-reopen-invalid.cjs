"use strict";
// Fresh installed-editor DB, real native portable reopen and publication
// attempts with invalid unsaved control code. No product changes or model calls.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const JSZip = require("../editor/node_modules/jszip");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const A = require("./lib/installed-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const { descriptor } = require("./current-runtime-story-closure.cjs");
const { nativePick } = require("./current-control-closure.cjs");
const { normalizeInstalledControls } = require("./lib/installed-control-normalization.cjs");
const { authorRoot, editorRoot, qa } = require("./current-role-closure.cjs");
const attempt = process.argv[3] ?? "14"; assert.match(attempt, /^\d{2}$/);
const root = path.resolve(__dirname, ".."), out = editorRoot + "/editor-" + attempt;
const authorFile = authorRoot + "/report.json";
const installationFile = "F:/AgentVN/QA/Controls-1.9.35-20261102-01/derived-actual-installation.json";
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const desc = f => ({ path: path.resolve(f), sha256: sha(f), bytes: fs.statSync(f).size });
const displays = [1920, 2560, 3840].flatMap(width => [1, 2].flatMap(dpr =>
  [false, true].map(reduced => ({ width, height: width * 9 / 16, dpr, reduced }))));
const validHTML = '<span class="root"><span class="body"><slot name="content"></slot></span></span>';
const validCSS = ".root { background-color: #315b72; border-radius: 6px; } .body { color: #f6f8ff; }";
const badCSS = "body { --qa-invalid-publication: 20261102; color: red; }";
const badHTML = '<script>window.__qaInvalidPublicationExecuted = true</script><slot name="content"></slot>';
const titleControl = profiles => profiles.profiles.renpy.screens.find(s => s.screen_id === "title")
  .components.find(c => c.component_id === "title_start_button");
const source = read(authorFile), actual = descriptor();
assert.equal(source.status, "PASS"); assert.equal(source.cases.length, 4);
assert(source.cases.every(c => c.status === "PASS"));
assert.deepEqual(read(source.installation.path).executable, actual.executable);
assert.equal(sha(source.portable.path), source.portable.sha256);
if (process.argv[2] === "self-test") {
  assert.equal(displays.length, 12); assert(!fs.existsSync(out));
  console.log(JSON.stringify({ status: "PASS", displays: 12, nativePicker: "Windows UI Automation",
    emptyAuthorRejected: true, productStarts: 0 }));
  return;
}
assert.equal(process.argv[2], "run"); assert(!fs.existsSync(out)); fs.mkdirSync(out);
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), version: "1.9.35",
  installation: desc(installationFile), source: desc(authorFile), portable: source.portable,
  cases: [], matrix: [], errors: [], screenshots: [], launches: [], cleanups: [], violations: [],
  productChanges: 0, builds: 0, modelRequests: 0,
  scope: "FRESH_NATIVE_PORTABLE_REOPEN_SIX_ROLES_INVALID_DRAFT_REAL_PUBLISH_EXPORT_LAST_SAVED_VALID_LAYOUT",
  boundaries: ["Explicit isolated DB/WebView, not default-account migration",
    "Windows UI Automation native picker, Playwright WebView; not Computer Use",
    "Invalid draft may open publishing only if actual exported bytes remain the last saved valid layout"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
const host = installedReleaseSession({ installationFile, out, input: source.portable.path, report, save });
process.env.AGENTVN_INSTALLED_GUI_QA_ROOT = path.resolve(editorRoot);
let page, protectedCache = false, savedProfiles;
const click = async n => { await n.scrollIntoViewIfNeeded(); await n.click(); };
const htmlField = () => page.getByRole("textbox", { name: "当前控件 HTML", exact: true });
const cssField = () => page.getByRole("textbox", { name: "当前控件 CSS", exact: true });
function cache(action) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(root, "scripts/installed-layout-cache-session.ps1"), "-Action", action,
    "-RunDirectory", out, "-CodexCacheView"], { windowsHide: true, encoding: "utf8", timeout: 45000 });
  (report.cache ??= []).push({ action, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); save();
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
async function stage(name, action) {
  const item = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.cases.push(item); save();
  try { item.detail = await action(); item.status = "PASS"; console.log("PASS " + name); }
  catch (e) { item.status = "FAILED"; item.error = String(e.stack || e); throw e; }
  finally { item.finishedAt = new Date().toISOString(); save(); }
}
async function enterLayout() {
  const publishingPanel = page.locator('[data-workspace-task="publish"].is-open:not([inert]) .cartridge-export-panel');
  if (await publishingPanel.isVisible()) {
    await click(publishingPanel.getByRole("button", { name: "关闭发布与打包", exact: true }));
    await publishingPanel.waitFor({ state: "hidden" }); await A.settleEditor(page);
  }
  await click(page.locator('[data-workspace-surface="options"]:visible'));
  await click(page.locator('[data-help-key="advanced.tab.layout"]:visible'));
  await page.getByTestId("renpy-title-editor").waitFor(); await A.settleEditor(page);
  await click(page.getByTestId("renpy-title-static-preview-toggle"));
  await click(page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_start_button"]'));
}
async function publishing() {
  await click(page.locator('[data-workspace-surface="publish"]:visible')); await A.settleEditor(page);
  const panel = page.locator('[data-workspace-task="publish"].is-open:not([inert]) .cartridge-export-panel');
  // Handle a genuine navigation guard without choosing to discard the draft.
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "取消", exact: true }) });
  await until(async () => await panel.isVisible() || await dialog.isVisible(),
    "publication ready or visible navigation confirmation", 30000);
  if (await dialog.isVisible()) {
    const text = await dialog.innerText(); await dialog.getByRole("button", { name: "取消", exact: true }).click();
    return { blocked: true, text };
  }
  assert(await panel.isVisible(), "No actual publication screen or explicit navigation guard");
  await until(async () => {
    const environment = page.getByTestId("package-environment-operation-dialog");
    if (await environment.isVisible()) {
      const phase = await environment.getAttribute("data-environment-phase");
      if (!["completed", "failed"].includes(phase)) return false;
      (report.incidentalEnvironment ??= []).push({ phase, text: await environment.innerText(),
        scope: "QA dependency junction, not environment-discovery acceptance" }); save();
      await environment.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await environment.waitFor({ state: "detached" });
    }
    try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); } catch { return false; }
    return panel.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual invalid-draft publication settings", 180000);
  await click(panel.locator('[data-help-key="package.mode"]'));
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  return { blocked: false, panel };
}
(async () => {
  save(); cache("SelfTest"); cache("Prepare"); protectedCache = true; page = await host.start();
  await stage("Fresh DB opens actual six-role portable archive through the native system picker", async () => {
    await page.locator(".project-home").waitFor();
    const trigger = page.getByLabel("创建或打开项目").getByRole("button", { name: "导入项目", exact: true });
    report.nativePicker = await nativePick({ page, trigger, out, ownerPid: host.current.pid,
      selectedPath: source.portable.path }); save();
    // Native import enters the editor automatically. Waiting for its real
    // toolbar avoids clicking a recent-project card during its unmount.
    await page.locator(".editor-toolbar").waitFor({ timeout: 45000 });
    await A.settleEditor(page); await enterLayout();
    const snapshot = await A.projectSnapshot(host.current.ports[0]);
    assert.deepEqual(snapshot.settings.runtimeUILayoutProfiles, source.authored.settings.runtimeUILayoutProfiles);
    report.reopened = snapshot.settings.runtimeUILayoutProfiles;
    await host.shot("native-six-role-reopen");
    return { newIsolatedDatabase: true, actualNativePicker: true, bothLayoutsAnd24RoleStatesExact: true };
  });
  await stage("Save one valid control override as the explicit publication baseline", async () => {
    const advanced = page.getByRole("checkbox", { name: "Ren’Py进阶代码编辑", exact: true });
    if (!await advanced.isChecked()) await advanced.check();
    const enable = page.getByRole("button", { name: "为当前控件启用代码覆盖", exact: true });
    if (await enable.isVisible()) await click(enable);
    await htmlField().fill(validHTML); await cssField().fill(validCSS);
    await click(page.locator('[data-help-key="layout.save"]:visible'));
    await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
    savedProfiles = (await A.projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles;
    assert.equal(titleControl(savedProfiles).presentation.html, validHTML);
    assert.equal(titleControl(savedProfiles).presentation.css, validCSS);
    assert.deepEqual(savedProfiles.profiles.renpy.renpy.shared.buttonRoles, source.expected);
    assert.deepEqual(savedProfiles.profiles.agentvn, report.reopened.profiles.agentvn);
    report.savedProfiles = savedProfiles; save();
    return { actualUIWrite: true, sixRolesAndOtherLayoutUnchanged: true };
  });
  await stage("Invalid executable HTML/global CSS cannot contaminate publication in twelve displays", async () => {
    for (const display of displays) {
      await host.metrics(display);
      const row = { display, status: "RUNNING" }; report.matrix.push(row); save();
      await htmlField().fill(badHTML); await cssField().fill(badCSS);
      await page.getByRole("alert").filter({ hasText: "代码未应用" }).waitFor();
      assert(await page.locator('[data-help-key="layout.save"]:visible').isDisabled());
      assert.equal(await page.evaluate(() => window.__qaInvalidPublicationExecuted), undefined);
      assert.deepEqual((await A.projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles, savedProfiles);
      await host.shot(`invalid-${display.width}-dpr${display.dpr}-${display.reduced}`);
      const publication = await publishing();
      if (publication.blocked) row.publication = { status: "BLOCKED_INVALID_DRAFT", detail: publication.text };
      else {
        const trigger = publication.panel.locator('[data-help-key="package.export"]');
        if (!await trigger.isEnabled()) row.publication = { status: "EXPORT_DISABLED_WITH_INVALID_DRAFT" };
        else {
          const directory = path.join(out, `export-${report.matrix.length}`); fs.mkdirSync(directory);
          const cartridge = await A.realDownload(page, host.cdp, directory, trigger);
          const zip = await JSZip.loadAsync(fs.readFileSync(cartridge.path), { checkCRC32: true });
          const layout = JSON.parse(await zip.file("ui/layout.json").async("string"));
          const normalized = normalizeInstalledControls(host.installation, savedProfiles.profiles.renpy);
          assert.deepEqual(layout, normalized.layout);
          for (const entry of Object.values(zip.files).filter(f => !f.dir && /\.(?:json|html|css)$/.test(f.name))) {
            const text = await entry.async("string");
            assert(!text.includes("__qaInvalidPublicationExecuted") && !text.includes("--qa-invalid-publication"),
              "Invalid unsaved source entered export: " + entry.name);
          }
          row.publication = { status: "LAST_SAVED_VALID_LAYOUT_EXPORTED", cartridge, normalization: normalized.evidence };
        }
      }
      await enterLayout();
      row.draftPreserved = await htmlField().inputValue() === badHTML && await cssField().inputValue() === badCSS;
      row.executionBlocked = await page.evaluate(() => window.__qaInvalidPublicationExecuted) === undefined;
      row.savedLayoutUnchanged = JSON.stringify((await A.projectSnapshot(host.current.ports[0])).settings.runtimeUILayoutProfiles)
        === JSON.stringify(savedProfiles);
      if (!row.draftPreserved) report.violations.push({ display, issue: "Invalid unsaved code lost on workspace roundtrip without explicit discard" });
      assert(row.executionBlocked && row.savedLayoutUnchanged);
      await htmlField().fill(validHTML); await cssField().fill(validCSS);
      row.status = row.draftPreserved ? "PASS" : "FAILED"; row.finishedAt = new Date().toISOString(); save();
      console.log(`${row.status} invalid-draft publication ${display.width}/${display.dpr}/${display.reduced}`);
    }
    assert.equal(report.matrix.length, 12); assert.equal(report.violations.length, 0);
    return { displays: 12, invalidHTMLAndCSS: true, realPublicationAttempts: 12,
      noArbitraryScriptExecution: true, unsavedSourceNeverExported: true, draftRetainedOnReturn: true };
  });
  assert.equal(report.cases.length, 3); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(String)).slice(-10000);
    try { await host.shot("failure"); } catch (e) { report.captureError = String(e); }
  }
}).finally(async () => {
  try {
    await host.stop("Fresh-reopen invalid-code QA finally; normal native exit not claimed");
    if (protectedCache) { cache("Restore"); report.nativeCacheRestoration = "PASS"; }
    for (const f of [source.portable, source.installation, ...actual.resources]) assert.equal(sha(f.path), f.sha256);
  } catch (error) { report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  report.tool = desc(path.join(out, "executed-test.cjs")); report.workspaceTool = desc(__filename); save();
  console.log(JSON.stringify({ status: report.status, out, displays: report.matrix.length,
    violations: report.violations.length, error: report.error, cleanupError: report.cleanupError }));
});
