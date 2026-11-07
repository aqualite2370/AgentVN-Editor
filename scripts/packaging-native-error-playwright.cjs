"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { until } = require("./lib/current-native-editor-session.cjs");
const attempt = process.argv[2];
assert.match(attempt, /^\d{2}$/);
const base = `F:/AgentVN/QA/Packaging-Native-Error-20261107-${attempt}`;
assert(!fs.existsSync(base)); fs.mkdirSync(base, { recursive: true });
const input = path.join(base, "isolated.vnproj"), out = path.join(base, "browser");
fs.writeFileSync(input, JSON.stringify(fixture("qa-packaging-native-errors-" + attempt)));
process.env.AGENTVN_TEST_PROJECT = input; process.env.AGENTVN_WORKSPACE_OUTPUT = out;
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_CONTROLLED_NATIVE_ERROR_NOT_INSTALLED",
  startedAt: new Date().toISOString(), cases: [], models: 0, builds: 0, cleanup: "PENDING" };
const save = () => fs.writeFileSync(path.join(base, "report.json"), JSON.stringify(report, null, 2));
let host, browser;
(async () => {
  try {
    save(); host = await startEditorAcceptance(out, { isolateBackendWorkingDirectory: true });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript(() => {
      window.__QA_FAIL__ = true; window.__QA_CALLS__ = [];
      window.__TAURI_INTERNALS__ = {
        transformCallback: () => 1, unregisterCallback() {}, callbacks: {},
        invoke: async (command, args) => {
          if (command.startsWith("plugin:event|")) return 1;
          if (command === "write_frontend_error_log" || command === "write_error_log") return;
          if (command === "check_windows_build_environment") {
            window.__QA_CALLS__.push({ command, args, failed: window.__QA_FAIL__ });
            if (window.__QA_FAIL__) throw "Failed to publish JSON C:\\测试目录\\windows-env-check.json atomically: 系统找不到指定的路径。 (os error 3)";
            return { ok: true, status: "PASS", checks: [], missing: [], warnings: [], manualFix: [], cacheHit: true };
          }
          throw Error("Unexpected controlled native command: " + command);
        },
      };
    });
    await host.open(page);
    await page.locator('[data-workspace-surface="publish"]:visible').click();
    const dialog = page.getByTestId("package-environment-operation-dialog");
    await dialog.waitFor();
    await until(async () => await dialog.getAttribute("data-environment-phase") === "failed", "initial string rejection");
    for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
      for (const dpr of [1, 2]) for (const reduced of [false, true]) {
        await host.server.assertAlive();
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
        await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
        await page.evaluate(() => { window.__QA_FAIL__ = true; });
        if (!(await dialog.isVisible())) await page.locator('[data-help-key="package.windowsEnvCheck"]:visible').click();
        await until(async () => await dialog.getAttribute("data-environment-phase") === "failed", "visible failure");
        const text = await dialog.innerText();
        assert(text.includes("系统找不到指定的路径。 (os error 3)"));
        assert(text.includes("C:\\测试目录\\windows-env-check.json"));
        assert(await page.locator('[data-help-key="package.export"]:visible').isDisabled());
        const metrics = await dialog.evaluate(el => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
        });
        assert.equal(metrics.width, width); assert.equal(metrics.height, height); assert.equal(metrics.dpr, dpr);
        assert(metrics.x >= 0 && metrics.y >= 0 && metrics.right <= width && metrics.bottom <= height);
        const close = dialog.getByRole("button", { name: "关闭", exact: true });
        await close.focus(); assert(await close.evaluate(el => el === document.activeElement));
        await close.press("Enter"); await dialog.waitFor({ state: "hidden" });
        await page.evaluate(() => { window.__QA_FAIL__ = false; });
        await page.locator('[data-help-key="package.windowsEnvCheck"]:visible').click();
        await until(async () => await dialog.getAttribute("data-environment-phase") === "completed", "retry success");
        assert.equal(await page.locator('.windows-env-panel').getAttribute("data-environment-verification"), "passed");
        await dialog.getByRole("button", { name: "完成", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        report.cases.push({ status: "PASS", width, height, dpr, reduced, metrics,
          checks: ["native-string-detail", "build-disabled-on-failure", "close-focus-and-keyboard", "retry-and-success"] });
        save(); await cdp.detach();
      }
    }
    report.nativeCalls = await page.evaluate(() => window.__QA_CALLS__);
    assert.equal(report.cases.length, 12); assert(report.nativeCalls.length >= 24);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    await browser?.close();
    try { await host?.stop(); report.cleanup = "PASS"; }
    catch (error) { report.cleanup = "FAILED"; report.cleanupError = String(error); process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, cleanup: report.cleanup, error: report.error, base }));
  }
})();
