const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const runRoot = path.resolve(process.argv[2] || "");
assert(process.argv[2], "explicit installed acceptance directory required");
const expectedExportDir = path.resolve(process.argv[3] || path.join(runRoot, "windows-export"));
const expectedProjectTitle = process.env.INSTALLED_ACCEPTANCE_PROJECT_TITLE || "隐忍的成长";
assert(expectedExportDir.startsWith(`${runRoot}${path.sep}`), "export directory must stay inside this acceptance run");
fs.mkdirSync(expectedExportDir, { recursive: true });
const state = JSON.parse(fs.readFileSync(path.join(runRoot, "installed-processes.json"), "utf8"));
const out = path.join(runRoot, `windows-export-ui-${new Date().toISOString().replace(/[:.]/g, "-")}`);
fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(), state, warnings: [] };
let browser, page;
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function reconnect() {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${state.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().startsWith("http://tauri.localhost"));
  assert(page, "installed Release editor must be open");
}
async function dismissEnvironmentCompletion() {
  const dialog = page.getByRole("dialog").filter({ hasText: "环境检测已完成" }).last();
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    return true;
  }
  const backdrop = page.locator(".android-env-import-backdrop:visible")
    .filter({ hasText: "环境检测已完成" }).last();
  if (await backdrop.count()) {
    await backdrop.getByRole("button", { name: "完成", exact: true }).click();
    await backdrop.waitFor({ state: "hidden", timeout: 30_000 });
    return true;
  }
  return false;
}
async function main() {
  await reconnect();
  await dismissEnvironmentCompletion();
  if (!(await page.locator(".cartridge-export-panel").count())) {
    const publishButton = page.getByRole("button", { name: "发布", exact: true });
    await publishButton.waitFor({ state: "visible", timeout: 60_000 });
    await publishButton.click();
    await page.locator(".cartridge-export-panel").waitFor({ state: "visible", timeout: 180_000 });
  }
  await dismissEnvironmentCompletion();
  if (!process.argv.includes("--observe-only")) {
  assert((await page.locator(".cartridge-export-panel").innerText()).includes("Windows"), "wrong platform");
  const settingButton = page.getByRole("button", { name: /发布设置/ });
  await settingButton.click();
  const pickerReportPath = path.join(out, "native-output-picker.json");
  const pickerArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    path.join(__dirname, "gui-directory-picker-uia.ps1"),
    "-OwnerPid", String(state.editorPid), "-ReportPath", pickerReportPath,
    "-Directory", expectedExportDir, "-TitlePattern", "软件包导出目录"];
  const picker = spawn("powershell.exe", pickerArgs, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let pickerOutput = "";
  picker.stdout.on("data", data => { pickerOutput += data; });
  picker.stderr.on("data", data => { pickerOutput += data; });
  const pickerDone = new Promise((resolve, reject) => {
    picker.on("error", reject);
    picker.on("exit", code => code === 0
      ? resolve()
      : reject(Error(`Owned native output picker helper ${code}: ${pickerOutput}`)));
  });
  pickerDone.catch(() => {});
  await page.locator('[data-help-key="package.chooseOutputDir"]:visible').click();
  await pickerDone;
  report.outputPicker = JSON.parse(fs.readFileSync(pickerReportPath, "utf8"));
  assert.equal(report.outputPicker.status, "PASS");
  await page.waitForFunction(expected => {
    return document.querySelector('[data-help-key="package.outputDir"]')?.value === expected;
  }, expectedExportDir);
  assert.equal(
    path.resolve(await page.getByPlaceholder("请选择 .exe/.msi/.apk 输出目录").inputValue()),
    expectedExportDir,
    "installed editor output directory does not match the explicitly selected acceptance directory",
  );
  assert.equal(await page.locator('input[title="游戏标题"]').inputValue(), expectedProjectTitle);
  await page.getByRole("button", { name: "查看并确认警告", exact: true }).click();
  const warnings = page.locator(".preflight-check.is-warning button");
  for (let index = 0; index < await warnings.count(); index++) {
    await warnings.nth(index).click();
    report.warnings.push(await page.getByTestId("package-preflight-detail-dialog").innerText());
    await page.getByRole("button", { name: "返回检查", exact: true }).click();
  }
  save();
  await page.getByRole("checkbox", { name: "我已检查全部警告，本次继续导出", exact: true }).check();
  await page.screenshot({ path: path.join(out, "before-build.png") });
  await page.locator(".package-primary-action").click();
  report.clickedAt = new Date().toISOString();
  save();
  } else {
    report.observationOnly = true;
    assert(await page.locator(".package-primary-action[aria-busy=true]").count(),
      "observe-only requires an already active build; it must never start one");
    save();
  }
  const deadline = Date.now() + 60 * 60_000;
  let previous = "";
  while (Date.now() < deadline) {
    if (page.isClosed() || !browser.isConnected()) {
      report.connectionLosses = (report.connectionLosses || 0) + 1;
      save();
      await reconnect();
    }
    if (await page.getByTestId("package-build-result-dialog").isVisible()) {
      report.result = await page.getByTestId("package-build-result-dialog").innerText();
      report.console = await page.locator(".package-log-console").innerText();
      await page.screenshot({ path: path.join(out, "result.png") });
      report.status = "RESULT_READY";
      return;
    }
    let text = "";
    try {
      const consoleLocator = page.locator(".package-log-console");
      await consoleLocator.waitFor({ state: "visible", timeout: 5_000 });
      text = await consoleLocator.innerText();
    } catch (error) {
      // The publish workbench briefly unmounts the log dock while moving from
      // checks to the export stage. This is a transient UI transition, not a
      // build failure; keep observing the same native build.
      report.transientLogPanelMisses = (report.transientLogPanelMisses || 0) + 1;
      report.lastTransientLogPanelError = String(error.message || error);
      save();
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    fs.writeFileSync(path.join(out, "live-console.txt"), text);
    if (text !== previous) {
      console.log(text.slice(-900));
      previous = text;
      report.lastProgressAt = new Date().toISOString();
      save();
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  throw Error("Observation deadline reached; inspect native processes before restarting or stopping build");
}
main().catch(async error => {
  report.status = "OBSERVATION_FAILED";
  report.error = String(error.stack || error);
  process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(out, "observation-failure.png") }).catch(() => {});
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, result: report.result, error: report.error, out }));
  if (browser) await browser.close();
});
