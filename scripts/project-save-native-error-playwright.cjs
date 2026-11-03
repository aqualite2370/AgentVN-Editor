"use strict";
// Real Editor button/notice flow with a controlled native write rejection.
// This is a host-boundary regression, not evidence of installed native writing.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require("../editor/node_modules/playwright");
const { fixture, startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.resolve(process.env.AGENTVN_NATIVE_SAVE_ERROR_OUTPUT || "");
assert(out.toLowerCase().startsWith("f:\\agentvn\\qa\\") && !fs.existsSync(out),
  "Explicit fresh F:/AgentVN/QA output required");
fs.mkdirSync(out, { recursive: true });
const input = path.join(out, "isolated-small.vnproj");
fs.writeFileSync(input, JSON.stringify(fixture(`native-save-error-${runId}`)));
process.env.AGENTVN_TEST_PROJECT = input;
process.env.AGENTVN_WORKSPACE_OUTPUT = path.join(out, "service");
const report = { status: "RUNNING", input, scope: "Editor browser / controlled native error, not installed acceptance",
  cases: [], errors: [] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
(async () => {
  let env, browser, page;
  try {
    env = await startEditorAcceptance();
    browser = await chromium.launch({ headless: process.env.ADVANCED_TOOLS_HEADFUL !== "1" });
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on("pageerror", error => report.errors.push(String(error)));
    let downloads = 0; page.on("download", () => downloads++);
    await env.open(page); await settleEditor(page);
    const cdp = await page.context().newCDPSession(page);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const item = { width, height, dpr, reduced, status: "RUNNING" };
      report.cases.push(item); save();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await settleEditor(page);
      item.viewport = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
      }));
      assert.deepEqual(item.viewport, { width, height, dpr, reduced });
      await page.evaluate(() => {
        window.__nativeSaveCommands = [];
        window.__nativeSaveReports = [];
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          window.__nativeSaveCommands.push(command);
          if (command === "write_project_bundle")
            throw "PROJECT_EXPORT_DIRECTORY_WRITE_FAILED: 无法将工程包写入保存目录「F:\\中文 保存目录」 （创建工程包临时文件）：拒绝访问。 (os error 5)。请检查目录写入权限与可用空间，恢复后重试或重新选择保存目录；不会改存到其他目录。";
          // Error report persistence is unrelated to the controlled write error.
          if (["write_error_report", "open_error_report"].includes(command)) {
            window.__nativeSaveReports.push({ command, message: args.message }); return "controlled-host-report";
          }
          if (command === "append_frontend_error") return "controlled-host-report";
          throw new Error(`Unexpected controlled native command: ${command}`);
        } };
      });
      await page.getByRole("button", { name: "保存工程", exact: true }).click();
      const notice = page.locator(".toast-status.is-error").filter({ hasText: "PROJECT_EXPORT_DIRECTORY_WRITE_FAILED" });
      await notice.waitFor({ timeout: 10000 });
      item.message = await notice.innerText();
      assert(!item.message.includes("请确认素材仍可在素材库中预览"), "Output IO cannot be misclassified as asset input");
      assert.equal(await page.getByTestId("project-save-confirmation").count(), 0, "Failed write cannot show success");
      assert.equal(downloads, 0, "Failed native save cannot fall back to a browser download");
      item.geometry = await notice.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { rect: r.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth,
          hit: node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
      });
      assert(item.geometry.overflow <= 1 && item.geometry.rect.left >= 0 && item.geometry.rect.right <= width + 1);
      assert(item.geometry.hit);
      item.commands = await page.evaluate(() => window.__nativeSaveCommands);
      assert.equal(item.commands.filter(command => command === "write_project_bundle").length, 1);
      const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
      item.screenshot = await captureInstalledWebview(page, cdp, path.join(out, `${width}-${dpr}-${reduced}.png`),
        { width, height, dpr, reduced });
      // The normal toast previews 96 characters. Use its real detail action
      // rather than treating a deliberately abbreviated preview as the report.
      await notice.click();
      await page.waitForFunction(() => window.__nativeSaveReports.some(r => r.command === "open_error_report"));
      item.openedReport = await page.evaluate(() =>
        window.__nativeSaveReports.find(r => r.command === "open_error_report").message);
      const summary = item.openedReport.split("== Developer Diagnosis ==")[0];
      assert(summary.includes("重新选择") && summary.includes("写入权限") && summary.includes("可用空间"));
      assert(!summary.includes("请确认素材仍可在素材库中预览"));
      await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });
      await notice.waitFor({ state: "hidden", timeout: 10000 });
      item.status = "PASS"; save();
    }
    assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []);
    report.status = "PASS";
  } catch (error) {
    report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
    if (report.cases.at(-1)?.status === "RUNNING") report.cases.at(-1).status = "FAILED";
    await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  } finally {
    await browser?.close(); await env?.stop(); save();
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length, error: report.error, out }));
  }
})();
