"use strict";
// Actual Windows Player glyph attribution. Does not modify styles or Runtime.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const assert = require("node:assert/strict"), { spawn } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { verifiedInstalledCandidate } = require("./lib/verified-installed-candidate.cjs");
const { rows, listeners, ps, until } = require("./lib/current-native-editor-session.cjs");
const { ownedProcessTree } = require("./lib/owned-process-tree.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
assert.equal(process.argv.length, 5, "installation receipt, actual author report, fresh output");
const [receiptFile, sourceFile, out] = process.argv.slice(2).map(p => path.resolve(p));
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = f => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const installation = verifiedInstalledCandidate(receiptFile), source = read(sourceFile);
assert.equal(source.status, "EDITOR_PASS_PLAYER_NOT_RUN");
assert.equal(sha(source.cartridge.path), source.cartridge.sha256);
assert.equal(installation.executable.sha256, source.installation.executable.sha256);
const exe = path.join(installation.installRoot, "agentvn-player.exe");
const expected = installation.resources.find(f => path.basename(f.path) === "agentvn-player.exe");
assert(expected); assert.equal(sha(exe), expected.sha256); assert(!fs.existsSync(out)); fs.mkdirSync(out);
const report = { status: "RUNNING", startedAt: new Date().toISOString(),
  scope: "ACTUAL_INSTALLED_WINDOWS_FONT_GLYPH_ATTRIBUTION_12_DISPLAYS",
  source: { path: sourceFile, sha256: sha(sourceFile) }, installation,
  player: { path: exe, sha256: sha(exe) }, matrix: [], screenshots: [], errors: [], modelRequests: 0,
  limitations: ["Physical 4K display and Android font rendering are not proven", "No font or DOM style injection"] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let child, browser, page, cdp, port, created;
const known = new Map();
const key = p => `${p.ProcessId}:${p.Created}`;
function remember() {
  if (!child) return;
  const tree = ownedProcessTree(rows(), child.pid, created);
  if (tree.length) created = tree[0].Created;
  for (const p of tree) known.set(key(p), p);
  report.knownProcesses = [...known.values()];
}
(async () => {
  fs.copyFileSync(__filename, path.join(out, "executed-test.cjs"), fs.constants.COPYFILE_EXCL); save();
  assert(!rows().some(p => p.Name === "agentvn-player.exe"), "Never reuse another Player");
  port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => {
      const value = s.address().port; s.close(e => e ? reject(e) : resolve(value));
    });
  });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$|VITE_BACKEND_URL$)/i.test(name)) delete env[name];
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` });
  const fd = fs.openSync(path.join(out, "player.log"), "wx");
  child = spawn(exe, ["--mode", "preview", "--cartridge", source.cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: ["ignore", fd, fd] }); fs.closeSync(fd);
  report.player.pid = child.pid; report.player.port = port; remember(); save();
  await until(async () => {
    assert.equal(child.exitCode, null); remember();
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; }
    catch { return false; }
  }, "owned Player WebView", 60000);
  const tree = ownedProcessTree(rows(), child.pid, created), activeListeners = listeners([port]);
  assert.equal(activeListeners.length, 1);
  assert(activeListeners.every(l => tree.some(p => p.ProcessId === l.OwningProcess)));
  report.debugListener = activeListeners;
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await until(() => browser.contexts().flatMap(c => c.pages()).find(p => /tauri\.localhost|^tauri:/.test(p.url())), "Player document");
  page.setDefaultTimeout(30000); page.on("pageerror", e => { report.errors.push(String(e)); save(); });
  cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  for (const width of [1920, 2560, 3840]) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    const m = { width, height: width * 9 / 16, dpr, reduced };
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: m.height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.reload(); await page.getByTestId("start-new-game").waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-runtime-boot-blocking]"));
    await page.getByTestId("start-new-game").click();
    await page.locator(".dialog-box").filter({ hasText: "GUI_CONSUMPTION" }).waitFor();
    await page.waitForFunction(() => document.querySelector(".story-player")?.dataset.isTyping === "false");
    await page.evaluate(() => document.fonts.ready);
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".dialog-text" });
    assert(nodeId); const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    assert(fonts.some(f => f.isCustomFont && /DejaVu/i.test(f.familyName) && f.glyphCount > 0), JSON.stringify(fonts));
    assert(fonts.some(f => !f.isCustomFont && /YaHei|SimSun|DengXian|CJK|Source Han/i.test(f.familyName)
      && f.glyphCount > 0), JSON.stringify(fonts));
    const rendered = await page.locator(".dialog-text").evaluate(n => ({
      text: n.textContent, fontFamily: getComputedStyle(n).fontFamily,
      rect: n.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches },
      overflow: document.documentElement.scrollWidth - innerWidth,
    }));
    assert(rendered.text.includes("中文字体回退")); assert(rendered.overflow <= 1);
    assert.equal(rendered.viewport.width, width); assert.equal(rendered.viewport.height, m.height);
    assert.equal(rendered.viewport.reduced, reduced); assert(Math.abs(rendered.viewport.dpr - dpr) < 1e-6);
    report.matrix.push({ ...m, status: "PASS", fonts, rendered }); save();
    if (width === 1920 && dpr === 1 && !reduced || width === 3840 && dpr === 2 && reduced)
      report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(out, `glyphs-${width}-${dpr}-${reduced}.png`), m));
    console.log(`PASS actual GUI glyph fonts ${width}/${dpr}/${reduced}`);
  }
  assert.equal(report.matrix.length, 12); assert.deepEqual(report.errors, []); report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
  .finally(async () => {
    try {
      remember(); await browser?.close().catch(() => {});
      for (const p of [...known.values()].reverse()) {
        if (!rows().some(q => key(q) === key(p))) continue;
        ps(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${p.ProcessId}';` +
          `if($p -and $p.CreationDate.ToUniversalTime().ToString('o') -eq '${p.Created}'){Stop-Process -Id ${p.ProcessId} -Force}`);
      }
      if (child) await until(() => !rows().some(p => known.has(key(p))) && !listeners([port]).length,
        "exact-owned glyph test cleanup", 15000);
      report.cleanup = { status: "PASS", killedIdentities: [...known.keys()], port, normalCloseClaimed: false };
    } catch (error) { report.cleanupError = String(error.stack || error); report.status = "FAILED"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, out, error: report.error, cleanupError: report.cleanupError }));
  });
