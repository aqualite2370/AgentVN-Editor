"use strict";
const fs = require("node:fs"), path = require("node:path"), net = require("node:net");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-assets-20261018-01", destination = process.argv[2];
assert(destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const sha = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const exported = read(path.join(run, "cartridge-02/report.json")).cartridge;
const installed = read(path.join(run, "launch-03.json")), fixture = read(path.join(run, "fixtures.json"));
const exe = path.join(installed.installRoot, "agentvn-player.exe");
const report = { status: "RUNNING", scope: "REAL_INSTALLED_PLAYER_CONSUMES_UI_EXPORTED_CARTRIDGE_BACKGROUND_NOT_WINDOWS_PACKAGE_ACCEPTANCE",
  at: new Date().toISOString(), checks: [], screenshots: [], error: null, cleanup: {}, realModelRequests: 0 };
let child, browser, page, cdp;
function check(name, condition, detail) { report.checks.push({ name, status: condition ? "PASS" : "FAILED", detail }); assert(condition, name); }
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
(async () => {
  assert.equal(sha(exported.path), exported.sha256);
  const port = await new Promise(resolve => {
    const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(() => resolve(p)); });
  });
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(name)) delete env[name];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  child = spawn(exe, ["--mode", "preview", "--cartridge", exported.path], {
    cwd: installed.installRoot, env, windowsHide: true, stdio: "ignore",
  });
  report.pid = child.pid; report.cdpPort = port; report.exe = { path: exe, sha256: sha(exe) };
  report.cartridge = exported; report.originalProcess = processInfo(child.pid);
  assert.equal(report.originalProcess?.ExecutablePath.toLowerCase(), exe.toLowerCase());
  const deadline = Date.now() + 45000; let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, "Owned cartridge player's actual debugger unavailable");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(30000);
  cdp = await page.context().newCDPSession(page);
  const expected = { width: 1920, height: 1080, dpr: 1, reduced: false };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByTestId("start-new-game").waitFor(); await page.locator(".boot-overlay").waitFor({ state: "detached" });
  check("Actual installed binary loads the exact UI-exported cartridge title", (await page.locator("body").innerText()).includes("安装版全类型素材替换验收_20261018"));
  await page.getByTestId("start-new-game").click();
  await page.locator(".dialog-box").filter({ hasText: "全类型素材替换独立工程" }).waitFor();
  await page.waitForFunction(() => {
    const e = document.querySelector(".background-transition-frame.is-current");
    return e && getComputedStyle(e).backgroundImage.startsWith("url(") && Number(getComputedStyle(e).opacity) > .99;
  });
  report.rendered = await page.evaluate(async () => {
    const e = document.querySelector(".background-transition-frame.is-current"), css = getComputedStyle(e).backgroundImage;
    const src = css.match(/^url\(["']?(.*?)["']?\)$/)[1], image = new Image(); image.src = src; await image.decode();
    return { src, width: image.naturalWidth, height: image.naturalHeight, rect: e.getBoundingClientRect().toJSON(),
      bytes: Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer())) };
  });
  report.rendered.sha256 = crypto.createHash("sha256").update(Buffer.from(report.rendered.bytes)).digest("hex"); delete report.rendered.bytes;
  check("Real cartridge Runtime renders and fetches the upgraded background, not old image or thumbnail",
    report.rendered.sha256 === fixture.types[0].files.new.sha256 && report.rendered.width === 900 && report.rendered.height === 600, report.rendered);
  report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, "cartridge-actual-playing.png"), expected));
  assert.equal(sha(exported.path), exported.sha256);
  report.status = "PASS";
})().catch(error => { report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1; })
.finally(async () => {
  await browser?.close().catch(() => {});
  // Tool-blocked physical close is NOT called a normal-close PASS.
  report.cleanup.method = "OWNED_PROCESS_TERMINATION_NOT_PHYSICAL_CLOSE_ACCEPTANCE";
  if (child && child.exitCode === null) {
    const current = processInfo(child.pid);
    assert(current && current.ExecutablePath === report.originalProcess.ExecutablePath
      && current.ParentProcessId === report.originalProcess.ParentProcessId
      && current.CreationDate === report.originalProcess.CreationDate, "Owned process identity changed");
    child.kill();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
  }
  const deadline = Date.now() + 5000;
  let listening = true;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${report.cdpPort}/json/version`, { signal: AbortSignal.timeout(300) }); } catch { listening = false; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.cleanup.status = !processInfo(report.pid) && !listening ? "PASS" : "FAILED";
  if (report.cleanup.status !== "PASS") { report.status = "FAILED"; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, cleanup: report.cleanup, error: report.error }, null, 2));
});
