"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright");
const { startEditorAcceptance } = require("./lib/editor-ui-acceptance.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");
const { settleEditor } = require("./lib/installed-acceptance.cjs");
assert(process.env.AGENTVN_TEST_PROJECT && process.env.AGENTVN_WORKSPACE_OUTPUT);
const output = path.resolve(process.env.AGENTVN_WORKSPACE_OUTPUT);
const report = { status: "RUNNING", scope: "source-browser-isolated-backend-not-installed",
  modelSubmissions: 0, cases: [] };
let host, browser;
async function focusState(page) {
  return page.evaluate(() => {
    const active = document.activeElement, win = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
    const rect = active?.getBoundingClientRect();
    return { inside: Boolean(win?.contains(active)), tag: active?.tagName,
      label: active?.getAttribute("aria-label"), text: active?.textContent?.slice(0, 80),
      meaningful: active instanceof HTMLElement && active !== document.body
        && active.matches("button,textarea,input,select,a[href],[tabindex]")
        && !active.closest('[inert],[aria-hidden="true"]') && rect.width > 0 && rect.height > 0,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches } };
  });
}
async function openByKeyboard(page) {
  await page.locator('[data-workspace-surface="assistant"]:visible').click();
  await settleEditor(page);
  const panel = page.locator(".workspace-task-panel.is-open .assistant-chat-panel");
  await panel.getByRole("button", { name: "创造模式", exact: true }).click();
  const opener = panel.getByRole("button", { name: "在独立窗口打开创造工作台", exact: true });
  await opener.focus();
  await page.evaluate(() => {
    window.__assistantFocusProbe = { running: true, frames: [] };
    const sample = () => {
      const probe = window.__assistantFocusProbe;
      if (!probe.running) return;
      const win = document.querySelector('[data-testid="assistant-creation-workbench-window"]');
      if (win && !win.closest("[inert]")) probe.frames.push({
        time: performance.now(), inside: win.contains(document.activeElement),
        activeTag: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute("aria-label"),
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("Enter");
  const win = page.getByTestId("assistant-creation-workbench-window");
  await win.waitFor();
  await win.getByTestId("assistant-creation-workbench-studio").waitFor();
  await win.evaluate(async element => {
    await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return win;
}
(async () => {
  host = await startEditorAcceptance(output);
  report.service = { backendPid: host.backendPid, frontendPid: host.server.pid,
    backendUrl: host.backendUrl, frontendUrl: host.url };
  browser = await chromium.launch();
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2])
    for (const motion of ["no-preference", "reduce"]) {
      const item = { width, height, dpr, motion, status: "RUNNING", checks: [] };
      report.cases.push(item);
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr,
        reducedMotion: motion });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      await page.route(/\/api\/assistant\/(?:creation\/processes|chat)/, route => {
        if (route.request().method() !== "POST") return route.continue();
        report.modelSubmissions++;
        return route.abort();
      });
      try {
        await host.open(page);
        await settleEditor(page);
        const win = await openByKeyboard(page);
        item.openFocus = await focusState(page);
        item.openFrames = await page.evaluate(() => {
          window.__assistantFocusProbe.running = false;
          return window.__assistantFocusProbe.frames;
        });
        item.checks.push({ name: "keyboard-open-focus-is-actionable-inside-window",
          status: item.openFocus.inside && item.openFocus.meaningful ? "PASS" : "FAILED" });
        item.geometry = await win.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(item.geometry.x >= 0 && item.geometry.y >= 0
          && item.geometry.right <= width && item.geometry.bottom <= height && item.geometry.overflow <= 1);
        const close = win.getByRole("button", { name: "关闭工作台", exact: true });
        await close.focus();
        await page.keyboard.press("Enter");
        await win.waitFor({ state: "detached" });
        item.closeFocus = await focusState(page);
        item.checks.push({ name: "keyboard-close-restores-live-focus",
          status: item.closeFocus.meaningful && !item.closeFocus.inside ? "PASS" : "FAILED" });
        assert(item.openFrames.length > 0 && item.openFrames.every(frame => frame.inside),
          "Keyboard focus must remain inside the user-opened window during entry and lazy content readiness");
        if (width === 1920 && dpr === 1 && motion === "no-preference") {
          const reopened = await openByKeyboard(page);
          await page.evaluate(() => { window.__assistantFocusProbe.running = false; });
          const editButton = page.locator('[data-workspace-surface="edit"]:visible');
          await editButton.click();
          assert(await editButton.evaluate(element => document.activeElement === element),
            "A nonmodal workbench must allow intentional focus on the background toolbar");
          assert(await reopened.isVisible(), "Background focus must not close the nonmodal workbench");
          const minimize = reopened.getByRole("button", { name: "最小化工作台", exact: true });
          await minimize.focus();
          await page.keyboard.press("Enter");
          const restore = reopened.getByRole("button", { name: "恢复工作台", exact: true });
          assert(await restore.evaluate(element => document.activeElement === element));
          assert(!(await reopened.locator(".assistant-creation-workbench-content").isVisible()));
          await page.keyboard.press("Enter");
          assert((await focusState(page)).inside);
          const nextClose = reopened.getByRole("button", { name: "关闭工作台", exact: true });
          await nextClose.focus();
          await page.keyboard.press("Enter");
          item.closingFocus = await focusState(page);
          assert(item.closingFocus.meaningful && !item.closingFocus.inside,
            "Transfer focus before the decorative exit completes");
          const options = page.locator('[data-workspace-surface="options"]:visible');
          await options.focus();
          await reopened.waitFor({ state: "detached" });
          assert(await options.evaluate(element => document.activeElement === element),
            "Exit cleanup must not steal focus from the user's newer target");
          item.nonmodalMinimizeAndCloseInterruption = "PASS";
        }
        assert.deepEqual(item.openFocus.viewport, { width, height, dpr, reduced: motion === "reduce" });
        const screenshotPath = path.join(output, `focus-${width}-dpr${dpr}-${motion}.png`);
        const png = await page.screenshot({ path: screenshotPath });
        assert.equal(png.readUInt32BE(16), width * dpr);
        assert.equal(png.readUInt32BE(20), height * dpr);
        item.screenshot = { path: screenshotPath, pixels: [png.readUInt32BE(16), png.readUInt32BE(20)],
          sha256: crypto.createHash("sha256").update(png).digest("hex") };
        assert.equal(report.modelSubmissions, 0);
        item.status = item.checks.every(check => check.status === "PASS") ? "PASS" : "FAILED";
      } catch (error) {
        item.status = "FAILED"; item.error = String(error.stack || error);
      } finally { await context.close(); }
      fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ width, dpr, motion, status: item.status, checks: item.checks, error: item.error }));
    }
  assert.equal(report.cases.length, 12);
  report.status = report.cases.every(item => item.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") process.exitCode = 1;
})().catch(error => {
  report.status = "TOOL_FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  await host?.stop();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, modelSubmissions: report.modelSubmissions }));
});
