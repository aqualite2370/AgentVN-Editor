"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), net = require("node:net");
const { spawn, execFileSync } = require("node:child_process"), assert = require("node:assert/strict");
const { chromium } = require("../editor/node_modules/playwright");
const { captureInstalledWebview } = require("./lib/installed-webview-capture.cjs");
const run = "D:/AgentVN/output/installed-asset-consumers-20261018-01", destination = process.argv[2];
const read = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const fixture = read(path.join(run, "fixtures.json"));
assert(fixture.status === "PASS" && destination && !fs.existsSync(destination)); fs.mkdirSync(destination);
const installation = read("D:/AgentVN/output/installed-assets-20261018-01/launch-03.json");
const exe = path.join(installation.installRoot, "agentvn-player.exe"), cartridge = fixture.output;
const report = { status: "RUNNING", scope: fixture.scope, at: new Date().toISOString(), checks: [], screenshots: [],
  network: [], mediaProperties: [], mediaEvents: [], mediaErrors: [], consoleErrors: [], error: null, cleanup: {},
  instrumentation: "Read-only CDP Media/Network, DOM media listeners, runtime diagnostics flag; no engine/store mutation",
  viewportScope: "Actual installed native WebView, emulated 1920x1080 DPR1 ordinary only",
  audioScope: "Technical loading/decoding/playback evidence, NOT new human listening confirmation", realModelRequests: 0 };
let child, browser, page, cdp, originalProcess;
const pendingBodies = new Set();
function processInfo(pid) {
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command",
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"|Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate|ConvertTo-Json`],
  { encoding: "utf8", windowsHide: true });
  return raw.trim() ? JSON.parse(raw.replace(/^\uFEFF/, "")) : null;
}
function check(name, condition, detail, collectAfterFailure = false) {
  report.checks.push({ name, status: condition ? "PASS" : "FAILED", detail });
  if (!collectAfterFailure) assert(condition, name);
}
async function shot(name) { report.screenshots.push(await captureInstalledWebview(page, cdp, path.join(destination, `${name}.png`),
  { width: 1920, height: 1080, dpr: 1, reduced: false })); }
