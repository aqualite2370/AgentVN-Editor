"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-video-20261018-01", destination = process.argv[2];
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const fixture = read(path.join(run, "fixtures.json")), exported = read(path.join(run, "ui-02/report.json"));
assert(exported.status === "PASS" && destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const launch = read(path.join(run, "launch.json")), exe = path.join(launch.installRoot, "agentvn-player.exe");
const report = { status: "RUNNING", at: new Date().toISOString(), checks: [], screenshots: [], error: null, cleanup: {},
  realModelRequests: 0, scope: "REAL_INSTALLED_PLAYER_WITH_UNMODIFIED_UI_EXPORTED_CARTRIDGE_NOT_DERIVATIVE",
  viewportScope: "Native WebView viewport emulation 1920x1080 DPR1 ordinary, NOT full UI matrix",
  instrumentation: "Read-only DOM listeners, decoded-frame pixel observations and fetched-source SHA; no engine/playback overrides" };
let child, browser, page, cdp, owned;
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
function check(name, ok, detail) { report.checks.push({ name, status: ok ? "PASS" : "FAILED", detail }); assert(ok, name); }
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`),
  { width: 1920, height: 1080, dpr: 1, reduced: false })); }
(async () => {
  const cartridge = exported.cartridge, expected = fixture.videos.find(v => v.version === "new");
  assert.equal(sha(fs.readFileSync(cartridge.path)), cartridge.sha256); report.cartridge = cartridge;
  const previous = read("D:/AgentVN/output/installed-asset-consumers-20261018-01/player-02/report.json");
  assert.equal(sha(fs.readFileSync(exe)), previous.exe.sha256); report.exe = { path: exe, sha256: previous.exe.sha256 };
  const port = await new Promise(resolve => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  report.cdpPort = port;
  const env = { ...process.env }; for (const key of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(key)) delete env[key];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  child = spawn(exe, ["--mode", "preview", "--cartridge", cartridge.path],
    { cwd: launch.installRoot, env, windowsHide: true, stdio: "ignore" });
  report.pid = child.pid; owned = processInfo(child.pid); report.originalProcess = owned;
  assert.equal(owned?.ExecutablePath.toLowerCase(), exe.toLowerCase());
  const deadline = Date.now() + 45000; let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, "Owned player debugger not ready");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page); page.setDefaultTimeout(30000);
  cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  report.consoleErrors = []; page.on("pageerror", e => report.consoleErrors.push(String(e)));
  await page.evaluate(() => {
    const qa = window.__qaMultiframe = { events: [], frames: [], source: null, sourceError: null };
    const seen = new WeakSet();
    for (const type of ["loadedmetadata", "playing", "timeupdate", "ended", "error"]) document.addEventListener(type, event => {
      const v = event.target; if (!(v instanceof HTMLVideoElement)) return;
      qa.events.push({ event: type, at: performance.now(), time: v.currentTime, duration: v.duration,
        width: v.videoWidth, height: v.videoHeight, error: v.error?.code ?? null });
      if (seen.has(v)) return; seen.add(v);
      fetch(v.currentSrc || v.src).then(r => r.arrayBuffer()).then(async bytes => {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        qa.source = { bytes: bytes.byteLength, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("") };
      }).catch(e => { qa.sourceError = String(e); });
      const canvas = document.createElement("canvas"); canvas.width = 48; canvas.height = 27;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const next = () => v.requestVideoFrameCallback((_, meta) => {
        ctx.drawImage(v, 0, 0, 48, 27); const data = ctx.getImageData(0, 0, 48, 27).data;
        let hash = 2166136261; for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
        qa.frames.push({ time: meta.mediaTime, presentedFrames: meta.presentedFrames, width: meta.width,
          height: meta.height, pixelSignature: hash >>> 0 }); next();
      }); next();
    }, true);
  });
  await page.getByTestId("start-new-game").waitFor(); await page.locator(".boot-overlay").waitFor({ state: "detached" });
  await page.getByTestId("start-new-game").click();
  const before = page.locator('.dialog-box[aria-label*="QA_MULTIFRAME_BEFORE_VIDEO"]'); await before.waitFor();
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  await before.click();
  await page.waitForFunction(() => window.__qaMultiframe.frames.some(f => f.time >= .4));
  await shot("real-moving-video");
  await page.locator('.dialog-box[aria-label*="QA_MULTIFRAME_AFTER_VIDEO"]').waitFor();
  await page.waitForFunction(() => window.__qaMultiframe.source !== null || window.__qaMultiframe.sourceError !== null);
  report.video = await page.evaluate(() => window.__qaMultiframe);
  const video = report.video;
  check("Unmodified cartridge exported by installed Editor feeds exact new video bytes to actual player",
    video.source?.sha256 === expected.sha256 && !video.sourceError, video.source);
  check("Player decodes multiple real 480x270 frames with advancing video time",
    video.frames.length >= 15 && video.frames.some(f => f.time > 1)
    && video.frames.every(f => f.width === 480 && f.height === 270), { frames: video.frames.length, lastFrame: video.frames.at(-1) });
  check("Decoded visible video content changes, not a static frame with a synthetic clock",
    new Set(video.frames.map(f => f.pixelSignature)).size >= 10, { uniqueFrameSignatures: new Set(video.frames.map(f => f.pixelSignature)).size });
  check("Real video ends without media errors and story resumes at expected post-video command",
    video.events.some(e => e.event === "ended" && e.duration > 1)
    && !video.events.some(e => e.event === "error") && report.consoleErrors.length === 0, video.events);
  await shot("story-after-video");
  assert.equal(sha(fs.readFileSync(cartridge.path)), cartridge.sha256); report.status = "PASS";
})().catch(async e => {
  report.status = "FAILED"; report.error = String(e.stack || e); process.exitCode = 1;
  if (page) { report.video = await page.evaluate(() => window.__qaMultiframe).catch(() => null); await shot("failure").catch(() => {}); }
}).finally(async () => {
  await browser?.close().catch(() => {});
  report.cleanup.method = "ATTRIBUTED_OWNED_PLAYER_TERMINATION_NOT_NORMAL_CLOSE_ACCEPTANCE";
  if (child && child.exitCode === null) {
    const current = processInfo(child.pid);
    if (current && (current.ExecutablePath !== owned.ExecutablePath || current.ParentProcessId !== owned.ParentProcessId
      || current.CreationDate !== owned.CreationDate)) {
      report.cleanup.status = "FAILED"; report.cleanup.error = "Ownership changed; refusing termination"; report.status = "FAILED"; process.exitCode = 1;
    } else {
      child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
      report.cleanup.status = "PASS";
    }
  } else report.cleanup.status = "PASS";
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, cleanup: report.cleanup, destination }, null, 2));
});
