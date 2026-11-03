"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
const { sha256, settleRuntime } = require("./installed-acceptance.cjs");
const { captureInstalledWebview } = require("./current-native-capture.cjs");
async function verifyInstalledSharedMenu({ installRoot, cartridge, out }) {
  fs.mkdirSync(out, { recursive: false });
  const exe = path.join(installRoot, "agentvn-player.exe");
  const report = { status: "RUNNING", exe, executableSha256: sha256(fs.readFileSync(exe)), cartridge, cartridgeSha256: sha256(fs.readFileSync(cartridge)), cases: [], errors: [], scope: "actual installed player; WebView CDP logical viewport simulation, not physical 4K display" };
  let child, browser, page;
  try {
    const port = await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once("error", reject); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
    const log = fs.openSync(path.join(out, "player.log"), "wx");
    try { child = spawn(exe, ["--mode", "preview", "--cartridge", cartridge], { cwd: installRoot, windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } }); } finally { fs.closeSync(log); }
    report.pid = child.pid;
    const deadline = Date.now() + 60000; let ready = false;
    while (Date.now() < deadline) { assert.equal(child.exitCode, null); try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    assert(ready, "Owned installed player readiness failed");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(30000);
    page.on("pageerror", error => report.errors.push(String(error))); const session = await browser.contexts()[0].newCDPSession(page);
    await page.getByTestId("game-state-title").waitFor(); await settleRuntime(page);
    const shared = page.locator('[data-ui-component-scope="game_menu"]'); assert.equal(await shared.count(), 0);
    await page.getByTestId("open-settings").click(); await page.getByTestId("settings-screen").waitFor(); await settleRuntime(page);
    assert.equal(await shared.count(), 1);
    await shared.evaluate(node => { window.__installedSharedNode = node; });
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      await session.send("Emulation.clearDeviceMetricsOverride");
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false }); await settleRuntime(page);
      await page.waitForFunction(({ width, height, dpr, reduced }) => innerWidth === width && innerHeight === height && Math.abs(devicePixelRatio - dpr) <= 1e-6 && matchMedia('(prefers-reduced-motion: reduce)').matches === reduced, { width, height, dpr, reduced });
      const metrics = await shared.getByRole("img", { name: "Agent徽章", exact: true }).evaluate(async img => { await img.decode(); const node = img.closest('[data-testid="runtime-custom-component"]'), rect = node.getBoundingClientRect(); return { width: img.naturalWidth, rect: rect.toJSON(), clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1, overflow: document.documentElement.scrollWidth - innerWidth }; });
      assert(metrics.width > 0 && !metrics.clipped && metrics.overflow <= 1 && metrics.rect.left >= 0 && metrics.rect.top >= 0 && metrics.rect.right <= width + 1 && metrics.rect.bottom <= height + 1);
      for (const [button, target] of [["renpy-menu-about", "about-screen"], ["renpy-menu-help", "help-screen"], ["renpy-menu-settings", "settings-screen"]]) {
        await page.getByTestId(button).click(); await page.getByTestId(target).waitFor(); await settleRuntime(page);
        assert.equal(await shared.count(), 1); assert(await shared.evaluate(node => node === window.__installedSharedNode));
        assert.equal(await page.getByTestId("runtime-blackout").count(), 0);
      }
      const capture = await captureInstalledWebview(page, session,
        path.join(out, `installed-player-${width}-${dpr}-${reduced}.png`), { width, height, dpr, reduced });
      report.cases.push({ width, height, dpr, reduced, metrics, capture, status: "PASS" });
    }
    await page.getByTestId("renpy-menu-return").click(); await page.getByTestId("game-state-title").waitFor(); await settleRuntime(page); assert.equal(await shared.count(), 0);
    assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []); assert.equal(sha256(fs.readFileSync(cartridge)), report.cartridgeSha256); report.status = "PASS";
  } catch (error) { report.status = "FAILED"; report.error = String(error.stack || error); await page?.screenshot({ path: path.join(out, "failure.png") }).catch(() => {}); }
  finally {
    await browser?.close().catch(() => {});
    report.cleanup = child?.pid && child.exitCode === null ? { exitCode: spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).status } : { exitCode: 0 };
    if (report.cleanup.exitCode !== 0) report.status = "FAILED";
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  }
  assert.equal(report.status, "PASS", report.error || "Installed player cleanup failed"); return report;
}
module.exports = { verifyInstalledSharedMenu };