async function bytesForVisibleImage(locator) {
  return locator.evaluate(async image => {
    await image.decode(); const bytes = new Uint8Array(await (await fetch(image.currentSrc)).arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { src: image.currentSrc, width: image.naturalWidth, height: image.naturalHeight,
      sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join(""),
      rect: image.getBoundingClientRect().toJSON() };
  });
}
async function advanceTo(marker) {
  const current = page.locator(".dialog-box");
  // Wait on actual completed text/page state, never force typing/store state.
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  await current.click();
  await page.locator(`.dialog-box[aria-label*="${marker}"]`).waitFor();
}
async function captureAudioObjects(stage) {
  // CDP inspects and retains the genuine detached Audio elements. No Audio
  // constructor/play override, synthetic event, engine or store write.
  const prototype = await cdp.send("Runtime.evaluate", { expression: "HTMLAudioElement.prototype", objectGroup: "qa-real-audio" });
  const objects = await cdp.send("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId, objectGroup: "qa-real-audio" });
  const result = await cdp.send("Runtime.callFunctionOn", { objectId: objects.objects.objectId, awaitPromise: true, returnByValue: true,
    functionDeclaration: `async function() {
      return Promise.all(this.filter(a => a.currentSrc || a.src).map(async a => {
        const src = a.currentSrc || a.src;
        const row = {src, currentTime:a.currentTime, duration:a.duration, paused:a.paused, ended:a.ended,
          error:a.error?.code??null, readyState:a.readyState};
        try {
          const bytes=await (await fetch(src)).arrayBuffer(), digest=await crypto.subtle.digest("SHA-256",bytes);
          row.bytes=bytes.byteLength; row.sha256=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
        } catch(error) {row.probeError=String(error);}
        return row;
      }));
    }` });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  const values = result.result.value; assert(Array.isArray(values));
  (report.audioObjects ||= []).push({ stage, values });
  return values;
}
const proof = id => fixture.assetProofs.find(a => a.id === id);
(async () => {
  assert.equal(sha(fs.readFileSync(cartridge.path)), cartridge.sha256);
  const port = await new Promise(resolve => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  report.cdpPort = port;
  const env = { ...process.env }; for (const k of Object.keys(env)) if (/^AGENTVN_|^WEBVIEW2_|^DATABASE_PATH$/i.test(k)) delete env[k];
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${port}`;
  child = spawn(exe, ["--mode", "preview", "--cartridge", cartridge.path],
    { cwd: installation.installRoot, env, windowsHide: true, stdio: "ignore" });
  report.pid = child.pid; report.exe = { path: exe, sha256: sha(fs.readFileSync(exe)) }; report.cartridge = cartridge;
  originalProcess = processInfo(child.pid); report.originalProcess = originalProcess;
  assert.equal(originalProcess?.ExecutablePath.toLowerCase(), exe.toLowerCase());
  const deadline = Date.now() + 45000; let ready = false;
  while (Date.now() < deadline && child.exitCode === null) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
    if (ready) break; await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, "Owned installed player's debugger not ready");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find(p => p.url().includes("tauri.localhost")); assert(page);
  page.setDefaultTimeout(30000); cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await cdp.send("Media.enable");
  cdp.on("Media.playerPropertiesChanged", e => report.mediaProperties.push({ at: new Date().toISOString(), ...e }));
  cdp.on("Media.playerEventsAdded", e => report.mediaEvents.push({ at: new Date().toISOString(), ...e }));
  cdp.on("Media.playerErrorsRaised", e => report.mediaErrors.push({ at: new Date().toISOString(), ...e }));
  page.on("pageerror", e => report.consoleErrors.push(String(e)));
  page.on("response", response => {
    if (!/qa_(background|sprite|portrait|bgm|voice|sfx|ui|font|video|other)/.test(decodeURIComponent(response.url()))) return;
    const p = (async () => {
      const entry = { at: new Date().toISOString(), url: response.url(), status: response.status() }; report.network.push(entry);
      try { const bytes = await response.body(); entry.sha256 = sha(bytes); entry.bytes = bytes.length; }
      catch (error) { entry.bodyReadError = String(error); }
    })();
    pendingBodies.add(p); p.finally(() => pendingBodies.delete(p));
  });
  await page.evaluate(() => {
    window.__AGENTVN_RUNTIME_DIAGNOSTICS_ENABLED__ = true;
    window.__qaVideoMediaEvents = [];
    for (const event of ["loadedmetadata", "playing", "timeupdate", "ended", "error", "resize"]) document.addEventListener(event, e => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      const v = e.target; window.__qaVideoMediaEvents.push({ event, at: performance.now(), src: v.currentSrc || v.src,
        currentTime: v.currentTime, duration: v.duration, width: v.videoWidth, height: v.videoHeight,
        readyState: v.readyState, error: v.error?.code ?? null });
    }, true);
  });
  await page.getByTestId("start-new-game").waitFor(); await page.locator(".boot-overlay").waitFor({ state: "detached" });
  check("Real installed player accepts exact validated controlled consumer cartridge",
    (await page.locator("body").innerText()).includes("替换素材真实消费探针_20261018"));
  await page.getByTestId("start-new-game").click();
  await page.locator('.dialog-box[aria-label*="QA_CONSUMER_DIALOG_FONT_VOICE_SPRITE"]').waitFor();
  await captureAudioObjects("first-dialog-bgm-and-voice");
  const sprite = page.locator('[data-sprite-id="qa_sprite"] img.sprite-visual').last(); await sprite.waitFor();
  report.sprite = await bytesForVisibleImage(sprite);
  check("Real sprite command renders upgraded sprite bytes", report.sprite.sha256 === proof("qa_sprite").sha256
    && report.sprite.width === 900 && report.sprite.rect.width > 0, report.sprite);
  report.font = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts].filter(f => f.family.includes("AgentVNFont_qa_font")).map(f => ({ family: f.family, status: f.status }));
    const nodes = [...document.querySelectorAll(".dialog-box *")].filter(e => getComputedStyle(e).fontFamily.includes("AgentVNFont_qa_font"));
    const style = [...document.querySelectorAll("style[data-agentvn-runtime-fonts]")].map(e => e.textContent).join("\n");
    return { faces, renderedTextNodes: nodes.length, style, check: document.fonts.check('16px "AgentVNFont_qa_font"', "QA_FONT_ASCII") };
  });
  check("Real dialog uses loaded upgraded font face rather than only retaining a file", report.font.check
    && report.font.faces.some(f => f.status === "loaded") && report.font.renderedTextNodes > 0, report.font);
  report.dialogPortraitObservation = await page.evaluate(() => ({
    images: [...document.images].map(i => ({ src: i.currentSrc, alt: i.alt })),
    renderedPortraitImages: [...document.images].filter(i => i.currentSrc.includes("qa_portrait")).length,
    scope: "Observation only: no claim that legacy dialog portrait has a dedicated renderer",
  }));
  await shot("dialog-sprite-font");
  await advanceTo("QA_CONSUMER_SFX_HOLD");
  await captureAudioObjects("sfx-command-hold");
  await shot("sfx-hold");
  await page.waitForFunction(() => document.querySelector(".dialog-box")?.getAttribute("data-dialog-page-done") === "true");
  await page.locator(".dialog-box").click();
  for (const [id, alt] of [["qa_ui", "QA_CONSUMER_UI"], ["qa_other", "QA_CONSUMER_OTHER"], ["qa_portrait", "QA_CONSUMER_PORTRAIT"]]) {
    const overlay = page.getByTestId("focused-image-overlay").filter({ has: page.getByTestId("focused-image").and(page.getByAltText(alt, { exact: true })) });
    await overlay.waitFor();
    const info = await bytesForVisibleImage(overlay.getByTestId("focused-image"));
    check(`Real generic image event consumes upgraded ${id} bytes`, info.sha256 === proof(id).sha256 && info.width === 900 && info.rect.width > 0, info);
    await shot(id);
    await overlay.press("Enter");
    await overlay.waitFor({ state: "hidden" });
  }
  await page.locator(".dialog-box").filter({ hasText: "QA_CONSUMER_FINISHED_AFTER_VIDEO" }).waitFor();
  report.video = await page.evaluate(() => window.__qaVideoMediaEvents);
  check("Actual video event decodes new 480x270 frames, advances time and finishes normally",
    report.video.some(e => e.event === "playing" && e.width === 480 && e.height === 270)
    && report.video.some(e => e.event === "timeupdate" && e.currentTime > 0)
    && report.video.some(e => e.event === "ended") && !report.video.some(e => e.event === "error"), report.video, true);
  report.videoFixtureLimitation = report.video.some(e => e.duration <= .001)
    ? "Original UI-replaced WebM has one canvas frame/duration 0.001s; full timeline assertion remains FAILED, not relaxed"
    : null;
  await shot("after-real-video");
  await Promise.all([...pendingBodies]);
  report.runtimeDiagnostics = await page.evaluate(() => window.__AGENTVN_RUNTIME_DIAGNOSTICS__);
  const byPlayer = new Map();
  for (const group of report.mediaProperties) {
    const current = byPlayer.get(group.playerId) || { id: group.playerId, properties: {}, events: [] };
    for (const p of group.properties) current.properties[p.name] = p.value;
    byPlayer.set(group.playerId, current);
  }
  for (const group of report.mediaEvents) {
    const current = byPlayer.get(group.playerId) || { id: group.playerId, properties: {}, events: [] };
    current.events.push(...group.events.map(e => { try { return JSON.parse(e.value); } catch { return e.value; } }));
    byPlayer.set(group.playerId, current);
  }
  report.mediaPlayers = [...byPlayer.values()];
  const bgmSource = report.runtimeDiagnostics?.audio.find(e => e.payload.kind === "bgm" && e.payload.assetId === "qa_bgm" && e.payload.phase === "play-request")?.payload.source;
  const first = report.audioObjects.find(g => g.stage === "first-dialog-bgm-and-voice").values;
  const later = report.audioObjects.find(g => g.stage === "sfx-command-hold").values;
  const playedSources = report.mediaPlayers.filter(p => p.events.some(e => e.event === "kPlay"))
    .map(p => p.events.find(e => e.event === "kLoad")?.url).filter(Boolean);
  const firstPlayed = first.filter(a => !a.paused && !a.ended && playedSources.includes(a.src));
  const voiceSources = firstPlayed.filter(a => a.src !== bgmSource).map(a => a.src);
  const firstSources = new Set(firstPlayed.map(a => a.src));
  const sfxSources = [...new Set(later.filter(a => !a.paused && !a.ended && !firstSources.has(a.src)
    && playedSources.includes(a.src)).map(a => a.src))];
  check("Runtime BGM diagnostic and actual sequential audio objects unambiguously map three command sources",
    typeof bgmSource === "string" && firstPlayed.some(a => a.src === bgmSource) && voiceSources.length === 1 && sfxSources.length === 1,
    { bgmSource, voiceSources, sfxSources, playedSources });
  const sourceFor = { bgm: bgmSource, voice: voiceSources[0], sfx: sfxSources[0] };
  for (const kind of ["bgm", "sfx", "voice"]) {
    const source = sourceFor[kind], actual = [...first, ...later].find(a => a.src === source);
    check(`Actual ${kind} audio element loads upgraded WAV bytes`, actual?.sha256 === proof(`qa_${kind}`).sha256 && !actual.error, actual);
    const matching = report.mediaPlayers.filter(p => p.events.some(e => e.event === "kLoad" && e.url === source));
    check(`Real detached ${kind} audio player has successful play and decoder pipeline evidence`,
      matching.some(p => p.events.some(e => e.event === "kPlay") && p.events.some(e => e.pipeline_state === "kPlaying")), matching);
  }
  check("No JavaScript errors or CDP media player errors during observed consumer sequence",
    report.consoleErrors.length === 0 && report.mediaErrors.length === 0, { consoleErrors: report.consoleErrors, mediaErrors: report.mediaErrors });
  assert.equal(sha(fs.readFileSync(cartridge.path)), cartridge.sha256);
  report.animationJsonScope = "PRESERVED_BYTES_ONLY_NO_RUNTIME_ASSET_READER; animation command consumes params, not this JSON asset";
  report.status = report.checks.every(c => c.status === "PASS") ? "PASS" : "FAILED";
  if (report.status !== "PASS") { report.error = "Video timeline assertion failed on original single-frame fixture; independent later checks retained"; process.exitCode = 1; }
})().catch(async error => {
  report.status = "FAILED"; report.error = String(error.stack || error); process.exitCode = 1;
  if (page) {
    report.failureText = await page.locator("body").innerText().catch(() => "");
    report.video = await page.evaluate(() => window.__qaVideoMediaEvents).catch(() => undefined);
    await shot("failure").catch(() => {});
  }
}).finally(async () => {
  await Promise.all([...pendingBodies]); await browser?.close().catch(() => {});
  report.cleanup.method = "ATTRIBUTED_OWNED_PLAYER_TERMINATION_NOT_NORMAL_CLOSE_ACCEPTANCE";
  if (child && child.exitCode === null) {
    const current = processInfo(child.pid);
    if (!current || current.ExecutablePath !== originalProcess.ExecutablePath
      || current.ParentProcessId !== originalProcess.ParentProcessId || current.CreationDate !== originalProcess.CreationDate) {
      report.cleanup.status = "FAILED"; report.cleanup.error = "Process ownership mismatch; not stopped"; report.status = "FAILED"; process.exitCode = 1;
    } else {
      child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
      report.cleanup.status = "PASS";
    }
  } else report.cleanup.status = "PASS";
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(destination, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, error: report.error, cleanup: report.cleanup, destination }, null, 2));
});
