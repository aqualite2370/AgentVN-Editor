"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("../../editor/node_modules/playwright");
const { desktopViewports } = require("./current-acceptance-viewports.cjs");
const { sha256, settleRuntime } = require("./installed-acceptance.cjs");
const { captureInstalledWebview } = require("./installed-webview-capture.cjs");

async function verifyInstalledCartridge({ installRoot, cartridge, expectedTitle, out, profileRoot }) {
  const exe = path.join(installRoot, "agentvn-player.exe");
  const beforeHash = sha256(fs.readFileSync(cartridge));
  const result = { status: "RUNNING", exe, exeSha256: sha256(fs.readFileSync(exe)), cartridge,
    cartridgeSha256: beforeHash, cases: [], errors: [], cleanup: {} };
  let child, browser, page;
  try {
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer(); server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); });
    });
    const descriptor = fs.openSync(path.join(out, "installed-player.log"), "wx");
    child = spawn(exe, ["--mode", "preview", "--cartridge", cartridge], {
      cwd: installRoot, windowsHide: true, stdio: ["ignore", descriptor, descriptor],
      env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profileRoot || path.join(out, "player-webview"),
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    });
    fs.closeSync(descriptor); result.pid = child.pid; result.cdpPort = port;
    let ready = false;
    for (let i = 0; i < 160; i++) {
      assert.equal(child.exitCode, null, "Owned player exited during startup");
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert(ready, "Owned player debugging endpoint did not become ready");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(45000);
    page.on("pageerror", error => result.errors.push(String(error)));
    const session = await browser.contexts()[0].newCDPSession(page);
    await page.getByTestId("runtime-custom-component").waitFor(); await settleRuntime(page);
    for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await settleRuntime(page);
      const custom = page.getByTestId("runtime-custom-component"); assert.equal(await custom.count(), 1);
      const metrics = await custom.evaluate(async node => {
        const image = node.querySelector("img"); await image.decode(); const button = node.querySelector("button"), rect = button.getBoundingClientRect(), box = node.getBoundingClientRect();
        return { title: node.querySelector('[data-binding="project.title"]').textContent, imageWidth: image.naturalWidth,
          hit: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), rect: rect.toJSON(), box: box.toJSON(), overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(metrics.title, expectedTitle); assert(metrics.imageWidth > 0 && metrics.hit && metrics.overflow <= 1);
      assert(metrics.rect.top >= metrics.box.top && metrics.rect.bottom <= metrics.box.bottom);
      await custom.getByRole("button", { name: "组件打开关于", exact: true }).click(); await page.getByTestId("about-screen").waitFor(); await settleRuntime(page);
      await page.getByTestId("renpy-menu-return").click(); await settleRuntime(page); await custom.waitFor();
      result.cases.push({ width, height, dpr, reduced, metrics, status: "PASS" });
      console.log(`PASS installed external player ${width} DPR${dpr} ${reduced ? "reduced" : "normal"}`);
      (result.screenshots ||= []).push(await captureInstalledWebview(page, session,
        path.join(out, `external-${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}.png`),
        { width, height, dpr, reduced }));
    }
    assert.equal(result.cases.length, 12); assert.deepEqual(result.errors, []);
    assert.equal(sha256(fs.readFileSync(cartridge)), beforeHash); result.status = "PASS";
  } catch (error) {
    result.status = "FAILED"; result.error = String(error.stack || error);
    await page?.screenshot({ path: path.join(out, "external-failure.png") }).catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
    if (child?.pid && child.exitCode === null) {
      const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      result.cleanup.exitCode = stopped.status;
      if (stopped.status !== 0) { result.status = "FAILED"; result.cleanup.error = "Owned player cleanup failed"; }
    } else result.cleanup.exitCode = 0;
    fs.writeFileSync(path.join(out, "installed-player-report.json"), JSON.stringify(result, null, 2));
  }
  assert.equal(result.status, "PASS", result.error || result.cleanup.error || "Installed player verification failed");
  return result;
}
module.exports = { verifyInstalledCartridge };
