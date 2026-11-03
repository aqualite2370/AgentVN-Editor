"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const JSZip = require("../editor/node_modules/jszip");
const { fixture } = require("./lib/editor-ui-acceptance.cjs");
const { installedReleaseSession } = require("./lib/installed-release-session.cjs");
const A = require("./lib/installed-acceptance.cjs");

const root = path.resolve(__dirname, "..");
const qa = "F:/AgentVN/QA/Editor-1.9.27-20261026-01";
const installationFile = path.join(qa, "installation.json");
const attempt = process.argv[2] || "01";
assert.match(attempt, /^\d{2}$/);
const out = path.join(qa, `installed-title-button-export-${attempt}`);
assert(!fs.existsSync(out));
fs.mkdirSync(out, { recursive: true });

const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const desc = file => ({
  path: path.resolve(file),
  sha256: sha(file),
  bytes: fs.statSync(file).size,
  modifiedUtc: fs.statSync(file).mtime.toISOString(),
});
const installation = read(installationFile);
assert.equal(installation.status, "PASS");
assert.equal(installation.metadataRestoration, "PASS");
assert.equal(installation.version, "1.9.27");

const project = fixture("installed-renpy-title-button-export-01");
project.title = "安装版 Ren’Py 默认标题按钮导出验收";
project.nodes[0].data.openingAudio = [];
const input = path.join(out, "安装版RenPy标题按钮导出工程.vnproj");
fs.writeFileSync(input, JSON.stringify(project), { flag: "wx" });
fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL);

const report = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  candidateVersion: "1.9.27",
  scope: "ACTUAL_INSTALLED_EDITOR_RENPY_TITLE_BUTTON_DEFAULT_STYLE_EXPORT",
  modelRequests: 0,
  installation: desc(installationFile),
  input: desc(input),
  actions: [],
  launches: [],
  screenshots: [],
  cartridge: undefined,
  errors: [],
  cleanups: [],
};
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));

let host;
(async () => {
  host = installedReleaseSession({ installationFile, out, report, save, input });
  const page = await host.start();
  report.actions.push({ action: "installed-editor-start", status: "PASS", version: installation.version });

  const importResponse = await fetch(`http://127.0.0.1:${host.current.ports[0]}/api/project/projects/import`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "X-AgentVN-Filename": encodeURIComponent(path.basename(input)),
    },
    body: fs.readFileSync(input),
  });
  const imported = await importResponse.json();
  assert(importResponse.ok && imported.ok);
  assert.equal(imported.data.project_id, project.project_id);
  await page.reload();
  await page.locator(".project-home").waitFor();
  await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: project.title }).click();
  await A.settleEditor(page);
  report.actions.push({ action: "project-import-and-open", status: "PASS", projectId: project.project_id });

  await page.locator('[data-workspace-surface="options"]:visible').click();
  await page.locator('[data-help-key="advanced.tab.layout"]:visible').click();
  await A.settleEditor(page);
  const renpy = page.locator('[data-layout-type-option="renpy"]:visible');
  if (await renpy.getAttribute("aria-pressed") !== "true") await renpy.click();
  await page.waitForFunction(() => {
    const designer = document.querySelector('.runtime-layout-designer[data-layout-type="renpy"]');
    return designer && document.querySelector(".runtime-layout-type-control")?.getAttribute("aria-busy") === "false";
  });
  await A.settleEditor(page);
  await page.locator('[data-help-key="layout.save"]:visible').click();
  await page.locator('[data-help-key="layout.save"][data-save-state="saved"]').waitFor();
  const saved = await A.projectSnapshot(host.current.ports[0]);
  const savedLayout = saved.settings.runtimeUILayout;
  assert.equal(savedLayout.layout_type, "renpy");
  const savedButton = savedLayout.screens.find(screen => screen.screen_id === "title")
    .components.find(component => component.component_id === "title_start_button");
  assert(savedButton && savedButton.style, "saved Ren’Py layout must retain the default title-button style");
  assert.equal(savedButton.titleButtonStyleSource, undefined);
  report.actions.push({
    action: "renpy-layout-save",
    status: "PASS",
    layoutType: savedLayout.layout_type,
    buttonStyle: savedButton.style,
  });

  await page.locator('[data-workspace-surface="publish"]:visible').click();
  const panel = page.locator(".cartridge-export-panel");
  await panel.waitFor();
  await page.waitForFunction(() => !document.querySelector(".cartridge-export-panel")?.innerText.includes("正在检测当前构建环境"));
  await A.dismissEnvironmentCompletion(page);
  const mode = panel.locator('[data-help-key="package.mode"]');
  await mode.click();
  await page.getByRole("option").filter({ hasText: "游戏卡带 .vncart" }).click();
  await panel.locator('.package-stage-navigation-item[data-package-stage="checks"]').click();
  const warning = panel.getByRole("checkbox", { name: /我已检查全部警告/ });
  if (await warning.count()) await warning.check();

  const download = await Promise.all([
    page.waitForEvent("download"),
    panel.locator(".package-primary-action").click(),
  ]).then(([event]) => event);
  const downloaded = path.resolve(out, download.suggestedFilename());
  assert.equal(await download.failure(), null);
  const deadline = Date.now() + 60000;
  while (!fs.existsSync(downloaded) && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 100));
  assert(fs.existsSync(downloaded), `installed download did not materialize at ${downloaded}`);
  const zip = await JSZip.loadAsync(fs.readFileSync(downloaded), { checkCRC32: true });
  const packedLayout = JSON.parse(await zip.file("ui/layout.json").async("string"));
  const packedButton = packedLayout.screens.find(screen => screen.screen_id === "title")
    .components.find(component => component.component_id === "title_start_button");
  assert.deepEqual(
    packedButton.style,
    savedButton.style,
    "installed export must preserve the saved Ren’Py default title-button style",
  );
  assert.equal(packedButton.titleButtonStyleSource, savedButton.titleButtonStyleSource);
  assert.deepEqual(packedLayout, savedLayout);
  report.cartridge = {
    ...desc(downloaded),
    layoutSha256: crypto.createHash("sha256")
      .update(await zip.file("ui/layout.json").async("nodebuffer"))
      .digest("hex"),
    layoutType: packedLayout.layout_type,
    titleButtonStyle: packedButton.style,
  };
  report.actions.push({ action: "installed-cartridge-export", status: "PASS", cartridge: report.cartridge });
  await host.shot("installed-title-button-export");
  report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED";
  report.error = String(error.stack || error);
  report.errors.push(report.error);
  process.exitCode = 1;
}).finally(async () => {
  try {
    await host?.stop("installed title button export");
    report.cleanups.push({ status: "PASS" });
  } catch (error) {
    report.status = "FAILED";
    report.cleanupError = String(error.stack || error);
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({
    status: report.status,
    out,
    error: report.error,
    cleanupError: report.cleanupError,
  }));
});
