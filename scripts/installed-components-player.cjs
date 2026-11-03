"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { settleRuntime } = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview, readInstalledViewport } = require("./lib/installed-webview-capture.cjs");
const assistantReview = process.env.AGENTVN_ASSISTANT_SESSION === "review";
const run = assistantReview ? "D:/AgentVN/output/installed-assistant-review-20261018-01" : process.env.AGENTVN_COMPONENTS_SESSION === "import-use"
  ? "D:/AgentVN/output/installed-components-use-20261018-01" : "D:/AgentVN/output/installed-components-20261018-01";
const destination = process.argv[2];
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const exported = read(path.join(run, assistantReview ? (process.env.AGENTVN_ASSISTANT_REVIEW_REPORT || "review-07/report.json") : "export-01/report.json")), fixture = read(path.join(run, "fixtures.json"));
const expectedImages = assistantReview ? [fixture.image] : fixture.images;
const buttonName = action => assistantReview ? `审核${action}卡操作` : `分享组件${action}`;
const launch = read(path.join(run, "launch-02.json")), exe = path.join(launch.installRoot, "agentvn-player.exe");
assert(exported.status === "PASS" && destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], cases: [], screenshots: [], consoleErrors: [],
  realModelRequests: 0, error: null, cleanup: {},
  scope: "ACTUAL_INSTALLED_PLAYER_UNMODIFIED_UI_EXPORTED_CARTRIDGE; 12 native WebView viewport combinations, not physical 4K",
  motionScope: "Functional menu actions/return, visibility/geometry/focus; NOT full Runtime transition audit" };
let child, browser, page, cdp, owned, expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
function check(name, ok, detail) { report.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); assert(ok, name); }
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`), expected)); }
(async () => {
  const previous = read("D:/AgentVN/output/installed-video-20261018-01/player-01/report.json");
  assert.equal(sha(fs.readFileSync(exe)), previous.exe.sha256);
  report.exe = { path: exe, sha256: previous.exe.sha256 }; report.cartridge = exported.cartridge;
  assert.equal(sha(fs.readFileSync(report.cartridge.path)), report.cartridge.sha256);
  const port = await new Promise(resolve => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  }); report.cdpPort = port;
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  child = spawn(exe, ["--mode", "preview", "--cartridge", report.cartridge.path],
    { cwd: launch.installRoot, env, windowsHide: true, stdio: "ignore" });
  report.pid = child.pid; owned = processInfo(child.pid); report.originalProcess = owned;
  assert.equal(owned?.ExecutablePath.toLowerCase(), exe.toLowerCase());
  const deadline = Date.now() + 45000; let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 100));
  } assert(ready, "Owned installed player debugger not ready");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(30000);
  page.on("pageerror", e => report.consoleErrors.push(String(e)));
  cdp = await page.context().newCDPSession(page);
  await page.getByTestId("runtime-custom-component").first().waitFor(); await settleRuntime(page);
  for (const [width, height] of [[1920, 1080], [2560, 1440], [3840, 2160]]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    expected = { width, height, dpr, reduced }; const item = { ...expected, status: "RUNNING", components: [], actions: [] }; report.cases.push(item);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" }); await settleRuntime(page);
    await readInstalledViewport(page, expected);
    const components = page.getByTestId("runtime-custom-component"); assert.equal(await components.count(), 2);
    for (const component of await components.all()) {
      const info = await component.evaluate(async node => {
        const box = node.getBoundingClientRect(), button = node.querySelector("button"), r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const images = [];
        for (const i of node.querySelectorAll("img")) {
          await i.decode(); const bytes = await (await fetch(i.currentSrc)).arrayBuffer();
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          images.push({ assetId: i.dataset.assetId, width: i.naturalWidth, height: i.naturalHeight,
            sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") });
        }
        return { id: node.dataset.componentId, title: node.querySelector('[data-binding="project.title"]')?.textContent,
          box: box.toJSON(), button: r.toJSON(), hit: button === hit || button.contains(hit), images,
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      assert.equal(info.title, fixture.title); assert.equal(info.images.length, assistantReview ? 1 : 2);
      assert(info.images.every(i => i.width === 48 && i.height === 32 && expectedImages.some(f => f.sha256 === i.sha256)));
      assert(info.hit && info.overflow <= 1 && info.box.left >= 0 && info.box.right <= width + 1 && info.box.top >= 0 && info.box.bottom <= height + 1);
      assert(info.button.left >= info.box.left && info.button.right <= info.box.right + 1
        && info.button.top >= info.box.top && info.button.bottom <= info.box.bottom + 1);
      item.components.push(info);
    }
    const [a, b] = item.components.map(c => c.box);
    assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, "Copied components must not overlap");
    await shot(`${width}-dpr${dpr}-${reduced ? "reduced" : "normal"}`);
    for (const [action, screen] of [["关于", "about-screen"], ["帮助", "help-screen"]]) {
      await page.getByRole("button", { name: buttonName(action), exact: true }).click();
      await page.getByTestId(screen).waitFor(); await settleRuntime(page);
      assert.equal(await page.getByTestId("runtime-custom-component").count(), 0);
      const hiddenFocus = await page.evaluate(() => {
        const node = document.activeElement;
        return node instanceof HTMLElement && node !== document.body && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }); assert.equal(hiddenFocus, false);
      await page.getByTestId("renpy-menu-return").click(); await settleRuntime(page);
      await page.getByRole("button", { name: buttonName("关于"), exact: true }).waitFor();
      assert.equal(await page.getByTestId("runtime-custom-component").count(), 2);
      item.actions.push({ name: action, screen, status: "PASS" });
    }
    item.status = "PASS"; console.log(`PASS component player ${width} DPR${dpr} reduced=${reduced}`);
  }
  check(`Twelve actual native WebView combinations decode all ${assistantReview ? "two" : "four"} mapped images, preserve bindings/geometry and execute both whitelist actions`,
    report.cases.length === 12 && report.cases.every(c => c.status === "PASS" && c.actions.length === 2), { combinations: report.cases.length, successfulActions: 24 });
  // Actual story entry after using shared components, not just static previews.
  await page.getByTestId("start-new-game").click();
  await page.locator(assistantReview ? '.dialog-box[aria-label*="本轮独立 UI 验收"]' : '.dialog-box[aria-label*="QA_COMPONENTS_EXPORTED_PLAYER_STORY"]').waitFor();
  check("Unmodified UI-exported project remains playable after component menu roundtrips", true);
  assert.deepEqual(report.consoleErrors, []);
  assert.equal(sha(fs.readFileSync(report.cartridge.path)), report.cartridge.sha256); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.failureText = await page.locator("body").innerText().catch(() => ""); await shot("failure").catch(() => {}); }
}).finally(async () => {
  await browser?.close().catch(() => {});
  report.cleanup.method = "ATTRIBUTED_OWNED_PLAYER_TERMINATION_NOT_NORMAL_CLOSE_ACCEPTANCE";
  if (child && child.exitCode === null) {
    const current = processInfo(child.pid);
    if (current && (current.ExecutablePath !== owned.ExecutablePath || current.ParentProcessId !== owned.ParentProcessId
      || current.CreationDate !== owned.CreationDate)) {
      report.cleanup.status = "FAILED"; report.cleanup.error = "Ownership changed; refusing termination"; report.status = "FAILED"; process.exitCode = 1;
    } else {
      child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve)); report.cleanup.status = "PASS";
    }
  } else report.cleanup.status = "PASS";
  report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, cases: report.cases.length, error: report.error, cleanup: report.cleanup, destination }, null, 2));
});
