"use strict";
// Consume the already-exported live-model artifact. No further model calls.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const A = require("./lib/installed-acceptance.cjs");
const { captureInstalledWebview } = require("./lib/current-native-capture.cjs");
const { desktopViewports } = require("./lib/current-acceptance-viewports.cjs");

const sessionFile = path.resolve(process.argv[2] || "");
const out = path.resolve(process.argv[3] || "");
assert(process.argv[2] && process.argv[3]);
assert.equal(path.dirname(out), path.resolve("F:/AgentVN/QA/Native-Runtime-State-20261101-01"));
assert(!fs.existsSync(out), "Player evidence directory must be fresh");
const author = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
const sourceReport = JSON.parse(fs.readFileSync(author.creationReport.path, "utf8"));
assert.equal(author.creationReport.status, "PASS");
assert.equal(sourceReport.requests.length, 1);
assert.equal(sourceReport.process.result.edits.length, 1);
const artifact = author.creationReport.cartridgeArtifact;
const exe = path.join(author.installRoot, "agentvn-player.exe");
assert.equal(A.sha256(fs.readFileSync(exe)), author.playerSha256);
assert.equal(A.sha256(fs.readFileSync(artifact.path)), artifact.sha256);
const helper = "F:/AgentVN/QA/Editor-1.9.35-20261101-01/layout-closure-native-player-preparation-01/exact-current-player-profile.ps1";
assert(fs.existsSync(helper));
fs.mkdirSync(out);
const report = { status: "RUNNING", scope: "Installed Player consumes real-model-approved existing-button label",
  startedAt: new Date().toISOString(), modelRequests: 0, productChanges: 0, builds: 0,
  authorReport: { path: sessionFile, sha256: A.sha256(fs.readFileSync(sessionFile)) },
  executable: { path: exe, sha256: author.playerSha256 }, cartridge: artifact,
  cases: [], errors: [], screenshots: [], profiles: [], boundaries: [
    "Actual installed Player preview mode; not Windows setup or Android",
    "Logical WebView viewport/DPR simulation, not physical 4K",
    "Reuse exact already-generated artifact; no repeated AI submission",
  ] };
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
let browser, page, cdp, child, port, protectedProfile = false, identity;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function profile(action) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper,
    "-Action", action, "-RunDirectory", out, "-CodexCacheView"],
  { encoding: "utf8", windowsHide: true, timeout: 60000 });
  report.profiles.push({ action, exitCode: r.status });
  fs.writeFileSync(path.join(out, `profile-${action}.log`), r.stdout + r.stderr, { flag: "wx" });
  assert.equal(r.status, 0, "Player profile operation failed; inspect its log");
}
function currentIdentity() {
  const text = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${child.pid}" | Select-Object ProcessId,ExecutablePath,CreationDate | ConvertTo-Json -Compress`],
  { windowsHide: true, encoding: "utf8" });
  return text.trim() ? JSON.parse(text) : null;
}
(async () => {
  protectedProfile = true;
  profile("Prepare");
  port = await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(AGENTVN_|WEBVIEW2_|DATABASE_PATH$)/i.test(key)) delete env[key];
  const temporary = path.join(out, "temporary"); fs.mkdirSync(temporary);
  Object.assign(env, { WEBVIEW2_USER_DATA_FOLDER: path.join(out, "webview"),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: temporary, TMP: temporary });
  child = spawn(exe, ["--mode", "preview", "--cartridge", artifact.path],
    { cwd: author.installRoot, env, windowsHide: true, stdio: "ignore" });
  identity = currentIdentity(); assert(identity);
  assert.equal(path.resolve(identity.ExecutablePath).toLowerCase(), path.resolve(exe).toLowerCase());
  report.process = { ...identity, port }; save();
  let ready = false;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Owned Player exited before readiness");
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(600) })).ok; } catch {}
    if (ready) break; await pause(150);
  }
  assert(ready);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pageDeadline = Date.now() + 30000;
  while (Date.now() < pageDeadline) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tauri.localhost"));
    if (page && await page.getByTestId("game-state-title").count()) break;
    await pause(100);
  }
  assert(page); page.setDefaultTimeout(30000);
  page.on("pageerror", error => report.errors.push(String(error)));
  cdp = await page.context().newCDPSession(page);
  await page.getByTestId("game-state-title").waitFor(); await A.settleRuntime(page);
  for (const [width, height] of desktopViewports) for (const dpr of [1, 2]) for (const reduced of [false, true]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await A.settleRuntime(page);
    const button = page.getByTestId("start-new-game");
    assert.equal(await button.innerText(), "开始创作");
    await button.focus(); await button.click({ trial: true });
    const metrics = await button.evaluate(node => {
      const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { rect: rect.toJSON(), hit: node === hit || node.contains(hit), focused: document.activeElement === node,
        overflow: document.documentElement.scrollWidth - innerWidth, width: innerWidth, height: innerHeight,
        dpr: devicePixelRatio, reduced: matchMedia("(prefers-reduced-motion: reduce)").matches };
    });
    assert(metrics.hit && metrics.focused && metrics.overflow <= 1);
    assert(metrics.rect.left >= 0 && metrics.rect.top >= 0 && metrics.rect.right <= width + 1 && metrics.rect.bottom <= height + 1);
    assert.equal(metrics.width, width); assert.equal(metrics.height, height);
    assert(Math.abs(metrics.dpr - dpr) < 0.001); assert.equal(metrics.reduced, reduced);
    report.cases.push({ width, height, dpr, reduced, metrics, status: "PASS" });
    if (width === 1920 && !reduced) report.screenshots.push(await captureInstalledWebview(page, cdp,
      path.join(out, `button-${width}-dpr${dpr}.png`), { width, height, dpr, reduced }));
    save();
  }
  await page.getByTestId("open-help").click(); await page.getByTestId("help-screen").waitFor(); await A.settleRuntime(page);
  await page.getByTestId("renpy-menu-return").click(); await A.settleRuntime(page);
  assert.equal(await page.getByTestId("start-new-game").innerText(), "开始创作");
  await page.getByTestId("start-new-game").click();
  await page.getByTestId("game-state-playing").waitFor(); await A.settleRuntime(page);
  await page.locator(".dialog-text").waitFor();
  report.storyText = await page.locator(".dialog-text").innerText(); assert(report.storyText.length > 0);
  assert.equal(report.cases.length, 12); assert.deepEqual(report.errors, []);
  report.functionalResult = "PASS"; report.status = "PASS";
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(-4000);
}).finally(async () => {
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) {
    const actual = currentIdentity();
    if (actual && JSON.stringify(actual) === JSON.stringify(identity)) {
      const stopped = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      report.cleanupExitCode = stopped.status;
      if (stopped.status) { report.status = "FAILED"; process.exitCode = 1; }
    }
  }
  if (protectedProfile && fs.existsSync(path.join(out, "profile-protection.json"))) {
    try {
      profile("Restore");
      const restored = JSON.parse(fs.readFileSync(path.join(out, "profile-restoration.json"), "utf8"));
      assert.equal(restored.status, "PASS"); report.profileRestoration = "PASS";
    } catch (error) {
      report.status = "FAILED"; report.cleanupError = String(error); process.exitCode = 1;
    }
  }
  assert.equal(A.sha256(fs.readFileSync(exe)), author.playerSha256);
  assert.equal(A.sha256(fs.readFileSync(artifact.path)), artifact.sha256);
  report.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, out }));
});
