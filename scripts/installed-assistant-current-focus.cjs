"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { settleEditor, sha256 } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-assistant-session-20261018-01", out = process.argv[2];
assert(out && !fs.existsSync(out)); fs.mkdirSync(out);
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const launch = read(path.join(run, "launch-03.json"));
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], screenshots: [], realModelRequests: 0,
  error: null, installedSha256: launch.executableSha256, scope: "ACTUAL_INSTALLED_RELEASE_CLOSE_FOCUS; no product repair" };
let browser, page, cdp;
const variant = process.argv[3]?.split(",");
const expected = variant ? { width: Number(variant[0]), height: Number(variant[1]), dpr: Number(variant[2]), reduced: variant[3] === "true" }
  : { width: 1920, height: 1080, dpr: 1, reduced: false };
report.expected = expected;
(async () => {
  assert.equal(sha256(fs.readFileSync(path.join(launch.installRoot, "agentvn-editor.exe"))), launch.executableSha256);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${launch.cdpPort}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(15000); cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: expected.width, height: expected.height, deviceScaleFactor: expected.dpr, mobile: false });
  await page.emulateMedia({ reducedMotion: expected.reduced ? "reduce" : "no-preference" });
  await page.locator('[data-workspace-surface="assistant"]:visible').click(); await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  const opener = panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true });
  await opener.focus(); await page.keyboard.press("Enter");
  const win = page.getByTestId("assistant-creation-workbench-window"); await win.waitFor();
  await win.getByTestId("assistant-creation-workbench-studio").waitFor();
  await win.evaluate(async n => {
    await Promise.all(n.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity)
      .map(a => a.finished.catch(() => {})));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  // Opening a nonmodal window must put keyboard ownership inside that window,
  // otherwise typing/tabbing continues in the obscured background chat.
  report.openFocus = await win.evaluate(n => ({
    inside: n.contains(document.activeElement), tag: document.activeElement?.tagName,
    label: document.activeElement?.getAttribute("aria-label"), text: document.activeElement?.textContent?.slice(0, 120),
    activeRect: document.activeElement?.getBoundingClientRect().toJSON() }));
  report.checks.push({ name: "Keyboard-open moves focus into floating workbench", status: report.openFocus.inside ? "PASS" : "FAILED" });
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "opened-workbench-focus.png"), expected));
  report.openerStillMounted = await opener.count() > 0;
  const close = win.getByRole("button", { name: "关闭工作台", exact: true }); await close.focus(); await page.keyboard.press("Enter");
  await win.waitFor({ state: "detached" });
  report.closeFocus = await page.evaluate(() => {
    const n = document.activeElement, opener = document.querySelector('[data-testid="open-creation-workbench"]');
    const r = n?.getBoundingClientRect(), target = n instanceof HTMLElement
      && n !== document.body && n.matches('button,textarea,input,select,a[href],[tabindex]')
      && !n.closest('[inert],[aria-hidden="true"]') && r?.width > 0 && r?.height > 0;
    return { restored: opener ? n === opener : target, openerConnected: Boolean(opener), activeTag: n?.tagName,
      activeLabel: n?.getAttribute("aria-label"), activeText: n?.textContent?.slice(0, 120),
      rationale: "Restore original opener if it remains; otherwise a meaningful visible interactive fallback, not BODY" };
  });
  report.checks.push({ name: "Close restores keyboard focus to opener or meaningful live fallback", status: report.closeFocus.restored ? "PASS" : "FAILED" });
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, "closed-workbench-focus.png"), expected));
  report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status === "FAILED") report.defect = "G03_FLOATING_WORKBENCH_KEYBOARD_FOCUS_NOT_HANDED_OFF";
})().catch(e => { report.status = "FAILED"; report.error = String(e.stack || e); })
.finally(async () => {
  await browser?.close(); report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  if (report.status !== "PASS") process.exitCode = 1; console.log(JSON.stringify(report, null, 2));
});
