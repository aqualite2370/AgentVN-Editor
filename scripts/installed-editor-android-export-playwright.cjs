const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
assert(process.argv[2], "explicit installed acceptance directory required");
const runRoot = path.resolve(process.argv[2]);
const { state } = A.readInstalledSession(runRoot);
const expectedTitle = process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE;
const target = require("./lib/android-export-target.cjs").validateExportTarget({
  title: expectedTitle, proofFile: process.env.INSTALLED_ACCEPTANCE_FINAL_PROJECT_PROOF,
  projectFile: process.env.AGENTVN_TEST_PROJECT, sessionRoot: runRoot,
});
const expectedExportDir = path.join(runRoot, "android-export");
fs.mkdirSync(expectedExportDir, { recursive: true });
const out = path.join(runRoot, `android-export-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), state,
  target: { scope: target.scope, projectId: target.projectId, proof: target.proof },
  warnings: [], observationOnly: process.argv.includes("--observe-only") };
let browser, page;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function connect() {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => /tauri\.localhost|tauri:/.test(p.url()));
  assert(page, "actual installed editor WebView required");
  page.setDefaultTimeout(60000);
}
async function completeInitialEnvironment() {
  report.stage = "initial-environment"; save();
  await A.settleEditor(page);
  await page.waitForFunction(() => document.querySelector('[data-testid="package-environment-operation-dialog"]')
    || ["passed", "failed"].includes(document.querySelector(".package-primary-action")
      ?.getAttribute("data-environment-status")), null, { timeout: 180000 });
  const dialog = page.getByTestId("package-environment-operation-dialog");
  if (await dialog.isVisible()) {
    await page.waitForFunction(() => ["completed", "failed"].includes(
      document.querySelector('[data-testid="package-environment-operation-dialog"]')
        ?.getAttribute("data-environment-phase")), null, { timeout: 180000 });
    report.initialEnvironment = await dialog.innerText(); save();
    assert.equal(await dialog.getAttribute("data-environment-phase"), "completed", report.initialEnvironment);
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
}
async function completeEnvironment() {
  report.stage = "android-environment"; save();
  await page.waitForFunction(() => document.querySelector('[data-testid="package-environment-operation-dialog"]')
    || ["passed", "failed"].includes(document.querySelector(".android-env-panel:not(.windows-env-panel)")
      ?.getAttribute("data-environment-verification")), null, { timeout: 180000 });
  const dialog = page.getByTestId("package-environment-operation-dialog");
  if (await dialog.isVisible()) {
    await page.waitForFunction(() => ["completed", "failed"].includes(
      document.querySelector('[data-testid="package-environment-operation-dialog"]')
        ?.getAttribute("data-environment-phase")), null, { timeout: 180000 });
    report.environment = await dialog.innerText(); save();
    assert.equal(await dialog.getAttribute("data-environment-phase"), "completed", report.environment);
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
  }
  assert.equal(await page.locator(".android-env-panel:not(.windows-env-panel)")
    .getAttribute("data-environment-verification"), "passed", "Actual installed Android environment must pass");
}
async function chooseOutput() {
  report.stage = "native-output-picker"; save();
  const nativeReport = path.join(out, "native-output-picker.json");
  const helper = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "gui-directory-picker-uia.ps1"), "-OwnerPid", String(state.editorPid),
    "-ReportPath", nativeReport, "-Directory", expectedExportDir, "-TitlePattern", "软件包导出目录"],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  helper.stdout.on("data", data => { text += data; });
  helper.stderr.on("data", data => { text += data; });
  const completed = new Promise((resolve, reject) => {
    helper.once("error", reject);
    helper.once("close", code => code === 0 ? resolve() : reject(Error(`Native picker ${code}: ${text}`)));
  });
  completed.catch(() => {});
  await page.locator('[data-help-key="package.chooseOutputDir"]:visible').click();
  await completed;
  report.outputPicker = JSON.parse(fs.readFileSync(nativeReport, "utf8"));
  assert.equal(report.outputPicker.status, "PASS");
  await page.waitForFunction(expected => document.querySelector('[data-help-key="package.outputDir"]')
    ?.value === expected, expectedExportDir);
}
(async () => {
  if (!report.observationOnly) {
    const token = spawnSync("powershell.exe", ["-NoProfile", "-Command",
      '$p=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); @{isElevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);processId=$PID} | ConvertTo-Json -Compress'],
    { windowsHide: true, encoding: "utf8" });
    assert.equal(token.status, 0, token.stderr);
    const processToken = JSON.parse(token.stdout.replace(/^\uFEFF/, "").trim());
    assert(processToken.isElevated, "ANDROID_ADMIN_REQUIRED: actual export runner must be elevated");
    const permissionDir = process.env.INSTALLED_ACCEPTANCE_ANDROID_PERMISSION_DIR
      || path.join(runRoot, "android-admin-preflight");
    assert(A.inside(runRoot, permissionDir), "Administrator evidence must remain inside the current run");
    const permission = JSON.parse(fs.readFileSync(path.join(permissionDir, "acceptance-permission.json"), "utf8"));
    assert(permission.isElevated && permission.success, "real administrator token and symlink probe required");
    assert(Date.now() - Date.parse(permission.checkedAt) < 60 * 60_000, "permission probe must be from this acceptance run");
    assert(A.inside(permissionDir, permission.probeRoot),
      "Symlink probe must belong to this run");
    report.processToken = processToken;
    report.permission = permission;
    report.stage = "connect-installed-editor"; save();
    await connect();
    if (!await page.locator(".cartridge-export-panel").count()) {
      await page.getByRole("button", { name: "发布", exact: true }).click();
      await page.locator(".cartridge-export-panel").waitFor({ state: "visible" });
    }
    await completeInitialEnvironment();
    await page.getByRole("button", { name: /发布设置/ }).click();
    await page.locator('[data-help-key="package.platform"]:visible').click();
    await page.getByRole("option", { name: /^Android(?:\s|$)/ }).click();
    await completeEnvironment();
    await chooseOutput();
    assert.equal(await page.locator('input[title="游戏标题"]').inputValue(), expectedTitle);
    await page.getByRole("button", { name: "查看并确认警告", exact: true }).click();
    const warnings = page.locator(".preflight-check.is-warning button");
    for (let index = 0; index < await warnings.count(); index++) {
      await warnings.nth(index).click();
      report.warnings.push(await page.getByTestId("package-preflight-detail-dialog").innerText());
      await page.getByRole("button", { name: "返回检查", exact: true }).click();
    }
    save();
    const warningsConfirmation = page.getByRole("checkbox", { name: "我已检查全部警告，本次继续导出", exact: true });
    if (await warningsConfirmation.isVisible()) await warningsConfirmation.check();
    await page.screenshot({ path: path.join(out, "before-build.png") });
    await page.locator(".package-primary-action").click();
    report.clickedAt = new Date().toISOString();
    report.stage = "build-observation";
  } else {
    await connect();
    assert(await page.locator(".package-primary-action[aria-busy=true]").count()
      || await page.getByTestId("package-build-result-dialog").isVisible(), "nothing to observe; will not start a duplicate");
  }
  save();
  const deadline = Date.now() + 90 * 60_000;
  let previous = "";
  while (Date.now() < deadline) {
    if (!browser.isConnected() || page.isClosed()) {
      report.reconnections = (report.reconnections || 0) + 1;
      save();
      await connect();
    }
    if (await page.getByTestId("package-build-result-dialog").isVisible()) {
      report.result = await page.getByTestId("package-build-result-dialog").innerText();
      report.console = await page.locator(".package-log-console").innerText();
      await page.screenshot({ path: path.join(out, "result.png") });
      report.status = /构建成功/.test(report.result) ? "BUILD_UI_PASS" : "BUILD_UI_FAILED";
      if (report.status !== "BUILD_UI_PASS") process.exitCode = 1;
      return;
    }
    const text = await page.locator(".package-log-console").innerText();
    if (text !== previous) {
      fs.writeFileSync(path.join(out, "live-console.txt"), text);
      console.log(text.slice(-1200));
      previous = text; report.lastProgressAt = new Date().toISOString(); save();
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw Error("Observation deadline exceeded; inspect the original helper before restarting. This does not terminate the build.");
})().catch(async error => {
  report.status = "OBSERVATION_FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(out, "observation-failure.png") }).catch(() => {});
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save();
  if (browser) await browser.close();
  console.log(JSON.stringify({ status: report.status, result: report.result, error: report.error, out }));
});
