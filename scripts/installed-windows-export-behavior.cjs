"use strict";
// Actual frozen installed Editor; native output selection is left to Computer
// Use. No picker mocks, store writes, manual backend or source build fallback.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { sha256, settleEditor, dismissEnvironmentCompletion } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const run = process.env.AGENTVN_WORKSPACE_OUTPUT || "D:/AgentVN/output/installed-windows-export-20261018-01";
assert(/^D:\/AgentVN\/output\/installed-windows-export-20261018-0[1-9]$/i.test(run.replaceAll("\\", "/")));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const [phase, out] = process.argv.slice(2);
assert(["prepare-ui", "environment", "choose-native", "build", "observe"].includes(phase));
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const launch = read(path.join(run, "launch.json")), fixture = read(path.join(run, "fixtures.json"));
const prep = read(path.join(run, "preparation.json"));
assert.equal(prep.status, "PASS"); assert(prep.profiles.every(p => fs.existsSync(p.held)));
assert.equal(path.resolve(process.env.AGENTVN_TEST_PROJECT), path.resolve(fixture.input));
assert.equal(path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT), path.resolve(run));
const report = { status: "RUNNING", phase, at: new Date().toISOString(), checks: [], screenshots: [],
  realModelRequests: 0, productChanges: 0, pageErrors: [], error: null,
  scope: "ACTUAL_FROZEN_NSIS_EDITOR_DEFAULT_PROFILES_HELD; NOT_CLEAN_MACHINE; UI_WINDOWS_EXPORT" };
