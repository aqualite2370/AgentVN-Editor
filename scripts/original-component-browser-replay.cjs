"use strict";
// Same retained bytes through the public live-preview protocol; not installation evidence.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process"), net = require("node:net"), crypto = require("node:crypto");
const { chromium } = require("../editor/node_modules/playwright"), JSZip = require("../editor/node_modules/jszip");
const { rows, listeners, until, ps } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs"), { stopOwnedProcess } = require("./lib/owned-process-stop.cjs");
const { readInstalledViewport, captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const run = process.argv[2]; assert.match(run || "", /^\d{2}$/);
const root = path.resolve(__dirname, ".."), out = path.resolve("F:/AgentVN/QA/Original-Component-Replay-20261103-01", `browser-${run}`);
assert(!fs.existsSync(out)); fs.mkdirSync(out);
const input = path.resolve("F:/AgentVN/QA/Installed-Real-Component-20261031-01/new-component-agent-01/qa-installed-real-component-20261031-01-0.1.0.vncart");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
assert.equal(hash(fs.readFileSync(input)), "8a4d33b1a3e641b7a2f258f4408aba9088741cc8965a9b8d3a050ec36c5a8f04");
const report = { status: "RUNNING", scope: "SOURCE_BROWSER_EXACT_HISTORICAL_COMPONENT_NOT_INSTALLED",
  startedAt: new Date().toISOString(), cartridge: { path: input, sha256: hash(fs.readFileSync(input)) },
  sources: ["GameCli_framework/src/components/shell/RenpyTitleView.tsx", "shared/cartridge/renpyTitleControls.ts"]
    .map(file => ({ path: path.resolve(root, file), sha256: hash(fs.readFileSync(path.join(root, file))) })),
  modelRequests: 0, screenshots: [], matrix: [], errors: [], cleanup: "NOT_RUN" };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let host, port, browser, identity;
const known = new Map(), key = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (host) for (const p of ownedProcessTree(rows(), host.pid, identity?.Created)) {
    if (p.ProcessId === host.pid) identity ??= p;
    known.set(key(p), p);
  }
  report.known = [...known.values()]; save();
}
(async () => {
  save();
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(input), { checkCRC32: true });
    const manifest = JSON.parse(await zip.file("manifest.json").async("string")),
      script = JSON.parse(await zip.file("script.json").async("string")),
      uiSkin = JSON.parse(await zip.file("ui/layout.json").async("string")), assetUrls = {};
    for (const asset of manifest.assets) assetUrls[asset.asset_id] =
      `data:${asset.mime_type};base64,${await zip.file(asset.path).async("base64")}`;
    const componentsBefore = JSON.stringify(uiSkin.screens.find(s => s.screen_id === "title").components);
    port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once("error", reject);
      s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); }); });
    assert.equal(listeners([port]).length, 0);
    const log = fs.openSync(path.join(out, "server.log"), "wx");
    host = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "vite.config.cjs", "--configLoader",
      "native", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: path.join(root, "GameCli_framework"), windowsHide: true, stdio: ["ignore", log, log] }); fs.closeSync(log);
    await until(() => { remember(); return identity; }, "source server identity");
    await until(async () => { assert.equal(host.exitCode, null); remember();
      try { return (await fetch(`http://127.0.0.1:${port}`)).ok; } catch { return false; }
    }, "source owned strict port");
    const sockets = listeners([port]); assert.equal(sockets.length, 1);
    assert([...known.values()].some(p => p.ProcessId === sockets[0].OwningProcess));
    report.launch = { identity, port, sockets }; save();
    browser = await chromium.launch();
    for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
      const value = { width, height: width * 9 / 16, dpr, reduced };
      const context = await browser.newContext({ viewport: { width, height: value.height }, deviceScaleFactor: dpr,
        reducedMotion: reduced ? "reduce" : "no-preference" }), page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: value.height,
        deviceScaleFactor: dpr, mobile: false });
      page.setDefaultTimeout(20000); page.on("pageerror", e => report.errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/?mode=preview`);
      await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0);
      await page.evaluate(data => window.postMessage({ type: "agentvn.live-preview.init", protocolVersion: 2,
        sessionId: "original-component-replay", revision: 1, requestId: "original", runId: "original",
        ...data, screen: "title_menu" }, "*"), { manifest, script, uiSkin, assetUrls });
      const ready = async screen => {
        await page.waitForFunction(s => {
          const n = document.querySelector("[data-runtime-screen-transition]");
          return n?.getAttribute("data-runtime-presented-screen") === s && n.dataset.runtimeScreenTransition === "idle";
        }, screen); await settleRuntime(page);
      };
      await ready("title_menu"); await page.getByTestId("start-new-game").click(); await ready("playing");
      await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
      await page.keyboard.press("Escape"); await ready("main_menu");
      const actual = await readInstalledViewport(page, value);
      const result = await page.evaluate(() => {
        const component = document.querySelector('[data-testid="runtime-custom-component"]'),
          nav = document.querySelector('[data-testid="main-menu-actions"]'), frame = document.querySelector('[data-testid="renpy-title-view"]');
        if (!component || !nav || !frame) throw Error("Original component/menu missing");
        const obstacle = component.getBoundingClientRect(), controls = [];
        for (const button of nav.querySelectorAll("button")) {
          const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT), chars = []; let node;
          while ((node = walker.nextNode())) for (let i = 0; i < node.textContent.length; i++) {
            if (!node.textContent[i].trim()) continue;
            const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
            for (const box of r.getClientRects()) {
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              chars.push({ character: node.textContent[i], owned: hit === button || button.contains(hit),
                overlap: Math.min(box.right, obstacle.right) > Math.max(box.left, obstacle.left)
                  && Math.min(box.bottom, obstacle.bottom) > Math.max(box.top, obstacle.top) });
            }
          }
          const rect = button.getBoundingClientRect();
          controls.push({ id: button.dataset.testid, chars, rect: rect.toJSON() });
        }
        return { controls, component: obstacle.toJSON(), frame: frame.getBoundingClientRect().toJSON(),
          overflow: document.documentElement.scrollWidth - innerWidth, clear: nav.dataset.titleNavigationClear };
      });
      assert.equal(result.controls.length, 7); assert.equal(result.clear, "true");
      assert(result.controls.every(c => c.chars.length && c.chars.every(char => char.owned && !char.overlap)));
      assert(result.controls.every(c => c.rect.left >= 0 && c.rect.top >= 0
        && c.rect.right <= width + 1 && c.rect.bottom <= value.height + 1));
      assert(result.overflow <= 1);
      for (const c of result.controls) {
        await page.getByTestId(c.id).focus();
        assert(await page.getByTestId(c.id).evaluate(n => document.activeElement === n));
      }
      report.screenshots.push(await captureInstalledWebview(page, cdp,
        path.join(out, `${width}-${dpr}-${reduced ? "reduced" : "normal"}.png`), value));
      await page.getByRole("button", { name: "组件打开关于", exact: true }).click(); await ready("about");
      await page.keyboard.press("Escape"); await ready("main_menu");
      await page.getByTestId("open-settings").click(); await ready("settings");
      await page.keyboard.press("Escape"); await ready("main_menu");
      await page.getByTestId("continue-game").click(); await ready("playing");
      assert.match(await page.locator(".dialog-box").innerText(), /本轮独立 UI 验收/);
      report.matrix.push({ ...value, actual, result, componentAction: true, settingsAction: true, continueAction: true, status: "PASS" });
      save(); await context.close(); console.log(`PASS original ${width}/${dpr}/${reduced}`);
    }
    assert.equal(report.matrix.length, 12); assert.deepEqual(report.errors, []);
    assert.equal(JSON.stringify(uiSkin.screens.find(s => s.screen_id === "title").components), componentsBefore);
    report.status = "PASS";
  } catch (e) { report.status = "FAILED"; report.error = String(e.stack || e); }
  finally {
    await browser?.close();
    try {
      remember(); for (const p of [...known.values()].reverse()) stopOwnedProcess(p, ps);
      await until(() => !rows().some(p => known.has(key(p))) && (!port || !listeners([port]).length), "source server cleanup", 15000);
      report.cleanup = "PASS";
    } catch (e) { report.cleanup = "FAILED"; report.cleanupError = String(e.stack || e); report.status = "FAILED"; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, matrix: report.matrix.length, cleanup: report.cleanup, out }));
    process.exitCode = report.status === "PASS" ? 0 : 1;
  }
})();
