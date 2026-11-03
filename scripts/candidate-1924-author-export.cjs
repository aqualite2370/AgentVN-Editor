"use strict";
// Fresh UI export from the exact installed Editor. Run only after the single
// installed narrative matrix and its profile restoration have finished.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const JSZip = require("../editor/node_modules/jszip");
const A = require("./lib/installed-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const { rows, listeners, until } = require("./lib/current-native-editor-session.cjs");
const { validateCartridge } = require("./installed-narrative-1922-export.cjs");
const { sha } = require("./lib/installed-runtime-session.cjs");
const attempt = process.argv[2]; assert.match(attempt || "", /^\d{2}$/);
const base = "F:/AgentVN/QA/Editor-1.9.24-20261024-01", out = path.join(base, `author-export-${attempt}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const desc = file => ({ path: path.resolve(file), sha256: sha(file), bytes: fs.statSync(file).size });
const installationFile = path.join(base, "installation.json"), installed = read(installationFile);
const historical = "F:/AgentVN/QA/Installed-Layout-20261021-01/editor-49/report.json", prior = read(historical);
const input = path.join(out, "本轮安装版作者导出隔离工程.vnproj");
const expectedTitle = { title: { visible: false, text: "安装版 1.9.24 自定义标题" },
  version: { visible: false, text: "本轮作者导出验证" } };
const report = { status: "RUNNING", startedAt: new Date().toISOString(), out,
  scope: "ACTUAL_INSTALLED_1_9_24_FRESH_UI_EXPORT_NARRATIVE_AND_TITLE_NOT_STANDALONE_OR_ANDROID",
  installation: desc(installationFile), historicalFixture: desc(historical), fixture: prior.fixture,
  steps: [], screenshots: [], cartridges: [], launches: [], cleanups: [], knownProcesses: [],
  errors: [], downloadEvents: [], modelRequests: 0, productChanges: 0, builds: 0,
  tools: [__filename, "scripts/installed-narrative-1922-export.cjs",
    "scripts/lib/installed-narrative-1922-fixture.cjs", "scripts/lib/installed-release-session.cjs",
    "scripts/lib/installed-acceptance.cjs", "scripts/lib/current-native-capture.cjs"].map(desc),
  boundaries: ["Controlled public fixture import, not native file-picker acceptance",
    "Real installed Editor layout authoring and fresh cartridge export",
    "Runtime iframe, not standalone/setup/Android; owned teardown, not normal window close"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
function verify() {
  assert.equal(installed.status, "PASS"); assert.equal(installed.metadataRestoration, "PASS");
  assert.equal(installed.executable.version, "1.9.24");
  for (const f of [report.installation, report.historicalFixture, installed.executable,
    ...installed.resources, ...installed.protectedFiles, ...report.tools])
    assert.equal(sha(f.path), f.sha256, f.path);
  assert.equal(prior.status, "PASS"); assert.equal(sha(prior.fixture.input), prior.fixture.inputSha256);
}
let owner, page;
async function step(name, fn) {
  const row = { name, status: "RUNNING", startedAt: new Date().toISOString() }; report.steps.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; }
  catch (error) { row.status = "FAILED"; row.error = String(error.stack || error); throw error; }
  finally { row.finishedAt = new Date().toISOString(); save(); console.log(`${row.status}: ${name}`); }
}
async function openRecent() {
  await page.locator(".project-home").waitFor();
  await page.locator(".recent-project-open:not(:disabled):visible").filter({ hasText: prior.fixture.title }).click();
  await page.locator(".editor-toolbar").waitFor(); await A.settleEditor(page);
}
async function layout() {
  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click(); await A.settleEditor(page);
}
async function publish(type) {
  await page.locator('[data-workspace-surface="publish"]:visible').click(); await A.settleEditor(page);
  const panel = page.locator(".cartridge-export-panel"); await panel.waitFor();
  await until(async () => {
    const initial = page.getByTestId("package-environment-operation-dialog");
    if (await initial.isVisible()) {
      const phase = await initial.getAttribute("data-environment-phase");
      if (!["completed", "failed"].includes(phase)) return false;
      await initial.getByRole("button", { name: phase === "completed" ? "完成" : "关闭", exact: true }).click();
      await initial.waitFor({ state: "detached" });
    }
    try { await panel.locator('[data-package-stage="settings"]').click({ timeout: 750 }); }
    catch { return false; }
    return panel.locator('[data-help-key="package.mode"]').isVisible();
  }, "actual publish settings readiness", 180000);
  await panel.locator('[data-help-key="package.mode"]').click();
  await page.getByRole("option", { name: /游戏卡带 .vncart/ }).click();
  const warning = page.getByRole("button", { name: "查看并确认警告", exact: true });
  if (await warning.isVisible()) await warning.click();
  const consent = page.locator('[data-help-key="package.confirmWarnings"]');
  if (await consent.isVisible()) await consent.check();
  (report.warnings ??= {})[type] = await panel.locator(".preflight-check.is-warning").allTextContents();
  const directory = path.join(out, `download-${type}`); fs.mkdirSync(directory);
  const download = await A.realDownload(page, owner.cdp, directory, panel.locator('[data-help-key="package.export"]'));
  const result = await validateCartridge(download.path, prior.fixture, type);
  const event = report.downloadEvents.find(e => e.type === "begin" && e.suggestedFilename === path.basename(download.path));
  assert(event); await until(() => report.downloadEvents.some(e => e.guid === event.guid &&
    e.type === "progress" && e.state === "completed"), "completed native download");
  const zip = await JSZip.loadAsync(fs.readFileSync(result.path), { checkCRC32: true });
  const skin = JSON.parse(await zip.file("ui/layout.json").async("string"));
  if (type === "renpy") assert.deepEqual(skin.renpyTitleText, expectedTitle);
  else assert.equal(skin.renpyTitleText, undefined, "Renpy authoring must not leak into AgentVN");
  if (report.cartridges.length) assert.equal(result.scriptSha256, report.cartridges[0].scriptSha256);
  report.cartridges.push(result); save(); await owner.shot(`fresh-export-${type}`); return result;
}
(async () => {
  save(); verify();
  const narrative = read(path.join(base, `narrative-audit-${attempt}/report.json`));
  assert.equal(narrative.status, "PASS"); assert.equal(narrative.sourceConclusion, "PASS");
  assert.equal(narrative.coverageComplete, true);
  report.narrativeAudit = desc(path.join(base, `narrative-audit-${attempt}/report.json`));
  assert(!rows().some(p => /^(agentvn-player|agentvn-editor|creator-backend|AgentVN Dev)\.exe$/i.test(p.Name)));
  fs.copyFileSync(prior.fixture.input, input, fs.constants.COPYFILE_EXCL);
  report.environment = { AGENTVN_TEST_PROJECT: input, AGENTVN_WORKSPACE_OUTPUT: out };
  owner = installedReleaseSession({ installationFile, out, input, report, save }); page = await owner.start();
  owner.cdp.on("Browser.downloadWillBegin", e => { report.downloadEvents.push({ type: "begin", ...e }); save(); });
  owner.cdp.on("Browser.downloadProgress", e => { report.downloadEvents.push({ type: "progress", ...e }); save(); });
  await step("Installed backend fixture import and real project home entry", async () => {
    const response = await fetch(`http://127.0.0.1:${owner.current.ports[0]}/api/project/projects/import`, {
      method: "POST", headers: { "content-type": "application/octet-stream",
        "X-AgentVN-Filename": encodeURIComponent(path.basename(input)) },
      body: fs.readFileSync(input), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json(); assert(response.ok && result.ok);
    assert.equal(result.data.project_id, prior.fixture.projectId);
    await page.reload(); await openRecent();
    return { projectId: result.data.project_id, nativePickerClaimed: false };
  });
  await step("Fresh AgentVN cartridge export retains every scene, branch and actual voice byte", () => publish("agentvn"));
  await step("Ordinary Renpy controls author independent title/version without changing project identity", async () => {
    await page.getByRole("button", { name: "关闭发布与打包", exact: true }).click(); await A.settleEditor(page);
    await layout(); await page.locator('.runtime-layout-type-switch [data-layout-type-option="renpy"]:visible').click();
    await page.locator('.runtime-layout-designer[data-layout-type="renpy"]').waitFor();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false");
    await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
    for (const [key, label] of [["title", "标题"], ["version", "版本"]]) {
      const inputField = page.getByRole("textbox", { name: `${label}文字`, exact: true });
      if (!await inputField.count()) await page.getByRole("button", { name: `自定义${label}文字`, exact: true }).click();
      await inputField.fill(expectedTitle[key].text);
      await page.getByRole("checkbox", { name: `显示${label}`, exact: true }).uncheck();
    }
    await page.locator('[data-help-key="layout.save"]:visible').click();
    await page.waitForFunction(() => document.querySelector(".runtime-layout-save-feedback")?.textContent?.includes("已保存"));
    const actual = (await owner.rawApi(`/api/project/projects/${prior.fixture.projectId}`)).data;
    assert.equal(actual.project_id, prior.fixture.projectId); assert.equal(actual.title, prior.fixture.title);
    assert.deepEqual(actual.editor_settings.runtimeUILayout.renpyTitleText, expectedTitle);
    const toggle = page.getByTestId("renpy-title-runtime-preview-toggle");
    if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
    await page.locator('.renpy-editor-runtime-viewport[data-preview-phase="ready"]').waitFor();
    const frame = page.frameLocator(".renpy-editor-runtime-viewport iframe");
    await frame.locator(".renpy-title-view").waitFor();
    assert.equal(await frame.locator(".renpy-title-heading h1,.renpy-title-heading p").count(), 0);
    await owner.shot("authored-hidden-title"); return { expectedTitle, projectIdentityPreserved: true };
  });
  await step("Real reload preserves authored title configuration", async () => {
    await page.reload(); await openRecent(); await layout();
    await page.getByTestId("renpy-title-editor").waitFor();
    await page.locator('[data-testid="renpy-page-region-editor"] [data-component-id="title_hero"]').click();
    assert.equal(await page.getByRole("checkbox", { name: "显示标题", exact: true }).isChecked(), false);
    assert.equal(await page.getByRole("checkbox", { name: "显示版本", exact: true }).isChecked(), false);
    assert.equal(await page.getByRole("textbox", { name: "标题文字", exact: true }).inputValue(), expectedTitle.title.text);
    assert.equal(await page.getByRole("textbox", { name: "版本文字", exact: true }).inputValue(), expectedTitle.version.text);
  });
  await step("Fresh Renpy cartridge contains actual title configuration and identical story/voice bytes", () => publish("renpy"));
  assert.equal(report.steps.length, 5); assert.equal(report.cartridges.length, 2); assert.deepEqual(report.errors, []);
  assert.equal(report.downloadEvents.filter(e => e.type === "begin").length, 2); report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-6000);
    await owner.shot("failure").catch(() => {});
  }
}).finally(async () => {
  try {
    await owner?.stop("Fresh author exports complete; owned termination, not normal window close");
    verify(); assert.deepEqual(listeners(report.launches.flatMap(l => l.ports)), []);
  } catch (error) {
    report.status = "FAILED"; report.cleanupError = String(error.stack || error); process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
});