let browser, page, cdp;
const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
async function step(name, fn) {
  const row = { name, status: "RUNNING", at: new Date().toISOString() }; report.checks.push(row); save();
  try { row.detail = await fn(); row.status = "PASS"; console.log(`PASS ${name}`); }
  catch (e) { row.status = "FAILED"; row.error = String(e.stack || e); throw e; }
  finally { save(); }
}
async function shot(name) {
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `${name}.png`), expected)); save();
}
async function environmentSettled() {
  await page.waitForFunction(() => {
    const panel = document.querySelector(".windows-env-panel");
    return panel && ["passed", "failed"].includes(panel.getAttribute("data-environment-verification"))
      && document.querySelector('[data-help-key="package.windowsEnvCheck"]')?.disabled === false
      && document.querySelector('[data-testid="package-environment-operation-dialog"]')
        ?.getAttribute("data-environment-phase") !== "running";
  }, null, { timeout: 240000 });
  await dismissEnvironmentCompletion(page);
  const completion = page.locator(".android-env-import-backdrop:visible").filter({ hasText: "环境检测已完成" });
  if (await completion.count()) {
    await completion.getByRole("button", { name: "完成", exact: true }).click();
    await completion.waitFor({ state: "hidden" });
  }
  report.environment = await page.locator(".windows-env-panel").innerText();
  report.environmentState = await page.locator(".windows-env-panel").getAttribute("data-environment-verification");
  report.console = await page.locator(".package-log-console").innerText().catch(() => "");
  save();
}
(async () => {
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  assert.equal(sha256(fs.readFileSync(fixture.input)), fixture.inputSha256);
  report.launch = launch; report.fixture = fixture;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost"));
  assert(page); page.setDefaultTimeout(30000); page.on("pageerror", e => report.pageErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await readInstalledViewport(page, expected);
  if (phase === "prepare-ui") {
    await step("Controlled fixture import through real packaged backend then actual recent-project entry", async () => {
      const response = await fetch(`http://127.0.0.1:${launch.backendPort}/api/project/projects/import`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream",
          "X-AgentVN-Filename": encodeURIComponent(path.basename(fixture.input)) },
        body: fs.readFileSync(fixture.input), signal: AbortSignal.timeout(30000) });
      const result = await response.json(); assert(response.ok && result.ok && result.data.project_id === fixture.projectId);
      await page.reload({ waitUntil: "domcontentloaded" }); await dismissEnvironmentCompletion(page);
      await page.locator('[data-help-key="home.recentProject"]').filter({ hasText: fixture.title }).click();
      await page.locator(".editor-toolbar").waitFor(); await settleEditor(page);
      assert.equal(await page.evaluate(() => window.__AGENTVN_PROJECT_STORE__.getState().projectId), fixture.projectId);
      await shot("isolated-project"); return { nativeProjectPickerClaim: false, projectId: fixture.projectId };
    });
    await step("Real publish entry and Windows environment verification without fixing or installing dependencies", async () => {
      await page.getByRole("button", { name: "发布", exact: true }).click();
      await page.locator(".cartridge-export-panel").waitFor();
      await environmentSettled();
      await page.locator('[data-package-stage="settings"]').click();
      assert((await page.locator('[data-help-key="package.mode"]').innerText()).includes("打包 Windows 单软件"));
      assert((await page.locator('[data-help-key="package.platform"]').innerText()).includes("Windows"));
      await shot("windows-environment");
      // A failed environment result is product/environment evidence, not a
      // reason to silently install system dependencies.
      assert.equal(report.environmentState, "passed", report.environment);
      assert.equal(await page.locator('input[title="游戏标题"]').inputValue(), fixture.title);
      return { state: report.environmentState, text: report.environment };
    });
  } else if (phase === "environment") {
    await step("Continue the imported real UI and observe the actual recheck button, explicitly recording any cache reuse", async () => {
      await environmentSettled();
      await page.locator('[data-package-stage="settings"]').click();
      const before = await page.locator(".package-log-console").innerText();
      await page.locator('[data-help-key="package.windowsEnvCheck"]').click();
      await page.waitForFunction(() =>
        document.querySelector('[data-help-key="package.windowsEnvCheck"]')?.disabled === true);
      await page.waitForFunction(() =>
        document.querySelector('[data-help-key="package.windowsEnvCheck"]')?.disabled === false,
      null, { timeout: 240000 });
      await environmentSettled();
      report.previousConsole = before;
      report.fullProbeClaim = false;
      report.cacheReuseObserved = report.console.includes("skipped the repeated full check");
      await shot("observed-windows-environment");
      assert.equal(report.environmentState, "passed", report.environment);
      const details = page.locator(".package-environment-details");
      if (!await details.evaluate(n => n.open)) await details.locator("summary").click();
      report.environmentDetails = await details.innerText(); save();
      return { state: report.environmentState, text: report.environment, details: report.environmentDetails };
    });
  } else if (phase === "choose-native") {
    await environmentSettled();
    await page.locator('[data-package-stage="settings"]').click(); await settleEditor(page);
    await step("Real native output-directory selection; no Tauri/store substitution", async () => {
      report.nativeInput = { status: "WAITING_FOR_REAL_NATIVE_DIALOG", ownerPid: launch.editorPid,
        title: "选择软件包导出目录", selectedPath: fixture.output, at: new Date().toISOString() }; save();
      await page.locator('[data-help-key="package.chooseOutputDir"]').click();
      console.log(JSON.stringify({ nativeInput: report.nativeInput, out }));
      await page.waitForFunction(expectedPath =>
        document.querySelector('[data-help-key="package.outputDir"]')?.value === expectedPath,
      fixture.output, { timeout: 150000 });
      report.nativeInput.status = "REAL_NATIVE_UI_RESULT_OBSERVED"; await shot("output-selected");
      return { selectedPath: await page.locator('[data-help-key="package.outputDir"]').inputValue() };
    });
  } else {
    await dismissEnvironmentCompletion(page);
    if (phase === "build") {
      await step("Start one actual Windows build from visible publish controls", async () => {
        await page.locator('[data-package-stage="settings"]').click();
        assert.equal(await page.locator('[data-help-key="package.outputDir"]').inputValue(), fixture.output);
        await environmentSettled(); assert.equal(report.environmentState, "passed");
        const confirmation = page.getByRole("button", { name: "查看并确认警告", exact: true });
        if (await confirmation.isVisible()) {
          await confirmation.click();
          report.warnings = await page.locator(".preflight-check.is-warning").allTextContents();
          await page.getByRole("checkbox", { name: "我已检查全部警告，本次继续导出", exact: true }).check();
        }
        const button = page.locator(".package-primary-action"); assert(await button.isEnabled());
        await shot("before-build"); await button.click();
        report.clickedAt = new Date().toISOString(); save(); return { clickedAt: report.clickedAt };
      });
    } else assert(await page.locator(".package-primary-action[aria-busy=true]").count(),
      "Observe must not start a second build");
    await step("Observe real build result and retained diagnostic paths; no automatic rebuild", async () => {
      const until = Date.now() + 60 * 60 * 1000; let previous = "";
      while (Date.now() < until) {
        const dialog = page.getByTestId("package-build-result-dialog");
        if (await dialog.isVisible()) {
          report.result = await dialog.innerText();
          report.console = await page.locator(".package-log-console").innerText().catch(() => "");
          report.resultObservedAt = new Date().toISOString(); await shot("build-result");
          const files = fs.readdirSync(fixture.output).map(n => path.join(fixture.output, n))
            .filter(f => fs.statSync(f).isFile());
          report.artifacts = files.map(f => ({ path: f, bytes: fs.statSync(f).size,
            sha256: sha256(fs.readFileSync(f)), generatedAt: fs.statSync(f).mtime.toISOString() }));
          save(); assert(report.artifacts.some(f => /\.exe$/i.test(f.path)), report.result);
          return { text: report.result, artifacts: report.artifacts };
        }
        const text = await page.locator(".package-log-console").innerText().catch(() => "");
        if (text !== previous) {
          previous = text; report.console = text; report.lastProgressAt = new Date().toISOString(); save();
          console.log(text.slice(-600));
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      throw Error("Actual build observation deadline; inspect owned build process before cleanup");
    });
  }
  assert.equal(report.pageErrors.length, 0); report.status = "PASS";
})().catch(e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
}).finally(async () => {
  report.finishedAt = new Date().toISOString(); save(); await browser?.close();
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length, error: report.error, out }));
});
